/**
 * The Reporter's brief as structured output (spec §4, §4.2a, §5.1).
 *
 * The Reporter ends by calling submit_brief, a strict-schema tool whose
 * fields mirror the prompt's section list (prompts file §1 OUTPUT), so the
 * brief arrives as JSON instead of free text (Tommy, 2026-10-05: replaces
 * the free-text parser). Code checks it against the schema, then: sources
 * exist, IDs are unique, cited IDs exist.
 */
import type Anthropic from '@anthropic-ai/sdk';

export const NUMBER_TYPES = ['money', 'count', 'percent', 'duration', 'date', 'other'] as const;
export type NumberType = (typeof NUMBER_TYPES)[number];

export type BriefFact = {
  id: string; // F1… or B1…
  text: string;
  sources: string[];
  /** X when the fact is marked [CLAIM: X says]; null otherwise. */
  claim_by: string | null;
  notes: string[];
};

export type BriefQuote = {
  id: string; // Q1…
  /** Exact quote text, without the surrounding quotation marks. */
  text: string;
  speaker: string;
  /** Where it was said (interview, post, statement). */
  where: string | null;
  /** Outlet(s) the quote was read in. */
  via: string[];
  single_source: boolean;
  cut_off: boolean;
  notes: string[];
};

export type BriefNumber = {
  id: string; // N1…
  /** Exactly as the source writes it ("nearly $21 billion"). */
  value: string;
  type: NumberType;
  counts: string;
  sources: string[];
  notes: string[];
};

export type Brief = {
  single_story: { yes: boolean; note: string | null };
  the_news: { text: string; ids: string[] };
  why_it_matters: Array<{ text: string; ids: string[] }>;
  facts: BriefFact[];
  background: BriefFact[];
  quotes: BriefQuote[];
  numbers: BriefNumber[];
  terms: Array<{ name: string; definition: string; source: string }>;
  subjects: Array<{ name: string; role: string | null }>;
  events: Array<{ what: string; date: string | null; place: string | null }>;
  article_photos: Array<{ caption: string | null; credit: string | null; url: string | null; page: string | null }>;
  not_answered: string[];
  sources: Array<{ outlet: string; date: string | null; url: string }>;
  fetch_failures: Array<{ url: string; reason: string }>;
};

// ── JSON schema (strict tool use: every object closed, every field required) ──

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strList = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items: unknown) => ({ type: 'array', items });

const fact = (idHint: string) =>
  obj({
    id: { type: 'string', description: idHint },
    text: { type: 'string', description: 'One sentence.' },
    sources: { ...strList, description: 'Outlets this fact comes from (only sources you opened).' },
    claim_by: { ...nullableStr, description: 'For [CLAIM: X says]: X. Null otherwise.' },
    notes: { ...strList, description: 'Caveats, disagreements, extra outlets. Empty if none.' },
  });

export const BRIEF_SCHEMA = obj({
  single_story: obj({ yes: { type: 'boolean' }, note: nullableStr }),
  the_news: obj({
    text: { type: 'string', description: 'One line (who, what, when).' },
    ids: { ...strList, description: 'Fact IDs it rests on.' },
  }),
  why_it_matters: list(obj({ text: str, ids: { ...strList, description: 'IDs it rests on (sourced only).' } })),
  facts: list(fact('F1, F2, …')),
  background: list(fact('B1, B2 (max 2)')),
  quotes: list(
    obj({
      id: { type: 'string', description: 'Q1, Q2, …' },
      text: { type: 'string', description: 'Exact text, word for word, without surrounding quotation marks.' },
      speaker: str,
      where: { ...nullableStr, description: 'Where it was said.' },
      via: { ...strList, description: 'Outlet(s) you read it in.' },
      single_source: { type: 'boolean', description: 'Found in only ONE source (⚠).' },
      cut_off: { type: 'boolean', description: 'Cut off in every source.' },
      notes: strList,
    }),
  ),
  numbers: list(
    obj({
      id: { type: 'string', description: 'N1, N2, …' },
      value: { type: 'string', description: 'Exactly as the source writes it.' },
      type: { type: 'string', enum: [...NUMBER_TYPES] },
      counts: { type: 'string', description: 'What it counts.' },
      sources: strList,
      notes: strList,
    }),
  ),
  terms: list(obj({ name: str, definition: { type: 'string', description: 'Plain-language definition taken from sources.' }, source: str })),
  subjects: list(obj({ name: str, role: nullableStr })),
  events: list(obj({ what: { type: 'string', description: 'Photographable event.' }, date: nullableStr, place: nullableStr })),
  article_photos: list(
    obj({
      caption: { ...nullableStr, description: 'Copied exactly; null if none.' },
      credit: { ...nullableStr, description: 'Copied exactly; null if none.' },
      url: nullableStr,
      page: { ...nullableStr, description: 'URL of the article the photo is in.' },
    }),
  ),
  not_answered: strList,
  sources: list(obj({ outlet: str, date: nullableStr, url: { type: 'string', description: 'Only sources you opened.' } })),
  fetch_failures: list(obj({ url: str, reason: str })),
});

