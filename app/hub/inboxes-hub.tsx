'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, RefreshCw, X } from 'lucide-react';

import { hubGetJson, invalidateHubCache } from '@/app/hub/hub-data';
import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { heliosIdentitySignatureHtml } from '@/lib/drafting/email-signature';
import { RequestError, requestJson } from '@/lib/client-request';
import { inboxStatusHeadline, stageActionsFor } from '@/lib/inboxes/drawer-status';
import type {
  Campaign7d,
  MailboxConnection,
  WarmupProgram,
  WarmupWindow,
} from '@/lib/inboxes/drawer-analytics';
import { scoreInboxHealth } from '@/lib/inboxes/health-score';
import type { InboxRoster, RosterInbox } from '@/lib/inboxes/roster';
import type { SendSeriesDay } from '@/lib/inboxes/send-series';
import { resolveStagePlan } from '@/lib/inboxes/stage-plan';

const STAGE_LABELS: Record<string, string> = {
  production: 'Production',
  ramping: 'Ramping',
  warming: 'Warming',
  provisioning: 'Provisioning',
  resting: 'Resting',
  retired: 'Retired',
};

const STAGE_AHEAD: Record<string, string> = {
  provisioning: 'Warming',
  warming: 'Ramping',
  ramping: 'Production',
};
const STAGE_ORDER = ['production', 'ramping', 'warming', 'provisioning', 'resting', 'retired'] as const;

const EXIT_LABELS: Record<string, string> = {
  smartlead_account: 'Waiting to be detected in Smartlead',
  connection_errors: 'Smartlead reports a connection error',
};

type SelectOption = { value: string; label: string; hint?: string };

function explainUnmet(code: string): string {
  if (EXIT_LABELS[code]) return EXIT_LABELS[code];
  const days = code.match(/^days_in_stage<(\d+)$/);
  if (days) return `Needs ${days[1]} days in this stage`;
  const inbox = code.match(/^warmup_inbox_rate<([\d.]+)$/);
  if (inbox) return `Warmup inbox placement below ${Math.round(Number(inbox[1]) * 100)}%`;
  const bounce = code.match(/^bounce_rate>=([\d.]+)$/);
  if (bounce) return `Bounce rate at or above ${Math.round(Number(bounce[1]) * 100)}%`;
  if (code.startsWith('postmaster_')) return `Gmail Postmaster reports ${code.replace('postmaster_', '')}`;
  return code;
}

function liveFromName(inbox: RosterInbox): string {
  return inbox.smartlead.from_name || inbox.from_name || '';
}

function liveSignatureHtml(inbox: RosterInbox): string {
  return inbox.smartlead.signature_html
    || inbox.signature_html
    || heliosIdentitySignatureHtml(inbox.identity_slug);
}

function signatureSource(inbox: RosterInbox): string {
  if (inbox.smartlead.signature_html) return 'Live in Smartlead';
  if (inbox.signature_html) return 'Saved in the hub — write it to Smartlead with Save';
  return 'Helios default — save to write it to Smartlead';
}

function fromNameSource(inbox: RosterInbox): string {
  if (inbox.smartlead.from_name) return 'Live in Smartlead';
  if (inbox.from_name) return 'Saved in the hub — write it to Smartlead with Save';
  return 'Empty until you set it';
}

function healthFor(inbox: RosterInbox) {
  return scoreInboxHealth({
    warmupInboxRate: inbox.warmup_7d.inbox_rate,
    warmupSpamRate: inbox.warmup_7d.spam_rate,
    bounceRate: inbox.bounce_rate_7d,
    postmasterReputation: inbox.postmaster_reputation,
    connectionHealthy: inbox.smartlead.status === null || inbox.smartlead.status === 'ok',
    warmupReputation: inbox.warmup_7d.sent > 0 ? inbox.smartlead.warmup_reputation : null,
  });
}

function postmasterFact(inbox: RosterInbox): string {
  if (inbox.postmaster_reputation) return inbox.postmaster_reputation;
  if (inbox.postmaster_status === 'error') return 'error';
  return 'quiet';
}

function formatRate(rate: number | null, digits: number): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

type HealthFact = { label: string; value: string; hint: string };
type StatRow = { label: string; value: string; explain: string };

type InboxHealthPayload = {
  series?: SendSeriesDay[];
  series_totals?: { warmup: number; campaign: number };
  campaign_7d?: Campaign7d;
  warmup_program?: WarmupProgram;
  warmup_7d?: WarmupWindow;
  warmup_lifetime?: { sent: number; inbox: number; spam: number; received: number } | null;
  postmaster_latest?: {
    day: string;
    status: string;
    reputation: string | null;
    spam_rate: string | null;
    spf_ratio: string | null;
    dkim_ratio: string | null;
    dmarc_ratio: string | null;
    detail: Record<string, unknown>;
  } | null;
  connection?: MailboxConnection;
  forecast?: Array<{ detail?: { planned?: number; actual?: number; variance_flag?: boolean } }>;
};

function inboxHealthLine(inbox: RosterInbox): string {
  return `Warmup inbox placement ${formatRate(inbox.warmup_7d.inbox_rate, 0)} · Bounce ${formatRate(inbox.bounce_rate_7d, 1)} · ${postmasterFact(inbox)}`;
}

