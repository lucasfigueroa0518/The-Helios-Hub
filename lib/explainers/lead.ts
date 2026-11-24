import type { Queryable } from '@/lib/explainers/db';

/**
 * Explainers made two days ahead (Bald-Eagle D4, D8; lib/social-hub/lead.ts). A render the night requests carries the
 * New York date it is FOR in `explainers.jobs.target_date` (db/bald_eagle_2026_11_12_leadtime.sql); a person's render
 * has none and counts as the day it was requested, as before.
 *
 * Reads go through `to_jsonb(j)->>'target_date'`, so they run on a database where the column is not added yet (and then
 * read a night render's date from its idea cycle, jobTargetSql); the one write checks for the column first
 * (jobsHaveTargetDate).
 */

const NY_TZ = 'America/New_York';

/**
 * A job row's target date as SQL (`alias` is the explainers.jobs alias). Its `target_date`; else, for a night render
 * (trigger 'auto'), the date of the idea cycle that requested it (`idea_cycles.ny_date`, the date that cycle fills: the
 * render was requested while the cycle ran, between its start and finish). The fallback is the fail-safe while the
 * column is not added yet, so a render made for day+2 still books day+2 (never today's leftover slot, which would
 * leave day+2 empty for good since its cycle row exists). For a render from before lead time the cycle's date is the
 * day it ran, as before. NULL: a person's render (no cycle), which counts as today.
 */
export const jobTargetSql = (alias: string) => `COALESCE((to_jsonb(${alias})->>'target_date')::date,
  (SELECT c.ny_date FROM explainers.idea_cycles c
    WHERE ${alias}.trigger = 'auto' AND c.started_at <= ${alias}.requested_at
      AND (c.finished_at IS NULL OR c.finished_at >= ${alias}.requested_at)
    ORDER BY c.started_at DESC LIMIT 1))`;

/** The New York day a job counts against (daily caps, retry): its target date, else the day it was requested. */
export const jobDaySql = (alias: string) => `COALESCE(${jobTargetSql(alias)}, (${alias}.requested_at AT TIME ZONE '${NY_TZ}')::date)`;

/** True when explainers.jobs has the target_date column (the lead-time SQL is applied). */
export async function jobsHaveTargetDate(db: Queryable): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'explainers' AND table_name = 'jobs' AND column_name = 'target_date'`,
  );
  return rows.length > 0;
}

/** The date a render was made FOR (the night's target date), or null (a person's render, or no column yet). */
export async function explainerJobTarget(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ d: string | null }>(`SELECT ${jobTargetSql('j')}::text AS d FROM explainers.jobs j WHERE j.id = $1`, [jobId]);
  const d = rows[0]?.d;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}
