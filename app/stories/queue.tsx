'use client';

import { useState } from 'react';

import { FrameStrip, SERIES_LABEL, STATUS_LABEL, api, usd, useLoad, when, type SetRow } from '@/app/stories/shared';

type Detail = { candidates: Array<{ origin: string; ref: string; payload: Record<string, unknown>; score: number | null; chosen: boolean; reason: string | null }>; costs: Array<{ component: string; usd: number; calls: number }> };
const TAGS = ['story_choice', 'copy', 'photo', 'design', 'accuracy'] as const;

/** Queue (plan §8): today's and upcoming sets, Generate per series, and the review actions. */
export function StoriesQueue() {
  const { data, error, reload } = useLoad<{ sets: SetRow[]; spend: { month: string; total: number } }>('/api/stories/sets?view=queue');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      setNotice(done);
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="sh-main">
      <header className="sh-head">
        <div>
          <h1>Stories</h1>
          <p className="sh-muted">Generate makes live model and web calls for that one set; the worker on Lucas&apos;s Mac builds and posts it.{data ? ` This month: ${usd(data.spend.total)}.` : ''}</p>
        </div>
        <div className="sh-generate">
          {Object.entries(SERIES_LABEL).map(([id, label]) => (
            <button key={id} type="button" className="sh-btn" disabled={busy !== null} onClick={() => act(`gen-${id}`, () => api('/api/stories/generate', { series: id }), `${label}: requested. The worker picks it up within a minute.`)}>
              Generate {label}
            </button>
          ))}
        </div>
      </header>
      {notice && <p className="sh-notice" role="status">{notice}</p>}
      {error && <p className="sh-error" role="alert">{error}</p>}
      {!data && !error && <p className="sh-muted">Loading…</p>}
      {data && !data.sets.length && <p className="sh-muted">Nothing in the queue. Generate a set to start.</p>}
      {data?.sets.map((s) => <SetCard key={s.id} set={s} busy={busy} act={act} />)}
    </main>
  );
}

function SetCard({ set, busy, act }: { set: SetRow; busy: string | null; act: (k: string, fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const toggle = async () => {
    setOpen(!open);
    if (!detail) setDetail(await api<Detail>(`/api/stories/sets/${set.id}`).catch(() => null));
  };
  const post = (action: string, body?: unknown) => api(`/api/stories/sets/${set.id}/${action}`, body ?? {});
  const canReview = set.status === 'ready';
  return (
    <section className={`sh-card sh-card--${set.status}`}>
      <div className="sh-card__head">
        <h2>
          {SERIES_LABEL[set.series]} <span className="sh-muted">· {set.ny_date}</span>
        </h2>
        <span className={`sh-status sh-status--${set.status}`}>{STATUS_LABEL[set.status] ?? set.status}</span>
        {set.flagged && <span className="sh-status sh-status--flagged">Flagged by the review</span>}
        <span className="sh-muted">
          {set.style} · {set.trigger === 'auto' ? 'auto' : 'generated'} · {usd(set.spend_usd)}
          {set.publish_at ? ` · posts ${when(set.publish_at)}` : ''}
        </span>
      </div>
      {set.error && <p className="sh-error">{set.error}</p>}
      {set.frames.length > 0 && <FrameStrip set={set} />}
      <div className="sh-actions">
        {canReview && (
          <button type="button" className="sh-btn sh-btn--primary" disabled={busy !== null} onClick={() => act(`a-${set.id}`, () => post('approve'), 'Approved. The worker schedules it in its window.')}>
            Approve
          </button>
        )}
        {['ready', 'approved', 'scheduled'].includes(set.status) && (
          <>
            <button type="button" className="sh-btn" disabled={busy !== null} onClick={() => confirm('Publish this set now?') && act(`p-${set.id}`, () => post('publish-now'), 'Publishing within a minute.')}>
              Publish now
            </button>
            <button type="button" className="sh-btn" disabled={busy !== null} onClick={() => setRejecting(!rejecting)}>
              Reject
            </button>
          </>
        )}
        {['ready', 'approved', 'scheduled', 'failed', 'skipped'].includes(set.status) && (
          <button type="button" className="sh-btn" disabled={busy !== null || set.status === 'failed' || set.status === 'skipped'} onClick={() => act(`r-${set.id}`, () => post('regenerate'), 'A new set is requested for the same day.')}>
            Regenerate
          </button>
        )}
        {['failed', 'skipped'].includes(set.status) && (
          <button type="button" className="sh-btn" disabled={busy !== null} onClick={() => act(`g-${set.id}`, () => api('/api/stories/generate', { series: set.series }), 'Requested again.')}>
            Try again
          </button>
        )}
        <button type="button" className="sh-link" onClick={toggle}>
          {open ? 'Hide details' : 'Candidates and cost'}
        </button>
      </div>
      {rejecting && (
        <div className="sh-reject">
          <div className="sh-tags">
            {TAGS.map((t) => (
              <label key={t}>
                <input type="checkbox" checked={tags.includes(t)} onChange={(e) => setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} /> {t.replace('_', ' ')}
              </label>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was wrong?" rows={2} />
          <button type="button" className="sh-btn sh-btn--danger" disabled={busy !== null} onClick={() => act(`x-${set.id}`, () => post('reject', { tags, note }), 'Rejected. The note is kept as feedback.')}>
            Reject set
          </button>
        </div>
      )}
      {open && detail && (
        <div className="sh-detail">
          <h3>Candidates</h3>
          <table>
            <tbody>
              {detail.candidates.map((c, i) => (
                <tr key={i} className={c.chosen ? 'sh-chosen' : ''}>
                  <td>{c.score == null ? '' : c.score.toFixed(2)}</td>
                  <td>{c.origin}</td>
                  <td>{String(c.payload.headline ?? c.payload.value ?? c.payload.paid_tool ?? c.ref)}</td>
                  <td className="sh-muted">{c.chosen ? 'chosen' : c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Cost</h3>
          <ul>
            {detail.costs.map((c) => (
              <li key={c.component}>
                {c.component}: {usd(c.usd)} ({c.calls} call{c.calls === 1 ? '' : 's'})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
