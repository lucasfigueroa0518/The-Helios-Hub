import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import {
  FOCUS_KINDS,
  type Asset,
  type DirectorPlan,
  type FactSheet,
  type FrameShot,
  type MakeRequest,
  type ScriptLine,
  type ShotWish,
  type StoryboardFrame,
  type StoryNotes,
  type VisualsInventory,
  type WriterDraft,
} from '@/lib/reel-ai-drama/types';
import type { Parsed } from '@/lib/reel-ai-drama/writing/llm';
import { creditOf } from '@/lib/reel-ai-drama/writing/timeline';
import { EXPRESSIONS, seedKind } from '@/explainers/reel-ai-drama/kit/settings/index.js';
import { treatmentSaysNothing } from '@/explainers/reel-ai-drama/kit/components/compiled.js';
import { ASSET_TREATMENTS, CHARACTER_TREATMENTS, MAKE_KINDS, MAX_STORY_NOTES, TREATMENTS, WISH_AS, type Treatment } from '@/lib/reel-ai-drama/writing/schemas';

/**
 * Code checks on the writer's and director's output: the objective structure the prompts' HARD
 * CONSTRAINTS promise. Craft (is the hook good?) is never judged here. Limits carry a little slack over
 * the prompts' numbers so a near miss doesn't cost a paid fix round.
 */

/**
 * The delivered narration pace (MD-91, MD-93): the voice is one take sped up by `voice_tempo`, about
 * `words_per_minute_target` (180) words a minute, the caption ceiling. Limits that carry no rate use it.
 */
export const WORDS_PER_SECOND = DEFAULT_SETTINGS.words_per_minute_target / 60;
/** The reel's whole-word ceiling sits this little over the pace, so a near miss doesn't cost a fix round. */
export const MAX_WORDS_SLACK = 1.02;
export const RUNG_WORD_SLACK = 3;
export const MIN_RUNGS = 4;
export const MIN_WORDS = 110;
export const HOOK_ON_SCREEN_MAX_WORDS = 10;
/** The close question: about 6 words (the prompt says about 6; one word of slack). The close stretches to fit its voice. */
export const CLOSE_QUESTION_MAX_WORDS = 7;
export const ON_SCREEN_MAX_WORDS = 12;
/** A silent picture beat after a line (W-130): 0–1 seconds. */
export const PAUSE_MAX = 1;
/** One picture beat at most per reel (MD-91, MD-103). */
export const MAX_PICTURE_BEATS = 1;
/** Image-model makes per reel (MD-59; a seeded make is code-built and free, so it doesn't count). */
export const MAX_GENERATED_MAKES = 6;
/** Shots the director may ask the targeted search for (MD-68; the search's own bound). */
export const MAX_WISHES = 12;
/** No more than this many spoken words between one picture beat and the next or the frame's end (MD-136). */
export const SHOT_MAX_WORDS = 12;
/** A beat's `at` is the few words it lands on, so "landing on a number" stays a real claim (MD-136). */
export const SHOT_AT_MAX_WORDS = 6;
/** A wish's search query (MD-139): the prompt says 2 to 5 words; a little slack either way. */
export const WISH_QUERY_MAX_WORDS = 6;
/** The most different pictures one wish may keep (MD-138). */
export const WISH_COUNT_MAX = 10;

/** Length rules; the rate and target default to DEFAULT_SETTINGS when a caller passes only the two caps. */
export type LengthLimits = Pick<ReelAiDramaSettings, 'max_seconds' | 'rung_max_seconds'> &
  Partial<Pick<ReelAiDramaSettings, 'words_per_minute_target' | 'target_seconds'>>;

/** Spoken words a second for these limits (MD-91). */
export function wordsPerSecond(limits: LengthLimits): number {
  return (limits.words_per_minute_target ?? DEFAULT_SETTINGS.words_per_minute_target) / 60;
}

/** The narration's word budget: about this many words make the target length (the writer's Length section). */
export function targetWords(limits: LengthLimits): number {
  return Math.round((limits.target_seconds ?? DEFAULT_SETTINGS.target_seconds) * wordsPerSecond(limits));
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function draftLines(draft: WriterDraft): ScriptLine[] {
  return draft.rungs.flatMap((r) => r.lines);
}

export function narratedWords(draft: WriterDraft): number {
  return draftLines(draft).reduce((n, l) => n + countWords(l.text), 0);
}

export function maxRungWords(limits: LengthLimits): number {
  return Math.round(limits.rung_max_seconds * wordsPerSecond(limits));
}

export function maxWords(limits: LengthLimits): number {
  return Math.round(limits.max_seconds * wordsPerSecond(limits) * MAX_WORDS_SLACK);
}

/** The silent picture beats the script asks for, in seconds. */
export function pauseSeconds(draft: WriterDraft): number {
  return draftLines(draft).reduce((n, l) => n + (typeof l.pause_after === 'number' && l.pause_after > 0 ? Math.min(l.pause_after, PAUSE_MAX) : 0), 0);
}

/** A logo (its own flag, MD-41): never a person's character image, though it keeps the logos' reuse exemption. */
export function isLogo(a: Pick<Asset, 'kind' | 'flags'>): boolean {
  return a.kind === 'logo' || (a.flags ?? []).includes('logo');
}

/** A person's banked character image (MD-41): flagged so, and not a logo. */
export function isCharacterImage(a: Pick<Asset, 'kind' | 'flags' | 'character_image'>): boolean {
  return a.character_image && !isLogo(a);
}

/** Words compared loosely: case, spacing and curly quotes don't matter. */
const sameWords = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

/** Every id a line may cite: facts, quotes and artifacts. */
export function citableIds(facts: FactSheet): Set<string> {
  return new Set([...facts.facts.map((f) => f.id), ...facts.quotes.map((q) => q.id), ...facts.artifacts.map((a) => a.id)]);
}

const ASSET_ID = /^V\d+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A line's label kind (MD-130): 'date' or null. The script's first line's label is always the date, so it
 * defaults to 'date'; a line with no label has no kind; anything but 'date' reads as null (fail open).
 */
export function labelKind(line: Pick<ScriptLine, 'on_screen' | 'on_screen_kind'>, isFirst: boolean): 'date' | null {
  if (!line.on_screen?.trim()) return null;
  if (isFirst) return 'date';
  return line.on_screen_kind === 'date' ? 'date' : null;
}

/** Validate a draft against the facts, the inventory and the length rules. Sets `word_count` from the text. */
const CREDIT_VERB = '(?:(?:first|later|also|then|once)\\s+)?(?:says?|said|reports?|reported|wrote|writes|found|noted|revealed|described)';
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How the narration credits a source by name: "according to X", "per X", "told X", "X says", "X's reporting". Case
 * counts for the name (as the outlet writes it, in capitals or capitalised), so an outlet named after a common word
 * is never found in that word.
 */
function creditPattern(name: string): RegExp {
  const capitalised = name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const n = `(?:[Tt]he\\s+)?(?:${[...new Set([name, name.toUpperCase(), capitalised])].map(reEscape).join('|')})`;
  return new RegExp(`\\b(?:[Aa]ccording to|[Pp]er|[Tt]old)\\s+${n}\\b|\\b${n}\\s+${CREDIT_VERB}\\b|\\b${n}['’]s\\s+(?:report|reporting|story|profile|account)\\b`, 'g');
}

/**
 * A source is credited once in a reel (must 4), unless a dispute needs both sides: the same source credited on more
 * than one line is a problem, naming the lines. A line citing a disputed fact doesn't count. A source's name used as
 * the subject of the story ("X sued Y") isn't a credit and is never counted.
 */
export function creditRepeats(lines: readonly ScriptLine[], facts: Pick<FactSheet, 'facts' | 'sources'>): string[] {
  const disputed = new Set(facts.facts.filter((f) => f.confidence === 'disputed').map((f) => f.id));
  const names = new Set((facts.sources ?? []).map((s) => creditOf(s.publisher).replace(/^the\s+/i, '').replace(/\s+(?:magazine|newspaper)$/i, '')).filter(Boolean));
  const out: string[] = [];
  for (const name of names) {
    const re = creditPattern(name);
    const credited = lines.filter((l) => !(l.fact_ids ?? []).some((id) => disputed.has(id))).flatMap((l) => (l.text ?? '').match(re)?.map(() => l.id) ?? []);
    if (credited.length > 1) out.push(`${name} is credited ${credited.length} times (${[...new Set(credited)].join(', ')}); credit a source once in the reel, where it first matters, and let its later facts stand on their own (must 4)`);
  }
  return out;
}

export function validateDraft(
  raw: unknown,
  ctx: { facts: FactSheet; inventory: VisualsInventory | null; limits: LengthLimits },
): Parsed<WriterDraft> {
  if (!isObject(raw) || !Array.isArray(raw.rungs) || !isObject(raw.hook)) return { value: null, problems: ['the script is missing its hook or rungs'] };
  const draft = raw as unknown as WriterDraft;
  const problems: string[] = [];
  const citable = citableIds(ctx.facts);
  // A null inventory (a revision called without one) can't vouch for asset ids, so it doesn't judge them.
  const assets = ctx.inventory ? new Set(ctx.inventory.assets.map((a) => a.id)) : null;
  const lines = draftLines(draft);
  const total = lines.reduce((n, l) => n + countWords(l.text), 0);
  const wps = wordsPerSecond(ctx.limits);

  if (draft.rungs.length < MIN_RUNGS) problems.push(`the script has ${draft.rungs.length} rungs; it needs at least ${MIN_RUNGS}`);
  draft.rungs.forEach((r, i) => {
    if (r.id !== `R${i + 1}`) problems.push(`rung ${i + 1} has id "${r.id}"; rung ids run R1, R2… in order`);
    if (!r.lines.length) problems.push(`rung ${r.id} has no lines`);
    if (!r.purpose?.trim()) problems.push(`rung ${r.id} has no purpose`);
    const words = r.lines.reduce((n, l) => n + countWords(l.text), 0);
    const cap = maxRungWords(ctx.limits);
    if (words > cap + RUNG_WORD_SLACK) {
      problems.push(`rung ${r.id} runs ${words} spoken words (about ${Math.round(words / wps)}s); keep every rung to about ${cap} so something new lands at least every ${ctx.limits.rung_max_seconds}s — split it or cut`);
    }
  });
  lines.forEach((l, i) => {
    if (l.id !== `L${i + 1}`) problems.push(`line ${i + 1} has id "${l.id}"; line ids run L1, L2… in order through the rungs`);
    if (!l.text?.trim()) problems.push(`line ${l.id} has no narration`);
    for (const f of l.fact_ids ?? []) if (!citable.has(f)) problems.push(`line ${l.id} cites ${f}, which is not in the fact sheet`);
    const show = l.must_show?.trim();
    if (show && assets && ASSET_ID.test(show) && !assets.has(show)) problems.push(`line ${l.id} must show ${show}, which is not in the inventory`);
    if (l.on_screen && countWords(l.on_screen) > ON_SCREEN_MAX_WORDS) problems.push(`line ${l.id}'s on-screen words run ${countWords(l.on_screen)} words; keep labels to ${ON_SCREEN_MAX_WORDS} or fewer`);
    if (l.pause_after !== null && l.pause_after !== undefined && !(typeof l.pause_after === 'number' && l.pause_after >= 0 && l.pause_after <= PAUSE_MAX)) {
      problems.push(`line ${l.id}'s pause_after is ${String(l.pause_after)}; give seconds from 0 to ${PAUSE_MAX}, or null`);
    }
  });

  if (!lines.length || draft.hook.line_id !== lines[0]!.id) problems.push(`the hook's line_id must be the first line (L1), got "${draft.hook.line_id}"`);
  if (!draft.hook.on_screen?.trim()) problems.push('the hook has no on-screen words');
  else if (countWords(draft.hook.on_screen) > HOOK_ON_SCREEN_MAX_WORDS) problems.push(`the hook's on-screen words run ${countWords(draft.hook.on_screen)} words; keep them to about 8`);

  const rungIndex = new Map(draft.rungs.map((r, i) => [r.id, i]));
  const landing = rungIndex.get(draft.landing_rung_id);
  if (landing === undefined || landing !== draft.rungs.length - 1) problems.push(`landing_rung_id must be the last rung, got "${draft.landing_rung_id}"`);
  // The peak may sit anywhere; a draft saved before iteration 5 carries it as turn_rung_id.
  const peak = draft.peak_rung_id ?? draft.turn_rung_id;
  if (!rungIndex.has(peak ?? '')) problems.push(`peak_rung_id "${String(peak ?? '')}" is not a rung`);

  // MD-100: `central` names who gets cutouts, as the fact sheet's cast names them.
  const central = (draft as { central?: unknown }).central;
  if (!Array.isArray(central) || central.some((c) => typeof c !== 'string')) problems.push('central must be a list of the cast names central to the story');
  else {
    const castNames = new Set((ctx.facts.cast ?? []).map((m) => castKey(m.name)).filter(Boolean));
    for (const c of central as string[]) {
      if (castNames.size && !castNames.has(castKey(c))) problems.push(`central names "${c}", who is not in the facts' cast; use the name exactly as the facts give it`);
    }
  }

  const q = draft.close_question?.trim() ?? '';
  if (!q) problems.push('the close question is missing');
  else {
    if (!q.endsWith('?')) problems.push('the close question must end with a question mark');
    if (countWords(q) > CLOSE_QUESTION_MAX_WORDS) problems.push(`the close question runs ${countWords(q)} words; keep it to about 6 so the close stays short`);
  }

  const beats = lines.filter((l) => typeof l.pause_after === 'number' && l.pause_after > 0);
  if (beats.length > MAX_PICTURE_BEATS) {
    problems.push(`${beats.length} lines ask for a silent picture beat (${beats.map((l) => l.id).join(', ')}); ${MAX_PICTURE_BEATS} at most — keep the one that matters most, set the others' pause_after to null`);
  }

  if (total < MIN_WORDS) problems.push(`the narration totals ${total} words; about ${targetWords(ctx.limits)} make ${ctx.limits.target_seconds ?? DEFAULT_SETTINGS.target_seconds} seconds`);
  if (total > maxWords(ctx.limits)) problems.push(`the narration totals ${total} words; at most about ${maxWords(ctx.limits)} (${ctx.limits.max_seconds}s)`);
  else {
    const pauses = pauseSeconds(draft);
    const seconds = total / wps + pauses;
    if (pauses > 0 && seconds > ctx.limits.max_seconds) {
      problems.push(`the narration (${total} words) plus ${Math.round(pauses * 10) / 10}s of pauses runs about ${Math.round(seconds)}s; at most ${ctx.limits.max_seconds}s — cut words or pauses`);
    }
  }

  problems.push(...creditRepeats(lines, ctx.facts));

  const firstLine = lines[0]?.id;
  const rungs = draft.rungs.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l, on_screen_kind: labelKind(l, l.id === firstLine) })) }));
  const value: WriterDraft = { ...draft, rungs, central: Array.isArray(central) ? (central as unknown[]).filter((c): c is string => typeof c === 'string') : [], word_count: total };
  return { value, problems };
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** A cast name for comparison: case and spacing aside. */
const castKey = (v: unknown): string => text(v).toLowerCase().replace(/\s+/g, ' ');

