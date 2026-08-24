"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import {
  MessageCircle,
  Paperclip,
  CheckSquare,
  Calendar,
  Check,
  AlignLeft,
  Eye,
  Trash2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { cn, dueState, formatCurrency, formatDate } from "@/lib/trello/utils";
import { AvatarStack } from "@/components/trello/ui/Avatar";
import type { Board, Card, FieldDef, User } from "@/lib/trello/types";

type Props = {
  card: Card;
  board: Board;
  users: User[];
  meId?: string;
  onOpen: () => void;
  onArchive?: () => void;
  onToggleComplete?: () => void;
  isDragging?: boolean;
  isOverlay?: boolean;
};

export const CardFace = forwardRef<HTMLDivElement, Props>(function CardFace(
  { card, board, users, meId, onOpen, onArchive, onToggleComplete, isDragging, isOverlay },
  ref
) {
  const isTracking = meId ? card.trackerIds.includes(meId) : false;
  const assignees = card.assigneeIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => !!u);
  const labels = card.labelIds
    .map((id) => board.labels.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => !!l);

  const checklistTotal = card.checklists.reduce((a, c) => a + c.items.length, 0);
  const checklistDone = card.checklists.reduce(
    (a, c) => a + c.items.filter((i) => i.done).length,
    0
  );

  const dstate = dueState(card.due, card.complete);
  const shownFields = board.fields.slice(0, 2);

  return (
    <motion.div
      ref={ref}
      layout={!isOverlay}
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.5 }}
      className={cn(
        "group relative surface-card cursor-pointer select-none rounded-[8px] p-3 touch-manipulation",
        "shadow-card hover:border-neutral-200 active:bg-neutral-100/50 dark:active:bg-neutral-800/50 transition-[opacity,transform,box-shadow,border-color] duration-150",
        // Completed cards fade back so the eye reads "done, moved on"
        // without needing loud iconography or a colored side-stripe.
        // Hover restores full opacity so the card is fully readable
        // when the user actually points at it.
        card.complete && !isOverlay && "opacity-65 hover:opacity-100",
        isDragging && "opacity-0",
        isOverlay && "shadow-card-lift rotate-[2deg]",
      )}
    >
      {/* Top right quick actions (complete toggle & archive) */}
      {!isOverlay && (onToggleComplete || onArchive) && (
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onToggleComplete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleComplete();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={card.complete ? "Mark incomplete" : "Mark complete"}
              title={card.complete ? "Mark incomplete" : "Mark complete"}
              className={cn(
                "grid h-6 w-6 place-items-center rounded-md transition-all",
                card.complete
                  ? "text-heliosGreen-500 hover:bg-heliosGreen-500/10 dark:text-heliosGreen-400"
                  : "text-ink-mute hover:bg-neutral-100 hover:text-heliosGreen-500 dark:hover:bg-neutral-800"
              )}
            >
              {card.complete ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {onArchive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Archive card"
              title="Archive card"
              className="grid h-6 w-6 place-items-center rounded-md text-ink-mute transition-all hover:bg-red-500/10 hover:text-red-500 dark:hover:bg-red-500/20 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Labels — Trello-style small pills with names */}
      {labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 pr-14">
          {labels.map((l) => (
            <span
              key={l.id}
              className="inline-block rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{ background: l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      {/* Title */}
      <h3
        className={cn(
          "text-[14px] leading-[1.4] text-ink-hi dark:text-neutral-100",
          (onArchive || onToggleComplete) && labels.length === 0 && "pr-14",
          // Softer strikethrough — inherits the current text color at
          // low opacity instead of a bright helios-green line. Pairs
          // with the card-level opacity fade above so the "completed"
          // treatment is calm rather than shouty.
          card.complete && "text-ink-mid line-through decoration-current/40 decoration-[1.5px] underline-offset-[3px] dark:text-neutral-500",
        )}
      >
        {card.title}
      </h3>

      {/* Custom field chips */}
      {shownFields.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {shownFields.map((f) => (
            <FieldChip key={f.id} field={f} value={card.fieldValues[f.id]} />
          ))}
        </div>
      )}

      {/* Meta row */}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-mute">
          {card.due && (
            <DueBadge state={dstate} label={formatDate(card.due)} />
          )}
          {card.description && card.description.trim().length > 0 && (
            <span
              className="text-ink-mute"
              aria-label="Has description"
              title="This card has a description"
            >
              <AlignLeft className="h-3 w-3" />
            </span>
          )}
          {checklistTotal > 0 && (
            <ChecklistBadge
              done={checklistDone}
              total={checklistTotal}
              complete={checklistDone === checklistTotal}
            />
          )}
          {card.comments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] tabular-nums">
              <MessageCircle className="h-3 w-3" />
              {card.comments.length}
            </span>
          )}
          {card.attachments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] tabular-nums">
              <Paperclip className="h-3 w-3" />
              {card.attachments.length}
            </span>
          )}
          {isTracking && (
            <span
              className="text-helios-500"
              aria-label="You are tracking this card"
              title="Tracking"
            >
              <Eye className="h-3 w-3" />
            </span>
          )}
        </div>
        {assignees.length > 0 && (
          <AvatarStack
            names={assignees.map((a) => a.name)}
            hues={assignees.map((a) => a.hue)}
            size="sm"
          />
        )}
      </div>
    </motion.div>
  );
});

function FieldChip({
  field,
  value,
}: {
  field: FieldDef;
  value: string | number | boolean | null | undefined;
}) {
  if (value == null || value === "") return null;

  if (field.type === "boolean") {
    const on = Boolean(value);
    if (!on) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] bg-heliosGreen-400/10 px-1.5 py-0.5 text-[11px] font-medium text-heliosGreen-400">
        <Check className="h-2.5 w-2.5" />
        {field.name}
      </span>
    );
  }

  let display: string = String(value);
  if (field.type === "currency") display = formatCurrency(Number(value));
  if (field.type === "date") display = formatDate(String(value));
  if (field.type === "number") display = `${value}h`;

  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] bg-neutral-50 px-1.5 py-0.5 text-[11px] text-ink-mid">
      <span className="text-ink-mute">{field.name}</span>
      <span className="tabular-nums text-ink-hi">{display}</span>
    </span>
  );
}

function DueBadge({
  state,
  label,
}: {
  state: "none" | "overdue" | "soon" | "later" | "far" | "complete";
  label: string;
}) {
  // Cards more than 7 days out don't need a chip — suppressing keeps
  // yellow/red visually rare and load-bearing when they do appear.
  if (state === "far") return null;
  const style =
    state === "overdue"
      ? "bg-danger text-white shadow-[0_0_0_1px_rgba(226,58,58,0.4)]"
      : state === "soon"
        ? "bg-warning text-white"
        : state === "complete"
          ? "bg-heliosGreen-600/12 text-heliosGreen-600"
          : "bg-neutral-50 text-ink-mid";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium",
        style,
      )}
    >
      <Calendar className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function ChecklistBadge({
  done,
  total,
  complete,
}: {
  done: number;
  total: number;
  complete: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] tabular-nums",
        complete ? "text-heliosGreen-400" : "text-ink-mid"
      )}
    >
      <CheckSquare className="h-3 w-3" />
      {done}/{total}
    </span>
  );
}
