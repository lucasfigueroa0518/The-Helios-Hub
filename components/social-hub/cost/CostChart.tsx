'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { money, shortDay } from '@/components/social-hub/cost/format';
import { hoverCompare, spikeDrivers, type By, type Compare, type Series } from '@/lib/social-hub/cost-page/model';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';

const W = 760;
const H = 230;
const PAD_L = 40;
const PAD_B = 26;
const PAD_T = 14;
const TIP_W = 270;
const BYS: Array<{ id: By; label: string }> = [
  { id: 'type', label: 'By type' },
  { id: 'vendor', label: 'By vendor' },
  { id: 'stage', label: 'By stage' },
];

/** A round axis step that gives at most four gridlines. */
function niceStep(maxUsd: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (maxUsd / s <= 4) return s;
  return Math.ceil(maxUsd / 4);
}

function Marker({ c }: { c: Compare }) {
  if (c.change === 'same') return <span className="is-same">≈</span>;
  if (c.change === 'new') return <span className="is-new">new</span>;
  return c.change === 'up' ? <span className="is-up">▲{c.pct}%</span> : <span className="is-down">▼{c.pct}%</span>;
}

type Hover = { i: number; j: number | null; x: number; y: number; on: boolean };

/**
 * The page's one chart: stacked daily bars by type, vendor or stage.
 * `series.days` starts with `lead` look-back days; bars render from `lead`, and the hover
 * compares each series with its own previous 7 days. Click a bar for what drove it.
 */
