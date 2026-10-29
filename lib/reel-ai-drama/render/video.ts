import fs from 'node:fs';
import path from 'node:path';

import { HYPERFRAMES_BIN, HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';

/** HyperFrames' render can take a while on the VM; the Explainer job allows 30 minutes too. */
export const RENDER_TIMEOUT_MS = 30 * 60 * 1000;

/** P8: render the assembled project to renders/video.mp4 with the pinned HyperFrames. Throws on failure. */
export async function renderVideo(projectDir: string, deps: { run?: Runner; bin?: string } = {}): Promise<string> {
  const run = deps.run ?? spawnRunner;
  const out = path.join(projectDir, 'renders', 'video.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = run(deps.bin ?? HYPERFRAMES_BIN, ['render', '--quality', 'high', '--workers', 'auto', '--output', 'renders/video.mp4'], {
    cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs: RENDER_TIMEOUT_MS,
  });
  if (res.status !== 0) throw new Error(`hyperframes render exited ${res.status ?? 'with no status'}: ${tail(res, 800)}`);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('hyperframes render left no renders/video.mp4');
  masterLoudness(out, { run });
  return out;
}

/** Reels/TikTok delivery loudness (research 07 §5): integrated −14 LUFS, true peak ≤ −1 dBTP. */
export const LOUDNESS = { I: -14, TP: -1, LRA: 11 };

/**
 * Master the finished reel's audio to LOUDNESS in place (video stream copied). Fails open: the render
 * stays as it was if ffmpeg is missing or fails.
 */
export function masterLoudness(video: string, { run = spawnRunner }: { run?: Runner } = {}): boolean {
  const tmp = video.replace(/\.mp4$/, '.master.mp4');
  const res = run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-c:v', 'copy', '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', tmp], {
    cwd: path.dirname(video), env: process.env, timeoutMs: 5 * 60 * 1000,
  });
  if (res.status !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  fs.renameSync(tmp, video);
  return true;
}

export type FrameSpan = { number: number; name: string; treatment: string; start: number; end: number };

/** The storyboard's frames with their reel start and end (from the paced `- duration:` lines). */
export function frameSpans(storyboard: string): FrameSpan[] {
  const out: FrameSpan[] = [];
  const heads = [...storyboard.matchAll(/^##\s+Frame\s+(\d+)\s*[—–-]?\s*(.*)$/gm)];
  let at = 0;
  heads.forEach((m, i) => {
    const body = storyboard.slice(m.index! + m[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined);
    const dur = Number(/^-\s+duration:\s*(\d+(?:\.\d+)?)/m.exec(body)?.[1] ?? 0);
    const treatment = (/^-\s+treatment:\s*(\S+)/m.exec(body)?.[1] ?? 'photo').toLowerCase();
    out.push({ number: Number(m[1]), name: m[2].trim(), treatment, start: round(at), end: round(at + dur) });
    at += dur;
  });
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const stamp = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** When the contact sheet takes its stills: 1.0s (the hook, MD-34), then each frame at 60% of its span. */
export function stillTimes(spans: FrameSpan[]): number[] {
  const times = [1.0, ...spans.map((s) => round(s.start + (s.end - s.start) * 0.6))];
  return [...new Set(times)].filter((t) => t >= 0).sort((a, b) => a - b);
}

/**
 * Caption pages as the viewer reads them: the skin's paging (presets/reel-ai-drama/caption-skin.html):
 * at most 7 words and about 34 characters, broken at sentence ends, long pauses and frame changes.
 * Groups without words are kept as they are.
 */
export function captionPages(groups: { start: number; text: string; frame?: number; words?: { text: string; start: number; end: number }[] }[]): { start: number; text: string }[] {
  const pages: { start: number; text: string; frame?: number; n: number; end: number }[] = [];
  for (const g of groups) {
    if (!g.words?.length) {
      pages.push({ start: g.start, text: g.text, n: 99, end: g.start });
      continue;
    }
    for (const w of g.words) {
      const p = pages[pages.length - 1];
      const fresh = !p || p.n >= 7 || p.text.length + 1 + w.text.length > 34 || p.frame !== g.frame || /[.?!]["')\]]*$/.test(p.text) || w.start - p.end > 0.8;
      if (fresh) pages.push({ start: w.start, text: w.text, frame: g.frame, n: 1, end: w.end });
      else Object.assign(p, { text: `${p.text} ${w.text}`, n: p.n + 1, end: w.end });
    }
  }
  return pages.map(({ start, text }) => ({ start, text }));
}

/**
 * The caption transcript: every frame with its time and treatment, then every caption group as the
 * viewer reads it (caption_groups.json, written by captions.mjs). Plain text, for the first-time viewer.
 */
export function captionTranscript(projectDir: string): string {
  const lines: string[] = [];
  try {
    const spans = frameSpans(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'));
    lines.push('FRAMES');
    for (const s of spans) lines.push(`[${stamp(s.start)}–${stamp(s.end)}] Frame ${s.number} (${s.treatment}): ${s.name}`);
    lines.push('');
  } catch {
    // no storyboard: captions only
  }
  lines.push('CAPTIONS');
  try {
    type Group = { start: number; text: string; frame?: number; words?: { text: string; start: number; end: number }[] };
    const groups = (JSON.parse(fs.readFileSync(path.join(projectDir, 'caption_groups.json'), 'utf8')) as { groups?: Group[] }).groups ?? [];
    for (const p of captionPages(groups)) lines.push(`[${stamp(p.start)}] ${p.text}`);
  } catch {
    lines.push('(no caption_groups.json)');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * P9 / C3: a stills grid of the rendered video (renders/contact-sheet.png: the hook at 1.0s, then one
 * still per frame) and the caption transcript beside it (renders/contact-sheet.txt). Returns the PNG.
 */
export async function contactSheet(projectDir: string, videoPath: string, deps: { run?: Runner; cols?: number } = {}): Promise<string> {
  const run = deps.run ?? spawnRunner;
  const cols = deps.cols ?? 6;
  const dir = path.join(projectDir, 'renders', 'sheet');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const spans = frameSpans(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'));
  const times = stillTimes(spans);
  const rows = Math.max(1, Math.ceil(times.length / cols));
  const W = 270;
  const H = 480;
  for (let i = 0; i < rows * cols; i++) {
    const out = path.join(dir, `still-${String(i).padStart(3, '0')}.png`);
    const args = i < times.length
      ? ['-v', 'error', '-y', '-ss', String(times[i]), '-i', videoPath, '-frames:v', '1', '-vf', `scale=${W}:${H}`, out]
      : ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1a1a1a:s=${W}x${H}`, '-frames:v', '1', out];
    const res = run('ffmpeg', args, { cwd: projectDir, timeoutMs: 120_000 });
    if (res.status !== 0) throw new Error(`contact sheet: the still at ${times[i] ?? 'pad'}s failed: ${tail(res)}`);
  }
  const png = path.join(projectDir, 'renders', 'contact-sheet.png');
  const tiled = run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(dir, 'still-%03d.png'), '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=0x1a1a1a`, '-frames:v', '1', png], { cwd: projectDir, timeoutMs: 120_000 });
  if (tiled.status !== 0) throw new Error(`contact sheet: tiling failed: ${tail(tiled)}`);
  const stills = times.map((t, i) => `still ${i + 1}: ${stamp(t)}`).join('\n');
  fs.writeFileSync(path.join(projectDir, 'renders', 'contact-sheet.txt'), `${captionTranscript(projectDir)}\nSTILLS (left to right, top to bottom)\n${stills}\n`);
  return png;
}
