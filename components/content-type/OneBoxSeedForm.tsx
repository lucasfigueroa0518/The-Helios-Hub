'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON, type SeedVertical } from '@/lib/content-type/seed-verticals';
import { LIMIT_USD } from '@/lib/seed/one-box/budget';
import { RUNNER } from '@/lib/seed/one-box/types';

/**
 * One-box seeding (design 2026-11-04-one-box-seeding-design): a sentence or two, an optional link. The click opens a request;
 * an agent finds and checks the source and files the idea. This click is the approval for that one seed's spend.
 * Every type uses this form; only the placeholder, the after-line and the price differ.
 */

export const MAX_BLURB = 600;

/** What the button says a seed costs, in cents. Field Notes with a link is added free; the page is read at Generate. */
export const ESTIMATE_CENTS = {
  reels: 12, carousels: 12, last_few_days: 12, stories: 12, explainers: 15, field_notes: 12, fieldNotesWithLink: 1, ai_trivia: 8, real_or_ai: 30, reel_ai_drama: 25,
} as const;

export function submitLabel(v: SeedVertical, hasLink: boolean): string {
  const about = v === 'field_notes' && hasLink ? ESTIMATE_CENTS.fieldNotesWithLink : ESTIMATE_CENTS[v];
  return `Add · about ${about}¢ (${Math.round(LIMIT_USD[v] * 100)}¢ limit)`;
}

/** The toast after a submit: Vercel looks for the source at once; the worker types wait in its queue. */
export function submittedText(v: SeedVertical): string {
  return RUNNER[v] === 'vercel'
    ? 'Looking for a source. It will appear in the queue when it is found.'
    : "Queued for the worker. It will appear in the queue when it's made.";
}

const STORY_PLACEHOLDER = 'In a sentence or two, what is the story?';
const STORY_AFTER = "Claude finds the real article, checks it matches, and adds it. If it can't, nothing is added.";

export const PLACEHOLDER: Record<SeedVertical, string> = {
  reels: STORY_PLACEHOLDER,
  carousels: STORY_PLACEHOLDER,
  last_few_days: STORY_PLACEHOLDER,
  stories: STORY_PLACEHOLDER,
  explainers: 'A concept, or a sentence about it.',
  field_notes: 'The tool, skill or repo, and what someone gets from it.',
  ai_trivia: 'A topic for a question.',
  real_or_ai: 'A subject to photograph.',
  reel_ai_drama: 'The story, in a sentence or two.',
};

export const AFTER_LINE: Record<SeedVertical, string> = {
  reels: STORY_AFTER,
  carousels: STORY_AFTER,
  last_few_days: STORY_AFTER,
  stories: STORY_AFTER,
  explainers: 'Claude names the concept and finds pages that explain it, then it is scoped and scored.',
  field_notes: 'With a link: added free; the page is read when you press Generate. Without: Claude finds its official page first.',
  ai_trivia: "Claude writes up to two questions on it; they're checked and scored like the daily ones.",
  real_or_ai: 'Claude finds a real photo of it and makes an AI twin; both are screened like the daily ones.',
  reel_ai_drama: 'Claude writes a pitch from it, then the drama, material and visuals checks run.',
};

export function OneBoxSeedForm({ vertical, done }: SeedFormProps & { vertical: SeedVertical }) {
  const [blurb, setBlurb] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLink = showLink && link.trim().length > 0;
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/seed/one-box', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vertical, blurb, ...(hasLink ? { link } : {}) }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      done(submittedText(vertical));
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
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !blurb.trim() || blurb.length > MAX_BLURB}>{busy ? 'Working…' : submitLabel(vertical, hasLink)}</button>
      </div>
      <p className="rh-muted">{AFTER_LINE[vertical]}</p>
      {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
    </form>
  );
}
