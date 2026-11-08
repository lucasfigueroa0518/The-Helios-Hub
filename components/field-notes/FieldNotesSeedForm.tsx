'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { CONTENT_LEAVES, WANTS, type ContentLeaf, type Want } from '@/lib/field-notes/types';

import { LEAF_LABEL, WANT_LABEL } from './constants';

/**
 * "Seed an idea" for Field Notes: a source link, what it points to (leaf) and what the reader gets (want), both
 * required, and an optional note. Posts only to /api/field-notes/seed,
 * which adds a tip (source kind seed). No model call, no page fetch, nothing is made or spent; the link
 * is read when someone presses Generate. A link already in the list is reported, not an error.
 */
export function FieldNotesSeedForm({ done }: SeedFormProps) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [leaf, setLeaf] = useState<ContentLeaf | ''>('');
  const [want, setWant] = useState<Want | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/field-notes/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, note, leaf, want }) });
      const json = (await res.json().catch(() => ({}))) as { kind?: 'created' | 'reopened' | 'duplicate'; subject?: string; status?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      done(
        json.kind === 'reopened'
          ? `Put ${json.subject ?? 'the tip'} back on the Field Notes list. Nothing was made.`
          : json.kind === 'duplicate'
          ? `That link is already a Field Notes tip (${json.subject ?? 'the source'}, ${json.status ?? 'waiting'}). Nothing was added.`
          : `Added ${json.subject ?? 'the tip'} to the Field Notes list. Nothing was made.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ex-form rh-seed-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 className="rh-detail__archetype">Seed a Field Notes tip</h2>
      <input className="helios-field-input" type="url" placeholder="Link to the tool, skill or repo" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Source link" required />
      <select className="helios-field-input" value={leaf} onChange={(e) => setLeaf(e.target.value as ContentLeaf | '')} aria-label="What it points to" required>
        <option value="" disabled>What it points to</option>
        {CONTENT_LEAVES.map((l) => <option key={l} value={l}>{LEAF_LABEL[l]}</option>)}
      </select>
      <select className="helios-field-input" value={want} onChange={(e) => setWant(e.target.value as Want | '')} aria-label="What the reader gets" required>
        <option value="" disabled>What the reader gets</option>
        {WANTS.map((w) => <option key={w} value={w}>{WANT_LABEL[w]}</option>)}
      </select>
      <textarea className="ex-textarea" placeholder="Note: what to do with it and what you get (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} aria-label="Note" />
      <div className="ex-actions">
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !url.trim() || !leaf || !want}>{busy ? 'Adding…' : 'Add the tip'}</button>
      </div>
      <p className="rh-muted">Adds the tip to the list. Nothing is made and nothing is spent; the page is read when you press Generate.</p>
      {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
    </form>
  );
}
