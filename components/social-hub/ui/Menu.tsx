'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { useHubNav } from '@/components/social-hub/nav/HubNav';

export type MenuOption = { value: string; label: string; href?: string };

/**
 * A choice from more than five options (DESIGN.md: no native selects). Opens a
 * popover list; Escape or a click outside closes it; arrow keys move.
 */
export function Menu({ label, value, options, onSelect, align = 'right', icon }: {
  label: string;
  value: string;
  options: MenuOption[];
  onSelect?: (value: string) => void;
  align?: 'left' | 'right';
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const { go } = useHubNav();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('.sh-menu__trigger')?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() ?? list.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const choose = (o: MenuOption) => {
    setOpen(false);
    if (o.href) go(o.href);
    else onSelect?.(o.value);
  };

  return (
    <div className="sh-menu" ref={root}>
      <button
        type="button"
        className="sh-btn sh-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="sh-menu__label">{label}</span>
        <span className="sh-sr">: </span>
        <span>{current?.label ?? value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul
          id={id}
          ref={list}
          role="menu"
          className={`sh-menu__list${align === 'left' ? ' sh-menu__list--left' : ''}`}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {options.map((o) => (
            <li key={o.value} role="none">
              <button type="button" role="menuitemradio" aria-checked={o.value === value} className="sh-menu__item" onClick={() => choose(o)}>
                <Check size={14} aria-hidden="true" style={{ visibility: o.value === value ? 'visible' : 'hidden' }} />
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
