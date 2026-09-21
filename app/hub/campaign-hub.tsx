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
import { approvalLockExpired, DEFAULT_DELIVERY_SETTINGS } from '@/lib/smartlead/delivery-settings';

const DRAFTING_POLL_MS = 5_000;

type Campaign = {
  id: string;
  name: string;
  status: 'active' | 'archived';
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
  const [emailsPerDay, setEmailsPerDay] = useState('10');
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
  const [maxNewLeads, setMaxNewLeads] = useState('');
  const [replyFallback, setReplyFallback] = useState<'claude' | 'human_only'>('claude');
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');
  const [requireApproval, setRequireApproval] = useState(true);
  const [requireApprovalUntil, setRequireApprovalUntil] = useState<string | null>(null);

  const active = useMemo(() => campaigns.filter((campaign) => campaign.status === 'active'), [campaigns]);
  const archived = useMemo(() => campaigns.filter((campaign) => campaign.status === 'archived'), [campaigns]);
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
    setEmailsPerDay('10');
    setSenderIdentity('lucas');
    setMessageMode('ai');
    setSubjectTemplate('');
    setBodyTemplate('');
    setIncludeSignature(true);
    setTracking(false);
    setFollowUpDelay('3');
    setFollowUpBody('');
    setMaxNewLeads('');
    setReplyFallback('claude');
    setScheduleStart('09:00');
    setScheduleEnd('17:00');
    setRequireApproval(true);
    setRequireApprovalUntil(null);
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
    setMaxNewLeads(settings?.max_new_leads_per_day ? String(settings.max_new_leads_per_day) : '');
    setFollowUpDelay(follow ? String(follow.delay_days) : '3');
    setFollowUpBody(follow?.body_template ?? '');
    setScheduleStart(settings?.schedule.start ?? '09:00');
    setScheduleEnd(settings?.schedule.end ?? '17:00');
    setRequireApproval(settings?.require_approval ?? true);
    setRequireApprovalUntil(settings?.require_approval_until ?? null);
  }

  function deliveryPayload() {
    return {
      tracking,
      reply_fallback: replyFallback,
      max_new_leads_per_day: maxNewLeads.trim()
        ? Number.parseInt(maxNewLeads.replace(/[^\d]/g, ''), 10)
        : null,
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
                emails_per_day: Number.parseInt(emailsPerDay.replace(/[^\d]/g, ''), 10),
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
          delivery_settings: {
            ...deliveryPayload(),
            require_approval: requireApproval,
          },
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
                    onReload={() => void loadCampaigns(true)}
                  />
                ))}
              </div>
            </div>
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
          <section className={`card dialog${dialog === 'create' && messageMode === 'custom' ? ' dialog--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
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
                <form className="login-form" onSubmit={(event) => void createCampaign(event)}>
                  <div className="field">
                    <span className="field__label">Campaign type</span>
                    <div className="segmented" style={{ width: 'fit-content' }}>
                      <button
                        type="button"
                        className={`segmented__item${kind === 'manual' ? ' segmented__item--active' : ''}`}
                        onClick={() => setKind('manual')}
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        className={`segmented__item${kind === 'auto' ? ' segmented__item--active' : ''}`}
                        onClick={() => setKind('auto')}
                      >
                        Auto
                      </button>
                    </div>
                  </div>
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
                  <div className="field">
                    <span className="field__label">Message</span>
                    <div className="segmented" style={{ width: 'fit-content' }}>
                      <button
                        type="button"
                        className={`segmented__item${messageMode === 'ai' ? ' segmented__item--active' : ''}`}
                        onClick={() => setMessageMode('ai')}
                      >
                        AI-generated
                      </button>
                      <button
                        type="button"
                        className={`segmented__item${messageMode === 'custom' ? ' segmented__item--active' : ''}`}
                        onClick={() => {
                          setMessageMode('custom');
                          setNeedsEnrichment(false);
                        }}
                      >
                        Custom message
                      </button>
                    </div>
                    <p className="field__hint" style={{ margin: 0, marginTop: 'var(--space-1)' }}>
                      {messageMode === 'custom'
                        ? 'One template for every lead. Merge fields fill from the list — no Claude drafting cost.'
                        : 'Research plus write. Claude drafts a unique email per lead.'}
                    </p>
                  </div>
                  {kind === 'manual' ? (
                    <div className="field" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                      <span className="field__label" id="needs-enrichment-label">Needs Enrichment?</span>
                      <div className="segmented" style={{ width: 'fit-content' }}>
                        <button
                          type="button"
                          className={`segmented__item${!needsEnrichment ? ' segmented__item--active' : ''}`}
                          onClick={() => setNeedsEnrichment(false)}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          className={`segmented__item${needsEnrichment ? ' segmented__item--active' : ''}`}
                          onClick={() => setNeedsEnrichment(true)}
                        >
                          Yes
                        </button>
                      </div>
                      <p className="field__hint" style={{ margin: 0, marginTop: 'var(--space-1)' }}>
                        {needsEnrichment
                          ? (messageMode === 'custom'
                            ? 'Enrich still costs Claude and is usually unnecessary for a custom template. Continue only if the list is missing emails or profile fields.'
                            : 'Upload → Enrich → Review → Draft. Use for lists that still need email and profile research.')
                          : 'Upload → Draft. Use for lists that are already enriched with validated emails.'}
                      </p>
                    </div>
                  ) : (
                    <>
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
                      <label className="field">
                        <span className="field__label">Emails per day</span>
                        <input
                          className="field__input"
                          value={emailsPerDay}
                          onChange={(event) => setEmailsPerDay(event.target.value)}
                          placeholder="50"
                          required
                        />
                      </label>
                    </>
                  )}
                  <div className="field" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
                    <span className="field__label">Delivery</span>
                    <p className="field__hint" style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
                      Smartlead sends from this identity&apos;s mailboxes. Follow-ups and tracking are optional.
                    </p>
                    <span className="field__label">Sender</span>
                    <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
                      {(['lucas', 'tommy'] as const).map((slug) => (
                        <button
                          key={slug}
                          type="button"
                          className={`segmented__item${senderIdentity === slug ? ' segmented__item--active' : ''}`}
                          onClick={() => setSenderIdentity(slug)}
                        >
                          {SENDER_IDENTITY_LABELS[slug]}
                        </button>
                      ))}
                    </div>
                    <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
                      <button
                        type="button"
                        className={`segmented__item${!tracking ? ' segmented__item--active' : ''}`}
                        onClick={() => setTracking(false)}
                      >
                        Tracking off
                      </button>
                      <button
                        type="button"
                        className={`segmented__item${tracking ? ' segmented__item--active' : ''}`}
                        onClick={() => setTracking(true)}
                      >
                        Opens &amp; clicks
                      </button>
                    </div>
                    <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
                      <button
                        type="button"
                        className={`segmented__item${replyFallback === 'claude' ? ' segmented__item--active' : ''}`}
                        onClick={() => setReplyFallback('claude')}
                      >
                        Claude fallback
                      </button>
                      <button
                        type="button"
                        className={`segmented__item${replyFallback === 'human_only' ? ' segmented__item--active' : ''}`}
                        onClick={() => setReplyFallback('human_only')}
                      >
                        Human only
                      </button>
                    </div>
                    <label className="field">
                      <span className="field__label">Max new leads / day</span>
                      <input
                        className="field__input"
                        value={maxNewLeads}
                        onChange={(event) => setMaxNewLeads(event.target.value)}
                        placeholder="Leave blank for mailbox capacity"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Follow-up delay (days)</span>
                      <input
                        className="field__input"
                        value={followUpDelay}
                        onChange={(event) => setFollowUpDelay(event.target.value)}
                        placeholder="3"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Send window (America/New_York, weekdays)</span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          className="field__input"
                          type="time"
                          value={scheduleStart}
                          onChange={(event) => setScheduleStart(event.target.value)}
                        />
                        <input
                          className="field__input"
                          type="time"
                          value={scheduleEnd}
                          onChange={(event) => setScheduleEnd(event.target.value)}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span className="field__label">Follow-up body (optional)</span>
                      <textarea
                        className="field__input"
                        rows={4}
                        value={followUpBody}
                        onChange={(event) => setFollowUpBody(event.target.value)}
                        placeholder="Leave blank for no follow-up. Step 1 is the per-lead draft."
                      />
                    </label>
                  </div>
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
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={
                      saving
                      || !name.trim()
                      || !customTemplateValid
                      || (kind === 'auto' && (!industry.trim() || !seniority.trim() || !geography.trim() || !businessSize.trim() || !Number.parseInt(emailsPerDay.replace(/[^\d]/g, ''), 10)))
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
                <form className="login-form" onSubmit={(event) => void saveDelivery(event)}>
                  <DeliveryFields
                    senderIdentity={senderIdentity}
                    setSenderIdentity={setSenderIdentity}
                    tracking={tracking}
                    setTracking={setTracking}
                    replyFallback={replyFallback}
                    setReplyFallback={setReplyFallback}
                    maxNewLeads={maxNewLeads}
                    setMaxNewLeads={setMaxNewLeads}
                    followUpDelay={followUpDelay}
                    setFollowUpDelay={setFollowUpDelay}
                    followUpBody={followUpBody}
                    setFollowUpBody={setFollowUpBody}
                    scheduleStart={scheduleStart}
                    setScheduleStart={setScheduleStart}
                    scheduleEnd={scheduleEnd}
                    setScheduleEnd={setScheduleEnd}
                    identityLocked={selected.kind === 'auto'}
                  />
                  <div className="field">
                    <span className="field__label">Approve before handoff</span>
                    <div className="segmented" style={{ width: 'fit-content' }}>
                      <button
                        type="button"
                        className={`segmented__item${requireApproval ? ' segmented__item--active' : ''}`}
                        onClick={() => setRequireApproval(true)}
                      >
                        Required
                      </button>
                      <button
                        type="button"
                        className={`segmented__item${!requireApproval ? ' segmented__item--active' : ''}`}
                        disabled={!approvalLockExpired({
                          ...DEFAULT_DELIVERY_SETTINGS,
                          require_approval: requireApproval,
                          require_approval_until: requireApprovalUntil,
                        })}
                        onClick={() => setRequireApproval(false)}
                      >
                        Off
                      </button>
                    </div>
                    <p className="field__hint" style={{ margin: 0, marginTop: 'var(--space-1)' }}>
                      {requireApprovalUntil && !approvalLockExpired({
                        ...DEFAULT_DELIVERY_SETTINGS,
                        require_approval: requireApproval,
                        require_approval_until: requireApprovalUntil,
                      })
                        ? `Stays on until ${requireApprovalUntil}. After that you can turn it off.`
                        : 'Drafts wait for approval before Smartlead gets them.'}
                    </p>
                  </div>
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

function DeliveryFields({
  senderIdentity,
  setSenderIdentity,
  tracking,
  setTracking,
  replyFallback,
  setReplyFallback,
  maxNewLeads,
  setMaxNewLeads,
  followUpDelay,
  setFollowUpDelay,
  followUpBody,
  setFollowUpBody,
  scheduleStart,
  setScheduleStart,
  scheduleEnd,
  setScheduleEnd,
  identityLocked,
}: {
  senderIdentity: SenderIdentitySlug;
  setSenderIdentity: (value: SenderIdentitySlug) => void;
  tracking: boolean;
  setTracking: (value: boolean) => void;
  replyFallback: 'claude' | 'human_only';
  setReplyFallback: (value: 'claude' | 'human_only') => void;
  maxNewLeads: string;
  setMaxNewLeads: (value: string) => void;
  followUpDelay: string;
  setFollowUpDelay: (value: string) => void;
  followUpBody: string;
  setFollowUpBody: (value: string) => void;
  scheduleStart: string;
  setScheduleStart: (value: string) => void;
  scheduleEnd: string;
  setScheduleEnd: (value: string) => void;
  identityLocked?: boolean;
}) {
  return (
    <>
      <span className="field__label">Sender</span>
      <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
        {(['lucas', 'tommy'] as const).map((slug) => (
          <button
            key={slug}
            type="button"
            className={`segmented__item${senderIdentity === slug ? ' segmented__item--active' : ''}`}
            disabled={identityLocked}
            onClick={() => setSenderIdentity(slug)}
          >
            {SENDER_IDENTITY_LABELS[slug]}
          </button>
        ))}
      </div>
      <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
        <button type="button" className={`segmented__item${!tracking ? ' segmented__item--active' : ''}`} onClick={() => setTracking(false)}>
          Tracking off
        </button>
        <button type="button" className={`segmented__item${tracking ? ' segmented__item--active' : ''}`} onClick={() => setTracking(true)}>
          Opens &amp; clicks
        </button>
      </div>
      <div className="segmented" style={{ width: 'fit-content', marginBottom: 'var(--space-2)' }}>
        <button type="button" className={`segmented__item${replyFallback === 'claude' ? ' segmented__item--active' : ''}`} onClick={() => setReplyFallback('claude')}>
          Claude fallback
        </button>
        <button type="button" className={`segmented__item${replyFallback === 'human_only' ? ' segmented__item--active' : ''}`} onClick={() => setReplyFallback('human_only')}>
          Human only
        </button>
      </div>
      <label className="field">
        <span className="field__label">Max new leads / day</span>
        <input className="field__input" value={maxNewLeads} onChange={(event) => setMaxNewLeads(event.target.value)} placeholder="Leave blank for mailbox capacity" />
      </label>
      <label className="field">
        <span className="field__label">Follow-up delay (days)</span>
        <input className="field__input" value={followUpDelay} onChange={(event) => setFollowUpDelay(event.target.value)} placeholder="3" />
      </label>
      <label className="field">
        <span className="field__label">Send window (America/New_York, weekdays)</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="field__input" type="time" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
          <input className="field__input" type="time" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} />
        </div>
      </label>
      <label className="field">
        <span className="field__label">Follow-up body (optional)</span>
        <textarea
          className="field__input"
          rows={4}
          value={followUpBody}
          onChange={(event) => setFollowUpBody(event.target.value)}
          placeholder="Leave blank for no follow-up. Step 1 is the per-lead draft."
        />
      </label>
    </>
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
  campaign, canMerge, onRename, onDelivery, onMerge, onArchive, onReload,
}: {
  campaign: Campaign;
  canMerge: boolean;
  onRename: () => void;
  onDelivery: () => void;
  onMerge: () => void;
  onArchive: () => void;
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
  const isPaused = isAuto && campaign.auto_status === 'paused';
  const href = campaignHref(campaign);
  const laneLabel = campaign.lane_status ? `lane ${campaign.lane_status}` : 'lane pending';
  const forecastLabel = campaign.tomorrow_forecast
    ? `${campaign.tomorrow_forecast} planned tomorrow`
    : 'no handoffs tomorrow';
  const meta = isAuto
    ? `${SENDER_IDENTITY_LABELS[campaign.sender_identity_slug ?? 'lucas']} · ${laneLabel} · ${forecastLabel} · ${campaign.sent_count ?? 0} sent · ${campaign.lead_count} pulled · ${(campaign.auto_status ?? 'pending_sender').replace(/_/g, ' ')}`
    : `${SENDER_IDENTITY_LABELS[campaign.sender_identity_slug ?? 'lucas']} · ${laneLabel} · ${forecastLabel} · ${campaign.lead_count} ${campaign.lead_count === 1 ? 'lead' : 'leads'} · ${formatDate(campaign.last_run_at)}`;

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
        {campaign.status === 'active' && canMerge && <button className="btn btn--quiet" onClick={onMerge}>Merge in</button>}
        <button className="btn btn--quiet" onClick={onRename}>Rename</button>
        {campaign.status === 'active' && <button className="btn btn--quiet" onClick={onDelivery}>Delivery</button>}
        {campaign.status === 'active' && <button className="btn btn--quiet" onClick={onArchive}>Archive</button>}
      </div>
    </div>
  );
}
