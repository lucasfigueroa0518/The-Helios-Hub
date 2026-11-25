'use client';

import { useState } from 'react';

import type { CommentResult, Decision } from '@/lib/personality/lab';
import { SILENT_ROUTES } from '@/lib/personality/prompts';
import { LAB_SAMPLE_COMMENTS } from '@/lib/personality/sample-comments';
import { LAB_POST_TYPES, postsOfType, postTitle, type LabPost, type LabPostType } from '@/lib/personality/posts';

const ROUTE_LABEL: Record<Decision['route'], string> = {
  no_point: 'No point, ignored',
  negative: 'Negative, ignored',
  controversial: 'Controversial, ignored',
  opinion: 'Opinion',
  question: 'Question',
  helios_question: 'About Helios, invite to DM',
  correction: 'Correction, looked up',
  nice: 'Nice to us',
  agree: 'Simple agreement',
  joke: 'Joke',
};

const VERDICT_LABEL: Record<string, string> = {
  they_are_right: 'Sources show they are right, and the post was wrong',
  post_is_right: 'Sources show the post is right',
  unverified: 'The sources did not settle it',
};

/** Values for the force dropdown. Question splits in two so a long answer can be tried on purpose. */
const FORCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto (router decides)' },
  { value: 'opinion', label: 'Opinion' },
  { value: 'question:short', label: 'Question, short' },
  { value: 'question:long', label: 'Question, long' },
  { value: 'correction', label: 'Correction, looked up' },
  { value: 'helios_question', label: 'About Helios, invite to DM' },
  { value: 'nice', label: 'Nice to us' },
  { value: 'agree', label: 'Simple agreement' },
  { value: 'joke', label: 'Joke' },
  { value: 'no_point', label: 'No point, ignored' },
  { value: 'negative', label: 'Negative, ignored' },
  { value: 'controversial', label: 'Controversial, ignored' },
];

const pickOther = <T,>(list: readonly T[], current: T | null): T => {
  const pool = list.filter((x) => x !== current);
  const from = pool.length ? pool : list;
  return from[Math.floor(Math.random() * from.length)]!;
};

type Exchange = { id: number; comment: string; post: LabPost; result: CommentResult };

