'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON } from '@/lib/content-type/seed-verticals';

/**
 * Carousels: paste a story's link (design 2026-10-25-carousels-seeding). The page is read with a plain web request and the
 * story is scored once (one Jev call, a fraction of a cent); this click is the approval for it. Nothing is made: pin it or
 * Run now to make it. A seed waits a week.
 */
export function CarouselSeedForm({ done }: SeedFormProps) {
  const [url, setUrl] = useState('');
  const [headline, setHeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/carousels/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, headline }) });
      const out = (await res.json().catch(() => ({}))) as { title: string; score: number; status: string; error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      done(`“${out.title}” is in the queue, scored ${out.score.toFixed(1)} of 5.5${out.status === 'qualified' ? '' : ' (below the bar the night uses, so it only runs if you pin it)'}. Nothing was made.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ex-form rh-seed-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
      <input className="helios-field-input" placeholder="Link to the story" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link to the story" />
      <input className="helios-field-input" placeholder="Headline (optional)" value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" />
      <div className="ex-actions">
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !url.trim()}>{busy ? 'Reading and scoring…' : 'Add and score'}</button>
      </div>
      <p className="rh-muted">Reads the page and scores the story once, a fraction of a cent. Nothing is made; pin it or Run now to make it. It waits a week.</p>
      {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
    </form>
  );
}
