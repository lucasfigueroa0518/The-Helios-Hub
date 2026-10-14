'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { FIXED_AFTER, type Problem } from '@/lib/social-hub/health/problems';
import { addDays } from '@/lib/social-hub/time';

/** "Oct 3" from a night key. */
const shortDay = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/** Writes a ready-made brief to the clipboard. Nothing is sent anywhere (no model call). */
export function CopyBrief({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button type="button" className="sh-ops-link" onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy for Claude'}
    </button>
  );
}

function InfoButton() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return (
    <div ref={wrap} className={`sh-ops-info${open ? ' is-open' : ''}`}>
      <button ref={button} type="button" aria-label="What is this?" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>i</button>
      <div id={id} className="sh-ops-pop" role="region" aria-label="What's in Problems?">
        <strong className="sh-ops-pop__title">What&apos;s in Problems?</strong>
        Each row is one kind of failure. Every time the same thing goes wrong (same type, same stage, same reason), it&apos;s counted on the same row instead of being listed again.
        <dl>
          <dt>Dot</dt><dd>Red broke something last night · yellow healed or heads-up · grey quiet lately</dd>
          <dt>Strip</dt><dd>The last 14 nights; a tick marks each night it happened</dd>
          <dt>Count</dt><dd>Times in the window, and when it first appeared</dd>
          <dt>Back again</dt><dd>It returned after a quiet stretch, so a fix didn&apos;t hold</dd>
          <dt>Healed</dt><dd>The system recovered on its own (e.g. retried)</dd>
          <dt>Fixed</dt><dd>Quiet for 7 nights after a change. It moves to Fixed.</dd>
        </dl>
      </div>
    </div>
  );
}

const DOT: Record<Problem['tone'], string> = { current: 'failed', healed: 'short', warning: 'short', quiet: 'none' };

function FixedCheck() {
  const id = useId();
  return (
    <svg className="sh-ops-ck" viewBox="0 0 22 22" aria-hidden>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="22" height="22">
          <rect className="sh-ops-ck__wipe" x="0" y="0" width="22" height="22" fill="#fff" />
        </mask>
      </defs>
      <circle cx="11" cy="11" r="11" />
      <path d="M6.5 11.5l3 3 6-6.5" mask={`url(#${id})`} />
    </svg>
  );
}

export function ProblemsList({ problems, fixed, briefs, base, clean, nights }: { problems: Problem[]; fixed: Problem[]; briefs: Record<string, string>; base: string; clean: boolean; nights: string[] }) {
  return (
    <>
      <section aria-labelledby="h-problems">
        <div className="sh-ops-sechead is-start">
          <h2 id="h-problems">Problems</h2>
          <InfoButton />
        </div>
        <p className="sh-ops-sub">What keeps going wrong, newest first.</p>
        <div className="sh-ops-panel">
          {problems.length === 0 ? (
            <p className="sh-ops-none">{clean ? 'Nothing new last night. 🎯' : 'Nothing new last night.'}</p>
          ) : (
            <ul className="sh-ops-issues">
              {problems.map((p) => (
                <li key={p.key} className="sh-ops-iss">
                  <span className={`sh-ops-dot is-${DOT[p.tone]}${p.tone === 'current' ? ' is-pulse' : ''}`} aria-hidden />
                  <div className="sh-ops-iss__text">
                    <div className="sh-ops-iss__title">
                      {p.title}
                      {p.state === 'open' && p.backAgain ? <span className="sh-ops-tag is-failed">Back again</span> : p.tone === 'healed' ? <span className="sh-ops-tag">Healed</span> : null}
                    </div>
                    <div className="sh-ops-meta">
                      {p.latest.rawError ? <><span>{clip(p.latest.rawError, 90)}</span><span aria-hidden> · </span></> : null}
                      <Link className="sh-ops-link" href={`${base}/health/night/${p.lastSeen}`}>See items</Link>
                      <span aria-hidden> · </span>
                      <CopyBrief text={briefs[p.key] ?? ''} />
                    </div>
                  </div>
                  <span className="sh-ops-strip" role="img" aria-label={`Happened on ${p.count} of the last ${nights.length} nights`}>
                    {nights.map((n) => (
                      <i key={n} className={p.nights.includes(n) ? (p.latest.severity === 'failed' ? 'is-failed' : 'is-short') : undefined} />
                    ))}
                  </span>
                  <span className="sh-ops-count"><b>{p.count}×</b>first {shortDay(p.firstSeen)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {fixed.length > 0 && (
        <section aria-labelledby="h-fixed">
          <div className="sh-ops-sechead"><h2 id="h-fixed">Fixed</h2></div>
          <p className="sh-ops-sub">Problems that stopped happening. Proof the fixes worked.</p>
          <ul className="sh-ops-panel sh-ops-fixedlist">
            {fixed.map((p) => (
              <li key={p.key} className="sh-ops-fixed">
                <FixedCheck />
                <div>
                  <div className="sh-ops-iss__title">{p.title}</div>
                  <div className="sh-ops-meta">
                    {p.state === 'almost'
                      ? `Quiet ${p.quietNights} nights · 1 more to confirm`
                      : `Fixed ${shortDay(addDays(p.lastSeen, FIXED_AFTER))} · quiet ${p.quietNights} nights · was ${p.count}×`}
                  </div>
                </div>
                <span className="sh-ops-tag">{p.state === 'almost' ? 'Almost' : 'Fixed'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
