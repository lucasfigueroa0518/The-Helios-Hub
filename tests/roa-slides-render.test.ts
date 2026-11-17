/**
 * Real or AI? slides (planning/Real or AI/CONTRACT.md §5 B): the markup's element counts, the payoff rule (RA-26),
 * and a real render through the Stories still renderer (headless Chromium, local files only, no network, no model):
 * 1080×1920 JPEGs ≤ 8 MB, the renderer's own checks (fit, bounds, safe zones), and contrast judged the way AI Trivia's
 * preflight judges it. The fixture set lands in .stories-local/roa-fixture/ for a look.
 */
import assert from 'node:assert/strict';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { colorPasses, sampleRegion, type RawImage } from '@/lib/field-notes/render/contrast';
import { framesHtml, openRenderer } from '@/lib/stories/render/render';
import { fitText } from '@/lib/stories/render/text-fit';
import { FRAME_H, FRAME_W, MAX_JPEG_BYTES, type Frame } from '@/lib/stories/render/types';
import { cardOf, PROMPT_HEAD, QUESTION_ELEMENTS, REVEAL_ELEMENTS, roaCss } from '@/lib/stories/roa/render/RoaSlide';
import type { RoaQuestionData, RoaRevealData } from '@/lib/stories/roa/types';

const PHOTOS = 'lib/stories/render/fixtures/photos';
const OUT = path.join(process.cwd(), '.stories-local', 'roa-fixture');

const capitol = { src: `${PHOTOS}/capitol.jpg`, credit: 'Dllu, CC BY-SA 4.0', kind: 'scene' as const };
const datacenter = { src: `${PHOTOS}/datacenter.jpg`, credit: 'fixture', kind: 'scene' as const };
const hq = { src: `${PHOTOS}/openai_hq.jpg`, credit: 'fixture', kind: 'scene' as const };

const q = (round: 1 | 2, photo: RoaQuestionData['photo']): RoaQuestionData => ({ role: 'roa_question', round, photo });
/** RA-26: the three payoffs. */
const REAL_EFFORT: RoaRevealData = {
  role: 'roa_reveal', round: 1, photo: capitol, truth: 'real', payoff: 'effort',
  line: 'Twelve gilders spent a summer on scaffolding up there.', proof: 'Sacramento, 2018 · Dllu, CC BY-SA 4.0',
};
const REAL_CAMERA: RoaRevealData = {
  role: 'roa_reveal', round: 2, photo: datacenter, truth: 'real', payoff: 'camera',
  receipt: { head: 'Shot on', rows: ['Nikon D7200', '390 mm · f/8 · 1/640 s · ISO 100', 'April 2022 · Lake Nakuru, Kenya'] },
  proof: 'Kenya, 2022 · Jane Doe, CC BY-SA 4.0',
};
const AI_PROMPT: RoaRevealData = {
  role: 'roa_reveal', round: 1, photo: hq, truth: 'ai', payoff: 'prompt',
  prompt: 'A phone photo of an ordinary office building on a grey weekday afternoon, slightly crooked, a few parked cars, no people',
  proof: 'Made with gpt-image-2',
};

/** #RGB, #RRGGBB or rgb()/rgba() → #RRGGBB (the contrast check's ink). */
function cssToHex(c: string): string {
  if (c.startsWith('#')) return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}`.toUpperCase() : c.slice(0, 7).toUpperCase();
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c);
  if (!m) return '#FFFFFF';
  return `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The fixture set: one round per payoff. */
const DATA = [q(1, capitol), REAL_EFFORT, q(2, datacenter), REAL_CAMERA, q(1, hq), AI_PROMPT];
const asFrames = (ds: Array<RoaQuestionData | RoaRevealData>): Frame[] =>
  ds.map((data, i) => ({ series: 'real_or_ai', backdrop: 'black', style: 'polished', index: i + 1, total: ds.length, data }) as unknown as Frame);

