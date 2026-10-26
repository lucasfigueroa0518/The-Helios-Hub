// lib/social-hub/slots/seed.ts
import { PLAN } from '@/lib/social-hub/views/plan';

import { DEFAULT_FEED_MODE, DEFAULT_TIMES } from './times';
import type { SlotQuery, StorySeries, TemplateRow } from './types';

export type { StorySeries } from './types';
/** `aiEventsDays`: the weekdays of the AI Events evening slot (Sunday when absent). */
export type SeedInputs = { lfdDays: readonly number[]; storyDays: Record<StorySeries, readonly number[]>; aiEventsDays?: readonly number[] };

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/** Today's defaults (lib/lfd/config.ts DEFAULT_LFD_DAYS, lib/ai-events/config.ts DEFAULT_AI_EVENTS_DAYS, lib/stories/settings.ts DEFAULT_SETTINGS via PLAN). */
export const DEFAULT_SEED_INPUTS: SeedInputs = {
  lfdDays: PLAN.last_few_days[0]!.days ?? [2, 5],
  aiEventsDays: PLAN.ai_events[0]!.days ?? [0],
  storyDays: {
    morning_download: PLAN.stories.find((w) => w.id === 'morning_download')!.days ?? EVERY_DAY,
    guess_the_number: PLAN.stories.find((w) => w.id === 'guess_the_number')!.days ?? EVERY_DAY,
    free_vs_paid: PLAN.stories.find((w) => w.id === 'free_vs_paid')!.days ?? EVERY_DAY,
  },
};

/**
 * The first template (spec §Seeding): today's pattern at the default times
 * (times.ts DEFAULT_TIMES). Text on Screen and Explainers every day,
 * Carousels on every day but Last Few Days', LFD on its days, AI Events on
 * its days (Sunday evening), each Stories series on its days. Reels Trial,
 * Explainers Main.
 * tests/slots-resolve.test.ts pins Monday to the default times list.
 */
export function seedTemplate(input: SeedInputs): TemplateRow[] {
  const rows: TemplateRow[] = [];
  const add = (weekday: number, vertical: TemplateRow['vertical'], series: StorySeries | null = null) => {
    for (const startMinute of DEFAULT_TIMES[vertical]) rows.push({ weekday, vertical, startMinute, series, feedMode: DEFAULT_FEED_MODE[vertical] });
  };
  for (const weekday of EVERY_DAY) {
    add(weekday, 'reels');
    add(weekday, 'explainers');
    add(weekday, input.lfdDays.includes(weekday) ? 'last_few_days' : 'carousels');
    if ((input.aiEventsDays ?? DEFAULT_AI_EVENTS_SEED_DAYS).includes(weekday)) add(weekday, 'ai_events');
    for (const series of Object.keys(input.storyDays) as StorySeries[]) {
      if (input.storyDays[series].includes(weekday)) add(weekday, 'stories', series);
    }
  }
  return rows;
}

const DEFAULT_AI_EVENTS_SEED_DAYS: readonly number[] = PLAN.ai_events[0]!.days ?? [0];

const isDays = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

/** Today's LFD, AI Events and Stories series days, read the way their own loaders read them; defaults on any error. SELECT only. */
export async function readSeedInputs(q: SlotQuery): Promise<SeedInputs> {
  const out: SeedInputs = { lfdDays: [...DEFAULT_SEED_INPUTS.lfdDays], storyDays: { ...DEFAULT_SEED_INPUTS.storyDays }, aiEventsDays: [...DEFAULT_AI_EVENTS_SEED_DAYS] };
  try {
    const { rows } = await q(`SELECT value FROM lfd.settings WHERE key = 'days'`);
    if (isDays(rows[0]?.value)) out.lfdDays = [...new Set(rows[0].value as number[])].sort((a, b) => a - b);
  } catch { /* no lfd schema on this handle */ }
  try {
    const { rows } = await q(`SELECT value FROM ai_events.settings WHERE key = 'days'`);
    if (isDays(rows[0]?.value)) out.aiEventsDays = [...new Set(rows[0].value as number[])].sort((a, b) => a - b);
  } catch { /* no ai_events schema on this handle */ }
  try {
    const { rows } = await q(`SELECT value FROM stories.settings WHERE key = 'series'`);
    const series = rows[0]?.value as Partial<Record<StorySeries, { window?: { days?: unknown } }>> | undefined;
    for (const s of Object.keys(out.storyDays) as StorySeries[]) {
      const days = series?.[s]?.window?.days;
      if (isDays(days)) out.storyDays[s] = days;
    }
  } catch { /* no stories schema on this handle */ }
  return out;
}
