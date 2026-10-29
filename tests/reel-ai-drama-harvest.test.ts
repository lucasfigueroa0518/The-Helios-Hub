import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import type { Queryable } from '@/lib/explainers/db';
import type { BankedCutout } from '@/lib/real-case/bank';
import { spendFor } from '@/lib/reel-ai-drama/cost';
import {
  blockedDomain,
  dedupeByHash,
  hamming,
  identityVerdict,
  lookVerdict,
  metadataVerdict,
  parseIptc,
  phash,
  preScreen,
  readImageMeta,
  recencyFlags,
  recencyScore,
  sizeFloor,
  upscaleFactor,
  type Look,
} from '@/lib/reel-ai-drama/harvest/filters';
import { runHarvest } from '@/lib/reel-ai-drama/harvest/harvest';
import { contactSheet, lookAt } from '@/lib/reel-ai-drama/harvest/look';
import { geocode, mapSource, nominatimGate } from '@/lib/reel-ai-drama/harvest/places';
import { planWants } from '@/lib/reel-ai-drama/harvest/plan';
import { recentlyUsed, recordUses } from '@/lib/reel-ai-drama/harvest/reuse';
import { boxesToImagePixels } from '@/lib/reel-ai-drama/harvest/screens';
import { articleSource, newsroomSource, parsePageImages } from '@/lib/reel-ai-drama/harvest/sources/articles';
import { bankSource } from '@/lib/reel-ai-drama/harvest/sources/bank';
import { commonsSource } from '@/lib/reel-ai-drama/harvest/sources/commons';
import { documentSource, paperSource, screenSourceAdapter } from '@/lib/reel-ai-drama/harvest/sources/documents';
import { logoSource } from '@/lib/reel-ai-drama/harvest/sources/logos';
import { openverseSource } from '@/lib/reel-ai-drama/harvest/sources/openverse';
import { serperSource } from '@/lib/reel-ai-drama/harvest/sources/serper';
import { videoSource } from '@/lib/reel-ai-drama/harvest/sources/video';
import { wikidataSource } from '@/lib/reel-ai-drama/harvest/sources/wikidata';
import type { HarvestDeps, RawCandidate, Screenshot, SourceRun, Want } from '@/lib/reel-ai-drama/harvest/types';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { FactSheet, Pitch } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';
import { makeJpeg, makePng, nearCopy, seedOf } from './fixtures/reel-ai-drama/harvest/images';

const FIX = path.join(__dirname, 'fixtures', 'reel-ai-drama', 'harvest');
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');
const pitch = JSON.parse(fixture('pitch.json')) as Pitch;
const facts = () => JSON.parse(fixture('factsheet.json')) as FactSheet;
const NOW = new Date('2026-10-28T12:00:00Z');
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ── A recorded web: every outside call answers from a fixture ───────────────

type Seen = { url: string; init?: RequestInit };

function fixtureHttp(seen: Seen[] = []): typeof fetch {
  const json = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  const jpeg = (b: Buffer) => new Response(new Uint8Array(b), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, init });
    const u = new URL(url);
    if (u.hostname === 'www.wikidata.org') return json(fixture('wikidata-entity.json'));
    if (u.hostname === 'commons.wikimedia.org') {
      if (u.searchParams.get('list') === 'search') return json(fixture((u.searchParams.get('srsearch') ?? '').startsWith('haswbstatement') ? 'commons-depicts.json' : 'commons-search.json'));
      return json(fixture('commons-imageinfo.json'));
    }
    if (u.hostname === 'api.openverse.org') return json(fixture('openverse.json'));
    if (u.hostname === 'google.serper.dev') return json(fixture('serper.json'));
    if (u.hostname === 'nominatim.openstreetmap.org') return json(fixture('nominatim.json'));
    if (url === 'https://example-news.com/2026/10/01/board-fires-ceo') return html(fixture('article.html'));
    if (url === 'https://openai.com/index/board-statement') return html(fixture('newsroom.html'));
    if (/\.(jpe?g|png)(\?|$)/i.test(u.pathname + u.search)) {
      if (url.includes('altman-large')) return jpeg(await nearCopy(await makeJpeg(seedOf('https://cdn.example-news.com/altman-devday.jpg'))));
      if (url.includes('tiny-altman')) return jpeg(await makeJpeg(seedOf(url), 300, 200));
      return jpeg(await makeJpeg(seedOf(url)));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const stubScreenshot: Screenshot = async (url, { out, phrases }) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await makePng(seedOf(url), 540, 960));
  return {
    file: out,
    width: 540,
    height: 960,
    boxes: phrases.filter((p) => !/never on the page/.test(p)).map((text) => ({ text, x: 40, y: 300, w: 400, h: 48 })),
    title: `Captured ${url}`,
    captured_at: '2026-10-28T12:00:00.000Z',
  };
};

