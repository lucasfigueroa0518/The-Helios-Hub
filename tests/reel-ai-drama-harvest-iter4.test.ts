import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { cutOffset, faceBoxes, findTesseract, liftRegion, parseTesseractTsv, photoRegions, sidecarPath, tesseractWords, wordBoxes, writeSidecars } from '@/lib/reel-ai-drama/harvest/boxes';
import { anchorScore, type CastCand } from '@/lib/reel-ai-drama/harvest/cast';
import { identityVerdict, type Look } from '@/lib/reel-ai-drama/harvest/filters';
import { LOOK_MAX_TOKENS, lookAt, lookUserText, parseLooks } from '@/lib/reel-ai-drama/harvest/look';
import { removePaper } from '@/lib/reel-ai-drama/harvest/transparent';
import { pickForWish, searchWishes, wishNames, wishPages, wishWants } from '@/lib/reel-ai-drama/harvest/wishes';
import type { Cand } from '@/lib/reel-ai-drama/harvest/pipeline';
import { makeAssets, type GenerateImage } from '@/lib/reel-ai-drama/render/make';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, Pitch, ShotWish, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';
import { makeJpeg, seedOf } from './fixtures/reel-ai-drama/harvest/images';

/** Iteration 4, builder B: the wish search and wrong-anchor fixes, box sidecars, transparent makes. All offline. */

const NOW = new Date('2026-11-02T12:00:00Z');
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const look = (over: Partial<Look> = {}): Look => ({ shows: 's', watermark: false, tv_logo: false, ai_generated: false, faces: 1, text_heavy: false, about_story: true, key_moment: false, ...over });

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`);
  const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'production', 8) RETURNING id`, [p.id]);
  return { db, jobId: job.id };
}

const PITCH: Pitch = {
  title: 'The dinner that made OpenAI',
  logline: 'l',
  pitch: 'p',
  story_type: 'power_struggle',
  era: 'history',
  event_date: '2015-07-01',
  date_precision: 'month',
  cast: [
    { name: 'Sam Altman', role: 'Y Combinator president', kind: 'person', player_id: null, want: 'w' },
    { name: 'Thomas Wolf', role: 'Hugging Face co-founder', kind: 'person', player_id: null, want: 'w' },
  ],
  central_figure: 'Sam Altman',
  scene: 'A dinner at the Rosewood',
  turn: 't',
  implication: 'i',
  why_now: null,
  engine: 'e',
  expected_visuals: [],
  sources: [],
} as unknown as Pitch;