/** A name compared: accents, case and punctuation aside. */
export const normName = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Words with their accents dropped, keeping case: what name patterns run over. */
export const plainText = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Whether two ways of writing a person's name are the same person (full name, or the same surname). */
export function samePerson(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || x.split(' ').at(-1) === y.split(' ').at(-1);
}

/** The ways narration names a company or product (MD-135): a one-word name as written, so "apple" isn't Apple; a longer one in any case. */
export function playerMatcher(name: string): RegExp | null {
  const words = plainText(name).replace(/\b(Inc|Corp|Corporation|LLC|Ltd)\b\.?/g, ' ').replace(/[^\p{L}\p{N} '-]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(reEscape).join('\\s+')}(?![\\p{L}\\p{N}])`, words.length > 1 ? 'iu' : 'u');
}

/**
 * The blind story editor's notes (MD-102): a retelling, and at most MAX_STORY_NOTES notes, each naming
 * script lines. Notes past the limit are dropped (the editor puts the most important first); a line id the
 * script doesn't have is a problem (one correction), and after it is dropped from the note (fail open).
 */
export function validateStoryNotes(raw: unknown, ctx: { lineIds: readonly string[]; lenient?: boolean }): Parsed<StoryNotes> {
  if (!isObject(raw)) return { value: null, problems: ['the notes could not be read'] };
  const problems: string[] = [];
  const tell = text(raw.tell_back);
  if (!tell) problems.push('tell_back is missing: retell the story from the script alone');
  if (!Array.isArray(raw.notes)) problems.push('notes must be a list (empty when the script holds)');
  const known = new Set(ctx.lineIds);
  const notes: StoryNotes['notes'] = [];
  (Array.isArray(raw.notes) ? raw.notes : []).slice(0, MAX_STORY_NOTES).forEach((n, i) => {
    if (!isObject(n) || !text(n.note)) return void problems.push(`note ${i + 1} says nothing`);
    const lines = Array.isArray(n.lines) ? n.lines.map(String) : [];
    if (!Array.isArray(n.lines)) problems.push(`note ${i + 1}'s lines must be a list of line ids`);
    const unknown = lines.filter((l) => !known.has(l));
    if (unknown.length && !ctx.lenient) problems.push(`note ${i + 1} names ${unknown.join(', ')}, which the script doesn't have (lines run ${ctx.lineIds[0] ?? 'L1'}–${ctx.lineIds[ctx.lineIds.length - 1] ?? 'L1'})`);
    notes.push({ lines: lines.filter((l) => known.has(l)), note: text(n.note) });
  });
  if (ctx.lenient) return { value: { tell_back: tell, notes }, problems: [] };
  return { value: { tell_back: tell, notes }, problems };
}

/** What a revision may also update when its line changes make it stale (all optional). */
export type RevisionExtras = { hook_on_screen?: string | null; close_question?: string | null; purposes?: { rung_id: string; purpose: string }[] };

export type Replacement = {
  line_id: string;
  cut: boolean;
  text: string;
  on_screen: string | null;
  /** 'date' for a date label (MD-130); when left out, an unchanged label keeps its kind. */
  on_screen_kind?: 'date' | null;
  fact_ids: string[];
  must_show: string | null;
  pause_after?: number | null;
};

/**
 * Apply one round of revisions: only noted lines change, the hook and the closing line are never cut,
 * and line ids are kept (a cut line's id disappears; the plan drops it with `pruneCutLines`).
 */
export function applyRevision(
  draft: WriterDraft,
  replacements: Replacement[],
  ctx: { notedLineIds: string[]; facts: FactSheet; inventory: VisualsInventory | null; limits: LengthLimits },
  extras: RevisionExtras = {},
): Parsed<WriterDraft> {
  const problems: string[] = [];
  const noted = new Set(ctx.notedLineIds);
  const byId = new Map<string, Replacement>();
  const lines = draftLines(draft);
  const lastLine = lines[lines.length - 1]?.id;
  for (const r of replacements) {
    if (!noted.has(r.line_id)) problems.push(`${r.line_id} was not noted; change only the noted lines (${[...noted].join(', ')})`);
    else if (r.cut && (r.line_id === draft.hook.line_id || r.line_id === lastLine)) problems.push(`${r.line_id} can't be cut (it is the hook or the last line); rewrite it`);
    else if (!r.cut && !r.text.trim()) problems.push(`${r.line_id} has an empty replacement; rewrite it or set cut`);
    else byId.set(r.line_id, r);
  }
  const rungs = draft.rungs
    .map((rung) => ({
      ...rung,
      lines: rung.lines.flatMap((l) => {
        const r = byId.get(l.id);
        if (!r) return [l];
        if (r.cut) return [];
        const on_screen_kind = r.on_screen_kind !== undefined ? r.on_screen_kind : r.on_screen === l.on_screen ? l.on_screen_kind ?? null : null;
        return [{ id: l.id, text: r.text, on_screen: r.on_screen, on_screen_kind, fact_ids: r.fact_ids, must_show: r.must_show, pause_after: r.pause_after === undefined ? l.pause_after ?? null : r.pause_after }];
      }),
    }))
    .filter((rung) => rung.lines.length > 0);
  const purposes = new Map((extras.purposes ?? []).filter((p) => p?.rung_id && p.purpose?.trim()).map((p) => [p.rung_id, p.purpose.trim()]));
  for (const id of purposes.keys()) if (!rungs.some((r) => r.id === id)) problems.push(`purposes names ${id}, which is not a rung`);
  const revised: WriterDraft = {
    ...draft,
    rungs: rungs.map((r) => (purposes.has(r.id) ? { ...r, purpose: purposes.get(r.id)! } : r)),
    ...(extras.hook_on_screen?.trim() ? { hook: { ...draft.hook, on_screen: extras.hook_on_screen.trim() } } : {}),
    ...(extras.close_question?.trim() ? { close_question: extras.close_question.trim() } : {}),
  };
  const checked = validateRevised(revised, ctx);
  return { value: checked.value, problems: [...problems, ...checked.problems] };
}

/**
 * A revised draft keeps its original line ids (so the plan still points at them) and its `central` list (a
 * revision can't change it); everything else is checked as usual.
 */
function validateRevised(draft: WriterDraft, ctx: { facts: FactSheet; inventory: VisualsInventory | null; limits: LengthLimits }): Parsed<WriterDraft> {
  const renumbered = (p: string) => !/^(line|rung) \d+ has id/.test(p) && !/^central /.test(p);
  const v = validateDraft(draft, ctx);
  return { value: v.value, problems: v.problems.filter(renumbered) };
}

/**
 * What a plan does that is allowed but worth a visible warning (checks fail open): a line's on-screen
 * label competing with other frame-level words (the builder may drop it, W-39), and a non-character
 * image reused across frames whose purposes differ (MD-46; the integrity look judges it).
 */
export function planWarnings(plan: DirectorPlan, ctx: { draft: WriterDraft; inventory: VisualsInventory }): string[] {
  const out: string[] = [];
  const lines = new Map(draftLines(ctx.draft).map((l) => [l.id, l]));
  const carried = new Set(plan.frames.flatMap((f) => (f.treatment === 'close' ? [] : f.line_ids)));
  for (const l of lines.values()) if (l.on_screen?.trim() && !carried.has(l.id)) out.push(`${l.id}'s on-screen label "${l.on_screen}" is dropped: no story frame carries the line`);
  for (const f of plan.frames) {
    const own = f.on_screen?.trim();
    if (!own) continue;
    for (const id of f.line_ids) {
      if (f.drop_labels?.includes(id)) continue;
      const label = lines.get(id)?.on_screen?.trim();
      if (label && !sameWords(label, own) && !(f.n === 1 && sameWords(own, ctx.draft.hook.on_screen ?? ''))) {
        out.push(`frame ${f.n} shows "${own}" as well as ${id}'s label "${label}"; one text element per frame, so the label may be dropped`);
      }
    }
  }
  out.push(...repeatedPictures(plan, ctx));
  out.push(...blueprintFindings(plan, ctx).map((f) => f.why));
  const byId = new Map(ctx.inventory.assets.map((a) => [a.id, a]));
  const uses = new Map<string, StoryboardFrame[]>();
  for (const f of plan.frames) for (const id of new Set(f.asset_ids)) uses.set(id, [...(uses.get(id) ?? []), f]);
  for (const [id, frames] of uses) {
    const a = byId.get(id);
    if (!a || isCharacterImage(a) || a.anchor_for || frames.length < 2) continue;
    if (new Set(frames.map((f) => f.purpose.trim().toLowerCase())).size > 1) {
      out.push(`${id} is used in frames ${frames.map((f) => f.n).join(', ')} for different purposes (${frames.map((f) => `${f.n}: ${f.purpose}`).join('; ')}); each use must show something new and stay true to the moment it records`);
    }
  }
  return out;
}

/** Validate a director's plan against the locked draft and the inventory. */
export function validatePlan(raw: unknown, ctx: { draft: WriterDraft; inventory: VisualsInventory }): Parsed<DirectorPlan> & { warnings: string[]; soft: string[] } {
  if (!isObject(raw) || !Array.isArray(raw.frames) || !Array.isArray(raw.lines_back)) return { value: null, problems: ['the plan is missing frames or lines_back'], warnings: [], soft: [] };
  const plan = raw as unknown as DirectorPlan;
  const problems: string[] = [];
  const byId = new Map(ctx.inventory.assets.map((a) => [a.id, a]));
  const draftLineList = draftLines(ctx.draft);
  const order = draftLineList.map((l) => l.id);
  const known = new Set(order);
  const lineById = new Map(draftLineList.map((l) => [l.id, l]));
  // Frame words are the writer's (PROCESS P5 "never decides: the words"): the hook's words or a line's label, nothing else.
  const allowedWords = [ctx.draft.hook.on_screen, ...draftLineList.map((l) => l.on_screen)].filter((w): w is string => Boolean(w?.trim()));
  const frames = plan.frames;
  // Runs first: a beat's pictures join the frame's assets, so every check on those holds them too.
  problems.push(...normalizeShots(frames));
  normalizeBlueprints(frames);
  plan.makes = Array.isArray(plan.makes) || plan.makes == null ? ensurePlannedMakes(plan, ctx.inventory).plan.makes : plan.makes;
  if (plan.makes != null && !Array.isArray(plan.makes)) problems.push('makes must be a list (empty when nothing is made)');
  const makes = Array.isArray(plan.makes) ? plan.makes : [];
  problems.push(...makeProblems(makes, plan, ctx.inventory));
  const made = new Set(makes.map((m) => m.id));
  if (plan.wishes != null && !Array.isArray(plan.wishes)) problems.push('wishes must be a list (empty when the inventory has every shot)');
  const wishes = Array.isArray(plan.wishes) ? plan.wishes : [];
  problems.push(...wishProblems(wishes, plan, ctx.inventory));
  if (hasShotMap(plan)) problems.push(...wishSearchProblems(wishes));
  const wished = new Set(wishes.map((w) => w.id));
  // A wish's find is cut out only when it says so (MD-127); plans before iteration 7 never do.
  for (const w of wishes) if (isObject(w)) w.cut_out = w.cut_out === true;
  problems.push(...mediumProblems({ frames, makes, wishes }, ctx.inventory));

  if (frames.length < 2) problems.push('the plan needs at least one story frame and the close');
  frames.forEach((f, i) => {
    if (f.n !== i + 1) problems.push(`frame ${i + 1} is numbered ${f.n}; number frames 1, 2, 3… in order`);
    if (!(TREATMENTS as readonly string[]).includes(f.treatment)) problems.push(`frame ${f.n} uses "${f.treatment}", which is not a kit treatment`);
    const isLast = i === frames.length - 1;
    if (f.treatment === 'close' && !isLast) problems.push(`frame ${f.n} is a close; only the last frame is the close`);
    if (isLast) {
      if (f.treatment !== 'close') problems.push('the last frame must be the close');
      if (f.line_ids.length) problems.push('the close carries no lines (the question plays over it)');
    } else if (!f.line_ids.length) problems.push(`frame ${f.n} carries no lines; every story frame carries at least one`);
    for (const id of f.line_ids) if (!known.has(id)) problems.push(`frame ${f.n} carries ${id}, which is not a script line`);
    // MD-131: every story frame names what the eye lands on first; the close has none.
    if (f.treatment === 'close') f.focus = null;
    else {
      const focus = f.focus as unknown;
      if (!isObject(focus) || !(FOCUS_KINDS as readonly string[]).includes(String(focus.kind))) {
        problems.push(`frame ${f.n} needs a focus { kind, what }: what the eye lands on first, its kind one of ${FOCUS_KINDS.join(', ')}`);
      } else if (!text(focus.what)) problems.push(`frame ${f.n}'s focus says no what: name in a few words what the eye lands on first`);
    }
    f.drop_labels = Array.isArray(f.drop_labels) ? f.drop_labels : [];
    for (const id of f.drop_labels) if (!f.line_ids.includes(id)) problems.push(`frame ${f.n} drops ${id}'s label, but it doesn't carry ${id}`);
    for (const a of f.asset_ids) {
      const asset = byId.get(a);
      if (!asset) {
        if (!made.has(a) && !wished.has(a)) problems.push(`frame ${f.n} uses ${a}, which is not in the inventory or the makes, nor a wish`);
      }
      else if (isCharacterImage(asset) && !CHARACTER_TREATMENTS.includes(f.treatment as Treatment)) {
        problems.push(`frame ${f.n} (${f.treatment}) uses ${a}, a person's character image; it appears only in ${CHARACTER_TREATMENTS.join(' or ')} — use a different photo of them (one image, one job)`);
      }
    }
    if (ASSET_TREATMENTS.includes(f.treatment as Treatment) && !f.asset_ids.length) {
      problems.push(`frame ${f.n} (${f.treatment}) names no asset to show${f.treatment === 'lower_third' || f.treatment === 'number' ? ' (it renders over the frame\'s first asset)' : ''}`);
    }
    if (f.shows != null && !Array.isArray(f.shows)) problems.push(`frame ${f.n}'s shows must be a list`);
    for (const sh of Array.isArray(f.shows) ? f.shows : []) {
      if (!sh?.person?.trim()) problems.push(`frame ${f.n} lists a shows entry with no person`);
      else if (!f.asset_ids.includes(sh.asset_id)) problems.push(`frame ${f.n} shows ${sh.person} as ${sh.asset_id}, which the frame's asset_ids don't name`);
    }
    if (f.on_screen?.trim()) {
      if (countWords(f.on_screen) > ON_SCREEN_MAX_WORDS) problems.push(`frame ${f.n}'s on-screen words run ${countWords(f.on_screen)}; at most ${ON_SCREEN_MAX_WORDS}`);
      if (!allowedWords.some((w) => sameWords(w, f.on_screen!))) problems.push(`frame ${f.n}'s on-screen words "${f.on_screen}" are not the script's: use the hook's words or a line's on_screen label exactly, or null`);
    }
    // A line's pause is a silent beat at the end of its frame's voice, so the paused line ends its frame.
    f.line_ids.slice(0, -1).forEach((id) => {
      const p = lineById.get(id)?.pause_after;
      if (typeof p === 'number' && p > 0) problems.push(`${id} has a ${p}s pause after it; end frame ${f.n} on ${id} (the pause is a silent beat after the frame's voice)`);
    });
  });

  const carried = frames.flatMap((f) => f.line_ids).filter((id) => known.has(id));
  const seen = new Set<string>();
  for (const id of carried) {
    if (seen.has(id)) problems.push(`${id} appears in more than one frame`);
    seen.add(id);
  }
  const missing = order.filter((id) => !seen.has(id));
  if (missing.length) problems.push(`no frame carries ${missing.join(', ')}; every line appears in exactly one frame`);
  if (!missing.length && seen.size === carried.length && carried.join() !== order.join()) problems.push('the frames carry the lines out of script order');

  const first = frames[0];
  if (first) {
    if (!first.line_ids.includes(order[0] ?? 'L1')) problems.push(`frame 1 must carry the hook line (${order[0]})`);
    if (first.music !== 'start') problems.push('frame 1 must start the music (music: start)');
    if (ctx.draft.hook.on_screen?.trim() && !first.on_screen?.trim()) problems.push("frame 1 must show the hook's words (on_screen)");
  }
  for (const b of plan.lines_back) {
    if (!known.has(b.line_id)) problems.push(`lines_back names ${b.line_id}, which is not a script line`);
    if (!b.why?.trim()) problems.push(`lines_back for ${b.line_id} gives no reason`);
  }
  // Asked to fix once, in this same call, before any build money, but never a reason to fail: it ships flagged if it stays (planWarnings).
  // What the frames show (planFindings) waits for the wishes to resolve, and gets its own one fix round.
  const soft = problems.length ? [] : blueprintFindings(plan, ctx).map((f) => f.why);
  return { value: plan, problems, warnings: problems.length ? [] : planWarnings(plan, ctx), soft };
}

/** Made-asset kinds that are drawn or code-built pictures (MD-127): made material in a frame. */
const MADE_KINDS = new Set(['sketch', 'setting', 'expression', 'collage', 'drawing']);

export type FrameMedium = 'real' | 'made';

/**
 * The medium an asset id brings to a frame (MD-127): `real` (found photos, pages, documents, posts, logos,
 * real cutouts, and any wish, which finds a real picture), `made` (a make, or an inventory asset made as a
 * drawing, sketch, setting, expression or paper layer), or null for kit material that only carries a fact or
 * dresses the frame: a map render (a pin on a real place) and a seeded collage layer (paper, tape, ground).
 */
export function assetMedium(
  id: string,
  ctx: { assets: Map<string, Asset>; makes: Map<string, NonNullable<DirectorPlan['makes']>[number]>; wishes: Set<string> },
): FrameMedium | null {
  const make = ctx.makes.get(id);
  if (make) return make.kind === 'collage' && make.seed ? null : 'made';
  if (ctx.wishes.has(id)) return 'real';
  const a = ctx.assets.get(id);
  if (!a) return null;
  if (a.made && a.made_kind && MADE_KINDS.has(a.made_kind)) {
    return a.made_kind === 'collage' && (a.flags ?? []).some((x) => x.startsWith('seed:')) ? null : 'made';
  }
  return a.kind === 'map' ? null : 'real';
}

/**
 * One medium per frame (MD-127): a story frame uses real material or made material, never both. A
 * whiteboard is a made surface. Each frame is checked as planned and again with every wish replaced by its
 * fallback, since that is what plays when the search finds nothing. Marks, labels, pins and stats the kit
 * draws over a frame carry a fact and are not material here.
 */
export function mediumProblems(
  plan: Pick<DirectorPlan, 'frames'> & Partial<Pick<DirectorPlan, 'makes' | 'wishes'>>,
  inventory: VisualsInventory,
): string[] {
  const out: string[] = [];
  const ctx = {
    assets: new Map(inventory.assets.map((a) => [a.id, a])),
    makes: new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m])),
    wishes: new Set((plan.wishes ?? []).filter(isObject).map((w) => w.id)),
  };
  const wishLogos = new Set((plan.wishes ?? []).filter((w) => isObject(w) && w.as === 'logo').map((w) => w.id));
  const isLogoId = (id: string) => wishLogos.has(id) || (ctx.assets.has(id) && isLogo(ctx.assets.get(id)!));
  const fallback = new Map((plan.wishes ?? []).filter(isObject).map((w) => [w.id, w.fallback]));
  const split = (f: StoryboardFrame, ids: string[]) => {
    // MD-138: on a whiteboard a logo is drawn in marker, so it is the board's own material.
    const real = ids.filter((id) => assetMedium(id, ctx) === 'real' && !(f.treatment === 'whiteboard' && isLogoId(id)));
    const made = ids.filter((id) => assetMedium(id, ctx) === 'made');
    if (f.treatment === 'whiteboard') made.unshift('the whiteboard');
    return { real, made };
  };
  const rule = 'a frame is all real (photos, pages, posts, real cutouts, logos) or all made (drawings, the whiteboard): build a reconstructed scene as a cutout collage of real photos (wish for the real objects and places, cut_out: true), and keep drawings for a frame with no real picture [MD-127]';
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close') continue;
    const ids = [...new Set(Array.isArray(f.asset_ids) ? f.asset_ids : [])];
    const planned = split(f, ids);
    if (planned.real.length && planned.made.length) {
      out.push(`frame ${f.n} mixes real material (${planned.real.join(', ')}) with made material (${planned.made.join(', ')}); ${rule}`);
      continue;
    }
    const swapped = ids.filter((id) => fallback.has(id));
    const fallen = split(f, ids.map((id) => fallback.get(id) ?? id));
    if (swapped.length && fallen.real.length && fallen.made.length) {
      out.push(`frame ${f.n} would mix media if the search finds nothing: with ${swapped.map((id) => `${id}'s fallback ${fallback.get(id)}`).join(', ')} it holds real ${fallen.real.join(', ')} beside made ${fallen.made.join(', ')}; give the wish a fallback in the frame's medium — ${rule}`);
    }
  }
  return out;
}

/** After a revision cut lines: drop them from the frames, drop story frames left empty, renumber. */
export function pruneCutLines(plan: DirectorPlan, draft: WriterDraft): DirectorPlan {
  const live = new Set(draftLines(draft).map((l) => l.id));
  const frames: StoryboardFrame[] = [];
  for (const f of plan.frames) {
    const line_ids = f.line_ids.filter((id) => live.has(id));
    if (f.treatment !== 'close' && f.line_ids.length && !line_ids.length) continue;
    const next = { ...f, line_ids, n: frames.length + 1 };
    // A beat on a cut line goes with the line (MD-136).
    if (f.shots && line_ids.length < f.line_ids.length) {
      const spans = shotSpans(next, new Map(draftLines(draft).map((l) => [l.id, l.text])));
      next.shots = f.shots.filter((_, i) => spans[i]);
    }
    frames.push(next);
  }
  const used = new Set(frames.flatMap((f) => f.asset_ids));
  const wishes = plan.wishes?.filter((w) => used.has(w.id));
  // A make that is only a kept wish's fallback is still needed (MD-68).
  for (const w of wishes ?? []) used.add(w.fallback);
  return {
    frames,
    ...(plan.makes ? { makes: plan.makes.filter((m) => used.has(m.id)) } : {}),
    ...(wishes ? { wishes } : {}),
    lines_back: plan.lines_back.filter((b) => live.has(b.line_id)),
  };
}

/**
 * The director's make requests (MD-59): ids M1, M2… unique and apart from the inventory, a known kind, a
 * brief, sources from the inventory, a seed only when it is a seeded tool of that kind, a picture to trace
 * for an expression sketch, at most MAX_GENERATED_MAKES image-model makes, and every make used by a frame.
 */
export function makeProblems(
  makes: NonNullable<DirectorPlan['makes']>,
  plan: Pick<DirectorPlan, 'frames'> & Partial<Pick<DirectorPlan, 'wishes'>>,
  inventory: VisualsInventory,
): string[] {
  const out: string[] = [];
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const ids = new Set<string>();
  // A make may be used by a frame directly, or as a wish's fallback (MD-68).
  const used = new Set([...(plan.frames ?? []).flatMap((f) => f.asset_ids ?? []), ...(plan.wishes ?? []).map((w) => w.fallback)]);
  // A make may build from a wish (MD-68): applyWishes swaps in the find, else the wish's fallback.
  const wished = new Map((plan.wishes ?? []).map((w) => [w.id, w]));
  let generated = 0;
  for (const m of makes) {
    if (!/^M\d+$/.test(m?.id ?? '')) { out.push(`make "${m?.id}" needs an id M1, M2…`); continue; }
    if (ids.has(m.id)) out.push(`make ${m.id} appears twice`);
    // A fix round may see a make already made (it is in the inventory, `made`); anything else is a collision.
    if (byId.has(m.id) && !byId.get(m.id)!.made) out.push(`make ${m.id} collides with an inventory asset id`);
    ids.add(m.id);
    if (!(MAKE_KINDS as readonly string[]).includes(m.kind)) out.push(`make ${m.id} has kind "${m.kind}"; one of ${MAKE_KINDS.join(', ')}`);
    if (!m.brief?.trim()) out.push(`make ${m.id} has no brief: say exactly what the moment needs`);
    for (const a of m.from_assets ?? []) if (!byId.has(a) && !wished.has(a)) out.push(`make ${m.id} builds from ${a}, which is not in the inventory nor a wish`);
    if (m.seed != null && m.seed !== '') {
      const k = seedKind(m.seed);
      if (k !== m.kind) out.push(`make ${m.id}'s seed "${m.seed}" is not a seeded ${m.kind}; set seed null and the ${m.kind} is made to the brief`);
    } else {
      generated += 1;
      if (m.kind === 'expression') {
        const traceable = (m.from_assets ?? []).some((a) => byId.has(a) || Boolean(wished.get(a)?.person)) ||
          (m.people ?? []).some((p) => inventory.assets.some((a) => a.anchor_for === p || (a.people.includes(p) && a.kind !== 'logo')));
        if (!traceable) out.push(`make ${m.id} is an expression sketch with nothing to trace: name the person (people) or their picture (from_assets)`);
      }
    }
    if (!used.has(m.id)) out.push(`make ${m.id} is used by no frame; drop it or put it in a frame's asset_ids`);
  }
  if (generated > MAX_GENERATED_MAKES) out.push(`${generated} makes need the image model; at most ${MAX_GENERATED_MAKES} per reel (a seeded make is free)`);
  return out;
}

