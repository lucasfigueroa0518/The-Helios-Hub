'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';

const OPTIONS = [
  { href: '/reels/analytics', label: 'Cost Analytics', id: 'cost' },
  { href: '/reels/analytics/performance', label: 'Performance Analytics', id: 'performance' },
] as const;

export function AnalyticsTitle({ current }: { current: 'cost' | 'performance' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const selected = OPTIONS.find((option) => option.id === current) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span className="rh-title-menu" ref={rootRef}>
      <h1 className="rh__title">
        <button
          type="button"
          className="rh-title-menu__button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {selected.label}
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </h1>
      {open ? (
        <span className="rh-title-menu__list" role="menu">
          {OPTIONS.map((option) => {
            const active = option.id === current;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                aria-current={active ? 'page' : undefined}
                className={`rh-title-menu__option${active ? ' is-active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (!active) router.push(option.href);
                }}
              >
                <span>{option.label}</span>
                {active ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
