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

/** The company's logo card image, or why there is none. */
export async function fetchLogo(qid: string, company: string, opts: { http?: typeof fetch } = {}): Promise<LogoResult> {
  const http = opts.http ?? fetch;
  const ent = new URL(WIKIDATA_API);
  for (const [k, v] of Object.entries({ action: 'wbgetentities', ids: qid, props: 'claims', format: 'json', origin: '*' })) ent.searchParams.set(k, v);
  const er = await http(ent.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!er.ok) return { photo: null, reason: `Wikidata HTTP ${er.status}` };
  const body = (await er.json()) as { entities?: Record<string, { claims?: Record<string, Claim[]> }> };
  const file = currentLogoFile(body.entities?.[qid]?.claims?.P154 ?? []);
  if (!file) return { photo: null, reason: 'no current Wikidata logo (P154)' };

  const ii = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(LOGO_PX), iiextmetadatalanguage: 'en', format: 'json', origin: '*' })) ii.searchParams.set(k, v);
  const ir = await http(ii.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!ir.ok) return { photo: null, reason: `Commons HTTP ${ir.status}` };
  const q = (await ir.json()) as { query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: Record<string, { value?: string }> }> }> } };
  const info = Object.values(q.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info?.thumburl) return { photo: null, reason: `logo file not on Commons: ${file}` };
  const licence = info.extmetadata?.LicenseShortName?.value ?? '';
  const tier = classifyLicense(licence);
  if (!tier) return { photo: null, reason: `logo licence not allowed: "${licence || 'none'}"` };
  const w = info.thumbwidth ?? 0;
  const h = info.thumbheight ?? 0;
  if (!w || !h || w / h > LOGO_MAX_ASPECT) return { photo: null, reason: `logo too wide for a card (${w}×${h})` };

  const png = await http(info.thumburl, { headers: { 'User-Agent': USER_AGENT } });
  if (!png.ok) return { photo: null, reason: `logo download HTTP ${png.status}` };
  const plate = await plateFor(Buffer.from(await png.arrayBuffer()));
  if (!plate) return { photo: null, reason: 'logo has no visible pixels' };
  const shown = tier === 'PD/CC0' ? (/cc0/i.test(licence) ? 'CC0' : 'public domain') : licence;
  return {
    file,
    photo: { url: info.thumburl, credit: `Logo: ${company} (${shown}) · Wikimedia Commons`, source: 'logo', width: w, height: h, qid, subject: company, plate },
  };
}