function makeRun(deps: Partial<HarvestDeps> = {}, over: Partial<SourceRun> = {}): SourceRun {
  const dir = tmp('rad-run-');
  let n = 0;
  return {
    deps: { db: {} as Queryable, http: fixtureHttp(), create: null, loadPrompt: () => 'p', ...deps },
    notes: [],
    now: NOW,
    tmpDir: dir,
    isNews: true,
    eventDate: '2026-10-01',
    cast: ['Sam Altman'],
    spend: { serperQueries: 0, serperUsd: 0, lookUsd: 0 },
    nextName: (ext) => path.join(dir, `c${++n}.${ext}`),
    ...over,
  };
}

const want = (over: Partial<Want>): Want => ({ id: 'w', kind: 'event_photo', what: 'x', terms: 'x', people: [], qids: [], playerId: null, key_moment: false, sources: [], ...over });
const PERSON = want({ id: 'person:sam-altman', kind: 'person_photo', terms: 'Sam Altman', people: ['Sam Altman'], qids: ['Q7407093'] });

// ── Source adapters on recorded responses ───────────────────────────────────

test('wikidata: the main image and depicts files, tied to the QID, with Commons credit and taken date', async () => {
  const got = await wikidataSource(PERSON, makeRun());
  assert.equal(got.length, 2);
  assert.ok(got.every((c) => c.source === 'wikidata' && c.qids[0] === 'Q7407093' && c.people[0] === 'Sam Altman'));
  assert.match(got[0].credit, /Jane Photographer, CC BY 4\.0 · Wikimedia Commons/);
  assert.equal(got[0].date_taken, '2025-05-20');
  assert.equal(got[0].date_basis, 'commons');
  assert.match(got[0].url!, /thumb/, 'the 2160px copy, not the original');
});

test('commons search: bitmaps only; a person search keeps only files that name the person', async () => {
  const place = await commonsSource(want({ kind: 'place_photo', terms: 'OpenAI office' }), makeRun());
  assert.deepEqual(place.map((c) => c.caption.split(' — ')[0]), ['OpenAI office exterior'], 'the SVG is dropped');
  assert.equal(place[0].license, 'CC0');
  assert.deepEqual(await commonsSource(PERSON, makeRun()), []);
});

test('openverse: results with credit, licence and landing page', async () => {
  const got = await openverseSource(want({ kind: 'place_photo', terms: 'office' }), makeRun());
  assert.equal(got.length, 2);
  assert.match(got[0].credit, /Jane Flickr, CC BY .*Openverse/);
  assert.equal(got[0].source_page, 'https://www.flickr.com/photos/x/1');
});

test('serper: skipped with a note without a key; with one, a dated query and the spend counted', async () => {
  const noKey = makeRun();
  assert.deepEqual(await serperSource(PERSON, noKey), []);
  assert.deepEqual(noKey.notes, ['serper: skipped (no SERPER_API_KEY)']);
  const seen: Seen[] = [];
  const run = makeRun({ http: fixtureHttp(seen), serperKey: 'k' });
  const got = await serperSource(PERSON, run);
  assert.equal(got.length, 4);
  assert.equal(run.spend.serperQueries, 1);
  const body = JSON.parse(String(seen[0].init?.body));
  assert.equal(body.q, 'Sam Altman');
  assert.equal(body.tbs, 'cdr:1,cd_min:09/17/2026,cd_max:10/28/2026');
  assert.equal((seen[0].init?.headers as Record<string, string>)['X-API-KEY'], 'k');
});

