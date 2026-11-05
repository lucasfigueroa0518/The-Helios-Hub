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
  /** Length (MD-103: about 60s, up to 80s when the story needs it) and pacing (MD-34, MD-35). */
  target_seconds: number;
  max_seconds: number;
  hook_seconds: number;
  rung_max_seconds: number;
  /** The voice (MD-93): one take, sped up after recording with ffmpeg `atempo` (HeyGen ignores `speed`). */
  voice_tempo: number;
  /** The delivered narration pace, the word budget's rate (MD-91: up to the caption ceiling). */
  words_per_minute_target: number;
  /** The longest silent beat, in seconds: a frame with no voice, or a line's picture beat (MD-103: about 0.15s). */
  silent_beat_max: number;
  /** Models (MD-49). Jev scores run on Jev's own configured model. */
  producer_model: string;
  reporting_model: string;
  writer_model: string;
  /** The blind story editor (MD-102). */
  story_editor_model: string;
  director_model: string;
  orchestrator_model: string;
  frame_worker_model: string;
  vision_model: string;
  /** The design reviewer's judgment items (MD-133); its mechanical items run on `vision_model`. */
  design_judge_model: string;
  /** Iteration 11: director fix rounds run here first, and escalate if the re-check still finds the problem. */
  director_fix_model: string;
  director_fix_escalation_model: string;
  /** Iteration 11: the problem solver's reel-wide look and its two rounds, and what all of them may spend on one reel. */
  solver_look_model: string;
  solver_first_model: string;
  solver_second_model: string;
  solver_limit_usd: number;
};

export type ReelAiDramaSettingKey = keyof ReelAiDramaSettings;

export const DEFAULT_SETTINGS: ReelAiDramaSettings = {
  mode: 'development',
  auto: false,
  per_week: 3,
  weekly_dev_cap_usd: 3,
  cells_per_session: 4,
  pitches_per_cell: 5,
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
  max_seconds: 80,
  hook_seconds: 1.5,
  rung_max_seconds: 8,
  voice_tempo: 1.12,
  words_per_minute_target: 180,
  silent_beat_max: 0.15,
  producer_model: 'claude-sonnet-5-5',
  reporting_model: 'claude-sonnet-5-5',
  writer_model: 'claude-opus-5-5',
  story_editor_model: 'claude-opus-5-5',
  director_model: 'claude-opus-5-5',
  orchestrator_model: 'claude-sonnet-5-5',
  frame_worker_model: 'claude-sonnet-5-5',
  vision_model: 'claude-haiku-5-5',
  design_judge_model: 'claude-sonnet-5-5',
  director_fix_model: 'claude-sonnet-5-5',
  director_fix_escalation_model: 'claude-opus-5-5',
  solver_look_model: 'claude-sonnet-5-5',
  solver_first_model: 'claude-sonnet-5-5',
  solver_second_model: 'claude-opus-5-5',
  solver_limit_usd: 4,
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
  // ffmpeg's atempo takes 0.5–2 in one pass.
  voice_tempo: num('voice_tempo', 0.5, 2),
  words_per_minute_target: num('words_per_minute_target', 60, 300),
  silent_beat_max: num('silent_beat_max', 0, 4),
  producer_model: str('producer_model'),
  reporting_model: str('reporting_model'),
  writer_model: str('writer_model'),
  story_editor_model: str('story_editor_model'),
  director_model: str('director_model'),
  orchestrator_model: str('orchestrator_model'),
  frame_worker_model: str('frame_worker_model'),
  vision_model: str('vision_model'),
  design_judge_model: str('design_judge_model'),
  director_fix_model: str('director_fix_model'),
  director_fix_escalation_model: str('director_fix_escalation_model'),
  solver_look_model: str('solver_look_model'),
  solver_first_model: str('solver_first_model'),
  solver_second_model: str('solver_second_model'),
  solver_limit_usd: num('solver_limit_usd', 2),
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
