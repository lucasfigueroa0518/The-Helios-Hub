/**
 * Typed access to `outreach.org_settings`, the single-row-per-key jsonb store
 * that holds delivery policy: plan limits, pricing, the lifecycle stage plan,
 * the domain rest clock, and the Smartlead usage cache.
 *
 * Reads are forgiving by design — a missing or malformed key falls back to the
 * supplied default rather than failing a send.
 */
import { dbQuery } from '@/lib/db';

export type OrgSettingKey =
  | 'daily_inbox_cap'
  | 'stage_plan.default'
  | 'domains'
  | 'postmaster.domains'
  | 'smartlead.plan_limits'
  | 'smartlead.billing_day'
  | 'smartlead.pricing'
  | 'smartlead.webhook'
  | 'smartlead.usage_cache'
  | 'smartlead.accounts_cache'
  | 'smartlead.cutover_report'
  | 'm365.pricing'
  | 'verifier.pricing';

export async function getOrgSetting<T>(key: OrgSettingKey, fallback: T): Promise<T> {
  const { rows } = await dbQuery<{ value: unknown }>(
    'SELECT value FROM outreach.org_settings WHERE key = $1',
    [key],
  );
  const value = rows[0]?.value;
  return value === undefined || value === null ? fallback : (value as T);
}

/** Loads several keys in one round trip; the planner reads four at a time. */
export async function getOrgSettings(
  keys: OrgSettingKey[],
): Promise<Map<OrgSettingKey, unknown>> {
  const { rows } = await dbQuery<{ key: OrgSettingKey; value: unknown }>(
    'SELECT key, value FROM outreach.org_settings WHERE key = ANY($1::text[])',
    [keys],
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function setOrgSetting(key: OrgSettingKey, value: unknown): Promise<void> {
  await dbQuery(
    `INSERT INTO outreach.org_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value ?? null)],
  );
}

// ── Typed shapes for the delivery keys ──────────────────────────────────────

export type PlanLimits = { emails_per_month: number; active_leads: number };
export const DEFAULT_PLAN_LIMITS: PlanLimits = { emails_per_month: 0, active_leads: 0 };

export type UsageCache = {
  cycle_start?: string;
  sent?: number;
  warmup_sent?: number;
  active_leads?: number;
  fetched_at?: string;
};

export type AccountsCache = {
  fetched_at?: string;
  /** Smartlead accounts with no matching sender_inboxes row, for the claim action. */
  unassigned?: Array<{ id: number; from_email: string; from_name: string | null }>;
};

export type WebhookSettings = {
  /** Fixed at S0: Smartlead publishes no payload signature. */
  mode: 'hmac' | 'path_token' | 'ip_allowlist';
  url?: string;
  events?: string[];
  allowed_ips?: string[];
  /** Registered hook id per Smartlead campaign id. */
  registrations?: Record<string, number>;
};

export type DomainRest = {
  rested_since: string | null;
  min_rest_days: number;
  notes?: string;
};
export type DomainRestClock = Record<string, DomainRest>;

export const DEFAULT_MIN_REST_DAYS = 10;

export async function getDomainRestClock(): Promise<DomainRestClock> {
  return getOrgSetting<DomainRestClock>('domains', {});
}

/**
 * True when the domain has rested long enough for a mailbox on it to start
 * warming. Unknown domains are treated as rested — a domain we have never
 * burned has nothing to recover from.
 */
export function domainRestSatisfied(
  clock: DomainRestClock,
  domain: string,
  today: string,
): { ok: true } | { ok: false; restedSince: string; availableOn: string } {
  const entry = clock[domain.toLowerCase()];
  if (!entry?.rested_since) return { ok: true };
  const availableOn = addDays(entry.rested_since, entry.min_rest_days ?? DEFAULT_MIN_REST_DAYS);
  return availableOn <= today
    ? { ok: true }
    : { ok: false, restedSince: entry.rested_since, availableOn };
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Marks a domain as resting from `day`, leaving an existing clock untouched. */
export async function markDomainResting(domain: string, day: string): Promise<void> {
  const clock = await getDomainRestClock();
  const key = domain.toLowerCase();
  const entry = clock[key] ?? { rested_since: null, min_rest_days: DEFAULT_MIN_REST_DAYS };
  if (entry.rested_since) return;
  clock[key] = { ...entry, rested_since: day };
  await setOrgSetting('domains', clock);
}

/** Clears the clock when a mailbox on the domain re-enters ramping. */
export async function clearDomainRest(domain: string): Promise<void> {
  const clock = await getDomainRestClock();
  const key = domain.toLowerCase();
  if (!clock[key]?.rested_since) return;
  clock[key] = { ...clock[key], rested_since: null };
  await setOrgSetting('domains', clock);
}
