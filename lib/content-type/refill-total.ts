/**
 * The nightly total of all idea-pool refills (settings standard D19). Each type's refill keeps its own cap
 * (pool_refill_cap_usd); on top of that, every refill in one New York day shares one total
 * (social_hub.settings `refill_total_cap_usd`, default $5). Render and make-step spend is not counted here.
 *
 * Ledger: social_hub.refill_spend (db/settings_standard_states.sql). A refill
 *  1. begins: it reserves its cap, cut to what is left of the night's total. Nothing left: it is skipped and logs
 *     `refill_total_capped`; it runs again the next night.
 *  2. settles: its reservation is replaced by what it really spent.
 * An unsettled reservation (a crashed run) keeps counting at its reserved amount, so a crash can only make the
 * night stricter. Refills that begin at the same moment can together pass the total by at most one refill's cap.
 *
 * Fails open: if the ledger can't be read (e.g. the migration isn't applied), the refill runs on its own cap alone
 * and logs `refill_total_unread`. The per-type caps still bound it.
 */
import { calendarDateKey } from '@/lib/instagram/clock';
import { refillTotalUsd } from '@/lib/content-type/state';

export type TotalQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
export type TotalLog = (message: string, fields?: Record<string, unknown>) => void;

/** A refill that may run: its cap for tonight and its ledger row (null when the ledger couldn't be written). */
export type RefillGrant = { capUsd: number; id: string | null; nyDate: string };

/** Smallest refill worth starting: below this, what's left of the total is treated as spent. */
export const MIN_REFILL_USD = 0.01;

/** The night a refill counts toward (New York date). */
export function refillNight(now: Date = new Date()): string {
  return calendarDateKey(now);
}

/** Pure: a refill's cap for tonight, or null when the total has no room. */
export function allowance(capUsd: number, totalUsd: number, spentTonightUsd: number): number | null {
  const left = Math.max(0, totalUsd - Math.max(0, spentTonightUsd));
  const cap = Math.min(capUsd, left);
  return cap >= MIN_REFILL_USD ? Math.round(cap * 1e6) / 1e6 : null;
}

/** The stored nightly total, or the default. */
export async function readRefillTotalUsd(q: TotalQuery): Promise<number> {
  const { rows } = await q(`SELECT value FROM social_hub.settings WHERE key = 'refill_total_cap_usd'`);
  return refillTotalUsd(rows[0]?.value);
}

/** Change the nightly total (a person's decision, Social Hub Cost page). */
export const MAX_REFILL_TOTAL_USD = 50;
export async function writeRefillTotalUsd(q: TotalQuery, usd: number): Promise<number> {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > MAX_REFILL_TOTAL_USD) {
    throw new Error(`The nightly refill total is a dollar amount above $0 and at most $${MAX_REFILL_TOTAL_USD}.`);
  }
  await q(
    `INSERT INTO social_hub.settings (key, value, updated_at) VALUES ('refill_total_cap_usd', to_jsonb($1::numeric), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [usd],
  );
  return usd;
}

/** What tonight's refills have used: settled spend plus open reservations. */
export async function spentTonightUsd(q: TotalQuery, nyDate: string): Promise<number> {
  const { rows } = await q(`SELECT coalesce(sum(coalesce(spent_usd, reserved_usd)), 0)::float8 AS usd FROM social_hub.refill_spend WHERE ny_date = $1::date`, [nyDate]);
  return Number(rows[0]?.usd ?? 0);
}

/**
 * Begin a refill under the nightly total. Returns null when the total has no room left (logged
 * `refill_total_capped`); the caller skips the refill. A person's own run is not held to the total: don't call this
 * for it.
 */
export async function beginRefill(
  q: TotalQuery,
  type: string,
  capUsd: number,
  o: { ref?: string | null; log?: TotalLog; now?: Date } = {},
): Promise<RefillGrant | null> {
  const nyDate = refillNight(o.now);
  let totalUsd: number;
  let spent: number;
  try {
    totalUsd = await readRefillTotalUsd(q);
    spent = await spentTonightUsd(q, nyDate);
  } catch (error) {
    o.log?.('refill_total_unread', { type, error: error instanceof Error ? error.message : String(error) });
    return { capUsd, id: null, nyDate };
  }
  const cap = allowance(capUsd, totalUsd, spent);
  if (cap == null) {
    o.log?.('refill_total_capped', { type, totalUsd, spentTonightUsd: Number(spent.toFixed(4)), nyDate });
    return null;
  }
  try {
    const { rows } = await q(
      `INSERT INTO social_hub.refill_spend (ny_date, vertical, reserved_usd, ref) VALUES ($1::date, $2, $3, $4) RETURNING id::text AS id`,
      [nyDate, type, cap, o.ref ?? null],
    );
    return { capUsd: cap, id: rows[0]?.id ?? null, nyDate };
  } catch (error) {
    o.log?.('refill_total_unread', { type, error: error instanceof Error ? error.message : String(error) });
    return { capUsd: cap, id: null, nyDate };
  }
}

/** Settle a refill: its reservation becomes what it spent. Never throws (the refill's own work already happened). */
export async function settleRefill(q: TotalQuery, grant: RefillGrant | null, spentUsd: number, log?: TotalLog): Promise<void> {
  if (!grant?.id) return;
  try {
    await q(`UPDATE social_hub.refill_spend SET spent_usd = $2, settled_at = now() WHERE id = $1::bigint`, [grant.id, Math.max(0, Number(spentUsd) || 0)]);
  } catch (error) {
    log?.('refill_total_settle_failed', { id: grant.id, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * For a refill that only knows whether it ran after the fact (Morning Download's pool refresh, which runs when due):
 * the cap it may use tonight without reserving (null: no room), then `recordRefill` once it spent something.
 */
export async function peekRefill(q: TotalQuery, type: string, capUsd: number, o: { log?: TotalLog; now?: Date } = {}): Promise<number | null> {
  const nyDate = refillNight(o.now);
  try {
    return allowance(capUsd, await readRefillTotalUsd(q), await spentTonightUsd(q, nyDate));
  } catch (error) {
    o.log?.('refill_total_unread', { type, error: error instanceof Error ? error.message : String(error) });
    return capUsd;
  }
}

/** Record a finished refill's spend in tonight's ledger. Never throws. */
export async function recordRefill(q: TotalQuery, type: string, spentUsd: number, o: { ref?: string | null; log?: TotalLog; now?: Date } = {}): Promise<void> {
  const usd = Math.max(0, Number(spentUsd) || 0);
  if (usd <= 0) return;
  try {
    await q(
      `INSERT INTO social_hub.refill_spend (ny_date, vertical, reserved_usd, spent_usd, ref, settled_at) VALUES ($1::date, $2, $3, $3, $4, now())`,
      [refillNight(o.now), type, usd, o.ref ?? null],
    );
  } catch (error) {
    o.log?.('refill_total_settle_failed', { type, error: error instanceof Error ? error.message : String(error) });
  }
}