function InboxHealthPill({ inbox }: { inbox: RosterInbox }) {
  const health = healthFor(inbox);
  const text = health.score === null ? health.label : `${health.label} ${health.score}`;
  return (
    <span
      className={`inbox-health-pill inbox-health-pill--${health.tone}`}
      title={health.detail}
    >
      {text}
    </span>
  );
}

function stageChangeNotice(
  email: string,
  to: string,
  smartlead: 'applied' | 'already_matching' | undefined,
  warnings: string[],
): string {
  const moved = `${email} → ${STAGE_LABELS[to] ?? to}`;
  const warmup = smartlead === 'applied'
    ? 'Smartlead was updated just now.'
    : smartlead === 'already_matching'
      ? 'Smartlead already matches this stage.'
      : null;
  const extra = [
    warmup,
    warnings.filter((warning) => !warning.startsWith('domain_resting_until_')).join(', ') || null,
  ].filter(Boolean);
  return extra.length ? `${moved}. ${extra.join(' ')}` : moved;
}

function confirmStageChange(email: string, from: string, requested: string): boolean {
  if (requested === 'retired') {
    return window.confirm(
      `Retire ${email}?\n\nIt leaves rotation and stops campaign sending. You can re-enable it later from Retired.`,
    );
  }
  if (requested === 'restart_warmup') {
    return window.confirm(
      `Restart warmup for ${email}?\n\nIt will move to Warming and Smartlead warmup will turn on.`,
    );
  }
  const fromLabel = STAGE_LABELS[from] ?? from;
  const toLabel = STAGE_LABELS[requested] ?? requested;
  if (requested === from) {
    return window.confirm(`Start warmup now for ${email}?`);
  }
  return window.confirm(`Move ${email} from ${fromLabel} to ${toLabel}?`);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function InboxesHub() {
  const [roster, setRoster] = useState<InboxRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<RosterInbox | null>(null);
  const [adding, setAdding] = useState(false);
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await hubGetJson<InboxRoster>('/api/inboxes');
      setRoster(next);
      setDetail((current) => (current ? next.inboxes.find((row) => row.id === current.id) ?? null : null));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load inboxes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      setNotice(message);
      invalidateHubCache();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const changeStage = useCallback(async (
    inbox: RosterInbox,
    stage: string,
    force = false,
  ) => {
    if (!force && !confirmStageChange(inbox.email, inbox.lifecycle_stage, stage)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{
        warnings: string[];
        to: string;
        smartlead?: 'applied' | 'already_matching';
      }>(
        `/api/inboxes/${inbox.id}/stage`,
        { method: 'POST', body: JSON.stringify({ stage, force }) },
      );
      setNotice(stageChangeNotice(inbox.email, result.to, result.smartlead, result.warnings));
      invalidateHubCache();
      await load();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        const code = err.body?.code;
        if (code === 'smartlead_unlinked') {
          setError(err.message);
          return;
        }
        const detailText = code === 'domain_resting'
          ? `${err.body?.domain} is resting until ${err.body?.available_on}.`
          : code === 'exit_criteria_unmet'
            ? `Not ready: ${(err.body?.unmet as string[] ?? []).map(explainUnmet).join('; ')}.`
            : err.message;
        if (window.confirm(`${detailText}\n\nOverride and move it anyway?`)) {
          await changeStage(inbox, stage, true);
          return;
        }
        setError(detailText);
      } else {
        setError(err instanceof Error ? err.message : 'Action failed');
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  const ordered = useMemo(() => {
    if (!roster) return [];
    return [...roster.inboxes]
      .filter((inbox) => !stageFilter || inbox.lifecycle_stage === stageFilter)
      .sort((a, b) => {
        const byStage = STAGE_ORDER.indexOf(a.lifecycle_stage as typeof STAGE_ORDER[number])
          - STAGE_ORDER.indexOf(b.lifecycle_stage as typeof STAGE_ORDER[number]);
        if (byStage !== 0) return byStage;
        if (a.identity_slug !== b.identity_slug) return a.identity_slug.localeCompare(b.identity_slug);
        return a.email.localeCompare(b.email);
      });
  }, [roster, stageFilter]);

  if (loading && !roster) return <HubLoadingSpinner label="Loading inboxes" />;
  if (!roster) {
    return (
      <main className="app-shell">
        <section className="card"><div className="card__body">
          <p className="field__error">{error ?? 'Unable to load inboxes'}</p>
        </div></section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Inboxes</div>
            <div className="card__subtitle">
              Sending mailboxes, their lifecycle stage, and what Smartlead and Gmail say
              about them.
            </div>
          </div>
          <div className="inbox-hub__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              title="Match hub mailboxes to Smartlead accounts, then pull signatures, usage, and warmup."
              onClick={() => void act(
                () => requestJson('/api/inboxes/sync', { method: 'POST' }),
                'Matched mailboxes against Smartlead.',
              )}
            >
              <RefreshCw size={14} /> Sync now
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add address
            </button>
          </div>
        </div>

        <div className="card__body">
          <FleetStrip
            roster={roster}
            stageFilter={stageFilter}
            onFilter={(stage) => setStageFilter((current) => (current === stage ? null : stage))}
          />

          {error ? <p className="field__error">{error}</p> : null}
          {notice ? <p className="muted">{notice}</p> : null}

          {roster.unassigned.length > 0 ? (
            <p className="muted">
              {roster.unassigned.length} Smartlead{' '}
              {roster.unassigned.length === 1 ? 'account is' : 'accounts are'} not matched to a
              mailbox here: {roster.unassigned.map((a) => a.from_email).join(', ')}. Open a
              mailbox to claim one if the addresses do not match.
            </p>
          ) : null}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mailbox</th>
                  <th>Stage</th>
                  <th>Health</th>
                  <th>Progress</th>
                  <th>Next 7 days</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((inbox) => (
                  <tr
                    key={inbox.id}
                    className="inbox-hub__row"
                    onClick={() => setDetail(inbox)}
                  >
                    <td>
                      <strong>{inbox.email}</strong>
                      <div className="muted">
                        {inbox.identity_slug === 'lucas' ? 'Lucas' : 'Tommy'}
                        {inbox.smartlead.account_id ? '' : ' · not in Smartlead yet'}
                      </div>
                    </td>
                    <td>
                      <span className={`inbox-stage-pill inbox-stage-pill--${inbox.lifecycle_stage}`}>
                        {STAGE_LABELS[inbox.lifecycle_stage] ?? inbox.lifecycle_stage}
                      </span>
                      <div className="muted">{inbox.days_in_stage}d</div>
                    </td>
                    <td>
                      <InboxHealthPill inbox={inbox} />
                      <div className="muted">{inboxHealthLine(inbox)}</div>
                    </td>
                    <td style={{ maxWidth: '16rem' }}>
                      {inbox.exit_unmet.length === 0 ? (
                        <span className="muted">
                          {inbox.next_stage
                            ? `Ready for ${STAGE_LABELS[inbox.next_stage] ?? inbox.next_stage}`
                            : '—'}
                        </span>
                      ) : (
                        <span className="muted">{explainUnmet(inbox.exit_unmet[0])}</span>
                      )}
                    </td>
                    <td>{inbox.capacity_7d_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {detail ? (
        <InboxDrawer
          key={detail.id}
          inbox={detail}
          roster={roster}
          busy={busy}
          onClose={() => setDetail(null)}
          onStage={(stage) => void changeStage(detail, stage)}
          onPatch={(patch, message) => act(
            () => requestJson(`/api/inboxes/${detail.id}`, {
              method: 'PATCH',
              body: JSON.stringify(patch),
            }),
            message,
          )}
          onApplyTimeline={(plan, message) => act(
            () => requestJson('/api/inboxes', {
              method: 'PATCH',
              body: JSON.stringify({ stage_plan_default: plan, apply_to_all_inboxes: true }),
            }),
            message,
          )}
        />
      ) : null}

      {adding ? (
        <AddInboxDialog
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={async (payload) => {
            const ok = await act(
              () => requestJson('/api/inboxes', { method: 'POST', body: JSON.stringify(payload) }),
              `Added ${payload.email}. It will start warming once Smartlead detects it.`,
            );
            if (ok) setAdding(false);
          }}
        />
      ) : null}
    </main>
  );
}

function stageCounts(roster: InboxRoster): Record<string, number> {
  return Object.fromEntries(
    STAGE_ORDER.map((stage) => [
      stage,
      roster.inboxes.filter((inbox) => inbox.lifecycle_stage === stage).length,
    ]),
  ) as Record<string, number>;
}

function FleetStrip(props: {
  roster: InboxRoster;
  stageFilter: string | null;
  onFilter: (stage: string | null) => void;
}) {
  const counts = stageCounts(props.roster);
  const present = STAGE_ORDER.filter((stage) => counts[stage] > 0);
  const todayCap = props.roster.inboxes.reduce((sum, inbox) => sum + (inbox.capacity_7d[0]?.cap ?? 0), 0);
  const used = props.roster.monthly.used + props.roster.monthly.warmup_used;
  const limit = props.roster.monthly.limit;

  return (
    <div className="inbox-fleet">
      <div
        className="inbox-fleet__bar"
        role="img"
        aria-label="Inbox stages by share of the fleet"
      >
        {present.map((stage) => (
          <button
            key={stage}
            type="button"
            className={`inbox-fleet__slice inbox-fleet__slice--${stage}${props.stageFilter === stage ? ' is-on' : ''}`}
            style={{ flexGrow: counts[stage] }}
            title={`${STAGE_LABELS[stage]} · ${counts[stage]}`}
            onClick={() => props.onFilter(stage)}
          />
        ))}
      </div>
      <div className="inbox-fleet__meta">
        <div className="inbox-fleet__legend">
          <button
            type="button"
            className={`inbox-fleet__all${props.stageFilter === null ? ' is-on' : ''}`}
            onClick={() => props.onFilter(null)}
          >
            {props.roster.inboxes.length} inboxes
          </button>
          {present.map((stage) => (
            <button
              key={stage}
              type="button"
              className={`inbox-fleet__key inbox-fleet__key--${stage}${props.stageFilter === stage ? ' is-on' : ''}`}
              onClick={() => props.onFilter(stage)}
            >
              <span className="inbox-fleet__dot" />
              {STAGE_LABELS[stage]}
              <strong>{counts[stage]}</strong>
            </button>
          ))}
        </div>
        <div className="inbox-fleet__gauges">
          <MiniGauge
            label="Today"
            value={`${todayCap.toLocaleString()} / day`}
            title="Campaign emails these inboxes may send today. Provisioning, warming, and resting mailboxes contribute zero."
          />
          <MiniGauge
            label="Smartlead"
            value={limit ? `${used.toLocaleString()} / ${limit.toLocaleString()}` : used.toLocaleString()}
            fill={limit ? used / limit : 0}
            title={props.roster.monthly.fetched_at
              ? `Monthly Smartlead usage as of ${new Date(props.roster.monthly.fetched_at).toLocaleString()}`
              : 'Monthly Smartlead usage — not synced yet'}
          />
        </div>
      </div>
    </div>
  );
}

function MiniGauge(props: {
  label: string;
  value: string;
  fill?: number;
  title: string;
}) {
  const width = props.fill === undefined
    ? null
    : `${Math.min(100, Math.max(0, props.fill * 100))}%`;
  return (
    <div className="inbox-mini" title={props.title}>
      <span className="inbox-mini__label">{props.label}</span>
      <span className="inbox-mini__value">{props.value}</span>
      {width !== null ? (
        <span className="inbox-mini__track" aria-hidden="true">
          <span className="inbox-mini__fill" style={{ width }} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Google publishes nothing below an undisclosed daily volume to Gmail
 * recipients, so silence is the expected reading at this scale. It is rendered
 * as information, never as an alert.
 */
function InboxDrawer(props: {
  inbox: RosterInbox;
  roster: InboxRoster;
  busy: boolean;
  onClose: () => void;
  onStage: (stage: string) => void;
  onPatch: (patch: Record<string, unknown>, message: string) => Promise<boolean>;
  onApplyTimeline: (plan: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const { inbox } = props;
  const [fromName, setFromName] = useState(liveFromName(inbox));
  const [signature, setSignature] = useState(liveSignatureHtml(inbox));
  const [identity, setIdentity] = useState(inbox.identity_slug);
  const [claimId, setClaimId] = useState('');
  const plan = resolveStagePlan(props.roster.stage_plan_default, inbox.stage_plan_override);
  const [warmingDays, setWarmingDays] = useState(plan.warming.days);
  const [rampingDays, setRampingDays] = useState(plan.ramping.days);
  const [productionCap, setProductionCap] = useState(plan.production.cap);
  const [restingDays, setRestingDays] = useState(plan.resting.days);
  const [pane, setPane] = useState<'actions' | 'analytics'>('actions');
  const [health, setHealth] = useState<InboxHealthPayload | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);

  const actions = stageActionsFor(inbox.lifecycle_stage, inbox.smartlead.warmup_enabled);
  const linked = Boolean(inbox.smartlead.account_id);
  const status = inboxStatusHeadline({
    lifecycleStage: inbox.lifecycle_stage,
    linked,
    warmupEnabled: inbox.smartlead.warmup_enabled,
  });

  useEffect(() => {
    setPane('actions');
  }, [inbox.id]);

  useEffect(() => {
    let cancelled = false;
    setSeriesLoading(true);
    setHealth(null);
    void hubGetJson<InboxHealthPayload>(
      `/api/inboxes/${inbox.id}/health`,
      { force: true },
    ).then((payload) => {
      if (!cancelled) setHealth(payload);
    }).catch(() => {
      if (!cancelled) setHealth({});
    }).finally(() => {
      if (!cancelled) setSeriesLoading(false);
    });
    return () => { cancelled = true; };
  }, [inbox.id]);

  return (
    <div className="drawer-overlay" role="presentation" onClick={props.onClose}>
      <div
        className="drawer inbox-drawer"
        role="dialog"
        aria-label="Inbox detail"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__header">
          <div>
            <div className="card__title">{inbox.email}</div>
            <div className="card__subtitle inbox-drawer__subtitle">
              <span className={`inbox-stage-pill inbox-stage-pill--${inbox.lifecycle_stage}`}>
                {STAGE_LABELS[inbox.lifecycle_stage]}
              </span>
              {status ? (
                <span className={`inbox-drawer__status${inbox.smartlead.warmup_enabled ? ' inbox-drawer__status--active' : ''}`}>
                  {status}
                </span>
              ) : null}
              <InboxHealthPill inbox={inbox} />
              {inbox.days_in_stage} days in this stage
              {inbox.rest_reason ? ` · resting: ${inbox.rest_reason}` : ''}
            </div>
          </div>
          <button type="button" className="drawer__close" aria-label="Close" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="inbox-drawer__tabs">
          <div className="segmented" role="tablist" aria-label="Inbox drawer">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'actions'}
              className={`segmented__item${pane === 'actions' ? ' segmented__item--active' : ''}`}
              onClick={() => setPane('actions')}
            >
              Actions
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'analytics'}
              className={`segmented__item${pane === 'analytics' ? ' segmented__item--active' : ''}`}
              onClick={() => setPane('analytics')}
            >
              Analytics
            </button>
          </div>
        </div>

        <div className="drawer__body inbox-drawer__body">
          {pane === 'actions' ? (
            <>
          {inbox.exit_unmet.length > 0 ? (
            <section className="inbox-drawer__section inbox-drawer__section--secondary">
              <h3 className="inbox-drawer__heading">
                {inbox.next_stage
                  ? `To reach ${STAGE_LABELS[inbox.next_stage] ?? inbox.next_stage}`
                  : STAGE_AHEAD[inbox.lifecycle_stage]
                    ? `To reach ${STAGE_AHEAD[inbox.lifecycle_stage]}`
                    : 'Before the next stage'}
              </h3>
              <ul className="inbox-drawer__list">
                {inbox.exit_unmet.map((code) => <li key={code}>{explainUnmet(code)}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="inbox-drawer__section">
            <h3 className="inbox-drawer__heading">Move stage</h3>
            <div className="inbox-stage-actions">
              {actions.map((action) => (
                <button
                  key={action.stage}
                  type="button"
                  className={`inbox-stage-action inbox-stage-action--${action.tone}`}
                  disabled={props.busy}
                  onClick={() => props.onStage(action.stage)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>

          {!linked && props.roster.unassigned.length > 0 ? (
            <section className="inbox-drawer__section">
              <h3 className="inbox-drawer__heading">Claim Smartlead account</h3>
              <p className="inbox-drawer__copy">
                This mailbox is not linked. Pick the unmatched Smartlead account that already
                sends as a different from-address, then claim it.
              </p>
              <div className="inbox-drawer__claim">
                <HubSelect
                  value={claimId}
                  placeholder="Choose an unmatched Smartlead account"
                  options={props.roster.unassigned.map((account) => ({
                    value: String(account.id),
                    label: account.from_email,
                    hint: `account ${account.id}`,
                  }))}
                  onChange={setClaimId}
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={props.busy || !claimId}
                  onClick={() => void props.onPatch(
                    { smartlead_email_account_id: Number(claimId) },
                    `Linked ${inbox.email} to Smartlead account ${claimId}.`,
                  )}
                >
                  Claim
                </button>
              </div>
            </section>
          ) : null}

          <section className="inbox-drawer__section">
            <RangeField
              label="Warming days"
              value={warmingDays}
              min={1}
              max={90}
              onChange={setWarmingDays}
            />
            <RangeField
              label="Ramping days"
              value={rampingDays}
              min={1}
              max={90}
              onChange={setRampingDays}
            />
            <RangeField
              label="Production cap / day"
              value={productionCap}
              min={1}
              max={50}
              onChange={setProductionCap}
            />
            <RangeField
              label="Rest days"
              value={restingDays}
              min={1}
              max={120}
              onChange={setRestingDays}
            />
            <button
              type="button"
              className="btn btn--secondary inbox-timeline-apply"
              disabled={props.busy}
              onClick={() => {
                const plan = timelinePatch(warmingDays, rampingDays, productionCap, restingDays);
                if (!window.confirm(
                  `Apply ${warmingDays} warming days, ${rampingDays} ramping days, ${productionCap} production / day, and ${restingDays} rest days to all ${props.roster.inboxes.length} inboxes?`,
                )) return;
                void props.onApplyTimeline(
                  plan,
                  `Applied this timeline to all ${props.roster.inboxes.length} inboxes.`,
                );
              }}
            >
              Apply to all inboxes
            </button>
          </section>

          <section className="inbox-drawer__section">
            <div className="field">
              <span className="field__label">From name</span>
              <span className="field__hint">{fromNameSource(inbox)}</span>
              <input
                className="field__input"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </div>
            <div className="field">
              <span className="field__label">Identity</span>
              <HubSelect
                value={identity}
                options={[
                  { value: 'lucas', label: 'Lucas' },
                  { value: 'tommy', label: 'Tommy' },
                ]}
                onChange={(value) => setIdentity(value as RosterInbox['identity_slug'])}
              />
            </div>
            <div className="inbox-signature-head">
              <div>
                <h3 className="inbox-drawer__heading">Signature</h3>
                <p className="field__hint">{signatureSource(inbox)}</p>
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSignature(heliosIdentitySignatureHtml(identity))}
              >
                Use Helios signature
              </button>
            </div>
            <div className="inbox-signature-preview" aria-label="Signature preview">
              {signature.trim() ? (
                <iframe
                  className="inbox-signature-preview__frame"
                  title="Signature as Smartlead will send it"
                  sandbox=""
                  srcDoc={signature}
                />
              ) : (
                <p className="muted" style={{ margin: 0 }}>No signature in Smartlead yet.</p>
              )}
            </div>
            <label className="field">
              <span className="field__label">HTML written to Smartlead</span>
              <textarea
                className="field__input inbox-signature-html"
                rows={6}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
              />
            </label>
          </section>
            </>
          ) : (
            <InboxAnalyticsPane
              inbox={inbox}
              health={health}
              loading={seriesLoading}
            />
          )}
        </div>

        {pane === 'actions' ? (
        <div className="drawer__footer">
          <button
            type="button"
            className="btn btn--primary inbox-drawer__save"
            disabled={props.busy}
            onClick={() => void props.onPatch(
              {
                from_name: fromName || null,
                signature_html: signature || null,
                identity_slug: identity,
                stage_plan: timelinePatch(warmingDays, rampingDays, productionCap, restingDays),
              },
              linked
                ? `Updated ${inbox.email} and wrote from-name and signature to Smartlead.`
                : `Updated ${inbox.email}. Smartlead picks up from-name and signature once the account is linked.`,
            )}
          >
            Save
          </button>
        </div>
        ) : null}
      </div>
    </div>
  );
}

function timelinePatch(
  warmingDays: number,
  rampingDays: number,
  productionCap: number,
  restingDays: number,
): Record<string, unknown> {
  return {
    warming: { days: warmingDays },
    ramping: { days: rampingDays },
    production: { cap: productionCap },
    resting: { days: restingDays },
  };
}

function RangeField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="inbox-range">
      <span className="field__label">{props.label}</span>
      <div className="inbox-range__row">
        <input
          className="inbox-range__box"
          type="number"
          min={props.min}
          max={props.max}
          value={props.value}
          onChange={(e) => props.onChange(clampInt(Number(e.target.value), props.min, props.max))}
        />
        <input
          className="inbox-range__slider"
          type="range"
          min={props.min}
          max={props.max}
          value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function HubSelect(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = props.options.find((option) => option.value === props.value);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="inbox-select" ref={rootRef}>
      <button
        type="button"
        className={`inbox-select__trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? undefined : 'muted'}>
          {selected?.label ?? props.placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="inbox-select__menu" role="listbox">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              className={`inbox-select__option${option.value === props.value ? ' is-active' : ''}`}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
            >
              <span>
                {option.label}
                {option.hint ? <span className="inbox-select__hint">{option.hint}</span> : null}
              </span>
              {option.value === props.value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InboxAnalyticsPane(props: {
  inbox: RosterInbox;
  health: InboxHealthPayload | null;
  loading: boolean;
}) {
  const { inbox, health } = props;
  const campaign = health?.campaign_7d;
  const postmaster = health?.postmaster_latest;
  const connection = health?.connection;
  const forecast = health?.forecast?.[0]?.detail;
  const rows = warmupStatRows(inbox, health);

  return (
    <>
      <section className="inbox-drawer__section">
        <h3 className="inbox-drawer__heading">Warmup</h3>
        <StatList rows={rows} />
      </section>

      <section className="inbox-drawer__section">
        <h3 className="inbox-drawer__heading">Volumes</h3>
        <SendSeriesChart
          days={health?.series ?? null}
          totals={health?.series_totals ?? null}
          loading={props.loading}
        />
      </section>

      <section className="inbox-drawer__section">
        <h3 className="inbox-drawer__heading">Campaign 7d</h3>
        <div className="inbox-health-facts">
          {campaignFacts(campaign).map((fact) => (
            <div key={fact.label} className="inbox-health-fact" title={fact.hint}>
              <span className="inbox-health-fact__label">{fact.label}</span>
              <span className="inbox-health-fact__value">{fact.value}</span>
            </div>
          ))}
        </div>
        {forecast && (forecast.planned || forecast.actual) ? (
          <p className="inbox-drawer__copy">
            Hub model {forecast.planned ?? 0} planned vs {forecast.actual ?? 0} actual
            {forecast.variance_flag ? ' · variance flagged' : ''}.
          </p>
        ) : null}
      </section>

      <section className="inbox-drawer__section">
        <h3 className="inbox-drawer__heading">Postmaster</h3>
        {postmaster?.status === 'ok' && postmaster.reputation ? (
          <>
            <p className="inbox-drawer__copy">
              {inbox.domain} reputation {postmaster.reputation} on {postmaster.day}.
            </p>
            <dl className="inbox-analytics-dl">
              <div>
                <dt>User spam</dt>
                <dd>{formatStoredRatio(postmaster.spam_rate)}</dd>
              </div>
              <div>
                <dt>SPF</dt>
                <dd>{formatStoredRatio(postmaster.spf_ratio)}</dd>
              </div>
              <div>
                <dt>DKIM</dt>
                <dd>{formatStoredRatio(postmaster.dkim_ratio)}</dd>
              </div>
              <div>
                <dt>DMARC</dt>
                <dd>{formatStoredRatio(postmaster.dmarc_ratio)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="inbox-drawer__copy">
            Quiet. Google publishes nothing below its Gmail-volume threshold; this is expected at this scale.
          </p>
        )}
        {inbox.domain_rest.available_on ? (
          <p className="inbox-drawer__copy">
            Domain rest until {inbox.domain_rest.available_on} — campaign capacity stays 0.
          </p>
        ) : null}
      </section>

      <section className="inbox-drawer__section">
        <h3 className="inbox-drawer__heading">Connection</h3>
        {connection && !connection.healthy ? (
          <p className="inbox-drawer__copy">
            {connection.suspended ? 'Account suspended. ' : ''}
            {connection.smtp_ok === false ? `SMTP: ${connection.smtp_error ?? 'error'}. ` : ''}
            {connection.imap_ok === false ? `IMAP: ${connection.imap_error ?? 'error'}.` : ''}
            {!connection.suspended && connection.smtp_ok !== false && connection.imap_ok !== false
              ? (connection.status ?? 'Connection error')
              : ''}
          </p>
        ) : (
          <p className="inbox-drawer__copy">Connected.</p>
        )}
      </section>
    </>
  );
}

function warmupStatRows(inbox: RosterInbox, health: InboxHealthPayload | null): StatRow[] {
  const program = health?.warmup_program;
  const live = health?.warmup_7d;
  const sent = live?.sent ?? inbox.warmup_7d.sent;
  const inboxCount = live?.inbox ?? inbox.warmup_7d.inbox;
  const days = live?.days ?? inbox.warmup_7d.days;
  const inboxRate = live?.inbox_rate ?? inbox.warmup_7d.inbox_rate;
  const replies = live?.replies ?? 0;
  const lifetime = health?.warmup_lifetime;
  const campaign = health?.campaign_7d;
  const postmaster = health?.postmaster_latest;
  const rows: StatRow[] = [];

  const programOn = Boolean(program?.enabled);
  rows.push({
    label: 'Program',
    value: program
      ? `${programOn ? 'On' : 'Off'}${program.status ? ` · ${program.status}` : ''}`
      : '—',
    explain: programOn
      ? 'Smartlead is sending warmup mail to build this address’s reputation.'
      : program
        ? 'Warmup is off. This mailbox is not sending those practice emails.'
        : 'No warmup program reported by Smartlead yet.',
  });

  if (program?.blocked || program?.blocked_reason) {
    rows.push({
      label: 'Blocked',
      value: 'Yes',
      explain: program.blocked_reason
        ? `Smartlead paused warmup: ${program.blocked_reason}.`
        : 'Smartlead has paused this warmup program.',
    });
  }

  rows.push({
    label: 'Inbox placement',
    value: formatRate(inboxRate, 0),
    explain: sent > 0
      ? `${inboxCount} of ${sent} warmup emails arrived in the inbox over the last ${days} days.`
      : 'Share of warmup emails that landed in the inbox, not spam. None sent in the last 7 days.',
  });

  const today = program?.current_daily;
  const floor = program?.min_per_day;
  const ceiling = program?.max_per_day;
  rows.push({
    label: 'Today’s volume',
    value: today != null ? `${today} / day` : '—',
    explain: todayVolumeExplain(floor, today, ceiling),
  });

  rows.push({
    label: 'Daily increase',
    value: programOn && program ? `+${program.daily_rampup} / day` : '—',
    explain: !programOn
      ? 'Volume only increases while warmup is on.'
      : today != null && ceiling != null && today >= ceiling
        ? 'Warmup is already at the daily ceiling, so volume is not increasing further.'
        : 'Extra warmup emails added each day until today’s volume hits the ceiling.',
  });

  rows.push({
    label: 'Reply target',
    value: program?.reply_rate_pct == null ? '—' : `${Math.round(program.reply_rate_pct)}%`,
    explain: 'Share of warmup threads Smartlead tries to get a reply on. Replies help reputation.',
  });

  const reputation = program?.reputation;
  rows.push({
    label: 'Reputation',
    value: reputation != null ? String(Math.round(reputation)) : '—',
    explain: reputation != null
      ? 'Smartlead’s 0–100 score for how this mailbox looks to email providers.'
      : 'Not enough warmup yet for a Smartlead score.',
  });

  rows.push({
    label: 'Last 7 days',
    value: sent > 0 ? `${sent} sent` : 'None',
    explain: sent > 0
      ? `${inboxCount} landed in the inbox; ${replies} ${replies === 1 ? 'reply' : 'replies'}.`
      : 'No warmup emails sent this week.',
  });

  if (lifetime && lifetime.sent > 0) {
    rows.push({
      label: 'Lifetime',
      value: `${lifetime.sent} sent`,
      explain: `Total warmup emails this mailbox has sent. ${lifetime.inbox} landed in the inbox.`,
    });
  }

  const bounce = campaign && campaign.sent > 0 ? campaign.bounce_rate : inbox.bounce_rate_7d;
  rows.push({
    label: 'Bounce 7d',
    value: formatRate(bounce, 1),
    explain: 'Share of campaign mail from this mailbox that bounced in the last 7 days.',
  });

  const postmasterValue = postmaster?.reputation || postmasterFact(inbox);
  rows.push({
    label: 'Postmaster',
    value: postmasterValue,
    explain: postmasterValue !== 'quiet' && postmasterValue !== 'error' && postmasterValue !== '—'
      ? 'Gmail’s published reputation for this domain.'
      : 'Gmail’s domain reputation. Quiet means Google hasn’t published a score yet — expected at this volume.',
  });

  return rows;
}

function todayVolumeExplain(
  floor: number | null | undefined,
  today: number | null | undefined,
  ceiling: number | null | undefined,
): string {
  if (today == null) return 'How many warmup emails Smartlead will send from this mailbox today.';
  if (floor != null && ceiling != null && floor !== ceiling) {
    if (today >= ceiling) {
      return `Warmup emails Smartlead will send from this mailbox today. Started at ${floor}/day; now at the ${ceiling}/day ceiling.`;
    }
    return `Warmup emails Smartlead will send from this mailbox today. Started at ${floor}/day; climbing toward ${ceiling}/day.`;
  }
  if (ceiling != null && today >= ceiling) {
    return `Warmup emails Smartlead will send from this mailbox today, already at the ${ceiling}/day ceiling.`;
  }
  return 'Warmup emails Smartlead will send from this mailbox today.';
}

function StatList({ rows }: { rows: StatRow[] }) {
  return (
    <ul className="inbox-stat-list">
      {rows.map((row) => (
        <li key={row.label} className="inbox-stat-list__row">
          <div className="inbox-stat-list__head">
            <span className="inbox-stat-list__label">{row.label}</span>
            <span className="inbox-stat-list__value">{row.value}</span>
          </div>
          <p className="inbox-stat-list__explain">{row.explain}</p>
        </li>
      ))}
    </ul>
  );
}

function formatStoredRatio(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function campaignFacts(campaign: Campaign7d | undefined): HealthFact[] {
  const empty = campaign ?? {
    sent: 0, bounced: 0, opened: 0, clicked: 0, replied: 0, complained: 0,
    bounce_rate: null, open_rate: null, click_rate: null, reply_rate: null, complaint_rate: null,
  };
  const countRate = (count: number, rate: number | null) => (
    empty.sent > 0 ? `${count} · ${formatRate(rate, 1)}` : '—'
  );
  return [
    { label: 'Sent', value: empty.sent > 0 ? String(empty.sent) : '—', hint: 'Campaign emails sent from this mailbox in 7 days' },
    { label: 'Bounced', value: countRate(empty.bounced, empty.bounce_rate), hint: 'Bounce count and rate' },
    { label: 'Opened', value: countRate(empty.opened, empty.open_rate), hint: 'Open count and rate' },
    { label: 'Clicked', value: countRate(empty.clicked, empty.click_rate), hint: 'Click count and rate' },
    { label: 'Replied', value: countRate(empty.replied, empty.reply_rate), hint: 'Reply count and rate' },
    { label: 'Complaints', value: countRate(empty.complained, empty.complaint_rate), hint: 'Spam complaint count and rate' },
  ];
}

function SendSeriesChart(props: {
  days: SendSeriesDay[] | null;
  totals: { warmup: number; campaign: number } | null;
  loading: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const days = props.days ?? [];
  if (props.loading) {
    return <p className="inbox-series__caption">Loading send series…</p>;
  }
  if (days.length === 0) return null;

  const width = 460;
  const height = 92;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const yMax = Math.max(1, ...days.flatMap((day) => [day.warmup, day.campaign]));
  const xAt = (index: number) => padL + (index / Math.max(1, days.length - 1)) * innerW;
  const yAt = (value: number) => padT + innerH - (value / yMax) * innerH;
  const toPoints = (key: 'warmup' | 'campaign', from: number, to: number) =>
    days.slice(from, to + 1).map((day, offset) => `${xAt(from + offset)},${yAt(day[key])}`).join(' ');
  const todayIndex = days.findIndex((day) => day.kind === 'today');
  const hovered = hover !== null ? days[hover] : null;

  return (
    <div className="inbox-series">
      <div className="inbox-series__legend">
        <span className="inbox-series__key inbox-series__key--warmup">Warmup</span>
        <span className="inbox-series__key inbox-series__key--campaign">Campaign</span>
        <span className="inbox-series__hint">Solid actual · dashed planned</span>
      </div>
      <svg
        className="inbox-series__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Warmup and campaign sends, 7 days past through 7 days ahead"
        onMouseLeave={() => setHover(null)}
      >
        {todayIndex >= 0 ? (
          <line
            className="inbox-series__today"
            x1={xAt(todayIndex)}
            x2={xAt(todayIndex)}
            y1={padT}
            y2={padT + innerH}
          />
        ) : null}
        <polyline className="inbox-series__line inbox-series__line--warmup" points={toPoints('warmup', 0, todayIndex)} fill="none" />
        <polyline className="inbox-series__line inbox-series__line--campaign" points={toPoints('campaign', 0, todayIndex)} fill="none" />
        <polyline className="inbox-series__line inbox-series__line--warmup inbox-series__line--future" points={toPoints('warmup', todayIndex, days.length - 1)} fill="none" />
        <polyline className="inbox-series__line inbox-series__line--campaign inbox-series__line--future" points={toPoints('campaign', todayIndex, days.length - 1)} fill="none" />
        {days.map((day, index) => (
          <rect
            key={day.date}
            x={xAt(index) - innerW / days.length / 2}
            y={padT}
            width={innerW / days.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
        {todayIndex >= 0 ? (
          <text className="inbox-series__label" x={xAt(todayIndex)} y={height - 4} textAnchor="middle">Today</text>
        ) : null}
      </svg>
      <p className="inbox-series__caption">
        {hovered
          ? `${shortSeriesDate(hovered.date)} · Warmup ${hovered.warmup} · Campaign ${hovered.campaign}${hovered.kind === 'future' ? ' planned' : ''}`
          : `Warmup 7d sent ${props.totals?.warmup ?? 0} · Campaign 7d sent ${props.totals?.campaign ?? 0}`}
      </p>
    </div>
  );
}

function shortSeriesDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function AddInboxDialog(props: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { email: string; identity_slug: string; from_name?: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [identity, setIdentity] = useState('lucas');
  const [fromName, setFromName] = useState('');

  return (
    <div className="drawer-overlay" role="presentation" onClick={props.onClose}>
      <div
        className="drawer inbox-drawer"
        role="dialog"
        aria-label="Add mailbox"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__header">
          <div className="card__title">Add a sending address</div>
          <button type="button" className="drawer__close" aria-label="Close" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer__body inbox-drawer__body">
          <label className="field">
            <span className="field__label">Email address</span>
            <input
              className="field__input"
              value={email}
              placeholder="name@heliosgroup.me"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="field">
            <span className="field__label">Identity</span>
            <HubSelect
              value={identity}
              options={[
                { value: 'lucas', label: 'Lucas' },
                { value: 'tommy', label: 'Tommy' },
              ]}
              onChange={setIdentity}
            />
          </div>
          <label className="field">
            <span className="field__label">From name (optional)</span>
            <input className="field__input" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          </label>
          <p className="inbox-drawer__copy">
            The mailbox starts at Provisioning. Connect it in Smartlead with Microsoft OAuth;
            the next sync detects it, writes the from-name and signature, and starts the
            14-day warmup clock.
          </p>
        </div>
        <div className="drawer__footer">
          <button
            type="button"
            className="btn btn--primary inbox-drawer__save"
            disabled={props.busy || !email.includes('@')}
            onClick={() => props.onSubmit({
              email: email.trim(),
              identity_slug: identity,
              from_name: fromName.trim() || undefined,
            })}
          >
            Add mailbox
          </button>
        </div>
      </div>
    </div>
  );
}
