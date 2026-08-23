"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/trello/ui/Button";
import { Avatar } from "@/components/trello/ui/Avatar";
import { savedViews, type Board, type User } from "@/lib/trello/types";
import { cn } from "@/lib/trello/utils";
import { Plus, Search, X } from "lucide-react";
import type { ActiveView } from "@/lib/trello/useBoardState";
import type { Notification } from "@/lib/trello/types";
import { motion } from "framer-motion";
import { NotificationsPopover } from "./NotificationsPopover";
import { BoardMenu } from "@/components/trello/board/BoardMenu";

const tapSpring = { type: "spring", stiffness: 500, damping: 26, mass: 0.55 } as const;

type Props = {
  boards: Board[];
  users: User[];
  activeBoardId: string;
  activeView: ActiveView;
  filterAssignees: string[];
  onToggleAssignee: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onNewCard: () => void;
  notifications: Notification[];
  unreadCount: number;
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  onOpenCard: (cardId: string) => void;
  onRenameBoard: (name: string) => void;
  onSetBoardAccent: (accent: string) => void;
  onSetBoardTheme: (theme: "light" | "dark") => void;
  onSetBoardCanvas: (canvas: string | null) => void;
  onArchiveBoard: () => void;
  onDeleteBoard: () => void;
  onShareBoard: (email: string, firstName: string, lastName: string) => Promise<void>;
};

export function Topbar({
  boards,
  users,
  activeBoardId,
  activeView,
  filterAssignees,
  onToggleAssignee,
  search,
  onSearchChange,
  onNewCard,
  notifications,
  unreadCount,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenCard,
  onRenameBoard,
  onSetBoardAccent,
  onSetBoardTheme,
  onSetBoardCanvas,
  onArchiveBoard,
  onDeleteBoard,
  onShareBoard,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const board = boards.find((b) => b.id === activeBoardId)!;
  // Title reflects context. Home is deliberately blank in the topbar —
  // the page body carries its own structure and the workspace mark in
  // the sidebar handles identity. Views show their own name; boards
  // show the board name.
  const viewName =
    activeView === "board" || activeView === "home"
      ? null
      : savedViews.find((v) => v.id === activeView)?.name ?? null;
  const title =
    activeView === "home" ? null : viewName ?? board.name;

  // On Home the topbar is a quiet chrome strip — no search, no filters,
  // no primary CTA. Everything you can do there is already on the page.
  const isHome = activeView === "home";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="trello-topbar-offset flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-white/10 dark:bg-neutral-950 sm:gap-3 sm:px-6 sm:py-3">
      {title && (
        <div className="flex items-center gap-1.5">
          <h1 className="flex items-center gap-2.5 font-display text-[18px] text-ink-hi">
            {activeView === "board" && (
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-[3px] shadow-[0_0_12px_-2px_var(--tw-shadow-color)]"
                style={{
                  background: board.accent,
                  // @ts-expect-error — Tailwind's custom-property bridge; ok in style.
                  "--tw-shadow-color": board.accent,
                }}
              />
            )}
            {title}
          </h1>
          {activeView === "board" && (
            <BoardMenu
              board={board}
              onRename={onRenameBoard}
              onSetAccent={onSetBoardAccent}
              onSetTheme={onSetBoardTheme}
              onSetCanvas={onSetBoardCanvas}
              onArchive={onArchiveBoard}
              onDelete={onDeleteBoard}
              onShare={onShareBoard}
            />
          )}
        </div>
      )}

      {!isHome && (
        <div className="relative hidden w-full max-w-sm sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearchChange("");
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Search"
            className={cn(
              "h-8 w-full rounded-full bg-neutral-100 pl-8 pr-10 text-[13px] text-ink-hi placeholder:text-ink-mute",
              "border border-transparent focus:border-neutral-300 focus:bg-white",
              "outline-none transition-colors duration-100"
            )}
          />
          {search ? (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-mute hover:bg-neutral-200 hover:text-ink-hi"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : (
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-neutral-200 px-1 py-0 font-mono text-[10px] text-ink-mute">
              /
            </kbd>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Assignee filter — only when multi-user AND on a board (filters
          don't apply outside the board grid). Hidden on mobile to
          reclaim the horizontal budget; assignees still show on cards
          themselves and can be filtered via the sidebar drawer's
          "My cards" view when the user wants that lens. */}
      {!isHome && users.length > 1 && (
        <div className="hidden items-center gap-1 md:flex">
          {users.map((u) => {
            const active = filterAssignees.includes(u.id);
            const dim = filterAssignees.length > 0 && !active;
            return (
              <motion.button
                key={u.id}
                onClick={() => onToggleAssignee(u.id)}
                aria-label={`Filter by ${u.name}`}
                whileHover={{ y: -1, scale: 1.04 }}
                whileTap={{ scale: 0.9 }}
                transition={tapSpring}
                className="outline-none focus-visible:ring-2 focus-visible:ring-helios-500/60 rounded-full"
              >
                <Avatar name={u.name} hue={u.hue} size="md" active={active} dim={dim} />
              </motion.button>
            );
          })}
        </div>
      )}

      <NotificationsPopover
        users={users}
        boards={boards}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkRead={onMarkNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
        onOpenCard={onOpenCard}
      />

      {!isHome && (
        <Button variant="primary" size="md" onClick={onNewCard}>
          <Plus className="h-4 w-4" />
          {/* Label hides at very-narrow widths; the plus icon is the
              understood affordance and reclaims topbar space for the
              board title next to it. */}
          <span className="hidden xs:inline sm:inline">New card</span>
        </Button>
      )}
    </header>
  );
}
