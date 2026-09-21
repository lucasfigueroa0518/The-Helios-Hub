/**
 * Pure shapes for the inbox drawer Analytics pane.
 * Counts come from Smartlead warmup-stats, email_sends, and Postmaster rows.
 */
import { addCalendarDays } from '@/lib/drafting/send-queue-schedule';
import { toNumber } from '@/lib/smartlead/types';

export type Campaign7d = {
  sent: number;
  bounced: number;
  opened: number;
  clicked: number;
  replied: number;
  complained: number;
  bounce_rate: number | null;
  open_rate: number | null;
  click_rate: number | null;
  reply_rate: number | null;
  complaint_rate: number | null;
};

export type WarmupDay = {
  date: string;
  sent: number;
  replies: number;
  spam: number;
  inbox: number;
};

export type WarmupWindow = {
  days: number;
  sent: number;
  replies: number;
  spam: number;
  inbox: number;
  received: number;
  inbox_rate: number | null;
  spam_rate: number | null;
  by_date: WarmupDay[];
};

export type WarmupProgram = {
  enabled: boolean;
  status: string | null;
  blocked: boolean;
  blocked_reason: string | null;
  min_per_day: number | null;
  current_daily: number | null;
  max_per_day: number | null;
  daily_rampup: number;
  reply_rate_pct: number | null;
  reputation: number | null;
  started_at: string | null;
};

export type MailboxConnection = {
  healthy: boolean;
  smtp_ok: boolean | null;
  imap_ok: boolean | null;
  smtp_error: string | null;
  imap_error: string | null;
  suspended: boolean | null;
  status: string | null;
};

export type WarmupGrade = {
  label: string;
  tone: 'good' | 'watch' | 'poor' | 'unknown';
  copy: string;
};

export function campaignRates(counts: {
  sent: number;
  bounced: number;
  opened: number;
  clicked: number;
  replied: number;
  complained: number;
}): Campaign7d {
  const rate = (value: number): number | null => (counts.sent > 0 ? value / counts.sent : null);
  return {
    sent: counts.sent,
    bounced: counts.bounced,
    opened: counts.opened,
    clicked: counts.clicked,
    replied: counts.replied,
    complained: counts.complained,
    bounce_rate: rate(counts.bounced),
    open_rate: rate(counts.opened),
    click_rate: rate(counts.clicked),
    reply_rate: rate(counts.replied),
    complaint_rate: rate(counts.complained),
  };
}

export function normalizeWarmupDayDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function warmupDayFromStatsRow(row: {
  date?: unknown;
  sent_count?: unknown;
  sent?: unknown;
  reply_count?: unknown;
  replies?: unknown;
  save_from_spam_count?: unknown;
  spam?: unknown;
}): WarmupDay | null {
  const date = normalizeWarmupDayDate(row.date);
  if (!date) return null;
  const sent = Math.max(0, toNumber(row.sent_count ?? row.sent, 0));
  const replies = Math.max(0, toNumber(row.reply_count ?? row.replies, 0));
  const spam = Math.max(0, toNumber(row.save_from_spam_count ?? row.spam, 0));
  return {
    date,
    sent,
    replies,
    spam,
    inbox: Math.max(0, sent - spam),
  };
}

export function warmupDaysFromStats(
  rows: Array<{
    date?: unknown;
    sent_count?: unknown;
    sent?: unknown;
    reply_count?: unknown;
    replies?: unknown;
    save_from_spam_count?: unknown;
    spam?: unknown;
  }>,
): WarmupDay[] {
  const byDate = new Map<string, WarmupDay>();
  for (const row of rows) {
    const day = warmupDayFromStatsRow(row);
    if (!day) continue;
    byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function warmupWindowFromStats(
  rows: Array<{
    date?: unknown;
    sent_count?: unknown;
    sent?: unknown;
    reply_count?: unknown;
    replies?: unknown;
    save_from_spam_count?: unknown;
    spam?: unknown;
  }>,
  options: { until?: string; days?: number; received?: number } = {},
): WarmupWindow {
  const days = options.days ?? 7;
  const all = warmupDaysFromStats(rows);
  const until = options.until ?? all.at(-1)?.date ?? null;
  const since = until ? addCalendarDays(until, -(days - 1)) : null;
  const windowDays = since
    ? all.filter((row) => row.date >= since && row.date <= (until as string))
    : all;

  let sent = 0;
  let replies = 0;
  let spam = 0;
  let inbox = 0;
  for (const row of windowDays) {
    sent += row.sent;
    replies += row.replies;
    spam += row.spam;
    inbox += row.inbox;
  }
  return {
    days: windowDays.length,
    sent,
    replies,
    spam,
    inbox,
    received: Math.max(0, options.received ?? 0),
    inbox_rate: sent > 0 ? inbox / sent : null,
    spam_rate: sent > 0 ? spam / sent : null,
    by_date: windowDays,
  };
}

export function warmupWindowFromHealthRows(
  rows: Array<{
    day: string;
    sent: number | null;
    inbox: number | null;
    spam: number | null;
    replied: number | null;
    status: string;
  }>,
  options: { until: string; days?: number; received?: number } = { until: '' },
): WarmupWindow {
  return warmupWindowFromStats(
    rows
      .filter((row) => row.status === 'ok')
      .map((row) => ({
        date: row.day,
        sent_count: row.sent ?? 0,
        reply_count: row.replied ?? 0,
        save_from_spam_count: row.spam ?? 0,
      })),
    options,
  );
}

/** Smartlead's overview grade: Super when nearly everything lands in inbox. */
export function warmupPerformance(inboxRate: number | null, sent: number): WarmupGrade {
  if (sent <= 0 || inboxRate === null) {
    return {
      label: '—',
      tone: 'unknown',
      copy: 'No warmup mail in this window yet.',
    };
  }
  const pct = Math.round(inboxRate * 100);
  if (inboxRate >= 0.98) {
    return {
      label: 'Super',
      tone: 'good',
      copy: `${pct}% of warmup emails landed in inbox`,
    };
  }
  if (inboxRate >= 0.92) {
    return {
      label: 'Strong',
      tone: 'good',
      copy: `${pct}% of warmup emails landed in inbox`,
    };
  }
  if (inboxRate >= 0.8) {
    return {
      label: 'Watch',
      tone: 'watch',
      copy: `${pct}% of warmup emails landed in inbox`,
    };
  }
  return {
    label: 'Needs work',
    tone: 'poor',
    copy: `${pct}% of warmup emails landed in inbox`,
  };
}

export function connectionFromAccount(raw: Record<string, unknown> | null, status: string | null): MailboxConnection {
  const smtpOk = asBool(raw?.is_smtp_success);
  const imapOk = asBool(raw?.is_imap_success);
  const suspended = asBool(raw?.is_suspended);
  const smtpError = asString(raw?.smtp_failure_error);
  const imapError = asString(raw?.imap_failure_error);
  const healthy = (status === null || status === 'ok')
    && smtpOk !== false
    && imapOk !== false
    && suspended !== true;
  return {
    healthy,
    smtp_ok: smtpOk,
    imap_ok: imapOk,
    smtp_error: smtpError,
    imap_error: imapError,
    suspended,
    status,
  };
}

function asBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
