import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { anchorScore, faceCount, needsSketch, pickAnchor, sketchReference, type CastCand } from '@/lib/reel-ai-drama/harvest/cast';
import { fileFaceDetector, mainFace, parseFaceBoxes } from '@/lib/reel-ai-drama/harvest/faces';
import { downloadImage } from '@/lib/reel-ai-drama/harvest/fetch';
import { identityVerdict, nameInUrl, parseIptc, readImageMeta, type Look } from '@/lib/reel-ai-drama/harvest/filters';
import { runHarvest } from '@/lib/reel-ai-drama/harvest/harvest';
import { realEsrganArgs } from '@/lib/reel-ai-drama/harvest/live';
import { parseLooks, SUBMIT_LOOKS_TOOL } from '@/lib/reel-ai-drama/harvest/look';
import { anchorUpscale, MAX_LONG_EDGE, normaliseImage, normalisedFormat, scaleBoxes } from '@/lib/reel-ai-drama/harvest/media';
import { garbledAssetIds, reanchor } from '@/lib/reel-ai-drama/harvest/anchors';
import { lookVerdict } from '@/lib/reel-ai-drama/harvest/filters';
import { checkedUpscale, GarbledUpscaleError, upscaleDiff } from '@/lib/reel-ai-drama/harvest/media';
import { castPeople, centralPeople, officialHostsFor, topUpWants } from '@/lib/reel-ai-drama/harvest/plan';
import { lastVisualNumber, MAX_WISHES, pickForWish, searchWishes, WISH_QUERIES, wishWants } from '@/lib/reel-ai-drama/harvest/wishes';
import { sketchPrompt } from '@/lib/reel-ai-drama/harvest/sketch';
import { pickPersonQid } from '@/lib/reel-ai-drama/harvest/sources/wikidata';
import type { FaceBox, HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, FactSheet, Pitch, ShotWish, VisualsInventory } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';
import { makeJpeg, makePng, seedOf } from './fixtures/reel-ai-drama/harvest/images';

/** Iteration 2, W2 (MD-60, MD-14): cast coverage, anchors, face boxes, normalised media, sketch fallback. All offline. */

const NOW = new Date('2026-10-28T12:00:00Z');
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const look = (over: Partial<Look> = {}): Look => ({ shows: 's', watermark: false, tv_logo: false, ai_generated: false, faces: 1, text_heavy: false, about_story: true, key_moment: false, ...over });

// ── Identity: a name stated about the picture itself confirms it ────────────

test('identity: a Commons or press caption, an embedded caption, or a search title plus URL naming them is verified', () => {
  const p = { people: ['Greg Brockman'], kind: 'person_photo' as const, flags: [] as string[], qids: [] as string[] };
  const commons = identityVerdict({ ...p, source: 'commons', caption: 'Greg Brockman at TechCrunch Disrupt SF 2016' }, look());
  assert.deepEqual(commons, { reject: null, people: ['Greg Brockman'], flags: ['identity:verified', 'identity_basis:caption'] });
  const press = identityVerdict({ ...p, source: 'newsroom', caption: 'Brockman on stage' }, look());
  assert.equal(press.flags[0], 'identity:verified');
  const embedded = identityVerdict({ ...p, source: 'serper', caption: 'Keynote photos', embedded_caption: 'Greg Brockman, OpenAI president, speaks' }, look());
  assert.deepEqual(embedded.flags, ['identity:verified', 'identity_basis:embedded_caption']);
  const titleAndUrl = identityVerdict({ ...p, source: 'serper', caption: 'Greg Brockman returns', url: 'https://cdn.example.com/2024/greg-brockman-stage.jpg' }, look());
  assert.deepEqual(titleAndUrl.flags, ['identity:verified', 'identity_basis:title_and_url']);
  // Weak evidence stays probable: a search title alone, or a page title standing in for a caption.
  assert.deepEqual(identityVerdict({ ...p, source: 'serper', caption: 'Greg Brockman returns', url: 'https://cdn.example.com/img123.jpg' }, look()).flags, ['identity:probable']);
  assert.deepEqual(identityVerdict({ ...p, source: 'article', caption: 'Brockman quits', flags: ['caption:page_title'] }, look()).flags, ['identity:probable']);
  // No face, no claim; a group photo stays flagged.
  assert.equal(identityVerdict({ ...p, source: 'commons', caption: 'Greg Brockman' }, look({ faces: 0 })).reject, 'identity:no_face');
  assert.ok(identityVerdict({ ...p, source: 'commons', caption: 'Greg Brockman with friends' }, look({ faces: 4 })).flags.includes('group_photo:4_faces'));
  assert.equal(nameInUrl('Greg Brockman', 'https://upload.wikimedia.org/x/Greg_Brockman%2C_2019.jpg'), true);
  assert.equal(nameInUrl('Sam Altman', 'https://x.com/samaltman/photo'), true);
  assert.equal(nameInUrl('Sam Altman', 'https://x.com/photo/123'), false);
});

test('wikidata: a cast person without a QID is resolved by name; namesakes need the story context', () => {
  const hit = (id: string, label: string, description: string) => ({ id, label, description, match: { type: 'label', text: label } });
  assert.equal(pickPersonQid([hit('Q1', 'Greg Brockman', 'American entrepreneur')], 'Greg Brockman'), 'Q1');
  assert.equal(pickPersonQid([hit('Q2', 'Brockman', 'family name')], 'Brockman'), null);
  const wolves = [hit('Q3', 'Thomas Wolf', 'German footballer'), hit('Q4', 'Thomas Wolf', 'French machine learning researcher, Hugging Face co-founder')];
  assert.equal(pickPersonQid(wolves, 'Thomas Wolf'), null, 'two namesakes and no context: no QID');
  assert.equal(pickPersonQid(wolves, 'Thomas Wolf', 'Hugging Face co-founder and chief science officer'), 'Q4');
  assert.equal(pickPersonQid([hit('Q5', 'Jane Doe', 'American film director')], 'Jane Doe'), 'Q5', 'occupations are not filtered out');
});

// ── The look carries a portrait verdict ─────────────────────────────────────

