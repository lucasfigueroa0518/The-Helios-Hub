/**
 * The Smartlead reconcile tick (§5C).
 *
 * Everything here is repair work: catching what the webhook missed, unsticking
 * rows, refreshing the usage cache, and re-enqueueing the scheduled jobs. Each
 * step runs in its own try/catch so one failing step cannot stop the rest —
 * the same resilience contract as `handleReconcile`.
 */
import type { IdentitySlug } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { enqueueWork } from '@/lib/orchestration/repository';
import {
  getOrgSetting,
  setOrgSetting,
  type PlanLimits,
  type UsageCache,
} from '@/lib/org-settings';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { isSmartleadEnabled } from '@/lib/smartlead/enabled';
import {
  handoffAvailableAt,
  reclaimStaleHandoffs,
  replanHandoffs,
} from '@/lib/smartlead/handoff';
import { listUnfinishedLanes } from '@/lib/smartlead/lanes';
import { toNumber } from '@/lib/smartlead/types';
import { cycleStartFor, recordCycleFixedCosts } from '@/lib/smartlead/costs';

export type ReconcileReport = {
  skipped?: 'smartlead_disabled';
  day: string;
  lanesReenqueued: number;
  staleHandoffs: { completed: number; requeued: number };
  statisticsBackfilled: number;
  repliesRecovered: number;
  planned: { assigned: number; waiting: number };
  handoffJobsEnqueued: number;
  usage: UsageCache | null;
  costRowsWritten: number;
  scheduledJobs: string[];
  errors: Array<{ step: string; error: string }>;
};

