/**
 * Capacity and forecast maths (§3.4, §5D). Pure — no DB, no network.
 *
 * The forecast is a model, not a promise. Smartlead splits each mailbox's daily
 * budget between new leads and follow-ups by its own rule, and `followupsDue`
 * assumes step k+1 goes out exactly `delay_days` after step k. The hub controls
 * new-lead volume; drift is expected, surfaced as the variance signal, and
 * never silently corrected.
 */
import type { IdentitySlug, LifecycleStage } from '@/lib/delivery-states';
import { addCalendarDays, isNyCalendarWeekend } from '@/lib/drafting/send-queue-schedule';
import type { StagePlan } from '@/lib/inboxes/stage-plan';

/** The estimate disclaimer the Queue board renders beside forecast cells. */
export const FORECAST_NOTE =
  'Estimate. Smartlead decides the sender and the minute; this is the hub\'s model of what it will do.';

export type CapacityInbox = {
  id: string;
  email: string;
  identitySlug: IdentitySlug;
  stage: LifecycleStage;
  enabled: boolean;
  /** NY calendar date the mailbox entered its current stage. */
  stageEnteredAt: string;
  plan: StagePlan;
};

/** Weekdays in [from, to) — the ramp counts business days, not calendar days. */
export function businessDaysBetween(from: string, to: string): number {
  if (from >= to) return 0;
  let count = 0;
  for (let day = from; day < to; day = addCalendarDays(day, 1)) {
    if (!isNyCalendarWeekend(day)) count += 1;
  }
  return count;
}

/**
 * Campaign sends allowed from one mailbox on one day.
 *
 * Warming mailboxes send zero campaign mail on purpose: warmup traffic is the
 * only thing that should leave them until the inbox rate proves out.
 */
export function stageCap(inbox: CapacityInbox, day: string): number {
  if (!inbox.enabled) return 0;
  switch (inbox.stage) {
    case 'provisioning':
    case 'warming':
    case 'resting':
    case 'retired':
      return 0;
    case 'production':
      return Math.max(0, inbox.plan.production.cap);
    case 'ramping': {
      const { cap_start, cap_step, weekdays_only } = inbox.plan.ramping;
      if (weekdays_only && isNyCalendarWeekend(day)) return 0;
      const elapsed = businessDaysBetween(inbox.stageEnteredAt, day);
      return Math.max(0, Math.min(inbox.plan.production.cap, cap_start + cap_step * elapsed));
    }
  }
}

/**
 * Ceiling on total daily volume from one mailbox, warmup included. Smartlead
 * runs warmup independently, so the campaign cap has to leave room for it.
 */
export function totalDailyBudget(inbox: CapacityInbox, day: string, warmupPerDay: number): number {
  const campaign = stageCap(inbox, day);
  const total = campaign + Math.max(0, warmupPerDay);
  const overBy = total - inbox.plan.limits.max_daily_total;
  return overBy > 0 ? Math.max(0, campaign - overBy) : campaign;
}

/** Caps may not more than double day over day, however the plan is edited. */
export function clampGrowth(previousCap: number, desiredCap: number, plan: StagePlan): number {
  if (previousCap <= 0) return desiredCap;
  return Math.min(desiredCap, Math.ceil(previousCap * plan.limits.max_growth_ratio));
}

export type IdentityCapacityInput = {
  inboxes: CapacityInbox[];
  /** Follow-up steps Smartlead is expected to send for this identity that day. */
  followupsDue: number;
};

/**
 * New-lead slots for one identity on one day: what its mailboxes can send,
 * minus the follow-ups Smartlead will spend that budget on first.
 */
export function identityCapacity(input: IdentityCapacityInput, day: string): number {
  const total = input.inboxes.reduce((sum, inbox) => sum + stageCap(inbox, day), 0);
  return Math.max(0, total - Math.max(0, input.followupsDue));
}

export type MonthlyUsage = {
  /** Plan allowance for the cycle. */
  limit: number;
  /** Campaign sends already made this cycle. */
  used: number;
  /** Warmup mail counts against the same allowance. */
  warmupUsed: number;
  /** Days remaining in the cycle, today included. */
  daysLeft: number;
};

/**
 * Even spread of what is left of the monthly allowance. Returns Infinity when
 * no plan limit is configured, so an unknown plan never throttles sending.
 */
export function monthlyCeiling(usage: MonthlyUsage, plannedEarlier = 0): number {
  if (!Number.isFinite(usage.limit) || usage.limit <= 0) return Number.POSITIVE_INFINITY;
  const daysLeft = Math.max(1, usage.daysLeft);
  const remaining = usage.limit - usage.used - usage.warmupUsed - Math.max(0, plannedEarlier);
  return Math.max(0, Math.floor(remaining / daysLeft));
}

