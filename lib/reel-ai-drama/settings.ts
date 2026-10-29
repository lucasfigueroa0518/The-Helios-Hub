import type { Queryable } from '@/lib/explainers/db';
import type { Mode } from '@/lib/reel-ai-drama/types';

/**
 * Reel AI Drama settings (PLAN.md decisions in brackets). Stored rows override these defaults; no seed
 * rows in SQL, so the defaults live only here.
 */
export type ReelAiDramaSettings = {
  mode: Mode;
  /** Off: no automatic weekly development or production; the lab's buttons still work. */
  auto: boolean;
  /** Documentaries made per week (MD-19). */
  per_week: number;
  /** Development budget per week (MD-28). */
  weekly_dev_cap_usd: number;
  /** Cells the producer explores per development session. */
  cells_per_session: number;
  /** Candidate pitches the producer returns per cell (research 05). */
  pitches_per_cell: number;
  /** A searched cell is due again after this many days, unless news reopens it (MD-27). */
  cell_due_days: number;
  /** Per-idea cap on the visuals check (Lucas: "definitely under thirty five cents"). */
  visuals_check_cap_usd: number;
  /** Bars a pitch must clear to enter the pool (MD-32); 0–1 scales. */
  drama_bar: number;
  material_bar: number;
  /** News stories: in the window at all, and the freshness bonus window (MD-09). */
  news_window_days: number;
  fresh_days: number;
  /** At most one documentary per player within this many days (MD-32). */
  spread_days: number;
  /** Per-reel cap (MD-07). */
  per_reel_cap_usd: number;
  /** Fewer usable visuals than this kills a story (MD-33). */
  min_visuals: number;
  /** A photo can appear in another reel only after this many days (MD-45). */
  reuse_days: number;
  /** Length (MD-35 S-10 rewrite) and pacing (MD-34, MD-35). */
  target_seconds: number;
  max_seconds: number;
  hook_seconds: number;
  rung_max_seconds: number;
  /** Models (MD-49). Jev scores run on Jev's own configured model. */
  producer_model: string;
  reporting_model: string;
  writer_model: string;
  director_model: string;
  orchestrator_model: string;
  frame_worker_model: string;
  vision_model: string;
};

export type ReelAiDramaSettingKey = keyof ReelAiDramaSettings;

export const DEFAULT_SETTINGS: ReelAiDramaSettings = {
  mode: 'development',
  auto: false,
  per_week: 3,
  weekly_dev_cap_usd: 3,
  cells_per_session: 4,
  pitches_per_cell: 4,
  cell_due_days: 120,
  visuals_check_cap_usd: 0.35,
  drama_bar: 0.55,
  material_bar: 0.45,
  news_window_days: 90,
  fresh_days: 60,
  spread_days: 7,
  per_reel_cap_usd: 8,
  min_visuals: 15,
  reuse_days: 20,
  target_seconds: 60,
  max_seconds: 75,
  hook_seconds: 1.5,
  rung_max_seconds: 8,
  producer_model: 'claude-sonnet-5-5',
  reporting_model: 'claude-sonnet-5-5',
  writer_model: 'claude-opus-5-5',
  director_model: 'claude-opus-5-5',
  orchestrator_model: 'claude-sonnet-5-5',
  frame_worker_model: 'claude-sonnet-5-5',
  vision_model: 'claude-haiku-5-5',
};

function fail(key: string, expected: string, value: unknown): never {
  throw new Error(`reel_ai_drama setting ${key} must be ${expected}, got ${JSON.stringify(value)}`);
}

const str = (key: string) => (v: unknown) => (typeof v === 'string' && v.trim() ? v : fail(key, 'a non-empty string', v));
const int = (key: string, min: number) => (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : fail(key, `an integer >= ${min}`, v);
const num = (key: string, min: number, max = Infinity) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(key, `a number in [${min}, ${max}]`, v);

const PARSERS: { [K in ReelAiDramaSettingKey]: (v: unknown) => ReelAiDramaSettings[K] } = {
  mode: (v) => (v === 'development' || v === 'production' ? v : fail('mode', 'development or production', v)),
  auto: (v) => (typeof v === 'boolean' ? v : fail('auto', 'a boolean', v)),
  per_week: int('per_week', 0),
  weekly_dev_cap_usd: num('weekly_dev_cap_usd', 0),
  cells_per_session: int('cells_per_session', 1),
  pitches_per_cell: int('pitches_per_cell', 1),
  cell_due_days: int('cell_due_days', 1),
  visuals_check_cap_usd: num('visuals_check_cap_usd', 0, 0.35),
  drama_bar: num('drama_bar', 0, 1),
  material_bar: num('material_bar', 0, 1),
  news_window_days: int('news_window_days', 1),
  fresh_days: int('fresh_days', 1),
  spread_days: int('spread_days', 0),
  per_reel_cap_usd: num('per_reel_cap_usd', 0),
  min_visuals: int('min_visuals', 1),
  reuse_days: int('reuse_days', 0),
  target_seconds: num('target_seconds', 10),
  max_seconds: num('max_seconds', 10),
  hook_seconds: num('hook_seconds', 0.1),
  rung_max_seconds: num('rung_max_seconds', 1),
  producer_model: str('producer_model'),
  reporting_model: str('reporting_model'),
  writer_model: str('writer_model'),
  director_model: str('director_model'),
  orchestrator_model: str('orchestrator_model'),
  frame_worker_model: str('frame_worker_model'),
  vision_model: str('vision_model'),
};

export function isSettingKey(key: string): key is ReelAiDramaSettingKey {
  return key in PARSERS;
}

export async function loadSettings(db: Queryable): Promise<ReelAiDramaSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM reel_ai_drama.settings');
  const out: ReelAiDramaSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (isSettingKey(key)) (out as Record<string, unknown>)[key] = PARSERS[key](value);
  }
  return out;
}

export async function saveSetting<K extends ReelAiDramaSettingKey>(db: Queryable, key: K, value: ReelAiDramaSettings[K]): Promise<void> {
  const parsed = PARSERS[key](value);
  await db.query(
    `INSERT INTO reel_ai_drama.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(parsed)],
  );
}
