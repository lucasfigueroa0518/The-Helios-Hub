/**
 * Job folders on the worker's disk. A job keeps about 0.8 GB locally (render, voice, harvest), and the VM's disk would
 * fill in about a week of nightly reels. Once a job is delivered its files are in the bucket and nothing reads the
 * folder again (revisions only change the caption), so finished folders are removed. A failed job keeps its folder
 * long enough to be retried (it resumes from what it paid for); a queued or running job is never touched.
 * Only for bucket storage: with local storage the folder holds the only copy of the video.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';

/** Days a delivered or killed job's folder stays. */
export const FINISHED_KEEP_DAYS = 1;
/** Days a failed job's folder stays, for a retry. */
export const FAILED_KEEP_DAYS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Removes the folders (`<jobsRoot>/<id>` and `<jobsRoot>/_harvest/<id>`) of jobs finished long enough ago. Returns the ids removed. */
export async function sweepJobFolders(db: Queryable, jobsRoot: string, now: Date = new Date()): Promise<string[]> {
  const folders = new Map<string, string[]>();
  for (const dir of [jobsRoot, path.join(jobsRoot, '_harvest')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!UUID.test(name)) continue;
      folders.set(name, [...(folders.get(name) ?? []), path.join(dir, name)]);
    }
  }
  if (!folders.size) return [];
  const { rows } = await db.query<{ id: string; status: string; finished_at: string | Date | null }>(
    `SELECT id::text AS id, status, finished_at FROM reel_ai_drama.jobs WHERE id::text = ANY($1::text[])`,
    [[...folders.keys()]],
  );
  const removed: string[] = [];
  for (const r of rows) {
    if (!r.finished_at) continue;
    const keepDays = r.status === 'ok' || r.status === 'killed' ? FINISHED_KEEP_DAYS : r.status === 'failed' ? FAILED_KEEP_DAYS : null;
    if (keepDays === null) continue;
    if (now.getTime() - new Date(r.finished_at).getTime() < keepDays * 86_400_000) continue;
    for (const dir of folders.get(r.id) ?? []) fs.rmSync(dir, { recursive: true, force: true });
    removed.push(r.id);
  }
  return removed;
}
