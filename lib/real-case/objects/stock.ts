import { buildStockCredit, searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';

/**
 * The stock lane for object photos (RC-41): Openverse filtered to StockSnap and rawpixel first (the
 * Hub's photo-finder lane), then Openverse at large; CC0, public domain and CC BY only (CC BY-SA would
 * bind the reel). No model call, no paid API.
 */

export const CANDIDATES = 4;
export const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
const STOCKSNAP_LANE = ['stocksnap', 'rawpixel'];
const LICENCES = new Set(['cc0', 'pdm', 'by']);

export type StockCandidate = { url: string; landing: string; license: string; credit: string; title: string };

export type StockSearch = (query: string, opts: { limit: number; minShortSide: number; sources?: string[] }) => Promise<OpenverseCandidate[]>;

export async function stockCandidates(query: string, search: StockSearch = searchOpenverse): Promise<StockCandidate[]> {
  const ok = (list: OpenverseCandidate[]) => list.filter((c) => LICENCES.has(c.license.toLowerCase()));
  const lane = ok(await search(query, { limit: 12, minShortSide: 600, sources: STOCKSNAP_LANE }).catch(() => []));
  const wide = lane.length >= CANDIDATES ? [] : ok(await search(query, { limit: 12, minShortSide: 600 }).catch(() => []));
  return [...lane, ...wide.filter((w) => !lane.some((l) => l.url === w.url))]
    .slice(0, CANDIDATES)
    .map((c) => ({ url: c.url, landing: c.foreignLandingUrl, license: c.license.toLowerCase(), credit: buildStockCredit(c), title: c.title ?? '' }));
}

export async function download(url: string, http: typeof fetch = fetch): Promise<Buffer | null> {
  const res = await http(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
