// lib/social-hub/slots/legacy.ts
import { EXPLAINER_WINDOWS } from '@/lib/explainers/publish/config';
import { AI_EVENTS_NIGHT_WINDOW, AI_EVENTS_WINDOW } from '@/lib/ai-events/config';
import { LFD_WINDOW } from '@/lib/lfd/config';
import { POSTING_SLOTS } from '@/lib/reels/publish/slots';
import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';
import type { Vertical } from '@/lib/social-hub/types';

import { DEFAULT_TIMES } from './times';
import { isStorySeries, parseSlotId, slotId, type StorySeries } from './types';

/**
 * A pre-cutover booking's window id as its free-time key: the window's start
 * minute from each type's window constants, Stories' series at the Stories
 * default time (the slot the seed gave it, R9). Null for anything else. The
 * one legacy-id mapper: slot writes, the schedulers and placement all use it.
 */
const LEGACY_START: Record<Exclude<Vertical, 'stories'>, ReadonlyArray<{ id: string; startMinute: number }>> = {
  reels: POSTING_SLOTS,
  explainers: EXPLAINER_WINDOWS,
  carousels: CAROUSEL_SLOTS,
  last_few_days: [LFD_WINDOW],
  ai_events: [AI_EVENTS_WINDOW, AI_EVENTS_NIGHT_WINDOW],
};

export function legacyKey(vertical: Vertical, slot: string): { startMinute: number; series: StorySeries | null } | null {
  if (vertical === 'stories') return isStorySeries(slot) ? { startMinute: DEFAULT_TIMES.stories[0]!, series: slot } : null;
  const w = LEGACY_START[vertical]?.find((x) => x.id === slot);
  return w ? { startMinute: w.startMinute, series: null } : null;
}

/** A booking's slot as a free-time id: a slot id stays; a window id (or a Stories series) reads as legacyKey maps it. */
export function asSlotId(vertical: Vertical, slot: string): string | null {
  if (parseSlotId(slot)) return slot;
  const key = legacyKey(vertical, slot);
  return key ? slotId(key.startMinute, key.series) : null;
}
