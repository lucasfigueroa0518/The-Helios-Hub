'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import type { SeedFormProps } from '@/components/content-type/SeedButton';
import { SEED_BUTTON } from '@/lib/content-type/seed-verticals';

const OUTCOMES: Record<string, string> = {
  not_proposed: 'skipped',
  rejected_history_duplicate: 'rejected: duplicates a recent render',
  rejected_gates: 'rejected: failed a gate',
  entered_pool: 'is in the pool',
  won_head_to_head: 'entered the pool, displacing a duplicate',
  lost_head_to_head: 'displaced by a stronger duplicate',
};

/** What a seed would have been refused for, said plainly: the idea is in the pool either way. */
const SEED_FLAGS: Record<string, string> = {
  history_duplicate: 'close to an explainer made recently',
  near_pool_topic: 'close to an idea already in the pool',
  below_gate: 'scored below a quality bar, so the night skips it unless you pin it',
};

/** Explainers: seed an idea (a topic or a question) or paste a list; each is written up and scored (a live model call) when you click. A seed is never refused or trimmed. */
export function ExplainerSeedForm({ done }: SeedFormProps) {
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/explainers/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = (await res.json().catch(() => ({}))) as { results: { title: string; evaluation: { outcome: string; flags?: string[] } }[]; error?: string };
      if (!res.ok) throw new Error(result.error ?? `Request failed (${res.status})`);
      done(result.results.map((r) => `${r.title}: ${OUTCOMES[r.evaluation.outcome] ?? r.evaluation.outcome}${(r.evaluation.flags ?? []).map((f) => ` (${SEED_FLAGS[f] ?? f})`).join('')}`).join(' · '));
      setTitle('');
      setSourceUrl('');
      setSourceText('');
      setList('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ex-form">
      <h2 className="rh-detail__archetype">{SEED_BUTTON.title}</h2>
      <form
        className="ex-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ title, sourceUrl, sourceText });
        }}
      >
        <p className="rh-card__title">What should the explainer explain?</p>
        <input className="helios-field-input" placeholder="A topic or a question, e.g. Why do LLMs hallucinate?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="What should the explainer explain?" />
        <input className="helios-field-input" placeholder="Source URL (optional)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} aria-label="Source URL" />
        <textarea className="ex-textarea" placeholder="Source notes (optional). Claims and visuals must trace to the source." value={sourceText} onChange={(e) => setSourceText(e.target.value)} aria-label="Source notes" rows={3} />
        <div className="ex-actions">
          <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !title.trim()}>
            {busy ? <Loader2 size={14} className="rh-spin" /> : <Plus size={14} />}
            Seed and score
          </button>
        </div>
      </form>
      <form
        className="ex-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ list });
        }}
      >
        <p className="rh-card__title">Or paste a list</p>
        <textarea
          className="ex-textarea"
          placeholder={'One title per line.\nWhat is a webhook?\nWhy does a database need a primary key?'}
          value={list}
          onChange={(e) => setList(e.target.value)}
          aria-label="Topic list"
          rows={6}
        />
        <div className="ex-actions">
          <button type="submit" className="rh-btn" disabled={busy || !list.trim()}>
            {busy ? <Loader2 size={14} className="rh-spin" /> : <Plus size={14} />}
            Seed and score
          </button>
        </div>
        <p className="rh-muted">One Sonnet call writes the scopes, then Jev scores each topic.</p>
      </form>
      {error && <p className="rh-note rh-note--bad">{error}</p>}
    </div>
  );
}
