/**
 * Targeted Revisions for Explainers. The item is one render (`explainers.jobs`, the spine's
 * native_ref). Scenes are not rows: each frame's scene module lives in the job's working folder on
 * the social worker VM (`<EXPLAINERS_JOBS_DIR>/<job id>/project/assets/frames/<id>.js`); only the
 * finished video, the contact sheet and the burned-in captions are in Storage, and the post caption
 * is an artifact row. The current file of each kind is the job's newest artifact row of that kind
 * (every reader orders by seq), so a revision points the job at new files by ADDING rows; nothing is
 * updated or deleted.
 *
 * Parts:
 *   { kind: 'scene', key: <frame module id> }  every frame a frame worker wrote: frame 1's hook
 *       (`01-hook`, under the bank's opener, which code writes) and the storyboard frames 2-7.
 *       The close (frame 8) is the kit's and the same in every reel, so it is not a part.
 *       Fixes wording | photo | color | layout all do the same redo: the person's words become the
 *       resume note naming that frame (job.ts sceneResumeNote), its module is removed, and ONE
 *       session B resumes in the kept workspace (job.ts rebuildScene, the RenderDeps.resume path):
 *       one frame worker, then mount, assemble, captions, the picture check and the render.
 *   { kind: 'caption', key: 'caption' }  the post caption. wording only: args.value is the exact new
 *       caption; the pipeline's own caption checks (parseCaption) gate it; no model call, $0.
 *
 * Scene redo order (nothing is written on any non-ok path):
 *   checks (part, args, published/rejected, retention + folder, the job's own spend cap) → hold the
 *   job's running slot (status 'running', stage 'revision': the one-render-at-a-time index, so no
 *   render starts and none is running) → hash every other scene, the plan, the voice and the world →
 *   rename the module, its events, the old video and contact sheet aside (explainers-folder.ts, with a
 *   manifest the worker's start-up recovers from) → the voice-locked session (charged to the meter
 *   message by message, ChargedSpendMeter) → the collateral check (nothing else changed) → gates
 *   (text bounds and HyperFrames/storyboard errors on that frame) → store
 *   the new video and contact sheet under NEW keys (`video.rev<id>.mp4`) → ONE guarded statement adds
 *   the artifact rows and releases the slot. Any other outcome puts the other files, the module, the
 *   video and the contact sheet back on disk and releases the slot. Runs in helios-explainers only.
 *
 * Undo: a scene's `before` carries its module source and the old video/contact-sheet pointers.
 * One video carries every scene, so restore refuses when a later fix replaced the video this one
 * made (`made`); undo newest first. Derived fields: the contact sheet is re-pointed with the video;
 * the burned-in captions (caption_groups.json) are made from the storyboard and the voice, which a
 * scene redo does not change, and the post caption from the title, storyboard and script, so neither
 * changes. A caption fix touches only the post caption, so scene and caption undo in any order.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import type { SceneRebuild } from '@/lib/explainers/render/job';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';
import type { JobRow, LintViolation } from '@/lib/explainers/types';
import type { ActionTarget } from '@/lib/publishing/actions/types';

import { collateral, finishAside, hold, holdStage, putBack, readManifest, release, restoreCollateral, setAside, snapshot } from '../explainers-folder';
import type { ContentTypeDescription, FixKind, PartState, PostSnapshot } from '../types';

import type { Metered } from './carousels';
import { liveExplainersDeps } from './explainers-live';

export type { Metered };
/** helios-explainers start-up recovery of an interrupted scene redo (lib/revisions/explainers-folder.ts). */
export { recoverSceneRedos } from '../explainers-folder';

/** The Explainers pipeline's stages (lib/explainers/render/job.ts): plan (session A), lint, build (session B), render, caption. */
export const EXPLAINERS_STAGE_TAGS = ['plan', 'lint', 'build', 'render', 'caption'] as const;

