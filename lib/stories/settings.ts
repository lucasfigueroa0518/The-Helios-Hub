/**
 * Stories settings (plan §4, §8). Defaults live here; a row in
 * stories.settings overrides one key. Every series starts with its auto
 * switch off (S-05): Lucas reviews the first sets, then flips it.
 *
 * Stories Split (SS-1, planning/Stories Split/CONTRACT.md §3 B): each Stories-format content type (Morning Download
 * `stories`, `ai_trivia`, `real_or_ai`) has its own approval, publishing-live and daily-cap switches, in the `types`
 * row. The old engine-wide rows (`publishing_live`, `daily_cap_usd`) are every type's fallback,
 * so a database that has only them behaves as before; the first per-type save writes all three types out. The
 * monthly watch and the models stay engine-wide.
 *
 * Settings standard (D16): approval is always required, so `require_approval` (engine-wide or per type) is read as
 * true whatever is stored. Each type's refill cap (D14) is `types[<type>].refill_cap_usd`.
 */
import type { Queryable } from '@/lib/stories/db';
import { SERIES_STYLE, type Series, type Style } from '@/lib/stories/render/types';
import { STORY_VERTICALS, verticalOfSeries, type StoryVertical } from '@/lib/social-hub/story-types';

/**
 * The series a person or the worker can request. Guess the Number (AT-14) and Free vs. Paid (replaced by Real or AI?,
 * planning/Real or AI/CONTRACT.md §1) are retired: their settings and history stay.
 */
export const SERIES: Series[] = ['morning_download', 'ai_trivia', 'real_or_ai'];

/** A posting window in America/New_York (S-20); days are 0 = Sunday … 6 = Saturday. */
export type PostingWindow = { start: string; end: string; days: number[] };

export type SeriesSettings = { enabled: boolean; auto: boolean; style: Style; window: PostingWindow };

/** One Stories-format content type's own switches (SS-1). */
export type TypeSettings = {
  /**
   * Every post needs a person's approval (settings standard D16): always true. Kept so older readers compile;
   * a stored false is read as true and can't be saved.
   */
  requireApproval: boolean;
  /** Master switch: the worker schedules and publishes the type's sets only while it is on. Off until a person turns it on. */
  publishingLive: boolean;
  /** Checked before each of the type's builds per New York day (docs/social-overnight.md); a set costs ~$0.08–0.45. */
  dailyCapUsd: number;
  /**
   * The spend cap of one pool refill (D14), stored as `types[<type>].refill_cap_usd`. Null when unset: read it
   * with refillCapUsd(type, value) from lib/content-type/state.ts for the default.
   */
  refillCapUsd: number | null;
};

