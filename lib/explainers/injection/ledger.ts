import fs from 'node:fs';
import path from 'node:path';

import { lessonIdOf, lessonText, loadLessonRules, normalizeError } from '@/lib/explainers/injection/lessons';

/**
 * The learning loop (INJECTION-PLAN.md § 4; thresholds approved by Lucas 2026-11-16). Each render
 * logs, per context window, what was injected, what the builder had to Read on demand (a miss) and
 * the errors of its first self-check. After the render, code folds that into a ledger that lasts
 * across renders. Code applies the thresholds; no model judges anything here.
 *
 * - promote: a section missed (Read on demand, or governing a first-try error while not injected) in
 *   PROMOTE_MISSES or more of the last PROMOTE_WINDOW renders of that role and look is injected
 *   always, whatever Jev says;
 * - demote: a section injected in each of the last DEMOTE_WINDOW renders of that role and look,
 *   never missed, never governing an error, and always picked on a borderline score, needs
 *   DEMOTED_MIN from Jev from then on;
 * - lessons: a first-try error of the same lesson id (lessons.ts: a written rule, or the normalized
 *   error for a kind with no rule yet) in PROMOTE_MISSES or more of the last PROMOTE_WINDOW renders
 *   puts that lesson's rule in that role and look's dispatch message (never another reel's text; a
 *   retired rule, one code now prevents, is never injected).
 *
 * The ledger is plain JSON Lucas can read and edit: `overrides.always` / `overrides.never` (section
 * ids, per `role|look` key or `*`) win over everything.
 */

export const PROMOTE_MISSES = 2;
export const PROMOTE_WINDOW = 5;
export const DEMOTE_WINDOW = 10;
/** A demoted section is injected only at this Jev score or more. */
export const DEMOTED_MIN = 0.6;
/** "Borderline": every pick of a demotion candidate scored under this. */
export const BORDERLINE = 0.6;
export const MAX_LESSONS = 8;
const KEEP_RENDERS = 20;

/** One context window of one render (a builder dispatch). */
export type ContextLog = {
  label: string;
  role: string;
  look: string;
  frame: string | null;
  injected: string[];
  scores: Record<string, number>;
  misses: string[];
  /** The errors of the first try.mjs run in this window, or null when it never ran one. */
  firstTry: string[] | null;
  /** The lesson ids injected into this window (so the ledger can tell whether a lesson worked). */
  lessons?: string[];
};
export type RenderLog = { jobId: string; at: string; contexts: ContextLog[] };
export type Ledger = {
  about?: string;
  renders: RenderLog[];
  overrides: { always: Record<string, string[]>; never: Record<string, string[]> };
};

export const contextKey = (role: string, look: string) => `${role}|${look}`;

export function emptyLedger(): Ledger {
  return {
    about: 'Instruction injection ledger (lib/explainers/injection/ledger.ts). renders: the last renders\' logs, newest last. overrides.always / overrides.never: section ids by "role|look" (or "*"), edited by hand; they win over everything.',
    renders: [],
    overrides: { always: {}, never: {} },
  };
}

export function readLedger(file: string): Ledger {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Ledger>;
    return { ...emptyLedger(), ...raw, overrides: { always: raw.overrides?.always ?? {}, never: raw.overrides?.never ?? {} }, renders: raw.renders ?? [] };
  } catch {
    return emptyLedger();
  }
}

export function writeLedger(file: string, ledger: Ledger): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Fold one render into the ledger (replacing an earlier log of the same job, a resumed render). */
export function foldRender(ledger: Ledger, render: RenderLog): Ledger {
  const renders = [...ledger.renders.filter((r) => r.jobId !== render.jobId), render].slice(-KEEP_RENDERS);
  return { ...ledger, renders };
}

/** The same error, whatever frame, time, name or number it names. */
export const errorKind = normalizeError;

/** The sections whose instructions govern an error (what should have prevented it). */
const GOVERNS: [RegExp, string[]][] = [
  [/critter|\bCAST\b|outfit|\bwear|worn|body\b/i, ['frame:critters', 'frame:roles', 'kit:cast-js', 'kit:outfits-js']],
  [/\bshot|camera|jump|\bcut\b|lens/i, ['frame:cameras-and-shots', 'kit:shots-js', 'kit:lens-js', 'craft:3-editing']],
  [/\btext|font|label|caption|textBox|off screen|overlap|spacing|MIN_GAP/i, ['frame:solids-labels-and-drawing', 'kit:layout-js', 'kit:cards-js']],
  [/prop|NEW_PROPS|SIZES|\bobject|courier|carr(y|ies)/i, ['frame:objects-and-the-courier', 'frame:carry', 'kit:props-js', 'kit:objects-js']],
  [/light|shadow|mood/i, ['frame:light-and-mood', 'kit:light-js']],
  [/event|sound|sfx/i, ['frame:sound-events']],
  [/world|place|\bset\b|setlock|room|VIEWS/i, ['frame:the-world-module', 'frame:places', 'kit:set-js', 'kit:setlock-js', 'kit:space-js']],
  [/glass|screen|gloss/i, ['kit:glass-js']],
  [/cable|plug/i, ['kit:connect-js']],
  [/mechanism|diagram|identity/i, ['frame:mechanism-primitives', 'kit:explain-js']],
];