/**
 * The director's wishes (MD-68): ids W1, W2… unique and apart from the inventory and the makes, at most
 * MAX_WISHES, a want, a fallback the frames can use when nothing is found (an inventory asset or one of
 * the plan's makes), and every wish used by a frame.
 */
export function wishProblems(wishes: NonNullable<DirectorPlan['wishes']>, plan: Pick<DirectorPlan, 'frames' | 'makes'>, inventory: VisualsInventory): string[] {
  const out: string[] = [];
  const assets = new Set(inventory.assets.map((a) => a.id));
  const makes = new Set((plan.makes ?? []).map((m) => m.id));
  // A wish is used by a frame, or by a make that builds from it.
  const used = new Set([...(plan.frames ?? []).flatMap((f) => f.asset_ids ?? []), ...(plan.makes ?? []).flatMap((m) => m.from_assets ?? [])]);
  const ids = new Set<string>();
  if (wishes.length > MAX_WISHES) out.push(`${wishes.length} wishes; at most ${MAX_WISHES} per reel: keep the shots that matter most and plan the rest from the inventory or a make`);
  for (const w of wishes) {
    if (!/^W\d+$/.test(w?.id ?? '')) { out.push(`wish "${w?.id}" needs an id W1, W2…`); continue; }
    if (ids.has(w.id)) out.push(`wish ${w.id} appears twice`);
    if (assets.has(w.id) || makes.has(w.id)) out.push(`wish ${w.id} collides with an inventory asset or make id`);
    ids.add(w.id);
    if (!w.want?.trim()) out.push(`wish ${w.id} has no want: say exactly what the media must show`);
    if (!w.fallback?.trim() || (!assets.has(w.fallback) && !makes.has(w.fallback))) {
      out.push(`wish ${w.id}'s fallback "${w.fallback ?? ''}" is not an inventory asset or one of the plan's makes; name what the frames use if the search finds nothing`);
    }
    if (!used.has(w.id)) out.push(`wish ${w.id} is used by no frame or make; drop it or put it in a frame's asset_ids`);
    // A cut-out find replaces the photo in every frame that uses it, so each of those frames must stage cutouts (MD-127).
    if (w.cut_out === true) {
      const wrong = (plan.frames ?? []).filter((f) => f.asset_ids?.includes(w.id) && !CUTOUT_STAGES.has(f.treatment));
      if (wrong.length) out.push(`wish ${w.id} is cut out, but frame${wrong.length > 1 ? 's' : ''} ${wrong.map((f) => `${f.n} (${f.treatment})`).join(', ')} ${wrong.length > 1 ? 'stage' : 'stages'} no cutouts; use it only in ${[...CUTOUT_STAGES].join(', ')} frames, or set cut_out false`);
    }
  }
  return out;
}

