'use client';

import { CalendarRange } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useHubParams } from '@/components/social-hub/nav/HubNav';
import { Menu } from '@/components/social-hub/ui/Menu';
import { shortDate } from '@/lib/social-hub/views/format';

const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All' },
];

/**
 * One quiet row above the answer (DESIGN.md: never a filter form first):
 * range pills, a custom range in a popover, the metric that ranks things.
 * Every change keeps the scroll position and starts the table at page 1.
 */
export function Toolbar({ range, from, to, metric, metrics, extra }: {
  range: string;
  from: string | null;
  to: string;
  metric: string;
  metrics: Array<{ value: string; label: string }>;
  extra?: React.ReactNode;
}) {
  const { set } = useHubParams();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from ?? '');
  const [t, setT] = useState(to);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t) && f <= t;

  return (
    <div className="sh-toolbar sh-toolbar--sticky">
      <div className="sh-toolbar__group">
        <div className="sh-pills" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className="sh-pill" aria-pressed={range === r.id} onClick={() => set({ range: r.id === '30d' ? null : r.id, from: null, to: null, page: null })}>
              {r.label}
            </button>
          ))}
          <div className="sh-menu" ref={root}>
            <button type="button" className="sh-pill" aria-pressed={range === 'custom'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
              <CalendarRange size={13} aria-hidden="true" />
              {range === 'custom' && from ? `${shortDate(from)} – ${shortDate(to)}` : 'Custom'}
            </button>
            {open ? (
              <div className="sh-menu__list sh-menu__list--left sh-popover" role="dialog" aria-label="Custom range">
                <label className="sh-field">
                  <span>From</span>
                  <input type="date" value={f} max={t} onChange={(e) => setF(e.target.value)} />
                </label>
                <label className="sh-field">
                  <span>To</span>
                  <input type="date" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="sh-btn sh-btn--primary"
                  disabled={!valid}
                  onClick={() => {
                    setOpen(false);
                    set({ range: 'custom', from: f, to: t, page: null });
                  }}
                >
                  Show this range
                </button>
                {!valid && f ? <p className="sh-subtle">The start has to be on or before the end.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        {extra}
      </div>
      <Menu label="Ranked by" value={metric} options={metrics} onSelect={(value) => set({ metric: value === 'views' ? null : value, sort: null, page: null })} />
    </div>
  );
}