test('articles: og:image with its JSON-LD credit, figures with the largest srcset and caption credits; icons skipped', async () => {
  const page = parsePageImages(fixture('article.html'), 'https://example-news.com/2026/10/01/board-fires-ceo');
  assert.deepEqual(page.images.map((i) => i.url), ['https://cdn.example-news.com/hero-board.jpg', 'https://cdn.example-news.com/altman-large.jpg', 'https://cdn.example-news.com/tv-still.jpg']);
  assert.equal(page.images[0].credit, 'Example News staff');
  assert.equal(page.images[1].credit, 'Jane Roe/Reuters');
  const got = await articleSource(want({ id: 'article:1', url: 'https://example-news.com/2026/10/01/board-fires-ceo' }), makeRun());
  const altman = got.find((c) => c.url?.includes('altman-large'))!;
  assert.deepEqual(altman.people, ['Sam Altman']);
  assert.equal(altman.kind, 'person_photo');
  assert.equal(altman.credit, 'Jane Roe/Reuters (via Example News)');
  assert.equal(altman.date_taken, '2026-10-02');
  assert.equal(altman.date_basis, 'article');
});

test('newsroom: a company page gives press images credited to the company', async () => {
  const got = await newsroomSource(want({ id: 'article:2', url: 'https://openai.com/index/board-statement' }), makeRun());
  assert.equal(got.length, 2);
  assert.ok(got.every((c) => c.credit === 'OpenAI (press image)' && c.flags.includes('official:OpenAI')));
});

test('bank and logo bank: character images, trusted, from local files', async () => {
  const dir = tmp('rad-bank-');
  const file = path.join(dir, 'sam.png');
  fs.writeFileSync(file, await makePng(1, 400, 500));
  const cutouts: BankedCutout[] = [{ id: 'sam-altman', name: 'Sam Altman', qid: 'Q7407093', file, width: 400, height: 500, credit: 'Someone, CC BY 2.0', provenance: 'https://commons.wikimedia.org/wiki/File:x.jpg', approved: true }];
  const [cut] = await bankSource(PERSON, makeRun({ cutouts }));
  assert.ok(cut.character_image && cut.trusted && cut.localFile === file);
  const [logo] = await logoSource(want({ kind: 'logo', terms: 'OpenAI' }), makeRun());
  assert.ok(!logo.character_image && logo.flags.includes('logo') && fs.existsSync(logo.localFile!), 'a logo has its own flag, not a character image');
  const none = makeRun();
  assert.deepEqual(await logoSource(want({ kind: 'logo', terms: 'Nobody Labs' }), none), []);
  assert.match(none.notes[0], /no logo/);
});

test('video frames: skipped with a note without yt-dlp/ffmpeg; frames credited to the channel', async () => {
  const run = makeRun();
  assert.deepEqual(await videoSource(want({ url: 'https://youtu.be/abcdefghijk' }), run), []);
  assert.match(run.notes[0], /yt-dlp or ffmpeg/);
  const got = await videoSource(want({ url: 'https://youtu.be/abcdefghijk' }), makeRun({ videoFrames: async () => ({ frames: [{ file: '/f1.jpg', at: 72 }], channel: 'OpenAI', title: 'DevDay', date: '2026-10-01' }) }));
  assert.equal(got[0].credit, 'OpenAI (video frame at 1:12)');
  assert.equal(got[0].trusted, false, 'a frame may carry a channel logo, so it is looked at');
});

test('screens, documents and papers: made, trusted, with measured boxes; missing phrases flagged; PDFs skipped', async () => {
  const run = makeRun({ screenshot: stubScreenshot });
  const [page] = await screenSourceAdapter(want({ kind: 'social_post', url: 'https://x.com/OpenAI/status/1', phrases: ['The board no longer', 'never on the page'] }), run);
  assert.ok(page.made && page.trusted && fs.existsSync(page.localFile!));
  assert.deepEqual(page.text_boxes, [{ text: 'The board no longer', x: 40, y: 300, w: 400, h: 48 }]);
  assert.deepEqual(page.flags, ['phrase_not_found:never on the page']);
  assert.match(page.credit, /Screenshot of x\.com, captured 2026-10-28/);
  const [paper] = await paperSource(want({ kind: 'paper', url: 'https://arxiv.org/abs/2610.01234', phrases: ['A paper'] }), run);
  assert.match(paper.shows ?? '', /arXiv page/);
  assert.deepEqual(await documentSource(want({ kind: 'document', url: 'https://sec.gov/x.pdf' }), run), []);
  const noBrowser = makeRun();
  assert.deepEqual(await screenSourceAdapter(want({ url: 'https://x.com/a' }), noBrowser), []);
  assert.match(noBrowser.notes[0], /no Playwright/);
  assert.deepEqual(boxesToImagePixels('w', [{ x: -10, y: 100, w: 60, h: 20 }, { x: 600, y: 0, w: 10, h: 10 }]), [{ text: 'w', x: 0, y: 200, w: 100, h: 40 }]);
});

