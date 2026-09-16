/**
 * Inbox lifecycle (§3.5, §5G).
 *
 * Split in two on purpose: `evaluateTransition` and `desiredSmartleadSettings`
 * are pure and carry every rule, so the state machine is testable against
 * fixture health without a database or an API key. `runLifecycleDaily` is the
 * thin I/O shell that feeds them and writes the results.
 */
import type { IdentitySlug, LifecycleStage } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import {
  clampGrowth,
  stageCap,
  totalDailyBudget,
  varianceFlag,
  type CapacityInbox,
} from '@/lib/inboxes/capacity';
import {
  latestReputation,
  listHealth,
  summarizeWindow,
  type HealthRow,
} from '@/lib/inboxes/health';
import {
  DEFAULT_STAGE_PLAN,
  resolveStagePlan,
  type StagePlan,
} from '@/lib/inboxes/stage-plan';
import {
  clearDomainRest,
  domainRestSatisfied,
  getDomainRestClock,
  getOrgSetting,
  markDomainResting,
  setOrgSetting,
  type AccountsCache,
  type DomainRestClock,
} from '@/lib/org-settings';
import {
  domainsWithActiveSenders,
  getInboxById,
  listInboxes,
  linkSmartleadAccount,
  writeSmartleadMirror,
  writeStage,
  type InboxRow,
} from '@/lib/inboxes/repository';
import { isSmartleadEnabled } from '@/lib/smartlead/enabled';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { normalizeWarmupDetails, toNumber } from '@/lib/smartlead/types';

/** Everything the state machine is allowed to look at. */
export type LifecycleSignals = {
  daysInStage: number;
  /** 7-day warmup inbox rate; null when warmup has produced no data. */
  warmupInboxRate: number | null;
  warmupSpamRate: number | null;
  /** 7-day campaign bounce rate from email_sends; null when nothing was sent. */
  bounceRate: number | null;
  /**
   * Latest Gmail Postmaster reputation, or null for `no_data`.
   * Null is neutral: Postmaster can block a promotion only when it has data.
   */
  postmasterReputation: string | null;
  /** Smartlead reports the mailbox connected and unsuspended. */
  connectionHealthy: boolean;
  /** Two consecutive days of actual < half of planned. */
  varianceFlagged: boolean;
};

export type TransitionDecision = {
  next: LifecycleStage | null;
  reason: string;
  /** Criteria that are not met — surfaced on the Inboxes tab as progress. */
  unmet: string[];
  /** Set when the move is a derate rather than a promotion. */
  restReason?: string;
};

const POSTMASTER_NO_DATA = null;

/**
 * The automatic half of the machine. Manual moves go through `requestStage`,
 * which shares these guards but may be forced.
 */
export function evaluateTransition(
  inbox: { stage: LifecycleStage; restCycles: number; hasSmartleadAccount: boolean },
  plan: StagePlan,
  signals: LifecycleSignals,
): TransitionDecision {
  switch (inbox.stage) {
    case 'provisioning':
      // Detection, not a rule: the account has to appear in Smartlead first.
      return inbox.hasSmartleadAccount
        ? { next: 'warming', reason: 'smartlead_account_detected', unmet: [] }
        : { next: null, reason: 'awaiting_smartlead_account', unmet: ['smartlead_account'] };

    case 'warming': {
      const unmet: string[] = [];
      if (signals.daysInStage < plan.warming.days) {
        unmet.push(`days_in_stage<${plan.warming.days}`);
      }
      if (
        signals.warmupInboxRate === null
        || signals.warmupInboxRate < plan.warming.exit.inbox_rate_min
      ) {
        unmet.push(`warmup_inbox_rate<${plan.warming.exit.inbox_rate_min}`);
      }
      if (!signals.connectionHealthy) unmet.push('connection_errors');
      return unmet.length
        ? { next: null, reason: 'warming', unmet }
        : { next: 'ramping', reason: 'warmup_complete', unmet: [] };
    }

    case 'ramping': {
      const derate = autoDerateReason(plan, signals);
      if (derate) return { next: 'resting', reason: derate, unmet: [], restReason: derate };

      const unmet: string[] = [];
      if (signals.daysInStage < plan.ramping.days) {
        unmet.push(`days_in_stage<${plan.ramping.days}`);
      }
      if (signals.bounceRate !== null && signals.bounceRate >= plan.ramping.exit.bounce_rate_max) {
        unmet.push(`bounce_rate>=${plan.ramping.exit.bounce_rate_max}`);
      }
      // no_data is neutral; only a real Low/Bad grade blocks promotion.
      if (
        signals.postmasterReputation !== POSTMASTER_NO_DATA
        && plan.auto_derate.postmaster_rest.includes(signals.postmasterReputation)
      ) {
        unmet.push(`postmaster_${signals.postmasterReputation.toLowerCase()}`);
      }
      return unmet.length
        ? { next: null, reason: 'ramping', unmet }
        : { next: 'production', reason: 'ramp_complete', unmet: [] };
    }

    case 'production': {
      const derate = autoDerateReason(plan, signals);
      return derate
        ? { next: 'resting', reason: derate, unmet: [], restReason: derate }
        : { next: null, reason: 'healthy', unmet: [] };
    }

    case 'resting':
      // Only rest that the system imposed times out on its own; a human who
      // parked a mailbox has to take it back out.
      return { next: null, reason: 'resting', unmet: [] };

    case 'retired':
      return { next: null, reason: 'retired', unmet: [] };
  }
}

