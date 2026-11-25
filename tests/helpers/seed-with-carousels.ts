import { seedTemplate, type SeedInputs } from '@/lib/social-hub/slots/seed';
import type { TemplateRow } from '@/lib/social-hub/slots/types';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/** Carousels' old routine times (9:00 and 2:30 PM), which the seed no longer adds. */
export const CAROUSEL_TEST_TIMES = [540, 870] as const;

/**
 * The seed as it was before Carousels went opt-in: carousel rows on every weekday
 * Last Few Days is not on. Tests that exercise carousel behavior (placement, spacing,
 * the LFD swap) build their calendar with this, since the real seed has none.
 */
export function seedWithCarousels(input: SeedInputs): TemplateRow[] {
  const rows = seedTemplate(input);
  for (const weekday of EVERY_DAY) {
    if (input.lfdDays.includes(weekday)) continue;
    for (const startMinute of CAROUSEL_TEST_TIMES) rows.push({ weekday, vertical: 'carousels', startMinute, series: null, feedMode: null });
  }
  return rows;
}
