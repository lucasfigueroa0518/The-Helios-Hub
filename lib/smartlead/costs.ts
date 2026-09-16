/**
 * Delivery costs (§5H).
 *
 * The Smartlead subscription and the Microsoft 365 seats are fixed monthly
 * fees, so they are written **once per billing cycle** as `phase='subscription'`
 * rows with no `lead_id`, and divided at read time by that cycle's actual
 * step-1 sends. Writing a per-send row would charge the same fee twice: once in
 * the subscription row and again per email.
 *
 * The only per-event delivery cost is a verifier check.
 */
import { dbQuery } from '@/lib/db';
import { countBillableSeats } from '@/lib/inboxes/repository';
import { getOrgSettings } from '@/lib/org-settings';
import { cycleStartFor } from '@/lib/smartlead/reconcile';

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
export const LEGACY_AGENTMAIL_USD_PER_SEND = 0.004;

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

/** `YYYY-MM` tag for the cycle that contains `day`. */
export function cycleTag(day: string, billingDay: number): string {
  return cycleStartFor(day, billingDay).slice(0, 7);
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
  /** Fixed cost attributable to one step-1 send in this cycle. */
  perSendUsd: number;
};

/**
 * Divides each cycle's fixed fees by that cycle's actual step-1 sends.
 *
 * A cycle with no sends has `perSendUsd = 0` and keeps its whole fixed cost
 * unallocated, which is truthful: the money was spent and no lead caused it.
 * Because the fee is stored once and divided here, per-lead figures and the
 * monthly total always reconcile.
 */
export async function loadCycleAmortization(
  from: string,
  to: string,
): Promise<Map<string, CycleAmortization>> {
  // Sends are the denominator, so the reporting cycle follows the send
  // platform's anchor. Seat rows tagged to the same month join that cycle.
  const billingDay = (await loadDeliveryPricing()).smartleadBillingDay;

  const { rows: fixedRows } = await dbQuery<{ cycle: string; total: string }>(
    `SELECT CASE
              WHEN source_kind = 'smartlead_subscription' THEN source_id
              ELSE split_part(source_id, ':', 2)
            END AS cycle,
            sum(actual_cost_usd)::text AS total
       FROM outreach.lead_cost_events
      WHERE phase = 'subscription'
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
    const fixedUsd = fixedRows
      .filter((row) => row.cycle === cycle)
      .reduce((sum, row) => sum + Number(row.total), 0);
    const step1Sends = sendsByCycle.get(cycle) ?? 0;
    out.set(cycle, {
      cycle,
      fixedUsd,
      step1Sends,
      perSendUsd: step1Sends > 0 ? fixedUsd / step1Sends : 0,
    });
  }
  return out;
}

export type DeliveryCostSummary = {
  /** Subscription rows in the window, shown as fixed lines. */
  fixedUsd: number;
  /** Verifier checks in the window. */
  perEventUsd: number;
  /** Legacy AgentMail sends, priced by the old constant. */
  legacyUsd: number;
  step1Sends: number;
  /** Fixed spend from cycles with no sends, attributed to nothing. */
  unallocatedUsd: number;
  cycles: CycleAmortization[];
};

export async function loadDeliveryCostSummary(
  from: string,
  to: string,
): Promise<DeliveryCostSummary> {
  const cycles = [...(await loadCycleAmortization(from, to)).values()];

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
    perEventUsd: Number(verifier[0]?.total ?? 0),
    legacyUsd: Number(legacy[0]?.n ?? 0) * LEGACY_AGENTMAIL_USD_PER_SEND,
    step1Sends: cycles.reduce((sum, cycle) => sum + cycle.step1Sends, 0),
    unallocatedUsd: cycles
      .filter((cycle) => cycle.step1Sends === 0)
      .reduce((sum, cycle) => sum + cycle.fixedUsd, 0),
    cycles,
  };
}

/** Per-lead delivery cost: its cycle's amortized share plus its own verifier rows. */
export function leadDeliveryCostUsd(
  cycles: Map<string, CycleAmortization>,
  input: { sentCycle: string | null; verifierUsd: number; provider: string },
): number {
  if (input.provider === 'agentmail') return LEGACY_AGENTMAIL_USD_PER_SEND + input.verifierUsd;
  const amortized = input.sentCycle ? cycles.get(input.sentCycle)?.perSendUsd ?? 0 : 0;
  return amortized + input.verifierUsd;
}