export function governingSections(error: string): string[] {
  const out = new Set<string>();
  for (const [re, ids] of GOVERNS) if (re.test(error)) ids.forEach((id) => out.add(id));
  return [...out];
}

const recentFor = (ledger: Ledger, key: string, n: number) =>
  ledger.renders
    .map((r) => r.contexts.filter((c) => contextKey(c.role, c.look) === key))
    .filter((cs) => cs.length > 0)
    .slice(-n);

/** Sections missed in a context: Read on demand, or governing a first-try error while not injected. */
export function missedIn(c: ContextLog): Set<string> {
  const out = new Set(c.misses);
  for (const e of c.firstTry ?? []) for (const id of governingSections(e)) if (!c.injected.includes(id)) out.add(id);
  return out;
}

export type Guidance = { always: string[]; never: string[]; demoted: string[]; lessons: string[]; lessonIds: string[] };

/** What the ledger says for one role and look. */
export function guidance(ledger: Ledger, role: string, look: string): Guidance {
  const key = contextKey(role, look);
  const pick = (o: Record<string, string[]>) => [...new Set([...(o['*'] ?? []), ...(o[key] ?? [])])];
  const never = pick(ledger.overrides.never);

  const recent = recentFor(ledger, key, PROMOTE_WINDOW);
  const rules = loadLessonRules();
  const missCount = new Map<string, number>();
  const lessonCount = new Map<string, number>();
  for (const contexts of recent) {
    const missed = new Set<string>();
    const ids = new Set<string>();
    for (const c of contexts) {
      missedIn(c).forEach((id) => missed.add(id));
      for (const e of c.firstTry ?? []) ids.add(lessonIdOf(e, rules));
    }
    for (const id of missed) missCount.set(id, (missCount.get(id) ?? 0) + 1);
    for (const id of ids) lessonCount.set(id, (lessonCount.get(id) ?? 0) + 1);
  }
  const promoted = [...missCount].filter(([, n]) => n >= PROMOTE_MISSES).map(([id]) => id);
  const always = [...new Set([...pick(ledger.overrides.always), ...promoted])].filter((id) => !never.includes(id));

  const long = recentFor(ledger, key, DEMOTE_WINDOW);
  const demoted: string[] = [];
  if (long.length >= DEMOTE_WINDOW) {
    const candidates = new Set(long[0].flatMap((c) => c.injected));
    for (const id of candidates) {
      const ok = long.every((cs) => cs.some((c) => c.injected.includes(id)) && cs.every((c) => !missedIn(c).has(id) && (c.scores[id] ?? 1) < BORDERLINE));
      if (ok && !always.includes(id)) demoted.push(id);
    }
  }

  const picked = [...lessonCount]
    .filter(([, n]) => n >= PROMOTE_MISSES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => ({ id, text: lessonText(id, rules) }))
    .filter((x): x is { id: string; text: string } => Boolean(x.text))
    .slice(0, MAX_LESSONS);

  return { always, never, demoted, lessons: picked.map((x) => x.text), lessonIds: picked.map((x) => x.id) };
}

/** Apply guidance to Jev's scores: the ids to inject. */
export function applyGuidance(candidates: readonly string[], scores: Record<string, number>, g: Guidance, min: number): string[] {
  return candidates.filter((id) => {
    if (g.never.includes(id)) return false;
    if (g.always.includes(id)) return true;
    const bar = g.demoted.includes(id) ? Math.max(min, DEMOTED_MIN) : min;
    return (scores[id] ?? 1) >= bar;
  });
}

/** How one lesson did for one role and look: in the windows it was injected into, how often its error came back at the first try. */
export type LessonEffect = {
  role: string;
  look: string;
  lesson: string;
  /** Windows that got the lesson and ran a first self-check. */
  injected: number;
  /** Of those, how many still made the error at their first try. */
  recurred: number;
  /** Windows without the lesson that ran a first self-check, and how many made the error. */
  without: number;
  withoutErrors: number;
};

/** Every lesson's effect across the ledger's renders (the lessons report reads it). */
export function lessonEffects(ledger: Ledger): LessonEffect[] {
  const rules = loadLessonRules();
  const rows = new Map<string, LessonEffect>();
  const row = (role: string, look: string, lesson: string) => {
    const k = `${role}|${look}|${lesson}`;
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { role, look, lesson, injected: 0, recurred: 0, without: 0, withoutErrors: 0 }));
    return r;
  };
  // every lesson id ever seen or injected, per role and look
  const known = new Map<string, Set<string>>();
  for (const r of ledger.renders) for (const c of r.contexts) {
    const key = contextKey(c.role, c.look);
    if (!known.has(key)) known.set(key, new Set());
    for (const id of c.lessons ?? []) known.get(key)!.add(id);
    for (const e of c.firstTry ?? []) known.get(key)!.add(lessonIdOf(e, rules));
  }
  for (const r of ledger.renders) for (const c of r.contexts) {
    if (c.firstTry === null) continue;
    const made = new Set(c.firstTry.map((e) => lessonIdOf(e, rules)));
    for (const id of known.get(contextKey(c.role, c.look)) ?? []) {
      const x = row(c.role, c.look, id);
      if ((c.lessons ?? []).includes(id)) {
        x.injected++;
        if (made.has(id)) x.recurred++;
      } else {
        x.without++;
        if (made.has(id)) x.withoutErrors++;
      }
    }
  }
  return [...rows.values()];
}
