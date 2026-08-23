"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import { ViewShell } from "./ViewShell";
import type { Board } from "@/lib/trello/types";
import type { Workspace } from "@/lib/trello/types";

type Props = {
  archivedBoards: Board[];
  workspaces: Workspace[];
  onUnarchive: (boardId: string) => void;
  onDelete: (boardId: string) => void;
};

/**
 * Archive shelf for boards that were soft-deleted from the sidebar.
 * Actions: restore (moves the board back to sidebar), or delete
 * permanently (hard cascade — confirmed inline).
 */
export function ArchivedBoardsView({
  archivedBoards,
  workspaces,
  onUnarchive,
  onDelete,
}: Props) {
  const workspaceName = (id: string) =>
    workspaces.find((w) => w.id === id)?.name ?? "Unknown workspace";

  return (
    <ViewShell
      eyebrow="Boards"
      title="Archived"
      description="Boards you've archived from the sidebar. Restore to bring them back, or delete permanently to drop them for good."
      empty={archivedBoards.length === 0}
      emptyState={
        <div className="text-center">
          <div className="eyebrow eyebrow-ink mb-3 opacity-60">Nothing archived</div>
          <div className="font-display text-[24px] text-ink-hi">
            Nothing has been archived yet.
          </div>
          <p className="mt-2 max-w-[40ch] text-[14px] text-ink-low">
            When you archive a board from its ••• menu, it lands here for safekeeping.
          </p>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {archivedBoards.map((b) => (
            <ArchivedCard
              key={b.id}
              board={b}
              workspaceName={workspaceName(b.workspaceId)}
              onUnarchive={() => onUnarchive(b.id)}
              onDelete={() => onDelete(b.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </ViewShell>
  );
}

function ArchivedCard({
  board,
  workspaceName,
  onUnarchive,
  onDelete,
}: {
  board: Board;
  workspaceName: string;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="surface-card rounded-[10px] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: board.accent }}
            />
            <h3 className="truncate font-display text-[15.5px] text-ink-hi">
              {board.name}
            </h3>
          </div>
          <p className="mt-1 text-[11.5px] uppercase tracking-[0.08em] text-ink-mute">
            {workspaceName}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-1.5">
        {confirming ? (
          <>
            <span className="mr-auto text-[12px] text-ink-mid">Delete forever?</span>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-full px-3 py-1 text-[12px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              className="rounded-full bg-danger px-3 py-1 text-[12px] font-medium text-white hover:bg-danger/90 transition-colors"
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setConfirming(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-mute",
                "hover:bg-danger/10 hover:text-danger transition-colors",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              onClick={onUnarchive}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium",
                "bg-helios-500/10 text-helios-500 hover:bg-helios-500/20 transition-colors",
              )}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              Restore
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
