import fs from 'node:fs';
import path from 'node:path';

import { parseFrames } from '@/explainers/reel-ai-drama/kit/frames.mjs';
import { wordsAt, withTouches } from '@/explainers/reel-ai-drama/kit/components/compiled.js';
import { cueAt } from '@/explainers/reel-ai-drama/kit/components/moves.js';
import { blueprintTreatment, planFrames } from '@/explainers/reel-ai-drama/kit/project-files.mjs';
import { EVENT_KINDS, IMPLIES_EVENT, MAX_AMBIENCE, MAX_DUR } from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { sourceProblems } from '@/explainers/reel-ai-drama/kit/try.mjs';
import { hookScore, planHook } from '@/explainers/reel-ai-drama/kit/hooks/plan.js';
import { findTesseract, readWordsHard, tesseractWords } from '@/lib/reel-ai-drama/harvest/boxes';
import { hookOptions, resolveHook } from '@/lib/reel-ai-drama/hooks/eligibility';
import { HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import type { Manifest } from '@/lib/reel-ai-drama/render/plan-carried';
import { jsonOut, spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { blueprintAssets, type Blueprint, type CustomPiece, type DirectorPlan, type HookChoice, type SourceRef, type StoryboardFrame, type Touch, type Touches, type VisualsInventory } from '@/lib/reel-ai-drama/types';

/**
 * Compile, don't retype (ITERATION-10-CONTRACT §5). Every story frame becomes one logic-free module that hands its blueprint
 * and accepted touches to `compiledFrame` (kit/components/compiled.js) and on to `nk.stage`, so a planned mark or move can't be
 * lost in the typing. No model, no network. Nothing here throws for one frame: a frame that can't compile becomes a plain one
 * and a problem line, and the reel ships.
 */

export const TOUCHES_FILE = path.join('assets', 'touches.json');
export const MAX_TOUCHES = 3;
export const MAX_CUSTOM = 2;
export const NO_TOUCHES: Touches = { touches: [], custom: [] };

const PLAIN_GROUNDS = new Set(['charcoal', 'kraft', 'whiteboard']);
const list = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
const one = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const plain = (v: unknown) => one(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type CompileInput = {
  plan: DirectorPlan;
  inventory?: VisualsInventory | null;
  projectDir: string;
  touches?: Touches | null;
  /** The story's sources: a hook swap to Front Page checks its headlines against them. */
  sources?: readonly SourceRef[] | null;
  /** A new layout for a frame: its recompile after breakage or a missed plan item. */
  seeds?: Record<number, number>;
  /** Frames that shipped broken twice: their first picture, held. */
  plain?: readonly number[];
  /** Write only these frames' files (the names introduced in earlier frames still come from all of them). */
  only?: readonly number[];
  /** Local OCR for a picture a blueprint marks words on. Default: Tesseract when installed. */
  readWords?: ((file: string) => Promise<{ text: string; left: number; top: number; width: number; height: number; conf: number }[]>) | null;
};

export type CompileResult = { frames: { n: number; id: string; treatment: string; plain: boolean }[]; problems: string[] };

/** A blueprint with every list present, or null when it holds nothing to show. Pure. */
export function normalBlueprint(b: Partial<Blueprint> | null | undefined): Blueprint | null {
  if (!b || !list(b.pieces).length) return null;
  return {
    ...b,
    ground: b.ground ?? (b.style === 'paper' ? 'kraft' : 'charcoal'),
    style: b.style ?? 'cutouts',
    arrangement: b.arrangement ?? 'solo',
    pieces: list(b.pieces),
    labels: list(b.labels),
    speech: list(b.speech),
    marks: list(b.marks),
    arrows: list(b.arrows),
    camera: { move: b.camera?.move ?? 'hold', stops: list(b.camera?.stops) },
    sounds: list(b.sounds),
  };
}

/** What a frame with no usable blueprint shows: its first picture, held. Pure. */
export function plainBlueprint(frame: Pick<StoryboardFrame, 'asset_ids'>): Blueprint {
  const asset = frame.asset_ids?.[0];
  return { ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: asset ? [{ id: 'p1', asset, on: '' }] : [], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'hold', stops: [] }, sounds: [] };
}

/** The frame's own words reach the screen whatever the plan's fields say: words the blueprint doesn't already carry become a label. The opening has no title. Pure. */
export function withOnScreen(blueprint: Blueprint, frame: Pick<StoryboardFrame, 'on_screen' | 'n'>): Blueprint {
  const words = one(frame.on_screen);
  if (!words) return blueprint;
  const said = [blueprint.hook?.text, ...blueprint.labels.map((l) => l.text), ...blueprint.pieces.flatMap((p) => [p.label, p.note])];
  if (said.some((s) => plain(s) === plain(words))) return blueprint;
  if (frame.n === 1) return blueprint;
  return { ...blueprint, labels: [...blueprint.labels, { text: words, on: '' }] };
}

/** Every name a blueprint introduces, for "only a first appearance gets a name" in the frames after it. Pure. */
export function namesIn(blueprint: Blueprint | null): string[] {
  if (!blueprint) return [];
  return [...blueprint.pieces.flatMap((p) => (p.label ? [p.label] : [])), ...blueprint.labels.filter((l) => l.for).map((l) => l.text)];
}

// ── Custom pieces and touches ───────────────────────────────────────────────────────────────────────

/** What a custom piece may not reach for. It gets `el` and may make what it draws with `el.ownerDocument.createElement`. */
const CUSTOM_BANNED: [RegExp, string][] = [
  [/visibility\s*[:=]\s*['"]?visible/, "sets visibility to 'visible', which shows through the hidden clip of a frame that isn't playing"],
  // A bare global, never a property (`style.top`), an object key (`{ top: 0 }`) or a local of a common name: only their reach outward counts.
  [/(?<![.\w$])(?:document|window|globalThis|localStorage|sessionStorage|navigator)\b(?!\s*:)/, 'reaches outside its box'],
  [/(?<![.\w$])(?:self|top|parent)\s*\.\s*(?:document|window|location|frames|postMessage|parent|top)\b/, 'reaches outside its box'],
  [/(?<![.\w$])location\s*\.\s*(?:href|assign|replace|reload)\b|(?<![.\w$])history\s*\.\s*(?:pushState|replaceState|back|forward|go)\b/, 'reaches outside its box'],
  [/(?<![.\w$])(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\b(?!\s*:)|\bnew\s+(?:Worker|Image|Audio)\b/, 'uses the network'],
  [/(?<![.\w$])eval\s*\(|\bnew\s+Function\b|(?<![.\w$])Function\s*\(/, 'runs code from text'],
  [/(?<![.\w$])Date\b(?!\s*:)|(?<![.\w$])crypto\b(?!\s*:)/, 'reads the clock or randomness'],
  [/\.(?:parentNode|parentElement|closest|getRootNode|previousSibling|nextSibling|previousElementSibling|nextElementSibling|offsetParent)\b/, 'reaches outside its box'],
  [/ownerDocument\s*\.\s*(?!createElement(?:NS)?\b|createTextNode\b)/, 'reaches outside its box'],
];

/** Problems in a custom piece's code; empty means it may run. Pure. */
export function customProblems(code: string): string[] {
  const out = sourceProblems(code).filter((p) => !/treatment, build/.test(p));
  if (/\bfrom\s+['"]\.\.\/custom\//.test(code)) out.push('imports another custom piece');
  if (!/export\s+default\b/.test(code)) out.push('has no default export { build(el, ctx), render(t) }');
  if (!/\bbuild\b/.test(code) || !/\brender\b/.test(code)) out.push('needs both build(el, ctx) and render(t)');
  // Words in a comment or a string are the frame's text ("the document", "Date"), not reach; the visibility rule reads the strings.
  const bare = code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "''");
  for (const [re, why] of CUSTOM_BANNED) if (re.test(re.source.startsWith('visibility') ? code : bare) && !out.includes(why)) out.push(why);
  return out;
}

const TOUCH_KEYS: Record<Touch['type'], string[]> = {
  extra_line: ['text', 'for', 'on'],
  in_turn: ['piece_ids', 'from', 'to'],
  closer_cuts: ['aim', 'on'],
  mark: ['kind', 'on_piece', 'target', 'on'],
  ground_tone: ['on', 'to'],
  sound: ['kind', 'what', 'on', 'dur'],
};

/** What's wrong with one touch on this plan, or null. Touches only add: they can't name a position, a size or a removal. Pure. */
function touchProblem(t: Touch, frame: StoryboardFrame | undefined): string | null {
  if (!frame || !frame.blueprint || frame.treatment === 'close') return `frame ${t.frame} can't take a touch`;
  const keys = TOUCH_KEYS[t.type];
  if (!keys) return `no touch type "${(t as { type?: unknown }).type}"`;
  const extra = Object.keys(t).filter((k) => !['id', 'frame', 'why', 'type', ...keys].includes(k) && (t as Record<string, unknown>)[k] != null);
  if (extra.length) return `a touch can only add; it can't set ${extra.join(', ')}`;
  const ids = new Set(list(frame.blueprint.pieces).map((p) => p.id));
  if (t.type === 'extra_line' && !one(t.text)) return 'an extra line needs words';
  if (t.type === 'extra_line' && t.for && !ids.has(t.for)) return `no piece "${t.for}"`;
  if (t.type === 'in_turn' && (list(t.piece_ids).length < 2 || t.piece_ids.some((id) => !ids.has(id)))) return 'words in turn need two pieces of this frame';
  if (t.type === 'closer_cuts' && (!one(t.aim) || !list(t.on).length)) return 'closer cuts need an aim and the words they land on';
  if (t.type === 'mark' && (!ids.has(t.on_piece) || !one(t.kind))) return `no piece "${t.on_piece}" to mark`;
  if (t.type === 'ground_tone' && !(Number.isFinite(t.to) && t.to >= 0 && t.to <= 1)) return 'a ground tone runs from 0 to 1';
  if (t.type === 'sound' && (!one(t.what) || !one(t.kind))) return 'a sound needs a kind and what it is';
  return null;
}

/**
 * The limits, in code: at most MAX_TOUCHES touches and MAX_CUSTOM custom pieces a reel, at most one of either per frame, none
 * required. What's over or wrong is dropped with a reason. Pure.
 */
export function acceptTouches(proposed: Partial<Touches> | null | undefined, plan: DirectorPlan): { touches: Touches; rejected: { id: string; frame: number; why: string }[] } {
  const rejected: { id: string; frame: number; why: string }[] = [];
  const taken = new Set<number>();
  const byN = new Map(plan.frames.map((f) => [f.n, f]));
  const touches: Touch[] = [];
  const seen = new Set<string>();
  const fresh = (id: string, frame: number) => {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(String(id)) || seen.has(id)) {
      rejected.push({ id: String(id), frame, why: 'needs an id of its own' });
      return false;
    }
    seen.add(id);
    return true;
  };
  for (const t of list(proposed?.touches)) {
    if (!fresh(t?.id, t?.frame)) continue;
    const why = touchProblem(t, byN.get(t.frame)) ?? (touches.length >= MAX_TOUCHES ? `at most ${MAX_TOUCHES} touches a reel` : taken.has(t.frame) ? 'at most one touch or custom piece a frame' : null);
    if (why) { rejected.push({ id: t.id, frame: t.frame, why }); continue; }
    taken.add(t.frame);
    touches.push(t);
  }
  const custom: CustomPiece[] = [];
  for (const c of list(proposed?.custom)) {
    if (!fresh(c?.id, c?.frame)) continue;
    const f = byN.get(c.frame);
    const clash = list(f?.blueprint?.pieces).some((p) => p.id === c.id);
    const bad = customProblems(String(c.code ?? ''));
    const why = !f?.blueprint || f.treatment === 'close' ? `frame ${c.frame} can't take a custom piece`
      : clash ? `a planned piece is already called ${c.id}`
        : !(c.aspect > 0 && c.min_width > 0) ? 'a custom piece needs an aspect and a minimum width'
          : bad.length ? `its code ${bad.join('; ')}`
            : custom.length >= MAX_CUSTOM ? `at most ${MAX_CUSTOM} custom pieces a reel`
              : taken.has(c.frame) ? 'at most one touch or custom piece a frame' : null;
    if (why) { rejected.push({ id: c.id, frame: c.frame, why }); continue; }
    taken.add(c.frame);
    custom.push(c);
  }
  return { touches: { touches, custom, ...(proposed?.hook_swap ? { hook_swap: proposed.hook_swap } : {}) }, rejected };
}

/** The accepted touches, from assets/touches.json. */
export function readTouches(projectDir: string): Touches {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(projectDir, TOUCHES_FILE), 'utf8')) as Touches;
    return { touches: list(t.touches), custom: list(t.custom), ...(t.hook_swap ? { hook_swap: t.hook_swap } : {}) };
  } catch {
    return { ...NO_TOUCHES };
  }
}

// ── The files ───────────────────────────────────────────────────────────────────────────────────────

type TimingFile = { duration?: number; words?: { text: string; start: number; end: number }[]; lines?: { start?: number }[] };

function timingOf(projectDir: string, id: string): TimingFile {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'timing', `${id}.json`), 'utf8')) as TimingFile;
  } catch {
    return {};
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The frame's sounds on their words, in the format kit/sound.mjs reads. Arrivals keep the stage's own kit cues (measure.mjs
 * merges them), so only what the plan and touches name is here. `reports`: the words that couldn't be found. Pure.
 */
export function eventsFor(blueprint: Blueprint, touches: readonly Touch[], timing: TimingFile, duration: number, assetIds: readonly string[], report: (r: string) => void = () => {}): Record<string, unknown>[] {
  const at = wordsAt({ words: timing.words ?? [], lines: timing.lines ?? [], cueAt, report });
  const sounds = [...blueprint.sounds, ...touches.flatMap((t) => (t.type === 'sound' ? [{ kind: t.kind, what: t.what, on: t.on, dur: t.dur }] : []))];
  const kinds = (EVENT_KINDS as string[]).filter((k) => k !== 'file');
  const out = sounds.flatMap((s) => {
    const t = round(Math.max(0, Math.min(duration, at(s.on, `sound "${one(s.what)}"`))));
    // A decorative kind is the action's own foley (try.mjs bans whoosh and sting); an unknown one too.
    const kind = kinds.includes(s.kind) && !['whoosh', 'sting'].includes(s.kind) ? s.kind : 'foley';
    const what = one(s.what) || one(s.kind);
    const e: Record<string, unknown> = { t, kind };
    if (kind === 'foley' || kind === 'ambience') e.what = what;
    if (kind === 'ambience') e.dur = round(Math.max(0.5, Math.min(MAX_AMBIENCE, s.dur ?? Math.max(0.5, duration - t))));
    else if (kind === 'foley' && Number.isFinite(s.dur)) e.dur = round(Math.max(0.2, Math.min(MAX_DUR, s.dur!)));
    if (IMPLIES_EVENT.test(what)) {
      if (assetIds[0]) e.shown = assetIds[0];
      else { report(`sound "${what}" implies an event no picture shows; dropped`); return []; }
    }
    return [e];
  });
  return out.sort((a, b) => Number(a.t) - Number(b.t));
}

/** A frame's module: its data and one call, nothing else. A web address in the data can't read as a network call to try.mjs. */
export function frameModule(spec: Record<string, unknown>, custom: readonly CustomPiece[] = []): string {
  const data = JSON.stringify(spec, null, 1).replace(/https?:\/\//g, (m) => m.replace(/\//g, '\\/'));
  const imports = custom.map((c, i) => `import custom${i} from '../custom/${c.id}.js';`);
  const modules = custom.length ? `, { ${custom.map((c, i) => `'${c.id}.js': custom${i}`).join(', ')} }` : '';
  return [
    '// Compiled from the director\'s plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.',
    "import { compiledFrame } from '../kit/components/compiled.js';",
    ...imports,
    `export default compiledFrame(${data}${modules});`,
    '',
  ].join('\n');
}

/** A hook frame's module: the hook and the frame's own spec behind it, nothing else. */
export function hookModule(spec: { treatment: string; hook: HookChoice; years: Record<string, number>; frame: Record<string, unknown> }): string {
  const data = JSON.stringify(spec, null, 1).replace(/https?:\/\//g, (m) => m.replace(/\//g, '\\/'));
  return [
    '// Compiled from the director\'s plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.',
    "import { compiledHook } from '../kit/hooks/index.js';",
    `export default compiledHook(${data});`,
    '',
  ].join('\n');
}

/**
 * The hook frame 1 renders as: the plan's, or the problem solver's swap when it's among the hooks that qualify. A swap that
 * doesn't qualify leaves the plan's hook standing, with a problem line. Nothing here invents a hook for a plan without one.
 */
export function chosenHook(plan: DirectorPlan, touches: Touches | null | undefined, ctx: { inventory: VisualsInventory | null; sources: readonly SourceRef[]; words: string }, problem: (p: string) => void): HookChoice | null {
  const swap = touches?.hook_swap ?? null;
  const planned = plan.hook ?? null;
  if (!swap || !ctx.inventory) return planned;
  const sources = [...ctx.sources];
  const options = hookOptions(ctx.inventory, sources);
  if (!options.some((o) => o.id === swap.id)) {
    problem(`the hook swap to ${swap.id} doesn't have the assets it needs, so ${planned?.id ?? 'the frame'} stands`);
    return planned;
  }
  return resolveHook(swap, options, { inventory: ctx.inventory, sources, words: ctx.words });
}

/** A word as OCR might give it: AI and Al, O and 0 read as one. */
const wordKey = (w: unknown) => String(w ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/[il1|]/g, 'l').replace(/0/g, 'o');
/** The phrases a blueprint marks or aims at, by the picture they must be on (or null: any on the frame). */
function markedPhrases(b: Blueprint, touches: readonly Touch[]): { asset: string | null; phrase: string }[] {
  const text = (v: unknown) => /^text\s*:\s*(.+)$/is.exec(String(v ?? ''))?.[1]?.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') ?? null;
  const assetOf = (id: string) => b.pieces.find((p) => p.id === id)?.asset ?? null;
  const { blueprint } = withTouches(b, touches as never);
  return [
    ...blueprint.marks.flatMap((m: { target?: string; on_piece: string }) => (text(m.target) ? [{ asset: assetOf(m.on_piece), phrase: text(m.target)! }] : [])),
    ...(list(blueprint.camera?.stops) as { aim: string }[]).flatMap((s) => (text(s.aim) ? [{ asset: null, phrase: text(s.aim)! }] : [])),
  ];
}

const yearIn = (v: unknown): number | null => {
  const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

type InventoryFile = { assets: { id: string; file?: string; width?: number; height?: number; boxes?: unknown[]; regions?: { words?: { text: string; box: { x: number; y: number; w: number; h: number } }[] } | null }[] };

/**
 * A mark can only land on words the picture was read for: the harvest reads only text-kind pictures, so a slide in a photo had
 * none. A picture a blueprint marks words on and that holds no words gets read here (local OCR, free), once. Fails open: the
 * mark then skips and the plan check says so.
 */
async function readMarkedWords(projectDir: string, frames: readonly { blueprint: Blueprint; touches: Touch[]; assets: string[] }[], readWords: CompileInput['readWords'], problems: string[]): Promise<void> {
  const file = path.join(projectDir, 'assets', 'inventory.json');
  let inv: InventoryFile;
  try {
    inv = JSON.parse(fs.readFileSync(file, 'utf8')) as InventoryFile;
  } catch {
    return;
  }
  const read = readWords === undefined ? (findTesseract() ? tesseractWords(findTesseract()!) : null) : readWords;
  const byId = new Map(inv.assets.map((a) => [a.id, a]));
  let changed = false;
  const tried = new Set<string>();
  for (const f of frames) {
    for (const { asset, phrase } of markedPhrases(f.blueprint, f.touches)) {
      const want = phrase.split(/\s+/).map(wordKey).filter(Boolean);
      const candidates = (asset ? [asset] : f.assets).map((id) => byId.get(id)).filter((a): a is InventoryFile['assets'][number] => Boolean(a));
      const saysIt = (words: readonly { text: unknown }[]) => {
        const said = words.map((w) => wordKey(w.text));
        return said.some((_, i) => want.every((x, k) => said[i + k] === x));
      };
      if (candidates.some((a) => saysIt(list(a.regions?.words)))) continue;
      for (const a of candidates) {
        if (tried.has(a.id) || !a.file) continue;
        tried.add(a.id);
        if (!read) { problems.push(`${a.id}: no local OCR to read the words "${phrase}" on it`); continue; }
        try {
          const abs = path.resolve(projectDir, a.file);
          const had = list(a.regions?.words);
          const words = await readWordsHard(abs, a.width ?? 0, a.height ?? 0, read, saysIt);
          if (!words.length || (!saysIt(words) && words.length <= had.length)) continue;
          a.regions = { ...(a.regions ?? {}), words };
          changed = true;
        } catch (e) {
          problems.push(`${a.id}: OCR failed (${e instanceof Error ? e.message.slice(0, 100) : String(e)})`);
        }
      }
    }
  }
  if (changed) fs.writeFileSync(file, `${JSON.stringify(inv, null, 1)}\n`);
}

/**
 * Write `assets/frames/<id>.js` and `<id>.events.json` for every frame but the close, and each custom piece to
 * `assets/custom/<id>.js`. `problems`: what degraded (a plain frame, an unusable touch); the reel still ships.
 */
export async function compileReel(input: CompileInput): Promise<CompileResult> {
  const { plan, projectDir } = input;
  const accepted = acceptTouches(input.touches ?? NO_TOUCHES, plan);
  const problems: string[] = accepted.rejected.map((r) => `frame ${r.frame}: touch ${r.id} dropped: ${r.why}`);
  const framesDir = path.join(projectDir, 'assets', 'frames');
  const customDir = path.join(projectDir, 'assets', 'custom');
  fs.mkdirSync(framesDir, { recursive: true });
  let storyboard: { number: number; id: string; duration: number }[] = [];
  try {
    storyboard = parseFrames(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'));
  } catch {
    storyboard = [];
  }
  const planned = planFrames(plan, null) as (StoryboardFrame & { id: string })[];
  const idOf = (n: number, fallback: string) => storyboard.find((s) => s.number === n)?.id || fallback;
  const only = input.only ? new Set(input.only) : null;
  const plainSet = new Set(input.plain ?? []);

  const prepared = planned.filter((f) => f.treatment !== 'close').map((f) => {
    let blueprint = normalBlueprint(f.blueprint);
    const degraded = !blueprint;
    if (!blueprint) blueprint = plainBlueprint(f);
    blueprint = withOnScreen(blueprint, f);
    const touches = accepted.touches.touches.filter((t) => t.frame === f.n);
    const custom = accepted.touches.custom.filter((c) => c.frame === f.n);
    return { f, id: idOf(f.n, f.id), blueprint, degraded, touches, custom, assets: [...new Set([...blueprintAssets(blueprint), ...(f.asset_ids ?? [])])] };
  });
  // Every frame, also on a partial compile: a re-plan rewrites inventory.json, and frames it didn't touch still read their marks from it.
  await readMarkedWords(projectDir, prepared, input.readWords, problems);

  // The opening hook replaces only what frame 1 renders: its blueprint stays, for integrity, variety and the fallback.
  const inventory: VisualsInventory | null = input.inventory ?? (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'inventory.json'), 'utf8')) as VisualsInventory;
    } catch {
      return null;
    }
  })();
  const openingId = prepared[0] ? prepared[0].id : '';
  const openingTiming = openingId ? timingOf(projectDir, openingId) : {};
  const hook = chosenHook(plan, input.touches, { inventory, sources: input.sources ?? [], words: (openingTiming.words ?? []).map((w) => w.text).join(' ') }, (p) => problems.push(`frame 1: ${p}`));

  const out: CompileResult['frames'] = [];
  const known: string[] = [];
  for (const p of prepared) {
    const { f, id, blueprint, touches, custom } = p;
    const treatment = String(blueprintTreatment({ ...f, blueprint }));
    const isPlain = p.degraded || plainSet.has(f.n);
    const asHook = hook && p === prepared[0] && !plainSet.has(f.n) ? hook : null;
    if (!only || only.has(f.n)) {
      try {
        if (p.degraded) problems.push(`frame ${f.n}: no blueprint to compile, so it shows its first picture, plain`);
        else if (plainSet.has(f.n)) problems.push(`frame ${f.n}: it would not build as planned, so it shows its first picture, plain`);
        const spec = { treatment, blueprint, known_names: [...new Set(known)], ...(touches.length ? { touches } : {}), ...(custom.length ? { custom: custom.map(({ code: _code, ...c }) => { void _code; return c; }) } : {}), ...(input.seeds?.[f.n] != null ? { seed: input.seeds[f.n] } : {}), ...(isPlain ? { plain: true } : {}) };
        for (const c of custom) {
          fs.mkdirSync(customDir, { recursive: true });
          fs.writeFileSync(path.join(customDir, `${c.id}.js`), c.code);
        }
        const timing = timingOf(projectDir, id);
        const duration = timing.duration ?? storyboard.find((s) => s.number === f.n)?.duration ?? 6;
        if (asHook) {
          const media = Object.fromEntries((inventory?.assets ?? []).map((a) => [a.id, a]));
          const years = Object.fromEntries((inventory?.assets ?? []).flatMap((a) => { const y = a.date_confidence === 'unknown' ? null : yearIn(a.date_taken); return y === null ? [] : [[a.id, y]]; }));
          const plan1 = planHook(asHook, { media, words: (timing.words ?? []) as never[], duration, cueAt, years });
          for (const r of plan1.reports as string[]) problems.push(`frame ${f.n}: ${r}`);
          fs.writeFileSync(path.join(framesDir, `${id}.js`), hookModule({ treatment, hook: asHook, years: Object.fromEntries(asHook.beats.flatMap((b) => (years[b.asset] != null ? [[b.asset, years[b.asset]]] : []))), frame: { treatment, blueprint, known_names: [] } }));
          fs.writeFileSync(path.join(framesDir, `${id}.events.json`), `${JSON.stringify(hookScore(plan1), null, 1)}\n`);
        } else {
          fs.writeFileSync(path.join(framesDir, `${id}.js`), frameModule(spec, custom));
          const events = eventsFor(blueprint, touches, timing, duration, p.assets, (r) => problems.push(`frame ${f.n}: ${r}`));
          fs.writeFileSync(path.join(framesDir, `${id}.events.json`), `${JSON.stringify(events, null, 1)}\n`);
        }
      } catch (e) {
        // The one thing that can't happen quietly: a frame with no module at all. It still gets a plain one.
        problems.push(`frame ${f.n}: compile failed (${e instanceof Error ? e.message.slice(0, 160) : String(e)}), so it shows its first picture, plain`);
        fs.writeFileSync(path.join(framesDir, `${id}.js`), frameModule({ treatment, blueprint: plainBlueprint(f), known_names: [], plain: true }));
        fs.writeFileSync(path.join(framesDir, `${id}.events.json`), '[]\n');
      }
    }
    out.push({ n: f.n, id, treatment, plain: isPlain });
    // A hook shows no labels: a name in frame 1's blueprint hasn't been introduced yet.
    if (!isPlain && !asHook) known.push(...namesIn(blueprint));
  }
  return { frames: out, problems };
}

// ── Reading the compiled frames back (the browser, free) ────────────────────────────────────────────

export type CompiledRead = { ok: boolean; frames: Record<string, CompiledFrameRecord>; stills: { number: number; name: string; id: string; at: number; file: string }[]; skipped?: string };
export type CompiledFrameRecord = {
  id: string;
  name?: string;
  duration?: number;
  manifest?: Manifest;
  reports?: string[];
  notes?: string[];
  skips?: string[];
  errors?: string[];
  failed?: string;
  plain?: boolean;
  cues?: Record<string, number>;
  names_held_back?: string[];
  in_turn?: string[];
  closer_cuts?: boolean;
};

/** Run kit/compiled-read.mjs in the project: each frame's manifest and what didn't land; with `stills`, a still at its main beat. */
export function readCompiled(projectDir: string, { stills = null, only = null, run = spawnRunner }: { stills?: string | null; only?: readonly string[] | null; run?: Runner } = {}): CompiledRead {
  const args = ['assets/kit/compiled-read.mjs', ...(stills ? ['--stills', stills] : []), ...(only ?? [])];
  const res = run(process.execPath, args, { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs: 10 * 60 * 1000 });
  return jsonOut<CompiledRead>(res) ?? { ok: false, frames: {}, stills: [], skipped: tail(res) };
}

/** What the kit's measured checks say about one frame (try, bounds, screen), for the touch removal rule. */
export function frameFindings(projectDir: string, frameId: string, { run = spawnRunner }: { run?: Runner } = {}): string[] {
  const out: string[] = [];
  for (const script of ['try', 'bounds', 'screen']) {
    const res = run(process.execPath, [`assets/kit/${script}.mjs`, frameId], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs: 5 * 60 * 1000 });
    const parsed = jsonOut<{ errors?: string[] }>(res);
    if (parsed) out.push(...(parsed.errors ?? []).map((e) => `${script}: ${e}`));
    else if (res.status !== 0) out.push(`${script} failed: ${tail(res)}`);
  }
  return out;
}
