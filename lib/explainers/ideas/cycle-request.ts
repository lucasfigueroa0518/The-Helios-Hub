import type { Queryable } from '@/lib/explainers/db';
import { nyDate } from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';

/**
 * "Run the idea cycle now" (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §7.2). A person's click is
 * stored as the `explainers.settings` row `idea_cycle_request` = `{ at, by }`; it never runs a model
 * inside the web request. The explainers worker polls it, runs `runIdeaCycle({ …, force: true })`
 * once (force bypasses only the `auto_render` gate: the one-cycle-per-day index and the spend caps
 * stay), then clears the row. `loadSettings` ignores the key, so it never shows up as a setting.
 */

export const IDEA_CYCLE_REQUEST_KEY = 'idea_cycle_request';

/** The idea call, scoring and duplicate check when no cycle has run yet (a typical night is well under this). */
export const IDEA_PIPELINE_FALLBACK_USD = 0.25;

export type IdeaCycleRequest = { at: string; by: string | null };

export type IdeaCycleStatus = {
  /** Upper bound: the idea pipeline plus `maxRenders` renders at the per-reel cap. */
  estimateUsd: number;
  /** The most renders one cycle may queue (`daily_render_cap`). */
  maxRenders: number;
  /** A cycle for today's New York date is running or finished ok. */
  ranToday: boolean;
  /** A request is waiting for the worker. */
  requested: boolean;
};

export type IdeaCycleRefusal = 'already_ran' | 'already_requested';

export const IDEA_CYCLE_REFUSAL_TEXT: Record<IdeaCycleRefusal, string> = {
  already_ran: 'Today’s idea cycle already ran.',
  already_requested: 'The idea cycle is already requested. The worker runs it on its next poll.',
};

function parseRequest(value: unknown): IdeaCycleRequest | null {
  const v = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!v || typeof v !== 'object') return null;
  const { at, by } = v as { at?: unknown; by?: unknown };
  if (typeof at !== 'string' || Number.isNaN(new Date(at).getTime())) return null;
  return { at, by: typeof by === 'string' ? by : null };
}

/** The waiting request, or null. A malformed row reads as none (the worker then clears it). */
export async function pendingIdeaCycleRequest(db: Queryable): Promise<IdeaCycleRequest | null> {
  const { rows } = await db.query<{ value: unknown }>('SELECT value FROM explainers.settings WHERE key = $1', [IDEA_CYCLE_REQUEST_KEY]);
  if (!rows[0]) return null;
  try {
    return parseRequest(rows[0].value);
  } catch {
    return null;
  }
}

export async function clearIdeaCycleRequest(db: Queryable): Promise<void> {
  await db.query('DELETE FROM explainers.settings WHERE key = $1', [IDEA_CYCLE_REQUEST_KEY]);
}

async function ranOn(db: Queryable, day: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM explainers.idea_cycles WHERE ny_date = $1::date AND status IN ('running', 'ok') LIMIT 1`,
    [day],
  );
  return rows.length > 0;
}

/** What the confirm states before the click (GET /api/explainers/idea-cycle). */
export async function ideaCycleStatus(db: Queryable, now: Date = new Date()): Promise<IdeaCycleStatus> {
  const [settings, ranToday, pending, history] = await Promise.all([
    loadSettings(db),
    ranOn(db, nyDate(now)),
    pendingIdeaCycleRequest(db),
    db.query<{ usd: unknown }>(
      `SELECT avg(generator_cost_usd + scoring_cost_usd + duplicate_check_cost_usd)::float8 AS usd
         FROM (SELECT generator_cost_usd, scoring_cost_usd, duplicate_check_cost_usd
                 FROM explainers.idea_cycles WHERE status = 'ok' ORDER BY started_at DESC LIMIT 10) recent`,
    ),
  ]);
  const seen = Number(history.rows[0]?.usd);
  const ideaUsd = Number.isFinite(seen) && seen > 0 ? seen : IDEA_PIPELINE_FALLBACK_USD;
  const maxRenders = settings.daily_render_cap;
  return {
    estimateUsd: Math.round((ideaUsd + maxRenders * settings.per_reel_cap_usd) * 100) / 100,
    maxRenders,
    ranToday,
    requested: pending !== null,
  };
}

/**
 * Store a person's request. Refused when today's cycle already ran or a request is waiting. A request
 * left from an earlier New York day (the worker was down) is replaced.
 */
export async function requestIdeaCycle(
  db: Queryable,
  by: string | null,
  now: Date = new Date(),
): Promise<{ ok: true; request: IdeaCycleRequest } | { ok: false; reason: IdeaCycleRefusal }> {
  const today = nyDate(now);
  if (await ranOn(db, today)) return { ok: false, reason: 'already_ran' };
  const pending = await pendingIdeaCycleRequest(db);
  if (pending && nyDate(new Date(pending.at)) === today) return { ok: false, reason: 'already_requested' };
  const request: IdeaCycleRequest = { at: now.toISOString(), by };
  if (pending) await clearIdeaCycleRequest(db);
  // ON CONFLICT DO NOTHING: two clicks at once store one request; the second is told it is waiting.
  const { rows } = await db.query(
    `INSERT INTO explainers.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO NOTHING RETURNING key`,
    [IDEA_CYCLE_REQUEST_KEY, JSON.stringify(request)],
  );
  if (!rows.length) return { ok: false, reason: 'already_requested' };
  return { ok: true, request };
}
