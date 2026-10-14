'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { HealthBlock, HealthRow } from '@/lib/social-hub/health/view';

/** "Sep 30" for the axis. */
const axisDay = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const TIP_WIDTH = 250;

/** One block per night per type; one shared hover card that also opens on keyboard focus. */
export function NightRows({ rows, base }: { rows: HealthRow[]; base: string }) {
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ key: string; block: HealthBlock; el: HTMLElement; on: boolean } | null>(null);
  // Keep the last card's content while it fades out.
  const hide = useCallback(() => setActive((a) => (a && a.on ? { ...a, on: false } : a)), []);

  // Above the block, centered, clamped to the viewport (as in the approved mockup).
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

  const nights = rows[0]?.blocks.map((b) => b.night) ?? [];
  const card = active?.block.card;


  return (
    <div className="sh-ops-panel sh-ops-rows">
      {rows.map((row, ri) => (
        <div key={row.id} className={`sh-ops-row${row.id === 'publisher' ? ' is-publisher' : ''}`}>
          <div className="sh-ops-row__name">
            {row.colorVar ? <i className="sh-ops-mark" style={{ background: `var(${row.colorVar})` }} aria-hidden /> : null}
            {row.label}
          </div>
          <div className="sh-ops-blocks">
            {row.blocks.map((b, i) => {
              const key = `${row.id}|${b.night}`;
              const show = (e: { currentTarget: HTMLElement }) => setActive({ key, block: b, el: e.currentTarget, on: true });
              return (
                <Link
                  key={b.night}
                  href={`${base}/health/night/${b.night}`}
                  className={`sh-ops-b is-${b.tone}${i === row.blocks.length - 1 ? ' is-last' : ''}`}
                  style={{ animationDelay: `${ri * 60 + i * 28}ms` }}
                  aria-label={`${b.card.title}: ${b.card.status}`}
                  aria-describedby={on && active?.key === key ? tipId : undefined}
                  onMouseEnter={show}
                  onFocus={show}
                  onMouseLeave={hide}
                  onBlur={hide}
                />
              );
            })}
          </div>
          <div className="sh-ops-row__status">
            <b className={`is-${row.status}`}>{row.statusWord}</b>
            {row.sub ? <span className={row.sub.startsWith('🔥') ? 'sh-ops-streak' : undefined}>{row.sub}</span> : null}
          </div>
        </div>
      ))}
      {nights.length > 0 && (
        <div className="sh-ops-axis" aria-hidden>
          <span />
          <span><span>{axisDay(nights[0]!)}</span><span>{axisDay(nights[nights.length - 1]!)}</span></span>
          <span />
        </div>
      )}

      <div ref={tipRef} id={tipId} role="tooltip" className={`sh-ops-tip${on ? ' is-on' : ''}`} aria-hidden={!on}>
        {card && active ? (
          <>
            <div className="sh-ops-tip__hd">
              <span>{card.title}</span>
              <span className={`sh-ops-pill is-${active.block.tone}`}>{card.status}</span>
            </div>
            {card.lines.map(([label, value]) => (
              <div key={label} className="sh-ops-tip__kv"><span>{label}</span><span>{value}</span></div>
            ))}
            {card.why ? <div className={`sh-ops-tip__why${active.block.tone === 'worked' ? ' is-good' : ''}`}>{card.why}</div> : null}
            <div className="sh-ops-tip__ft">Click to open this night</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
