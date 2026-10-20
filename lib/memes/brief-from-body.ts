/**
 * Lab briefs for Last Few Days stories. Finished posts get a Brief from their
 * writer copy for free. Candidates get a structure-from-body Claude call
 * (no web_search) on a human click, in parallel under BRIEF_BATCH_CAP_USD.
 * A thin body can take the full Reporter as a second, one-at-a-time click.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { mapPool } from '@/lib/async-pool';
import { NUMBER_TYPES, PLOT_BEATS, SUBMIT_BRIEF_TOOL, validateBrief, type Brief, type NumberType, type PlotBeat, type SourceKind, type SubjectKind } from '@/lib/social/reporter/brief';
import type { ReporterStoryInput } from '@/lib/social/reporter/prompt';
import { runReporter, type MessagesCreate } from '@/lib/social/reporter/reporter';

import { readableDate } from '@/lib/social/pipeline/reporter-stage';

import { CostMeter, MEME_MODELS, worstCaseCallUsd } from './cost';
import type { Queryable } from './db';
import { briefFromCopy, needsBodyBrief, saveBrief, THIN_BODY_CHARS } from './lfd-source';

export { briefFromCopy, sentencesOf } from './lfd-source';

export const BRIEF_BATCH_CAP_USD = 0.5;
export const REPORTER_ONE_CAP_USD = 0.4;
export const BRIEF_PROMPT_VERSION = 'meme-brief-from-body@2';

const BRIEF_SYSTEM = `You turn one already-written news article into a Helios Reporter brief. You do not search the web. You do not invent facts, numbers, quotes, or people. Every fact, number and quote must appear in the article text you were given. If a section has nothing in the article, return an empty list.

You will be given a HEADLINE and ARTICLE BODY. Call submit_brief once with:
- the_news: one line (who, what, when) from the headline/body
- facts F1… from distinct claims in the body
- numbers N1… only when the body states a figure
- quotes Q1… only when the body contains a quotation
- subjects: people and organizations named in the body
- plot beats that rearrange listed fact IDs; they add no new facts
- tensions: every contradiction the article shows, one plain sentence each with the fact IDs it rests on. Look for: a party says one thing and does another; a party's own move causes its own problem; a promise and what actually happened; two sides that disagree, and what each says; a result opposite to what was expected; who gains from a position they take; the same thing happening again. Return an empty list only when the article truly has none.
- sources: the outlet given, kind original

Mark a company's sales claim as claim_by. Never write a fact that is not in the article.`;

const BRIEF_TOOLS: Anthropic.Tool[] = [withToolCache(SUBMIT_BRIEF_TOOL)];

let briefPrefixCached = false;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown) => (typeof v === 'string' ? v : '');
const asStrs = (v: unknown): string[] => asList(v).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

/**
 * The cheap brief uses the Reporter's full schema, but Claude often omits
 * required empties, sources, or plot IDs. Fill those from the article's
 * outlet so validateBrief can accept a usable lab brief.
 */
