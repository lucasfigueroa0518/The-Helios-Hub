'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  Loader2,
  Play,
  Sparkles,
  X,
} from 'lucide-react';

import { requestJson } from '@/lib/client-request';
import type { StoredCopyJob } from '@/lib/reels/copy/jobs';
import type { StoredCopy } from '@/lib/reels/copy/store';
import type { FinishStatus, ReelsOverview } from '@/lib/reels/overview';
import type { StoredScore, StoredSlate } from '@/lib/reels/scoring/store';
import type { StoredFrame } from '@/lib/reels/visual/run';
import type { StoredVideo } from '@/lib/reels/visual/video-run';

/* ------------------------------------------------------------------ labels */

const ARCHETYPE: Record<string, string> = {
  ball_knowledge: 'Ball Knowledge',
  the_number: 'The Number',
  the_saga: 'The Saga',
  personal_profile: 'Personal Profile',
  the_warning: 'The Warning',
  the_callout: 'The Callout',
};

const CATEGORY: Record<string, string> = {
  curiosity: 'Curiosity',
  arousal: 'Arousal',
  identity: 'Identity',
};

const RUN_STATUS: Record<string, string> = {
  requested: 'Queued',
  running: 'Running',
  ok: 'Healthy',
  partial: 'Partial',
  failed: 'Failed',
  skipped: 'Skipped',
};

const STAGE_LABEL: Record<string, string> = { copy: 'Copy', frame: 'Frame', video: 'Video' };

/* ----------------------------------------------------------------- format */

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `nyDate` is a New York calendar date. Parsing it as UTC shifts the label back a day. */
function formatNyDate(nyDate: string, style: 'short' | 'long' = 'short'): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  if (!year || !month || !day) return nyDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: style === 'long' ? 'long' : undefined,
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
  });
}

