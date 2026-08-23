"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CardRow } from "./CardRow";
import { ViewShell } from "./ViewShell";
import type { Board, Card, List, User } from "@/lib/trello/types";

const groupEnter = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: {
    delay: 0.04 + i * 0.055,
    type: "spring" as const,
    stiffness: 420,
    damping: 32,
  },
});

/**
 * Cards with a due date in the next 7 days, grouped by day. Overdue
 * open cards get pulled up into a "Past due" section at the top so
 * they don't get buried under the day-by-day list.
 */

type Props = {
  cards: Card[];
  lists: List[];
  boards: Board[];
  users: User[];
  onOpenCard: (id: string) => void;
  onToggleComplete: (id: string) => void;
};

const dayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});
const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export function DueThisWeekView({
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

  const { pastDue, days } = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    // Build 7 buckets starting today
    const dayKeys: string[] = [];
    const dayMap = new Map<string, Card[]>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayStart);
      d.setDate(todayStart.getDate() + i);
      const k = d.toDateString();
      dayKeys.push(k);
      dayMap.set(k, []);
    }
    const endOfWeek = new Date(todayStart);
    endOfWeek.setDate(todayStart.getDate() + 7);

    const past: Card[] = [];
    for (const c of cards) {
      if (!c.due) continue;
      const due = new Date(c.due);
      if (due < todayStart) {
        if (!c.complete) past.push(c);
        continue;
      }
      if (due >= endOfWeek) continue;
      const k = due.toDateString();
      dayMap.get(k)?.push(c);
    }
    past.sort(byDue);
    for (const k of dayKeys) dayMap.get(k)!.sort(byDue);

    return {
      pastDue: past,
      days: dayKeys.map((k) => ({
        key: k,
        date: new Date(k),
        cards: dayMap.get(k)!,
      })),
    };
  }, [cards]);

  const totalUpcoming = days.reduce((a, d) => a + d.cards.length, 0);
  const total = pastDue.length + totalUpcoming;

  return (
    <ViewShell
      eyebrow="View"
      title="Due this week"
      description={
        total === 0
          ? "No cards are due in the next seven days."
          : `${totalUpcoming} upcoming${pastDue.length ? ` · ${pastDue.length} overdue` : ""}`
      }
      empty={total === 0}
    >
      <div className="space-y-8">
        {(() => {
          // Flatten to an [visibleGroup, index] stream so the stagger
          // counter tracks *rendered* groups only, not day slots.
          let ord = 0;
          return (
            <>
              {pastDue.length > 0 && (
                <DayGroup
                  index={ord++}
                  label="Past due"
                  sub={`${pastDue.length} card${pastDue.length === 1 ? "" : "s"}`}
                  tone="red"
                  cards={pastDue}
                  listById={listById}
                  boardById={boardById}
                  users={users}
                  onOpenCard={onOpenCard}
                  onToggleComplete={onToggleComplete}
                />
              )}
              {days.map((d, i) => {
                if (d.cards.length === 0) return null;
                const label =
                  i === 0
                    ? "Today"
                    : i === 1
                      ? "Tomorrow"
                      : dayLabel.format(d.date);
                return (
                  <DayGroup
                    key={d.key}
                    index={ord++}
                    label={label}
                    sub={dateLabel.format(d.date)}
                    tone={i === 0 ? "helios" : "mute"}
                    cards={d.cards}
                    listById={listById}
                    boardById={boardById}
                    users={users}
                    onOpenCard={onOpenCard}
                    onToggleComplete={onToggleComplete}
                  />
                );
              })}
            </>
          );
        })()}
      </div>
    </ViewShell>
  );
}

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function byDue(a: Card, b: Card) {
  const ad = a.due ? new Date(a.due).getTime() : Infinity;
  const bd = b.due ? new Date(b.due).getTime() : Infinity;
  return ad - bd;
}

function DayGroup({
  index,
  label,
  sub,
  tone,
  cards,
  listById,
  boardById,
  users,
  onOpenCard,
  onToggleComplete,
}: {
  index: number;
  label: string;
  sub: string;
  tone: "red" | "helios" | "mute";
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
        : "bg-neutral-300";

  return (
    <motion.section {...groupEnter(index)}>
      <header className="mb-2.5 flex items-baseline gap-3">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <h2 className="text-[13px] font-semibold text-ink-hi">{label}</h2>
        <span className="text-[11px] tabular-nums text-ink-mute">{sub}</span>
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
