'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  Check,
  ExternalLink,
  Loader2,
  Music2,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import { Drawer, ReelVideo, Section } from '@/app/reels/ui';
import { requestJson } from '@/lib/client-request';
import { ENTERTAINMENT_BOOST, NET_BUCKET_WEIGHT, NET_VALUE_WEIGHT } from '@/lib/reels/config';
import type { StoredCopyJob } from '@/lib/reels/copy/jobs';
import { fullCaption } from '@/lib/reels/copy/report';
import type { StoredCopy } from '@/lib/reels/copy/store';
import type { MusicStatus, ReelSong } from '@/lib/reels/music/overview';
import type { FinishStatus, ReelsOverview } from '@/lib/reels/overview';
import type { StoredSchedule } from '@/lib/reels/publish/schedule';
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
  songs: Record<string, ReelSong>;
  schedules: Record<string, StoredSchedule>;
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
      songs: data.songs,
      schedules: data.schedules,
    });
  }
  for (const day of data.archive) views.push({ ...day, isCurrent: false, schedules: data.schedules });
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
  song: ReelSong | null;
  schedule: StoredSchedule | null;
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
  const song = view.songs[id] ?? null;
  const rawSchedule = view.schedules[id] ?? null;
  const schedule =
    rawSchedule &&
    (rawSchedule.status === 'published' ||
      rawSchedule.status === 'publishing' ||
      rawSchedule.nyDate === view.slate.nyDate)
      ? rawSchedule
      : null;
  const writing = job?.status === 'requested' || job?.status === 'running';
  const framing = frame?.status === 'requested' || frame?.status === 'running';
  const filming = video?.status === 'requested' || video?.status === 'running';
  // The song pick is the last step of the one reel flow (D-192).
  const picking = video?.status === 'ok' && !song?.song && (song?.pick?.status === 'requested' || song?.pick?.status === 'running');
  const working = finish?.status === 'active' || writing || framing || filming || picking;
  const canGenerate = Boolean(score.chosenBucket && score.chosenFramework);
  const ready = video?.status === 'ok' && video.hasVideo && !picking;
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
    song,
    schedule,
    phase,
    stage: writing ? 'Writing copy' : framing ? 'Making the frame' : filming ? 'Making the video' : picking ? 'Picking a song' : 'Starting',
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

