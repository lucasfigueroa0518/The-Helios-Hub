/**
 * Morning Download frame fixes from set d61efd39, offline (fake Jev, sharp-made images, ffmpeg only when installed):
 *   1. a WebP photo reaches Jev as a JPEG of the same size (Jev rejects anything but PNG and JPEG);
 *   2. a covering band crop leaves the edge text and corner bar outside the essential box out of the frame;
 *   3. an MD clip plays in the contained photo's place, below the masthead, and its poster says so.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { askBand, BAND_H, BAND_W, CONTAINED_BOTTOM, CONTAINED_TOP, decideBand, renderBand, visionFormat, visionImage } from '@/lib/news-photos';
import { MD_BAND, MD_VIDEO_ASPECT, MD_VIDEO_PLACE, videoPoster } from '@/lib/stories/video';
import { bandGraph } from '@/lib/video-finder/band';
import type { VideoFit } from '@/lib/video-finder/vertical';

const BOX = { left: 0.3, right: 0.7, top: 0.1, bottom: 0.75 };
const fakeJev = (seen: Uint8Array[]) => ({
  systemOne: async (a: { state: { data: Uint8Array } }) => {
    seen.push(a.state.data);
    return { answers: { essential: { box: BOX }, text: { noul: 0.1 } }, usage: { input_tokens: 800, output_tokens: 5 } };
  },
});

test('askBand: a WebP photo reaches Jev as a JPEG with the same width and height, and its box comes back', async () => {
  const webp = await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 30, g: 120, b: 200 } } }).webp().toBuffer();
  assert.equal(visionFormat(webp), null);
  const seen: Uint8Array[] = [];
  const a = await askBand(webp, fakeJev(seen));
  assert.equal(a.error, undefined);
  assert.deepEqual(a.essential, BOX);
  const sent = Buffer.from(seen[0]!);
  assert.equal(visionFormat(sent), 'image/jpeg');
  const m = await sharp(sent).metadata();
  assert.equal(m.format, 'jpeg');
  assert.deepEqual([m.width, m.height], [1280, 720]);
});

test('visionImage: JPEG and PNG pass through untouched', async () => {
  const img = sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } });
  const jpg = await img.clone().jpeg().toBuffer(), png = await img.clone().png().toBuffer();
  assert.equal((await visionImage(jpg)).bytes, jpg);
  assert.deepEqual([(await visionImage(png)).bytes, (await visionImage(png)).mediaType], [png, 'image/png']);
});

test('frame 4: a covering band crop keeps the essential box and leaves the edge text and corner bar out', async () => {
  const W = 1280, H = 720;
  // Grey composite; broadcaster text strip (green) on the left 6%, red bar bottom-left, two "faces" (blue) inside BOX.
  const rect = (l: number, t: number, w: number, h: number, c: string) => ({ input: { create: { width: Math.round(w * W), height: Math.round(h * H), channels: 3 as const, background: c } }, left: Math.round(l * W), top: Math.round(t * H) });
  const webp = await sharp({ create: { width: W, height: H, channels: 3, background: '#777777' } })
    .composite([rect(0, 0.3, 0.06, 0.4, '#00ff00'), rect(0, 0.88, 0.2, 0.12, '#ff0000'), rect(0.32, 0.15, 0.16, 0.5, '#0000ff'), rect(0.52, 0.15, 0.16, 0.5, '#0000ff')])
    .webp({ lossless: true }).toBuffer();
  const a = await askBand(webp, fakeJev([]));
  const p = decideBand(W, H, a.essential, a.hasText);
  assert.equal(p.covers, true);
  assert.equal(p.contained, false);
  // Geometry: the box is inside the band, the strip and the bar are off its left edge.
  assert.ok(p.left + BOX.left * p.drawW >= 0 && p.left + BOX.right * p.drawW <= BAND_W);
  assert.ok(p.left + 0.06 * p.drawW <= 0, 'edge text strip is off the frame');
  assert.ok(p.left + 0.2 * p.drawW <= 0, 'red corner bar is off the frame');
  // Pixels: no green or red survives; both faces do.
  const { data, info } = await sharp(await renderBand(webp, p)).raw().toBuffer({ resolveWithObject: true });
  let red = 0, green = 0, blue = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
    if (r > 200 && g < 60 && b < 60) red++;
    if (g > 200 && r < 60 && b < 60) green++;
    if (b > 200 && r < 60 && g < 60) blue++;
  }
  assert.deepEqual([red, green], [0, 0]);
  assert.ok(blue > 100_000, 'the faces are shown');
});

const shots = [{ shot: { start: 0, end: 6, samples: [1] }, boxes: [], left: 0.1, shown: 1 }];

test('MD clip geometry: the band constants, the contained place below the masthead, and a contained poster', () => {
  assert.deepEqual(MD_BAND, { w: BAND_W, h: BAND_H });
  assert.deepEqual(MD_VIDEO_PLACE, { top: CONTAINED_TOP, bottom: CONTAINED_BOTTOM });
  assert.ok(MD_VIDEO_PLACE.top >= 350, 'the masthead ends at 350px');
  assert.equal(MD_VIDEO_ASPECT, BAND_W / (CONTAINED_BOTTOM - CONTAINED_TOP));
  assert.equal(videoPoster('https://x/p.jpg', 'Video: Ch').contained, true);

  const rh = CONTAINED_BOTTOM - CONTAINED_TOP;
  const crop = bandGraph({ mode: 'crop', win: 0.9, shots } as unknown as VideoFit, 1920, 1080, BAND_W, BAND_H, MD_VIDEO_PLACE);
  assert.match(crop, new RegExp(`scale=${BAND_W}:${rh}:force_original_aspect_ratio=increase.*crop=${BAND_W}:${rh}`));
  assert.match(crop, new RegExp(`overlay=0:${CONTAINED_TOP}\\[v\\]$`));
  assert.match(crop, new RegExp(`boxblur=10:2,scale=${BAND_W}:${BAND_H}`), 'blur fill covers the whole band');
  for (const mode of ['blur', 'vertical'] as const) {
    const g = bandGraph({ mode, win: 1, shots, reason: 'x' } as unknown as VideoFit, 1920, 1080, BAND_W, BAND_H, MD_VIDEO_PLACE);
    assert.match(g, new RegExp(`scale=${BAND_W}:${rh}:force_original_aspect_ratio=decrease`));
    assert.match(g, new RegExp(`overlay=\\(W-w\\)/2:${CONTAINED_TOP}\\+\\(${rh}-h\\)/2\\[v\\]$`));
  }
  // Without a place (LFD slides) the graph is unchanged: full-bleed.
  assert.doesNotMatch(bandGraph({ mode: 'crop', win: 0.9, shots } as unknown as VideoFit, 1920, 1080, BAND_W, BAND_H), /overlay/);
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('MD clip render: the picture sits at the contained place, nothing bright above it (local ffmpeg)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-place-'));
  try {
    const src = path.join(dir, 'src.mp4'), still = path.join(dir, 'still.png');
    // A white 16:9 source: the band clip is white where the picture is, a darkened blur of white (≤ 0.7) elsewhere.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1', '-pix_fmt', 'yuv420p', src]);
    const g = bandGraph({ mode: 'crop', win: 0.9, shots: [{ ...shots[0], left: 0.05 }] } as unknown as VideoFit, 320, 180, BAND_W, BAND_H, MD_VIDEO_PLACE);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', g, '-map', '[v]', '-frames:v', '1', still]);
    const { data, info } = await sharp(still).greyscale().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [BAND_W, BAND_H]);
    const row = (y: number) => { let s = 0; for (let x = 0; x < info.width; x++) s += data[y * info.width + x]!; return s / info.width; };
    assert.ok(row(320) < 200, `above the place is the dim fill (${row(320)})`);
    assert.ok(row(CONTAINED_TOP + 20) > 240 && row(CONTAINED_BOTTOM - 20) > 240, 'the picture fills the place');
    assert.ok(row(CONTAINED_BOTTOM + 40) < 200, 'below the place is the dim fill');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
