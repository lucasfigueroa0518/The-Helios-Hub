import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, type Ledger, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_LOOKS_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { draftLines, frameAssetIds, hasShotMap, isCharacterImage, plainText, shotSpans, spokenNumbers, wordsAt } from '@/lib/reel-ai-drama/writing/validate';

/**
 * C2, the integrity check (MD-39): each image shows what its line claims, every used asset has a source and
 * credit, and a picture implies nothing its line doesn't say (MD-137). Code checks the records, the figures a
 * frame writes and years a picture's words state; Haiku looks at the pictures, a few per call, each judged against the
 * shot on screen with it: the words spoken then, the labels up then, and the story's date there (iteration 10). Only a
 * clear "no" or a disqualifier is a problem; "unsure" passes (checks fail open; one fix, then warn).
 */

export type ImageData = { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' };

export type IntegrityDeps = Ledger & {
  create: SendMessage;
  /** The job dir that asset `file` paths are relative to. */
  jobDir: string;
  settings?: ReelAiDramaSettings;
  root?: string;
  /** Reads and downsizes one asset for the look; defaults to `readImageForLook`. */
  readImage?: (file: string) => Promise<ImageData>;
  /** Images per Haiku call. */
  batchSize?: number;
};

export type IntegrityProblem = { frame: number; asset_id: string; why: string };

const LOOK_EDGE = 768;

/** A JPEG no larger than LOOK_EDGE on its long side: plenty for "who and what is this", and cheap. */
export async function readImageForLook(file: string): Promise<ImageData> {
  const buf = await sharp(await readFile(file)).rotate().resize(LOOK_EDGE, LOOK_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { data: buf.toString('base64'), mediaType: 'image/jpeg' };
}

/** Record checks that need no model: the asset exists and carries a source and a credit. */
export function recordProblems(plan: DirectorPlan, inventory: VisualsInventory): IntegrityProblem[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const out: IntegrityProblem[] = [];
  for (const f of plan.frames) {
    for (const id of frameAssetIds(f)) {
      const a = byId.get(id);
      if (!a) out.push({ frame: f.n, asset_id: id, why: `${id} is not in the inventory.` });
      else if (!a.made && !a.credit?.trim()) out.push({ frame: f.n, asset_id: id, why: `${id} has no credit recorded.` });
      else if (!a.made && !a.url && !a.source_page) out.push({ frame: f.n, asset_id: id, why: `${id} has no source recorded.` });
    }
  }
  return out;
}

const figures = (s: string, loose = false) => spokenNumbers(s, { loose }).map((n) => n.value);

/** The words a frame's blueprint writes on screen: notes, labels, plates, the hook, and a treatment's own text. */
function writtenOnScreen(f: Pick<StoryboardFrame, 'blueprint'>): string {
  const b = f.blueprint;
  if (!b) return '';
  const strings = (o: unknown): string[] => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : []);
  return [
    b.hook?.text,
    ...(b.pieces ?? []).flatMap((p) => [p.note, p.label, ...strings(p.opts)]),
    ...(b.labels ?? []).flatMap((l) => [l.text, l.sub]),
    ...(b.speech ?? []).map((s) => s.text),
  ].filter((w): w is string => Boolean(w?.trim())).join(' . ');
}

/**
 * A figure on screen the words over it don't state (MD-137): next to its line, a number reads as what the line
 * is about. Each figure a frame writes on the scene (its blueprint's notes, labels and plates) must be in the frame's own words, and
 * each figure a beat shows must be in that beat's words or the frame's labels. Pure; a plan with no shot maps skips this.
 */
export function impliedFigureProblems(plan: DirectorPlan, draft: WriterDraft): IntegrityProblem[] {
  if (!hasShotMap(plan)) return [];
  const lines = new Map(draftLines(draft).map((l) => [l.id, l]));
  const lineText = new Map([...lines].map(([id, l]) => [id, l.text]));
  const out: IntegrityProblem[] = [];
  for (const f of plan.frames) {
    if (f.treatment === 'close') continue;
    const labels = [f.on_screen ?? '', ...f.line_ids.map((id) => lines.get(id)?.on_screen ?? '')].join(' . ');
    const stated = figures(`${f.line_ids.map((id) => lineText.get(id) ?? '').join(' . ')} . ${labels}`, true);
    for (const n of spokenNumbers(writtenOnScreen(f))) {
      if (!stated.includes(n.value)) out.push({ frame: f.n, asset_id: f.asset_ids[0] ?? '', why: `Frame ${f.n} writes "${n.raw}" on screen, and its lines don't state that figure: beside these words it reads as what they are about. Show what the line says, or move the figure to the line that states it.` });
    }
    const beats = Array.isArray(f.shots) ? shotSpans(f, lineText) : [];
    for (const span of beats) {
      if (!span) continue;
      const here = [...figures(span.words, true), ...figures(labels, true)];
      for (const n of spokenNumbers(span.shot.shows ?? '')) {
        if (!here.includes(n.value)) out.push({ frame: f.n, asset_id: span.shot.asset_ids?.[0] ?? f.asset_ids[0] ?? '', why: `Frame ${f.n}'s beat on "${span.shot.at}" shows "${n.raw}" over words that don't state it (${JSON.stringify(span.words)}): beside them it reads as what they are about. Show what those words say, or move the figure to the beat that states it.` });
      }
    }
  }
  return out;
}

/** The year words stating a date: "1987", "2014". */
const YEARS = /\b(?:19|20)\d\d\b/g;
const yearsIn = (s: string | null | undefined): number[] => (s ?? '').match(YEARS)?.map(Number) ?? [];

/** The story's date at a frame: its text as the viewer would read it, and the latest year it covers. */
export type StoryDate = { text: string; to: number };

/**
 * When each frame's story takes place, for checking a picture against it. A frame's date is what its own line says: a date
 * label, then a year spoken, then the fact timeline's dates for the facts the line cites. A frame that says none carries the
 * date before it. Null until the story states one. Pure.
 */
export function storyDates(plan: Pick<DirectorPlan, 'frames'>, draft: WriterDraft, facts?: Pick<FactSheet, 'timeline'> | null): Map<number, StoryDate | null> {
  const lines = new Map(draftLines(draft).map((l) => [l.id, l]));
  const out = new Map<number, StoryDate | null>();
  let last: StoryDate | null = null;
  for (const f of plan.frames) {
    if (f.treatment === 'close') continue;
    const held = f.line_ids.map((id) => lines.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
    const label = held.filter((l) => l.on_screen_kind === 'date' && yearsIn(l.on_screen).length).map((l) => l.on_screen!).join(', ');
    const spoken = held.flatMap((l) => yearsIn(l.text));
    const cited = new Set(held.flatMap((l) => l.fact_ids ?? []));
    const timeline = (facts?.timeline ?? []).filter((t) => t.fact_ids?.some((id) => cited.has(id)) && yearsIn(t.date).length);
    const here: StoryDate | null = label
      ? { text: label, to: Math.max(...yearsIn(label)) }
      : spoken.length ? { text: [...new Set(spoken)].join(', '), to: Math.max(...spoken) }
      : timeline.length ? { text: [...new Set(timeline.map((t) => t.date))].join(', '), to: Math.max(...timeline.flatMap((t) => yearsIn(t.date))) }
      : null;
    if (here) last = here;
    out.set(f.n, last);
  }
  return out;
}

/** The words a picture was recorded showing: the measured words where they exist, else what `shows` quotes. */
function visibleWords(a: Asset): string {
  const measured = (a.regions as { words?: { text?: string }[] } | undefined)?.words;
  if (Array.isArray(measured) && measured.length) return measured.map((w) => w.text ?? '').join(' ');
  return [...(a.shows ?? '').matchAll(/"([^"]+)"|“([^”]+)”|'([^']{3,})'|‘([^’]+)’/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').join(' . ');
}

/**
 * A picture's visible words against the story's date: a later year on a page or sign in a scene set earlier reads as a mistake, unless the
 * frame's own words reach that year. Names that came later (a company's later name) need eyes, so the look gets the story's date. Pure.
 */
export function visibleDateProblems(plan: DirectorPlan, inventory: VisualsInventory, draft: WriterDraft, facts?: Pick<FactSheet, 'timeline'> | null): IntegrityProblem[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const lineText = new Map(draftLines(draft).map((l) => [l.id, l.text]));
  const dates = storyDates(plan, draft, facts);
  const out: IntegrityProblem[] = [];
  for (const f of plan.frames) {
    const date = dates.get(f.n);
    if (!date || f.treatment === 'close') continue;
    const said = yearsIn(f.line_ids.map((id) => lineText.get(id) ?? '').join(' '));
    for (const id of frameAssetIds(f)) {
      const a = byId.get(id);
      if (!a) continue;
      const later = yearsIn(visibleWords(a)).filter((y) => y > date.to && !said.includes(y));
      if (later.length) out.push({ frame: f.n, asset_id: id, why: `${id}'s visible words say ${later[0]}, and frame ${f.n}'s story is set in ${date.text}: a viewer reads it as a mistake. Use a picture whose words fit that date, or crop to a part with none.` });
    }
  }
  return out;
}

/** Where a label lands in the frame's words: on its own words if the voice says them, else where its line starts. */
function labelWord(label: string, lineStart: number, voice: string): number {
  const at = wordsAt(label, voice, lineStart);
  if (at >= 0) return at;
  // A label often names the words with more around them: "Larry Page, Google CEO" lands on "Larry Page".
  const head = label.split(/[,:(–—-]/)[0]?.trim() ?? '';
  const part = head ? wordsAt(head, voice, lineStart) : -1;
  return part >= 0 ? part : lineStart;
}

/**
 * Who a label is about: the first thing it names that a picture in this frame shows. A label naming a person belongs to
 * that person's pictures, whoever else stands beside them when it lands. Null when it names no one here.
 */
function labelOwners(label: string, ids: readonly string[], byId: ReadonlyMap<string, Asset>): string[] | null {
  const said = plainText(label).toLowerCase();
  let first: { at: number; ids: string[] } | null = null;
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    for (const person of a.people ?? []) {
      const words = plainText(person).toLowerCase().split(/\s+/).filter(Boolean);
      const at = Math.min(...[words.join(' '), words.at(-1) ?? ''].map((w) => { const i = w ? said.indexOf(w) : -1; return i < 0 ? Infinity : i; }));
      if (at === Infinity) continue;
      if (!first || at < first.at) first = { at, ids: [id] };
      else if (at === first.at && !first.ids.includes(id)) first.ids.push(id);
    }
  }
  return first?.ids ?? null;
}

/** One picture's moments in its frame: the words spoken while it's on screen, what the shot says, and the labels up with it. */
export type ShotMoment = { words: string | null; shot: string | null; labels: string[] };

/**
 * The frame's shot map, picture by picture, so each is judged against the shot on screen with it and not the frame's first picture.
 * A beat lists what it shows; a blueprint piece holds from its words until its end. A label goes with its owner when it names one here,
 * else with what is on screen when it lands. A frame with neither beats nor a blueprint has no map, so every word plays over every picture. Pure.
 */
export function frameShotMap(f: StoryboardFrame, draft: WriterDraft, inventory: VisualsInventory): Map<string, ShotMoment> {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const lines = new Map(draftLines(draft).map((l) => [l.id, l]));
  const lineText = new Map([...lines].map(([id, l]) => [id, l.text]));
  const ids = frameAssetIds(f);
  const voice = f.line_ids.map((id) => lineText.get(id) ?? '').join(' ');
  const voiceWords = voice.split(/[\s—–]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const beats = Array.isArray(f.shots) ? shotSpans(f, lineText) : [];
  const spans = new Map<string, { start: number; end: number; shot: string | null }[]>();
  const add = (id: string, start: number, end: number, shot: string | null) => spans.set(id, [...(spans.get(id) ?? []), { start, end, shot }]);
  for (const b of beats) if (b) for (const id of b.shot.asset_ids ?? []) add(id, b.start, b.end, b.shot.shows || null);
  for (const p of f.blueprint?.pieces ?? []) {
    if (!p?.asset || spans.has(p.asset)) continue;
    const start = wordsAt(p.on ?? '', voice);
    if (start < 0) continue;
    const until = p.until ? wordsAt(p.until, voice, start + 1) : -1;
    add(p.asset, start, until >= 0 ? until : voiceWords.length, null);
  }
  const mapped = spans.size > 0;

  const placed: { text: string; word: number; owners: string[] | null }[] = [];
  const place = (label: string | null | undefined, word: number, forId?: string | null) => {
    if (!label?.trim()) return;
    placed.push({ text: label.trim(), word, owners: forId ? [forId] : labelOwners(label, ids, byId) });
  };
  let start = 0;
  for (const id of f.line_ids) {
    if (!f.drop_labels?.includes(id)) place(lines.get(id)?.on_screen, labelWord(lines.get(id)?.on_screen ?? '', start, voice));
    start += (lineText.get(id) ?? '').split(/[\s—–]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  if (f.on_screen?.trim() && !placed.some((l) => l.text === f.on_screen!.trim())) placed.push({ text: f.on_screen.trim(), word: 0, owners: null });
  const pieceAsset = new Map((f.blueprint?.pieces ?? []).filter((p) => p?.asset).map((p) => [p.id, p.asset!]));
  for (const l of f.blueprint?.labels ?? []) if (l?.text) place(l.text, Math.max(0, wordsAt(l.on ?? '', voice)), l.for ? pieceAsset.get(l.for) ?? null : null);
  for (const p of f.blueprint?.pieces ?? []) if (p?.asset && p.label) place(p.label, Math.max(0, wordsAt(p.on ?? '', voice)), p.asset);

  const out = new Map<string, ShotMoment>();
  for (const id of ids) {
    const mine = spans.get(id) ?? [];
    const labels = placed.filter((l) => {
      if (l.owners) return l.owners.includes(id);
      return !mapped || mine.some((s) => l.word >= s.start && l.word < Math.max(s.end, s.start + 1));
    }).map((l) => l.text);
    out.set(id, {
      words: mine.length ? mine.map((s) => voiceWords.slice(s.start, s.end).join(' ')).join(' … ') : null,
      shot: [...new Set(mine.map((s) => s.shot).filter((s): s is string => Boolean(s)))].join('; ') || null,
      labels: [...new Set(labels)],
    });
  }
  return out;
}

/**
 * `otherUses`: the image's other frames and their purposes, when it is not a person's character image (MD-41, MD-46).
 * `stagedAs`: who the frame's `shows` says this image stands for, so a second person staged on purpose (a
 * table, a pair) is judged as that person and not as the person the line names.
 * `beat`: the words spoken while this image plays, when the frame's shot map places it (MD-137).
 * `shot`: what the shot map says is on screen with it. `onScreen`: only the words up with this picture.
 * `storyDate`: when the story is at this frame, to read the picture's visible words against.
 */
type LookItem = { frame: number; asset: Asset; claim: string; beat: string | null; shot: string | null; onScreen: string; storyDate: string | null; purpose: string; otherUses: { frame: number; purpose: string }[]; stagedAs: string[] };

/**
 * One item per (frame, asset): the same image is judged against each line it plays under. An image other
 * than a character image that appears in more than one frame carries its other uses, so the look can
 * judge whether each use stays true to the moment it records.
 */
export function lookItems(plan: DirectorPlan, inventory: VisualsInventory, draft: WriterDraft, facts?: Pick<FactSheet, 'timeline'> | null): LookItem[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const lines = new Map(draft.rungs.flatMap((r) => r.lines).map((l) => [l.id, l]));
  const dates = storyDates(plan, draft, facts);
  const items: LookItem[] = [];
  for (const f of plan.frames) {
    if (f.treatment === 'close') continue;
    const claim = f.line_ids.map((id) => lines.get(id)?.text ?? '').join(' ').trim();
    const map = frameShotMap(f, draft, inventory);
    for (const id of frameAssetIds(f)) {
      const asset = byId.get(id);
      if (!asset) continue;
      // A character image or a main character's anchor recurs as their presence: one job (MD-41, MD-60).
      const otherUses = isCharacterImage(asset) || asset.anchor_for ? [] : plan.frames.filter((g) => g.n !== f.n && frameAssetIds(g).includes(id)).map((g) => ({ frame: g.n, purpose: g.purpose }));
      const stagedAs = (f.shows ?? []).filter((s) => s.asset_id === id).map((s) => s.person);
      const moment = map.get(id);
      items.push({ frame: f.n, asset, claim, beat: moment?.words ?? null, shot: moment?.shot ?? null, onScreen: (moment?.labels ?? []).join(' / '), storyDate: dates.get(f.n)?.text ?? null, purpose: f.purpose, otherUses, stagedAs });
    }
  }
  return items;
}

/** What the look reads about one item, beside its image. Pure, so a test can read it. */
export function lookText(item: LookItem, i: number): string {
  return `Image ${i + 1}. Narration ${item.beat ? `spoken while it plays: "${item.beat}". The frame's whole narration` : 'over it'}: "${item.claim}"${item.shot ? `. The shot on screen with it: "${item.shot}"` : ''}${item.onScreen ? `. On screen with this picture: "${item.onScreen}"` : ''}${item.storyDate ? `. The story's date here: ${item.storyDate}` : ''}. Recorded as showing: "${item.asset.shows}"${item.asset.date_taken ? ` (dated ${item.asset.date_taken}, ${item.asset.date_confidence})` : ''}${item.asset.made ? `; a made visual (${item.asset.made_kind ?? 'drawing, map, screenshot or graphic'})` : ''}${item.asset.anchor_for ? `; the anchor image of ${item.asset.anchor_for}` : ''}.${item.stagedAs.length ? ` In this frame it stands for ${item.stagedAs.join(' and ')}, shown beside the line, not necessarily the person the line names.` : ''}${item.otherUses.length ? ` Its job here: "${item.purpose}". The same image is also used in ${item.otherUses.map((u) => `frame ${u.frame} ("${u.purpose}")`).join(', ')}.` : ''}`;
}

type Look = { image: number; sees: string; matches: 'yes' | 'no' | 'unsure'; disqualified: boolean; why: string };

function parseLooks(count: number) {
  return (raw: unknown) => {
    const looks = (raw as { looks?: Look[] })?.looks;
    if (!Array.isArray(looks)) return { value: null, problems: ['looks is missing'] };
    const seen = new Set(looks.map((l) => l.image));
    const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n));
    return { value: looks, problems: missing.length ? [`no look for image ${missing.join(', ')}`] : [] };
  };
}

export async function checkIntegrity(
  deps: IntegrityDeps,
  input: { plan: DirectorPlan; inventory: VisualsInventory; draft: WriterDraft; facts?: Pick<FactSheet, 'timeline'> | null },
): Promise<{ problems: IntegrityProblem[] }> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const read = deps.readImage ?? ((file: string) => readImageForLook(path.join(deps.jobDir, file)));
  const problems = [...recordProblems(input.plan, input.inventory), ...impliedFigureProblems(input.plan, input.draft), ...visibleDateProblems(input.plan, input.inventory, input.draft, input.facts)];
  const items = lookItems(input.plan, input.inventory, input.draft, input.facts);
  const size = Math.max(1, deps.batchSize ?? 8);
  const system = loadPrompt('integrity', deps.root);

  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const content: Anthropic.ContentBlockParam[] = [];
    for (const [i, item] of batch.entries()) {
      const img = await read(item.asset.file);
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      content.push({ type: 'text', text: lookText(item, i) });
    }
    const result = await runSubmit(deps.create, deps, {
      component: 'integrity_check',
      model: settings.vision_model,
      system,
      user: content,
      tool: SUBMIT_LOOKS_TOOL,
      maxTokens: 8_000,
      parse: parseLooks(batch.length),
    });
    for (const look of result.value) {
      const item = batch[look.image - 1];
      if (!item) continue;
      if (look.matches === 'no' || look.disqualified) {
        problems.push({ frame: item.frame, asset_id: item.asset.id, why: look.why?.trim() || `${item.asset.id} doesn't show what its line claims (it shows: ${look.sees}).` });
      }
    }
  }
  return { problems };
}
