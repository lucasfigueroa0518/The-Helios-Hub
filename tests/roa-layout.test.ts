/**
 * RA-28: text never sits on the photo's subject. The crop and subject geometry (lib/stories/roa/layout.ts), the room
 * check intake applies, the pixel read for rows with no screen box, and the renderer moving each stack into the empty
 * space (lib/stories/render/avoid.ts) in headless Chromium. Local files only, no network, no model. The frames land in
 * .stories-local/roa-avoid/ for a look.
 */
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { avoidSubject, type AvoidResult } from '@/lib/stories/render/avoid';
import { framesHtml, openRenderer } from '@/lib/stories/render/render';
import { fitText } from '@/lib/stories/render/text-fit';
import { FRAME_H, FRAME_W, type Frame } from '@/lib/stories/render/types';
import { freeBands, hasRoom, layoutFor, layoutOfImage, subjectFromPixels, SUBJECT_PAD, TEXT_BAND } from '@/lib/stories/roa/layout';
import type { RoaQuestionData, RoaRevealData, SubjectRect } from '@/lib/stories/roa/types';

const PHOTO = { src: 'lib/stories/render/fixtures/photos/capitol.jpg', credit: '', kind: 'scene' as const };
const OUT = path.join(process.cwd(), '.stories-local', 'roa-avoid');

test('layoutFor: a 9:16 image maps its box straight onto the frame', () => {
  const l = layoutFor({ w: 1080, h: 1920 }, { x: 0.25, y: 0.5, w: 0.5, h: 0.4 });
  assert.deepEqual(l.focus, { x: 0.5, y: 0.5 });
  assert.deepEqual(l.subject, { top: 960, bottom: 1728, left: 270, right: 810 });
});

test('layoutFor: a wide image centres its subject across; a tall one crops to the largest empty band', () => {
  const wide = layoutFor({ w: 3840, h: 1920 }, { x: 0.7, y: 0.4, w: 0.1, h: 0.2 });
  assert.ok(wide.focus.x > 0.5);
  assert.ok(Math.abs((wide.subject.left + wide.subject.right) / 2 - FRAME_W / 2) <= 1, JSON.stringify(wide.subject));
  // A subject near the top of a tall image: the crop keeps it high so the band below it is empty.
  const tall = layoutFor({ w: 1080, h: 3840 }, { x: 0.2, y: 0.1, w: 0.6, h: 0.2 });
  const { above, below } = freeBands(tall.subject);
  assert.ok(Math.max(above, below) >= 700, JSON.stringify({ above, below, focus: tall.focus }));
});

test('hasRoom: the reveal fits whole in one band, or split with the verdict above; else no room', () => {
  const at = (y0: number, y1: number) => layoutFor({ w: 1080, h: 1920 }, { x: 0.2, y: y0, w: 0.6, h: y1 - y0 });
  assert.ok(hasRoom(at(0.55, 0.95)), 'subject low: the reveal fits above');
  assert.ok(hasRoom(at(0.05, 0.4)), 'subject high: the reveal fits below');
  assert.ok(hasRoom(at(0.27, 0.55)), 'verdict above, the rest below');
  assert.ok(!hasRoom(at(0.3, 0.7)), 'subject fills the middle');
  assert.ok(!hasRoom(at(0.05, 0.95)), 'subject fills the frame');
});

test('subjectFromPixels: flat sky is left out, the detailed part is the subject', async () => {
  const W = 360;
  const H = 640;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const busy = y > H * 0.6;
      const v = busy ? ((x * 37 + y * 91) % 7 < 3 ? 30 : 230) : 180;
      px[i] = busy ? v : 120;
      px[i + 1] = busy ? v : 170;
      px[i + 2] = busy ? v : 230;
    }
  }
  const jpeg = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
  const box = await subjectFromPixels(jpeg);
  assert.ok(box.y >= 0.55, JSON.stringify(box));
  const l = await layoutOfImage(jpeg);
  assert.ok(hasRoom(l));
  assert.ok(l.subject.top >= FRAME_H * 0.55);
});

/* ── The renderer moves the text ─────────────────────────────────── */

