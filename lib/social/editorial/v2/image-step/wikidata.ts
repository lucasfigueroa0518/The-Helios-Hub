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
  briefTerms: Array<{ name: string; description: string; wikidataQid?: string }>;
  briefStory: string;
};

/**
 * Regex for organisation-ish descriptions returned by wbsearchentities.
 * Used to break ties among candidates that share the exact subject label:
 * an org-shaped description wins over a philosophy/species/software-library
 * hit. Deliberately narrow — matches only description phrasings Wikidata
 * actually uses ("American company", "AI corporation", "Python library"
 * DOES NOT match here).
 */
const ORG_SHAPE_RE = /\b(company|corporation|corp|inc\.?|ltd|nonprofit|non-profit|firm|organization|organisation|startup|studio|laboratory|labs|foundation|institute|agency|association|coalition)\b/i;

/**
 * Strip a trailing parenthetical suffix off a TERMS name so the
 * resolver's QID-pin fast path matches even when the Reporter wrote
 * "METR (Model Evaluation and Threat Research)" or "GPT-5.6 (Sol)".
 * Kept private here so the resolver has no dependency on image-step's
 * own copy of the same helper.
 */
function bareName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

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
  // Type-shape bonus (2026-10-01 Part 1 name-confusion fix): when the
  // brief tells us the subject is an org (TERMS description mentions
  // company/nonprofit/etc.) and this candidate's Wikidata description
  // agrees, +3. Same for persons. Fixes the "OpenAI (research
  // organization)" vs "OpenAI (company)" tie by rewarding the candidate
  // whose type-shape matches the brief's own gloss on the subject.
  const subjLower = ctx.subject.toLowerCase();
  const term = ctx.briefTerms.find((t) => t.name.toLowerCase() === subjLower);
  if (term) {
    const termIsOrg = ORG_SHAPE_RE.test(term.description);
    const termIsPerson = PERSON_SHAPE_RE.test(term.description);
    const candIsOrg = ORG_SHAPE_RE.test(cand.description);
    const candIsPerson = PERSON_SHAPE_RE.test(cand.description);
    if (termIsOrg && candIsOrg) score += 3;
    if (termIsPerson && candIsPerson) score += 3;
    // Anti-signal: if the candidate description is clearly a wrong
    // type (person when brief says org, or vice versa), penalise. Same
    // magnitude as the positive so a same-name look-alike of the wrong
    // type falls a full 6 points below a right-type match.
    if (termIsOrg && candIsPerson) score -= 3;
    if (termIsPerson && candIsOrg) score -= 3;
  }
  return score;
}

/**
 * Person-shape description keywords (mirror of ORG_SHAPE_RE).
 * Matches short role glosses Wikidata uses on person entities and
 * matches TERMS descriptions that identify a subject as a person.
 * Used by scoreCandidate's type-shape bonus.
 */
const PERSON_SHAPE_RE = /\b(person|politician|governor|senator|president|ceo|cto|cfo|founder|researcher|scientist|journalist|reporter|editor|writer|author|professor|director|actor|actress|musician|singer|artist|athlete|congressman|congresswoman|minister|judge)\b/i;

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

  // ── QID pin fast path ────────────────────────────────────────────────
  // 2026-10-01 Part 1: when a TERMS entry names this subject and pins a
  // wikidataQid, skip search + scoring + ambiguity check. The pinned Q-id
  // is the authoritative answer. Prevents repeat losses on ambiguous
  // short labels like "OpenAI" (two org entities on Wikidata).
  const pin = input.briefTerms.find(
    (t) => bareName(t.name).toLowerCase() === subject.toLowerCase() && t.wikidataQid,
  );
  if (pin?.wikidataQid) {
    // Search on the QID itself — wbsearchentities returns the entity so we
    // get its label + description for the report shape.
    const cands = await searchWikidataEntities(pin.wikidataQid, { http: opts.http });
    const hit = cands.find((c) => c.id === pin.wikidataQid) ?? cands[0];
    if (!hit) {
      return { ok: false, reason: `pinned QID ${pin.wikidataQid} for "${subject}" returned no Wikidata entity` };
    }
    return { ok: true, candidate: hit, score: Number.POSITIVE_INFINITY, runnerUpScore: 0 };
  }

  const candidates = await searchWikidataEntities(subject, { http: opts.http });
  if (candidates.length === 0) {
    return { ok: false, reason: `no Wikidata entities match "${subject}"` };
  }

  // ── Exact-label preference ───────────────────────────────────────────
  // 2026-10-01 Part 1 name-confusion fix. When multiple candidates come
  // back and only ONE has a label exactly equal to the subject (case-
  // insensitive), take it — subject "Anthropic" should not lose to
  // "anthropic principle" (Q240581) merely because both matched the
  // search. When several candidates share the exact label (e.g. two
  // "OpenAI" entities), narrow to org-shaped descriptions and, within
  // that pool, run the existing scoring. Pin the ambiguous case in
  // TERMS.wikidataQid if you need a repeat-safe answer.
  const subjectLower = subject.toLowerCase();
  const exactMatches = candidates.filter((c) => c.label.toLowerCase() === subjectLower);
  if (exactMatches.length === 1) {
    const only = exactMatches[0]!;
    return { ok: true, candidate: only, score: Number.POSITIVE_INFINITY, runnerUpScore: 0 };
  }
  const pool = exactMatches.length > 1
    ? (exactMatches.filter((c) => ORG_SHAPE_RE.test(c.description)).length > 0
       ? exactMatches.filter((c) => ORG_SHAPE_RE.test(c.description))
       : exactMatches)
    : candidates;

  const scored = pool
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
