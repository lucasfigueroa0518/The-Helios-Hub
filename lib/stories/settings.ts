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
  /** Checked before each build, like the reels watch (D-023); at or over it, a build is skipped. */
  monthlyWatchUsd: number;
  models: { copy: string; review: string };
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_SETTINGS: StoriesSettings = {
  series: {
    morning_download: { enabled: true, auto: false, style: SERIES_STYLE.morning_download, window: { start: '08:45', end: '10:00', days: EVERY_DAY } },
    // S-01: Guess the Number Monday and Thursday; Free vs. Paid Tuesday and Saturday.
    guess_the_number: { enabled: true, auto: false, style: SERIES_STYLE.guess_the_number, window: { start: '18:00', end: '21:00', days: [1, 4] } },
    free_vs_paid: { enabled: true, auto: false, style: SERIES_STYLE.free_vs_paid, window: { start: '18:00', end: '21:00', days: [2, 6] } },
  },
  monthlyWatchUsd: 25,
  // S-21: the latest Sonnet writes copy; S-33: Haiku 5.5 reviews renders.
  models: { copy: 'claude-sonnet-5-5', review: 'claude-haiku-5-5' },
};

type SettingKey = 'series' | 'monthly_watch_usd' | 'models';

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
    } else if (key === 'models' && value && typeof value === 'object') {
      out.models = { ...out.models, ...(value as Partial<StoriesSettings['models']>) };
    }
  }
  return out;
}

/** Turn a series' auto switch on or off, or enable/disable it (Settings tab, M4). */
export async function saveSeriesSetting(db: Queryable, series: Series, patch: Partial<Pick<SeriesSettings, 'enabled' | 'auto'>>, by?: string): Promise<StoriesSettings> {
  const current = await loadSettings(db);
  const next = { ...current.series, [series]: { ...current.series[series], ...patch } };
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ('series', $1::jsonb, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), by ?? null],
  );
  return loadSettings(db);
}
