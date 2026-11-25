/**
 * Resource Tracker (planning/Resource Tracker/PLAN.md): one view per public resource on heliosgroup.ai.
 * These are the JSON shapes the two API routes return and the page draws.
 */

export const TRACKER_RANGES = ['14d', '30d', '90d', 'all'] as const;
export type TrackerRange = (typeof TRACKER_RANGES)[number];

export function parseRange(value: string | null | undefined): TrackerRange {
  return (TRACKER_RANGES as readonly string[]).includes(value ?? '') ? (value as TrackerRange) : '30d';
}

/** Page views on the resource's page (Vercel Web Analytics), or null when analytics is not configured or failed. */
export type ViewsByDay = Record<string, number> | null;

/* ── Networking calendar ─────────────────────────────────────────────── */

export type CalendarDay = { date: string; clicks: number; visitors: number | null };
export type CalendarEventRow = { id: string; title: string; metro: string; start: string; clicks: number };
export type CalendarStats = {
  range: TrackerRange;
  from: string;
  to: string;
  /** The first counted click ever (tracking starts at deploy), or null before any. */
  trackingSince: string | null;
  totals: { clicks: number; visitors: number | null; eventsClicked: number; botHits: number };
  days: CalendarDay[];
  topEvents: CalendarEventRow[];
  metros: { metro: string; clicks: number }[];
  viewsNote: string | null;
};

/* ── Are you smarter than AI? ────────────────────────────────────────── */

export type GameDayRow = {
  dayNumber: number;
  date: string;
  /** Visitors to the game page that day (Vercel), when available. */
  visitors: number | null;
  started: number;
  /** Finished daily plays: the day's players. */
  players: number;
  newPlayers: number;
  returningPlayers: number;
  avgScore: number | null;
  avgPoints: number | null;
  aiScore: number | null;
  aiPoints: number | null;
  /** Players who beat the AI (on points when both have points, else on correct answers). */
  beatAi: number;
};

export type TopPlayer = {
  key: string;
  name: string;
  saved: boolean;
  games: number;
  avgScore: number;
  wins: number;
  lastDay: number;
  /** Day number → that day's correct answers (0–5) and whether they beat the AI. */
  byDay: Record<number, { score: number; beatAi: boolean }>;
};

export type GameQuestionRow = {
  position: number;
  question: string;
  options: { letter: string; text: string }[];
  correct: string;
  aiPicked: string;
  aiRight: boolean;
  answers: number;
  right: number;
  timeouts: number;
  medianSeconds: number | null;
};

export type GameStats = {
  range: TrackerRange;
  configured: boolean;
  error: string | null;
  days: GameDayRow[];
  topPlayers: TopPlayer[];
  /** Day number → its five questions with how players did. */
  questions: Record<number, GameQuestionRow[]>;
  totals: { players: number; plays: number; finishRate: number | null; returningShare: number | null; beatAiShare: number | null };
  viewsNote: string | null;
};
