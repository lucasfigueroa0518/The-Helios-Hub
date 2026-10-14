'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { readinessCard, type Readiness, type ReadinessCard } from '@/lib/social-hub/health/readiness';
import { verticalInfo } from '@/lib/social-hub/verticals';

const TIP_WIDTH = 260;

/** Auto-publish readiness: one ring per type, with a hover card (also on keyboard focus) that explains the number. */
export function ReadinessRings({ readiness }: { readiness: Readiness[] }) {
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ card: ReadinessCard; el: HTMLElement; on: boolean } | null>(null);
  const hide = useCallback(() => setActive((a) => (a && a.on ? { ...a, on: false } : a)), []);

  // Above the ring, centered, clamped to the viewport; below when there's no room above.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !active?.on) return;
    const r = active.el.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left + r.width / 2 - TIP_WIDTH / 2, window.innerWidth - TIP_WIDTH - 8));
    const above = r.top - tip.offsetHeight - 10;
    tip.style.left = `${x}px`;
    tip.style.top = `${above < 8 ? r.bottom + 10 : above}px`;
  }, [active]);

  const on = Boolean(active?.on);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [on, hide]);

  const rings = readiness.filter((r) => r.rate !== null);
  if (!rings.length) return null;
  const card = active?.card;

  return (
    <section className="sh-ops-ready" aria-label="Auto-publish readiness">
      {rings.map((r) => {
        const c = readinessCard(r);
        const show = (e: { currentTarget: HTMLElement }) => setActive({ card: c, el: e.currentTarget, on: true });
        return (
          <figure
            key={r.vertical}
            className="sh-ops-ring"
            style={{ ['--pct' as string]: String(r.rate) }}
            tabIndex={0}
            aria-describedby={on && active?.card.title === c.title ? tipId : undefined}
            onMouseEnter={show}
            onFocus={show}
            onMouseLeave={hide}
            onBlur={hide}
          >
            <svg viewBox="0 0 60 60" aria-hidden><circle className="bg" cx="30" cy="30" r="24" /><circle className="fg" cx="30" cy="30" r="24" /></svg>
            <figcaption><b>{c.rate}</b> approved as-is · {verticalInfo(r.vertical).label}</figcaption>
          </figure>
        );
      })}

      <div ref={tipRef} id={tipId} role="tooltip" className={`sh-ops-tip sh-ops-tip--ready${on ? ' is-on' : ''}`} aria-hidden={!on}>
        {card ? (
          <>
            <div className="sh-ops-tip__hd"><span>{card.title}</span><span>{card.rate}</span></div>
            {card.lines.map(([label, value]) => (
              <div key={label} className="sh-ops-tip__kv"><span>{label}</span><span>{value}</span></div>
            ))}
            <div className={`sh-ops-tip__why${card.meets ? ' is-good' : ''}`}>{card.note}</div>
            <div className="sh-ops-tip__ft">Share of this type&rsquo;s drafts you approved without changes.</div>
          </>
        ) : null}
      </div>
    </section>
  );
}
