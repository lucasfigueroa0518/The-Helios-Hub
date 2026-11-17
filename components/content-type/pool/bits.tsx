'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Circle, CircleAlert, CircleCheck, CircleDashed, Clock, Hand, LoaderCircle, Play, X } from 'lucide-react';

import type { ProgressItem } from '@/lib/content-type/progress';
import type { PoolRowState } from '@/lib/content-type/pool-rules';
import { POOL_STATE_WORDS } from '@/lib/content-type/pool-rules';
import type { RunSnapshot } from '@/lib/content-type/run-status';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';

/** Pieces the pool screen's rows, board and panels share. */

const BADGE_ICON: Record<PoolRowState, typeof Circle> = {
  idea: Circle,
  making: LoaderCircle,
  failed: CircleAlert,
  ready: CircleDashed,
  scheduled: Clock,
  needs_you: Hand,
  posted: CircleCheck,
};

const BADGE_TONE: Partial<Record<PoolRowState, string>> = { failed: ' pl-badge--failed', needs_you: ' pl-badge--you', making: ' pl-badge--making' };

/** A State Badge: icon plus the one word for the state (POOL_STATE_WORDS). Never an error. */
export function Badge({ state }: { state: PoolRowState }) {
  const Icon = BADGE_ICON[state];
  return (
    <span className={`pl-badge${BADGE_TONE[state] ?? ''}`}>
      <Icon className={state === 'making' ? 'pl-spin' : undefined} aria-hidden="true" />
      {POOL_STATE_WORDS[state]}
    </span>
  );
}

/** A post's first picture (or the video's opening frame), else a play mark. */
export function PostThumb({ post, thumb, remote }: { post: HubPost; thumb: string | null; remote?: boolean }) {
  return (
    <span className="pl-thumb" aria-hidden="true">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" loading="lazy" decoding="async" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      ) : post.media.kind === 'video' && post.media.src ? (
        <video src={`${post.media.src}#t=0.5`} muted playsInline preload="metadata" />
      ) : (
        <Play className="pl-i" />
      )}
    </span>
  );
}

const formatScore = (n: number) => n.toFixed(n >= 10 ? 0 : 2);

/** A part's points: signed, since the parts add up to the score. */
function formatPoints(n: number | null): string {
  if (n == null) return '—';
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return n > 0 ? `+${n.toFixed(digits)}` : n < 0 ? `−${Math.abs(n).toFixed(digits)}` : n.toFixed(digits);
}

/** Where an idea's score comes from: the rule, then each part with the answer behind it, then the total. */
export function ScoreSection({ idea }: { idea: HubIdea }) {
  const b = idea.breakdown;
  if (!b && idea.score == null) return null;
  return (
    <>
      <div className="pl-sec">Where the score comes from</div>
      <p className="pl-why__formula">{b?.formula ?? 'This pipeline stored a score without its parts.'}</p>
      <table className="pl-why">
        <tbody>
          {b?.parts.map((part, i) => (
            <tr key={`${i}:${part.label}`} className={part.points == null ? 'is-note' : part.points < 0 ? 'is-minus' : undefined}>
              <td>{part.label}{part.detail ? <small>{part.detail}</small> : null}</td>
              <td>{formatPoints(part.points)}</td>
            </tr>
          ))}
          <tr>
            <td><b>{idea.scoreLabel || 'Total'}</b></td>
            <td><b>{idea.score == null ? '—' : formatScore(idea.score)}</b></td>
          </tr>
        </tbody>
      </table>
      {b?.note ? <p className="pl-why__note" style={{ marginTop: 8 }}>{b.note}</p> : null}
    </>
  );
}

/** The side panel: slides in from the right (fades with reduced motion), full screen on a phone; Escape and the backdrop close it. */
export function SidePanel({ title, label, onClose, foot, children }: { title: ReactNode; label: string; onClose: () => void; foot?: ReactNode; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="pl-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="pl-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <header className="pl-drawer__head">
          <h2>{title}</h2>
          <button ref={close} type="button" className="pl-icon-btn" onClick={onClose} aria-label="Close"><X className="pl-i" /></button>
        </header>
        <div className="pl-drawer__body">{children}</div>
        {foot ? <div className="pl-drawer__foot">{foot}</div> : null}
      </aside>
    </>
  );
}

/** Two alternating class names, so a repeated flash on the same element restarts its animation. */
export function flashClass(n: number | undefined): string {
  return n == null ? '' : n % 2 ? ' pl-flash-a' : ' pl-flash-b';
}

/** A clock that ticks once a second while `on`. */
export function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

// ── Runs: the live poll wins over the dataset snapshot (TypeHub's rules, kept) ──

function topicKey(id: string): string {
  const prefix = 'explainers:topic:';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function snapshot(item: ProgressItem): RunSnapshot {
  return { state: item.state, stage: item.stage, error: item.error, requestedAt: item.requestedAt, startedAt: item.startedAt };
}

/** A carousel run is one job for the type, not one idea: the same strip the header shows. */
function typeRun(vertical: HubPost['vertical'], live: readonly ProgressItem[]): RunSnapshot | null {
  if (vertical !== 'carousels') return null;
  const hit = live.find((item) => item.label === 'Carousel run') ?? live[0];
  return hit ? snapshot(hit) : null;
}

/** The idea's own render, from the live poll (matched on its topic) or the dataset; null when none. Rows use only this. */
export function ownRun(idea: HubIdea, live: readonly ProgressItem[]): RunSnapshot | null {
  const topicId = topicKey(idea.id);
  const hit = live.find((item) => item.topicId != null && (item.topicId === topicId || item.topicId === idea.id));
  return hit ? snapshot(hit) : idea.run ?? null;
}

/** For a panel's status line: the idea's own render, else (Carousels) the type's run. */
export function panelRun(idea: HubIdea, live: readonly ProgressItem[]): RunSnapshot | null {
  return ownRun(idea, live) ?? typeRun(idea.vertical, live);
}

export function runForPost(post: HubPost, ideas: readonly HubIdea[], live: readonly ProgressItem[]): RunSnapshot | null {
  const topicId = post.refs.topicId ?? (post.idea ? topicKey(post.idea.id) : null);
  if (topicId) {
    const hit = live.find((item) => item.topicId === topicId);
    if (hit) return snapshot(hit);
    const fromIdea = ideas.find((idea) => topicKey(idea.id) === topicId)?.run;
    if (fromIdea) return fromIdea;
  }
  return typeRun(post.vertical, live);
}
