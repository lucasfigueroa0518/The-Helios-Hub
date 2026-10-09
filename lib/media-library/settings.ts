/**
 * The photo bank's switches (media_library.settings; DECISIONS_LOG D49).
 * Both start OFF and are flipped with SQL. A missing schema reads as
 * everything off, so code shipped before the schema is applied does nothing.
 */
import type { FinderSourceMode, Query } from './types';

export type BankSettings = {
  /** The schema is applied. */
  present: boolean;
  /** Store vetted photos from finder runs. */
  capture: boolean;
  /** The bank as a finder source. */
  finderSource: FinderSourceMode;
  /** The last social.used_photos id imported. */
  usedPhotosAfterId: number;
};

export const SETTINGS_OFF: BankSettings = { present: false, capture: false, finderSource: 'off', usedPhotosAfterId: 0 };

const MODES: FinderSourceMode[] = ['off', 'compete', 'first'];

export async function loadBankSettings(query: Query): Promise<BankSettings> {
  const exists = await query(`SELECT to_regclass('media_library.settings') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return SETTINGS_OFF;
  const { rows } = await query(`SELECT key, value FROM media_library.settings`);
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const mode = value('finder_source');
  const after = Number(value('used_photos_after_id'));
  return {
    present: true,
    capture: value('capture') === true || value('capture') === 'true',
    finderSource: MODES.includes(mode) ? mode : 'off',
    usedPhotosAfterId: Number.isFinite(after) && after > 0 ? Math.floor(after) : 0,
  };
}

/**
 * Settings read at most once per `ttlMs` (a one-shot run reads them once; a
 * long-running worker picks up a flipped switch within the TTL). A failed
 * read counts as everything off.
 */
export function cachedBankSettings(query: Query, opts: { ttlMs?: number; now?: () => number; onError?: (err: unknown) => void } = {}): () => Promise<BankSettings> {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  let cached: { at: number; value: Promise<BankSettings> } | null = null;
  return () => {
    if (!cached || now() - cached.at > ttl) {
      cached = {
        at: now(),
        value: loadBankSettings(query).catch((err) => {
          opts.onError?.(err);
          return SETTINGS_OFF;
        }),
      };
    }
    return cached.value;
  };
}