test('places: Nominatim with a User-Agent, one request a second; the kit renderer makes the map', async () => {
  const seen: Seen[] = [];
  const waits: number[] = [];
  const run = makeRun({ http: fixtureHttp(seen), sleep: async (ms) => void waits.push(ms) });
  nominatimGate.last = 0;
  assert.deepEqual(await geocode(run, 'a'), { lat: 37.768, lon: -122.388, display: '1455 3rd Street, San Francisco, CA' });
  await geocode(run, 'b');
  assert.ok(waits.length === 1 && waits[0] >= 1000, `waited ${waits}`);
  assert.match((seen[0].init?.headers as Record<string, string>)['User-Agent'], /HeliosHub-ReelAiDrama/);
  const maps: unknown[] = [];
  const place = { name: 'OpenAI headquarters', address: '1455 3rd Street', lat: null, lon: null, role: 'r' };
  const [map] = await mapSource(
    want({ kind: 'map', place }),
    makeRun({ sleep: async () => undefined, renderMap: async (o) => { maps.push(o); fs.writeFileSync(o.out, await makePng(5, 1080, 1920)); } }),
  );
  assert.ok(map.made && map.trusted && map.kind === 'map');
  assert.deepEqual(maps[0], { lat: 37.768, lon: -122.388, zoom: 15, label: 'OpenAI headquarters', sublabel: '1455 3rd Street', out: map.localFile });
  const noMap = makeRun();
  assert.deepEqual(await mapSource(want({ place }), noMap), []);
  assert.match(noMap.notes[0], /no map renderer/);
});

// ── Filters ─────────────────────────────────────────────────────────────────

const cand = (over: Partial<RawCandidate>): RawCandidate => ({
  source: 'serper', want: 'w', kind: 'event_photo', url: 'https://cdn.example.com/a.jpg', source_page: null, credit: '', license: null, caption: '', people: [], qids: [],
  place: null, date_taken: null, date_basis: 'unknown', character_image: false, made: false, trusted: false, flags: [], ...over,
});
const look = (over: Partial<Look> = {}): Look => ({ shows: 's', watermark: false, tv_logo: false, ai_generated: false, faces: 1, text_heavy: false, about_story: true, key_moment: false, ...over });

test('watermark layers 1–2: stock domains (any subdomain), preview URL patterns and AI captions are rejected before download', () => {
  assert.equal(blockedDomain('https://media.gettyimages.com/id/1/x.jpg?s=612x612'), 'gettyimages.com');
  assert.equal(blockedDomain('https://www.istockphoto.com/photo/x'), 'istockphoto.com');
  assert.equal(blockedDomain('https://t3.ftcdn.net/jpg/x.jpg'), 'ftcdn.net');
  assert.equal(blockedDomain('https://example.com/x.jpg'), null);
  assert.match(preScreen(cand({ url: 'https://ok.example/x.jpg', source_page: 'https://www.alamy.com/x' }))!, /stock_domain:alamy\.com/);
  assert.equal(preScreen(cand({ url: 'https://ok.example/img.jpg?wm=1' })), 'watermark_risk:url_pattern');
  assert.equal(preScreen(cand({ caption: 'An AI-generated city' })), 'ai_generated:caption');
  assert.equal(preScreen(cand({ caption: 'Made with Midjourney' })), 'ai_generated:caption');
  assert.equal(preScreen(cand({ made: true, url: 'https://gettyimages.com/x.jpg' })), null, 'our own captures are never screened out by domain');
});

