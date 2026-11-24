"use client";

import { useEffect, useState } from "react";
import { loadActivityFeed, loadMyWeekStats } from "@/app/trello/actions/cardDetails";
import type { FeedRow, WeekStatsRows } from "@/lib/trello/card-details";

/**
 * The newest activity and comments from the server (cards carry only counts
 * until opened). Null until the first answer; while a new search loads, the
 * previous rows stay (the views filter them to the cards still shown).
 */
export function useActivityFeed(opts: { query: string; authorId?: string | null; limit: number }): FeedRow[] | null {
  const query = opts.query.trim().toLowerCase();
  const authorId = opts.authorId ?? null;
  const { limit } = opts;
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const loaded = rows !== null;
  useEffect(() => {
    let live = true;
    // Typing in search: wait for a pause before asking again.
    const timer = setTimeout(() => {
      loadActivityFeed({ query, authorId, limit })
        .then((next) => {
          if (live) setRows(next);
        })
        .catch((err) => console.error("[loadActivityFeed]", err));
    }, loaded ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `loaded` only picks the delay; it must not trigger a second read.
  }, [query, authorId, limit]);
  return rows;
}

/** The viewer's recent comments and first "checked" per card, for the Profile's week tiles. */
export function useMyWeekStats(): WeekStatsRows | null {
  const [rows, setRows] = useState<WeekStatsRows | null>(null);
  useEffect(() => {
    let live = true;
    loadMyWeekStats()
      .then((next) => {
        if (live) setRows(next);
      })
      .catch((err) => console.error("[loadMyWeekStats]", err));
    return () => {
      live = false;
    };
  }, []);
  return rows;
}
