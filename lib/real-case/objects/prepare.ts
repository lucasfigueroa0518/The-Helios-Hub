import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCutouts } from '@/lib/real-case/bank';
import { bankObject, findBanked, slugOf, type BankedObject, type ObjectKind } from '@/lib/real-case/objects/bank';
import { removeBackground, type CutoutResult } from '@/lib/real-case/objects/cutout';
import { generateDrawingImage, objectPrompt, personPrompt, photoPrompt, type GenerateImage } from '@/lib/real-case/objects/drawing';
import { PICK_MODEL, pickCandidate, type CreateMessage } from '@/lib/real-case/objects/pick';
import { download, stockCandidates, type StockSearch } from '@/lib/real-case/objects/stock';
import { traceDrawing, type Strokes } from '@/lib/real-case/objects/trace';
import { priceCall } from '@/lib/stories/cost';
import { frameGround, parseFrames } from '../../../explainers/real-case/kit/frames.mjs';

/**
 * Object prep for one render, after session A (RC-41, RC-48). From the plan's `## Case file` objects and
 * the grounds of the frames they appear in: a board or newspaper object needs a photo cutout, a
 * whiteboard object a marker drawing; a public figure on the whiteboard needs an approved sketch made
 * from their banked cutout. Each comes from the object bank on an exact match, else is found (stock →
 * cutout → vision pick) or drawn (gpt-image → traced), then banked. Results land in the job as
 * assets/objects/<kind>/<slug>.png (+ .strokes.json) with assets/objects/credits.json. Anything that
 * fails is a flag and the frame does without it, never a wrong object.
 */

export type Scene = 'board' | 'newspaper' | 'whiteboard';
export type ObjectNeed = { name: string; slug: string; kinds: Exclude<ObjectKind, 'person-sketch'>[] };

/** `- name — acts 1, 3, 5` lines under `- objects:` in the plan's `## Case file`. */
export function caseFileObjects(storyboard: string): { name: string; acts: number[] }[] {
  const section = /^## Case file\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(storyboard)?.[1] ?? '';
  const block = /^- objects:\s*$([\s\S]*?)(?=^- \S|(?![\s\S]))/m.exec(section)?.[1] ?? '';
  return [...block.matchAll(/^\s+-\s+(.+?)\s+—\s+acts?\s+([\d,\s]+)$/gm)].map((m) => ({
    name: m[1]!.trim(),
    acts: m[2]!.split(',').map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0),
  }));
}

/** Players the case file shows as a cutout, with their acts (`- name — kind — shown as: cutout — acts 2, 5`). */
export function caseFileCutoutPlayers(storyboard: string): { name: string; acts: number[] }[] {
  const section = /^## Case file\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(storyboard)?.[1] ?? '';
  const block = /^- players:\s*$([\s\S]*?)(?=^- \S|(?![\s\S]))/m.exec(section)?.[1] ?? '';
  return [...block.matchAll(/^\s+-\s+(.+?)\s+—.*?shown as:?\s*cutout\b.*?—\s+acts?\s+([\d,\s]+)$/gm)].map((m) => ({
    name: m[1]!.trim(),
    acts: m[2]!.split(',').map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0),
  }));
}

/** Which kinds each object needs, from the grounds of its acts' frames (frame n is act n). */
export function objectNeeds(objects: { name: string; acts: number[] }[], groundOf: (frame: number) => Scene | null): ObjectNeed[] {
  return objects.flatMap((o) => {
    const grounds = new Set(o.acts.map(groundOf).filter((g): g is Scene => Boolean(g)));
    const kinds: ObjectNeed['kinds'] = [];
    if (grounds.has('board') || grounds.has('newspaper')) kinds.push('cutout');
    if (grounds.has('whiteboard')) kinds.push('drawing');
    return kinds.length ? [{ name: o.name, slug: slugOf(o.name), kinds }] : [];
  });
}