/** The addends of the net: winning framework, winning bucket, the higher value, and blockbuster. Older rows also carry the retired Ball Knowledge bump. */
function netParts(score: StoredScore): Array<{ label: string; value: string }> {
  if (score.net == null) return [];
  const parts: Array<{ label: string; value: string }> = [];
  const { archetype, category } = labels(score);
  if (category && score.psychology != null) parts.push({ label: category, value: score2(score.psychology) });
  // D-253: bucket fit counts half and value counts double, so the parts add up to the net.
  if (archetype && score.bucketScore != null) {
    parts.push({ label: `${archetype} ×${NET_BUCKET_WEIGHT}`, value: score2(NET_BUCKET_WEIGHT * score.bucketScore) });
  }
  if (score.value != null) {
    // D-261: a boosted entertainment score competes at its boosted value.
    const boost = score.components.entertainmentBoosted ? ENTERTAINMENT_BOOST : 1;
    const entertainment = score.components.entertainment?.score;
    const kinds: Array<[string, number | null]> = [
      ['Useful', score.components.useful?.score ?? null],
      ['Worth knowing', score.components.knowledge?.score ?? null],
      [boost > 1 ? `Entertainment ×${ENTERTAINMENT_BOOST}` : 'Entertainment', entertainment == null ? null : entertainment * boost],
    ];
    const best = kinds.reduce((top, kind) => ((kind[1] ?? -1) > (top[1] ?? -1) ? kind : top));
    parts.push({ label: `${best[0]} ×${NET_VALUE_WEIGHT}`, value: score2(NET_VALUE_WEIGHT * score.value) });
  }
  if (score.blockbuster > 0) parts.push({ label: 'Blockbuster', value: `+${score2(score.blockbuster)}` });
  // Only rows scored before D-261 carry the Ball Knowledge bump.
  if ((score.components.ballKnowledge ?? 0) > 0) {
    parts.push({ label: 'Ball knowledge', value: `+${score2(score.components.ballKnowledge ?? 0)}` });
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

/** The caption as it posts (D-158): body, call to action, hashtags. */
function captionText(copy: StoredCopy | null): string {
  if (!copy || copy.status !== 'ok' || !copy.caption) return '';
  return fullCaption({ caption: copy.caption, callToAction: copy.callToAction ?? '', hashtags: copy.hashtags });
}

/* ------------------------------------------------------------ publishing */

type PublishState =
  | { kind: 'none' }
  | { kind: 'song-working'; text: string }
  | { kind: 'song-failed'; text: string }
  | { kind: 'awaiting' }
  | { kind: 'scheduled'; publishAt: string }
  | { kind: 'publishing' }
  | { kind: 'published'; permalink: string | null }
  | { kind: 'publish-failed'; text: string };

function formatSlotTime(iso: string): string {
  const when = new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${when} ET`;
}

/** Where a finished reel stands between its song pick and Instagram (D-155, D-170, D-171). */
export function publishState(reel: Reel, music: MusicStatus): PublishState {
  if (reel.phase !== 'ready' || !reel.video) return { kind: 'none' };
  const publish = reel.song?.publish;
  if (publish?.status === 'published') return { kind: 'published', permalink: publish.permalink };
  if (publish && publish.status !== 'failed') return { kind: 'publishing' };
  if (reel.schedule?.status === 'publishing') return { kind: 'publishing' };
  if (reel.schedule?.status === 'scheduled') return { kind: 'scheduled', publishAt: reel.schedule.publishAt };
  if (reel.song?.song) {
    return publish?.status === 'failed' ? { kind: 'publish-failed', text: publish.error ?? 'Publish failed.' } : { kind: 'awaiting' };
  }
  const pick = reel.song?.pick;
  if (pick?.status === 'failed') return { kind: 'song-failed', text: pick.error ?? 'Song pick failed.' };
  if (!music.pickApproved) return { kind: 'song-working', text: 'Song pending: the song-pick question (P-13) is not approved yet.' };
  if (!music.clapReady) return { kind: 'song-working', text: 'Song pending: waiting on the CLAP endpoint.' };
  if (pick) return { kind: 'song-working', text: 'Picking a song…' };
  return { kind: 'song-failed', text: 'No song pick queued for this reel.' };
}

const BADGE: Partial<Record<PublishState['kind'], string>> = {
  awaiting: 'Awaiting approval',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  'publish-failed': 'Publish failed',
  'song-failed': 'Song pending',
  'song-working': 'Song pending',
};

/** Why Approve cannot run yet, or null when it can. */
function approveBlocker(music: MusicStatus): string | null {
  if (!music.metaReady) return 'Waiting on Meta credentials.';
  return null;
}

function badgeLabel(state: PublishState, windowsOpen: number): string | null {
  if (state.kind === 'scheduled') return `Scheduled · ${formatSlotTime(state.publishAt)}`;
  if (state.kind === 'awaiting' && windowsOpen === 0) return 'Carries tomorrow';
  return BADGE[state.kind] ?? null;
}

function isPostingReel(reel: Reel): boolean {
  return reel.score.selected;
}

/* ------------------------------------------------------------------- hub */

export function ReelsHub({ initial, reviewPath = '' }: { initial: ReelsOverview; reviewPath?: string }) {
  const [data, setData] = useState<ReelsOverview>(initial);
  const [dayId, setDayId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

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
    ) ||
    [data.songs, ...data.archive.map((day) => day.songs)].some((songs) =>
      Object.values(songs).some(
        (song) =>
          (song.pick?.status === 'running' || (song.pick?.status === 'requested' && data.music.pickApproved && data.music.clapReady)) ||
          (song.publish != null && !['published', 'failed'].includes(song.publish.status)),
      ),
    ) ||
    Object.values(data.schedules).some((item) => {
      if (item.status === 'publishing') return true;
      if (item.status !== 'scheduled') return false;
      const at = new Date(item.publishAt).getTime();
      return Number.isFinite(at) && at - Date.now() < 60_000;
    });

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
      setConfirmLive(false);
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

  async function publishReel(videoJobId: string, mode: 'schedule' | 'force') {
    try {
      const result = await requestJson<{ queued: boolean; note?: string }>('/api/reels/publish', {
        method: 'POST',
        body: JSON.stringify({ video_job_id: videoJobId, mode }),
      });
      setMessage(
        result.note ?? (mode === 'force' ? 'Posting to Instagram now as a trial reel.' : 'Scheduled as a trial reel.'),
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function retrySong(videoJobId: string) {
    try {
      const result = await requestJson<{ queued: boolean; note?: string }>('/api/reels/songs/pick', {
        method: 'POST',
        body: JSON.stringify({ video_job_id: videoJobId }),
      });
      setMessage(result.queued ? 'Song pick queued.' : result.note ?? 'Not queued.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setReviewOpen(value: boolean) {
    try {
      await requestJson('/api/reels/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ review_open: value }),
      });
      setMessage(
        value
          ? 'The review link is showing reels.'
          : 'The review link is paused. Visitors see that a new batch is coming.',
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setLive(value: boolean) {
    try {
      const result = await requestJson<{ publishingLive: boolean; scheduled?: number }>('/api/reels/settings', {
        method: 'POST',
        body: JSON.stringify({ publishing_live: value }),
      });
      const placed = result.scheduled ?? 0;
      setMessage(
        value
          ? placed > 0
            ? `Live is on. ${placed} of today's reels are on the clock.`
            : "Live is on. Tonight's selected reels will be scheduled into the day's slots."
          : 'Live is off. Reels already on the clock still post.',
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const health = healthOf(data);
  const reels = view ? view.slate.scores.map((score) => reelFor(view, score)) : [];
  const ranked = [...reels].sort((a, b) => (a.score.rank ?? 999) - (b.score.rank ?? 999));
  const top = ranked.filter((reel) => reel.score.selected);
  const rest = view?.isCurrent ? ranked.filter((reel) => !reel.score.selected) : [];
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
            <div className="rh-review-controls">
              <label
                className="rh-switch"
                title="On: the review link plays the reels. Off: the link says a new review batch is coming soon."
              >
                <input
                  type="checkbox"
                  checked={data.reviewOpen}
                  onChange={(event) => void setReviewOpen(event.target.checked)}
                />
                <span className="rh-switch__track" aria-hidden="true" />
                Show reels
              </label>
              {reviewPath ? (
                <button
                  type="button"
                  className="rh-btn"
                  title="Copy the private review link. No login."
                  onClick={() => {
                    const url = `${window.location.origin}${reviewPath}`;
                    void navigator.clipboard.writeText(url).then(
                      () => {
                        setCopiedLink(true);
                        window.setTimeout(() => setCopiedLink(false), 1600);
                      },
                      (error: unknown) => setMessage(error instanceof Error ? error.message : String(error)),
                    );
                  }}
                >
                  {copiedLink ? <Check size={15} /> : <CopyIcon size={15} />}
                  {copiedLink ? 'Copied' : 'Review link'}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={`rh-live${data.music.publishingLive ? ' is-on' : ''}`}
              aria-pressed={data.music.publishingLive}
              title="When Live is on, each night's selected reels are scheduled into the day's posting slots and posted as trial reels."
              onClick={() => {
                if (data.music.publishingLive) void setLive(false);
                else setConfirmLive(true);
              }}
            >
              <span className="rh-live__lamp" aria-hidden="true" />
              Live
            </button>
            <Link href="/reels/health" className="rh-health-link" title={health.label} aria-label={health.label}>
              <span className={`rh-dot rh-dot--${health.tone}`} aria-hidden="true" />
            </Link>
          </div>
        </header>

        {views.length === 0 || !view ? (
          <p className="rh-empty">No scored days yet. The next run ranks the timely post ideas and picks the day&apos;s reels.</p>
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
                        {item.slate.nyDate === today ? 'Today' : item.isCurrent ? 'Latest' : 'Selected'}
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
              <div>
                <h2>{formatNyDate(view.slate.nyDate, 'long')}</h2>
                <p>
                  Scored {formatTime(view.slate.scoredAt)}
                  {view.isCurrent ? ` · ${view.slate.scores.length} ideas in the pool` : ''}
                </p>
              </div>
            </section>

            {top.length === 0 ? (
              <p className="rh-empty">Nothing cleared the bar this day, so no reels were selected.</p>
            ) : (
              <div className="rh-top">
                {top.map((reel) => (
                  <ReelCard
                    key={reel.score.postIdeaId}
                    reel={reel}
                    badge={isPostingReel(reel) || publishState(reel, data.music).kind === 'published' ? badgeLabel(publishState(reel, data.music), data.windowsOpen) : null}
                    onOpen={() => setOpenId(reel.score.postIdeaId)}
                    onGenerate={() => void generate(reel.score.postIdeaId, view.slate.id)}
                  />
                ))}
              </div>
            )}

            {top.length > 0 && (
              <p className="rh-muted rh-posting-note">
                These reels can post today, one per window still open. A reel that misses today's windows carries to tomorrow. It is not scheduled late.
              </p>
            )}

            {rest.length > 0 && (
              <section className="rh-rest">
                <h3 className="rh-rest__title">
                  The bench <span>{rest.length}</span>
                </h3>
                <p className="rh-muted">
                  Depth and rotation. These do not go out, and they do not get a slot.
                </p>
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
          <ReelDetail
            reel={open}
            music={data.music}
            onGenerate={() => void generate(open.score.postIdeaId, view.slate.id)}
            onSchedule={(videoJobId) => void publishReel(videoJobId, 'schedule')}
            onForce={(videoJobId) => void publishReel(videoJobId, 'force')}
            onRetrySong={(videoJobId) => void retrySong(videoJobId)}
            windowsOpen={data.windowsOpen}
          />
        </Drawer>
      )}

      {confirmLive && (
        <div className="rh-confirm" role="presentation" onClick={() => setConfirmLive(false)}>
          <div
            className="rh-confirm__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rh-live-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="rh-live-title">Go live?</h2>
            <p>
              Today&apos;s selected reels will be scheduled into the windows still open and posted to Instagram. The bench stays off the clock.
            </p>
            <div className="rh-confirm__actions">
              <button type="button" className="rh-btn" onClick={() => setConfirmLive(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rh-btn rh-btn--primary"
                onClick={() => {
                  setConfirmLive(false);
                  void setLive(true);
                }}
              >
                Go live
              </button>
            </div>
          </div>
        </div>
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
  if (!latest) return { tone: 'idle', label: 'No runs yet' };
  if (latest.status === 'failed') return { tone: 'bad', label: 'Last run failed' };
  if (latest.status === 'partial' || latest.source_results.some((result) => result.status === 'failed')) {
    return { tone: 'warn', label: 'Last run had source errors' };
  }
  if (latest.status === 'running' || latest.status === 'requested') return { tone: 'idle', label: 'Run in progress' };
  return { tone: 'ok', label: 'All systems healthy' };
}

/* ----------------------------------------------------------------- media */

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

function ReelCard({
  reel,
  badge,
  onOpen,
  onGenerate,
}: {
  reel: Reel;
  badge: string | null;
  onOpen: () => void;
  onGenerate: () => void;
}) {
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
          <ReelVideo src={`/api/reels/video/${reel.video.id}`} poster={reel.poster} playing={hover} />
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
        {badge && <span className={`rh-reel__badge${badge === 'Published' ? ' is-done' : ''}`}>{badge}</span>}
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

function ApproveBlock({
  state,
  music,
  videoJobId,
  canGenerate,
  canSchedule,
  scheduleNote,
  onSchedule,
  onForce,
  onGenerate,
  onRetrySong,
}: {
  state: PublishState;
  music: MusicStatus;
  videoJobId: string;
  canGenerate: boolean;
  canSchedule: boolean;
  scheduleNote: string | null;
  onSchedule: (videoJobId: string) => void;
  onForce: (videoJobId: string) => void;
  onGenerate: () => void;
  onRetrySong: (videoJobId: string) => void;
}) {
  const [busy, setBusy] = useState<'schedule' | 'force' | 'regenerate' | 'song' | null>(null);
  const blocker = approveBlocker(music);
  const act = (which: 'schedule' | 'force' | 'regenerate' | 'song', run: () => void) => {
    setBusy(which);
    run();
    setTimeout(() => setBusy(null), 1500);
  };
  switch (state.kind) {
    case 'published':
      return (
        <div className="rh-approve rh-approve--done">
          <Check size={15} /> Published as a trial reel
          {state.permalink && (
            <a href={state.permalink} target="_blank" rel="noreferrer" className="rh-approve__link">
              Open on Instagram <ExternalLink size={12} />
            </a>
          )}
        </div>
      );
    case 'publishing':
      return (
        <div className="rh-approve">
          <Loader2 size={15} className="rh-spin" /> Publishing to Instagram…
        </div>
      );
    case 'song-working':
      return (
        <div className="rh-approve">
          <Music2 size={15} /> {state.text}
        </div>
      );
    case 'song-failed':
      return (
        <div className="rh-approve rh-approve--bad">
          <span>
            <AlertTriangle size={14} /> {state.text}
          </span>
          <button type="button" className="rh-btn rh-btn--xs" disabled={busy !== null} onClick={() => act('song', () => onRetrySong(videoJobId))}>
            <RotateCcw size={12} /> Retry song
          </button>
        </div>
      );
    case 'scheduled':
      return (
        <div className="rh-approve-wrap">
          <div className="rh-approve">
            <Check size={15} /> Scheduled for {formatSlotTime(state.publishAt)} as a trial reel
          </div>
          <div className="rh-approve-actions">
            <button
              type="button"
              className="rh-btn rh-btn--primary"
              disabled={busy !== null || blocker !== null}
              onClick={() => act('force', () => onForce(videoJobId))}
            >
              {busy === 'force' ? <Loader2 size={15} className="rh-spin" /> : <Play size={15} />} Force post
            </button>
          </div>
          {blocker && <p className="rh-muted rh-song-note">{blocker}</p>}
          {!music.mix && <p className="rh-muted rh-song-note">Song and SFX volumes are not chosen yet, so this posts at full volume.</p>}
        </div>
      );
    case 'awaiting':
    case 'publish-failed':
      return (
        <div className="rh-approve-wrap">
          {state.kind === 'publish-failed' && (
            <p className="rh-note rh-note--bad">
              <AlertTriangle size={13} /> {state.text}
            </p>
          )}
          <div className="rh-approve-actions">
            <button
              type="button"
              className="rh-btn"
              disabled={busy !== null || !canGenerate}
              title={canGenerate ? 'Make this reel again from the copy onward.' : 'No archetype and category cleared the bar, so there is nothing to write from.'}
              onClick={() => act('regenerate', onGenerate)}
            >
              {busy === 'regenerate' ? <Loader2 size={15} className="rh-spin" /> : <RotateCcw size={15} />} Regenerate
            </button>
            <button
              type="button"
              className="rh-btn"
              disabled={busy !== null || blocker !== null}
              onClick={() => act('force', () => onForce(videoJobId))}
            >
              {busy === 'force' ? <Loader2 size={15} className="rh-spin" /> : <Play size={15} />} Force post
            </button>
            {canSchedule && (
              <button
                type="button"
                className="rh-btn rh-btn--primary"
                disabled={busy !== null || blocker !== null}
                onClick={() => act('schedule', () => onSchedule(videoJobId))}
              >
                {busy === 'schedule' ? <Loader2 size={15} className="rh-spin" /> : <Check size={15} />} Schedule
              </button>
            )}
          </div>
          {scheduleNote && <p className="rh-muted rh-song-note">{scheduleNote}</p>}
          {blocker && <p className="rh-muted rh-song-note">{blocker}</p>}
          {!music.mix && <p className="rh-muted rh-song-note">Song and SFX volumes are not chosen yet, so this posts at full volume.</p>}
        </div>
      );
    default:
      return null;
  }
}

export function ReelDetail({
  reel,
  music,
  onGenerate,
  onSchedule,
  onForce,
  onRetrySong,
  windowsOpen,
}: {
  reel: Reel;
  music: MusicStatus;
  onGenerate: () => void;
  onSchedule: (videoJobId: string) => void;
  onForce: (videoJobId: string) => void;
  onRetrySong: (videoJobId: string) => void;
  windowsOpen: number;
}) {
  const [songOpen, setSongOpen] = useState(false);
  const song = reel.song?.song ?? null;
  const state = publishState(reel, music);
  const previewUrl = song?.previewUrl ?? null;
  const songVolume = music.mix ? music.mix.audioVolume / 100 : 1;
  const videoVolume = music.mix ? music.mix.videoVolume / 100 : 1;
  const track = useMemo(
    () => (previewUrl ? { src: previewUrl, songVolume, videoVolume } : null),
    [previewUrl, songVolume, videoVolume],
  );
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
          <ReelVideo
            key={track?.src ?? 'silent'}
            src={`/api/reels/video/${reel.video.id}`}
            poster={reel.poster}
            playing
            controls
            sound
            track={track}
          />
        ) : reel.still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rh-media__fill" src={reel.still} alt="Reel still" />
        ) : (
          <div className="rh-detail__blank">{reel.phase === 'working' ? `${reel.stage}…` : 'No reel yet'}</div>
        )}
      </div>

      {song && (
        <button type="button" className="rh-song-strip" onClick={() => setSongOpen((value) => !value)} aria-expanded={songOpen}>
          {song.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.coverUrl} alt="" className="rh-song-strip__cover" />
          ) : (
            <span className="rh-song-strip__cover rh-song-strip__cover--blank">
              <Music2 size={14} />
            </span>
          )}
          <span className="rh-song-strip__text">
            <span className="rh-song-strip__title">{song.title ?? 'Untitled sound'}</span>
            <span className="rh-song-strip__artist">{song.artist ?? 'Unknown artist'}</span>
          </span>
          <ChevronRight size={15} className={`rh-song-strip__chev${songOpen ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
      )}
      {song && (
        <p className="rh-muted rh-song-note">
          {previewUrl
            ? 'The preview plays the song from 0:00. Instagram may start it at a different point.'
            : 'This song has left the pool, so its preview is gone. Schedule and Force post still attach it by audio_id.'}
          {!music.mix && previewUrl ? ' Volumes are not set yet, so both play at full.' : ''}
        </p>
      )}

      {reel.phase === 'ready' && reel.video ? (
        <ApproveBlock
          state={state}
          music={music}
          videoJobId={reel.video.id}
          canGenerate={reel.canGenerate}
          canSchedule={isPostingReel(reel) && windowsOpen > 0}
          scheduleNote={
            !isPostingReel(reel)
              ? 'The bench does not get a slot. Force post is the only way to send this one now.'
              : windowsOpen === 0
                ? 'Today’s windows are closed. This reel carries to tomorrow at its score. It is not scheduled late.'
                : null
          }
          onSchedule={onSchedule}
          onForce={onForce}
          onGenerate={onGenerate}
          onRetrySong={onRetrySong}
        />
      ) : (
        <GenerateButton reel={reel} onGenerate={onGenerate} block />
      )}

      <div className="rh-detail__sections">
        {song && (
          <Section key={songOpen ? 'song-open' : 'song-closed'} title="Song" open={songOpen}>
            <dl className="rh-parts">
              <div>
                <dt>Genre</dt>
                <dd className="rh-parts__text">{song.genre ?? '—'}</dd>
              </div>
              <div>
                <dt>BPM</dt>
                <dd>{song.bpm ?? '—'}</dd>
              </div>
              <div>
                <dt>Jev confidence</dt>
                <dd>{song.confidence == null ? '—' : score2(song.confidence)}</dd>
              </div>
            </dl>
            <p className="rh-song-tags">
              <span className="rh-muted">Instruments</span> {song.instruments.join(', ') || '—'}
            </p>
            <p className="rh-song-tags">
              <span className="rh-muted">Vibes</span> {song.vibes.join(', ') || '—'}
            </p>
            {song.shortlist.length > 0 && (
              <>
                <p className="rh-card__sub">Shortlist, most similar first</p>
                <ol className="rh-shortlist">
                  {song.shortlist.map((candidate) => (
                    <li key={candidate.audioId} className={candidate.audioId === song.audioId ? 'is-picked' : undefined}>
                      <span className="rh-shortlist__name">
                        <span className="rh-shortlist__title">
                          {candidate.audioId === song.audioId && <Check size={12} />}
                          {candidate.title ?? candidate.audioId}
                        </span>
                        <small>
                          {candidate.genre}
                          {candidate.bpm ? ` · ${candidate.bpm} BPM` : ''} · {candidate.vibes.slice(0, 3).join(', ')}
                        </small>
                      </span>
                      <span className="rh-shortlist__num" title="Tag-text similarity">{score2(candidate.similarity)}</span>
                      <span className="rh-shortlist__num" title="Jev probability">
                        {candidate.probability == null ? '—' : `${Math.round(candidate.probability * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {song.audioRanking.length > 0 && (
              <>
                <p className="rh-card__sub">Evidence: ranked by audio instead</p>
                <ol className="rh-shortlist rh-shortlist--quiet">
                  {song.audioRanking.map((item) => (
                    <li key={item.audioId}>
                      <span className="rh-shortlist__name">{item.title ?? item.audioId}</span>
                      <span className="rh-shortlist__num">{score2(item.similarity)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Section>
        )}

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