test('metadata: IPTC/XMP AI source types reject; agency credits are a flag, not a reject; EXIF gives the taken date', async () => {
  const base = await makeJpeg(3, 800, 600);
  const ai = await sharp(base).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></rdf:RDF></x:xmpmeta>').jpeg().toBuffer();
  assert.match(metadataVerdict(await readImageMeta(ai)).reject!, /^ai_generated:metadata/);
  const wire = await sharp(base)
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="Getty Images"/></rdf:RDF></x:xmpmeta>')
    .withExif({ IFD0: { DateTime: '2026:10:02 09:00:00' } })
    .jpeg()
    .toBuffer();
  const meta = await readImageMeta(wire);
  assert.equal(meta.credit, 'Getty Images');
  assert.equal(meta.taken, '2026-10-02');
  assert.deepEqual(metadataVerdict(meta), { reject: null, flags: ['agency_credit:getty'] });
  const iptc = Buffer.concat([Buffer.from([0x1c, 2, 110, 0, 7]), Buffer.from('Reuters'), Buffer.from([0x1c, 2, 80, 0, 4]), Buffer.from('Jane')]);
  assert.deepEqual(parseIptc(iptc), { 110: 'Reuters', 80: 'Jane' });
});

test('the look: a TV channel logo or a watermark rejects a found image; our own captures keep their branding', () => {
  assert.equal(lookVerdict({ made: false }, look({ tv_logo: true })), 'tv_channel_logo');
  assert.equal(lookVerdict({ made: false }, look({ watermark: true })), 'watermark');
  assert.equal(lookVerdict({ made: false }, look({ ai_generated: true })), 'ai_generated:look');
  assert.equal(lookVerdict({ made: true }, look({ watermark: true, tv_logo: true })), null);
});

test('identity: QID-tied sources are verified; a caption naming them is probable; otherwise a person shot is rejected', () => {
  const p = { people: ['Sam Altman'], kind: 'person_photo' as const, flags: [] as string[] };
  assert.deepEqual(identityVerdict({ ...p, qids: ['Q7407093'], source: 'wikidata', caption: 'x' }, look()), { reject: null, people: ['Sam Altman'], flags: ['identity:verified'] });
  assert.equal(identityVerdict({ ...p, qids: ['Q7407093'], source: 'wikidata', caption: 'x' }, look({ faces: 0 })).reject, 'identity:no_face');
  assert.deepEqual(identityVerdict({ ...p, qids: [], source: 'serper', caption: 'Altman speaks on stage' }, look({ faces: 3 })).flags, ['identity:probable', 'group_photo:3_faces']);
  assert.match(identityVerdict({ ...p, qids: [], source: 'serper', caption: 'A man speaks' }, look()).reject!, /identity:unverified/);
  assert.deepEqual(identityVerdict({ ...p, kind: 'event_photo', qids: [], source: 'serper', caption: 'A crowd' }, look()), { reject: null, people: [], flags: ['identity:unverified'] });
});

test('recency weighs, never gates: news prefers recent photos, history prefers its era', () => {
  assert.equal(recencyScore('2026-10-01', NOW, true, '2026-10-01'), 1);
  assert.equal(recencyScore('2026-01-01', NOW, true, '2026-10-01'), 0.5);
  assert.equal(recencyScore(null, NOW, true, '2026-10-01'), 0.4);
  assert.equal(recencyScore('2015-12-11', NOW, false, '2015-12-11'), 1);
  assert.equal(recencyScore('2023-01-01', NOW, false, '2015-12-11'), 0.4);
  assert.deepEqual(recencyFlags({ kind: 'person_photo' }, '2023-05-01', NOW, true, '2026-10-01'), ['old_photo:2023']);
  assert.deepEqual(recencyFlags({ kind: 'event_photo' }, '2024-05-01', NOW, false, '2015-12-11'), ['later_than_event:2024']);
});

test('size: a 600px floor for found images; upscale at most 2×, and only when it reaches the floor', () => {
  assert.equal(sizeFloor({ made: false, trusted: false, kind: 'event_photo' }), 600);
  assert.equal(sizeFloor({ made: true, trusted: true, kind: 'web_page' }), 0);
  assert.equal(upscaleFactor(800), 1);
  assert.equal(upscaleFactor(400), 1.5);
  assert.equal(upscaleFactor(200), null);
});