const CUTOUT_STAGES = new Set(['tableau', 'collage', 'cutout_lift', 'collision']);

/** A plan written with shot maps (MD-136). Plans saved before iteration 8 carry none, and their checks skip them. */
export function hasShotMap(plan: Pick<DirectorPlan, 'frames'>): boolean {
  return (plan.frames ?? []).some((f) => Array.isArray(f?.shots));
}

/**
 * The shape of each frame's beats, set so later code can trust it: the close has none, a beat's lists and nulls
 * are filled in, and its pictures join the frame's `asset_ids` (main image first, so the id, medium and treatment
 * rules hold them too). What the beats say is judged by `shotMapFindings`, which fails open.
 */
function normalizeShots(frames: StoryboardFrame[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    if (f?.shots == null) continue;
    if (!Array.isArray(f.shots)) { out.push(`frame ${f.n}'s shots must be a list`); continue; }
    if (f.treatment === 'close') { f.shots = []; continue; }
    f.shots = f.shots.filter(isObject).map((s) => ({
      at: text(s.at),
      shows: text(s.shows),
      asset_ids: Array.isArray(s.asset_ids) ? s.asset_ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())) : [],
      introduces: text(s.introduces) || null,
    }));
    f.asset_ids = [...new Set([...(f.asset_ids ?? []), ...f.shots.flatMap((s) => s.asset_ids)])];
  }
  return out;
}

/** What the targeted search needs of a wish in a new plan (MD-139): checked before the search runs. */
function wishSearchProblems(wishes: NonNullable<DirectorPlan['wishes']>): string[] {
  const out: string[] = [];
  for (const w of wishes) {
    if (!isObject(w)) continue;
    const words = countWords(w.query);
    if (!words || words > WISH_QUERY_MAX_WORDS) out.push(`wish ${w.id}'s query runs ${words} words; give 2 to 5 words naming the thing itself, as you would type them into an image search`);
    if (!(WISH_AS as readonly string[]).includes(String(w.as))) out.push(`wish ${w.id}'s as is "${String(w.as)}"; one of ${WISH_AS.join(', ')}`);
    if (!Number.isInteger(w.count) || w.count! < 1 || w.count! > WISH_COUNT_MAX) out.push(`wish ${w.id}'s count is ${String(w.count)}; give 1 to ${WISH_COUNT_MAX}`);
  }
  return out;
}

