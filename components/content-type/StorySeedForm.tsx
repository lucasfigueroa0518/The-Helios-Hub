'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON } from '@/lib/content-type/seed-verticals';
import { SERIES_OF_VERTICAL, STORY_TYPE_LABEL } from '@/lib/social-hub/story-types';

type SeedFields = Record<string, string>;

/**
 * Morning Download: type a story into its pool (idea seeding spec, 2026-10-21). Seeding is Morning Download's only
 * (SS-26): AI Trivia writes its own questions and Real or AI? makes its own images, so neither takes seeds. It costs
 * nothing (no model or web call) and starts no build; it sits in the pool as "Yours" and competes like any idea.
 */
export function StorySeedForm({ done }: SeedFormProps) {
  const [f, setF] = useState<SeedFields>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The fields needed before it can be added (the same ones the route refuses without). */
  const valid = Boolean(f.headline?.trim());
  const set = (key: string) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [key]: e.target.value }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/stories/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ series: SERIES_OF_VERTICAL.stories, ...f }) });
      const out = (await res.json().catch(() => ({}))) as { title: string; error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      done(`“${out.title}” is in the ${STORY_TYPE_LABEL.stories} pool. Nothing was made; it competes like any idea, and you can pin it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
  <form className="ex-form rh-seed-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
    <input className="helios-field-input" placeholder="The story’s headline" value={f.headline ?? ''} onChange={set('headline')} aria-label="Headline" />
    <input className="helios-field-input" placeholder="Link (optional)" value={f.url ?? ''} onChange={set('url')} aria-label="Link" />
    <textarea className="ex-textarea" placeholder="What it says, in your words (optional)" value={f.notes ?? ''} onChange={set('notes')} aria-label="Notes" rows={4} />
    <div className="ex-actions">
      <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !valid}>{busy ? 'Adding…' : 'Add to the pool'}</button>
    </div>
    <p className="rh-muted">Free: no model or web call, and nothing is built.</p>
    {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
  </form>
  );
}
