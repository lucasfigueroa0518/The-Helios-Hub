/**
 * An organization's photos (photo spec §2, §4; Tommy, 2026-10-07, fifth
 * round): its CEO's headshot, its logo card and its headquarters, all from
 * the identity-verified organization's own Wikidata entry. Fetched once per
 * organization per post (the finder caches the promise by QID).
 *
 *   CEO           P169 (preferred rank first, no end date P582); none: the
 *                 founder (P112) when there is exactly one. That person's P18,
 *                 the same usability rule as every headshot (p18.ts).
 *   logo          P154, through logo.ts.
 *   headquarters  the current headquarters building's own photo (P159, no end
 *                 date, when that entity has a P18), else the organization's
 *                 best P18 (preferred rank first); kept only when the Jev
 *                 metadata question org-hq@1 says the Commons file shows its
 *                 building, and only when the photo is no more than
 *                 HQ_MAX_AGE_YEARS older than the story (2026-10-08: an
 *                 OpenAI post showed its 2019 building).
 *
 * Twins: Wikidata sometimes splits one company in two (OpenAI: Q124605186,
 * the operating company with 11 claims, "said to be the same as" (P460)
 * Q21708200, the main entry with its CEO, logo and building). A source the
 * verified entry lacks is filled from a P460 twin with the same English
 * name, never from any other entity.
 *
 * Wikidata and Commons reads are free; the headquarters check is one Jev call
 * per organization that has a P18.
 */
