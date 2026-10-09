'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * The month as an ARIA grid that behaves like one (critique 2026-10-08):
 * one tab stop (today, else the first day), arrow keys move a day or a week,
 * Home and End go to the week's ends. Enter opens the day as before.
 */
export function MonthGrid({ label, children }: { label: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  const cells = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-day]') ?? [])];

  useEffect(() => {
    const all = cells();
    const focused = all.find((c) => c === document.activeElement || c.tabIndex === 0 && c.dataset.kept === 'true');
    const start = focused ?? all.find((c) => c.dataset.today === 'true') ?? all.find((c) => c.dataset.inMonth === 'true') ?? all[0];
    for (const c of all) c.tabIndex = c === start ? 0 : -1;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = cells();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(at % 7), End: 6 - (at % 7) };
    if (!(e.key in step)) return;
    e.preventDefault();
    const next = all[Math.max(0, Math.min(all.length - 1, at + step[e.key]!))];
    if (!next) return;
    for (const c of all) {
      c.tabIndex = c === next ? 0 : -1;
      c.dataset.kept = c === next ? 'true' : 'false';
    }
    next.focus();
  };

  return (
    <div ref={root} className="sh-month" role="grid" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
