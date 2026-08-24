"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/trello/ui/Button";
import { Avatar } from "@/components/trello/ui/Avatar";
import { savedViews, type Board, type User } from "@/lib/trello/types";
import { cn } from "@/lib/trello/utils";
import { Menu, Plus, Search, X } from "lucide-react";
import type { ActiveView } from "@/lib/trello/useBoardState";
import type { Notification } from "@/lib/trello/types";
import { motion } from "framer-motion";
import { NotificationsPopover } from "./NotificationsPopover";
import { BoardMenu } from "@/components/trello/board/BoardMenu";
import { useMobileNav } from "@/components/hub-shell/MobileNavContext";

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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const { openMobileNav } = useMobileNav();

  const board = boards.find((b) => b.id === activeBoardId)!;
  const viewName =
    activeView === "board" || activeView === "home"
      ? null
      : savedViews.find((v) => v.id === activeView)?.name ?? null;
  const title = activeView === "home" ? null : viewName ?? board.name;

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
    <header className="relative flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-neutral-950 sm:gap-3 sm:px-6 sm:py-3">
      {/* Burger menu button on mobile */}
      <button
        type="button"
        onClick={openMobileNav}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-mute transition-colors hover:bg-neutral-100 hover:text-ink-hi dark:hover:bg-neutral-800 md:hidden outline-none focus-visible:ring-2 focus-visible:ring-helios-500/50"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {title && (
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="flex min-w-0 items-center gap-2 font-display text-[15px] text-ink-hi sm:text-[18px]">
            {activeView === "board" && (
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded-[3px] shadow-[0_0_12px_-2px_var(--tw-shadow-color)]"
                style={{
                  background: board.accent,
                  // @ts-expect-error — Tailwind's custom-property bridge; ok in style.
                  "--tw-shadow-color": board.accent,
                }}
              />
            )}
            <span className="truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">
              {title}
            </span>
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

      {/* Full search input on sm+ */}
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

      {/* Compact overlay search input on mobile when active */}
      {!isHome && mobileSearchOpen && (
        <div className="absolute inset-x-0 inset-y-0 z-30 flex items-center gap-2 bg-white px-3 dark:bg-neutral-950 sm:hidden">
          <Search className="pointer-events-none h-4 w-4 shrink-0 text-ink-mute" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setMobileSearchOpen(false);
              }
            }}
            placeholder="Search cards..."
            className="h-9 w-full rounded-md bg-neutral-100 px-2 text-[14px] text-ink-hi placeholder:text-ink-mute outline-none dark:bg-neutral-800"
          />
          <button
            onClick={() => {
              onSearchChange("");
              setMobileSearchOpen(false);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-mute hover:bg-neutral-100 hover:text-ink-hi dark:hover:bg-neutral-800"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1" />

      {/* Mobile search toggle icon */}
      {!isHome && (
        <button
          type="button"
          onClick={() => setMobileSearchOpen(true)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-mute hover:bg-neutral-100 hover:text-ink-hi dark:hover:bg-neutral-800 sm:hidden"
          aria-label="Search cards"
        >
          <Search className="h-4 w-4" />
        </button>
      )}

      {/* Assignee filter — desktop multi-user */}
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
        <Button variant="primary" size="md" onClick={onNewCard} className="min-h-[36px]">
          <Plus className="h-4 w-4" />
          <span className="hidden xs:inline sm:inline">New card</span>
        </Button>
      )}
    </header>
  );
}
