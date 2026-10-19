import type { CostLedger } from '@/lib/social-hub/cost';
import { stageOf, vendorOf, type Stage, type VendorGroup } from '@/lib/social-hub/cost-page/normalize';
import type { Vertical } from '@/lib/social-hub/types';

export type CostRow = { nyDate: string; vertical: Vertical; vendor: VendorGroup; stage: Stage; micros: number; mode: 'production' | 'development'; unknown: boolean; runId: string | null };
/** Carousels record stage spend per run (record.result.costByStage); the page splits each run's ledger rows by these shares. */
export type CarouselStageSplit = { runId: string; byStage: Record<string, number> };
/** Carousel Claude vs Jev split per run (claude_usd, jev_usd). */
export type CarouselVendorSplit = { runId: string; claude: number; jev: number; total: number };

const CAROUSEL_STAGE: Record<string, Stage> = {
  'jev-scoring': 'research', selection: 'research', reporter: 'research', feeds: 'research',
  writer: 'writing', editor: 'writing', captioner: 'writing', 'fact-checker': 'writing', mechanical: 'writing', hook: 'writing',
  design: 'visuals', photos: 'visuals', render: 'visuals',
};

export function toCostRows(ledger: CostLedger, stages: readonly CarouselStageSplit[], vendors: readonly CarouselVendorSplit[]): CostRow[] {
  const out: CostRow[] = [];
  for (const r of ledger.rows) {
    const base = { nyDate: r.nyDate, vertical: r.vertical, mode: r.mode ?? 'production', unknown: Boolean(r.unknown) } as const;
    if (r.vertical !== 'carousels') {
      out.push({ ...base, vendor: vendorOf(r.vendor), stage: stageOf(r.vertical, r.label), micros: r.micros, runId: null });
      continue;
    }
    const runId = r.id.split(':')[2] ?? null;
    const split = stages.find((s) => s.runId === runId)?.byStage ?? {};
    const v = vendors.find((x) => x.runId === runId);
    const total = Object.values(split).reduce((a, b) => a + b, 0);
    const parts = total > 0
      ? Object.entries(split).map(([k, usd]) => [CAROUSEL_STAGE[k] ?? 'other', usd / total] as [Stage, number])
      : [['writing', 1] as [Stage, number]];
    const claudeShare = v && v.total > 0 ? v.claude / v.total : 1;
    const jevShare = v && v.total > 0 ? v.jev / v.total : 0;
    for (const [stage, share] of parts) {
      const micros = Math.round(r.micros * share);
      out.push({ ...base, stage, vendor: 'claude', micros: Math.round(micros * claudeShare), runId });
      if (jevShare > 0) out.push({ ...base, stage, vendor: 'jev-search', micros: Math.round(micros * jevShare), runId });
      const rest = micros - Math.round(micros * claudeShare) - Math.round(micros * jevShare);
      if (rest > 0) out.push({ ...base, stage, vendor: 'other', micros: rest, runId });
    }
  }
  return out;
}