export function CostChart({ series, rows, base }: { series: Record<By, Series>; rows: CostRow[]; base: string }) {
  const [by, setBy] = useState<By>('type');
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const s = series[by];
  const idx = useMemo(() => s.days.map((_, i) => i).slice(s.lead), [s]);
  const totals = useMemo(() => s.values.map((d) => d.reduce((a, b) => a + b, 0)), [s]);

  const maxUsd = Math.max(1, ...idx.map((i) => totals[i]! / 1e6));
  const step = niceStep(maxUsd);
  const top = Math.ceil(maxUsd / step) * step;
  const plotH = H - PAD_B - PAD_T;
  const y = (usd: number) => H - PAD_B - (usd / top) * plotH;
  const slot = (W - PAD_L) / Math.max(1, idx.length);
  const bw = Math.min(36, slot * 0.68);
  const labelEvery = idx.length > 16 ? Math.ceil(idx.length / 12) : 1;

  const hide = useCallback(() => setHover((h) => (h && h.on ? { ...h, on: false } : h)), []);
  const on = Boolean(hover?.on);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [on, hide]);

  // Beside the pointer, flipped left near the right edge, clamped to the viewport.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !hover?.on) return;
    const x = hover.x + 16 + TIP_W > window.innerWidth - 8 ? hover.x - 16 - TIP_W : hover.x + 16;
    const yy = Math.min(Math.max(8, hover.y - tip.offsetHeight / 2), window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${yy}px`;
  }, [hover]);

  const onMove = (i: number) => (e: MouseEvent<SVGGElement>) => {
    const j = (e.target as Element).getAttribute('data-j');
    setHover({ i, j: j === null ? null : Number(j), x: e.clientX, y: e.clientY, on: true });
  };
  const onFocus = (i: number) => (e: { currentTarget: SVGGElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ i, j: null, x: r.right, y: r.top + r.height / 2, on: true });
  };
  const toggle = (i: number) => setSel((cur) => (cur === i ? null : i));
  const onKey = (i: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(i);
    }
  };

  const h = hover ? hoverCompare(s, hover.i) : null;
  const prev = hover ? totals.slice(Math.max(0, hover.i - 7), hover.i) : [];
  const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
  const drivers = sel !== null ? spikeDrivers(rows, s.days[sel]!, s.days) : [];
  const driverMax = Math.max(1, ...drivers.map((d) => d.micros));
  const selPrev = sel !== null ? totals.slice(Math.max(0, sel - 7), sel) : [];
  const selAvg = selPrev.length ? selPrev.reduce((a, b) => a + b, 0) / selPrev.length : 0;

  return (
    <section aria-labelledby="h-chart" className="sh-cost-chartsec">
      <div className="sh-ops-sechead">
        <h2 id="h-chart" className="sh-cost-sr">Daily spend</h2>
        <div className="sh-ops-seg is-strong" role="group" aria-label="Split the bars">
          {BYS.map((b) => (
            <button key={b.id} type="button" aria-pressed={by === b.id} onClick={() => { setBy(b.id); hide(); }}>{b.label}</button>
          ))}
        </div>
        <span className="sh-ops-meta">Click a bar to see what drove it</span>
      </div>
      <div className="sh-cost-panel">
        <svg key={by} className="sh-cost-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`Daily spend, ${BYS.find((b) => b.id === by)!.label.toLowerCase()}`} onMouseLeave={hide}>
          {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((v) => (
            <g key={v} aria-hidden>
              <line x1={PAD_L} x2={W} y1={y(v)} y2={y(v)} className="sh-cost-grid" />
              <text x={0} y={y(v) + 4} className="sh-cost-axis">${v}</text>
            </g>
          ))}
          {idx.map((i, n) => {
            const x = PAD_L + n * slot + (slot - bw) / 2;
            let acc = 0;
            const day = s.days[i]!;
            return (
              <g
                key={day}
                tabIndex={0}
                role="button"
                aria-label={`${shortDay(day)}: ${money(totals[i]!, 1)}`}
                aria-pressed={sel === i}
                aria-describedby={on && hover?.i === i ? tipId : undefined}
                className={`sh-cost-day${sel !== null && sel !== i ? ' is-dim' : ''}`}
                onMouseMove={onMove(i)}
                onFocus={onFocus(i)}
                onBlur={hide}
                onClick={() => toggle(i)}
                onKeyDown={onKey(i)}
              >
                <rect x={PAD_L + n * slot} y={0} width={slot} height={H - PAD_B} fill="transparent" />
                {s.keys.map((k, j) => {
                  const usd = s.values[i]![j]! / 1e6;
                  if (usd <= 0) return null;
                  const y1 = y(acc + usd);
                  const hgt = Math.max(0, y(acc) - y1 - 1);
                  acc += usd;
                  return (
                    <rect
                      key={k.id}
                      data-j={j}
                      x={x}
                      y={y1}
                      width={bw}
                      height={hgt}
                      rx={3}
                      fill={k.color}
                      className={`sh-cost-bar${hover?.on && hover.i === i && hover.j === j ? ' is-hot' : ''}`}
                      style={{ animationDelay: `${n * 40 + j * 30}ms` }}
                    />
                  );
                })}
                {n % labelEvery === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="sh-cost-axis" aria-hidden>{Number(day.slice(8))}</text>}
              </g>
            );
          })}
        </svg>
        <ul className="sh-cost-legend" aria-label="Legend">
          {s.keys.filter((_, j) => idx.some((i) => s.values[i]![j]! > 0)).map((k) => <li key={k.id}><i style={{ background: k.color }} aria-hidden />{k.label}</li>)}
        </ul>
      </div>

      {sel !== null && (
        <div className="sh-cost-spike" aria-live="polite">
          <div className="sh-cost-spike__hd">
            <b>{shortDay(s.days[sel]!)} · {money(totals[sel]!, 1)}</b>
            {selAvg > 0 && <span className="sh-ops-meta">{Math.abs(totals[sel]! - selAvg) / selAvg <= 0.08 ? 'about normal' : `${(totals[sel]! / selAvg).toFixed(1)}× a normal day`}</span>}
          </div>
          {drivers.length === 0 ? (
            <p className="sh-ops-none">Nothing spent this day.</p>
          ) : drivers.map((d) => {
            const hot = d.ratio !== null && d.ratio >= 2;
            return (
              <div key={d.label} className={`sh-cost-driver${hot ? ' is-hot' : ''}`}>
                <span>{d.label}{hot && <span className="sh-cost-driver__why"> · {d.ratio}× its usual</span>}</span>
                <span className="sh-cost-driver__track"><i style={{ transform: `scaleX(${d.micros / driverMax})` }} /></span>
                <span className="sh-ops-num">{money(d.micros, 1)}</span>
              </div>
            );
          })}
          <div className="sh-cost-spike__ft"><Link className="sh-ops-link" href={`${base}/health/night/${s.days[sel]}`}>Open the night</Link></div>
        </div>
      )}

      <div ref={tipRef} id={tipId} role="tooltip" className={`sh-ops-tip sh-cost-tip${on ? ' is-on' : ''}`} aria-hidden={!on}>
        {hover && h ? (
          <>
            <div className="sh-ops-tip__hd"><span>{shortDay(s.days[hover.i]!)}</span><span className="sh-ops-num">{money(h.total.micros, 1)}</span></div>
            {h.parts.map((p, j) => (p.micros === 0 && p.change === 'same' ? null : (
              <div key={s.keys[j]!.id} className={`sh-cost-tip__r${hover.j === j ? ' is-hot' : ''}`}>
                <i style={{ background: s.keys[j]!.color }} aria-hidden />
                <span>{p.label}</span>
                <span className="sh-ops-num">{money(p.micros, 1)}</span>
                <span className="sh-cost-tip__d"><Marker c={p} /></span>
              </div>
            )))}
            <div className="sh-ops-tip__why">vs the 7 days before: {money(Math.round(prevAvg), 1)} avg · <span className="sh-cost-tip__d"><Marker c={h.total} /></span></div>
            <div className="sh-ops-tip__ft">Click the bar for what drove it</div>
          </>
        ) : null}
      </div>
    </section>
  );
}
