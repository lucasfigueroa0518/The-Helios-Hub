/**
 * `campaigns.delivery_settings` — the per-campaign delivery contract (§3.3).
 *
 * Stored as jsonb and therefore untrusted on read: `resolveDeliverySettings`
 * coerces whatever is in the column onto the defaults so a hand-edited row
 * cannot produce an unschedulable campaign.
 */
import type { ReplyFallback } from '@/lib/delivery-states';

export type FollowUpStep = {
  /** Sequence position; step 1 is the hub's per-lead draft, so these start at 2. */
  step: number;
  delay_days: number;
  body_template: string;
};

export type DeliverySchedule = {
  tz: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: string;
  end: string;
  min_gap_min: number;
};

export type DeliverySettings = {
  tracking: boolean;
  stop_on_reply: boolean;
  unsubscribe_text: string;
  schedule: DeliverySchedule;
  max_new_leads_per_day: number | null;
  follow_ups: FollowUpStep[];
  reply_fallback: ReplyFallback;
  require_approval: boolean;
  /** ISO date; the create dialog sets created_at + 30 days. */
  require_approval_until: string | null;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  tracking: false,
  stop_on_reply: true,
  unsubscribe_text: 'Reply STOP and I will take you off this list.',
  schedule: {
    tz: 'America/New_York',
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '17:00',
    min_gap_min: 10,
  },
  max_new_leads_per_day: null,
  follow_ups: [],
  reply_fallback: 'claude',
  require_approval: true,
  require_approval_until: null,
};

/** Approval defaults on for a campaign's first 30 days. */
export const REQUIRE_APPROVAL_DAYS = 30;

export function initialDeliverySettings(createdAt: Date = new Date()): DeliverySettings {
  const until = new Date(createdAt.getTime() + REQUIRE_APPROVAL_DAYS * 86_400_000);
  return {
    ...DEFAULT_DELIVERY_SETTINGS,
    require_approval: true,
    require_approval_until: until.toISOString().slice(0, 10),
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number | null): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function asTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function asDays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const days = [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return days.length ? days.sort((a, b) => a - b) : fallback;
}

function asFollowUps(value: unknown): FollowUpStep[] {
  if (!Array.isArray(value)) return [];
  const steps: FollowUpStep[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const step = asPositiveInt(row.step, null);
    const body = typeof row.body_template === 'string' ? row.body_template : '';
    // Step 1 is reserved for the per-lead draft, and an empty follow-up would
    // send a blank email.
    if (step === null || step < 2 || !body.trim()) continue;
    steps.push({
      step,
      delay_days: asPositiveInt(row.delay_days, 3) ?? 3,
      body_template: body,
    });
  }
  return steps.sort((a, b) => a.step - b.step);
}

export function resolveDeliverySettings(raw: unknown): DeliverySettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_DELIVERY_SETTINGS;
  const row = raw as Record<string, unknown>;
  const schedule = (row.schedule ?? {}) as Record<string, unknown>;
  const fallback = row.reply_fallback === 'human_only' ? 'human_only' : 'claude';

  return {
    tracking: asBoolean(row.tracking, DEFAULT_DELIVERY_SETTINGS.tracking),
    stop_on_reply: asBoolean(row.stop_on_reply, DEFAULT_DELIVERY_SETTINGS.stop_on_reply),
    unsubscribe_text: typeof row.unsubscribe_text === 'string'
      ? row.unsubscribe_text
      : DEFAULT_DELIVERY_SETTINGS.unsubscribe_text,
    schedule: {
      tz: typeof schedule.tz === 'string' ? schedule.tz : DEFAULT_DELIVERY_SETTINGS.schedule.tz,
      days: asDays(schedule.days, DEFAULT_DELIVERY_SETTINGS.schedule.days),
      start: asTime(schedule.start, DEFAULT_DELIVERY_SETTINGS.schedule.start),
      end: asTime(schedule.end, DEFAULT_DELIVERY_SETTINGS.schedule.end),
      min_gap_min: asPositiveInt(schedule.min_gap_min, DEFAULT_DELIVERY_SETTINGS.schedule.min_gap_min)!,
    },
    max_new_leads_per_day: asPositiveInt(row.max_new_leads_per_day, null),
    follow_ups: asFollowUps(row.follow_ups),
    reply_fallback: fallback,
    require_approval: asBoolean(row.require_approval, true),
    require_approval_until: typeof row.require_approval_until === 'string'
      ? row.require_approval_until
      : null,
  };
}

/**
 * Approval is on while the flag is set. The `until` date is when the *user* may
 * switch it off, not an automatic expiry — leaving it on is always safe, and
 * silently disabling a safety gate on a timer is not.
 */
export function approvalRequired(settings: DeliverySettings): boolean {
  return settings.require_approval;
}

/** True once the user is allowed to turn approval off. */
export function approvalLockExpired(
  settings: DeliverySettings,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return !settings.require_approval_until || settings.require_approval_until <= today;
}
