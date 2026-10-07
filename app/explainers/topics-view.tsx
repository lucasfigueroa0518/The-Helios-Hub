'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play, Plus, X } from 'lucide-react';

import { requestJson } from '@/lib/client-request';
import type { TopicsView as TopicsData } from '@/lib/explainers/overview';
import { SCORE_KEYS, type ScoreKey, type TopicRow } from '@/lib/explainers/types';

const SCORE_LABELS: Record<ScoreKey, string> = {
  audience_fit: 'Aud',
  teachability_45s: 'Tch',
  analogy_potential: 'Ana',
  visual_potential: 'Vis',
  accuracy_under_simplification: 'Acc',
  hook_strength: 'Hook',
};

const OUTCOMES: Record<string, string> = {
  not_proposed: 'skipped',
  rejected_history_duplicate: 'rejected: duplicates a recent render',
  rejected_gates: 'rejected: failed a gate',
  entered_pool: 'entered the pool',
  won_head_to_head: 'entered the pool, displacing a duplicate',
  lost_head_to_head: 'displaced by a stronger duplicate',
};

function Scores({ topic }: { topic: TopicRow }) {
  return (
    <div className="ex-scores">
      {SCORE_KEYS.map((key) => {
        const value = topic[key];
        return (
          <span
            key={key}
            className={`ex-score${value != null && value >= 3.5 ? ' ex-score--top' : ''}`}
            title={`${key.replaceAll('_', ' ')}: ${value ?? 'not scored'}`}
          >
            {value == null ? '·' : value.toFixed(1)}
          </span>
        );
      })}
    </div>
  );
}

function score(value: number | null) {
  return value == null ? '—' : value.toFixed(1);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function AddTopics({ onDone }: { onDone: (note: string) => void }) {
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
      const result = await requestJson<{ results: { title: string; evaluation: { outcome: string } }[] }>(
        '/api/explainers/topics',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      );
      onDone(result.results.map((r) => `${r.title}: ${OUTCOMES[r.evaluation.outcome] ?? r.evaluation.outcome}`).join(' · '));
      setTitle('');
      setSourceUrl('');
      setSourceText('');
      setList('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ex-block ex-add">
      <form
        className="ex-add__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ title, sourceUrl, sourceText });
        }}
      >
        <h2 className="ex-block__title">Add a topic</h2>
        <input className="ex-input ex-input--wide" placeholder="Title, e.g. What is a webhook?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <input className="ex-input ex-input--wide" placeholder="Source URL (optional)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} aria-label="Source URL" />
        <textarea className="ex-textarea" placeholder="Source notes (optional). Claims and visuals must trace to the source." value={sourceText} onChange={(e) => setSourceText(e.target.value)} aria-label="Source notes" rows={3} />
        <div className="ex-actions">
          <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !title.trim()}>
            {busy ? <Loader2 size={14} className="rh-spin" /> : <Plus size={14} />}
            Add and score
          </button>
        </div>
      </form>
      <form
        className="ex-add__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ list });
        }}
      >
        <h2 className="ex-block__title">Paste a list</h2>
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
          <span className="ex-note">One Sonnet call writes the scopes, then Jev scores each topic.</span>
        </div>
      </form>
      {error && <p className="ex-note ex-note--bad">{error}</p>}
    </section>
  );
}

export function TopicsView({ view }: { view: TopicsData }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function act(topic: TopicRow, action: 'generate' | 'reject') {
    if (action === 'reject' && !window.confirm(`Reject "${topic.title}"?`)) return;
    setBusyId(topic.id);
    setNote(null);
    try {
      await requestJson(`/api/explainers/topics/${topic.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      setNote({ text: action === 'generate' ? `Render queued for "${topic.title}".` : `Rejected "${topic.title}".` });
      router.refresh();
    } catch (error) {
      setNote({ text: message(error), bad: true });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {!view.settings.auto_render && (
        <div className="ex-banner">
          <span>
            <strong>Auto-render is off.</strong> No daily idea run and no promotion (A-7). Seed
            topics by hand and click Generate on a pool topic.
          </span>
        </div>
      )}

      <AddTopics
        onDone={(text) => {
          setNote({ text });
          router.refresh();
        }}
      />
      {note && <p className={`ex-note ex-flash${note.bad ? ' ex-note--bad' : ''}`} role="status">{note.text}</p>}

      <section className="ex-block">
        <div className="ex-block__head">
          <h2 className="ex-block__title">Candidate pool</h2>
          <span className="ex-block__meta">
            {view.pool.length} of {view.settings.pool_size} · ranked by weighted score, then E-15 tie-breaks
          </span>
        </div>
        {view.pool.length === 0 ? (
          <p className="rh-empty">The pool is empty. Add a topic to score it.</p>
        ) : (
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th className="ex-num">#</th>
                  <th>Topic</th>
                  <th title={SCORE_KEYS.map((k) => `${SCORE_LABELS[k]} = ${k}`).join(', ')}>
                    {SCORE_KEYS.map((k) => SCORE_LABELS[k]).join(' · ')}
                  </th>
                  <th className="ex-num">Score</th>
                  <th>Origin</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {view.pool.map((topic, index) => (
                  <tr key={topic.id}>
                    <td className="ex-num">{index + 1}</td>
                    <td>
                      <div className="ex-title">{topic.title}</div>
                      {topic.scope && <div className="ex-scope">{topic.scope}</div>}
                    </td>
                    <td><Scores topic={topic} /></td>
                    <td className="ex-num">{score(topic.weighted_score)}</td>
                    <td>{topic.origin}</td>
                    <td>
                      <div className="ex-row-actions">
                      <button type="button" className="rh-btn rh-btn--primary rh-btn--xs" disabled={busyId !== null} onClick={() => void act(topic, 'generate')}>
                        {busyId === topic.id ? <Loader2 size={12} className="rh-spin" /> : <Play size={12} />}
                        Generate
                      </button>
                      <button type="button" className="rh-btn rh-btn--quiet rh-btn--xs" disabled={busyId !== null} onClick={() => void act(topic, 'reject')} aria-label={`Reject ${topic.title}`}>
                        <X size={12} />
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ex-block">
        <div className="ex-block__head">
          <h2 className="ex-block__title">Other topics</h2>
          <span className="ex-block__meta">{view.others.length} · newest first</span>
        </div>
        {view.others.length === 0 ? (
          <p className="rh-empty">Nothing outside the pool yet.</p>
        ) : (
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Status</th>
                  <th className="ex-num">Score</th>
                  <th>Reason</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {view.others.map((topic) => (
                  <tr key={topic.id}>
                    <td>
                      <div className="ex-title">{topic.title}</div>
                      {topic.scope && <div className="ex-scope">{topic.scope}</div>}
                    </td>
                    <td><span className={`ex-status ex-status--${topic.status}`}>{topic.status}</span></td>
                    <td className="ex-num">{score(topic.weighted_score)}</td>
                    <td>{topic.reject_reason ?? ''}</td>
                    <td>
                      <div className="ex-row-actions">
                      {topic.status === 'queued' && (
                        <button type="button" className="rh-btn rh-btn--xs" disabled={busyId !== null} onClick={() => void act(topic, 'generate')} title="Retry after a failed render">
                          <Play size={12} /> Retry
                        </button>
                      )}
                      {(topic.status === 'proposed' || topic.status === 'promoted') && (
                        <button type="button" className="rh-btn rh-btn--quiet rh-btn--xs" disabled={busyId !== null} onClick={() => void act(topic, 'reject')} aria-label={`Reject ${topic.title}`}>
                          <X size={12} />
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