test('look schema and parsing: portrait is a required field; missing values default to false', () => {
  const items = SUBMIT_LOOKS_TOOL.input_schema.properties.tiles.items;
  assert.ok((items.required as readonly string[]).includes('portrait'));
  const parsed = parseLooks({ tiles: [{ tile: 1, shows: 'x', faces: 1, portrait: true }, { tile: 2, shows: 'y', faces: 2 }] }, 2);
  assert.equal(parsed.get(0)!.portrait, true);
  assert.equal(parsed.get(1)!.portrait, false);
});

// ── Face boxes ───────────────────────────────────────────────────────────────

test('face boxes: parsed, clamped, low-confidence dropped; the main face is the largest', async () => {
  const boxes = parseFaceBoxes([
    { x: 0.4, y: 0.1, w: 0.2, h: 0.25, score: 0.95 },
    { x: -0.1, y: 0.5, w: 0.3, h: 0.3, score: 0.8 },
    { x: 0.1, y: 0.1, w: 0.5, h: 0.5, score: 0.2 },
    { x: 0.1, y: 0.1, w: 0, h: 0.2, score: 0.9 },
    { x: 'a', y: 0, w: 1, h: 1 },
    null,
  ]);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[1], { x: 0, y: 0.5, w: 0.2, h: 0.3, score: 0.8 });
  assert.deepEqual(parseFaceBoxes('nope'), []);
  assert.deepEqual(mainFace(boxes), { x: 0, y: 0.5, w: 0.2, h: 0.3 }, 'the clamped box is still the larger one');
  assert.equal(mainFace([]), null);

  const dir = tmp('rad-faces-');
  const a = path.join(dir, 'a.jpg');
  const b = path.join(dir, 'b.jpg');
  fs.writeFileSync(a, await makeJpeg(1, 3000, 2000));
  fs.writeFileSync(b, await makeJpeg(2, 800, 600));
  const seen: string[] = [];
  const detect = fileFaceDetector(async (urls) => {
    seen.push(...urls);
    return new Map<string, FaceBox[] | null>([
      [urls[0], [{ x: 0.3, y: 0.05, w: 0.2, h: 0.3, score: 0.9 }]],
      [urls[1], null],
    ]);
  });
  const found = await detect([a, b, a, path.join(dir, 'missing.jpg')]);
  assert.equal(seen.length, 2, 'one data URL per readable file');
  assert.ok(seen.every((u) => u.startsWith('data:image/jpeg;base64,')));
  const small = await sharp(Buffer.from(seen[0].split(',')[1], 'base64')).metadata();
  assert.ok(Math.max(small.width!, small.height!) <= 640, 'the detector sees a small copy');
  assert.equal(found.get(a)!.length, 1);
  assert.equal(found.get(b), null);
  assert.equal(found.get(path.join(dir, 'missing.jpg')), null);
});

// ── Anchors and sketches ────────────────────────────────────────────────────

const cand = (over: Partial<CastCand>): CastCand => ({
  source: 'commons',
  kind: 'person_photo',
  people: ['Greg Brockman'],
  qids: [],
  caption: 'Greg Brockman',
  flags: ['identity:verified'],
  made: false,
  character_image: false,
  width: 1600,
  height: 2000,
  file: null,
  look: look({ portrait: true }),
  faces: [{ x: 0.4, y: 0.15, w: 0.2, h: 0.25, score: 0.9 }],
  face: { x: 0.4, y: 0.15, w: 0.2, h: 0.25 },
  recency: 0.5,
  order: 0,
  reject: null,
  ...over,
});

test('anchor: a banked cutout wins; else the best confirmed solo portrait; never a probable, group or text-heavy picture', () => {
  const portrait = cand({ order: 1 });
  const bigGroup = cand({ order: 2, width: 4000, height: 3000, faces: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1, score: 0.9 }, { x: 0.5, y: 0.1, w: 0.1, h: 0.1, score: 0.9 }], look: look({ faces: 2 }) });
  const probable = cand({ order: 3, flags: ['identity:probable'], width: 3000, height: 3000 });
  const offCentre = cand({ order: 4, look: look({ portrait: false }), face: { x: 0.85, y: 0.6, w: 0.05, h: 0.06 } });
  const page = cand({ order: 5, look: look({ text_heavy: true, portrait: true }) });
  const two = cand({ order: 6, people: ['Greg Brockman', 'Sam Altman'] });
  const pool = [bigGroup, probable, offCentre, page, two, portrait];
  assert.equal(pickAnchor(pool, 'Greg Brockman'), portrait);
  for (const c of [bigGroup, probable, page, two]) assert.equal(anchorScore(c, 'Greg Brockman'), null);
  assert.ok(anchorScore(portrait, 'Greg Brockman')! > anchorScore(offCentre, 'Greg Brockman')!);
  const cutout = cand({ source: 'bank', flags: ['cutout', 'identity:verified'], look: null, faces: null, face: null, width: 400, height: 500, order: 9 });
  assert.equal(pickAnchor([...pool, cutout], 'Greg Brockman'), cutout);
  assert.equal(faceCount(cutout), 1);
  assert.equal(pickAnchor([probable, bigGroup], 'Greg Brockman'), null, 'no confirmed solo picture: no anchor');
  // The detector missing a small face does not hide the look's count.
  assert.equal(faceCount(cand({ faces: [], look: look({ faces: 1 }) })), 1);
});

