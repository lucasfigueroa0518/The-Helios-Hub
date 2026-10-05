/**
 * Subject identity check (spec §5A #5; plan M5). Both checks are required
 * before any subject photo is used:
 *
 *   1. Jev: is the subject a person, and which Wikidata entry's description
 *      matches the brief's description of the subject? When the pulled
 *      resolver picked one entry, Jev must confirm it; when it couldn't
 *      decide, Jev picks among its top candidates, and only a single clear
 *      match counts.
 *   2. Code: the chosen entry's "instance of" (P31) must fit the subject
 *      type: person = human (Q5); organization = anything under
 *      organization (Q43229) in Wikidata's class tree.
 *
 * Either check fails → no subject photo (the caller falls back to a scene).
 * Identity comes from records, never from a model looking at a face.
 */
import { resolveSubject } from '@/lib/social/editorial/v2/image-step/wikidata';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import type { Brief } from '@/lib/social/reporter/brief';

const SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

export type SubjectType = 'person' | 'organization';

export type IdentityResult =
  | { ok: true; qid: string; label: string; description: string; type: SubjectType; via: 'resolver' | 'jev-pick' }
  /** `type` is Jev's answer when it got that far, so the fallback scene can fit the subject. */
  | { ok: false; reason: string; type: SubjectType | null };

/** Code: what the entry is an instance of, as the two types we use. */
export async function fetchEntityTypes(qid: string, http: typeof fetch = fetch): Promise<{ human: boolean; organization: boolean }> {
  if (!/^Q\d+$/.test(qid)) throw new Error(`not a Wikidata id: ${qid}`);
  const query = `SELECT ?human ?org WHERE {
    BIND(EXISTS { wd:${qid} wdt:P31 wd:Q5 } AS ?human)
    BIND(EXISTS { wd:${qid} wdt:P31/wdt:P279* wd:Q43229 } AS ?org)
  }`;
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const res = await http(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`Wikidata type query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { results?: { bindings?: Array<Record<string, { value: string }>> } };
  const row = body.results?.bindings?.[0] ?? {};
  return { human: row.human?.value === 'true', organization: row.org?.value === 'true' };
}

export type IdentityDeps = { jev: JevAsk; http?: typeof fetch };

export async function checkIdentity(
  subject: { name: string; role: string | null },
  brief: Brief,
  deps: IdentityDeps,
): Promise<IdentityResult> {
  const story = [brief.the_news.text, ...brief.facts.slice(0, 6).map((f) => f.text)].join(' ');
  const resolved = await resolveSubject(
    {
      subject: subject.name,
      briefTerms: [
        ...brief.subjects.map((s) => ({ name: s.name, description: s.role ?? '' })),
        ...brief.terms.map((t) => ({ name: t.name, description: t.definition })),
      ],
      briefStory: story,
    },
    { http: deps.http },
  );
  const candidates = resolved.ok ? [resolved.candidate] : (resolved.candidates ?? []);
  if (candidates.length === 0) return { ok: false, reason: `no Wikidata entry: ${resolved.ok ? '' : resolved.reason}`, type: null };

  const res = await deps.jev(
    { state: Identity.buildState(subject, story, candidates), questions: Identity.buildQuestions(candidates.length) },
    { version: Identity.VERSION, subjectId: subject.name },
  );
  const { MATCH_MIN, PERSON_MIN } = Identity.THRESHOLDS;
  const person = res.answers.is_person!.noul;
  const type: SubjectType | null = person >= PERSON_MIN ? 'person' : person <= 1 - PERSON_MIN ? 'organization' : null;
  if (!type) return { ok: false, reason: `subject type unclear (person ${person.toFixed(2)})`, type: null };

  const matches = candidates
    .map((c, k) => ({ c, p: res.answers[Identity.matchId(k)]!.noul }))
    .filter((m) => m.p >= MATCH_MIN);
  if (matches.length === 0) {
    return { ok: false, reason: `no entry matches the brief (${candidates.map((c) => `${c.id} "${c.description}"`).join('; ')})`, type };
  }
  if (matches.length > 1) return { ok: false, reason: `several entries match: ${matches.map((m) => m.c.id).join(', ')}`, type };
  const chosen = matches[0]!.c;

  const types = await fetchEntityTypes(chosen.id, deps.http);
  const fits = type === 'person' ? types.human : types.organization;
  if (!fits) {
    return { ok: false, reason: `${chosen.id} "${chosen.label}" is not ${type === 'person' ? 'a human' : 'an organization'} in Wikidata (P31)`, type };
  }
  return { ok: true, qid: chosen.id, label: chosen.label, description: chosen.description, type, via: resolved.ok ? 'resolver' : 'jev-pick' };
}