export function coerceBodyBrief(
  input: unknown,
  story: { headline: string; outlet?: string | null; url?: string | null },
): Brief {
  const raw = asRecord(input);
  const outlet = story.outlet?.trim() || 'Last Few Days';
  const url = story.url ?? '';
  const sources = asList(raw.sources).flatMap((s) => {
    const o = asRecord(s);
    const name = asStr(o.outlet) || outlet;
    if (!name) return [];
    const kind: SourceKind = o.kind === 'official' || o.kind === 'aggregator' || o.kind === 'original' ? o.kind : 'original';
    return [{ outlet: name, date: typeof o.date === 'string' ? o.date : null, url: asStr(o.url) || url, kind }];
  });
  if (!sources.length) sources.push({ outlet, date: null, url, kind: 'original' });

  const facts = asList(raw.facts).flatMap((item, i) => {
    const o = asRecord(item);
    const text = asStr(o.text);
    if (!text) return [];
    return [{
      id: asStr(o.id) || `F${i + 1}`,
      text,
      sources: asStrs(o.sources).length ? asStrs(o.sources) : [outlet],
      claim_by: typeof o.claim_by === 'string' ? o.claim_by : null,
      notes: asStrs(o.notes),
    }];
  });
  if (!facts.length) throw new Error('no facts in the brief');

  const background = asList(raw.background).flatMap((item, i) => {
    const o = asRecord(item);
    const text = asStr(o.text);
    if (!text) return [];
    return [{
      id: asStr(o.id) || `B${i + 1}`,
      text,
      sources: asStrs(o.sources).length ? asStrs(o.sources) : [outlet],
      claim_by: typeof o.claim_by === 'string' ? o.claim_by : null,
      notes: asStrs(o.notes),
    }];
  });
  const known = new Set([...facts, ...background].map((f) => f.id));

  const numbers = asList(raw.numbers).flatMap((item, i) => {
    const o = asRecord(item);
    const value = asStr(o.value);
    if (!value) return [];
    const type = NUMBER_TYPES.includes(o.type as NumberType) ? o.type as NumberType : 'other';
    const n = {
      id: asStr(o.id) || `N${i + 1}`,
      value,
      type,
      counts: asStr(o.counts) || value,
      sources: asStrs(o.sources).length ? asStrs(o.sources) : [outlet],
      notes: asStrs(o.notes),
    };
    known.add(n.id);
    return [n];
  });

  const subjects = asList(raw.subjects).flatMap((item, i) => {
    const o = asRecord(item);
    const name = asStr(o.name);
    if (!name) return [];
    const type: SubjectKind = o.type === 'person' ? 'person' : 'organization';
    return [{ id: asStr(o.id) || `S${i + 1}`, name, role: typeof o.role === 'string' ? o.role : null, type }];
  });
  const subjectIds = new Set(subjects.map((s) => s.id));

  const quotes = asList(raw.quotes).flatMap((item, i) => {
    const o = asRecord(item);
    const text = asStr(o.text);
    if (!text) return [];
    const q = {
      id: asStr(o.id) || `Q${i + 1}`,
      text,
      speaker: asStr(o.speaker) || outlet,
      speaker_id: typeof o.speaker_id === 'string' && subjectIds.has(o.speaker_id) ? o.speaker_id : null,
      where: typeof o.where === 'string' ? o.where : null,
      via: asStrs(o.via).length ? asStrs(o.via) : [outlet],
      single_source: Boolean(o.single_source),
      cut_off: Boolean(o.cut_off),
      notes: asStrs(o.notes),
    };
    known.add(q.id);
    return [q];
  });

  const keepIds = (ids: unknown) => asStrs(ids).filter((id) => known.has(id));
  const news = asRecord(raw.the_news);
  const plot = asList(raw.plot).flatMap((item) => {
    const o = asRecord(item);
    const beat = PLOT_BEATS.includes(o.beat as PlotBeat) ? o.beat as PlotBeat : null;
    if (!beat) return [];
    const ids = keepIds(o.ids);
    if (beat !== 'OPEN' && !ids.length) return [];
    return [{ beat, text: asStr(o.text), ids }];
  });
  plot.sort((a, b) => PLOT_BEATS.indexOf(a.beat) - PLOT_BEATS.indexOf(b.beat));
  if (!plot.length) plot.push({ beat: 'TRIGGER', text: asStr(news.text) || story.headline, ids: [facts[0]!.id] });

  const ss = asRecord(raw.single_story);
  return validateBrief({
    single_story: { yes: typeof ss.yes === 'boolean' ? ss.yes : true, note: typeof ss.note === 'string' ? ss.note : null },
    the_news: { text: asStr(news.text) || story.headline, ids: keepIds(news.ids) },
    why_it_matters: asList(raw.why_it_matters).flatMap((w) => {
      const o = asRecord(w);
      const text = asStr(o.text);
      return text ? [{ text, ids: keepIds(o.ids) }] : [];
    }),
    plot,
    tensions: asList(raw.tensions).flatMap((t) => {
      const o = asRecord(t);
      const text = asStr(o.text);
      return text ? [{ text, ids: keepIds(o.ids) }] : [];
    }),
    facts,
    background,
    quotes,
    numbers,
    terms: asList(raw.terms).flatMap((t) => {
      const o = asRecord(t);
      const name = asStr(o.name);
      return name ? [{ name, definition: asStr(o.definition), source: asStr(o.source) || outlet }] : [];
    }),
    subjects,
    events: asList(raw.events).flatMap((e) => {
      const o = asRecord(e);
      const what = asStr(o.what);
      return what ? [{ what, date: typeof o.date === 'string' ? o.date : null, place: typeof o.place === 'string' ? o.place : null }] : [];
    }),
    article_photos: [],
    not_answered: asStrs(raw.not_answered),
    sources,
    fetch_failures: [],
  });
}

