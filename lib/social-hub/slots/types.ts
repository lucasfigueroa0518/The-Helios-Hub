// lib/social-hub/slots/types.ts
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The weekly slot calendar's shapes (docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md).
 * A slot is a content type in one of its own windows (PLAN) on a New York date.
 */

export type FeedMode = 'trial' | 'main';

export type TemplateRow = { weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null };

export type OverrideRow = { nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null };

export type ResolvedSlot = {
  vertical: Vertical;
  windowId: string;
  feedMode: FeedMode | null;
  startMinute: number;
  endMinute: number;
  origin: 'template' | 'override';
};

/** Resolved slots by New York date, as the hub's dataset carries them. */
export type SlotsByDate = Readonly<Record<string, readonly ResolvedSlot[]>>;

/** Who decides cadence: each type's own settings (as before) or the calendar. */
export type SlotSource = 'legacy' | 'template';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query, Queryable.query bound). */
export type SlotQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Only reels can be trial reels on Instagram: Text on Screen and Explainers. */
export const REEL_TYPES: readonly Vertical[] = ['reels', 'explainers'];

export const isReelType = (v: Vertical): boolean => REEL_TYPES.includes(v);
