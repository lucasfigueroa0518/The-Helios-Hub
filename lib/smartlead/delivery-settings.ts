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
  /**
   * Share of the sender's current inbox capacity, 1–100. Null keeps the
   * legacy absolute `max_new_leads_per_day` / `emails_per_day` cap.
   */
  capacity_pct: number | null;
  follow_ups: FollowUpStep[];
  reply_fallback: ReplyFallback;
  require_approval: boolean;
  /** Unused. Kept so older rows still parse. */
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
  capacity_pct: null,
  follow_ups: [],
  reply_fallback: 'claude',
  require_approval: false,
  require_approval_until: null,
};

/** New campaigns send without a human review step. */
export function initialDeliverySettings(): DeliverySettings {
  return {
    ...DEFAULT_DELIVERY_SETTINGS,
    schedule: { ...DEFAULT_DELIVERY_SETTINGS.schedule },
    follow_ups: [],
    require_approval: false,
    require_approval_until: null,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asCapacityPct(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const pct = Math.floor(parsed);
  if (pct < 1 || pct > 100) return null;
  return pct;
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
    capacity_pct: asCapacityPct(row.capacity_pct),
    follow_ups: asFollowUps(row.follow_ups),
    reply_fallback: fallback,
    require_approval: asBoolean(row.require_approval, false),
    require_approval_until: typeof row.require_approval_until === 'string'
      ? row.require_approval_until
      : null,
  };
}

/** Drafts hand off without a review. The stored flag is ignored. */
export function approvalRequired(_settings: DeliverySettings): boolean {
  return false;
}
