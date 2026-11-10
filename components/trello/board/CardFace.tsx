"use client";

import { forwardRef, useState } from "react";
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
  Plus,
} from "lucide-react";
import { cn, dueState, formatCurrency, formatDate } from "@/lib/trello/utils";
import { Avatar, AvatarStack } from "@/components/trello/ui/Avatar";
import type { Board, Card, FieldDef, User } from "@/lib/trello/types";

type Props = {
  card: Card;
  board: Board;
  users: User[];
  meId?: string;
  onOpen: () => void;
  onArchive?: () => void;
  onToggleComplete?: () => void;
  quickAssign?: boolean;
  members?: User[];
  onToggleAssignee?: (userId: string) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
};

export const CardFace = forwardRef<HTMLDivElement, Props>(function CardFace(
  {
    card,
    board,
    users,
    meId,
    onOpen,
    onArchive,
    onToggleComplete,
    quickAssign,
    members,
    onToggleAssignee,
    isDragging,
    isOverlay,
  },
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
  const assignCandidates = (members ?? []).filter(
    (u) => !card.assigneeIds.includes(u.id)
  );
  const showQuickAssign =
    !isOverlay &&
    !!quickAssign &&
    !!onToggleAssignee &&
    assignCandidates.length > 0;

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

      {/* Meta row. Suggestions, people already on the card, and the plus
          share one row so the suggestions grow into free space instead of
          painting over the avatars. */}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-2 text-ink-mute">
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
        {(assignees.length > 0 || showQuickAssign) && (
          <MemberRow
            assignees={assignees}
            candidates={assignCandidates}
            showQuickAssign={showQuickAssign}
            onToggle={onToggleAssignee}
          />
        )}
      </div>
    </motion.div>
  );
});

function MemberRow({
  assignees,
  candidates,
  showQuickAssign,
  onToggle,
}: {
  assignees: User[];
  candidates: User[];
  showQuickAssign: boolean;
  onToggle?: (userId: string) => void;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const expanded = showQuickAssign && (pinned || hover);

  return (
    <div
      className="ml-auto flex min-w-0 flex-1 items-center justify-end"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          "flex min-w-0 justify-end overflow-hidden transition-[flex-grow,opacity,margin] duration-200 ease-out",
          expanded ? "mr-1 flex-1 opacity-100" : "mr-0 w-0 flex-none opacity-0"
        )}
      >
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-white/95 px-1 py-0.5 shadow-sm ring-1 ring-neutral-200/80 dark:bg-neutral-900/95 dark:ring-neutral-700">
          {candidates.map((member) => (
            <button
              key={member.id}
              type="button"
              title={`Add ${member.name}`}
              aria-label={`Add ${member.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.(member.id);
              }}
              className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi dark:hover:bg-neutral-800"
            >
              <Avatar name={member.name} hue={member.hue} size="xs" tooltip={false} />
              <span className="max-w-[68px] truncate text-[11px] leading-none">
                {member.firstName || member.name}
              </span>
            </button>
          ))}
        </div>
      </div>
      {assignees.length > 0 && (
        onToggle ? (
          <div className="flex shrink-0 items-center -space-x-1">
            {assignees.map((member) => (
              <button
                key={member.id}
                type="button"
                title={`Remove ${member.name}`}
                aria-label={`Remove ${member.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(member.id);
                }}
                className="rounded-full outline-none transition-transform hover:z-10 hover:scale-105 focus-visible:ring-2 focus-visible:ring-helios-500/60"
              >
                <Avatar name={member.name} hue={member.hue} size="sm" stacked tooltip={false} />
              </button>
            ))}
          </div>
        ) : (
          <AvatarStack
            names={assignees.map((a) => a.name)}
            hues={assignees.map((a) => a.hue)}
            size="sm"
          />
        )
      )}
      {showQuickAssign && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide members" : "Add members"}
          title="Add members"
          onClick={(e) => {
            e.stopPropagation();
            setPinned((open) => !open);
          }}
          className={cn(
            "ml-1 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border text-neutral-400/70 transition-all",
            "border-neutral-400/40 bg-white/50 opacity-60 hover:border-neutral-500/60 hover:bg-white/95 hover:text-ink-mid hover:opacity-100",
            "dark:border-neutral-500/40 dark:bg-neutral-900/30 dark:hover:bg-neutral-900/80 dark:hover:text-neutral-200",
            expanded &&
              "border-neutral-400/70 bg-white text-ink-mid opacity-100 dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-200"
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

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
