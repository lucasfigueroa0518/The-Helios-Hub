/**
 * Editorial pipeline configuration.
 *
 * Every knob the editorial skill's stages read lives here. Defaults are the
 * starting values in `~/.claude/skills/helios-social-editorial/SKILL.md` §2
 * (hook gate) and `~/.claude/skills/helios-social-skill/SKILL.md` §Photo policy
 * (reuse window). Both notes call these starting values and expect us to tune
 * after reviewing the first batch.
 *
 * Env-override every knob so tuning doesn't require a code change.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

/**
 * Hook gate — a story only becomes a post if its best hook clears BOTH bars.
 * From the editorial skill's §2 Scoring: "Skip any story whose best hook
 * totals under 18 of 25, or scores under 4 on question 2 ['Could you scroll
 * past it?']. (These thresholds are starting values. Tune them after
 * reviewing the first batch.)"
 */
export const HOOK_GATE_MIN_TOTAL = envNumber('HELIOS_HOOK_GATE_MIN_TOTAL', 18);
export const HOOK_GATE_MIN_Q2 = envNumber('HELIOS_HOOK_GATE_MIN_Q2', 4);

/**
 * Photo reuse window — the design skill's §Photo policy says covers are
 * never reused across carousels, and interior photos may be reused from the
 * library but not if they appeared in any of the previous N posts. N=10 is
 * the starting value.
 */
export const PHOTO_REUSE_WINDOW = envNumber('HELIOS_PHOTO_REUSE_WINDOW', 10);

/**
 * Models. The editorial skill's model note: "stages 1 to 4 are judgment
 * calls and decide whether a post is good. Run them on Sonnet or better.
 * Haiku is fine for stage 6 rewrites and for field-level retries."
 *
 * IDs match the `claude-*-YYYYMMDD` shape the SDK expects. Override in
 * env if a newer snapshot ships mid-batch.
 */
export const EDITORIAL_MODEL = envString('HELIOS_EDITORIAL_MODEL', 'claude-sonnet-4-6');
export const HUMANIZER_MODEL = envString('HELIOS_HUMANIZER_MODEL', 'claude-haiku-4-5-20251001');

/**
 * v2 cost cuts (docs/PROJECT-STATUS.md §Costs):
 * - Caption stage runs on Haiku (short summary, low judgment).
 * - Editor's length-repair reruns (CHECK ERRORS = char_limit /
 *   highlight_substring) run on Haiku — they're mechanical trims, not
 *   editorial rewrites. Fact-check flag reruns still run on Sonnet
 *   because they require judgment about what the sources say.
 */
export const CAPTION_MODEL = envString('HELIOS_V2_CAPTION_MODEL', 'claude-haiku-4-5-20251001');
export const REPAIR_EDITOR_MODEL = envString('HELIOS_V2_REPAIR_EDITOR_MODEL', 'claude-haiku-4-5-20251001');

/**
 * Sonnet 4.6 pricing (per Anthropic pricing page as of 2026-09):
 * $3/Mtok input, $15/Mtok output, cache reads $0.30/Mtok, cache writes $3.75/Mtok.
 * Kept alongside the model constant so cost math travels with the model choice.
 */
export const SONNET_INPUT_USD_PER_MTOK = 3.0;
export const SONNET_OUTPUT_USD_PER_MTOK = 15.0;
export const SONNET_CACHE_READ_USD_PER_MTOK = 0.30;
export const SONNET_CACHE_WRITE_USD_PER_MTOK = 3.75;

/**
 * Jev pricing (per docs.typesafe.ai/models.md): $42/Btok input, output free.
 * Used in the strategy stage's bucket + value-type sub-calls, which are
 * multiway classifications well-suited to chained Nouls.
 */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export function jevCostUsd(usage: { inputTokens: number }): number {
  return (usage.inputTokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;
}

/**
 * Autonomous-spend guard for the dry-run CLI. The Hub's CLAUDE.md sets a
 * ~$1.50 ceiling on agent-initiated Claude calls without user go-ahead;
 * cap the dry-run at $1 by default so a single accidental N=50 doesn't
 * blow through the ceiling.
 */
export const DRY_RUN_MAX_USD = envNumber('HELIOS_DRY_RUN_MAX_USD', 1.0);

/**
 * Dry-run defaults. 5 articles is the number the plan calls for; MAX=10
 * keeps a runaway invocation from hitting the spend cap in one shot.
 */
export const DRY_RUN_DEFAULT_COUNT = envNumber('HELIOS_DRY_RUN_DEFAULT_COUNT', 5);
export const DRY_RUN_MAX_COUNT = envNumber('HELIOS_DRY_RUN_MAX_COUNT', 10);

/**
 * Minimum article-body length in characters for the editorial pipeline to
 * bother calling Sonnet. Below this, the article is just a headline blob
 * (typical RSS-summary artifact) and Sonnet correctly refuses to fabricate
 * facts — a wasted call that also throws a non-JSON parse error downstream.
 *
 * Discovered from the first dry-run: 317 of 334 approved_for_draft articles
 * had less than 500 chars of body. The real bottleneck is upstream RSS
 * extraction, not editorial. The pre-check gives a clean skip until the
 * ingest layer fetches full article bodies.
 */
export const MIN_BODY_CHARS = envNumber('HELIOS_MIN_BODY_CHARS', 500);

/**
 * Utility to compute Sonnet USD from token usage. Handles the cache split.
 */
export function sonnetCostUsd(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // "input_tokens" in Anthropic's usage is the NON-cached input tokens.
  return (
    (usage.inputTokens * SONNET_INPUT_USD_PER_MTOK
      + cacheRead * SONNET_CACHE_READ_USD_PER_MTOK
      + cacheWrite * SONNET_CACHE_WRITE_USD_PER_MTOK
      + usage.outputTokens * SONNET_OUTPUT_USD_PER_MTOK)
    / 1_000_000
  );
}

/** Haiku 4.5 pricing: $1/Mtok in, $5/Mtok out, cache-read $0.10, cache-write $1.25. */
export const HAIKU_INPUT_USD_PER_MTOK = 1.0;
export const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;
export const HAIKU_CACHE_READ_USD_PER_MTOK = 0.10;
export const HAIKU_CACHE_WRITE_USD_PER_MTOK = 1.25;

export function haikuCostUsd(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return (
    (usage.inputTokens * HAIKU_INPUT_USD_PER_MTOK
      + cacheRead * HAIKU_CACHE_READ_USD_PER_MTOK
      + cacheWrite * HAIKU_CACHE_WRITE_USD_PER_MTOK
      + usage.outputTokens * HAIKU_OUTPUT_USD_PER_MTOK)
    / 1_000_000
  );
}

/** Dispatch to the right pricing table by model ID. */
export function costUsdForModel(model: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  return /haiku/i.test(model) ? haikuCostUsd(usage) : sonnetCostUsd(usage);
}
