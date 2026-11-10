/**
 * The used-photo guard (CI-32) for finders whose candidates carry no perceptual hash (the Stories / LFD web finder,
 * the carousel design path, an article's lead image). The URL check is free and always applies; a final pick that
 * isn't a brand asset is also downloaded (or its already-downloaded bytes reused), hashed, and checked against the
 * ledger's pHashes and dHashes. A hit gives way to the next candidate, or re-asks the finder with that URL excluded,
 * at most GUARD_RETRIES times; past that the slot gets no photo (today's behaviour for an empty slot).
 *
 * A download or hash failure never blocks a pick: the URL check has already passed.
 */
import type { Query } from '@/lib/social/store/pg';

import { EMPTY_LEDGER, hashesOf, isBrandAsset, readUsedLedger, usedMatch, type UsedLedger } from './used';

/** Hash hits a pick may give way to before the slot goes without a photo. */
export const GUARD_RETRIES = 2;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024;

export type GuardDeps = {
  /** Downloads a pick's bytes. Absent: no download, so only the URL (and any hash the pick carries) is checked. */
  http?: typeof fetch;
  /** Both hashes of an image's bytes (default hashesOf). */
  hash?: (bytes: Buffer) => Promise<{ phash: string; dhash: string }>;
};

/** What the guard needs to know about a pick. `kind` marks a brand asset (logo, meme template, cutout). */
export type GuardView = { url: string; kind?: string | null; bytes?: Buffer | null; phash?: string | null; dhash?: string | null };

/** One read shared by every caller of the returned loader; a failed read is tried again on the next call. */
export function memoLedger(load: () => Promise<UsedLedger>): () => Promise<UsedLedger> {
  let pending: Promise<UsedLedger> | null = null;
  return () => {
    pending ??= load().catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

/** The ledger from a query function, as of now. */
export const ledgerFrom = (query: Query, now: () => Date = () => new Date()) => () => readUsedLedger(query, now());

/**
 * The ledger on the hub's database (lib/db.ts, DATABASE_URL), read fresh on every call (callers memoize per post).
 * No database configured: the empty ledger.
 */
export function liveUsedLedger(env: NodeJS.ProcessEnv = process.env): () => Promise<UsedLedger> {
  return async () => {
    if (!env.DATABASE_URL?.trim() && !env.DIRECT_DATABASE_URL?.trim()) return EMPTY_LEDGER;
    const { dbQuery } = await import('@/lib/db');
    return readUsedLedger((text, params) => dbQuery(text, params), new Date());
  };
}

async function download(url: string, http: typeof fetch): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const res = await http(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length && bytes.length <= MAX_BYTES ? bytes : null;
}

/** Why the ledger refuses this pick, or null when it may be used. Brand assets are exempt. */
export async function usedReason(ledger: UsedLedger, pick: GuardView, deps: GuardDeps = {}): Promise<string | null> {
  if (isBrandAsset(pick.kind)) return null;
  const known = usedMatch(ledger, { url: pick.url, phash: pick.phash, dhash: pick.dhash });
  if (known) return known;
  // Nothing hashed in the window, or both hashes already checked: no download needed.
  if (!ledger.phashes.length && !ledger.dhashes.length) return null;
  if (pick.phash && pick.dhash) return null;
  try {
    const bytes = pick.bytes ?? (deps.http ? await download(pick.url, deps.http) : null);
    if (!bytes) return null;
    return usedMatch(ledger, await (deps.hash ?? hashesOf)(bytes));
  } catch {
    return null;
  }
}

/**
 * The first candidate, in order, the ledger doesn't refuse. A URL hit is skipped for free; a hash hit counts, and
 * after 1 + GUARD_RETRIES hash checks have hit, the slot gets null. `notes` receives one line per refusal.
 */
export async function firstUnused<T>(
  cands: readonly T[],
  view: (c: T) => GuardView,
  ledger: UsedLedger,
  deps: GuardDeps = {},
  notes?: string[],
): Promise<T | null> {
  let hits = 0;
  for (const c of cands) {
    const v = view(c);
    const byUrl = isBrandAsset(v.kind) ? null : usedMatch(ledger, { url: v.url });
    if (byUrl) {
      notes?.push(`used-photo ledger: ${v.url} ${byUrl}`);
      continue;
    }
    const why = await usedReason(ledger, v, deps);
    if (!why) return c;
    notes?.push(`used-photo ledger: ${v.url} ${why}`);
    if (++hits > GUARD_RETRIES) return null;
  }
  return null;
}

/**
 * A finder whose candidates the caller can't see: its pick is checked, and on a hit the finder runs again with that
 * URL added to `exclude`, at most GUARD_RETRIES times; then null.
 */
export async function guardPick<T>(
  find: (exclude: ReadonlySet<string>) => Promise<T | null>,
  view: (pick: T) => GuardView,
  ledger: UsedLedger,
  opts: GuardDeps & { exclude?: ReadonlySet<string>; notes?: string[] } = {},
): Promise<T | null> {
  const exclude = new Set(opts.exclude ?? []);
  for (let attempt = 0; attempt <= GUARD_RETRIES; attempt++) {
    const pick = await find(exclude);
    if (!pick) return null;
    const v = view(pick);
    const why = await usedReason(ledger, v, opts);
    if (!why) return pick;
    opts.notes?.push(`used-photo ledger: ${v.url} ${why}${attempt < GUARD_RETRIES ? '; asked again without it' : '; no photo for this slot'}`);
    exclude.add(v.url);
  }
  return null;
}
