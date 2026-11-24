import type { Query } from '@/lib/social/store/pg';

import { RUNNER, type OneBoxInput, type SeedVerticalKey, type Stage } from './types';

/**
 * The one-box seed requests (design 2026-11-04-one-box-seeding-design, section 2): one row per click, so a placeholder card can
 * show progress and, when it stops, why. Staleness is decided when the cards are read, not by a writer: a request nobody has
 * touched for STALE_MINUTES shows as failed (or "may have been added" if it died while filing).
 */

export const STALE_MINUTES = 6;
export const MAX_WORKING = 3;
export const SAME_BLURB_SECONDS = 60;
export const QUEUED_MAX_MINUTES = 120;
export const STALE_MINUTES_ROA = 10;
const WAITING_BUSY_MINUTES = 1;

const staleMinutesFor = (vertical: string) => (vertical === 'real_or_ai' ? STALE_MINUTES_ROA : STALE_MINUTES);

export type Card = {
  id: string;
  vertical: string;
  blurb: string;
  status: 'working' | 'failed' | 'done';
  stage: string;
  message: string | null;
  createdAt: string;
  /** Queued for a worker and unclaimed: the card may offer Cancel. */
  cancellable: boolean;
};

const staleBefore = (now: Date) => new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();

/** How many requests are genuinely still running (stale ones do not count; a request waiting in a worker's queue does not either). */
export async function workingCount(q: Query, now = new Date()): Promise<number> {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM social_hub.seed_requests
      WHERE status = 'working' AND updated_at > $1::timestamptz AND (runner = 'vercel' OR stage <> 'queued')`,
    [staleBefore(now)],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Open a request. The same blurb in the same pool inside a minute is the first click (`reused`); a fourth running request is refused. */
export async function createRequest(q: Query, input: OneBoxInput, now = new Date()): Promise<{ id: string; reused: boolean }> {
  const again = await q(
    `SELECT id::text FROM social_hub.seed_requests
      WHERE vertical = $1 AND blurb = $2 AND link IS NOT DISTINCT FROM $4
        AND status = 'working' AND created_at > $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [input.vertical, input.blurb, new Date(now.getTime() - SAME_BLURB_SECONDS * 1000).toISOString(), input.link ?? null],
  );
  if (again.rows[0]) return { id: again.rows[0].id as string, reused: true };
  if ((await workingCount(q, now)) >= MAX_WORKING) throw new Error('Three seeds are already being worked on; wait for one to finish.');
  const { rows } = await q(
    `INSERT INTO social_hub.seed_requests (vertical, blurb, link, runner, created_at, updated_at)
     VALUES ($1, $2, $3, $5, $4::timestamptz, $4::timestamptz) RETURNING id::text`,
    [input.vertical, input.blurb, input.link ?? null, now.toISOString(), RUNNER[input.vertical]],
  );
  return { id: rows[0]!.id as string, reused: false };
}

/** Move a running request to a stage, adding the spend so far. */
export async function setStage(q: Query, id: string, stage: Stage, costUsd = 0, now = new Date()): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET stage = $2, cost_usd = $3, updated_at = $4::timestamptz WHERE id = $1::uuid AND status = 'working'`, [id, stage, costUsd, now.toISOString()]);
}

/**
 * A worker takes the oldest queued request for its runner. A request that has waited longer than QUEUED_MAX_MINUTES is never
 * returned (its card reads as failed). SKIP LOCKED lets two workers race without taking the same row.
 */
export async function claimRequest(q: Query, runner: 'stories' | 'drama', now = new Date()): Promise<{ id: string; input: OneBoxInput } | null> {
  const oldest = new Date(now.getTime() - QUEUED_MAX_MINUTES * 60_000).toISOString();
  const { rows } = await q(
    `UPDATE social_hub.seed_requests SET stage = 'claimed', claimed_at = $3::timestamptz, updated_at = $3::timestamptz
      WHERE id = (
        SELECT id FROM social_hub.seed_requests
         WHERE runner = $1 AND status = 'working' AND stage = 'queued' AND dismissed_at IS NULL AND created_at > $2::timestamptz
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id::text, vertical, blurb, link`,
    [runner, oldest, now.toISOString()],
  );
  const r = rows[0];
  if (!r) return null;
  const input: OneBoxInput = { vertical: r.vertical as SeedVerticalKey, blurb: r.blurb as string, ...(r.link ? { link: r.link as string } : {}) };
  return { id: r.id as string, input };
}

/** Cancel a request nobody has claimed yet. False when it is no longer queued. */
export async function cancelRequest(q: Query, id: string, now = new Date()): Promise<boolean> {
  const { rows } = await q(
    `UPDATE social_hub.seed_requests SET status = 'failed', message = 'Cancelled; nothing was spent.', dismissed_at = $2::timestamptz, updated_at = $2::timestamptz
      WHERE id = $1::uuid AND status = 'working' AND stage = 'queued' AND runner <> 'vercel' RETURNING id`,
    [id, now.toISOString()],
  );
  return rows.length > 0;
}

export async function failRequest(q: Query, id: string, message: string, costUsd: number): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET status = 'failed', message = $2, cost_usd = $3, updated_at = now() WHERE id = $1::uuid`, [id, message, costUsd]);
}