type Line = { n: number; source: string; claim: string; caption: string };
const linesOf = (params: Anthropic.MessageCreateParamsNonStreaming): Line[] => {
  const text = ((params.messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.TextBlockParam).text;
  return [...text.matchAll(/^(\d+)\. from (\w+); meant to show: (.*); caption: (.*)$/gm)].map((m) => ({ n: Number(m[1]), source: m[2], claim: m[3], caption: m[4] }));
};
const message = (input: unknown, stop: string) =>
  ({
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: stop, stop_sequence: null,
    content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 't', name: 'submit_looks', input }],
    usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Message;

// ── 1. The look: room for thinking, and a short answer is re-asked ──────────

test('look: a sheet cut off at max_tokens with an empty call is re-asked for its missing tiles only (Rosewood W2–W6)', async () => {
  const { db, jobId } = await freshJob();
  const dir = tmp('rad4-look-');
  const files = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const f = path.join(dir, `${i}.jpg`);
    fs.writeFileSync(f, await makeJpeg(300 + i, 400, 300));
    return f;
  }));
  const items = files.map((file, i) => ({ file, claim: 'c', caption: `item ${i}`, source: 'serper' }));
  const ctx = { title: 't', keyMoment: 'k', cast: ['Thomas Wolf'], roles: { 'Thomas Wolf': 'Hugging Face co-founder' }, jobId, mode: 'production' as const };
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let first = true;
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    if (first) {
      first = false;
      return message({}, 'max_tokens');
    }
    return message({ tiles: linesOf(params).map((l) => ({ tile: l.n, ...look({ shows: l.caption }) })) }, 'tool_use');
  };
  const res = await lookAt({ db, create, loadPrompt: () => 'LOOK', model: 'claude-haiku-5-5' }, items, { ...ctx, capUsd: 1 });
  assert.equal(calls[0].max_tokens, LOOK_MAX_TOKENS);
  assert.ok(LOOK_MAX_TOKENS >= 12_000, 'thinking and 16 tiles both fit');
  assert.equal(calls.length, 3, 'sheet 1, sheet 1 again (missing tiles), sheet 2');
  assert.equal(linesOf(calls[1]).length, 16);
  assert.equal(res.looks.size, 20);
  assert.equal(res.looks.get(5)!.shows, 'item 5', 'the re-asked tiles map back to their items');
  assert.deepEqual(res.errors, []);
  const text = ((calls[0].messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.TextBlockParam).text;
  assert.match(text, /Cast: Thomas Wolf \(Hugging Face co-founder\)/);

  const empty = await lookAt({ db, create: async () => message({}, 'max_tokens'), loadPrompt: () => 'LOOK', model: 'm' }, items.slice(0, 3), { ...ctx, capUsd: 1 });
  assert.equal(empty.looks.size, 0);
  assert.match(empty.errors.join(' | '), /3 tile\(s\) still unanswered after a second ask \(max_tokens, then max_tokens\)/);
  assert.equal(lookUserText({ title: 't', keyMoment: 'k', cast: ['A B'] }, []).includes('Cast: A B'), true, 'no role: the bare name');
});

// ── 2. Wish queries from names, not prose ──────────────────────────────────

test('wish wants: names and roles, no shot words; Commons gets names only; a named page is captured with its figures measured', () => {
  const altman = wishWants(
    { id: 'W3', person: 'Sam Altman', want: 'A photo of Sam Altman alone, face clear, around 2014–2015, while president of Y Combinator (e.g. speaking at a YC or TechCrunch event).', frame_ns: [2], fallback: 'V26' },
    { context: 'OpenAI co-founder' },
  );
  assert.deepEqual(altman.map((w) => w.terms), ['Sam Altman Y Combinator YC 2014', 'Sam Altman Y Combinator', 'Sam Altman 2014']);
  assert.ok(altman.every((w) => !/\b(photo|alone|clear|around|while)\b/i.test(w.terms)));

  const hq = wishWants({ id: 'W2', person: null, want: "An exterior photo of Google's headquarters (the Googleplex) in Mountain View, California, with the Google sign or logo clearly visible, mid-2010s.", frame_ns: [1], fallback: 'M4' });
  assert.equal(hq[0].kind, 'place_photo');
  assert.equal(hq[0].terms, 'Google Googleplex Mountain View headquarters');
  assert.equal(hq[2].terms, 'Google Googleplex', 'not "exterior photo"');

  const wolf = wishWants({ id: 'W2', person: 'Thomas Wolf', want: 'A real photo of Thomas Wolf from around 2018–2019, with his face clear.', frame_ns: [1], fallback: 'V2' }, { context: 'Hugging Face co-founder' });
  assert.equal(wolf[1].terms, 'Thomas Wolf Hugging Face', 'no names in the wish: the role says which Thomas Wolf');

  const table = wishWants({ id: 'W6', person: null, want: 'The ConvAI2 human-evaluation results table (on convai.io/2018 or in arXiv 1902.00098) showing Lost in Conversation at 3.11 and Hugging Face at 2.68.', frame_ns: [7], fallback: 'V20' });
  assert.match(table[0].terms, /^ConvAI2 Lost in Conversation Hugging Face .*2018$/);
  const pages = table.filter((w) => w.url);
  assert.deepEqual(pages.map((w) => [w.sources[0], w.url]), [['paper', 'https://arxiv.org/abs/1902.00098'], ['screen', 'https://convai.io/2018']]);
  assert.deepEqual(pages[0].phrases, ['3.11', '2.68']);
  assert.ok(table.filter((w) => !w.url).length <= 3);

  assert.deepEqual(wishNames("A screenshot of OpenAI's December 11, 2015 blog post 'Introducing OpenAI' listing Ilya Sutskever."), ['"Introducing OpenAI"', 'OpenAI', 'Ilya Sutskever']);
  assert.deepEqual(wishPages('No page here, e.g. a photo.'), []);
});