/**
 * Not `strict`: the API caps the compiled grammar of strict tools, and the
 * full brief schema is over that limit (400 "compiled grammar is too
 * large", 2026-10-05; any 7 of the 14 sections fit, all 14 don't). The
 * schema is kept as designed and enforced in code instead: checkShape +
 * validateBrief, with one retry on failure (Tommy, 2026-10-05).
 */
export const SUBMIT_BRIEF_TOOL = {
  name: 'submit_brief',
  description: 'Submit the finished brief. Call it once, as your final step.',
  input_schema: BRIEF_SCHEMA,
} as unknown as Anthropic.Tool;

// ── Validation: the only check after the schema ──

export type BriefError = { section: string; message: string };

export class BriefValidationError extends Error {
  constructor(readonly errors: BriefError[]) {
    super(`brief invalid: ${errors.map((e) => `${e.section}: ${e.message}`).join('; ')}`);
  }
}

/** Shape check against BRIEF_SCHEMA (types, required fields, enums, no extra fields). */
export function checkShape(value: unknown, schema: any = BRIEF_SCHEMA, at = 'brief', errors: BriefError[] = []): BriefError[] {
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const ok = types.includes(actual) || (actual === 'number' && types.includes('integer') && Number.isInteger(value));
  if (!ok) {
    errors.push({ section: at, message: `expected ${types.join(' or ')}, got ${actual}` });
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push({ section: at, message: `"${String(value)}" not one of ${schema.enum.join(', ')}` });
  if (actual === 'array') (value as unknown[]).forEach((v, i) => checkShape(v, schema.items, `${at}[${i}]`, errors));
  if (actual === 'object' && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push({ section: at, message: `missing ${key}` });
    for (const key of Object.keys(obj)) {
      if (!(key in schema.properties)) errors.push({ section: at, message: `unexpected field ${key}` });
      else checkShape(obj[key], schema.properties[key], `${at}.${key}`, errors);
    }
  }
  return errors;
}

/** Shape, then: sources exist, IDs are unique, cited IDs exist. Returns the brief or throws. */
export function validateBrief(input: unknown): Brief {
  const shape = checkShape(input);
  if (shape.length > 0) throw new BriefValidationError(shape);
  const brief = input as Brief;
  const errors: BriefError[] = [];
  if (brief.sources.length === 0) errors.push({ section: 'sources', message: 'no sources' });
  const has = (list: string[]) => list.some((s) => s.trim());
  for (const [section, items] of [['facts', brief.facts], ['background', brief.background], ['numbers', brief.numbers]] as const) {
    for (const x of items) if (!has(x.sources)) errors.push({ section, message: `${x.id} has no source` });
  }
  for (const q of brief.quotes) if (!has(q.via)) errors.push({ section: 'quotes', message: `${q.id} has no source` });

  const seen = new Set<string>();
  for (const { id } of [...brief.facts, ...brief.background, ...brief.quotes, ...brief.numbers]) {
    if (seen.has(id)) errors.push({ section: 'ids', message: `duplicate id ${id}` });
    seen.add(id);
  }
  const cited: Array<[string, string[]]> = [
    ['the_news', brief.the_news.ids],
    ...brief.why_it_matters.map((w): [string, string[]] => ['why_it_matters', w.ids]),
  ];
  for (const [section, ids] of cited) {
    for (const id of ids) if (!seen.has(id)) errors.push({ section, message: `cites ${id}, which isn't in the brief` });
  }
  if (errors.length > 0) throw new BriefValidationError(errors);
  return brief;
}

/** Lookup by ID for copy-by-ID (spec §4.2a). */
export function briefIndex(brief: Brief) {
  return {
    quote: new Map(brief.quotes.map((q) => [q.id, q])),
    number: new Map(brief.numbers.map((n) => [n.id, n])),
    fact: new Map([...brief.facts, ...brief.background].map((f) => [f.id, f])),
  };
}
