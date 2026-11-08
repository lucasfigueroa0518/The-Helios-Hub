import type { Queryable } from '@/lib/explainers/db';
import { DRAMA_WINDOWS } from '@/lib/reel-ai-drama/publish/config';
import type { Mode } from '@/lib/reel-ai-drama/types';

/**
 * Reel AI Drama settings (PLAN.md decisions in brackets). Stored rows override these defaults; no seed
 * rows in SQL, so the defaults live only here.
 */
export type ReelAiDramaSettings = {
  mode: Mode;
  /** The hub's Generate switch: nightly fill + weekly development. Off: only clicks run. */
  auto: boolean;
  /** Retired (HUB-WIRING-CONTRACT.md §1.1): no longer editable, and the weekly tick requests no production from it. */
  per_week: number;
  /** Off = auto-publish (written only by writeDramaPosting). */
  require_approval: boolean;
  /** Master switch: nothing is booked or posted while it is off (written only by writeDramaPosting). */
  publishing_live: boolean;
  /** Legacy quota (1 – DRAMA_WINDOWS.length) while the calendar has no template. */
  posts_per_day: number;
  /** Production jobs requested per New York day (the night and clicks together). */
  daily_render_cap: number;
  /** Production spend per New York day. */
  daily_spend_cap_usd: number;
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
  require_approval: true,
  publishing_live: false,
  posts_per_day: 1,
  daily_render_cap: 2,
  daily_spend_cap_usd: 20,
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

const bool = (key: string) => (v: unknown) => (typeof v === 'boolean' ? v : fail(key, 'a boolean', v));
const str = (key: string) => (v: unknown) => (typeof v === 'string' && v.trim() ? v : fail(key, 'a non-empty string', v));
const int = (key: string, min: number) => (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : fail(key, `an integer >= ${min}`, v);
const num = (key: string, min: number, max = Infinity) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(key, `a number in [${min}, ${max}]`, v);

const PARSERS: { [K in ReelAiDramaSettingKey]: (v: unknown) => ReelAiDramaSettings[K] } = {
  mode: (v) => (v === 'development' || v === 'production' ? v : fail('mode', 'development or production', v)),
  auto: bool('auto'),
  per_week: int('per_week', 0),
  require_approval: bool('require_approval'),
  publishing_live: bool('publishing_live'),
  posts_per_day: (v) => {
    const n = int('posts_per_day', 1)(v);
    return n <= DRAMA_WINDOWS.length ? n : fail('posts_per_day', `an integer from 1 to ${DRAMA_WINDOWS.length}`, v);
  },
  daily_render_cap: int('daily_render_cap', 1),
  daily_spend_cap_usd: num('daily_spend_cap_usd', 0),
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
  return Object.prototype.hasOwnProperty.call(PARSERS, key);
}

/** Parse one value for a key; throws with a readable message when it doesn't fit. */
export function parseSetting<K extends ReelAiDramaSettingKey>(key: K, value: unknown): ReelAiDramaSettings[K] {
  return PARSERS[key](value);
}

/**
 * What a person may change from the lab or the hub's Rendering form. `mode` is a cost tag set by hand,
 * `per_week` is retired, and `publishing_live` / `require_approval` are written only by writeDramaPosting.
 */
const NOT_EDITABLE: ReadonlySet<string> = new Set(['mode', 'per_week', 'publishing_live', 'require_approval']);
export const EDITABLE_KEYS: readonly ReelAiDramaSettingKey[] = (Object.keys(DEFAULT_SETTINGS) as ReelAiDramaSettingKey[]).filter((k) => !NOT_EDITABLE.has(k));
export const isEditableKey = (key: string): key is ReelAiDramaSettingKey => isSettingKey(key) && !NOT_EDITABLE.has(key);

/** A stored row that doesn't parse: the default stands in for it, and the lab shows the problem. */
export type SettingProblem = { key: string; stored: unknown; error: string };

/** The settings, and every stored row that didn't parse (its key falls back to the default). Never throws on a bad row. */
export async function loadSettingsReport(db: Queryable): Promise<{ settings: ReelAiDramaSettings; problems: SettingProblem[] }> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM reel_ai_drama.settings');
  const settings: ReelAiDramaSettings = { ...DEFAULT_SETTINGS };
  const problems: SettingProblem[] = [];
  for (const { key, value } of rows) {
    if (!isSettingKey(key)) continue;
    try {
      (settings as Record<string, unknown>)[key] = PARSERS[key](value);
    } catch (error) {
      problems.push({ key, stored: value, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { settings, problems };
}

export async function loadSettings(db: Queryable): Promise<ReelAiDramaSettings> {
  return (await loadSettingsReport(db)).settings;
}

/**
 * The cross-field rules every save is checked against, on the settings as they would be after it.
 * Each failure is reported on the key the person is most likely changing (the patch's own key when it has one).
 */
function crossFieldProblems(next: ReelAiDramaSettings, patched: ReadonlySet<string>): Record<string, string> {
  const fields: Record<string, string> = {};
  const put = (keys: readonly ReelAiDramaSettingKey[], message: string) => {
    const key = keys.find((k) => patched.has(k)) ?? keys[0]!;
    fields[key] ??= message;
  };
  const money = (n: number) => `$${n.toFixed(2)}`;
  if (next.max_seconds < next.target_seconds) put(['max_seconds', 'target_seconds'], `The longest reel (${next.max_seconds}s) must be at least the target length (${next.target_seconds}s).`);
  if (next.target_seconds < next.hook_seconds) put(['target_seconds', 'hook_seconds'], `The target length (${next.target_seconds}s) must be at least the hook (${next.hook_seconds}s).`);
  if (next.rung_max_seconds > next.max_seconds) put(['rung_max_seconds', 'max_seconds'], `One rung (${next.rung_max_seconds}s) can't be longer than the whole reel (${next.max_seconds}s).`);
  if (next.fresh_days > next.news_window_days) put(['fresh_days', 'news_window_days'], `The freshness window (${next.fresh_days} days) must fit inside the news window (${next.news_window_days} days).`);
  if (next.solver_limit_usd > next.per_reel_cap_usd) put(['solver_limit_usd', 'per_reel_cap_usd'], `The problem solver's limit (${money(next.solver_limit_usd)}) can't be more than the per-reel cap (${money(next.per_reel_cap_usd)}).`);
  if (next.visuals_check_cap_usd > next.per_reel_cap_usd) put(['visuals_check_cap_usd', 'per_reel_cap_usd'], `The visuals check cap (${money(next.visuals_check_cap_usd)}) can't be more than the per-reel cap (${money(next.per_reel_cap_usd)}).`);
  if (next.daily_spend_cap_usd < next.per_reel_cap_usd) put(['daily_spend_cap_usd', 'per_reel_cap_usd'], `The daily spend cap (${money(next.daily_spend_cap_usd)}) must cover at least one reel (${money(next.per_reel_cap_usd)}).`);
  if (next.daily_render_cap < next.posts_per_day) put(['daily_render_cap', 'posts_per_day'], `The daily render cap (${next.daily_render_cap}) must be at least the posts per day (${next.posts_per_day}).`);
  if (next.posts_per_day > DRAMA_WINDOWS.length) put(['posts_per_day'], `At most ${DRAMA_WINDOWS.length} AI Drama reel(s) a day.`);
  return fields;
}

/**
 * Check a patch against the current settings: every key known and parseable, then the cross-field rules on the result.
 * Nothing is saved here; `next` is what saving the patch would leave.
 */
export function validateSettingsPatch(
  current: ReelAiDramaSettings,
  patch: Readonly<Record<string, unknown>>,
): { ok: true; next: ReelAiDramaSettings } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const next: ReelAiDramaSettings = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingKey(key)) {
      fields[key] = `Unknown setting ${key}.`;
      continue;
    }
    try {
      (next as Record<string, unknown>)[key] = PARSERS[key](value);
    } catch (error) {
      fields[key] = error instanceof Error ? error.message : String(error);
    }
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  const cross = crossFieldProblems(next, new Set(Object.keys(patch)));
  return Object.keys(cross).length ? { ok: false, fields: cross } : { ok: true, next };
}

type TxDb = Queryable & { transaction?: <R>(fn: (tx: Queryable) => Promise<R>) => Promise<R> };

/** Run `fn` in one transaction: the handle's own when it has one, else BEGIN/COMMIT on it. */
export async function inTransaction<R>(db: Queryable, fn: (tx: Queryable) => Promise<R>): Promise<R> {
  const t = (db as TxDb).transaction;
  if (typeof t === 'function') return (t as <X>(f: (tx: Queryable) => Promise<X>) => Promise<X>).call(db, fn) as Promise<R>;
  await db.query('BEGIN');
  try {
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function upsert(db: Queryable, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO reel_ai_drama.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export class SettingsError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Those settings don’t fit together.');
  }
}

/**
 * Save several keys at once, validated together, in one transaction: all of them or none. Throws SettingsError
 * (with per-key `fields`) when the patch doesn't validate. `by` is kept for the caller's log; the table has no column for it.
 */
export async function saveSettings(db: Queryable, patch: Readonly<Record<string, unknown>>, _by: string | null = null): Promise<ReelAiDramaSettings> {
  const current = await loadSettings(db);
  const checked = validateSettingsPatch(current, patch);
  if (!checked.ok) throw new SettingsError(checked.fields);
  await inTransaction(db, async (tx) => {
    for (const key of Object.keys(patch)) await upsert(tx, key, checked.next[key as ReelAiDramaSettingKey]);
  });
  return checked.next;
}

export async function saveSetting<K extends ReelAiDramaSettingKey>(db: Queryable, key: K, value: ReelAiDramaSettings[K]): Promise<void> {
  await upsert(db, key, PARSERS[key](value));
}
