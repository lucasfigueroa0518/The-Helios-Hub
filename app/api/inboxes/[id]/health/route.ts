import { NextRequest } from 'next/server';

import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import { dbQuery } from '@/lib/db';
import { addCalendarDays, formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { stageCap } from '@/lib/inboxes/capacity';
import {
  campaignRates,
  connectionFromAccount,
  warmupWindowFromHealthRows,
  warmupWindowFromStats,
  type Campaign7d,
  type MailboxConnection,
  type WarmupProgram,
  type WarmupWindow,
} from '@/lib/inboxes/drawer-analytics';
import { listHealth } from '@/lib/inboxes/health';
import { toCapacityInbox } from '@/lib/inboxes/lifecycle';
import { getInboxById } from '@/lib/inboxes/repository';
import {
  actualTotals,
  buildSendSeries,
  SEND_SERIES_FUTURE_DAYS,
  SEND_SERIES_PAST_DAYS,
  type WarmupRamp,
} from '@/lib/inboxes/send-series';
import { DEFAULT_STAGE_PLAN, resolveStagePlan } from '@/lib/inboxes/stage-plan';
import { ingestedFromStats, persistWarmupDays } from '@/lib/inboxes/warmup-sync';
import { getOrgSetting } from '@/lib/org-settings';
import { getSession } from '@/lib/session';
import { getEmailAccount, warmupStats } from '@/lib/smartlead/adapter';
import { hasSmartleadApiKey } from '@/lib/smartlead/enabled';
import {
  normalizeWarmupDetails,
  type SmartleadWarmupDetails,
} from '@/lib/smartlead/types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Health trend for one mailbox, plus a live 15-day warmup/campaign series
 * fetched when the drawer opens — not on the roster list GET.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  const inbox = await getInboxById(id);
  if (!inbox) return draftingJson({ error: 'Inbox not found' }, 404);

  const requested = Number(request.nextUrl.searchParams.get('days') ?? 30);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, Math.floor(requested))) : 30;
  const today = formatNyDate();

  try {
    const orgPlan = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
    const plan = resolveStagePlan(orgPlan, inbox.stage_plan);
    const [rows, campaignByDate, campaign7d, liveWarmup] = await Promise.all([
      listHealth({
        scopeKeys: [inbox.id, inbox.domain],
        since: addCalendarDays(today, -days),
      }),
      campaignSendsByDate(
        inbox.smartlead_email_account_id,
        addCalendarDays(today, -SEND_SERIES_PAST_DAYS),
        today,
      ),
      campaignEngagement7d(
        inbox.smartlead_email_account_id,
        addCalendarDays(today, -6),
        today,
      ),
      loadLiveWarmup(
        inbox.id,
        inbox.smartlead_email_account_id,
        plan.warming.warmup_rampup,
        today,
      ),
    ]);

    const capacityInbox = await toCapacityInbox(inbox, orgPlan);
    const campaignCapacityByDate: Record<string, number> = {};
    for (let offset = 1; offset <= SEND_SERIES_FUTURE_DAYS; offset += 1) {
      const date = addCalendarDays(today, offset);
      campaignCapacityByDate[date] = stageCap(capacityInbox, date);
    }

    const warmupRamp: WarmupRamp = {
      enabled: liveWarmup.program.enabled,
      currentDaily: liveWarmup.program.current_daily
        ?? inbox.sl_warmup_total_per_day
        ?? 0,
      maxPerDay: liveWarmup.program.max_per_day ?? plan.warming.warmup_target,
      dailyRampup: plan.warming.warmup_rampup,
    };

    const storedWarmup = rows.filter((row) => row.source === 'smartlead_warmup');
    const liveWindow = liveWarmup.window.sent > 0
      ? liveWarmup.window
      : warmupWindowFromHealthRows(storedWarmup, {
        until: today,
        days: 7,
        received: liveWarmup.lifetime?.received ?? 0,
      });
    const liveByDate = Object.keys(liveWarmup.byDate).length
      ? liveWarmup.byDate
      : Object.fromEntries(storedWarmup.map((row) => [row.day, Number(row.sent ?? 0)]));

    const series = buildSendSeries({
      today,
      warmupByDate: liveByDate,
      warmupRamp,
      campaignByDate,
      campaignCapacityByDate,
    });

    const postmasterRows = rows.filter((row) => row.source === 'postmaster');
    const postmasterLatest = postmasterRows.find((row) => row.status === 'ok') ?? postmasterRows[0] ?? null;

    return draftingJson({
      inbox_id: inbox.id,
      email: inbox.email,
      domain: inbox.domain,
      days,
      warmup: storedWarmup,
      postmaster: postmasterRows,
      postmaster_latest: postmasterLatest,
      forecast: rows.filter((row) => row.source === 'forecast'),
      series,
      series_totals: actualTotals(series),
      campaign_7d: campaign7d,
      warmup_program: liveWarmup.program.enabled || liveWarmup.program.status
        ? liveWarmup.program
        : {
            ...liveWarmup.program,
            enabled: inbox.sl_warmup_enabled === true,
            current_daily: inbox.sl_warmup_total_per_day,
            reply_rate_pct: inbox.sl_warmup_reply_rate,
            reputation: inbox.sl_warmup_reputation,
          },
      warmup_7d: liveWindow,
      warmup_lifetime: liveWarmup.lifetime,
      connection: liveWarmup.connection ?? connectionFromAccount(inbox.sl_raw, inbox.sl_status),
    });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}

