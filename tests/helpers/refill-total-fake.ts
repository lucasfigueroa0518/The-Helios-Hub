/**
 * An in-memory ledger for the nightly refill total (settings standard D19; lib/content-type/refill-total.ts), so a test
 * that runs a refill never reaches a database through the default `dbQuery` ledger. Pass `q` as the run's `totalQuery`.
 *
 *  - `total`: the stored social_hub.settings `refill_total_cap_usd` (absent: the $5 default).
 *  - `spentUsd`: what tonight's earlier refills already used (one settled row), e.g. the whole total for "no room left".
 */
import type { TotalQuery } from '@/lib/content-type/refill-total';

type Row = { id: number; ny_date: string | null; vertical: string; reserved_usd: number; spent_usd: number | null };

export function fakeTotalLedger(o: { total?: unknown; spentUsd?: number } = {}) {
  const rows: Row[] = [];
  // Earlier refills tonight: counted for any night asked about (tests pin their own clocks).
  if (o.spentUsd) rows.push({ id: 1, ny_date: null, vertical: 'earlier', reserved_usd: o.spentUsd, spent_usd: o.spentUsd });
  const queries: string[] = [];
  const q: TotalQuery = async (text, params = []) => {
    queries.push(text);
    if (text.includes("key = 'refill_total_cap_usd'") && /^\s*SELECT/.test(text)) return { rows: o.total === undefined ? [] : [{ value: o.total }] };
    if (text.includes('sum(coalesce(spent_usd, reserved_usd))')) {
      const usd = rows.filter((r) => r.ny_date == null || r.ny_date === params[0]).reduce((n, r) => n + (r.spent_usd ?? r.reserved_usd), 0);
      return { rows: [{ usd }] };
    }
    if (text.includes('INSERT INTO social_hub.refill_spend')) {
      const settled = text.includes('settled_at');
      const row: Row = { id: rows.length + 1, ny_date: params[0] as string, vertical: params[1] as string, reserved_usd: Number(params[2]), spent_usd: settled ? Number(params[2]) : null };
      rows.push(row);
      return { rows: settled ? [] : [{ id: String(row.id) }] };
    }
    if (text.includes('UPDATE social_hub.refill_spend')) {
      const row = rows.find((r) => String(r.id) === params[0]);
      if (row) row.spent_usd = Number(params[1]);
      return { rows: [] };
    }
    throw new Error(`fakeTotalLedger: unexpected query: ${text}`);
  };
  /** Tonight's rows written by the code under test (reservations and settlements), without the preloaded one. */
  const written = () => rows.filter((r) => r.vertical !== 'earlier');
  return { q, rows, written, queries };
}
