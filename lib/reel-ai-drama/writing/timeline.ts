import type { FactSheet } from '@/lib/reel-ai-drama/types';

/**
 * The writer's view of the facts (MD-100): code, no model. Every fact, quote and artifact as one plain
 * line, in date order, ending with its ids. A fact takes the date of the earliest timeline entry that cites
 * it; what has no date follows under "Undated". The cast follows as "Who's who" (then, before, after and
 * want, MD-119) so the writer names people exactly as the facts do (`WriterDraft.central`), then the places
 * and how they connect.
 *
 * One line per fact (MD-120): a quote or artifact whose words are mostly another item's words merges into
 * that line, which carries every id. Reporter working notes (corrections to the pitch, which outlet printed
 * what) are stripped; a one-source fact names its source so the writer can credit it.
 */

type Fact = FactSheet['facts'][number];
type Quote = FactSheet['quotes'][number];
type Artifact = FactSheet['artifacts'][number];
type Item = { id: string; date: string | null; order: number; words: string[] } & (
  | { kind: 'fact'; fact: Fact }
  | { kind: 'quote'; quote: Quote }
  | { kind: 'artifact'; artifact: Artifact }
);

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** End a sentence with a full stop unless it already ends in punctuation. */
const sentence = (s: string) => (/[.!?"'”’)]$/.test(s) ? s : `${s}.`);
const words = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Share of `a`'s words that appear in `b` as one unbroken run. */
function overlap(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return a.length ? best / a.length : 0;
}
/** Words that are mostly (60%+, at least four words in a row) another item's words say the same thing. */
const SAME = 0.6;
const same = (a: string[], b: string[]) => overlap(a, b) >= SAME && overlap(a, b) * a.length >= 4;

/** Sentences with their trailing space; a full stop inside a number ("4.5") doesn't end one. */
const SENTENCES = /(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+["'”’)]*|$)\s*/g;
/**
 * Reporter working notes out of a line (MD-120): a "Correction to the pitch:" lead-in, any sentence or
 * parenthesis about the pitch, which outlet relayed or printed a report, and notes that other outlets
 * carry the same words. Who reported a fact lives in its sources.
 */
export function stripNotes(text: string): string {
  const lead = /^(?:correction|note)(?: to the pitch)?\s*:\s*/i;
  const led = lead.test(clean(text));
  let t = clean(text)
    .replace(lead, '')
    .replace(/\s*\([^()]*\bpitch(?:ed)?\b[^()]*\)/gi, '')
    .replace(/,?\s*\bas (?:printed|excerpted|relayed|quoted|carried|embedded) (?:by|in) [^,.;:()]+,?/gi, '')
    .replace(/,\s*(?:relayed|excerpted|printed) by [^,.;:()]+,?/gi, '')
    .replace(/\s*\((?:via|relaying|excerpting) [^()]*\)/gi, '');
  t = (t.match(SENTENCES) ?? [t])
    .filter((s) => !/\bpitch(?:ed)?\b|could not be fetched|\bour cop(?:y|ies)\b|\b(?:print|prints|carry|carries|run|runs) (?:the )?(?:same|this) (?:quote|wording|words|line)\b/i.test(s))
    .join('');
  t = clean(t).replace(/\s+([,.;:])/g, '$1');
  return led ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** The outlet to credit: the original when a source relays one ("9to5Mac (relaying Bloomberg)" → Bloomberg). */
export function creditOf(publisher: string): string {
  const relayed = /\b(?:relaying|excerpting|via)\s+([^,;()]+)/i.exec(publisher);
  return clean(relayed ? relayed[1] : publisher.replace(/\([^)]*\)/g, ''));
}

function strength(f: Fact, sources: FactSheet['sources']): string {
  if (f.confidence === 'disputed') return ' (disputed)';
  if (f.confidence !== 'single_source') return '';
  const names = [...new Set(f.source_ids.map((id) => sources.find((s) => s.id === id)).filter((s) => s).map((s) => creditOf(s!.publisher)).filter(Boolean))];
  return names.length ? ` (one source: ${names.join(', ')})` : ' (one source)';
}

const unverified = (v: boolean | undefined) => (v === false ? ' (wording unverified)' : '');
const textOf = (i: Item) => (i.kind === 'fact' ? i.fact.text : i.kind === 'quote' ? i.quote.text : i.artifact.text);

function lineOf(lead: Item, members: Item[], sources: FactSheet['sources']): string {
  let line: string;
  if (lead.kind === 'fact') line = `${sentence(stripNotes(lead.fact.text))}${strength(lead.fact, sources)}`;
  else if (lead.kind === 'artifact') line = `A ${lead.artifact.kind} read: "${clean(lead.artifact.text)}"${unverified(lead.artifact.verified)}`;
  else {
    const q = lead.quote;
    const context = stripNotes(q.context);
    line = `${sentence(`${clean(q.speaker) || 'Someone'} said: "${clean(q.text)}"${context ? `, ${context}` : ''}`)}${unverified(q.verified)}`;
  }
  // A merged quote or artifact adds its exact words only when the line doesn't already carry most of them.
  const shown = [lead.words];
  for (const m of [...members].sort((a, b) => b.words.length - a.words.length)) {
    if (shown.some((w) => overlap(m.words, w) >= SAME)) continue;
    shown.push(m.words);
    if (m.kind === 'quote') line += ` ${clean(m.quote.speaker) || 'Someone'} said: "${clean(m.quote.text)}"${unverified(m.quote.verified)}`;
    if (m.kind === 'artifact') line += ` The ${m.artifact.kind} read: "${clean(m.artifact.text)}"${unverified(m.artifact.verified)}`;
  }
  return `${line} (${[lead, ...members].sort((a, b) => a.order - b.order).map((i) => i.id).join(', ')})`;
}

export function factTimeline(facts: FactSheet): string {
  const sources = facts.sources ?? [];
  const dateOf = new Map<string, string>();
  for (const t of facts.timeline ?? []) {
    const d = clean(t.date);
    if (!d) continue;
    for (const id of t.fact_ids ?? []) {
      const had = dateOf.get(id);
      if (!had || d < had) dateOf.set(id, d);
    }
  }
  const cast = (facts.cast ?? []).filter((m) => clean(m.name));
  // A context fact (someone's before or after) off the timeline is told once, in Who's who.
  const onTimeline = new Set((facts.timeline ?? []).flatMap((t) => t.fact_ids ?? []));
  const contextOnly = new Set(cast.flatMap((m) => m.context_fact_ids ?? []).filter((id) => !onTimeline.has(id)));

  const items: Item[] = [];
  let order = 0;
  for (const f of facts.facts ?? []) {
    if (!clean(f.text) || contextOnly.has(f.id)) continue;
    items.push({ kind: 'fact', fact: f, id: f.id, date: dateOf.get(f.id) ?? null, order: order++, words: words(f.text) });
  }
  for (const q of facts.quotes ?? []) {
    if (!clean(q.text)) continue;
    items.push({ kind: 'quote', quote: q, id: q.id, date: clean(q.date) || dateOf.get(q.id) || null, order: order++, words: words(q.text) });
  }
  for (const a of facts.artifacts ?? []) {
    if (!clean(a.text)) continue;
    items.push({ kind: 'artifact', artifact: a, id: a.id, date: clean(a.date) || dateOf.get(a.id) || null, order: order++, words: words(a.text) });
  }

  // Merge each quote or artifact into the item that says the same, closest pairs first; a line holds at most one fact.
  const group = new Map<string, Item[]>(items.map((i) => [i.id, [i]]));
  const pairs: { a: Item; b: Item; score: number }[] = [];
  for (const a of items) {
    if (a.kind === 'fact') continue;
    for (const b of items) if (b !== a && same(a.words, b.words)) pairs.push({ a, b, score: overlap(a.words, b.words) });
  }
  for (const { a, b } of pairs.sort((x, y) => y.score - x.score)) {
    const ga = group.get(a.id)!;
    const gb = group.get(b.id)!;
    if (ga === gb || ga.filter((i) => i.kind === 'fact').length + gb.filter((i) => i.kind === 'fact').length > 1) continue;
    const merged = [...ga, ...gb];
    for (const i of merged) group.set(i.id, merged);
  }

  type Entry = { date: string | null; order: number; line: string };
  const entries: Entry[] = [];
  for (const g of new Set(group.values())) {
    // The lead: the fact, else the artifact (the original as it ran), else the quote.
    const rank = (i: Item) => (i.kind === 'fact' ? 0 : i.kind === 'artifact' ? 1 : 2);
    const lead = [...g].sort((a, b) => rank(a) - rank(b) || a.order - b.order)[0]!;
    const dates = g.map((i) => i.date).filter((d): d is string => !!d);
    entries.push({ date: lead.date ?? dates.sort()[0] ?? null, order: Math.min(...g.map((i) => i.order)), line: lineOf(lead, g.filter((i) => i !== lead), sources) });
  }

  // ISO dates (YYYY, YYYY-MM, YYYY-MM-DD) sort as text; ties keep the sheet's order.
  const dated = entries.filter((e) => e.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.order - b.order));
  const undated = entries.filter((e) => !e.date).sort((a, b) => a.order - b.order);
  const out: string[] = dated.map((e) => `- ${e.date}: ${e.line}`);
  if (undated.length) out.push('', 'Undated:', ...undated.map((e) => `- ${e.line}`));

  const factById = new Map((facts.facts ?? []).map((f) => [f.id, f]));
  if (cast.length) {
    out.push('', "Who's who:");
    for (const m of cast) {
      const parts = [
        clean(m.role) && `then: ${stripNotes(m.role)}`,
        clean(m.background) && `Before: ${stripNotes(m.background!)}`,
        clean(m.later) && `After: ${stripNotes(m.later!)}`,
        clean(m.want) && `Wanted: ${stripNotes(m.want!)}`,
      ].filter(Boolean).map((p) => sentence(p as string));
      const ids = (m.context_fact_ids ?? []).filter((id) => factById.has(id)).map((id) => `${id}${strength(factById.get(id)!, sources)}`);
      out.push(`- ${clean(m.name)}${parts.length ? ` — ${parts.join(' ')}` : ''}${ids.length ? ` (${ids.join(', ')})` : ''}`);
    }
  }
  const places = (facts.places ?? []).filter((p) => clean(p.name));
  if (places.length) {
    out.push('', 'Places:');
    for (const p of places) {
      const where = clean(p.address) && !clean(p.name).includes(clean(p.address)) ? ` (${clean(p.address)})` : '';
      const ids = p.fact_ids?.length ? ` (${p.fact_ids.join(', ')})` : '';
      out.push(`- ${clean(p.name)}${where}${clean(p.role) ? `: ${stripNotes(p.role)}` : ''}${ids}`);
    }
  }
  const relations = (facts.relations ?? []).filter((r) => clean(r.a) && clean(r.b));
  if (relations.length) {
    out.push('', 'How they connect:', ...relations.map((r) => `- ${clean(r.a)} ${clean(r.relation)} ${clean(r.b)}${r.fact_ids?.length ? ` (${r.fact_ids.join(', ')})` : ''}`));
  }
  return out.join('\n').trim();
}
