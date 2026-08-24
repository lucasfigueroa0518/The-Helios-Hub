'use client';

import { useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export function RowActions({
  label = 'Show actions',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`dashboards-row-actions${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="dashboards-row-actions__more"
        aria-expanded={open}
        aria-label={open ? 'Hide actions' : label}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={18} />
      </button>
      <div className="dashboards-row-actions__menu">{children}</div>
    </div>
  );
}
