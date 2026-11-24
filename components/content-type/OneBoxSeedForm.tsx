'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON, type SeedVertical } from '@/lib/content-type/seed-verticals';

/**
 * One-box seeding (design 2026-11-04-one-box-seeding-design): a sentence or two, an optional link. The click opens a request;
 * an agent finds and checks the source and files the idea. This click is the approval for that one seed's spend.
 */

export const MAX_BLURB = 600;
export const ONE_BOX_SUBMIT = 'Find source and add, about 12¢ (35¢ limit)';
const PLACEHOLDER: Record<SeedVertical, string> = {
  reels: 'In a sentence or two, what is the story? e.g. what happened and why it matters.',
  carousels: 'In a sentence or two, what is the story? e.g. what happened and why it matters.',
  last_few_days: 'In a sentence or two, what is the story? e.g. what happened and why it matters.',
  stories: 'In a sentence or two, what is the story? e.g. what happened and why it matters.',
  explainers: 'A concept or a sentence on it, e.g. AI hallucinations.',
  field_notes: 'The tool, skill or repo, and what someone gets from it.',
  ai_trivia: 'In a sentence or two, what is the question about?',
  real_or_ai: 'In a sentence or two, what is the photo of?',
  reel_ai_drama: 'In a sentence or two, what is the story of the reel?',
};

export function OneBoxSeedForm({ vertical, done }: SeedFormProps & { vertical: SeedVertical }) {
  const [blurb, setBlurb] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/seed/one-box', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vertical, blurb, ...(showLink && link.trim() ? { link } : {}) }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      done('Looking for a source. It will appear in the queue when it is found.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ex-form rh-seed-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
      <textarea className="ex-textarea" rows={4} placeholder={PLACEHOLDER[vertical]} maxLength={MAX_BLURB + 200} value={blurb} onChange={(e) => setBlurb(e.target.value)} aria-label="Your idea" />
      <p className="rh-muted">{blurb.length} of {MAX_BLURB} characters.</p>
      {showLink ? (
        <input className="helios-field-input" placeholder="Link (a starting point; it is checked against other sources)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link" />
      ) : (
        <button type="button" className="rh-btn" onClick={() => setShowLink(true)}>Add a link</button>
      )}
      <div className="ex-actions">
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !blurb.trim() || blurb.length > MAX_BLURB}>{busy ? 'Working…' : ONE_BOX_SUBMIT}</button>
      </div>
      <p className="rh-muted">A search finds the real article, checks that it matches your idea, and adds it. If it can’t find a solid match it adds nothing and says why.</p>
      {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
    </form>
  );
}
