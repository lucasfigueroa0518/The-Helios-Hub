"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { List } from "@/components/trello/board/List";
import { CardFace } from "@/components/trello/board/CardFace";
import { AddListComposer } from "@/components/trello/board/AddListComposer";
import type { Board as BoardType, Card, List as ListType, User } from "@/lib/trello/types";

type Props = {
  board: BoardType;
  lists: ListType[];
  cards: Card[];
  users: User[];
  meId?: string;
  onOpenCard: (id: string) => void;
  onAddCard: (listId: string, title: string) => void;
  onAddList: (boardId: string, name: string) => void;
  onMoveCard: (cardId: string, toListId: string, toIndex: number) => void;
  onReorderLists: (boardId: string, orderedIds: string[]) => void;
  onRenameList: (listId: string, name: string) => void;
  onDeleteList: (listId: string) => void;
  onSortCards: (listId: string, by: "title" | "due") => void;
  draftListId: string | null;
  setDraftListId: (id: string | null) => void;
};

export function Board({
  board,
  lists,
  cards,
  users,
  meId,
  onOpenCard,
  onAddCard,
  onAddList,
  onMoveCard,
  onReorderLists,
  onRenameList,
  onDeleteList,
  onSortCards,
  draftListId,
  setDraftListId,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"card" | "list" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleAddList(boardId: string, name: string) {
    onAddList(boardId, name);
    // Reveal the newly added list (drops in right before the composer).
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    });
  }

  const sensors = useSensors(
    // Desktop: 6px drag activation threshold so a mouse click still
    // registers as a click on the card without triggering a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch: press-and-hold to drag. Without a delay every quick touch
    // on a card would start a drag and eat the horizontal scroll gesture
    // used to browse columns on mobile. 200ms is short enough to feel
    // responsive when the user actually means to grab, and tolerance:5
    // lets the finger jitter a hair without cancelling the activation.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // While dragging a list, restrict collision detection to other lists.
  // Otherwise the nearest droppable is often a card in another list's
  // stack, which both hides the horizontal slot preview and drops onto
  // an ineligible target on release.
  const collisionDetection: CollisionDetection = (args) => {
    if (args.active.data.current?.type === "list") {
      return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => c.data.current?.type === "list" && c.id !== args.active.id,
        ),
      });
    }
    return closestCorners(args);
  };

  const boardLists = useMemo(
    () => lists.filter((l) => l.boardId === board.id),
    [lists, board.id]
  );

  const cardsByList = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const l of boardLists) map[l.id] = [];
    for (const c of cards) {
      if (map[c.listId]) map[c.listId].push(c);
    }
    return map;
  }, [boardLists, cards]);

  const activeCard = useMemo(
    () =>
      activeId && activeType === "card"
        ? cards.find((c) => c.id === activeId) ?? null
        : null,
    [activeId, activeType, cards]
  );

  const activeList = useMemo(
    () =>
      activeId && activeType === "list"
        ? boardLists.find((l) => l.id === activeId) ?? null
        : null,
    [activeId, activeType, boardLists]
  );

  function findListOfCard(cardId: string) {
    return cards.find((c) => c.id === cardId)?.listId ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setActiveType((e.active.data.current?.type as "card" | "list") ?? null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeType = active.data.current?.type;
    if (activeType !== "card") return;

    const overType = over.data.current?.type;
    const activeCardId = String(active.id);
    const fromList = findListOfCard(activeCardId);
    if (!fromList) return;

    let toList = fromList;
    if (overType === "list") toList = String(over.id);
    else if (overType === "card") toList = over.data.current?.listId ?? fromList;

    if (fromList === toList) return;

    const targetLen = cardsByList[toList]?.length ?? 0;
    onMoveCard(activeCardId, toList, targetLen);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const activeType = active.data.current?.type;
    setActiveId(null);
    setActiveType(null);
    if (!over) return;

    if (activeType === "list") {
      const overType = over.data.current?.type;
      if (overType !== "list") return;
      const fromIdx = boardLists.findIndex((l) => l.id === String(active.id));
      const toIdx = boardLists.findIndex((l) => l.id === String(over.id));
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      const reordered = arrayMove(boardLists, fromIdx, toIdx).map((l) => l.id);
      onReorderLists(board.id, reordered);
      return;
    }

    if (activeType === "card") {
      const activeCardId = String(active.id);
      const fromList = findListOfCard(activeCardId);
      if (!fromList) return;

      const overType = over.data.current?.type;

      if (overType === "list") {
        const toList = String(over.id);
        const targetLen = cardsByList[toList]?.length ?? 0;
        onMoveCard(activeCardId, toList, targetLen);
        return;
      }

      if (overType === "card") {
        const toList = over.data.current?.listId ?? fromList;
        const toIdx = cardsByList[toList]?.findIndex(
          (c) => c.id === String(over.id)
        );
        if (toIdx == null || toIdx < 0) return;
        onMoveCard(activeCardId, toList, toIdx);
      }
    }
  }

  // Dark class is applied at PageClient root so sidebar + topbar
  // inherit it too — this container only owns the canvas fill so a
  // custom board background doesn't spill into the app chrome.
  const canvasStyle: React.CSSProperties = board.canvas
    ? { background: board.canvas }
    : board.theme === "dark"
      ? { background: "#141821" }
      : {};
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={canvasStyle}
    >
      {/* Very faint sunset wash — decorative warmth across the full width
          of the workspace. Lives outside the scrolling child so it always
          covers the visible viewport regardless of horizontal scroll.
          pointer-events-none, capped at ~5% helios-500 fading to
          transparent so it never competes with the orange CTAs.
          Suppressed in dark mode / on a custom canvas so it doesn't
          fight the picked color. */}
      {board.theme === "light" && !board.canvas && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-56 bg-gradient-to-b from-helios-500/[0.05] via-helios-500/[0.02] to-transparent"
        />
      )}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-x-auto overflow-y-hidden"
      >
      <DndContext
        id="trello-board"
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Tame auto-scroll for narrow viewports. dnd-kit's defaults
        // (acceleration:10, interval:5ms, threshold:0.2) are calibrated
        // for desktop mice. On a 375px phone where each 288px column is
        // ≈ the full viewport, ANY finger nudge near an edge caused a
        // runaway scroll flying past several lists at once.
        //   threshold  → activates only in the last 8% of the viewport.
        //                Reserves the middle 84% as a stable dead zone
        //                so the user can hold their finger over a list
        //                without triggering scroll.
        //   acceleration → 3 out of 10. Scroll ramps in slowly, giving
        //                  the user time to lift and settle.
        //   interval    → 20ms between scroll frames (4× default) so
        //                 each column takes noticeably longer to
        //                 cross — you get to see the target arrive
        //                 rather than fly past it.
        // dnd-kit's auto-scroll already ramps smoothly with
        // distance-to-edge — the closer the finger is to the viewport
        // edge, the faster the scroll rate becomes (proximity ratio in
        // the threshold zone). We tune the shape here rather than
        // replace it:
        //   threshold  → 0.12 gives ~45px of scroll zone on a 375px
        //                phone, more runway than 0.08 for the ramp
        //                curve to build up before hitting the edge.
        //   acceleration → 6 out of 10. Middle of the range. Higher
        //                  than 3 (previous "too slow" setting), still
        //                  well under the default 10 that caused the
        //                  runaway. The ramp lets the user hover at
        //                  ~50% into the zone for gentle scroll and
        //                  push to the very edge for faster scroll.
        //   interval    → 15ms. Slightly faster than 20 but still 3×
        //                 the desktop default so each column takes
        //                 time to arrive.
        autoScroll={{
          threshold: { x: 0.12, y: 0.14 },
          acceleration: 6,
          interval: 15,
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setActiveType(null);
        }}
      >
        <div className="flex h-full items-start gap-3 px-5 pb-5 pt-4">
          <SortableContext
            items={boardLists.map((l) => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            {boardLists.map((l) => (
              <List
                key={l.id}
                list={l}
                cards={cardsByList[l.id] ?? []}
                board={board}
                users={users}
                meId={meId}
                onOpenCard={onOpenCard}
                onAddCard={onAddCard}
                onRenameList={onRenameList}
                onDeleteList={onDeleteList}
                onSortCards={onSortCards}
                isDraftOpen={draftListId === l.id}
                setDraftOpen={(open) => setDraftListId(open ? l.id : null)}
              />
            ))}
          </SortableContext>
          <AddListComposer onAdd={(name) => handleAddList(board.id, name)} />
        </div>

        <DragOverlay
          dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          {activeCard && (
            <div className="w-[288px]">
              <CardFace
                card={activeCard}
                board={board}
                users={users}
                meId={meId}
                onOpen={() => {}}
                isOverlay
              />
            </div>
          )}
          {activeList && (
            <div className="w-[288px] rotate-[2deg]">
              <div className="rounded-[10px] bg-neutral-100 px-3 py-3 shadow-card-lift">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13.5px] font-semibold text-ink-hi">
                    {activeList.name}
                  </h2>
                  <span className="text-[11.5px] tabular-nums text-ink-mute">
                    {cardsByList[activeList.id]?.length ?? 0}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}
