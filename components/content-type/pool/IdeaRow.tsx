'use client';

import type { ReactNode } from 'react';
import { Archive, Pin, Sparkles } from 'lucide-react';

import { Badge, flashClass } from '@/components/content-type/pool/bits';
import type { PoolRowState } from '@/lib/content-type/pool-rules';
import type { PoolIdeaRow } from '@/lib/content-type/pool-view';

/**
 * One idea in the Ideas list (DESIGN.md Pool screen, Idea row): grip, position, title, one meta line, state badge,
 * number, then Pin, Archive and a quiet Make it (Idea and Failed rows only). Make it opens an inline confirm that
 * states the cost first. A Making row locks its buttons and can't be dragged. The run's error never shows here.
 */
export function IdeaRow({ row, state, pinned, handle, moves, readOnly, confirming, costText, busy, flash, pop, leaving, laterBand, onOpen, onPin, onArchive, onMake, onMakeYes, onMakeNo }: {
  row: PoolIdeaRow;
  /** The row's state, with a Make it just sent shown as Making before the next read. */
  state: PoolRowState;
  pinned: boolean;
  /** The drag handle PoolQueue hands the row (null: dragging is off here). */
  handle: ReactNode;
  moves: { pin: boolean; archive: boolean; make: boolean };
  readOnly: boolean;
  confirming: boolean;
  /** "Make this now? It spends about $0.40; the day's spend cap still applies." */
  costText: string;
  busy: boolean;
  flash?: number;
  pop: boolean;
  leaving: boolean;
  /** The "Later" divider, carried by the first row after Up next. */
  laterBand: ReactNode;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
  onMake: () => void;
  onMakeYes: () => void;
  onMakeNo: () => void;
}) {
  const making = state === 'making';
  const canMake = moves.make && (state === 'idea' || state === 'failed');
  const locked = making || busy;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      {laterBand}
      <div
        className={`pl-row${row.upNext ? ' is-up' : ''}${leaving ? ' is-leaving' : ''}${flashClass(flash)}`}
        tabIndex={0}
        aria-label={row.idea.title}
        data-id={row.idea.id}
        {...(making ? { 'data-no-drag': '' } : {})}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
        }}
      >
        <span className="pl-row__grip">{making ? null : handle}</span>
        <span className="pl-row__pos">{row.position}</span>
        <span className="pl-row__main">
          <span className="pl-row__title">
            {pinned ? <span className="pl-row__pin" title="Pinned"><Pin className="pl-i" aria-hidden="true" /></span> : null}
            <span>{row.idea.title}</span>
          </span>
          <span className="pl-row__meta">
            {row.meta.map((piece, i) => (
              <span key={`${i}:${piece}`}>
                {i ? ' · ' : ''}
                {i === 0 && row.slot ? <span className="pl-row__slot">{piece}</span> : piece}
              </span>
            ))}
          </span>
        </span>
        <span className="pl-row__badge"><Badge state={state} /></span>
        <span className="pl-row__num" title={row.number ? 'Score' : undefined}>{row.number ?? ''}</span>
        <span className="pl-row__acts" data-no-drag="" onClick={stop} onKeyDown={stop}>
          {readOnly ? null : (
            <>
              {moves.pin ? (
                <button type="button" className={`pl-icon-btn${pop ? ' pl-pop' : ''}`} aria-pressed={pinned} aria-label={pinned ? 'Unpin' : 'Pin'} title={pinned ? 'Unpin: back to its place' : 'Pin: top of the queue until it is made'} disabled={locked} onClick={onPin}>
                  <Pin className="pl-i" />
                </button>
              ) : null}
              {moves.archive ? (
                <button type="button" className="pl-icon-btn" aria-label="Archive" title="Archive: it leaves the pool (kept, not deleted)" disabled={locked} onClick={onArchive}>
                  <Archive className="pl-i" />
                </button>
              ) : null}
              {canMake ? (
                <button type="button" className="pl-btn pl-btn--sm" disabled={busy} onClick={onMake} aria-expanded={confirming}>
                  <Sparkles className="pl-i" aria-hidden="true" /><span className="pl-lbl">Make it</span>
                </button>
              ) : moves.make ? <span className="pl-row__make-gap" aria-hidden="true" /> : null}
            </>
          )}
        </span>
        {confirming ? (
          <div className="pl-confirm" data-no-drag="" onClick={stop} onKeyDown={stop}>
            {costText}
            <button type="button" className="pl-btn pl-btn--primary pl-btn--sm" disabled={busy} onClick={onMakeYes}>{busy ? 'Starting…' : 'Make it'}</button>
            <button type="button" className="pl-btn pl-btn--sm" disabled={busy} onClick={onMakeNo}>Cancel</button>
          </div>
        ) : null}
      </div>
    </>
  );
}