const subjectAt = (top: number, bottom: number): SubjectRect => ({ top, bottom, left: 200, right: 880 });
const question = (subject: SubjectRect): RoaQuestionData => ({ role: 'roa_question', round: 1, photo: PHOTO, subject });
const reveal = (subject: SubjectRect): RoaRevealData => ({
  role: 'roa_reveal', round: 1, photo: PHOTO, subject, truth: 'real', payoff: 'camera',
  receipt: { head: 'Shot on', rows: ['Nikon D7200', '390 mm · f/8 · 1/640 s · ISO 100', 'April 2022 · Lake Nakuru, Kenya'] },
  proof: 'Kenya, 2022 · Jane Doe, CC BY-SA 4.0',
});
/** Subject low, high, and in the middle with a band either side too small for the whole reveal (the split case). */
const LOW = subjectAt(1000, 1500);
const HIGH = subjectAt(300, 800);
const MIDDLE = subjectAt(500, 1150);
const CASES: Array<{ data: RoaQuestionData | RoaRevealData; placed: AvoidResult['placed'] }> = [
  { data: question(LOW), placed: 'top' },
  { data: question(HIGH), placed: 'bottom' },
  { data: reveal(LOW), placed: 'top' },
  { data: reveal(HIGH), placed: 'bottom' },
  { data: reveal(MIDDLE), placed: 'split' },
  { data: question({ top: 300, bottom: 1500, left: 960, right: 1080 }), placed: 'clear' },
];
const frames: Frame[] = CASES.map((c) => ({ backdrop: 'black', photo: c.data.photo, data: c.data }) as unknown as Frame);

test('render: every stack lands in the empty space, none on the subject, and the renderer reports no problem', { timeout: 180_000 }, async () => {
  assert.ok(Math.max(MIDDLE.top - SUBJECT_PAD - TEXT_BAND.top, TEXT_BAND.bottom - MIDDLE.bottom - SUBJECT_PAD) < 500, 'the middle case cannot take the reveal whole');
  const renderer = await openRenderer();
  try {
    await fsp.rm(OUT, { recursive: true, force: true });
    const result = await renderer.render(frames, { outDir: OUT, name: 'avoid' });
    for (const f of result.frames) assert.deepEqual(f.problems, [], `frame ${f.index} (${f.role})`);
  } finally {
    await renderer.close();
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: FRAME_W, height: FRAME_H } });
    await page.addInitScript(() => {
      (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    });
    const html = await framesHtml(frames);
    const ASSETS = path.join(process.cwd(), 'lib/stories/render/assets');
    await page.route('http://stories.local/**', async (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p === '/__frames') return route.fulfill({ body: html, contentType: 'text/html' });
      const file = p.startsWith('/__assets/') ? path.join(ASSETS, path.basename(p)) : p.startsWith('/__local/') ? path.resolve(process.cwd(), p.slice(9)) : null;
      try {
        if (!file || !file.startsWith(process.cwd() + path.sep)) throw new Error('outside');
        await route.fulfill({ body: await fsp.readFile(file) });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    });
    await page.route(/^(?!http:\/\/stories\.local\/).*/, (route) => route.abort());
    await page.goto('http://stories.local/__frames', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await Promise.all(['700 40px "Pragmatica Extended"', '500 40px Roboto', '400 40px Roboto'].map((f) => document.fonts.load(f)));
      await document.fonts.ready;
    });
    await page.evaluate(`[...document.querySelectorAll('.st-host')].map((h) => (${fitText.toString()})(h))`);
    const placed = (await page.evaluate(`[...document.querySelectorAll('.st-host')].map((h) => (${avoidSubject.toString()})(h))`)) as AvoidResult[][];
    assert.deepEqual(placed.map((p) => p[0]?.placed), CASES.map((c) => c.placed));

    // Every block of every stack, in frame pixels: none overlaps its subject (the clear case shares no column).
    type R = { top: number; bottom: number; left: number; right: number };
    const blocks = (await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.st-host')].map((host) => {
        const hb = host.getBoundingClientRect();
        return [...host.querySelectorAll<HTMLElement>('.rs-stack > *')].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top - hb.top, bottom: r.bottom - hb.top, left: r.left - hb.left, right: r.right - hb.left };
        });
      }),
    )) as R[][];
    for (const [i, c] of CASES.entries()) {
      const s = c.data.subject!;
      for (const b of blocks[i]!) {
        const hits = b.left < s.right && s.left < b.right && b.top < s.bottom && s.top < b.bottom;
        assert.ok(!hits, `case ${i + 1} (${c.placed}): a block at ${Math.round(b.top)}–${Math.round(b.bottom)} covers the subject ${s.top}–${s.bottom}`);
        assert.ok(b.top >= TEXT_BAND.top - 1 && b.bottom <= TEXT_BAND.bottom + 1, `case ${i + 1}: inside the band`);
      }
    }
  } finally {
    await browser.close();
  }
});
