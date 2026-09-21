/**
 * Delivery costs (§5H).
 *
 * Smartlead is a $94/month subscription clocked on its own Analytics line:
 * a monthly (or longer) view takes the full month once per calendar month
 * covered; a shorter view prorates `price × (days in range / days in month)`.
 * Used send capacity (sends / prorated plan emails) is outreach; the unused
 * remainder stays wasted. Microsoft 365 seats stay as overlapping billing-cycle
 * lumps. The only per-event delivery cost is a verifier check. Historical
 * AgentMail sends keep $0.002 each.
 */
import { dbQuery } from '@/lib/db';
import {
  DEFAULT_PLAN_LIMITS,
  getOrgSetting,
  getOrgSettings,
  type PlanLimits,
} from '@/lib/org-settings';

export type DeliveryPricing = {
  smartleadPerMonthUsd: number;
  /** Smartlead Pro bills on the 16th. */
  smartleadBillingDay: number;
  m365SeatPerMonthUsd: number;
  /** Microsoft 365 seats bill on the 15th — a day earlier than Smartlead. */
  m365BillingDay: number;
  verifierPerCheckUsd: number;
};

/** Historical AgentMail sends keep their original per-send price so old
 * analytics totals still reconcile. */
export const LEGACY_AGENTMAIL_USD_PER_SEND = 0.002;

export async function loadDeliveryPricing(): Promise<DeliveryPricing> {
  const settings = await getOrgSettings([
    'smartlead.pricing',
    'smartlead.billing_day',
    'm365.pricing',
    'verifier.pricing',
  ]);
  const smartlead = settings.get('smartlead.pricing') as { subscription_usd_per_month?: number } | undefined;
  const m365 = settings.get('m365.pricing') as
    | { seat_usd_per_month?: number; billing_day?: number }
    | undefined;
  const verifier = settings.get('verifier.pricing') as { usd_per_check?: number } | undefined;
  const smartleadBillingDay = Number(settings.get('smartlead.billing_day') ?? 1);

  return {
    smartleadPerMonthUsd: Number(smartlead?.subscription_usd_per_month ?? 0),
    smartleadBillingDay,
    m365SeatPerMonthUsd: Number(m365?.seat_usd_per_month ?? 0),
    // Absent an M365 billing day, follow Smartlead's rather than inventing one.
    m365BillingDay: Number(m365?.billing_day ?? smartleadBillingDay),
    verifierPerCheckUsd: Number(verifier?.usd_per_check ?? 0),
  };
}

/** `YYYY-MM-DD` start of the billing cycle that contains `day`. */
export function cycleStartFor(day: string, billingDay: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const anchor = Math.min(Math.max(1, billingDay), 28);
  const start = date >= anchor
    ? new Date(Date.UTC(year, month - 1, anchor))
    : new Date(Date.UTC(year, month - 2, anchor));
  return start.toISOString().slice(0, 10);
}

/** `YYYY-MM` tag for the cycle that contains `day`. */
export function cycleTag(day: string, billingDay: number): string {
  return cycleStartFor(day, billingDay).slice(0, 7);
}

/** Inclusive start and exclusive end of the billing cycle tagged `YYYY-MM`. */
export function cycleBounds(cycle: string, billingDay: number): { start: string; endExclusive: string } {
  const [year, month] = cycle.split('-').map(Number);
  const day = Math.min(Math.max(1, billingDay), 28);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(Date.UTC(year, month, day));
  return {
    start: start.toISOString().slice(0, 10),
    endExclusive: end.toISOString().slice(0, 10),
  };
}

/** True when the billing cycle and the reporting window share at least one day. */
export function cycleOverlapsWindow(
  cycle: string,
  billingDay: number,
  from: string,
  to: string,
): boolean {
  const { start, endExclusive } = cycleBounds(cycle, billingDay);
  return from < endExclusive && to >= start;
}

const MS_PER_DAY = 86_400_000;
/** Inclusive day count at which a window is treated as a full month, not prorated. */
const SMARTLEAD_FULL_MONTH_DAYS = 28;

function utcDayStart(day: string): Date {
  return new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
}

