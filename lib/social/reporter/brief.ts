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
  /**
   * The speaker's SUBJECTS id (S1…) (Tommy, 2026-10-06). Everyone quoted is a
   * SUBJECT (Tommy, 2026-10-07); null only when the Reporter still left the
   * speaker out after its retry (logged, never sent back twice).
   */
  speaker_id: string | null;
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

export const SUBJECT_KINDS = ['person', 'organization'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SOURCE_KINDS = ['original', 'official', 'aggregator'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type Brief = {
  single_story: { yes: boolean; note: string | null };
  the_news: { text: string; ids: string[] };
  why_it_matters: Array<{ text: string; ids: string[] }>;
  /**
   * The story's shape (Tommy, 2026-10-07, copy overhaul): events in order,
   * the plot in beats, and the real disagreements or open questions. Every
   * line arranges listed facts by ID; none adds a fact. Optional in the type
   * so briefs saved before the overhaul still load; required of the Reporter.
   */
  timeline?: Array<{ date: string | null; what: string; ids: string[] }>;
  plot?: Array<{ beat: PlotBeat; text: string; ids: string[] }>;
  tensions?: Array<{ text: string; ids: string[] }>;
  facts: BriefFact[];
  background: BriefFact[];
  quotes: BriefQuote[];
  numbers: BriefNumber[];
  terms: Array<{ name: string; definition: string; source: string }>;
  /** `type` (Tommy, 2026-10-07): person or organization, marked by the Reporter; the identity check's type wins when it has one. */
  subjects: Array<{ id: string; name: string; role: string | null; type: SubjectKind }>;
  events: Array<{ what: string; date: string | null; place: string | null }>;
  article_photos: Array<{ caption: string | null; credit: string | null; url: string | null; page: string | null }>;
  not_answered: string[];
  /** kind (Tommy, 2026-10-06): original reporting, an official source, or an aggregator. */
  sources: Array<{ outlet: string; date: string | null; url: string; kind: SourceKind }>;
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

/** PLOT beat labels, in story order (copy overhaul, 2026-10-07). */
export const PLOT_BEATS = ['SETUP', 'TRIGGER', 'CONFLICT', 'RESPONSE', 'OPEN'] as const;
export type PlotBeat = (typeof PLOT_BEATS)[number];

export const BRIEF_SCHEMA = obj({
  single_story: obj({ yes: { type: 'boolean' }, note: nullableStr }),
  the_news: obj({
    text: { type: 'string', description: 'One line (who, what, when).' },
    ids: { ...strList, description: 'Fact IDs it rests on.' },
  }),
  why_it_matters: list(obj({ text: str, ids: { ...strList, description: 'IDs it rests on (sourced only).' } })),
  timeline: list(obj({
    date: { ...nullableStr, description: 'As precise as the sources give it (YYYY-MM-DD when known); null if undated.' },
    what: { type: 'string', description: 'What happened, one line.' },
    ids: { ...strList, description: 'Fact IDs it rests on.' },
  })),
  plot: list(obj({
    beat: { type: 'string', enum: [...PLOT_BEATS], description: 'SETUP → TRIGGER → CONFLICT → RESPONSE → OPEN, in that order.' },
    text: { type: 'string', description: 'One line; arranges listed facts, adds none.' },
    ids: { ...strList, description: 'Fact IDs it rests on (an OPEN beat may rest on NOT ANSWERED: empty).' },
  })),
  tensions: list(obj({
    text: { type: 'string', description: 'Who says what vs who says what, or the open question.' },
    ids: { ...strList, description: 'IDs on each side (an open question from NOT ANSWERED: empty).' },
  })),
  facts: list(fact('F1, F2, …')),
  background: list(fact('B1, B2 (max 2)')),
  quotes: list(
    obj({
      id: { type: 'string', description: 'Q1, Q2, …' },
      text: { type: 'string', description: 'Exact text, word for word, without surrounding quotation marks.' },
      speaker: str,
      speaker_id: { ...nullableStr, description: "The speaker's SUBJECTS id (S1, S2, …). Everyone quoted is listed in SUBJECTS." },
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
  subjects: list(obj({
    id: { type: 'string', description: 'S1, S2, …' },
    name: { type: 'string', description: 'One person or one organization, never combined (no "A / B"). Describe any relation in role.' },
    role: nullableStr,
    type: { type: 'string', enum: [...SUBJECT_KINDS], description: 'person, or organization (a company, government body, lab or product).' },
  })),
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
  sources: list(obj({
    outlet: str,
    date: nullableStr,
    url: { type: 'string', description: 'Only sources you opened.' },
    kind: { type: 'string', enum: [...SOURCE_KINDS], description: "original: the outlet's own reporting; official: the company, government or person behind the news; aggregator: summarizes other outlets' reporting." },
  })),
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
/**
 * `aggregators`: also fail FACTS, BACKGROUND and NUMBERS whose only sources
 * are aggregators (Tommy, 2026-10-06). The Reporter gets this once, while it
 * still has its retry; after that, code drops them (dropAggregatorOnly).
 */
/**
 * `speakers`: also fail QUOTES whose speaker isn't in SUBJECTS (speaker_id
 * null) (Tommy, 2026-10-07: everyone quoted is a SUBJECT). Like
 * `aggregators`, the Reporter gets this once, while it still has its retry;
 * after that the quote stays, unattributed to a subject, and is logged.
 */
export function validateBrief(input: unknown, opts: { aggregators?: boolean; speakers?: boolean } = {}): Brief {
  const shape = checkShape(input);
  if (shape.length > 0) throw new BriefValidationError(shape);
  const brief = input as Brief;
  const errors: BriefError[] = [];
  if (opts.aggregators) {
    for (const x of aggregatorOnly(brief)) {
      errors.push({ section: 'aggregator-only', message: `${x.id} rests only on aggregators (${x.sources.join(', ')}): open the primary or drop the fact` });
    }
  }
  if (opts.speakers) {
    for (const q of quoteSpeakersNotInSubjects(brief)) {
      errors.push({ section: 'quotes', message: `${q.id}'s speaker (${q.speaker}) isn't in SUBJECTS: list them in SUBJECTS with their role and give ${q.id} their ID` });
    }
  }
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
    ...(brief.timeline ?? []).map((t): [string, string[]] => ['timeline', t.ids]),
    ...(brief.plot ?? []).map((p): [string, string[]] => ['plot', p.ids]),
    ...(brief.tensions ?? []).map((t): [string, string[]] => ['tensions', t.ids]),
  ];
  for (const [section, ids] of cited) {
    for (const id of ids) if (!seen.has(id)) errors.push({ section, message: `cites ${id}, which isn't in the brief` });
  }
  errors.push(...storyShapeErrors(brief));
  // Quote speakers by ID (Tommy, 2026-10-06): every speaker_id names a SUBJECTS entry.
  const subjectIds = new Set<string>();
  for (const s of brief.subjects) {
    if (subjectIds.has(s.id)) errors.push({ section: 'subjects', message: `duplicate id ${s.id}` });
    subjectIds.add(s.id);
  }
  for (const q of brief.quotes) {
    if (q.speaker_id && !subjectIds.has(q.speaker_id)) errors.push({ section: 'quotes', message: `${q.id} speaker_id ${q.speaker_id} isn't in SUBJECTS` });
  }
  if (errors.length > 0) throw new BriefValidationError(errors);
  return brief;
}

/**
 * The story shape's order (copy overhaul, 2026-10-07): PLOT beats in label
 * order, each but OPEN resting on fact IDs; TIMELINE dated entries oldest
 * first, each resting on fact IDs.
 */
export function storyShapeErrors(brief: Pick<Brief, 'plot' | 'timeline'>): BriefError[] {
  const errors: BriefError[] = [];
  let last = -1;
  for (const [i, p] of (brief.plot ?? []).entries()) {
    const at = PLOT_BEATS.indexOf(p.beat);
    if (at < last) errors.push({ section: 'plot', message: `beat ${i + 1} (${p.beat}) comes after ${PLOT_BEATS[last]}: keep SETUP → TRIGGER → CONFLICT → RESPONSE → OPEN order` });
    last = Math.max(last, at);
    if (p.beat !== 'OPEN' && p.ids.length === 0) errors.push({ section: 'plot', message: `beat ${i + 1} (${p.beat}) cites no fact IDs` });
  }
  let prev = '';
  for (const [i, t] of (brief.timeline ?? []).entries()) {
    if (t.ids.length === 0) errors.push({ section: 'timeline', message: `entry ${i + 1} cites no fact IDs` });
    const d = t.date && /^\d{4}(-\d{2}(-\d{2})?)?/.exec(t.date)?.[0];
    if (d) {
      if (prev && d < prev.slice(0, d.length)) errors.push({ section: 'timeline', message: `entry ${i + 1} (${t.date}) is before an earlier entry: oldest first` });
      prev = d;
    }
  }
  return errors;
}

/** QUOTES whose speaker isn't a SUBJECTS entry (no speaker_id). An unknown speaker_id is a separate error. */
export function quoteSpeakersNotInSubjects(brief: Brief): Array<{ id: string; speaker: string }> {
  return brief.quotes.filter((q) => !q.speaker_id).map((q) => ({ id: q.id, speaker: q.speaker }));
}

const outletKeyOf = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** FACTS, BACKGROUND and NUMBERS whose every source is an aggregator in SOURCES. */
export function aggregatorOnly(brief: Brief): Array<{ id: string; sources: string[] }> {
  const aggregators = new Set(brief.sources.filter((s) => s.kind === 'aggregator').map((s) => outletKeyOf(s.outlet)));
  if (aggregators.size === 0) return [];
  return [...brief.facts, ...brief.background, ...brief.numbers]
    .filter((x) => x.sources.length > 0 && x.sources.every((s) => aggregators.has(outletKeyOf(s))))
    .map((x) => ({ id: x.id, sources: x.sources }));
}

/**
 * Code removes what is still aggregator-only after the Reporter's retry,
 * along with anything citing it (WHY IT MATTERS items; the ID in THE
 * NEWS), before the Writer sees the brief. Returns what was removed (logged).
 */
export function dropAggregatorOnly(brief: Brief): { brief: Brief; dropped: string[] } {
  const ids = new Set(aggregatorOnly(brief).map((x) => x.id));
  if (ids.size === 0) return { brief, dropped: [] };
  const dropped: string[] = [];
  const keep = <T extends { id: string }>(xs: T[]) => xs.filter((x) => (ids.has(x.id) ? (dropped.push(`${x.id} (aggregator-only)`), false) : true));
  const why = brief.why_it_matters.filter((w) => {
    const cites = w.ids.filter((id) => ids.has(id));
    if (cites.length) dropped.push(`WHY IT MATTERS "${w.text.slice(0, 60)}" (cites ${cites.join(', ')})`);
    return cites.length === 0;
  });
  return {
    brief: {
      ...brief,
      facts: keep(brief.facts),
      background: keep(brief.background),
      numbers: keep(brief.numbers),
      why_it_matters: why,
      the_news: { ...brief.the_news, ids: brief.the_news.ids.filter((id) => !ids.has(id)) },
    },
    dropped,
  };
}

/** Lookup by ID for copy-by-ID (spec §4.2a). */
export function briefIndex(brief: Brief) {
  return {
    quote: new Map(brief.quotes.map((q) => [q.id, q])),
    number: new Map(brief.numbers.map((n) => [n.id, n])),
    fact: new Map([...brief.facts, ...brief.background].map((f) => [f.id, f])),
  };
}