const spokenWords = (s: string): string[] => s.split(/[\s—–]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
/** A word for comparison: case and punctuation aside, so "$5," and "5" are the same word. */
const wordKey = (w: string): string => w.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const SMALL_NUMBERS = new Map(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].map((w, i) => [w, i + 1]));
const TEEN_NUMBERS = new Map(['thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((w, i) => [w, i + 13]));
const TENS = new Map(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].map((w, i) => [w, (i + 2) * 10]));
const MAGNITUDES = new Map([['hundred', 100], ['thousand', 1e3], ['million', 1e6], ['billion', 1e9], ['trillion', 1e12]]);
const NUMBER_SUFFIX = new Map([['%', 1], ['k', 1e3], ['m', 1e6], ['b', 1e9], ['bn', 1e9]]);
const MEASURES = new Set(['second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'decade', 'decades', 'percent', 'dollar', 'dollars', 'times']);
const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const DIGITS = /^([$€£])?(\d[\d,]*(?:\.\d+)?)(%|k|m|bn|b)?$/i;

const bareWord = (w: string) => w.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, '');
const lowerWord = (w: string) => bareWord(w).toLowerCase();
/** The value of a spelled-out piece of a number: "forty-two" is 42. */
function spelledValue(w: string): number | null {
  const [head, tail] = w.split('-');
  const tens = TENS.get(head!);
  if (tens !== undefined && tail !== undefined) return SMALL_NUMBERS.has(tail) ? tens + SMALL_NUMBERS.get(tail)! : null;
  return SMALL_NUMBERS.get(w) ?? TEEN_NUMBERS.get(w) ?? tens ?? null;
}

export type SpokenNumber = { start: number; end: number; value: number; raw: string };

/**
 * The numbers in some words (MD-136), as word positions and values. A number is a figure in digits or one
 * spelled with a magnitude ("five billion"), 13 and up in words, or a small spelled number with a measure after
 * it ("three hours"). A bare year or a day of a month is a date, and "the two founders" is grammar: neither is
 * a number here, unless `loose` asks for every small spelled number. Pure.
 */
export function spokenNumbers(s: string, opts: { loose?: boolean } = {}): SpokenNumber[] {
  const words = spokenWords(s);
  const out: SpokenNumber[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = lowerWord(words[i]!);
    const digits = DIGITS.exec(w);
    let value: number | null = null;
    let small = false;
    if (digits) {
      if (!digits[1] && !digits[3] && (/^(1[5-9]|20|21)\d\d$/.test(digits[2]!) || MONTHS.has(lowerWord(words[i - 1] ?? '')))) continue;
      value = Number(digits[2]!.replace(/,/g, '')) * (NUMBER_SUFFIX.get(digits[3] ?? '') ?? 1);
    } else if (MAGNITUDES.has(w)) value = MAGNITUDES.get(w)!;
    else {
      value = spelledValue(w);
      small = SMALL_NUMBERS.has(w);
    }
    if (value === null) continue;
    let end = i + 1;
    // Later pieces of one number: "two hundred and forty million".
    let part = value;
    let total = 0;
    for (; end < words.length; end++) {
      let next = lowerWord(words[end]!);
      if (next === 'and' && (MAGNITUDES.has(lowerWord(words[end + 1] ?? '')) || spelledValue(lowerWord(words[end + 1] ?? '')) !== null)) next = lowerWord(words[++end]!);
      const mag = MAGNITUDES.get(next);
      if (mag !== undefined) {
        part *= mag;
        if (mag >= 1e3) { total += part; part = 0; }
        continue;
      }
      const piece = spelledValue(next);
      if (piece === null || digits) break;
      part += piece;
    }
    const whole = end > i + 1;
    if (small && !whole && !opts.loose && !MEASURES.has(lowerWord(words[end] ?? ''))) continue;
    if (w === 'one' && !whole) continue;
    out.push({ start: i, end, value: total + part, raw: words.slice(i, end).join(' ') });
    i = end - 1;
  }
  return out;
}

export type ShotSpan = { shot: FrameShot; start: number; length: number; end: number; words: string };

/** Where a frame's lines sit in its narration: each line's word range, in order. */
function frameNarration(f: Pick<StoryboardFrame, 'line_ids'>, lineText: ReadonlyMap<string, string>): { words: string[]; lines: { id: string; start: number; end: number }[] } {
  const words: string[] = [];
  const lines = f.line_ids.map((id) => {
    const start = words.length;
    words.push(...spokenWords(lineText.get(id) ?? ''));
    return { id, start, end: words.length };
  });
  return { words, lines };
}

function findWords(keys: string[], at: string[], from: number): number {
  if (!at.length) return -1;
  for (let i = from; i + at.length <= keys.length; i++) if (at.every((w, j) => keys[i + j] === w)) return i;
  return -1;
}

/** Each beat's place in the frame's narration, in order: null for a beat whose `at` isn't found after the one before. */
export function shotSpans(f: Pick<StoryboardFrame, 'line_ids' | 'shots'>, lineText: ReadonlyMap<string, string>): (ShotSpan | null)[] {
  const { words } = frameNarration(f, lineText);
  const keys = words.map(wordKey);
  let from = 0;
  const found = (f.shots ?? []).map((shot) => {
    const at = spokenWords(shot.at ?? '').map(wordKey);
    const start = findWords(keys, at, from);
    if (start < 0) return null;
    from = start + at.length;
    return { shot, start, length: at.length };
  });
  return found.map((s, i) => {
    if (!s) return null;
    const end = found.slice(i + 1).find(Boolean)?.start ?? words.length;
    return { ...s, end, words: words.slice(s.start, end).join(' ') };
  });
}

/** The range of the line a word position sits in. */
export function lineAtWord(f: Pick<StoryboardFrame, 'line_ids'>, lineText: ReadonlyMap<string, string>, word: number): string | null {
  return frameNarration(f, lineText).lines.find((l) => word >= l.start && word < l.end)?.id ?? null;
}

export type ShotMapFinding = { id: 'shot_map' | 'shot_number'; frame: number; asset_id: string | null; why: string };

/**
 * The shot map held against the script (MD-136). Every story frame has beats; each `at` is the frame's spoken
 * words, a few of them, in order, the first on the frame's opening words; no beat holds past SHOT_MAX_WORDS; and
 * every spoken number has a beat landing on it. Pure, and it skips a plan with no shot maps. These go to the
 * director's fix round and then ship as flags (MD-39), so a near miss never stops a reel.
 */
export function shotMapFindings(plan: Pick<DirectorPlan, 'frames'>, draft: WriterDraft): ShotMapFinding[] {
  if (!hasShotMap(plan)) return [];
  const out: ShotMapFinding[] = [];
  const lineText = new Map(draftLines(draft).map((l) => [l.id, l.text]));
  for (const f of plan.frames) {
    if (f.treatment === 'close') continue;
    const say = (why: string, id: ShotMapFinding['id'] = 'shot_map') => out.push({ id, frame: f.n, asset_id: f.asset_ids?.[0] ?? null, why: `frame ${f.n} ${why} [MD-136]` });
    const shots = Array.isArray(f.shots) ? f.shots : [];
    if (!shots.length) { say('has no shots: list its picture beats, each on the spoken words it lands on'); continue; }
    const { words } = frameNarration(f, lineText);
    const keys = words.map(wordKey);
    const spans = shotSpans(f, lineText);
    spans.forEach((span, i) => {
      const shot = shots[i]!;
      if (!span) {
        const anywhere = findWords(keys, spokenWords(shot.at ?? '').map(wordKey), 0) >= 0;
        say(anywhere ? `has a beat out of spoken order: "${shot.at}" comes before the beat ahead of it` : `has a beat on "${shot.at}", which the frame's narration doesn't say; copy the spoken words exactly`);
        return;
      }
      if (span.length > SHOT_AT_MAX_WORDS) say(`has a beat whose at runs ${span.length} words ("${shot.at}"); name the few words it lands on, ${SHOT_AT_MAX_WORDS} at most`);
      if (!shot.shows?.trim()) say(`has a beat on "${shot.at}" that doesn't say what it shows`);
    });
    const placed = spans.filter((s): s is ShotSpan => Boolean(s));
    if (!placed.length) continue;
    if (placed[0]!.start > 0) say(`opens with no beat: its first beat lands ${placed[0]!.start} words in, on "${placed[0]!.shot.at}"; the first beat lands on the frame's opening words`);
    for (const span of placed) {
      const held = span.end - span.start;
      if (held > SHOT_MAX_WORDS) say(`holds the beat on "${span.shot.at}" for ${held} spoken words; at most ${SHOT_MAX_WORDS}: add a beat for what the words say next ("${words.slice(span.start + SHOT_MAX_WORDS, span.start + SHOT_MAX_WORDS + 4).join(' ')}…")`);
    }
    const spoken = spokenNumbers(words.join(' '));
    for (const n of spoken) {
      if (!placed.some((s) => s.start < n.end && n.start < s.start + s.length)) say(`says "${n.raw}" with no beat landing on it: give the number its own beat`, 'shot_number');
    }
  }
  return out;
}

// ── Iteration 10: the plan checks (ITERATION-10-CONTRACT §6) ────────────────────────────────────────
// All pure, all before any build. Each finding is phrased so the director can act on it: it goes to one fix round,
// then ships as a flag. Nothing here throws or blocks a reel.

export type PlanFindingId = 'blueprint' | 'repeated_picture' | 'same_cast' | 'arrangement_share' | 'named_thing' | 'named_place' | 'stand_in' | 'shot_picture' | 'recreated_as_real' | 'static_frame';
export type PlanFinding = { id: PlanFindingId; frame: number; asset_id: string | null; why: string };

type PlanLike = Pick<DirectorPlan, 'frames'> & Partial<Pick<DirectorPlan, 'makes' | 'wishes'>>;

export type PlanContext = {
  draft: WriterDraft;
  inventory: VisualsInventory;
  /** The cast, places and sources the named-things checks read. Without it those checks stay quiet. */
  facts?: Pick<FactSheet, 'cast' | 'places' | 'sources'>;
  /** Wishes the search did not find, from `standInsFrom`: they have left the plan by now, so the caller keeps them. */
  standIns?: readonly StandIn[];
};

/** A frame's words as the voice says them, for the same matching `nk.cueAt` does. */
function voiceOf(f: Pick<StoryboardFrame, 'line_ids'>, lineText: ReadonlyMap<string, string>): string {
  return f.line_ids.map((id) => lineText.get(id) ?? '').join(' ');
}

/** The normalising and adjacency of `nk.cueAt` (kit/components/moves.js); a test holds the two together. */
const cueKey = (w: string): string => String(w ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const cueWords = (s: string): string[] => String(s ?? '').split(/\s+/).map(cueKey).filter(Boolean);
const voiceKeys = (voice: string): string[] => spokenWords(voice).map(cueKey).filter(Boolean);

/** Where these exact words start in the voice, from word `after` on, or -1. '' is the frame's start. */
export function wordsAt(words: string, voice: string, after = 0): number {
  const want = cueWords(words);
  if (!want.length) return 0;
  return findWords(voiceKeys(voice), want, after);
}

/** Every asset a frame puts on screen, however the plan names it. */
export function frameAssetIds(f: Partial<Pick<StoryboardFrame, 'asset_ids' | 'shows' | 'shots' | 'blueprint'>>): string[] {
  const ground = f.blueprint?.ground;
  return [...new Set([
    ...(f.asset_ids ?? []),
    ...(f.shows ?? []).map((s) => s?.asset_id),
    ...(Array.isArray(f.shots) ? f.shots.flatMap((s) => s?.asset_ids ?? []) : []),
    ...(Array.isArray(f.blueprint?.pieces) ? f.blueprint!.pieces.map((p) => p?.asset) : []),
    ...(ground && !PLAIN_GROUNDS.has(ground) ? [ground] : []),
  ].filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

/** A blueprint's pictures join the frame's `asset_ids`, so every check on those holds them too. */
function normalizeBlueprints(frames: StoryboardFrame[]): void {
  for (const f of frames) {
    if (!isObject(f?.blueprint) || !Array.isArray(f.blueprint.pieces)) continue;
    f.asset_ids = [...new Set([...(f.asset_ids ?? []), ...frameAssetIds({ blueprint: f.blueprint })])];
  }
}

// ── Blueprint validity ──────────────────────────────────────────────────────────────────────────────

export const BLUEPRINT_ARRANGEMENTS = ['face_off', 'lead_inset', 'row', 'pile', 'facing', 'turned_away', 'leads_to', 'solo'] as const;
export const BLUEPRINT_STYLES = ['cutouts', 'paper'] as const;
export const BLUEPRINT_MOVES = ['hold', 'push', 'drift', 'slide', 'tour'] as const;
export const BLUEPRINT_TREATMENTS = ['page', 'post', 'document', 'headline', 'newspaper', 'map', 'photo', 'number', 'stat', 'board', 'lift', 'lower_third'] as const;
export const BLUEPRINT_NOTE_ROLES = ['figure', 'place', 'date', 'body'] as const;
/** kit/components/anchor.js `ANCHORED_KINDS`; a test holds the two together. Expression marks come from the kit's own list. */
export const ANCHORED_MARK_KINDS = ['circle', 'underline', 'highlight', 'box', 'cross', 'arrow'] as const;
export const markKinds = (): string[] => [...ANCHORED_MARK_KINDS, ...Object.keys(EXPRESSIONS)];
const PLAIN_GROUNDS = new Set(['charcoal', 'kraft', 'whiteboard']);
const TARGET_KIND = /^(text|face)\s*:\s*(.+)$/is;

const oneOf = (list: readonly string[]) => list.join(', ');

/** The names a piece's picture shows, from its asset or its make. */
function piecePeople(p: { asset?: string }, ctx: { assets: Map<string, Asset>; makes: Map<string, MakeRequest> }): string[] {
  if (!p.asset) return [];
  return ctx.assets.get(p.asset)?.people ?? ctx.makes.get(p.asset)?.people ?? [];
}

/**
 * A blueprint held against itself, the frame's voice and the inventory: every reference is to a real piece, every
 * `Words` is what the voice says (the matching `nk.cueAt` uses, whole phrase), and every arrangement, kind and aim is
 * one the kit knows. Each finding says what to change. Plans with no blueprints skip this.
 */
export function blueprintFindings(plan: PlanLike, ctx: Pick<PlanContext, 'draft' | 'inventory'>): PlanFinding[] {
  const frames = plan.frames ?? [];
  if (!frames.some((f) => f?.blueprint)) return [];
  const out: PlanFinding[] = [];
  const lineText = new Map(draftLines(ctx.draft).map((l) => [l.id, l.text]));
  const assets = new Map(ctx.inventory.assets.map((a) => [a.id, a]));
  const makes = new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m]));
  const wishes = new Set((plan.wishes ?? []).filter(isObject).map((w) => w.id));
  const exists = (id: string) => assets.has(id) || makes.has(id) || wishes.has(id);
  for (const f of frames) {
    if (!f || f.treatment === 'close') continue;
    const say = (why: string, asset_id: string | null = null) => out.push({ id: 'blueprint', frame: f.n, asset_id, why: `frame ${f.n}'s blueprint: ${why}` });
    const b = f.blueprint;
    if (!isObject(b)) { say('it has none; every story frame carries one'); continue; }
    const voice = voiceOf(f, lineText);
    const pieces = Array.isArray(b.pieces) ? b.pieces.filter(isObject) : [];
    if (!pieces.length) say('it has no pieces; a frame needs at least one thing on screen');
    const ids = new Set<string>();
    for (const p of pieces) {
      if (!text(p.id)) say('a piece has no id; give each piece a short id');
      else if (ids.has(p.id)) say(`two pieces share the id "${p.id}"; give each its own`);
      ids.add(p.id);
    }
    const pieceList = [...ids].join(', ') || 'none';
    const isPiece = (id: unknown) => typeof id === 'string' && ids.has(id);
    const ref = (what: string, id: unknown) => { if (!isPiece(id)) say(`${what} "${String(id ?? '')}" is not a piece in this frame (its pieces: ${pieceList}); use one of those ids or add the piece`); };

    const words = (what: string, w: unknown, after = 0): number => {
      if (w === '' ) return 0;
      if (typeof w !== 'string') { say(`${what} has no words; give the exact spoken words it lands on, or '' for the frame's start`); return -1; }
      const at = wordsAt(w, voice, after);
      if (at < 0) {
        const anywhere = wordsAt(w, voice) >= 0;
        say(anywhere
          ? `${what} ends on "${w}", which the voice says before the words it starts on; name words that come after`
          : `${what} lands on "${w}", which the frame's voice doesn't say. The voice says: "${voice}". Copy its exact words, or use '' for the frame's start`);
      }
      return at;
    };
    const span = (what: string, o: { on?: unknown; until?: unknown }) => {
      const from = words(what, o.on);
      if (o.until != null && o.until !== '') words(`${what} (until)`, o.until, from < 0 ? 0 : from + 1);
    };

    if (!(BLUEPRINT_ARRANGEMENTS as readonly string[]).includes(String(b.arrangement))) say(`arrangement "${String(b.arrangement)}" isn't one of ${oneOf(BLUEPRINT_ARRANGEMENTS)}`);
    if (!(BLUEPRINT_STYLES as readonly string[]).includes(String(b.style))) say(`style "${String(b.style)}" isn't one of ${oneOf(BLUEPRINT_STYLES)}`);
    if (!text(b.ground) || (!PLAIN_GROUNDS.has(b.ground) && !exists(b.ground))) say(`ground "${String(b.ground ?? '')}" is neither ${oneOf([...PLAIN_GROUNDS])} nor an asset in the inventory, the makes or the wishes`, text(b.ground) || null);
    if (b.hook) span('the hook', b.hook);

    let leads = 0;
    for (const p of pieces) {
      const name = `piece "${p.id}"`;
      span(name, p);
      if (p.role === 'lead') leads += 1;
      else if (p.role != null) say(`${name} has role "${String(p.role)}"; the only role is lead`);
      if (p.side != null && p.side !== 'left' && p.side !== 'right') say(`${name} has side "${String(p.side)}"; left or right`);
      if (p.belongs != null) ref(`${name} belongs to`, p.belongs);
      if (p.onto != null) {
        ref(`${name} is placed onto`, p.onto?.piece);
        if (!text(p.onto?.box)) say(`${name} is placed onto a picture with no box named`);
      }
      const hasPicture = text(p.asset) !== '';
      const hasNote = typeof p.note === 'string' && p.note.trim() !== '';
      if (!hasPicture && !hasNote && !p.treatment) say(`${name} has no asset, note or treatment, so nothing would draw; give it one`);
      if (hasPicture && !exists(p.asset!)) say(`${name} uses ${p.asset}, which is not in the inventory, the makes or the wishes; use an asset you have, or add a make or a wish for it`, p.asset!);
      if (treatmentSaysNothing(p)) say(`${name}'s ${p.treatment} has nothing to show: its opts need what it draws`);
      if (p.treatment != null && !(BLUEPRINT_TREATMENTS as readonly string[]).includes(p.treatment)) say(`${name} has treatment "${p.treatment}"; one of ${oneOf(BLUEPRINT_TREATMENTS)}`);
      if (p.note_role != null && !(BLUEPRINT_NOTE_ROLES as readonly string[]).includes(p.note_role)) say(`${name} has note_role "${p.note_role}"; one of ${oneOf(BLUEPRINT_NOTE_ROLES)}`);
      if (p.fill && !hasPicture) say(`${name} fills the frame but names no asset`);
      if (p.crop != null && ![p.crop.x, p.crop.y, p.crop.w, p.crop.h].every((v) => typeof v === 'number' && v >= 0 && v <= 1)) say(`${name}'s crop must be x, y, w and h, each 0 to 1 of the picture`);
    }
    if (leads > 1) say(`${leads} pieces are the lead; a frame has one lead`);

    for (const l of Array.isArray(b.labels) ? b.labels.filter(isObject) : []) {
      if (!text(l.text)) say('a label has no text');
      span(`the label "${l.text}"`, l);
      if (l.for != null) ref(`the label "${l.text}" is for`, l.for);
    }
    for (const s of Array.isArray(b.speech) ? b.speech.filter(isObject) : []) {
      if (!text(s.text)) say('a speech plate has no words');
      ref(`the speech plate "${s.text}" is on`, s.on_piece);
      span(`the speech plate "${s.text}"`, s);
    }
    for (const m of Array.isArray(b.marks) ? b.marks.filter(isObject) : []) {
      const name = `the ${String(m.kind)} mark`;
      if (!markKinds().includes(String(m.kind))) say(`mark kind "${String(m.kind)}" isn't one of ${oneOf(markKinds())}`);
      ref(`${name} is on`, m.on_piece);
      words(name, m.on);
      if (m.kind === 'arrow' && !m.from) say(`${name} on "${m.on_piece}" has no from; name the piece it starts from`);
      if (m.from != null && !TARGET_KIND.test(String(m.from))) ref(`${name} starts from`, m.from);
      if (m.target != null && m.target !== '' && !TARGET_KIND.test(String(m.target))) say(`${name} has target "${String(m.target)}"; write text:<the picture's words> or face:<the person's name>, or leave it out to mark the whole piece`);
      const face = TARGET_KIND.exec(String(m.target ?? ''));
      if (face?.[1]?.toLowerCase() === 'face') {
        const on = pieces.find((p) => p.id === m.on_piece);
        const a = on?.asset ? assets.get(on.asset) : undefined;
        if (a?.regions?.faces && !a.regions.faces.some((x) => x.trusted)) say(`${name} targets a face on ${a.id}, which has no trusted face; mark the whole piece or pick a picture with one`, a.id);
      }
    }
    for (const a of Array.isArray(b.arrows) ? b.arrows.filter(isObject) : []) {
      ref('an arrow starts from', a.from);
      ref('an arrow goes to', a.to);
      if (a.from === a.to) say(`an arrow goes from "${a.from}" to itself; arrows join two pieces`);
      words(`the arrow to "${a.to}"`, a.on);
    }
    const camera = isObject(b.camera) ? b.camera : null;
    if (!camera) say(`it has no camera; name a move (${oneOf(BLUEPRINT_MOVES)}) and its stops`);
    else {
      if (!(BLUEPRINT_MOVES as readonly string[]).includes(String(camera.move))) say(`camera move "${String(camera.move)}" isn't one of ${oneOf(BLUEPRINT_MOVES)}`);
      if (camera.move === 'slide' && b.peak) say('the peak frame uses a slide; a peak frame holds still: use hold, push or drift');
      const stops = Array.isArray(camera.stops) ? camera.stops.filter(isObject) : [];
      if (!stops.length) say(`the camera has no stops; give at least one { on, aim }`);
      for (const s of stops) {
        words(`the camera stop on "${String(s.aim)}"`, s.on);
        const aim = String(s.aim ?? '');
        const target = TARGET_KIND.exec(aim);
        if (aim !== 'whole' && !target && !ids.has(aim)) say(`the camera aims at "${aim}"; aim at whole, a piece id (${pieceList}), face:<name> or text:<words>`);
        if (target?.[1]?.toLowerCase() === 'face') {
          const who = target[2]!.trim();
          const holders = pieces.filter((p) => piecePeople(p, { assets, makes }).some((n) => samePerson(n, who)));
          if (!holders.length) say(`the camera aims at ${who}'s face, and no piece in this frame shows ${who}; aim at a piece that does`);
          else if (holders.every((p) => { const fs = assets.get(p.asset ?? '')?.regions?.faces; return fs && !fs.some((x) => x.trusted); })) say(`the camera aims at ${who}'s face, and no picture of them here has a trusted face; aim at the piece`);
        }
      }
    }
    for (const g of Array.isArray(b.ground_tone) ? b.ground_tone.filter(isObject) : []) {
      words('a ground tone change', g.on);
      if (typeof g.to !== 'number' || g.to < 0 || g.to > 1) say(`a ground tone goes to ${String(g.to)}; give 0 to 1`);
    }
    for (const s of Array.isArray(b.sounds) ? b.sounds.filter(isObject) : []) words(`the sound "${s.what ?? s.kind}"`, s.on);
  }
  return out;
}

/**
 * A planned drawing that doesn't exist becomes a `makes` entry before compile: a make id a blueprint piece names with
 * no make behind it, briefed from the beat that shows it. Stops at the make limit, leaving the rest to the plan check. Pure.
 */
export function ensurePlannedMakes(plan: DirectorPlan, inventory: VisualsInventory): { plan: DirectorPlan; added: string[] } {
  const have = new Set([...inventory.assets.map((a) => a.id), ...(plan.makes ?? []).map((m) => m?.id)]);
  const added: MakeRequest[] = [];
  let generated = (plan.makes ?? []).filter((m) => !m?.seed).length;
  for (const f of plan.frames ?? []) {
    for (const p of Array.isArray(f?.blueprint?.pieces) ? f.blueprint!.pieces : []) {
      const id = p?.asset;
      if (!id || !/^M\d+$/.test(id) || have.has(id) || generated >= MAX_GENERATED_MAKES) continue;
      const beat = (f.shots ?? []).find((s) => s?.asset_ids?.includes(id))?.shows;
      added.push({
        id, kind: 'drawing', brief: text(beat) || text(p.note) || text(f.purpose) || `what frame ${f.n} shows`,
        people: (f.shows ?? []).filter((s) => s?.asset_id === id).map((s) => s.person), from_assets: [], seed: null,
      });
      have.add(id);
      generated += 1;
    }
  }
  return added.length ? { plan: { ...plan, makes: [...(plan.makes ?? []), ...added] }, added: added.map((m) => m.id) } : { plan, added: [] };
}

// ── Repetition ──────────────────────────────────────────────────────────────────────────────────────

/** How many frames one picture of a person may hold in a reel, never adjacent ones. */
export const PERSON_PICTURE_MAX = 3;
/** How many frames may share one ground and arrangement in a reel. */
export const ARRANGEMENT_MAX = 3;

/** The picture an asset really is: near-duplicates (`dup_of`) and cuts of a photo (`cutout_of`) count as the photo. */
function pictureRoot(inventory: VisualsInventory): (id: string) => string {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const up = (id: string): string | null => {
    const a = byId.get(id);
    if (!a) return null;
    return a.regions?.dup_of ?? a.flags?.find((f) => f.startsWith('cutout_of:'))?.slice('cutout_of:'.length) ?? null;
  };
  return (id) => {
    let at = id;
    const seen = new Set([at]);
    for (let next = up(at); next && !seen.has(next); next = up(at)) { at = next; seen.add(at); }
    return at;
  };
}

/** Whom an asset or make pictures: its recorded people, or the name it anchors. */
function peopleOf(id: string, ctx: { assets: Map<string, Asset>; makes: Map<string, MakeRequest> }): string[] {
  const a = ctx.assets.get(id);
  if (a) return a.people?.length ? a.people : a.anchor_for ? [a.anchor_for] : [];
  return ctx.makes.get(id)?.people ?? [];
}

/**
 * Which frames must change so a picture keeps to its limit: the earliest frames that fit stay. One picture of a person
 * (a cut-out thing too: it recurs the same way) holds at most PERSON_PICTURE_MAX frames, never adjacent; any other picture one. A logo is a name, so it may return.
 */
function repeatedUses(plan: PlanLike, inventory: VisualsInventory): { id: string; frames: number[]; over: number[]; recurring: boolean; people: string[] }[] {
  const assets = new Map(inventory.assets.map((a) => [a.id, a]));
  const makes = new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m]));
  const rootOf = pictureRoot(inventory);
  const uses = new Map<string, { id: string; frames: number[]; recurring: boolean; people: string[] }>();
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close') continue;
    const here = new Set<string>();
    for (const id of frameAssetIds(f)) {
      const a = assets.get(id);
      const people = peopleOf(id, { assets, makes });
      if (a ? isLogo(a) : !people.length) continue;
      const root = rootOf(id);
      if (here.has(root)) continue;
      here.add(root);
      const use = uses.get(root) ?? { id, frames: [], recurring: Boolean(people.length || a?.character_image || a?.flags?.includes('cutout')), people };
      use.frames.push(f.n);
      uses.set(root, use);
    }
  }
  const out = [];
  for (const use of uses.values()) {
    const kept: number[] = [];
    const over: number[] = [];
    const max = use.recurring ? PERSON_PICTURE_MAX : 1;
    for (const n of use.frames) {
      if (kept.length < max && !kept.includes(n - 1)) kept.push(n);
      else over.push(n);
    }
    if (over.length) out.push({ ...use, over });
  }
  return out;
}

