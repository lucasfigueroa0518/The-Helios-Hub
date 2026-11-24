/**
 * The news-chain photo finder (lib/news-photos), offline: Haiku, Jev, page reads, Serper and image fetches are
 * stubbed with canned answers and tiny sharp-made images. No live calls.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import {
  BAND_H, BAND_W, decideBand, findStoryPhoto, fitToBand, pickOrder, tier, toJpeg,
  type GradedPhoto, type PhotoDeps, type PhotoStory,
} from '@/lib/news-photos';

const png = (w: number, h: number, r = 120) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 60 } } }).png().toBuffer();

type JevAns = { logo?: number; thumbnail?: number; overlay?: number; specific?: number; related?: number; clarity: number };
const jevAnswers = (a: JevAns) => ({
  answers: {
    logo: { noul: a.logo ?? 0.05 }, thumbnail: { noul: a.thumbnail ?? 0.05 }, overlay: { noul: a.overlay ?? 0.05 },
    specific: { noul: a.specific ?? 0.9 }, related: { noul: a.related ?? 0.9 }, clarity: { probabilities: { [String(a.clarity)]: 1 } },
  },
  usage: { input_tokens: 1000, output_tokens: 10 },
});

const message = (name: string, input: unknown) => ({
  id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
  content: [{ type: 'tool_use', id: 'tu_x', name, input }],
  usage: { input_tokens: 500, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

/** Haiku stub: the brief, and the AI check, which flags images whose width is in `aiWidths`. */
function haiku(aiWidths: number[], brief: unknown = { kind: 'object', subject: 'the robot arm', good_if: 'the arm in action' }) {
  const calls: Record<string, unknown>[] = [];
  const create = async (p: Record<string, unknown>) => {
    calls.push(p);
    const tool = (p.tools as { name: string; cache_control?: unknown }[])[0]!;
    assert.ok(tool.cache_control, 'tool is cached');
    assert.ok((p.system as { cache_control?: unknown }[])[0]!.cache_control, 'system is cached');
    if (tool.name === 'photo_brief') return message('photo_brief', brief) as never;
    const img = ((p.messages as { content: { source: { data: string } }[] }[])[0]!.content[0]!).source.data;
    const w = (await sharp(Buffer.from(img, 'base64')).metadata()).width!;
    return message('real_check', { blatantly_ai: aiWidths.includes(w) }) as never;
  };
  return { create, calls };
}

/** Images are told apart by width: article a1..a3 = 801..803, search = 811, used = 820, small = 500×400, extra = 830. */
async function world(o: { jev: JevAns[]; aiWidths?: number[]; brief?: unknown }) {
  const images: Record<string, Buffer> = {
    'https://x/a1.jpg': await png(801, 700), 'https://x/a2.jpg': await png(802, 700), 'https://x/a3.jpg': await png(803, 700),
    'https://x/used.jpg': await png(820, 700), 'https://x/small.jpg': await png(500, 400), 'https://s/s1.jpg': await png(811, 700),
    'https://x/extra.jpg': await png(830, 700),
  };
  let n = 0;
  const jevCalls: unknown[] = [];
  const h = haiku(o.aiWidths ?? [], o.brief);
  const deps: PhotoDeps = {
    create: h.create,
    jev: { systemOne: async (args: unknown) => { jevCalls.push(args); const a = o.jev[n++]; if (!a) throw new Error('no canned answer'); return jevAnswers(a); } },
    readPage: async (url) => (url === 'https://news/story'
      ? { images: [{ src: 'https://x/used.jpg', credit: 'Getty' }, { src: 'https://x/a1.jpg', credit: 'Photo: Acme' }, 'https://x/small.jpg', { src: 'https://x/a2.jpg', credit: '' }] }
      : url === 'https://dup/one' ? { images: ['https://x/a3.jpg', 'https://x/a1.jpg'] } : null),
    serper: async () => ['https://s/s1.jpg', 'https://s/logo.svg'],
    fetchImage: async (u) => images[u] ?? null,
    usedReason: (src) => (src === 'https://x/used.jpg' ? 'published 3 days ago' : null),
  };
  const story: PhotoStory = { id: 's1', headline: 'Acme robot arm folds laundry', text: 'Acme showed a robot arm.', url: 'https://news/story', duplicateUrls: ['https://dup/one'] };
  return { deps, story, jevCalls, haikuCalls: h.calls };
}

