// lib/social-hub/slots/resolve.ts
import { weekdayOf } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';

import { clockLabel } from './times';
import { isReelType, isSlotMinute, slotKeyString, type OverrideRow, type ResolvedSlot, type TemplateRow } from './types';

/** Series only on Stories, and required there; a row that breaks this isn't a slot. */
const wellFormed = (r: Pick<TemplateRow, 'vertical' | 'startMinute' | 'series'>) =>
  isSlotMinute(r.startMinute) && (r.vertical === 'stories') === (r.series !== null);

/**
 * What runs on a New York date: that weekday's template rows, then that
 * date's overrides (remove drops a key; add inserts it or replaces it).
 * Keyed on (vertical, startMinute, series). Pure.
 */
export function resolveDay(template: readonly TemplateRow[], overrides: readonly OverrideRow[], nyDate: string): ResolvedSlot[] {
  const weekday = weekdayOf(nyDate);
  const byKey = new Map<string, ResolvedSlot>();
  for (const r of template) {
    if (r.weekday !== weekday || !wellFormed(r)) continue;
    byKey.set(slotKeyString(r), { vertical: r.vertical, startMinute: r.startMinute, series: r.series, feedMode: r.feedMode, origin: 'template' });
  }
  for (const o of overrides) {
    if (o.nyDate !== nyDate || !wellFormed(o)) continue;
    const key = slotKeyString(o);
    if (o.action === 'remove') byKey.delete(key);
    else byKey.set(key, { vertical: o.vertical, startMinute: o.startMinute, series: o.series, feedMode: o.feedMode, origin: 'override' });
  }
  return sortSlots([...byKey.values()]);
}

/** Time order, then type, then series: the order every view and run reads a day in. */
export function sortSlots<T extends Pick<ResolvedSlot, 'vertical' | 'startMinute' | 'series'>>(slots: T[]): T[] {
  return slots.sort((a, b) => a.startMinute - b.startMinute || a.vertical.localeCompare(b.vertical) || (a.series ?? '').localeCompare(b.series ?? ''));
}

export const LFD_CAROUSEL_CONFLICT = 'Last Few Days runs the 3 AM job that day. Carousels are off.';

/** Why a day's slots can't stand, in plain sentences; empty when they can. */
export function validateDay(slots: readonly ResolvedSlot[]): string[] {
  const errors: string[] = [];
  if (slots.some((s) => s.vertical === 'last_few_days') && slots.some((s) => s.vertical === 'carousels')) errors.push(LFD_CAROUSEL_CONFLICT);
  for (const s of slots) {
    const label = verticalInfo(s.vertical).label;
    if (isReelType(s.vertical) && !s.feedMode) errors.push(`${label} (${clockLabel(s.startMinute)}) needs Trial or Main feed.`);
    if (!isReelType(s.vertical) && s.feedMode) errors.push(`${label} posts aren’t reels, so they have no Trial or Main feed.`);
  }
  return errors;
}