/** The four conditions that pull a sending mailbox out of rotation. */
export function autoDerateReason(plan: StagePlan, signals: LifecycleSignals): string | null {
  if (signals.bounceRate !== null && signals.bounceRate > plan.auto_derate.bounce_rate_rest) {
    return 'bounce_rate';
  }
  if (
    signals.warmupSpamRate !== null
    && signals.warmupSpamRate > plan.auto_derate.warmup_spam_rate_rest
  ) {
    return 'warmup_spam_rate';
  }
  if (
    signals.postmasterReputation !== POSTMASTER_NO_DATA
    && plan.auto_derate.postmaster_rest.includes(signals.postmasterReputation)
  ) {
    return 'postmaster_reputation';
  }
  if (signals.varianceFlagged) return 'forecast_variance';
  return null;
}

/** Where "restart warmup" sends a resting mailbox. */
export function restartWarmupTarget(hasSmartleadAccount: boolean): LifecycleStage {
  return hasSmartleadAccount ? 'warming' : 'provisioning';
}

/** Two rest cycles is enough; the third retires the mailbox. */
export function shouldRetireOnRest(restCycles: number): boolean {
  return restCycles >= 2;
}

export type DesiredSmartleadState = {
  maxEmailPerDay: number;
  warmup: {
    warmup_enabled: boolean;
    total_warmup_per_day: number;
    daily_rampup: number;
    reply_rate_percentage: number;
  };
};

/**
 * What Smartlead should be told about this mailbox today.
 *
 * Warmup never switches off for a mailbox we intend to keep — resting mailboxes
 * keep warming so the address stays alive while its domain recovers.
 */
export function desiredSmartleadState(
  inbox: CapacityInbox,
  plan: StagePlan,
  day: string,
  previousCap: number | null,
): DesiredSmartleadState {
  const warmupPerDay = warmupTargetForStage(inbox.stage, plan);
  const capped = totalDailyBudget(inbox, day, warmupPerDay);
  const maxEmailPerDay = previousCap === null
    ? capped
    : clampGrowth(previousCap, capped, plan);

  return {
    maxEmailPerDay,
    warmup: {
      warmup_enabled: inbox.stage !== 'retired' && inbox.stage !== 'provisioning',
      total_warmup_per_day: warmupPerDay,
      daily_rampup: plan.warming.warmup_rampup,
      reply_rate_percentage: plan.warming.reply_rate_pct,
    },
  };
}

function warmupTargetForStage(stage: LifecycleStage, plan: StagePlan): number {
  switch (stage) {
    case 'warming':
      return plan.warming.warmup_target;
    case 'ramping':
      return plan.ramping.warmup_hold;
    case 'production':
    case 'resting':
      return plan.production.warmup_per_day;
    case 'provisioning':
    case 'retired':
      return 0;
  }
}

/** True when the mirror already matches, so the daily run makes no API call. */
export function smartleadStateMatches(inbox: InboxRow, desired: DesiredSmartleadState): boolean {
  return inbox.sl_max_email_per_day === desired.maxEmailPerDay
    && inbox.sl_warmup_enabled === desired.warmup.warmup_enabled
    && inbox.sl_warmup_total_per_day === desired.warmup.total_warmup_per_day
    && inbox.sl_warmup_reply_rate === desired.warmup.reply_rate_percentage;
}

// ---------------------------------------------------------------------------
// I/O layer
// ---------------------------------------------------------------------------

export class DomainRestingError extends Error {
  readonly code = 'domain_resting';

  constructor(
    readonly domain: string,
    readonly restedSince: string,
    readonly availableOn: string,
  ) {
    super(`${domain} is resting until ${availableOn} (since ${restedSince})`);
    this.name = 'DomainRestingError';
  }
}

