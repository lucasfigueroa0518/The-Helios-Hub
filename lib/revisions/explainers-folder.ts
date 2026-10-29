/**
 * The job-folder side of an Explainers scene redo (descriptions/explainers.ts), kept crash-safe:
 *
 *   hold      the job's running slot (status 'running', stage HOLD_STAGE): the one-render-at-a-time
 *             index, so no render runs while a redo does.
 *   setAside  writes a manifest (<job dir>/revision-hold.json: the redo id, the scene, the stage the
 *             hold replaced, what was moved) and RENAMES the scene's module and sound events and the
 *             local video and contact sheet to `*.before-rev<id>`. Nothing is deleted, so the old
 *             source is on disk for the whole redo.
 *   putBack   renames them back over whatever the session left (which is set aside as
 *             `*.failed-rev<id>`), then removes the manifest. The in-process rollback and the
 *             start-up recovery both use it.
 *   recoverSceneRedos  helios-explainers start-up, BEFORE failStaleRunningJobs (which leaves redo
 *             holds alone): every job still held by a redo is put back from its manifest (only when the
 *             manifest is the current hold's) and released with the stage it had. Only that worker runs
 *             explainer redos, so no other process ever releases a live hold.
 *
 * The collateral check: a scene redo may change only its own scene. Every other frame module and
 * sound-events file, STORYBOARD.md, SCRIPT.md, audio_meta.json, assets/world/world.js and the voice
 * (assets/voice/) are hashed before the session and compared after. The code-written modules (the
 * bank opener over the hook, the kit's close) are exempt: mount writes them again on every run.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';

/**
 * A redo's hold carries stage `revision:<redo id>` (lib/explainers/repository.ts REVISION_STAGE is the
 * prefix). The id is also the manifest's, so recovery only ever acts on the manifest of the CURRENT
 * hold: a manifest an earlier, committed redo left behind is never replayed.
 */
export const HOLD_STAGE = 'revision';
const MANIFEST = 'revision-hold.json';
export const holdStage = (token: string) => `${HOLD_STAGE}:${token}`;
/**
 * A released redo whose files could not be put back: stage `revision_interrupted:<id>` on an `ok`
 * job. Scene redos of it are refused, and start-up recovery retries the repair from its manifest.
 */
export const INTERRUPTED = 'revision_interrupted';

export type RedoManifest = { id: string; key: string; stage: string; hadEvents: boolean; movedVideo: boolean; movedSheet: boolean };

const paths = (jobDir: string, key: string, id: string) => {
  const project = path.join(jobDir, 'project');
  const frames = path.join(project, 'assets', 'frames');
  return {
    manifest: path.join(jobDir, MANIFEST),
    module: path.join(frames, `${key}.js`),
    events: path.join(frames, `${key}.events.json`),
    video: path.join(project, 'renders', 'video.mp4'),
    sheet: path.join(project, 'snapshots', 'contact-sheet.jpg'),
    aside: (file: string) => `${file}.before-rev${id}`,
    failed: (file: string) => `${file}.failed-rev${id}`,
  };
};

/** Hold the job's running slot for redo `token`. The stage it had ('' for none), or null when a render or another redo is running. */
export async function hold(db: Queryable, jobId: string, token: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ old: string | null }>(
      `UPDATE explainers.jobs j SET status = 'running', stage = $2
         FROM (SELECT stage AS old FROM explainers.jobs WHERE id = $1) o
        WHERE j.id = $1 AND j.status = 'ok' AND NOT EXISTS (SELECT 1 FROM explainers.jobs r WHERE r.status = 'running')
        RETURNING o.old`,
      [jobId, holdStage(token)],
    );
    return rows.length ? (rows[0]!.old ?? '') : null;
  } catch (e) {
    // The unique indexes (one running job; one in-flight job per topic) refused the hold.
    if ((e as { code?: string })?.code === '23505') return null;
    throw e;
  }
}

/** Release redo `token`'s hold, back to `stage`. */
export async function release(db: Queryable, jobId: string, token: string, stage: string): Promise<void> {
  await db.query(`UPDATE explainers.jobs SET status = 'ok', stage = $2 WHERE id = $1 AND status = 'running' AND stage = $3`, [jobId, stage || null, holdStage(token)]);
}

/** Write the manifest, then rename the scene's files and the local video and contact sheet aside. */
export function setAside(jobDir: string, m: { id: string; key: string; stage: string }): RedoManifest {
  const p = paths(jobDir, m.key, m.id);
  const manifest: RedoManifest = { ...m, hadEvents: fs.existsSync(p.events), movedVideo: fs.existsSync(p.video), movedSheet: fs.existsSync(p.sheet) };
  fs.writeFileSync(p.manifest, `${JSON.stringify(manifest)}\n`);
  for (const file of [p.module, p.events, p.video, p.sheet]) if (fs.existsSync(file)) fs.renameSync(file, p.aside(file));
  return manifest;
}

/** Put the set-aside files back over what the session left (that is kept as `*.failed-rev<id>`), then drop the manifest. */
export function putBack(jobDir: string, m: RedoManifest): void {
  const p = paths(jobDir, m.key, m.id);
  const had: Record<string, boolean> = { [p.module]: true, [p.events]: m.hadEvents, [p.video]: m.movedVideo, [p.sheet]: m.movedSheet };
  for (const file of [p.module, p.events, p.video, p.sheet]) {
    const aside = p.aside(file);
    if (fs.existsSync(aside)) {
      if (fs.existsSync(file)) fs.renameSync(file, p.failed(file));
      fs.renameSync(aside, file);
    } else if (!had[file] && fs.existsSync(file)) {
      fs.renameSync(file, p.failed(file)); // new, where there was none before
    }
  }
  fs.rmSync(p.manifest, { force: true });
}

