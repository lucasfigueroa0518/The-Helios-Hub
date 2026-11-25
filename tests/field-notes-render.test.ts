/**
 * Field Notes render (CONTRACT-v4 section 6): plain white text over a gently darkened photo, the readability
 * check, Hershey hand lines, the cover moving off faces, and the fit checks.
 * Offline: synthetic photos made in code (tests/fixtures/field-notes/render/synthetic.ts), faces
 * stubbed, no model, no network, no database. Rendering uses Playwright Chromium, as fit-check does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import type { Browser } from 'playwright';

import {
  OFF_BLACK_HEX, WHITE_HEX, COVER_HAND_TEXT, COVER_NO_FACE, FOLLOW_HAND_TEXT, MAX_SHIFT_RATIO, HERSHEY_SANS,
  applyDarkenRaw, buildSlideHtml, colorPasses, contrastRatio, createMediaPipeDetectFaces, darkenAt, darkenSamples, decodeRaw,
  faceBoxesToRects, faceZone, fitProblemStrings, handStrokes, handSvg, handwriteWidth, lumStats, minSizes, planSlide, preparePhoto,
  rectsOverlap, relativeLuminance, renderSlide, sampleRegion, slideSeed, storeFieldNotesJpegs, tipBody, withBrowser, withCode,
  TIP_HEADLINE_MAX_LINES, colorContrast, contrastBands, expandRect, hexLuminance, stackGeometry, textWidthPx, wrapLines, SAMPLE_PAD,
  type SlideInput, type SlideLayout,
} from '@/lib/field-notes/render';
import { draftToSlideInputs, layoutsToSlides } from '@/lib/field-notes/post';
import { FOLLOW_HANDLE, type Rect } from '@/lib/field-notes/types';

import {
  CENTRE_BAND, FACE_BOX, brightBusyPhoto, brightPhoto, brightSkyPhoto, centreBusyPhoto, darkPhoto, darkWithFace, exifRotatedPhoto, midPhoto, whitePhoto,
} from './fixtures/field-notes/render/synthetic';

const OUT_DIR = process.env.FIELD_NOTES_RENDER_OUT ?? path.join(os.tmpdir(), 'field-notes-render-samples');

const TIP = {
  headline: 'Placeholder value line for the reader',
  body: 'PLACEHOLDER: a plain sentence on what the thing is, naming it once, for someone who has never heard of it.',
};

/** A value headline at its cap shape: 8 words, about 60 characters. */
const LONG_HEADLINE = 'Placeholder headline that runs eight words and wraps';

/** Packed RGB samples of a flat colour. */
function flat(r: number, g: number, b: number, n = 2000): Uint8Array {
  const a = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b; }
  return a;
}

// ── contrast and darkening (pure) ───────────────────────────────────────────

test('contrast math matches WCAG; off-black is never pure black', () => {
  assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.notEqual(OFF_BLACK_HEX, '#000000');
});

test('darkening: a black overlay scales the samples and raises white contrast; a mid-tone needs only a little', () => {
  const mid = flat(122, 122, 122);
  assert.ok(!colorPasses(mid, WHITE_HEX, { large: false }).ok, 'white on gray 122 is under 4.5:1');
  assert.ok(colorPasses(darkenSamples(mid, 0.15), WHITE_HEX, { large: false }).ok, 'a 15% overlay is enough');
  assert.deepEqual([...darkenSamples(flat(200, 100, 0, 1), 0.5)], [100, 50, 0]);
});

test('darkening: feathered, not a box (full inside the core, smooth fall to zero across the feather)', () => {
  const zone = { core: { x: 100, y: 100, w: 200, h: 100 }, feather: 100 };
  assert.equal(darkenAt(200, 150, zone, 0.4), 0.4);
  const a = darkenAt(320, 150, zone, 0.4);
  const b = darkenAt(360, 150, zone, 0.4);
  assert.ok(a < 0.4 && b < a && b > 0, `fades: ${a} then ${b}`);
  assert.equal(darkenAt(401, 150, zone, 0.4), 0);
  const raw = { data: new Uint8Array(500 * 300 * 3).fill(200), width: 500, height: 300, channels: 3 as const };
  const out = applyDarkenRaw(raw, zone, 0.5);
  assert.equal(out.data[(150 * 500 + 200) * 3], 100);
  assert.equal(out.data[(150 * 500 + 450) * 3], 200);
});

