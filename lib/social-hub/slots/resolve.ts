// lib/social-hub/slots/resolve.ts
import { weekdayOf } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { PLAN } from '@/lib/social-hub/views/plan';

import { isReelType, type OverrideRow, type ResolvedSlot, type TemplateRow } from './types';

/**
 * What runs on a New York date: that weekday's template rows, then that
 * date's overrides (remove drops a key; add inserts it or replaces it).
 * Window times come from PLAN, the hub's one copy of them. Pure.
 */
export function resolveDay(template: readonly TemplateRow[], overrides: readonly OverrideRow[], nyDate: string): ResolvedSlot[] {
  const weekday = weekdayOf(nyDate);
  const byKey = new Map<string, Omit<ResolvedSlot, 'startMinute' | 'endMinute'>>();
  for (const r of template) {
    if (r.weekday !== weekday) continue;
    byKey.set(`${r.vertical}|${r.windowId}`, { vertical: r.vertical, windowId: r.windowId, feedMode: r.feedMode, origin: 'template' });
  }
  for (const o of overrides) {
    if (o.nyDate !== nyDate) continue;
    const key = `${o.vertical}|${o.windowId}`;
    if (o.action === 'remove') byKey.delete(key);
    else byKey.set(key, { vertical: o.vertical, windowId: o.windowId, feedMode: o.feedMode, origin: 'override' });
  }
  const out: ResolvedSlot[] = [];
  for (const s of byKey.values()) {
    const w = PLAN[s.vertical].find((p) => p.id === s.windowId);
    if (!w) continue; // a window the code no longer has: not a slot
    out.push({ ...s, startMinute: w.startMinute, endMinute: w.endMinute });
  }
  return out.sort((a, b) => a.startMinute - b.startMinute || a.vertical.localeCompare(b.vertical));
}

export const LFD_CAROUSEL_CONFLICT = 'Last Few Days runs the 3 AM job that day. Carousels are off.';

/** Why a day's slots can't stand, in plain sentences; empty when they can. */
export function validateDay(slots: readonly ResolvedSlot[]): string[] {
  const errors: string[] = [];
  if (slots.some((s) => s.vertical === 'last_few_days') && slots.some((s) => s.vertical === 'carousels')) errors.push(LFD_CAROUSEL_CONFLICT);
  for (const s of slots) {
    const label = verticalInfo(s.vertical).label;
    if (isReelType(s.vertical) && !s.feedMode) errors.push(`${label} (${s.windowId}) needs Trial or Main feed.`);
    if (!isReelType(s.vertical) && s.feedMode) errors.push(`${label} posts aren’t reels, so they have no Trial or Main feed.`);
  }
  return errors;
}