export async function structureFromBody(
  create: MessagesCreate,
  story: { headline: string; body: string; outlet?: string | null; url?: string | null },
  meter: CostMeter,
): Promise<{ brief: Brief; costUsd: number }> {
  const cfg = MEME_MODELS.brief;
  const user = `HEADLINE: ${story.headline}\nOUTLET: ${story.outlet ?? ''}\nURL: ${story.url ?? ''}\n\nARTICLE BODY:\n${story.body.slice(0, 12_000)}`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  let costUsd = 0;
  let last = 'the brief call did not submit a brief';
  for (let attempt = 0; attempt < 2; attempt++) {
    meter.ensure(worstCaseCallUsd(cfg, { cachedPrefix: BRIEF_SYSTEM.length + 800, rest: JSON.stringify(messages).length }, briefPrefixCached || meter.spent > 0));
    const res = await create({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: cachedSystemText(BRIEF_SYSTEM),
      tools: BRIEF_TOOLS,
      messages,
      output_config: { effort: cfg.effort },
    } as Anthropic.MessageCreateParamsNonStreaming);
    briefPrefixCached = true;
    const callCost = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: cfg.model }).costUsd);
    meter.add(callCost);
    costUsd += callCost;
    const submit = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_brief');
    if (!submit) {
      last = 'the brief call did not submit a brief';
      break;
    }
    try {
      return { brief: coerceBodyBrief(submit.input, story), costUsd };
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: submit.id, is_error: true, content: `The brief failed the check. Fix these and call submit_brief again:\n${last}` }] });
      }
    }
  }
  throw new Error(last);
}

export type BriefJob = { id: string; ok: boolean; source?: 'from-body' | 'reporter'; error?: string; costUsd: number; thin?: boolean };

export async function generateBriefs(
  db: Queryable,
  ids: string[],
  mode: 'from-body' | 'reporter',
  create: MessagesCreate,
  opts: { reporter?: (input: ReporterStoryInput) => Promise<{ ok: boolean; brief?: Brief; costUsd: number; detail?: string }>; now?: Date } = {},
): Promise<{ jobs: BriefJob[]; spent: number }> {
  const { rows } = await db.query<{ id: string; headline: string; body: string; outlet: string | null; url: string | null; brief: Brief | null; brief_source: string | null }>(
    `SELECT id, headline, body, outlet, url, brief, brief_source FROM memes.lfd_stories WHERE id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobs: BriefJob[] = [];

  if (mode === 'reporter') {
    const row = byId.get(ids[0]!);
    if (!row) {
      jobs.push({ id: ids[0] ?? '', ok: false, error: 'Unknown story.', costUsd: 0 });
      return { jobs, spent: 0 };
    }
    const run = opts.reporter;
    if (!run) {
      jobs.push({ id: row.id, ok: false, error: 'Reporter is not wired.', costUsd: 0 });
      return { jobs, spent: 0 };
    }
    const r = await run({
      story: row.headline,
      startingSources: row.url ? [row.url] : [],
      today: readableDate(opts.now ?? new Date()),
    });
    if (!r.ok || !r.brief) {
      jobs.push({ id: row.id, ok: false, error: r.detail ?? 'reporter failed', costUsd: r.costUsd });
      return { jobs, spent: r.costUsd };
    }
    await saveBrief(db, row.id, r.brief, 'reporter');
    jobs.push({ id: row.id, ok: true, source: 'reporter', costUsd: r.costUsd });
    return { jobs, spent: r.costUsd };
  }

  const meter = new CostMeter(BRIEF_BATCH_CAP_USD);
  const todo: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      jobs.push({ id, ok: false, error: 'Unknown story.', costUsd: 0 });
      continue;
    }
    if (row.brief && !needsBodyBrief(row)) {
      jobs.push({ id, ok: true, source: 'from-body', costUsd: 0 });
      continue;
    }
    if ((row.body ?? '').length < THIN_BODY_CHARS) {
      await saveBrief(db, id, briefFromCopy({ headline: row.headline, body: row.body, outlet: row.outlet, url: row.url }), 'from-body');
      jobs.push({ id, ok: true, source: 'from-body', costUsd: 0, thin: true });
      continue;
    }
    todo.push(id);
  }

  await mapPool(todo, 4, async (id) => {
    const row = byId.get(id)!;
    try {
      const { brief, costUsd } = await structureFromBody(create, row, meter);
      await saveBrief(db, id, brief, 'from-body');
      jobs.push({ id, ok: true, source: 'from-body', costUsd });
    } catch {
      const brief = briefFromCopy({ headline: row.headline, body: row.body, outlet: row.outlet, url: row.url });
      await saveBrief(db, id, brief, 'from-body');
      jobs.push({ id, ok: true, source: 'from-body', costUsd: 0 });
    }
  });

  return { jobs, spent: meter.spent };
}

export function liveReporter(create: MessagesCreate) {
  return async (input: ReporterStoryInput) => {
    const r = await runReporter(input, { create, costCapUsd: REPORTER_ONE_CAP_USD });
    return { ok: r.ok, brief: r.ok ? r.brief : undefined, costUsd: r.costUsd, detail: r.ok ? undefined : r.detail };
  };
}