// ── Hershey Sans ────────────────────────────────────────────────────────────

test('hand: Hershey glyphs are ported with their attribution, drawn as round-capped pen lines, deterministic', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/field-notes/render/hershey-sans.ts'), 'utf8');
  assert.match(src, /Dr\. A\. V\. Hershey/);
  assert.match(src, /hersheytext 2\.0\.0, MIT/);
  assert.ok(HERSHEY_SANS['f'] && HERSHEY_SANS['@'] && HERSHEY_SANS['('], 'lowercase and punctuation are there');
  const h = handStrokes(COVER_HAND_TEXT, 58);
  assert.ok(h.strokes.length > 10 && h.ink.w > 200 && h.ink.h > 40);
  assert.ok(handwriteWidth('ab', 58) > handwriteWidth('a', 58));
  const svg = handSvg(COVER_HAND_TEXT, 58, { x: 100, y: 100, w: h.ink.w, h: h.ink.h }, WHITE_HEX, '0');
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /feTurbulence[^>]*seed="4"/, 'the kit wobble, frozen at its seed');
  assert.equal(svg, handSvg(COVER_HAND_TEXT, 58, { x: 100, y: 100, w: h.ink.w, h: h.ink.h }, WHITE_HEX, '0'));
  assert.ok(!fs.readdirSync(path.join(process.cwd(), 'lib/field-notes/render')).some((f) => /pack|marks/.test(f)), 'pack.ts and marks.ts are gone');
  const fonts = fs.readdirSync(path.join(process.cwd(), 'lib/field-notes/render/assets/fonts'));
  assert.ok(!fonts.some((f) => /kalam|caveat|patrick/i.test(f)), fonts.join(','));
});

test('tip body: whitespace collapsed, backticks kept (they mark code for the monospace style)', () => {
  assert.equal(tipBody('  Does   a thing.\n Run `x` once. '), 'Does a thing. Run `x` once.');
  assert.equal(tipBody(undefined), '');
});

test('code in body text: backticked spans become monospace code, never bare backticks; measured wider than prose', () => {
  const html = renderToStaticMarkup(React.createElement('div', null, withCode('Run `npx thing --flag` once.')));
  assert.equal(html, '<div>Run <code class="fn-code">npx thing --flag</code> once.</div>');
  assert.equal(withCode('No code here.'), 'No code here.');
  assert.ok(textWidthPx('`iiiiii`', 40, 'body') > textWidthPx('iiiiii', 40, 'body'), 'monospace i is wider than Roboto i');
  assert.equal(textWidthPx('`ab`', 40, 'body'), textWidthPx('ab', 40, 'body', 0, true), 'backticks are not drawn');
  // A code span that wraps keeps its monospace width on the next line.
  const lines = wrapLines('Plain words then `a b c d e f g h i j k l m n o p` after', 40, 'body', 300);
  assert.ok(lines.length > 1);
});

test('faces: normalised fit-check boxes convert to canvas pixels', () => {
  assert.deepEqual(faceBoxesToRects([{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }]), [{ x: 540, y: 675, w: 108, h: 135 }]);
});

// ── renderer ────────────────────────────────────────────────────────────────