function todayInNewYork(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function score2(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function usd(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------- day model */

type DayView = {
  slate: StoredSlate;
  isCurrent: boolean;
  copy: Record<string, StoredCopy>;
  frames: Record<string, StoredFrame>;
  videos: Record<string, StoredVideo>;
  copyJobs: Record<string, StoredCopyJob>;
  finishes: Record<string, FinishStatus>;
};

export function dayViews(data: ReelsOverview): DayView[] {
  const views: DayView[] = [];
  if (data.slate) {
    views.push({
      slate: data.slate,
      isCurrent: true,
      copy: data.copy,
      frames: data.frames,
      videos: data.videos,
      copyJobs: data.copyJobs,
      finishes: data.finishes,
    });
  }
  for (const day of data.archive) views.push({ ...day, isCurrent: false });
  return views;
}

type ReelPhase = 'ready' | 'working' | 'failed' | 'empty' | 'blocked';

type Reel = {
  score: StoredScore;
  copy: StoredCopy | null;
  frame: StoredFrame | null;
  video: StoredVideo | null;
  job: StoredCopyJob | null;
  finish: FinishStatus | null;
  phase: ReelPhase;
  stage: string;
  canGenerate: boolean;
  poster: string | null;
  still: string | null;
};

export function reelFor(view: DayView, score: StoredScore): Reel {
  const id = score.postIdeaId;
  const copy = view.copy[id] ?? null;
  const frame = view.frames[id] ?? null;
  const video = view.videos[id] ?? null;
  const job = view.copyJobs[id] ?? null;
  const finish = view.finishes[id] ?? null;
  const writing = job?.status === 'requested' || job?.status === 'running';
  const framing = frame?.status === 'requested' || frame?.status === 'running';
  const filming = video?.status === 'requested' || video?.status === 'running';
  const working = finish?.status === 'active' || writing || framing || filming;
  const canGenerate = Boolean(score.chosenBucket && score.chosenFramework);
  const ready = video?.status === 'ok' && video.hasVideo;
  const phase: ReelPhase = working
    ? 'working'
    : ready
      ? 'ready'
      : finish?.status === 'failed'
        ? 'failed'
        : canGenerate
          ? 'empty'
          : 'blocked';
  const still = frame?.hasFrame
    ? `/api/reels/frames/${frame.id}?variant=frame`
    : frame?.hasBackground
      ? `/api/reels/frames/${frame.id}?variant=background`
      : null;
  return {
    score,
    copy,
    frame,
    video,
    job,
    finish,
    phase,
    stage: writing ? 'Writing copy' : framing ? 'Making the frame' : filming ? 'Making the video' : 'Starting',
    canGenerate,
    poster: still,
    still,
  };
}

function labels(score: StoredScore): { archetype: string | null; category: string | null } {
  return {
    archetype: score.chosenBucket ? ARCHETYPE[score.chosenBucket] ?? score.chosenBucket : null,
    category: score.chosenFramework ? CATEGORY[score.chosenFramework] ?? score.chosenFramework : null,
  };
}

/** The addends of the net: winning framework, winning bucket, the higher value, blockbuster, and the Ball Knowledge bump when it applies. */
function netParts(score: StoredScore): Array<{ label: string; value: string }> {
  if (score.net == null) return [];
  const parts: Array<{ label: string; value: string }> = [];
  const { archetype, category } = labels(score);
  if (category && score.psychology != null) parts.push({ label: category, value: score2(score.psychology) });
  if (archetype && score.bucketScore != null) parts.push({ label: archetype, value: score2(score.bucketScore) });
  if (score.value != null) {
    const knowledge = score.components.knowledge?.score ?? null;
    const entertainment = score.components.entertainment?.score ?? null;
    const label =
      knowledge != null && (entertainment == null || knowledge >= entertainment) ? 'Knowledge' : 'Entertainment';
    parts.push({ label, value: score2(score.value) });
  }
  if (score.blockbuster > 0) parts.push({ label: 'Blockbuster', value: `+${score2(score.blockbuster)}` });
  if (score.components.ballKnowledge > 0) {
    parts.push({ label: 'Ball knowledge', value: `+${score2(score.components.ballKnowledge)}` });
  }
  return parts;
}

/** Everything a reel says about itself: failures first, then warnings and copy checks. */
function statusNotes(reel: Reel): Array<{ tone: 'bad' | 'warn'; text: string }> {
  const notes: Array<{ tone: 'bad' | 'warn'; text: string }> = [];
  if (reel.finish?.status === 'failed' && reel.finish.error) notes.push({ tone: 'bad', text: reel.finish.error });
  if (reel.job?.status === 'failed' && reel.job.error) notes.push({ tone: 'bad', text: `Copy: ${reel.job.error}` });
  if (reel.copy?.status === 'failed') notes.push({ tone: 'bad', text: `Copy: ${reel.copy.error ?? 'failed'}` });
  if (reel.video?.status === 'failed' && reel.video.error) notes.push({ tone: 'bad', text: `Video: ${reel.video.error}` });
  if (reel.video?.status === 'ok' && reel.video.error) {
    for (const part of reel.video.error.replace(/^Warning:\s*/, '').split(' | ')) {
      notes.push({ tone: 'warn', text: `Video: ${part}` });
    }
  }
  if (reel.frame?.error) notes.push({ tone: reel.frame.status === 'ok' ? 'warn' : 'bad', text: `Frame: ${reel.frame.error}` });
  for (const warning of reel.frame?.warnings ?? []) notes.push({ tone: 'warn', text: `Frame: ${warning}` });
  const checks = reel.copy?.checks;
  if (checks) {
    if (!checks.copyInRange) {
      notes.push({ tone: 'warn', text: `${checks.copyWords} words on screen (archetype asks ${checks.copyWordRange.min}–${checks.copyWordRange.max})` });
    }
    if (!checks.foldFits) notes.push({ tone: 'warn', text: `First caption line is ${checks.foldChars} characters (fold is 125)` });
    if (!checks.captionUnderLimit) notes.push({ tone: 'warn', text: `Caption is ${checks.captionChars} characters (limit 2,200)` });
    if (!checks.hashtagsInRange) notes.push({ tone: 'warn', text: `${checks.hashtagCount} hashtags (asked for 3–5)` });
    if (checks.dashes > 0) notes.push({ tone: 'warn', text: `${checks.dashes} dash(es) in the copy` });
    if (checks.urlsInCaption > 0) notes.push({ tone: 'warn', text: `${checks.urlsInCaption} URL(s) in the caption` });
    if (checks.firstPersonWords.length > 0) {
      notes.push({ tone: 'warn', text: `First-person words: ${checks.firstPersonWords.join(', ')} (may be quotes)` });
    }
    if (checks.unknownSourceUrls.length > 0) {
      notes.push({ tone: 'warn', text: `${checks.unknownSourceUrls.length} source URL(s) not in this idea` });
    }
  }
  return notes;
}

function captionText(copy: StoredCopy | null): string {
  if (!copy || copy.status !== 'ok') return '';
  return [copy.caption, copy.callToAction, copy.hashtags.join(' ')].filter((part): part is string => Boolean(part)).join('\n\n');
}

/* ------------------------------------------------------------------- hub */

export function ReelsHub({ initial }: { initial: ReelsOverview }) {
  const [data, setData] = useState<ReelsOverview>(initial);
  const [dayId, setDayId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await requestJson<ReelsOverview>('/api/reels/overview'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const views = useMemo(() => dayViews(data), [data]);
  const dayList = useRef<HTMLDivElement>(null);

  // Days run oldest to newest, left to right. Start scrolled to today.
  useEffect(() => {
    const list = dayList.current;
    if (list) list.scrollLeft = list.scrollWidth;
  }, [views.length]);
  const view = views.find((item) => item.slate.id === dayId) ?? views[0] ?? null;
  const viewIndex = view ? views.indexOf(view) : -1;

  const nightInFlight = data.latest?.status === 'running' || data.latest?.status === 'requested';
  const reelInFlight =
    data.visualInFlight ||
    data.copyInFlight ||
    data.videoInFlight ||
    [data.finishes, ...data.archive.map((day) => day.finishes)].some((finishes) =>
      Object.values(finishes).some((finish) => finish.status === 'active'),
    );

  // While a night or a reel is in flight the page follows it.
  useEffect(() => {
    if (!nightInFlight && !reelInFlight) return undefined;
    const timer = setInterval(() => void refresh(), reelInFlight ? 4_000 : 10_000);
    return () => clearInterval(timer);
  }, [nightInFlight, reelInFlight, refresh]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 6_000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenId(null);
      setInsightsOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function generate(postIdeaId: string, slateId: string) {
    try {
      const result = await requestJson<{ queued: boolean; note?: string }>('/api/reels/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_idea_id: postIdeaId, slate_id: slateId }),
      });
      setMessage(result.note ?? 'Generating the reel.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function runNow() {
    setRunBusy(true);
    try {
      const result = await requestJson<{ queued: boolean; note?: string }>('/api/reels/run', { method: 'POST' });
      setMessage(result.queued ? 'Run queued. The worker picks it up within about 15 seconds.' : result.note ?? 'A run is already pending.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
    }
  }

  const health = healthOf(data);
  const reels = view ? view.slate.scores.map((score) => reelFor(view, score)) : [];
  const top = reels
    .filter((reel) => reel.score.selected)
    .sort((a, b) => (a.score.rank ?? 99) - (b.score.rank ?? 99));
  const rest = view?.isCurrent ? reels.filter((reel) => !reel.score.selected) : [];
  const open = reels.find((reel) => reel.score.postIdeaId === openId) ?? null;
  const today = todayInNewYork();

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Helios</p>
            <h1 className="rh__title">Trial Reels <span className="rh-beta">Beta</span></h1>
          </div>
          <div className="rh__head-actions">
            <button type="button" className="rh-btn rh-btn--quiet" disabled title="Advanced analytics on posted reels. Coming later.">
              <BarChart3 size={15} /> Post analytics <span className="rh-soon">Soon</span>
            </button>
            <button type="button" className="rh-btn" onClick={() => setInsightsOpen(true)} aria-haspopup="dialog">
              <span className={`rh-dot rh-dot--${health.tone}`} aria-hidden="true" />
              <Activity size={15} /> Insights
            </button>
          </div>
        </header>

        {views.length === 0 || !view ? (
          <p className="rh-empty">No scored days yet. The next run ranks the timely post ideas and picks the top three.</p>
        ) : (
          <>
            <nav className="rh-days" aria-label="Days">
              <button
                type="button"
                className="rh-days__step"
                onClick={() => setDayId(views[viewIndex + 1]?.slate.id ?? view.slate.id)}
                disabled={viewIndex >= views.length - 1}
                aria-label="Earlier day"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="rh-days__list" ref={dayList}>
                {[...views].reverse().map((item) => {
                  const active = item.slate.id === view.slate.id;
                  return (
                    <button
                      key={item.slate.id}
                      type="button"
                      className={`rh-day${active ? ' is-active' : ''}`}
                      aria-current={active ? 'date' : undefined}
                      onClick={() => {
                        setDayId(item.slate.id);
                        setOpenId(null);
                      }}
                    >
                      <span className="rh-day__date">{formatNyDate(item.slate.nyDate)}</span>
                      <span className="rh-day__sub">
                        {item.slate.nyDate === today ? 'Today' : item.isCurrent ? 'Latest' : 'Top 3'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="rh-days__step"
                onClick={() => setDayId(views[viewIndex - 1]?.slate.id ?? view.slate.id)}
                disabled={viewIndex <= 0}
                aria-label="Later day"
              >
                <ChevronRight size={16} />
              </button>
            </nav>

            <section className="rh-day-head">
              <h2>{formatNyDate(view.slate.nyDate, 'long')}</h2>
              <p>
                Scored {formatTime(view.slate.scoredAt)}
                {view.isCurrent ? ` · ${view.slate.scores.length} ideas in the pool` : ''}
              </p>
            </section>

            {top.length === 0 ? (
              <p className="rh-empty">Nothing cleared the bar this day, so no reels were selected.</p>
            ) : (
              <div className="rh-top">
                {top.map((reel) => (
                  <ReelCard
                    key={reel.score.postIdeaId}
                    reel={reel}
                    onOpen={() => setOpenId(reel.score.postIdeaId)}
                    onGenerate={() => void generate(reel.score.postIdeaId, view.slate.id)}
                  />
                ))}
              </div>
            )}

            {rest.length > 0 && (
              <section className="rh-rest">
                <h3 className="rh-rest__title">
                  The rest of the pool <span>{rest.length}</span>
                </h3>
                <ul className="rh-rest__list">
                  {rest.map((reel) => (
                    <li key={reel.score.postIdeaId}>
                      <RestRow reel={reel} onOpen={() => setOpenId(reel.score.postIdeaId)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {open && view && (
        <Drawer label="Reel details" onClose={() => setOpenId(null)}>
          <ReelDetail reel={open} onGenerate={() => void generate(open.score.postIdeaId, view.slate.id)} />
        </Drawer>
      )}

      {insightsOpen && (
        <Drawer label="Insights" onClose={() => setInsightsOpen(false)} wide>
          <Insights data={data} health={health} runBusy={runBusy || nightInFlight} onRunNow={() => void runNow()} />
        </Drawer>
      )}

      {message && (
        <p className="rh-toast" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- health */

type Health = { tone: 'ok' | 'warn' | 'bad' | 'idle'; label: string };

export function healthOf(data: ReelsOverview): Health {
  const latest = data.latest;
  const dayAgo = Date.now() - 86_400_000;
  const freshErrors = data.insights.recentErrors.filter((error) => new Date(error.at).getTime() > dayAgo).length;
  if (!latest) return { tone: 'idle', label: 'No runs yet' };
  if (latest.status === 'failed') return { tone: 'bad', label: 'Last run failed' };
  if (latest.status === 'partial' || latest.source_results.some((result) => result.status === 'failed')) {
    return { tone: 'warn', label: 'Last run had source errors' };
  }
  if (freshErrors > 0) return { tone: 'warn', label: `${freshErrors} job error${freshErrors === 1 ? '' : 's'} in 24 hours` };
  if (latest.status === 'running' || latest.status === 'requested') return { tone: 'idle', label: 'Run in progress' };
  return { tone: 'ok', label: 'All systems healthy' };
}

/* ----------------------------------------------------------------- media */

function ReelVideo({ id, poster, playing, controls }: { id: string; poster: string | null; playing: boolean; controls?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || controls) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, controls]);
  return (
    <video
      ref={ref}
      className="rh-media__fill"
      src={`/api/reels/video/${id}`}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      controls={controls}
      autoPlay={controls}
      preload="metadata"
    />
  );
}

function Pills({ score }: { score: StoredScore }) {
  return (
    <>
      {score.selected && <span className="rh-pill rh-pill--selected">Selected</span>}
      {score.origin === 'carryover' && <span className="rh-pill">Carryover</span>}
    </>
  );
}

function GenerateButton({ reel, onGenerate, block }: { reel: Reel; onGenerate: () => void; block?: boolean }) {
  const working = reel.phase === 'working';
  return (
    <button
      type="button"
      className={`rh-btn rh-btn--primary${block ? ' rh-btn--block' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onGenerate();
      }}
      disabled={working || !reel.canGenerate}
      title={reel.canGenerate ? undefined : 'No archetype and category cleared the bar, so there is nothing to write from.'}
    >
      {working ? <Loader2 size={15} className="rh-spin" /> : <Sparkles size={15} />}
      {working ? `${reel.stage}…` : 'Generate Reel'}
    </button>
  );
}

function ReelCard({ reel, onOpen, onGenerate }: { reel: Reel; onOpen: () => void; onGenerate: () => void }) {
  const [hover, setHover] = useState(false);
  const { archetype, category } = labels(reel.score);
  return (
    <article className="rh-reel">
      <div
        className="rh-reel__media"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {reel.phase === 'ready' && reel.video ? (
          <ReelVideo id={reel.video.id} poster={reel.poster} playing={hover} />
        ) : reel.still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rh-media__fill" src={reel.still} alt="" loading="lazy" />
        ) : null}
        <button type="button" className="rh-reel__hit" onClick={onOpen} aria-label={`Open reel ${reel.score.rank ?? ''} details`}>
          {reel.phase === 'ready' && !hover && (
            <span className="rh-reel__play" aria-hidden="true">
              <Play size={18} />
            </span>
          )}
        </button>
        {reel.phase === 'working' && (
          <div className="rh-reel__state">
            <Loader2 size={20} className="rh-spin" />
            <span>{reel.stage}</span>
          </div>
        )}
        {(reel.phase === 'empty' || reel.phase === 'failed' || reel.phase === 'blocked') && (
          <div className="rh-reel__state">
            {reel.phase === 'failed' && (
              <span className="rh-reel__note">
                <AlertTriangle size={14} /> Generation stopped
              </span>
            )}
            {reel.phase === 'blocked' ? (
              <span className="rh-reel__note">Nothing cleared the bar to write from</span>
            ) : (
              <GenerateButton reel={reel} onGenerate={onGenerate} />
            )}
          </div>
        )}
      </div>
      <button type="button" className="rh-reel__meta" onClick={onOpen}>
        <span className="rh-reel__score">{score2(reel.score.net)}</span>
        <span className="rh-reel__labels">
          {archetype && <span>{archetype}</span>}
          {category && <span className="rh-reel__cat">{category}</span>}
        </span>
        <span className="rh-reel__pills">
          <Pills score={reel.score} />
        </span>
      </button>
    </article>
  );
}

const PHASE_CHIP: Record<ReelPhase, string> = {
  ready: 'Reel ready',
  working: 'Generating',
  failed: 'Stopped',
  empty: 'No reel',
  blocked: 'No reel',
};

function RestRow({ reel, onOpen }: { reel: Reel; onOpen: () => void }) {
  const { archetype, category } = labels(reel.score);
  return (
    <button type="button" className="rh-row" onClick={onOpen}>
      <span className="rh-row__rank">{reel.score.rank ?? '—'}</span>
      <span className="rh-row__main">
        <span className="rh-row__headline">{reel.score.headlines[0] ?? 'Untitled idea'}</span>
        <span className="rh-row__labels">
          {archetype ? `${archetype} · ${category ?? '—'}` : 'No framework cleared 0.60'}
        </span>
      </span>
      <span className="rh-row__pills">
        <Pills score={reel.score} />
        <span className={`rh-chip rh-chip--${reel.phase}`}>
          {reel.phase === 'working' && <Loader2 size={11} className="rh-spin" />} {PHASE_CHIP[reel.phase]}
        </span>
      </span>
      <span className="rh-row__score">{score2(reel.score.net)}</span>
      <ChevronRight size={16} className="rh-row__chev" aria-hidden="true" />
    </button>
  );
}

/* ---------------------------------------------------------------- drawer */

function Drawer({
  label,
  onClose,
  wide,
  children,
}: {
  label: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className="rh-drawer" role="presentation">
      <button type="button" className="rh-drawer__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        className={`rh-drawer__panel${wide ? ' rh-drawer__panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <button type="button" className="rh-drawer__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

function Section({ title, open, children, count }: { title: string; open?: boolean; count?: number; children: ReactNode }) {
  return (
    <details className="rh-section" open={open}>
      <summary>
        {title}
        {count != null && count > 0 && <span className="rh-section__count">{count}</span>}
      </summary>
      <div className="rh-section__body">{children}</div>
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rh-btn rh-btn--quiet rh-btn--xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      <CopyIcon size={12} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ReelDetail({ reel, onGenerate }: { reel: Reel; onGenerate: () => void }) {
  const { archetype, category } = labels(reel.score);
  const parts = netParts(reel.score);
  const notes = statusNotes(reel);
  const caption = captionText(reel.copy);
  const spend = (reel.copy?.usd ?? 0) + (reel.frame?.usd ?? 0) + (reel.video?.usd ?? 0);
  return (
    <div className="rh-detail">
      <header className="rh-detail__head">
        <span className="rh-detail__rank">#{reel.score.rank ?? '—'}</span>
        <div className="rh-detail__score">
          <span>{score2(reel.score.net)}</span>
          <small>net score</small>
        </div>
        <div className="rh-detail__labels">
          <span className="rh-detail__archetype">{archetype ?? 'No archetype cleared the bar'}</span>
          {category && <span className="rh-detail__cat">{category}</span>}
          <span className="rh-reel__pills">
            <Pills score={reel.score} />
          </span>
        </div>
      </header>

      <div className="rh-detail__media">
        {reel.phase === 'ready' && reel.video ? (
          <ReelVideo id={reel.video.id} poster={reel.poster} playing controls />
        ) : reel.still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rh-media__fill" src={reel.still} alt="Reel still" />
        ) : (
          <div className="rh-detail__blank">{reel.phase === 'working' ? `${reel.stage}…` : 'No reel yet'}</div>
        )}
      </div>

      <GenerateButton reel={reel} onGenerate={onGenerate} block />

      <div className="rh-detail__sections">
        <Section title="Caption" open>
          {caption ? (
            <>
              <p className="rh-text">{caption}</p>
              <CopyButton text={caption} />
            </>
          ) : (
            <p className="rh-muted">No caption yet.</p>
          )}
        </Section>

        <Section title="On-screen copy">
          {reel.copy?.status === 'ok' ? <p className="rh-text rh-text--screen">{reel.copy.onScreenCopy}</p> : <p className="rh-muted">No copy yet.</p>}
        </Section>

        <Section title="Status" count={notes.length} open={notes.some((note) => note.tone === 'bad')}>
          {reel.phase === 'working' && (
            <p className="rh-note">
              <Loader2 size={13} className="rh-spin" /> {reel.stage}
            </p>
          )}
          {notes.length === 0 && reel.phase !== 'working' && <p className="rh-muted">No warnings.</p>}
          <ul className="rh-notes">
            {notes.map((note, index) => (
              <li key={`${note.text}-${index}`} className={`rh-note rh-note--${note.tone}`}>
                <AlertTriangle size={13} /> {note.text}
              </li>
            ))}
          </ul>
          {spend > 0 && <p className="rh-muted">Spent on this reel: {usd(spend, 3)} (Claude, Jev, and image; Kling adds about $0.67 per clip)</p>}
        </Section>

        <Section title="Score">
          <dl className="rh-parts">
            <div>
              <dt>Net</dt>
              <dd>{score2(reel.score.net)}</dd>
            </div>
            {parts.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
            {reel.score.confidence != null && (
              <div>
                <dt>Confidence</dt>
                <dd>{score2(reel.score.confidence)}</dd>
              </div>
            )}
          </dl>
        </Section>

        <Section title="Story" count={reel.score.headlines.length}>
          <ul className="rh-list">
            {reel.score.headlines.map((headline, index) => (
              <li key={`${headline}-${index}`}>{headline}</li>
            ))}
          </ul>
          {reel.copy?.status === 'ok' && reel.copy.sources.length > 0 && (
            <ul className="rh-list rh-list--sources">
              {reel.copy.sources.map((source, index) => (
                <li key={`${source.url}-${index}`}>
                  {source.name} ·{' '}
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {hostOf(source.url)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {reel.frame?.scene && (
          <Section title="Scene">
            <p className="rh-text">{reel.frame.scene}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- insights */

export function Insights({
  data,
  health,
  runBusy,
  onRunNow,
}: {
  data: ReelsOverview;
  health: Health;
  runBusy: boolean;
  onRunNow: () => void;
}) {
  const latest = data.latest;
  const failedSources = (latest?.source_results ?? []).filter((result) => result.status === 'failed');
  const costs = data.insights.costs;
  const watchShare = Math.min(1, costs.monthToDateUsd / Math.max(1, data.spend.watchUsd));
  const peak = Math.max(0.01, ...costs.days.map((day) => day.ledgerUsd + day.klingUsd));
  const perReel = costs.reelsMade > 0 ? costs.monthToDateUsd / costs.reelsMade : null;
  const inFlight = [
    data.copyInFlight && 'copy',
    data.visualInFlight && 'a frame',
    data.videoInFlight && 'a video',
  ].filter(Boolean);

  return (
    <div className="rh-insights">
      <header className="rh-insights__head">
        <p className="rh__kicker">Insights</p>
        <h2>System health and costs</h2>
      </header>

      <section className="rh-card">
        <div className="rh-card__row">
          <span className={`rh-health rh-health--${health.tone}`}>
            <span className={`rh-dot rh-dot--${health.tone}`} /> {health.label}
          </span>
          <button type="button" className="rh-btn rh-btn--xs" onClick={onRunNow} disabled={runBusy}>
            {runBusy ? <Loader2 size={12} className="rh-spin" /> : <Play size={12} />} {runBusy ? 'Running' : 'Run now'}
          </button>
        </div>
        <dl className="rh-facts">
          <div>
            <dt>Last run</dt>
            <dd>
              {latest ? `${RUN_STATUS[latest.status] ?? latest.status} · ${formatTime(latest.started_at ?? latest.requested_at)}` : 'None yet'}
            </dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{formatTime(latest?.finished_at ?? null)}</dd>
          </div>
          <div>
            <dt>Next scheduled</dt>
            <dd>{formatTime(data.nextRunAt)}</dd>
          </div>
          <div>
            <dt>In flight</dt>
            <dd>{inFlight.length > 0 ? `Making ${inFlight.join(', ')}` : 'Idle'}</dd>
          </div>
        </dl>
        {latest && (
          <p className="rh-muted rh-stats">
            {latest.stats.ingested ?? 0} kept · {latest.stats.dropped ?? 0} dropped · {latest.stats.scored ?? 0} scored ·{' '}
            {latest.stats.selected ?? 0} selected · {latest.stats.jevCalls ?? 0} Jev calls · {usd(latest.stats.usd ?? 0, 3)}
          </p>
        )}
      </section>

      <section className="rh-card">
        <h3 className="rh-card__title">Errors in the last run</h3>
        {!latest?.note && failedSources.length === 0 ? (
          <p className="rh-muted">None.</p>
        ) : (
          <ul className="rh-notes">
            {latest?.note && (
              <li className={`rh-note rh-note--${latest.status === 'failed' ? 'bad' : 'warn'}`}>
                <AlertTriangle size={13} /> {latest.note}
              </li>
            )}
            {failedSources.map((result) => (
              <li key={result.adapterId} className="rh-note rh-note--warn">
                <AlertTriangle size={13} /> {result.name}: {result.error ?? 'failed'}
              </li>
            ))}
          </ul>
        )}
        {!data.b6Approved && <p className="rh-muted">The nightly web-search story (B6) is off until the P-01 prompt is approved.</p>}
        {!data.copyApproved && <p className="rh-muted">On-screen copy and captions are off until the P-10 prompt is approved.</p>}
      </section>

      <section className="rh-card">
        <h3 className="rh-card__title">Reel job errors, last 7 days</h3>
        {data.insights.recentErrors.length === 0 ? (
          <p className="rh-muted">None.</p>
        ) : (
          <ul className="rh-errors">
            {data.insights.recentErrors.map((error, index) => (
              <li key={`${error.at}-${index}`}>
                <span className="rh-errors__meta">
                  {STAGE_LABEL[error.stage]} · {formatTime(error.at)}
                </span>
                {error.headline && <span className="rh-errors__idea">{error.headline}</span>}
                <span className="rh-errors__text">{error.error}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rh-card">
        <h3 className="rh-card__title">Costs this month</h3>
        <div className="rh-spend">
          <span className="rh-spend__total">{usd(costs.monthToDateUsd)}</span>
          <span className="rh-muted">of the {usd(data.spend.watchUsd, 0)} watch</span>
        </div>
        <div className="rh-meter" aria-hidden="true">
          <span style={{ width: `${watchShare * 100}%` }} className={watchShare >= 1 ? 'is-over' : undefined} />
        </div>
        <dl className="rh-facts rh-facts--three">
          <div>
            <dt>Reels made</dt>
            <dd>{costs.reelsMade}</dd>
          </div>
          <div>
            <dt>Kling clips</dt>
            <dd>{costs.klingClips}</dd>
          </div>
          <div>
            <dt>All-in per reel</dt>
            <dd>{perReel == null ? '—' : usd(perReel)}</dd>
          </div>
        </dl>

        <p className="rh-card__sub">Last 14 days</p>
        <div className="rh-bars" role="img" aria-label="Daily spend for the last 14 days">
          {costs.days.map((day) => {
            const total = day.ledgerUsd + day.klingUsd;
            return (
              <div key={day.nyDate} className="rh-bars__col" title={`${formatNyDate(day.nyDate)}: ${usd(total)}`}>
                <div className="rh-bars__stack" style={{ height: `${(total / peak) * 100}%` }}>
                  <span className="rh-bars__kling" style={{ flexGrow: day.klingUsd }} />
                  <span className="rh-bars__ledger" style={{ flexGrow: day.ledgerUsd }} />
                </div>
                <span className="rh-bars__label">{Number(day.nyDate.slice(8))}</span>
              </div>
            );
          })}
        </div>
        <p className="rh-legend">
          <span className="rh-legend__kling" /> Kling video <span className="rh-legend__ledger" /> Claude, Jev, and images
        </p>

        <table className="rh-table">
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Calls</th>
              <th scope="col">Spend</th>
            </tr>
          </thead>
          <tbody>
            {costs.lines.length === 0 ? (
              <tr>
                <td colSpan={3} className="rh-muted">
                  No spend yet this month.
                </td>
              </tr>
            ) : (
              costs.lines.map((line) => (
                <tr key={`${line.vendor}-${line.component}`}>
                  <th scope="row">
                    {line.component} <span className="rh-muted">{line.vendor}</span>
                  </th>
                  <td>{line.calls}</td>
                  <td>{usd(line.usd, 3)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="rh-muted">Kling is billed by Fal outside the cost ledger, so it is counted from clips at $0.672 each. Retries inside a job are not counted.</p>
      </section>

      <section className="rh-card">
        <h3 className="rh-card__title">Recent runs</h3>
        <ul className="rh-runs">
          {data.runs.slice(0, 8).map((run) => (
            <li key={run.id}>
              <span className={`rh-dot rh-dot--${run.status === 'ok' ? 'ok' : run.status === 'failed' ? 'bad' : run.status === 'partial' ? 'warn' : 'idle'}`} />
              <span>{formatTime(run.started_at ?? run.requested_at)}</span>
              <span className="rh-muted">{RUN_STATUS[run.status] ?? run.status} · {run.trigger}</span>
              <span className="rh-muted">{usd(run.stats.usd ?? 0, 3)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
