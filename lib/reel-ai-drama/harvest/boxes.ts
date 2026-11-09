import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import type { Asset, VisualKind } from '@/lib/reel-ai-drama/types';

import type { CutPerson, DetectFaces, FaceBox, ReadWords } from './types';

/**
 * Box sidecars (iteration 4 contract; B writes, C's kit reads): for every image in the job media,
 * `media/<stem>.boxes.json` =
 *   { faces: Box[]; words: { text, box }[]; photos: Box[]; lift: string | null }
 * with Box = { x, y, w, h } normalised 0–1 to the image, top-left origin, so marks and labels can target what
 * is really there (a face, a phrase on a page, the picture inside an article) instead of coordinates.
 *   - faces: the local detector (faces.ts), largest first; `name` when the asset shows exactly one named
 *     person and one face is found.
 *   - words: Tesseract TSV (local, no AI), words with confidence ≥ MIN_WORD_CONF; only for images that
 *     carry text (pages, posts, documents, papers, headlines, charts, or anything the look called text-heavy).
 *   - photos: picture regions inside a page/post/article image, found from the pixels (mid-tone, varied
 *     blocks that are not text), plus a region around any face that no region holds.
 *   - lift: `<stem>.lift.png`, a transparent PNG cut (rembg) out of the photo region that holds the page's
 *     main face, or null; `lift_from` is the page region the lift file covers (the crop narrowed to the
 *     remover's trim, so faces re-expressed in it land on the lift's faces). Same stem, so the kit copies it.
 * The older pixel-box fields of a screenshot sidecar (`image`, `width`, `height`, `boxes`: measured
 * phrases in image pixels) are kept when present, so readers of the old format keep working.
 * Fails open: a tool that is missing or fails leaves its field empty and a note.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type NamedBox = Box & { name?: string; score?: number };
export type Sidecar = {
  faces: NamedBox[];
  words: { text: string; box: Box }[];
  photos: Box[];
  lift: string | null;
  lift_from?: Box | null;
  image?: string;
  width?: number;
  height?: number;
  boxes?: unknown[];
};

export const TESSERACT_BIN = '/opt/homebrew/bin/tesseract';
export const MIN_WORD_CONF = 60;
/** Kinds whose pictures carry text worth targeting. */
export const TEXT_KINDS: ReadonlySet<VisualKind> = new Set<VisualKind>(['web_page', 'social_post', 'document', 'paper', 'headline', 'chart', 'archival']);
/** Kinds that are a page with pictures inside it (an artifact a person can be lifted off). */
export const PAGE_KINDS: ReadonlySet<VisualKind> = new Set<VisualKind>(['web_page', 'social_post', 'document', 'paper', 'headline', 'archival']);

const run = promisify(execFile);
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const area = (b: Box) => b.w * b.h;

export function normBox(b: Box): Box {
  const x = clamp(b.x);
  const y = clamp(b.y);
  return { x: r4(x), y: r4(y), w: r4(clamp(b.x + b.w) - x), h: r4(clamp(b.y + b.h) - y) };
}

