"use client";

import { Avatar } from "@/components/trello/ui/Avatar";
import { cn } from "@/lib/trello/utils";
import type { Board, Card, List, User } from "@/lib/trello/types";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Compact single-row card representation for the views (My Cards,
 * Due this week, Activity). Shows board + list breadcrumb, title,
 * assignees, due-date, complete-toggle. Clicking anywhere on the row
 * (except the complete circle) opens the CardDetail modal via onOpen.
 *
 * Motion:
 *   • row lifts and brightens on hover (spring)
 *   • row springs down on press (whileTap)
 *   • the complete-toggle icon crossfades + pops when flipped
 */

type Props = {
  card: Card;
  board: Board;
  list: List;
  users: User[];
  onOpen: () => void;
  onToggleComplete: () => void;
  /** show the board name + accent as a breadcrumb — off in single-board views */
  showBoardBreadcrumb?: boolean;
};

const dayShort = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const rowSpring = { type: "spring", stiffness: 480, damping: 32, mass: 0.6 } as const;

export function CardRow({
  card,
  board,
  list,
  users,
  onOpen,
  onToggleComplete,
  showBoardBreadcrumb = true,
}: Props) {
  const assignees = users.filter((u) => card.assigneeIds.includes(u.id));
  const due = card.due ? new Date(card.due) : null;
  const now = new Date();
  const isOverdue = due != null && !card.complete && due.getTime() < now.getTime();
  const isToday =
    due != null &&
    due.toDateString() === now.toDateString();

  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.995, y: 0 }}
      transition={rowSpring}
      className={cn(
        "group flex w-full items-center gap-3 rounded-[8px] border border-neutral-200",
        "bg-neutral-50 px-3 py-2.5 text-left",
        "transition-colors duration-150 ease-smooth",
        "hover:border-neutral-300 hover:bg-neutral-50",
        "hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.55)]"
      )}
    >
      <CompleteToggle complete={!!card.complete} onToggle={onToggleComplete} />

      <div className="min-w-0 flex-1">
        {showBoardBreadcrumb && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-mute">
            <span
              className="h-1.5 w-1.5 rounded-sm"
              style={{ background: board.accent }}
            />
            <span className="truncate">{board.name}</span>
            <span className="text-ink-mute/60">›</span>
            <span className="truncate">{list.name}</span>
          </div>
        )}
        <div
          className={cn(
            "truncate text-[13.5px] font-medium transition-colors duration-150",
            card.complete ? "text-ink-mute line-through" : "text-ink-hi"
          )}
        >
          {card.title}
        </div>
      </div>

      {due && (
        <span
          className={cn(
            "flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] tabular-nums font-medium",
            "transition-colors duration-150",
            isOverdue
              ? "bg-danger text-white shadow-[0_0_0_1px_rgba(226,58,58,0.4)]"
              : isToday
                ? "bg-warning text-white"
                : "bg-neutral-50 text-ink-mid font-normal",
          )}
        >
          <Clock className="h-3 w-3" />
          {dayShort.format(due)}
        </span>
      )}

      {assignees.length > 0 && (
        <div className="flex -space-x-1.5">
          {assignees.slice(0, 3).map((u) => (
            <Avatar
              key={u.id}
              name={u.name}
              hue={u.hue}
              size="sm"
              className="ring-2 ring-surface-1"
            />
          ))}
          {assignees.length > 3 && (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-100 text-[10px] text-ink-mid ring-2 ring-surface-1">
              +{assignees.length - 3}
            </span>
          )}
        </div>
      )}
    </motion.button>
  );
}

/**
 * The circle → check icon flip is the primary dopamine moment on a row.
 * We scale-punch the whole button on tap and crossfade+spring the two
 * icons through each other so it feels like a *snap*, not a swap.
 */
function CompleteToggle({
  complete,
  onToggle,
}: {
  complete: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.span
      role="checkbox"
      aria-checked={complete}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      whileTap={{ scale: 0.82 }}
      whileHover={{ scale: 1.08 }}
      transition={{ type: "spring", stiffness: 520, damping: 20 }}
      className={cn(
        "relative grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full outline-none",
        "focus-visible:ring-2 focus-visible:ring-helios-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
        "transition-colors duration-150",
        complete
          ? "text-heliosGreen-400"
          : "text-ink-mute hover:text-ink-hi"
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {complete ? (
          <motion.span
            key="on"
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: "spring", stiffness: 620, damping: 22 }}
            className="absolute inset-0 grid place-items-center"
          >
            <CheckCircle2 className="h-4 w-4" />
          </motion.span>
        ) : (
          <motion.span
            key="off"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute inset-0 grid place-items-center"
          >
            <Circle className="h-4 w-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}
