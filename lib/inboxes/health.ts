/**
 * `inbox_health_daily` — the deliverability time series behind lifecycle
 * decisions and the Inboxes tab.
 *
 * Column meaning is fixed per source. `smartlead_warmup` and `postmaster` fill
 * the metric columns; `forecast` leaves them NULL and puts
 * {planned, actual, followups, cap, variance_flag} in `detail`, so `sent` never
 * means two different things depending on who wrote the row.
 */
import type { HealthScope, HealthSource, HealthStatus } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';

export type HealthRow = {
  id: string;
  day: string;
  scope: HealthScope;
  scope_key: string;
  source: HealthSource;
  sent: number | null;
  inbox: number | null;
  spam: number | null;
  replied: number | null;
  bounced: number | null;
  inbox_rate: string | null;
  spam_rate: string | null;
  bounce_rate: string | null;
  reputation: string | null;
  spf_ratio: string | null;
  dkim_ratio: string | null;
  dmarc_ratio: string | null;
  status: HealthStatus;
  detail: Record<string, unknown>;
  fetched_at: string;
};

export type HealthWrite = {
  day: string;
  scope: HealthScope;
  scopeKey: string;
  source: HealthSource;
  sent?: number | null;
  inbox?: number | null;
  spam?: number | null;
  replied?: number | null;
  bounced?: number | null;
  inboxRate?: number | null;
  spamRate?: number | null;
  bounceRate?: number | null;
  reputation?: string | null;
  spfRatio?: number | null;
  dkimRatio?: number | null;
  dmarcRatio?: number | null;
  status?: HealthStatus;
  detail?: Record<string, unknown>;
};

/** Upsert on (day, scope, scope_key, source) so a re-run refreshes in place. */
export async function writeHealth(row: HealthWrite): Promise<void> {
  await dbQuery(
    `INSERT INTO outreach.inbox_health_daily
       (day, scope, scope_key, source, sent, inbox, spam, replied, bounced,
        inbox_rate, spam_rate, bounce_rate, reputation,
        spf_ratio, dkim_ratio, dmarc_ratio, status, detail, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, now())
     ON CONFLICT (day, scope, scope_key, source) DO UPDATE
        SET sent = EXCLUDED.sent,
            inbox = EXCLUDED.inbox,
            spam = EXCLUDED.spam,
            replied = EXCLUDED.replied,
            bounced = EXCLUDED.bounced,
            inbox_rate = EXCLUDED.inbox_rate,
            spam_rate = EXCLUDED.spam_rate,
            bounce_rate = EXCLUDED.bounce_rate,
            reputation = EXCLUDED.reputation,
            spf_ratio = EXCLUDED.spf_ratio,
            dkim_ratio = EXCLUDED.dkim_ratio,
            dmarc_ratio = EXCLUDED.dmarc_ratio,
            status = EXCLUDED.status,
            detail = EXCLUDED.detail,
            fetched_at = now()`,
    [
      row.day,
      row.scope,
      row.scopeKey,
      row.source,
      row.sent ?? null,
      row.inbox ?? null,
      row.spam ?? null,
      row.replied ?? null,
      row.bounced ?? null,
      row.inboxRate ?? null,
      row.spamRate ?? null,
      row.bounceRate ?? null,
      row.reputation ?? null,
      row.spfRatio ?? null,
      row.dkimRatio ?? null,
      row.dmarcRatio ?? null,
      row.status ?? 'ok',
      JSON.stringify(row.detail ?? {}),
    ],
  );
}

export async function writeHealthBatch(rows: HealthWrite[]): Promise<void> {
  for (const row of rows) await writeHealth(row);
}

export async function listHealth(filter: {
  scopeKeys: string[];
  sources?: HealthSource[];
  since: string;
  until?: string;
}): Promise<HealthRow[]> {
  const params: unknown[] = [filter.scopeKeys, filter.since];
  let sql = `SELECT id::text, to_char(day, 'YYYY-MM-DD') AS day, scope, scope_key, source,
                    sent, inbox, spam, replied, bounced,
                    inbox_rate, spam_rate, bounce_rate, reputation,
                    spf_ratio, dkim_ratio, dmarc_ratio, status, detail, fetched_at
               FROM outreach.inbox_health_daily
              WHERE scope_key = ANY($1::text[]) AND day >= $2::date`;
  if (filter.until) {
    params.push(filter.until);
    sql += ` AND day <= $${params.length}::date`;
  }
  if (filter.sources?.length) {
    params.push(filter.sources);
    sql += ` AND source = ANY($${params.length}::text[])`;
  }
  sql += ' ORDER BY day DESC';
  const { rows } = await dbQuery<HealthRow>(sql, params);
  return rows;
}

/** Most recent row per (scope_key, source) — what the roster renders. */
export async function latestHealthByScope(
  scopeKeys: string[],
): Promise<Map<string, Partial<Record<HealthSource, HealthRow>>>> {
  if (!scopeKeys.length) return new Map();
  const { rows } = await dbQuery<HealthRow>(
    `SELECT DISTINCT ON (scope_key, source)
            id::text, to_char(day, 'YYYY-MM-DD') AS day, scope, scope_key, source,
            sent, inbox, spam, replied, bounced,
            inbox_rate, spam_rate, bounce_rate, reputation,
            spf_ratio, dkim_ratio, dmarc_ratio, status, detail, fetched_at
       FROM outreach.inbox_health_daily
      WHERE scope_key = ANY($1::text[])
      ORDER BY scope_key, source, day DESC`,
    [scopeKeys],
  );
  const out = new Map<string, Partial<Record<HealthSource, HealthRow>>>();
  for (const row of rows) {
    const entry = out.get(row.scope_key) ?? {};
    entry[row.source] = row;
    out.set(row.scope_key, entry);
  }
  return out;
}

export type HealthWindow = {
  days: number;
  sent: number;
  inbox: number;
  spam: number;
  replied: number;
  bounced: number;
  /** null when the window holds no data at all — not the same as a zero rate. */
  inboxRate: number | null;
  spamRate: number | null;
  bounceRate: number | null;
};

/** Rolls up `ok` rows from one source; `no_data` days are skipped, not zeroed. */
export function summarizeWindow(rows: HealthRow[], source: HealthSource): HealthWindow {
  const usable = rows.filter((row) => row.source === source && row.status === 'ok');
  const sum = (pick: (row: HealthRow) => number | null) =>
    usable.reduce((total, row) => total + (pick(row) ?? 0), 0);

  const sent = sum((row) => row.sent);
  const inbox = sum((row) => row.inbox);
  const spam = sum((row) => row.spam);
  const replied = sum((row) => row.replied);
  const bounced = sum((row) => row.bounced);

  return {
    days: usable.length,
    sent,
    inbox,
    spam,
    replied,
    bounced,
    inboxRate: sent > 0 ? inbox / sent : null,
    spamRate: sent > 0 ? spam / sent : null,
    bounceRate: sent > 0 ? bounced / sent : null,
  };
}

/**
 * Latest Postmaster reputation for a domain.
 *
 * Google only publishes stats above an undisclosed daily volume to Gmail
 * recipients, so at ~12 sends per mailbox per day `no_data` is the expected
 * reading — possibly for weeks. Returning null for it keeps the caller honest:
 * lifecycle treats null as neutral rather than as a failing grade.
 */
export function latestReputation(rows: HealthRow[]): string | null {
  const withData = rows
    .filter((row) => row.source === 'postmaster' && row.status === 'ok' && row.reputation)
    .sort((a, b) => b.day.localeCompare(a.day));
  return withData[0]?.reputation ?? null;
}
