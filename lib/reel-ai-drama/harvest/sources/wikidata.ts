import { fetchEntityP18 } from '@/lib/social/editorial/v2/image-step/commons';

import { getJson } from '../fetch';
import { contentWords } from '../plan';
import type { Source, SourceRun, Want } from '../types';
import { commonsFiles, commonsSearchTitles } from './commons';

/**
 * Wikidata/Commons photos tied to a QID (research 04 §2.1): the item's main image (P18) and the newest
 * Commons files that state they depict it (P180). The QID is the identity proof, so these candidates
 * carry it; the face count from the look still has to agree (filters.ts). A cast person the pitch gave
 * no QID is looked up by name first (free), so a prominent figure never misses their Commons portraits.
 */

export const DEPICTS_LIMIT = 10;
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

type SearchHit = { id: string; label?: string; description?: string; match?: { type?: string; text?: string } };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const NOT_A_PERSON = /disambiguation|family name|given name|surname|wikimedia|^fictional/i;

/**
 * The QID of a person from a name search: an exact label or alias match that is not a name page or a
 * disambiguation. Several namesakes: the one whose description shares a word with the story's context;
 * still unsure: none (a wrong QID would "verify" a stranger's photo).
 */
export function pickPersonQid(hits: readonly SearchHit[], name: string, context = ''): string | null {
  const exact = hits.filter((h) => norm(h.match?.text ?? h.label ?? '') === norm(name) || norm(h.label ?? '') === norm(name));
  const people = exact.filter((h) => !NOT_A_PERSON.test(h.description ?? ''));
  if (people.length === 1) return people[0].id;
  if (!people.length) return null;
  const ctx = new Set(contentWords(context));
  const fits = people.filter((h) => contentWords(h.description ?? '').some((w) => ctx.has(w)));
  return fits.length === 1 ? fits[0].id : null;
}

export async function resolvePersonQid(run: SourceRun, want: Want): Promise<string | null> {
  const name = want.people[0];
  if (!name) return null;
  const url = new URL(WIKIDATA_API);
  for (const [k, v] of Object.entries({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '7', format: 'json', origin: '*' })) url.searchParams.set(k, v);
  const body = await getJson<{ search?: SearchHit[] }>(run.deps.http, url.toString());
  const qid = pickPersonQid(body.search ?? [], name, want.context ?? '');
  run.notes.push(qid ? `wikidata: ${name} resolved by name to ${qid}` : `wikidata: no single person QID for "${name}"`);
  return qid;
}

export const wikidataSource: Source = async (want, run) => {
  const out = [];
  const qids = want.qids.length || want.kind !== 'person_photo' ? want.qids : [await resolvePersonQid(run, want)].filter((q): q is string => !!q);
  const resolved = !want.qids.length && qids.length > 0;
  for (const qid of qids) {
    const p18 = await fetchEntityP18(qid, { http: run.deps.http });
    const depicts = want.kind === 'person_photo' ? await commonsSearchTitles(run, `haswbstatement:P180=${qid}`, DEPICTS_LIMIT, 'create_timestamp_desc') : [];
    const titles = [...new Set([...(p18 ? [`File:${p18}`] : []), ...depicts])];
    if (!titles.length) run.notes.push(`wikidata ${qid}: no main image and no depicts files`);
    const found = await commonsFiles(run, titles, want, { source: 'wikidata', qids: [qid], people: want.people });
    out.push(...(resolved ? found.map((c) => ({ ...c, flags: [...c.flags, 'qid:resolved_by_name'] })) : found));
  }
  return out;
};
