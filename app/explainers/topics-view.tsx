'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';

import { Drawer } from '@/app/reels/ui';
import { requestJson } from '@/lib/client-request';
import type { TopicsView as TopicsData } from '@/lib/explainers/overview';
import { SCORE_KEYS, type ScoreKey, type TopicRow, type TopicStatus } from '@/lib/explainers/types';

const SCORE_LABELS: Record<ScoreKey, string> = {
  audience_fit: 'Aud',
  teachability_45s: 'Tch',
  analogy_potential: 'Ana',
  visual_potential: 'Vis',
  accuracy_under_simplification: 'Acc',
  hook_strength: 'Hook',
};

const SCORE_NAMES = SCORE_KEYS.map((key) => `${SCORE_LABELS[key]} = ${key.replaceAll('_', ' ')}`).join(', ');

const OUTCOMES: Record<string, string> = {
  not_proposed: 'skipped',
  rejected_history_duplicate: 'rejected: duplicates a recent render',
  rejected_gates: 'rejected: failed a gate',
  entered_pool: 'entered the pool',
  won_head_to_head: 'entered the pool, displacing a duplicate',
  lost_head_to_head: 'displaced by a stronger duplicate',
};

function score(value: number | null) {
  return value == null ? '—' : value.toFixed(1);
}

function scoreLine(topic: TopicRow): string {
  return SCORE_KEYS.map((key) => {
    const value = topic[key];
    return `${SCORE_LABELS[key]} ${value == null ? '·' : value.toFixed(1)}`;
  }).join(' · ');
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function statusChip(status: TopicStatus): string {
  if (status === 'rejected' || status === 'displaced') return 'rh-chip rh-chip--failed';
  if (status === 'rendered' || status === 'queued' || status === 'promoted') return 'rh-chip rh-chip--ready';
  return 'rh-chip';
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
    <div className="ex-form">
      <h2 className="rh-detail__archetype">Add a topic</h2>
      <form
        className="ex-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ title, sourceUrl, sourceText });
        }}
      >
        <p className="rh-card__title">One topic</p>
        <input className="helios-field-input" placeholder="Title, e.g. What is a webhook?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <input className="helios-field-input" placeholder="Source URL (optional)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} aria-label="Source URL" />
        <textarea className="ex-textarea" placeholder="Source notes (optional). Claims and visuals must trace to the source." value={sourceText} onChange={(e) => setSourceText(e.target.value)} aria-label="Source notes" rows={3} />
        <div className="ex-actions">
          <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !title.trim()}>
            {busy ? <Loader2 size={14} className="rh-spin" /> : <Plus size={14} />}
            Add and score
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
        <p className="rh-card__title">Paste a list</p>
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

function TopicRowView({
  topic,
  rank,
  busy,
  disabled,
  onGenerate,
  onReject,
  retry,
}: {
  topic: TopicRow;
  rank: number | null;
  busy: boolean;
  disabled: boolean;
  onGenerate?: () => void;
  onReject?: () => void;
  retry?: boolean;
}) {
  const detail = [topic.scope, rank == null ? topic.reject_reason : null].filter(Boolean).join(' · ');
  return (
    <li>
      <div className="rh-row">
        <span className="rh-row__rank">{rank ?? '—'}</span>
        <span className="rh-row__main">
          <span className="rh-row__headline">{topic.title}</span>
          <span className="rh-row__labels" title={rank != null ? SCORE_NAMES : undefined}>
            {rank != null ? scoreLine(topic) : detail || topic.status}
          </span>
          {rank != null && topic.scope && <span className="rh-row__labels">{topic.scope}</span>}
        </span>
        <span className="rh-row__pills">
          <span className={rank != null ? 'rh-chip' : statusChip(topic.status)}>{rank != null ? topic.origin : topic.status}</span>
        </span>
        <span className="rh-row__score">{score(topic.weighted_score)}</span>
        <span className="ex-row-actions">
          {onGenerate && (
            <button type="button" className="rh-btn rh-btn--primary rh-btn--xs" disabled={disabled} onClick={onGenerate} title={retry ? 'Retry after a failed render' : undefined}>
              {busy ? <Loader2 size={12} className="rh-spin" /> : <Sparkles size={12} />}
              {retry ? 'Retry' : 'Generate'}
            </button>
          )}
          {onReject && (
            <button type="button" className="rh-btn rh-btn--quiet rh-btn--xs" disabled={disabled} onClick={onReject} aria-label={`Reject ${topic.title}`}>
              <X size={12} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

export function TopicsView({ view }: { view: TopicsData }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (!adding) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setAdding(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding]);

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
      setNote(action === 'generate' ? `Render queued for "${topic.title}".` : `Rejected "${topic.title}".`);
      router.refresh();
    } catch (error) {
      setNote(message(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="rh__head">
        <div>
          <p className="rh__kicker">Explainers</p>
          <h1 className="rh__title">
            Topics <span className="rh-beta">Beta</span>
          </h1>
        </div>
        <div className="rh__head-actions">
          <button type="button" className="rh-btn rh-btn--primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add topic
          </button>
        </div>
      </header>

      {!view.settings.auto_render && (
        <p className="rh-muted rh-posting-note">
          Auto-render is off. Seed topics by hand and click Generate on a pool topic.
        </p>
      )}

      <section className="rh-rest ex-bench">
        <h2 className="rh-rest__title">
          Candidate pool <span>{view.pool.length} of {view.settings.pool_size}</span>
        </h2>
        <p className="rh-muted">Ranked by weighted score, then the tie-breaks.</p>
        {view.pool.length === 0 ? (
          <p className="rh-empty">The pool is empty. Add a topic to score it.</p>
        ) : (
          <ul className="rh-rest__list">
            {view.pool.map((topic, index) => (
              <TopicRowView
                key={topic.id}
                topic={topic}
                rank={index + 1}
                busy={busyId === topic.id}
                disabled={busyId !== null}
                onGenerate={() => void act(topic, 'generate')}
                onReject={() => void act(topic, 'reject')}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rh-rest ex-bench">
        <h2 className="rh-rest__title">
          Other topics <span>{view.others.length}</span>
        </h2>
        <p className="rh-muted">Newest first. Rejected, displaced, rendered, and anything waiting outside the pool.</p>
        {view.others.length === 0 ? (
          <p className="rh-empty">Nothing outside the pool yet.</p>
        ) : (
          <ul className="rh-rest__list">
            {view.others.map((topic) => (
              <TopicRowView
                key={topic.id}
                topic={topic}
                rank={null}
                busy={busyId === topic.id}
                disabled={busyId !== null}
                onGenerate={topic.status === 'queued' ? () => void act(topic, 'generate') : undefined}
                onReject={topic.status === 'proposed' || topic.status === 'promoted' ? () => void act(topic, 'reject') : undefined}
                retry={topic.status === 'queued'}
              />
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <Drawer label="Add a topic" onClose={() => setAdding(false)}>
          <AddTopics
            onDone={(text) => {
              setAdding(false);
              setNote(text);
              router.refresh();
            }}
          />
        </Drawer>
      )}

      {note && (
        <p className="rh-toast" role="status">
          {note}
        </p>
      )}
    </>
  );
}