async function campaignSendsByDate(
  accountId: number | null,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (accountId === null) return {};
  const { rows } = await dbQuery<{ date: string; sent: number }>(
    `SELECT (es.sent_at AT TIME ZONE 'America/New_York')::date::text AS date,
            count(*)::int AS sent
       FROM outreach.email_sends es
      WHERE es.smartlead_email_account_id = $1
        AND es.status = 'sent'
        AND es.sent_at >= ($2::date AT TIME ZONE 'America/New_York')
        AND es.sent_at < (($3::date + 1) AT TIME ZONE 'America/New_York')
      GROUP BY 1`,
    [accountId, from, to],
  );
  return Object.fromEntries(rows.map((row) => [row.date, Number(row.sent)]));
}

async function campaignEngagement7d(
  accountId: number | null,
  from: string,
  to: string,
): Promise<Campaign7d> {
  const empty = campaignRates({
    sent: 0, bounced: 0, opened: 0, clicked: 0, replied: 0, complained: 0,
  });
  if (accountId === null) return empty;
  const { rows } = await dbQuery<{
    sent: number;
    bounced: number;
    opened: number;
    clicked: number;
    replied: number;
    complained: number;
  }>(
    `SELECT count(*)::int AS sent,
            count(*) FILTER (WHERE bounced_at IS NOT NULL)::int AS bounced,
            count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
            count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
            count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied,
            count(*) FILTER (WHERE complained_at IS NOT NULL)::int AS complained
       FROM outreach.email_sends
      WHERE smartlead_email_account_id = $1
        AND status = 'sent'
        AND sent_at >= ($2::date AT TIME ZONE 'America/New_York')
        AND sent_at < (($3::date + 1) AT TIME ZONE 'America/New_York')`,
    [accountId, from, to],
  );
  const row = rows[0];
  return campaignRates({
    sent: Number(row?.sent ?? 0),
    bounced: Number(row?.bounced ?? 0),
    opened: Number(row?.opened ?? 0),
    clicked: Number(row?.clicked ?? 0),
    replied: Number(row?.replied ?? 0),
    complained: Number(row?.complained ?? 0),
  });
}

async function loadLiveWarmup(
  inboxId: string,
  accountId: number | null,
  dailyRampup: number,
  today: string,
): Promise<{
  byDate: Record<string, number>;
  program: WarmupProgram;
  window: WarmupWindow;
  lifetime: { sent: number; inbox: number; spam: number; received: number } | null;
  connection: MailboxConnection | null;
}> {
  const emptyProgram: WarmupProgram = {
    enabled: false,
    status: null,
    blocked: false,
    blocked_reason: null,
    min_per_day: null,
    current_daily: null,
    max_per_day: null,
    daily_rampup: dailyRampup,
    reply_rate_pct: null,
    reputation: null,
    started_at: null,
  };
  const empty = {
    byDate: {},
    program: emptyProgram,
    window: warmupWindowFromStats([], { until: today }),
    lifetime: null as { sent: number; inbox: number; spam: number; received: number } | null,
    connection: null as MailboxConnection | null,
  };
  if (accountId === null || !hasSmartleadApiKey()) return empty;

  const [statsResult, accountResult] = await Promise.allSettled([
    warmupStats(accountId),
    getEmailAccount(accountId),
  ]);

  const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
  let byDate: Record<string, number> = {};
  let window = empty.window;
  let lifetime = empty.lifetime;
  if (stats) {
    const ingested = ingestedFromStats(stats, today);
    byDate = ingested.byDate;
    window = ingested.window;
    lifetime = ingested.lifetime;
    await persistWarmupDays(inboxId, ingested).catch(() => 0);
  }

  if (accountResult.status !== 'fulfilled') {
    return { ...empty, byDate, window, lifetime };
  }

  const account = accountResult.value;
  const details = normalizeWarmupDetails(
    account.warmup_details as SmartleadWarmupDetails | null,
  );
  const program: WarmupProgram = {
    enabled: details ? details.status === 'ACTIVE' : false,
    status: details?.status ?? null,
    blocked: details?.blocked ?? false,
    blocked_reason: details?.blockedReason ?? null,
    min_per_day: details?.minPerDay ?? null,
    current_daily: details?.maxEmailPerDay ?? details?.minPerDay ?? null,
    max_per_day: details?.maxPerDay ?? null,
    daily_rampup: dailyRampup,
    reply_rate_pct: details?.replyRatePct ?? null,
    reputation: details?.reputationPct ?? null,
    started_at: details?.createdAt ?? null,
  };

  return {
    byDate,
    window,
    lifetime,
    program,
    connection: connectionFromAccount(
      account as unknown as Record<string, unknown>,
      account.is_smtp_success && account.is_imap_success ? 'ok' : 'error',
    ),
  };
}
