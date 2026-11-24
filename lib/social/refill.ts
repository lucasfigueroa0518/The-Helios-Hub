/**
 * The refill split for the helios-social and helios-stories workers (settings standard, D16; CONTRACT.md §4).
 *
 *  - Refill runs in every state, on the type's cadence, and a full quota never stops it (D3).
 *  - Each refill is held to its own cap (D14, `pool_refill_cap_usd`; Stories types `types[<type>].refill_cap_usd`).
 *    A refill that stops for the cap logs `refill_capped`.
 *  - Making posts follows makesPosts(state). Booking slots follows holdsSlots(state) (Approval and Live, contract
 *    §4.3); posting follows postsToInstagram(state) (Live only, §4.4).
 *  - The state is read with stateOf(generate, publishing_live); Generate off with Live on reads as paused and logs
 *    `state_mismatch`.
 *
 * The workers read the stored keys themselves (SELECT only), so a worker never waits on the hub's posting read.
 * require_approval is not read here at all: every post needs a person (D16).
 */
import { holdsSlots, makesPosts, postsToInstagram, refillCapUsd, stateOf, type TypeState } from '@/lib/content-type/state';
import type { Vertical } from '@/lib/social-hub/types';

export type RefillLog = (message: string, fields?: Record<string, unknown>) => void;

/** One type's state as a worker acts on it. */
export type TypeGate = {
  type: Vertical;
  state: TypeState;
  /** Stored Generate off with Live on (reads as paused). */
  mismatch: boolean;
  /** The cap one refill is held to (D14). */
  refillCapUsd: number;
  /** makesPosts(state): the night may make posts (the quota still applies). */
  makes: boolean;
  /** holdsSlots(state): approved posts may be booked into slots (Approval and Live; contract §4.3, D17). */
  holds: boolean;
  /** postsToInstagram(state): due approved posts may be released and posted (Live only). */
  posts: boolean;
};

const truthy = (v: unknown) => v === true || v === 'true';

/** How long a repeated `state_mismatch` stays quiet: the poll loops read the state every 15 seconds. */
export const MISMATCH_LOG_EVERY_MS = 60 * 60_000;
const lastMismatch = new Map<string, number>();

/** The gate from stored values (pure apart from the mismatch log). A missing value is off (D6). */
export function typeGate(type: Vertical, stored: { generate: unknown; live: unknown; refillCap?: unknown }, log?: RefillLog, now = Date.now()): TypeGate {
  const { state, mismatch } = stateOf(truthy(stored.generate), truthy(stored.live));
  if (mismatch && log) {
    const last = lastMismatch.get(type);
    if (last === undefined || now - last >= MISMATCH_LOG_EVERY_MS) {
      lastMismatch.set(type, now);
      log('state_mismatch', { type, generate: false, publishingLive: true, readsAs: state });
    }
  }
  return { type, state, mismatch, refillCapUsd: refillCapUsd(type, stored.refillCap), makes: makesPosts(state), holds: holdsSlots(state), posts: postsToInstagram(state) };
}

/** Forget the mismatch log times (tests). */
export function resetMismatchLog(): void {
  lastMismatch.clear();
}

type SettingsTable = { table: string; generate: string };

/** The key/value settings table and Generate key of each type the helios-social worker runs (contract §3). */
export const SOCIAL_SETTINGS: Partial<Record<Vertical, SettingsTable>> = {
  carousels: { table: 'social.settings', generate: 'auto_run' },
  last_few_days: { table: 'lfd.settings', generate: 'auto_run' },
  ai_events: { table: 'ai_events.settings', generate: 'auto_run' },
  field_notes: { table: 'field_notes.settings', generate: 'auto_run' },
};

export type GateQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/**
 * A helios-social type's gate from its settings table (one SELECT). A read that fails reads as paused with the
 * default refill cap: nothing is made or posted, and refill still runs (D3, D6).
 */
export async function readTypeGate(q: GateQuery, type: Vertical, log?: RefillLog): Promise<TypeGate> {
  const t = SOCIAL_SETTINGS[type];
  if (!t) throw new Error(`readTypeGate: ${type} is not a helios-social type`);
  try {
    const { rows } = await q(`SELECT key, value FROM ${t.table} WHERE key = ANY($1::text[])`, [[t.generate, 'publishing_live', 'pool_refill_cap_usd']]);
    const get = (key: string) => (rows as Array<{ key: string; value: unknown }>).find((r) => r.key === key)?.value;
    return typeGate(type, { generate: get(t.generate), live: get('publishing_live'), refillCap: get('pool_refill_cap_usd') }, log);
  } catch (error) {
    log?.('state_read_failed', { type, error: error instanceof Error ? error.message : String(error) });
    return typeGate(type, { generate: false, live: false });
  }
}

/** A Stories-format type's stored refill cap, `stories.settings.types[<type>].refill_cap_usd` (read raw; missing: the default). */
export async function readStoriesRefillCap(q: GateQuery, type: Vertical): Promise<number> {
  try {
    const { rows } = await q(`SELECT value FROM stories.settings WHERE key = 'types'`);
    const raw = rows[0]?.value;
    const types = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, { refill_cap_usd?: unknown } | undefined> | null;
    return refillCapUsd(type, types?.[type]?.refill_cap_usd);
  } catch {
    return refillCapUsd(type, undefined);
  }
}

/** The one line every refill writes when it stops for its cap. */
export function logRefillCapped(log: RefillLog, type: Vertical, fields: { capUsd: number; spentUsd?: number; step: string } & Record<string, unknown>): void {
  log('refill_capped', { type, ...fields });
}
