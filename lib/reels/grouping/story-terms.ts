/**
 * D-265. Content overlap between two stories, for proposing grouping
 * candidates. Headline wording alone misses the same event reported from a
 * different angle ("OpenAI has work to do to rebuild trust in Australia"
 * against "AI agents linked to OpenAI made failed hacking attempts on
 * government websites" scored 0.22 on trigram similarity and never reached
 * Jev). This compares what the stories say: the headline and the opening of
 * the body, each word weighted by how rare it is in the pool being compared.
 *
 * Nothing here knows any company, person, or topic. A word that is everywhere
 * in tonight's pool, such as the name of the biggest lab, weighs little
 * because it is everywhere; a word two stories share and nobody else uses
 * weighs a lot. Jev still makes every decision; this only decides who it sees.
 */

/**
 * Words from the body's opening that count, after the headline. Calibrated on
 * 643 stored Jev grouping decisions: at 250 words every pair Jev called the
 * same event scored 0.128 or higher (D-265).
 */
export const LEAD_WORDS = 250;
/** Headline words count this many times over a lead word. */
const HEADLINE_WEIGHT = 2;

/** Function words only. No domain vocabulary, so the list cannot steer topics. */
const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves says said say new one two get gets got make makes made like may might must us its it\'s don\'t can\'t won\'t'
  ).split(/\s+/),
);

export type StoryTerms = Map<string, number>;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’‛']/g, '')
    .split(/[^a-z0-9$%.]+/)
    .map((word) => word.replace(/^[.]+|[.]+$/g, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/** Term counts for one story: headline words weighted, then the lead. */
export function storyTerms(headline: string, body: string, leadWords = LEAD_WORDS): StoryTerms {
  const terms: StoryTerms = new Map();
  for (const word of words(headline)) terms.set(word, (terms.get(word) ?? 0) + HEADLINE_WEIGHT);
  for (const word of words(body).slice(0, leadWords)) terms.set(word, (terms.get(word) ?? 0) + 1);
  return terms;
}

export type Idf = { weight: (term: string) => number };

/** Inverse document frequency over the pool being compared, smoothed. */
export function poolIdf(pool: readonly StoryTerms[]): Idf {
  const df = new Map<string, number>();
  for (const terms of pool) for (const term of terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const n = pool.length;
  return { weight: (term) => Math.log((n + 1) / ((df.get(term) ?? 0) + 1)) + 1 };
}

function vector(terms: StoryTerms, idf: Idf): Map<string, number> {
  const out = new Map<string, number>();
  for (const [term, count] of terms) out.set(term, (1 + Math.log(count)) * idf.weight(term));
  return out;
}

/** Cosine similarity of two stories' weighted terms, 0 to 1. */
export function storyOverlap(a: StoryTerms, b: StoryTerms, idf: Idf): number {
  const va = vector(a, idf);
  const vb = vector(b, idf);
  let dot = 0;
  for (const [term, weight] of va) dot += weight * (vb.get(term) ?? 0);
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((sum, x) => sum + x * x, 0));
  const denominator = norm(va) * norm(vb);
  return denominator === 0 ? 0 : dot / denominator;
}
