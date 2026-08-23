"use client";

import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar } from "@/components/trello/ui/Avatar";
import { cn } from "@/lib/trello/utils";
import { type Board, type User, type UserId } from "@/lib/trello/types";
import type { Notification, NotificationType } from "@/lib/trello/types";
import {
  AtSign,
  Bell,
  CheckCircle2,
  Clock,
  MessageSquare,
  MoveHorizontal,
  UserPlus,
} from "lucide-react";

/**
 * Notifications dropdown backed by the NOTIFICATIONS entity. Renders
 * the current user's list newest-first, with a filter tab for
 * All / Unread. Clicking a row marks it read and drops the user on the
 * linked card via the `Entity_URL` (parsed for `/cards/{id}`).
 */

type Props = {
  users: User[];
  boards: Board[];
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenCard: (cardId: string) => void;
};

const tapSpring = { type: "spring" as const, stiffness: 500, damping: 26, mass: 0.55 };

export function NotificationsPopover({
  users,
  boards,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onOpenCard,
}: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.92 }}
          transition={tapSpring}
          className={cn(
            "relative rounded-[6px] p-2 text-ink-mid outline-none transition-colors",
            "hover:bg-neutral-50 hover:text-ink-hi",
            "focus-visible:ring-2 focus-visible:ring-helios-500/60",
            "data-[state=open]:bg-neutral-100 data-[state=open]:text-ink-hi"
          )}
          aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-helios-500" />
              <motion.span
                className="absolute inset-0 rounded-full bg-helios-500"
                animate={{ scale: [1, 2.4, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
              />
            </span>
          )}
        </motion.button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className="z-50 w-[380px] focus-visible:outline-none"
          asChild
        >
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className={cn(
              "overflow-hidden rounded-[12px] border border-neutral-200",
              "bg-white/95 backdrop-blur-md",
              "shadow-[0_20px_60px_-12px_rgba(0,0,0,0.55),0_4px_12px_rgba(0,0,0,0.35)]"
            )}
          >
            <header className="flex items-center justify-between border-b border-neutral-200 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-display text-[14px] text-ink-hi">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-helios-500/15 px-1.5 py-0 text-[10px] font-medium text-helios-300">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="text-[11px] text-ink-mute transition-colors hover:text-ink-hi"
                >
                  Mark all read
                </button>
              )}
            </header>

            {notifications.length === 0 ? (
              <div className="grid place-items-center px-6 py-10">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-neutral-50 text-ink-mute">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="mt-2 text-[13px] text-ink-mid">You&rsquo;re caught up</div>
                <div className="text-[11px] text-ink-mute">
                  Nothing new to show right now.
                </div>
              </div>
            ) : (
              <ol className="max-h-[420px] overflow-y-auto py-1">
                <AnimatePresence initial={false}>
                  {notifications.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      users={users}
                      boards={boards}
                      onClick={() => {
                        onMarkRead(n.id);
                        const cardId = parseCardIdFromUrl(n.entityUrl);
                        if (cardId) onOpenCard(cardId);
                      }}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({
  n,
  users,
  boards,
  onClick,
}: {
  n: Notification;
  users: User[];
  boards: Board[];
  onClick: () => void;
}) {
  const actor = n.actorId ? users.find((u) => u.id === n.actorId) : null;
  const board = n.boardId ? boards.find((b) => b.id === n.boardId) : null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
    >
      <button
        onClick={onClick}
        className={cn(
          "group relative flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
          "hover:bg-neutral-50",
          !n.read && "bg-neutral-50"
        )}
      >
        {/* Unread dot at the left edge — physical rail */}
        {!n.read && (
          <motion.span
            layoutId={`unread-${n.id}`}
            className="absolute left-1 top-4 h-1.5 w-1.5 rounded-full bg-helios-500"
          />
        )}

        <span className="mt-0.5 shrink-0">
          {actor ? (
            <div className="relative">
              <Avatar name={actor.name} hue={actor.hue} size="sm" />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-white text-ink-mid">
                <TypeGlyph type={n.type} />
              </span>
            </div>
          ) : (
            <span className={cn(
              "grid h-6 w-6 place-items-center rounded-full",
              iconBg(n.type)
            )}>
              <TypeGlyph type={n.type} />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[13px] leading-snug">
            {actor && (
              <span className="font-medium text-ink-hi">{actor.name}</span>
            )}
            <span className="text-ink-mid">{verbFor(n.type, actor?.id)}</span>
          </div>
          {n.preview && (
            <div
              className={cn(
                "mt-0.5 line-clamp-2 text-[12.5px]",
                n.type === "mention" || n.type === "comment"
                  ? "italic text-ink-mid"
                  : "text-ink-low"
              )}
            >
              {n.preview}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-mute">
            {board && (
              <>
                <span
                  className="h-1.5 w-1.5 rounded-sm"
                  style={{ background: board.accent }}
                />
                <span className="truncate">{board.name}</span>
                <span className="text-ink-mute/60">·</span>
              </>
            )}
            <span>{relTime(n.createdAt)}</span>
          </div>
        </div>
      </button>
    </motion.li>
  );
}

function TypeGlyph({ type }: { type: NotificationType }) {
  const cls = "h-3 w-3";
  switch (type) {
    case "mention":     return <AtSign className={cls} />;
    case "assignment":  return <UserPlus className={cls} />;
    case "due_soon":    return <Clock className={cls} />;
    case "due_overdue": return <Clock className={cls} />;
    case "comment":     return <MessageSquare className={cls} />;
    case "moved":       return <MoveHorizontal className={cls} />;
    default:            return <CheckCircle2 className={cls} />;
  }
}

function iconBg(type: NotificationType) {
  switch (type) {
    case "mention":
    case "assignment":  return "bg-helios-500/15 text-helios-300";
    case "due_overdue": return "bg-danger text-white";
    case "due_soon":    return "bg-warning text-white";
    case "moved":       return "bg-neutral-50 text-ink-mid";
    case "comment":     return "bg-neutral-50 text-ink-mid";
    default:            return "bg-neutral-50 text-ink-mid";
  }
}

function verbFor(type: NotificationType, _actorId?: UserId) {
  switch (type) {
    case "mention":     return "mentioned you";
    case "assignment":  return "assigned you a card";
    case "due_soon":    return "reminder — due soon";
    case "due_overdue": return "reminder — overdue";
    case "comment":     return "commented";
    case "moved":       return "moved a card you follow";
    default:            return "updated";
  }
}

/** Parses `/cards/{id}` out of an entity URL. Rest of the shape is
 *  scaffolding for future entity types (boards, comments, etc). */
function parseCardIdFromUrl(url: string): string | null {
  const m = url.match(/\/cards\/([^/?#]+)/);
  return m ? m[1] : null;
}

function relTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}
