import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type {
  Asset,
  DirectorPlan,
  FactSheet,
  ScriptLine,
  StoryboardFrame,
  VisualsInventory,
  WriterDraft,
} from '@/lib/reel-ai-drama/types';
import type { Parsed } from '@/lib/reel-ai-drama/writing/llm';
import { seedKind } from '@/explainers/reel-ai-drama/kit/settings/index.js';
import { ASSET_TREATMENTS, CHARACTER_TREATMENTS, MAKE_KINDS, TREATMENTS, type Treatment } from '@/lib/reel-ai-drama/writing/schemas';

/**
 * Code checks on the writer's and director's output: the objective structure the prompts' HARD
 * CONSTRAINTS promise. Craft (is the hook good?) is never judged here. Limits carry a little slack over
 * the prompts' numbers so a near miss doesn't cost a paid fix round.
 */

/** Narration pace with the short picture beats included: about 165 words a minute (W-86 rewrite). */
export const WORDS_PER_SECOND = 2.75;
export const RUNG_WORD_SLACK = 3;
export const MIN_RUNGS = 4;
export const MIN_WORDS = 110;
export const HOOK_ON_SCREEN_MAX_WORDS = 10;
/** The close question fits the fixed 2.5s close: about 6 words (the prompt says about 6; one word of slack). */
export const CLOSE_QUESTION_MAX_WORDS = 7;
export const ON_SCREEN_MAX_WORDS = 12;
/** The turn starts in the back half: at or after this share of the narrated words, less TURN_WORD_SLACK. */
export const TURN_FROM = 0.5;
export const TURN_WORD_SLACK = 8;
/** A silent picture beat after a line (W-130): 0–1 seconds. */
export const PAUSE_MAX = 1;
/** Image-model makes per reel (MD-59; a seeded make is code-built and free, so it doesn't count). */
export const MAX_GENERATED_MAKES = 6;

export type LengthLimits = Pick<ReelAiDramaSettings, 'max_seconds' | 'rung_max_seconds'>;

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
  return Math.round(limits.rung_max_seconds * WORDS_PER_SECOND);
}

export function maxWords(limits: LengthLimits): number {
  return Math.round(limits.max_seconds * 2.8);
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

/** Validate a draft against the facts, the inventory and the length rules. Sets `word_count` from the text. */
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

  if (draft.rungs.length < MIN_RUNGS) problems.push(`the script has ${draft.rungs.length} rungs; it needs at least ${MIN_RUNGS} (hook, ladder, turn, landing)`);
  draft.rungs.forEach((r, i) => {
    if (r.id !== `R${i + 1}`) problems.push(`rung ${i + 1} has id "${r.id}"; rung ids run R1, R2… in order`);
    if (!r.lines.length) problems.push(`rung ${r.id} has no lines`);
    if (!r.purpose?.trim()) problems.push(`rung ${r.id} has no purpose`);
    const words = r.lines.reduce((n, l) => n + countWords(l.text), 0);
    const cap = maxRungWords(ctx.limits);
    if (words > cap + RUNG_WORD_SLACK) {
      problems.push(`rung ${r.id} runs ${words} spoken words (about ${Math.round(words / WORDS_PER_SECOND)}s); keep every rung to about ${cap} so something new lands at least every ${ctx.limits.rung_max_seconds}s — split it or cut`);
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
  const turn = rungIndex.get(draft.turn_rung_id);
  const landing = rungIndex.get(draft.landing_rung_id);
  if (landing === undefined || landing !== draft.rungs.length - 1) problems.push(`landing_rung_id must be the last rung, got "${draft.landing_rung_id}"`);
  if (turn === undefined) problems.push(`turn_rung_id "${draft.turn_rung_id}" is not a rung`);
  else if (landing !== undefined && turn >= landing) problems.push('the turn must come before the landing');
  else if (total > 0) {
    const before = draft.rungs.slice(0, turn).reduce((n, r) => n + r.lines.reduce((m, l) => m + countWords(l.text), 0), 0);
    if ((before + TURN_WORD_SLACK) / total < TURN_FROM) problems.push(`the turn (${draft.turn_rung_id}) starts ${Math.round((before / total) * 100)}% of the way in; it belongs in the back half`);
  }

  const q = draft.close_question?.trim() ?? '';
  if (!q) problems.push('the close question is missing');
  else {
    if (!q.endsWith('?')) problems.push('the close question must end with a question mark');
    if (countWords(q) > CLOSE_QUESTION_MAX_WORDS) problems.push(`the close question runs ${countWords(q)} words; keep it to about 6 so it is spoken inside the fixed 2.5s close`);
  }

  if (total < MIN_WORDS) problems.push(`the narration totals ${total} words; about 140–170 makes 60 seconds`);
  if (total > maxWords(ctx.limits)) problems.push(`the narration totals ${total} words; at most about ${maxWords(ctx.limits)} (${ctx.limits.max_seconds}s)`);
  else {
    const pauses = pauseSeconds(draft);
    const seconds = total / 2.8 + pauses;
    if (pauses > 0 && seconds > ctx.limits.max_seconds) {
      problems.push(`the narration (${total} words) plus ${Math.round(pauses * 10) / 10}s of pauses runs about ${Math.round(seconds)}s; at most ${ctx.limits.max_seconds}s — cut words or pauses`);
    }
  }

  return { value: { ...draft, word_count: total }, problems };
}

export type Replacement = {
  line_id: string;
  cut: boolean;
  text: string;
  on_screen: string | null;
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
        return [{ id: l.id, text: r.text, on_screen: r.on_screen, fact_ids: r.fact_ids, must_show: r.must_show, pause_after: r.pause_after === undefined ? l.pause_after ?? null : r.pause_after }];
      }),
    }))
    .filter((rung) => rung.lines.length > 0);
  const revised: WriterDraft = { ...draft, rungs };
  const checked = validateRevised(revised, ctx);
  return { value: checked.value, problems: [...problems, ...checked.problems] };
}