import { buildCredit, fetchImageInfo, toCandidate, type CommonsCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import type { JevAsk } from '@/lib/social/jev/client';
import * as OrgHq from '@/lib/social/jev/questions/org-hq.v1';

import type { Photo } from './find';
import { fetchLogo } from './logo';
import { P18_MIN_SHORT_SIDE } from './p18';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

type Claim = {
  rank?: 'preferred' | 'normal' | 'deprecated';
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown[]>;
};
type Entity = { claims?: Record<string, Claim[]>; labels?: Record<string, { value?: string }> };

/** A pool photo, with the Commons date of the file when it has one (photo spec §4 ranking). */
export type PoolPhoto = Photo & { date?: string | null };

export type OrgPool = {
  ceo: PoolPhoto | null;
  logo: PoolPhoto | null;
  hq: PoolPhoto | null;
  /** One line per source, for the run log. */
  notes: string[];
};

/** `storyDate` (YYYY-MM-DD): the headquarters photo must be no older than HQ_MAX_AGE_YEARS before it. */
export type OrgPoolDeps = { jev: JevAsk; http?: typeof fetch; storyDate?: string | null };

/** A headquarters photo dated more than this many years before the story is not used: buildings and offices change. */
export const HQ_MAX_AGE_YEARS = 5;

async function entities(ids: string[], props: string, http: typeof fetch): Promise<Record<string, Entity>> {
  const u = new URL(WIKIDATA_API);
  for (const [k, v] of Object.entries({ action: 'wbgetentities', ids: ids.join('|'), props, languages: 'en', format: 'json', origin: '*' })) u.searchParams.set(k, v);
  const res = await http(u.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return ((await res.json()) as { entities?: Record<string, Entity> }).entities ?? {};
}

const itemId = (c: Claim): string | null => {
  const v = c.mainsnak?.datavalue?.value as { id?: string } | undefined;
  return typeof v?.id === 'string' ? v.id : null;
};

/** The current CEO's QID: not deprecated, no end date (P582), preferred rank first. */
export function currentChief(claims: Claim[]): string | null {
  const live = claims.filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582?.length && itemId(c));
  const preferred = live.filter((c) => c.rank === 'preferred');
  return itemId((preferred.length ? preferred : live)[0] ?? {}) ?? null;
}

/** The founder's QID, only when there is exactly one. */
export function soleFounder(claims: Claim[]): string | null {
  const ids = [...new Set(claims.filter((c) => c.rank !== 'deprecated').map(itemId).filter((x): x is string => Boolean(x)))];
  return ids.length === 1 ? ids[0]! : null;
}

/** The best file of a P18 list: preferred rank first, never deprecated. */
const firstFile = (claims: Claim[] | undefined): string | null => {
  const live = (claims ?? []).filter((c) => c.rank !== 'deprecated');
  const v = (live.find((c) => c.rank === 'preferred') ?? live[0])?.mainsnak?.datavalue?.value;
  return typeof v === 'string' && v ? v : null;
};

/** The current headquarters location (P159): not deprecated, no end date (P582), preferred rank first. */
export function currentHeadquarters(claims: Claim[]): string | null {
  return currentChief(claims);
}

/** Is a photo dated `date` too old for a story dated `storyDate`? Undated photos and stories pass. */
export function tooOld(date: string | null | undefined, storyDate: string | null | undefined, maxYears = HQ_MAX_AGE_YEARS): boolean {
  const d = date ? Date.parse(date.slice(0, 10)) : NaN;
  const s = storyDate ? Date.parse(storyDate.slice(0, 10)) : NaN;
  if (Number.isNaN(d) || Number.isNaN(s)) return false;
  return s - d > maxYears * 365.25 * 24 * 3600 * 1000;
}

async function usableFile(file: string, http: typeof fetch): Promise<{ pick: CommonsCandidate | null; description: string }> {
  const title = `File:${file}`;
  const info = (await fetchImageInfo([title], { http }))[title];
  if (!info) return { pick: null, description: '' };
  const description = (info.extmetadata?.ImageDescription?.value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { pick: toCandidate(title, info, 'P18', { minShortSide: P18_MIN_SHORT_SIDE }), description };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Claims = Record<string, Claim[]>;
type Ctx = { org: { qid: string; label: string }; claims: Claims; deps: OrgPoolDeps; http: typeof fetch; notes: string[] };

/** The current CEO (or the sole founder) and their main photo. */
async function ceoPhoto({ org, claims, http, notes }: Ctx): Promise<PoolPhoto | null> {
  const chief = currentChief(claims.P169 ?? []);
  const person = chief ?? soleFounder(claims.P112 ?? []);
  const role = chief ? 'CEO' : 'founder';
  if (!person) {
    notes.push(`CEO: ${org.label} lists no current CEO (P169) and not exactly one founder (P112)`);
    return null;
  }
  const p = (await entities([person], 'claims|labels', http))[person];
  const name = p?.labels?.en?.value ?? person;
  const file = firstFile(p?.claims?.P18);
  const { pick } = file ? await usableFile(file, http) : { pick: null };
  if (!pick) {
    notes.push(`CEO: ${name} (${person}, ${role}) has ${file ? 'no usable main photo (licence, size or type)' : 'no main photo (P18)'}`);
    return null;
  }
  notes.push(`CEO: ${name} (${person}, ${role}) ${pick.file}`);
  return { url: pick.url, credit: `${name}, ${org.label} ${role} · ${buildCredit(pick)} · Wikimedia Commons`, source: 'ceo', width: pick.width, height: pick.height, qid: person, subject: name, date: pick.date ?? null };
}

async function logoPhoto({ org, http, notes }: Ctx): Promise<Photo | null> {
  const logo = await fetchLogo(org.qid, org.label, { http });
  notes.push(logo.photo ? `logo: File:${logo.file} (${logo.photo.plate} plate)` : `logo: ${logo.reason}`);
  return logo.photo;
}

/** The headquarters files to try, in order: the current headquarters entity's P18, then the organization's own. */
async function hqFiles({ claims, http, notes }: Ctx): Promise<string[]> {
  const files: string[] = [];
  const hq = currentHeadquarters(claims.P159 ?? []);
  if (hq) {
    const e = (await entities([hq], 'claims', http).catch(() => ({}) as Record<string, Entity>))[hq];
    const f = firstFile(e?.claims?.P18);
    if (f) files.push(f);
    else notes.push(`headquarters: P159 ${hq} has no main photo (P18)`);
  }
  const own = firstFile(claims.P18);
  if (own && !files.includes(own)) files.push(own);
  return files;
}

/** The headquarters photo: the first file that is usable, recent enough and describes the organization's building (org-hq@1). */
async function hqPhoto(ctx: Ctx): Promise<PoolPhoto | null> {
  const files = await hqFiles(ctx);
  if (!files.length) {
    ctx.notes.push('headquarters: no main photo (P159 or P18)');
    return null;
  }
  for (const file of files) {
    const photo = await hqCandidate(ctx, file);
    if (photo) return photo;
  }
  return null;
}

async function hqCandidate({ org, deps, http, notes }: Ctx, file: string): Promise<PoolPhoto | null> {
  const { pick, description } = await usableFile(file, http);
  if (!pick) {
    notes.push(`headquarters: File:${file} not usable (licence, size or type)`);
    return null;
  }
  if (tooOld(pick.date, deps.storyDate)) {
    notes.push(`headquarters: File:${file} dated ${pick.date}, more than ${HQ_MAX_AGE_YEARS} years before the story (${deps.storyDate}) → not used`);
    return null;
  }
  const title = file.replace(/\.[a-z0-9]+$/i, '');
  const res = await deps.jev({ state: OrgHq.buildState(org.label, { title, description }), questions: OrgHq.buildQuestions() }, { version: OrgHq.VERSION, subjectId: org.qid });
  const hq = res.answers[OrgHq.HQ_ID]?.noul ?? 0;
  const people = res.answers[OrgHq.PEOPLE_ID]?.noul ?? 0;
  const ok = hq >= OrgHq.THRESHOLDS.HQ_MIN && people < OrgHq.THRESHOLDS.PEOPLE_MAX;
  notes.push(`headquarters ${OrgHq.VERSION}: File:${file} hq ${hq.toFixed(2)} people ${people.toFixed(2)} → ${ok ? 'ok' : 'not a headquarters photo'}`);
  return ok ? { url: pick.url, credit: `${org.label} headquarters · ${buildCredit(pick)} · Wikimedia Commons`, source: 'hq', width: pick.width, height: pick.height, qid: org.qid, subject: org.label, date: pick.date ?? null } : null;
}

/** The organization's CEO, logo and headquarters photos (each null with a note when missing). One source failing never costs the others. */
export async function orgPool(org: { qid: string; label: string }, deps: OrgPoolDeps): Promise<OrgPool> {
  const http = deps.http ?? fetch;
  const notes: string[] = [];
  const entity = await entities([org.qid], 'claims', http).catch((err) => {
    notes.push(`Wikidata error: ${errText(err)} (no CEO or headquarters)`);
    return {} as Record<string, Entity>;
  });
  const claims = entity[org.qid]?.claims ?? {};
  const safely = (ctx: Ctx, label: string, fn: (c: Ctx) => Promise<PoolPhoto | null>) =>
    fn(ctx).catch((err) => {
      notes.push(`${label} error: ${errText(err)}`);
      return null;
    });
  const pool = async (ctx: Ctx, have: Partial<Record<'ceo' | 'logo' | 'hq', PoolPhoto | null>> = {}) => ({
    ceo: have.ceo ?? (await safely(ctx, 'CEO', ceoPhoto)),
    logo: have.logo ?? (await safely(ctx, 'logo', logoPhoto)),
    hq: have.hq ?? (await safely(ctx, 'headquarters', hqPhoto)),
  });
  let found = await pool({ org, claims, deps, http, notes });
  if (!found.ceo || !found.logo || !found.hq) {
    const twin = await sameNameTwin(org, claims, http).catch(() => null);
    if (twin) {
      notes.push(`twin: ${twin.qid} (P460, same name "${org.label}") fills what ${org.qid} lacks`);
      found = await pool({ org: { qid: twin.qid, label: org.label }, claims: twin.claims, deps, http, notes }, found);
    }
  }
  return { ...found, notes };
}

/** A P460 ("said to be the same as") entry with the same English name, and its claims. */
async function sameNameTwin(org: { qid: string; label: string }, claims: Claims, http: typeof fetch): Promise<{ qid: string; claims: Claims } | null> {
  const ids = (claims.P460 ?? []).map(itemId).filter((x): x is string => Boolean(x));
  if (!ids.length) return null;
  const ents = await entities(ids, 'claims|labels', http);
  const qid = ids.find((id) => ents[id]?.labels?.en?.value?.trim().toLowerCase() === org.label.trim().toLowerCase());
  return qid ? { qid, claims: ents[qid]?.claims ?? {} } : null;
}
