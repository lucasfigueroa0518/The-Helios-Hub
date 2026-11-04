import type { Query } from '@/lib/social/store/pg';

import type { OneBoxInput, Stage } from './types';

/**
 * The one-box seed requests (design 2026-11-04-one-box-seeding-design, section 2): one row per click, so a placeholder card can
 * show progress and, when it stops, why. Staleness is decided when the cards are read, not by a writer: a request nobody has
 * touched for STALE_MINUTES shows as failed (or "may have been added" if it died while filing).
 */

export const STALE_MINUTES = 6;
export const MAX_WORKING = 3;
export const SAME_BLURB_SECONDS = 60;

export type Card = {
  id: string;
  vertical: string;
  blurb: string;
  status: 'working' | 'failed';
  stage: string;
  message: string | null;
  createdAt: string;
};

const staleBefore = (now: Date) => new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();

/** How many requests are genuinely still running (stale ones do not count). */
export async function workingCount(q: Query, now = new Date()): Promise<number> {
  const { rows } = await q(`SELECT count(*)::int AS n FROM social_hub.seed_requests WHERE status = 'working' AND updated_at > $1::timestamptz`, [staleBefore(now)]);
  return Number(rows[0]?.n ?? 0);
}

/** Open a request. The same blurb in the same pool inside a minute is the first click (`reused`); a fourth running request is refused. */
export async function createRequest(q: Query, input: OneBoxInput, now = new Date()): Promise<{ id: string; reused: boolean }> {
  const again = await q(
    `SELECT id::text FROM social_hub.seed_requests
      WHERE vertical = $1 AND blurb = $2 AND series IS NOT DISTINCT FROM $4 AND link IS NOT DISTINCT FROM $5
        AND status = 'working' AND created_at > $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [input.vertical, input.blurb, new Date(now.getTime() - SAME_BLURB_SECONDS * 1000).toISOString(), input.series ?? null, input.link ?? null],
  );
  if (again.rows[0]) return { id: again.rows[0].id as string, reused: true };
  if ((await workingCount(q, now)) >= MAX_WORKING) throw new Error('Three seeds are already being worked on; wait for one to finish.');
  const { rows } = await q(
    `INSERT INTO social_hub.seed_requests (vertical, series, blurb, link, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz) RETURNING id::text`,
    [input.vertical, input.series ?? null, input.blurb, input.link ?? null, now.toISOString()],
  );
  return { id: rows[0]!.id as string, reused: false };
}

/** Move a running request to a stage, adding the spend so far. */
export async function setStage(q: Query, id: string, stage: Stage, costUsd = 0, now = new Date()): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET stage = $2, cost_usd = $3, updated_at = $4::timestamptz WHERE id = $1::uuid AND status = 'working'`, [id, stage, costUsd, now.toISOString()]);
}

export async function failRequest(q: Query, id: string, message: string, costUsd: number): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET status = 'failed', message = $2, cost_usd = $3, updated_at = now() WHERE id = $1::uuid`, [id, message, costUsd]);
}

export async function doneRequest(q: Query, id: string, ideaId: string | null, costUsd: number): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET status = 'done', idea_id = $2, cost_usd = $3, message = NULL, updated_at = now() WHERE id = $1::uuid`, [id, ideaId, costUsd]);
}

export async function dismissRequest(q: Query, id: string): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET dismissed_at = now() WHERE id = $1::uuid`, [id]);
}

/** The placeholder cards for one pool: running requests, and failed (or stale) ones nobody has dismissed. */
export async function listCards(q: Query, vertical: string, now = new Date()): Promise<Card[]> {
  const { rows } = await q(
    `SELECT id::text, vertical, blurb, status, stage, message, created_at::text AS created_at, updated_at
       FROM social_hub.seed_requests
      WHERE vertical = $1 AND status <> 'done' AND dismissed_at IS NULL
      ORDER BY created_at DESC LIMIT 20`,
    [vertical],
  );
  const cutoff = now.getTime() - STALE_MINUTES * 60_000;
  return rows.map((r): Card => {
    const stale = r.status === 'working' && new Date(r.updated_at).getTime() <= cutoff;
    const status = stale ? 'failed' : (r.status as 'working' | 'failed');
    const message = stale ? (r.stage === 'filing' ? 'This may have been added; check the queue.' : 'Timed out; nothing was added.') : (r.message as string | null);
    return { id: r.id, vertical: r.vertical, blurb: r.blurb, status, stage: r.stage, message, createdAt: r.created_at };
  });
}
