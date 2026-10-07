/**
 * Openverse search (pulled code; spec §5.1 Photo chain v1, the stock step):
 * a photograph for the Writer's `stock: <scene>` request, filtered to open
 * licences (CC0, public domain mark, CC BY, CC BY-SA), a named creator,
 * jpg/png, a minimum size, and away from a small denylist of news-agency
 * sources. The finder (photos/find.ts) then runs the Jev pre-screen and the
 * vision check.
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
  /** Openverse tag names (for the Jev metadata pre-screen, spec §5A #6). */
  tags?: string[];
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
      tags: Array.isArray(r.tags) ? (r.tags as Array<{ name?: unknown }>).map((t) => String(t?.name ?? '')).filter(Boolean) : undefined,
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