export class InvalidTransitionError extends Error {
  readonly code = 'invalid_transition';

  constructor(from: LifecycleStage, to: LifecycleStage) {
    super(`Cannot move an inbox from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class ExitCriteriaUnmetError extends Error {
  readonly code = 'exit_criteria_unmet';

  constructor(readonly unmet: string[]) {
    super(`Exit criteria not met: ${unmet.join(', ')}`);
    this.name = 'ExitCriteriaUnmetError';
  }
}

/** Manual moves the Inboxes tab offers, beyond what the machine does itself. */
const MANUAL_TRANSITIONS: Record<LifecycleStage, LifecycleStage[]> = {
  provisioning: ['warming', 'retired'],
  warming: ['ramping', 'resting', 'retired'],
  ramping: ['production', 'resting', 'retired'],
  production: ['resting', 'retired'],
  resting: ['ramping', 'warming', 'provisioning', 'retired'],
  retired: ['provisioning'],
};

export function isManualTransitionAllowed(from: LifecycleStage, to: LifecycleStage): boolean {
  return MANUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function toCapacityInbox(inbox: InboxRow, orgPlan: unknown): Promise<CapacityInbox> {
  return {
    id: inbox.id,
    email: inbox.email,
    identitySlug: inbox.identity_slug,
    stage: inbox.lifecycle_stage,
    enabled: inbox.enabled,
    stageEnteredAt: formatNyDate(new Date(inbox.stage_entered_at)),
    plan: resolveStagePlan(orgPlan, inbox.stage_plan),
  };
}

/** 7-day campaign bounce rate for one mailbox, from our own send records. */
export async function campaignBounceRate(
  accountId: number,
  days = 7,
): Promise<number | null> {
  const { rows } = await dbQuery<{ sent: string; bounced: string }>(
    `SELECT count(*)::text AS sent,
            count(*) FILTER (WHERE bounced_at IS NOT NULL)::text AS bounced
       FROM outreach.email_sends
      WHERE smartlead_email_account_id = $1
        AND status = 'sent'
        AND sent_at >= now() - ($2 || ' days')::interval`,
    [accountId, String(days)],
  );
  const sent = Number(rows[0]?.sent ?? 0);
  return sent > 0 ? Number(rows[0]?.bounced ?? 0) / sent : null;
}

export async function collectSignals(
  inbox: InboxRow,
  health: HealthRow[],
  domainHealth: HealthRow[],
  today: string,
): Promise<LifecycleSignals> {
  const warmup = summarizeWindow(health, 'smartlead_warmup');
  const forecastRows = health
    .filter((row) => row.source === 'forecast')
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => ({
      planned: Number((row.detail as { planned?: number }).planned ?? 0),
      actual: Number((row.detail as { actual?: number }).actual ?? 0),
    }));

  return {
    daysInStage: daysBetween(formatNyDate(new Date(inbox.stage_entered_at)), today),
    warmupInboxRate: warmup.inboxRate,
    warmupSpamRate: warmup.spamRate,
    bounceRate: inbox.smartlead_email_account_id
      ? await campaignBounceRate(inbox.smartlead_email_account_id)
      : null,
    postmasterReputation: latestReputation(domainHealth),
    connectionHealthy: inbox.sl_status === null || inbox.sl_status === 'ok',
    varianceFlagged: varianceFlag(forecastRows),
  };
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000));
}

export type StageChangeRequest = {
  inboxId: string;
  stage: LifecycleStage;
  force?: boolean;
  reason?: string;
};

export type StageChangeResult = {
  inbox: InboxRow;
  from: LifecycleStage;
  to: LifecycleStage;
  warnings: string[];
};

/**
 * Manual stage change from the Inboxes tab.
 *
 * Refuses a move the machine would never make, refuses a promotion whose exit
 * criteria are unmet unless forced, and refuses `→ warming` while the domain
 * is still resting — that last one is not forceable by accident, only by an
 * explicit `force`, because it is the rule that keeps a burned domain burned.
 */
export async function requestStage(request: StageChangeRequest): Promise<StageChangeResult> {
  const inbox = await getInboxById(request.inboxId);
  if (!inbox) throw new Error(`No such inbox: ${request.inboxId}`);

  const from = inbox.lifecycle_stage;
  const to = request.stage;
  if (from === to) return { inbox, from, to, warnings: [] };
  if (!isManualTransitionAllowed(from, to)) throw new InvalidTransitionError(from, to);

  const warnings: string[] = [];
  const orgPlan = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
  const plan = resolveStagePlan(orgPlan, inbox.stage_plan);
  const today = formatNyDate();

  if (to === 'warming') {
    const clock = await getDomainRestClock();
    const rest = domainRestSatisfied(clock, inbox.domain, today);
    if (!rest.ok && !request.force) {
      throw new DomainRestingError(inbox.domain, rest.restedSince, rest.availableOn);
    }
    if (!rest.ok) warnings.push(`domain_resting_until_${rest.availableOn}`);
  }

  if (to === 'ramping' || to === 'production') {
    const health = await listHealth({
      scopeKeys: [inbox.id],
      since: addDays(today, -plan.warming.exit.window_days),
    });
    const domainHealth = await listHealth({
      scopeKeys: [inbox.domain],
      sources: ['postmaster'],
      since: addDays(today, -30),
    });
    const signals = await collectSignals(inbox, health, domainHealth, today);
    const decision = evaluateTransition(
      {
        stage: from,
        restCycles: inbox.rest_cycles,
        hasSmartleadAccount: inbox.smartlead_email_account_id !== null,
      },
      plan,
      signals,
    );
    if (decision.next !== to && decision.unmet.length) {
      if (!request.force) throw new ExitCriteriaUnmetError(decision.unmet);
      warnings.push(...decision.unmet);
    }
  }

  const retireInstead = to === 'resting' && shouldRetireOnRest(inbox.rest_cycles);
  const finalStage = retireInstead ? 'retired' : to;
  if (retireInstead) warnings.push('retired_after_two_rest_cycles');

  await writeStage(inbox.id, finalStage, {
    restReason: finalStage === 'resting' ? request.reason ?? 'manual' : null,
    incrementRestCycles: finalStage === 'resting',
  });
  await syncDomainRestClock(inbox.domain, finalStage, today);

  const updated = await getInboxById(inbox.id);
  return { inbox: updated!, from, to: finalStage, warnings };
}

/**
 * A domain starts resting when its last sender leaves rotation, and stops when
 * one comes back. Reputation belongs to the domain, not the mailbox.
 */
async function syncDomainRestClock(
  domain: string,
  stage: LifecycleStage,
  today: string,
): Promise<void> {
  if (stage === 'ramping' || stage === 'production') {
    await clearDomainRest(domain);
    return;
  }
  const active = await domainsWithActiveSenders();
  if (!active.has(domain)) await markDomainResting(domain, today);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export type LifecycleDailyReport = {
  skipped?: 'smartlead_disabled';
  day: string;
  examined: number;
  detected: number;
  transitions: Array<{ email: string; from: LifecycleStage; to: LifecycleStage; reason: string }>;
  smartleadWrites: number;
  unassignedAccounts: number;
  /** Identities whose sending set changed, so their lanes need re-attaching. */
  identitiesToResync: IdentitySlug[];
  errors: Array<{ email: string; error: string }>;
};

/**
 * The daily pass: detect new Smartlead accounts, run the machine, and push the
 * resulting caps and warmup settings — but only where they differ from the
 * mirror, so a steady state costs zero API calls.
 */
export async function runLifecycleDaily(
  options: { adapter?: SmartleadAdapter; today?: string } = {},
): Promise<LifecycleDailyReport> {
  const day = options.today ?? formatNyDate();
  if (!isSmartleadEnabled()) {
    return {
      skipped: 'smartlead_disabled',
      day,
      examined: 0,
      detected: 0,
      transitions: [],
      smartleadWrites: 0,
      unassignedAccounts: 0,
      identitiesToResync: [],
      errors: [],
    };
  }

  const adapter = options.adapter ?? smartleadAdapter;
  const report: LifecycleDailyReport = {
    day,
    examined: 0,
    detected: 0,
    transitions: [],
    smartleadWrites: 0,
    unassignedAccounts: 0,
    identitiesToResync: [],
    errors: [],
  };

  const orgPlan = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
  const clock = await getDomainRestClock();
  const accounts = await adapter.listEmailAccounts();
  const byEmail = new Map(accounts.map((account) => [account.from_email.toLowerCase(), account]));

  const inboxes = await listInboxes();
  const matchedAccountIds = new Set<number>();
  const resync = new Set<IdentitySlug>();

  for (const inbox of inboxes) {
    report.examined += 1;
    try {
      const account = byEmail.get(inbox.email);
      if (account) matchedAccountIds.add(account.id);

      // Detection: link first, so a crash mid-loop does not lose the pairing.
      if (account && inbox.smartlead_email_account_id === null) {
        await linkSmartleadAccount(inbox.id, account.id);
        report.detected += 1;
      }

      const current = (await getInboxById(inbox.id))!;
      const plan = resolveStagePlan(orgPlan, current.stage_plan);

      if (account) {
        const warmup = normalizeWarmupDetails(account.warmup_details);
        await writeSmartleadMirror(current.id, {
          status: account.is_smtp_success && account.is_imap_success ? 'ok' : 'error',
          maxEmailPerDay: toNumber(account.message_per_day, 0),
          warmupEnabled: warmup ? warmup.status === 'ACTIVE' : false,
          warmupTotalPerDay: warmup?.maxPerDay ?? null,
          warmupReplyRate: warmup?.replyRatePct ?? null,
          warmupReputation: warmup?.reputationPct ?? null,
          raw: account,
        });
      }

      const refreshed = (await getInboxById(inbox.id))!;
      const health = await listHealth({
        scopeKeys: [refreshed.id],
        since: addDays(day, -plan.warming.exit.window_days),
      });
      const domainHealth = await listHealth({
        scopeKeys: [refreshed.domain],
        sources: ['postmaster'],
        since: addDays(day, -30),
      });
      const signals = await collectSignals(refreshed, health, domainHealth, day);

      const decision = evaluateTransition(
        {
          stage: refreshed.lifecycle_stage,
          restCycles: refreshed.rest_cycles,
          hasSmartleadAccount: refreshed.smartlead_email_account_id !== null,
        },
        plan,
        signals,
      );

      let stage = refreshed.lifecycle_stage;
      if (decision.next && decision.next !== stage) {
        const blocked = decision.next === 'warming'
          && !domainRestSatisfied(clock, refreshed.domain, day).ok;
        if (blocked) {
          report.transitions.push({
            email: refreshed.email,
            from: stage,
            to: stage,
            reason: 'blocked_domain_resting',
          });
        } else {
          const retire = decision.next === 'resting' && shouldRetireOnRest(refreshed.rest_cycles);
          const target = retire ? 'retired' : decision.next;
          await writeStage(refreshed.id, target, {
            restReason: target === 'resting' ? decision.restReason ?? decision.reason : null,
            incrementRestCycles: target === 'resting',
          });
          await syncDomainRestClock(refreshed.domain, target, day);
          report.transitions.push({
            email: refreshed.email,
            from: stage,
            to: target,
            reason: decision.reason,
          });
          if (isSendingStage(stage) !== isSendingStage(target)) resync.add(refreshed.identity_slug);
          stage = target;
        }
      }

      const capacityInbox = await toCapacityInbox({ ...refreshed, lifecycle_stage: stage }, orgPlan);
      const desired = desiredSmartleadState(
        capacityInbox,
        plan,
        day,
        refreshed.sl_max_email_per_day,
      );

      const accountId = refreshed.smartlead_email_account_id;
      if (accountId !== null && !smartleadStateMatches(refreshed, desired)) {
        await adapter.updateEmailAccount(accountId, {
          max_email_per_day: desired.maxEmailPerDay,
          ...(refreshed.from_name ? { from_name: refreshed.from_name } : {}),
          ...(refreshed.signature_html ? { signature: refreshed.signature_html } : {}),
        });
        await adapter.setWarmup(accountId, desired.warmup);
        await writeSmartleadMirror(refreshed.id, {
          status: refreshed.sl_status,
          maxEmailPerDay: desired.maxEmailPerDay,
          warmupEnabled: desired.warmup.warmup_enabled,
          warmupTotalPerDay: desired.warmup.total_warmup_per_day,
          warmupReplyRate: desired.warmup.reply_rate_percentage,
          warmupReputation: refreshed.sl_warmup_reputation,
          raw: refreshed.sl_raw,
        });
        report.smartleadWrites += 1;
      }
    } catch (error) {
      report.errors.push({
        email: inbox.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const unassigned = accounts
    .filter((account) => !matchedAccountIds.has(account.id))
    .map((account) => ({
      id: account.id,
      from_email: account.from_email,
      from_name: account.from_name ?? null,
    }));
  await setOrgSetting('smartlead.accounts_cache', {
    fetched_at: new Date().toISOString(),
    unassigned,
  } satisfies AccountsCache);
  report.unassignedAccounts = unassigned.length;
  report.identitiesToResync = [...resync];

  return report;
}

function isSendingStage(stage: LifecycleStage): boolean {
  return stage === 'ramping' || stage === 'production';
}

export { DEFAULT_STAGE_PLAN, resolveStagePlan, type StagePlan };
export type { DomainRestClock };
