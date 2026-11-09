/**
 * Gates. Hard gates are for safety only: the draft's facts must trace to the
 * tip, no slide text repeats, no field overruns its cap by more than 50
 * percent, and the assembled caption fits Instagram's limit. Everything else (voice, mild overrun) is a note for the
 * review screen; style never rejects a draft.
 *
 * The fact gate holds per slide (local runs, 2026-11-08: one unsupported claim on one slide threw away every slide):
 * a slide with an unsupported claim is dropped from the draft when the caption is clean and at least TIP_SLIDES_MIN
 * slides are clean; otherwise the whole draft fails, as before. A dropped slide never reaches the post.
 */
import { assembleFieldNotesCaption, withSourceLinks } from '@/lib/field-notes/caption';
import { CAPTION_CAP, OVERRUN_HARD_RATIO, TIP_SLIDE_CAPS, UNTRUSTED_EXCERPT_CAP, WRITER_CAPTION_CAP } from './caps';
import { realUseWithResult } from './prompts';
import type { DroppedSlide, FactChecker, FactCheckResult, GateReport, PostDraft } from './types';
import { TIP_SLIDES_MIN, type Tip } from '@/lib/field-notes/types';

/** One checked field; `tipId` is the slide's tip (absent for the caption). */
type Field = { where: string; text: string; cap: number; tipId?: string };

function fieldsOf(draft: PostDraft): Field[] {
  const out: Field[] = [];
  draft.slides.forEach((s, i) => {
    out.push({ where: `slide ${i + 1} headline`, text: s.headline, cap: TIP_SLIDE_CAPS.headline, tipId: s.tipId });
    out.push({ where: `slide ${i + 1} body`, text: s.body, cap: TIP_SLIDE_CAPS.body, tipId: s.tipId });
    out.push({ where: `slide ${i + 1} name`, text: s.name, cap: TIP_SLIDE_CAPS.name, tipId: s.tipId });
    out.push({ where: `slide ${i + 1} tryIt`, text: s.tryIt, cap: TIP_SLIDE_CAPS.tryIt, tipId: s.tipId });
  });
  out.push({ where: 'caption', text: draft.caption, cap: WRITER_CAPTION_CAP });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The text one tip's claims may be traced to: its own fields and its source text (capped as the Writer saw it). */
export function tipSourceText(tip: Tip): string {
  return [
    `tip_id: ${tip.id}`,
    tip.subject,
    realUseWithResult(tip) ?? '',
    tip.sourceLabel ?? '',
    (tip.untrustedContent ?? '').slice(0, UNTRUSTED_EXCERPT_CAP),
  ].join('\n');
}

/** Every tip's text, one labelled block per tip: what the fact check holds all slides against. */
export const tipsSourceText = (tips: Tip[]): string => tips.map(tipSourceText).join('\n\n');

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Every backtick span in a draft slide or caption: the commands, keys and flags the reader will type. */
export function codeSpans(text: string): string[] {
  return (text.match(/`[^`\n]+`/g) ?? []).map((m) => m.slice(1, -1).trim()).filter(Boolean);
}

/**
 * Default offline checker, and the first step of the model-backed one: every numeral and every
 * backtick span (command, key, flag) in the draft must appear verbatim in the source text.
 * Deliberately narrow; it cannot judge behavior claims, which the model-backed checker does.
 * Each problem is attributed to its slide (by tipId) or to the caption.
 */
export const numeralFactCheck = async ({ draft, sourceText }: Parameters<FactChecker>[0]): Promise<FactCheckResult & { bySlide: Record<string, string[]>; caption: string[] }> => {
  const source = sourceText.replace(/,/g, '');
  const problems: string[] = [];
  const bySlide: Record<string, string[]> = {};
  const caption: string[] = [];
  const add = (f: Field, p: string) => {
    problems.push(p);
    if (f.tipId === undefined) caption.push(p);
    else (bySlide[f.tipId] ??= []).push(p);
  };
  for (const f of fieldsOf(draft)) {
    for (const n of f.text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!source.includes(n)) add(f, `${f.where}: "${n}" does not appear in the tip or its source`);
    }
    for (const span of codeSpans(f.text)) {
      if (!squash(sourceText).includes(squash(span))) add(f, `${f.where}: \`${span}\` does not appear in the tip or its source`);
    }
  }
  return { ok: problems.length === 0, problems, bySlide, caption };
};

/**
 * The slides a failed fact check lets the post drop, or null when the whole draft fails: a problem in the caption,
 * a problem not attributed to a slide of this draft, no slide-level problem at all, or fewer than TIP_SLIDES_MIN
 * clean slides left.
 */
export function slidesToDrop(draft: PostDraft, fact: FactCheckResult): { kept: PostDraft; dropped: DroppedSlide[] } | null {
  if (!fact.bySlide || (fact.caption?.length ?? 0) > 0) return null;
  const ids = new Set(draft.slides.map((s) => s.tipId));
  const attributed = Object.entries(fact.bySlide).reduce((n, [id, ps]) => n + (ids.has(id) ? ps.length : 0), 0);
  if (attributed === 0 || attributed !== fact.problems.length) return null;
  const dropped = draft.slides.filter((s) => (fact.bySlide![s.tipId]?.length ?? 0) > 0).map((s) => ({ tipId: s.tipId, problems: [...fact.bySlide![s.tipId]!] }));
  const gone = new Set(dropped.map((d) => d.tipId));
  const kept = { ...draft, slides: draft.slides.filter((s) => !gone.has(s.tipId)) };
  return kept.slides.length >= TIP_SLIDES_MIN ? { kept, dropped } : null;
}