/** The redo was kept (or is starting): the manifest goes; any `*.before-rev<id>` files stay as history. */
export function finishAside(jobDir: string): void {
  fs.rmSync(path.join(jobDir, MANIFEST), { force: true });
}

export function readManifest(jobDir: string): RedoManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(jobDir, MANIFEST), 'utf8')) as RedoManifest;
    return typeof m?.id === 'string' && typeof m?.key === 'string' ? m : null;
  } catch {
    return null;
  }
}

/**
 * helios-explainers start-up (never in --once, which may run beside a live redo): put back and
 * release every job a redo still holds, and retry the repair of jobs released as
 * `revision_interrupted:<id>`. Each job is isolated: a failure to put its files back is logged with
 * the job id and a held job is still released (stage `revision_interrupted:<id>`, retried next
 * start-up), so one bad folder never stops the worker from starting or blocks renders. Returns the
 * job ids it released or repaired.
 */
export async function recoverSceneRedos(db: Queryable, jobsRoot: string, log: (event: string, fields: Record<string, unknown>) => void = () => undefined): Promise<string[]> {
  // Jobs a redo still holds, and released ones whose files are still waiting for repair.
  const { rows } = await db.query<{ id: string; status: string; stage: string }>(
    `SELECT id::text AS id, status, stage FROM explainers.jobs
      WHERE (status = 'running' AND stage LIKE $1) OR (status = 'ok' AND stage LIKE $2)`,
    [`${HOLD_STAGE}:%`, `${INTERRUPTED}:%`],
  );
  const done: string[] = [];
  for (const { id, status, stage } of rows) {
    const held = status === 'running';
    const token = stage.slice(stage.indexOf(':') + 1);
    // Default: still waiting (keeps the token, so the next start-up tries again).
    let back = `${INTERRUPTED}:${token}`;
    try {
      const jobDir = path.join(jobsRoot, id);
      const m = readManifest(jobDir);
      if (m && m.id === token) {
        putBack(jobDir, m);
        back = m.stage;
      } else {
        // No manifest of this redo: nothing to put back (a manifest left by an earlier, kept redo is never replayed).
        if (m) {
          log('scene_redo_stale_manifest', { jobId: id, manifest: m.id, hold: token });
          finishAside(jobDir);
        }
        back = INTERRUPTED;
      }
    } catch (error) {
      log('scene_redo_recovery_failed', { jobId: id, error: error instanceof Error ? error.message : String(error) });
    }
    try {
      if (held) await release(db, id, token, back);
      else if (back !== stage) {
        await db.query(`UPDATE explainers.jobs SET stage = $2 WHERE id = $1 AND status = 'ok' AND stage = $3`, [id, back || null, stage]);
      }
      if (held || back !== stage) done.push(id);
    } catch (error) {
      log('scene_redo_release_failed', { jobId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return done;
}

// ── The collateral check ───────────────────────────────────────────────────

type Entry = { hash: string; body: Buffer | null };
export type Snapshot = Map<string, Entry>;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function walk(dir: string, rel: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else out.push(r);
  }
}

/** The files a redo of `target` must not change (relative to the project). */
function guarded(projectDir: string, target: string, exempt: readonly string[]): string[] {
  const own = new Set([target, ...exempt].flatMap((id) => [`${id}.js`, `${id}.events.json`]));
  const frames: string[] = [];
  walk(path.join(projectDir, 'assets', 'frames'), 'assets/frames', frames);
  const voice: string[] = [];
  walk(path.join(projectDir, 'assets', 'voice'), 'assets/voice', voice);
  return [
    ...frames.filter((f) => !own.has(path.posix.basename(f)) && !/\.(before|failed)-rev[^/]*$/.test(f)),
    ...['STORYBOARD.md', 'SCRIPT.md', 'audio_meta.json', 'assets/world/world.js'].filter((f) => fs.existsSync(path.join(projectDir, f))),
    ...voice,
  ];
}

/** Hashes (and, except for the voice audio, the bytes) of every guarded file. */
export function snapshot(projectDir: string, target: string, exempt: readonly string[]): Snapshot {
  const snap: Snapshot = new Map();
  for (const rel of guarded(projectDir, target, exempt)) {
    const body = fs.readFileSync(path.join(projectDir, rel));
    snap.set(rel, { hash: sha(body), body: rel.startsWith('assets/voice/') ? null : body });
  }
  return snap;
}

/** Guarded files changed, added or removed since `before`. */
export function collateral(projectDir: string, before: Snapshot, target: string, exempt: readonly string[]): string[] {
  const now = guarded(projectDir, target, exempt);
  const changed = now.filter((rel) => before.get(rel)?.hash !== sha(fs.readFileSync(path.join(projectDir, rel))));
  const removed = [...before.keys()].filter((rel) => !fs.existsSync(path.join(projectDir, rel)));
  return [...new Set([...changed, ...removed])].sort();
}

/** Put the guarded files back as `before` had them. Returns what could not be (voice audio is hashed, not kept). */
export function restoreCollateral(projectDir: string, before: Snapshot, changed: readonly string[], id: string): string[] {
  const lost: string[] = [];
  for (const rel of changed) {
    const file = path.join(projectDir, rel);
    const was = before.get(rel);
    if (!was) {
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.failed-rev${id}`); // added by the session
    } else if (was.body) {
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.failed-rev${id}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, was.body);
    } else lost.push(rel);
  }
  return lost;
}