test('tier: logo, thumbnail and overlay are never usable; specific+clear is good; related is usable', () => {
  const base = { logo: 0, ai_made: 0, overlay: 0, thumbnail: 0, specific: 0.9, related: 0.9, clarity: 8 };
  assert.equal(tier(base), 'good');
  assert.equal(tier({ ...base, logo: 0.5 }), 'none');
  assert.equal(tier({ ...base, overlay: 0.6 }), 'none');
  assert.equal(tier({ ...base, thumbnail: 0.7 }), 'none');
  assert.equal(tier({ ...base, thumbnail: 0.69 }), 'good', 'thumbnail cutoff is 0.7');
  assert.equal(tier({ ...base, clarity: 5.5 }), 'usable', 'specific but under 6 clarity');
  assert.equal(tier({ ...base, specific: 0.2, clarity: 9 }), 'usable');
  assert.equal(tier({ ...base, specific: 0.2, related: 0.2, clarity: 9 }), 'none');
  assert.equal(tier({ ...base, clarity: 4 }), 'none');
});

test('pick order: good before usable, rounded clarity, then article before search', () => {
  const g = (src: string, t: GradedPhoto['tier'], clarity: number, source: GradedPhoto['source']): GradedPhoto => ({ src, tier: t, clarity, source, credit: 'Photo', jpeg: Buffer.alloc(0), width: 1, height: 1 });
  const order = pickOrder([g('u', 'usable', 10, 'article'), g('s', 'good', 8.6, 'search'), g('a', 'good', 9.2, 'article'), g('n', 'none', 10, 'article'), g('o', 'good', 6, 'other_outlet')]);
  assert.deepEqual(order.map((x) => x.src), ['a', 's', 'o', 'u'], '8.6 and 9.2 both round to 9; article wins the tie');
});

test('findStoryPhoto: ledger and floor skip candidates; the AI check falls through to the next pick; credits follow production', async () => {
  // Fetched order: a1 (article), a2 (article), a3 (other outlet), s1 (search). used.jpg is in the ledger; small.jpg is under 600; the svg is skipped.
  const w = await world({ jev: [{ clarity: 7 }, { clarity: 9 }, { clarity: 5, specific: 0.1 }, { clarity: 9 }], aiWidths: [802] });
  const r = await findStoryPhoto(w.story, w.deps);
  assert.equal(w.jevCalls.length, 4);
  assert.equal(r.tier, 'good');
  assert.equal(r.pick?.src, 'https://s/s1.jpg', 'a2 (clarity 9, article) is AI → s1 (clarity 9, search)');
  assert.equal(r.pick?.credit, 'Photo', 'a search image has no credit line → Photo');
  assert.ok(r.log.some((l) => /used \(published 3 days ago\)/.test(l)));
  assert.ok(r.log.some((l) => /small\.jpg: too small \(500×400; needs 600\)/.test(l)));
  assert.ok(r.log.some((l) => /blatantly AI/.test(l)));
  assert.equal(r.brief?.subject, 'the robot arm');
  assert.ok(r.costUsd > 0);
  assert.equal(w.haikuCalls.length, 3, 'brief + two AI checks');
  // The runner-ups for the photo bank: the other good/usable candidates in pick order, never the AI-rejected one.
  assert.ok(r.passed!.length > 0);
  assert.ok(!r.passed!.some((c) => c.src === r.pick?.src || /a2/.test(c.src)));
  assert.ok(r.passed!.every((c) => c.tier === 'good' || c.tier === 'usable'));
});

test('findStoryPhoto: every good photo AI-rejected → the best usable one; page credit is kept', async () => {
  const w = await world({ jev: [{ clarity: 5, specific: 0.1 }, { clarity: 9 }, { thumbnail: 0.8, clarity: 9 }, { clarity: 8 }], aiWidths: [802, 811] });
  const r = await findStoryPhoto(w.story, w.deps);
  assert.equal(r.tier, 'usable');
  assert.equal(r.pick?.src, 'https://x/a1.jpg');
  assert.equal(r.pick?.credit, 'Photo: Acme');
  assert.equal(r.pick?.source, 'article');
});

test('findStoryPhoto: nothing passes → none; a missing brief makes no Jev calls', async () => {
  const w = await world({ jev: [{ logo: 0.9, clarity: 9 }, { overlay: 0.9, clarity: 9 }, { thumbnail: 0.9, clarity: 9 }, { clarity: 3 }] });
  const r = await findStoryPhoto(w.story, w.deps, { extra: [] });
  assert.equal(r.tier, 'none');
  assert.equal(r.pick, null);

  const nb = await world({ jev: [], brief: { kind: 'object' } });
  const r2 = await findStoryPhoto(nb.story, nb.deps);
  assert.equal(r2.tier, 'none');
  assert.equal(r2.brief, null);
  assert.equal(nb.jevCalls.length, 0);
});

