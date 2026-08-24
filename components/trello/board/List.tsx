"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  ArrowDownAZ,
  CalendarClock,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/trello/utils";
import { SortableCard } from "@/components/trello/board/SortableCard";
import type { Board, Card, User, List as ListType } from "@/lib/trello/types";

type Props = {
  list: ListType;
  cards: Card[];
  board: Board;
  users: User[];
  meId?: string;
  onOpenCard: (id: string) => void;
  onArchiveCard?: (id: string) => void;
  onToggleCompleteCard?: (id: string) => void;
  onAddCard: (listId: string, title: string) => void;
  onRenameList: (listId: string, name: string) => void;
  onDeleteList: (listId: string) => void;
  onSortCards: (listId: string, by: "title" | "due") => void;
  isDraftOpen: boolean;
  setDraftOpen: (open: boolean) => void;
};

export function List({
  list,
  cards,
  board,
  users,
  meId,
  onOpenCard,
  onArchiveCard,
  onToggleCompleteCard,
  onAddCard,
  onRenameList,
  onDeleteList,
  onSortCards,
  isDraftOpen,
  setDraftOpen,
}: Props) {
  const {
    setNodeRef: setSortableRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
    data: { type: "list", listId: list.id },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: list.id,
    data: { type: "list", listId: list.id },
  });
  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDropRef(node);
  };
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(list.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!renaming) setRenameDraft(list.name);
  }, [list.name, renaming]);

  function commit() {
    const t = draft.trim();
    if (t) onAddCard(list.id, t);
    setDraft("");
    setDraftOpen(false);
  }

  function commitRename() {
    const t = renameDraft.trim();
    if (t && t !== list.name) onRenameList(list.id, t);
    setRenaming(false);
  }

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    // Override dnd-kit's default `ease` timing with the DS's slot-in curve.
    // Only applied while a reorder is in flight; static state stays snappy.
    transition: transition
      ? "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)"
      : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex w-[85vw] max-w-[320px] sm:w-[288px] shrink-0 snap-start snap-always flex-col rounded-[10px] surface-list transition-colors duration-100",
        "max-h-full",
        isOver && "bg-neutral-100",
        isDragging && "opacity-40"
      )}
    >
      {/* Column header — drag handle for the whole list, unless renaming */}
      <div
        {...(renaming ? {} : attributes)}
        {...(renaming ? {} : listeners)}
        className={cn(
          "flex items-center gap-2 px-3 pt-3 pb-2",
          !renaming && "cursor-grab active:cursor-grabbing"
        )}
      >
        {renaming ? (
          <input
            ref={renameRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                setRenameDraft(list.name);
                setRenaming(false);
              }
            }}
            onBlur={commitRename}
            className="min-w-0 flex-1 rounded-[6px] border border-neutral-200 bg-white px-1.5 py-0.5 text-[13.5px] font-semibold text-ink-hi outline-none focus:border-helios-500/60"
          />
        ) : (
          <>
            <h2
              onDoubleClick={() => setRenaming(true)}
              className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-hi dark:text-neutral-100"
            >
              {list.name}
            </h2>
            <span className="text-[11.5px] tabular-nums text-ink-mute dark:text-neutral-400">
              {cards.length}
            </span>
          </>
        )}
        {!renaming && (
          <ListMenu
            onRename={() => setRenaming(true)}
            onAddCard={() => setDraftOpen(true)}
            onSort={(by) => onSortCards(list.id, by)}
            onDelete={() => onDeleteList(list.id)}
          />
        )}
      </div>

      {/* Cards — scroll when list overflows */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {cards.map((card) => (
                <motion.li
                  key={card.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                >
                  <SortableCard
                    card={card}
                    board={board}
                    users={users}
                    meId={meId}
                    onOpen={() => onOpenCard(card.id)}
                    onArchive={() => onArchiveCard?.(card.id)}
                    onToggleComplete={() => onToggleCompleteCard?.(card.id)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </div>

      {/* Add a card — pinned to bottom */}
      <div className="shrink-0 p-2 pt-1">
        {isDraftOpen ? (
          <div className="surface-card rounded-[8px] p-3 shadow-card">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setDraft("");
                  setDraftOpen(false);
                }
              }}
              onBlur={commit}
              placeholder="Enter a title…"
              rows={2}
              className="w-full resize-none bg-transparent text-[14px] leading-[1.4] text-ink-hi placeholder:text-ink-mute outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setDraftOpen(true)}
            className="flex w-full items-center gap-1.5 rounded-[6px] px-2.5 py-2 text-left text-[13px] text-ink-mute hover:bg-neutral-50 hover:text-ink-mid transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a card
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── List menu ────────────────────────────────────────────────── */

function ListMenu({
  onRename,
  onAddCard,
  onSort,
  onDelete,
}: {
  onRename: () => void;
  onAddCard: () => void;
  onSort: (by: "title" | "due") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  function fire(fn: () => void) {
    return () => {
      setOpen(false);
      fn();
    };
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="rounded p-1 text-ink-mute hover:bg-neutral-50 hover:text-ink-mid transition-colors"
          aria-label="List actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-[60] w-52 rounded-[10px] surface-modal p-1.5 shadow-modal"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={fire(onAddCard)}>
            Add card
          </MenuItem>
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={fire(onRename)}>
            Rename list
          </MenuItem>
          <MenuDivider />
          <MenuLabel>Sort cards by</MenuLabel>
          <MenuItem
            icon={<ArrowDownAZ className="h-3.5 w-3.5" />}
            onClick={fire(() => onSort("title"))}
          >
            Title (A–Z)
          </MenuItem>
          <MenuItem
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            onClick={fire(() => onSort("due"))}
          >
            Due date
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={fire(onDelete)}
            danger
          >
            Delete list
          </MenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink-mid hover:bg-neutral-50 hover:text-ink-hi"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-neutral-50" />;
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
      {children}
    </div>
  );
}
