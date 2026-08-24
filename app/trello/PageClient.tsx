"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Topbar } from "@/components/trello/shell/Topbar";
import { Board } from "@/components/trello/board/Board";
import { CardDetail } from "@/components/trello/card/CardDetail";
import { NewBoardDialog } from "@/components/trello/board/NewBoardDialog";
import { MyCardsView } from "@/components/trello/views/MyCardsView";
import { DueThisWeekView } from "@/components/trello/views/DueThisWeekView";
import { ActivityView } from "@/components/trello/views/ActivityView";
import { ArchivedBoardsView } from "@/components/trello/views/ArchivedBoardsView";
import { ProfileView } from "@/components/trello/views/ProfileView";
import { HomeView } from "@/components/trello/views/HomeView";
import { useBoardState } from "@/lib/trello/useBoardState";
import { parseTrelloSearch, trelloHref } from "@/lib/trello/viewUrl";
import { usersInWorkspace, usersNotInWorkspace } from "@/lib/trello/workspace-access";
import type { LoadedWorkspace } from "@/app/trello/actions/loadWorkspace";

const paneEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
};

export default function PageClient({ initial }: { initial: LoadedWorkspace }) {
  const s = useBoardState(initial);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardWorkspaceId, setNewBoardWorkspaceId] = useState<string | null>(null);

  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    const parsed = parseTrelloSearch(search);
    s.setActiveView(parsed.view);
    if (parsed.boardId) s.setActiveBoardId(parsed.boardId);
  }, [search, s.setActiveView, s.setActiveBoardId]);

  const activeCardList = s.activeCard
    ? s.allLists.find((l) => l.id === s.activeCard!.listId)
    : null;
  const activeCardBoard = s.activeCard
    ? s.boards.find((b) => b.id === s.activeCard!.boardId)
    : null;

  const me = s.me;
  const activeBoard =
    s.activeView === "board"
      ? s.boards.find((b) => b.id === s.activeBoardId)
      : null;
  const boardFilterUsers = activeBoard
    ? usersInWorkspace(s.users, s.workspaceMembers, activeBoard.workspaceId)
    : [];
  const boardShareCandidates = activeBoard
    ? usersNotInWorkspace(s.users, s.workspaceMembers, activeBoard.workspaceId, me.id)
    : [];
  const rootThemeClass = activeBoard?.theme === "dark" ? "dark" : "";

  return (
    <div className={`relative flex h-full bg-white dark:bg-neutral-950 ${rootThemeClass}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          boards={s.boards}
          users={s.users}
          activeBoardId={s.activeBoardId}
          activeView={s.activeView}
          filterAssignees={s.filterAssignees}
          onToggleAssignee={s.toggleFilterAssignee}
          search={s.search}
          onSearchChange={s.setSearch}
          onNewCard={() => {
            const firstList = s.allLists.find(
              (l) => l.boardId === s.activeBoardId
            );
            if (firstList) {
              if (s.activeView !== "board") {
                router.push(trelloHref("board", s.activeBoardId));
              }
              s.setDraftListId(firstList.id);
            }
          }}
          notifications={s.notifications}
          unreadCount={s.unreadCount}
          onMarkNotificationRead={s.markNotificationRead}
          onMarkAllNotificationsRead={s.markAllNotificationsRead}
          onOpenCard={s.setActiveCardId}
          onRenameBoard={(name) => s.renameBoard(s.activeBoardId, name)}
          onSetBoardAccent={(accent) => s.setBoardAccent(s.activeBoardId, accent)}
          onSetBoardTheme={(theme) => s.setBoardTheme(s.activeBoardId, theme)}
          onSetBoardCanvas={(canvas) => s.setBoardCanvas(s.activeBoardId, canvas)}
          onArchiveBoard={() => s.archiveBoard(s.activeBoardId)}
          onDeleteBoard={() => s.deleteBoard(s.activeBoardId)}
          onShareBoard={(userId) => s.shareBoard(s.activeBoardId, userId)}
          filterUsers={boardFilterUsers}
          shareCandidates={boardShareCandidates}
        />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={
                s.activeView === "board"
                  ? `board:${s.activeBoardId}`
                  : s.activeView
              }
              {...paneEnter}
              className="flex min-h-0 flex-1 flex-col"
            >
              {s.activeView === "home" && (
                <HomeView
                  me={me}
                  profile={s.profile}
                  workspaces={s.workspaces}
                  members={s.workspaceMembers}
                  boards={s.boards}
                  cards={s.allCards}
                  lists={s.allLists}
                  users={s.users}
                  favoriteBoardIds={s.myFavoriteBoardIds}
                  onEnterBoard={(id) => {
                    router.push(trelloHref("board", id));
                  }}
                  onOpenCard={s.setActiveCardId}
                  onSelectView={(v) => router.push(trelloHref(v))}
                  onNewBoardInWorkspace={(workspaceId) => {
                    setNewBoardWorkspaceId(workspaceId);
                    setNewBoardOpen(true);
                  }}
                  onMoveBoardToWorkspace={s.moveBoardToWorkspace}
                  onCreateWorkspace={s.createWorkspace}
                  onRenameWorkspace={s.renameWorkspace}
                  onSetWorkspaceAccent={s.setWorkspaceAccent}
                  onDeleteWorkspace={s.deleteWorkspace}
                  onAddWorkspaceMember={s.addWorkspaceMember}
                  onRemoveWorkspaceMember={s.removeWorkspaceMember}
                  onSetWorkspaceMemberRole={s.setWorkspaceMemberRole}
                  onDeleteUser={s.deleteUser}
                />
              )}

              {s.activeView === "board" && s.activeBoard && (
                <Board
                  board={s.activeBoard}
                  lists={s.lists}
                  cards={s.cards}
                  users={s.users}
                  meId={me.id}
                  onOpenCard={s.setActiveCardId}
                  onArchiveCard={s.archiveCard}
                  onToggleCompleteCard={s.toggleCardComplete}
                  onAddCard={s.addCard}
                  onAddList={s.addList}
                  onMoveCard={s.moveCard}
                  onReorderLists={s.reorderLists}
                  onRenameList={s.renameList}
                  onDeleteList={s.deleteList}
                  onSortCards={s.sortCardsInList}
                  draftListId={s.draftListId}
                  setDraftListId={s.setDraftListId}
                />
              )}

              {s.activeView === "sv_mine" && (
                <MyCardsView
                  me={me}
                  cards={s.allCards}
                  lists={s.allLists}
                  boards={s.boards}
                  users={s.users}
                  onOpenCard={s.setActiveCardId}
                  onToggleComplete={s.toggleCardComplete}
                />
              )}

              {s.activeView === "sv_week" && (
                <DueThisWeekView
                  cards={s.allCards}
                  lists={s.allLists}
                  boards={s.boards}
                  users={s.users}
                  onOpenCard={s.setActiveCardId}
                  onToggleComplete={s.toggleCardComplete}
                />
              )}

              {s.activeView === "sv_activity" && (
                <ActivityView
                  cards={s.allCards}
                  lists={s.allLists}
                  boards={s.boards}
                  users={s.users}
                  onOpenCard={s.setActiveCardId}
                />
              )}

              {s.activeView === "sv_archive" && (
                <ArchivedBoardsView
                  archivedBoards={s.archivedBoards}
                  workspaces={s.workspaces}
                  onUnarchive={s.unarchiveBoard}
                  onDelete={s.deleteBoard}
                />
              )}

              {s.activeView === "sv_profile" && (
                <ProfileView
                  me={me}
                  profile={s.profile}
                  cards={s.allCards}
                  lists={s.allLists}
                  boards={s.boards}
                  favoriteBoardIds={s.myFavoriteBoardIds}
                  onUpdate={s.updateProfile}
                  onToggleFavoriteBoard={s.toggleFavoriteBoard}
                  onOpenCard={s.setActiveCardId}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {s.activeCard && activeCardList && activeCardBoard && (
          <CardDetail
            key={s.activeCard.id}
            card={s.activeCard}
            board={activeCardBoard}
            list={activeCardList}
            users={s.users}
            onClose={() => s.setActiveCardId(null)}
            onUpdate={(patch) => s.updateCard(s.activeCard!.id, patch)}
            onToggleAssignee={(userId) =>
              s.toggleCardAssignee(s.activeCard!.id, userId)
            }
            onToggleLabel={(labelId) =>
              s.toggleCardLabel(s.activeCard!.id, labelId)
            }
            onToggleComplete={() => s.toggleCardComplete(s.activeCard!.id)}
            onToggleChecklistItem={(clId, itemId) =>
              s.toggleChecklistItem(s.activeCard!.id, clId, itemId)
            }
            onAddChecklistItem={(clId, text) =>
              s.addChecklistItem(s.activeCard!.id, clId, text)
            }
            onDeleteChecklistItem={(clId, itemId) =>
              s.deleteChecklistItem(s.activeCard!.id, clId, itemId)
            }
            onAddChecklist={(title) => s.addChecklist(s.activeCard!.id, title)}
            onAddComment={(body) => s.addComment(s.activeCard!.id, body)}
            onCopy={() => {
              const id = s.activeCard!.id;
              const newId = s.copyCard(id);
              if (newId) s.setActiveCardId(newId);
            }}
            onArchive={() => s.archiveCard(s.activeCard!.id)}
            onToggleTracker={() => s.toggleCardTracker(s.activeCard!.id, me.id)}
            isTracking={s.activeCard.trackerIds.includes(me.id)}
            onAddLink={(url, title) =>
              s.addLinkAttachment(s.activeCard!.id, url, title)
            }
            onDeleteAttachment={(attachmentId) =>
              s.deleteAttachment(s.activeCard!.id, attachmentId)
            }
            onCreateLabel={(name, color) =>
              s.createLabel(activeCardBoard!.id, name, color)
            }
            onRenameLabel={s.renameLabel}
            onDeleteLabel={s.deleteLabel}
          />
        )}
      </AnimatePresence>

      <NewBoardDialog
        open={newBoardOpen}
        onOpenChange={(open) => {
          setNewBoardOpen(open);
          if (!open) setNewBoardWorkspaceId(null);
        }}
        workspaces={s.workspaces}
        defaultWorkspaceId={
          newBoardWorkspaceId ??
          s.activeWorkspaceId ??
          s.workspaces[0]?.id ??
          ""
        }
        onCreate={(name, workspaceId, accent) => {
          const id = s.addBoard(name, workspaceId, accent);
          if (id) router.push(trelloHref("board", id));
          return id;
        }}
      />
    </div>
  );
}