/** data-el values per host, in document order. */
function elementsByHost(html: string): string[][] {
  return html
    .split('<div class="st-host"')
    .slice(1)
    .map((h) => [...h.matchAll(/data-el="([a-z]+)"/g)].map((m) => m[1]!));
}

test('question slide: exactly the photo and "Real or AI?"; reveal: verdict, one payoff, proof, in that order', async () => {
  const html = await framesHtml(asFrames(DATA));
  const hosts = elementsByHost(html);
  assert.equal(hosts.length, DATA.length);
  for (const [i, els] of hosts.entries()) {
    if (DATA[i]!.role === 'roa_question') assert.deepEqual(els, [...QUESTION_ELEMENTS], `frame ${i + 1}`);
    else for (const e of els) assert.ok((REVEAL_ELEMENTS as readonly string[]).includes(e), e);
  }
  assert.deepEqual(hosts[1], ['photo', 'verdict', 'line', 'proof']);
  assert.deepEqual(hosts[3], ['photo', 'verdict', 'card', 'proof']);
  assert.deepEqual(hosts[5], ['photo', 'verdict', 'card', 'proof']);
  assert.match(html, />Real or AI\?</);
  assert.match(html, />REAL</);
  assert.match(html, /tv-box--orange tv-text" data-ink="#FFFFFF">AI</);
  assert.match(html, />The prompt</);
  assert.match(html, />Shot on</);
  assert.match(html, />390 mm · f\/8 · 1\/640 s · ISO 100</);
  // No tells and no pen circle any more (RA-26); no credit line (the proof carries it); photos from the private origin.
  assert.doesNotMatch(html, /rs-ring|<svg/);
  assert.doesNotMatch(html, /class="st-credit"/);
  assert.doesNotMatch(html, /src="lib\/stories/);
});

test('RA-26: one payoff per reveal; a line only on effort, a card only on prompt or camera', async () => {
  assert.deepEqual(cardOf(AI_PROMPT), { head: PROMPT_HEAD, rows: [AI_PROMPT.prompt], typed: true });
  assert.deepEqual(cardOf(REAL_CAMERA), { head: 'Shot on', rows: REAL_CAMERA.receipt!.rows, typed: false });
  assert.equal(cardOf(REAL_EFFORT), null);
  const origin: RoaRevealData = { ...AI_PROMPT, payoff: 'origin', prompt: undefined, receipt: { head: 'Made with', rows: ['some-model', 'From the Example set dataset'] } };
  assert.deepEqual(cardOf(origin), { head: 'Made with', rows: origin.receipt!.rows, typed: false });
  // Stray fields never show: an effort reveal ignores a prompt, a camera reveal ignores a line.
  const html = await framesHtml(asFrames([
    { ...REAL_EFFORT, prompt: 'a prompt that must not show' },
    { ...REAL_CAMERA, line: 'a line that must not show' },
    { ...AI_PROMPT, line: 'nor this one' },
  ]));
  assert.deepEqual(elementsByHost(html), [['photo', 'verdict', 'line', 'proof'], ['photo', 'verdict', 'card', 'proof'], ['photo', 'verdict', 'card', 'proof']]);
  assert.doesNotMatch(html, /must not show|nor this one/);
  // Nothing to show: the reveal is the verdict and the proof.
  const bare = await framesHtml(asFrames([{ ...REAL_CAMERA, receipt: undefined }, { ...AI_PROMPT, prompt: undefined }]));
  assert.deepEqual(elementsByHost(bare), [['photo', 'verdict', 'proof'], ['photo', 'verdict', 'proof']]);
});

test("RA-25: the slide owns its styles and sets the Helios pair", () => {
  const css = roaCss();
  assert.doesNotMatch(css, /html, body|#root|^\* \{/m, 'no page-level rules');
  assert.doesNotMatch(css, /Bowlby|Inter/, 'no one-off faces');
  assert.match(css, /\.rs-label, \.rs-verdict \{ font-family: 'Pragmatica Extended'/);
  assert.match(css, /\.rs-frame \{[^}]*font-family: 'Roboto'/);
  assert.match(css, /\.rs-frame \.tv-box--orange \{/);
  assert.doesNotMatch(css, /rs-ring/, 'no pen circle (RA-26)');
  assert.doesNotMatch(readFileSync('lib/stories/roa/render/RoaSlide.tsx', 'utf8'), /trivia\.css/);
});

test('render: the fixture set renders to 1080×1920 JPEGs ≤ 8 MB and passes the renderer checks and contrast', { timeout: 180_000 }, async () => {
  const sharp = (await import('sharp')).default;
  const frames = asFrames(DATA);
  await fsp.rm(OUT, { recursive: true, force: true });
  const renderer = await openRenderer();
  try {
    const result = await renderer.render(frames, { outDir: OUT, name: 'roa' });
    assert.deepEqual(result.problems, []);
    for (const f of result.frames) assert.deepEqual(f.problems, [], `frame ${f.index} (${f.role})`);
    assert.ok(result.ok);
    assert.equal(result.frames.length, 6);
    for (const f of result.frames) {
      const meta = await sharp(f.jpeg).metadata();
      assert.equal(meta.format, 'jpeg');
      assert.equal(meta.width, FRAME_W);
      assert.equal(meta.height, FRAME_H);
      assert.ok(f.bytes <= MAX_JPEG_BYTES, `frame ${f.index} is ${f.bytes} bytes`);
      assert.ok(f.file && (await fsp.stat(f.file)).size === f.bytes);
    }
  } finally {
    await renderer.close();
  }

  // Contrast, AI Trivia's way (lib/stories/trivia/render/preflight.ts): text hidden, its box kept, the pixels behind
  // each line judged against its ink. Same page the renderer builds, same text fit.
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
    const fonts = await page.evaluate(async () => {
      await Promise.all(['700 40px "Pragmatica Extended"', '500 40px Roboto', '400 40px Roboto', '400 40px "Courier Prime"'].map((f) => document.fonts.load(f)));
      await document.fonts.ready;
      return ['700 40px "Pragmatica Extended"', '500 40px Roboto', '400 40px Roboto', '400 40px "Courier Prime"'].map((f) => document.fonts.check(f));
    });
    assert.deepEqual(fonts, [true, true, true, true], 'Pragmatica Extended, Roboto and Courier Prime loaded');
    await page.evaluate(`[...document.querySelectorAll('.st-host')].map((h) => (${fitText.toString()})(h))`);

    type Box = { host: number; text: string; px: number; ink: string; x: number; y: number; w: number; h: number };
    const boxes = (await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.st-host')].flatMap((host, i) => {
        const hb = host.getBoundingClientRect();
        return [...host.querySelectorAll<HTMLElement>('.tv-text')].flatMap((el) => {
          const cs = getComputedStyle(el);
          const rects = cs.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
          return rects.map((r) => ({ host: i, text: (el.textContent ?? '').trim(), px: parseFloat(cs.fontSize), ink: el.dataset.ink ?? cs.color, x: r.left - hb.left, y: r.top - hb.top, w: r.width, h: r.height }));
        });
      }),
    )) as Box[];
    assert.ok(boxes.length >= 14, `${boxes.length} text lines read`);
    await page.evaluate(() => document.body.classList.add('tv-hide-text'));
    const hosts = await page.$$('.st-host');
    const failures: string[] = [];
    for (const [i, host] of hosts.entries()) {
      const { data, info } = await sharp(await host.screenshot({ type: 'png' })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const img: RawImage = { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels as 3 };
      for (const bx of boxes.filter((x) => x.host === i && x.w > 2 && x.h > 2)) {
        const c = colorPasses(sampleRegion(img, { x: bx.x, y: bx.y, w: bx.w, h: bx.h }), cssToHex(bx.ink), { large: bx.px >= 40 });
        if (!c.ok) failures.push(`frame ${i + 1} "${bx.text.slice(0, 30)}" ${c.mean.toFixed(2)}:1 (worst ${c.worst.toFixed(2)}, needs ${c.required})`);
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
