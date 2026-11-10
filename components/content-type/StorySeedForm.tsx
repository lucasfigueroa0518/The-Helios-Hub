'use client';

import { useState } from 'react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON } from '@/lib/content-type/seed-verticals';
import { SERIES_LABEL } from '@/lib/content-type/story-series';

type SeedFields = Record<string, string>;

/** The series that take a typed-in idea. */
const SEEDABLE = ['morning_download', 'free_vs_paid'] as const;

/**
 * Stories: type an idea into a series' pool (idea seeding spec, 2026-10-21). A story for Morning Download, a tool for
 * Free vs. Paid (AI Trivia writes its own questions and takes no seeds). It costs nothing (no model or web call) and starts no build; it sits in the
 * pool as "Yours" and competes like any idea.
 */
export function StorySeedForm({ done }: SeedFormProps) {
  const [series, setSeries] = useState('morning_download');
  const [f, setF] = useState<SeedFields>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The fields a series needs before it can be added (the same ones the route refuses without). */
  const valid = series === 'morning_download' ? Boolean(f.headline?.trim()) : Boolean(f.toolName?.trim() && f.url?.trim());
  const set = (key: string) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [key]: e.target.value }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/stories/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ series, ...f }) });
      const out = (await res.json().catch(() => ({}))) as { title: string; error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      done(`“${out.title}” is in the ${SERIES_LABEL[series]} pool. Nothing was made; it competes like any idea, and you can pin it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
  <form className="ex-form rh-seed-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
    <select className="helios-field-input" value={series} onChange={(e) => { setSeries(e.target.value); setF({}); }} aria-label="Series">
      {SEEDABLE.map((id) => <option key={id} value={id}>{SERIES_LABEL[id]}</option>)}
    </select>
    {series === 'morning_download' ? (
      <>
        <input className="helios-field-input" placeholder="The story’s headline" value={f.headline ?? ''} onChange={set('headline')} aria-label="Headline" />
        <input className="helios-field-input" placeholder="Link (optional)" value={f.url ?? ''} onChange={set('url')} aria-label="Link" />
        <textarea className="ex-textarea" placeholder="What it says, in your words (optional)" value={f.notes ?? ''} onChange={set('notes')} aria-label="Notes" rows={4} />
      </>
    ) : null}
    {series === 'free_vs_paid' ? (
      <>
        <input className="helios-field-input" placeholder="The tool, e.g. GIMP" value={f.toolName ?? ''} onChange={set('toolName')} aria-label="Tool" />
        <input className="helios-field-input" placeholder="Link to the tool" value={f.url ?? ''} onChange={set('url')} aria-label="Link" />
        <input className="helios-field-input" placeholder="What it is (optional)" value={f.description ?? ''} onChange={set('description')} aria-label="What it is" />
      </>
    ) : null}
    <div className="ex-actions">
      <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !valid}>{busy ? 'Adding…' : 'Add to the pool'}</button>
    </div>
    <p className="rh-muted">Free: no model or web call, and nothing is built. Free vs. Paid still pairs your tool with its counterpart when the set is built.</p>
    {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
  </form>
  );
}
