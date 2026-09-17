/**
 * Read model for the Inboxes tab: one query pass that answers "what is every
 * mailbox doing, how healthy is it, and how much can it send this week".
 */
import type { IdentitySlug, LifecycleStage } from '@/lib/delivery-states';
import { addCalendarDays, formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { stageCap, type CapacityInbox } from '@/lib/inboxes/capacity';
import {
  latestHealthByScope,
  listHealth,
  summarizeWindow,
  type HealthRow,
} from '@/lib/inboxes/health';
import {
  collectSignals,
  detectAndLinkSmartleadAccounts,
  evaluateTransition,
  toCapacityInbox,
} from '@/lib/inboxes/lifecycle';
import { listInboxes, type InboxRow } from '@/lib/inboxes/repository';
import { DEFAULT_STAGE_PLAN, resolveStagePlan } from '@/lib/inboxes/stage-plan';
import {
  DEFAULT_PLAN_LIMITS,
  getDomainRestClock,
  getOrgSettings,
  type AccountsCache,
  type DomainRestClock,
  type PlanLimits,
  type UsageCache,
} from '@/lib/org-settings';

export type RosterInbox = {
  id: string;
  email: string;
  domain: string;
  identity_slug: IdentitySlug;
  from_name: string | null;
  signature_html: string | null;
  enabled: boolean;
  lifecycle_stage: LifecycleStage;
  stage_entered_at: string;
  days_in_stage: number;
  rest_reason: string | null;
  rest_cycles: number;
  /** What still stands between this mailbox and its next stage. */
  exit_unmet: string[];
  next_stage: LifecycleStage | null;
  smartlead: {
    account_id: number | null;
    status: string | null;
    max_email_per_day: number | null;
    warmup_enabled: boolean | null;
    warmup_total_per_day: number | null;
    warmup_reply_rate: number | null;
    warmup_reputation: number | null;
    synced_at: string | null;
    from_name: string | null;
    signature_html: string | null;
  };
  warmup_7d: {
    days: number;
    sent: number;
    inbox: number;
    spam: number;
    inbox_rate: number | null;
    spam_rate: number | null;
  };
  /** null when Postmaster has published nothing — never rendered as a zero. */
  postmaster_reputation: string | null;
  postmaster_status: 'ok' | 'no_data' | 'error' | 'never_fetched';
  bounce_rate_7d: number | null;
  capacity_7d: Array<{ date: string; cap: number }>;
  capacity_7d_total: number;
  domain_rest: { rested_since: string | null; available_on: string | null };
  stage_plan_override: Record<string, unknown>;
};

export type MonthlyGauge = {
  limit: number;
  used: number;
  warmup_used: number;
  remaining: number;
  active_leads: number;
  active_leads_limit: number;
  cycle_start: string | null;
  fetched_at: string | null;
};

export type InboxRoster = {
  today: string;
  inboxes: RosterInbox[];
  monthly: MonthlyGauge;
  /** Smartlead accounts with no hub mailbox, offered for the claim action. */
  unassigned: NonNullable<AccountsCache['unassigned']>;
  stage_plan_default: unknown;
  domains: DomainRestClock;
};

const HEALTH_WINDOW_DAYS = 7;
const CAPACITY_HORIZON_DAYS = 7;

export async function buildInboxRoster(today = formatNyDate()): Promise<InboxRoster> {
  try {
    await detectAndLinkSmartleadAccounts();
  } catch {
    // Listing Smartlead is best-effort; the roster still renders from hub rows.
  }

  const settings = await getOrgSettings([
    'stage_plan.default',
    'smartlead.plan_limits',
    'smartlead.usage_cache',
    'smartlead.accounts_cache',
  ]);
  const orgPlan = settings.get('stage_plan.default') ?? DEFAULT_STAGE_PLAN;
  const planLimits = (settings.get('smartlead.plan_limits') ?? DEFAULT_PLAN_LIMITS) as PlanLimits;
  const usage = (settings.get('smartlead.usage_cache') ?? {}) as UsageCache;
  const accountsCache = (settings.get('smartlead.accounts_cache') ?? {}) as AccountsCache;
  const restClock = await getDomainRestClock();

  const inboxes = await listInboxes();
  const since = addCalendarDays(today, -30);
  const scopeKeys = [
    ...inboxes.map((row) => row.id),
    ...new Set(inboxes.map((row) => row.domain)),
  ];
  const [healthRows, latest] = await Promise.all([
    scopeKeys.length ? listHealth({ scopeKeys, since }) : Promise.resolve([] as HealthRow[]),
    latestHealthByScope(scopeKeys),
  ]);

  const byScope = new Map<string, HealthRow[]>();
  for (const row of healthRows) {
    const list = byScope.get(row.scope_key) ?? [];
    list.push(row);
    byScope.set(row.scope_key, list);
  }

  const windowStart = addCalendarDays(today, -HEALTH_WINDOW_DAYS);
  const rendered: RosterInbox[] = [];

  for (const inbox of inboxes) {
    const plan = resolveStagePlan(orgPlan, inbox.stage_plan);
    const own = (byScope.get(inbox.id) ?? []).filter((row) => row.day >= windowStart);
    const domainRows = byScope.get(inbox.domain) ?? [];
    const signals = await collectSignals(inbox, own, domainRows, today);
    const decision = evaluateTransition(
      {
        stage: inbox.lifecycle_stage,
        restCycles: inbox.rest_cycles,
        hasSmartleadAccount: inbox.smartlead_email_account_id !== null,
      },
      plan,
      signals,
    );

    const warmup = summarizeWindow(own, 'smartlead_warmup');
    const capacityInbox: CapacityInbox = await toCapacityInbox(inbox, orgPlan);
    const capacity = buildCapacityWindow(capacityInbox, today);
    const postmasterRow = latest.get(inbox.domain)?.postmaster;

    rendered.push({
      id: inbox.id,
      email: inbox.email,
      domain: inbox.domain,
      identity_slug: inbox.identity_slug,
      from_name: inbox.from_name ?? inbox.identity_display_name,
      signature_html: inbox.signature_html,
      enabled: inbox.enabled,
      lifecycle_stage: inbox.lifecycle_stage,
      stage_entered_at: inbox.stage_entered_at,
      days_in_stage: signals.daysInStage,
      rest_reason: inbox.rest_reason,
      rest_cycles: inbox.rest_cycles,
      exit_unmet: decision.unmet,
      next_stage: decision.next,
      smartlead: {
        account_id: inbox.smartlead_email_account_id,
        status: inbox.sl_status,
        max_email_per_day: inbox.sl_max_email_per_day,
        warmup_enabled: inbox.sl_warmup_enabled,
        warmup_total_per_day: inbox.sl_warmup_total_per_day,
        warmup_reply_rate: inbox.sl_warmup_reply_rate,
        warmup_reputation: inbox.sl_warmup_reputation,
        synced_at: inbox.sl_synced_at,
        from_name: stringFromRaw(inbox.sl_raw, 'from_name'),
        signature_html: stringFromRaw(inbox.sl_raw, 'signature'),
      },
      warmup_7d: {
        days: warmup.days,
        sent: warmup.sent,
        inbox: warmup.inbox,
        spam: warmup.spam,
        inbox_rate: warmup.inboxRate,
        spam_rate: warmup.spamRate,
      },
      postmaster_reputation: signals.postmasterReputation,
      postmaster_status: postmasterRow ? postmasterRow.status : 'never_fetched',
      bounce_rate_7d: signals.bounceRate,
      capacity_7d: capacity,
      capacity_7d_total: capacity.reduce((sum, day) => sum + day.cap, 0),
      domain_rest: domainRestFor(restClock, inbox.domain),
      stage_plan_override: inbox.stage_plan,
    });
  }

  return {
    today,
    inboxes: rendered,
    monthly: buildMonthlyGauge(planLimits, usage),
    unassigned: accountsCache.unassigned ?? [],
    stage_plan_default: orgPlan,
    domains: restClock,
  };
}

function buildCapacityWindow(inbox: CapacityInbox, today: string) {
  return Array.from({ length: CAPACITY_HORIZON_DAYS }, (_, offset) => {
    const date = addCalendarDays(today, offset);
    return { date, cap: stageCap(inbox, date) };
  });
}

function domainRestFor(clock: DomainRestClock, domain: string) {
  const entry = clock[domain.toLowerCase()];
  if (!entry?.rested_since) return { rested_since: null, available_on: null };
  const [y, m, d] = entry.rested_since.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + (entry.min_rest_days ?? 10));
  return { rested_since: entry.rested_since, available_on: utc.toISOString().slice(0, 10) };
}

export function buildMonthlyGauge(limits: PlanLimits, usage: UsageCache): MonthlyGauge {
  const used = usage.sent ?? 0;
  const warmupUsed = usage.warmup_sent ?? 0;
  return {
    limit: limits.emails_per_month ?? 0,
    used,
    warmup_used: warmupUsed,
    remaining: Math.max(0, (limits.emails_per_month ?? 0) - used - warmupUsed),
    active_leads: usage.active_leads ?? 0,
    active_leads_limit: limits.active_leads ?? 0,
    cycle_start: usage.cycle_start ?? null,
    fetched_at: usage.fetched_at ?? null,
  };
}

export type { InboxRow };

/** Reads a string field off Smartlead's mirrored account payload. */
export function stringFromRaw(raw: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = raw?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[redacted]') return null;
  return trimmed;
}
