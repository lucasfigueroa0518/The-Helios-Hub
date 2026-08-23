"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/trello/ui/Avatar";
import { ViewShell } from "./ViewShell";
import { cn } from "@/lib/trello/utils";
import type { ActivityEntry, Board, Card, List, User } from "@/lib/trello/types";
import {
  CheckCircle2,
  CircleUserRound,
  MessageSquare,
  MoveHorizontal,
  Plus,
  Tag,
} from "lucide-react";

/**
 * Flattened stream of every activity event across every card, plus
 * every comment (comments live on card.comments and read as
 * activity from the user's point of view). Grouped by day.
 */

type Props = {
  cards: Card[];
  lists: List[];
  boards: Board[];
  users: User[];
  onOpenCard: (id: string) => void;
};

type Row = {
  id: string;
  authorId: string;
  kind: ActivityEntry["kind"] | "commented";
  detail: string;
  at: string;
  cardId: string;
};

const dayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const timeLabel = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export function ActivityView({
  cards,
  lists,
  boards,
  users,
  onOpenCard,
}: Props) {
  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );
  const listById = useMemo(
    () => new Map(lists.map((l) => [l.id, l])),
    [lists]
  );
  const boardById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards]
  );
  const cardById = useMemo(
    () => new Map(cards.map((c) => [c.id, c])),
    [cards]
  );

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const c of cards) {
      for (const a of c.activity) {
        list.push({
          id: `${c.id}:${a.id}`,
          authorId: a.authorId,
          kind: a.kind,
          detail: a.detail,
          at: a.at,
          cardId: c.id,
        });
      }
      for (const cm of c.comments) {
        list.push({
          id: `${c.id}:${cm.id}`,
          authorId: cm.authorId,
          kind: "commented",
          detail: cm.body,
          at: cm.at,
          cardId: c.id,
        });
      }
    }
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    return list.slice(0, 200); // don't render an infinite scroll from day one
  }, [cards]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    const order: string[] = [];
    for (const r of rows) {
      const k = new Date(r.at).toDateString();
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)!.push(r);
    }
    return order.map((k) => ({ key: k, date: new Date(k), rows: map.get(k)! }));
  }, [rows]);

  return (
    <ViewShell
      eyebrow="View"
      title="Activity"
      description={
        rows.length === 0
          ? "Nothing has happened yet."
          : `${rows.length} recent events across all boards`
      }
      empty={rows.length === 0}
    >
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <header className="mb-2.5 flex items-baseline gap-3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-300" />
              <h2 className="text-[13px] font-semibold text-ink-hi">
                {isToday(g.date)
                  ? "Today"
                  : isYesterday(g.date)
                    ? "Yesterday"
                    : dayLabel.format(g.date)}
              </h2>
              <span className="text-[11px] tabular-nums text-ink-mute">
                {g.rows.length}
              </span>
            </header>
            <ol className="relative space-y-0.5 border-l border-neutral-200 pl-4">
              {g.rows.map((r) => {
                const author = userById.get(r.authorId);
                const card = cardById.get(r.cardId);
                const list = card ? listById.get(card.listId) : null;
                const board = card ? boardById.get(card.boardId) : null;
                if (!author || !card || !list || !board) return null;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => onOpenCard(card.id)}
                      className={cn(
                        "group relative -ml-4 flex w-[calc(100%+1rem)] items-start gap-3 rounded-[8px] px-4 py-2 text-left transition-colors",
                        "hover:bg-neutral-50"
                      )}
                    >
                      <span className="absolute left-4 top-3.5 -ml-[2px] h-1.5 w-1.5 rounded-full bg-ink-mute/50 group-hover:bg-ink-mid" />
                      <Avatar
                        name={author.name}
                        hue={author.hue}
                        size="sm"
                        className="mt-0.5 ml-3 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-snug">
                          <span className="font-medium text-ink-hi">
                            {author.name}
                          </span>
                          <KindGlyph kind={r.kind} />
                          <VerbLabel kind={r.kind} />
                          {r.kind === "commented" ? null : (
                            <span className="text-ink-mid">on</span>
                          )}
                          <span className="truncate font-medium text-ink-hi">
                            {card.title}
                          </span>
                        </div>
                        {r.kind === "commented" ? (
                          <div className="mt-1 rounded-[6px] border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[12.5px] text-ink-mid">
                            {truncate(r.detail, 240)}
                          </div>
                        ) : (
                          r.detail && (
                            <div className="mt-0.5 text-[12px] text-ink-low">
                              {truncate(r.detail, 160)}
                            </div>
                          )
                        )}
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-mute">
                          <span
                            className="h-1.5 w-1.5 rounded-sm"
                            style={{ background: board.accent }}
                          />
                          <span className="truncate">{board.name}</span>
                          <span className="text-ink-mute/60">›</span>
                          <span className="truncate">{list.name}</span>
                          <span className="text-ink-mute/60">·</span>
                          <span>{timeLabel.format(new Date(r.at))}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </ViewShell>
  );
}

function KindGlyph({ kind }: { kind: Row["kind"] }) {
  const cls = "h-3.5 w-3.5 text-ink-mute";
  switch (kind) {
    case "created":
      return <Plus className={cls} />;
    case "moved":
      return <MoveHorizontal className={cls} />;
    case "checked":
      return <CheckCircle2 className={cls} />;
    case "commented":
      return <MessageSquare className={cls} />;
    case "assigned":
      return <CircleUserRound className={cls} />;
    case "labeled":
      return <Tag className={cls} />;
    default:
      return null;
  }
}

function VerbLabel({ kind }: { kind: Row["kind"] }) {
  const verb =
    kind === "created"
      ? "created"
      : kind === "moved"
        ? "moved"
        : kind === "checked"
          ? "checked off"
          : kind === "commented"
            ? "commented on"
            : kind === "assigned"
              ? "assigned"
              : kind === "labeled"
                ? "labeled"
                : "";
  return <span className="text-ink-mid">{verb}</span>;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function isToday(d: Date) {
  const t = new Date();
  return d.toDateString() === t.toDateString();
}

function isYesterday(d: Date) {
  const t = new Date();
  t.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString();
}