test('sketch reference: any solo picture that names them, usable or rejected for a non-identity reason; never a group or an identity reject', () => {
  const dir = tmp('rad-ref-');
  const file = (n: string) => {
    const f = path.join(dir, n);
    fs.writeFileSync(f, 'x');
    return f;
  };
  const watermarked = cand({ source: 'serper', flags: [], caption: 'Ilya Sutskever speaks', people: ['Ilya Sutskever'], reject: 'watermark', file: file('w.jpg'), faces: null, look: look({ faces: 1 }) });
  const group = cand({ source: 'serper', flags: ['identity:probable'], caption: 'Ilya Sutskever with team', people: ['Ilya Sutskever'], file: file('g.jpg'), faces: null, look: look({ faces: 5 }) });
  const stranger = cand({ source: 'serper', flags: [], caption: 'A man speaks', people: ['Ilya Sutskever'], reject: 'identity:unverified', file: file('s.jpg') });
  const ai = cand({ source: 'serper', flags: [], caption: 'Ilya Sutskever', people: ['Ilya Sutskever'], reject: 'ai_generated:look', file: file('a.jpg') });
  const gone = cand({ source: 'serper', flags: [], caption: 'Ilya Sutskever', people: ['Ilya Sutskever'], reject: 'too_small:300px', file: path.join(dir, 'gone.jpg') });
  assert.equal(sketchReference([group, stranger, ai, gone, watermarked], 'Ilya Sutskever'), watermarked);
  assert.equal(sketchReference([group, stranger, ai], 'Ilya Sutskever'), null);
  const usable = cand({ source: 'serper', flags: ['identity:probable'], caption: 'Ilya Sutskever', people: ['Ilya Sutskever'], file: file('u.jpg'), width: 900, height: 900 });
  assert.equal(sketchReference([watermarked, usable], 'Ilya Sutskever'), usable, 'a usable picture beats a rejected one');
});

test('coverage rules: named people want three confirmed looks, central people six; a sketch only when there is no anchor or no picture', () => {
  assert.equal(needsSketch({ main: true, portraits: 3, verified: 0 }, false), true);
  assert.equal(needsSketch({ main: true, portraits: 3, verified: 1 }, true), false);
  assert.equal(needsSketch({ main: false, portraits: 1, verified: 0 }, false), false, 'a supporting person with a picture needs no sketch');
  assert.equal(needsSketch({ main: false, portraits: 0, verified: 0 }, false), true);

  assert.equal(needsSketch({ main: false, central: true, portraits: 2, verified: 0 }, false), true, 'a central person with no anchor gets a sketch');

  const greg = { name: 'Greg Brockman', main: true, central: false, role: 'OpenAI president and co-founder', qid: null, playerId: null };
  const more = topUpWants(greg, { verified: 1 });
  assert.deepEqual(more.map((w) => w.terms), ['incategory:"Greg Brockman"', 'Greg Brockman portrait', 'Greg Brockman interview', 'Greg Brockman site:openai.com']);
  assert.deepEqual(more.map((w) => w.sources.join()), ['commons', 'serper', 'serper', 'serper']);
  assert.ok(more.every((w) => w.kind === 'person_photo' && w.people[0] === 'Greg Brockman'));
  assert.deepEqual(topUpWants(greg, { verified: 3 }), [], 'three confirmed looks is enough for a named person');
  assert.deepEqual(topUpWants({ ...greg, main: false }, { verified: 3 }), []);
  const central = { ...greg, central: true };
  assert.equal(topUpWants(central, { verified: 3 }).filter((w) => w.sources[0] === 'serper').length, 6, 'a central person short of six gets six searches');
  assert.deepEqual(topUpWants(central, { verified: 6 }), []);
  const r2 = topUpWants(central, { verified: 4 }, { round: 2, year: '2015' });
  assert.ok(r2.every((w) => w.sources.join() === 'serper' && w.id.includes(':r2-')), 'round two is Serper only, with new ids');
  assert.ok(r2.some((w) => w.terms === 'Greg Brockman 2015'));
  assert.deepEqual(officialHostsFor('Chief scientist at Google DeepMind'), ['blog.google', 'deepmind.google']);
  assert.match(sketchPrompt(), /never a photograph or a photoreal render/);
});

// ── Media normalisation and upscale decisions ───────────────────────────────