// ── 3. The wish search keeps fitting pictures ──────────────────────────────

const IMG_SIZES: Record<string, [number, number]> = { campus: [1600, 1000], 'big-misfit': [1600, 1200], 'small-table': [900, 420], 'wolf-denver': [1200, 1500], 'wolf-hf': [1200, 1500] };

function wishHttp(): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const img = (name: string, title: string, link = `https://example.com/${name}`) => ({ title, imageUrl: `https://cdn.example.com/${name}.jpg`, link, source: 'Example', domain: 'example.com' });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    if (u.hostname === 'google.serper.dev') {
      const q = String(JSON.parse(String(init?.body ?? '{}')).q ?? '');
      if (/Googleplex/.test(q)) return json({ images: [img('campus', 'Aerial view of the Googleplex campus')] });
      if (/ConvAI2/.test(q)) return json({ images: [img('big-misfit', 'ConvAI2 worksheet'), img('small-table', 'ConvAI2 human evaluation leaderboard')] });
      if (/Thomas Wolf/.test(q)) return json({ images: [img('wolf-denver', 'Thomas Wolf', 'https://denverite.com/2022/09/06/thomas-wolf-denver-mayor-race-2023/')] });
      return json({ images: [] });
    }
    if (u.hostname === 'commons.wikimedia.org') return json({ query: { search: [] } });
    if (/\.jpe?g$/i.test(u.pathname)) {
      const key = Object.keys(IMG_SIZES).find((k) => u.pathname.includes(k));
      const [w, h] = key ? IMG_SIZES[key] : [1600, 1000];
      return new Response(new Uint8Array(await makeJpeg(seedOf(u.pathname), w, h)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function wishLooks(rule: (caption: string) => Partial<Look>) {
  return async (params: Anthropic.MessageCreateParamsNonStreaming) =>
    message({ tiles: linesOf(params).map((l) => ({ tile: l.n, ...look({ shows: l.caption, fits: true }), ...rule(l.caption) })) }, 'tool_use');
}

const resizeUpscale = async (input: string, output: string, scale: number) => {
  const m = await sharp(input).metadata();
  await sharp(input).resize(Math.round(m.width! * scale), Math.round(m.height! * scale), { fit: 'fill' }).toFile(output);
};

test('wish search: a fitting place picture is never "off story"; a small fitting table beats a big misfit; outcomes are logged', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad4-wish-');
  fs.mkdirSync(path.join(jobDir, 'media'), { recursive: true });
  const logs: Record<string, unknown>[] = [];
  const wishes: ShotWish[] = [
    { id: 'W2', person: null, want: "An exterior photo of Google's headquarters (the Googleplex) in Mountain View, California.", frame_ns: [1], fallback: 'M4' },
    { id: 'W6', person: null, want: 'The ConvAI2 human-evaluation results table showing Lost in Conversation at 3.11.', frame_ns: [7], fallback: 'V20' },
  ];
  const rule = (caption: string): Partial<Look> =>
    /Googleplex/.test(caption) ? { about_story: false, faces: 0 } : /worksheet/.test(caption) ? { fits: false, about_story: false, faces: 0 } : { faces: 0, text_heavy: true };
  const result = await searchWishes(
    { db, http: wishHttp(), create: wishLooks(rule), loadPrompt: () => 'LOOK', serperKey: 'k', cutouts: [], upscale: resizeUpscale, detectFaces: null, now: () => NOW, sleep: async () => undefined, log: (e) => logs.push(e) },
    { wishes, pitch: PITCH, facts: null, jobDir, jobId, mode: 'production', settings: DEFAULT_SETTINGS },
  );
  assert.deepEqual(result.found.map((f) => f.wish_id), ['W2', 'W6'], result.problems.join(' | '));
  assert.match(result.found[0].asset.url!, /campus/);
  const tableAsset = result.found[1].asset;
  assert.match(tableAsset.url!, /small-table/);
  assert.ok(tableAsset.flags.some((f) => f.startsWith('upscaled:')));
  // Every saved wish picture gets its box sidecar.
  assert.ok(fs.existsSync(sidecarPath(path.join(jobDir, tableAsset.file))));
  assert.ok(tableAsset.flags.some((f) => f.startsWith('boxes:')));
  const done = logs.find((e) => e.event === 'wish_search_done') as { outcomes: Record<string, string[]> };
  assert.ok(done.outcomes.W6.some((o) => /big-misfit.*(fits=false|off_story)/.test(o)), JSON.stringify(done.outcomes));
});

// ── 4. Identity: a namesake never anchors ──────────────────────────────────

test('identity: the look\'s namesake verdict drops the claim; a title+URL name on an off-story picture stays probable and cannot anchor', () => {
  const p = { people: ['Thomas Wolf'], kind: 'person_photo' as const, flags: [] as string[], qids: [] as string[], source: 'serper' as const, caption: 'Thomas Wolf', url: 'https://cdn.example.com/thomas-wolf.jpg', source_page: 'https://denverite.com/2022/09/06/thomas-wolf-denver-mayor-race-2023/' };
  assert.equal(identityVerdict(p, look({ namesake: true })).reject, 'identity:namesake');
  assert.deepEqual(identityVerdict({ ...p, kind: 'event_photo' }, look({ namesake: true })), { reject: null, people: [], flags: ['identity:namesake'] });
  // Before iteration 4 this was verified (title_and_url), and became Best on Paper's anchor.
  const offStory = identityVerdict(p, look({ about_story: false }));
  assert.deepEqual(offStory.people, ['Thomas Wolf']);
  assert.ok(offStory.flags.includes('identity:probable') && offStory.flags.includes('identity:name_only_off_story'));
  assert.deepEqual(identityVerdict(p, look()).flags, ['identity:verified', 'identity_basis:title_and_url'], 'on story: as before');
  // QID-tied evidence is not second-guessed by a namesake verdict.
  assert.equal(identityVerdict({ ...p, source: 'wikidata', qids: ['Q4'] }, look({ namesake: true })).reject, null);
  const cand: CastCand = { source: 'serper', kind: 'person_photo', people: ['Thomas Wolf'], qids: [], caption: 'Thomas Wolf', flags: offStory.flags, made: false, character_image: false, width: 1200, height: 1500, file: '/x.jpg', look: look({ about_story: false, portrait: true }), faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.3, score: 0.9 }], face: { x: 0.3, y: 0.2, w: 0.3, h: 0.3 }, recency: 0.4, order: 0, reject: null };
  assert.equal(anchorScore(cand, 'Thomas Wolf'), null);
  assert.equal(parseLooks({ tiles: [{ tile: 1, shows: 'x', namesake: true }] }, 1).get(0)!.namesake, true);
});

