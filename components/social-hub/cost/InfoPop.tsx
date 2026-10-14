'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** The ⓘ beside a section title (same pattern as Health's Problems): opens on click, closes on Escape or outside click. */
export function InfoPop({ title, children }: { title: string; children: ReactNode }) {
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
      <button ref={button} type="button" aria-label={`About ${title}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>i</button>
      <div id={id} className="sh-ops-pop" role="region" aria-label={title}>
        <strong className="sh-ops-pop__title">{title}</strong>
        {children}
      </div>
    </div>
  );
}