test('normalise: long edge at most 2160 px, photos as JPEG, alpha and text kinds as PNG; boxes follow; anchor upscale factors', async () => {
  const dir = tmp('rad-norm-');
  const big = path.join(dir, 'big.png');
  fs.writeFileSync(big, await sharp(await makeJpeg(3, 3840, 2560)).png().toBuffer());
  const n = await normaliseImage(big, path.join(dir, 'V1'), 'person_photo');
  assert.equal(path.basename(n.file), 'V1.jpg');
  assert.deepEqual([n.width, n.height], [MAX_LONG_EDGE, 1440]);
  assert.equal((await sharp(n.file).metadata()).format, 'jpeg');
  assert.ok(Math.abs(n.scale - 2160 / 3840) < 1e-9);

  const cutout = path.join(dir, 'cut.png');
  fs.writeFileSync(cutout, await sharp({ create: { width: 400, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
  const c = await normaliseImage(cutout, path.join(dir, 'V2'), 'person_photo');
  assert.equal(path.basename(c.file), 'V2.png');
  assert.deepEqual([c.width, c.height, c.scale], [400, 500, 1]);

  const page = path.join(dir, 'page.png');
  fs.writeFileSync(page, await makePng(4, 1080, 4000));
  const p = await normaliseImage(page, path.join(dir, 'V3'), 'web_page');
  assert.equal(path.basename(p.file), 'V3.png');
  assert.equal(p.height, 2160);
  assert.deepEqual(scaleBoxes([{ text: 't', x: 100, y: 400, w: 200, h: 50 }], p.scale), [{ text: 't', x: 54, y: 216, w: 108, h: 27 }]);
  assert.equal(normalisedFormat('event_photo', false), 'jpeg');
  assert.equal(normalisedFormat('map', false), 'png');

  assert.equal(anchorUpscale(1600, 1200), null);
  assert.equal(anchorUpscale(800, 1000), 2);
  assert.equal(anchorUpscale(400, 500), 4);
  assert.equal(anchorUpscale(0, 0), null);
  // V21: the ×4-only model asked for -s 2 shuffled its tiles. The model always runs at ×4, named explicitly.
  assert.deepEqual(realEsrganArgs('in.png', 'out.png'), ['-i', 'in.png', '-o', 'out.png', '-n', 'realesrgan-x4plus', '-s', '4']);
});

test('download: a rate limit (429) is retried after a wait, then succeeds', async () => {
  const waits: number[] = [];
  let calls = 0;
  const jpeg = await makeJpeg(5, 800, 600);
  const http = (async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } });
    return new Response(new Uint8Array(jpeg), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as unknown as typeof fetch;
  const got = await downloadImage(http, 'https://upload.wikimedia.org/x.jpg', path.join(tmp('rad-dl-'), 'x'), { sleep: async (ms) => void waits.push(ms) });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.ok(fs.existsSync(got.file));
});

test('embedded caption: the IPTC or XMP caption is read from the file', async () => {
  const caption = 'Greg Brockman speaks at a conference';
  const iptc = Buffer.concat([Buffer.from([0x1c, 2, 120, 0, caption.length]), Buffer.from(caption)]);
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${caption}</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const withXmp = await sharp(await makeJpeg(6, 400, 300)).withXmp(xmp).jpeg().toBuffer();
  assert.equal((await readImageMeta(withXmp)).caption, caption);
  assert.equal(parseIptc(iptc)[120], caption);
});

// ── A full stubbed harvest: two main characters ─────────────────────────────

const PITCH: Pitch = {
  title: 'The weekend OpenAI fired its CEO',
  brief: 'p',
  logline: 'l',
  pitch: 'p',
  story_type: 'power_struggle',
  era: 'now',
  event_date: '2026-10-01',
  date_precision: 'day',
  cast: [
    { name: 'Greg Brockman', role: 'OpenAI president', kind: 'person', player_id: null, want: 'w' },
    { name: 'Ilya Sutskever', role: 'OpenAI chief scientist', kind: 'person', player_id: null, want: 'w' },
  ],
  central_figure: 'Greg Brockman',
  scene: 'Brockman quits by text at midnight',
  turn: 't',
  implication: 'i',
  why_now: null,
  engine: 'e',
  expected_visuals: [],
  sources: [],
};

const SIZES: Record<string, [number, number]> = {
  'brockman-disrupt': [900, 1200],
  'brockman-keynote': [3840, 2560],
  'greg-brockman-stage': [1800, 1200],
  'ilya-photo': [1200, 1500],
  'mira-murati-talk': [1400, 1800],
};

function stubHttp(): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const u = new URL(url);
    if (u.hostname === 'www.wikidata.org') {
      if (u.searchParams.get('action') === 'wbsearchentities') {
        const name = u.searchParams.get('search');
        return json({ search: name === 'Greg Brockman' ? [{ id: 'Q100', label: 'Greg Brockman', description: 'American entrepreneur', match: { type: 'label', text: 'Greg Brockman' } }] : [] });
      }
      return json({ entities: { Q100: { claims: {} } } });
    }
    if (u.hostname === 'commons.wikimedia.org') {
      if (u.searchParams.get('list') === 'search') {
        const q = u.searchParams.get('srsearch') ?? '';
        return json({ query: { search: /^Greg Brockman filetype/.test(q) ? [{ title: 'File:Greg Brockman at Disrupt.jpg' }, { title: 'File:Brockman keynote.jpg' }] : [] } });
      }
      const info = (n: string, file: string, w: number, h: number, desc: string) => ({ title: n, imageinfo: [{ url: `https://upload.wikimedia.org/${file}`, width: w, height: h, mime: 'image/jpeg', extmetadata: { Artist: { value: 'Conference Photos' }, LicenseShortName: { value: 'CC BY 2.0' }, ImageDescription: { value: desc } } }] });
      return json({ query: { pages: { 1: info('File:Greg Brockman at Disrupt.jpg', 'brockman-disrupt.jpg', 900, 1200, 'Greg Brockman at TechCrunch Disrupt'), 2: info('File:Brockman keynote.jpg', 'brockman-keynote.jpg', 3840, 2560, 'Greg Brockman gives a keynote') } } });
    }
    if (u.hostname === 'google.serper.dev') {
      const q = String(JSON.parse(String(init?.body ?? '{}')).q ?? '');
      if (/Brockman/.test(q)) return json({ images: [{ title: 'Greg Brockman on stage', imageUrl: 'https://cdn.example.com/greg-brockman-stage.jpg', link: 'https://example.com/a', source: 'Example', domain: 'example.com' }] });
      if (/Sutskever/.test(q)) return json({ images: [{ title: 'Ilya Sutskever at an event', imageUrl: 'https://cdn.example.com/ilya-photo.jpg', link: 'https://example.com/b', source: 'Example', domain: 'example.com' }] });
      if (/Murati/.test(q)) return json({ images: [{ title: 'Mira Murati speaks', imageUrl: 'https://cdn.example.com/mira-murati-talk.jpg', link: 'https://example.com/c', source: 'Example', domain: 'example.com' }] });
      return json({ images: [] });
    }
    if (/\.jpe?g$/i.test(u.pathname)) {
      const key = Object.keys(SIZES).find((k) => u.pathname.includes(k));
      const [w, h] = key ? SIZES[key] : [1600, 1000];
      return new Response(new Uint8Array(await makeJpeg(seedOf(url), w, h)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function stubLooks() {
  return async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    const text = ((params.messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.TextBlockParam).text;
    const tiles = [...text.matchAll(/^(\d+)\. from (\w+); meant to show: (.*); caption: (.*)$/gm)].map((m) => ({
      tile: Number(m[1]),
      ...look({ shows: `Stub: ${m[4]}`.slice(0, 80), portrait: /Disrupt/.test(m[4]) }),
    }));
    return {
      id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: 'submit_looks', input: { tiles } }],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
}

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`);
  const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'production', 8) RETURNING id`, [p.id]);
  return { db, jobId: job.id };
}

test('a stubbed harvest: confirmed anchors upscaled, a sketch for the unconfirmed main character, faces boxed, media normalised', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-cast-');
  const upscaled: number[] = [];
  const sketched: string[] = [];
  const deps: HarvestDeps = {
    db,
    http: stubHttp(),
    create: stubLooks(),
    loadPrompt: () => 'LOOK',
    serperKey: 'k',
    cutouts: [],
    upscale: async (input, output, scale) => {
      upscaled.push(scale);
      const m = await sharp(input).metadata();
      await sharp(input).resize(Math.round(m.width! * scale)).png().toFile(output);
    },
    detectFaces: async (files) => new Map(files.map((f) => [f, [{ x: 0.42, y: 0.12, w: 0.18, h: 0.24, score: 0.93 }]])),
    sketch: async ({ prompt, reference }) => {
      sketched.push(reference);
      assert.match(prompt, /line drawing/);
      return { png: await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } }).png().toBuffer(), usd: 0.05 };
    },
    now: () => NOW,
    sleep: async () => undefined,
    log: () => undefined,
  };
  const result = await runHarvest(deps, { pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } });
  const { assets } = result.inventory;

  const gregAnchor = assets.filter((a) => a.anchor_for === 'Greg Brockman');
  assert.equal(gregAnchor.length, 1, 'one anchor per person');
  assert.equal(gregAnchor[0].character_image, true, 'the anchor is the character image');
  assert.ok(gregAnchor[0].flags.includes('identity:verified'));
  assert.equal(gregAnchor[0].upscaled, true, 'the 900 px Commons portrait was upscaled for its anchor job');
  assert.ok(gregAnchor[0].flags.includes('upscaled:anchor:2x'));
  assert.deepEqual(upscaled, [2]);
  assert.deepEqual(gregAnchor[0].face, { x: 0.42, y: 0.12, w: 0.18, h: 0.24 });

  const ilya = assets.filter((a) => a.people.includes('Ilya Sutskever'));
  const sketch = ilya.find((a) => a.made_kind === 'sketch')!;
  assert.ok(sketch, `no sketch of Ilya: ${result.notes.join(' | ')}`);
  assert.equal(sketch.made, true);
  assert.equal(sketch.anchor_for, 'Ilya Sutskever', 'with no confirmed photo, the sketch is the anchor');
  assert.ok(ilya.some((a) => a.made_kind === null && a.flags.includes('identity:probable')), 'the probable photo stays usable');
  assert.equal(sketched.length, 1);
  assert.match(sketched[0], /tmp/);

  for (const a of assets) {
    const m = await sharp(path.join(jobDir, a.file)).metadata();
    assert.ok(Math.max(m.width!, m.height!) <= MAX_LONG_EDGE, `${a.id} is ${m.width}×${m.height}`);
    assert.deepEqual([a.width, a.height], [m.width, m.height]);
    assert.ok('anchor_for' in a && 'face' in a && 'made_kind' in a);
  }
  assert.ok(assets.some((a) => a.flags.some((f) => f.startsWith('resized:'))), 'the 3840 px keynote photo was resized');

  const greg = result.cast.find((c) => c.name === 'Greg Brockman')!;
  assert.equal(greg.anchor, gregAnchor[0].id);
  assert.ok(greg.verified >= 2);
  assert.ok(result.notes.some((n) => /^cast: Greg Brockman \(central\): \d+ look\(s\), \d+ confirmed, anchor V\d+, cutout none/.test(n)), result.notes.join(' | '));
  assert.ok(result.notes.some((n) => /cutout: Greg Brockman needs one but no background remover is set/.test(n)));
  assert.ok(result.wants.some((w) => w.id === 'person-cat:greg-brockman') && result.wants.some((w) => w.id.startsWith('person-look:greg-brockman:r2-')), 'the central person got the category search and a second round');
  assert.ok(result.wants.some((w) => w.id.startsWith('person-look:ilya-sutskever:')), 'the unconfirmed main character got a second search pass');
  const harvest = JSON.parse(fs.readFileSync(path.join(jobDir, 'media', 'harvest.json'), 'utf8'));
  assert.equal(harvest.cast.length, 2);
  const { rows } = await db.query<{ component: string }>(`SELECT component FROM reel_ai_drama.cost_events WHERE job_id = $1 AND vendor = 'openai'`, [jobId]);
  assert.deepEqual(rows.map((r) => r.component), ['harvest_sketch']);
  assert.ok(result.inventory.usd >= 0.05, 'the sketch counts toward harvest spend');
});