test('wish pick: within a year of the wish beats a newer, bigger photo far from it', () => {
  const wish: ShotWish = { id: 'W5', person: 'Sam Altman', want: 'Sam Altman around 2015', frame_ns: [1], fallback: 'V1' };
  const base = { source: 'commons', kind: 'person_photo', wants: ['wish:W5:1'], key_want: false, url: null, source_page: null, credit: '', license: null, caption: 'Sam Altman', people: ['Sam Altman'], qids: [], place: null, date_basis: 'commons', character_image: false, made: false, trusted: false, flags: ['identity:verified'], bytes: null, phash: null, reject: null, look: look({ fits: true }), recency: 0.4, upscaled: false, faces: null, face: null, anchor_for: null, file: '/x.jpg' };
  const old = { ...base, order: 1, date_taken: '2015-06-01', width: 1000, height: 1200 } as unknown as Cand;
  const recent = { ...base, order: 0, date_taken: '2024-06-01', width: 1600, height: 2000 } as unknown as Cand;
  assert.equal(pickForWish([recent, old], wish), old);
});

// ── 5. Box sidecars ────────────────────────────────────────────────────────

/** A white page: black text bars on top, a colourful photo block lower down. */
async function pagePng(file: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="#fff"/>
    ${Array.from({ length: 8 }, (_, i) => `<rect x="80" y="${80 + i * 50}" width="${600 + (i % 3) * 80}" height="18" fill="#111"/>`).join('')}
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a6fa5"/><stop offset="0.5" stop-color="#c08552"/><stop offset="1" stop-color="#5e8c61"/></linearGradient></defs>
    <rect x="200" y="700" width="600" height="500" fill="url(#g)"/><circle cx="500" cy="900" r="90" fill="#d9a07a"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

test('sidecars: faces (named when one person), Tesseract words, the picture inside a page, and a lift cut from it; the old pixel boxes are kept', async () => {
  const jobDir = tmp('rad4-box-');
  fs.mkdirSync(path.join(jobDir, 'media'));
  await pagePng(path.join(jobDir, 'media', 'V5.png'));
  // An old screenshot sidecar (measured phrases in pixels) already sits there.
  fs.writeFileSync(path.join(jobDir, 'media', 'V5.boxes.json'), JSON.stringify({ image: 'media/V5.png', width: 1000, height: 1400, boxes: [{ text: 'Headline', x: 80, y: 80, w: 600, h: 18 }] }));
  await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#888' } }).jpeg().toFile(path.join(jobDir, 'media', 'V1.jpg'));
  const asset = (id: string, file: string, kind: Asset['kind'], people: string[] = []): Asset =>
    ({ id, kind, file, url: null, source_page: null, credit: '', license: null, shows: '', people, qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 0, height: 0, phash: null, character_image: false, made: false, upscaled: false, flags: [], anchor_for: null, face: null, made_kind: null }) as Asset;
  const page = asset('V5', 'media/V5.png', 'web_page', ['Sam Altman']);
  const photo = asset('V1', 'media/V1.jpg', 'person_photo', ['Sam Altman']);
  const cut: string[] = [];
  let trim = { left: 0, top: 0, width: 0, height: 0 };
  const notes = await writeSidecars(
    jobDir,
    [{ asset: page }, { asset: photo, faces: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.3, score: 0.95 }] }],
    {
      detectFaces: async (files) => new Map(files.map((f) => [f, [{ x: 0.45, y: 0.6, w: 0.1, h: 0.1, score: 0.9 }]])),
      readWords: async () => [{ text: 'Headline', left: 80, top: 80, width: 600, height: 18, conf: 91 }, { text: '~', left: 0, top: 0, width: 5, height: 5, conf: 95 }, { text: 'faint', left: 80, top: 130, width: 100, height: 18, conf: 30 }],
      // Like rembg + Real Case's trim: the figure's own pixels (the round face drawn in the picture), cropped to it.
      cutout: async (src, out) => {
        cut.push(src);
        const m = await sharp(src).metadata();
        trim = { left: Math.round(m.width! / 2) - 110, top: Math.round(m.height! / 2) - 160, width: 220, height: 200 };
        await sharp(src).extract(trim).ensureAlpha().png().toFile(out);
        return { ok: true, width: 220, height: 200, coverage: 0.5 };
      },
    },
  );
  assert.deepEqual(notes, []);
  const side = JSON.parse(fs.readFileSync(path.join(jobDir, 'media', 'V5.boxes.json'), 'utf8'));
  assert.deepEqual(side.boxes, [{ text: 'Headline', x: 80, y: 80, w: 600, h: 18 }], 'old pixel boxes kept');
  assert.deepEqual(side.words.map((w: { text: string }) => w.text), ['Headline'], 'confident words with a letter only');
  assert.ok(Math.abs(side.words[0].box.x - 0.08) < 1e-6 && Math.abs(side.words[0].box.w - 0.6) < 1e-6);
  assert.equal(side.faces.length, 1);
  assert.equal(side.faces[0].name, 'Sam Altman');
  const photoBox = side.photos[0];
  assert.ok(photoBox.x <= 0.21 && photoBox.y <= 0.51 && photoBox.x + photoBox.w >= 0.79 && photoBox.y + photoBox.h >= 0.85, JSON.stringify(side.photos));
  assert.ok(side.photos.every((b: { y: number }) => b.y >= 0.35), 'the text block is not a picture');
  assert.equal(side.lift, 'V5.lift.png');
  assert.ok(fs.existsSync(path.join(jobDir, 'media', 'V5.lift.png')) && cut.length === 1);
  // lift_from is where the trimmed lift file really sits on the page, not the crop it was cut from.
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  assert.deepEqual(side.lift_from, { x: r4((Math.floor(photoBox.x * 1000) + trim.left) / 1000), y: r4((Math.floor(photoBox.y * 1400) + trim.top) / 1400), w: r4(trim.width / 1000), h: r4(trim.height / 1400) });
  assert.ok(page.flags.includes('boxes:media/V5.boxes.json') && page.flags.includes('lift'));
  const ph = JSON.parse(fs.readFileSync(path.join(jobDir, 'media', 'V1.boxes.json'), 'utf8'));
  assert.deepEqual(ph, { faces: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.3, score: 0.95, name: 'Sam Altman' }], words: [], photos: [], lift: null }, 'a photo: no OCR, no regions, no lift');
  assert.equal(fs.readdirSync(path.join(jobDir, 'media')).some((f) => f.includes('lift-src')), false, 'the crop is cleaned up');
});