/** A revised draft keeps its original line ids (so the plan still points at them); everything else is checked as usual. */
function validateRevised(draft: WriterDraft, ctx: { facts: FactSheet; inventory: VisualsInventory | null; limits: LengthLimits }): Parsed<WriterDraft> {
  const renumbered = (p: string) => !/^(line|rung) \d+ has id/.test(p);
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
      const label = lines.get(id)?.on_screen?.trim();
      if (label && !sameWords(label, own) && !(f.n === 1 && sameWords(own, ctx.draft.hook.on_screen ?? ''))) {
        out.push(`frame ${f.n} shows "${own}" as well as ${id}'s label "${label}"; one text element per frame, so the label may be dropped`);
      }
    }
  }
  const byId = new Map(ctx.inventory.assets.map((a) => [a.id, a]));
  const uses = new Map<string, StoryboardFrame[]>();
  for (const f of plan.frames) for (const id of new Set(f.asset_ids)) uses.set(id, [...(uses.get(id) ?? []), f]);
  for (const [id, frames] of uses) {
    const a = byId.get(id);
    if (!a || isCharacterImage(a) || a.anchor_for || frames.length < 2) continue;
    if (new Set(frames.map((f) => f.purpose.trim().toLowerCase())).size > 1) {
      out.push(`${id} is used in frames ${frames.map((f) => f.n).join(', ')} for different purposes (${frames.map((f) => `${f.n}: ${f.purpose}`).join('; ')}); one image, one job unless it says the same thing again`);
    }
  }
  return out;
}