export async function runSmartleadReconcile(
  options: { adapter?: SmartleadAdapter; now?: Date } = {},
): Promise<ReconcileReport> {
  const now = options.now ?? new Date();
  const day = formatNyDate(now);
  const report: ReconcileReport = {
    day,
    lanesReenqueued: 0,
    staleHandoffs: { completed: 0, requeued: 0 },
    statisticsBackfilled: 0,
    repliesRecovered: 0,
    planned: { assigned: 0, waiting: 0 },
    handoffJobsEnqueued: 0,
    usage: null,
    costRowsWritten: 0,
    scheduledJobs: [],
    errors: [],
  };

  if (!isSmartleadEnabled()) return { ...report, skipped: 'smartlead_disabled' };
  const adapter = options.adapter ?? smartleadAdapter;

  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      report.errors.push({
        step: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await step('lane_repair', async () => {
    for (const lane of await listUnfinishedLanes()) {
      await enqueueWork({
        kind: 'smartlead.lane_ensure',
        payload: { campaignId: lane.campaign_id, identitySlug: lane.identity_slug },
        dedupeKey: `lane:${lane.campaign_id}:${lane.identity_slug}`,
        scopeKey: lane.campaign_id,
        reviveTerminal: true,
      });
      report.lanesReenqueued += 1;
    }
  });

  await step('stale_handoffs', async () => {
    report.staleHandoffs = await reclaimStaleHandoffs(15, { adapter });
  });

  await step('statistics_backfill', async () => {
    report.statisticsBackfilled = await backfillMissingSends(adapter);
  });

  await step('message_history', async () => {
    report.repliesRecovered = await recoverMissedReplies(adapter);
  });

  await step('usage_cache', async () => {
    report.usage = await refreshUsageCache(adapter, day);
  });

  await step('cycle_costs', async () => {
    report.costRowsWritten = await recordCycleFixedCosts(day);
  });

  await step('plan', async () => {
    const planned = await replanHandoffs({ today: day });
    report.planned = { assigned: planned.assigned, waiting: planned.waiting };
  });

  await step('handoff_jobs', async () => {
    report.handoffJobsEnqueued = await enqueueDueHandoffs(day, now);
  });

  await step('scheduled_jobs', async () => {
    report.scheduledJobs = await enqueueScheduledJobs(day, now);
  });

  return report;
}

/**
 * Webhooks can be lost. Any row handed off more than 36 hours ago with no
 * recorded send gets one from Smartlead's own statistics, keyed so a later
 * webhook for the same step is a no-op.
 */
async function backfillMissingSends(adapter: SmartleadAdapter): Promise<number> {
  const { rows } = await dbQuery<{
    lane_id: string;
    smartlead_campaign_id: string;
    campaign_id: string;
  }>(
    `SELECT DISTINCT q.lane_id::text, lane.smartlead_campaign_id::text, lane.campaign_id::text
       FROM outreach.email_send_queue q
       JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.status = 'handed_off'
        AND q.handed_off_at < now() - interval '36 hours'
        AND lane.smartlead_campaign_id IS NOT NULL`,
  );

  const { applySmartleadEvent, normalizeSmartleadEvent } = await import('@/lib/smartlead/webhook');
  let applied = 0;

  for (const lane of rows) {
    const smartleadCampaignId = Number(lane.smartlead_campaign_id);
    const page = await adapter.campaignStatistics(smartleadCampaignId, 0, 200);
    for (const stat of page.data ?? []) {
      if (!stat.sent_time || !stat.lead_email) continue;
      const event = normalizeSmartleadEvent({
        event: 'EMAIL_SENT',
        campaign_id: smartleadCampaignId,
        sequence_number: toNumber(stat.sequence_number, 1),
        email_account_id: stat.email_account_id ? toNumber(stat.email_account_id) : undefined,
        timestamp: stat.sent_time,
        lead: { email: stat.lead_email },
        email: { subject: stat.email_subject, message_id: stat.stats_id },
        // Statistics rows carry no event id, so synthesize a stable one that a
        // webhook for the same step will collide with.
        event_id: `stats:${smartleadCampaignId}:${stat.lead_email}:${toNumber(stat.sequence_number, 1)}`,
      });
      if (!event) continue;
      const outcome = await applySmartleadEvent(event);
      if (outcome.applied) applied += 1;
    }
  }
  return applied;
}

/**
 * Pulls message history for threads that have a send but no inbound row, in
 * case a reply webhook was dropped.
 */
async function recoverMissedReplies(adapter: SmartleadAdapter): Promise<number> {
  const { rows } = await dbQuery<{
    smartlead_campaign_id: string;
    smartlead_lead_id: string;
    drafting_item_id: string;
  }>(
    `SELECT DISTINCT lane.smartlead_campaign_id::text,
            es.smartlead_lead_id::text,
            es.drafting_item_id::text
       FROM outreach.email_sends es
       JOIN outreach.campaign_lanes lane ON lane.id = es.lane_id
      WHERE es.status = 'sent'
        AND es.replied_at IS NOT NULL
        AND es.smartlead_lead_id IS NOT NULL
        AND lane.smartlead_campaign_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM outreach.inbound_emails inb
           WHERE inb.drafting_item_id = es.drafting_item_id
        )
      LIMIT 50`,
  );

  const { applySmartleadEvent, normalizeSmartleadEvent } = await import('@/lib/smartlead/webhook');
  let recovered = 0;

  for (const row of rows) {
    const history = await adapter.messageHistory(
      Number(row.smartlead_campaign_id),
      Number(row.smartlead_lead_id),
    );
    for (const message of history.history ?? []) {
      if (message.type !== 'REPLY' || !message.message_id) continue;
      const event = normalizeSmartleadEvent({
        event: 'EMAIL_REPLIED',
        campaign_id: Number(row.smartlead_campaign_id),
        lead_id: Number(row.smartlead_lead_id),
        sequence_number: toNumber(message.email_seq_number, 1),
        timestamp: message.time,
        reply: {
          subject: message.subject,
          body: message.email_body,
          message_id: message.message_id,
          received_at: message.time,
        },
        event_id: `history:${message.message_id}`,
      });
      if (!event) continue;
      const outcome = await applySmartleadEvent(event);
      if (outcome.applied) recovered += 1;
    }
  }
  return recovered;
}

/**
 * Monthly usage against the plan allowance. Warmup counts too, so the gauge
 * reflects what Smartlead actually bills against.
 */
async function refreshUsageCache(
  adapter: SmartleadAdapter,
  day: string,
): Promise<UsageCache> {
  const billingDay = await getOrgSetting<number>('smartlead.billing_day', 1);
  const cycleStart = cycleStartFor(day, billingDay);

  const { rows } = await dbQuery<{ sent: string; active: string }>(
    `SELECT count(*) FILTER (
              WHERE es.status = 'sent'
                AND es.provider = 'smartlead'
                AND es.sent_at >= $1::date
            )::text AS sent,
            (SELECT count(*)::text
               FROM outreach.email_send_queue q
              WHERE q.status IN ('handed_off', 'sent')
                AND q.handed_off_at >= $1::date) AS active
       FROM outreach.email_sends es`,
    [cycleStart],
  );

  let warmupSent = 0;
  const { rows: accounts } = await dbQuery<{ id: string }>(
    `SELECT smartlead_email_account_id::text AS id
       FROM outreach.sender_inboxes
      WHERE smartlead_email_account_id IS NOT NULL AND lifecycle_stage <> 'retired'`,
  );
  for (const account of accounts) {
    try {
      const stats = await adapter.warmupStats(Number(account.id));
      warmupSent += (stats.stats_by_date ?? [])
        .filter((entry) => entry.date >= cycleStart)
        .reduce((total, entry) => total + toNumber(entry.sent_count, 0), 0);
    } catch {
      // A single unreadable mailbox must not void the whole gauge.
    }
  }

  const usage: UsageCache = {
    cycle_start: cycleStart,
    sent: Number(rows[0]?.sent ?? 0),
    warmup_sent: warmupSent,
    active_leads: Number(rows[0]?.active ?? 0),
    fetched_at: new Date().toISOString(),
  };
  await setOrgSetting('smartlead.usage_cache', usage);
  return usage;
}

export { cycleStartFor } from '@/lib/smartlead/costs';

/** Queues today's and tomorrow's handoff jobs for every lane with demand. */
async function enqueueDueHandoffs(day: string, now: Date): Promise<number> {
  const tomorrow = addDays(day, 1);
  const { rows } = await dbQuery<{
    campaign_id: string;
    identity_slug: IdentitySlug;
    handoff_date: string;
  }>(
    `SELECT DISTINCT q.campaign_id::text, lane.identity_slug, q.handoff_date::text
       FROM outreach.email_send_queue q
       JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.status = 'queued'
        AND q.handoff_date IN ($1::date, $2::date)
        AND lane.status = 'ready'`,
    [day, tomorrow],
  );

  let enqueued = 0;
  for (const row of rows) {
    const availableAt = handoffAvailableAt(row.handoff_date);
    await enqueueWork({
      kind: 'smartlead.handoff',
      payload: {
        campaignId: row.campaign_id,
        identitySlug: row.identity_slug,
        handoffDate: row.handoff_date,
      },
      dedupeKey: `handoff:${row.campaign_id}:${row.identity_slug}:${row.handoff_date}`,
      scopeKey: row.campaign_id,
      availableAt: availableAt > now ? availableAt : now,
    });
    enqueued += 1;
  }
  return enqueued;
}

/**
 * The daily cadence: lifecycle after 06:00 NY, the health snapshot after 20:00
 * NY, Postmaster after 10:00 UTC. Dedupe keys are the day, so a second tick in
 * the same window is a no-op.
 */
async function enqueueScheduledJobs(day: string, now: Date): Promise<string[]> {
  const queued: string[] = [];
  const nyHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );

  if (nyHour >= 6) {
    await enqueueWork({
      kind: 'inbox.lifecycle_daily',
      payload: { dayKey: day },
      dedupeKey: day,
      scopeKey: 'inboxes',
    });
    queued.push('inbox.lifecycle_daily');
  }
  if (nyHour >= 20) {
    await enqueueWork({
      kind: 'inbox.health_snapshot',
      payload: { dayKey: day },
      dedupeKey: day,
      scopeKey: 'inboxes',
    });
    queued.push('inbox.health_snapshot');
  }
  if (now.getUTCHours() >= 10) {
    const utcDay = now.toISOString().slice(0, 10);
    await enqueueWork({
      kind: 'postmaster.daily',
      payload: { dayKey: utcDay },
      dedupeKey: utcDay,
      scopeKey: 'postmaster',
    });
    queued.push('postmaster.daily');
  }
  return queued;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export type { PlanLimits };