/** Other pictures of the same person the director could use instead, with what the look step recorded. */
function otherPictures(who: string[], not: string, inventory: VisualsInventory): string {
  const rootOf = pictureRoot(inventory);
  const others = inventory.assets.filter((a) => a.people?.some((p) => who.some((w) => samePerson(p, w))) && rootOf(a.id) !== rootOf(not) && !isLogo(a) && a.regions?.cut?.grade !== 'rejected');
  const seen = new Set<string>();
  const list = others.filter((a) => { const r = rootOf(a.id); if (seen.has(r)) return false; seen.add(r); return true; }).slice(0, 6);
  return list.map((a) => (a.regions?.expression ? `${a.id} (${a.regions.expression})` : a.id)).join(', ');
}

function repeatFindings(plan: PlanLike, inventory: VisualsInventory): PlanFinding[] {
  const out: PlanFinding[] = [];
  for (const use of repeatedUses(plan, inventory)) {
    const others = use.people.length ? otherPictures(use.people, use.id, inventory) : '';
    const rule = use.recurring
      ? `one picture${use.people.length ? ` of ${use.people[0]}` : ''} appears at most ${PERSON_PICTURE_MAX} times a reel and never in adjacent frames, however it is cut, because it looks the same whatever the beat feels like`
      : 'one picture under several beats reads as a held visual; give each beat its own picture';
    const why = `[repeated_picture] ${use.id} holds frames ${use.frames.join(', ')}: ${rule}. Change frames ${use.over.join(', ')}${others ? `: pick by each beat's feeling from ${others}` : ''}${use.people.length ? ', or wish for another photo' : ''}`;
    for (const n of use.over) out.push({ id: 'repeated_picture', frame: n, asset_id: use.id, why });
  }
  return out;
}

/** The same picture under too many beats, caught on the storyboard before anything is built. Pure. */
export function repeatedPictures(plan: PlanLike, ctx: { inventory: VisualsInventory }): string[] {
  return [...new Set(repeatFindings(plan, ctx.inventory).map((f) => f.why))];
}

/** The people on screen in a frame, as comparable surnames. */
function castOf(f: StoryboardFrame, ctx: { assets: Map<string, Asset>; makes: Map<string, MakeRequest> }): string[] {
  const names = f.blueprint?.pieces?.length
    ? f.blueprint.pieces.flatMap((p) => piecePeople(p, ctx))
    : (f.shows ?? []).map((s) => s?.person).filter((n): n is string => Boolean(n?.trim()));
  return [...new Set(names.map((n) => normName(n).split(' ').at(-1) ?? ''))].filter(Boolean).sort();
}

/** The same people, staged the same way, reads as the same picture: never in consecutive frames, nor twice in a reel. A ground and arrangement holds at most ARRANGEMENT_MAX frames. */
function sameCastFindings(plan: PlanLike, inventory: VisualsInventory): PlanFinding[] {
  const out: PlanFinding[] = [];
  const ctx = { assets: new Map(inventory.assets.map((a) => [a.id, a])), makes: new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m])) };
  const frames = (plan.frames ?? []).filter((f) => f && f.treatment !== 'close');
  const seen = new Map<string, number>();
  for (const f of frames) {
    const cast = castOf(f, ctx);
    if (!cast.length) continue;
    const how = f.blueprint?.arrangement ?? f.treatment;
    const key = `${cast.join('|')}@${how}`;
    const before = seen.get(key);
    if (before !== undefined) {
      out.push({ id: 'same_cast', frame: f.n, asset_id: null, why: `frame ${f.n} stages the same people (${cast.join(', ')}) in the same ${how} as frame ${before}${before === f.n - 1 ? ', right after it' : ''}: it reads as the same picture. Change who is on screen or how they relate here: another arrangement, one of them alone, or what they are looking at` });
    }
    seen.set(key, f.n);
  }
  const shares = new Map<string, number[]>();
  for (const f of frames) {
    if (!f.blueprint?.arrangement) continue;
    const key = `${f.blueprint.arrangement} on ${f.blueprint.ground}`;
    shares.set(key, [...(shares.get(key) ?? []), f.n]);
  }
  for (const [key, list] of shares) {
    for (const n of list.slice(ARRANGEMENT_MAX)) {
      out.push({ id: 'arrangement_share', frame: n, asset_id: null, why: `frames ${list.join(', ')} are all ${key}, so they read as one layout; at most ${ARRANGEMENT_MAX}. Stage frame ${n} another way` });
    }
  }
  return out;
}

// ── Named things are shown ──────────────────────────────────────────────────────────────────────────

/**
 * How the named-things check matches, kept low on false alarms:
 *   - A company or product matches its cast name as written when it is one word ("Apple", never "apple"), and in any case when longer. A source matches its publisher's name the same way, either credited in a known phrase or mid-sentence, so a publisher named after a common word isn't found at the head of a sentence.
 *   - A mention is passing when it only modifies something else: a possessive ("Apple's secrecy"), after a determiner ("an Apple session"), or before a role word ("Apple researchers"). A passing mention needs the thing shown in this frame or an earlier one; any other mention needs it shown in this frame.
 *   - Shown means a picture in the frame whose record names the thing (`shows`, `people`, `place`), or a make or wish that does. A portrait doesn't show its subject's company, even when its caption names it. A source needs a page, document, post or masthead of it, so a photo merely credited to it doesn't count. A label on a picture counts, and a note counts on a whiteboard.
 * People are held by `named_not_shown` (checks/variety.ts), which reads the same pieces.
 */
const MODIFIES_NEXT = /^\s+(?:researchers?|scientists?|engineers?|employees?|staff|workers?|authors?|executives?|leaders?|founders?|insiders?|users?|customers?|products?|devices?|sessions?|events?|campus|offices?|teams?|papers?|stock|shares?|logo|boss|chief)\b/i;
const DETERMINER_BEFORE = /\b(?:a|an|the|this|that|these|those|its|their|his|her|our)\s+$/i;
const DOCUMENT_KINDS = new Set(['web_page', 'social_post', 'document', 'paper', 'headline', 'logo']);

type Named = { name: string; kind: 'company' | 'product' | 'source'; re: RegExp };

function namedThings(facts: NonNullable<PlanContext['facts']>): Named[] {
  const out: Named[] = [];
  const add = (name: string, kind: Named['kind']) => {
    const re = playerMatcher(name);
    if (re && !out.some((t) => normName(t.name) === normName(name))) out.push({ name, kind, re: new RegExp(re.source, `${re.flags}g`) });
  };
  const people = new Set((facts.cast ?? []).filter((c) => c.kind === 'person').map((c) => normName(c.name)));
  for (const c of facts.cast ?? []) if (c.kind !== 'person') add(c.name, c.kind);
  for (const s of facts.sources ?? []) {
    const name = creditOf(s.publisher).replace(/^the\s+/i, '').replace(/\s+(?:magazine|newspaper)$/i, '').trim();
    if (name && !people.has(normName(name))) add(name, 'source');
  }
  return out;
}

