'use client';

import { useState } from 'react';

import { HubLink, useHubNav, useHubParams } from '@/components/social-hub/nav/HubNav';
import type { CostParams } from '@/lib/social-hub/cost-page/params';
import { VERTICALS } from '@/lib/social-hub/verticals';

const RANGES: Array<{ id: CostParams['range']; label: string; changes: Record<string, string | null> }> = [
  { id: '7d', label: '7 days', changes: { range: '7d', from: null, to: null } },
  { id: '30d', label: '30 days', changes: { range: '30d', from: null, to: null } },
  { id: 'month', label: 'This month', changes: { range: null, from: null, to: null } },
];

/** One quiet row of choice pills: type, range (with Custom dates) and mode. Every change goes through the router. */
export function RangeControls({ params }: { params: CostParams }) {
  const { hrefWith } = useHubParams();
  const { go } = useHubNav();
  const [custom, setCustom] = useState(params.range === 'custom');
  const [from, setFrom] = useState(params.from);
  const [to, setTo] = useState(params.to);
  const valid = Boolean(from && to && from <= to);
  const current = (on: boolean) => (on ? ('page' as const) : undefined);

  return (
    <div className="sh-cost-ctrls">
      <nav className="sh-ops-seg" aria-label="Content type">
        <HubLink href={hrefWith({ type: null })} history="replace" aria-current={current(params.vertical === null)}>All types</HubLink>
        {VERTICALS.map((v) => (
          <HubLink key={v.id} href={hrefWith({ type: v.id })} history="replace" aria-current={current(params.vertical === v.id)}>{v.label}</HubLink>
        ))}
      </nav>
      <div className="sh-cost-ctrls__right">
        <nav className="sh-ops-seg" aria-label="Range">
          {RANGES.map((r) => (
            <HubLink key={r.id} href={hrefWith(r.changes)} history="replace" aria-current={current(params.range === r.id)} onClick={() => setCustom(false)}>{r.label}</HubLink>
          ))}
          <button type="button" aria-expanded={custom} aria-pressed={params.range === 'custom' || custom} onClick={() => setCustom((c) => !c)}>Custom</button>
        </nav>
        <nav className="sh-ops-seg" aria-label="Mode">
          <HubLink href={hrefWith({ mode: null })} history="replace" aria-current={current(params.mode === 'production')}>Production</HubLink>
          <HubLink href={hrefWith({ mode: 'development' })} history="replace" aria-current={current(params.mode === 'development')}>Development</HubLink>
        </nav>
      </div>
      {custom && (
        <div className="sh-cost-custom" role="group" aria-label="Custom range">
          <label>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="button" className="sh-cost-apply" disabled={!valid} onClick={() => go(hrefWith({ range: 'custom', from, to }), { history: 'push' })}>Apply</button>
          {!valid && <span className="sh-ops-meta">Pick a start on or before the end.</span>}
        </div>
      )}
    </div>
  );
}
