'use server';

import { dbQuery } from '@/lib/db';
import { ensureTrelloProfile } from '@/lib/trello/ensure-profile';
import { hueFromString, requireTrelloSession } from '@/lib/trello/session';
import type {
  ActivityEntry,
  Attachment,
  Board,
  Card,
  Checklist,
  ChecklistItem,
  Comment,
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

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return raw.slice(0, 10);
}

export async function loadWorkspace(): Promise<LoadedWorkspace> {
  const session = await requireTrelloSession();
  const meId = session.userId;
  await ensureTrelloProfile(meId, session.email);

  const usersRows = await dbQuery<{
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

  const workspaceMembersRows = await dbQuery<{
    id: string;
    workspace_id: string;
    user_id: string;
    role: WorkspaceMember['role'];
    joined_at: Date;
  }>('SELECT id, workspace_id, user_id, role, joined_at FROM boards.workspace_members');

  const workspacesRows = await dbQuery<{
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    description: string | null;
    accent: string;
    visibility: Workspace['visibility'];
    created_at: Date;
  }>('SELECT id, name, slug, owner_id, description, accent, visibility, created_at FROM boards.workspaces');

  const boardsRows = await dbQuery<{
    id: string;
    name: string;
    workspace_id: string;
    background: string | null;
    canvas: string | null;
    theme: 'light' | 'dark';
    visibility: Board['visibility'];
    archived: boolean;
  }>(`SELECT id, name, workspace_id, background, canvas, theme, visibility, archived FROM boards.boards`);

  const boardMembersRows = await dbQuery<{ board_id: string; user_id: string }>(
    'SELECT board_id, user_id FROM boards.board_members',
  );

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

  const labelsRows = await dbQuery<{ id: string; board_id: string; name: string; color: string }>(
    'SELECT id, board_id, name, color FROM boards.labels',
  );
  const listsRows = await dbQuery<{ id: string; board_id: string; name: string; position: number }>(
    'SELECT id, board_id, name, position FROM boards.lists ORDER BY position',
  );
  const cardsRows = await dbQuery<{
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

  const visibleCards = cardsRows.rows.filter((c) => visibleBoardIds.has(c.board_id));
  const visibleCardIds = new Set(visibleCards.map((c) => c.id));

  const cardMembersRows = await dbQuery<{ card_id: string; user_id: string }>(
    'SELECT card_id, user_id FROM boards.card_members',
  );
  const cardLabelsRows = await dbQuery<{ card_id: string; label_id: string }>(
    'SELECT card_id, label_id FROM boards.card_labels',
  );
  const cardTrackersRows = await dbQuery<{ card_id: string; user_id: string }>(
    'SELECT card_id, user_id FROM boards.card_trackers',
  );
  const checklistsRows = await dbQuery<{
    id: string;
    card_id: string;
    title: string;
    position: number;
  }>('SELECT id, card_id, title, position FROM boards.checklists ORDER BY position');
  const checklistItemsRows = await dbQuery<{
    id: string;
    checklist_id: string;
    text: string;
    completed: boolean;
    position: number;
    due_date: Date | null;
  }>('SELECT id, checklist_id, text, completed, position, due_date FROM boards.checklist_items ORDER BY position');
  const commentsRows = await dbQuery<{
    id: string;
    card_id: string;
    user_id: string;
    body: string;
    created_at: Date;
  }>('SELECT id, card_id, user_id, body, created_at FROM boards.comments WHERE deleted_at IS NULL ORDER BY created_at');
  const attachmentsRows = await dbQuery<{
    id: string;
    card_id: string;
    file_name: string;
    mime_type: string;
    file_url: string;
    created_at: Date;
  }>('SELECT id, card_id, file_name, mime_type, file_url, created_at FROM boards.attachments ORDER BY created_at');
  const activityRows = await dbQuery<{
    id: string;
    user_id: string;
    card_id: string | null;
    action_type: string;
    data: { detail?: string } | string | null;
    created_at: Date;
  }>('SELECT id, user_id, card_id, action_type, data, created_at FROM boards.activity ORDER BY created_at DESC');
  const favoriteRows = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.favorite_boards WHERE user_id = $1',
    [meId],
  );
  const readRows = await dbQuery<{ notification_id: string }>(
    'SELECT notification_id FROM boards.notification_reads WHERE user_id = $1',
    [meId],
  );
  const myProfile = await dbQuery<{
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

  const visibleChecklists = checklistsRows.rows.filter((cl) => visibleCardIds.has(cl.card_id));
  const visibleChecklistIds = new Set(visibleChecklists.map((cl) => cl.id));
  const itemsByChecklist = new Map<string, ChecklistItem[]>();
  for (const it of checklistItemsRows.rows) {
    if (!visibleChecklistIds.has(it.checklist_id)) continue;
    const bucket = itemsByChecklist.get(it.checklist_id) ?? [];
    bucket.push({
      id: it.id,
      text: it.text,
      done: it.completed,
      due: it.due_date ? iso(it.due_date) : null,
    });
    itemsByChecklist.set(it.checklist_id, bucket);
  }
  const checklistsByCard = new Map<string, Checklist[]>();
  for (const cl of visibleChecklists) {
    const bucket = checklistsByCard.get(cl.card_id) ?? [];
    bucket.push({ id: cl.id, title: cl.title, items: itemsByChecklist.get(cl.id) ?? [] });
    checklistsByCard.set(cl.card_id, bucket);
  }

  const commentsByCard = new Map<string, Comment[]>();
  for (const cm of commentsRows.rows) {
    if (!visibleCardIds.has(cm.card_id)) continue;
    const bucket = commentsByCard.get(cm.card_id) ?? [];
    bucket.push({ id: cm.id, authorId: cm.user_id, body: cm.body, at: iso(cm.created_at) });
    commentsByCard.set(cm.card_id, bucket);
  }
  const attachmentsByCard = new Map<string, Attachment[]>();
  for (const at of attachmentsRows.rows) {
    if (!visibleCardIds.has(at.card_id)) continue;
    const bucket = attachmentsByCard.get(at.card_id) ?? [];
    bucket.push({
      id: at.id,
      name: at.file_name,
      mime: at.mime_type,
      url: at.file_url,
      addedAt: iso(at.created_at),
    });
    attachmentsByCard.set(at.card_id, bucket);
  }
  const activityByCard = new Map<string, ActivityEntry[]>();
  for (const a of activityRows.rows) {
    if (!a.card_id || !visibleCardIds.has(a.card_id)) continue;
    const bucket = activityByCard.get(a.card_id) ?? [];
    bucket.push({
      id: a.id,
      authorId: a.user_id,
      kind: a.action_type as ActivityEntry['kind'],
      detail:
        (typeof a.data === 'object' && a.data && 'detail' in a.data ? a.data.detail : null)
        ?? (typeof a.data === 'string' ? a.data : ''),
      at: iso(a.created_at),
    });
    activityByCard.set(a.card_id, bucket);
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
    checklists: checklistsByCard.get(c.id) ?? [],
    attachments: attachmentsByCard.get(c.id) ?? [],
    comments: commentsByCard.get(c.id) ?? [],
    activity: activityByCard.get(c.id) ?? [],
    createdById: c.created_by,
    createdAt: iso(c.created_at),
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
