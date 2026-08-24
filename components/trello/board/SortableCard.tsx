"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardFace } from "@/components/trello/board/CardFace";
import type { Board, Card, User } from "@/lib/trello/types";

export function SortableCard({
  card,
  board,
  users,
  meId,
  onOpen,
  onArchive,
  onToggleComplete,
}: {
  card: Card;
  board: Board;
  users: User[];
  meId?: string;
  onOpen: () => void;
  onArchive?: () => void;
  onToggleComplete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { type: "card", cardId: card.id, listId: card.listId },
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition
      ? "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)"
      : undefined,
    // No touch-action:none here — that would eat quick horizontal
    // swipes on a card (used to browse columns on mobile). The
    // TouchSensor's press-and-hold delay is what discriminates a
    // scroll from a drag; movement within the delay window cancels
    // activation and returns the touch to the browser for scrolling.
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardFace
        card={card}
        board={board}
        users={users}
        meId={meId}
        onOpen={onOpen}
        onArchive={onArchive}
        onToggleComplete={onToggleComplete}
        isDragging={isDragging}
      />
    </div>
  );
}
