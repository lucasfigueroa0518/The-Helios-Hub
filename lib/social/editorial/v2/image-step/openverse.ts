/**
 * Openverse stock-image adapter. Used by runImageStep when the Writer's
 * IMAGE line is `stock: <scene>` — the finder queries the Openverse API
 * (no key required, public rate-limited endpoint) for a photograph
 * matching the scene, filters to safe licences + safe sources +
 * minimum size, and returns candidates ready for the vision KIND check.
 *
 * Openverse aggregates images from many upstream sources (Flickr,
 * Wikimedia Commons, museums, iNaturalist, etc.). We block a small
 * denylist of news-agency-adjacent sources to avoid grabbing
 * Reuters/AP/Bloomberg-tagged photos.
 *
 * Pluggable: `StockAdapter` is the shape any future stock provider
 * (Pixabay, Unsplash…) must satisfy so `runImageStep` never depends on
 * one provider.
 *
 * 2026-10-01 image redesign (Tommy Part 1).
 */

const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

/**
 * Allowed licence codes on Openverse (matches the CC licence taxonomy).
 * Kept in sync with commons.ts::classifyLicense. Openverse also uses
 * `sampling` and `sampling+` — deliberately excluded as they don't
 * cleanly map to any Creative Commons tier.
 */
const ALLOWED_LICENSES = ['cc0', 'pdm', 'by', 'by-sa'] as const;

/**
 * Denylist of Openverse `source` codes that resolve to news-wire /
 * press-agency material. Blocking these prevents accidental Reuters /
 * AP / Bloomberg / Getty grabs even when Openverse indexes them under
 * a CC-licensed re-upload. Add to this list when a new source shows
 * up in the QA stream that shouldn't ship.
 */
const BLOCKED_SOURCES: readonly string[] = Object.freeze([
  'reuters',
  'ap',
  'associated_press',
  'bloomberg',
  'getty',
  'gettyimages',
  'afp',
  'shutterstock',
]);

export type OpenverseCandidate = {
  /** Direct download URL for the full-resolution file. */
  url: string;
  /** Foreign landing page (Openverse's link back to the source platform). */
  foreignLandingUrl: string;
  /** MIME type — filtered to jpeg/png in `searchOpenverse`. */
  mime: string;
  width: number;
  height: number;
  /** Openverse licence code, e.g. 'cc0', 'by-sa'. */
  license: string;
  /** Optional licence version, e.g. '4.0'. */
  licenseVersion?: string;
  /** Human-readable creator name. */
  creator: string;
  /** Link to the creator's page on the source platform, when supplied. */
  creatorUrl?: string;
  /** Openverse `source` code (e.g. 'flickr', 'wikimedia'). */
  source: string;
  /** Openverse `title` field — used as fallback context. */
  title?: string;
};

/**
 * Stock adapter interface. Any provider (Openverse, Pixabay, Unsplash)
 * must expose `search(query, opts)`. runImageStep binds to
 * `StockAdapter`, not the Openverse implementation, so a future swap
 * doesn't touch orchestration.
 */
export type StockAdapter = {
  /** Provider name used in logs / credits ('openverse', 'pixabay'…). */
  name: string;
  search(query: string, opts?: { limit?: number; http?: typeof fetch }): Promise<OpenverseCandidate[]>;
};

function mimeFromUrl(url: string): string {
  const ext = /\.(jpe?g|png)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext ? 'image/jpeg' : '';
}

export async function searchOpenverse(
  query: string,
  opts: { limit?: number; http?: typeof fetch; minShortSide?: number } = {},
): Promise<OpenverseCandidate[]> {
  const http = opts.http ?? fetch;
  const limit = opts.limit ?? 12;
  const minShortSide = opts.minShortSide ?? 1080;

  const url = new URL(OPENVERSE_API);
  url.searchParams.set('q', query);
  url.searchParams.set('license', ALLOWED_LICENSES.join(','));
  url.searchParams.set('category', 'photograph');
  url.searchParams.set('page_size', String(Math.min(limit, 20)));

  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Openverse search failed: HTTP ${res.status}`);
  const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const raw = body.results ?? [];

  const out: OpenverseCandidate[] = [];
  for (const r of raw) {
    const source = String(r.source ?? '').toLowerCase();
    if (BLOCKED_SOURCES.includes(source)) continue;
    const license = String(r.license ?? '').toLowerCase();
    if (!ALLOWED_LICENSES.includes(license as (typeof ALLOWED_LICENSES)[number])) continue;
    // Openverse often leaves mime_type empty (seen 2026-10-05: 12 of 12
    // results); then judge the type from the file URL's extension.
    const mime = String(r.mime_type ?? '') || mimeFromUrl(String(r.url ?? ''));
    if (mime !== 'image/jpeg' && mime !== 'image/png') continue;
    const width = Number(r.width ?? 0);
    const height = Number(r.height ?? 0);
    if (Math.min(width, height) < minShortSide) continue;
    const creator = String(r.creator ?? '').trim();
    if (!creator) continue;
    out.push({
      url: String(r.url ?? ''),
      foreignLandingUrl: String(r.foreign_landing_url ?? ''),
      mime,
      width,
      height,
      license,
      licenseVersion: r.license_version ? String(r.license_version) : undefined,
      creator,
      creatorUrl: r.creator_url ? String(r.creator_url) : undefined,
      source,
      title: r.title ? String(r.title) : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Compact per-image credit fragment for a stock image, matching the
 * commons.ts::buildCredit shape so the caption's Photos: block can
 * append both kinds without a special case.
 *
 * Format:
 *   CC0/PDM  → "<Creator> (public domain)"
 *   BY/BY-SA → "<Creator>, <License> · Openverse"
 */
export function buildStockCredit(cand: Pick<OpenverseCandidate, 'creator' | 'license' | 'source'>): string {
  const l = cand.license.toLowerCase();
  if (l === 'cc0' || l === 'pdm') return `${cand.creator} (public domain)`;
  const licenseText = l === 'by' ? 'CC BY' : l === 'by-sa' ? 'CC BY-SA' : cand.license.toUpperCase();
  return `${cand.creator}, ${licenseText} · via ${cand.source}`;
}

/** The default Openverse adapter, ready to hand to runImageStep. */
export const OPENVERSE_ADAPTER: StockAdapter = {
  name: 'openverse',
  search: searchOpenverse,
};