export type StoriesSettings = {
  series: Record<Series, SeriesSettings>;
  /** Each Stories-format type's switches (SS-1); read with typeSettings. */
  types: Record<StoryVertical, TypeSettings>;
  /** Checked before each build, like the reels watch (D-023); at or over it, a build is skipped. Engine-wide. */
  monthlyWatchUsd: number;
  models: { copy: string; review: string };
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Today's engine-wide defaults, now each type's: approval on, publishing off, $2 a day, the default refill cap. */
const DEFAULT_TYPE: TypeSettings = { requireApproval: true, publishingLive: false, dailyCapUsd: 2, refillCapUsd: null };

/** Every series posts in the morning, 8:30–10:00 AM; Stories may share the hour with other content types (Tommy, 2026-10-08). */
const MORNING = { start: '08:30', end: '10:00' };

export const DEFAULT_SETTINGS: StoriesSettings = {
  series: {
    morning_download: { enabled: true, auto: false, style: SERIES_STYLE.morning_download, window: { ...MORNING, days: EVERY_DAY } },
    // Retired (AT-14): never requested again; the row stays so its history reads.
    guess_the_number: { enabled: false, auto: false, style: SERIES_STYLE.guess_the_number, window: { ...MORNING, days: [1, 4] } },
    // Retired (Real or AI? replaces it): never requested again; the row stays so its history reads.
    free_vs_paid: { enabled: false, auto: false, style: SERIES_STYLE.free_vs_paid, window: { ...MORNING, days: [2, 6] } },
    // AT-13: AI Trivia Sunday, Monday and Thursday.
    ai_trivia: { enabled: true, auto: false, style: SERIES_STYLE.ai_trivia, window: { ...MORNING, days: [0, 1, 4] } },
    // RA-10: Real or AI? takes Free vs. Paid's Tuesday and Saturday slot.
    real_or_ai: { enabled: true, auto: false, style: SERIES_STYLE.real_or_ai, window: { ...MORNING, days: [2, 6] } },
  },
  types: Object.fromEntries(STORY_VERTICALS.map((v) => [v, { ...DEFAULT_TYPE }])) as Record<StoryVertical, TypeSettings>,
  monthlyWatchUsd: 25,
  // S-21: the latest Sonnet writes copy; S-33: Haiku 5.5 reviews renders.
  models: { copy: 'claude-sonnet-5-5', review: 'claude-haiku-5-5' },
};

type SettingKey = 'series' | 'types' | 'monthly_watch_usd' | 'daily_cap_usd' | 'models' | 'require_approval' | 'publishing_live';

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * One type's stored switches over a base; a value of the wrong kind is ignored. Approval is always required (D16).
 * The refill cap is read from the stored `refill_cap_usd` (contract §3) or a patch's `refillCapUsd`.
 */
function mergeType(base: TypeSettings, raw: unknown): TypeSettings {
  if (!raw || typeof raw !== 'object') return { ...base, requireApproval: true };
  const v = raw as Partial<Record<keyof TypeSettings | 'refill_cap_usd', unknown>>;
  const refill = v.refillCapUsd !== undefined ? v.refillCapUsd : v.refill_cap_usd;
  return {
    requireApproval: true,
    publishingLive: typeof v.publishingLive === 'boolean' ? v.publishingLive : base.publishingLive,
    dailyCapUsd: positive(v.dailyCapUsd) ? v.dailyCapUsd : base.dailyCapUsd,
    refillCapUsd: positive(refill) ? refill : base.refillCapUsd,
  };
}

/** A type's switches as stored in the `types` row: the refill cap under its contract key, `refill_cap_usd`. */
function storedType(t: TypeSettings): Record<string, unknown> {
  return { requireApproval: true, publishingLive: t.publishingLive, dailyCapUsd: t.dailyCapUsd, ...(t.refillCapUsd != null ? { refill_cap_usd: t.refillCapUsd } : {}) };
}

export async function loadSettings(db: Queryable): Promise<StoriesSettings> {
  const { rows } = await db.query<{ key: SettingKey; value: unknown }>(`SELECT key, value FROM stories.settings`);
  const out: StoriesSettings = structuredClone(DEFAULT_SETTINGS);
  // The old engine-wide switches are every type's fallback (SS-1); a `types` row overrides them per type.
  const fallback: TypeSettings = { ...DEFAULT_TYPE };
  let types: unknown = null;
  for (const { key, value } of rows) {
    if (key === 'series' && value && typeof value === 'object') {
      for (const s of SERIES) {
        const v = (value as Partial<Record<Series, Partial<SeriesSettings>>>)[s];
        if (v) out.series[s] = { ...out.series[s], ...v, window: { ...out.series[s].window, ...(v.window ?? {}) } };
      }
    } else if (key === 'monthly_watch_usd' && typeof value === 'number' && value > 0) {
      out.monthlyWatchUsd = value;
    } else if (key === 'daily_cap_usd' && typeof value === 'number' && value > 0) {
      fallback.dailyCapUsd = value;
    } else if (key === 'publishing_live' && typeof value === 'boolean') {
      fallback.publishingLive = value;
    } else if (key === 'types' && value && typeof value === 'object') {
      types = value;
    } else if (key === 'models' && value && typeof value === 'object') {
      out.models = { ...out.models, ...(value as Partial<StoriesSettings['models']>) };
    }
  }
  for (const v of STORY_VERTICALS) out.types[v] = mergeType(fallback, (types as Partial<Record<StoryVertical, unknown>> | null)?.[v]);
  return out;
}

/** A Stories-format type's switches (SS-1). */
export function typeSettings(settings: Pick<StoriesSettings, 'types'>, vertical: StoryVertical): TypeSettings {
  return settings.types[vertical];
}

/** The switches of the type a series belongs to; retired series read as Morning Download's (`stories`). */
export function seriesTypeSettings(settings: Pick<StoriesSettings, 'types'>, series: string): TypeSettings {
  return typeSettings(settings, verticalOfSeries(series));
}

/**
 * Change one type's switches (SS-1). Writes every type's current values (the fallback included), so the first save
 * moves the old engine-wide rows into `types` and a later change to them no longer reaches any type.
 */
export async function saveTypeSetting(db: Queryable, vertical: StoryVertical, patch: Partial<TypeSettings>, by?: string): Promise<StoriesSettings> {
  // D16: there is no setting that skips a person's approval.
  if (patch.requireApproval !== undefined && patch.requireApproval !== true) throw new Error('Every post needs a person’s approval; that can’t be turned off.');
  if (patch.publishingLive !== undefined && typeof patch.publishingLive !== 'boolean') throw new Error('publishingLive must be true or false.');
  if (patch.dailyCapUsd !== undefined && !positive(patch.dailyCapUsd)) throw new Error('A daily cap is a dollar amount above zero.');
  if (patch.refillCapUsd !== undefined && patch.refillCapUsd !== null && !positive(patch.refillCapUsd)) throw new Error('A refill cap is a dollar amount above zero.');
  const current = await loadSettings(db);
  const types = { ...current.types, [vertical]: mergeType(current.types[vertical], patch) };
  const next = Object.fromEntries(STORY_VERTICALS.map((v) => [v, storedType(types[v])]));
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ('types', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), by ?? null],
  );
  return loadSettings(db);
}

/** Turn a series' auto switch on or off, or enable/disable it (Settings tab, M4). */
export async function saveSeriesSetting(db: Queryable, series: Series, patch: Partial<Pick<SeriesSettings, 'enabled' | 'auto'>> & { days?: number[] }, by?: string): Promise<StoriesSettings> {
  const current = await loadSettings(db);
  const { days, ...rest } = patch;
  const merged = { ...current.series[series], ...rest, ...(days ? { window: { ...current.series[series].window, days } } : {}) };
  const next = { ...current.series, [series]: merged };
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ('series', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), by ?? null],
  );
  return loadSettings(db);
}
