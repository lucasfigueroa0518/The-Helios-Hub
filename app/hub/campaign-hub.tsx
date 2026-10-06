'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { HubPlaneFlight } from '@/app/components/plane-flight';
import { hubGetJson, invalidateHubCache } from '@/app/hub/hub-data';
import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { LeadListTutorial } from '@/app/hub/lead-list-tutorial';

import { requestJson } from '@/lib/client-request';
import { campaignHref } from '@/lib/home/campaignHref';
import {
  SENDER_IDENTITY_LABELS,
  type SenderIdentitySlug,
} from '@/lib/agentmail-inboxes';
import { LivePulse } from '@/app/components/live-pulse';
import { TagBadge } from '@/app/components/tag-badge';
import { TagInputPopover } from '@/app/components/tag-input-popover';
import type { TagWithColor } from '@/lib/campaigns';
import { MessageComposer } from '@/app/components/message-composer';
import { buildSignatureHtml, resolveEmailSignature } from '@/lib/drafting/email-signature';
import { parseMessageTemplate, parseSubjectTemplate } from '@/lib/drafting/message-template';
import { isLiveAutoCampaign } from '@/lib/auto-campaigns/status';
import { CapacityShareField, ChoiceCards } from '@/app/hub/campaign-setup-fields';
import type { InboxRoster } from '@/lib/inboxes/roster';

const DRAFTING_POLL_MS = 5_000;

type Campaign = {
  id: string;
  name: string;
  status: 'active' | 'archived' | 'terminated';
  merged_into_id: string | null;
  needs_enrichment?: boolean;
  kind?: 'manual' | 'auto';
  auto_status?: 'pending_sender' | 'live' | 'paused' | 'exhausted' | 'error' | null;
  auto_error?: string | null;
  emails_per_day?: number | null;
  sender_identity_slug?: SenderIdentitySlug | null;
  sent_count?: number;
  created_at: string;
  updated_at: string;
  lead_count: number;
  last_run_at: string | null;
  tags?: string[];
  tag_details?: TagWithColor[];
  drafting_active?: boolean;
  drafting_generated?: number;
  drafting_total?: number;
  lane_status?: string | null;
  tomorrow_forecast?: number;
  delivery_settings?: {
    tracking: boolean;
    reply_fallback: 'claude' | 'human_only';
    max_new_leads_per_day: number | null;
    capacity_pct?: number | null;
    require_approval: boolean;
    require_approval_until: string | null;
    schedule: { start: string; end: string };
    follow_ups: Array<{ step: number; delay_days: number; body_template: string }>;
  };
};

function formatDate(value: string | null) {
  if (!value) return 'No runs yet';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
}