test('fail open: an upscaler error keeps the original anchor with a flag; no sketch generator leaves a note', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-cast2-');
  const result = await runHarvest(
    {
      db,
      http: stubHttp(),
      create: stubLooks(),
      loadPrompt: () => 'LOOK',
      serperKey: 'k',
      cutouts: [],
      upscale: async () => {
        throw new Error('vulkan device lost');
      },
      detectFaces: null,
      sketch: null,
      now: () => NOW,
      sleep: async () => undefined,
      log: () => undefined,
    },
    { pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } },
  );
  const anchor = result.inventory.assets.find((a) => a.anchor_for === 'Greg Brockman')!;
  assert.equal(anchor.upscaled, false);
  assert.ok(anchor.flags.some((f) => f.startsWith('upscale_failed:vulkan device lost')));
  assert.equal(anchor.face, null);
  assert.ok(result.notes.includes('faces: no detector; no face boxes'));
  assert.ok(result.notes.some((n) => /Ilya Sutskever needs a sketch but no sketch generator/.test(n)));
  assert.ok(!result.inventory.assets.some((a) => a.made_kind === 'sketch'));
  assert.ok(castPeople(PITCH, null).every((p) => p.main));
});

// ── Iteration 3: the upscaler bug, cutouts, central people, fact-sheet cast, anchor fallback, wish search ──

/** An "upscaler" that resizes correctly, then swaps the picture's quadrants: V21's shuffled tiles. */
async function shuffledUpscale(input: string, output: string, scale: number) {
  const m = await sharp(input).metadata();
  const w = Math.round(m.width! * scale);
  const h = Math.round(m.height! * scale);
  const big = await sharp(input).resize(w, h, { fit: 'fill' }).png().toBuffer();
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const q = (left: number, top: number) => sharp(big).extract({ left, top, width: hw, height: hh }).toBuffer();
  const [a, b, c, d] = await Promise.all([q(0, 0), q(hw, 0), q(0, hh), q(hw, hh)]);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } })
    .composite([{ input: d, left: 0, top: 0 }, { input: c, left: hw, top: 0 }, { input: b, left: 0, top: hh }, { input: a, left: hw, top: hh }])
    .png()
    .toFile(output);
}

const goodUpscale = async (input: string, output: string, scale: number) => {
  const m = await sharp(input).metadata();
  await sharp(input).resize(Math.round(m.width! * scale), Math.round(m.height! * scale), { fit: 'fill' }).png().toFile(output);
};