/** How a line mentions a thing: not at all, in passing, or as what the line is about. */
function mentionOf(line: string, t: Named): 'none' | 'passing' | 'full' {
  let best: 'none' | 'passing' | 'full' = 'none';
  const headless = line.trim();
  for (const m of headless.matchAll(t.re)) {
    const before = headless.slice(0, m.index);
    const after = headless.slice(m.index + m[0].length);
    if (t.kind === 'source' && !/[\p{L}\p{N},;:]\s+$/u.test(before) && !creditPattern(m[0]).test(headless)) continue;
    const passing = /^['’]s\b/.test(after) || DETERMINER_BEFORE.test(before) || MODIFIES_NEXT.test(after);
    if (!passing) return 'full';
    best = 'passing';
  }
  return best;
}

const MADE_FRAME_KINDS = new Set(['sketch', 'setting', 'expression', 'collage', 'drawing']);
const isMadeAsset = (a: Asset | undefined): boolean => Boolean(a?.made && a.made_kind && MADE_FRAME_KINDS.has(a.made_kind));

function assetRecord(a: Asset, opts: { credit?: boolean } = {}): string {
  return [a.shows, ...(a.people ?? []), a.place, opts.credit ? a.credit : null].filter(Boolean).join(' . ');
}

const hits = (re: RegExp, s: string) => { re.lastIndex = 0; const ok = re.test(s); re.lastIndex = 0; return ok; };

/** Whether this frame shows the thing, by the rule above. */
function frameShows(f: StoryboardFrame, t: Named, ctx: { assets: Map<string, Asset>; makes: Map<string, MakeRequest>; wishes: Map<string, ShotWish> }): boolean {
  for (const id of frameAssetIds(f)) {
    const a = ctx.assets.get(id);
    if (a) {
      if (t.kind === 'source' ? DOCUMENT_KINDS.has(a.kind) && hits(t.re, plainText(assetRecord(a, { credit: true }))) : a.kind !== 'person_photo' && hits(t.re, plainText(assetRecord(a)))) return true;
      continue;
    }
    const make = ctx.makes.get(id);
    if (make && hits(t.re, plainText([make.brief, ...(make.people ?? [])].join(' . ')))) return true;
    const wish = ctx.wishes.get(id);
    if (wish && hits(t.re, plainText([wish.want, wish.query, wish.person].filter(Boolean).join(' . ')))) return true;
  }
  const b = f.blueprint;
  if (b?.pieces) {
    const pictured = new Set(b.pieces.filter((p) => p.asset).map((p) => p.id));
    if ((b.labels ?? []).some((l) => l.for && pictured.has(l.for) && hits(t.re, plainText(l.text ?? '')))) return true;
    if (b.pieces.some((p) => p.asset && p.label && hits(t.re, plainText(p.label)))) return true;
    if (b.ground === 'whiteboard' && b.pieces.some((p) => p.note && hits(t.re, plainText(p.note)))) return true;
  }
  return false;
}

/** Every company, product and source a line names gets a real picture or logo on screen. */
function namedThingFindings(plan: PlanLike, ctx: PlanContext): PlanFinding[] {
  if (!ctx.facts) return [];
  const out: PlanFinding[] = [];
  const things = namedThings(ctx.facts);
  const lookup = { assets: new Map(ctx.inventory.assets.map((a) => [a.id, a])), makes: new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m])), wishes: new Map((plan.wishes ?? []).filter(isObject).map((w) => [w.id, w])) };
  const lineText = new Map(draftLines(ctx.draft).map((l) => [l.id, plainText(l.text)]));
  const shown = new Set<string>();
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close') continue;
    const voice = f.line_ids.map((id) => lineText.get(id) ?? '').join(' ');
    for (const t of things) {
      const here = frameShows(f, t, lookup);
      const how = mentionOf(voice, t);
      if (!here && (how === 'full' || (how === 'passing' && !shown.has(t.name)))) {
        const candidates = ctx.inventory.assets.filter((a) => (t.kind === 'source' ? DOCUMENT_KINDS.has(a.kind) : a.kind !== 'person_photo') && hits(t.re, plainText(assetRecord(a, { credit: t.kind === 'source' }))));
        const have = [...candidates.filter(isLogo), ...candidates.filter((a) => !isLogo(a))].map((a) => a.id).slice(0, 4);
        const how_to = have.length ? `use ${have.join(' or ')}` : `the inventory has none, so add a wish { as: 'logo', query: '${t.name} logo' }, or show it by a labelled picture`;
        out.push({ id: 'named_thing', frame: f.n, asset_id: null, why: `frame ${f.n}'s words name ${t.name}, and nothing on screen shows it: give it a beat with a real picture or logo on those words; ${how_to}` });
      }
      if (here) shown.add(t.name);
    }
  }
  return out;
}

const LOCATIVE = '(?:in|at|from|to|near|inside|outside|across|through|into|around|over)';
/** Rooms and buildings a line can set a scene in without naming them. Only these, after a locative and a determiner ("in office" isn't a scene), count. */
const SCENE_NOUNS = 'closet|office|garage|kitchen|bedroom|basement|attic|hotel|restaurant|courtroom|boardroom|lobby|dorm|cafe';
const SCENE_RE = new RegExp(`\\b${LOCATIVE}\\s+(?:a|an|the|that|this|his|her|their|its)\\s+(?:[\\p{L}-]+\\s+){0,2}?(${SCENE_NOUNS})\\b`, 'iu');

/** A place the frame puts on screen: its picture, a map, a built scene, or on a whiteboard a place note. */
function framePlaceIs(f: StoryboardFrame, re: RegExp | null, ctx: { assets: Map<string, Asset>; makes: Map<string, MakeRequest> }): boolean {
  if (f.treatment === 'map' || f.blueprint?.pieces?.some((p) => p.treatment === 'map')) return true;
  for (const id of frameAssetIds(f)) {
    const a = ctx.assets.get(id);
    if (a) {
      if (a.kind === 'map' || a.made_kind === 'setting') return true;
      if (re ? hits(re, plainText(assetRecord(a))) : a.kind === 'place_photo') return true;
    } else if (ctx.makes.get(id)?.kind === 'setting') return true;
  }
  const b = f.blueprint;
  return Boolean(b?.ground === 'whiteboard' && b.pieces?.some((p) => p.note && p.note_role === 'place' && (!re || hits(re, plainText(p.note)))));
}

/**
 * A line that says where something happens gets that place, as a picture or a built scene, never a plain ground. A place counts when it is one of
 * the fact sheet's places (the whole name or a comma part), named as a place, after a locative: "in Barcelona", never "a Toronto professor" or "Montreal's Bengio". A room or building named as the scene ("from a party closet") counts the same.
 */
function namedPlaceFindings(plan: PlanLike, ctx: PlanContext): PlanFinding[] {
  const out: PlanFinding[] = [];
  const lineText = new Map(draftLines(ctx.draft).map((l) => [l.id, plainText(l.text)]));
  const lookup = { assets: new Map(ctx.inventory.assets.map((a) => [a.id, a])), makes: new Map((plan.makes ?? []).filter(isObject).map((m) => [m.id, m])) };
  const cast = new Set((ctx.facts?.cast ?? []).map((c) => normName(c.name)));
  const places: { name: string; re: RegExp; at: RegExp }[] = [];
  for (const p of ctx.facts?.places ?? []) {
    for (const part of [p.name, ...String(p.name ?? '').split(',')].map((s) => s?.trim()).filter(Boolean)) {
      if (cast.has(normName(part)) || places.some((x) => x.name === part)) continue;
      const re = playerMatcher(part);
      if (re) places.push({ name: part, re, at: new RegExp(`\\b${LOCATIVE}\\s+(?:the\\s+|downtown\\s+)?${re.source}`, re.flags) });
    }
  }
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close') continue;
    const voice = f.line_ids.map((id) => lineText.get(id) ?? '').join(' ');
    const said = new Set<string>();
    for (const p of places) {
      if (!p.at.test(voice) || [...said].some((s) => s.includes(p.name) || p.name.includes(s))) continue;
      said.add(p.name);
      if (!framePlaceIs(f, p.re, lookup)) out.push({ id: 'named_place', frame: f.n, asset_id: null, why: `frame ${f.n}'s words place it in ${p.name}, and the frame doesn't show ${p.name}: give it a real picture of the place or a built scene, never a plain ground` });
    }
    const scene = SCENE_RE.exec(voice);
    if (scene && !framePlaceIs(f, null, lookup)) out.push({ id: 'named_place', frame: f.n, asset_id: null, why: `frame ${f.n}'s words set the scene "${scene[0]}", and the frame shows no place: build that ${scene[1]} from real pictures (a place photo, or a cutout collage of its objects) or draw it, never a plain ground` });
  }
  return out;
}

// ── Failed searches: a stand-in must show what the shot says (decision 4) ───────────────────────────

/** A wish the search didn't find, and the fallback the frames fell to. `frames`: the frames that used the wish. */
export type StandIn = { wish_id: string; want: string; query: string | null; as: string | null; person: string | null; fallback: string; frames: number[] };

/** The wishes a plan loses to their fallbacks, read before `applyWishes` removes them. Pure. */
export function standInsFrom(plan: PlanLike, found: ReadonlyMap<string, unknown>): StandIn[] {
  return (plan.wishes ?? []).filter((w) => isObject(w) && text(w.fallback) && !found.has(w.id)).map((w) => ({
    wish_id: w.id, want: text(w.want), query: text(w.query) || null, as: w.as ?? null, person: text(w.person) || null, fallback: w.fallback,
    frames: (plan.frames ?? []).filter((f) => frameAssetIds(f).includes(w.id)).map((f) => f.n),
  }));
}

/** Words that say what kind of thing is pictured, not which thing: they can't tell two pictures apart. */
const PICTURE_WORDS = new Set(('about above after again against also among around arrives back been before behind being beside between both captured clear close from front full have head image images into just like long many more most much near next only other over photo photos picture pictures portrait real same seen shot shots shoulders shows showing some such than that their them then there these they this those through under very viewer visible what when where which while with without would your screenshot screenshots page pages article articles headline headlines post posts photographed').split(' '));
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const wordSet = (s: string): string[] => [...new Set((plainText(s).toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{N}]+)?/gu) ?? []).map(stem).filter((w) => w.length > 2 && !PICTURE_WORDS.has(w)))];

/** Words too many of this reel's pictures share to tell one from another: at least this share of the inventory, and at least 3 pictures. */
const COMMON_WORD_SHARE = 0.15;
function commonWords(inventory: VisualsInventory): Set<string> {
  const counts = new Map<string, number>();
  for (const a of inventory.assets) for (const w of wordSet(assetRecord(a, { credit: true }))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const least = Math.max(3, inventory.assets.length * COMMON_WORD_SHARE);
  return new Set([...counts].filter(([, n]) => n >= least).map(([w]) => w));
}

/** The forms a shot can ask for by name, and what makes a picture one. */
const PICTURE_FORMS: { asks: RegExp; kinds: string[]; says: RegExp; name: string }[] = [
  { name: 'an article or page', asks: /\b(?:articles?|headlines?|web ?pages?|pages?|screenshots?)\b/i, kinds: ['web_page', 'headline', 'document', 'paper', 'social_post'], says: /\b(?:articles?|headlines?|pages?|screenshots?)\b/i },
  { name: 'a post', asks: /\b(?:tweets?|posts?)\b/i, kinds: ['social_post'], says: /\b(?:tweets?|posts?)\b/i },
  { name: 'a slide', asks: /\bslides?\b/i, kinds: [], says: /\bslides?\b/i },
  { name: 'a document', asks: /\b(?:papers?|filings?|memos?|documents?)\b/i, kinds: ['paper', 'document'], says: /\b(?:papers?|filings?|memos?|documents?|arxiv)\b/i },
];
const QUOTED_TEXT = /"[^"]*"|“[^”]*”|'[^']{3,}'|‘[^’]*’/g;
const withoutQuotes = (s: string) => s.replace(QUOTED_TEXT, ' ');

function missingForm(asks: string, a: Asset): string | null {
  const what = withoutQuotes(asks);
  for (const form of PICTURE_FORMS) {
    if (form.asks.test(what) && !form.kinds.includes(a.kind) && !form.says.test(withoutQuotes(a.shows ?? ''))) return form.name;
  }
  return null;
}

/** The least share of a want's telling words a stand-in's record must carry to count as showing it. */
const STAND_IN_MIN_SHARE = 1 / 3;

/**
 * Whether a found picture shows what a wish asks, from the records alone (fails open: a want with nothing telling passes).
 * A make is drawn, so it reads as made and may stand in (decision 4). A person's wish needs that person, a logo's a logo, a named form that form.
 * Otherwise at least a third of the want's telling words must be in the picture's record, not counting words most of the inventory shares.
 */
export function standInFits(w: Pick<StandIn, 'want' | 'query' | 'as' | 'person' | 'fallback'>, ctx: Pick<PlanContext, 'inventory'> & { makes?: readonly MakeRequest[] }): { fits: boolean; why: string } {
  const a = ctx.inventory.assets.find((x) => x.id === w.fallback);
  if (!a) return { fits: true, why: (ctx.makes ?? []).some((m) => m.id === w.fallback) ? 'a make, which reads as made' : 'nothing on record to compare' };
  if (isMadeAsset(a)) return { fits: true, why: 'made, which reads as made' };
  if (w.person) {
    const has = (a.people ?? []).some((p) => samePerson(p, w.person!));
    return { fits: has, why: has ? `it shows ${w.person}` : `it doesn't show ${w.person}` };
  }
  if (w.as === 'logo' && !isLogo(a)) return { fits: false, why: 'it is not a logo' };
  const form = missingForm(`${w.want} ${w.query ?? ''}`, a);
  if (form) return { fits: false, why: `it is not ${form}` };
  const common = commonWords(ctx.inventory);
  const telling = wordSet(`${w.want} ${w.query ?? ''}`).filter((x) => !common.has(x));
  if (!telling.length) return { fits: true, why: 'nothing telling to compare' };
  const record = new Set(wordSet(assetRecord(a, { credit: true })));
  const shared = telling.filter((x) => record.has(x));
  return shared.length / telling.length >= STAND_IN_MIN_SHARE ? { fits: true, why: `it shares ${shared.join(', ')}` } : { fits: false, why: 'its record shares almost nothing with what the shot asks' };
}

const REBUILD = 'First rebuild the frame\'s message from the real pictures you have. Only when real pictures can\'t carry the message, draw it or build it in code from verified words, plainly as made, never as the real page';

/** After the search: a frame still on a fallback that doesn't show what its shot asked. Back to the director, once. */
export function standInFindings(plan: PlanLike, standIns: readonly StandIn[], inventory: VisualsInventory): PlanFinding[] {
  const out: PlanFinding[] = [];
  for (const s of standIns) {
    const check = standInFits(s, { inventory, makes: plan.makes });
    if (check.fits) continue;
    const a = inventory.assets.find((x) => x.id === s.fallback);
    for (const f of plan.frames ?? []) {
      if (!f || !frameAssetIds(f).includes(s.fallback) || (s.frames.length && !s.frames.includes(f.n))) continue;
      out.push({ id: 'stand_in', frame: f.n, asset_id: s.fallback, why: `frame ${f.n} wanted "${s.want}", the search didn't find it, and it fell to ${s.fallback} ("${a?.shows ?? ''}"): ${check.why}. ${REBUILD}` });
    }
  }
  return out;
}

