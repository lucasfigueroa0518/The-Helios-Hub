/**
 * The inbox lifecycle plan (§3.5).
 *
 * `org_settings.stage_plan.default` holds the org-wide numbers; each
 * `sender_inboxes.stage_plan` deep-merges over it, so a single mailbox can ramp
 * slower without forking the policy. Pure: both capacity.ts and lifecycle.ts
 * depend on this, and it depends on neither.
 */

export type StagePlan = {
  warming: {
    days: number;
    warmup_start: number;
    warmup_rampup: number;
    warmup_target: number;
    reply_rate_pct: number;
    exit: { inbox_rate_min: number; window_days: number };
  };
  ramping: {
    days: number;
    cap_start: number;
    cap_step: number;
    weekdays_only: boolean;
    warmup_hold: number;
    exit: { bounce_rate_max: number };
  };
  production: { cap: number; warmup_per_day: number };
  resting: { days: number; legacy_days: number };
  limits: { max_daily_total: number; max_growth_ratio: number };
  auto_derate: {
    bounce_rate_rest: number;
    warmup_spam_rate_rest: number;
    postmaster_rest: string[];
  };
};

/** Mirrors the seed in db/smartlead_schema.sql. */
export const DEFAULT_STAGE_PLAN: StagePlan = {
  warming: {
    days: 14,
    warmup_start: 5,
    warmup_rampup: 2,
    warmup_target: 30,
    reply_rate_pct: 32,
    exit: { inbox_rate_min: 0.92, window_days: 7 },
  },
  ramping: {
    days: 14,
    cap_start: 3,
    cap_step: 1,
    weekdays_only: true,
    warmup_hold: 30,
    exit: { bounce_rate_max: 0.02 },
  },
  production: { cap: 12, warmup_per_day: 20 },
  resting: { days: 10, legacy_days: 60 },
  limits: { max_daily_total: 40, max_growth_ratio: 2 },
  auto_derate: {
    bounce_rate_rest: 0.03,
    warmup_spam_rate_rest: 0.05,
    postmaster_rest: ['LOW', 'BAD'],
  },
};

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursive merge where `override` wins leaf by leaf. Arrays replace rather
 * than concatenate, so overriding `postmaster_rest` to `[]` really disables it.
 */
export function mergeStagePlan(base: StagePlan, ...overrides: Array<unknown>): StagePlan {
  let merged: Plain = base as unknown as Plain;
  for (const override of overrides) {
    if (!isPlainObject(override)) continue;
    merged = deepMerge(merged, override);
  }
  return merged as unknown as StagePlan;
}

function deepMerge(base: Plain, override: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key] as Plain, value)
      : value;
  }
  return out;
}

/** Resolves the effective plan for one mailbox. */
export function resolveStagePlan(
  orgDefault: unknown,
  inboxOverride: unknown,
): StagePlan {
  return mergeStagePlan(DEFAULT_STAGE_PLAN, orgDefault, inboxOverride);
}