test('upscale check: a whole picture passes; shuffled tiles or a wrong size are rejected and deleted', async () => {
  const dir = tmp('rad-up-');
  const src = path.join(dir, 'src.jpg');
  fs.writeFileSync(src, await makeJpeg(11, 400, 500));
  const ok = await checkedUpscale(goodUpscale, src, path.join(dir, 'ok.png'), 2);
  assert.deepEqual([ok.width, ok.height], [800, 1000]);
  assert.ok(ok.diff.mean < 0.05 && ok.diff.worstBlock < 0.2, JSON.stringify(ok.diff));

  const bad = path.join(dir, 'bad.png');
  await assert.rejects(checkedUpscale(shuffledUpscale, src, bad, 2), GarbledUpscaleError);
  assert.equal(fs.existsSync(bad), false, 'a garbled upscale is deleted');

  const sized = path.join(dir, 'sized.png');
  await assert.rejects(checkedUpscale(async (i, o) => void (await sharp(i).png().toFile(o)), src, sized, 2), GarbledUpscaleError, 'an upscale that did not grow the picture is wrong');

  // Alpha: only the person's pixels count, so a cutout on a transparent ground is judged by the person.
  const cut = path.join(dir, 'cut.png');
  const person = await sharp(await makeJpeg(12, 200, 300)).png().toBuffer();
  await sharp({ create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: person, left: 50, top: 50 }]).png().toFile(cut);
  assert.ok((await upscaleDiff(cut, (await checkedUpscale(goodUpscale, cut, path.join(dir, 'cut2.png'), 4), path.join(dir, 'cut2.png')))).mean < 0.05);
  await assert.rejects(checkedUpscale(shuffledUpscale, cut, path.join(dir, 'cut3.png'), 2), GarbledUpscaleError);
});

test('a garbled anchor upscale keeps the original anchor, flagged, and says so', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-garble-');
  const result = await runHarvest(
    { db, http: stubHttp(), create: stubLooks(), loadPrompt: () => 'LOOK', serperKey: 'k', cutouts: [], upscale: shuffledUpscale, detectFaces: null, sketch: null, now: () => NOW, sleep: async () => undefined, log: () => undefined },
    { pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } },
  );
  const anchor = result.inventory.assets.find((a) => a.anchor_for === 'Greg Brockman')!;
  assert.equal(anchor.upscaled, false);
  assert.ok(anchor.flags.includes('upscale_garbled'));
  assert.deepEqual([anchor.width, anchor.height], [900, 1200], 'the original pixels were saved');
  assert.ok(result.notes.some((n) => /anchor upscale for Greg Brockman came out garbled .*kept the original/.test(n)));
});

test('look: a garbled file is rejected; garbled and fits are required tile fields (fits defaults to true)', () => {
  const items = SUBMIT_LOOKS_TOOL.input_schema.properties.tiles.items;
  assert.ok((items.required as readonly string[]).includes('garbled') && (items.required as readonly string[]).includes('fits'));
  assert.equal(lookVerdict({ made: false }, look({ garbled: true })), 'garbled:look');
  const parsed = parseLooks({ tiles: [{ tile: 1, shows: 'x', faces: 1, garbled: true, fits: false }, { tile: 2, shows: 'y', faces: 1 }] }, 2);
  assert.deepEqual([parsed.get(0)!.garbled, parsed.get(0)!.fits, parsed.get(1)!.garbled, parsed.get(1)!.fits], [true, false, false, true]);
  // A garbled picture is never an anchor.
  const c = { source: 'commons' as const, kind: 'person_photo' as const, people: ['Sam Altman'], qids: [], caption: '', flags: ['identity:verified'], made: false, character_image: false, width: 1200, height: 1500, file: 'x', look: look({ portrait: true }), faces: null, face: null, recency: 0.5, order: 0, reject: null };
  assert.notEqual(anchorScore(c, 'Sam Altman'), null);
  assert.equal(anchorScore({ ...c, flags: [...c.flags, 'garbled'] }, 'Sam Altman'), null);
  assert.equal(anchorScore({ ...c, look: look({ portrait: true, garbled: true }) }, 'Sam Altman'), null);
});

const FACTS = (texts: string[], cast: FactSheet['cast'] = []): FactSheet => ({
  summary: 's',
  timeline: [],
  facts: texts.map((text, i) => ({ id: `F${i + 1}`, text, source_ids: [], key: false, confidence: 'confirmed' as const })),
  sources: [],
  quotes: [],
  artifacts: [],
  cast,
  places: [],
  verdict: { holds: true, reason: '' },
});

test('central people: the central figure, then the cast the facts are most about (3+ facts), at most three; a spine list wins', () => {
  const murati = { name: 'Mira Murati', role: 'OpenAI CTO', kind: 'person' as const, player_id: null, want: 'w', qid: null };
  const facts = FACTS(
    ['Sutskever voted.', 'Sutskever signed.', 'Ilya Sutskever regretted it.', 'Murati was named interim CEO.', 'Murati signed the letter.', 'Mira Murati spoke.', 'Murati left.', 'Brockman quit.'],
    [murati],
  );
  assert.deepEqual(centralPeople(PITCH, facts), ['Greg Brockman', 'Mira Murati', 'Ilya Sutskever']);
  assert.deepEqual(centralPeople(PITCH, null), ['Greg Brockman'], 'before the facts: the central figure and cast the scene names');
  assert.deepEqual(centralPeople(PITCH, facts, ['Ilya Sutskever']), ['Ilya Sutskever']);
  const cast = castPeople(PITCH, facts);
  assert.deepEqual(cast.map((p) => [p.name, p.main, p.central]), [['Mira Murati', false, true], ['Greg Brockman', true, true], ['Ilya Sutskever', true, true]]);
});

