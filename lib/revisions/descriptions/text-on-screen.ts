/**
 * Targeted Revisions for text on screen (the `reels` vertical; never called "trial reels" to people).
 * One reel is one piece: a 9:16 background still, the on-screen words laid over it, and one 10-second
 * Kling clip made from that still, with the words, the hook and its sound composed on top. The item is
 * the video job (`reels.video_jobs`, the spine's native_ref); a revision re-renders THAT row in place
 * (new storage keys, same id, same spine item), so it works for a reel from any slate and never goes
 * through `requestFinish` (which only rebuilds today's slate and queues new jobs).
 *
 * Parts: `{ kind: 'stage', key: 'copy' | 'frame' | 'video' }`. Each fix is the cheapest consistent redo:
 *   wording  the person's exact words. Gates: the bucket's word range and the text-artifact check
 *            (lib/reels/copy/report.ts, clean-text.ts), then copy fit (the text engine on the stored
 *            background). No Jev line scoring: the person chose the words. The words are re-laid over
 *            the stored CLEAN clip (no text yet) with ffmpeg only (text-on-screen-plate.ts relayPlate).
 *            A reel with no clean clip stored is refused (see the live deps for where one is found).
 *   photo    the background image: the stored scene (or ONE scene-writer call when args.sceneHint is
 *            given) → gpt-image-2 → band check → text fit → motion writer → Kling → plate. The grade and
 *            hook are kept (the color and hook routes read only the words, which did not change).
 *   motion   the stored background → motion writer (args.motionHint as its own labelled note) → Kling → plate.
 *   color    the grade (noir | paper | orange | green) is in the background's palette, the band check,
 *            Kling's band line and the plate's ink, so a re-lay alone would put e.g. dark paper-grade
 *            ink on a dark noir clip. The honest cheapest path is the photo path with the new grade
 *            and the stored scene (no scene writer).
 *
 * The grade IS stored: `visual_jobs.render.colorProfile` (run.ts finishJob), read with colorProfileOrNoir.
 *
 * Order (nothing is written on any non-ok path): checks → billable calls (each metered; Kling is charged
 * before it is called) → renders → uploads to NEW keys (`<video id>/reel.rev<id>.mp4`, `raw.rev<id>.mp4`,
 * `<new frame id>/background.png|frame.png`) → ONE guarded statement: a new `visual_jobs` row when the
 * still changed (the old row is never touched), `idea_copy` (+ an `idea_copy_history` row) when the
 * words changed, and the video row's pointers. Old files stay in storage and in `before.files`.
 *
 * Undo is whole-reel (one clip carries every part): `before` names the clip this revision made, and
 * restore refuses when a later fix replaced that clip, so undoing out of order never throws away a
 * later fix's clip. Derived fields: `idea_copy.checks` is recomputed with checkCopy on revise and
 * restore; the still's lines/grade/words live on their own `visual_jobs` row, which restore re-points to.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { CopyReport } from '@/lib/reels/copy/report';
import type { BucketId } from '@/lib/reels/scoring/decide';
import { COLOR_PROFILES, colorProfileOrNoir, isColorProfile, type ColorProfile } from '@/lib/reels/visual/color';
import type { BackgroundQa } from '@/lib/reels/visual/engine';
import { HOOK_TIMING_IDS, HOOKS, type Hook, type HookTiming } from '@/lib/reels/visual/hook';
import type { MotionPrompt } from '@/lib/reels/visual/motion-prompt';
import type { VisualCategory } from '@/lib/reels/visual/scene';
import type { Query } from '@/lib/social/store/pg';

import type { PlateDeps } from '../text-on-screen-plate';
import type { ContentTypeDescription, FixKind, PartState, PostSnapshot } from '../types';

import type { Metered } from './carousels';
import { liveTextOnScreenDeps } from './text-on-screen-live';

export type { Metered };

/** The reel pipeline's stages (lib/reels/visual/finish.ts, run.ts, video-run.ts). */
export const TEXT_ON_SCREEN_STAGE_TAGS = ['copy', 'scene', 'background', 'color', 'motion', 'overlay'] as const;

/**
 * One Kling clip: D-266 Kling 2.5 Turbo Standard, $0.042 a second × KLING_CLIP_SECONDS (10). The same
 * figure as lib/reels/insights.ts KLING_USD_PER_CLIP (the reels cost ledger); kept here so the
 * registry does not import the database module. A test pins them equal.
 */
export const TEXT_ON_SCREEN_KLING_USD = 0.042 * 10;
/**
 * One gpt-image-2 background at high quality, 1152×2048. The reels code prices it from the response's
 * tokens (lib/reels/visual/image.ts priceImageUsage) and has no per-image constant.
 * PLACEHOLDER: NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const TEXT_ON_SCREEN_IMAGE_ESTIMATE_USD = 0.25;
/**
 * One Sonnet motion-writer call (the background image plus the cached instructions) or scene-writer
 * call. Metered at the real price from each response (priceAnthropicMessages); no constant exists.
 * PLACEHOLDER: NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const TEXT_ON_SCREEN_WRITER_ESTIMATE_USD = 0.03;

const STAGES = ['copy', 'frame', 'video'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** run.ts VISUAL_RECENT_SCENES: the scene writer is told the last 10 scenes so it does not repeat them. */
const RECENT_SCENES = 10;