/** Parses `tesseract … tsv` output into words (level 5) above the confidence floor. */
export function parseTesseractTsv(tsv: string): Awaited<ReturnType<ReadWords>> {
  const out: Awaited<ReturnType<ReadWords>> = [];
  for (const line of tsv.split('\n').slice(1)) {
    const f = line.split('\t');
    if (f.length < 12 || f[0] !== '5') continue;
    const [left, top, width, height, conf] = [f[6], f[7], f[8], f[9], f[10]].map(Number);
    const text = f.slice(11).join('\t').trim();
    if (!text || ![left, top, width, height, conf].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    out.push({ text, left, top, width, height, conf });
  }
  return out;
}

/** The live OCR: Tesseract (sparse text, so headlines and captions around pictures are found too). */
export function tesseractWords(bin: string = TESSERACT_BIN): ReadWords {
  return async (file) => {
    const { stdout } = await run(bin, [file, 'stdout', '--psm', '11', 'tsv'], { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
    return parseTesseractTsv(stdout);
  };
}

export function findTesseract(): string | null {
  return fs.existsSync(TESSERACT_BIN) ? TESSERACT_BIN : null;
}

/** Words worth targeting: confident, with a letter or digit, normalised to the image. */
export function wordBoxes(words: Awaited<ReturnType<ReadWords>>, width: number, height: number): Sidecar['words'] {
  if (!(width > 0 && height > 0)) return [];
  return words
    .filter((w) => w.conf >= MIN_WORD_CONF && /[A-Za-z0-9]/.test(w.text) && (w.text.length > 1 || /[A-Za-z0-9]/.test(w.text)))
    .map((w) => ({ text: w.text, box: normBox({ x: w.left / width, y: w.top / height, w: w.width / width, h: w.height / height }) }));
}

/** A picture OCR can't read as it is often reads as grey, negated, or larger: light words on a dark band above all. */
const OCR_VARIANTS: readonly ((img: ReturnType<typeof sharp>, width: number) => ReturnType<typeof sharp>)[] = [
  (img) => img.greyscale(),
  (img) => img.greyscale().negate({ alpha: false }),
  (img, width) => img.greyscale().resize({ width: Math.min(2400, width * 2) }),
  (img, width) => img.greyscale().negate({ alpha: false }).resize({ width: Math.min(2400, width * 2) }),
];

/**
 * The words on a picture, trying harder until `enough` says they're the ones wanted: the picture as it is, then its variants.
 * Boxes stay in the picture's 0-1 frame. The fullest reading when none is enough. A variant that can't be made is skipped.
 */
export async function readWordsHard(file: string, width: number, height: number, read: ReadWords, enough: (words: Sidecar['words']) => boolean): Promise<Sidecar['words']> {
  let best = wordBoxes(await read(file), width, height);
  if (enough(best)) return best;
  const tmp = path.join(os.tmpdir(), `rd-ocr-${process.pid}-${Date.now()}.png`);
  for (const variant of OCR_VARIANTS) {
    try {
      const info = await variant(sharp(file).flatten({ background: '#ffffff' }), width).png().toFile(tmp);
      const words = wordBoxes(await read(tmp), info.width, info.height);
      if (enough(words)) return words;
      if (words.length > best.length) best = words;
    } catch {
      // A variant that can't be made or read says nothing.
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return best;
}

/** Faces largest first; the only face of a one-person picture carries that person's name. */
export function faceBoxes(faces: readonly FaceBox[] | null | undefined, people: readonly string[]): NamedBox[] {
  const sorted = [...(faces ?? [])].sort((a, b) => area(b) - area(a)).map((f) => ({ ...normBox(f), score: r4(f.score) }));
  if (sorted.length === 1 && people.length === 1) return [{ ...sorted[0], name: people[0] }];
  return sorted;
}

const GRID = 48;

/**
 * Picture regions inside a page image, from the pixels: the page's own background is its commonest tone;
 * the image is cut into a GRID×GRID lattice and a cell is a candidate when most of its pixels differ from
 * that background (a line of text is mostly background between its strokes; dark mode works the same). Connected
 * candidate cells become a region, kept when it is big, mostly solid and varied (its cells' tones differ,
 * or the cells have texture), so a flat UI banner is not a picture. Text-covered cells are dropped. A face no region holds gets a region around it (a portrait in a post the grid missed).
 */
export async function photoRegions(file: string, opts: { words?: readonly Box[]; faces?: readonly Box[] } = {}): Promise<Box[]> {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).resize(GRID * 4, GRID * 4, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const cell = info.width / GRID;
  const hist = new Array(32).fill(0);
  for (const v of data) hist[v >> 3]++;
  const bg = hist.indexOf(Math.max(...hist)) * 8 + 4;
  const pic: boolean[] = new Array(GRID * GRID).fill(false);
  const means = new Float64Array(GRID * GRID);
  const sds = new Float64Array(GRID * GRID);
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      let off = 0;
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const v = data[y * info.width + x];
          if (Math.abs(v - bg) > 24) off++;
          sum += v;
          sq += v * v;
          n++;
        }
      }
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      means[cy * GRID + cx] = mean;
      sds[cy * GRID + cx] = sd;
      pic[cy * GRID + cx] = off / n >= 0.6;
    }
  }
  // Cells under a confident word are text, whatever their tones.
  for (const w of opts.words ?? []) {
    for (let cy = Math.floor(w.y * GRID); cy <= Math.min(GRID - 1, Math.floor((w.y + w.h) * GRID)); cy++) {
      for (let cx = Math.floor(w.x * GRID); cx <= Math.min(GRID - 1, Math.floor((w.x + w.w) * GRID)); cx++) pic[cy * GRID + cx] = false;
    }
  }
  const seen = new Uint8Array(GRID * GRID);
  const boxes: Box[] = [];
  for (let i = 0; i < pic.length; i++) {
    if (!pic[i] || seen[i]) continue;
    let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1, count = 0, sum = 0, sq = 0, texture = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % GRID;
      const y = Math.floor(j / GRID);
      count++;
      sum += means[j];
      sq += means[j] * means[j];
      texture += sds[j];
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = ny * GRID + nx;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || seen[k] || !pic[k]) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    const b = { x: x0 / GRID, y: y0 / GRID, w: (x1 - x0 + 1) / GRID, h: (y1 - y0 + 1) / GRID };
    // A region is a picture when it is big enough and mostly solid (not a scatter of tinted words).
    const spread = Math.sqrt(Math.max(0, sq / count - (sum / count) ** 2));
    const varied = spread >= 8 || texture / count >= 6;
    if (varied && b.w >= 0.1 && b.h >= 0.06 && area(b) >= 0.02 && count / ((x1 - x0 + 1) * (y1 - y0 + 1)) >= 0.5) boxes.push(normBox(b));
  }
  for (const f of opts.faces ?? []) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    if (boxes.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)) continue;
    boxes.push(normBox({ x: f.x - f.w, y: f.y - f.h * 0.8, w: f.w * 3, h: f.h * 3.6 }));
  }
  return boxes.sort((a, b) => area(b) - area(a));
}

