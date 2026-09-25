'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type HeliosMenuOption = {
  value: string;
  label: string;
};

export function HeliosMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label?: string;
  value: string;
  options: HeliosMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? 'Select';

  useEffect(() => {
    if (!open) return;
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
    <div className="analytics-filter analytics-filter--menu" ref={rootRef}>
      {label ? <span className="analytics-filter__label">{label}</span> : null}
      <button
        type="button"
        className={`analytics-filter__shell analytics-filter__trigger${value ? ' analytics-filter__shell--active' : ''}${open ? ' analytics-filter__shell--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="analytics-filter__value">{selected}</span>
        <ChevronDown size={14} className="analytics-filter__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="analytics-filter__menu" role="listbox">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value || 'empty'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`analytics-filter__option${isSelected ? ' analytics-filter__option--active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