export type TextOnScreenDeps = {
  /** Read a stored object (reels-frames bucket). Free. */
  readObject: (key: string) => Promise<Buffer>;
  /** Store a local file / a buffer under a NEW key. Never called with an existing key. */
  storeFile: (key: string, localPath: string, contentType: string) => Promise<void>;
  storeBuffer: (key: string, body: Buffer, contentType: string) => Promise<void>;
  /** A scratch folder, removed by `done`. */
  workDir: () => Promise<{ dir: string; done: () => Promise<void> }>;
  writeLocal: (filePath: string, body: Buffer) => Promise<void>;
  /** The text engine over a still (engine.ts renderTextPng): ok:false is "the words do not fit". Local, free. */
  renderText: (
    png: Buffer,
    copy: string,
    profile: ColorProfile,
    fullStoryCue: string | null,
  ) => Promise<{ ok: true; png: Buffer; lines: string[]; warnings: string[] } | { ok: false; error: string }>;
  /** The band check (engine.ts checkBackgroundPng). Local, free. */
  checkBackground: (png: Buffer, profile: ColorProfile) => Promise<BackgroundQa>;
  /** ffmpeg + text engine steps for relayPlate. Local, free. */
  plate: PlateDeps;
  /** Read a stored clip (the raw clip a revision kept) to `toPath`; false when there is none. Free. */
  readClip: (key: string, toPath: string) => Promise<boolean>;
  /**
   * Fal's stored result for a finished clip request (`higgsfield_job_id`) to `toPath`: a read, never a
   * generation. False when Fal no longer has it. The fallback for pipeline-made reels, whose video stage
   * does not keep its raw clip.
   */
  falClip: (requestId: string, toPath: string) => Promise<boolean>;
  /** ONE scene-writer call with the person's hint as its own note; null when it wrote no scene. Charges `meter`. */
  writeScene: (
    input: { story: string; category: VisualCategory; onScreenText: string; recentScenes: string[]; profile: ColorProfile; hint: string | null },
    meter: Metered,
  ) => Promise<string | null>;
  /** ONE gpt-image-2 background. Charges `meter` as it pays. */
  generateBackground: (prompt: string, meter: Metered) => Promise<{ png: Buffer }>;
  /** ONE motion-writer call (fails open to the camera-only prompt, as the pipeline does). Charges `meter`. */
  writeMotion: (
    input: { png: Buffer; scene: string; story: string; onScreenCopy: string; profile: ColorProfile; hint: string | null },
    meter: Metered,
  ) => Promise<MotionPrompt>;
  /** ONE Kling clip from the stored background. The description charges the clip's price BEFORE calling. */
  kling: (input: { prompt: string; backgroundKey: string; profile: ColorProfile }, meter: Metered) => Promise<{ bytes: Buffer; jobId: string | null }>;
  /** The type's own un-approve: lib/reels/publish/schedule.ts unscheduleIdea (the idea's slot and its approval). */
  unschedule: (q: Query, postIdeaId: string) => Promise<{ ok: boolean; note: string }>;
  /**
   * The spine's un-approve for an item with no slot (lib/social/overnight/schedule.ts unscheduleItem):
   * a force-posted-then-failed or released reel keeps its approval with no slot to cancel.
   */
  withdrawItem: (q: Query, itemId: string) => Promise<{ ok: boolean; note: string }>;
  /** A short id for the revision's storage keys. Default: random. */
  newId?: () => string;
};

type Row = {
  video_id: string;
  post_idea_id: string;
  slate_id: string | null;
  video_status: string;
  motion_prompt: string | null;
  video_storage_path: string | null;
  higgsfield_job_id: string | null;
  visual_job_id: string | null;
  category: string | null;
  story: string | null;
  scene: string | null;
  background_storage_path: string | null;
  frame_storage_path: string | null;
  render: { lines?: string[]; model?: string; colorProfile?: string } | null;
  copy_status: string | null;
  on_screen_copy: string | null;
  checks: unknown;
  caption: string | null;
  call_to_action: string | null;
  viewer_stake: string | null;
  hashtags: string[] | null;
  sources: Array<{ name: string; url: string }> | null;
  working: { builderRead?: string } | null;
  bucket: string | null;
  full_story_cue: string | null;
};

type VideoPointers = { visualJobId: string | null; videoPath: string | null; motionPrompt: string | null; higgsfieldJobId: string | null };
/** The whole reel's state (one clip carries every part). `made`: the clip the revision that saved this made. */
type ReelState = PartState & { copy: { onScreenCopy: string | null }; photo: { visualJobId: string | null; scene: string | null }; colors: { grade: ColorProfile }; video: VideoPointers; made?: string | null };
type NewVisual = {
  id: string;
  category: string | null;
  story: string | null;
  onScreenCopy: string;
  scene: string | null;
  imagePrompt: string | null;
  backgroundPath: string;
  framePath: string;
  qa: BackgroundQa | null;
  render: Record<string, unknown>;
  warnings: string[];
  usd: number;
};

const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const videoIdOf = (refs: ActionTarget) => refs.videoJobId ?? '';
const gradeOf = (r: Row): ColorProfile => colorProfileOrNoir(r.render?.colorProfile);

async function readReel(q: Query, refs: ActionTarget): Promise<Row | null> {
  const id = videoIdOf(refs);
  if (!UUID.test(id)) return null;
  const { rows } = await q(
    `SELECT j.id::text AS video_id, j.post_idea_id::text AS post_idea_id, j.slate_id::text AS slate_id, j.status AS video_status,
            j.motion_prompt, j.video_storage_path, j.higgsfield_job_id, j.visual_job_id::text AS visual_job_id,
            v.category, v.story, v.scene, v.background_storage_path, v.frame_storage_path, v.render,
            c.status AS copy_status, c.on_screen_copy, c.checks, c.caption, c.call_to_action, c.viewer_stake, c.hashtags,
            c.sources, c.working, c.bucket, c.full_story_cue
       FROM reels.video_jobs j
       LEFT JOIN reels.visual_jobs v ON v.id = j.visual_job_id
       LEFT JOIN reels.idea_copy c ON c.slate_id = j.slate_id AND c.post_idea_id = j.post_idea_id
      WHERE j.id = $1::uuid`,
    [id],
  );
  const row = rows[0] as Row | undefined;
  if (!row || (refs.postIdeaId && refs.postIdeaId !== row.post_idea_id)) return null;
  return row;
}

