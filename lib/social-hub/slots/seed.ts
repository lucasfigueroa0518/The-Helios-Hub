// lib/social-hub/slots/seed.ts
import { PLAN } from '@/lib/social-hub/views/plan';

import type { SlotQuery, TemplateRow } from './types';

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

/**
 * The template that behaves exactly like today (spec §1 Seed): every-day
 * windows from PLAN, Carousels on every day but Last Few Days', LFD's one
 * window on its days, each Stories series on its days. Reels Trial,
 * Explainers Main. tests/slots-resolve.test.ts pins it to windowsOn.
 */
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

const isDays = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

/** Today's LFD days and Stories series days, read the way their own loaders read them; defaults on any error. SELECT only. */
export async function readSeedInputs(q: SlotQuery): Promise<SeedInputs> {
  const out: SeedInputs = { lfdDays: [...DEFAULT_SEED_INPUTS.lfdDays], storyDays: { ...DEFAULT_SEED_INPUTS.storyDays } };
  try {
    const { rows } = await q(`SELECT value FROM lfd.settings WHERE key = 'days'`);
    if (isDays(rows[0]?.value)) out.lfdDays = [...new Set(rows[0].value as number[])].sort((a, b) => a - b);
  } catch { /* no lfd schema on this handle */ }
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
