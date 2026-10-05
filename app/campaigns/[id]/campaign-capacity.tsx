'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CapacityShareField } from '@/app/hub/campaign-setup-fields';
import { hubGetJson } from '@/app/hub/hub-data';
import { requestJson } from '@/lib/client-request';
import type { Campaign } from '@/lib/campaigns';
import type { InboxRoster } from '@/lib/inboxes/roster';

function senderDays(roster: InboxRoster | null, identity: string) {
  if (!roster) return undefined;
  const mine = roster.inboxes.filter((inbox) => inbox.identity_slug === identity && inbox.enabled);
  const horizon = mine[0]?.capacity_7d.length ?? 0;
  if (!horizon) return [];
  return Array.from({ length: horizon }, (_, index) => ({
    date: mine[0]?.capacity_7d[index]?.date ?? '',
    cap: mine.reduce((sum, inbox) => sum + (inbox.capacity_7d[index]?.cap ?? 0), 0),
  }));
}

export function CampaignCapacityControl({
  campaignId,
  senderIdentitySlug,
  initialPct,
  legacyDailyCount,
  onSaved,
}: {
  campaignId: string;
  senderIdentitySlug: string | null;
  initialPct: number | null;
  /** Fixed emails/day this campaign still uses until a share is saved. */
  legacyDailyCount: number | null;
  onSaved?: (campaign: Campaign) => void;
}) {
  const router = useRouter();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(initialPct ?? 100);
  const [savedPct, setSavedPct] = useState<number | null>(initialPct);
  const [roster, setRoster] = useState<InboxRoster | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = senderIdentitySlug || 'lucas';
  const dirty = savedPct !== pct;

  useEffect(() => {
    void hubGetJson<InboxRoster>('/api/inboxes').then(setRoster).catch(() => setRoster(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismiss() {
      setPct(savedPct ?? 100);
      setError(null);
      setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, savedPct]);

  function close() {
    setPct(savedPct ?? 100);
    setError(null);
    setOpen(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await requestJson<{ campaign: Campaign }>(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_settings: {
            capacity_pct: pct,
            max_new_leads_per_day: null,
          },
        }),
      });
      const next = result.campaign.delivery_settings.capacity_pct ?? pct;
      setSavedPct(next);
      setPct(next);
      onSaved?.(result.campaign);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the capacity share');
    } finally {
      setSaving(false);
    }
  }

  const label = savedPct == null ? 'Set capacity' : `${savedPct}% capacity`;

  return (
    <div className="capacity-menu" ref={rootRef}>
      <button
        type="button"
        className={`btn btn--secondary capacity-menu__button${open ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
      </button>
      {open ? (
        <div className="capacity-menu__panel" id={panelId} role="dialog" aria-label="Daily capacity">
          {savedPct == null ? (
            <p className="capacity-menu__hint">
              {legacyDailyCount
                ? `This campaign still sends a fixed ${legacyDailyCount} emails a day. Saving applies this share of live inbox capacity, and the number moves as mailboxes ramp.`
                : 'This campaign does not have a capacity share yet. Saving applies this percentage of live inbox capacity.'}
            </p>
          ) : null}
          <CapacityShareField
            pct={pct}
            onChange={setPct}
            days={senderDays(roster, identity)}
          />
          <div className="capacity-menu__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!dirty || saving || pct < 1 || pct > 100}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {error ? <span className="field__error">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
