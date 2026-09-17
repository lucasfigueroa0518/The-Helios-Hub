/**
 * Pure shapes for the inbox drawer Analytics pane.
 * Counts come from Smartlead warmup-stats, email_sends, and Postmaster rows.
 */

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

export type WarmupWindow = {
  days: number;
  sent: number;
  replies: number;
  spam: number;
  inbox: number;
  inbox_rate: number | null;
  spam_rate: number | null;
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

export function warmupWindowFromStats(
  rows: Array<{ sent_count?: number; reply_count?: number; save_from_spam_count?: number }>,
): WarmupWindow {
  let sent = 0;
  let replies = 0;
  let spam = 0;
  for (const row of rows) {
    sent += Number(row.sent_count ?? 0);
    replies += Number(row.reply_count ?? 0);
    spam += Number(row.save_from_spam_count ?? 0);
  }
  const inbox = Math.max(0, sent - spam);
  return {
    days: rows.length,
    sent,
    replies,
    spam,
    inbox,
    inbox_rate: sent > 0 ? inbox / sent : null,
    spam_rate: sent > 0 ? spam / sent : null,
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