/** Inclusive UTC calendar days from `from` through `to`. */
export function inclusiveUtcDays(from: string, to: string): number {
  const start = utcDayStart(from).getTime();
  const end = utcDayStart(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

type CalendarMonth = { year: number; month: number; days: number };

function utcCalendarMonthsOverlapping(from: string, to: string): CalendarMonth[] {
  const start = utcDayStart(from);
  const end = utcDayStart(to);
  if (end < start) return [];
  const out: CalendarMonth[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    out.push({ year, month, days });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

/**
 * Clock the Smartlead subscription against a reporting window.
 *
 * Monthly views and longer ranges (28+ days) take the full list price once
 * per calendar month covered — a ~30-day "month" view that straddles two
 * months still counts as one month. Shorter views prorate
 * `price × (overlap days / days in that month)` for each calendar month
 * the range touches.
 */
export function clockSmartleadUsd(monthlyUsd: number, from: string, to: string): number {
  if (!(monthlyUsd > 0)) return 0;
  const months = utcCalendarMonthsOverlapping(from, to);
  if (months.length === 0) return 0;
  const days = inclusiveUtcDays(from, to);
  if (days >= SMARTLEAD_FULL_MONTH_DAYS) {
    if (days <= 31) return monthlyUsd;
    return monthlyUsd * months.length;
  }

  const start = utcDayStart(from);
  const end = utcDayStart(to);
  let total = 0;
  for (const month of months) {
    const monthStart = new Date(Date.UTC(month.year, month.month, 1));
    const monthEnd = new Date(Date.UTC(month.year, month.month + 1, 0));
    const overlapFrom = start > monthStart ? start : monthStart;
    const overlapTo = end < monthEnd ? end : monthEnd;
    const overlapDays = Math.floor((overlapTo.getTime() - overlapFrom.getTime()) / MS_PER_DAY) + 1;
    if (overlapDays > 0) total += monthlyUsd * (overlapDays / month.days);
  }
  return total;
}

/**
 * Split a clocked Smartlead fee by used send capacity.
 * `usedSends / capacitySends` is outreach; the rest is unused (wasted).
 */
export function allocateSmartleadByCapacity(input: {
  clockedUsd: number;
  usedSends: number;
  capacitySends: number;
}): { usedUsd: number; unusedUsd: number; usedRatio: number } {
  const clocked = Math.max(0, input.clockedUsd);
  if (!(clocked > 0)) return { usedUsd: 0, unusedUsd: 0, usedRatio: 0 };
  const usedSends = Math.max(0, input.usedSends);
  const capacity = Math.max(0, input.capacitySends);
  if (capacity <= 0) {
    return usedSends > 0
      ? { usedUsd: clocked, unusedUsd: 0, usedRatio: 1 }
      : { usedUsd: 0, unusedUsd: clocked, usedRatio: 0 };
  }
  const usedRatio = Math.min(1, usedSends / capacity);
  const usedUsd = clocked * usedRatio;
  return { usedUsd, unusedUsd: clocked - usedUsd, usedRatio };
}

/**
 * Writes this cycle's fixed fees if they are not already there. Idempotent via
 * the `(phase, source_kind, source_id, lead_id)` unique index, so calling it on
 * every reconcile tick costs one conflicting insert and nothing else.
 *
 * Each vendor is tagged with its **own** billing cycle. The two anchors are a
 * day apart, so on the 15th of a month the seats have rolled into the new cycle
 * while the Smartlead fee is still in the old one — which is exactly what the
 * invoices say.
 */
export async function recordCycleFixedCosts(day: string): Promise<number> {
  const pricing = await loadDeliveryPricing();
  let written = 0;

  if (pricing.smartleadPerMonthUsd > 0) {
    const cycle = cycleTag(day, pricing.smartleadBillingDay);
    written += await insertSubscriptionRow({
      sourceKind: 'smartlead_subscription',
      sourceId: cycle,
      amountUsd: pricing.smartleadPerMonthUsd,
      usage: { cycle, kind: 'smartlead_plan', billing_day: pricing.smartleadBillingDay },
    });
  }

  if (pricing.m365SeatPerMonthUsd > 0) {
    const cycle = cycleTag(day, pricing.m365BillingDay);
    const { rows } = await dbQuery<{ id: string; email: string }>(
      `SELECT id::text, email FROM outreach.sender_inboxes WHERE lifecycle_stage <> 'retired'`,
    );
    for (const inbox of rows) {
      written += await insertSubscriptionRow({
        sourceKind: 'm365_seat',
        sourceId: `${inbox.id}:${cycle}`,
        amountUsd: pricing.m365SeatPerMonthUsd,
        usage: {
          cycle,
          kind: 'm365_seat',
          mailbox: inbox.email,
          billing_day: pricing.m365BillingDay,
        },
      });
    }
  }

  return written;
}

async function insertSubscriptionRow(input: {
  sourceKind: string;
  sourceId: string;
  amountUsd: number;
  usage: Record<string, unknown>;
}): Promise<number> {
  const { rowCount } = await dbQuery(
    `INSERT INTO outreach.lead_cost_events
       (lead_id, campaign_id, phase, actual_cost_usd, usage, source_kind, source_id)
     VALUES (NULL, NULL, 'subscription', $1, $2::jsonb, $3, $4)
     ON CONFLICT (phase, source_kind, source_id,
                  coalesce(lead_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO NOTHING`,
    [input.amountUsd, JSON.stringify(input.usage), input.sourceKind, input.sourceId],
  );
  return rowCount ?? 0;
}

/** One verifier check — the only per-event delivery cost. */
export async function recordVerifierCheck(input: {
  leadId: string;
  campaignId?: string | null;
  checkId: string;
  costUsd?: number;
}): Promise<void> {
  const pricing = await loadDeliveryPricing();
  const cost = input.costUsd ?? pricing.verifierPerCheckUsd;
  await dbQuery(
    `INSERT INTO outreach.lead_cost_events
       (lead_id, campaign_id, phase, actual_cost_usd, usage, source_kind, source_id)
     VALUES ($1, $2, 'delivery', $3, '{}'::jsonb, 'verifier_check', $4)
     ON CONFLICT (phase, source_kind, source_id,
                  coalesce(lead_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO NOTHING`,
    [input.leadId, input.campaignId ?? null, cost, input.checkId],
  );
}

export type CycleAmortization = {
  cycle: string;
  fixedUsd: number;
  step1Sends: number;
  /** Always 0. The month is clocked as a lump, not a per-send slice. */
  perSendUsd: number;
};

/**
 * Loads Microsoft 365 seat lumps for overlapping billing cycles.
 * Smartlead is clocked separately via `clockSmartleadUsd` so it is not
 * mixed into this map.
 */
export async function loadCycleAmortization(
  from: string,
  to: string,
): Promise<Map<string, CycleAmortization>> {
  const pricing = await loadDeliveryPricing();
  const billingDay = pricing.m365BillingDay;

  const { rows: fixedRows } = await dbQuery<{ cycle: string; total: string }>(
    `SELECT split_part(source_id, ':', 2) AS cycle,
            sum(actual_cost_usd)::text AS total
       FROM outreach.lead_cost_events
      WHERE phase = 'subscription'
        AND source_kind = 'm365_seat'
      GROUP BY 1`,
  );

  const { rows: sendRows } = await dbQuery<{ day: string; n: string }>(
    `SELECT (sent_at AT TIME ZONE 'America/New_York')::date::text AS day, count(*)::text AS n
       FROM outreach.email_sends
      WHERE status = 'sent'
        AND provider = 'smartlead'
        AND sequence_number = 1
        AND sent_at >= $1::date
        AND sent_at < ($2::date + interval '1 day')
      GROUP BY 1`,
    [from, to],
  );

  const sendsByCycle = new Map<string, number>();
  for (const row of sendRows) {
    const cycle = cycleTag(row.day, billingDay);
    sendsByCycle.set(cycle, (sendsByCycle.get(cycle) ?? 0) + Number(row.n));
  }

  const out = new Map<string, CycleAmortization>();
  const cycles = new Set([...fixedRows.map((row) => row.cycle), ...sendsByCycle.keys()]);
  for (const cycle of cycles) {
    if (!cycle || !cycleOverlapsWindow(cycle, billingDay, from, to)) continue;
    const fixedUsd = fixedRows
      .filter((row) => row.cycle === cycle)
      .reduce((sum, row) => sum + Number(row.total), 0);
    const step1Sends = sendsByCycle.get(cycle) ?? 0;
    out.set(cycle, {
      cycle,
      fixedUsd,
      step1Sends,
      perSendUsd: 0,
    });
  }

  return out;
}

export type DeliveryCostSummary = {
  /** Microsoft 365 seat rows overlapping the window. */
  fixedUsd: number;
  /** Smartlead subscription clocked for this window (full or prorated). */
  smartleadUsd: number;
  /** `full` when the window is a month or longer; otherwise prorated. */
  smartleadClock: 'full' | 'prorated';
  /** Plan emails available in this window (same day-proration as the fee). */
  smartleadCapacity: number;
  /** Smartlead campaign sends in the window (every sequence step). */
  smartleadSends: number;
  /** `smartleadUsd × min(1, sends / capacity)` — outreach, not wasted. */
  smartleadUsedUsd: number;
  /** Remainder of the clocked fee — unused capacity. */
  smartleadUnusedUsd: number;
  smartleadUsedRatio: number;
  /** Verifier checks in the window. */
  perEventUsd: number;
  /** Legacy AgentMail sends, priced by the old constant. */
  legacyUsd: number;
  step1Sends: number;
  /** Unused. Fixed fees land in org totals as a lump, not a leftover. */
  unallocatedUsd: number;
  cycles: CycleAmortization[];
};

export async function loadDeliveryCostSummary(
  from: string,
  to: string,
): Promise<DeliveryCostSummary> {
  const [cycles, pricing, limits, sendCount] = await Promise.all([
    loadCycleAmortization(from, to).then((map) => [...map.values()]),
    loadDeliveryPricing(),
    getOrgSetting<PlanLimits>('smartlead.plan_limits', DEFAULT_PLAN_LIMITS),
    dbQuery<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM outreach.email_sends
        WHERE status = 'sent'
          AND provider = 'smartlead'
          AND sent_at >= $1::date
          AND sent_at < ($2::date + interval '1 day')`,
      [from, to],
    ),
  ]);
  const smartleadUsd = clockSmartleadUsd(pricing.smartleadPerMonthUsd, from, to);
  const smartleadClock = inclusiveUtcDays(from, to) >= SMARTLEAD_FULL_MONTH_DAYS
    ? 'full'
    : 'prorated';
  const smartleadSends = Number(sendCount.rows[0]?.n ?? 0);
  const smartleadCapacity = clockSmartleadUsd(limits.emails_per_month ?? 0, from, to);
  const allocated = allocateSmartleadByCapacity({
    clockedUsd: smartleadUsd,
    usedSends: smartleadSends,
    capacitySends: smartleadCapacity,
  });

  const { rows: verifier } = await dbQuery<{ total: string }>(
    `SELECT coalesce(sum(actual_cost_usd), 0)::text AS total
       FROM outreach.lead_cost_events
      WHERE phase = 'delivery'
        AND created_at >= $1::date
        AND created_at < ($2::date + interval '1 day')`,
    [from, to],
  );

  const { rows: legacy } = await dbQuery<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM outreach.email_sends
      WHERE status = 'sent'
        AND provider = 'agentmail'
        AND sent_at >= $1::date
        AND sent_at < ($2::date + interval '1 day')`,
    [from, to],
  );

  return {
    fixedUsd: cycles.reduce((sum, cycle) => sum + cycle.fixedUsd, 0),
    smartleadUsd,
    smartleadClock,
    smartleadCapacity,
    smartleadSends,
    smartleadUsedUsd: allocated.usedUsd,
    smartleadUnusedUsd: allocated.unusedUsd,
    smartleadUsedRatio: allocated.usedRatio,
    perEventUsd: Number(verifier[0]?.total ?? 0),
    legacyUsd: Number(legacy[0]?.n ?? 0) * LEGACY_AGENTMAIL_USD_PER_SEND,
    step1Sends: cycles.reduce((sum, cycle) => sum + cycle.step1Sends, 0),
    unallocatedUsd: 0,
    cycles,
  };
}

/** Per-lead delivery cost: verifier (and legacy AgentMail). The Smartlead month is clocked once at org level. */
export function leadDeliveryCostUsd(
  _cycles: Map<string, CycleAmortization>,
  input: { sentCycle: string | null; verifierUsd: number; provider: string },
): number {
  if (input.provider === 'agentmail') return LEGACY_AGENTMAIL_USD_PER_SEND + input.verifierUsd;
  return input.verifierUsd;
}