test('perceptual hash: a near-identical copy is a duplicate, a different picture is not; dedupe keeps the better copy', async () => {
  const a = await makeJpeg(11);
  const near = await nearCopy(a);
  const other = await makeJpeg(12);
  const [ha, hn, ho] = await Promise.all([phash(a), phash(near), phash(other)]);
  assert.ok(hamming(ha, hn) <= 8, `near copy distance ${hamming(ha, hn)}`);
  assert.ok(hamming(ha, ho) > 8, `different picture distance ${hamming(ha, ho)}`);
  const { keep, dropped } = dedupeByHash(
    [{ id: 'small', phash: hn, size: 1 }, { id: 'big', phash: ha, size: 2 }, { id: 'other', phash: ho, size: 1 }],
    (x, y) => x.size - y.size,
  );
  assert.deepEqual(keep.map((k) => k.id).sort(), ['big', 'other']);
  assert.deepEqual(dropped.map((d) => [d.item.id, d.of.id]), [['small', 'big']]);
});

// ── The 20-day rule ─────────────────────────────────────────────────────────

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`);
  const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'production', 8) RETURNING id`, [p.id]);
  return { db, jobId: job.id };
}

test('reuse: a photo used within 20 days (or a near copy of it) is blocked; older uses and character images are not', async () => {
  const { db, jobId } = await freshJob();
  const day = 86_400_000;
  const used = await phash(await makeJpeg(21));
  const near = await phash(await nearCopy(await makeJpeg(21)));
  await recordUses(db, jobId, [{ assetKey: used, purpose: 'hero', characterImage: false }], new Date(NOW.getTime() - 5 * day));
  await recordUses(db, jobId, [{ assetKey: 'https://x/cutout.png', purpose: 'character', characterImage: true }], new Date(NOW.getTime() - day));
  await recordUses(db, jobId, [{ assetKey: 'https://x/old.jpg', purpose: 'b-roll', characterImage: false }], new Date(NOW.getTime() - 30 * day));
  const hits = await recentlyUsed(db, [used, near, 'https://x/cutout.png', 'https://x/old.jpg', 'https://x/new.jpg'], 20, NOW);
  assert.deepEqual([...hits].sort(), [...new Set([near, used])].sort());
  assert.equal((await recentlyUsed(db, [used], 4, NOW)).size, 0);
});

// ── Looks ───────────────────────────────────────────────────────────────────

type StubLookRule = (line: { n: number; source: string; claim: string; caption: string }) => Partial<Look>;

function stubLooks(rule: StubLookRule, calls: Anthropic.MessageCreateParamsNonStreaming[] = []) {
  return async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const content = params.messages[0].content as Anthropic.ContentBlockParam[];
    const text = (content[0] as Anthropic.TextBlockParam).text;
    const tiles = [...text.matchAll(/^(\d+)\. from (\w+); meant to show: (.*); caption: (.*)$/gm)].map((m) => {
      const line = { n: Number(m[1]), source: m[2], claim: m[3], caption: m[4] };
      return { tile: line.n, ...look({ shows: `Stub look: ${line.caption}`.slice(0, 80) }), ...rule(line) };
    });
    return {
      id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: 'submit_looks', input: { tiles } }],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
}