let browser: Browser;
let closeBrowser: () => void;
before(async () => {
  await new Promise<void>((ready) => {
    void withBrowser(async (b) => {
      browser = b;
      ready();
      await new Promise<void>((done) => { closeBrowser = done; });
    });
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
});
after(() => closeBrowser?.());

async function renderOne(name: string, input: SlideInput, faces: Rect[] = [], darkenCap?: number) {
  const layout = await planSlide(input, { detectFaces: async () => faces, ...(darkenCap !== undefined ? { darkenCap } : {}) });
  const rendered = await renderSlide(layout, { browser, slideNumber: 1 });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.jpg`), rendered.jpeg);
  return { layout, rendered };
}

async function assertSize(buf: Buffer, format: 'png' | 'jpeg') {
  const m = await sharp(buf).metadata();
  assert.equal(m.format, format);
  assert.equal(m.width, 1080);
  assert.equal(m.height, 1350);
}

/** Re-measure each block's white contrast on the rendered (darkened) backdrop, independent of the checks module. */
async function assertRenderedContrast(layout: SlideLayout, backdropPng: Buffer) {
  const backdrop = await decodeRaw(backdropPng);
  for (const b of layout.blocks) {
    const c = colorPasses(sampleRegion(backdrop, b.region), b.color, { large: b.large });
    assert.ok(c.mean >= c.required * 0.97, `${b.role} ${b.color}: contrast ${c.mean.toFixed(2)} < ${c.required}`);
  }
}

test('tip: one left-aligned block (headline then one paragraph), centred, white, no marks or arrows', async () => {
  const { layout, rendered } = await renderOne('tip-dark', { kind: 'tip', photo: await darkPhoto(), ...TIP, seed: 't' });
  await assertSize(rendered.png, 'png');
  await assertSize(rendered.jpeg, 'jpeg');
  assert.deepEqual(rendered.problems, [], fitProblemStrings(rendered.problems).join('\n'));
  assert.equal(layout.placementFailed, false);
  assert.deepEqual(layout.blocks.map((b) => [b.role, b.family]), [['headline', 'heading'], ['body', 'body']]);
  assert.equal(layout.blocks[1]!.text, tipBody(TIP.body));
  assert.ok(layout.blocks.every((b) => b.fill === 'white' && b.color === WHITE_HEX));
  // Left-aligned: both blocks start at the same x. Centred: the block's middle sits on the canvas middle.
  const [h, body] = layout.blocks;
  assert.equal(h!.region.x, body!.region.x);
  assert.equal(layout.shiftY, 0);
  const box = { x0: Math.min(h!.region.x), x1: Math.max(h!.region.x + h!.region.w, body!.region.x + body!.region.w), y0: h!.region.y, y1: body!.region.y + body!.region.h };
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - 540) <= 4, `x centre ${(box.x0 + box.x1) / 2}`);
  assert.ok(Math.abs((box.y0 + box.y1) / 2 - 675) <= 4, `y centre ${(box.y0 + box.y1) / 2}`);
  const left = rendered.measure.blocks.map((m) => m.box.x);
  assert.ok(Math.abs(left[0]! - left[1]!) < 10, `measured left edges ${left.join(', ')}`);
  const html = await buildSlideHtml(layout);
  assert.match(html, /text-align: left/);
  assert.ok(!/<path/.test(html), 'no strokes on a tip slide (no arrows, circles or underlines)');
  assert.ok(!('marks' in layout) && !('marks' in rendered), 'there are no marks any more');
  assert.ok(layout.blocks[0]!.fontPx >= minSizes('tip').headline && layout.blocks[1]!.fontPx >= minSizes('tip').body);
  await assertRenderedContrast(layout, rendered.backdropPng);
});

test('tip: an 8-word value headline wraps to at most 3 lines at a large size and renders legibly with its body', async () => {
  const input: SlideInput = { kind: 'tip', photo: await darkPhoto(), headline: LONG_HEADLINE, body: TIP.body, seed: 'long' };
  const { layout, rendered } = await renderOne('tip-long-headline', input);
  assert.deepEqual(rendered.problems, [], fitProblemStrings(rendered.problems).join('\n'));
  const [head, body] = layout.blocks;
  assert.equal(head!.role, 'headline');
  assert.equal(TIP_HEADLINE_MAX_LINES, 3);
  assert.ok(head!.lines >= 2 && head!.lines <= TIP_HEADLINE_MAX_LINES, `planned ${head!.lines} lines`);
  assert.ok(head!.fontPx >= 54, `headline stays large: ${head!.fontPx}px`);
  assert.ok(head!.fontPx > body!.fontPx * 1.2, 'the headline leads the body');
  // The browser agrees: the rendered headline is at most 3 lines tall, and no word overflows.
  const m = rendered.measure.blocks.find((x) => x.index === 0)!;
  const lineH = head!.fontPx * head!.lineHeight;
  // Pragmatica's glyph box overhangs its line box a little, so 3 lines measure under 3.5 line heights (4 would be over 3.9).
  assert.ok(m.box.h < lineH * (TIP_HEADLINE_MAX_LINES + 0.5), `rendered headline ${m.box.h}px for ${lineH}px lines`);
  assert.ok(m.box.h > lineH * 1.2, 'it does wrap');
  assert.ok(!rendered.measure.blocks.some((x) => x.overflows));
  assert.equal(head!.region.x, body!.region.x, 'one left-aligned block');
  await assertRenderedContrast(layout, rendered.backdropPng);
});

test('tip: backticked code left in the body renders in monospace, not as backticks', async () => {
  const { layout, rendered } = await renderOne('tip-code', { kind: 'tip', photo: await darkPhoto(), headline: 'Placeholder value line', body: 'PLACEHOLDER: a plain sentence, then `placeholder --flag` as code.', seed: 'code' });
  assert.deepEqual(rendered.problems, [], fitProblemStrings(rendered.problems).join('\n'));
  const html = await buildSlideHtml(layout);
  assert.match(html, /<code class="fn-code">placeholder --flag<\/code>/);
  assert.ok(!/`/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'no backtick is drawn');
  assert.match(html, /\.fn-code \{ font-family: Menlo/);
});

test('contrast: a bright busy photo raises darken step by step until the readability check passes', async () => {
  const { layout, rendered } = await renderOne('tip-bright-busy', { kind: 'tip', photo: await brightBusyPhoto(), ...TIP, seed: 'bb' }, [], 0.6);
  const steps = layout.darken.steps;
  assert.ok(steps.length >= 3, `steps ${JSON.stringify(steps)}`);
  assert.equal(steps[0]!.ok, false, 'the floor is not enough on a bright photo');
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i]!.darken > steps[i - 1]!.darken, 'darken only rises');
    assert.ok(steps[i]!.contrast > steps[i - 1]!.contrast, 'contrast rises with it');
  }
  assert.equal(steps[steps.length - 1]!.ok, true);
  assert.equal(layout.placementFailed, false);
  assert.ok(layout.blocks.every((b) => b.darken === layout.darken.value && b.darken > 0.3));
  assert.deepEqual(rendered.problems.filter((p) => p.kind === 'low_contrast'), [], fitProblemStrings(rendered.problems).join('\n'));
  await assertRenderedContrast(layout, rendered.backdropPng);
  // The overlay is baked into the photo under the block and fades out away from it.
  const base = layout.basePhoto.raw;
  const dark = layout.photo.raw;
  const at = (img: typeof base, x: number, y: number) => img.data[(y * 1080 + x) * 3]!;
  const cx = Math.round(layout.blocks[1]!.region.x + 40);
  const cy = Math.round(layout.blocks[1]!.region.y + 20);
  assert.ok(at(dark, cx, cy) < at(base, cx, cy) * 0.75);
  assert.equal(at(dark, 5, 5), at(base, 5, 5), 'the corner is untouched');
});