test('findStoryPhoto: extras are graded last, with their own credit, and the floor can be turned off', async () => {
  const w = await world({ jev: [{ clarity: 3 }, { clarity: 3 }, { clarity: 3 }, { clarity: 3 }, { clarity: 9 }] });
  w.deps.minShortSide = 0;
  w.deps.serper = null;
  const r = await findStoryPhoto(w.story, w.deps, { extra: [{ src: 'https://x/extra.jpg', source: 'extra', credit: 'Image: Acme' }] });
  assert.ok(r.log.some((l) => /Serper not configured/.test(l)));
  assert.equal(r.pick?.src, 'https://x/extra.jpg');
  assert.equal(r.pick?.source, 'extra');
  assert.equal(r.pick?.credit, 'Image: Acme');
});

test('toJpeg: a very wide picture is padded to 3.5:1; small pictures are refused', async () => {
  const j = await toJpeg(await png(2000, 400));
  assert.ok(j);
  assert.equal(j.width, 1024);
  assert.ok(j.width / j.height <= 3.5 + 1e-6, `${j.width}x${j.height}`);
  assert.equal(j.origWidth, 2000);
  assert.equal(await toJpeg(await png(390, 300)), null);
});

test('decideBand: a landscape with a central subject covers the band; a wide text picture is contained', () => {
  const cover = decideBand(1920, 1080, { left: 0.35, right: 0.65, top: 0.2, bottom: 0.6 });
  assert.equal(cover.contained, false);
  assert.ok(cover.drawW >= BAND_W - 0.5 && cover.drawH >= BAND_H - 0.5);
  const contained = decideBand(3000, 900, { left: 0.4, right: 0.6, top: 0.3, bottom: 0.7 }, true);
  assert.equal(contained.contained, true);
  assert.ok(contained.drawW <= BAND_W + 0.5);
});

test('fitToBand without an upscaler: plain band frame, noted; a failed Jev call keeps the whole picture', async () => {
  const img = await png(600, 500);
  const calls: Record<string, unknown>[] = [];
  const jev = { systemOne: async (a: Record<string, unknown>) => { calls.push(a); return { answers: { essential: { box: { left: 0.3, right: 0.7, top: 0.2, bottom: 0.7 } }, text: { noul: 0.1 } }, usage: { input_tokens: 800, output_tokens: 5 } }; } };
  const f = await fitToBand(img, { jev, upscaler: null, tmpDir: '/nonexistent-never-written' });
  assert.equal(calls[0]!.model, 'jev-preview');
  assert.equal(f.upscaled, false);
  assert.match(f.note ?? '', /not installed/);
  assert.ok(f.costUsd > 0);
  const m = await sharp(f.jpeg).metadata();
  assert.deepEqual([m.width, m.height], [BAND_W, BAND_H]);

  const failed = await fitToBand(await png(3000, 900), { jev: { systemOne: async () => { throw new Error('down'); } }, upscaler: null, tmpDir: '/nonexistent-never-written' });
  assert.equal(failed.contained, true, 'whole 3000×900 picture as the subject can not cover the band');
  assert.match(failed.note ?? '', /band check failed/);
});

test('photo upscaler: the VM runs the compact model on the CPU, one thread at nice 10, input capped; ncnn keeps x4plus', async () => {
  const { onnxPhotoUpscaler, ncnnPhotoUpscaler, upscaleInputSize, ONNX_MAX_INPUT_PX, ESRGAN_ONNX_PYTHON } = await import('@/lib/news-photos/band');
  const onnx = onnxPhotoUpscaler(ESRGAN_ONNX_PYTHON, '/app');
  assert.equal(onnx.kind, 'onnx');
  assert.equal(onnx.bin, 'nice');
  assert.deepEqual(onnx.args('/t/in.png', '/t/out.png'), ['-n', '10', '/opt/helios-social/rembg-venv/bin/python', '/app/scripts/upscale/esrgan_onnx.py', '-i', '/t/in.png', '-o', '/t/out.png', '-s', '4', '-m', '/app/scripts/upscale/realesr-general-x4v3.onnx', '-t', '256', '-j', '1']);
  assert.ok(onnx.timeoutMs <= 150_000);
  const ncnn = ncnnPhotoUpscaler('/usr/local/bin/realesrgan-ncnn-vulkan');
  assert.deepEqual(ncnn.args('a.png', 'b.png'), ['-i', 'a.png', '-o', 'b.png', '-n', 'realesrgan-x4plus', '-s', '4']);
  // The cap: a region that fits is untouched; a bigger one shrinks to the cap, keeping its shape.
  assert.deepEqual(upscaleInputSize(400, 500, ONNX_MAX_INPUT_PX), { w: 400, h: 500 });
  const big = upscaleInputSize(864, 944, ONNX_MAX_INPUT_PX);
  assert.ok(big.w * big.h <= ONNX_MAX_INPUT_PX && big.w * big.h > ONNX_MAX_INPUT_PX * 0.99);
  assert.ok(Math.abs(big.w / big.h - 864 / 944) < 0.01);
});