const SENTENCE_START = /^\s*$|[.!?:;]\s*$/;
/** An acronym may stand for a name the record spells out, so it can't be held against the record. */
const ACRONYM = /^\p{Lu}[\p{Lu}\p{N}]{1,5}$/u;

/**
 * A beat's own words against the pictures it names: what it says is on screen must be what they record. Two things code can tell without a model:
 * the beat names something none of its real pictures records (a capitalised word past the sentence's start, leaving quoted on-screen words aside), or
 * asks for a page, post, slide or document and none of them is one. Drawn pictures are made, so they are left out. Fails open.
 */
export function shotPictureFindings(plan: PlanLike, inventory: VisualsInventory): PlanFinding[] {
  const out: PlanFinding[] = [];
  const assets = new Map(inventory.assets.map((a) => [a.id, a]));
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close' || !Array.isArray(f.shots)) continue;
    for (const s of f.shots) {
      const real = (s?.asset_ids ?? []).map((id) => assets.get(id)).filter((a): a is Asset => Boolean(a) && !isMadeAsset(a));
      if (!real.length || real.length !== (s.asset_ids ?? []).length) continue;
      const says = withoutQuotes(plainText(s.shows ?? ''));
      const record = new Set((real.map((a) => plainText(assetRecord(a, { credit: true }))).join(' . ').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
      const unnamed: string[] = [];
      for (const m of says.matchAll(/[\p{L}\p{N}]*\p{Lu}[\p{L}\p{N}]*/gu)) {
        if (SENTENCE_START.test(says.slice(0, m.index)) || ACRONYM.test(m[0]) || record.has(m[0].toLowerCase())) continue;
        unnamed.push(m[0]);
      }
      const ids = real.map((a) => a.id).join(', ');
      const form = real.every((a) => missingForm(says, a)) ? missingForm(says, real[0]!) : null;
      if (unnamed.length) out.push({ id: 'shot_picture', frame: f.n, asset_id: real[0]!.id, why: `frame ${f.n}'s beat on "${s.at}" says it shows ${s.shows}, and ${ids} (${real.map((a) => `"${a.shows}"`).join('; ')}) ${real.length > 1 ? 'record' : 'records'} nothing of ${unnamed.join(', ')}. Use a picture that shows it, or rebuild the beat from what you have. ${REBUILD}` });
      else if (form) out.push({ id: 'shot_picture', frame: f.n, asset_id: real[0]!.id, why: `frame ${f.n}'s beat on "${s.at}" says it shows ${s.shows}, and ${ids} (${real.map((a) => `"${a.shows}"`).join('; ')}) ${real.length > 1 ? 'are' : 'is'} not ${form}. Use a picture that shows it, or rebuild the beat from what you have. ${REBUILD}` });
    }
  }
  return out;
}

const REAL_ARTIFACT_TREATMENTS = new Set(['page', 'post', 'document', 'headline', 'newspaper']);

/** Anything recreated must read clearly as made: a page, post or headline with no real picture behind it would pass as the real thing. */
function recreatedFindings(plan: PlanLike, inventory: VisualsInventory): PlanFinding[] {
  const out: PlanFinding[] = [];
  const assets = new Map(inventory.assets.map((a) => [a.id, a]));
  const makes = new Set((plan.makes ?? []).filter(isObject).map((m) => m.id));
  const fake = (id: string | undefined) => !id || makes.has(id) || isMadeAsset(assets.get(id));
  for (const f of plan.frames ?? []) {
    if (!f || f.treatment === 'close') continue;
    const say = (what: string, id: string | null) => out.push({ id: 'recreated_as_real', frame: f.n, asset_id: id, why: `frame ${f.n} presents ${what} as a real ${id ? 'page' : 'page with no picture behind it'}, which would pass a recreation off as the real thing. Show the real one, or make it read plainly as made: marker notes or a drawing on the whiteboard` });
    if (f.blueprint?.pieces) {
      if (f.blueprint.ground === 'whiteboard') continue;
      for (const p of f.blueprint.pieces) if (p?.treatment && REAL_ARTIFACT_TREATMENTS.has(p.treatment) && fake(p.asset)) say(`piece "${p.id}"`, p.asset ?? null);
    } else if (REAL_ARTIFACT_TREATMENTS.has(f.treatment)) {
      const made = (f.asset_ids ?? []).find((id) => makes.has(id) || isMadeAsset(assets.get(id)));
      if (made) say(made, made);
    }
  }
  return out;
}

/** A long frame needs something to happen in it: an arrival, a mark, a plate, an arrow, a tone or a second camera aim, not only a slow push. */
function staticFrameFindings(plan: PlanLike, draft: WriterDraft): PlanFinding[] {
  const out: PlanFinding[] = [];
  const lineText = new Map(draftLines(draft).map((l) => [l.id, l.text]));
  for (const f of plan.frames ?? []) {
    const b = f?.blueprint;
    if (!b?.pieces || f.treatment === 'close') continue;
    const spoken = voiceKeys(voiceOf(f, lineText)).length;
    if (spoken <= SHOT_MAX_WORDS) continue;
    const changes = b.pieces.filter((p) => p?.on).length + (b.marks?.length ?? 0) + (b.speech?.length ?? 0) + (b.arrows?.length ?? 0) + (b.ground_tone?.length ?? 0) + (new Set((b.camera?.stops ?? []).map((s) => s?.aim)).size > 1 ? 1 : 0);
    if (!changes) out.push({ id: 'static_frame', frame: f.n, asset_id: null, why: `frame ${f.n} runs ${spoken} spoken words and nothing changes on screen but the camera; land something on the words that matter: a piece, a mark, words beside the person, or a second camera aim` });
  }
  return out;
}

/**
 * Every plan check on what the frames show (§6). The caller runs these once the wishes are resolved, gives them to one
 * director fix round, and flags what remains. Blueprint validity goes earlier, in `validatePlan`'s own correction.
 */
export function planFindings(plan: PlanLike, ctx: PlanContext): PlanFinding[] {
  return [
    ...repeatFindings(plan, ctx.inventory),
    ...sameCastFindings(plan, ctx.inventory),
    ...namedThingFindings(plan, ctx),
    ...namedPlaceFindings(plan, ctx),
    ...standInFindings(plan, ctx.standIns ?? [], ctx.inventory),
    ...shotPictureFindings(plan, ctx.inventory),
    ...recreatedFindings(plan, ctx.inventory),
    ...staticFrameFindings(plan, ctx.draft),
  ];
}

// ── A fix round's answer, and a plan that never passed ───────

const framesNamedIn = (text: string): number | null => {
  const m = /\bframes? (\d+)/.exec(text);
  return m ? Number(m[1]) : null;
};

/**
 * A fix round's answer, completed from the plan the run holds: frames the fix doesn't name stay exactly as they are (code may have
 * changed them since the director saw them, and they aren't its to answer for), and a named frame keeps its number, name and lines.
 * Only what the fix can change is judged, so a fix round is never spent on a frame nobody asked about. Pure on `fix`.
 */
export function validateFixedPlan(
  raw: unknown,
  fix: { plan: DirectorPlan; problems: readonly { frame: number }[] },
  ctx: { draft: WriterDraft; inventory: VisualsInventory },
): ReturnType<typeof validatePlan> {
  if (!isObject(raw)) return { value: null, problems: ['the plan is missing frames'], warnings: [], soft: [] };
  const named = new Set(fix.problems.map((p) => p.frame));
  const returned = new Map((Array.isArray(raw.frames) ? raw.frames : []).filter(isObject).map((f) => [f.n as number, f as unknown as StoryboardFrame]));
  const frames = (JSON.parse(JSON.stringify(fix.plan.frames)) as StoryboardFrame[]).map((f) => {
    const g = named.has(f.n) ? returned.get(f.n) : undefined;
    return g ? { ...g, n: f.n, name: f.name, line_ids: f.line_ids } : f;
  });
  const have = new Set((fix.plan.makes ?? []).map((m) => m.id));
  const makes = [...(fix.plan.makes ?? []), ...(Array.isArray(raw.makes) ? (raw.makes as MakeRequest[]) : []).filter((m) => !have.has(m?.id))];
  const inUse = new Set([...frames.flatMap((f) => frameAssetIds(f)), ...makes.flatMap((m) => m?.from_assets ?? [])]);
  const wishes = (Array.isArray(raw.wishes) ? (raw.wishes as ShotWish[]) : []).filter((w) => inUse.has(w?.id));
  const parsed = validatePlan({ frames, makes, wishes, lines_back: [] }, ctx);
  const mine = (text: string) => {
    const n = framesNamedIn(text);
    return n === null || named.has(n);
  };
  return { ...parsed, problems: parsed.problems.filter(mine), soft: parsed.soft.filter(mine) };
}

/**
 * Never block a reel: what code can make of a first plan still invalid after its fix round. The structure the run depends on is
 * repaired (every line once and in order, the close last, frame 1 opening the reel, words that are the script's, pictures that
 * exist), and what it changed or couldn't goes on `repairs` for the run to flag. Null when there is nothing to build from.
 */
export function salvagePlan(raw: unknown, problems: readonly string[], ctx: { draft: WriterDraft; inventory: VisualsInventory }): DirectorPlan | null {
  if (!isObject(raw) || !Array.isArray(raw.frames)) return null;
  const given = (JSON.parse(JSON.stringify(raw.frames)) as unknown[]).filter(isObject) as unknown as StoryboardFrame[];
  const lines = draftLines(ctx.draft);
  const place = new Map(lines.map((l, i) => [l.id, i]));
  const makes = (Array.isArray(raw.makes) ? raw.makes : []).filter(isObject) as unknown as MakeRequest[];
  const wishes = (Array.isArray(raw.wishes) ? raw.wishes : []).filter(isObject) as unknown as ShotWish[];
  const exists = new Set([...ctx.inventory.assets.map((a) => a.id), ...makes.map((m) => m.id), ...wishes.map((w) => w.id)]);
  const seen = new Set<string>();

  const shaped = given.map((f) => {
    const blueprint = isObject(f.blueprint) && Array.isArray(f.blueprint.pieces)
      ? { ...f.blueprint, pieces: f.blueprint.pieces.filter((p) => isObject(p) && (!p.asset || exists.has(p.asset))) }
      : null;
    const line_ids = (Array.isArray(f.line_ids) ? f.line_ids : []).filter((id) => place.has(id) && !seen.has(id) && Boolean(seen.add(id))).sort((a, b) => place.get(a)! - place.get(b)!);
    return {
      ...f,
      name: text(f.name) || `Frame ${f.n ?? ''}`.trim(),
      purpose: text(f.purpose) || 'Carries its lines.',
      line_ids,
      asset_ids: (Array.isArray(f.asset_ids) ? f.asset_ids : []).filter((a) => exists.has(a)),
      ...(blueprint?.pieces.length ? { blueprint } : { blueprint: undefined }),
    } as StoryboardFrame;
  });
  const closes = shaped.filter((f) => f.treatment === 'close');
  const story = shaped.filter((f) => f.treatment !== 'close').filter((f) => f.line_ids.length);
  // Lines the plan lost, or left on a close, go with the line before them.
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.id) && story.some((f) => f.line_ids.includes(l.id))) continue;
    const before = lines.slice(0, i).reverse().find((p) => story.some((f) => f.line_ids.includes(p.id)));
    const host = before ? story.find((f) => f.line_ids.includes(before.id)) : story[0];
    if (!host) return null;
    host.line_ids = [...host.line_ids, l.id].sort((a, b) => place.get(a)! - place.get(b)!);
  }
  if (!story.length) return null;
  story.sort((a, b) => place.get(a.line_ids[0])! - place.get(b.line_ids[0])!);
  const firstAsset = ctx.inventory.assets[0]?.id;
  let last: string | undefined = firstAsset;
  for (const f of story) {
    if (!(TREATMENTS as readonly string[]).includes(f.treatment)) f.treatment = 'photo' as StoryboardFrame['treatment'];
    if (!f.asset_ids.length && !f.blueprint && last) f.asset_ids = [last];
    last = f.asset_ids[0] ?? last;
    if (!isObject(f.focus) || !(FOCUS_KINDS as readonly string[]).includes(f.focus.kind) || !text(f.focus.what)) f.focus = { kind: 'object', what: f.purpose };
    const words = f.on_screen;
    if (words != null && (typeof words !== 'string' || countWords(words) > ON_SCREEN_MAX_WORDS || ![ctx.draft.hook.on_screen, ...lines.map((l) => l.on_screen)].some((w) => w && sameWords(w, words)))) f.on_screen = null;
  }
  const close: StoryboardFrame = { ...(closes.at(-1) ?? { name: 'The question', purpose: 'The question plays over the close.', asset_ids: [], music: 'hold', on_screen: null }), treatment: 'close', line_ids: [] } as StoryboardFrame;
  story[0].music = 'start';
  if (ctx.draft.hook.on_screen?.trim() && !story[0].on_screen?.trim()) story[0].on_screen = ctx.draft.hook.on_screen;
  const frames = [...story, close].map((f, i) => ({ ...f, n: i + 1 }));
  const lines_back = (Array.isArray(raw.lines_back) ? raw.lines_back : []).filter((b) => isObject(b) && place.has(b.line_id as string) && text(b.why));
  const checked = validatePlan({ frames, makes, wishes, lines_back } as unknown as DirectorPlan, ctx);
  if (!checked.value) return null;
  const still = new Set(checked.problems);
  const repairs = [...problems.filter((p) => !still.has(p)).map((p) => `repaired: ${p}`), ...checked.problems.map((p) => `still so: ${p}`)];
  return { ...checked.value, repairs };
}
