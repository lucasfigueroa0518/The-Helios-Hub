/**
 * A second photo of a verified person (photo spec §3; Tommy, 2026-10-07),
 * e.g. the cover used their main photo and their quote slide needs another.
 * The only use of Commons "depicts" (P180): all three checks must agree.
 *
 *   1. tagged on Commons as depicting that exact person, by Wikidata ID
 *      (never by name): Commons search haswbstatement:P180=<QID>
 *   2. the file title contains the person's full name
 *   3. the face detector finds exactly one face (the finder, faces.ts)
 *
 * Plus the usual Commons rule (commons.ts toCandidate): an open licence, a
 * credited author, jpg/png, short side ≥ P18_MIN_SHORT_SIDE.
 * Code, no AI: one search, one imageinfo call.
 */
import { fetchImageInfo, toCandidate, type CommonsCandidate } from '@/lib/social/editorial/v2/image-step/commons';

import { P18_MIN_SHORT_SIDE } from './p18';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
/** Files looked at per person. */
export const SECOND_PHOTO_SEARCH_LIMIT = 20;

const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, ' ').trim();

/** Check 2: the file title contains the person's full name. */
export function titleNamesPerson(file: string, name: string): boolean {
  return norm(file.replace(/^File:/, '')).includes(norm(name));
}

export type SecondPhotos = (qid: string, name: string) => Promise<CommonsCandidate[]>;

/** Candidates passing checks 1–2 and the Commons rule, in search order. Check 3 (one face) is the finder's. */
export function createSecondPhotos(opts: { http?: typeof fetch } = {}): SecondPhotos {
  const http = opts.http ?? fetch;
  return async (qid, name) => {
    if (!/^Q\d+$/.test(qid)) throw new Error(`not a Wikidata id: ${qid}`);
    const url = new URL(COMMONS_API);
    for (const [k, v] of Object.entries({ action: 'query', list: 'search', srsearch: `haswbstatement:P180=${qid}`, srnamespace: '6', srlimit: String(SECOND_PHOTO_SEARCH_LIMIT), format: 'json', origin: '*' })) url.searchParams.set(k, v);
    const res = await http(url.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Commons depicts search failed: HTTP ${res.status}`);
    const body = (await res.json()) as { query?: { search?: Array<{ title: string }> } };
    const files = (body.query?.search ?? []).map((x) => x.title).filter((t) => titleNamesPerson(t, name));
    if (!files.length) return [];
    const info = await fetchImageInfo(files, { http });
    return files.flatMap((f) => {
      const c = info[f] ? toCandidate(f, info[f]!, 'P180', { minShortSide: P18_MIN_SHORT_SIDE }) : null;
      return c ? [c] : [];
    });
  };
}
