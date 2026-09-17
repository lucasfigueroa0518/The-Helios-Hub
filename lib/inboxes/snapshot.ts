/**
 * Nightly `inbox.health_snapshot`: pulls Smartlead warmup counters and records
 * the day's forecast-versus-actual per mailbox.
 *
 * Two sources, two shapes, one table:
 *   `smartlead_warmup` fills the metric columns from Smartlead's counters;
 *   `forecast` leaves them NULL and puts the model's numbers in `detail`.
 *
 * Needs the API key, not the send kill switch — warmup counters should land
 * even while campaign sending is held off.
 */
import { dbQuery } from '@/lib/db';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { plannedPerMailbox, varianceFlag, type CapacityInbox } from '@/lib/inboxes/capacity';
import { listHealth, writeHealth } from '@/lib/inboxes/health';
import { toCapacityInbox } from '@/lib/inboxes/lifecycle';
import { listInboxes } from '@/lib/inboxes/repository';
import { DEFAULT_STAGE_PLAN } from '@/lib/inboxes/stage-plan';
import { getOrgSetting } from '@/lib/org-settings';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { hasSmartleadApiKey } from '@/lib/smartlead/enabled';
import { toNumber } from '@/lib/smartlead/types';

export type HealthSnapshotReport = {
  skipped?: 'smartlead_unconfigured';
  day: string;
  warmupRows: number;
  forecastRows: number;
  flagged: string[];
  errors: Array<{ email: string; error: string }>;
};

export async function runHealthSnapshot(
  dayKey?: string,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<HealthSnapshotReport> {
  const day = dayKey ?? formatNyDate();
  if (!hasSmartleadApiKey()) {
    return { skipped: 'smartlead_unconfigured', day, warmupRows: 0, forecastRows: 0, flagged: [], errors: [] };
  }

  const adapter = options.adapter ?? smartleadAdapter;
  const orgPlan = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
  const inboxes = await listInboxes();
  const report: HealthSnapshotReport = {
    day,
    warmupRows: 0,
    forecastRows: 0,
    flagged: [],
    errors: [],
  };

  const actuals = await actualSendsByInbox(day);
  const followups = await followupSendsByInbox(day);
  const planned = await plannedByInbox(inboxes, orgPlan, day);

  for (const inbox of inboxes) {
    try {
      if (inbox.smartlead_email_account_id !== null) {
        const stats = await adapter.warmupStats(inbox.smartlead_email_account_id);
        const today = stats.stats_by_date?.find((row) => row.date === day);

        // Smartlead reports per-day sent/reply/save_from_spam but only
        // account-lifetime inbox/spam totals. `save_from_spam_count` is the
        // per-day spam signal — mail that landed in spam and was rescued — so
        // the day's inbox count is what was sent and did not need rescuing.
        const sent = toNumber(today?.sent_count, 0);
        const spam = toNumber(today?.save_from_spam_count, 0);
        const inboxed = Math.max(0, sent - spam);

        await writeHealth({
          day,
          scope: 'inbox',
          scopeKey: inbox.id,
          source: 'smartlead_warmup',
          sent,
          inbox: inboxed,
          spam,
          replied: toNumber(today?.reply_count, 0),
          inboxRate: sent > 0 ? inboxed / sent : null,
          spamRate: sent > 0 ? spam / sent : null,
          status: today ? 'ok' : 'no_data',
          detail: {
            lifetime_sent: toNumber(stats.sent_count, 0),
            lifetime_inbox: toNumber(stats.inbox_count, 0),
            lifetime_spam: toNumber(stats.spam_count, 0),
            warmup_received: toNumber(stats.warmup_email_received_count, 0),
          },
        });
        report.warmupRows += 1;
      }

      const plannedToday = planned.get(inbox.id) ?? 0;
      const actualToday = actuals.get(inbox.id) ?? 0;
      const history = await recentForecast(inbox.id, day);
      const flagged = varianceFlag([...history, { planned: plannedToday, actual: actualToday }]);

      await writeHealth({
        day,
        scope: 'inbox',
        scopeKey: inbox.id,
        source: 'forecast',
        status: 'ok',
        detail: {
          planned: plannedToday,
          actual: actualToday,
          followups: followups.get(inbox.id) ?? 0,
          cap: inbox.sl_max_email_per_day ?? 0,
          variance_flag: flagged,
        },
      });
      report.forecastRows += 1;
      if (flagged) report.flagged.push(inbox.email);
    } catch (error) {
      report.errors.push({
        email: inbox.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

/** Step-1 sends attributed to each mailbox by Smartlead's own account id. */
async function actualSendsByInbox(day: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ inbox_id: string; n: string }>(
    `SELECT ib.id::text AS inbox_id, count(*)::text AS n
       FROM outreach.email_sends es
       JOIN outreach.sender_inboxes ib
         ON ib.smartlead_email_account_id = es.smartlead_email_account_id
      WHERE es.status = 'sent'
        AND es.sequence_number = 1
        AND (es.sent_at AT TIME ZONE 'America/New_York')::date = $1::date
      GROUP BY ib.id`,
    [day],
  );
  return new Map(rows.map((row) => [row.inbox_id, Number(row.n)]));
}

async function followupSendsByInbox(day: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ inbox_id: string; n: string }>(
    `SELECT ib.id::text AS inbox_id, count(*)::text AS n
       FROM outreach.email_sends es
       JOIN outreach.sender_inboxes ib
         ON ib.smartlead_email_account_id = es.smartlead_email_account_id
      WHERE es.status = 'sent'
        AND es.sequence_number > 1
        AND (es.sent_at AT TIME ZONE 'America/New_York')::date = $1::date
      GROUP BY ib.id`,
    [day],
  );
  return new Map(rows.map((row) => [row.inbox_id, Number(row.n)]));
}

/**
 * What the hub expected each mailbox to send: the identity's handoffs for the
 * day, split across its mailboxes in proportion to their caps.
 */
async function plannedByInbox(
  inboxes: Awaited<ReturnType<typeof listInboxes>>,
  orgPlan: unknown,
  day: string,
): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ identity_slug: string; n: string }>(
    `SELECT lane.identity_slug, count(*)::text AS n
       FROM outreach.email_send_queue q
       JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.handoff_date = $1::date
        AND q.status IN ('queued', 'handing_off', 'handed_off', 'sent')
      GROUP BY lane.identity_slug`,
    [day],
  );
  const plannedByIdentity = new Map(rows.map((row) => [row.identity_slug, Number(row.n)]));

  const out = new Map<string, number>();
  for (const [slug, total] of plannedByIdentity) {
    const capacityInboxes: CapacityInbox[] = await Promise.all(
      inboxes
        .filter((inbox) => inbox.identity_slug === slug)
        .map((inbox) => toCapacityInbox(inbox, orgPlan)),
    );
    for (const [id, value] of plannedPerMailbox(capacityInboxes, day, total)) {
      out.set(id, value);
    }
  }
  return out;
}

/** Yesterday's forecast row, so the flag needs two bad days rather than one. */
async function recentForecast(
  inboxId: string,
  day: string,
): Promise<Array<{ planned: number; actual: number }>> {
  const rows = await listHealth({
    scopeKeys: [inboxId],
    sources: ['forecast'],
    since: addDays(day, -2),
    until: addDays(day, -1),
  });
  return rows
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-1)
    .map((row) => ({
      planned: Number((row.detail as { planned?: number }).planned ?? 0),
      actual: Number((row.detail as { actual?: number }).actual ?? 0),
    }));
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}
