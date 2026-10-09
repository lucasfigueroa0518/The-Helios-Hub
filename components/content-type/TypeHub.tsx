'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Film, GalleryHorizontal, ImageIcon, Layers } from 'lucide-react';

import { Drawer, Section } from '@/app/reels/ui';
import { BackToHub } from '@/components/content-type/BackToHub';
import { RankButtons } from '@/components/content-type/RankButtons';
import { useRunProgress } from '@/components/content-type/run-progress';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { MADE_LABEL, STORY_SERIES, type MadeKind, type TypeBenchItem, type TypeCard, type TypeHubModel } from '@/lib/content-type/model';
import type { ProgressItem } from '@/lib/content-type/progress';
import { runStatusText, type RunSnapshot } from '@/lib/content-type/run-status';
import { metricValue } from '@/lib/social-hub/metrics';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { clock, displayName, shortDate } from '@/lib/social-hub/views/format';
import { IDEA_STATE_LABEL } from '@/lib/social-hub/views/pools';

/**
 * A content type's page, in the Text on Screen format: title and header
 * controls, a row of days, that day's posts as cards, and the bench below
 * (the ideas waiting for the next generation). A card opens a drawer with
 * everything about the post and every action the hub offers for it.
 *
 * Pure display: the writes (Live, Run now, Generate) arrive as `headerActions`
 * and `benchAction`, built outside the read-only hub code.
 */

const ASPECT: Record<string, string> = { feed: '4 / 5', reel: '9 / 16', story: '9 / 16' };