export type PrepDeps = {
  /** Repo root (the bank lives under it). */
  root?: string;
  create?: CreateMessage | null;
  generate?: GenerateImage;
  search?: StockSearch;
  http?: typeof fetch;
  removeBg?: (src: string, out: string) => Promise<CutoutResult>;
  trace?: (src: string) => Promise<Strokes>;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type Credit = { what: string; kind: ObjectKind; file: string; credit: string; license: string; source: string };
export type PrepResult = { placed: Credit[]; flags: string[]; usd: { vision: number; drawing: number } };

export async function prepareObjects(projectDir: string, needs: ObjectNeed[], people: { name: string; cutout: string }[], deps: PrepDeps = {}): Promise<PrepResult> {
  const root = deps.root ?? process.cwd();
  const log = deps.log ?? (() => {});
  const out: PrepResult = { placed: [], flags: [], usd: { vision: 0, drawing: 0 } };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-objects-'));
  const place = (b: BankedObject) => {
    const dir = path.join(projectDir, 'assets', 'objects', b.kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(root, b.file), path.join(dir, `${b.slug}.png`));
    if (b.strokes) fs.copyFileSync(path.join(root, b.strokes), path.join(dir, `${b.slug}.strokes.json`));
    out.placed.push({ what: b.name, kind: b.kind, file: `assets/objects/${b.kind}/${b.slug}.png`, credit: b.credit, license: b.license, source: b.source });
  };

  const drawIt = async (name: string, slug: string, kind: 'drawing' | 'person-sketch', reference?: string): Promise<BankedObject | null> => {
    const gen = deps.generate ?? generateDrawingImage;
    const { png, usage } = await gen({ prompt: kind === 'drawing' ? objectPrompt(name) : personPrompt(), reference });
    out.usd.drawing += usage.usd;
    const pngFile = path.join(work, `${kind}-${slug}.png`);
    fs.writeFileSync(pngFile, png);
    const strokes = await (deps.trace ?? traceDrawing)(pngFile);
    if (strokes.strokes.length < 3) throw new Error(`the drawing traced to ${strokes.strokes.length} strokes`);
    const strokesFile = path.join(work, `${kind}-${slug}.strokes.json`);
    fs.writeFileSync(strokesFile, `${JSON.stringify(strokes)}\n`);
    return bankObject(
      { slug, kind, name, width: strokes.width, height: strokes.height, credit: 'Drawn for Helios', license: 'generated', source: 'gpt-image-2', approved: kind === 'drawing' },
      { png: pngFile, strokes: strokesFile },
      root,
    );
  };

  const findCutout = async (name: string, slug: string, create: CreateMessage): Promise<BankedObject | null> => {
    const found = await stockCandidates(name, deps.search);
    const ok: { png: Buffer; file: string; c: (typeof found)[number]; w: number; h: number }[] = [];
    for (const [i, c] of found.entries()) {
      const bytes = await download(c.url, deps.http);
      if (!bytes) continue;
      const src = path.join(work, `${slug}-${i}.src`);
      const file = path.join(work, `${slug}-${i}.png`);
      fs.writeFileSync(src, bytes);
      const r = await (deps.removeBg ?? removeBackground)(src, file);
      if (r.ok) ok.push({ png: fs.readFileSync(file), file, c, w: r.width, h: r.height });
    }
    if (!ok.length) throw new Error(`no usable cutout among ${found.length} stock photos`);
    const { index, message } = await pickCandidate(name, ok.map((o) => o.png), create);
    if (message) out.usd.vision += priceCall(PICK_MODEL, message.usage).usd;
    if (index == null) throw new Error(`the vision check found no clean, whole ${name} among ${ok.length} cutouts`);
    const pick = ok[index]!;
    return bankObject({ slug, kind: 'cutout', name, width: pick.w, height: pick.h, credit: pick.c.credit, license: pick.c.license, source: pick.c.landing, approved: true }, { png: pick.file }, root);
  };

  /** No clean stock photo: a generated studio photo of the object, background removed, banked once. */
  const photoCutout = async (name: string, slug: string): Promise<BankedObject | null> => {
    const { png, usage } = await (deps.generate ?? generateDrawingImage)({ prompt: photoPrompt(name) });
    out.usd.drawing += usage.usd;
    const src = path.join(work, `${slug}-photo.png`);
    const file = path.join(work, `${slug}-photo-cut.png`);
    fs.writeFileSync(src, png);
    const r = await (deps.removeBg ?? removeBackground)(src, file);
    if (!r.ok) throw new Error(`the generated photo did not cut out (${r.error})`);
    return bankObject({ slug, kind: 'cutout', name, width: r.width, height: r.height, credit: 'Made for Helios', license: 'generated', source: 'gpt-image-2', approved: true }, { png: file }, root);
  };

  /** Stock first when a vision check can pick; otherwise, or when stock has nothing clean, a generated photo. */
  const cutoutFor = async (name: string, slug: string): Promise<BankedObject | null> => {
    if (deps.create) {
      try {
        return await findCutout(name, slug, deps.create);
      } catch (error) {
        log('object_stock_miss', { slug, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return photoCutout(name, slug);
  };

  try {
    for (const need of needs) {
      for (const kind of need.kinds) {
        const banked = findBanked(need.slug, kind, root);
        if (banked) {
          place(banked);
          log('object_banked', { slug: need.slug, kind });
          continue;
        }
        try {
          const made = kind === 'drawing' ? await drawIt(need.name, need.slug, 'drawing') : await cutoutFor(need.name, need.slug);
          if (made) place(made);
          log('object_made', { slug: need.slug, kind });
        } catch (error) {
          out.flags.push(`${kind} "${need.name}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    for (const p of people) {
      const slug = slugOf(p.name);
      const banked = findBanked(slug, 'person-sketch', root);
      if (banked) {
        place(banked);
        continue;
      }
      try {
        const sketch = await drawIt(p.name, slug, 'person-sketch', path.join(root, p.cutout));
        out.flags.push(`sketch of ${p.name} drawn and banked for Lucas's approval (${sketch?.file}); this reel uses a name card`);
      } catch (error) {
        out.flags.push(`sketch of ${p.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(projectDir, 'assets', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'objects', 'credits.json'), `${JSON.stringify(out.placed, null, 1)}\n`);
  return out;
}

const SCENES: Scene[] = ['board', 'newspaper', 'whiteboard'];

/**
 * Object prep for a job from its final plan: the case file's objects by their acts' grounds, and a
 * sketch for each cutout player who appears on a whiteboard act (from their approved banked cutout).
 */
export async function prepareJobObjects(projectDir: string, storyboard: string, deps: PrepDeps = {}): Promise<PrepResult> {
  const frames = parseFrames(storyboard) as { number: number; fields?: Record<string, string> }[];
  const groundOf = (n: number): Scene | null => {
    const f = frames.find((x) => x.number === n);
    const g = f ? (frameGround(f) as Scene) : null;
    return g && SCENES.includes(g) ? g : null;
  };
  const cutouts = loadCutouts(deps.root).filter((c) => c.approved);
  const people = caseFileCutoutPlayers(storyboard)
    .filter((p) => p.acts.some((n) => groundOf(n) === 'whiteboard'))
    .flatMap((p) => {
      const c = cutouts.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      return c ? [{ name: c.name, cutout: c.file }] : [];
    });
  return prepareObjects(projectDir, objectNeeds(caseFileObjects(storyboard), groundOf), people, deps);
}