/** The engine's vocabulary, from the spine (the video's item, its approval, its attempts, the idea's slot). */
async function statusOf(q: Query, r: Row): Promise<PostSnapshot['status']> {
  const item = (await q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'reels' AND native_ref = $1`, [r.video_id])).rows[0]?.id as string | undefined;
  if (item) {
    const posting = await q(
      `SELECT 1 FROM social_hub.publish_attempts WHERE content_item_id = $1::uuid AND status <> 'failed'
       UNION ALL SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1::uuid AND status IN ('publishing', 'published') LIMIT 1`,
      [item],
    );
    if (posting.rows.length) return 'published';
    const rejected = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1::uuid AND decision = 'rejected'`, [item]);
    if (rejected.rows.length) return 'rejected';
  }
  if (r.video_status !== 'ok' || !r.video_storage_path) return 'preview';
  // A slot belongs to the idea (D50) and gets its video's item when attached; unscheduleIdea cancels it by idea.
  const slot = await q(
    `SELECT 1 FROM social_hub.schedule WHERE vertical = 'reels' AND status = 'scheduled'
        AND (idea_ref = $1 OR ($2::uuid IS NOT NULL AND content_item_id = $2::uuid)) LIMIT 1`,
    [r.post_idea_id, item ?? null],
  );
  if (slot.rows.length) return 'scheduled';
  if (item) {
    const ok = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1::uuid AND decision = 'approved'`, [item]);
    if (ok.rows.length) return 'approved';
  }
  return 'review';
}

/** reel_locks for this idea on the slate's New York day (lib/reels/locks.ts findReelLock), and stages still being made. */
const LOCK_SQL = (j: string) =>
  `SELECT l.ny_date::text AS ny_date FROM reels.reel_locks l JOIN reels.score_slates s ON s.ny_date = l.ny_date
    WHERE s.id = ${j}.slate_id AND l.post_idea_id = ${j}.post_idea_id`;
const BUSY_SQL = (j: string) =>
  `EXISTS (SELECT 1 FROM reels.copy_jobs x WHERE x.post_idea_id = ${j}.post_idea_id AND x.status IN ('requested', 'running'))
   OR EXISTS (SELECT 1 FROM reels.visual_jobs x WHERE x.post_idea_id = ${j}.post_idea_id AND x.status IN ('requested', 'running'))
   OR EXISTS (SELECT 1 FROM reels.video_jobs x WHERE x.post_idea_id = ${j}.post_idea_id AND x.status IN ('requested', 'running'))
   OR EXISTS (SELECT 1 FROM reels.finish_requests x WHERE x.post_idea_id = ${j}.post_idea_id AND x.status = 'active')`;

/** A frame row as a NewVisual (restore copies it). */
async function readVisual(q: Query, id: string): Promise<Omit<NewVisual, 'id'> | null> {
  const { rows } = await q(
    `SELECT category, story, on_screen_copy, scene, image_prompt, background_storage_path, frame_storage_path, background_qa, render, warnings
       FROM reels.visual_jobs WHERE id = $1::uuid`,
    [id],
  );
  const v = rows[0];
  if (!v) return null;
  return {
    category: v.category,
    story: v.story,
    onScreenCopy: v.on_screen_copy,
    scene: v.scene,
    imagePrompt: v.image_prompt,
    backgroundPath: v.background_storage_path,
    framePath: v.frame_storage_path,
    qa: v.background_qa,
    render: v.render ?? {},
    warnings: Array.isArray(v.warnings) ? v.warnings : [],
    usd: 0,
  };
}

/** What a person sees of a still: same key = same frame (a restored copy matches its source). */
const stillKey = (v: Omit<NewVisual, 'id'>) => JSON.stringify([v.backgroundPath, v.framePath, v.scene, v.onScreenCopy, v.render]);

/** Posting or posted: a non-failed publish attempt or a publishing/published slot for the video's item, or a publishing slot for the idea. */
const POSTING_SQL = (j: string) =>
  `EXISTS (SELECT 1 FROM social_hub.content_items ci JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci.id
             WHERE ci.vertical = 'reels' AND ci.native_ref = ${j}.id::text AND pa.status <> 'failed')
   OR EXISTS (SELECT 1 FROM social_hub.content_items ci JOIN social_hub.schedule sc ON sc.content_item_id = ci.id
             WHERE ci.vertical = 'reels' AND ci.native_ref = ${j}.id::text AND sc.status IN ('publishing', 'published'))
   OR EXISTS (SELECT 1 FROM social_hub.schedule sc WHERE sc.vertical = 'reels' AND sc.idea_ref = ${j}.post_idea_id::text AND sc.status = 'publishing')`;

/** The raw (clean) clip kept beside a reel: `<id>/raw.rev<x>.mp4` next to `<id>/reel.rev<x>.mp4`, and `<id>/raw.mp4` next to a pipeline reel's `<id>/reel.mp4` (video-run keeps it, clean-clip.ts). */
export function rawKeyFor(videoPath: string): string | null {
  const plain = /^(.*)\/reel\.mp4$/.exec(videoPath);
  if (plain) return `${plain[1]}/raw.mp4`;
  const m = /^(.*)\/reel\.rev([^/]+)\.mp4$/.exec(videoPath);
  return m ? `${m[1]}/raw.rev${m[2]}.mp4` : null;
}

async function lockOf(q: Query, r: Row): Promise<string | null> {
  const { rows } = await q(`SELECT l.ny_date FROM (SELECT $1::uuid AS slate_id, $2::uuid AS post_idea_id) j, LATERAL (${LOCK_SQL('j')}) l LIMIT 1`, [r.slate_id, r.post_idea_id]);
  return (rows[0]?.ny_date as string | undefined) ?? null;
}

async function busy(q: Query, r: Row): Promise<boolean> {
  const { rows } = await q(`SELECT (${BUSY_SQL('j')}) AS busy FROM (SELECT $1::uuid AS post_idea_id) j`, [r.post_idea_id]);
  return rows[0]?.busy === true;
}

/** What `video_jobs.motion_prompt` records (motion-prompt.ts motionRecord): the hook, its timing, then Kling's block. */
function readRecord(text: string | null): { hook: Hook | null; routed: Hook | null; timing: HookTiming; kling: string } {
  const s = text ?? '';
  const pick = <T extends string>(re: RegExp, allowed: readonly T[]): T | null => {
    const v = re.exec(s)?.[1];
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  };
  const hook = pick(/^Hook: (\S+)$/m, HOOKS);
  const lines = s.split('\n');
  const at = lines.findIndex((l) => l.startsWith('Camera:'));
  return {
    hook,
    routed: pick(/^Routed hook: (\S+)$/m, HOOKS) ?? hook,
    timing: pick(/^Hook timing: (\S+)$/m, HOOK_TIMING_IDS) ?? 'double',
    kling: at >= 0 ? lines.slice(at).join('\n') : '',
  };
}

function filesOf(p: { videoPath: string | null; framePath: string | null; backgroundPath: string | null; rawPath?: string | null }): string[] {
  return [p.videoPath, p.framePath, p.backgroundPath, p.rawPath ?? null].filter((f): f is string => !!f);
}

function stateOf(r: Row, made: string | null, rawPath?: string | null): ReelState {
  return {
    copy: { onScreenCopy: r.on_screen_copy },
    photo: { visualJobId: r.visual_job_id, scene: r.scene },
    colors: { grade: gradeOf(r) },
    video: { visualJobId: r.visual_job_id, videoPath: r.video_storage_path, motionPrompt: r.motion_prompt, higgsfieldJobId: r.higgsfield_job_id },
    files: filesOf({ videoPath: r.video_storage_path, framePath: r.frame_storage_path, backgroundPath: r.background_storage_path, rawPath }),
    made,
  };
}

/** The idea's member pages and the pages they cite, members in order (reels.idea_sources_v: legacy or intake). */
export async function knownUrlsFor(q: Query, postIdeaId: string): Promise<string[]> {
  const { rows } = await q(
    `SELECT m.url AS canonical_url, m.citation_urls FROM reels.idea_sources_v m
      WHERE m.post_idea_id = $1::uuid ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at`,
    [postIdeaId],
  );
  return [...new Set(rows.flatMap((x) => [x.canonical_url as string, ...((x.citation_urls as string[] | null) ?? [])]))];
}

/** idea_copy.checks as the copy stage computes it (pipeline/copy.ts: checkCopy(report, bucket, knownUrls)). Null stays null. */
async function checksFor(q: Query, r: Row, onScreenCopy: string): Promise<unknown> {
  if (r.checks == null) return null;
  const [{ checkCopy, ON_SCREEN_WORD_RANGE }] = await Promise.all([import('@/lib/reels/copy/report')]);
  if (!r.bucket || !(r.bucket in ON_SCREEN_WORD_RANGE)) return r.checks;
  const known = await knownUrlsFor(q, r.post_idea_id);
  const report: CopyReport = {
    onScreenCopy,
    viewerStake: r.viewer_stake ?? '',
    caption: r.caption ?? '',
    builderRead: r.working?.builderRead ?? '',
    callToAction: r.call_to_action ?? '',
    hashtags: r.hashtags ?? [],
    sources: r.sources ?? [],
    working: (r.working ?? {}) as CopyReport['working'],
  };
  return checkCopy(report, r.bucket as BucketId, known);
}

/**
 * The ONE guarded write. Applies only while the video row, its frame pointer, its record and the
 * words are still what this revision read, the reel is not locked and no stage of the idea is being
 * made; otherwise nothing changes (false).
 */
async function save(
  q: Query,
  cur: Row,
  next: { copy?: { onScreenCopy: string; checks: unknown }; visual?: NewVisual; video: VideoPointers },
): Promise<boolean> {
  const v = next.visual;
  const { rows } = await q(
    `WITH guard AS (
       SELECT j.id, j.slate_id, j.post_idea_id FROM reels.video_jobs j
        WHERE j.id = $1::uuid AND j.status = 'ok'
          AND j.video_storage_path IS NOT DISTINCT FROM $2::text
          AND j.visual_job_id IS NOT DISTINCT FROM $3::uuid
          AND j.motion_prompt IS NOT DISTINCT FROM $4::text
          AND EXISTS (SELECT 1 FROM reels.idea_copy c WHERE c.slate_id = j.slate_id AND c.post_idea_id = j.post_idea_id
                        AND c.on_screen_copy IS NOT DISTINCT FROM $5::text)
          AND NOT EXISTS (${LOCK_SQL('j')})
          AND NOT (${BUSY_SQL('j')})
          AND NOT (${POSTING_SQL('j')})
        FOR UPDATE OF j
     ),
     vis AS (
       INSERT INTO reels.visual_jobs (id, post_idea_id, slate_id, status, requested_at, started_at, finished_at, category, story,
                                      on_screen_copy, scene, image_prompt, background_storage_path, frame_storage_path,
                                      background_qa, render, warnings, usd)
       SELECT $6::uuid, g.post_idea_id, g.slate_id, 'ok', clock_timestamp(), clock_timestamp(), clock_timestamp(), $7::text, $8::text, $9::text, $10::text, $11::text,
              $12::text, $13::text, $14::jsonb, $15::jsonb, $16::jsonb, $17::numeric
         FROM guard g WHERE $6::uuid IS NOT NULL
       RETURNING id
     ),
     cp AS (
       UPDATE reels.idea_copy c SET on_screen_copy = $18::text, checks = $19::jsonb
         FROM guard g WHERE $20::boolean AND c.slate_id = g.slate_id AND c.post_idea_id = g.post_idea_id
       RETURNING c.*
     ),
     hist AS (
       INSERT INTO reels.idea_copy_history (slate_id, post_idea_id, run_id, prompt_version, model, bucket, framework, status,
                                            on_screen_copy, viewer_stake, caption, call_to_action, hashtags, sources, checks,
                                            working, variants, full_story_below, full_story_cue)
       SELECT slate_id, post_idea_id, run_id, prompt_version, model, bucket, framework, status, on_screen_copy, viewer_stake,
              caption, call_to_action, hashtags, sources, checks, working, variants, full_story_below, full_story_cue
         FROM cp
     ),
     vid AS (
       UPDATE reels.video_jobs j SET visual_job_id = $21::uuid, video_storage_path = $22::text, motion_prompt = $23::text, higgsfield_job_id = $24::text
         FROM guard g WHERE j.id = g.id
       RETURNING j.id
     )
     SELECT (SELECT count(*) FROM vid)::int AS n`,
    [
      cur.video_id,
      cur.video_storage_path,
      cur.visual_job_id,
      cur.motion_prompt,
      cur.on_screen_copy,
      v?.id ?? null,
      v?.category ?? null,
      v?.story ?? null,
      v?.onScreenCopy ?? null,
      v?.scene ?? null,
      v?.imagePrompt ?? null,
      v?.backgroundPath ?? null,
      v?.framePath ?? null,
      v?.qa ? JSON.stringify(v.qa) : null,
      v ? JSON.stringify(v.render) : null,
      JSON.stringify(v?.warnings ?? []),
      v?.usd ?? 0,
      next.copy?.onScreenCopy ?? null,
      next.copy && next.copy.checks != null ? JSON.stringify(next.copy.checks) : null,
      !!next.copy,
      next.video.visualJobId,
      next.video.videoPath,
      next.video.motionPrompt,
      next.video.higgsfieldJobId,
    ],
  );
  return Number(rows[0]?.n ?? 0) === 1;
}

/** The meter as a billable dep sees it: once it has thrown, `stopped()` is true and every spend re-throws. */
function metered(meter: { spend(usd: number): void }): Metered & { check(): void } {
  let stop: unknown = null;
  const halt = (): never => {
    throw stop;
  };
  return {
    spend(usd) {
      if (stop) halt();
      try {
        meter.spend(usd);
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

export function createTextOnScreenDescription(deps: TextOnScreenDeps): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));

  return {
    vertical: 'reels',
    label: 'text on screen',
    stageTags: TEXT_ON_SCREEN_STAGE_TAGS,
    fixKinds: ['wording', 'photo', 'motion', 'color'],
    argsGuide: {
      wording: 'args.value is the exact new text on screen (the words laid over the video), written out in full.',
      photo: 'This redoes the background image. No args are needed; args.sceneHint is an optional short description of the background wanted (for example "a desk lamp in an empty office").',
      motion: 'This redoes the movement of the clip. No args are needed; args.motionHint is an optional short note on the movement wanted (for example "slower, calmer").',
      color: 'args.grade is the reel\'s new color grade: one of noir, paper, orange or green.',
    },

    async load(q, refs) {
      const r = await readReel(q, refs);
      if (!r) return null;
      const grade = gradeOf(r);
      const rec = readRecord(r.motion_prompt);
      const movement = rec.kling ? rec.kling.split('\n').slice(0, 6).join(' ').slice(0, 600) : 'no movement recorded';
      return {
        vertical: 'reels',
        refs,
        status: await statusOf(q, r),
        parts: [
          { ref: { kind: 'stage', key: 'copy' }, text: `The text on screen (the words laid over the video): "${r.on_screen_copy ?? ''}"` },
          {
            ref: { kind: 'stage', key: 'frame' },
            text: `The background image (the still the video starts from, ${grade} color grade): ${r.scene ?? 'no scene recorded'}`,
            color: grade,
          },
          {
            ref: { kind: 'stage', key: 'video' },
            text: `The movement (the 10-second clip made from the background): ${movement}. It opens on the ${rec.hook ?? 'no'} hook.`,
            color: grade,
          },
        ],
      };
    },

    /** Wording is ffmpeg and the local text engine only. Motion is one writer call and one clip; photo and color add a background. */
    estimate(fix: FixKind) {
      const video = TEXT_ON_SCREEN_WRITER_ESTIMATE_USD + TEXT_ON_SCREEN_KLING_USD;
      if (fix === 'motion') return video;
      if (fix === 'photo') return TEXT_ON_SCREEN_WRITER_ESTIMATE_USD + TEXT_ON_SCREEN_IMAGE_ESTIMATE_USD + video;
      if (fix === 'color') return TEXT_ON_SCREEN_IMAGE_ESTIMATE_USD + video;
      return 0;
    },

    async revise({ q, refs, interpretation: it, meter }) {
      const r = await readReel(q, refs);
      if (!r) return failed('This text on screen reel could not be found, so nothing was changed.');
      const status = await statusOf(q, r);
      if (status === 'published') return blocked('This text on screen reel is posting or has posted, so it was not changed.');
      if (status === 'rejected') return blocked('This text on screen reel was rejected, so it was not changed.');
      if (r.video_status !== 'ok' || !r.video_storage_path) return failed('This text on screen reel has no finished video yet, so nothing was changed. Try again once it is made.');
      if (it.part.kind !== 'stage' || !(STAGES as readonly string[]).includes(it.part.key)) {
        return failed(`A text on screen reel has three parts (the text, the background, the movement); "${it.part.kind} ${it.part.key}" is not one of them, so nothing was changed.`);
      }
      if (!(['wording', 'photo', 'motion', 'color'] as FixKind[]).includes(it.fixKind)) return failed(`${it.fixKind} fixes are not available for text on screen, so nothing was changed.`);
      const lock = await lockOf(q, r);
      if (lock) return blocked(`This text on screen reel is locked for ${lock} and stays as generated, so it was not changed.`);
      if (await busy(q, r)) return failed('Part of this text on screen reel is being made right now, so nothing was changed. Try again once it is finished.');
      const copy = r.on_screen_copy?.trim();
      if (r.copy_status !== 'ok' || !copy) return failed('This text on screen reel has no stored words, so nothing was changed.');
      if (!r.visual_job_id || !r.background_storage_path) return failed('This text on screen reel has no stored background image, so nothing was changed.');
      const args = it.args ?? {};
      const grade = gradeOf(r);
      const rec = readRecord(r.motion_prompt);
      const cue = r.full_story_cue?.trim() ? r.full_story_cue.trim() : null;

      // Argument checks (nothing paid, nothing written).
      let value = '';
      let want: ColorProfile = grade;
      if (it.fixKind === 'wording') {
        value = (args.value ?? '').trim();
        if (!value) return failed('I could not tell what the new text on screen should say, so nothing was changed.');
        if (value === copy) return failed('The text on screen already says that, so nothing was changed.');
        const [{ ON_SCREEN_WORD_RANGE, countWords }, { textArtifacts }] = await Promise.all([import('@/lib/reels/copy/report'), import('@/lib/reels/copy/clean-text')]);
        const range = r.bucket ? ON_SCREEN_WORD_RANGE[r.bucket as BucketId] : undefined;
        if (!range) return failed('I could not tell how many words this text on screen reel takes, so nothing was changed.');
        const words = countWords(value);
        if (words < range.min || words > range.max) {
          return blocked(`The new text on screen is ${words} words; this kind of reel takes ${range.min} to ${range.max}, so it was not changed.`);
        }
        const leftovers = textArtifacts(value);
        if (leftovers.length) return blocked(`The new text on screen carries ${leftovers.join(' and ')}, which would show on the video, so it was not changed.`);
      } else if (it.fixKind === 'color') {
        const g = (args.grade ?? '').trim().toLowerCase();
        if (!g) return failed(`I could not tell which color grade the text on screen reel should have (${COLOR_PROFILES.join(', ')}), so nothing was changed.`);
        if (!isColorProfile(g)) return failed(`"${g}" is not a text on screen color grade. Choose noir, paper, orange or green; nothing was changed.`);
        if (g === grade) return failed(`This text on screen reel is already ${g}, so nothing was changed.`);
        want = g;
      }

      const m = metered(meter);
      const id = newId();
      const videoKey = `${r.video_id}/reel.rev${id}.mp4`;
      const rawKey = `${r.video_id}/raw.rev${id}.mp4`;
      const work = await deps.workDir();
      const { relayPlate } = await import('../text-on-screen-plate');
      /** A dep call whose error means "could not do it"; a ceiling stop re-throws. */
      const attempt = async <T,>(f: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
        try {
          const out = await f();
          m.check();
          return { ok: true, value: out };
        } catch (e) {
          m.check();
          return { ok: false, error: errText(e) };
        }
      };
      try {
        if (it.fixKind === 'wording') {
          const bg = await attempt(() => deps.readObject(r.background_storage_path!));
          if (!bg.ok) return failed(`I could not read this reel's background image (${bg.error}), so the text on screen was not changed.`);
          const fit = await attempt(() => deps.renderText(bg.value, value, grade, cue));
          if (!fit.ok) return failed(`The text engine could not set the new words (${fit.error}), so the text on screen was not changed.`);
          if (!fit.value.ok) return blocked(`The new text on screen does not fit the frame (${fit.value.error}), so it was not changed. Try fewer or shorter words.`);
          const clean = path.join(work.dir, 'clean.mp4');
          const stored = rawKeyFor(r.video_storage_path!);
          const found = await attempt(async () =>
            (stored ? await deps.readClip(stored, clean) : false) || (r.higgsfield_job_id ? await deps.falClip(r.higgsfield_job_id, clean) : false),
          );
          if (!found.ok || !found.value) {
            return failed('This text on screen reel has no clean clip (the video before its words) stored, so the words could not be laid again. Ask for a new movement instead, which makes a new clip with these words.');
          }
          const relay = await attempt(() => relayPlate(deps.plate, { storedClipPath: clean, newCopy: value, workDir: work.dir, profile: grade, fullStoryCue: cue, hook: rec.hook, timing: rec.timing }));
          if (!relay.ok) return failed(`The new words could not be laid over the video (${relay.error}), so the text on screen was not changed.`);
          const visualId = randomUUID();
          const frameKey = `${visualId}/frame.png`;
          // The clean clip goes beside the new reel, so the next wording fix finds it there (never via Fal).
          const kept = await attempt(async () => {
            await deps.storeBuffer(frameKey, fit.value.ok ? fit.value.png : Buffer.alloc(0), 'image/png');
            await deps.storeFile(rawKey, clean, 'video/mp4');
            await deps.storeFile(videoKey, relay.value.videoPath, 'video/mp4');
          });
          if (!kept.ok) return failed(`The new video could not be stored (${kept.error}), so the text on screen was not changed.`);
          const visual: NewVisual = {
            id: visualId,
            category: r.category,
            story: r.story,
            onScreenCopy: value,
            scene: r.scene,
            imagePrompt: null,
            backgroundPath: r.background_storage_path,
            framePath: frameKey,
            qa: null,
            render: { ...(r.render ?? {}), lines: fit.value.lines, details: null, colorProfile: grade },
            warnings: [...fit.value.warnings, ...relay.value.warnings],
            usd: 0,
          };
          return await finish(q, r, {
            copy: { onScreenCopy: value, checks: await checksFor(q, r, value) },
            visual,
            video: { visualJobId: visualId, videoPath: videoKey, motionPrompt: r.motion_prompt, higgsfieldJobId: r.higgsfield_job_id },
          }, { scene: r.scene, grade, framePath: frameKey, backgroundPath: r.background_storage_path, rawPath: rawKey });
        }

        // photo, color, motion: the background (new or stored), then one new clip.
        let bgPng: Buffer;
        let bgKey = r.background_storage_path;
        let scene = r.scene ?? '';
        let visual: NewVisual | undefined;
        if (it.fixKind === 'photo' || it.fixKind === 'color') {
          const spentBefore = meter.spent;
          const hint = it.fixKind === 'photo' ? (args.sceneHint ?? '').trim() : '';
          if (hint) {
            const { rows } = await q(
              `SELECT scene FROM reels.visual_jobs WHERE status = 'ok' AND scene IS NOT NULL AND id <> $1::uuid ORDER BY finished_at DESC NULLS LAST LIMIT $2`,
              [r.visual_job_id, RECENT_SCENES],
            );
            const written = await attempt(() =>
              deps.writeScene({ story: r.story ?? '', category: (r.category ?? 'storytelling') as VisualCategory, onScreenText: copy, recentScenes: rows.map((x) => x.scene as string), profile: want, hint }, m),
            );
            if (!written.ok) return failed(`I couldn't reach the scene writer (${written.error}), so the background was not changed.`);
            if (!written.value?.trim()) return failed('The scene writer returned no new background description, so the background was not changed.');
            scene = written.value.trim();
          }
          if (!scene.trim()) return failed('This text on screen reel has no stored scene to draw again, so the background was not changed.');
          const { assembleImagePrompt } = await import('@/lib/reels/visual/blocks');
          const imagePrompt = assembleImagePrompt(scene, want);
          const image = await attempt(() => deps.generateBackground(imagePrompt, m));
          if (!image.ok) return failed(`The image model could not draw a new background (${image.error}), so the original was kept.`);
          bgPng = image.value.png;
          // The band check and the still fail open, as in the frame stage (produce.ts): warnings, not a stop.
          const warnings: string[] = [];
          let qa: BackgroundQa | null = null;
          try {
            qa = await deps.checkBackground(bgPng, want);
            if (!qa.pass) warnings.push(`Background check: ${qa.reasons.join('; ') || 'failed the band check'}. Kept anyway.`);
          } catch (e) {
            warnings.push(`Background check did not run: ${errText(e)}`);
          }
          let framePng = bgPng;
          let lines: string[] = [];
          try {
            const fit = await deps.renderText(bgPng, copy, want, cue);
            if (fit.ok) {
              framePng = fit.png;
              lines = fit.lines;
              warnings.push(...fit.warnings);
            } else warnings.push(`Copy did not fit the still (${fit.error}). The video plate sets the text on its own.`);
          } catch (e) {
            warnings.push(`Text did not render on the still: ${errText(e)}`);
          }
          const visualId = randomUUID();
          bgKey = `${visualId}/background.png`;
          const frameKey = `${visualId}/frame.png`;
          const stored = await attempt(async () => {
            await deps.storeBuffer(bgKey!, bgPng, 'image/png');
            await deps.storeBuffer(frameKey, framePng, 'image/png');
          });
          if (!stored.ok) return failed(`The new background could not be stored (${stored.error}), so the original was kept.`);
          const { VISUAL_IMAGE_MODEL } = await import('@/lib/reels/config');
          visual = {
            id: visualId,
            category: r.category,
            story: r.story,
            onScreenCopy: copy,
            scene,
            imagePrompt,
            backgroundPath: bgKey,
            framePath: frameKey,
            qa,
            render: { lines, details: null, model: VISUAL_IMAGE_MODEL, colorProfile: want },
            warnings,
            usd: meter.spent - spentBefore,
          };
        } else {
          if (!scene.trim()) return failed('This text on screen reel has no stored scene for the motion writer, so the movement was not changed.');
          const bg = await attempt(() => deps.readObject(bgKey!));
          if (!bg.ok) return failed(`I could not read this reel's background image (${bg.error}), so the movement was not changed.`);
          bgPng = bg.value;
        }

        // The video stage (video-run.ts): motion writer → Kling → the stored hook and the plate.
        const motionHint = it.fixKind === 'motion' ? (args.motionHint ?? '').trim() || null : null;
        const motion = await attempt(() => deps.writeMotion({ png: bgPng, scene, story: r.story ?? '', onScreenCopy: copy, profile: want, hint: motionHint }, m));
        if (!motion.ok) return failed(`I couldn't reach the motion writer (${motion.error}), so the original was kept.`);
        m.spend(TEXT_ON_SCREEN_KLING_USD);
        const clip = await attempt(() => deps.kling({ prompt: motion.value.text, backgroundKey: bgKey!, profile: want }, m));
        if (!clip.ok) return failed(`Kling could not make the new clip (${clip.error}), so the original was kept.`);
        const raw = path.join(work.dir, 'raw.mp4');
        const relay = await attempt(async () => {
          await deps.writeLocal(raw, clip.value.bytes);
          return relayPlate(deps.plate, { storedClipPath: raw, newCopy: copy, workDir: work.dir, profile: want, fullStoryCue: cue, hook: rec.hook, timing: rec.timing });
        });
        if (!relay.ok) return failed(`The words could not be laid over the new clip (${relay.error}), so the original was kept.`);
        const stored = await attempt(async () => {
          await deps.storeFile(rawKey, raw, 'video/mp4');
          await deps.storeFile(videoKey, relay.value.videoPath, 'video/mp4');
        });
        if (!stored.ok) return failed(`The new video could not be stored (${stored.error}), so the original was kept.`);
        const { motionRecord } = await import('@/lib/reels/visual/motion-prompt');
        const prompt = { ...motion.value, warnings: [...relay.value.warnings, ...motion.value.warnings] };
        const record = motionRecord(relay.value.hook, prompt, rec.timing, rec.routed ? { routedHook: rec.routed, sfx: relay.value.sfx } : undefined);
        return await finish(
          q,
          r,
          { visual, video: { visualJobId: visual?.id ?? r.visual_job_id, videoPath: videoKey, motionPrompt: record, higgsfieldJobId: clip.value.jobId } },
          { scene, grade: want, framePath: visual?.framePath ?? r.frame_storage_path, backgroundPath: bgKey, rawPath: rawKey },
        );
      } finally {
        await work.done().catch(() => {});
      }
    },

    async restore({ q, refs, state }) {
      const r = await readReel(q, refs);
      if (!r) throw new Error('The text on screen reel is gone.');
      const s = state as ReelState;
      if (!s.video) throw new Error('This undo record has no text on screen reel state.');
      const words = s.copy?.onScreenCopy ?? r.on_screen_copy;
      const v = s.video;
      // The still to come back to. When it is not the current row, a COPY of it is inserted, so the
      // idea's newest frame row (what loadFramesForIdeas and latestBackground read) is the restored one.
      const target = v.visualJobId ? await readVisual(q, v.visualJobId) : null;
      if (v.visualJobId && !target) throw new Error('The frame this text on screen reel is being restored to is gone.');
      const current = r.visual_job_id ? await readVisual(q, r.visual_job_id) : null;
      const sameStill = r.visual_job_id === v.visualJobId || (!!target && !!current && stillKey(target) === stillKey(current));
      const unchanged =
        r.video_storage_path === v.videoPath && sameStill && r.motion_prompt === v.motionPrompt && r.higgsfield_job_id === v.higgsfieldJobId && r.on_screen_copy === words;
      if (unchanged) return; // idempotent
      if (s.made !== undefined && r.video_storage_path !== s.made) {
        throw new Error('A later fix to this text on screen reel changed it after this one; undo that fix first.');
      }
      const copyChanged = words != null && words !== r.on_screen_copy;
      const visual: NewVisual | undefined = !sameStill && target ? { ...target, id: randomUUID() } : undefined;
      const ok = await save(q, r, {
        ...(copyChanged ? { copy: { onScreenCopy: words, checks: await checksFor(q, r, words) } } : {}),
        ...(visual ? { visual } : {}),
        video: { ...v, visualJobId: visual?.id ?? (sameStill ? r.visual_job_id : v.visualJobId) },
      });
      if (!ok) throw new Error('The text on screen reel changed, is locked, is posting, or is being made right now, so it was not restored.');
    },

    /**
     * Back to review: the idea's slot and approval (unscheduleIdea). A reel with no slot (force-posted
     * and failed, or a released slot) can still be approved: its approval is withdrawn on the spine.
     */
    unschedule: async (q, refs) => {
      const r = await readReel(q, refs);
      const postIdeaId = refs.postIdeaId ?? r?.post_idea_id;
      if (!postIdeaId) return { ok: false, note: 'This text on screen reel could not be found.' };
      const slot = await q(`SELECT 1 FROM social_hub.schedule WHERE vertical = 'reels' AND idea_ref = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`, [postIdeaId]);
      const item = r ? ((await q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'reels' AND native_ref = $1`, [r.video_id])).rows[0]?.id as string | undefined) : undefined;
      if (slot.rows.length) {
        const out = await deps.unschedule(q, postIdeaId);
        if (!out.ok || !item) return out;
        // unscheduleIdea withdraws the slot's item's approval; this video's own approval goes too.
        const still = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1::uuid AND decision = 'approved'`, [item]);
        return still.rows.length ? deps.withdrawItem(q, item) : out;
      }
      if (!item) return { ok: false, note: 'This text on screen reel has no slot and no approval to withdraw.' };
      return deps.withdrawItem(q, item);
    },
  };

  /** The guarded write, then before/after for undo. */
  async function finish(
    q: Query,
    r: Row,
    next: Parameters<typeof save>[2],
    after: { scene: string | null; grade: ColorProfile; framePath: string | null; backgroundPath: string | null; rawPath?: string | null },
  ) {
    if (!(await save(q, r, next))) {
      return failed('The text on screen reel changed, was locked, or started being made while the fix ran, so it was not changed.');
    }
    const before = stateOf(r, next.video.videoPath);
    const afterState: ReelState = {
      copy: { onScreenCopy: next.copy?.onScreenCopy ?? r.on_screen_copy },
      photo: { visualJobId: next.video.visualJobId, scene: after.scene },
      colors: { grade: after.grade },
      video: next.video,
      files: filesOf({ videoPath: next.video.videoPath, framePath: after.framePath, backgroundPath: after.backgroundPath, rawPath: after.rawPath }),
      made: r.video_storage_path,
    };
    return { ok: true as const, before, after: afterState };
  }
}

export const textOnScreenDescription: ContentTypeDescription = createTextOnScreenDescription(liveTextOnScreenDeps);