export function CampaignHub({ email }: { email: string }) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'merge' | 'delivery' | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [name, setName] = useState('');
  const [needsEnrichment, setNeedsEnrichment] = useState(false);
  const [kind, setKind] = useState<'manual' | 'auto'>('manual');
  const [industry, setIndustry] = useState('');
  const [seniority, setSeniority] = useState('');
  const [geography, setGeography] = useState('');
  const [businessSize, setBusinessSize] = useState('');
  const [capacityPct, setCapacityPct] = useState(100);
  const [roster, setRoster] = useState<InboxRoster | null>(null);
  const [senderIdentity, setSenderIdentity] = useState<SenderIdentitySlug>('lucas');
  const [sourceId, setSourceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageMode, setMessageMode] = useState<'ai' | 'custom'>('ai');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [followUpDelay, setFollowUpDelay] = useState('3');
  const [followUpBody, setFollowUpBody] = useState('');
  const [replyFallback, setReplyFallback] = useState<'claude' | 'human_only'>('claude');
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');

  const active = useMemo(() => campaigns.filter((campaign) => campaign.status === 'active'), [campaigns]);
  const archived = useMemo(() => campaigns.filter((campaign) => campaign.status === 'archived'), [campaigns]);
  const terminated = useMemo(() => campaigns.filter((campaign) => campaign.status === 'terminated'), [campaigns]);
  const anyDrafting = useMemo(
    () => campaigns.some((campaign) => campaign.drafting_active),
    [campaigns],
  );
  const customTemplateValid = useMemo(() => {
    if (messageMode !== 'custom') return true;
    const subject = parseSubjectTemplate(subjectTemplate);
    const body = parseMessageTemplate(bodyTemplate);
    return subject.errors.length === 0 && body.errors.length === 0 && Boolean(subject.canonical.trim() && body.canonical.trim());
  }, [messageMode, subjectTemplate, bodyTemplate]);
  const signaturePreviewHtml = useMemo(
    () => buildSignatureHtml(resolveEmailSignature({
      workEmail: '',
      identitySlug: senderIdentity,
      allowRemoteHeadshot: true,
    })),
    [senderIdentity],
  );

  async function loadCampaigns(force = false) {
    if (campaigns.length === 0) setLoading(true);
    try {
      const data = await hubGetJson<{ campaigns: Campaign[] }>('/api/campaigns', { force });
      setCampaigns(data.campaigns);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load campaigns');
    } finally {
      setLoading(false);
    }
  }

  const loadCampaignsRef = useRef(loadCampaigns);
  loadCampaignsRef.current = loadCampaigns;

  useEffect(() => {
    void loadCampaignsRef.current();
  }, []);

  useEffect(() => {
    if (dialog !== 'create' && dialog !== 'delivery') return;
    void hubGetJson<InboxRoster>('/api/inboxes')
      .then(setRoster)
      .catch(() => setRoster(null));
  }, [dialog]);

  useEffect(() => {
    if (!anyDrafting) return undefined;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadCampaignsRef.current(true);
    }, DRAFTING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyDrafting]);

  function openCreate() {
    setName(`Campaign #${campaigns.length + 1}`);
    setNeedsEnrichment(false);
    setKind('manual');
    setIndustry('');
    setSeniority('');
    setGeography('');
    setBusinessSize('');
    setCapacityPct(100);
    setSenderIdentity('lucas');
    setMessageMode('ai');
    setSubjectTemplate('');
    setBodyTemplate('');
    setIncludeSignature(true);
    setTracking(false);
    setFollowUpDelay('3');
    setFollowUpBody('');
    setReplyFallback('claude');
    setScheduleStart('09:00');
    setScheduleEnd('17:00');
    setSenderIdentity('lucas');
    setSelected(null);
    setDialog('create');
  }

  function applyDeliveryFrom(campaign: Campaign) {
    const settings = campaign.delivery_settings;
    const follow = settings?.follow_ups[0];
    setSenderIdentity(campaign.sender_identity_slug ?? 'lucas');
    setTracking(settings?.tracking ?? false);
    setReplyFallback(settings?.reply_fallback ?? 'claude');
    setCapacityPct(settings?.capacity_pct ?? 100);
    setFollowUpDelay(follow ? String(follow.delay_days) : '3');
    setFollowUpBody(follow?.body_template ?? '');
    setScheduleStart(settings?.schedule.start ?? '09:00');
    setScheduleEnd(settings?.schedule.end ?? '17:00');
  }

  function deliveryPayload() {
    return {
      tracking,
      reply_fallback: replyFallback,
      max_new_leads_per_day: null,
      capacity_pct: capacityPct,
      follow_ups: followUpBody.trim()
        ? [{ step: 2, delay_days: Number.parseInt(followUpDelay, 10) || 3, body_template: followUpBody }]
        : [],
      schedule: { start: scheduleStart, end: scheduleEnd },
    };
  }

  function openDelivery(campaign: Campaign) {
    setSelected(campaign);
    applyDeliveryFrom(campaign);
    setDialog('delivery');
  }

  function openRename(campaign: Campaign) {
    setSelected(campaign);
    setName(campaign.name);
    setDialog('rename');
  }

  function openMerge(target: Campaign) {
    setSelected(target);
    setSourceId(active.find((campaign) => campaign.id !== target.id)?.id ?? '');
    setDialog('merge');
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await requestJson<{ campaign: { id: string } }>('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          {
            ...(kind === 'auto'
              ? {
                name,
                kind: 'auto' as const,
                needs_enrichment: false,
                sender_identity_slug: senderIdentity,
                lead_attributes: {
                  industry,
                  seniority,
                  geography,
                  business_size: businessSize,
                },
              }
              : { name, needs_enrichment: needsEnrichment, sender_identity_slug: senderIdentity }),
            message_mode: messageMode,
            delivery_settings: deliveryPayload(),
            ...(messageMode === 'custom'
              ? {
                message_subject_template: subjectTemplate,
                message_body_template: bodyTemplate,
                include_signature: includeSignature,
              }
              : {}),
          },
        ),
      });
      invalidateHubCache('/api/campaigns');
      setDialog(null);
      router.push(
        kind === 'auto'
          ? `/campaigns/${data.campaign.id}/prospect`
          : `/campaigns/${data.campaign.id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create campaign');
    } finally {
      setSaving(false);
    }
  }

  async function renameCampaign(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await requestJson(`/api/campaigns/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      invalidateHubCache('/api/campaigns');
      setDialog(null);
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename campaign');
    } finally {
      setSaving(false);
    }
  }

  async function saveDelivery(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await requestJson(`/api/campaigns/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_identity_slug: senderIdentity,
          delivery_settings: deliveryPayload(),
        }),
      });
      invalidateHubCache('/api/campaigns');
      setDialog(null);
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update delivery');
    } finally {
      setSaving(false);
    }
  }

  async function setAutoStatus(campaign: Campaign, autoStatus: 'live' | 'paused') {
    try {
      await requestJson(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_status: autoStatus }),
      });
      invalidateHubCache('/api/campaigns');
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update campaign');
    }
  }

  async function terminateCampaign(campaign: Campaign) {
    if (!window.confirm(`Terminate “${campaign.name}”? It stops sending and gives its capacity back. This cannot be resumed.`)) return;
    try {
      await requestJson(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'terminated' }),
      });
      invalidateHubCache('/api/campaigns');
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to terminate campaign');
    }
  }

  async function archiveCampaign(campaign: Campaign) {
    if (!window.confirm(`Archive “${campaign.name}”? You can restore it later.`)) return;
    try {
      await requestJson(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      invalidateHubCache('/api/campaigns');
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive campaign');
    }
  }

  async function mergeCampaign(event: FormEvent) {
    event.preventDefault();
    if (!selected || !sourceId) return;
    setSaving(true);
    try {
      await requestJson(`/api/campaigns/${selected.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_campaign_id: sourceId }),
      });
      invalidateHubCache('/api/campaigns');
      setDialog(null);
      await loadCampaigns(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to merge campaigns');
    } finally {
      setSaving(false);
    }
  }

  if (loading && campaigns.length === 0) {
    return <HubLoadingSpinner label="Loading campaigns" />;
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Outreach Hub</div>
            <div className="card__subtitle">Live Auto campaigns are shared · {email}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void signOut({ callbackUrl: '/' })}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="card__body">
          {error && <p className="field__error">{error}</p>}
          <section className="hub-overview" aria-labelledby="hub-overview-title">
            <HubPlaneFlight />
            <div className="hub-overview__pitch">
              <h2 id="hub-overview-title">
                <span>Upload your Leads.</span>
                <span>Personalized Outreach.</span>
              </h2>
              <p>
                Upload an image, csv, doc, pdf, and more. Outreach Hub enriches your leads, researches them,
                situates them in Helios&apos;s prior work, and drafts personalized emails for each one.
              </p>
            </div>
            <LeadListTutorial />
          </section>
          {active.length === 0 ? (
            <div className="empty-state">
              <strong>Create your first campaign</strong>
              <span>Keep each outreach list organized in its own workspace, then add your lead sources.</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn--primary" onClick={openCreate}>+ New Campaign</button>
              </div>
            </div>
          ) : (
            <div className="hub-campaigns">
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn--primary hub-campaigns__create" type="button" onClick={openCreate}>
                  + New Campaign
                </button>
              </div>
              <div className="hub-campaigns__header">
                <strong>Your campaigns</strong>
                <span>{active.length} active</span>
              </div>
              <div className="campaign-list">
                {active.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    canMerge={active.length > 1 && campaign.kind !== 'auto'}
                    onRename={() => openRename(campaign)}
                    onDelivery={() => openDelivery(campaign)}
                    onMerge={() => openMerge(campaign)}
                    onArchive={() => void archiveCampaign(campaign)}
                    onPause={() => void setAutoStatus(campaign, 'paused')}
                    onResume={() => void setAutoStatus(campaign, 'live')}
                    onTerminate={() => void terminateCampaign(campaign)}
                    onReload={() => void loadCampaigns(true)}
                  />
                ))}
              </div>
            </div>
          )}

          {terminated.length > 0 && (
            <details className="archived-campaigns">
              <summary>Terminated campaigns ({terminated.length})</summary>
              <div className="campaign-list">
                {terminated.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    canMerge={false}
                    onRename={() => openRename(campaign)}
                    onDelivery={() => undefined}
                    onMerge={() => undefined}
                    onArchive={() => undefined}
                    onPause={() => undefined}
                    onResume={() => undefined}
                    onTerminate={() => undefined}
                    onReload={() => void loadCampaigns(true)}
                  />
                ))}
              </div>
            </details>
          )}

          {archived.length > 0 && (
            <details className="archived-campaigns">
              <summary>Archived campaigns ({archived.length})</summary>
              <div className="campaign-list">
                {archived.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    canMerge={false}
                    onRename={() => openRename(campaign)}
                    onDelivery={() => openDelivery(campaign)}
                    onMerge={() => undefined}
                    onArchive={() => undefined}
                    onPause={() => undefined}
                    onResume={() => undefined}
                    onTerminate={() => undefined}
                    onReload={() => void loadCampaigns(true)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {dialog && (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => !saving && setDialog(null)}>
          <section className={`card dialog${dialog === 'create' || dialog === 'delivery' ? ' dialog--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="card__header">
              <div className="card__title">
                {dialog === 'create' && 'New Campaign'}
                {dialog === 'rename' && 'Rename Campaign'}
                {dialog === 'merge' && `Merge into “${selected?.name}”`}
                {dialog === 'delivery' && `Delivery · ${selected?.name}`}
              </div>
              <button className="dialog__close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={18} /></button>
            </div>
            <div className="card__body">
              {dialog === 'create' && (
                <form className="setup-form" onSubmit={(event) => void createCampaign(event)}>
                  <label className="field">
                    <span className="field__label">Campaign name</span>
                    <input
                      className="field__input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={kind === 'auto' ? 'e.g. NYC CRE principals' : 'e.g. Q3 Fintech VP Outreach'}
                      autoFocus
                      required
                    />
                  </label>
                  <ChoiceCards
                    legend="How leads get in"
                    value={kind}
                    onChange={setKind}
                    options={[
                      { id: 'manual', title: 'Manual', detail: 'You upload the list. Helios drafts and sends it.' },
                      { id: 'auto', title: 'Auto', detail: 'Helios finds new people from the filters below, every day.' },
                    ]}
                  />
                  <ChoiceCards
                    legend="The email"
                    value={messageMode}
                    onChange={(mode) => {
                      setMessageMode(mode);
                      if (mode === 'custom') setNeedsEnrichment(false);
                    }}
                    options={[
                      { id: 'ai', title: 'Written per lead', detail: 'Claude researches the person and writes a unique email.' },
                      { id: 'custom', title: 'One template', detail: 'The same message for every lead. Merge fields fill the names.' },
                    ]}
                  />
                  {kind === 'manual' ? (
                    <ChoiceCards
                      legend="The list"
                      value={needsEnrichment ? 'yes' : 'no'}
                      onChange={(value) => setNeedsEnrichment(value === 'yes')}
                      options={[
                        {
                          id: 'no',
                          title: 'Already enriched',
                          detail: 'Upload, then draft. Use this when the list already has validated emails.',
                        },
                        {
                          id: 'yes',
                          title: 'Needs research',
                          detail: messageMode === 'custom'
                            ? 'Looks up missing emails and profile fields. Costs Claude, even with a template.'
                            : 'Upload, enrich, review, then draft. For lists that still need emails.',
                        },
                      ]}
                    />
                  ) : (
                    <div className="setup-section">
                      <p className="setup-section__title">Who to find</p>
                      <label className="field">
                        <span className="field__label">Industry</span>
                        <input className="field__input" value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Commercial real estate" required />
                      </label>
                      <label className="field">
                        <span className="field__label">Seniority</span>
                        <input className="field__input" value={seniority} onChange={(event) => setSeniority(event.target.value)} placeholder="Owner / principal" required />
                      </label>
                      <label className="field">
                        <span className="field__label">Geography</span>
                        <input className="field__input" value={geography} onChange={(event) => setGeography(event.target.value)} placeholder="New York City" required />
                      </label>
                      <label className="field">
                        <span className="field__label">Business size</span>
                        <input className="field__input" value={businessSize} onChange={(event) => setBusinessSize(event.target.value)} placeholder="11–50" required />
                      </label>
                    </div>
                  )}
                  <ChoiceCards
                    legend="Who sends"
                    value={senderIdentity}
                    onChange={setSenderIdentity}
                    options={(['lucas', 'tommy'] as const).map((slug) => ({
                      id: slug,
                      title: SENDER_IDENTITY_LABELS[slug],
                      detail: 'Campaign mail goes out from this person’s ramping and production mailboxes.',
                    }))}
                  />
                  <CapacityShareField
                    pct={capacityPct}
                    onChange={setCapacityPct}
                    days={senderCapacityDays(roster, senderIdentity)}
                  />
                  <SendingRules
                    tracking={tracking}
                    setTracking={setTracking}
                    replyFallback={replyFallback}
                    setReplyFallback={setReplyFallback}
                    scheduleStart={scheduleStart}
                    setScheduleStart={setScheduleStart}
                    scheduleEnd={scheduleEnd}
                    setScheduleEnd={setScheduleEnd}
                  />
                  {messageMode === 'custom' ? (
                    <MessageComposer
                      subject={subjectTemplate}
                      body={bodyTemplate}
                      includeSignature={includeSignature}
                      onSubjectChange={setSubjectTemplate}
                      onBodyChange={setBodyTemplate}
                      onIncludeSignatureChange={setIncludeSignature}
                      signatureHtml={signaturePreviewHtml}
                    />
                  ) : null}
                  <FollowUpFields
                    delay={followUpDelay}
                    setDelay={setFollowUpDelay}
                    body={followUpBody}
                    setBody={setFollowUpBody}
                  />
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={
                      saving
                      || !name.trim()
                      || !customTemplateValid
                      || capacityPct < 1
                      || capacityPct > 100
                      || (kind === 'auto' && (!industry.trim() || !seniority.trim() || !geography.trim() || !businessSize.trim()))
                    }
                  >
                    {saving ? 'Saving…' : 'Create Campaign'}
                  </button>
                </form>
              )}
              {dialog === 'rename' && (
                <CampaignNameForm name={name} setName={setName} saving={saving} submitLabel="Save Name" onSubmit={renameCampaign} />
              )}
              {dialog === 'delivery' && selected && (
                <form className="setup-form" onSubmit={(event) => void saveDelivery(event)}>
                  {selected.delivery_settings?.capacity_pct == null && (selected.delivery_settings?.max_new_leads_per_day || selected.emails_per_day) ? (
                    <p className="setup-section__hint">
                      This campaign is still on a fixed daily count
                      {selected.delivery_settings?.max_new_leads_per_day ? ` of ${selected.delivery_settings.max_new_leads_per_day}` : selected.emails_per_day ? ` of ${selected.emails_per_day}` : ''}.
                      Saving switches it to a share of inbox capacity, so the number moves as mailboxes ramp.
                    </p>
                  ) : null}
                  <ChoiceCards
                    legend="Who sends"
                    value={senderIdentity}
                    onChange={(slug) => {
                      if (selected.kind === 'auto') return;
                      setSenderIdentity(slug);
                    }}
                    options={(['lucas', 'tommy'] as const).map((slug) => ({
                      id: slug,
                      title: SENDER_IDENTITY_LABELS[slug],
                      detail: selected.kind === 'auto'
                        ? 'Auto campaigns keep the sender they were created with.'
                        : 'Campaign mail goes out from this person’s ramping and production mailboxes.',
                    }))}
                  />
                  <CapacityShareField
                    pct={capacityPct}
                    onChange={setCapacityPct}
                    days={senderCapacityDays(roster, senderIdentity)}
                  />
                  <SendingRules
                    tracking={tracking}
                    setTracking={setTracking}
                    replyFallback={replyFallback}
                    setReplyFallback={setReplyFallback}
                    scheduleStart={scheduleStart}
                    setScheduleStart={setScheduleStart}
                    scheduleEnd={scheduleEnd}
                    setScheduleEnd={setScheduleEnd}
                  />
                  <FollowUpFields
                    delay={followUpDelay}
                    setDelay={setFollowUpDelay}
                    body={followUpBody}
                    setBody={setFollowUpBody}
                  />
                  <button className="btn btn--primary" type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save delivery'}
                  </button>
                </form>
              )}
              {dialog === 'merge' && selected && (
                <form className="login-form" onSubmit={mergeCampaign}>
                  <p className="text-muted">The selected campaign will keep its name. Leads from the campaign below will be added and high-confidence duplicates collapsed.</p>
                  <label className="field">
                    <span className="field__label">Campaign to bring in</span>
                    <select className="field__input" value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>
                      {active.filter((campaign) => campaign.id !== selected.id).map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn--primary" type="submit" disabled={saving || !sourceId}>
                    {saving ? 'Merging…' : 'Merge Campaigns'}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function senderCapacityDays(roster: InboxRoster | null, identity: SenderIdentitySlug) {
  if (!roster) return undefined;
  const mine = roster.inboxes.filter((inbox) => inbox.identity_slug === identity && inbox.enabled);
  const horizon = mine[0]?.capacity_7d.length ?? 0;
  if (!horizon) return [];
  return Array.from({ length: horizon }, (_, index) => ({
    date: mine[0]?.capacity_7d[index]?.date ?? '',
    cap: mine.reduce((sum, inbox) => sum + (inbox.capacity_7d[index]?.cap ?? 0), 0),
  }));
}

function SendingRules({
  tracking,
  setTracking,
  replyFallback,
  setReplyFallback,
  scheduleStart,
  setScheduleStart,
  scheduleEnd,
  setScheduleEnd,
}: {
  tracking: boolean;
  setTracking: (value: boolean) => void;
  replyFallback: 'claude' | 'human_only';
  setReplyFallback: (value: 'claude' | 'human_only') => void;
  scheduleStart: string;
  setScheduleStart: (value: string) => void;
  scheduleEnd: string;
  setScheduleEnd: (value: string) => void;
}) {
  return (
    <div className="setup-section">
      <p className="setup-section__title">Sending rules</p>
      <ChoiceCards
        legend="Tracking"
        value={tracking ? 'on' : 'off'}
        onChange={(value) => setTracking(value === 'on')}
        options={[
          { id: 'off', title: 'Tracking off', detail: 'No open or click pixels. Better for deliverability.' },
          { id: 'on', title: 'Opens and clicks', detail: 'Smartlead records when someone opens or clicks.' },
        ]}
      />
      <ChoiceCards
        legend="If they reply and Claude is unsure"
        value={replyFallback}
        onChange={setReplyFallback}
        options={[
          { id: 'claude', title: 'Claude can answer', detail: 'A reply draft goes out when the model is confident.' },
          { id: 'human_only', title: 'You answer', detail: 'Replies wait for you. Nothing sends on its own.' },
        ]}
      />
      <label className="field">
        <span className="field__label">Send window (America/New_York, weekdays)</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="field__input" type="time" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
          <input className="field__input" type="time" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} />
        </div>
      </label>
    </div>
  );
}

function FollowUpFields({
  delay,
  setDelay,
  body,
  setBody,
}: {
  delay: string;
  setDelay: (value: string) => void;
  body: string;
  setBody: (value: string) => void;
}) {
  return (
    <div className="setup-section">
      <p className="setup-section__title">Follow-up</p>
      <p className="setup-section__hint">Optional. Sent only if they have not replied. The first email is the message above.</p>
      <label className="field">
        <span className="field__label">Follow-up delay (days)</span>
        <input className="field__input" value={delay} onChange={(event) => setDelay(event.target.value)} placeholder="3" />
      </label>
      <MessageComposer
        variant="body"
        subject=""
        body={body}
        includeSignature={false}
        onSubjectChange={() => undefined}
        onBodyChange={setBody}
        bodyLabel="Follow-up body"
        bodyPlaceholder="Leave blank for no follow-up. Type [ to insert a field."
      />
    </div>
  );
}

function CampaignNameForm({
  name, setName, saving, submitLabel, onSubmit,
}: {
  name: string;
  setName: (name: string) => void;
  saving: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <form className="login-form" onSubmit={(event) => void onSubmit(event)}>
      <label className="field">
        <span className="field__label">Campaign name</span>
        <input
          className="field__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Q3 Fintech VP Outreach"
          autoFocus
          required
        />
      </label>
      <button className="btn btn--primary" type="submit" disabled={saving || !name.trim()}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function CampaignRow({
  campaign, canMerge, onRename, onDelivery, onMerge, onArchive, onPause, onResume, onTerminate, onReload,
}: {
  campaign: Campaign;
  canMerge: boolean;
  onRename: () => void;
  onDelivery: () => void;
  onMerge: () => void;
  onArchive: () => void;
  onPause: () => void;
  onResume: () => void;
  onTerminate: () => void;
  onReload: () => void;
}) {
  const [editingTag, setEditingTag] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleAddTag(tagName: string, colorId: string) {
    try {
      await requestJson(`/api/campaigns/${campaign.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: tagName, color: colorId }),
      });
      setEditingTag(false);
      onReload();
    } catch {
      // Ignore
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      await requestJson(`/api/campaigns/${campaign.id}/tags?tag=${encodeURIComponent(tag)}`, {
        method: 'DELETE',
      });
      onReload();
    } catch {
      // Ignore
    }
  }

  const tagItems: { tag: string; color?: string | null }[] = campaign.tag_details?.length
    ? campaign.tag_details
    : (campaign.tags ?? []).map((t) => ({ tag: t, color: null }));

  const draftingActive = Boolean(campaign.drafting_active);
  const draftingGenerated = campaign.drafting_generated ?? 0;
  const draftingTotal = campaign.drafting_total ?? 0;
  const draftingLabel = draftingTotal > 0
    ? `Drafting · ${draftingGenerated} of ${draftingTotal}`
    : 'Drafting';
  const isAuto = campaign.kind === 'auto';
  const isLive = isLiveAutoCampaign(campaign);
  const isPaused = isAuto && campaign.status === 'active' && campaign.auto_status === 'paused';
  const isTerminated = campaign.status === 'terminated';
  const href = campaignHref(campaign);
  const laneLabel = campaign.lane_status ? `lane ${campaign.lane_status}` : 'lane pending';
  const forecastLabel = campaign.tomorrow_forecast
    ? `${campaign.tomorrow_forecast} planned tomorrow`
    : 'no handoffs tomorrow';
  const volume = campaign.delivery_settings?.capacity_pct != null
    ? `${campaign.delivery_settings.capacity_pct}% of capacity`
    : null;
  const meta = [
    SENDER_IDENTITY_LABELS[campaign.sender_identity_slug ?? 'lucas'],
    volume,
    laneLabel,
    forecastLabel,
    isAuto ? `${campaign.sent_count ?? 0} sent` : null,
    isAuto ? `${campaign.lead_count} pulled` : `${campaign.lead_count} ${campaign.lead_count === 1 ? 'lead' : 'leads'}`,
    isTerminated
      ? 'terminated'
      : isAuto
        ? (campaign.auto_status ?? 'pending_sender').replace(/_/g, ' ')
        : formatDate(campaign.last_run_at),
  ].filter(Boolean).join(' · ');

  return (
    <div className={`campaign-row${draftingActive ? ' campaign-row--drafting' : ''}${isLive ? ' campaign-row--live' : ''}${menuOpen ? ' campaign-row--menu-open' : ''}`}>
      <div className="campaign-row__top">
        <Link
          className="campaign-row__main"
          href={href}
          prefetch={false}
        >
          <span className="campaign-row__heading">
            {isLive ? <LivePulse live label="Live" /> : null}
            {isPaused ? <span className="campaign-row__paused">Paused</span> : null}
            {isTerminated ? <span className="campaign-row__paused">Terminated</span> : null}
            <span className="campaign-row__name">{campaign.name}</span>
            {draftingActive ? (
              <span className="campaign-row__drafting" role="status" aria-live="polite">
                <span className="loading-spinner campaign-row__drafting-spinner" aria-hidden="true" />
                {draftingLabel}
              </span>
            ) : null}
          </span>
          <span className="campaign-row__meta">{meta}</span>
        </Link>
        <button
          type="button"
          className="campaign-row__more"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Hide campaign actions' : 'Show campaign actions'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="campaign-row__tags">
        {tagItems.map((item) => (
          <TagBadge
            key={item.tag}
            tag={item.tag}
            color={item.color}
            onRemove={() => void handleRemoveTag(item.tag)}
            size="sm"
          />
        ))}

        {editingTag ? (
          <TagInputPopover
            onAddTag={handleAddTag}
            onCancel={() => setEditingTag(false)}
            excludeTags={tagItems.map((item) => item.tag)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTag(true)}
            style={{
              border: '1px dashed var(--color-border)',
              background: 'transparent',
              borderRadius: 'var(--radius-pill)',
              padding: '2px 8px',
              fontSize: '11px',
              color: 'var(--color-text-subtle)',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            + Tag
          </button>
        )}
      </div>

      <div className="campaign-row__actions">
        {campaign.status === 'active' && isAuto && isLive ? (
          <button className="btn btn--quiet" onClick={onPause}>Pause</button>
        ) : null}
        {campaign.status === 'active' && isAuto && (isPaused || campaign.auto_status === 'exhausted' || campaign.auto_status === 'error') ? (
          <button className="btn btn--quiet" onClick={onResume}>Resume</button>
        ) : null}
        {campaign.status === 'active' && (
          <button className="btn btn--quiet" onClick={onTerminate}>Terminate</button>
        )}
        {campaign.status === 'active' && canMerge && <button className="btn btn--quiet" onClick={onMerge}>Merge in</button>}
        <button className="btn btn--quiet" onClick={onRename}>Rename</button>
        {campaign.status === 'active' && <button className="btn btn--quiet" onClick={onDelivery}>Delivery</button>}
        {campaign.status === 'active' && <button className="btn btn--quiet" onClick={onArchive}>Archive</button>}
      </div>
    </div>
  );
}