test('cutouts: a central person gets a transparent cutout of their verified portrait, which becomes their anchor', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-cut-');
  const cut: string[] = [];
  const result = await runHarvest(
    {
      db,
      http: stubHttp(),
      create: stubLooks(),
      loadPrompt: () => 'LOOK',
      serperKey: 'k',
      cutouts: [],
      upscale: goodUpscale,
      detectFaces: async (files) => new Map(files.map((f) => [f, [{ x: 0.4, y: 0.1, w: 0.2, h: 0.25, score: 0.9 }]])),
      cutout: async (src, out) => {
        cut.push(src);
        const m = await sharp(src).metadata();
        await sharp(src).ensureAlpha(0.5).png().toFile(out);
        return { ok: true, width: m.width!, height: m.height!, coverage: 0.4 };
      },
      sketch: null,
      now: () => NOW,
      sleep: async () => undefined,
      log: () => undefined,
    },
    { pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } },
  );
  const { assets } = result.inventory;
  assert.equal(cut.length, 1, 'only the central person (Greg) is cut out');
  assert.match(cut[0], /anchor-greg-brockman\.png$/, 'the low-res portrait was upscaled before cutting');
  const cutout = assets.find((a) => a.flags.includes('cutout_made'))!;
  assert.ok(cutout, result.notes.join(' | '));
  assert.equal(cutout.anchor_for, 'Greg Brockman');
  assert.equal(cutout.character_image, true);
  assert.ok(cutout.flags.includes('cutout') && cutout.flags.includes('identity:verified'));
  assert.equal(path.extname(cutout.file), '.png');
  assert.equal((await sharp(path.join(jobDir, cutout.file)).metadata()).hasAlpha, true);
  const of = cutout.flags.find((f) => f.startsWith('cutout_of:'))!.slice('cutout_of:'.length);
  const source = assets.find((a) => a.id === of)!;
  assert.equal(source.anchor_for, null, 'the photo it was cut from is no longer the anchor');
  assert.equal(source.character_image, false);
  assert.ok(!source.flags.includes('anchor:Greg Brockman'));
  assert.equal(assets.filter((a) => a.anchor_for === 'Greg Brockman').length, 1);
  const greg = result.cast.find((c) => c.name === 'Greg Brockman')!;
  assert.equal(greg.cutout, cutout.id);
  assert.equal(greg.anchor, cutout.id);
  assert.equal(greg.central, true);
  assert.equal(greg.target, 6);
  assert.equal(result.cast.find((c) => c.name === 'Ilya Sutskever')!.cutout, null, 'Ilya is named, not central: no cutout');
});

test('fact-sheet cast: with the reporting still running, the cast passes wait for it and the fact-sheet people get portraits', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-factcast-');
  let release: (f: FactSheet) => void = () => undefined;
  const facts = new Promise<FactSheet>((resolve) => (release = resolve));
  const murati = { name: 'Mira Murati', role: 'OpenAI CTO', kind: 'person' as const, player_id: null, want: 'w', qid: null };
  setTimeout(() => release(FACTS(['Murati was named interim CEO.'], [murati])), 20);
  const result = await runHarvest(
    { db, http: stubHttp(), create: stubLooks(), loadPrompt: () => 'LOOK', serperKey: 'k', cutouts: [], upscale: goodUpscale, detectFaces: null, sketch: null, now: () => NOW, sleep: async () => undefined, log: () => undefined },
    { pitch: PITCH, facts, jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } },
  );
  assert.ok(result.wants.some((w) => w.id === 'person:mira-murati'));
  const mira = result.cast.find((c) => c.name === 'Mira Murati')!;
  assert.ok(mira, 'the fact-sheet person is in the cast coverage');
  assert.equal(mira.main, false);
  assert.ok(mira.verified >= 1, JSON.stringify(mira));
  assert.ok(result.inventory.assets.some((a) => a.people.includes('Mira Murati')));
});

const asset = (over: Partial<Asset> & Pick<Asset, 'id'>): Asset => ({
  kind: 'person_photo', file: `media/${over.id}.jpg`, url: null, source_page: null, credit: 'c', license: null, shows: 's', people: ['Sam Altman'], qids: [], place: null,
  date_taken: null, date_confidence: 'unknown', width: 1200, height: 1500, phash: null, character_image: false, made: false, upscaled: false, flags: ['identity:verified'],
  anchor_for: null, face: null, made_kind: null, ...over,
});

test('anchor fallback: an anchor the integrity check calls garbled hands the job to the next best portrait', () => {
  const inventory: VisualsInventory = {
    assets: [
      asset({ id: 'V1', anchor_for: 'Sam Altman', character_image: true, flags: ['identity:verified', 'cutout', 'anchor:Sam Altman'] }),
      asset({ id: 'V2', face: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 } }),
      asset({ id: 'V3', flags: ['identity:verified', 'group_photo:3_faces'], width: 3000, height: 3000 }),
      asset({ id: 'V4', flags: ['identity:probable'], width: 3000, height: 3000 }),
      asset({ id: 'V5', people: ['Elon Musk'], anchor_for: 'Elon Musk', character_image: true }),
    ],
    usable_count: 5,
    counts: {},
    kill: null,
    usd: 0,
  };
  const bad = garbledAssetIds([
    { asset_id: 'V1', why: 'The image is garbled: shuffled tiles on a black ground.' },
    { asset_id: 'V5', why: 'Shows a different event than the line says.' },
  ]);
  assert.deepEqual(bad, ['V1']);
  const { inventory: next, moved } = reanchor(inventory, bad);
  assert.deepEqual(moved, [{ name: 'Sam Altman', from: 'V1', to: 'V2' }]);
  const byId = new Map(next.assets.map((a) => [a.id, a]));
  assert.equal(byId.get('V1')!.anchor_for, null);
  assert.ok(byId.get('V1')!.flags.includes('garbled'));
  assert.equal(byId.get('V2')!.anchor_for, 'Sam Altman');
  assert.equal(byId.get('V2')!.character_image, true);
  assert.equal(byId.get('V5')!.anchor_for, 'Elon Musk', 'other people keep their anchors');
  assert.equal(inventory.assets[0].anchor_for, 'Sam Altman', 'the input is not changed');
  assert.deepEqual(reanchor(inventory, []).moved, []);
});

// ── The wish search (MD-68) ─────────────────────────────────────────────────

