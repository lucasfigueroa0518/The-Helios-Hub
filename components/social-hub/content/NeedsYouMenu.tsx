'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The orange "N need you" in the Content header, as a button. It opens the
 * list of what is waiting on a person (rows come from the server as children,
 * each one a PostLink to its post). A click on a row closes the list.
 */
export function NeedsYouMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

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

  return (
    <span className="sh-menu sh-needs-menu" ref={root}>
      <button type="button" className="sh-needs-count sh-needs-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="sh-menu__list sh-menu__list--left sh-needs-list" role="dialog" aria-label="Waiting on you" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          {children}
        </div>
      ) : null}
    </span>
  );
}