test('looks: 16 tiles a sheet, a cached system prompt, an image suffix, spend recorded and capped', async () => {
  const { db, jobId } = await freshJob();
  const dir = tmp('rad-look-');
  const files = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const f = path.join(dir, `${i}.jpg`);
    fs.writeFileSync(f, await makeJpeg(100 + i, 400, 300));
    return f;
  }));
  const sheet = await sharp(await contactSheet(files.slice(0, 16))).metadata();
  assert.deepEqual([sheet.width, sheet.height], [1024, 1024]);
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const items = files.map((file, i) => ({ file, claim: 'c', caption: i === 3 ? 'CNBC broadcast' : 'fine', source: 'serper' }));
  const ctx = { title: 't', keyMoment: 'k', cast: [], jobId, mode: 'production' as const };
  const res = await lookAt({ db, create: stubLooks(({ caption }) => ({ tv_logo: /broadcast/i.test(caption) }), calls), loadPrompt: () => 'LOOK', model: 'claude-haiku-5-5' }, items, { ...ctx, capUsd: 1 });
  assert.equal(res.sheets, 2);
  assert.equal(res.looks.size, 20);
  assert.equal(res.looks.get(3)!.tv_logo, true);
  assert.equal((calls[0].system as { cache_control?: unknown }[])[0].cache_control !== undefined, true);
  assert.equal(((calls[0].messages[0].content as Anthropic.ContentBlockParam[])[1] as { type: string }).type, 'image');
  assert.ok(Math.abs((await spendFor(db, { jobId })) - res.usd) < 1e-9);
  const capped = await lookAt({ db, create: stubLooks(() => ({})), loadPrompt: () => 'LOOK', model: 'claude-haiku-5-5' }, items, { ...ctx, capUsd: 0.0001 });
  assert.equal(capped.sheets, 1);
  assert.match(capped.errors[0], /looks stopped/);
});

// ── The full stubbed harvest ────────────────────────────────────────────────

async function harvestDeps(db: Queryable, rule: StubLookRule): Promise<HarvestDeps> {
  const dir = tmp('rad-cut-');
  const file = path.join(dir, 'sam.png');
  fs.writeFileSync(file, await makePng(7, 400, 500));
  return {
    db,
    http: fixtureHttp(),
    create: stubLooks(rule),
    loadPrompt: () => 'LOOK',
    serperKey: 'k',
    screenshot: stubScreenshot,
    renderMap: async (o) => fs.writeFileSync(o.out, await makePng(9, 1080, 1920)),
    videoFrames: async (_url, { outDir }) => {
      const frames = [];
      for (const at of [0, 12]) {
        const f = path.join(outDir, `v-${at}.jpg`);
        fs.writeFileSync(f, await makeJpeg(500 + at, 1920, 1080));
        frames.push({ file: f, at });
      }
      return { frames, channel: 'CNBC', title: 'CNBC Broadcast: DevDay', date: '2026-10-01' };
    },
    upscale: null,
    cutouts: [{ id: 'sam-altman', name: 'Sam Altman', qid: 'Q7407093', file, width: 400, height: 500, credit: 'Someone, CC BY 2.0', provenance: 'p', approved: true }],
    now: () => NOW,
    sleep: async () => undefined,
    log: () => undefined,
  };
}

const storyRule: StubLookRule = ({ caption, claim }) => ({
  tv_logo: /broadcast/i.test(caption),
  about_story: !/crowd/i.test(caption),
  faces: /altman|stage|leaves/i.test(caption) ? 1 : 0,
  key_moment: /devday/i.test(`${caption} ${claim}`),
});

test('plan: the cast, the key moment, expected visuals, pages, artifacts, papers, videos and places become wants', () => {
  const wants = planWants(pitch, facts(), { isNews: true, cutouts: [] });
  const ids = wants.map((w) => w.id);
  for (const id of ['person:sam-altman', 'person-event:sam-altman', 'company:openai', 'moment', 'visual:1', 'visual:2', 'article:1', 'headline:1', 'page:2', 'video:3', 'paper:2610.01234', 'artifact:A1', 'place:1', 'place-photo:1']) {
    assert.ok(ids.includes(id), `missing ${id} in ${ids.join(', ')}`);
  }
  assert.ok(wants.find((w) => w.id === 'visual:1')!.key_moment, 'the expected visual that matches the scene is a key-moment want');
  assert.equal(wants.find((w) => w.id === 'artifact:A1')!.kind, 'social_post');
  assert.deepEqual(wants.find((w) => w.id === 'person:sam-altman')!.qids, ['Q7407093']);
});

