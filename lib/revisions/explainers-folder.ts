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
 *   recoverSceneRedos  helios-explainers start-up, BEFORE failStaleRunningJobs: every job still held
 *             by a redo is put back from its manifest and released with the stage it had. Only that
 *             worker runs explainer redos, so no other process ever releases a live hold.
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

/** The stage a redo's hold carries (lib/explainers/repository.ts REVISION_STAGE). */
export const HOLD_STAGE = 'revision';
const MANIFEST = 'revision-hold.json';

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

/** Hold the job's running slot. The stage it had ('' for none), or null when a render or another redo is running. */
export async function hold(db: Queryable, jobId: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ old: string | null }>(
      `UPDATE explainers.jobs j SET status = 'running', stage = $2
         FROM (SELECT stage AS old FROM explainers.jobs WHERE id = $1) o
        WHERE j.id = $1 AND j.status = 'ok' AND NOT EXISTS (SELECT 1 FROM explainers.jobs r WHERE r.status = 'running')
        RETURNING o.old`,
      [jobId, HOLD_STAGE],
    );
    return rows.length ? (rows[0]!.old ?? '') : null;
  } catch (e) {
    // The unique indexes (one running job; one in-flight job per topic) refused the hold.
    if ((e as { code?: string })?.code === '23505') return null;
    throw e;
  }
}

export async function release(db: Queryable, jobId: string, stage: string): Promise<void> {
  await db.query(`UPDATE explainers.jobs SET status = 'ok', stage = $2 WHERE id = $1 AND status = 'running' AND stage = $3`, [jobId, stage || null, HOLD_STAGE]);
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

/** The redo was kept: the manifest goes; the `*.before-rev<id>` files stay as history. */
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

/** helios-explainers start-up: put back and release every job a redo still holds. Returns their ids. */
export async function recoverSceneRedos(db: Queryable, jobsRoot: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(`SELECT id::text AS id FROM explainers.jobs WHERE status = 'running' AND stage = $1`, [HOLD_STAGE]);
  for (const { id } of rows) {
    const jobDir = path.join(jobsRoot, id);
    const m = readManifest(jobDir);
    if (m) putBack(jobDir, m);
    await release(db, id, m ? m.stage : 'revision_interrupted');
  }
  return rows.map((r) => r.id);
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
