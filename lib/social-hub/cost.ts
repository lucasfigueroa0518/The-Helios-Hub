import type { HubPost, Vertical } from '@/lib/social-hub/types';

/**
 * Cost model (PRODUCT_SPEC §8a, SH-56). Pure. Every ledger row is counted
 * exactly once: a direct row lands on one content item; a shared row is split
 * across the items its pool produced, in integer micro-dollars with a
 * largest-remainder rule, so the shares add up to the row exactly. A shared
 * row with no item to land on stays in "Unattributed (no output)" on its own
 * day and vertical; it is never spread across other days.
 *
 * Invariant (tested): for any window and vertical,
 *   Σ allocations to items + Σ unattributed = Σ ledger rows, to the micro-dollar.
 */

export type Micros = number;

export function toMicros(usd: unknown): Micros {
  const n = typeof usd === 'number' ? usd : Number(usd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000);
}

export function usd(micros: Micros): number {
  return micros / 1_000_000;
}

export type LedgerTarget =
  | { kind: 'item'; item: string }
  | { kind: 'pool'; pool: string };

export type LedgerRow = {
  id: string;
  vertical: Vertical;
  /** America/New_York day the money was spent. Allocations keep this day. */
  nyDate: string;
  micros: Micros;
  target: LedgerTarget;
  /** What it was (component, stage), for drills. */
  label: string;
};

/** The items a shared row splits across. No weights = equal split. */
export type Pool = {
  key: string;
  items: Array<{ item: string; weight?: number }>;
  /** Used when every weight is zero or missing: split equally across these instead. */
  fallback?: string[];
};

export type Allocation = {
  rowId: string;
  item: string;
  vertical: Vertical;
  nyDate: string;
  micros: Micros;
  direct: boolean;
};

export type Unattributed = { rowId: string; vertical: Vertical; nyDate: string; micros: Micros; label: string };

export type CostLedger = {
  rows: LedgerRow[];
  allocations: Allocation[];
  unattributed: Unattributed[];
};

/**
 * Split `amount` across weights so the parts sum to `amount` exactly.
 * Largest remainder; ties go to the earlier entry (stable, keyed order).
 */
export function largestRemainder(amount: Micros, weights: readonly number[]): Micros[] {
  if (weights.length === 0) return [];
  if (!Number.isInteger(amount)) throw new Error(`amount must be integer micros: ${amount}`);
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const use = total > 0 ? clean : clean.map(() => 1);
  const sum = total > 0 ? total : use.length;
  const exact = use.map((w) => (abs * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k]!.i]! += 1;
  return parts.map((p) => p * sign);
}

/** Allocate every ledger row. Pools are looked up by key; items are deduped and sorted for stability. */
export function allocate(rows: readonly LedgerRow[], pools: readonly Pool[]): CostLedger {
  const poolByKey = new Map(pools.map((p) => [p.key, p]));
  const allocations: Allocation[] = [];
  const unattributed: Unattributed[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.micros)) throw new Error(`ledger row ${row.id} is not integer micros`);
    if (row.target.kind === 'item') {
      allocations.push({ rowId: row.id, item: row.target.item, vertical: row.vertical, nyDate: row.nyDate, micros: row.micros, direct: true });
      continue;
    }
    const pool = poolByKey.get(row.target.pool);
    const merged = new Map<string, number>();
    // Weights add up per item; an unweighted entry listed twice still counts as one share.
    for (const entry of pool?.items ?? []) {
      merged.set(entry.item, entry.weight == null ? Math.max(merged.get(entry.item) ?? 0, 1) : (merged.get(entry.item) ?? 0) + entry.weight);
    }
    let items = [...merged.keys()].sort();
    let weights = items.map((item) => merged.get(item)!);
    if (items.length > 0 && weights.every((w) => !(w > 0))) {
      items = [...new Set(pool?.fallback?.length ? pool.fallback : items)].sort();
      weights = items.map(() => 1);
    }
    if (items.length === 0) {
      unattributed.push({ rowId: row.id, vertical: row.vertical, nyDate: row.nyDate, micros: row.micros, label: row.label });
      continue;
    }
    const parts = largestRemainder(row.micros, weights);
    items.forEach((item, i) => {
      allocations.push({ rowId: row.id, item, vertical: row.vertical, nyDate: row.nyDate, micros: parts[i]!, direct: false });
    });
  }
  return { rows: [...rows], allocations, unattributed };
}

export type CostWindow = { from: string | null; to: string; vertical?: Vertical | null };

function inWindow(nyDate: string, vertical: Vertical, w: CostWindow): boolean {
  if (w.vertical && vertical !== w.vertical) return false;
  if (w.from && nyDate < w.from) return false;
  return nyDate <= w.to;
}

export type CostSummary = {
  ledgerMicros: Micros;
  itemMicros: Micros;
  unattributedMicros: Micros;
  byVertical: Record<Vertical, { ledger: Micros; items: Micros; unattributed: Micros }>;
};