test('contrast: a calm dark photo gets only the gentle floor', async () => {
  const layout = await planSlide({ kind: 'tip', photo: await darkPhoto(), ...TIP });
  assert.equal(layout.darken.steps.length, 1);
  assert.equal(layout.darken.value, 0.1);
});

test('contrast: unreadable even at darkenCap fails with the photo-swap reason', async () => {
  const layout = await planSlide({ kind: 'tip', photo: await whitePhoto(), ...TIP }, { darkenCap: 0.3 });
  assert.equal(layout.placementFailed, true);
  assert.equal(layout.failReason, 'no_calm_region');
  assert.equal(layout.darken.value, 0.3);
  assert.ok(layout.problems.some((p) => p.kind === 'no_calm_region' && /cap 0.3/.test(p.message)));
  const mid = await planSlide({ kind: 'tip', photo: await midPhoto(), ...TIP }, { darkenCap: 0.3 });
  assert.equal(mid.placementFailed, false, 'a mid-tone passes with a little darkening');
});

// The post of 2026-11-08 (slide 3): "body #FFFFFF on the rendered photo: mean contrast 4.30, worst 3.03, needs 4.5".
const SKY_TIP = {
  headline: 'Placeholder value line that wraps to three lines',
  body: 'PLACEHOLDER body that runs to about thirty words: a plain account of what the thing is, naming it once, for a stranger who has never heard of it before today.',
};

