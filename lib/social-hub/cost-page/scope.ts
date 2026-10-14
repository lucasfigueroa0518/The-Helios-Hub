import type { CostLedger } from '@/lib/social-hub/cost';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import type { Vertical } from '@/lib/social-hub/types';

/** What the Cost page is filtered to: one type (or all) and one mode. */
export type CostScope = { vertical: Vertical | null; mode: 'production' | 'development' };

const inScope = (s: CostScope, vertical: Vertical, mode: 'production' | 'development') => mode === s.mode && (!s.vertical || vertical === s.vertical);

/**
 * Pure. The ledger's items within the scope: each item's total and first day come only from
 * allocations whose source row matches the type and mode, and `itemMicros` keeps the items
 * first spent on between `from` and `to` (inclusive New York days).
 */
export function scopedItems(ledger: CostLedger, s: CostScope, from: string, to: string): { itemMicros: Map<string, number>; firstDay: Map<string, string> } {
  const rowMode = new Map(ledger.rows.map((r) => [r.id, r.mode ?? 'production']));
  const totals = new Map<string, number>();
  const firstDay = new Map<string, string>();
  for (const a of ledger.allocations) {
    if (!inScope(s, a.vertical, rowMode.get(a.rowId) ?? 'production')) continue;
    totals.set(a.item, (totals.get(a.item) ?? 0) + a.micros);
    const seen = firstDay.get(a.item);
    if (!seen || a.nyDate < seen) firstDay.set(a.item, a.nyDate);
  }
  const itemMicros = new Map([...totals].filter(([k]) => {
    const d = firstDay.get(k)!;
    return d >= from && d <= to;
  }));
  return { itemMicros, firstDay };
}

/** Pure. Spend nobody could be pinned on (the cost of choosing), within the scope and days. */
export function scopedUnattributed(ledger: CostLedger, s: CostScope, from: string, to: string): number {
  const rowMode = new Map(ledger.rows.map((r) => [r.id, r.mode ?? 'production']));
  return ledger.unattributed
    .filter((u) => inScope(s, u.vertical, rowMode.get(u.rowId) ?? 'production') && u.nyDate >= from && u.nyDate <= to)
    .reduce((n, u) => n + u.micros, 0);
}

/** Pure. Page rows within the scope and days. */
export function scopedSpend(rows: readonly CostRow[], s: CostScope, from: string, to: string): number {
  return rows.filter((r) => inScope(s, r.vertical, r.mode) && r.nyDate >= from && r.nyDate <= to).reduce((n, r) => n + r.micros, 0);
}

/** Pure. Spend per month ('YYYY-MM'), oldest first, within the scope. */
export function scopedMonthTotals(rows: readonly CostRow[], s: CostScope): Array<{ month: string; micros: number }> {
  const months = new Map<string, number>();
  for (const r of rows) if (inScope(s, r.vertical, r.mode)) months.set(r.nyDate.slice(0, 7), (months.get(r.nyDate.slice(0, 7)) ?? 0) + r.micros);
  return [...months.entries()].sort().map(([month, micros]) => ({ month, micros }));
}