test('sidecar helpers: TSV parsing, word and face normalisation, the lift region holds the biggest face', async () => {
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t96.5\tOpenAI\n5\t1\t1\t1\t1\t2\t50\t20\t30\t10\t88\t\n';
  assert.deepEqual(parseTesseractTsv(tsv), [{ text: 'OpenAI', left: 10, top: 20, width: 30, height: 10, conf: 96.5 }]);
  assert.deepEqual(wordBoxes(parseTesseractTsv(tsv), 100, 100), [{ text: 'OpenAI', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }]);
  const faces = faceBoxes([{ x: 0, y: 0, w: 0.1, h: 0.1, score: 0.9 }, { x: 0.5, y: 0.5, w: 0.3, h: 0.3, score: 0.8 }], ['A', 'B']);
  assert.deepEqual(faces.map((f) => f.w), [0.3, 0.1]);
  assert.ok(faces.every((f) => !f.name), 'two faces, two people: no names guessed');
  assert.deepEqual(liftRegion([{ x: 0, y: 0, w: 0.4, h: 0.4 }, { x: 0.4, y: 0.4, w: 0.6, h: 0.6 }], faces), { x: 0.4, y: 0.4, w: 0.6, h: 0.6 });
  const plain = tmp('rad4-plain-');
  const f = path.join(plain, 'white.png');
  await sharp({ create: { width: 400, height: 400, channels: 3, background: '#fff' } }).png().toFile(f);
  assert.deepEqual(await photoRegions(f), []);
});

