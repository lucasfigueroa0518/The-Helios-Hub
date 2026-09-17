'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Send, Trash2, X } from 'lucide-react';

import {
  ChoiceList,
  FilterAccordion,
  MobileFilterBar,
  MobileFilterMenu,
} from '@/app/components/mobile-filter-menu';
import { hubGetJson, invalidateHubCache } from '@/app/hub/hub-data';
import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { requestJson } from '@/lib/client-request';
import {
  formatNyDateLabel,
  formatNyWeekday,
  isNyCalendarWeekend,
} from '@/lib/drafting/send-queue-schedule';
import type {
  QueueCampaignDayStat,
  QueueDayBucket,
  QueueListItem,
  QueueMailboxDayStat,
  SendQueueBoard,
} from '@/lib/drafting/send-queue';

type CampaignOption = { id: string; name: string };

function QueueMetric({
  label,
  value,
  tip,
}: {
  label: string;
  value: number | string;
  tip: string;
}) {
  return (
    <span className="queue-metric" tabIndex={0}>
      <span className="queue-metric__label">{label}</span>
      <strong className="queue-metric__value">{value}</strong>
      <span className="queue-metric__tip" role="tooltip">{tip}</span>
    </span>
  );
}

const DELIVERY_LABELS: Record<QueueListItem['delivery_status'], string> = {
  waiting: 'Waiting',
  scheduled: 'Scheduled',
  handing_off: 'Handing off',
  with_smartlead: 'With Smartlead',
  sent: 'Sent',
  bounced: 'Bounced',
  replied: 'Replied',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

const WAITING_LABELS: Record<string, string> = {
  no_capacity: 'No mailbox capacity in the next two weeks',
  lane_not_ready: 'Smartlead campaign not ready yet',
  monthly_ceiling: 'Held back by the monthly Smartlead allowance',
};

function deliveryChipClass(status: QueueListItem['delivery_status']): string {
  if (status === 'sent' || status === 'replied') return 'drafting-status-chip drafting-status-chip--approved';
  if (status === 'bounced' || status === 'failed') return 'drafting-status-chip drafting-status-chip--failed';
  if (status === 'cancelled') return 'drafting-status-chip drafting-status-chip--failed';
  if (status === 'waiting') return 'drafting-status-chip drafting-status-chip--attention';
  return 'drafting-status-chip drafting-status-chip--queued';
}

export function SendQueueHub() {
  const [board, setBoard] = useState<SendQueueBoard | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [identity, setIdentity] = useState('');
  const [inboxEmail, setInboxEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<QueueListItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<'campaign' | 'identity' | 'inbox' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaign_id', campaignId);
      if (identity) params.set('identity', identity);
      if (inboxEmail) params.set('inbox', inboxEmail);
      const qs = params.toString();
      setBoard(await hubGetJson<SendQueueBoard>(`/api/send-queue${qs ? `?${qs}` : ''}`));
      hasDataRef.current = true;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the queue');
    } finally {
      setLoading(false);
    }
  }, [campaignId, identity, inboxEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void hubGetJson<{ campaigns: CampaignOption[] }>('/api/campaigns')
      .then((res) => setCampaigns(res.campaigns.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCampaigns([]));
  }, []);

  const act = useCallback(async (
    run: () => Promise<unknown>,
    message: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      setNotice(message);
      setSelected(new Set());
      invalidateHubCache();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const ids = useMemo(() => [...selected], [selected]);

  const sendNow = () => act(
    () => requestJson('/api/send-queue/send-now', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    `Handing ${ids.length} ${ids.length === 1 ? 'draft' : 'drafts'} to Smartlead now.`,
  );

  const cancel = () => act(
    () => requestJson('/api/send-queue', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),
    `Cancelled ${ids.length} ${ids.length === 1 ? 'draft' : 'drafts'}.`,
  );

  const retry = () => act(
    () => requestJson('/api/send-queue/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    `Retrying ${ids.length} failed ${ids.length === 1 ? 'handoff' : 'handoffs'}.`,
  );

  const moveTo = (targetDate: string, moveIds: string[]) => act(
    () => requestJson('/api/send-queue', {
      method: 'PATCH',
      body: JSON.stringify({ ids: moveIds, target_date: targetDate }),
    }),
    `Moved to ${formatNyDateLabel(targetDate)}.`,
  );

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const scrollBy = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * 360, behavior: 'smooth' });
  };

  if (loading && !board) return <HubLoadingSpinner label="Loading queue" />;
  if (!board) {
    return (
      <main className="app-shell send-queue-page">
        <section className="card"><div className="card__body">
          <p className="field__error">{error ?? 'Unable to load the queue'}</p>
        </div></section>
      </main>
    );
  }

  const unassigned = board.days[0]?.totals.queued_unassigned ?? 0;
  const todayBucket = board.days.find((day) => day.date === board.today) ?? null;
  const sendingToday = todayBucket?.totals.planned ?? 0;
  const activeInboxes = board.inboxes.filter(
    (inbox) => inbox.stage === 'ramping' || inbox.stage === 'production',
  );
  const activeCapacity = todayBucket?.capacity ?? 0;

  return (
    <main className="app-shell send-queue-page">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Send queue</div>
            <div className="card__subtitle">
              America/New_York · drag to move by day
            </div>
          </div>
        </div>

        <div className="card__body">
          <MobileFilterBar
            title="Filters"
            summary={[
              campaignId ? (campaigns.find((c) => c.id === campaignId)?.name ?? 'Campaign') : 'All campaigns',
              identity || 'Both identities',
            ].join(' · ')}
            onOpen={() => setMenuOpen(true)}
          />

          <div className="send-queue-layout">
          <div className="send-queue-toolbar hub-desktop-toolbar">
            <div className="send-queue-toolbar__stats">
              <QueueMetric
                label="Sending today"
                value={sendingToday}
                tip="Drafts on today’s handoff day — the volume leaving the hub today."
              />
              <QueueMetric
                label="Active inbox capacity"
                value={activeCapacity}
                tip={activeInboxes.length
                  ? `${activeInboxes.length} ramping or production ${activeInboxes.length === 1 ? 'mailbox' : 'mailboxes'} can send this many campaign emails today.`
                  : 'No mailboxes are in ramping or production, so campaign capacity is 0.'}
              />
            </div>
            <label className="send-queue-filter">
              <span>Campaign</span>
              <select className="field__input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">All campaigns</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="send-queue-filter">
              <span>Identity</span>
              <select className="field__input" value={identity} onChange={(e) => setIdentity(e.target.value)}>
                <option value="">Both</option>
                {board.identities.map((slug) => (
                  <option key={slug} value={slug}>{slug === 'lucas' ? 'Lucas' : 'Tommy'}</option>
                ))}
              </select>
            </label>
            <label className="send-queue-filter">
              <span>Mailbox</span>
              <select className="field__input" value={inboxEmail} onChange={(e) => setInboxEmail(e.target.value)}>
                <option value="">All mailboxes</option>
                {board.inboxes.map((inbox) => (
                  <option key={inbox.id} value={inbox.email}>{inbox.email}</option>
                ))}
              </select>
            </label>
          </div>

          {error ? <p className="field__error">{error}</p> : null}
          {notice ? <p className="muted">{notice}</p> : null}

          {unassigned > 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              {unassigned} approved {unassigned === 1 ? 'draft has' : 'drafts have'} no handoff day
              yet. Check the lane status and mailbox capacity below.
            </p>
          ) : null}

          {ids.length > 0 ? (
            <div className="send-queue-selection">
              <strong>{ids.length} selected</strong>
              <button type="button" className="button" disabled={busy} onClick={() => void sendNow()}>
                <Send size={14} /> Send now
              </button>
              <button type="button" className="button button--ghost" disabled={busy} onClick={() => void retry()}>
                <RotateCcw size={14} /> Retry failed
              </button>
              <button type="button" className="button button--ghost" disabled={busy} onClick={() => void cancel()}>
                <Trash2 size={14} /> Cancel
              </button>
              <button type="button" className="button button--ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : null}

          <div className="send-queue-board-wrap">
            <button type="button" className="send-queue-board-wrap__nav" aria-label="Scroll left" onClick={() => scrollBy(-1)}>
              <ChevronLeft size={16} />
            </button>
            <div className="send-queue-board-scroller" ref={scrollerRef}>
              {board.days.map((day) => (
                <DayColumn
                  key={day.date}
                  day={day}
                  today={board.today}
                  selected={selected}
                  dragId={dragId}
                  onToggle={toggle}
                  onOpen={setDetail}
                  onDragStart={setDragId}
                  onDrop={(date) => {
                    const moving = dragId ? [dragId] : ids;
                    setDragId(null);
                    if (moving.length) void moveTo(date, moving);
                  }}
                />
              ))}
            </div>
            <button type="button" className="send-queue-board-wrap__nav" aria-label="Scroll right" onClick={() => scrollBy(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          </div>

          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            {board.forecast_note}
          </p>
        </div>
      </section>

      <MobileFilterMenu
        title="Queue filters"
        subtitle="Campaign, identity and mailbox."
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      >
        <FilterAccordion
          label="Campaign"
          value={campaignId ? (campaigns.find((c) => c.id === campaignId)?.name ?? 'Campaign') : 'All campaigns'}
          open={openSection === 'campaign'}
          onToggle={() => setOpenSection((s) => (s === 'campaign' ? null : 'campaign'))}
        >
          <ChoiceList
            options={[{ id: '', label: 'All campaigns' }, ...campaigns.map((c) => ({ id: c.id, label: c.name }))]}
            value={campaignId}
            onChange={setCampaignId}
          />
        </FilterAccordion>
        <FilterAccordion
          label="Identity"
          value={identity || 'Both identities'}
          open={openSection === 'identity'}
          onToggle={() => setOpenSection((s) => (s === 'identity' ? null : 'identity'))}
        >
          <ChoiceList
            options={[
              { id: '', label: 'Both identities' },
              ...board.identities.map((slug) => ({ id: slug, label: slug === 'lucas' ? 'Lucas' : 'Tommy' })),
            ]}
            value={identity}
            onChange={setIdentity}
          />
        </FilterAccordion>
        <FilterAccordion
          label="Mailbox"
          value={inboxEmail || 'All mailboxes'}
          open={openSection === 'inbox'}
          onToggle={() => setOpenSection((s) => (s === 'inbox' ? null : 'inbox'))}
        >
          <ChoiceList
            options={[
              { id: '', label: 'All mailboxes' },
              ...board.inboxes.map((inbox) => ({ id: inbox.email, label: inbox.email })),
            ]}
            value={inboxEmail}
            onChange={setInboxEmail}
          />
        </FilterAccordion>
      </MobileFilterMenu>

      {detail ? <QueueDetailDrawer item={detail} onClose={() => setDetail(null)} /> : null}
    </main>
  );
}

function DayColumn(props: {
  day: QueueDayBucket;
  today: string;
  selected: Set<string>;
  dragId: string | null;
  onToggle: (id: string) => void;
  onOpen: (item: QueueListItem) => void;
  onDragStart: (id: string) => void;
  onDrop: (date: string) => void;
}) {
  const { day, today } = props;
  const isToday = day.date === today;
  const isPast = day.date < today;
  const weekend = isNyCalendarWeekend(day.date);

  return (
    <div
      className="send-queue-day-panel"
      onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={() => props.onDrop(day.date)}
      style={{
        border: `1px solid ${isToday ? 'var(--color-accent, #2f6feb)' : 'var(--color-border, #d8dee8)'}`,
        borderRadius: '10px',
        padding: '0.75rem',
        background: weekend ? 'var(--color-surface-muted, #f5f7fa)' : 'var(--color-surface, #fff)',
        opacity: isPast ? 0.75 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{formatNyDateLabel(day.date)}</strong>
        <span className="muted">{formatNyWeekday(day.date)}{isToday ? ' · today' : ''}</span>
      </div>

      <div className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0.6rem' }}>
        {day.totals.planned} planned · {day.totals.actual} sent · capacity {day.totals.capacity}
        {day.totals.followups > 0 ? ` · ${day.totals.followups} follow-ups` : ''}
        <br />
        <span title="Estimate. Smartlead decides the sender and the minute.">
          forecast {day.totals.forecast}
        </span>
      </div>

      {day.campaigns.length > 0 ? (
        <div style={{ marginBottom: '0.6rem' }}>
          {day.campaigns.map((campaign) => (
            <CampaignRow key={campaign.campaign_id} campaign={campaign} />
          ))}
        </div>
      ) : null}

      {day.mailboxes.some((mailbox) => mailbox.cap > 0 || mailbox.actual > 0) ? (
        <details style={{ marginBottom: '0.6rem' }}>
          <summary className="muted" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
            Mailboxes
          </summary>
          {day.mailboxes
            .filter((mailbox) => mailbox.cap > 0 || mailbox.actual > 0)
            .map((mailbox) => <MailboxRow key={mailbox.inbox_id} mailbox={mailbox} />)}
        </details>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {day.items.length === 0 ? (
          <span className="muted" style={{ fontSize: '0.8rem' }}>Nothing scheduled.</span>
        ) : null}
        {day.items.map((item) => (
          <button
            key={item.id}
            type="button"
            draggable={item.status === 'queued' || item.status === 'handed_off'}
            onDragStart={() => props.onDragStart(item.id)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) props.onToggle(item.id);
              else props.onOpen(item);
            }}
            style={{
              textAlign: 'left',
              border: `1px solid ${props.selected.has(item.id) ? 'var(--color-accent, #2f6feb)' : 'var(--color-border, #e3e8ef)'}`,
              borderLeft: `4px solid ${item.queue_color ?? 'var(--color-border, #e3e8ef)'}`,
              borderRadius: '6px',
              padding: '0.4rem 0.55rem',
              background: 'var(--color-surface, #fff)',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span style={{ fontWeight: 500 }}>{item.recipient_name || item.to_email}</span>
              <span className={deliveryChipClass(item.delivery_status)}>
                {DELIVERY_LABELS[item.delivery_status]}
              </span>
            </div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>{item.campaign_name}</div>
            {item.waiting_reason ? (
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                {WAITING_LABELS[item.waiting_reason] ?? item.waiting_reason}
              </div>
            ) : null}
            {item.overdue ? (
              <div className="muted" style={{ fontSize: '0.75rem' }}>Past its handoff day.</div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: QueueCampaignDayStat }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.8rem' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            marginRight: '0.35rem',
            background: campaign.queue_color ?? 'var(--color-border, #d8dee8)',
          }}
        />
        {campaign.name}
        {campaign.lane_status && campaign.lane_status !== 'ready' ? (
          <span className="muted"> · lane {campaign.lane_status}</span>
        ) : null}
      </span>
      <span className="muted" title="Planned / forecast / actual. Forecast is an estimate.">
        {campaign.planned}/{campaign.forecast}/{campaign.actual}
      </span>
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: QueueMailboxDayStat }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.78rem' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mailbox.email}
        <span className="muted"> · {mailbox.stage}</span>
        {mailbox.variance_flag ? <span className="muted"> · under plan</span> : null}
      </span>
      <span className="muted" title="Estimated share / actual / cap">
        {mailbox.planned}/{mailbox.actual}/{mailbox.cap}
      </span>
    </div>
  );
}

function QueueDetailDrawer({ item, onClose }: { item: QueueListItem; onClose: () => void }) {
  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <div className="drawer" role="dialog" aria-label="Queued draft" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__header">
          <div>
            <div className="card__title">{item.recipient_name || item.to_email}</div>
            <div className="card__subtitle">{item.campaign_name}</div>
          </div>
          <button type="button" className="drawer__close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <Field label="To">{item.to_email}</Field>
          <Field label="Subject">{item.subject}</Field>
          <Field label="Status">{DELIVERY_LABELS[item.delivery_status]}</Field>
          <Field label="Handoff day">
            {item.handoff_date ? formatNyDateLabel(item.handoff_date) : 'Not scheduled yet'}
          </Field>
          {item.handed_off_at ? (
            <Field label="Handed to Smartlead">{new Date(item.handed_off_at).toLocaleString()}</Field>
          ) : null}
          {item.sent_date ? <Field label="Sent">{formatNyDateLabel(item.sent_date)}</Field> : null}
          {item.inbox_email ? <Field label="Mailbox">{item.inbox_email}</Field> : null}
          {item.smartlead_lead_id ? (
            <Field label="Smartlead lead">{item.smartlead_lead_id}</Field>
          ) : null}
          {item.waiting_reason ? (
            <Field label="Waiting because">
              {WAITING_LABELS[item.waiting_reason] ?? item.waiting_reason}
            </Field>
          ) : null}
          {item.error_message ? <Field label="Error">{item.error_message}</Field> : null}
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            Smartlead chooses the sending mailbox and the exact minute inside the campaign
            schedule. The hub controls only which day this is handed over.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
