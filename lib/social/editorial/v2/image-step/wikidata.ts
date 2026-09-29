/**
 * Wikidata entity resolver.
 *
 * Per docs/IMAGES-V1-HANDOFF.md §Accuracy rules: identity comes from
 * Wikidata records, never from a free-text search or a model looking at
 * a face. This module resolves a "photo of <subject>" string to a single
 * Wikidata Q-id — or null if it can't be resolved unambiguously.
 *
 * Flow:
 *   1. wbsearchentities → up to N candidates (each: id, label, description).
 *   2. Score each candidate by how well its Wikidata description matches
 *      the brief's TERMS + THE STORY text.
 *   3. Return the top candidate iff it beats the runner-up by a clear
 *      margin AND its score clears an absolute floor. Otherwise null.
 *
 * Ambiguity is the failure mode we care about: "Sam Altman" the OpenAI
 * CEO vs some other Sam Altman. If both plausibly match the brief, the
 * spec is explicit: no photo.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

export type WikidataCandidate = {
  id: string;              // "Q19837"
  label: string;           // "Gavin Newsom"
  description: string;     // "Governor of California since 2019"
  aliases: string[];
};

export type ResolveInput = {
  subject: string;         // "photo of Gavin Newsom" or just "Gavin Newsom"
  briefTerms: Array<{ name: string; description: string }>;
  briefStory: string;
};

export type ResolveResult =
  | { ok: true;  candidate: WikidataCandidate; score: number; runnerUpScore: number }
  | { ok: false; reason: string; candidates?: WikidataCandidate[] };

/** Strip a leading "photo of ", any leading article ("the ", "a "), and surrounding punctuation. */
export function normalizeSubject(raw: string): string {
  return raw
    .trim()
    .replace(/^photo of\s+/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[.,;:'"!?]+$/g, '')
    .trim();
}

/**
 * Search Wikidata for entity candidates matching the subject. Uses
 * wbsearchentities — the same endpoint the Wikidata UI uses for the
 * search box, so results include labels + descriptions + aliases.
 *
 * Injectable http for tests.
 */
export async function searchWikidataEntities(
  subject: string,
  opts: { limit?: number; http?: typeof fetch } = {},
): Promise<WikidataCandidate[]> {
  const limit = opts.limit ?? 8;
  const http = opts.http ?? fetch;
  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', subject);
  url.searchParams.set('language', 'en');
  url.searchParams.set('uselang', 'en');
  url.searchParams.set('type', 'item');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Wikidata search failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    search?: Array<{
      id: string;
      label?: string;
      description?: string;
      aliases?: string[];
    }>;
  };
  return (body.search ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label ?? '',
    description: entry.description ?? '',
    aliases: entry.aliases ?? [],
  }));
}

/**
 * Score how well a candidate's description + label + aliases match the
 * brief context. Token overlap on the description carries most of the
 * weight; label + aliases contribute smaller bonuses.
 *
 * The score is unitless; only the RELATIVE gap between top and runner-up
 * matters for the ambiguity check.
 */
export function scoreCandidate(cand: WikidataCandidate, ctx: ResolveInput): number {
  const haystack = tokenize(`${ctx.briefStory} ${ctx.briefTerms.map((t) => `${t.name} ${t.description}`).join(' ')}`);
  const needle = tokenize(`${cand.description} ${cand.label} ${cand.aliases.join(' ')}`);
  let score = 0;
  for (const tok of needle) {
    if (tok.length < 3) continue;
    if (haystack.has(tok)) score += 1;
  }
  // Small bonus for a matching TERMS name — the writer picked this
  // subject from TERMS, so a candidate whose label/aliases literally
  // appear in TERMS gets an edge over a same-scoring look-alike.
  const termNames = ctx.briefTerms.map((t) => t.name.toLowerCase());
  for (const alias of [cand.label, ...cand.aliases]) {
    if (termNames.includes(alias.toLowerCase())) {
      score += 2;
      break;
    }
  }
  return score;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

/**
 * Resolve a subject string to a single Wikidata entity, using the brief
 * as tie-breaker context. Returns { ok: false } when the top candidate
 * doesn't beat the runner-up by at least MARGIN, or doesn't clear FLOOR.
 *
 * Ambiguity → no photo, per spec.
 */
const AMBIGUITY_MARGIN = 2;
const MIN_SCORE_FLOOR = 1;

export async function resolveSubject(
  input: ResolveInput,
  opts: { http?: typeof fetch } = {},
): Promise<ResolveResult> {
  const subject = normalizeSubject(input.subject);
  if (!subject) return { ok: false, reason: 'empty subject after normalization' };

  const candidates = await searchWikidataEntities(subject, { http: opts.http });
  if (candidates.length === 0) {
    return { ok: false, reason: `no Wikidata entities match "${subject}"` };
  }

  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(c, { ...input, subject }) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  const runnerUp = scored[1];

  if (top.score < MIN_SCORE_FLOOR) {
    return {
      ok: false,
      reason: `top candidate (${top.candidate.id} "${top.candidate.label}") scored ${top.score}, below floor ${MIN_SCORE_FLOOR}`,
      candidates: candidates.slice(0, 3),
    };
  }
  if (runnerUp && top.score - runnerUp.score < AMBIGUITY_MARGIN) {
    return {
      ok: false,
      reason: `ambiguous: top ${top.candidate.id} scored ${top.score}, runner-up ${runnerUp.candidate.id} scored ${runnerUp.score} (need margin ≥${AMBIGUITY_MARGIN})`,
      candidates: candidates.slice(0, 3),
    };
  }

  return {
    ok: true,
    candidate: top.candidate,
    score: top.score,
    runnerUpScore: runnerUp?.score ?? 0,
  };
}