test('wish wants: at most three searches per wish, the person plus the wish key words; places and events without a person', () => {
  const w = wishWants({ id: 'W1', person: 'Greg Brockman', want: 'Greg Brockman on stage announcing the launch at a 2017 keynote', frame_ns: [3], fallback: 'V2' });
  assert.ok(w.length <= WISH_QUERIES);
  assert.equal(w[0].terms, 'Greg Brockman stage announcing 2017');
  assert.equal(w[2].terms, 'Greg Brockman 2017', 'Commons ANDs every word: the person and the year only');
  assert.equal(w[0].kind, 'person_photo');
  assert.deepEqual(w[0].people, ['Greg Brockman']);
  assert.deepEqual(w.map((x) => x.sources[0]), ['serper', 'serper', 'commons']);
  assert.ok(w.every((x) => x.id.startsWith('wish:W1:') && x.what.includes('on stage')));
  const place = wishWants({ id: 'W2', person: null, want: 'The Rosewood hotel exterior at night', frame_ns: [1], fallback: 'M1' });
  assert.equal(place[0].kind, 'place_photo');
  assert.deepEqual(place[0].people, []);
});

function wishLooks(rule: (caption: string) => Partial<Look>) {
  return async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    const text = ((params.messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.TextBlockParam).text;
    const tiles = [...text.matchAll(/^(\d+)\. from (\w+); meant to show: (.*); caption: (.*)$/gm)].map((m) => ({ tile: Number(m[1]), ...look({ shows: m[4].slice(0, 60), fits: true, ...rule(m[4]) }) }));
    return {
      id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: 'submit_looks', input: { tiles } }],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
}

test('wish search: a fitting, verified picture is numbered after the last V id and saved; a misfit keeps the fallback; cost recorded', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-wish-');
  const media = path.join(jobDir, 'media');
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, 'V1.jpg'), await makeJpeg(1));
  fs.writeFileSync(path.join(media, 'V9.png'), await makePng(2, 600, 800));
  assert.equal(lastVisualNumber(media), 9);
  let serper = 0;
  const http = stubHttp();
  const counting = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('serper')) serper += 1;
    return http(input, init);
  }) as typeof fetch;
  const wishes: ShotWish[] = [
    { id: 'W1', person: 'Greg Brockman', want: 'Greg Brockman on stage at a keynote', frame_ns: [2], fallback: 'V1' },
    { id: 'W2', person: 'Ilya Sutskever', want: 'Ilya Sutskever testifying before a committee', frame_ns: [4], fallback: 'V9' },
  ];
  const result = await searchWishes(
    { db, http: counting, create: wishLooks((caption) => (/Ilya/.test(caption) ? { fits: false } : {})), loadPrompt: () => 'LOOK', serperKey: 'k', cutouts: [], upscale: null, detectFaces: null, now: () => NOW, sleep: async () => undefined, log: () => undefined },
    { wishes, pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: DEFAULT_SETTINGS },
  );
  assert.deepEqual(result.found.map((f) => [f.wish_id, f.asset.id]), [['W1', 'V10']]);
  const a = result.found[0].asset;
  assert.ok(fs.existsSync(path.join(jobDir, a.file)));
  assert.deepEqual(a.people, ['Greg Brockman']);
  assert.ok(a.flags.includes('wish:W1') && a.flags.includes('identity:verified'));
  assert.ok(result.problems.some((p) => /^W2: nothing found .* V9 stands in/.test(p)), result.problems.join(' | '));
  assert.ok(serper <= wishes.length * WISH_QUERIES);
  assert.ok(result.usd > 0);
  const { rows } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM reel_ai_drama.cost_events WHERE job_id = $1 ORDER BY component`, [jobId]);
  assert.deepEqual(rows.map((r) => r.component), ['harvest_look', 'harvest_wish_search']);
  const { rows: saved } = await db.query<{ ref: string }>(`SELECT ref FROM reel_ai_drama.assets WHERE job_id = $1`, [jobId]);
  assert.deepEqual(saved.map((r) => r.ref), ['V10']);
  assert.equal(fs.readdirSync(media).some((f) => f.startsWith('tmp-wishes')), false, 'scratch files are cleaned up');
});

test('wish search: a copy of an inventory picture is not new; past twelve wishes are not searched; a failing source costs only its wish', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-wish2-');
  const media = path.join(jobDir, 'media');
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, 'V3.jpg'), await makeJpeg(seedOf('https://cdn.example.com/greg-brockman-stage.jpg'), 1800, 1200));
  const http = stubHttp();
  const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('serper') && /Nobody/.test(String(init?.body ?? ''))) throw new Error('socket hang up');
    return http(input, init);
  }) as typeof fetch;
  const wishes: ShotWish[] = [
    { id: 'W1', person: 'Greg Brockman', want: 'Greg Brockman on stage', frame_ns: [2], fallback: 'V3' },
    ...Array.from({ length: MAX_WISHES + 1 }, (_, i): ShotWish => ({ id: `W${i + 2}`, person: null, want: `Nobody scene ${i}`, frame_ns: [1], fallback: 'V3' })),
  ];
  const result = await searchWishes(
    { db, http: flaky, create: wishLooks(() => ({})), loadPrompt: () => 'LOOK', serperKey: 'k', cutouts: [], upscale: null, detectFaces: null, now: () => NOW, sleep: async () => undefined, log: () => undefined },
    { wishes, pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: DEFAULT_SETTINGS },
  );
  // The Serper hit duplicates V3; the name-only Commons search (iteration 4) finds a new picture instead.
  assert.deepEqual(result.found.map((f) => f.wish_id), ['W1']);
  assert.ok(result.found.every((f) => f.asset.url !== 'https://cdn.example.com/greg-brockman-stage.jpg' && f.asset.flags.includes('source:commons')));
  assert.ok(result.problems.some((p) => /^2 wish\(es\) past the first 12 were not searched/.test(p)));
  assert.equal(result.problems.filter((p) => /^W\d+: nothing found/.test(p)).length, MAX_WISHES - 1);
  // An unknown wish id in a candidate never matches; a taken candidate is not picked twice.
  assert.equal(pickForWish([], wishes[0]), null);
});
