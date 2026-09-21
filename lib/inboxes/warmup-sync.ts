/**
 * Pull Smartlead warmup-stats into `inbox_health_daily` so the roster and
 * drawer do not wait on the nightly snapshot (which used to be trapped behind
 * the send kill switch).
 */
import { writeHealth } from '@/lib/inboxes/health';
import {
  warmupDaysFromStats,
  warmupWindowFromStats,
  type WarmupDay,
  type WarmupWindow,
} from '@/lib/inboxes/drawer-analytics';
import type { InboxRow } from '@/lib/inboxes/repository';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { hasSmartleadApiKey } from '@/lib/smartlead/enabled';
import { toNumber, type SmartleadWarmupStats } from '@/lib/smartlead/types';
import { dbQuery } from '@/lib/db';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';

const FRESH_MS = 15 * 60 * 1000;

export type WarmupLifetime = {
  sent: number;
  inbox: number;
  spam: number;
  received: number;
};

export type IngestedWarmup = {
  days: WarmupDay[];
  window: WarmupWindow;
  lifetime: WarmupLifetime;
  byDate: Record<string, number>;
};

export function lifetimeFromStats(stats: SmartleadWarmupStats): WarmupLifetime {
  return {
    sent: toNumber(stats.sent_count, 0),
    inbox: toNumber(stats.inbox_count, 0),
    spam: toNumber(stats.spam_count, 0),
    received: toNumber(stats.warmup_email_received_count, 0),
  };
}

export function ingestedFromStats(
  stats: SmartleadWarmupStats,
  until = formatNyDate(),
): IngestedWarmup {
  const days = warmupDaysFromStats(stats.stats_by_date ?? []);
  const lifetime = lifetimeFromStats(stats);
  const window = warmupWindowFromStats(days, {
    until,
    days: 7,
    received: lifetime.received,
  });
  const byDate: Record<string, number> = {};
  for (const day of days) byDate[day.date] = day.sent;
  return { days, window, lifetime, byDate };
}

export async function persistWarmupDays(
  inboxId: string,
  ingested: IngestedWarmup,
): Promise<number> {
  if (ingested.days.length === 0) {
    await writeHealth({
      day: formatNyDate(),
      scope: 'inbox',
      scopeKey: inboxId,
      source: 'smartlead_warmup',
      sent: 0,
      inbox: 0,
      spam: 0,
      replied: 0,
      status: 'no_data',
      detail: {
        lifetime_sent: ingested.lifetime.sent,
        lifetime_inbox: ingested.lifetime.inbox,
        lifetime_spam: ingested.lifetime.spam,
        warmup_received: ingested.lifetime.received,
      },
    });
    return 0;
  }

  for (const day of ingested.days) {
    await writeHealth({
      day: day.date,
      scope: 'inbox',
      scopeKey: inboxId,
      source: 'smartlead_warmup',
      sent: day.sent,
      inbox: day.inbox,
      spam: day.spam,
      replied: day.replies,
      inboxRate: day.sent > 0 ? day.inbox / day.sent : null,
      spamRate: day.sent > 0 ? day.spam / day.sent : null,
      status: 'ok',
      detail: {
        lifetime_sent: ingested.lifetime.sent,
        lifetime_inbox: ingested.lifetime.inbox,
        lifetime_spam: ingested.lifetime.spam,
        warmup_received: ingested.lifetime.received,
      },
    });
  }
  return ingested.days.length;
}

export async function ingestAccountWarmup(
  inboxId: string,
  accountId: number,
  options: { adapter?: SmartleadAdapter; until?: string } = {},
): Promise<IngestedWarmup> {
  const adapter = options.adapter ?? smartleadAdapter;
  const stats = await adapter.warmupStats(accountId);
  const ingested = ingestedFromStats(stats, options.until ?? formatNyDate());
  await persistWarmupDays(inboxId, ingested);
  return ingested;
}

export async function warmupHealthIsFresh(inboxIds: string[]): Promise<boolean> {
  if (!inboxIds.length) return true;
  const { rows } = await dbQuery<{ fetched_at: string | null }>(
    `SELECT max(fetched_at) AS fetched_at
       FROM outreach.inbox_health_daily
      WHERE source = 'smartlead_warmup'
        AND scope_key = ANY($1::text[])`,
    [inboxIds],
  );
  const fetchedAt = rows[0]?.fetched_at;
  if (!fetchedAt) return false;
  const age = Date.now() - new Date(fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < FRESH_MS;
}

/**
 * Best-effort live pull for linked mailboxes. Failures on one account must not
 * blank the rest of the roster.
 */
export async function syncWarmupHealthIfStale(
  inboxes: InboxRow[],
  options: { adapter?: SmartleadAdapter; force?: boolean } = {},
): Promise<{ refreshed: number; errors: number }> {
  if (!hasSmartleadApiKey()) return { refreshed: 0, errors: 0 };
  const linked = inboxes.filter((inbox) => inbox.smartlead_email_account_id !== null);
  if (!linked.length) return { refreshed: 0, errors: 0 };
  if (!options.force && await warmupHealthIsFresh(linked.map((inbox) => inbox.id))) {
    return { refreshed: 0, errors: 0 };
  }

  const adapter = options.adapter ?? smartleadAdapter;
  let refreshed = 0;
  let errors = 0;
  await Promise.all(linked.map(async (inbox) => {
    try {
      await ingestAccountWarmup(inbox.id, inbox.smartlead_email_account_id as number, {
        adapter,
      });
      refreshed += 1;
    } catch {
      errors += 1;
    }
  }));
  return { refreshed, errors };
}
