'use client';

import type { ReactNode } from 'react';

import { PoolQueue } from '@/components/content-type/PoolQueue';
import { QueueControls } from '@/components/content-type/QueueControls';

/**
 * A type's idea pool as the draggable queue (idea pool standard, 2026-10-21), in the Social Hub's own styling: pin, drag,
 * archive. Rows arrive in queue order with everything they show already worked out on the server.
 */

export type PoolRowData = {
  id: string;
  title: string;
  detail: string | null;
  score: string;
  /** The score bar's width in percent, or null when there is no score. */
  bar: number | null;
  state: string;
  versions: string | null;
  chips: Array<{ text: string; kind?: 'pinned' }>;
  pinned: boolean;
  hasContent: boolean;
  /** Can still become a post: Pin and Archive are offered. */
  open: boolean;
  /** "Where the score comes from", folded under the title. */
  why: ReactNode;
};

export function PoolList({ vertical, rows, scoreLabel, canDrag }: { vertical: string; rows: PoolRowData[]; scoreLabel: string; canDrag: boolean }) {
  const byId = new Map(rows.map((r, i) => [r.id, { r, rank: i + 1 }]));
  return (
    <PoolQueue
      vertical={vertical}
      rows={rows.map((r) => ({ id: r.id, pinned: r.pinned, hasContent: r.hasContent, title: r.title }))}
      topN={0}
      enabled={canDrag}
      classes={{ list: 'sh-queue', zone: 'sh-queue-zone', grip: 'sh-queue__grip' }}
      renderRow={(id, handle) => {
        const { r, rank } = byId.get(id)!;
        return (
          <div className={`sh-queue__row${r.pinned ? ' is-pinned' : ''}`}>
            <span className="sh-queue__rank">{rank}</span>
            <span className="sh-queue__handle">{handle}</span>
            <span className="sh-queue__main">
              <span className="sh-cell-post__name">{r.title}</span>
              <span className="sh-queue__chips">
                {r.chips.map((c) => <span key={c.text} className={`sh-chip${c.kind === 'pinned' ? ' sh-chip--pinned' : ''}`}>{c.text}</span>)}
                <span className="sh-chip">{r.state}</span>
                {r.versions ? <span className="sh-subtle">{r.versions}</span> : null}
              </span>
              {r.detail ? <span className="sh-subtle">{r.detail}</span> : null}
              {r.why}
            </span>
            <span className="sh-queue__score" aria-label={`${scoreLabel} ${r.score}`}>
              <span className="sh-score">{r.score}</span>
              {r.bar != null ? <span className="sh-bar" aria-hidden="true"><span style={{ width: `${r.bar}%` }} /></span> : null}
            </span>
            {r.open ? <QueueControls vertical={vertical} ideaId={r.id} pinned={r.pinned} title={r.title} compact buttonClass="sh-btn sh-queue__btn" /> : <span />}
          </div>
        );
      }}
    />
  );
}
