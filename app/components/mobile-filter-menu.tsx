'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';

export function useIsMobile(query = '(max-width: 767px)') {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function MobileFilterBar({
  title,
  summary,
  onOpen,
}: {
  title: string;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="hub-mobile-bar" onClick={onOpen}>
      <SlidersHorizontal size={18} aria-hidden="true" />
      <span className="hub-mobile-bar__copy">
        <strong>{title}</strong>
        <span>{summary}</span>
      </span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
  );
}

export function MobileFilterMenu({
  title,
  subtitle,
  open,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="hub-mobile-menu" role="dialog" aria-modal="true" aria-labelledby="hub-mobile-menu-title">
      <div className="hub-mobile-menu__top">
        <div>
          <h2 id="hub-mobile-menu-title">{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="hub-mobile-menu__body">{children}</div>
      <div className="hub-mobile-menu__footer">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export function FilterAccordion({
  label,
  value,
  open,
  onToggle,
  children,
  icon,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={`hub-mobile-acc${open ? ' is-open' : ''}`}>
      <button type="button" className="hub-mobile-acc__head" onClick={onToggle} aria-expanded={open}>
        <span className="hub-mobile-acc__copy">
          <span className="hub-mobile-acc__label">{icon}{label}</span>
          <span className="hub-mobile-acc__value">{value}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open ? <div className="hub-mobile-acc__body">{children}</div> : null}
    </div>
  );
}

export function ChoiceList({
  options,
  value,
  onChange,
  multi = false,
}: {
  options: Array<{ id: string; label: string }>;
  value: string | string[];
  onChange: (id: string) => void;
  multi?: boolean;
}) {
  const selected = Array.isArray(value) ? new Set(value) : new Set([value]);
  return (
    <div className="hub-mobile-choices" role={multi ? 'group' : 'listbox'}>
      {options.map((option) => {
        const isSelected = selected.has(option.id);
        return (
          <button
            key={option.id || 'all'}
            type="button"
            role={multi ? 'checkbox' : 'option'}
            aria-checked={multi ? isSelected : undefined}
            aria-selected={multi ? undefined : isSelected}
            className={`hub-mobile-choice${isSelected ? ' is-selected' : ''}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