test('sidecars: the real Tesseract reads a rendered word (local OCR, skipped when not installed)', { skip: !findTesseract() }, async () => {
  const dir = tmp('rad4-ocr-');
  const f = path.join(dir, 'w.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><rect width="900" height="200" fill="#fff"/><text x="40" y="130" font-size="96" font-family="Helvetica, Arial" fill="#000">Leaderboard</text></svg>')).png().toFile(f);
  const words = await tesseractWords()(f);
  assert.ok(words.some((w) => /leaderboard/i.test(w.text) && w.conf >= 60), JSON.stringify(words));
});

// ── 6. Made drawings lose their paper ──────────────────────────────────────

const lineArt = (w = 400, h = 400) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="none" stroke="#000" stroke-width="10"/></svg>`)).png().toBuffer();

test('transparent: ink keeps only the strokes (inside the figure too); paper keeps the element and drops the white around it', async () => {
  const ink = await removePaper(await lineArt(), 'ink');
  assert.ok(ink);
  const { data, info } = await sharp(ink!.png).raw().toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(info.channels, 4);
  assert.equal(alpha(5, 5), 0, 'corner: transparent');
  assert.equal(alpha(200, 200), 0, 'inside the circle: no paper');
  assert.equal(alpha(300, 200), 255, 'on the stroke: opaque');
  const element = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><rect x="60" y="60" width="180" height="180" fill="#e8dcc0"/><rect x="120" y="120" width="60" height="60" fill="#fff"/></svg>')).png().toBuffer();
  const paper = await removePaper(element, 'paper');
  const p = await sharp(paper!.png).raw().toBuffer({ resolveWithObject: true });
  const pa = (x: number, y: number) => p.data[(y * p.info.width + x) * 4 + 3];
  assert.equal(pa(10, 10), 0);
  assert.equal(pa(100, 100), 255);
  assert.equal(pa(150, 150), 255, 'white inside the element is its own paper, kept');
  const blank = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal(await removePaper(blank, 'ink'), null, 'nothing drawn: refused, the caller keeps the original');
});

test('makeAssets: a drawing comes out transparent and flagged; a setting stays opaque', async () => {
  const jobDir = tmp('rad4-make-');
  const plan = {
    frames: [],
    makes: [
      { id: 'M1', kind: 'drawing', brief: 'a stack of banknotes', people: [], from_assets: [], seed: null },
      { id: 'M2', kind: 'setting', brief: 'a dining room', people: [], from_assets: [], seed: null },
    ],
  } as unknown as DirectorPlan;
  const generate: GenerateImage = async ({ size }) => {
    const [w, h] = size.split('x').map(Number);
    return { png: await lineArt(w / 4, h / 4), usage: { textInputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0, usd: 0.04 } };
  };
  const out = await makeAssets({ plan, inventory: { assets: [], usable_count: 0, counts: {}, kill: null, usd: 0 } as VisualsInventory, jobDir, draft: {} as WriterDraft }, { generate });
  assert.deepEqual(out.problems, []);
  const [drawing, setting] = out.assets;
  assert.ok(drawing.flags.includes('transparent'));
  assert.equal(setting.flags.includes('transparent'), false);
  assert.equal((await sharp(path.join(jobDir, drawing.file)).metadata()).hasAlpha, true);
  const s = await sharp(path.join(jobDir, setting.file)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(s.info.channels === 4 ? s.data[3] : 255, 255, 'the setting keeps its paper');
});

test('cutOffset: a trimmed cut-out is found where it sits in its source; a flat one cannot be told', () => {
  const W = 64, H = 48;
  const src = { data: new Uint8Array(W * H * 4), width: W, height: H, channels: 4 };
  for (let i = 0; i < W * H; i++) { src.data[i * 4] = (i * 37) % 251; src.data[i * 4 + 1] = (i * 91) % 241; src.data[i * 4 + 2] = (i * 13) % 239; src.data[i * 4 + 3] = 255; }
  const crop = (x0: number, y0: number, w: number, h: number) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = src.data[((y0 + y) * W + x0 + x) * 4 + c];
    // Its margin is transparent (the remover's cut), its figure opaque.
    for (let x = 0; x < w; x++) data[x * 4 + 3] = 0;
    return { data, width: w, height: h, channels: 4 };
  };
  assert.deepEqual(cutOffset(src, crop(11, 7, 30, 25)), { x: 11, y: 7 });
  const flat = { data: new Uint8Array(W * H * 4).fill(200), width: W, height: H, channels: 4 };
  assert.equal(cutOffset(flat, { data: new Uint8Array(20 * 20 * 4).fill(200), width: 20, height: 20, channels: 4 }), null);
});