/** Validate a director's plan against the locked draft and the inventory. */
export function validatePlan(raw: unknown, ctx: { draft: WriterDraft; inventory: VisualsInventory }): Parsed<DirectorPlan> & { warnings: string[] } {
  if (!isObject(raw) || !Array.isArray(raw.frames) || !Array.isArray(raw.lines_back)) return { value: null, problems: ['the plan is missing frames or lines_back'], warnings: [] };
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
  if (plan.makes != null && !Array.isArray(plan.makes)) problems.push('makes must be a list (empty when nothing is made)');
  const makes = Array.isArray(plan.makes) ? plan.makes : [];
  problems.push(...makeProblems(makes, plan, ctx.inventory));
  const made = new Set(makes.map((m) => m.id));

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
    for (const a of f.asset_ids) {
      const asset = byId.get(a);
      if (!asset) {
        if (!made.has(a)) problems.push(`frame ${f.n} uses ${a}, which is not in the inventory or the makes`);
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
  return { value: plan, problems, warnings: problems.length ? [] : planWarnings(plan, ctx) };
}

/** After a revision cut lines: drop them from the frames, drop story frames left empty, renumber. */
export function pruneCutLines(plan: DirectorPlan, draft: WriterDraft): DirectorPlan {
  const live = new Set(draftLines(draft).map((l) => l.id));
  const frames: StoryboardFrame[] = [];
  for (const f of plan.frames) {
    const line_ids = f.line_ids.filter((id) => live.has(id));
    if (f.treatment !== 'close' && f.line_ids.length && !line_ids.length) continue;
    frames.push({ ...f, line_ids, n: frames.length + 1 });
  }
  const used = new Set(frames.flatMap((f) => f.asset_ids));
  return {
    frames,
    ...(plan.makes ? { makes: plan.makes.filter((m) => used.has(m.id)) } : {}),
    lines_back: plan.lines_back.filter((b) => live.has(b.line_id)),
  };
}

/**
 * The director's make requests (MD-59): ids M1, M2… unique and apart from the inventory, a known kind, a
 * brief, sources from the inventory, a seed only when it is a seeded tool of that kind, a picture to trace
 * for an expression sketch, at most MAX_GENERATED_MAKES image-model makes, and every make used by a frame.
 */
export function makeProblems(makes: NonNullable<DirectorPlan['makes']>, plan: Pick<DirectorPlan, 'frames'>, inventory: VisualsInventory): string[] {
  const out: string[] = [];
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const ids = new Set<string>();
  const used = new Set((plan.frames ?? []).flatMap((f) => f.asset_ids ?? []));
  let generated = 0;
  for (const m of makes) {
    if (!/^M\d+$/.test(m?.id ?? '')) { out.push(`make "${m?.id}" needs an id M1, M2…`); continue; }
    if (ids.has(m.id)) out.push(`make ${m.id} appears twice`);
    // A fix round may see a make already made (it is in the inventory, `made`); anything else is a collision.
    if (byId.has(m.id) && !byId.get(m.id)!.made) out.push(`make ${m.id} collides with an inventory asset id`);
    ids.add(m.id);
    if (!(MAKE_KINDS as readonly string[]).includes(m.kind)) out.push(`make ${m.id} has kind "${m.kind}"; one of ${MAKE_KINDS.join(', ')}`);
    if (!m.brief?.trim()) out.push(`make ${m.id} has no brief: say exactly what the moment needs`);
    for (const a of m.from_assets ?? []) if (!byId.has(a)) out.push(`make ${m.id} builds from ${a}, which is not in the inventory`);
    if (m.seed != null && m.seed !== '') {
      const k = seedKind(m.seed);
      if (k !== m.kind) out.push(`make ${m.id}'s seed "${m.seed}" is not a seeded ${m.kind}; set seed null and the ${m.kind} is made to the brief`);
    } else {
      generated += 1;
      if (m.kind === 'expression') {
        const traceable = (m.from_assets ?? []).some((a) => byId.has(a)) ||
          (m.people ?? []).some((p) => inventory.assets.some((a) => a.anchor_for === p || (a.people.includes(p) && a.kind !== 'logo')));
        if (!traceable) out.push(`make ${m.id} is an expression sketch with nothing to trace: name the person (people) or their picture (from_assets)`);
      }
    }
    if (!used.has(m.id)) out.push(`make ${m.id} is used by no frame; drop it or put it in a frame's asset_ids`);
  }
  if (generated > MAX_GENERATED_MAKES) out.push(`${generated} makes need the image model; at most ${MAX_GENERATED_MAKES} per reel (a seeded make is free)`);
  return out;
}
