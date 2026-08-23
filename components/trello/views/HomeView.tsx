"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Board, Card, List, User } from "@/lib/trello/types";
import type { Workspace, WorkspaceMember } from "@/lib/trello/types";
import type { UserProfile } from "@/lib/trello/types";
import { cn } from "@/lib/trello/utils";
import { heliosEnter } from "@/lib/trello/motion";
import { Plus, Settings, Star } from "lucide-react";
import { NewWorkspaceDialog } from "@/components/trello/shell/NewWorkspaceDialog";
import { WorkspaceSettingsDialog } from "@/components/trello/shell/WorkspaceSettingsDialog";

/**
 * Home — Trello-style workspace landing.
 *
 * Structure (top to bottom):
 *   • "Recently viewed" — horizontal strip of the boards this user has
 *     touched most recently, favorites first. Non-draggable.
 *   • "Your workspaces" — one section per workspace the user belongs to,
 *     with a 4-col grid of that workspace's board tiles + a trailing
 *     "+ New board" tile. Board tiles can be dragged into any workspace
 *     the current user owns (workspaces the user only sees because of a
 *     shared board are not valid drop targets).
 *   • "View all closed boards" — muted footer link (placeholder for now).
 */

type Props = {
  me: User;
  profile: UserProfile;
  workspace: Workspace;
  workspaces: Workspace[];
  members: WorkspaceMember[];
  boards: Board[];
  cards: Card[];
  lists: List[];
  users: User[];
  favoriteBoardIds: string[];
  onEnterBoard: (boardId: string) => void;
  onOpenCard: (cardId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectView: (v: "sv_mine" | "sv_week" | "sv_activity") => void;
  /** Open the New Board dialog with a specific workspace pre-selected. */
  onNewBoardInWorkspace: (workspaceId: string) => void;
  /** Reassign a board from its current workspace to another one. */
  onMoveBoardToWorkspace: (boardId: string, workspaceId: string) => void;
  onCreateWorkspace: (name: string, description: string) => Promise<string>;
  onRenameWorkspace: (id: string, name: string) => void;
  onSetWorkspaceAccent: (id: string, accent: string) => void;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onRemoveWorkspaceMember: (workspaceId: string, userId: string) => Promise<void>;
  onSetWorkspaceMemberRole: (
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"],
  ) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
};

export function HomeView({
  me,
  workspace,
  workspaces,
  members,
  boards,
  cards,
  favoriteBoardIds,
  onEnterBoard,
  onSelectWorkspace,
  onNewBoardInWorkspace,
  onMoveBoardToWorkspace,
  users,
  onCreateWorkspace,
  onRenameWorkspace,
  onSetWorkspaceAccent,
  onDeleteWorkspace,
  onRemoveWorkspaceMember,
  onSetWorkspaceMemberRole,
  onDeleteUser,
}: Props) {
  const [draggingBoardId, setDraggingBoardId] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [settingsForWorkspaceId, setSettingsForWorkspaceId] = useState<string | null>(null);
  const settingsWorkspace = settingsForWorkspaceId
    ? workspaces.find((w) => w.id === settingsForWorkspaceId) ?? null
    : null;
  // 8px activation constraint lets a click still register as a click —
  // only movement past 8px starts a drag. Matches the sensor config the
  // board view uses so behavior is consistent app-wide.
  const sensors = useSensors(
    // Same mouse/touch split as the Board — click-to-open on desktop,
    // press-and-hold to drag on touch so a quick tap navigates to the
    // board instead of trying to drag it.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Which workspaces am I actually a member of? (Owned OR joined.) These
  // are the ones I can drop boards into.
  const myWorkspaceIds = useMemo(
    () =>
      new Set(members.filter((m) => m.userId === me.id).map((m) => m.workspaceId)),
    [members, me.id],
  );

  // Boards this user has touched, sorted by their most-recent activity.
  // Favorites bubble to the top of the recent list.
  const recentBoards = useMemo(() => {
    const lastByBoard = new Map<string, number>();
    for (const c of cards) {
      if (!c.assigneeIds.includes(me.id) && c.createdById !== me.id) continue;
      const times = c.activity
        .filter((a) => a.authorId === me.id)
        .map((a) => new Date(a.at).getTime());
      const last = times.length
        ? Math.max(...times)
        : new Date(c.createdAt).getTime();
      const prev = lastByBoard.get(c.boardId) ?? 0;
      if (last > prev) lastByBoard.set(c.boardId, last);
    }
    return [...boards]
      .filter((b) => lastByBoard.has(b.id) || favoriteBoardIds.includes(b.id))
      .sort((a, b) => {
        const aFav = favoriteBoardIds.includes(a.id) ? 1 : 0;
        const bFav = favoriteBoardIds.includes(b.id) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return (lastByBoard.get(b.id) ?? 0) - (lastByBoard.get(a.id) ?? 0);
      })
      .slice(0, 8);
  }, [boards, cards, favoriteBoardIds, me.id]);

  // Workspaces I have access to, in the order I joined. Includes
  // workspaces I only see because a board there was shared with me.
  const myWorkspaces = useMemo(() => {
    const seen = new Set<string>();
    // Owned/member workspaces first, in join order.
    const owned = members
      .filter((m) => m.userId === me.id)
      .map((m) => workspaces.find((w) => w.id === m.workspaceId))
      .filter((w): w is Workspace => !!w);
    for (const w of owned) seen.add(w.id);
    // Then any workspace the user has visibility into via board_members
    // (represented in the returned `workspaces` array by loadWorkspace)
    // but isn't a direct member of.
    const shared = workspaces.filter((w) => !seen.has(w.id));
    return [...owned, ...shared];
  }, [members, me.id, workspaces]);

  // Group boards by their actual workspace_id. Boards created via the
  // create-board flow set this correctly; loadWorkspace maps DB rows
  // through 1:1.
  const boardsByWorkspace = useMemo(() => {
    const map = new Map<string, Board[]>();
    for (const b of boards) {
      const arr = map.get(b.workspaceId) ?? [];
      arr.push(b);
      map.set(b.workspaceId, arr);
    }
    return map;
  }, [boards]);

  const draggingBoard = draggingBoardId
    ? boards.find((b) => b.id === draggingBoardId) ?? null
    : null;

  function handleDragStart(e: DragStartEvent) {
    setDraggingBoardId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setDraggingBoardId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const boardId = String(e.active.id);
    const targetWorkspaceId = String(overId);
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    if (board.workspaceId === targetWorkspaceId) return;
    if (!myWorkspaceIds.has(targetWorkspaceId)) return;
    onMoveBoardToWorkspace(boardId, targetWorkspaceId);
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[1180px] px-8 pb-24 pt-14">
        <DndContext
          id="trello-home"
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingBoardId(null)}
        >
          {/* Recently viewed — not draggable, since "recent" isn't tied to
              any workspace bucket. */}
          {recentBoards.length > 0 && (
            <motion.section {...heliosEnter(0)} className="mb-14">
              <div className="mb-5">
                <SectionHeader eyebrow="Recently viewed" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {recentBoards.map((b) => (
                  <BoardTile
                    key={b.id}
                    board={b}
                    starred={favoriteBoardIds.includes(b.id)}
                    onClick={() => onEnterBoard(b.id)}
                  />
                ))}
              </div>
            </motion.section>
          )}

          {/* Your workspaces */}
          <motion.section {...heliosEnter(1)}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <SectionHeader eyebrow="Your workspaces" />
              <button
                type="button"
                onClick={() => setNewWorkspaceOpen(true)}
                className="inline-flex items-center gap-1.5 text-[13px] text-ink-low transition-colors hover:text-ink-hi"
              >
                <Plus className="h-3.5 w-3.5" />
                New workspace
              </button>
            </div>
            <div className="space-y-10">
              {myWorkspaces.map((ws) => {
                const wsBoards = boardsByWorkspace.get(ws.id) ?? [];
                const owned = myWorkspaceIds.has(ws.id);
                const myRole = members.find((m) => m.userId === me.id && m.workspaceId === ws.id)?.role;
                return (
                  <WorkspaceGroup
                    key={ws.id}
                    workspace={ws}
                    boards={wsBoards}
                    favoriteBoardIds={favoriteBoardIds}
                    isCurrent={ws.id === workspace.id}
                    isDropEnabled={owned}
                    isDragActive={draggingBoardId !== null}
                    canManage={myRole === "owner" || myRole === "admin"}
                    onEnterBoard={onEnterBoard}
                    onSelectWorkspace={onSelectWorkspace}
                    onNewBoard={() => onNewBoardInWorkspace(ws.id)}
                    onOpenSettings={() => setSettingsForWorkspaceId(ws.id)}
                  />
                );
              })}
            </div>
          </motion.section>

          <DragOverlay dropAnimation={null}>
            {draggingBoard ? (
              <div className="pointer-events-none opacity-95">
                <BoardTile
                  board={draggingBoard}
                  starred={favoriteBoardIds.includes(draggingBoard.id)}
                  onClick={() => {}}
                  overlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Footer */}
        <motion.div
          {...heliosEnter(2)}
          className="mt-20 border-t border-neutral-200 pt-6 text-center"
        >
          <button
            type="button"
            className="text-[13px] text-ink-low transition-colors hover:text-ink-hi"
          >
            View all closed boards
          </button>
        </motion.div>
      </div>

      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        onCreate={async (name, description) => {
          await onCreateWorkspace(name, description);
        }}
      />

      {settingsWorkspace && (
        <WorkspaceSettingsDialog
          open={!!settingsForWorkspaceId}
          onOpenChange={(open) => !open && setSettingsForWorkspaceId(null)}
          workspace={settingsWorkspace}
          members={members}
          users={users}
          meId={me.id}
          onRename={(name) => onRenameWorkspace(settingsWorkspace.id, name)}
          onSetAccent={(accent) => onSetWorkspaceAccent(settingsWorkspace.id, accent)}
          onDelete={() => onDeleteWorkspace(settingsWorkspace.id)}
          onRemoveMember={(userId) => onRemoveWorkspaceMember(settingsWorkspace.id, userId)}
          onSetMemberRole={(userId, role) =>
            onSetWorkspaceMemberRole(settingsWorkspace.id, userId, role)
          }
          onDeleteUser={onDeleteUser}
        />
      )}
    </div>
  );
}

function SectionHeader({ eyebrow }: { eyebrow: string }) {
  return <div className="eyebrow eyebrow-ink">{eyebrow}</div>;
}

function WorkspaceGroup({
  workspace,
  boards,
  favoriteBoardIds,
  isCurrent,
  isDropEnabled,
  isDragActive,
  canManage,
  onEnterBoard,
  onSelectWorkspace,
  onNewBoard,
  onOpenSettings,
}: {
  workspace: Workspace;
  boards: Board[];
  favoriteBoardIds: string[];
  isCurrent: boolean;
  isDropEnabled: boolean;
  isDragActive: boolean;
  canManage: boolean;
  onEnterBoard: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
  onNewBoard: () => void;
  onOpenSettings: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: workspace.id,
    disabled: !isDropEnabled,
  });
  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelectWorkspace(workspace.id)}
        className={cn(
          "inline-flex items-center gap-3 rounded-full px-2 py-1 -mx-2 outline-none",
          "text-ink-hi transition-colors hover:bg-neutral-50",
          "focus-visible:ring-2 focus-visible:ring-helios-500/50",
        )}
        aria-label={`Switch to ${workspace.name}`}
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-[8px] text-[13px] font-display text-white shadow-sm"
          style={{
            background: `linear-gradient(135deg, ${workspace.accent}, ${shade(workspace.accent, -0.25)})`,
          }}
        >
          {workspaceInitial(workspace.name)}
        </span>
        <span className="font-display text-[16px] tracking-[-0.01em]">
          {workspace.name}
        </span>
        {isCurrent && (
          <span className="rounded-full bg-heliosGreen-600/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-heliosGreen-600">
            Current
          </span>
        )}
      </button>
      {canManage && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-mute transition-colors hover:bg-neutral-50 hover:text-ink-hi"
          aria-label={`Settings for ${workspace.name}`}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      )}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "rounded-[14px] transition-colors",
          // Only paint the drop-hover state on workspaces the caller can
          // drop into. Unowned workspaces stay quiet during a drag.
          isDropEnabled && isOver && "bg-helios-500/5 ring-2 ring-helios-500/40 -m-2 p-2",
          isDragActive && isDropEnabled && !isOver && "-m-2 p-2",
        )}
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {boards.map((b) => (
            <DraggableBoardTile
              key={b.id}
              board={b}
              starred={favoriteBoardIds.includes(b.id)}
              onClick={() => onEnterBoard(b.id)}
            />
          ))}
          <NewBoardTile onClick={onNewBoard} />
        </div>
      </div>
    </div>
  );
}

