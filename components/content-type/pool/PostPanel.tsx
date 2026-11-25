'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

import { Badge, ScoreSection, SidePanel } from '@/components/content-type/pool/bits';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import type { TypeCard } from '@/lib/content-type/model';
import type { PoolRowState } from '@/lib/content-type/pool-rules';
import { runStatusText, type RunSnapshot } from '@/lib/content-type/run-status';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { clock, displayName, shortDate } from '@/lib/social-hub/views/format';

/**
 * A made post's side panel (DESIGN.md Pool screen, Post panel). Every section of the type page's old PostDetail, in
 * order: the version toggle, the run's status (and, when it stopped, its error), the state and status line, the
 * post's own action bar (the first button orange), the reel or the carousel pages, the caption, the status note and
 * review notes, the details, where the score comes from, the sources, then Open the full post and View on Instagram.
 * A type adds its own post controls through `extras` (Text on Screen: song, finish, publish).
 */
export function PostPanel({ card, versions, onVersion, state, meta, idea, run, now, fullPostBase, fromPath, readOnly, extras, onClose }: {
  card: TypeCard;
  /** Every made version of the post's idea, newest first (more than one: the toggle shows). */
  versions: TypeCard[];
  onVersion: (postId: string) => void;
  state: PoolRowState;
  /** "Posts Tue, 7:00 PM · made 2 d ago · archives in 28 d", when the post is in the Made window. */
  meta: string | null;
  idea: HubIdea | null;
  run: RunSnapshot | null;
  now: number;
  fullPostBase: string;
  fromPath: string;
  readOnly: boolean;
  extras?: ReactNode;
  onClose: () => void;
}) {
  const { post, offer } = card;
  const when = post.postedAt ?? post.publishAt;
  const status = run && run.state !== 'failed' ? runStatusText(run, now) : null;
  return (
    <SidePanel title={displayName(post)} label="Post details" onClose={onClose}>
      {versions.length > 1 ? (
        <div className="pl-versions" role="group" aria-label="Versions">
          <span>Version</span>
          {versions.map((v, i) => {
            const current = i === 0;
            const on = v.post.id === post.id;
            return (
              <button key={v.post.id} type="button" className={`pl-btn pl-btn--sm${on ? ' pl-btn--primary' : ''}`} aria-pressed={on} onClick={() => onVersion(v.post.id)} title={`${current ? 'Current version' : 'Earlier version'}${v.post.generatedAt ? `, made ${shortDate(v.post.generatedAt)}` : ''}`}>
                v{versions.length - i}{current ? ' · current' : ''}
              </button>
            );
          })}
        </div>
      ) : null}
      {status ? <p className="pl-run">{status}</p> : null}
      {run?.state === 'failed' ? (
        <div className="pl-err" style={{ marginTop: 0, marginBottom: 12 }}>
          <b>The last try stopped.</b>
          {run.error ? <code>{run.error}</code> : null}
        </div>
      ) : null}
      <p className="pl-status">
        <Badge state={state} />
        <span>
          {offer.state.label}
          {when ? ` · ${shortDate(when)} ${clock(when)}` : ''}
          {post.slot ? ` · ${post.slot.label}` : ''}
        </span>
      </p>
      {offer.state.line ? <p className="pl-meta" style={{ marginTop: 0, marginBottom: 12 }}>{offer.state.line}</p> : null}
      <div className="sh pl-actbar">
        <ActionBar menu={offer.menu} readOnly={readOnly} />
      </div>
      <Media key={post.id} post={post} />
      {post.description ? (
        <>
          <div className="pl-sec">Caption</div>
          <p className="pl-cap">{post.description}</p>
        </>
      ) : null}
      {meta ? <p className="pl-meta">{meta}</p> : null}
      {post.statusNote || post.reviewNotes?.length ? (
        <>
          <div className="pl-sec">Checks</div>
          {post.statusNote ? <p className="pl-meta" style={{ marginTop: 0 }}>{post.statusNote}</p> : null}
          {post.reviewNotes?.length ? (
            <ul className="pl-notes">
              {post.reviewNotes.map((n) => <li key={n}><Check className="pl-i" aria-hidden="true" />{n}</li>)}
            </ul>
          ) : null}
        </>
      ) : null}
      {post.native.length ? (
        <>
          <div className="pl-sec">Details</div>
          <dl className="pl-dl" style={{ marginTop: 0 }}>
            {post.native.slice(0, 14).map((f) => (
              <div key={`${f.group}:${f.label}`} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
        </>
      ) : null}
      {idea ? <ScoreSection idea={idea} /> : null}
      {post.sources.length ? (
        <p className="pl-meta" style={{ marginTop: 16 }}>
          Sources: {post.sources.map((s, i) => <span key={s.url}>{i ? ', ' : ''}<a href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a></span>)}
        </p>
      ) : null}
      <div className="pl-links">
        <Link className="pl-btn" href={`${fullPostBase}/post/${encodeURIComponent(post.id)}?from=${encodeURIComponent(fromPath)}`}>
          Open the full post <ExternalLink className="pl-i" aria-hidden="true" />
        </Link>
        {post.permalink ? <a className="pl-btn" href={post.permalink} target="_blank" rel="noreferrer">View on Instagram <ExternalLink className="pl-i" aria-hidden="true" /></a> : null}
      </div>
      {extras ? <div className="pl-extras">{extras}</div> : null}
    </SidePanel>
  );
}

function pageList(post: HubPost): Array<{ src: string; label: string; video?: string | null }> {
  if (post.media.kind === 'slides') {
    return post.media.slides.flatMap((s, i) => {
      const src = s.src ?? s.photo;
      return src ? [{ src, label: s.headline ?? `Slide ${i + 1}` }] : [];
    });
  }
  if (post.media.kind === 'frames') return post.media.frames.flatMap((f) => (f.src || f.video ? [{ src: f.src ?? '', label: f.label, video: f.video ?? null }] : []));
  return [];
}

/** The playable reel, or the carousel / story pages with a pager. */
function Media({ post }: { post: HubPost }) {
  const m = post.media;
  const pages = pageList(post);
  const [page, setPage] = useState(0);
  if (m.kind === 'video' && m.src) return <FinishedVideo key={m.src} src={m.src} poster={m.poster ?? null} />;
  const current = pages[page];
  // eslint-disable-next-line @next/next/no-img-element
  if (!current && m.kind === 'video' && m.poster) return <img src={m.poster} alt="" style={{ height: 180, borderRadius: 8 }} />;
  if (!current) return m.kind === 'none' && m.note ? <p className="pl-meta">{m.note}</p> : null;
  return (
    <div className="pl-pager">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {current.video
        ? <video key={current.video} src={current.video} poster={current.src || undefined} aria-label={current.label} muted loop playsInline controls autoPlay />
        : <img src={current.src} alt={current.label} />}
      {pages.length > 1 ? (
        <div className="pl-pager__bar">
          <button type="button" className="pl-icon-btn" onClick={() => setPage((n) => (n - 1 + pages.length) % pages.length)} aria-label="Previous page"><ChevronLeft className="pl-i" /></button>
          <span>{current.label} · {page + 1} / {pages.length}</span>
          <button type="button" className="pl-icon-btn" onClick={() => setPage((n) => (n + 1) % pages.length)} aria-label="Next page"><ChevronRight className="pl-i" /></button>
        </div>
      ) : <p className="pl-meta">{current.label}</p>}
    </div>
  );
}

/** The finished video, to watch before approving. A record can outlive its file, so say so instead of showing a dead player. */
function FinishedVideo({ src, poster }: { src: string; poster: string | null }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <p className="pl-meta">The video file isn’t available here. The render is recorded, but its file isn’t in storage.</p>;
  return <video className="pl-video" src={src} poster={poster ?? undefined} controls playsInline preload="metadata" onError={() => setMissing(true)} />;
}
