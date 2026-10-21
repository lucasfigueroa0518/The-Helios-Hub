'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';

import type { SlotKey, StorySeries } from '@/lib/social-hub/slots/types';
import type { Vertical } from '@/lib/social-hub/types';
import { CARD_MINUTES, minuteForY, yForMinute } from '@/lib/social-hub/views/week';
import type { Drop } from '@/lib/social-hub/views/week-edit';

/**
 * Native HTML5 drag for the week board (spec decisions 6–8). One ghost
 * element, the size of a card, is reused for the whole drag and moved with a
 * transform; it is only touched when the snapped minute, the day or the tone
 * changes, at most once a frame. Column geometry is read once per drag (and
 * again after a scroll). Drag state lives in a ref; React renders once when a
 * drag starts (bands, the faded card) and once when it ends.
 */

export type DragSource =
  | { kind: 'type'; vertical: Vertical; series: StorySeries | null; label: string }
  | { kind: 'card'; day: number; key: SlotKey; cardKey: string; label: string }
  | { kind: 'ready'; id: string; vertical: Vertical; series: StorySeries | null; label: string };

export const sourceVertical = (s: DragSource): Vertical => (s.kind === 'card' ? s.key.vertical : s.vertical);
export const sourceSeries = (s: DragSource): StorySeries | null => (s.kind === 'card' ? s.key.series : s.series);

type Live = { source: DragSource; day: number | null; raw: number; drop: Drop | null; frame: number | null };

const CARD_FRACTION = CARD_MINUTES / (21 * 60 - 8 * 60);

export function useBoardDrag(opts: {
  grid: RefObject<HTMLDivElement | null>;
  ghost: RefObject<HTMLDivElement | null>;
  /** Where the source would land on a day at a raw minute; null when the day takes nothing (a past day). */
  preview: (source: DragSource, day: number, raw: number, prev: Drop | null) => Drop | null;
  onDrop: (source: DragSource, day: number, drop: Drop | null) => void;
  /** A card dropped back on the drag row. */
  onRemove: (source: Extract<DragSource, { kind: 'card' }>) => void;
}) {
  const live = useRef<Live | null>(null);
  const rects = useRef(new Map<number, DOMRect>());
  const gridRect = useRef<DOMRect | null>(null);
  const [dragging, setDragging] = useState<DragSource | null>(null);
  const [overRow, setOverRow] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const hideGhost = useCallback(() => {
    const g = optsRef.current.ghost.current;
    if (g) g.hidden = true;
    if (live.current) { live.current.day = null; live.current.drop = null; }
  }, []);

  const end = useCallback(() => {
    if (live.current?.frame != null) cancelAnimationFrame(live.current.frame);
    live.current = null;
    rects.current.clear();
    gridRect.current = null;
    hideGhost();
    setDragging(null);
    setOverRow(false);
  }, [hideGhost]);

  // Off a column (or a scroll moved the columns): the ghost goes, and geometry is read again.
  useEffect(() => {
    if (!dragging) return;
    const away = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-board-axis]')) hideGhost();
    };
    const scrolled = () => { rects.current.clear(); gridRect.current = null; };
    document.addEventListener('dragover', away);
    window.addEventListener('scroll', scrolled, true);
    return () => { document.removeEventListener('dragover', away); window.removeEventListener('scroll', scrolled, true); };
  }, [dragging, hideGhost]);

  const paint = useCallback((day: number, axis: HTMLElement, drop: Drop) => {
    const g = optsRef.current.ghost.current;
    const grid = optsRef.current.grid.current;
    const st = live.current;
    if (!g || !grid || !st) return;
    const r = rects.current.get(day) ?? axis.getBoundingClientRect();
    rects.current.set(day, r);
    const gr = gridRect.current ?? grid.getBoundingClientRect();
    gridRect.current = gr;
    const x = r.left - gr.left + 4;
    const y = r.top - gr.top + yForMinute(drop.minute, r.height);
    g.style.width = `${r.width - 8}px`;
    g.style.height = `${r.height * CARD_FRACTION}px`;
    g.style.transform = `translate(${x}px, ${y}px)`;
    g.dataset.tone = drop.tone;
    g.dataset.snapped = drop.snappedTo ? 'true' : 'false';
    const name = g.querySelector('[data-ghost-name]');
    const tag = g.querySelector('[data-ghost-tag]');
    if (name) name.textContent = st.source.label;
    if (tag) tag.textContent = drop.tag;
    g.hidden = false;
  }, []);

  /** Props for anything that can be dragged onto the board. */
  const sourceProps = useCallback((source: DragSource, enabled = true) => (enabled ? {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      // A drag that starts on a control inside the card (the Trial / Main tag) is not a drag.
      if (e.target instanceof Element && e.target.closest('button, select, a, input') && e.target !== e.currentTarget) { e.preventDefault(); return; }
      live.current = { source, day: null, raw: -1, drop: null, frame: null };
      e.dataTransfer.effectAllowed = source.kind === 'card' ? 'move' : 'copy';
      e.dataTransfer.setData('text/plain', source.label);
      // Render after the browser has taken its drag image: changing the dragged node now can cancel the drag.
      setTimeout(() => { if (live.current?.source === source) setDragging(source); }, 0);
    },
    onDragEnd: () => end(),
  } : { draggable: false }), [end]);

  /** Props for a day's timeline. */
  const axisProps = useCallback((day: number) => ({
    'data-board-axis': '',
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const st = live.current;
      if (!st) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = st.source.kind === 'card' ? 'move' : 'copy';
      const axis = e.currentTarget;
      const r = rects.current.get(day) ?? axis.getBoundingClientRect();
      rects.current.set(day, r);
      const raw = Math.round(minuteForY(e.clientY - r.top - (r.height * CARD_FRACTION) / 2, r.height));
      if (st.day === day && st.raw === raw) return;
      st.raw = raw;
      const drop = optsRef.current.preview(st.source, day, raw, st.day === day ? st.drop : null);
      if (!drop) { hideGhost(); return; }
      const same = st.day === day && st.drop && st.drop.minute === drop.minute && st.drop.tone === drop.tone && st.drop.tag === drop.tag;
      st.day = day;
      st.drop = drop;
      if (same) return;
      if (st.frame != null) cancelAnimationFrame(st.frame);
      st.frame = requestAnimationFrame(() => { if (live.current) { live.current.frame = null; paint(day, axis, drop); } });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const st = live.current;
      if (!st) return;
      e.preventDefault();
      const source = st.source;
      const drop = st.day === day ? st.drop : null;
      end();
      optsRef.current.onDrop(source, day, drop);
    },
  }), [end, hideGhost, paint]);

  /** Props for the drag row: a card dropped there is removed. */
  const rowProps = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (live.current?.source.kind !== 'card') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      hideGhost();
      if (!overRow) setOverRow(true);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOverRow(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const st = live.current;
      if (st?.source.kind !== 'card') return;
      e.preventDefault();
      const source = st.source;
      end();
      optsRef.current.onRemove(source);
    },
  };

  return { dragging, overRow, sourceProps, axisProps, rowProps };
}
