'use client';

import type { ReactNode } from 'react';

export type PoolTab = 'ideas' | 'made';

/**
 * Ideas | Made (pool UI contract §5): a segmented control whose selected segment is orange with a white label and
 * count; each count matches its list. Seed sits at the right of the same row, hidden on the Made tab; at the cap its
 * reason shows as text beside it.
 */
export function PoolTabs({ tab, onTab, ideas, made, seed, seedOff }: {
  tab: PoolTab;
  onTab: (tab: PoolTab) => void;
  ideas: number;
  made: number;
  /** The type's Seed button (none: the pool has no seed path, or the page is read-only). */
  seed?: ReactNode;
  /** Why Seed is off ("The pool holds 30 topics. Archive one to seed another."), or null. */
  seedOff: string | null;
}) {
  const segment = (id: PoolTab, label: string, n: number) => (
    <button
      type="button"
      role="tab"
      id={`pl-tab-${id}`}
      aria-selected={tab === id}
      aria-controls="pl-list"
      tabIndex={tab === id ? 0 : -1}
      onClick={() => onTab(id)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = id === 'ideas' ? 'made' : 'ideas';
        onTab(next);
        document.getElementById(`pl-tab-${next}`)?.focus();
      }}
    >
      {label} <span className="pl-seg__n">{n}</span>
    </button>
  );
  return (
    <div className="pl-bar">
      <div className="pl-seg" role="tablist" aria-label="Pool">
        {segment('ideas', 'Ideas', ideas)}
        {segment('made', 'Made', made)}
      </div>
      {tab === 'ideas' && seed ? (
        <div className="pl-bar__seed">
          {seedOff ? <span className="pl-why-off">{seedOff}</span> : null}
          {seed}
        </div>
      ) : null}
    </div>
  );
}
