/**
 * Card details load on demand (perf): the workspace payload carries each card's
 * summary and badge counts, and a card's checklists, attachments, comments and
 * activity load when it opens. These helpers keep every view reading the same
 * numbers whether a card's details have loaded or not. Pure, no I/O.
 */
import type { ActivityEntry, Card, Comment } from '@/lib/trello/types';

export function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

export type ActivityRow = {
  id: string;
  user_id: string;
  action_type: string;
  data: { detail?: string } | string | null;
  created_at: Date | string;
};

export function activityEntry(a: ActivityRow): ActivityEntry {
  return {
    id: a.id,
    authorId: a.user_id,
    kind: a.action_type as ActivityEntry['kind'],
    detail:
      (typeof a.data === 'object' && a.data && 'detail' in a.data ? a.data.detail : null)
      ?? (typeof a.data === 'string' ? a.data : ''),
    at: iso(a.created_at),
  };
}

export type CardCounts = { checklistItems: number; checklistDone: number; comments: number; attachments: number };

/** True until the card's checklists, attachments, comments and full activity are in state. */
export function detailsPending(card: Card): boolean {
  return card.detailsLoaded === false;
}

/** The numbers on a card's face: from its details once loaded, from the workspace counts before. */
export function badgeCounts(card: Card): CardCounts {
  if (detailsPending(card) && card.counts) return card.counts;
  return {
    checklistItems: card.checklists.reduce((a, c) => a + c.items.length, 0),
    checklistDone: card.checklists.reduce((a, c) => a + c.items.filter((i) => i.done).length, 0),
    comments: card.comments.length,
    attachments: card.attachments.length,
  };
}

/** Latest activity by `userId` on the card (ms), or null when there is none. */
export function lastActivityBy(card: Card, userId: string): number | null {
  let last: number | null = card.myLastActivityAt ? new Date(card.myLastActivityAt).getTime() : null;
  for (const a of card.activity) {
    if (a.authorId !== userId) continue;
    const t = new Date(a.at).getTime();
    if (last === null || t > last) last = t;
  }
  return last;
}

export type CardDetails = Pick<Card, 'checklists' | 'attachments' | 'comments' | 'activity'>;

const byIdUnion = <T extends { id: string }>(server: T[], local: T[], localFirst: boolean): T[] => {
  const known = new Set(server.map((x) => x.id));
  const extra = local.filter((x) => !known.has(x.id));
  return localFirst ? [...extra, ...server] : [...server, ...extra];
};

/**
 * The card with its loaded details. Anything added in this session that the
 * read doesn't have yet (an optimistic write still in flight) is kept: comments
 * and checklists at the end, activity (newest first) at the start.
 */
export function withDetails(card: Card, details: CardDetails): Card {
  return {
    ...card,
    checklists: byIdUnion(details.checklists, card.checklists, false),
    attachments: byIdUnion(details.attachments, card.attachments, false),
    comments: byIdUnion(details.comments, card.comments, false),
    activity: byIdUnion(details.activity, card.activity, true),
    detailsLoaded: true,
  };
}

export type FeedRow = {
  id: string;
  authorId: string;
  kind: ActivityEntry['kind'] | 'commented';
  detail: string;
  at: string;
  cardId: string;
};

/** Every activity event and comment on these cards as feed rows (ids are `cardId:entryId`). */
export function localFeedRows(cards: Card[], authorId?: string): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const c of cards) {
    for (const a of c.activity) {
      if (authorId && a.authorId !== authorId) continue;
      rows.push({ id: `${c.id}:${a.id}`, authorId: a.authorId, kind: a.kind, detail: a.detail, at: a.at, cardId: c.id });
    }
    for (const cm of c.comments) {
      if (authorId && cm.authorId !== authorId) continue;
      rows.push({ id: `${c.id}:${cm.id}`, authorId: cm.authorId, kind: 'commented', detail: cm.body, at: cm.at, cardId: c.id });
    }
  }
  return rows;
}

/**
 * Newest first, at most `limit`: the server's rows plus what this session holds
 * (optimistic writes, loaded cards), each once, only for cards still shown.
 */
export function mergeFeed(server: FeedRow[], local: FeedRow[], cardIds: ReadonlySet<string>, limit: number): FeedRow[] {
  const seen = new Set<string>();
  const out: FeedRow[] = [];
  for (const r of [...local, ...server]) {
    if (seen.has(r.id) || !cardIds.has(r.cardId)) continue;
    seen.add(r.id);
    out.push(r);
  }
  // Newest first; events with the same timestamp in a fixed order (by id), so a reload shows the same list.
  out.sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? 1 : -1));
  return out.slice(0, limit);
}

export type WeekStatsRows = {
  /** The user's comments from the last 8 days (a margin over the 7 the tile counts). */
  recentComments: Array<{ id: string; cardId: string; at: string }>;
  /** Per card, the user's earliest "checked" event. */
  firstChecked: Array<{ id: string; cardId: string; at: string }>;
};

/**
 * Profile tiles "done this week" and "comments this week", same rules as when every
 * card carried its full activity: done counts the user's open-then-completed cards
 * whose earliest "checked" by them is within the week.
 */
export function weekStats(
  cards: Card[],
  userId: string,
  server: WeekStatsRows | null,
  isMine: (c: Card) => boolean,
  now = new Date(),
): { open: number; doneThisWeek: number; commentsThisWeek: number; overdue: number } {
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const firstCheckedByCard = new Map<string, number>();
  for (const r of server?.firstChecked ?? []) firstCheckedByCard.set(r.cardId, new Date(r.at).getTime());
  const comments = new Map<string, number>();
  for (const r of server?.recentComments ?? []) comments.set(`${r.cardId}:${r.id}`, new Date(r.at).getTime());

  let open = 0;
  let doneThisWeek = 0;
  let overdue = 0;
  const cardIds = new Set<string>();
  for (const c of cards) {
    cardIds.add(c.id);
    const mine = isMine(c);
    if (mine && !c.complete) open++;
    if (mine && c.complete) {
      let first = firstCheckedByCard.get(c.id) ?? null;
      for (const a of c.activity) {
        if (a.authorId !== userId || a.kind !== 'checked') continue;
        const t = new Date(a.at).getTime();
        if (first === null || t < first) first = t;
      }
      if (first !== null && first >= weekAgo.getTime()) doneThisWeek++;
    }
    if (mine && c.due && !c.complete && new Date(c.due) < now) overdue++;
    for (const cm of c.comments as Comment[]) {
      if (cm.authorId === userId) comments.set(`${c.id}:${cm.id}`, new Date(cm.at).getTime());
    }
  }
  let commentsThisWeek = 0;
  for (const [key, t] of comments) {
    if (cardIds.has(key.slice(0, key.indexOf(':'))) && t >= weekAgo.getTime()) commentsThisWeek++;
  }
  return { open, doneThisWeek, commentsThisWeek, overdue };
}
