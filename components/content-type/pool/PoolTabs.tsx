'use client';

import type { ReactNode } from 'react';

export type PoolTab = 'ideas' | 'made' | 'settings';

/**
 * Ideas | Made | Settings (pool UI contract §5; settings standard D8): a segmented control whose selected segment is
 * orange with a white label and count; each count matches its list, and Settings has none. Settings shows only where
 * the page hands in a Settings tab (every type page does; the read-only preview doesn't). Arrow keys move along the
 * segments and wrap. Seed sits at the right of the same row on the Ideas tab only; at the cap its reason shows as text
 * beside it.
 */
export function PoolTabs({ tab, onTab, ideas, made, settings = false, seed, seedOff }: {
  tab: PoolTab;
  onTab: (tab: PoolTab) => void;
  ideas: number;
  made: number;
  /** Whether the Settings segment is drawn. */
  settings?: boolean;
  /** The type's Seed button (none: the pool has no seed path, or the page is read-only). */
  seed?: ReactNode;
  /** Why Seed is off ("The pool holds 30 topics. Archive one to seed another."), or null. */
  seedOff: string | null;
}) {
  const order: PoolTab[] = settings ? ['ideas', 'made', 'settings'] : ['ideas', 'made'];
  const segment = (id: PoolTab, label: string, n: number | null) => (
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
        const i = order.indexOf(id);
        const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
        onTab(next);
        document.getElementById(`pl-tab-${next}`)?.focus();
      }}
    >
      {label}{n === null ? null : <> <span className="pl-seg__n">{n}</span></>}
    </button>
  );
  return (
    <div className="pl-bar">
      <div className="pl-seg" role="tablist" aria-label="Pool">
        {segment('ideas', 'Ideas', ideas)}
        {segment('made', 'Made', made)}
        {settings ? segment('settings', 'Settings', null) : null}
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
