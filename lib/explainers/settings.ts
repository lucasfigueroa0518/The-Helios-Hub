import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import { MODES, type Mode } from '@/lib/explainers/types';

/**
 * Settings shared by the page and the worker. Defaults are the kickoff
 * decisions (E-16 to E-20, amendments A-4, A-5, A-7) and match the seed rows
 * in db/explainers_schema.sql.
 */
export type ExplainersSettings = {
  mode: Mode;
  /** A-5, A-7: off means no daily idea cycle and no promotion. */
  auto_render: boolean;
  per_reel_cap_usd: number;
  /** Production only (E-17). */
  daily_render_cap: number;
  /** Production only, renders plus the idea pipeline (A-4). */
  daily_spend_cap_usd: number;
  pool_size: number;
  ideas_per_day: number;
  dedupe_lookback_days: number;
  voice_name: string;
  voice_id: string | null;
  orchestrator_model: string;
  frame_worker_model: string;
  idea_model: string;
  music_enabled: boolean;
  sfx_enabled: boolean;
  theme_brief_version: string;
};

export type SettingKey = keyof ExplainersSettings;

export const DEFAULT_SETTINGS: ExplainersSettings = {
  mode: 'development',
  auto_render: false,
  per_reel_cap_usd: 5,
  // SH-49: two renders a day under the $5 per-reel cap.
  daily_render_cap: 2,
  daily_spend_cap_usd: 10,
  pool_size: 25,
  ideas_per_day: 3,
  dedupe_lookback_days: 45,
  voice_name: 'Lucas Figueroa',
  voice_id: null,
  orchestrator_model: 'claude-sonnet-5-5',
  frame_worker_model: 'claude-sonnet-5-5',
  idea_model: 'claude-sonnet-5-5',
  music_enabled: true,
  sfx_enabled: true,
  theme_brief_version: 'v1',
};

type Parser<K extends SettingKey> = (value: unknown) => ExplainersSettings[K];

function fail(key: string, expected: string, value: unknown): never {
  throw new Error(`explainers setting ${key} must be ${expected}, got ${JSON.stringify(value)}`);
}

function bool<K extends SettingKey>(key: K): Parser<K> {
  return (value) =>
    (typeof value === 'boolean' ? value : fail(key, 'a boolean', value)) as ExplainersSettings[K];
}

function positiveNumber<K extends SettingKey>(key: K): Parser<K> {
  return (value) =>
    (typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : fail(key, 'a positive number', value)) as ExplainersSettings[K];
}

function integer<K extends SettingKey>(key: K, min: number): Parser<K> {
  return (value) =>
    (typeof value === 'number' && Number.isInteger(value) && value >= min
      ? value
      : fail(key, `an integer >= ${min}`, value)) as ExplainersSettings[K];
}

function text<K extends SettingKey>(key: K): Parser<K> {
  return (value) =>
    (typeof value === 'string' && value.trim().length > 0
      ? value
      : fail(key, 'a non-empty string', value)) as ExplainersSettings[K];
}

const PARSERS: { [K in SettingKey]: Parser<K> } = {
  mode: (value) =>
    MODES.includes(value as Mode) ? (value as Mode) : fail('mode', MODES.join(' or '), value),
  auto_render: bool('auto_render'),
  per_reel_cap_usd: positiveNumber('per_reel_cap_usd'),
  daily_render_cap: integer('daily_render_cap', 0),
  daily_spend_cap_usd: positiveNumber('daily_spend_cap_usd'),
  pool_size: integer('pool_size', 1),
  ideas_per_day: integer('ideas_per_day', 1),
  dedupe_lookback_days: integer('dedupe_lookback_days', 0),
  voice_name: text('voice_name'),
  voice_id: (value) => (value === null ? null : text('voice_id')(value)),
  orchestrator_model: text('orchestrator_model'),
  frame_worker_model: text('frame_worker_model'),
  idea_model: text('idea_model'),
  music_enabled: bool('music_enabled'),
  sfx_enabled: bool('sfx_enabled'),
  theme_brief_version: text('theme_brief_version'),
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(PARSERS, key);
}

export function parseSetting<K extends SettingKey>(key: K, value: unknown): ExplainersSettings[K] {
  return PARSERS[key](value);
}

/**
 * Stored rows over defaults. Unknown keys are ignored; a stored value that
 * fails validation throws, because these values gate spend.
 */
export async function loadSettings(db: Queryable): Promise<ExplainersSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM explainers.settings',
  );
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!isSettingKey(row.key)) continue;
    (settings as Record<SettingKey, unknown>)[row.key] = parseSetting(row.key, row.value);
  }
  return settings;
}

export async function saveSetting<K extends SettingKey>(
  db: ExplainersDb | Queryable,
  key: K,
  value: unknown,
): Promise<ExplainersSettings[K]> {
  const parsed = parseSetting(key, value);
  await db.query(
    `INSERT INTO explainers.settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(parsed)],
  );
  return parsed;
}

export async function loadThemeBrief(db: Queryable, version: string): Promise<string> {
  const { rows } = await db.query<{ body: string }>(
    'SELECT body FROM explainers.theme_briefs WHERE version = $1',
    [version],
  );
  if (!rows[0]) throw new Error(`explainers theme brief ${version} not found`);
  return rows[0].body;
}