function Reply({ x, busy, onRetry }: { x: Exchange; busy: boolean; onRetry: () => void }) {
  const { decision, fields, flags, error, searches, sources, rewrites } = x.result;
  const silent = SILENT_ROUTES.includes(decision.route);
  return (
    <article className="pl-card pl-exchange">
      <p className="pl-comment">“{x.comment}”</p>
      <p className="pl-note pl-small">on {postTitle(x.post)}</p>
      <p className="pl-route">
        <span className={`pl-chip${silent ? ' pl-chip-silent' : ''}`}>{ROUTE_LABEL[decision.route]}</span>
        {silent ? null : <span className="pl-chip pl-chip-plain">{decision.energy} energy</span>}
        {decision.depth === 'long' && !silent ? <span className="pl-chip pl-chip-plain">long</span> : null}
        <span className="pl-note">{decision.reason}</span>
      </p>
      {error ? <p className="pl-error">{error}</p> : null}
      {silent ? <p className="pl-note">No reply.</p> : null}
      {fields?.verdict ? <p className="pl-label">{VERDICT_LABEL[fields.verdict] ?? fields.verdict}</p> : null}
      {fields?.reply ? <p className="pl-bubble">{fields.reply}</p> : null}
      {fields && !fields.reply ? <p className="pl-note">No reply.</p> : null}
      {fields?.reply ? <p className="pl-note pl-small">{fields.reply.length} characters{rewrites ? `, cut ${rewrites === 1 ? 'once' : 'twice'} to fit` : ''}</p> : null}
      {flags.map((flag) => <p className="pl-flag" key={flag}>{flag}</p>)}
      {searches?.length ? (
        <details className="pl-sources">
          <summary>Searched the web {searches.length === 1 ? 'once' : `${searches.length} times`}</summary>
          <ul>{searches.map((q) => <li key={q}>{q}</li>)}</ul>
          <ul>{sources?.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul>
        </details>
      ) : null}
      {silent || decision.route === 'joke' ? null : <button className="pl-retry" disabled={busy} onClick={onRetry}>Try another reply</button>}
    </article>
  );
}

export function CommentLab({ soul }: { soul: string }) {
  const [type, setType] = useState<LabPostType>(LAB_POST_TYPES[0]);
  const [post, setPost] = useState<LabPost>(postsOfType(LAB_POST_TYPES[0])[0]!);
  const [comment, setComment] = useState('');
  const [force, setForce] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastUsd, setLastUsd] = useState<number | null>(null);
  const [totalUsd, setTotalUsd] = useState(0);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  const send = async (text: string, target: LabPost, forced: { route: string; energy?: string; depth?: string } | null, retry = false) => {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError('');
    try {
      // Only a retry sees earlier replies, and only those to this same comment, so it reads differently.
      const avoid = retry
        ? exchanges.filter((x) => x.comment === clean).flatMap((x) => (x.result.fields?.reply ? [x.result.fields.reply] : []))
        : [];
      const res = await fetch('/api/personality/lab', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId: target.id, comment: clean, forceRoute: forced?.route, forceEnergy: forced?.energy, forceDepth: forced?.depth, avoid }),
      });
      const data = (await res.json()) as CommentResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
      setLastUsd(data.usd);
      setTotalUsd((t) => t + data.usd);
      setExchanges((list) => [{ id: Date.now(), comment: clean, post: target, result: data }, ...list]);
      if (clean === comment.trim()) setComment('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendNew = () => {
    const [route, depth] = force.split(':');
    void send(comment, post, route ? { route, depth } : null);
  };

  return (
    <main className="pl">
      <header className="pl-head">
        <h1>Comment lab</h1>
        <p className="pl-note">Write a comment and see what the bot would do. Nothing here posts, and nothing is saved.</p>
        <p className="pl-note">
          {lastUsd === null ? 'Send makes live Claude calls.' : `Last click $${lastUsd.toFixed(4)}. This session $${totalUsd.toFixed(4)}.`}
        </p>
      </header>

      <section className="pl-card">
        <div className="pl-row">
          <select aria-label="Post type" value={type} onChange={(e) => {
            const next = e.target.value as LabPostType;
            setType(next);
            setPost(postsOfType(next)[0]!);
          }}>
            {LAB_POST_TYPES.map((t) => <option key={t} value={t}>{t} ({postsOfType(t).length})</option>)}
          </select>
          <button onClick={() => setPost(pickOther(postsOfType(type), post))}>Different post</button>
          <span className="pl-note pl-small">
            {post.date}{post.permalink ? <> · <a href={post.permalink} target="_blank" rel="noreferrer">See it on Instagram</a></> : null}
          </span>
        </div>
        <p className="pl-label">What the bot sees: {type === 'Explainers' ? 'script' : 'copy'}</p>
        <p className="pl-post-copy">{post.copy}</p>
        {post.caption ? (
          <details className="pl-caption">
            <summary>What the bot sees: caption</summary>
            <p className="pl-post-copy">{post.caption}</p>
          </details>
        ) : <p className="pl-note pl-small">This post has no caption.</p>}
      </section>

      <section className="pl-card">
        <textarea aria-label="Comment" rows={2} placeholder="Write a comment on this post…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNew(); }
        }} />
        <div className="pl-row">
          <button className="pl-primary" disabled={busy || !comment.trim()} onClick={sendNew}>{busy ? 'Thinking…' : 'Send'}</button>
          <label>Route
            <select value={force} onChange={(e) => setForce(e.target.value)}>
              {FORCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="pl-samples">
          {LAB_SAMPLE_COMMENTS.map((group) => (
            <button key={group.label} disabled={busy} onClick={() => setComment(pickOther(group.comments, comment))}>{group.label}</button>
          ))}
        </div>
      </section>

      {error ? <p className="pl-error">{error}</p> : null}
      {exchanges.length === 0 ? <p className="pl-note">Write a comment, or tap a group to fill one in, then Send.</p> : null}
      {exchanges.map((x) => (
        <Reply key={x.id} x={x} busy={busy} onRetry={() => void send(x.comment, x.post, { route: x.result.decision.route, energy: x.result.decision.energy, depth: x.result.decision.depth }, true)} />
      ))}

      <details className="pl-soul">
        <summary>Read the voice file</summary>
        <pre>{soul}</pre>
      </details>
    </main>
  );
}