/**
 * The share of one render's spend a single-scene redo costs: session B resumed for one frame
 * worker plus the orchestrator's mount, assemble, picture check and render steps. No ledger
 * splits session B by frame, so this is a placeholder.
 * PLACEHOLDER: NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const EXPLAINERS_SCENE_REDO_SHARE = 0.25;

/** Job folders are kept until the explainer is published or this many days after its render was requested, whichever is earlier. */
export const EXPLAINERS_FOLDER_RETAIN_DAYS = 7;

export const EXPLAINERS_FOLDER_GONE_NOTE = "This explainer's working files were cleaned up, so single scenes can't be redone.";

const SCENE_FIXES: readonly FixKind[] = ['wording', 'photo', 'color', 'layout'];
const FRAME_ID = /^[a-z0-9][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a job's working folder still counts for scene redos: true until the explainer is
 * published or EXPLAINERS_FOLDER_RETAIN_DAYS after it was created, whichever is earlier.
 * Nothing deletes job folders today (only prepareWorkspace clears its own job's folder before a
 * fresh render), so this is the eligibility rule the revise path checks, not a cleanup.
 */
export function retainJobFolder(job: { createdAt: Date | string; publishedAt?: Date | string | null }, now: Date): boolean {
  const created = new Date(job.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  if (job.publishedAt != null && new Date(job.publishedAt).getTime() <= now.getTime()) return false;
  return now.getTime() < created + EXPLAINERS_FOLDER_RETAIN_DAYS * 24 * 60 * 60 * 1000;
}

export type StoredFile = { storagePath: string; bytes: number; location: 'local' | 'bucket' };

export type ExplainersDeps = {
  /** The Explainers database handle (lib/explainers/connection.ts). Never the worker's revisions query. */
  explainersDb: () => Promise<ExplainersDb>;
  /** Where job folders live (EXPLAINERS_JOBS_DIR on the worker). */
  jobsRoot: () => string;
  /** The job's working folder (with its plan) is on this machine. */
  folderExists: (jobId: string) => Promise<boolean>;
  /** ONE scene rebuild (job.ts rebuildScene). Charges `meter` as the session's spend accrues. */
  redoScene: (input: { job: JobRow; projectDir: string; frameId: string; frameNumber: number; note: string }, meter: Metered) => Promise<SceneRebuild>;
  /** Store a local file under a NEW key (the job's artifact store). Never called with an existing key. */
  store: (key: string, localPath: string) => Promise<StoredFile>;
  /** The type's own un-approve: lib/explainers/publish/schedule.ts unscheduleJob. */
  unscheduleJob: (db: ExplainersDb, jobId: string) => Promise<{ ok: boolean; note: string }>;
  now?: () => Date;
  /** A short id for the revision's storage keys. Default: random. */
  newId?: () => string;
};

type Pointer = { path: string; bytes: number | null; location: 'local' | 'bucket' };
type SceneState = PartState & { copy: { module: string; events: string | null }; video: Pointer; sheet: Pointer | null; made?: string | null };
type CaptionState = PartState & { copy: { caption: string } };
type Latest = { video: Pointer | null; sheet: Pointer | null; caption: string | null; storyboard: string | null };
type Scene = { key: string; number: number; name: string; text: string };

const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const usd = (n: number) => `$${n.toFixed(2)}`;
const jobIdOf = (refs: ActionTarget) => (UUID.test(refs.jobId ?? '') ? refs.jobId! : null);

/** Posting or posted: a non-failed publish attempt or a publishing/published slot (spine or the type's own tables). */
const POSTING_SQL = (j: string) =>
  `EXISTS (SELECT 1 FROM social_hub.content_items ci JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci.id
             WHERE ci.vertical = 'explainers' AND ci.native_ref = ${j}.id::text AND pa.status <> 'failed')
   OR EXISTS (SELECT 1 FROM social_hub.content_items ci JOIN social_hub.schedule sc ON sc.content_item_id = ci.id
             WHERE ci.vertical = 'explainers' AND ci.native_ref = ${j}.id::text AND sc.status IN ('publishing', 'published'))
   OR EXISTS (SELECT 1 FROM explainers.publish_attempts p WHERE p.job_id = ${j}.id AND p.status <> 'failed')`;
const LATEST_SQL = (j: string, kind: string, col: string) =>
  `(SELECT a.${col} FROM explainers.artifacts a WHERE a.job_id = ${j}.id AND a.kind = '${kind}' ORDER BY a.seq DESC LIMIT 1)`;

async function readJob(db: Queryable, refs: ActionTarget): Promise<JobRow | null> {
  const id = jobIdOf(refs);
  if (!id) return null;
  const { getJob } = await import('@/lib/explainers/repository');
  const job = await getJob(db, id);
  if (!job || (refs.topicId && refs.topicId !== job.topic_id)) return null;
  return job;
}

async function latestOf(db: Queryable, jobId: string): Promise<Latest> {
  const { rows } = await db.query<{ kind: string; storage_path: string | null; content: string | null; bytes: string | number | null; storage_location: string | null }>(
    `SELECT DISTINCT ON (kind) kind, storage_path, content, bytes, storage_location FROM explainers.artifacts
      WHERE job_id = $1 AND kind IN ('video', 'contact_sheet', 'post_caption', 'storyboard') ORDER BY kind, seq DESC`,
    [jobId],
  );
  const by = new Map(rows.map((r) => [r.kind, r]));
  const pointer = (kind: string): Pointer | null => {
    const r = by.get(kind);
    return r?.storage_path ? { path: r.storage_path, bytes: r.bytes == null ? null : Number(r.bytes), location: r.storage_location === 'bucket' ? 'bucket' : 'local' } : null;
  };
  return { video: pointer('video'), sheet: pointer('contact_sheet'), caption: by.get('post_caption')?.content ?? null, storyboard: by.get('storyboard')?.content ?? null };
}

async function itemOf(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'explainers' AND native_ref = $1`, [jobId]);
  return rows[0]?.id ?? null;
}

/** The engine's vocabulary, as unscheduleJob decides it: posting/posted, rejected, slot, approval. */
async function statusOf(db: Queryable, job: JobRow, latest: Latest): Promise<PostSnapshot['status']> {
  const { rows } = await db.query<{ posting: boolean }>(`SELECT (${POSTING_SQL('j')}) AS posting FROM explainers.jobs j WHERE j.id = $1`, [job.id]);
  if (rows[0]?.posting) return 'published';
  const item = await itemOf(db, job.id);
  const verdict = (await db.query<{ verdict: string }>(`SELECT verdict FROM explainers.feedback WHERE job_id = $1`, [job.id])).rows[0]?.verdict ?? null;
  const decision = item ? ((await db.query<{ decision: string }>(`SELECT decision FROM social_hub.approvals WHERE content_item_id = $1`, [item])).rows[0]?.decision ?? null) : null;
  if (verdict === 'rejected' || decision === 'rejected') return 'rejected';
  if (job.status !== 'ok' || !latest.video) return 'preview';
  if (item && (await db.query(`SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'scheduled' LIMIT 1`, [item])).rows.length) return 'scheduled';
  if (verdict === 'approved' || decision === 'approved') return 'approved';
  return 'review';
}

async function publishedAt(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ at: string | null }>(
    `SELECT min(at)::text AS at FROM (
       SELECT coalesce(pa.finished_at, pa.requested_at) AS at FROM social_hub.publish_attempts pa
         JOIN social_hub.content_items ci ON ci.id = pa.content_item_id
        WHERE ci.vertical = 'explainers' AND ci.native_ref = $1 AND pa.status = 'published'
       UNION ALL
       SELECT coalesce(p.finished_at, p.requested_at) FROM explainers.publish_attempts p WHERE p.job_id = $1::uuid AND p.status = 'published'
     ) x`,
    [jobId],
  );
  return rows[0]?.at ?? null;
}

/** The frames a frame worker wrote, from the stored storyboard: frame 1's hook under a bank opener, never the kit's close. */
async function scenesOf(storyboard: string | null, job: JobRow): Promise<Scene[]> {
  return (await framesOf(storyboard, job)).scenes;
}

/** The worker-written scenes, and the module ids code writes (the bank opener over the hook, the kit's close). */
async function framesOf(storyboard: string | null, job: JobRow): Promise<{ scenes: Scene[]; codeWritten: string[] }> {
  if (!storyboard) return { scenes: [], codeWritten: [] };
  const { parseFrames, isClose, HOOK_ID, OPENER_FRAME } = await import('../../../explainers/world-kit/frames.mjs');
  const scenes: Scene[] = [];
  const codeWritten: string[] = [];
  for (const f of parseFrames(storyboard) as Array<{ number: number; name: string; id: string; fields: Record<string, string> }>) {
    if (!f.id) continue;
    if (isClose(f)) {
      codeWritten.push(f.id);
      continue;
    }
    const key = f.number === OPENER_FRAME && job.opener ? (HOOK_ID as string) : f.id;
    if (key !== f.id) codeWritten.push(f.id);
    if (!FRAME_ID.test(key)) continue;
    const said = (v: string | undefined) => (v ?? '').replace(/^["“]|["”]$/g, '').trim();
    const what = [f.fields.scene && `Shows: ${f.fields.scene}`, f.fields.voiceover && `Voice: "${said(f.fields.voiceover)}"`, f.fields.shots && `Shots: ${f.fields.shots}`]
      .filter(Boolean)
      .join(' ');
    const hook = key !== f.id ? ' (the hook under the series opener)' : '';
    scenes.push({ key, number: f.number, name: f.name, text: `Frame ${f.number}, ${f.name}${hook}. ${what}`.slice(0, 600) });
  }
  return { scenes, codeWritten };
}

/** A file's text, or null. */
function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Put a module (and its sound events) on disk as `state` says; null events = none. */
function writeModule(framesDir: string, key: string, copy: { module: string; events: string | null }) {
  fs.writeFileSync(path.join(framesDir, `${key}.js`), copy.module);
  const ev = path.join(framesDir, `${key}.events.json`);
  if (copy.events != null) fs.writeFileSync(ev, copy.events);
  else fs.rmSync(ev, { force: true });
}

/** The meter as a billable dep sees it: once it has thrown, `stopped()` is true and every spend re-throws. */
function metered(meter: { spend(usd: number): void }): Metered & { check(): void } {
  let stop: unknown = null;
  const halt = (): never => {
    throw stop;
  };
  return {
    spend(x) {
      if (stop) halt();
      try {
        meter.spend(x);
      } catch (e) {
        stop = e;
        throw e;
      }
    },
    stopped: () => stop !== null,
    halt,
    check: () => {
      if (stop) halt();
    },
  };
}

/** Add artifact rows pointing at `video` (+ `sheet`) while the guard holds. Returns whether it applied. */
async function pointAt(
  db: Queryable,
  jobId: string,
  guard: { status: 'running' | 'ok'; currentVideo: string | null; holdStage?: string; releaseStage?: string },
  video: Pointer,
  sheet: Pointer | null,
): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `WITH guard AS (
       SELECT j.id FROM explainers.jobs j
        WHERE j.id = $1 AND j.status = $2 AND ($2 = 'ok' OR j.stage = $11)
          AND ${LATEST_SQL('j', 'video', 'storage_path')} IS NOT DISTINCT FROM $3::text
          AND NOT (${POSTING_SQL('j')})
        FOR UPDATE OF j
     ),
     vid AS (
       INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location)
       SELECT g.id, 'video', $4, $5, $6 FROM guard g RETURNING id
     ),
     cs AS (
       INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location)
       SELECT g.id, 'contact_sheet', $7, $8, $9 FROM guard g WHERE $7::text IS NOT NULL RETURNING id
     ),
     rel AS (
       UPDATE explainers.jobs j SET status = 'ok', stage = $10 FROM guard g WHERE j.id = g.id AND $2 = 'running' RETURNING j.id
     )
     SELECT (SELECT count(*) FROM vid)::int AS n`,
    [
      jobId,
      guard.status,
      guard.currentVideo,
      video.path,
      video.bytes,
      video.location,
      sheet?.path ?? null,
      sheet?.bytes ?? null,
      sheet?.location ?? 'local',
      guard.releaseStage || null,
      guard.holdStage ?? null,
    ],
  );
  return Number(rows[0]?.n ?? 0) === 1;
}

/** Add a post_caption row while the job is finished, not posting, and its caption is still `current`. */
async function captionTo(db: Queryable, jobId: string, current: string | null, next: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `WITH guard AS (
       SELECT j.id FROM explainers.jobs j
        WHERE j.id = $1 AND j.status = 'ok'
          AND ${LATEST_SQL('j', 'post_caption', 'content')} IS NOT DISTINCT FROM $2::text
          AND NOT (${POSTING_SQL('j')})
        FOR UPDATE OF j
     ),
     ins AS (INSERT INTO explainers.artifacts (job_id, kind, content) SELECT g.id, 'post_caption', $3 FROM guard g RETURNING id)
     SELECT (SELECT count(*) FROM ins)::int AS n`,
    [jobId, current, next],
  );
  return Number(rows[0]?.n ?? 0) === 1;
}

export function createExplainersDescription(deps: ExplainersDeps): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));
  const now = () => deps.now?.() ?? new Date();
  const projectDirOf = (jobId: string) => path.join(deps.jobsRoot(), jobId, 'project');

  async function reviseCaption(db: ExplainersDb, job: JobRow, latest: Latest, value: string | undefined) {
    const raw = (value ?? '').trim();
    if (!raw) return failed('I could not tell what the new caption should say, so nothing was changed.');
    const { parseCaption } = await import('@/lib/explainers/caption-format');
    let text: string;
    try {
      text = parseCaption(raw);
    } catch (e) {
      return blocked(`The new caption breaks a caption rule (${errText(e)}), so the caption was not changed.`);
    }
    if (text === (latest.caption ?? '').trim()) return failed('The caption already says that, so nothing was changed.');
    if (!(await captionTo(db, job.id, latest.caption, text))) {
      return failed('This explainer changed, started posting, or is being redone right now, so the caption was not changed.');
    }
    const before: CaptionState = { copy: { caption: latest.caption ?? '' }, files: [] };
    const after: CaptionState = { copy: { caption: text }, files: [] };
    return { ok: true as const, before, after };
  }

  return {
    vertical: 'explainers',
    label: 'explainers',
    stageTags: EXPLAINERS_STAGE_TAGS,
    fixKinds: SCENE_FIXES,
    argsGuide: {
      wording:
        'For the caption part: args.value is the exact new post caption, written out in full (hook, body, save prompt or question, the Helios line, then 3 to 5 hashtags). For a scene part: args.note is the change to make to that scene, in the person\'s words (optional; the instruction is used when it is missing).',
      photo: 'Scenes only (drawn, not photos): args.note is the change to the picture in that scene, in the person\'s words (optional; the instruction is used when it is missing).',
      color: 'Scenes only: args.note is the color change for that scene, in the person\'s words (optional; the instruction is used when it is missing).',
      layout: 'Scenes only: args.note is the layout change for that scene, in the person\'s words (optional; the instruction is used when it is missing).',
    },

    async load(_q, refs) {
      // Explainers data is reached through the Explainers handle only, never the caller's query.
      const db = await deps.explainersDb();
      const job = await readJob(db, refs);
      if (!job) return null;
      const latest = await latestOf(db, job.id);
      const scenes = await scenesOf(latest.storyboard, job);
      return {
        vertical: 'explainers',
        refs,
        status: await statusOf(db, job, latest),
        parts: [
          ...scenes.map((s) => ({ ref: { kind: 'scene', key: s.key }, text: s.text })),
          { ref: { kind: 'caption', key: 'caption' }, text: `The post caption under the video: "${latest.caption ?? ''}"` },
        ],
      };
    },

    /** A scene redo is a share of the per-reel cap (one resumed session); a caption fix makes no model call. */
    estimate(fix: FixKind) {
      return SCENE_FIXES.includes(fix) ? DEFAULT_SETTINGS.per_reel_cap_usd * EXPLAINERS_SCENE_REDO_SHARE : 0;
    },

    async revise({ refs, interpretation: it, meter }) {
      const db = await deps.explainersDb();
      const job = await readJob(db, refs);
      if (!job) return failed('This explainer could not be found, so nothing was changed.');
      const latest = await latestOf(db, job.id);
      const status = await statusOf(db, job, latest);
      if (status === 'published') return blocked('This explainer is posting or has posted, so it was not changed.');
      if (status === 'rejected') return blocked('This explainer was rejected, so it was not changed.');
      if (job.status !== 'ok' || !latest.video) return failed('This explainer is not finished, or is being made or redone right now, so nothing was changed.');
      const args = it.args ?? {};

      if (it.part.kind === 'caption') {
        if (it.part.key !== 'caption' || it.fixKind !== 'wording') return failed('Only the caption\'s words can be changed, so nothing was changed.');
        return reviseCaption(db, job, latest, args.value);
      }
      if (it.part.kind !== 'scene') return failed(`An explainer's parts are its scenes and its caption; "${it.part.kind} ${it.part.key}" is not one of them, so nothing was changed.`);
      if (!SCENE_FIXES.includes(it.fixKind)) return failed(`${it.fixKind} fixes are not available for explainer scenes, so nothing was changed.`);
      const { scenes, codeWritten } = await framesOf(latest.storyboard, job);
      const scene = scenes.find((s) => s.key === it.part.key);
      if (!scene) {
        const names = scenes.map((s) => s.key).join(', ') || 'none';
        return failed(`This explainer has no redoable scene "${it.part.key}" (its scenes are ${names}), so nothing was changed.`);
      }
      const note = (args.note ?? '').trim() || it.instruction.trim();
      if (!note) return failed('I could not tell what to change in that scene, so nothing was changed.');

      // Only while the working folder is kept (published or 7 days, whichever is earlier) and actually there.
      if (!retainJobFolder({ createdAt: job.requested_at, publishedAt: await publishedAt(db, job.id) }, now()) || !(await deps.folderExists(job.id))) {
        return failed(EXPLAINERS_FOLDER_GONE_NOTE);
      }
      const jobDir = path.join(deps.jobsRoot(), job.id);
      const projectDir = path.join(jobDir, 'project');
      const modFile = path.join(projectDir, 'assets', 'frames', `${scene.key}.js`);
      const evFile = path.join(projectDir, 'assets', 'frames', `${scene.key}.events.json`);
      const oldModule = readText(modFile);
      if (oldModule == null) return failed(EXPLAINERS_FOLDER_GONE_NOTE);
      // The job's own per-reel cap: what is left of it must cover a scene redo's estimate.
      const need = job.spend_cap_usd * EXPLAINERS_SCENE_REDO_SHARE;
      const left = Math.max(0, job.spend_cap_usd - job.spend_usd);
      if (left < need) {
        return blocked(`This explainer has ${usd(left)} left of its ${usd(job.spend_cap_usd)} spending cap and a scene redo needs about ${usd(need)}, so the scene was not redone.`);
      }

      const id = newId();
      // The hold carries this redo's id, and so does its manifest (start-up recovery matches them).
      const stage = await hold(db, job.id, id);
      if (stage == null) return failed('A render is running right now (or another explainer change is), so nothing was changed. Try again once it is finished.');
      const m = metered(meter);
      const oldEvents = readText(evFile);
      let kept = false;
      let before: ReturnType<typeof snapshot> | null = null;
      let collateralDone = false;
      try {
        // A manifest an earlier redo left behind is never this redo's: clear it before writing ours.
        finishAside(jobDir);
        // Every other scene, the plan, the voice and the world, as they are now (the redo may not touch them).
        before = snapshot(projectDir, scene.key, codeWritten);
        // Renamed aside, never deleted: the old module, its sound events, the local video and contact sheet.
        setAside(jobDir, { id, key: scene.key, stage });

        let out: SceneRebuild;
        try {
          m.check();
          out = await deps.redoScene({ job, projectDir, frameId: scene.key, frameNumber: scene.number, note }, m);
        } catch (e) {
          m.check();
          return failed(`The scene could not be rebuilt (${errText(e)}), so the original was kept.`);
        }
        m.check(); // a ceiling stop inside the session surfaces here
        if (!out.ok) {
          if (out.capped) return blocked(`Redoing the scene reached this explainer's ${usd(job.spend_cap_usd)} spending cap, so the original was kept.`);
          return failed(`The scene could not be rebuilt (${out.error}), so the original was kept.`);
        }
        const touched = collateral(projectDir, before, scene.key, codeWritten);
        if (touched.length) {
          collateralDone = true;
          const lost = restoreCollateral(projectDir, before, touched, id);
          if (lost.length) console.error(`[revisions] explainer ${job.id} redo ${id}: could not restore ${lost.join(', ')}`);
          const back = touched.filter((f) => !lost.includes(f));
          return blocked(
            `Redoing ${scene.key} also changed other parts of this explainer (${touched.join(', ')}), so nothing was kept.` +
              (back.length ? ` Put back: ${back.join(', ')}.` : '') +
              (lost.length ? ` These could not be put back: ${lost.join(', ')}.` : ''),
          );
        }
        const problems = out.violations.filter((v: LintViolation) => v.severity === 'error' && v.frame === scene.number);
        if (problems.length) {
          return blocked(`The new scene failed a check (${problems.map((v) => v.detail).join('; ')}), so the original was kept.`);
        }
        const newModule = readText(modFile) ?? '';
        let storedVideo: StoredFile;
        let storedSheet: StoredFile | null = null;
        try {
          storedVideo = await deps.store(`jobs/${job.id}/video.rev${id}.mp4`, out.videoPath);
          if (out.contactSheetPath) storedSheet = await deps.store(`jobs/${job.id}/contact-sheet.rev${id}.jpg`, out.contactSheetPath);
        } catch (e) {
          return failed(`The new video could not be stored (${errText(e)}), so the original was kept.`);
        }
        const toPointer = (s: StoredFile): Pointer => ({ path: s.storagePath, bytes: s.bytes, location: s.location });
        const nextVideo = toPointer(storedVideo);
        const nextSheet = storedSheet ? toPointer(storedSheet) : latest.sheet;
        const applied = await pointAt(db, job.id, { status: 'running', currentVideo: latest.video.path, holdStage: holdStage(id), releaseStage: stage }, nextVideo, storedSheet ? nextSheet : null);
        if (!applied) return failed('This explainer changed or started posting while the scene was redone, so it was not changed.');
        kept = true;
        finishAside(jobDir);
        const files = (v: Pointer, s: Pointer | null) => [v.path, ...(s ? [s.path] : [])];
        const beforeState: SceneState = { copy: { module: oldModule, events: oldEvents }, video: latest.video, sheet: latest.sheet, files: files(latest.video, latest.sheet), made: nextVideo.path };
        const after: SceneState = { copy: { module: newModule, events: readText(evFile) }, video: nextVideo, sheet: nextSheet, files: files(nextVideo, nextSheet), made: latest.video.path };
        return { ok: true as const, before: beforeState, after };
      } finally {
        if (!kept) await rollBack();
      }

      /**
       * Every non-kept path: the other files first (a failure there is logged and never skips the
       * rest), then the scene's own files from the manifest, then the release. If the scene's files
       * cannot be put back, the hold is KEPT and the error thrown (the engine ends the row failed), so
       * helios-explainers' start-up recovery repairs the folder from the manifest.
       */
      async function rollBack(): Promise<void> {
        if (before && !collateralDone) {
          try {
            restoreCollateral(projectDir, before, collateral(projectDir, before, scene!.key, codeWritten), id);
          } catch (e) {
            console.error(`[revisions] explainer ${job!.id} redo ${id}: the other files could not be checked or put back: ${errText(e)}`);
          }
        }
        const manifest = readManifest(jobDir);
        if (manifest && manifest.id === id) {
          try {
            putBack(jobDir, manifest);
          } catch (e) {
            throw new Error(
              `the scene's files could not be put back (${errText(e)}); this explainer stays held until the explainers worker restarts and repairs it`,
            );
          }
        }
        await release(db, job!.id, id, stage!);
      }
    },

    async restore({ refs, part, state }) {
      const db = await deps.explainersDb();
      const job = await readJob(db, refs);
      if (!job) throw new Error('The explainer is gone.');
      const latest = await latestOf(db, job.id);

      if (part.kind === 'caption') {
        const s = state as CaptionState;
        if (typeof s.copy?.caption !== 'string') throw new Error('This undo record has no explainer caption.');
        if ((latest.caption ?? '') === s.copy.caption) return; // idempotent
        if (!(await captionTo(db, job.id, latest.caption, s.copy.caption))) {
          throw new Error('The explainer changed, is posting, or is being redone right now, so its caption was not restored.');
        }
        return;
      }

      const s = state as SceneState;
      if (!s.video?.path || typeof s.copy?.module !== 'string') throw new Error('This undo record has no explainer scene state.');
      if (!FRAME_ID.test(part.key)) throw new Error('This undo record names no scene.');
      const framesDir = path.join(projectDirOf(job.id), 'assets', 'frames');
      const onDisk = fs.existsSync(framesDir);
      const putModule = (copy: { module: string; events: string | null }) => {
        if (onDisk) writeModule(framesDir, part.key, copy);
      };
      // Never write into the folder while a render or another redo holds the job.
      if (job.status !== 'ok') throw new Error('This explainer is being made or redone right now, so it was not restored.');
      if (latest.video?.path === s.video.path) {
        putModule(s.copy); // idempotent: the pointers are already there; keep the folder in step
        return;
      }
      if (s.made !== undefined && latest.video?.path !== s.made) {
        throw new Error('A later fix to this explainer changed its video after this one; undo that fix first.');
      }
      // The folder first (so a later scene redo starts from the restored scene), the pointers second.
      const was = onDisk ? { module: readText(path.join(framesDir, `${part.key}.js`)), events: readText(path.join(framesDir, `${part.key}.events.json`)) } : null;
      putModule(s.copy);
      const sheet = s.sheet && s.sheet.path !== latest.sheet?.path ? s.sheet : null;
      if (!(await pointAt(db, job.id, { status: 'ok', currentVideo: latest.video?.path ?? null }, s.video, sheet))) {
        if (was?.module != null) putModule({ module: was.module, events: was.events });
        throw new Error('The explainer changed, is posting, or is being made right now, so the scene was not restored.');
      }
    },

    unschedule: async (_q, refs) => {
      const id = jobIdOf(refs);
      if (!id) return { ok: false, note: 'This explainer could not be found.' };
      return deps.unscheduleJob(await deps.explainersDb(), id);
    },
  };
}

export const explainersDescription: ContentTypeDescription = createExplainersDescription(liveExplainersDeps);
