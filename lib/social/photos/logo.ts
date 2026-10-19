/**
 * Logo cover cards (spec §5.1 Photo chain v1, cover step 3): a story whose
 * cover subject (or an organization the cover names) is an organization
 * gets a Helios-designed card with its official logo. Allowed for any
 * identity-verified organization whose Commons logo file passes the licence
 * check; brand-guideline preferences don't block it (Tommy, 2026-10-07: "If
 * there are free, open-to-use logos that are just preferred not to be used
 * by the companies, we can definitely use them.").
 *
 *   - From Wikidata P154 ("logo image") on the identity-verified QID only,
 *     never matched by name. The current value: preferred rank, else one
 *     without an end date (P582), latest start date (P580) first.
 *   - From Wikimedia Commons, licence checked like every Commons photo
 *     (PD / CC0 / CC BY / CC BY-SA). A logo only on English Wikipedia
 *     (non-free) never resolves here, so the card falls back.
 *   - Drawn from Commons' rendered PNG (SVG logos included), never recoloured
 *     or cropped. Code picks a light or dark plate from the logo's own
 *     luminance so contrast always holds.
 *   - The 7-day rule applies per logo (its URL), like every photo.
 */
import { classifyLicense } from '@/lib/social/editorial/v2/image-step/commons';

import type { Photo } from './find';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
/** Rendered width requested from Commons. */
const LOGO_PX = 800;
/** Wider than this (width ÷ height) and the logo would read as a thin strip on the card (Tommy, 2026-10-07: 10:1). */
export const LOGO_MAX_ASPECT = 10;

type Claim = {
  rank?: 'preferred' | 'normal' | 'deprecated';
  mainsnak?: { datavalue?: { value?: string } };
  qualifiers?: Record<string, Array<{ datavalue?: { value?: { time?: string } } }>>;
};

/** The current P154 file among the entity's claims, or null. */
export function currentLogoFile(claims: Claim[]): string | null {
  const live = claims.filter((c) => c.rank !== 'deprecated' && typeof c.mainsnak?.datavalue?.value === 'string');
  const preferred = live.filter((c) => c.rank === 'preferred');
  const pool = (preferred.length ? preferred : live).filter((c) => !c.qualifiers?.P582?.length);
  const start = (c: Claim) => c.qualifiers?.P580?.[0]?.datavalue?.value?.time ?? '';
  const pick = [...pool].sort((a, b) => start(b).localeCompare(start(a)))[0];
  return pick?.mainsnak?.datavalue?.value ?? null;
}

/** Light plate for a dark logo, dark plate for a light one: mean luminance of the logo's opaque pixels. */
export async function plateFor(png: Buffer): Promise<'light' | 'dark' | null> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 128) continue;
    sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
    n++;
  }
  if (n === 0) return null;
  return sum / n < 0.55 ? 'light' : 'dark';
}

export type LogoResult = { photo: Photo; file: string } | { photo: null; reason: string };

/**
 * Software licences Commons logos sometimes carry (Nvidia: Apache 2.0,
 * DeepSeek: MIT). Free to reuse with credit, but not in the photo tiers, so
 * only a caller that opts in accepts them: the logo bank does (Lucas,
 * 2026-10-13); the cover card's own lookups do not.
 */
export const SOFTWARE_LOGO_LICENCE = /^(?:mit(?: license)?|apache(?: license)?[- ]2\.0)$/i;

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

/**
 * One Commons logo file as a card image, or why not: the licence check, the
 * shape check and the light/dark plate (shared by every logo). `owner` is
 * whose mark it is (the company, or one of its products) and goes in the
 * credit; the photo itself is always tied to the verified company (`qid`,
 * `company`), so the repeat rule and the photo bank see every mark as its own.
 */
async function logoFromFile(
  file: string,
  owner: string,
  qid: string,
  company: string,
  http: typeof fetch,
  opts: { softwareLicences?: boolean } = {},
): Promise<LogoResult> {
  const ii = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(LOGO_PX), iiextmetadatalanguage: 'en', format: 'json', origin: '*' })) ii.searchParams.set(k, v);
  const ir = await http(ii.toString(), { headers: HEADERS });
  if (!ir.ok) return { photo: null, reason: `Commons HTTP ${ir.status}` };
  const q = (await ir.json()) as { query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: Record<string, { value?: string }> }> }> } };
  const info = Object.values(q.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info?.thumburl) return { photo: null, reason: `logo file not on Commons: ${file}` };
  const licence = info.extmetadata?.LicenseShortName?.value ?? '';
  const tier = classifyLicense(licence);
  const software = !tier && opts.softwareLicences === true && SOFTWARE_LOGO_LICENCE.test(licence.trim());
  if (!tier && !software) return { photo: null, reason: `logo licence not allowed: "${licence || 'none'}" (${file})` };
  const w = info.thumbwidth ?? 0;
  const h = info.thumbheight ?? 0;
  if (!w || !h || w / h > LOGO_MAX_ASPECT) return { photo: null, reason: `logo too wide for a card (${w}×${h}) (${file})` };

  const png = await http(info.thumburl, { headers: { 'User-Agent': USER_AGENT } });
  if (!png.ok) return { photo: null, reason: `logo download HTTP ${png.status}` };
  const plate = await plateFor(Buffer.from(await png.arrayBuffer()));
  if (!plate) return { photo: null, reason: `logo has no visible pixels (${file})` };
  const shown = tier === 'PD/CC0' ? (/cc0/i.test(licence) ? 'CC0' : 'public domain') : licence;
  return {
    file,
    photo: { url: info.thumburl, credit: `Logo: ${owner} (${shown}) · Wikimedia Commons`, source: 'logo', width: w, height: h, qid, subject: company, plate },
  };
}

