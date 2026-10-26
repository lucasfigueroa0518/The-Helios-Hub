import type { Queryable } from '@/lib/explainers/db';
import type { Mode } from '@/lib/real-case/types';

/** Settings for this route only (RC-11). Defaults match the seed rows in db/real_case_schema.sql. */
export type RealCaseSettings = {
  mode: Mode;
  /** Off means no nightly story cycle. Lucas's Find stories click still runs one topic. */
  auto_scout: boolean;
  topics_per_night: number;
  /** The nightly cycle stops starting new topics once its spend reaches this. */
  nightly_cap_usd: number;
  stories_per_topic: number;
  pool_size: number;
  /** A topic searched within this many days is not searched again (found, weak or none). */
  scout_cooldown_days: number;
  dedupe_lookback_days: number;
  scout_model: string;
  /** The render (M5): its own cap per reel, and the models its sessions run on. */
  per_reel_cap_usd: number;
  orchestrator_model: string;
  frame_worker_model: string;
  /** The fact-check gate's one Sonnet call (RC-06). */
  fact_check_model: string;
};

export type RealCaseSettingKey = keyof RealCaseSettings;

export const DEFAULT_REAL_CASE_SETTINGS: RealCaseSettings = {
  mode: 'development',
  auto_scout: false,
  topics_per_night: 3,
  nightly_cap_usd: 1,
  stories_per_topic: 3,
  pool_size: 25,
  scout_cooldown_days: 30,
  dedupe_lookback_days: 45,
  scout_model: 'claude-sonnet-5-5',
  per_reel_cap_usd: 8,
  orchestrator_model: 'claude-sonnet-5-5',
  frame_worker_model: 'claude-sonnet-5-5',
  fact_check_model: 'claude-sonnet-5-5',
};

function fail(key: string, expected: string, value: unknown): never {
  throw new Error(`real_case setting ${key} must be ${expected}, got ${JSON.stringify(value)}`);
}

const model = (key: string) => (value: unknown) => (typeof value === 'string' && value.trim() ? value : fail(key, 'a non-empty string', value));

const integer = (key: string, min: number) => (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fail(key, `an integer >= ${min}`, value);

const PARSERS: { [K in RealCaseSettingKey]: (value: unknown) => RealCaseSettings[K] } = {
  mode: (value) => (value === 'development' || value === 'production' ? value : fail('mode', 'development or production', value)),
  auto_scout: (value) => (typeof value === 'boolean' ? value : fail('auto_scout', 'a boolean', value)),
  topics_per_night: integer('topics_per_night', 0),
  nightly_cap_usd: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail('nightly_cap_usd', 'a number >= 0', value),
  stories_per_topic: integer('stories_per_topic', 1),
  pool_size: integer('pool_size', 1),
  scout_cooldown_days: integer('scout_cooldown_days', 0),
  dedupe_lookback_days: integer('dedupe_lookback_days', 0),
  scout_model: model('scout_model'),
  per_reel_cap_usd: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fail('per_reel_cap_usd', 'a positive number', value),
  orchestrator_model: model('orchestrator_model'),
  frame_worker_model: model('frame_worker_model'),
  fact_check_model: model('fact_check_model'),
};

export function isRealCaseSettingKey(key: string): key is RealCaseSettingKey {
  return Object.prototype.hasOwnProperty.call(PARSERS, key);
}

/** Stored rows over defaults. A stored value that fails validation throws: these values gate spend. */
export async function loadRealCaseSettings(db: Queryable): Promise<RealCaseSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM real_case.settings');
  const settings = { ...DEFAULT_REAL_CASE_SETTINGS };
  for (const row of rows) {
    if (!isRealCaseSettingKey(row.key)) continue;
    (settings as Record<RealCaseSettingKey, unknown>)[row.key] = PARSERS[row.key](row.value);
  }
  return settings;
}

export async function saveRealCaseSetting<K extends RealCaseSettingKey>(db: Queryable, key: K, value: unknown): Promise<RealCaseSettings[K]> {
  const parsed = PARSERS[key](value) as RealCaseSettings[K];
  await db.query(
    `INSERT INTO real_case.settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(parsed)],
  );
  return parsed;
}