test('a full stubbed harvest builds the inventory, saves files, writes every candidate and records spend', async () => {
  const { db, jobId } = await freshJob();
  const jobDir = tmp('rad-job-');
  const office = await phash(await makeJpeg(seedOf('https://upload.wikimedia.org/c/OpenAI_office.jpg')));
  await recordUses(db, jobId, [{ assetKey: office, purpose: 'b-roll', characterImage: false }], new Date(NOW.getTime() - 3 * 86_400_000));
  nominatimGate.last = 0;
  const result = await runHarvest(await harvestDeps(db, storyRule), { pitch, facts: facts(), jobDir, jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 10 } });
  const inv = result.inventory;
  assert.equal(inv.kill, null, JSON.stringify({ usable: inv.usable_count, notes: result.notes }));
  assert.ok(inv.usable_count >= 10, `usable ${inv.usable_count}`);
  assert.equal(inv.usable_count, inv.assets.length);
  assert.ok(inv.assets.every((a, i) => a.id === `V${i + 1}` && a.shows && a.credit && fs.existsSync(path.join(jobDir, a.file))));
  assert.equal(inv.assets[0].character_image, true, 'the banked cutout leads');
  assert.ok(inv.assets.some((a) => a.flags.includes('key_moment')));
  for (const kind of ['person_photo', 'logo', 'map', 'social_post', 'headline', 'web_page', 'paper'] as const) assert.ok((inv.counts[kind] ?? 0) >= 1, `no ${kind}`);
  const shot = inv.assets.find((a) => a.kind === 'social_post')!;
  const boxes = shot.flags.find((f) => f.startsWith('boxes:'))!.slice(6);
  assert.equal(JSON.parse(fs.readFileSync(path.join(jobDir, boxes), 'utf8')).boxes[0].text, 'The board no longer has confidence in his ability to lead');

  const reasons = result.rejected.map((r) => r.reason);
  for (const want of [/stock_domain:gettyimages\.com/, /ai_generated:caption/, /tv_channel_logo/, /duplicate_of:/, /off_story|identity:unverified/, /too_small/, /used_within_20_days/]) {
    assert.ok(reasons.some((r) => want.test(r)), `no rejection matching ${want}: ${reasons.join(' | ')}`);
  }
  const { rows } = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM reel_ai_drama.assets WHERE job_id = $1 GROUP BY status ORDER BY status`, [jobId]);
  assert.deepEqual(rows.map((r) => [r.status, Number(r.n)]), [['rejected', result.rejected.length], ['usable', inv.usable_count]]);
  assert.ok(inv.usd > 0 && inv.usd < 1, `harvest spend ${inv.usd}`);
  assert.ok(Math.abs((await spendFor(db, { jobId })) - inv.usd) < 1e-6);
  assert.ok(result.notes.some((n) => /upscale/.test(n)) || reasons.some((r) => /too_small/.test(r)));
  assert.ok(!fs.existsSync(path.join(jobDir, 'media', 'tmp')));
});

test('kill rules: too few usable visuals, or no image of the key moment', async () => {
  const a = await freshJob();
  nominatimGate.last = 0;
  const few = await runHarvest(await harvestDeps(a.db, storyRule), { pitch, facts: facts(), jobDir: tmp('rad-k1-'), jobId: a.jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 100 } });
  assert.deepEqual(few.inventory.kill, { reason: 'too_few_visuals' });

  const b = await freshJob();
  nominatimGate.last = 0;
  const noKey = await runHarvest(await harvestDeps(b.db, (l) => ({ ...storyRule(l), key_moment: false })), {
    pitch,
    facts: facts(),
    jobDir: tmp('rad-k2-'),
    jobId: b.jobId,
    mode: 'production',
    settings: { ...DEFAULT_SETTINGS, min_visuals: 1 },
  });
  assert.equal(noKey.inventory.kill, null, 'a key moment nobody photographed is a warning, not a kill (MD-56)');
  assert.ok(noKey.notes.includes('no image of the key moment'));

  const c = await freshJob();
  const blind = await runHarvest({ ...(await harvestDeps(c.db, storyRule)), create: null, screenshot: null, renderMap: null }, { pitch, facts: null, jobDir: tmp('rad-k3-'), jobId: c.jobId, mode: 'production', settings: DEFAULT_SETTINGS });
  assert.deepEqual(blind.inventory.kill, { reason: 'too_few_visuals' });
  assert.ok(blind.rejected.some((r) => r.reason === 'not_checked:no_look'), 'found images are never kept unchecked');
});