function DraggableBoardTile({
  board,
  starred,
  onClick,
}: {
  board: Board;
  starred: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: board.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // Fade the source tile while its overlay is being dragged so
      // there's an obvious "this is what you're carrying" signal.
      className={cn(isDragging && "opacity-40 transition-opacity")}
    >
      <BoardTile board={board} starred={starred} onClick={onClick} />
    </div>
  );
}

function BoardTile({
  board,
  starred,
  onClick,
  overlay,
}: {
  board: Board;
  starred: boolean;
  onClick: () => void;
  /** DragOverlay wants a slightly lifted variant. */
  overlay?: boolean;
}) {
  const art = boardArt(board.accent);
  return (
    <motion.button
      onClick={onClick}
      whileHover={overlay ? undefined : { y: -2 }}
      whileTap={overlay ? undefined : { scale: 0.99 }}
      transition={{ type: "spring", stiffness: 480, damping: 30 }}
      className={cn(
        "group relative flex h-[128px] w-full flex-col justify-between overflow-hidden rounded-[12px]",
        "text-left text-white outline-none transition-shadow duration-200",
        overlay ? "shadow-card-lift cursor-grabbing" : "shadow-card hover:shadow-card-lift",
        "focus-visible:ring-2 focus-visible:ring-helios-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
      )}
      style={{ background: art }}
    >
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-black/0 to-black/0" />
      {starred && (
        <span className="relative z-10 self-end p-2.5">
          <Star className="h-3.5 w-3.5 fill-white text-white drop-shadow" />
        </span>
      )}
      <span
        className={cn(
          "relative z-10 p-3 font-display text-[15px] uppercase tracking-[-0.005em]",
          !starred && "mt-auto",
        )}
      >
        {board.name}
      </span>
    </motion.button>
  );
}

