"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  Board as BoardType,
  BoardId,
  Card,
  CardId,
  List,
  ListId,
  User,
} from "@/lib/trello/types";
import { type UserProfile } from "@/lib/trello/types";

/**
 * Patch shape accepted by useBoardState.updateProfile. Widens
 * UserProfile with the three identity fields (firstName / lastName /
 * role) that live on the `users` table so the Profile page can edit
 * everything through one prop.
 */
export type ProfileEditPatch = Partial<UserProfile> & {
  firstName?: string;
  lastName?: string;
  role?: string;
};
import type { Notification } from "@/lib/trello/types";
import type { Workspace, WorkspaceMember } from "@/lib/trello/types";
import type { LoadedWorkspace } from "@/app/trello/actions/loadWorkspace";
import * as listActions from "@/app/trello/actions/lists";
import * as boardActions from "@/app/trello/actions/boards";
import { shareBoard as shareBoardAction } from "@/app/trello/actions/boardShare";
import { updateProfile as updateProfileAction, type ProfilePatch } from "@/app/trello/actions/profile";
import {
  createWorkspace as createWorkspaceAction,
  renameWorkspace as renameWorkspaceAction,
  setWorkspaceAccent as setWorkspaceAccentAction,
  deleteWorkspace as deleteWorkspaceAction,
} from "@/app/trello/actions/workspaces";
import {
  removeWorkspaceMember as removeWorkspaceMemberAction,
  setWorkspaceMemberRole as setWorkspaceMemberRoleAction,
} from "@/app/trello/actions/workspaceMembers";
import { deleteUser as deleteUserAction } from "@/app/trello/actions/users";
import { DEFAULT_LIST_NAMES } from "@/lib/trello/boardDefaults";
import * as cardActions from "@/app/trello/actions/cards";
import * as childActions from "@/app/trello/actions/cardChildren";
import * as favoriteActions from "@/app/trello/actions/favorites";
import * as notificationActions from "@/app/trello/actions/notifications";
import * as attachmentActions from "@/app/trello/actions/attachments";
import * as labelActions from "@/app/trello/actions/labels";
import { LINK_MIME } from "@/lib/trello/attachmentTypes";

/**
 * Fire a server action without blocking UI. Mutations are optimistic —
 * local state updates immediately; if the DB write fails we surface it
 * to the console for now (proper toasts land with the auth PR).
 */
function persist(name: string, p: Promise<unknown>) {
  p.catch((err) => console.error(`[persist:${name}]`, err));
}

/** UUID string, browser + modern Node compatible. */
/** Same deterministic hue algo as loadWorkspace's hueFromString — keep
 *  in sync so an optimistically-added user's avatar color matches what
 *  the next full reload will show. */
