'use server';

import { dbQuery } from '@/lib/db';
import { activityEntry, iso, type ActivityRow } from '@/lib/trello/card-details';
import { ensureTrelloProfile } from '@/lib/trello/ensure-profile';
import { hueFromString, requireTrelloSession } from '@/lib/trello/session';
import type {
  ActivityEntry,
  Board,
  Card,
  List,
  User,
  UserProfile,
  Workspace,
  WorkspaceMember,
} from '@/lib/trello/types';

export type LoadedWorkspace = {
  users: User[];
  me: User;
  profile: UserProfile;
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  boards: Board[];
  archivedBoards: Board[];
  lists: List[];
  cards: Card[];
  favoriteBoardIds: string[];
  readNotificationIds: string[];
};

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return raw.slice(0, 10);
}

export async function loadWorkspace(): Promise<LoadedWorkspace> {
  const session = await requireTrelloSession();
  const meId = session.userId;
  await ensureTrelloProfile(meId, session.email);

  const usersRowsQuery = dbQuery<{
    id: string;
    email: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    role: string | null;
    hue: number | null;
  }>(
    `SELECT u.id, u.email, u.display_name,
            p.first_name, p.last_name, p.role, p.hue
       FROM outreach.users u
       LEFT JOIN boards.user_profiles p ON p.user_id = u.id
      ORDER BY u.display_name ASC, u.email ASC`,
  );

  const workspaceMembersRowsQuery = dbQuery<{
    id: string;
    workspace_id: string;
    user_id: string;
    role: WorkspaceMember['role'];
    joined_at: Date;
  }>('SELECT id, workspace_id, user_id, role, joined_at FROM boards.workspace_members');

  const workspacesRowsQuery = dbQuery<{
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    description: string | null;
    accent: string;
    visibility: Workspace['visibility'];
    created_at: Date;
  }>('SELECT id, name, slug, owner_id, description, accent, visibility, created_at FROM boards.workspaces');

  const boardsRowsQuery = dbQuery<{
    id: string;
    name: string;
    workspace_id: string;
    background: string | null;
    canvas: string | null;
    theme: 'light' | 'dark';
    visibility: Board['visibility'];
    archived: boolean;
  }>(`SELECT id, name, workspace_id, background, canvas, theme, visibility, archived FROM boards.boards`);

  const boardMembersRowsQuery = dbQuery<{ board_id: string; user_id: string }>(
    'SELECT board_id, user_id FROM boards.board_members',
  );

  const labelsRowsQuery = dbQuery<{ id: string; board_id: string; name: string; color: string }>(
    'SELECT id, board_id, name, color FROM boards.labels',
  );
  const listsRowsQuery = dbQuery<{ id: string; board_id: string; name: string; position: number }>(
    'SELECT id, board_id, name, position FROM boards.lists ORDER BY position',
  );
  const cardsRowsQuery = dbQuery<{
    id: string;
    board_id: string;
    list_id: string;
    title: string;
    description: string | null;
    position: number;
    due_date: Date | string | null;
    due_completed: boolean;
    created_by: string;
    created_at: Date;
  }>(
    `SELECT id, board_id, list_id, title, description, position, due_date, due_completed, created_by, created_at
       FROM boards.cards
      ORDER BY position`,
  );

  const cardMembersRowsQuery = dbQuery<{ card_id: string; user_id: string }>(
    'SELECT card_id, user_id FROM boards.card_members',
  );
  const cardLabelsRowsQuery = dbQuery<{ card_id: string; label_id: string }>(
    'SELECT card_id, label_id FROM boards.card_labels',
  );
  const cardTrackersRowsQuery = dbQuery<{ card_id: string; user_id: string }>(
    'SELECT card_id, user_id FROM boards.card_trackers',
  );
  // A card's checklists, attachments, comments and activity load when it opens
  // (app/trello/actions/cardDetails.ts). The board needs only their counts, the
  // viewer's latest activity per card (Home's recent boards), and the last 14 days
  // of activity on cards the viewer tracks (notifications).
  const checklistCountsQuery = dbQuery<{ card_id: string; total: number; done: number }>(
    `SELECT cl.card_id, count(i.id)::int AS total, count(i.id) FILTER (WHERE i.completed)::int AS done
       FROM boards.checklists cl
       JOIN boards.checklist_items i ON i.checklist_id = cl.id
      GROUP BY cl.card_id`,
  );
  const commentCountsQuery = dbQuery<{ card_id: string; n: number }>(
    'SELECT card_id, count(*)::int AS n FROM boards.comments WHERE deleted_at IS NULL GROUP BY card_id',
  );
  const attachmentCountsQuery = dbQuery<{ card_id: string; n: number }>(
    'SELECT card_id, count(*)::int AS n FROM boards.attachments GROUP BY card_id',
  );
  const myLastActivityQuery = dbQuery<{ card_id: string; at: Date }>(
    `SELECT card_id, max(created_at) AS at FROM boards.activity
      WHERE user_id = $1 AND card_id IS NOT NULL
      GROUP BY card_id`,
    [meId],
  );
  const trackedActivityQuery = dbQuery<ActivityRow & { card_id: string }>(
    `SELECT a.id, a.user_id, a.card_id, a.action_type, a.data, a.created_at
       FROM boards.activity a
       JOIN boards.card_trackers t ON t.card_id = a.card_id AND t.user_id = $1
      WHERE a.created_at > now() - interval '14 days'
      ORDER BY a.created_at DESC`,
    [meId],
  );
  const favoriteRowsQuery = dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.favorite_boards WHERE user_id = $1',
    [meId],
  );
  const readRowsQuery = dbQuery<{ notification_id: string }>(
    'SELECT notification_id FROM boards.notification_reads WHERE user_id = $1',
    [meId],
  );
  const myProfileQuery = dbQuery<{
    tagline: string;
    bio: string;
    timezone: string;
    pronouns: string | null;
    availability: UserProfile['availability'];
    hue: number | null;
    notify_mentions: boolean;
    notify_assignments: boolean;
    notify_due_soon: boolean;
    notify_digest: boolean;
    joined_at: Date;
  }>(
    `SELECT tagline, bio, timezone, pronouns, availability, hue,
            notify_mentions, notify_assignments, notify_due_soon, notify_digest, joined_at
       FROM boards.user_profiles WHERE user_id = $1 LIMIT 1`,
    [meId],
  );

  // Every read is independent (whole tables, filtered below), so they run together.
  const [
    usersRows,
    workspaceMembersRows,
    workspacesRows,
    boardsRows,
    boardMembersRows,
    labelsRows,
    listsRows,
    cardsRows,
    cardMembersRows,
    cardLabelsRows,
    cardTrackersRows,
    checklistCountRows,
    commentCountRows,
    attachmentCountRows,
    myLastActivityRows,
    trackedActivityRows,
    favoriteRows,
    readRows,
    myProfile,
  ] = await Promise.all([
    usersRowsQuery,
    workspaceMembersRowsQuery,
    workspacesRowsQuery,
    boardsRowsQuery,
    boardMembersRowsQuery,
    labelsRowsQuery,
    listsRowsQuery,
    cardsRowsQuery,
    cardMembersRowsQuery,
    cardLabelsRowsQuery,
    cardTrackersRowsQuery,
    checklistCountsQuery,
    commentCountsQuery,
    attachmentCountsQuery,
    myLastActivityQuery,
    trackedActivityQuery,
    favoriteRowsQuery,
    readRowsQuery,
    myProfileQuery,
  ]);

  const myWorkspaceIds = new Set(
    workspaceMembersRows.rows.filter((m) => m.user_id === meId).map((m) => m.workspace_id),
  );
  const myBoardMemberIds = new Set(
    boardMembersRows.rows.filter((bm) => bm.user_id === meId).map((bm) => bm.board_id),
  );

  const visibleBoardIds = new Set<string>();
  for (const b of boardsRows.rows) {
    if (myWorkspaceIds.has(b.workspace_id) || myBoardMemberIds.has(b.id)) {
      visibleBoardIds.add(b.id);
    }
  }
  const visibleWorkspaceIds = new Set<string>(myWorkspaceIds);
  for (const b of boardsRows.rows) {
    if (visibleBoardIds.has(b.id)) visibleWorkspaceIds.add(b.workspace_id);
  }

  const visibleCards = cardsRows.rows.filter((c) => visibleBoardIds.has(c.board_id));
  const visibleCardIds = new Set(visibleCards.map((c) => c.id));


  const users: User[] = usersRows.rows.map((u) => {
    const first = u.first_name || u.display_name.split(' ')[0] || '';
    const last = u.last_name ?? u.display_name.split(' ').slice(1).join(' ');
    return {
      id: u.id,
      email: u.email,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`.trim() || u.display_name,
      role: u.role ?? '',
      hue: u.hue ?? hueFromString(u.email),
    };
  });
  const me = users.find((u) => u.id === meId) ?? {
    id: meId,
    email: session.email,
    firstName: session.email.split('@')[0] ?? 'You',
    lastName: '',
    name: session.email,
    role: '',
    hue: hueFromString(session.email),
  };
  if (!users.some((u) => u.id === meId)) users.unshift(me);

  // Workspace members can exist without an outreach.users row (local data
  // does this). They still need to be assignable on a card.
  const knownUserIds = new Set(users.map((u) => u.id));
  const missingMemberIds = [
    ...new Set(workspaceMembersRows.rows.map((m) => m.user_id)),
  ].filter((id) => !knownUserIds.has(id));
  if (missingMemberIds.length) {
    const { rows: profileRows } = await dbQuery<{
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      role: string | null;
      hue: number | null;
    }>(
      `SELECT user_id, first_name, last_name, role, hue
         FROM boards.user_profiles
        WHERE user_id = ANY($1::uuid[])`,
      [missingMemberIds],
    );
    for (const p of profileRows) {
      const first = p.first_name ?? '';
      const last = p.last_name ?? '';
      users.push({
        id: p.user_id,
        firstName: first,
        lastName: last,
        name: `${first} ${last}`.trim() || 'Member',
        role: p.role ?? '',
        hue: p.hue ?? hueFromString(p.user_id),
      });
    }
  }

  const workspaces: Workspace[] = workspacesRows.rows
    .filter((w) => visibleWorkspaceIds.has(w.id))
    .map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      ownerId: w.owner_id,
      description: w.description ?? '',
      tagline: '',
      visibility: w.visibility,
      accent: w.accent ?? '#FF5E1A',
      createdAt: iso(w.created_at),
    }));

  const workspaceMembers: WorkspaceMember[] = workspaceMembersRows.rows
    .filter((wm) => visibleWorkspaceIds.has(wm.workspace_id))
    .map((wm) => ({
      id: wm.id,
      workspaceId: wm.workspace_id,
      userId: wm.user_id,
      role: wm.role,
      joinedAt: iso(wm.joined_at),
    }));

  const labelsByBoard = new Map<string, { id: string; name: string; color: string }[]>();
  for (const l of labelsRows.rows) {
    if (!visibleBoardIds.has(l.board_id)) continue;
    const bucket = labelsByBoard.get(l.board_id) ?? [];
    bucket.push(l);
    labelsByBoard.set(l.board_id, bucket);
  }

  const toBoard = (b: (typeof boardsRows.rows)[number], withLabels: boolean): Board => ({
    id: b.id,
    name: b.name,
    accent: b.background ?? '#FF5E1A',
    fields: [],
    labels: withLabels
      ? (labelsByBoard.get(b.id) ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color }))
      : [],
    workspaceId: b.workspace_id,
    visibility: b.visibility,
    archived: b.archived,
    theme: b.theme ?? 'light',
    canvas: b.canvas ?? null,
  });

  const boards = boardsRows.rows.filter((b) => visibleBoardIds.has(b.id) && !b.archived).map((b) => toBoard(b, true));
  const archivedBoards = boardsRows.rows
    .filter((b) => b.archived && (myWorkspaceIds.has(b.workspace_id) || myBoardMemberIds.has(b.id)))
    .map((b) => toBoard(b, false));

  const lists: List[] = listsRows.rows
    .filter((l) => visibleBoardIds.has(l.board_id))
    .map((l) => ({ id: l.id, boardId: l.board_id, name: l.name }));

  const membersByCard = new Map<string, string[]>();
  for (const cm of cardMembersRows.rows) {
    if (!visibleCardIds.has(cm.card_id)) continue;
    const bucket = membersByCard.get(cm.card_id) ?? [];
    bucket.push(cm.user_id);
    membersByCard.set(cm.card_id, bucket);
  }
  const labelIdsByCard = new Map<string, string[]>();
  for (const cl of cardLabelsRows.rows) {
    if (!visibleCardIds.has(cl.card_id)) continue;
    const bucket = labelIdsByCard.get(cl.card_id) ?? [];
    bucket.push(cl.label_id);
    labelIdsByCard.set(cl.card_id, bucket);
  }
  const trackersByCard = new Map<string, string[]>();
  for (const t of cardTrackersRows.rows) {
    if (!visibleCardIds.has(t.card_id)) continue;
    const bucket = trackersByCard.get(t.card_id) ?? [];
    bucket.push(t.user_id);
    trackersByCard.set(t.card_id, bucket);
  }

  const checklistCounts = new Map(checklistCountRows.rows.map((r) => [r.card_id, r]));
  const commentCounts = new Map(commentCountRows.rows.map((r) => [r.card_id, r.n]));
  const attachmentCounts = new Map(attachmentCountRows.rows.map((r) => [r.card_id, r.n]));
  const myLastActivity = new Map(myLastActivityRows.rows.map((r) => [r.card_id, iso(r.at)]));
  const trackedActivityByCard = new Map<string, ActivityEntry[]>();
  for (const a of trackedActivityRows.rows) {
    if (!visibleCardIds.has(a.card_id)) continue;
    const bucket = trackedActivityByCard.get(a.card_id) ?? [];
    bucket.push(activityEntry(a));
    trackedActivityByCard.set(a.card_id, bucket);
  }

  const cards: Card[] = visibleCards.map((c) => ({
    id: c.id,
    boardId: c.board_id,
    listId: c.list_id,
    title: c.title,
    description: c.description ?? undefined,
    labelIds: labelIdsByCard.get(c.id) ?? [],
    assigneeIds: membersByCard.get(c.id) ?? [],
    trackerIds: trackersByCard.get(c.id) ?? [],
    due: isoDate(c.due_date),
    complete: c.due_completed,
    fieldValues: {},
    checklists: [],
    attachments: [],
    comments: [],
    activity: trackedActivityByCard.get(c.id) ?? [],
    createdById: c.created_by,
    createdAt: iso(c.created_at),
    detailsLoaded: false,
    counts: {
      checklistItems: checklistCounts.get(c.id)?.total ?? 0,
      checklistDone: checklistCounts.get(c.id)?.done ?? 0,
      comments: commentCounts.get(c.id) ?? 0,
      attachments: attachmentCounts.get(c.id) ?? 0,
    },
    myLastActivityAt: myLastActivity.get(c.id) ?? null,
  }));

  const profileRow = myProfile.rows[0];
  const profile: UserProfile = {
    userId: meId,
    tagline: profileRow?.tagline ?? '',
    bio: profileRow?.bio ?? '',
    timezone: profileRow?.timezone ?? 'America/New_York',
    pronouns: profileRow?.pronouns ?? undefined,
    availability: profileRow?.availability ?? 'available',
    hue: profileRow?.hue ?? null,
    notify: {
      mentions: profileRow?.notify_mentions ?? true,
      assignments: profileRow?.notify_assignments ?? true,
      dueSoon: profileRow?.notify_due_soon ?? true,
      dailyDigest: profileRow?.notify_digest ?? false,
    },
    joinedAt: iso(profileRow?.joined_at),
  };

  return {
    users,
    me,
    profile,
    workspaces,
    workspaceMembers,
    boards,
    archivedBoards,
    lists,
    cards,
    favoriteBoardIds: favoriteRows.rows.map((r) => r.board_id),
    readNotificationIds: readRows.rows.map((r) => r.notification_id),
  };
}