/** Window totals at every level; each level is the plain sum of the one below. */
export function summarize(ledger: CostLedger, w: CostWindow): CostSummary {
  const zero = () => ({ ledger: 0, items: 0, unattributed: 0 });
  const byVertical: CostSummary['byVertical'] = { reels: zero(), explainers: zero(), carousels: zero(), stories: zero() };
  for (const row of ledger.rows) if (inWindow(row.nyDate, row.vertical, w)) byVertical[row.vertical].ledger += row.micros;
  for (const a of ledger.allocations) if (inWindow(a.nyDate, a.vertical, w)) byVertical[a.vertical].items += a.micros;
  for (const u of ledger.unattributed) if (inWindow(u.nyDate, u.vertical, w)) byVertical[u.vertical].unattributed += u.micros;
  const all = Object.values(byVertical);
  return {
    ledgerMicros: all.reduce((s, v) => s + v.ledger, 0),
    itemMicros: all.reduce((s, v) => s + v.items, 0),
    unattributedMicros: all.reduce((s, v) => s + v.unattributed, 0),
    byVertical,
  };
}

/** Full cost of each item (every day it was touched). A reused post adds nothing when it posts later. */
export function itemTotals(ledger: CostLedger): Map<string, Micros> {
  const out = new Map<string, Micros>();
  for (const a of ledger.allocations) out.set(a.item, (out.get(a.item) ?? 0) + a.micros);
  return out;
}

/** The day an item's money was first spent ("generated <date>"). */
export function itemFirstDay(ledger: CostLedger): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of ledger.allocations) {
    const seen = out.get(a.item);
    if (!seen || a.nyDate < seen) out.set(a.item, a.nyDate);
  }
  return out;
}

/** Put each post's cost on it (SH-21). Posts sharing one item show the same cost; totals dedupe (below). */
export function withCosts(posts: readonly HubPost[], ledger: CostLedger): HubPost[] {
  const totals = itemTotals(ledger);
  const firstDay = itemFirstDay(ledger);
  return posts.map((post) => {
    if (!post.costItemKey) return post;
    const micros = totals.get(post.costItemKey);
    if (micros == null) return { ...post, costMicros: null };
    const day = firstDay.get(post.costItemKey);
    const postedDay = post.nyDate;
    return {
      ...post,
      costMicros: micros,
      costNote: day && postedDay && day < postedDay ? `generated ${day}` : null,
    };
  });
}

/**
 * Total cost of a set of posts, each content item counted once even when it
 * appears under several posts or groupings (SH-56).
 */
export function costOfPosts(posts: readonly HubPost[]): { micros: Micros; items: number; unknown: number } {
  const seen = new Map<string, Micros>();
  let unknown = 0;
  for (const post of posts) {
    if (!post.costItemKey || post.costMicros == null) {
      unknown += 1;
      continue;
    }
    seen.set(post.costItemKey, post.costMicros);
  }
  return { micros: [...seen.values()].reduce((a, b) => a + b, 0), items: seen.size, unknown };
}

export type Ratio = { numerator: number; denominator: number; value: number | null };

function ratio(numerator: number, denominator: number): Ratio {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

export type CostStats = {
  /** Every stat is numerator ÷ denominator (Trial Reels rollups shape), both shown on drill. */
  perPublishedPost: Ratio;
  perGeneratedItem: Ratio;
  /** Spend that reached a published post ÷ all spend in the window. */
  yield: Ratio;
  unshippedMicros: Micros;
  unattributedMicros: Micros;
};

export function costStats(ledger: CostLedger, posts: readonly HubPost[], w: CostWindow): CostStats {
  const summary = summarize(ledger, w);
  const publishedItems = new Set(
    posts.filter((p) => p.status === 'published' && p.costItemKey && (!w.vertical || p.vertical === w.vertical)).map((p) => p.costItemKey!),
  );
  let shipped = 0;
  const itemsInWindow = new Set<string>();
  for (const a of ledger.allocations) {
    if (!inWindow(a.nyDate, a.vertical, w)) continue;
    itemsInWindow.add(a.item);
    if (publishedItems.has(a.item)) shipped += a.micros;
  }
  const publishedInWindow = [...publishedItems].filter((item) => itemsInWindow.has(item)).length;
  return {
    perPublishedPost: ratio(shipped, publishedInWindow),
    perGeneratedItem: ratio(summary.itemMicros, itemsInWindow.size),
    yield: ratio(shipped, summary.ledgerMicros),
    unshippedMicros: summary.itemMicros - shipped,
    unattributedMicros: summary.unattributedMicros,
  };
}

/** Per-post value next to cost (views per dollar, shares per dollar). */
export function perDollar(value: number | null, micros: Micros | null): number | null {
  if (value == null || micros == null || micros <= 0) return null;
  return value / usd(micros);
}

export function formatUsd(micros: Micros | null, digits = 2): string {
  if (micros == null) return '—';
  const value = usd(micros);
  if (value !== 0 && Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(digits)}`;
}
