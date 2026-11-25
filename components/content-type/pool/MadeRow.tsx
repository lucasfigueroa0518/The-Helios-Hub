'use client';

import { Badge, flashClass, PostThumb } from '@/components/content-type/pool/bits';
import type { TypeCard } from '@/lib/content-type/model';
import type { PoolMadeRow } from '@/lib/content-type/pool-view';
import { displayName } from '@/lib/social-hub/views/format';

/**
 * One made post in the Made tab (DESIGN.md Pool screen, Made row): thumbnail, title, a meta line (when it posts or
 * posted, made N d ago, archives in N d), the state badge, and a primary Review button only on Needs you rows.
 */
export function MadeRow({ row, card, flash, onOpen }: { row: PoolMadeRow; card: TypeCard | null; flash?: number; onOpen: () => void }) {
  const title = displayName(row.post);
  return (
    <li>
      <div
        className={`pl-row pl-row--made${flashClass(flash)}`}
        tabIndex={0}
        aria-label={title}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
        }}
      >
        <PostThumb post={row.post} thumb={card?.thumb ?? null} remote={card?.remote} />
        <span className="pl-row__main">
          <span className="pl-row__title"><span>{title}</span></span>
          <span className="pl-row__meta">{row.meta.join(' · ')}</span>
        </span>
        <span className="pl-row__badge"><Badge state={row.state} /></span>
        <span className="pl-row__acts" style={{ minWidth: 0 }}>
          {row.state === 'needs_you' ? (
            <button type="button" className="pl-btn pl-btn--primary pl-btn--sm" onClick={(e) => { e.stopPropagation(); onOpen(); }}>Review</button>
          ) : null}
        </span>
      </div>
    </li>
  );
}