test('contrast agreement: on a bright sky the planner measures every line band, so a slide it passes also passes the rendered-pixel check', async () => {
  const { layout, rendered } = await renderOne('tip-bright-sky', { kind: 'tip', photo: await brightSkyPhoto(220), ...SKY_TIP, seed: 'sky' }, [], 0.45);
  // The old measure (the whole estimated block region) called the centred block readable at the cap, while a band of it
  // is not: that gap is what shipped a low-contrast slide.
  const base = layout.basePhoto.raw;
  const items = [{ role: 'headline' as const, text: SKY_TIP.headline }, { role: 'body' as const, text: SKY_TIP.body }];
  const geo = stackGeometry('tip', items, { headline: layout.blocks[0]!.fontPx, body: layout.blocks[1]!.fontPx });
  const x = Math.round((1080 - geo.width) / 2);
  const y0 = Math.round((1350 - geo.height) / 2);
  const bodyRect = { x, y: y0 + geo.items[1]!.rect.y, w: geo.items[1]!.rect.w, h: geo.items[1]!.rect.h };
  const whole = colorContrast(lumStats(darkenSamples(sampleRegion(base, expandRect(bodyRect, SAMPLE_PAD)), 0.45)), hexLuminance(WHITE_HEX), false);
  assert.ok(whole.ok, `the old whole-region measure passed: ${whole.mean.toFixed(2)}`);
  const bands = contrastBands(geo, { x, y: y0 })[1]!.map((r) => colorContrast(lumStats(darkenSamples(sampleRegion(base, expandRect(r, SAMPLE_PAD)), 0.45)), hexLuminance(WHITE_HEX), false));
  assert.ok(bands.some((c) => !c.ok), `a body line at the centre does not read at the cap: ${bands.map((c) => c.mean.toFixed(2)).join(', ')}`);
  // The planner raised darken to the cap (never past it), then moved the block within the 15% band to where it reads.
  assert.equal(layout.darken.value, 0.45);
  assert.ok(layout.darken.steps.every((s) => s.darken <= 0.45));
  assert.equal(layout.placementFailed, false, layout.problems.map((p) => p.message).join('; '));
  assert.ok(layout.shiftY > 0 && layout.shiftY <= Math.round(1350 * MAX_SHIFT_RATIO), `shift ${layout.shiftY}`);
  assert.ok(layout.notes.some((n) => /did not read .* even at the darken cap 0.45/.test(n)), layout.notes.join('; '));
  // And the rendered check agrees.
  assert.deepEqual(rendered.problems.filter((p) => p.kind === 'low_contrast'), [], fitProblemStrings(rendered.problems).join('\n'));
});

test('contrast agreement: across sky brightnesses, planned-readable always means rendered-readable; too bright fails with the photo-swap reason', async () => {
  for (const top of [200, 210, 225, 235]) {
    const { layout, rendered } = await renderOne(`tip-sky-${top}`, { kind: 'tip', photo: await brightSkyPhoto(top), ...SKY_TIP, seed: `sky${top}` }, [], 0.45);
    const low = rendered.problems.filter((p) => p.kind === 'low_contrast');
    if (!layout.placementFailed) assert.deepEqual(low, [], `top ${top}: ${fitProblemStrings(rendered.problems).join('; ')}`);
    else assert.equal(layout.failReason, 'no_calm_region', `top ${top}`);
  }
  // Blown-out sky everywhere in the band: unreadable at the cap, so the slide fails and the run swaps the photo.
  const blown = await planSlide({ kind: 'tip', photo: await brightSkyPhoto(300), ...SKY_TIP }, { darkenCap: 0.45, detectFaces: async () => [] });
  assert.equal(blown.placementFailed, true);
  assert.equal(blown.failReason, 'no_calm_region');
  assert.equal(blown.darken.value, 0.45);
  assert.ok(blown.problems.some((p) => p.kind === 'no_calm_region' && /cap 0.45/.test(p.message)));
});

