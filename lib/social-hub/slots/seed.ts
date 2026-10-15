// lib/social-hub/slots/seed.ts
import { PLAN } from '@/lib/social-hub/views/plan';

import type { TemplateRow } from './types';

/**
 * The template that behaves exactly like today (spec §1 Seed): every-day
 * windows from PLAN, Carousels on every day but Last Few Days', LFD's one
 * window on its days, each Stories series on its days. Reels Trial,
 * Explainers Main. tests/slots-resolve.test.ts pins it to windowsOn.
 */
export type StorySeries = 'morning_download' | 'guess_the_number' | 'free_vs_paid';
export type SeedInputs = { lfdDays: readonly number[]; storyDays: Record<StorySeries, readonly number[]> };

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/** Today's defaults (lib/lfd/config.ts DEFAULT_LFD_DAYS, lib/stories/settings.ts DEFAULT_SETTINGS via PLAN). */
export const DEFAULT_SEED_INPUTS: SeedInputs = {
  lfdDays: PLAN.last_few_days[0]!.days ?? [2, 5],
  storyDays: {
    morning_download: PLAN.stories.find((w) => w.id === 'morning_download')!.days ?? EVERY_DAY,
    guess_the_number: PLAN.stories.find((w) => w.id === 'guess_the_number')!.days ?? EVERY_DAY,
    free_vs_paid: PLAN.stories.find((w) => w.id === 'free_vs_paid')!.days ?? EVERY_DAY,
  },
};

export function seedTemplate(input: SeedInputs): TemplateRow[] {
  const rows: TemplateRow[] = [];
  for (const weekday of EVERY_DAY) {
    for (const w of PLAN.reels) rows.push({ weekday, vertical: 'reels', windowId: w.id, feedMode: 'trial' });
    for (const w of PLAN.explainers) rows.push({ weekday, vertical: 'explainers', windowId: w.id, feedMode: 'main' });
    if (input.lfdDays.includes(weekday)) {
      rows.push({ weekday, vertical: 'last_few_days', windowId: PLAN.last_few_days[0]!.id, feedMode: null });
    } else {
      for (const w of PLAN.carousels) rows.push({ weekday, vertical: 'carousels', windowId: w.id, feedMode: null });
    }
    for (const series of Object.keys(input.storyDays) as StorySeries[]) {
      if (input.storyDays[series].includes(weekday)) rows.push({ weekday, vertical: 'stories', windowId: series, feedMode: null });
    }
  }
  return rows;
}