function NewBoardTile({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 480, damping: 30 }}
      className={cn(
        "group relative flex h-[128px] w-full flex-col items-center justify-center gap-1.5 rounded-[12px]",
        "border-2 border-dashed border-neutral-200 bg-neutral-50/40 text-ink-mute",
        "transition-colors outline-none",
        "hover:border-helios-500/50 hover:bg-helios-500/[0.03] hover:text-helios-500",
        "focus-visible:ring-2 focus-visible:ring-helios-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
      )}
      aria-label="New board"
    >
      <Plus className="h-4 w-4" />
      <span className="text-[12.5px] font-medium tracking-tight">New board</span>
    </motion.button>
  );
}

function boardArt(accent: string) {
  // Give every tile a warm gradient composition. If the board defines its
  // own accent, use it as the base and blend toward the DS sunset stops
  // for continuity across tiles. Otherwise fall back to the canonical
  // sunset gradient.
  const stops = accent && accent.startsWith("#")
    ? `${accent}, #FF5E1A`
    : `#FFB347, #FF5E1A, #E03C1A`;
  return `linear-gradient(135deg, ${stops})`;
}

function workspaceInitial(name: string) {
  const first = name.trim().charAt(0).toUpperCase();
  return first || "?";
}

// Darken or lighten a `#RRGGBB` color by an amount in [-1, 1].
function shade(hex: string, amount: number) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = clamp(parseInt(m[1], 16) + Math.round(255 * amount));
  const g = clamp(parseInt(m[2], 16) + Math.round(255 * amount));
  const b = clamp(parseInt(m[3], 16) + Math.round(255 * amount));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
function clamp(n: number) {
  return Math.max(0, Math.min(255, n));
}
function hex2(n: number) {
  return n.toString(16).padStart(2, "0");
}