test('tip: the block shifts (at most 15% of the height) only when the centre is clearly busier', async () => {
  const layout = await planSlide({ kind: 'tip', photo: await centreBusyPhoto(), headline: 'Placeholder', body: 'PLACEHOLDER short line. Then one more.' });
  assert.notEqual(layout.shiftY, 0, 'a busy band across the centre moves the block');
  assert.ok(Math.abs(layout.shiftY) <= Math.round(1350 * MAX_SHIFT_RATIO));
  const top = layout.blocks[0]!.region.y;
  const bottom = layout.blocks[layout.blocks.length - 1]!.region.y + layout.blocks[layout.blocks.length - 1]!.region.h;
  const overlap = Math.max(0, Math.min(bottom, CENTRE_BAND.y1) - Math.max(top, CENTRE_BAND.y0));
  assert.ok(overlap <= 0.2 * (bottom - top), `block ${top}-${bottom} mostly off the band (${overlap}px on it)`);
  const calm = await planSlide({ kind: 'tip', photo: await brightPhoto(), ...TIP });
  assert.equal(calm.shiftY, 0, 'a calm photo keeps the centre');
});

test('cover: hand "field notes" above the Pragmatica headline; Hershey strokes render; block clear of the face', async () => {
  const { layout, rendered } = await renderOne('cover-face', { kind: 'cover', photo: await darkWithFace(), headline: '3 AI tips to try', seed: 'c' }, [FACE_BOX]);
  assert.deepEqual(rendered.problems, [], fitProblemStrings(rendered.problems).join('\n'));
  assert.deepEqual(layout.blocks.map((b) => [b.role, b.text, b.family]), [['hand', COVER_HAND_TEXT, 'hand'], ['headline', '3 AI tips to try', 'heading']]);
  const [hand, head] = layout.blocks;
  assert.ok(hand!.region.y + hand!.region.h <= head!.region.y, 'hand line above the headline');
  assert.ok(Math.abs(hand!.region.x - head!.region.x) < 2, 'left-aligned together');
  for (const b of layout.blocks) assert.ok(!rectsOverlap(b.region, faceZone(FACE_BOX)), `${b.role} avoids the face`);
  for (const m of rendered.measure.blocks) assert.ok(!rectsOverlap(m.box, FACE_BOX), `measured block ${m.index} avoids the face`);
  // Hershey renders: the pen strokes are in the page and the pixels under the hand line got lighter than the backdrop.
  const html = await buildSlideHtml(layout);
  assert.match(html, /data-hand="field notes"/);
  const handBox = rendered.measure.blocks.find((m) => m.index === 0)!.box;
  assert.ok(handBox.w > 150 && handBox.h > 30, `hand box ${JSON.stringify(handBox)}`);
  const [png, bg] = await Promise.all([decodeRaw(rendered.png), decodeRaw(rendered.backdropPng)]);
  assert.ok(lumStats(sampleRegion(png, handBox)).mean > lumStats(sampleRegion(bg, handBox)).mean * 1.5, 'white pen strokes are drawn');
  await assertRenderedContrast(layout, rendered.backdropPng);
});

test('cover: a face in the middle pushes the block above or below it, never over it', async () => {
  const centreFace = { x: 400, y: 520, w: 280, h: 320 };
  for (const face of [centreFace, { x: 380, y: 300, w: 300, h: 340 }, { x: 380, y: 760, w: 300, h: 340 }]) {
    const layout = await planSlide({ kind: 'cover', photo: await darkPhoto(), headline: '4 AI tips to try' }, { detectFaces: async () => [face] });
    assert.equal(layout.placementFailed, false, JSON.stringify(face));
    const top = layout.blocks[0]!.region.y;
    const last = layout.blocks[layout.blocks.length - 1]!;
    const bottom = last.region.y + last.region.h;
    const zone = faceZone(face);
    assert.ok(bottom <= zone.y || top >= zone.y + zone.h, `block ${top}-${bottom} is above or below the face zone ${zone.y}-${zone.y + zone.h}`);
  }
  // Faces that leave no room above or below: the cover fails so the photo is swapped.
  const crowded = await planSlide({ kind: 'cover', photo: await darkPhoto(), headline: '3 AI tips to try' }, { detectFaces: async () => [{ x: 400, y: 150, w: 280, h: 300 }, { x: 400, y: 560, w: 280, h: 300 }, { x: 400, y: 950, w: 280, h: 300 }] });
  assert.equal(crowded.placementFailed, true);
  assert.equal(crowded.failReason, 'no_calm_region');
});

