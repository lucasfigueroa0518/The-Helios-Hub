import { RUN_HANG_BACKSTOP_MS } from '@/lib/content-runs/hang-guard';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Moment } from '@/lib/reel-ai-drama/render/moments';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';

/**
 * Composite sheets of a frame's moments (Iteration 11 contract §3): what the design review, the solver and the first viewer look
 * at. Stills are cut from the rendered video, so captions are what the viewer sees. Tiles never shrink: more moments
 * start another sheet, and every tile's label strip sits outside its picture so it can't hide a fault.
 */

export type Sheet = { frame: number; file: string; moments: Moment[] };

/** One tile's picture: the whole phone screen at about 40%, about 461 tokens. */
export const TILE = { W: 441, H: 784 };
export const SHEET_MOMENTS = 6;

const GAP = 8;
const PAD = 12;
const FONT = 20;
const LINE = 26;
/** The strip's font is monospaced, so wrapping needs no text measuring. */
const CHAR_W = FONT * 0.61;
const LINE_CHARS = Math.floor((TILE.W - PAD * 2) / CHAR_W);
/** A strip's most lines. It keeps a two-row sheet under the 2000 px the API allows when a request carries many images. */
const STRIP_LINES = 7;

/** Columns and rows by moment count: 1, 2 across, 2x2, 3x2. Pure. */
export function sheetGrid(count: number): { cols: number; rows: number } {
  if (count <= 2) return { cols: Math.max(1, count), rows: 1 };
  return count <= 4 ? { cols: 2, rows: 2 } : { cols: 3, rows: 2 };
}

/** A strip's lines: the frame and time first, then what happens, wrapped. A moment with no `what` carries only frame and time. Pure. */
export function stripLines(m: Moment): string[] {
  const head = m.what ? `Frame ${m.frame} · reel ${m.reel_t.toFixed(1)}s · frame ${m.t.toFixed(1)}s` : `Frame ${m.frame} · ${m.reel_t.toFixed(1)}s`;
  const lines: string[] = [];
  let line = '';
  for (const word of m.what.split(/\s+/).filter(Boolean).flatMap((w) => w.match(new RegExp(`.{1,${LINE_CHARS}}`, 'gu')) ?? [])) {
    if (line && line.length + 1 + word.length > LINE_CHARS) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length < STRIP_LINES) return [head, ...lines];
  return [head, ...lines.slice(0, STRIP_LINES - 2), `${lines[STRIP_LINES - 2]!.slice(0, LINE_CHARS - 1)}…`];
}

const xml = (s: string) => s.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripHeight = (lines: number) => lines * LINE + PAD;

/** A label strip as SVG, for sharp: light on dark, its first line bold. Pure. */
export function stripSvg(lines: string[], height: number): string {
  const text = lines.map((l, i) => `<text x="${PAD}" y="${(i + 1) * LINE - 2}" font-weight="${i ? 400 : 700}" fill="${i ? '#d8d8d8' : '#ffffff'}">${xml(l)}</text>`).join('');
  return `<svg width="${TILE.W}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${TILE.W}" height="${height}" fill="#000000"/><g font-family="DejaVu Sans Mono, Menlo, Liberation Mono, monospace" font-size="${FONT}" xml:space="preserve">${text}</g></svg>`;
}

function cutStill(run: Runner, video: string, reel_t: number, file: string, scale: string[]): void {
  const res = run('ffmpeg', ['-v', 'error', '-y', '-ss', String(reel_t), '-i', video, '-frames:v', '1', ...scale, '-q:v', '2', file], { cwd: path.dirname(file), timeoutMs: RUN_HANG_BACKSTOP_MS });
  // ffmpeg can exit 0 and write nothing when the time is past the video's end.
  if (res.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`the still at ${reel_t}s failed: ${tail(res)}`);
}

/**
 * Sheets of these moments in frame and time order, written to `dir` as frame-NN-K.jpg (a frame's older sheets go first). Moments are
 * never dropped, near-identical ones included. Throws when a still fails (the caller fails open).
 */
export async function makeSheets(videoPath: string, moments: Moment[], dir: string, deps: { run?: Runner } = {}): Promise<Sheet[]> {
  const run = deps.run ?? spawnRunner;
  const video = path.resolve(videoPath);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [...new Set(moments.map((m) => m.frame))].sort((a, b) => a - b);
  const name = (frame: number, k?: number) => `frame-${String(frame).padStart(2, '0')}-${k ?? ''}`;
  for (const old of fs.readdirSync(dir)) if (frames.some((f) => old.startsWith(name(f)))) fs.rmSync(path.join(dir, old), { force: true });
  // Its own folder per call: sheets for several frames can be made at once.
  const cuts = fs.mkdtempSync(path.join(dir, '.tiles-'));
  const out: Sheet[] = [];
  try {
    for (const frame of frames) {
      const own = moments.filter((m) => m.frame === frame).sort((a, b) => a.reel_t - b.reel_t);
      for (let k = 0; k * SHEET_MOMENTS < own.length; k++) {
        const group = own.slice(k * SHEET_MOMENTS, (k + 1) * SHEET_MOMENTS);
        const file = path.resolve(dir, `${name(frame, k + 1)}.jpg`);
        await writeSheet(run, video, group, file, cuts);
        out.push({ frame, file, moments: group });
      }
    }
  } finally {
    fs.rmSync(cuts, { recursive: true, force: true });
  }
  return out;
}

async function writeSheet(run: Runner, video: string, group: Moment[], file: string, cuts: string): Promise<void> {
  const { cols, rows } = sheetGrid(group.length);
  const labels = group.map(stripLines);
  const strip = stripHeight(Math.max(...labels.map((l) => l.length)));
  const parts: { input: Buffer; left: number; top: number }[] = [];
  group.forEach((m, i) => {
    const left = (i % cols) * (TILE.W + GAP);
    const top = Math.floor(i / cols) * (strip + TILE.H + GAP);
    const still = path.join(cuts, `${i}.jpg`);
    cutStill(run, video, m.reel_t, still, ['-vf', `scale=${TILE.W}:${TILE.H}`]);
    parts.push({ input: Buffer.from(stripSvg(labels[i]!, strip)), left, top }, { input: fs.readFileSync(still), left, top: top + strip });
  });
  const width = cols * TILE.W + (cols - 1) * GAP;
  const height = rows * (strip + TILE.H) + (rows - 1) * GAP;
  await sharp({ create: { width, height, channels: 3, background: '#000000' } }).composite(parts).jpeg({ quality: 85 }).toFile(file);
}

/**
 * Sheets for the first viewer: the same tiles with only frame and time on their strips. What a moment's label says comes from
 * the plan and can name what the video hasn't shown, and the stranger must only know what the video gives it.
 */
export function viewerSheets(videoPath: string, moments: Moment[], dir: string, deps: { run?: Runner } = {}): Promise<Sheet[]> {
  return makeSheets(videoPath, moments.map((m) => ({ ...m, what: '' })), dir, deps);
}

/** One full-size still of the rendered video, for a reader that needs to judge small text. Returns `file`. */
export async function fullStill(videoPath: string, reel_t: number, file: string, deps: { run?: Runner } = {}): Promise<string> {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  cutStill(deps.run ?? spawnRunner, path.resolve(videoPath), reel_t, path.resolve(file), []);
  return file;
}