function hueFromEmail(email: string): number {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function uid() {
  return crypto.randomUUID();
}

/**
 * Real notifications derived from the current card state. Solo mode
 * means assignment / mention / comment notifications don't fire (you
 * can't @-mention yourself) — the meaningful signals are due-date
 * reminders, which the fan-out below computes at read time.
 *
 * IDs are deterministic (`due_soon:{cardId}` / `due_overdue:{cardId}`)
 * so the "read" set can persist across re-derivations.
 */
function deriveNotifications(
  cards: Card[],
  userId: string,
  readIds: Set<string>
): Notification[] {
  const now = new Date();
  const soonWindowMs = 48 * 60 * 60 * 1000;
  const trackWindowMs = 14 * 24 * 60 * 60 * 1000;
  const out: Notification[] = [];

  for (const c of cards) {
    // Due-date signals — for assignees / creators of open cards.
    if (!c.complete && (c.assigneeIds.includes(userId) || c.createdById === userId) && c.due) {
      const due = new Date(c.due);
      const delta = due.getTime() - now.getTime();
      if (delta < 0) {
        const id = `due_overdue:${c.id}`;
        out.push({
          id,
          userId,
          type: "due_overdue",
          entityType: "card",
          entityUrl: `/cards/${c.id}`,
          cardId: c.id,
          boardId: c.boardId,
          preview: `${c.title} · ${friendlyDelta(delta)} overdue`,
          read: readIds.has(id),
          createdAt: c.due,
        });
      } else if (delta <= soonWindowMs) {
        const id = `due_soon:${c.id}`;
        out.push({
          id,
          userId,
          type: "due_soon",
          entityType: "card",
          entityUrl: `/cards/${c.id}`,
          cardId: c.id,
          boardId: c.boardId,
          preview: `${c.title} · due in ${friendlyDelta(delta)}`,
          read: readIds.has(id),
          createdAt: c.due,
        });
      }
    }

    // Track signals — every recent activity on a card the user tracks,
    // excluding their own actions (you don't notify yourself).
    if (c.trackerIds.includes(userId)) {
      for (const ac of c.activity) {
        if (ac.authorId === userId) continue;
        const at = new Date(ac.at).getTime();
        if (now.getTime() - at > trackWindowMs) continue;
        const id = `track:${ac.id}`;
        out.push({
          id,
          userId,
          type: "track_activity",
          entityType: "card",
          entityUrl: `/cards/${c.id}`,
          actorId: ac.authorId,
          cardId: c.id,
          boardId: c.boardId,
          preview: `${c.title} · ${ac.detail}`,
          read: readIds.has(id),
          createdAt: ac.at,
        });
      }
    }
  }

  // Newest-first.
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function friendlyDelta(ms: number) {
  const abs = Math.abs(ms);
  const h = Math.round(abs / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

export type ActiveView =
  | "home"
  | "board"
  | "sv_mine"
  | "sv_week"
  | "sv_activity"
  | "sv_archive"
  | "sv_profile";

export function useBoardState(initial: LoadedWorkspace) {
  // Data is hydrated on the server and passed in as `initial`, so the
  // client starts fully populated — no skeleton, no client→server round
  // trip on mount. Mutations still update local state optimistically.
  const [users, setUsers] = useState<User[]>(initial.users);
  const [me, setMe] = useState<User>(initial.me);
  const [cards, setCards] = useState<Card[]>(initial.cards);
  const [lists, setLists] = useState<List[]>(initial.lists);
  const [boards, setBoards] = useState<BoardType[]>(initial.boards);
  const [archivedBoards, setArchivedBoards] = useState<BoardType[]>(initial.archivedBoards);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initial.workspaces);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(initial.workspaceMembers);
  const [activeBoardId, setActiveBoardId] = useState<string>(initial.boards[0]?.id ?? "");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(initial.workspaces[0]?.id ?? "");
  // Default view is the workspaces home so users land on the hero
  // page. Selecting a board or a saved view takes them elsewhere.
  const [activeView, setActiveView] = useState<ActiveView>("home");
  const [activeCardId, setActiveCardId] = useState<CardId | null>(null);
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [draftListId, setDraftListId] = useState<ListId | null>(null);
  // Profile is DB-backed via user_profiles (see 0003 migration). We
  // hydrate from initial.profile and persist edits through the
  // updateProfile server action.
  const [profile, setProfile] = useState<UserProfile>(initial.profile);
  // Favorite board ids — seeded from server; kept in sync via
  // `favoriteActions.toggleFavoriteBoard`.
  const [favoriteBoardIds, setFavoriteBoardIds] = useState<string[]>(initial.favoriteBoardIds);
  // NOTIFICATIONS are derived from card + activity state; this Set
  // tracks which notifications the user has marked read so the state
  // persists across re-derivation. Seeded from `notification_reads`.
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(
    () => new Set(initial.readNotificationIds)
  );

  const currentUserId = me.id;

  // Switching to a board always returns us to board view; the caller
  // shouldn't need to reset both states in every click handler.
  const selectBoard = useCallback((id: string) => {
    setActiveBoardId(id);
    setActiveView("board");
  }, []);

  const cardCountsByBoard = useMemo(() => {
    return cards.reduce<Record<string, number>>((acc, c) => {
      acc[c.boardId] = (acc[c.boardId] ?? 0) + 1;
      return acc;
    }, {});
  }, [cards]);

  // Sidebar view badges: only surface counts that read as "open items
  // that still need attention" — completed / past cards aren't counted.
  const viewCounts = useMemo(() => {
    const now = new Date();
    const soon = new Date();
    soon.setDate(now.getDate() + 7);
    let mine = 0;
    let week = 0;
    for (const c of cards) {
      if (c.complete) continue;
      const isMine = c.assigneeIds.includes(currentUserId);
      if (isMine) mine++;
      if (c.due) {
        const t = new Date(c.due).getTime();
        if (t <= soon.getTime()) week++;
      }
    }
    // Activity is a stream — a numeric badge would flap; leave it 0.
    return { sv_mine: mine, sv_week: week, sv_activity: 0 };
  }, [cards]);

  const moveCard = useCallback(
    (cardId: CardId, toListId: ListId, toIndex: number) => {
      const fromListId = cards.find((c) => c.id === cardId)?.listId;
      setCards((prev) => {
        const withoutMoved = prev.filter((c) => c.id !== cardId);
        const moved = prev.find((c) => c.id === cardId);
        if (!moved) return prev;
        const updatedMoved: Card = { ...moved, listId: toListId };
        // Compute indices in the target list only.
        const targetIndices: number[] = [];
        withoutMoved.forEach((c, i) => {
          if (c.listId === toListId) targetIndices.push(i);
        });
        const insertAt = targetIndices[toIndex] ?? withoutMoved.length;
        return [
          ...withoutMoved.slice(0, insertAt),
          updatedMoved,
          ...withoutMoved.slice(insertAt),
        ];
      });
      const meta =
        me && fromListId
          ? { actorId: me.id, activityId: uid(), fromListId }
          : undefined;
      persist("moveCard", cardActions.moveCard(cardId, toListId, toIndex, meta));
    },
    [cards, me]
  );

  const createWorkspace = useCallback(
    async (name: string, description: string) => {
      const created = await createWorkspaceAction({ name, description });
      const optimisticWorkspace: Workspace = {
        id: created.id,
        name: created.name,
        slug: created.slug,
        ownerId: created.ownerId,
        description: created.description,
        tagline: "",
        visibility: "private",
        accent: "#FF5E1A",
        createdAt: created.createdAt,
      };
      setWorkspaces((prev) => [...prev, optimisticWorkspace]);
      setWorkspaceMembers((prev) => [
        ...prev,
        {
          id: `wm-${created.id}`,
          workspaceId: created.id,
          userId: created.ownerId,
          role: "owner",
          joinedAt: created.createdAt,
        },
      ]);
      setActiveWorkspaceId(created.id);
      setActiveView("home");
      return created.id;
    },
    [],
  );

  const switchWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setActiveView("home");
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
    );
    persist("renameWorkspace", renameWorkspaceAction(id, trimmed));
  }, []);

  const setWorkspaceAccent = useCallback((id: string, accent: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, accent } : w)),
    );
    persist("setWorkspaceAccent", setWorkspaceAccentAction(id, accent));
  }, []);

  const deleteWorkspace = useCallback(
    async (id: string): Promise<void> => {
      await deleteWorkspaceAction(id);
      // Server accepted — strip the workspace and everything under it
      // from local state. If it was active, land the user on any other
      // workspace they still have.
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      setWorkspaceMembers((prev) => prev.filter((wm) => wm.workspaceId !== id));
      setBoards((prev) => prev.filter((b) => b.workspaceId !== id));
      setArchivedBoards((prev) => prev.filter((b) => b.workspaceId !== id));
      setLists((prev) =>
        prev.filter((l) => !boards.find((b) => b.id === l.boardId && b.workspaceId === id)),
      );
      setCards((prev) =>
        prev.filter((c) => !boards.find((b) => b.id === c.boardId && b.workspaceId === id)),
      );
      setActiveWorkspaceId((prev) => {
        if (prev !== id) return prev;
        const next = workspaces.find((w) => w.id !== id);
        return next?.id ?? "";
      });
      setActiveView("home");
    },
    [boards, workspaces],
  );

  const removeWorkspaceMember = useCallback(
    async (workspaceId: string, userId: string): Promise<void> => {
      await removeWorkspaceMemberAction(workspaceId, userId);
      setWorkspaceMembers((prev) =>
        prev.filter(
          (wm) => !(wm.workspaceId === workspaceId && wm.userId === userId),
        ),
      );
    },
    [],
  );

  const deleteUser = useCallback(
    async (userId: string): Promise<void> => {
      await deleteUserAction(userId);
      // The user's own workspaces are already gone server-side; strip
      // any workspaces we hold locally that they own. Cascades in-app
      // to boards/lists/cards under those workspaces.
      const nukedWorkspaceIds = new Set(
        workspaces.filter((w) => w.ownerId === userId).map((w) => w.id),
      );
      if (nukedWorkspaceIds.size > 0) {
        setWorkspaces((prev) =>
          prev.filter((w) => !nukedWorkspaceIds.has(w.id)),
        );
        setBoards((prev) =>
          prev.filter((b) => !nukedWorkspaceIds.has(b.workspaceId)),
        );
        setArchivedBoards((prev) =>
          prev.filter((b) => !nukedWorkspaceIds.has(b.workspaceId)),
        );
        setLists((prev) =>
          prev.filter(
            (l) => !boards.find((b) => b.id === l.boardId && nukedWorkspaceIds.has(b.workspaceId)),
          ),
        );
        setCards((prev) =>
          prev.filter(
            (c) => !boards.find((b) => b.id === c.boardId && nukedWorkspaceIds.has(b.workspaceId)),
          ),
        );
      }
      // Strip the user from every place they might still be referenced.
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setWorkspaceMembers((prev) => prev.filter((wm) => wm.userId !== userId));
      setCards((prev) =>
        prev.map((c) => ({
          ...c,
          assigneeIds: c.assigneeIds.filter((id) => id !== userId),
          trackerIds: c.trackerIds.filter((id) => id !== userId),
        })),
      );
    },
    [boards, workspaces],
  );

  const setWorkspaceMemberRole = useCallback(
    async (
      workspaceId: string,
      userId: string,
      role: "owner" | "admin" | "member" | "guest",
    ): Promise<void> => {
      await setWorkspaceMemberRoleAction(workspaceId, userId, role);
      setWorkspaceMembers((prev) =>
        prev.map((wm) =>
          wm.workspaceId === workspaceId && wm.userId === userId
            ? { ...wm, role }
            : wm,
        ),
      );
    },
    [],
  );

  const addBoard = useCallback(
    (name: string, workspaceId: string, accent: string) => {
      if (!me) return null;
      const id = uid();
      const defaultListIds: [string, string, string] = [uid(), uid(), uid()];
      const newBoard: BoardType = {
        id,
        name,
        accent,
        fields: [],
        labels: [],
        workspaceId,
        visibility: "private",
        archived: false,
        theme: "light",
        canvas: null,
      };
      const newLists: List[] = DEFAULT_LIST_NAMES.map((n, i) => ({
        id: defaultListIds[i],
        boardId: id,
        name: n,
      }));
      setBoards((prev) => [...prev, newBoard]);
      setLists((prev) => [...prev, ...newLists]);
      persist(
        "createBoard",
        boardActions.createBoard({
          id,
          workspaceId,
          name,
          accent,
          createdBy: me.id,
          defaultListIds,
        }),
      );
      return id;
    },
    [me],
  );

  const renameBoard = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name: trimmed } : b)));
    persist("renameBoard", boardActions.renameBoard(id, trimmed));
  }, []);

  const setBoardAccent = useCallback((id: string, accent: string) => {
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, accent } : b)));
    persist("setBoardAccent", boardActions.setBoardAccent(id, accent));
  }, []);

  const setBoardTheme = useCallback((id: string, theme: "light" | "dark") => {
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, theme } : b)));
    persist("setBoardTheme", boardActions.setBoardTheme(id, theme));
  }, []);

  const setBoardCanvas = useCallback((id: string, canvas: string | null) => {
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, canvas } : b)));
    persist("setBoardCanvas", boardActions.setBoardCanvas(id, canvas));
  }, []);

  const archiveBoard = useCallback((id: string) => {
    // Move the board from `boards` to `archivedBoards` so it disappears
    // from the sidebar + main views but the Archived view can offer
    // restore. Server-side just flips the `archived` flag.
    setBoards((prev) => {
      const target = prev.find((b) => b.id === id);
      if (target) {
        setArchivedBoards((arch) => [...arch, { ...target, archived: true }]);
      }
      return prev.filter((b) => b.id !== id);
    });
    setActiveBoardId((prev) => (prev === id ? "" : prev));
    setActiveView((prev) => (prev === "board" ? "home" : prev));
    persist("setBoardArchived", boardActions.setBoardArchived(id, true));
  }, []);

  const unarchiveBoard = useCallback((id: string) => {
    setArchivedBoards((prev) => {
      const target = prev.find((b) => b.id === id);
      if (target) {
        setBoards((b) => [...b, { ...target, archived: false }]);
      }
      return prev.filter((b) => b.id !== id);
    });
    persist("unarchiveBoard", boardActions.unarchiveBoard(id));
  }, []);

  const deleteBoard = useCallback((id: string) => {
    // Hard delete — cascades server-side, so also remove all local
    // lists + cards that belong to it. Applies whether the board was
    // active or already archived, so remove from both collections.
    setBoards((prev) => prev.filter((b) => b.id !== id));
    setArchivedBoards((prev) => prev.filter((b) => b.id !== id));
    setLists((prev) => prev.filter((l) => l.boardId !== id));
    setCards((prev) => prev.filter((c) => c.boardId !== id));
    setActiveBoardId((prev) => (prev === id ? "" : prev));
    setActiveView((prev) => (prev === "board" ? "home" : prev));
    persist("deleteBoard", boardActions.deleteBoard(id));
  }, []);

  const createLabel = useCallback(
    (boardId: string, name: string, color: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const id = uid();
      setBoards((prev) =>
        prev.map((b) =>
          b.id === boardId
            ? { ...b, labels: [...b.labels, { id, name: trimmed, color }] }
            : b,
        ),
      );
      persist(
        "createLabel",
        labelActions.createLabel({ id, boardId, name: trimmed, color }),
      );
      return id;
    },
    [],
  );

  const renameLabel = useCallback((labelId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((prev) =>
      prev.map((b) => ({
        ...b,
        labels: b.labels.map((l) =>
          l.id === labelId ? { ...l, name: trimmed } : l,
        ),
      })),
    );
    persist("renameLabel", labelActions.renameLabel(labelId, trimmed));
  }, []);

  const updateLabelColor = useCallback((labelId: string, color: string) => {
    setBoards((prev) =>
      prev.map((b) => ({
        ...b,
        labels: b.labels.map((l) => (l.id === labelId ? { ...l, color } : l)),
      })),
    );
    persist("updateLabelColor", labelActions.updateLabelColor(labelId, color));
  }, []);

  const deleteLabel = useCallback((labelId: string) => {
    // Remove the label everywhere it appears (board palette + every
    // card that had it applied). Server-side cascade handles the DB.
    setBoards((prev) =>
      prev.map((b) => ({
        ...b,
        labels: b.labels.filter((l) => l.id !== labelId),
      })),
    );
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        labelIds: c.labelIds.filter((id) => id !== labelId),
      })),
    );
    persist("deleteLabel", labelActions.deleteLabel(labelId));
  }, []);

  const moveBoardToWorkspace = useCallback(
    (boardId: string, workspaceId: string) => {
      setBoards((prev) =>
        prev.map((b) => (b.id === boardId ? { ...b, workspaceId } : b)),
      );
      persist(
        "moveBoardToWorkspace",
        boardActions.moveBoardToWorkspace(boardId, workspaceId),
      );
    },
    [],
  );

  const shareBoard = useCallback(
    async (boardId: string, email: string, firstName: string, lastName: string) => {
      const result = await shareBoardAction({ boardId, email, firstName, lastName });
      setUsers((prev) => {
        if (prev.some((u) => u.id === result.userId)) return prev;
        return [
          ...prev,
          {
            id: result.userId,
            firstName: result.firstName,
            lastName: result.lastName,
            name: `${result.firstName} ${result.lastName}`.trim(),
            role: "",
            // hueFromString stays consistent with loadWorkspace's hue derivation
            // for users who haven't picked a swatch yet.
            hue: hueFromEmail(email),
          },
        ];
      });
    },
    [],
  );

  const addList = useCallback((boardId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = uid();
    setLists((prev) => [...prev, { id, boardId, name: trimmed }]);
    persist("createList", listActions.createList(id, boardId, trimmed));
    return id;
  }, []);

  const renameList = useCallback((id: ListId, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)));
    persist("renameList", listActions.renameList(id, trimmed));
  }, []);

  const deleteList = useCallback((id: ListId) => {
    setLists((prev) => prev.filter((l) => l.id !== id));
    setCards((prev) => prev.filter((c) => c.listId !== id));
    persist("deleteList", listActions.deleteList(id));
  }, []);

  const sortCardsInList = useCallback(
    (listId: ListId, by: "title" | "due") => {
      setCards((prev) => {
        const inList = prev.filter((c) => c.listId === listId);
        const sorted = [...inList].sort((a, b) => {
          if (by === "title") return a.title.localeCompare(b.title);
          // due — nulls sink to the bottom
          const ad = a.due ? new Date(a.due).getTime() : Infinity;
          const bd = b.due ? new Date(b.due).getTime() : Infinity;
          return ad - bd;
        });
        // Rebuild the full array: keep non-list cards where they are,
        // and interleave the sorted list cards back into their original slots.
        let sortedIdx = 0;
        return prev.map((c) =>
          c.listId === listId ? sorted[sortedIdx++] : c
        );
      });
    },
    []
  );

  const reorderLists = useCallback((boardId: string, orderedIds: ListId[]) => {
    setLists((prev) => {
      const idIndex = new Map(orderedIds.map((id, i) => [id, i]));
      const thisBoardLists = prev
        .filter((l) => l.boardId === boardId)
        .sort(
          (a, b) => (idIndex.get(a.id) ?? 0) - (idIndex.get(b.id) ?? 0)
        );
      const result: typeof prev = [];
      let boardSliceIdx = 0;
      for (const l of prev) {
        if (l.boardId === boardId) {
          result.push(thisBoardLists[boardSliceIdx++]);
        } else {
          result.push(l);
        }
      }
      return result;
    });
    persist("reorderLists", listActions.reorderLists(boardId, orderedIds));
  }, []);

  const addCard = useCallback(
    (listId: ListId, title: string) => {
      const list = lists.find((l) => l.id === listId);
      if (!list || !me) return null;
      const id = uid();
      const activityId = uid();
      const now = new Date().toISOString();
      const next: Card = {
        id,
        boardId: list.boardId,
        listId,
        title,
        description: "",
        labelIds: [],
        assigneeIds: [],
        trackerIds: [],
        due: null,
        fieldValues: {},
        checklists: [],
        attachments: [],
        comments: [],
        activity: [
          {
            id: activityId,
            authorId: me.id,
            kind: "created",
            detail: "created this card",
            at: now,
          },
        ],
        createdById: me.id,
        createdAt: now,
      };
      setCards((prev) => [next, ...prev]);
      setActiveCardId(id);
      persist(
        "createCard",
        cardActions.createCard({
          id,
          boardId: list.boardId,
          listId,
          title,
          createdBy: me.id,
          activityId,
        }),
      );
      return id;
    },
    [lists, me]
  );

  const updateCard = useCallback((id: CardId, patch: Partial<Card>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Only the DB-backed columns get forwarded — labels/assignees have
    // their own toggle actions, and checklists/comments have their own.
    const dbPatch: cardActions.UpdateCardPatch = {};
    if ("title" in patch) dbPatch.title = patch.title!;
    if ("description" in patch) dbPatch.description = patch.description ?? null;
    if ("due" in patch) dbPatch.due = patch.due ?? null;
    if (Object.keys(dbPatch).length) {
      const meta =
        me && "due" in patch
          ? { actorId: me.id, dueActivityId: uid() }
          : me
            ? { actorId: me.id }
            : undefined;
      persist("updateCard", cardActions.updateCard(id, dbPatch, meta));
    }
  }, [me]);

  const toggleChecklistItem = useCallback(
    (cardId: CardId, checklistId: string, itemId: string) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                checklists: c.checklists.map((cl) =>
                  cl.id !== checklistId
                    ? cl
                    : {
                        ...cl,
                        items: cl.items.map((it) =>
                          it.id !== itemId ? it : { ...it, done: !it.done }
                        ),
                      }
                ),
              }
        )
      );
      const meta = me ? { actorId: me.id, activityId: uid() } : undefined;
      persist("toggleChecklistItem", childActions.toggleChecklistItem(itemId, meta));
    },
    [me]
  );

  const addChecklistItem = useCallback(
    (cardId: CardId, checklistId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = uid();
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                checklists: c.checklists.map((cl) =>
                  cl.id !== checklistId
                    ? cl
                    : { ...cl, items: [...cl.items, { id, text: trimmed, done: false }] }
                ),
              }
        )
      );
      persist(
        "createChecklistItem",
        childActions.createChecklistItem(id, checklistId, trimmed),
      );
    },
    []
  );

  const deleteChecklistItem = useCallback(
    (cardId: CardId, checklistId: string, itemId: string) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                checklists: c.checklists.map((cl) =>
                  cl.id !== checklistId
                    ? cl
                    : { ...cl, items: cl.items.filter((it) => it.id !== itemId) }
                ),
              }
        )
      );
      persist("deleteChecklistItem", childActions.deleteChecklistItem(itemId));
    },
    []
  );

  const addChecklist = useCallback((cardId: CardId, title: string) => {
    const t = title.trim() || "Checklist";
    const id = uid();
    setCards((prev) =>
      prev.map((c) =>
        c.id !== cardId
          ? c
          : { ...c, checklists: [...c.checklists, { id, title: t, items: [] }] }
      )
    );
    persist("createChecklist", childActions.createChecklist(id, cardId, t));
  }, []);

  const addComment = useCallback((cardId: CardId, body: string) => {
    const trimmed = body.trim();
    if (!trimmed || !me) return;
    const now = new Date().toISOString();
    const id = uid();
    setCards((prev) =>
      prev.map((c) =>
        c.id !== cardId
          ? c
          : {
              ...c,
              comments: [
                {
                  id,
                  authorId: me.id,
                  body: trimmed,
                  at: now,
                },
                ...c.comments,
              ],
            }
      )
    );
    persist(
      "createComment",
      childActions.createComment(id, cardId, me.id, trimmed, uid()),
    );
  }, [me]);

  const addLinkAttachment = useCallback(
    (cardId: CardId, url: string, title: string) => {
      if (!me) return;
      const trimmedUrl = url.trim();
      if (!trimmedUrl) return;
      const displayTitle = title.trim() || trimmedUrl;
      const id = uid();
      const now = new Date().toISOString();
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                attachments: [
                  ...c.attachments,
                  {
                    id,
                    name: displayTitle,
                    mime: LINK_MIME,
                    url: trimmedUrl,
                    addedAt: now,
                  },
                ],
              }
        )
      );
      persist(
        "createLinkAttachment",
        attachmentActions.createLinkAttachment({
          id,
          cardId,
          uploadedBy: me.id,
          url: trimmedUrl,
          title: displayTitle,
        }),
      );
    },
    [me],
  );

  const deleteAttachment = useCallback((cardId: CardId, attachmentId: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id !== cardId
          ? c
          : {
              ...c,
              attachments: c.attachments.filter((a) => a.id !== attachmentId),
            }
      )
    );
    persist("deleteAttachment", attachmentActions.deleteAttachment(attachmentId));
  }, []);

  const toggleCardAssignee = useCallback(
    (cardId: CardId, userId: string) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                assigneeIds: c.assigneeIds.includes(userId)
                  ? c.assigneeIds.filter((id) => id !== userId)
                  : [...c.assigneeIds, userId],
              }
        )
      );
      const meta = me ? { actorId: me.id, activityId: uid() } : undefined;
      persist("toggleCardMember", childActions.toggleCardMember(cardId, userId, meta));
    },
    [me],
  );

  const toggleCardTracker = useCallback((cardId: CardId, userId: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id !== cardId
          ? c
          : {
              ...c,
              trackerIds: c.trackerIds.includes(userId)
                ? c.trackerIds.filter((id) => id !== userId)
                : [...c.trackerIds, userId],
            }
      )
    );
    persist("toggleCardTracker", childActions.toggleCardTracker(cardId, userId));
  }, []);

  const toggleCardLabel = useCallback(
    (cardId: CardId, labelId: string) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id !== cardId
            ? c
            : {
                ...c,
                labelIds: c.labelIds.includes(labelId)
                  ? c.labelIds.filter((id) => id !== labelId)
                  : [...c.labelIds, labelId],
              }
        )
      );
      const meta = me ? { actorId: me.id, activityId: uid() } : undefined;
      persist("toggleCardLabel", childActions.toggleCardLabel(cardId, labelId, meta));
    },
    [me],
  );

  const toggleCardComplete = useCallback((cardId: CardId) => {
    let nextComplete = false;
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId) return c;
        nextComplete = !c.complete;
        return { ...c, complete: nextComplete };
      })
    );
    persist("setCardComplete", cardActions.setCardComplete(cardId, nextComplete));
  }, []);

  const copyCard = useCallback((cardId: CardId) => {
    const src = cards.find((c) => c.id === cardId);
    if (!src || !me) return null;
    const newId = uid();
    const activityId = uid();
    const now = new Date().toISOString();
    const copy: Card = {
      ...src,
      id: newId,
      title: `${src.title} (copy)`,
      comments: [],
      activity: [
        {
          id: activityId,
          authorId: me.id,
          kind: "created",
          detail: "copied from another card",
          at: now,
        },
      ],
      createdAt: now,
    };
    setCards((prev) => {
      // Insert directly after the source card in the same list.
      const idx = prev.findIndex((c) => c.id === cardId);
      return idx < 0 ? [copy, ...prev] : [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
    persist(
      "copyCard",
      cardActions.copyCard({ newId, srcId: cardId, createdBy: me.id, activityId }),
    );
    return newId;
  }, [cards, me]);

  const archiveCard = useCallback((cardId: CardId) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setActiveCardId((prev) => (prev === cardId ? null : prev));
    persist("archiveCard", cardActions.archiveCard(cardId));
  }, []);

  const toggleFilterAssignee = useCallback((userId: string) => {
    setFilterAssignees((prev) =>
      prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
    );
  }, []);

  const updateProfile = useCallback(
    (patch: ProfileEditPatch) => {
      // Split identity fields (live on users.*) from profile fields
      // (user_profiles.*). Local state gets both; server action gets both.
      const identityChanged =
        patch.firstName !== undefined ||
        patch.lastName !== undefined ||
        patch.role !== undefined ||
        (patch.hue !== undefined && patch.hue !== null);

      if (identityChanged) {
        setMe((prev) => {
          const nextFirst = patch.firstName ?? prev.firstName;
          const nextLast = patch.lastName ?? prev.lastName;
          return {
            ...prev,
            firstName: nextFirst,
            lastName: nextLast,
            name: `${nextFirst} ${nextLast}`.trim(),
            role: patch.role ?? prev.role,
            hue:
              patch.hue !== undefined && patch.hue !== null
                ? patch.hue
                : prev.hue,
          };
        });
        // Mirror onto the roster so pickers / avatars everywhere refresh.
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id !== me.id) return u;
            const nextFirst = patch.firstName ?? u.firstName;
            const nextLast = patch.lastName ?? u.lastName;
            return {
              ...u,
              firstName: nextFirst,
              lastName: nextLast,
              name: `${nextFirst} ${nextLast}`.trim(),
              role: patch.role ?? u.role,
              hue:
                patch.hue !== undefined && patch.hue !== null
                  ? patch.hue
                  : u.hue,
            };
          }),
        );
      }

      setProfile((prev) => ({
        ...prev,
        tagline: patch.tagline ?? prev.tagline,
        bio: patch.bio ?? prev.bio,
        timezone: patch.timezone ?? prev.timezone,
        pronouns: patch.pronouns !== undefined ? patch.pronouns : prev.pronouns,
        availability: patch.availability ?? prev.availability,
        hue: patch.hue !== undefined ? patch.hue : prev.hue,
        notify: { ...prev.notify, ...(patch.notify ?? {}) },
      }));

      // Flatten to the server patch shape (nested notify → four columns).
      const serverPatch: ProfilePatch = {};
      if (patch.firstName !== undefined) serverPatch.firstName = patch.firstName;
      if (patch.lastName !== undefined) serverPatch.lastName = patch.lastName;
      if (patch.role !== undefined) serverPatch.role = patch.role;
      if (patch.tagline !== undefined) serverPatch.tagline = patch.tagline;
      if (patch.bio !== undefined) serverPatch.bio = patch.bio;
      if (patch.timezone !== undefined) serverPatch.timezone = patch.timezone;
      if (patch.pronouns !== undefined)
        serverPatch.pronouns = patch.pronouns ?? null;
      if (patch.availability !== undefined)
        serverPatch.availability = patch.availability;
      if (patch.hue !== undefined) serverPatch.hue = patch.hue;
      if (patch.notify?.mentions !== undefined)
        serverPatch.notifyMentions = patch.notify.mentions;
      if (patch.notify?.assignments !== undefined)
        serverPatch.notifyAssignments = patch.notify.assignments;
      if (patch.notify?.dueSoon !== undefined)
        serverPatch.notifyDueSoon = patch.notify.dueSoon;
      if (patch.notify?.dailyDigest !== undefined)
        serverPatch.notifyDigest = patch.notify.dailyDigest;

      if (Object.keys(serverPatch).length > 0) {
        persist("updateProfile", updateProfileAction(serverPatch));
      }
    },
    [me],
  );

  const toggleFavoriteBoard = useCallback(
    (boardId: string) => {
      if (!me) return;
      setFavoriteBoardIds((prev) =>
        prev.includes(boardId) ? prev.filter((id) => id !== boardId) : [...prev, boardId],
      );
      persist("toggleFavoriteBoard", favoriteActions.toggleFavoriteBoard(me.id, boardId));
    },
    [me],
  );

  const markNotificationRead = useCallback(
    (id: string) => {
      if (!me) return;
      setReadNotifIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      persist("markNotificationRead", notificationActions.markNotificationRead(me.id, id));
    },
    [me],
  );

  const myFavoriteBoardIds = favoriteBoardIds;
  // Real notifications, computed from the current card state each render.
  const myNotifications = useMemo(
    () => deriveNotifications(cards, currentUserId, readNotifIds),
    [cards, readNotifIds]
  );
  const unreadCount = useMemo(
    () => myNotifications.filter((n) => !n.read).length,
    [myNotifications]
  );

  const markAllNotificationsRead = useCallback(() => {
    if (!me) return;
    // Snapshot all currently-derived ids into the read set. Any brand
    // new due-soon fired after this still shows as unread.
    const ids = myNotifications.map((n) => n.id);
    setReadNotifIds(new Set(ids));
    persist(
      "markNotificationsRead",
      notificationActions.markNotificationsRead(me.id, ids),
    );
  }, [me, myNotifications]);

  // May be undefined during the hydration flash before boards load.
  // Consumers gate on `loading` before rendering board UI, so a
  // transient undefined is fine.
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? null,
    [boards, activeBoardId]
  );

  const listsForActiveBoard = useMemo(
    () => lists.filter((l) => l.boardId === activeBoardId),
    [lists, activeBoardId]
  );

  const cardsForActiveBoard = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (c.boardId !== activeBoardId) return false;
      if (filterAssignees.length > 0) {
        if (!c.assigneeIds.some((a) => filterAssignees.includes(a))) return false;
      }
      if (q) {
        const hay = `${c.title} ${c.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, activeBoardId, filterAssignees, search]);

  // Search-filtered card set for cross-board views. Assignee filter is
  // deliberately NOT applied here — the views apply their own scoping
  // (My Cards = current user; Due this week / Activity = everyone) and
  // layering the topbar filter on top would make it confusing.
  const cardsForViews = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const hay = `${c.title} ${c.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, search]);

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeCardId) ?? null,
    [cards, activeCardId]
  );

  return {
    me,
    // data
    users,
    boards,
    activeBoard,
    lists: listsForActiveBoard,
    cards: cardsForActiveBoard,
    // Unfiltered card set — the views (My Cards / Due this week / Activity)
    // need to look across every board, not just the active one.
    allCards: cardsForViews,
    allLists: lists,
    cardCountsByBoard,
    viewCounts,
    // selection
    activeBoardId,
    setActiveBoardId: selectBoard,
    activeView,
    setActiveView,
    activeCardId,
    setActiveCardId,
    activeCard,
    // filter
    filterAssignees,
    toggleFilterAssignee,
    search,
    setSearch,
    // draft
    draftListId,
    setDraftListId,
    // workspaces
    workspaces,
    workspaceMembers,
    activeWorkspaceId,
    setActiveWorkspaceId,
    // profile
    profile,
    updateProfile,
    toggleFavoriteBoard,
    myFavoriteBoardIds,
    // notifications
    notifications: myNotifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    // mutations
    moveCard,
    addCard,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    setWorkspaceAccent,
    deleteWorkspace,
    removeWorkspaceMember,
    setWorkspaceMemberRole,
    deleteUser,
    addBoard,
    renameBoard,
    setBoardAccent,
    setBoardTheme,
    setBoardCanvas,
    archiveBoard,
    unarchiveBoard,
    deleteBoard,
    moveBoardToWorkspace,
    shareBoard,
    createLabel,
    renameLabel,
    updateLabelColor,
    deleteLabel,
    archivedBoards,
    addList,
    renameList,
    reorderLists,
    deleteList,
    sortCardsInList,
    updateCard,
    toggleChecklistItem,
    addChecklistItem,
    deleteChecklistItem,
    addChecklist,
    addComment,
    addLinkAttachment,
    deleteAttachment,
    toggleCardAssignee,
    toggleCardTracker,
    toggleCardLabel,
    toggleCardComplete,
    copyCard,
    archiveCard,
  };
}