/** Done. `message` (optional) says what the card should still note, e.g. half of a Real or AI? twin that did not pass. */
export async function doneRequest(q: Query, id: string, ideaId: string | null, costUsd: number, message: string | null = null): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET status = 'done', idea_id = $2, cost_usd = $3, message = $4, updated_at = now() WHERE id = $1::uuid`, [id, ideaId, costUsd, message]);
}

export async function dismissRequest(q: Query, id: string): Promise<void> {
  await q(`UPDATE social_hub.seed_requests SET dismissed_at = now() WHERE id = $1::uuid`, [id]);
}

type Row = { status: string; stage: string; runner: string; vertical: string; message: string | null; created_ts: string | Date; updated_at: string | Date };

/** What a request looks like right now. The one place that decides "still running?", shared by the cards and by cancel/dismiss. */
export function cardState(r: Row, now: Date): { status: 'working' | 'failed' | 'done'; message: string | null; running: boolean } {
  if (r.status === 'working' && r.stage === 'queued' && r.runner !== 'vercel') {
    const waited = now.getTime() - new Date(r.created_ts).getTime();
    if (waited > QUEUED_MAX_MINUTES * 60_000) return { status: 'failed', message: "The worker didn't pick this up; nothing was spent.", running: false };
    return { status: 'working', message: waited > WAITING_BUSY_MINUTES * 60_000 ? "Waiting: the worker is busy with tonight's run" : 'Waiting for the worker', running: true };
  }
  const stale = r.status === 'working' && new Date(r.updated_at).getTime() <= now.getTime() - staleMinutesFor(r.vertical) * 60_000;
  if (stale) return { status: 'failed', message: r.stage === 'filing' ? 'This may have been added; check the queue.' : 'Timed out; nothing was added.', running: false };
  return { status: r.status as 'working' | 'failed' | 'done', message: r.message, running: r.status === 'working' };
}

/** The Dismiss / Cancel button: cancels a request still queued for a worker, dismisses one that has stopped, refuses one genuinely running. */
export async function cancelOrDismiss(q: Query, id: string, now = new Date()): Promise<'cancelled' | 'dismissed' | 'running' | 'missing'> {
  const { rows } = await q(
    `SELECT status, stage, runner, vertical, message, created_at AS created_ts, updated_at FROM social_hub.seed_requests WHERE id = $1::uuid`,
    [id],
  );
  if (!rows[0]) return 'missing';
  const state = cardState(rows[0] as Row, now);
  if (state.running) {
    if (await cancelRequest(q, id, now)) return 'cancelled';
    return 'running';
  }
  await dismissRequest(q, id);
  return 'dismissed';
}

/** The placeholder cards for one pool: running requests, failed (or stale) ones, and done ones that carry a note, until dismissed. */
export async function listCards(q: Query, vertical: string, now = new Date()): Promise<Card[]> {
  const { rows } = await q(
    `SELECT id::text, vertical, blurb, status, stage, runner, message, created_at::text AS created_at, created_at AS created_ts, updated_at
       FROM social_hub.seed_requests
      WHERE vertical = $1 AND dismissed_at IS NULL AND (status <> 'done' OR message IS NOT NULL)
      ORDER BY created_at DESC LIMIT 20`,
    [vertical],
  );
  return rows.map((r): Card => {
    const { status, message, running } = cardState(r as Row, now);
    const cancellable = running && r.stage === 'queued' && r.runner !== 'vercel';
    return { id: r.id as string, vertical: r.vertical as string, blurb: r.blurb as string, stage: r.stage as string, createdAt: r.created_at as string, status, message, cancellable };
  });
}
