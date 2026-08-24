"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CardRow } from "./CardRow";
import { ViewShell } from "./ViewShell";
import type { Board, Card, List, User } from "@/lib/trello/types";
import { cardAssociatedWithUser } from "@/lib/trello/card-filter";

const groupEnter = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: {
    delay: 0.04 + i * 0.06,
    type: "spring" as const,
    stiffness: 420,
    damping: 32,
  },
});

/**
 * Every card assigned to the current user across every board, grouped
 * by board. Overdue rises to the top, then upcoming due, then no-due
 * — inside each group the ordering follows the underlying data so the
 * view stays predictable when a user checks something off.
 */

type Props = {
  me: User;
  cards: Card[];
  lists: List[];
  boards: Board[];
  users: User[];
  onOpenCard: (id: string) => void;
  onToggleComplete: (id: string) => void;
};

export function MyCardsView({
  me,
  cards,
  lists,
  boards,
  users,
  onOpenCard,
  onToggleComplete,
}: Props) {
  const listById = useMemo(
    () => new Map(lists.map((l) => [l.id, l])),
    [lists]
  );
  const boardById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards]
  );

  const mine = useMemo(
    () => cards.filter((c) => cardAssociatedWithUser(c, me.id)),
    [cards, me.id]
  );

  const { overdue, upcoming, later, done } = useMemo(() => {
    const now = new Date();
    const soon = new Date();
    soon.setDate(now.getDate() + 7);

    const buckets = {
      overdue: [] as Card[],
      upcoming: [] as Card[],
      later: [] as Card[],
      done: [] as Card[],
    };

    for (const c of mine) {
      if (c.complete) {
        buckets.done.push(c);
        continue;
      }
      if (c.due) {
        const t = new Date(c.due).getTime();
        if (t < now.getTime()) buckets.overdue.push(c);
        else if (t <= soon.getTime()) buckets.upcoming.push(c);
        else buckets.later.push(c);
      } else {
        buckets.later.push(c);
      }
    }

    // Sort due-bearing groups by due asc
    buckets.overdue.sort(byDue);
    buckets.upcoming.sort(byDue);
    return buckets;
  }, [mine]);

  const total = mine.length;
  const openCount = total - done.length;

  return (
    <ViewShell
      eyebrow="View"
      title="My cards"
      description={
        total === 0
          ? "You don't have any cards assigned yet."
          : `${openCount} open · ${done.length} done`
      }
      empty={total === 0}
    >
      <div className="space-y-8">
        {[
          { title: "Overdue", tone: "red" as const, cards: overdue },
          { title: "Due this week", tone: "helios" as const, cards: upcoming },
          { title: "Later", tone: "mute" as const, cards: later },
          { title: "Done", tone: "green" as const, cards: done },
        ]
          .filter((g) => g.cards.length > 0)
          .map((g, i) => (
            <Group
              key={g.title}
              index={i}
              title={g.title}
              tone={g.tone}
              cards={g.cards}
              listById={listById}
              boardById={boardById}
              users={users}
              onOpenCard={onOpenCard}
              onToggleComplete={onToggleComplete}
            />
          ))}
      </div>
    </ViewShell>
  );
}

function byDue(a: Card, b: Card) {
  const ad = a.due ? new Date(a.due).getTime() : Infinity;
  const bd = b.due ? new Date(b.due).getTime() : Infinity;
  return ad - bd;
}

function Group({
  index,
  title,
  tone,
  cards,
  listById,
  boardById,
  users,
  onOpenCard,
  onToggleComplete,
}: {
  index: number;
  title: string;
  tone: "red" | "helios" | "green" | "mute";
  cards: Card[];
  listById: Map<string, List>;
  boardById: Map<string, Board>;
  users: User[];
  onOpenCard: (id: string) => void;
  onToggleComplete: (id: string) => void;
}) {
  const dotColor =
    tone === "red"
      ? "bg-danger"
      : tone === "helios"
        ? "bg-warning"
        : tone === "green"
          ? "bg-heliosGreen-400"
          : "bg-neutral-300";

  return (
    <motion.section {...groupEnter(index)}>
      <header className="mb-2.5 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-mid">
          {title}
        </h2>
        <span className="text-[11px] tabular-nums text-ink-mute">
          {cards.length}
        </span>
      </header>
      <ul className="space-y-1.5">
        {cards.map((c) => {
          const list = listById.get(c.listId);
          const board = boardById.get(c.boardId);
          if (!list || !board) return null;
          return (
            <li key={c.id}>
              <CardRow
                card={c}
                board={board}
                list={list}
                users={users}
                onOpen={() => onOpenCard(c.id)}
                onToggleComplete={() => onToggleComplete(c.id)}
              />
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