const MADE_ICON: Record<MadeKind, typeof Film> = { slides: GalleryHorizontal, frames: Layers, video: Film };
const MADE_TITLE: Record<MadeKind, string> = { slides: 'Slides are', frames: 'Story frames are', video: 'A video is' };

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function TypeHub({ model, title, headerActions, progress, nav, benchAction, benchNote, fullPostBase = '/social' }: {
  model: TypeHubModel;
  title: string;
  headerActions?: ReactNode;
  /** The "it's working" strip: built outside the read-only hub code because it polls. */
  progress?: ReactNode;
  nav?: ReactNode;
  /** A per-idea button (Explainers: Generate), shown on bench rows and in their drawer. */
  benchAction?: (item: TypeBenchItem) => ReactNode;
  benchNote?: string;
  /** Where "Open the full post" goes: the hub (live) or its preview mirror. */
  fullPostBase?: string;
}) {
  const { days, today, bench } = model;
  const live = useRunProgress();
  const [now, setNow] = useState(() => Date.now());
  const ticking = live.some((item) => item.state !== 'failed') || bench.some((item) => item.idea.run && item.idea.run.state !== 'failed');
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  const runOf = (idea: HubIdea) => resolveRun(idea, live);
  const runText = (run: RunSnapshot | null) => (run ? runStatusText(run, now) : null);
  const [dayId, setDayId] = useState<string>(today);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [openIdea, setOpenIdea] = useState<string | null>(null);
  // Stories: the bench narrowed to one series. Filtering only hides rows; the pool is the same.
  const [series, setSeries] = useState<string | null>(null);
  const seriesTabs = model.vertical === 'stories' ? STORY_SERIES.map((name) => ({ name, n: bench.filter((b) => b.idea.group === name).length })) : [];
  const shown = series ? bench.filter((b) => b.idea.group === series) : bench;
  const list = useRef<HTMLDivElement>(null);
  const day = days.find((d) => d.date === dayId) ?? days.find((d) => d.date === today) ?? days.at(-1)!;
  const index = days.indexOf(day);
  const info = verticalInfo(model.vertical);

  // Days run oldest to newest, left to right; the strip starts on the selected day.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="date"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [day.date]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenPost(null);
      setOpenIdea(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = days.flatMap((d) => d.cards).find((c) => c.post.id === openPost) ?? bench.find((b) => b.card?.post.id === openPost)?.card ?? null;
  const idea = bench.find((b) => b.idea.id === openIdea) ?? null;
  const ideaRun = idea ? runOf(idea.idea) : null;
  const ideaStatus = runText(ideaRun);
  const posted = day.cards.filter((c) => c.post.status === 'published').length;

  return (
    <div className="rh">
      <div className="rh__inner">
        {nav}
        <header className="rh__head">
          <div>
            <BackToHub href={fullPostBase} />
            <h1 className="rh__title">{title} <span className="rh-beta">Beta</span></h1>
          </div>
          <div className="rh__head-actions">{headerActions}</div>
        </header>

        {progress}

        <nav className="rh-days" aria-label="Days">
          <button type="button" className="rh-days__step" onClick={() => setDayId(days[index - 1]!.date)} disabled={index <= 0} aria-label="Earlier day">
            <ChevronLeft size={16} />
          </button>
          <div className="rh-days__list" ref={list}>
            {days.map((d) => {
              const active = d.date === day.date;
              const n = d.cards.length;
              return (
                <button key={d.date} type="button" className={`rh-day${active ? ' is-active' : ''}`} aria-current={active ? 'date' : undefined} onClick={() => { setDayId(d.date); setOpenPost(null); }}>
                  <span className="rh-day__date">{dayLabel(d.date)}</span>
                  <span className="rh-day__sub">{d.date === today ? (n ? `Today · ${n}` : 'Today') : d.date > today ? `Upcoming · ${n}` : n ? `${n} ${n === 1 ? 'post' : 'posts'}` : 'None'}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="rh-days__step" onClick={() => setDayId(days[index + 1]!.date)} disabled={index >= days.length - 1} aria-label="Later day">
            <ChevronRight size={16} />
          </button>
        </nav>

        <section className="rh-day-head">
          <div>
            <h2>{longDay(day.date)}</h2>
            <p>
              {day.cards.length ? `${day.cards.length} ${day.cards.length === 1 ? 'post' : 'posts'}${posted ? ` · ${posted} posted` : ''}` : 'Nothing posted or scheduled'}
              {day.date === today ? ` · ${model.poolOpen} ${model.poolOpen === 1 ? 'idea' : 'ideas'} in the pool` : ''}
            </p>
          </div>
        </section>

        {day.cards.length === 0 ? (
          <p className="rh-empty">{day.date > today ? `Nothing is scheduled for this day.` : `No ${info.label.toLowerCase()} posts on this day.`}</p>
        ) : (
          <div className="rh-top">
            {day.cards.map((card) => {
              const run = runForPost(card.post, bench, live);
              return <PostCard key={card.post.id} card={card} status={run ? runStatusText(run, now) : null} failed={run?.state === 'failed'} onOpen={() => setOpenPost(card.post.id)} />;
            })}
          </div>
        )}

        <section className="rh-rest">
          <h3 className="rh-rest__title">The bench <span>{series ? shown.length : model.benchTotal}</span></h3>
          <p className="rh-muted">{benchNote ?? (seriesTabs.length ? 'Ideas waiting for the next generation, best first within each series.' : 'Ideas waiting for the next generation, best first.')}</p>
          {seriesTabs.length ? (
            <div className="segmented rh-bench-filter" role="group" aria-label="Series">
              <button type="button" className={`segmented__item${series == null ? ' segmented__item--active' : ''}`} aria-pressed={series == null} onClick={() => setSeries(null)}>All series <span className="rh-bench-filter__n">{bench.length}</span></button>
              {seriesTabs.map((t) => (
                <button key={t.name} type="button" className={`segmented__item${series === t.name ? ' segmented__item--active' : ''}`} aria-pressed={series === t.name} onClick={() => setSeries(t.name)}>
                  {t.name} <span className="rh-bench-filter__n">{t.n}</span>
                </button>
              ))}
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="rh-empty">{series ? `No ${series} ideas in the pool until its next refill.` : 'The pool is empty until its next refill.'}</p>
          ) : (
            <ul className="rh-rest__list">
              {shown.map((item) => {
                const run = runOf(item.idea);
                const status = runText(run);
                const made = item.card ? item.made ?? null : null;
                const MadeIcon = made ? MADE_ICON[made] : null;
                const openRow = () => (item.card ? setOpenPost(item.card.post.id) : setOpenIdea(item.idea.id));
                return (
                <li key={item.idea.id}>
                  <div className="rh-row" role="button" tabIndex={0} onClick={openRow} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(); } }}>
                    <span className="rh-row__rank">{item.rank}</span>
                    <span className="rh-row__main">
                      <span className="rh-row__headline">{item.idea.title}</span>
                      {status ? <span className={`rh-row__status${run?.state === 'failed' ? ' is-failed' : ''}`}>{status}</span> : null}
                      {item.idea.group || item.idea.detail ? (
                        <span className="rh-row__labels">
                          {item.idea.group ? <span className="rh-tag">{item.idea.group}</span> : null}
                          {item.idea.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="rh-row__pills">
                      {made && MadeIcon && item.card ? (
                        <span className="rh-chip rh-chip--ready" title={`${MADE_TITLE[made]} made and waiting: ${item.card.offer.state.label.toLowerCase()}`}>
                          <MadeIcon size={11} /> {MADE_LABEL[made]}
                        </span>
                      ) : (
                        <span className="rh-chip">{IDEA_STATE_LABEL[item.idea.state]}</span>
                      )}
                      {item.inQuota ? <span className="rh-chip rh-chip--quota" title="One of today’s quota candidates">Today</span> : null}
                      {item.moved ? <span className="rh-chip">{item.moved === 'promoted' ? 'Promoted' : 'Demoted'}</span> : null}
                      {item.idea.state === 'idea_only' || item.idea.state === 'content_ready' ? <RankButtons vertical={model.vertical} ideaId={item.idea.id} compact /> : null}
                      {benchAction && !item.card ? <span onClick={(e) => e.stopPropagation()}>{benchAction(item)}</span> : null}
                    </span>
                    <span className="rh-row__score" title={item.idea.breakdown ? 'Open to see where the score comes from' : undefined}>{item.idea.score == null ? '—' : formatScore(item.idea.score)}</span>
                    <ChevronRight size={16} className="rh-row__chev" aria-hidden="true" />
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {open ? (
        <Drawer label={`${info.label} details`} onClose={() => setOpenPost(null)}>
          <PostDetail card={open} idea={bench.find((b) => b.card?.post.id === open.post.id)?.idea ?? null} run={runForPost(open.post, bench, live)} now={now} fullPostBase={fullPostBase} fromPath={`/${model.vertical}`} />
        </Drawer>
      ) : null}
      {idea ? (
        <Drawer label="Idea details" onClose={() => setOpenIdea(null)}>
          <div className="rh-detail">
            <h2 className="rh-detail__title">{idea.idea.title}</h2>
            {ideaStatus ? <p className={`rh-run-status${ideaRun?.state === 'failed' ? ' is-failed' : ''}`}>{ideaStatus}</p> : null}
            {ideaRun?.state === 'failed' && ideaRun.error ? <p className="rh-muted">{ideaRun.error}</p> : null}
            <p className="rh-muted">{IDEA_STATE_LABEL[idea.idea.state]}{idea.idea.group ? ` · ${idea.idea.group}` : ''} · ranked {idea.rank} of {idea.idea.group ? bench.filter((b) => b.idea.group === idea.idea.group).length : model.benchTotal}{idea.idea.score != null ? ` · ${idea.idea.scoreLabel || model.scoreLabel || 'score'} ${formatScore(idea.idea.score)}` : ''}</p>
            {idea.idea.detail ? <p>{idea.idea.detail}</p> : null}
            {idea.idea.createdAt ? <p className="rh-muted">Added {shortDate(idea.idea.createdAt)}</p> : null}
            {idea.idea.state === 'idea_only' || idea.idea.state === 'content_ready' ? <div style={{ marginTop: 12 }}><RankButtons vertical={model.vertical} ideaId={idea.idea.id} /></div> : null}
            {benchAction ? <div style={{ marginTop: 12 }}>{benchAction(idea)}</div> : null}
            <ScoreSection idea={idea.idea} />
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

const formatScore = (n: number) => n.toFixed(n >= 10 ? 0 : 2);

/** A part's points: signed, since the parts add up to the score. */
function formatPoints(n: number | null): string {
  if (n == null) return '—';
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return n > 0 ? `+${n.toFixed(digits)}` : n < 0 ? `−${Math.abs(n).toFixed(digits)}` : n.toFixed(digits);
}

/** Where an idea's score comes from: the rule, then each part with the answer behind it. */
function ScoreSection({ idea }: { idea: HubIdea }) {
  const b = idea.breakdown;
  if (!b && idea.score == null) return null;
  return (
    <div className="rh-detail__sections">
      <Section title="Where the score comes from" open>
        <p className="rh-muted rh-why__formula">{b?.formula ?? 'This pipeline stored a score without its parts.'}</p>
        {b?.parts.length ? (
          <dl className="rh-parts rh-why">
            <div className="rh-why__total">
              <dt>{idea.scoreLabel || 'Score'}</dt>
              <dd>{idea.score == null ? '—' : formatScore(idea.score)}</dd>
            </div>
            {b.parts.map((part, i) => (
              <div key={`${i}:${part.label}`} className={part.points == null ? 'is-note' : part.points < 0 ? 'is-minus' : part.points === 0 ? 'is-zero' : undefined}>
                <dt>{part.label}</dt>
                <dd>{formatPoints(part.points)}</dd>
                {part.detail ? <small>{part.detail}</small> : null}
              </div>
            ))}
          </dl>
        ) : null}
        {b?.note ? <p className="rh-muted rh-why__note">{b.note}</p> : null}
      </Section>
    </div>
  );
}

function pageList(post: HubPost): Array<{ src: string; label: string; remote: boolean }> {
  if (post.media.kind === 'slides') {
    return post.media.slides.flatMap((s, i) => {
      const src = s.src ?? s.photo;
      return src ? [{ src, label: s.headline ?? `Slide ${i + 1}`, remote: !s.src && Boolean(s.photo) }] : [];
    });
  }
  if (post.media.kind === 'frames') return post.media.frames.flatMap((f) => (f.src ? [{ src: f.src, label: f.label, remote: false }] : []));
  return [];
}

function PostCard({ card, status, failed, onOpen }: { card: TypeCard; status: string | null; failed?: boolean; onOpen: () => void }) {
  const { post, offer } = card;
  const when = post.postedAt ?? post.publishAt;
  const views = metricValue(post.metrics, post.format === 'story' ? 'reach' : 'views');
  const pages = pageList(post);
  const [page, setPage] = useState(0);
  const current = pages[page] ?? null;
  const thumb = current?.src ?? card.thumb;
  const remote = current ? current.remote : card.remote;
  const step = (dir: number) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setPage((n) => (n + dir + pages.length) % pages.length);
  };
  return (
    <article className="rh-reel">
      <div className="rh-reel__media" style={{ aspectRatio: ASPECT[post.format] ?? '4 / 5' }}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rh-media__fill" src={thumb} alt={current?.label ?? ''} loading="lazy" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
        ) : post.media.kind === 'video' && post.media.src ? (
          // No poster: the video's opening frame.
          <video className="rh-media__fill" src={`${post.media.src}#t=0.5`} muted playsInline preload="metadata" />
        ) : (
          <span className="rh-reel__state"><ImageIcon size={22} />{post.media.kind === 'none' ? post.media.note : post.status === 'generating' ? 'Being made' : 'No preview yet'}</span>
        )}
        <button type="button" className="rh-reel__hit" onClick={onOpen} aria-label={`Open ${displayName(post)}`} />
        {pages.length > 1 ? (
          <>
            <button type="button" className="rh-reel__step rh-reel__step--prev" onClick={step(-1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button type="button" className="rh-reel__step rh-reel__step--next" onClick={step(1)} aria-label="Next page"><ChevronRight size={16} /></button>
            <span className="rh-reel__pages">{page + 1} / {pages.length}</span>
          </>
        ) : null}
        <span className={`rh-reel__badge${failed ? ' is-failed' : ''}${post.status === 'published' ? ' is-done' : ''}`}>{status ?? offer.state.label}</span>
      </div>
      <button type="button" className="rh-reel__meta" onClick={onOpen}>
        <span className="rh-reel__score" style={{ fontSize: 22 }}>{when ? clock(when) : '—'}</span>
        <span className="rh-reel__labels">
          <span>{displayName(post)}</span>
          <span className={`rh-reel__cat${failed ? ' is-failed' : ''}`}>{status ?? [post.slot?.label, views != null ? `${views.toLocaleString('en-US')} ${post.format === 'story' ? 'reach' : 'views'}` : offer.state.line].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </article>
  );
}

function PostDetail({ card, idea, run, now, fullPostBase, fromPath }: { card: TypeCard; idea?: HubIdea | null; run: RunSnapshot | null; now: number; fullPostBase: string; fromPath: string }) {
  const { post, offer } = card;
  const when = post.postedAt ?? post.publishAt;
  const status = run ? runStatusText(run, now) : null;
  return (
    <div className="rh-detail">
      <h2 className="rh-detail__title">{displayName(post)}</h2>
      {status ? <p className={`rh-run-status${run?.state === 'failed' ? ' is-failed' : ''}`}>{status}</p> : null}
      {run?.state === 'failed' && run.error ? <p className="rh-muted">{run.error}</p> : null}
      <p className="rh-muted">
        <span className={`rh-chip${post.status === 'failed' || run?.state === 'failed' ? ' rh-chip--failed' : ''}`}>{status ?? offer.state.label}</span>
        {when ? ` ${shortDate(when)} ${clock(when)}` : ''}
        {post.slot ? ` · ${post.slot.label}` : ''}
      </p>
      {offer.state.line ? <p className="rh-muted">{offer.state.line}</p> : null}
      <Media post={post} />
      {post.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{post.description}</p> : null}
      {post.statusNote ? <p className="rh-muted">{post.statusNote}</p> : null}
      {post.reviewNotes?.length ? <ul>{post.reviewNotes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      <div className="sh" style={{ minHeight: 0, background: 'transparent', margin: '16px 0' }}>
        <ActionBar menu={offer.menu} />
      </div>
      {post.native.length ? (
        <dl className="rh-detail__facts">
          {post.native.slice(0, 14).map((f) => (
            <div key={`${f.group}:${f.label}`}><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {idea ? <ScoreSection idea={idea} /> : null}
      {post.sources.length ? (
        <p className="rh-muted">Sources: {post.sources.map((s, i) => <span key={s.url}>{i ? ', ' : ''}<a href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a></span>)}</p>
      ) : null}
      <p>
        <Link className="rh-btn" href={`${fullPostBase}/post/${encodeURIComponent(post.id)}?from=${encodeURIComponent(fromPath)}`}>
          Open the full post <ExternalLink size={14} />
        </Link>
        {post.permalink ? <> <a className="rh-btn" href={post.permalink} target="_blank" rel="noreferrer">View on Instagram <ExternalLink size={14} /></a></> : null}
      </p>
    </div>
  );
}

function Media({ post }: { post: HubPost }) {
  const m = post.media;
  if (m.kind === 'video' && m.src) return <FinishedVideo key={m.src} src={m.src} poster={m.poster ?? null} />;
  const pages = pageList(post);
  const [page, setPage] = useState(0);
  const current = pages[page];
  if (!current && m.kind === 'video' && m.poster) return <img src={m.poster} alt="" style={{ height: 180, borderRadius: 8 }} />;
  if (!current) return null;
  return (
    <div className="rh-pager">
      <img src={current.src} alt={current.label} />
      {pages.length > 1 ? (
        <div className="rh-pager__bar">
          <button type="button" className="rh-btn" onClick={() => setPage((n) => (n - 1 + pages.length) % pages.length)} aria-label="Previous page"><ChevronLeft size={14} /></button>
          <span>{current.label} · {page + 1} / {pages.length}</span>
          <button type="button" className="rh-btn" onClick={() => setPage((n) => (n + 1) % pages.length)} aria-label="Next page"><ChevronRight size={14} /></button>
        </div>
      ) : <p className="rh-muted">{current.label}</p>}
    </div>
  );
}

/** The finished video, to watch before approving: the point of opening a post. A record can outlive its file (a render kept on another machine), so say so instead of showing a dead player. */
function topicKey(id: string): string {
  const prefix = 'explainers:topic:';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function snapshot(item: ProgressItem): RunSnapshot {
  return { state: item.state, stage: item.stage, error: item.error, requestedAt: item.requestedAt, startedAt: item.startedAt };
}

/** A carousel run is one job for the type, not one idea — same strip the header already shows. */
function typeRun(vertical: HubPost['vertical'] | HubIdea['vertical'], live: readonly ProgressItem[]): RunSnapshot | null {
  if (vertical !== 'carousels') return null;
  const hit = live.find((item) => item.label === 'Carousel run') ?? live[0];
  return hit ? snapshot(hit) : null;
}

/** The live poll wins over the dataset snapshot, matched on the explainer topic. */
function resolveRun(idea: HubIdea, live: readonly ProgressItem[]): RunSnapshot | null {
  const topicId = topicKey(idea.id);
  const hit = live.find((item) => item.topicId != null && (item.topicId === topicId || item.topicId === idea.id));
  return hit ? snapshot(hit) : typeRun(idea.vertical, live) ?? idea.run ?? null;
}

function runForPost(post: HubPost, bench: readonly TypeBenchItem[], live: readonly ProgressItem[]): RunSnapshot | null {
  const topicId = post.refs.topicId ?? (post.idea ? topicKey(post.idea.id) : null);
  if (topicId) {
    const hit = live.find((item) => item.topicId === topicId);
    if (hit) return snapshot(hit);
    const fromIdea = bench.find((item) => topicKey(item.idea.id) === topicId)?.idea.run;
    if (fromIdea) return fromIdea;
  }
  return typeRun(post.vertical, live);
}

function FinishedVideo({ src, poster }: { src: string; poster: string | null }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <p className="rh-muted">The video file isn’t available here. The render is recorded, but its file isn’t in storage.</p>;
  return <video className="rh-detail__video" src={src} poster={poster ?? undefined} controls playsInline preload="metadata" onError={() => setMissing(true)} />;
}