export type LaneDemand = {
  laneId: string;
  campaignId: string;
  identitySlug: IdentitySlug;
  /** Queue rows waiting for a handoff date. */
  demand: number;
  /** delivery_settings.max_new_leads_per_day; null means no lane-level cap. */
  maxNewLeadsPerDay: number | null;
  /** Auto campaigns are additionally bounded by campaigns.emails_per_day. */
  emailsPerDay: number | null;
  laneReady: boolean;
};

/** Per-lane ceiling for one day, given the identity pool left to share. */
export function laneCapacity(lane: LaneDemand, pool: number): number {
  const limits = [pool];
  if (lane.maxNewLeadsPerDay !== null) limits.push(Math.max(0, lane.maxNewLeadsPerDay));
  if (lane.emailsPerDay !== null) limits.push(Math.max(0, lane.emailsPerDay));
  return Math.max(0, Math.min(...limits));
}

/**
 * Hands a day's pool out one slot at a time, so two lanes with unequal backlogs
 * still both make progress instead of the first one draining the day.
 */
export function roundRobinAllocate(
  lanes: LaneDemand[],
  pool: number,
): Map<string, number> {
  const allocated = new Map<string, number>(lanes.map((lane) => [lane.laneId, 0]));
  const eligible = lanes.filter((lane) => lane.laneReady && lane.demand > 0);
  if (eligible.length === 0 || pool <= 0) return allocated;

  let remaining = pool;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const lane of eligible) {
      if (remaining <= 0) break;
      const taken = allocated.get(lane.laneId) ?? 0;
      if (taken >= lane.demand) continue;
      if (taken >= laneCapacity(lane, pool)) continue;
      allocated.set(lane.laneId, taken + 1);
      remaining -= 1;
      progressed = true;
    }
  }
  return allocated;
}

export type ForecastCell = {
  date: string;
  laneId: string;
  forecast: number;
  capacity: number;
  demand: number;
};

/**
 * Forecast for a lane on a future day: the smaller of what it may send and what
 * it has to send. Today is special — the part already sent is fact, so today's
 * number is actual plus whatever capacity and demand both still allow.
 */
export function forecastForLane(input: {
  laneCapacityToday: number;
  demand: number;
  actualToday?: number;
  isToday?: boolean;
}): number {
  if (!input.isToday) return Math.max(0, Math.min(input.laneCapacityToday, input.demand));
  const actual = Math.max(0, input.actualToday ?? 0);
  const remainingCapacity = Math.max(0, input.laneCapacityToday - actual);
  return actual + Math.max(0, Math.min(remainingCapacity, input.demand));
}

/**
 * Splits an identity's planned volume across its mailboxes in proportion to
 * their caps. An estimate by construction: Smartlead picks the actual sender,
 * so this exists to make the per-mailbox row on the board meaningful, not
 * to predict it.
 */
export function plannedPerMailbox(
  inboxes: CapacityInbox[],
  day: string,
  identityPlanned: number,
): Map<string, number> {
  const caps = inboxes.map((inbox) => ({ id: inbox.id, cap: stageCap(inbox, day) }));
  const totalCap = caps.reduce((sum, entry) => sum + entry.cap, 0);
  const planned = new Map<string, number>(caps.map((entry) => [entry.id, 0]));
  if (totalCap <= 0 || identityPlanned <= 0) return planned;

  // Floor each share, then hand out the remainder to the largest fractions so
  // the parts add up to the whole.
  let assigned = 0;
  const remainders: Array<{ id: string; fraction: number }> = [];
  for (const entry of caps) {
    const exact = (identityPlanned * entry.cap) / totalCap;
    const whole = Math.floor(exact);
    planned.set(entry.id, whole);
    assigned += whole;
    remainders.push({ id: entry.id, fraction: exact - whole });
  }
  remainders.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; assigned < identityPlanned && i < remainders.length; i += 1) {
    planned.set(remainders[i].id, (planned.get(remainders[i].id) ?? 0) + 1);
    assigned += 1;
  }
  return planned;
}

/**
 * Two consecutive days of a mailbox sending less than half its plan means the
 * model and Smartlead disagree badly enough to stop trusting the mailbox.
 */
export function varianceFlag(history: Array<{ planned: number; actual: number }>): boolean {
  const recent = history.slice(-2);
  if (recent.length < 2) return false;
  return recent.every((day) => day.planned > 0 && day.actual < 0.5 * day.planned);
}