test('cover: no detected face fails with the stable reason cover_no_face (so the photo-swap loop retries)', async () => {
  const input: SlideInput = { kind: 'cover', photo: await darkPhoto(), headline: '3 AI tips to try', seed: 'nf' };
  const layout = await planSlide(input, { detectFaces: async () => [] });
  assert.equal(layout.placementFailed, true);
  assert.equal(layout.failReason, COVER_NO_FACE);
  assert.equal(COVER_NO_FACE, 'cover_no_face');
  assert.ok(layout.problems.some((p) => p.kind === 'cover_no_face'));
  assert.equal((await planSlide(input)).failReason, COVER_NO_FACE);
  const tip = await planSlide({ kind: 'tip', photo: await darkPhoto(), ...TIP }, { detectFaces: async () => [] });
  assert.equal(tip.placementFailed, false);
});

test('follow: the hand line and the handle, centred, no logo, same contrast treatment', async () => {
  const { layout, rendered } = await renderOne('follow', { kind: 'follow', photo: await brightPhoto(), seed: 'f' });
  assert.deepEqual(rendered.problems, [], fitProblemStrings(rendered.problems).join('\n'));
  assert.deepEqual(layout.blocks.map((b) => [b.role, b.text]), [['hand', FOLLOW_HAND_TEXT], ['headline', FOLLOW_HANDLE]]);
  assert.equal(FOLLOW_HAND_TEXT, 'follow for more field notes');
  assert.equal(layout.logo, null, 'no logo on Follow (Tommy, 2026-11-06)');
  assert.ok(layout.darken.value > 0.1, 'a bright photo is darkened behind the text');
  const box = { y0: layout.blocks[0]!.region.y, y1: layout.blocks[1]!.region.y + layout.blocks[1]!.region.h };
  assert.ok(Math.abs((box.y0 + box.y1) / 2 - 675) <= 4);
  await assertRenderedContrast(layout, rendered.backdropPng);
});

// ── checks ──────────────────────────────────────────────────────────────────

test('checks: white text forced onto a bright photo with no darkening fails the rendered-pixel contrast check', async () => {
  const layout = await planSlide({ kind: 'tip', photo: await brightPhoto(), ...TIP });
  const forced: SlideLayout = { ...layout, photo: layout.basePhoto, problems: [] };
  const r = await renderSlide(forced, { browser, slideNumber: 2 });
  assert.ok(r.problems.some((p) => p.kind === 'low_contrast' && p.slide === 2), fitProblemStrings(r.problems).join('\n'));
});

test('checks: cover text moved onto a face is caught', async () => {
  const layout = await planSlide({ kind: 'cover', photo: await darkWithFace(), headline: '3 AI tips to try' }, { detectFaces: async () => [FACE_BOX] });
  const moved: SlideLayout = { ...layout, blocks: layout.blocks.map((b) => ({ ...b, region: { ...b.region, x: FACE_BOX.x - 40, y: FACE_BOX.y + 40 } })) };
  const r = await renderSlide(moved, { browser });
  assert.ok(r.problems.some((p) => p.kind === 'face_overlap'));
});

test('checks: text too long at the minimum size is reported, not shrunk; exclamation marks and emoji are flagged', async () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const layout = await planSlide({ kind: 'tip', photo: await darkPhoto(), headline: 'Name', body: `${long} ${long}` });
  assert.ok(layout.problems.some((p) => p.kind === 'too_long'));
  assert.equal(layout.blocks[1]!.fontPx, minSizes('tip').body);
  const bad = await planSlide({ kind: 'tip', photo: await darkPhoto(), headline: 'Wow!', body: 'Nice 🎉 Do it.' });
  assert.equal(bad.problems.filter((p) => p.kind === 'forbidden_text').length, 2);
});