/** Raw pixels as sharp hands them out (`raw().toBuffer({ resolveWithObject: true })`). */
export type RawImage = { data: Uint8Array; width: number; height: number; channels: number };

/**
 * Where a trimmed cut-out sits inside the picture it was cut from, in px, or null when it can't be told.
 * The remover (rembg, then Real Case's trimToAlpha) keeps the colour of every pixel it keeps and crops to
 * them plus a margin, without saying where; the cut-out's opaque pixels equal the source's at exactly one
 * offset. Samples on a grid of fully opaque pixels are compared at every offset; the closest match wins
 * (a smooth gradient also matches one pixel off, only less well). Pure.
 */
export function cutOffset(src: RawImage, cut: RawImage, { samples = 64, tol = 10 }: { samples?: number; tol?: number } = {}): { x: number; y: number } | null {
  if (cut.width > src.width || cut.height > src.height || cut.channels < 4) return null;
  const grid: { x: number; y: number; px: [number, number, number] }[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((cut.width * cut.height) / (samples * 6))));
  for (let y = 0; y < cut.height; y += step) {
    for (let x = 0; x < cut.width; x += step) {
      const i = (y * cut.width + x) * cut.channels;
      if (cut.data[i + 3] >= 250) grid.push({ x, y, px: [cut.data[i], cut.data[i + 1], cut.data[i + 2]] });
    }
  }
  if (grid.length < 8) return null;
  // Spread the samples over the whole figure, deterministically.
  const pts = grid.length <= samples ? grid : Array.from({ length: samples }, (_, k) => grid[Math.floor((k * grid.length) / samples)]);
  const at = (x: number, y: number) => (y * src.width + x) * src.channels;
  // The offset whose samples differ least (every sample within `tol`); a tie means a flat figure: can't tell.
  let best: { x: number; y: number; err: number } | null = null;
  let tie = false;
  for (let dy = 0; dy <= src.height - cut.height; dy++) {
    for (let dx = 0; dx <= src.width - cut.width; dx++) {
      let err = 0;
      let ok = true;
      for (const p of pts) {
        const i = at(dx + p.x, dy + p.y);
        const e0 = Math.abs(src.data[i] - p.px[0]), e1 = Math.abs(src.data[i + 1] - p.px[1]), e2 = Math.abs(src.data[i + 2] - p.px[2]);
        err += e0 + e1 + e2;
        if (e0 > tol || e1 > tol || e2 > tol || (best && err > best.err)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (best && err === best.err) tie = true;
      else if (!best || err < best.err) { best = { x: dx, y: dy, err }; tie = false; }
    }
  }
  return best && !tie ? { x: best.x, y: best.y } : null;
}

/**
 * The page region a lift really covers: the crop `region` was cut from (px rect `crop` on a `width` ×
 * `height` page) narrowed to where the trimmed lift sits in it, so the kit's piece faces and aspect match
 * the lift file. Null when the lift can't be placed in its crop.
 */
export async function liftRegionOf(cropFile: string, liftFile: string, crop: { left: number; top: number }, width: number, height: number): Promise<Box | null> {
  const raw = async (f: string): Promise<RawImage> => {
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  };
  const [src, cut] = await Promise.all([raw(cropFile), raw(liftFile)]);
  const off = cutOffset(src, cut);
  if (!off) return null;
  return { x: r4((crop.left + off.x) / width), y: r4((crop.top + off.y) / height), w: r4(cut.width / width), h: r4(cut.height / height) };
}

/** The photo region holding the largest face, or null. */
export function liftRegion(photos: readonly Box[], faces: readonly Box[]): Box | null {
  for (const f of [...faces].sort((a, b) => area(b) - area(a))) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const hit = photos.filter((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h).sort((a, b) => area(a) - area(b))[0];
    if (hit) return hit;
  }
  return null;
}

export type SidecarDeps = { readWords?: ReadWords | null; detectFaces?: DetectFaces | null; cutout?: CutPerson | null };
export type SidecarInput = { asset: Asset; faces?: readonly FaceBox[] | null; textHeavy?: boolean };

/** The sidecar path of a media file: `media/V3.jpg` → `media/V3.boxes.json`. */
export const sidecarPath = (file: string) => path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.boxes.json`);

/**
 * Writes (or merges into) the sidecar of each asset's image under `jobDir`, and adds the `boxes:<path>`
 * flag to the asset. Faces come from the candidate when it was boxed already, else from the detector (one
 * batch). Returns notes for anything that failed. Made assets other than sketches, and SVGs, are skipped.
 */
export async function writeSidecars(jobDir: string, items: readonly SidecarInput[], deps: SidecarDeps): Promise<string[]> {
  const notes: string[] = [];
  const todo = items.filter(({ asset: a }) => /\.(jpe?g|png|webp)$/i.test(a.file) && fs.existsSync(path.join(jobDir, a.file)) && !/\.(lift|fg|plain)\.png$/i.test(a.file));
  const faceless = (a: Asset) => a.kind === 'logo' || a.kind === 'map';
  const needFaces = todo.filter((i) => !i.faces && !faceless(i.asset)).map((i) => path.join(jobDir, i.asset.file));
  let detected = new Map<string, FaceBox[] | null>();
  if (needFaces.length && deps.detectFaces) {
    try {
      detected = await deps.detectFaces(needFaces);
    } catch (error) {
      notes.push(`sidecars: face detector failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`);
    }
  }
  for (const item of todo) {
    const a = item.asset;
    const abs = path.join(jobDir, a.file);
    try {
      const meta = await sharp(abs).metadata();
      const width = meta.width ?? a.width;
      const height = meta.height ?? a.height;
      const faces = faceBoxes(item.faces ?? detected.get(abs) ?? [], a.people);
      let words: Sidecar['words'] = [];
      const wantsWords = TEXT_KINDS.has(a.kind) || item.textHeavy === true || a.flags.includes('text_heavy');
      if (wantsWords && deps.readWords) {
        try {
          words = wordBoxes(await deps.readWords(abs), width, height);
        } catch (error) {
          notes.push(`sidecars: OCR failed for ${a.id} (${error instanceof Error ? error.message.slice(0, 100) : String(error)})`);
        }
      }
      const page = PAGE_KINDS.has(a.kind) || item.textHeavy === true;
      const photos = page ? await photoRegions(abs, { words: words.map((w) => w.box), faces }) : [];
      let lift: string | null = null;
      let liftFrom: Box | null = null;
      const region = page ? liftRegion(photos, faces) : null;
      if (region && deps.cutout) {
        const crop = path.join(path.dirname(abs), `${a.id}.lift-src.png`);
        const out = path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}.lift.png`);
        try {
          const rect = { left: Math.floor(region.x * width), top: Math.floor(region.y * height), width: Math.max(1, Math.floor(region.w * width)), height: Math.max(1, Math.floor(region.h * height)) };
          await sharp(abs).extract(rect).png().toFile(crop);
          const res = await deps.cutout(crop, out);
          if (res.ok) {
            lift = path.basename(out);
            // The cut-out comes back trimmed to the figure: record the region it really covers, so its
            // faces (re-expressed in it by the kit) and its aspect match the lift file, not the crop.
            const trimmed = await liftRegionOf(crop, out, rect, width, height).catch(() => null);
            if (!trimmed) notes.push(`sidecars: ${a.id}'s lift could not be placed in its crop; lift_from is the crop`);
            liftFrom = trimmed ?? region;
          } else notes.push(`sidecars: no lift for ${a.id} (${res.error.slice(0, 100)})`);
        } catch (error) {
          notes.push(`sidecars: lift for ${a.id} failed (${error instanceof Error ? error.message.slice(0, 100) : String(error)})`);
        } finally {
          fs.rmSync(crop, { force: true });
        }
      }
      const file = sidecarPath(abs);
      let prior: Record<string, unknown> = {};
      if (fs.existsSync(file)) {
        try {
          prior = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        } catch {
          prior = {};
        }
      }
      const sidecar: Sidecar = { ...prior, faces, words, photos, lift, ...(liftFrom ? { lift_from: liftFrom } : {}) };
      fs.writeFileSync(file, `${JSON.stringify(sidecar, null, 1)}\n`);
      const rel = path.relative(jobDir, file).split(path.sep).join('/');
      if (!a.flags.some((f) => f.startsWith('boxes:'))) a.flags.push(`boxes:${rel}`);
      if (lift && !a.flags.includes('lift')) a.flags.push('lift');
    } catch (error) {
      notes.push(`sidecars: ${a.id} skipped (${error instanceof Error ? error.message.slice(0, 100) : String(error)})`);
    }
  }
  return notes;
}