type ClaimsByProp = Record<string, Claim[]>;

async function wikidata(ids: string[], props: string, http: typeof fetch): Promise<Record<string, { claims?: ClaimsByProp; labels?: Record<string, { value?: string }> }>> {
  const ent = new URL(WIKIDATA_API);
  // `mul` too: Wikidata now keeps many names only as a multilingual label.
  for (const [k, v] of Object.entries({ action: 'wbgetentities', ids: ids.join('|'), props, languages: 'en|mul', format: 'json', origin: '*' })) ent.searchParams.set(k, v);
  const er = await http(ent.toString(), { headers: HEADERS });
  if (!er.ok) throw new Error(`Wikidata HTTP ${er.status}`);
  return ((await er.json()) as { entities?: Record<string, { claims?: ClaimsByProp; labels?: Record<string, { value?: string }> }> }).entities ?? {};
}

/** The company's single current logo card, or why there is none. */
export async function fetchLogo(qid: string, company: string, opts: { http?: typeof fetch; softwareLicences?: boolean } = {}): Promise<LogoResult> {
  const http = opts.http ?? fetch;
  let claims: ClaimsByProp | undefined;
  try {
    claims = (await wikidata([qid], 'claims', http))[qid]?.claims;
  } catch (err) {
    return { photo: null, reason: err instanceof Error ? err.message : String(err) };
  }
  const file = currentLogoFile(claims?.P154 ?? []);
  if (!file) return { photo: null, reason: 'no current Wikidata logo (P154)' };
  return logoFromFile(file, company, qid, company, http, { softwareLicences: opts.softwareLicences });
}

/** At most this many of a company's products add their logo to its pool. */
export const MAX_PRODUCT_LOGOS = 4;
/** How many linked products are looked at to find those logos. */
const PRODUCTS_LOOKED_AT = 12;

/**
 * The logo files an entity has now: every logo image (P154) without an end
 * date, then its small logo (P8972) and icon (P2910). Never a deprecated or
 * ended one; preferred rank and the latest start date first; each file once.
 */
export function logoFiles(claims: ClaimsByProp | undefined): string[] {
  const live = (prop: string) => {
    const c = (claims?.[prop] ?? []).filter((x) => x.rank !== 'deprecated' && typeof x.mainsnak?.datavalue?.value === 'string' && !x.qualifiers?.P582?.length);
    const start = (x: Claim) => x.qualifiers?.P580?.[0]?.datavalue?.value?.time ?? '';
    return c
      .map((x, i) => ({ x, i }))
      .sort((a, b) => Number(b.x.rank === 'preferred') - Number(a.x.rank === 'preferred') || start(b.x).localeCompare(start(a.x)) || a.i - b.i)
      .map(({ x }) => x.mainsnak!.datavalue!.value as string);
  };
  return [...new Set([...live('P154'), ...live('P8972'), ...live('P2910')])];
}

export type LogoVariant = { photo: Photo; file: string };

/**
 * A company's logo pool (Tommy, 2026-10-12): its own current logos and icon,
 * then the logos of up to MAX_PRODUCT_LOGOS products Wikidata links to it
 * (P1056 product, P1830 owner of; Anthropic: Claude, Claude Code). Each goes
 * through the same licence and shape checks as any logo. A failing file is
 * skipped with a reason; the rest stay. Free Wikidata and Commons reads.
 */
export async function fetchLogos(qid: string, company: string, opts: { http?: typeof fetch } = {}): Promise<{ logos: LogoVariant[]; reasons: string[] }> {
  const http = opts.http ?? fetch;
  const reasons: string[] = [];
  let own: ClaimsByProp | undefined;
  try {
    own = (await wikidata([qid], 'claims', http))[qid]?.claims;
  } catch (err) {
    return { logos: [], reasons: [err instanceof Error ? err.message : String(err)] };
  }
  // [file, whose mark it is]
  const wanted: Array<[string, string]> = logoFiles(own).map((f): [string, string] => [f, company]);
  const productIds = [...new Set([...(own?.P1056 ?? []), ...(own?.P1830 ?? [])].map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => typeof x === 'string'))].slice(0, PRODUCTS_LOOKED_AT);
  if (productIds.length) {
    try {
      const products = await wikidata(productIds, 'claims|labels', http);
      let withLogo = 0;
      for (const id of productIds) {
        const e = products[id];
        // Wikidata lists dissolved companies as products too (Nvidia: Ageia); a mark that no longer exists is no cover.
        if (e?.claims?.P576?.length) continue;
        const files = logoFiles(e?.claims);
        if (!files.length || withLogo >= MAX_PRODUCT_LOGOS) continue;
        withLogo++;
        // The credit is printed on the post: the product's name, else the company's, never a Wikidata id.
        wanted.push([files[0]!, e?.labels?.en?.value ?? e?.labels?.mul?.value ?? company]);
      }
    } catch (err) {
      reasons.push(`products: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const logos: LogoVariant[] = [];
  const seen = new Set<string>();
  for (const [file, owner] of wanted) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const r = await logoFromFile(file, owner, qid, company, http);
      if (r.photo) logos.push({ photo: r.photo, file: r.file });
      else reasons.push(r.reason);
    } catch (err) {
      reasons.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!logos.length && !reasons.length) reasons.push('no logo on Wikidata (P154, P8972, P2910) for the company or its products');
  return { logos, reasons };
}
