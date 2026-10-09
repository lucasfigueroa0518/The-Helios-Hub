/**
 * Stories settings (plan §4, §8). Defaults live here; a row in
 * stories.settings overrides one key. Every series starts with its auto
 * switch off (S-05): Lucas reviews the first sets, then flips it.
 */
import type { Queryable } from '@/lib/stories/db';
import { SERIES_STYLE, type Series, type Style } from '@/lib/stories/render/types';

export const SERIES: Series[] = ['morning_download', 'guess_the_number', 'free_vs_paid'];

/** A posting window in America/New_York (S-20); days are 0 = Sunday … 6 = Saturday. */
export type PostingWindow = { start: string; end: string; days: number[] };

export type SeriesSettings = { enabled: boolean; auto: boolean; style: Style; window: PostingWindow };

export type StoriesSettings = {
  series: Record<Series, SeriesSettings>;
  /**
   * Every content type needs a person's approval before it posts (Tommy,
   * 2026-10-08, docs/social-overnight.md). While on, an auto set stops at
   * `ready` for the Approve button instead of approving itself.
   */
  requireApproval: boolean;
  /** Master switch: the worker schedules and publishes only while it is on. Off until a person turns it on. */
  publishingLive: boolean;
  /** Checked before each build, like the reels watch (D-023); at or over it, a build is skipped. */
  monthlyWatchUsd: number;
  /** Same check per New York day (docs/social-overnight.md); a set costs ~$0.08–0.45. */
  dailyCapUsd: number;
  models: { copy: string; review: string };
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Every series posts in the morning, 8:30–10:00 AM; Stories may share the hour with other content types (Tommy, 2026-10-08). */
const MORNING = { start: '08:30', end: '10:00' };

export const DEFAULT_SETTINGS: StoriesSettings = {
  series: {
    morning_download: { enabled: true, auto: false, style: SERIES_STYLE.morning_download, window: { ...MORNING, days: EVERY_DAY } },
    // S-01: Guess the Number Monday and Thursday; Free vs. Paid Tuesday and Saturday.
    guess_the_number: { enabled: true, auto: false, style: SERIES_STYLE.guess_the_number, window: { ...MORNING, days: [1, 4] } },
    free_vs_paid: { enabled: true, auto: false, style: SERIES_STYLE.free_vs_paid, window: { ...MORNING, days: [2, 6] } },
  },
  requireApproval: true,
  publishingLive: false,
  monthlyWatchUsd: 25,
  dailyCapUsd: 2,
  // S-21: the latest Sonnet writes copy; S-33: Haiku 5.5 reviews renders.
  models: { copy: 'claude-sonnet-5-5', review: 'claude-haiku-5-5' },
};

type SettingKey = 'series' | 'monthly_watch_usd' | 'daily_cap_usd' | 'models' | 'require_approval' | 'publishing_live';

export async function loadSettings(db: Queryable): Promise<StoriesSettings> {
  const { rows } = await db.query<{ key: SettingKey; value: unknown }>(`SELECT key, value FROM stories.settings`);
  const out: StoriesSettings = structuredClone(DEFAULT_SETTINGS);
  for (const { key, value } of rows) {
    if (key === 'series' && value && typeof value === 'object') {
      for (const s of SERIES) {
        const v = (value as Partial<Record<Series, Partial<SeriesSettings>>>)[s];
        if (v) out.series[s] = { ...out.series[s], ...v, window: { ...out.series[s].window, ...(v.window ?? {}) } };
      }
    } else if (key === 'monthly_watch_usd' && typeof value === 'number' && value > 0) {
      out.monthlyWatchUsd = value;
    } else if (key === 'daily_cap_usd' && typeof value === 'number' && value > 0) {
      out.dailyCapUsd = value;
    } else if (key === 'require_approval' && typeof value === 'boolean') {
      out.requireApproval = value;
    } else if (key === 'publishing_live' && typeof value === 'boolean') {
      out.publishingLive = value;
    } else if (key === 'models' && value && typeof value === 'object') {
      out.models = { ...out.models, ...(value as Partial<StoriesSettings['models']>) };
    }
  }
  return out;
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
