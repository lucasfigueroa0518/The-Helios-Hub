// lib/social-hub/slots/types.ts
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The weekly slot calendar's shapes (docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md,
 * reshaped by 2026-10-20-calendar-week-board-redesign.md). A slot is a content
 * type at a free start minute of a New York date (0–1439, on the 15-minute
 * grid); Stories slots also carry their series, so one series can run twice a day.
 */

export type FeedMode = 'trial' | 'main';

export type StorySeries = 'morning_download' | 'guess_the_number' | 'free_vs_paid';

export const STORY_SERIES: readonly StorySeries[] = ['morning_download', 'guess_the_number', 'free_vs_paid'];

export const isStorySeries = (v: unknown): v is StorySeries => typeof v === 'string' && (STORY_SERIES as readonly string[]).includes(v);

export type TemplateRow = { weekday: number; vertical: Vertical; startMinute: number; series: StorySeries | null; feedMode: FeedMode | null };

/**
 * Who set a date edit or a booking: a person (board, batch, placement,
 * reschedule, drags) or the system (pins the calendar writes itself, the
 * overnight run's bookings). A row with no mark is the system's.
 */
export type SetBy = 'person' | 'system';

export type OverrideRow = { nyDate: string; vertical: Vertical; startMinute: number; series: StorySeries | null; action: 'add' | 'remove'; feedMode: FeedMode | null; setBy: SetBy };

export type ResolvedSlot = {
  vertical: Vertical;
  startMinute: number;
  series: StorySeries | null;
  feedMode: FeedMode | null;
  origin: 'template' | 'override';
};

/** What makes a slot unique on a day: one slot per (type, minute), Stories per series too. */
export type SlotKey = { vertical: Vertical; startMinute: number; series: StorySeries | null };

/** The key as a string, for maps and sets. */
export const slotKeyString = (k: SlotKey): string => `${k.vertical}|${slotId(k.startMinute, k.series)}`;

export const sameSlotKey = (a: SlotKey, b: SlotKey): boolean => a.vertical === b.vertical && a.startMinute === b.startMinute && a.series === b.series;

/** A minute of the New York day on the 15-minute grid. */
export const isSlotMinute = (m: unknown): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 1439 && (m as number) % 15 === 0;

/** The free-time booking id in schedule.slot: `t0780`, Stories `t0510:morning_download`. */
export function slotId(startMinute: number, series: StorySeries | null): string {
  const t = `t${String(startMinute).padStart(4, '0')}`;
  return series ? `${t}:${series}` : t;
}

/** The inverse of slotId; null for a legacy window id or anything malformed. */
export function parseSlotId(id: string): { startMinute: number; series: StorySeries | null } | null {
  const m = /^t([0-9]{4})(?::([a-z_]+))?$/.exec(id);
  if (!m) return null;
  const startMinute = Number(m[1]);
  if (!isSlotMinute(startMinute)) return null;
  if (m[2] === undefined) return { startMinute, series: null };
  return isStorySeries(m[2]) ? { startMinute, series: m[2] } : null;
}

/** Resolved slots by New York date, as the hub's dataset carries them. */
export type SlotsByDate = Readonly<Record<string, readonly ResolvedSlot[]>>;

/** Who decides cadence: each type's own settings (as before) or the calendar. */
export type SlotSource = 'legacy' | 'template';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query, Queryable.query bound). */
export type SlotQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Only reels can be trial reels on Instagram: Text on Screen and Explainers. */
/** The most slot changes one call to the slot writer takes (write.ts re-exports it; here so the board can use it without server code). */
export const MAX_CHANGES = 20;

export const REEL_TYPES: readonly Vertical[] = ['reels', 'explainers'];

export const isReelType = (v: Vertical): boolean => REEL_TYPES.includes(v);
