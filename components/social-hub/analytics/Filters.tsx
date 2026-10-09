'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useHubParams } from '@/components/social-hub/nav/HubNav';

type Option = { factor: { id: string; label: string }; values: Array<{ key: string; label: string; count: number }> };

/** A type's own fields as filters (BRIEFS.md §3): tucked in a popover, shown as removable chips when on. */
export function Filters({ options, active }: { options: Option[]; active: Record<string, string> }) {
  const { set } = useHubParams();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const count = Object.keys(active).length;

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

  if (options.length === 0) return null;
  const labelOf = (factor: string, key: string) => options.find((o) => o.factor.id === factor)?.values.find((v) => v.key === key)?.label ?? key;

  return (
    <div className="sh-filterbar">
      <div className="sh-menu" ref={root}>
        <button type="button" className="sh-pill" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
          <SlidersHorizontal size={13} aria-hidden="true" />
          Filters{count ? ` (${count})` : ''}
        </button>
        {open ? (
          <div className="sh-menu__list sh-menu__list--left sh-popover sh-popover--wide" role="dialog" aria-label="Filters">
            {options.map((o) => (
              <fieldset key={o.factor.id} className="sh-filter">
                <legend>{o.factor.label}</legend>
                <div className="sh-pills">
                  {o.values.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className="sh-pill"
                      aria-pressed={active[o.factor.id] === v.key}
                      onClick={() => set({ [`f.${o.factor.id}`]: active[o.factor.id] === v.key ? null : v.key, page: null })}
                    >
                      {v.label} <span className="sh-muted">{v.count}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        ) : null}
      </div>
      {Object.entries(active).map(([factor, key]) => (
        <button key={factor} type="button" className="sh-pill sh-pill--chip" onClick={() => set({ [`f.${factor}`]: null, page: null })} aria-label={`Remove filter ${labelOf(factor, key)}`}>
          {options.find((o) => o.factor.id === factor)?.factor.label}: {labelOf(factor, key)}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      {count > 1 ? (
        <button type="button" className="sh-btn sh-btn--quiet" onClick={() => set(Object.fromEntries([...Object.keys(active).map((f) => [`f.${f}`, null]), ['page', null]]))}>Clear all</button>
      ) : null}
    </div>
  );
}