const FLUFF = ['game-changer', 'game changer', 'revolutionary', 'unlock', 'supercharge', 'skyrocket', 'next level', 'cutting-edge', 'seamless', 'effortless', 'powerful', 'amazing', 'incredible', 'ultimate', 'secret'];

export async function runGates(input: PostDraft, tips: Tip[], factCheck: FactChecker = numeralFactCheck): Promise<GateReport> {
  const report: GateReport = { hard: [], notes: [], draft: input, dropped: [] };

  // Hard 1: facts trace to the tips (every slide against every tip's text). A failure on some slides only drops
  // those slides when the caption and at least TIP_SLIDES_MIN slides are clean; anything else fails the draft.
  const fact = await factCheck({ draft: input, sourceText: tipsSourceText(tips) });
  if (fact.usage) report.factCheckUsage = fact.usage;
  if (fact.unavailable) report.factCheckUnavailable = fact.unavailable;
  else if (!fact.ok) {
    const split = slidesToDrop(input, fact);
    if (split) {
      report.draft = split.kept;
      report.dropped = split.dropped;
      for (const d of split.dropped) report.notes.push(`Tip ${d.tipId} dropped by the fact check: ${d.problems[0]}`);
    } else report.hard.push({ gate: 'fact_check', detail: fact.problems.join('; ') || 'fact check failed' });
  }

  // The remaining gates judge the draft the post would carry.
  const draft = report.draft;
  const fields = fieldsOf(draft);

  // Hard 2: no two slides share a headline or a body (the two pieces the slide shows).
  const seen = new Map<string, number>();
  draft.slides.forEach((s, i) => {
    for (const t of new Set([s.headline, s.body].map(norm).filter(Boolean))) {
      if (seen.has(t) && seen.get(t) !== i) {
        report.hard.push({ gate: 'repeat', detail: `slide ${seen.get(t)! + 1} and slide ${i + 1} repeat "${t}"` });
      } else seen.set(t, i);
    }
  });

  // Hard 3: a field more than 50 percent over its cap. Mild overrun is a note.
  for (const f of fields) {
    if (f.text.length > f.cap * (1 + OVERRUN_HARD_RATIO)) {
      report.hard.push({ gate: 'overrun', detail: `${f.where}: ${f.text.length} characters, cap ${f.cap}` });
    } else if (f.text.length > f.cap) {
      report.notes.push(`${f.where} is ${f.text.length - f.cap} characters over its cap of ${f.cap}`);
    }
  }
  const wordGate = (where: string, text: string, cap: number) => {
    const words = wordCount(text);
    if (words > cap * (1 + OVERRUN_HARD_RATIO)) report.hard.push({ gate: 'overrun', detail: `${where}: ${words} words, cap ${cap}` });
    else if (words > cap) report.notes.push(`${where} is ${words} words, cap ${cap}`);
  };
  draft.slides.forEach((s, i) => {
    wordGate(`slide ${i + 1} headline`, s.headline, TIP_SLIDE_CAPS.headlineWords);
    wordGate(`slide ${i + 1} body`, s.body, TIP_SLIDE_CAPS.bodyWords);
    // tryIt may be empty (the caption links the source instead).
    for (const f of ['headline', 'body', 'name'] as const) {
      if (!s[f]) report.hard.push({ gate: 'overrun', detail: `slide ${i + 1} has no ${f}` });
    }
  });

  // The assembled caption (Writer text, how-to-try lines, follow line, hashtags) against Instagram's limit:
  // hashtags are dropped first (a note); still over is hard, since nothing is trimmed silently.
  const assembled = assembleFieldNotesCaption(draft.caption, withSourceLinks(draft.slides, tips));
  if (assembled.over > 0) report.hard.push({ gate: 'overrun', detail: `the assembled caption is ${assembled.over} characters over ${CAPTION_CAP} even without hashtags` });
  else if (assembled.droppedHashtags) report.notes.push(`the hashtags were left off the caption to stay within ${CAPTION_CAP} characters`);

  // Soft: voice notes only, on the words we write (the name and tryIt are the source's, verbatim).
  for (const f of fields.filter((x) => !/ (name|tryIt)$/.test(x.where))) {
    if (/\p{Extended_Pictographic}/u.test(f.text)) report.notes.push(`${f.where}: contains an emoji`);
    const hit = FLUFF.find((w) => f.text.toLowerCase().includes(w));
    if (hit) report.notes.push(`${f.where}: marketing wording ("${hit}")`);
  }
  // Soft: at most one exclamation mark per post (a headline or the caption), never in a body.
  const bangs = draft.slides.reduce((n, s) => n + (s.headline.match(/!/g) ?? []).length, 0) + (draft.caption.match(/!/g) ?? []).length;
  if (bangs > 1) report.notes.push(`${bangs} exclamation marks; at most one per post`);
  draft.slides.forEach((s, i) => {
    if (s.body.includes('!')) report.notes.push(`slide ${i + 1} body: contains an exclamation mark`);
  });
  // Soft: the slide is for a general viewer, so the value line names no tool and neither slide piece carries code.
  draft.slides.forEach((s, i) => {
    if (s.name && norm(s.headline).includes(norm(s.name))) report.notes.push(`slide ${i + 1} headline: names the tool; the headline is the value`);
    for (const f of ['headline', 'body'] as const) if (s[f].includes('`')) report.notes.push(`slide ${i + 1} ${f}: contains code; code belongs in tryIt`);
  });
  return report;
}
