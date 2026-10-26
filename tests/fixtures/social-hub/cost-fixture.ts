import type { CostInput } from '@/lib/social-hub/cost-page/model';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import type { Vertical } from '@/lib/social-hub/types';

import { FIXTURE_NOW, previewDataset } from './preview-dataset';

/** The fixture's four original types (its numbers are pinned by the cost tests); Last Few Days and AI Events have no spend here. */
const DAILY: Record<Exclude<Vertical, 'last_few_days' | 'ai_events'>, number> = { reels: 4.6, explainers: 3.5, carousels: 1.9, stories: 0.7 };

export function previewCost(): CostInput {
  const rows: CostRow[] = [];
  for (let d = 1; d <= 8; d++) {
    const nyDate = `2026-10-0${d}`;
    for (const v of Object.keys(DAILY) as Array<keyof typeof DAILY>) {
      const usd = v === 'explainers' && d === 8 ? 9.8 : DAILY[v];
      rows.push({ nyDate, vertical: v, vendor: 'claude', stage: 'writing', micros: Math.round(usd * 0.6e6), mode: 'production', unknown: false, runId: null });
      rows.push({ nyDate, vertical: v, vendor: v === 'reels' ? 'video' : 'jev-search', stage: v === 'reels' || v === 'explainers' ? 'video' : 'research', micros: Math.round(usd * 0.4e6), mode: 'production', unknown: false, runId: null });
    }
  }
  rows.push({ nyDate: '2026-10-08', vertical: 'explainers', vendor: 'video', stage: 'video', micros: 0, mode: 'production', unknown: true, runId: null });
  rows.push({ nyDate: '2026-10-05', vertical: 'reels', vendor: 'claude', stage: 'writing', micros: 2_000_000, mode: 'development', unknown: false, runId: null });
  return {
    rows, from: '2026-10-01', to: '2026-10-08', now: FIXTURE_NOW, vertical: null, mode: 'production',
    watchUsd: { reels: 100, explainers: 310, carousels: 62, stories: 25, last_few_days: 9, ai_events: 2.5 },
    posts: previewDataset().posts,
    waste: { rejected: 8_900_000, failed: 6_600_000, expired: 3_900_000, selection: 11_200_000, spend: 142_000_000 },
    prevWastePct: 21,
    readiness: [
      { vertical: 'reels', approved: 46, rejected: 2, rate: 46 / 48 },
      { vertical: 'explainers', approved: 22, rejected: 8, rate: 22 / 30 },
      { vertical: 'carousels', approved: 27, rejected: 6, rate: 27 / 33 },
      { vertical: 'stories', approved: 20, rejected: 2, rate: 20 / 22 },
    ],
    caching: { savedMicros: 23_000_000, withoutMicros: 165_000_000 },
    monthTotals: [{ month: '2026-08', micros: 280e6 }, { month: '2026-09', micros: 300e6 }, { month: '2026-10', micros: 90e6 }],
    bestEverCpi: { carousels: 20_000 },
  };
}