test('render: EXIF-rotated photo is oriented, cover-fitted and stripped of metadata', async () => {
  const p = await preparePhoto(await exifRotatedPhoto());
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1350);
  const px = (x: number, y: number) => [0, 1, 2].map((c) => p.raw.data[(y * 1080 + x) * 3 + c]!);
  assert.ok(px(540, 100)[0]! < 80, 'top is the dark side after rotation');
  assert.ok(px(540, 1250)[0]! > 150, 'bottom is the red side');
  assert.equal((await sharp(p.jpeg).metadata()).exif, undefined);
});

test('render: the default MediaPipe detector loads offline and finds no face in synthetic photos', async () => {
  const detect = createMediaPipeDetectFaces(browser);
  assert.deepEqual(await detect((await preparePhoto(await darkPhoto())).jpeg), []);
});

test('render: JPEGs are stored as slide-NN.jpg under the slug, in order', async () => {
  const uploaded: string[] = [];
  const paths = await storeFieldNotesJpegs('post-1', [Buffer.from('a'), Buffer.from('b')], { upload: async (p) => { uploaded.push(p); }, prefix: 'field-notes' });
  assert.deepEqual(paths, ['field-notes/post-1/slide-01.jpg', 'field-notes/post-1/slide-02.jpg']);
  assert.deepEqual(uploaded, paths);
});

test('layout seed: the seed comes from the input, else from the photo id, kind and headline', () => {
  assert.equal(slideSeed({ kind: 'tip', photo: Buffer.alloc(0), seed: 7 }), '7');
  assert.equal(slideSeed({ kind: 'tip', photo: Buffer.alloc(0), photoId: 'p', headline: 'Name' }), 'p:tip:Name');
});

// ── post mappers ────────────────────────────────────────────────────────────

test('post: draftToSlideInputs makes 1 cover + N tip + 1 follow from the new DraftSlide (no emphasis)', () => {
  const photo = (id: string) => ({ photoId: id, bytes: Buffer.alloc(0) });
  const draft = { slides: [1, 2, 3].map((n) => ({ kind: 'tip' as const, headline: `Value ${n}`, body: `Body ${n}.`, name: `Tool ${n}`, tryIt: `\`run ${n}\``, tipId: `t${n}` })), caption: 'c' };
  const inputs = draftToSlideInputs({ draft, photos: ['c', 'a', 'b', 'd', 'f'].map(photo) });
  assert.deepEqual(inputs.map((i) => i.kind), ['cover', 'tip', 'tip', 'tip', 'follow']);
  assert.deepEqual(inputs.map((i) => i.photoId), ['c', 'a', 'b', 'd', 'f']);
  assert.equal(inputs[0]!.headline, '3 AI tips to try');
  assert.deepEqual([inputs[1]!.headline, inputs[1]!.body], ['Value 1', 'Body 1.']);
  assert.ok(!('emphasis' in inputs[1]!));
  for (const input of inputs) assert.ok(!('name' in input) && !('tryIt' in input) && !JSON.stringify(input).includes('Tool '), 'name and tryIt never reach the slide');
  assert.equal(new Set(inputs.map((i) => i.seed)).size, 5);
  assert.equal(draftToSlideInputs({ draft, photos: ['c', 'a', 'b', 'd', 'f'].map(photo), coverHeadline: 'Three tips' })[0]!.headline, 'Three tips');
  assert.throws(() => draftToSlideInputs({ draft, photos: ['c', 'a', 'b', 'f'].map(photo) }), /needs 5 photos/);
});

test('post: layoutsToSlides stores blocks with role, region, fill and darken; no marks', async () => {
  const layout = await planSlide({ kind: 'tip', photo: await brightPhoto(), ...TIP });
  const [slide] = layoutsToSlides([layout]);
  assert.equal(slide!.kind, 'tip');
  assert.deepEqual(slide!.blocks.map((b) => b.role), ['headline', 'body']);
  assert.ok(slide!.blocks.every((b) => b.fill === 'white' && b.darken === layout.darken.value));
  assert.ok(!('marks' in slide!));
});
