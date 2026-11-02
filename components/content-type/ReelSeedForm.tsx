'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON } from '@/lib/content-type/seed-verticals';
import { seedOutcomeView, type SeedOutcomeView } from '@/lib/reels/seed-outcome';
import type { ReelSeedOutcome } from '@/lib/reels/seeds';

/**
 * Text on Screen: type an idea into the queue (design 2026-10-29-text-on-screen-seeding). A headline, optionally your own
 * text and a link. The idea is scored, joins the queue by its score and waits a week; nothing is made. A headline with no
 * link (or an unreadable one) searches for the story; a story already in the queue stops and shows you that idea; a paid web
 * search is only run after you confirm its cost.
 */

const MAX_TEXT = 10_000;


export function ReelSeedForm({ done }: SeedFormProps) {
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A stop that needs a decision: the idea already in the queue, or the cost of a web search. */
  const [decision, setDecision] = useState<Extract<SeedOutcomeView, { kind: 'duplicate' | 'confirm' }> | null>(null);
  async function submit(extra: { seedAnyway?: boolean; confirmPaid?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDecision(null);
    try {
      const res = await fetch('/api/reels/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headline, text, url, ...extra }) });
      const out = (await res.json().catch(() => ({}))) as ReelSeedOutcome & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      const view = seedOutcomeView(out);
      if (view.kind === 'toast') {
        done(view.text);
      } else if (view.kind === 'none') {
        setError(view.text);
      } else {
        setDecision(view);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ex-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
      <input className="helios-field-input" placeholder="Headline" maxLength={200} value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" />
      <textarea className="helios-field-input" placeholder="Your text (optional): the story, in your words" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your text" />
      <p className="rh-muted">{text.length.toLocaleString('en-US')} of {MAX_TEXT.toLocaleString('en-US')} characters. A one-line idea gives thin copy; a few lines give the writer facts.</p>
      <input className="helios-field-input" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" />
      <div className="ex-actions">
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !headline.trim() || text.length > MAX_TEXT}>{busy ? 'Working…' : 'Add and score'}</button>
      </div>
      <p className="rh-muted">With a link or text, scoring costs well under a cent. With only a headline it searches for the story first. Nothing is made.</p>
      {decision?.kind === 'duplicate' ? (
        <div className="rh-note" role="alert">
          <p>That story is already in the queue: “{decision.existing.headline}”{decision.existing.yours ? ' (yours)' : ''}, {decision.existing.scoreText}.</p>
          <div className="ex-actions">
            <button type="button" className="rh-btn" onClick={() => done()}>Use existing</button>
            <button type="button" className="rh-btn" disabled={busy} onClick={() => void submit({ seedAnyway: true })}>Seed anyway</button>
          </div>
        </div>
      ) : null}
      {decision?.kind === 'confirm' ? (
        <div className="rh-note" role="alert">
          <p>{decision.text}</p>
          <div className="ex-actions">
            <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={() => void submit({ confirmPaid: true })}>Search the web (about {decision.estimateCents}¢)</button>
            <button type="button" className="rh-btn" onClick={() => setDecision(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
    </form>
  );
}
