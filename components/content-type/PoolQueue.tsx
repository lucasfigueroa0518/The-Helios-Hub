'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { GenerateConfirm } from '@/components/content-type/GenerateConfirm';
import { postQueue } from '@/components/content-type/queue-post';
import type { GenerateIdea } from '@/lib/content-type/queue-client';

/**
 * The idea queue as a draggable list (idea pool standard, 2026-10-21): grab a row by its handle and glide it to a
 * new place, like a music queue. Dropped above the pins it becomes a pin (the pin zone says so while you drag);
 * a pin dropped below the pins is unpinned and stays where it landed. The server works the position out from the
 * neighbours (lib/content-type/idea-queue.ts), so a stale page can never write a wrong number.
 * An idea with nothing made that lands in today's top slots asks "Generate this now?" before anything is spent.
 */

/**
 * Press and hold anywhere on a row to pick it up. A quick click still opens the row, and the row's own buttons (Pin, Archive,
 * Generate) and links never start a drag.
 */
class RowPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        const target = nativeEvent.target as HTMLElement | null;
        return !target?.closest('button:not([data-grip]), a, input, select, textarea, summary, [data-no-drag]');
      },
    },
  ];
}

/** How long a press must last before it picks the row up, and how far a finger or mouse may wander meanwhile. */
const HOLD = { delay: 180, tolerance: 8 };

export type QueueClasses = { list: string; zone: string; grip: string };
const RH: QueueClasses = { list: 'rh-rest__list rh-rest__list--queue', zone: 'rh-pinzone', grip: 'rh-row__grip' };

export type QueueRow = { id: string; pinned: boolean; hasContent: boolean; title: string };

export function PoolQueue({ vertical, rows, topN, enabled, generate, classes, renderRow }: {
  vertical: string;
  rows: QueueRow[];
  /** Today's quota: the first N places are the day's slots. */
  topN: number;
  /** Dragging is on for this list (Stories only inside one series). */
  enabled: boolean;
  /** Generate one idea, for the types that can (the page is handed it). */
  generate?: GenerateIdea;
  /** Class names for the page's own design system (the Social Hub pages use `sh-`); the defaults are the type pages' `rh-`. */
  classes?: Partial<QueueClasses>;
  renderRow: (id: string, handle: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const cls = { ...RH, ...classes };
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const [order, setOrder] = useState(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [willPin, setWillPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<QueueRow | null>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  useEffect(() => setOrder(ids), [ids]);
  const pinnedCount = order.filter((id) => byId.get(id)?.pinned).length;

  const sensors = useSensors(
    useSensor(RowPointerSensor, { activationConstraint: HOLD }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
    setError(null);
  }
  function onDragOver(e: DragOverEvent) {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (over === 'pin-zone') return setWillPin(true);
    const at = over ? order.indexOf(over) : -1;
    setWillPin(at >= 0 && at < pinnedCount && !byId.get(active)?.pinned);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setWillPin(false);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active === over) return;
    const from = order.indexOf(active);
    const wasPinned = byId.get(active)?.pinned === true;
    const toZone = over === 'pin-zone';
    const next = toZone ? [active, ...order.filter((id) => id !== active)] : arrayMove(order, from, order.indexOf(over));
    const to = next.indexOf(active);
    const nowPinned = toZone || to < pinnedCount;
    setOrder(next);
    try {
      if (nowPinned) {
        if (!wasPinned) await postQueue({ vertical, action: 'pin', ideaId: active });
        await postQueue({ vertical, action: 'reorder-pins', order: next.slice(0, pinnedCount + (wasPinned ? 0 : 1)) });
      } else {
        const side = (id: string | undefined) => (id && !byId.get(id)?.pinned ? id : null);
        await postQueue({ vertical, action: 'place', ideaId: active, aboveId: side(next[to - 1]), belowId: side(next[to + 1]), up: to < from });
      }
      const row = byId.get(active)!;
      if (to < topN && !row.hasContent && generate) setAsking(row);
      router.refresh();
    } catch (err) {
      setOrder(ids);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!enabled) {
    return <ul className={cls.list.replace(' rh-rest__list--queue', '')}>{order.map((id) => <li key={id}>{renderRow(id, null)}</li>)}</ul>;
  }
  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setDragging(null); setWillPin(false); }}>
        {dragging ? <PinZone active={willPin} className={cls.zone} /> : null}
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className={cls.list}>
            {order.map((id) => (
              <SortableRow key={id} id={id} pinned={byId.get(id)?.pinned === true} title={byId.get(id)?.title ?? ''} grip={cls.grip} renderRow={renderRow} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {error ? <p className="rh-run-status is-failed" role="alert">{error}</p> : null}
      {asking && generate ? <GenerateConfirm generate={generate} ideaId={asking.id} title={asking.title} reason="top" onDone={() => { setAsking(null); router.refresh(); }} /> : null}
    </>
  );
}

function PinZone({ active, className }: { active: boolean; className: string }) {
  const { setNodeRef } = useDroppable({ id: 'pin-zone' });
  return (
    <div ref={setNodeRef} className={`${className}${active ? ' is-active' : ''}`} aria-live="polite">
      {active ? 'Drop to pin it to the top of the queue' : 'Drag above the pins to pin'}
    </div>
  );
}

function SortableRow({ id, pinned, title, grip, renderRow }: { id: string; pinned: boolean; title: string; grip: string; renderRow: (id: string, handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined };
  // A drag ends with a click on the row it started on; that click must not open the row.
  const droppedAt = useRef(0);
  useEffect(() => {
    if (!isDragging) return undefined;
    return () => { droppedAt.current = Date.now(); };
  }, [isDragging]);
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (event: never) => void>;
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      data-grip=""
      className={grip}
      aria-label={`Move ${title}. Space to pick up, arrow keys to move, space to drop. Or press and hold the row.`}
      title={pinned ? 'Hold anywhere on the row to reorder the pins, or drag below them to unpin' : 'Hold anywhere on the row and drag to move it in the queue'}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown as never}
      {...attributes}
    >
      <GripVertical size={16} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'rh-queue-item is-dragging' : 'rh-queue-item'}
      {...(pointer as object)}
      onClickCapture={(e) => {
        if (Date.now() - droppedAt.current < 300) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {renderRow(id, handle)}
    </li>
  );
}
