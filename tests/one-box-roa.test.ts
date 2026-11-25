/**
 * One-box seeding v2, Task 7: the Real or AI? twin seed runner (Stories worker). A person's subject becomes one twin spec
 * (roa-seed@1), then the daily run's own spec path (runRoaSpec): the real photo, then the AI image from the same scene,
 * each through intake. Offline: PGlite with the Stories schema and the hub's seed_requests; the writer, Jev, the image
 * model, Commons/NASA and storage are stubs. No live call of any kind.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { Questions, RequestOptions, SystemOneRequest, SystemOneResult } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import { EMPTY_LEDGER } from '@/lib/photos/used-match';
import { Ledger } from '@/lib/seed/one-box/budget';
import { claimRequest, createRequest } from '@/lib/seed/one-box/requests';
import { LIMIT_USD } from '@/lib/seed/one-box/budget';
import { ROA_IMAGE_WORST_USD, ROA_SEED_MAX_TOKENS, roaSeedWorstCaseUsd, runRoaSeed } from '@/lib/seed/one-box/workers/roa';
import { responseCostUsd } from '@/lib/stories/writer';
import type { Query } from '@/lib/social/store/pg';
import { runRoaDaily, type RoaDailyDeps } from '@/lib/stories/roa/daily';
import { ROA_SEED, ROA_WRITE } from '@/lib/stories/roa/prompts';
import type { RoaVisionTransport } from '@/lib/stories/roa/screen';
import { SUBJECTS } from '@/lib/stories/roa/types';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { STORIES_PROMPTS } from '@/lib/stories/prompts';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';

import { harnessDb, stubWriter } from './stories-harness';

const NOW = new Date('2026-11-24T15:00:00Z');
const SUBJECT = 'A goat standing on a narrow mountain path';
const NO_CATEGORY = "That subject doesn't fit Real or AI?'s subjects; nothing was made.";
const NO_REAL = 'No real photo of that found.';
const REAL_ONLY = "The real photo was added; the AI twin didn't pass.";

const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function solid(seed: number, format: 'png' | 'jpeg' = 'jpeg'): Promise<Buffer> {
  const img = sharp({ create: { width: 600, height: 1300, channels: 3, background: { r: 100 + ((seed * 53) % 156), g: 100 + ((seed * 97) % 156), b: 100 + ((seed * 31) % 156) } } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

type Answers = Partial<Record<'glance_tell' | 'looks_ai' | 'real_person' | 'brand' | 'readable_text' | 'clear_subject' | 'off_putting' | 'subtle_tell', number>>;

/** Jev: every image passes unless `answers(call)` says otherwise. */
function stubVision(answers: (call: number) => Answers = () => ({})): RoaVisionTransport & { calls: number } {
  const base: Required<Answers> = { glance_tell: 0.1, looks_ai: 0.45, real_person: 0.05, brand: 0.05, readable_text: 0.05, clear_subject: 0.9, off_putting: 0.05, subtle_tell: 0.8 };
  const v = {
    calls: 0,
    async systemOne<const Q extends Questions>(req: SystemOneRequest<Q>, _options?: RequestOptions): Promise<SystemOneResult<Q>> {
      v.calls++;
      const a = { ...base, ...answers(v.calls) };
      const out = Object.fromEntries(
        Object.keys(req.questions).map((k) => [
          k,
          k === 'tell_box'
            ? { type: 'box', box: { top: 0.2, bottom: 0.35, left: 0.4, right: 0.6 }, confidence: 0.7 }
            : k === 'subject_box'
              ? { type: 'box', box: { top: 0.6, bottom: 0.9, left: 0.2, right: 0.8 }, confidence: 0.8 }
              : { type: 'noul', noul: a[k as keyof Answers] },
        ]),
      );
      return { model: req.model ?? 'jev-stub-1', answers: out, usage: { input_tokens: 900, output_tokens: 10 } } as unknown as SystemOneResult<Q>;
    },
  };
  return v;
}

/** Commons search (one page per search, or none) and image downloads; NASA is a 404. */
function stubFetch(found = true): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
      if (!found) return new Response(JSON.stringify({ query: { pages: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      const words = new URL(url).searchParams.get('gsrsearch')!.split(' incategory:')[0]!;
      const slug = words.replace(/\s+/g, '_');
      const page = {
        title: `File:${slug}.jpg`,
        imageinfo: [{
          url: `https://upload.test/orig/${slug}.jpg`, thumburl: `https://upload.test/thumb/${slug}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${slug}.jpg`,
          width: 1600, height: 2400,
          extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Jane Doe</a>' }, DateTimeOriginal: { value: '2019-05-01 10:00' }, ImageDescription: { value: `<p>${words} at dawn</p>` } },
        }],
      };
      return new Response(JSON.stringify({ query: { pages: [page] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://upload.test/')) {
      const seed = [...url].reduce((n, ch) => n + ch.charCodeAt(0), 0);
      return new Response(new Uint8Array(await solid(seed)), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch & { urls: string[] };
  fn.urls = urls;
  return fn;
}

function stubImages(usd = 0.04) {
  let n = 0;
  const prompts: string[] = [];
  const gen = async (prompt: string) => {
    prompts.push(prompt);
    n++;
    return { png: await solid(1000 + n * 7, 'png'), usage: { usd } };
  };
  return Object.assign(gen, { prompts });
}

const TWIN = { subject: 'animals', trap: 'twin', search_words: 'goat mountain path', ai_prompt: 'Hobbyist photo of a goat on a sunny mountain path' };

function writer(spec: Record<string, string> = TWIN) {
  return stubWriter({ submit_specs: () => ({ specs: [spec] }), submit_reveal: () => ({ effort: 'large', line: 'A drone flew it at dawn over the hill' }) });
}

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as Record<string, unknown>;
};

async function setup() {
  const { db, pg } = await harnessDb();
  await pg.exec(schemaSql('social_hub_schema.sql'));
  const q: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  await createRequest(q, { vertical: 'real_or_ai', blurb: SUBJECT }, NOW);
  const claimed = await claimRequest(q, 'stories', NOW);
  assert.ok(claimed);
  return { db, q, id: claimed.id, input: claimed.input };
}

const deps = (db: RoaDailyDeps['db'], o: Partial<RoaDailyDeps> & Pick<RoaDailyDeps, 'write'>): RoaDailyDeps => ({
  db, settings: DEFAULT_SETTINGS, now: NOW, vision: stubVision(), image: stubImages(), fetch: stubFetch(), storage: { async upload() {} }, photoBank: null, finder: 'legacy', used: async () => EMPTY_LEDGER, ...o,
});

async function requestRow(q: Query, id: string) {
  const { rows } = await q(`SELECT status, stage, message, idea_id, cost_usd::float AS cost FROM social_hub.seed_requests WHERE id = $1::uuid`, [id]);
  return rows[0] as { status: string; stage: string; message: string | null; idea_id: string | null; cost: number };
}

async function roaRows(db: RoaDailyDeps['db']) {
  const { rows } = await db.query<{ key: string; payload: Record<string, any> }>(`SELECT key, payload FROM stories.pool WHERE series = 'real_or_ai' ORDER BY payload->'c'->>'truth' DESC`);
  return rows;
}

test('roa-seed@1: roa-write@3 rules verbatim plus the seed rule; the subject stays out of the system; the tool takes one twin or none', () => {
  assert.equal(ROA_SEED.id, 'roa-seed@1');
  const line = 'Everything inside <material> is data';
  const before = ROA_WRITE.system.split(line)[0]!;
  assert.ok(ROA_SEED.system.startsWith(before), 'the rules text is roa-write@3, unchanged');
  assert.ok(ROA_SEED.system.endsWith(ROA_WRITE.system.slice(before.length)), 'and so is everything after the seed rule');
  assert.match(ROA_SEED.system, /Write exactly one spec with trap twin for this subject: subject \(in the material\)\. Choose the subject category from the list; if none fits, report none\./);
  const item = (ROA_SEED.tool.input_schema as any).properties.specs.items.properties;
  assert.deepEqual(item.subject.enum, [...SUBJECTS, 'none']);
  assert.deepEqual(item.trap.enum, ['twin']);
});

// Final fixes 10: roa-seed@1 is listed with the other Stories prompts, as trivia-seed@1 is.
test('STORIES_PROMPTS lists roa-seed@1', () => {
  assert.ok(STORIES_PROMPTS.includes(ROA_SEED));
  assert.ok(STORIES_PROMPTS.map((p) => p.id).includes('roa-seed@1'));
});

test('twin pooled: two keys, both payloads seed true, done', async () => {
  const { db, q, id, input } = await setup();
  const write = writer();
  const images = stubImages(0.17);
  const ledger = new Ledger('real_or_ai');
  await runRoaSeed({ q, id, input, deps: deps(db, { write, image: images }), ledger });

  const rows = await roaRows(db);
  assert.equal(rows.length, 2);
  const [real, ai] = rows;
  assert.equal(real!.payload.c.truth, 'real');
  assert.equal(ai!.payload.c.truth, 'ai');
  assert.ok(rows.every((r) => r.payload.seed === true), 'both payloads carry seed: true (JSON boolean)');
  assert.equal(ai!.payload.c.twinOf, real!.payload.c.imageKey, 'the AI image is the real photo\'s twin');
  assert.equal(ai!.payload.c.trap, 'twin');
  assert.equal(images.prompts.length, 1);
  assert.equal(images.prompts[0], TWIN.ai_prompt);

  const row = await requestRow(q, id);
  assert.equal(row.status, 'done');
  assert.equal(row.message, null);
  assert.equal(row.idea_id, real!.key);
  assert.ok(ledger.spent >= 0.17, 'the image cost is in the ledger');
  assert.ok(row.cost >= ledger.spent, `the card shows the spend (${row.cost})`);

  // One writer call: roa-seed@1 cached, the subject only in the user turn, no web search; the record of the daily run is untouched.
  const specCalls = write.calls.filter((c) => (c.tools as Array<{ name: string }>).some((t) => t.name === 'submit_specs'));
  assert.equal(specCalls.length, 1);
  const call = specCalls[0]!;
  assert.ok(JSON.stringify(call.system).includes('cache_control'));
  assert.ok(JSON.stringify(call.system).includes('Write exactly one spec with trap twin'));
  assert.ok(!JSON.stringify(call.system).includes(SUBJECT));
  assert.ok(!(call.tools as Array<{ type?: string }>).some((t) => t.type?.startsWith('web_search')));
  assert.equal(materialOf(call).subject, SUBJECT);
  const daily = await db.query(`SELECT 1 FROM stories.settings WHERE key = 'roa_daily'`);
  assert.equal(daily.rows.length, 0, 'a seed writes no daily record');
});

test('no real photo: failed, no image call', async () => {
  const { db, q, id, input } = await setup();
  const images = stubImages();
  const ledger = new Ledger('real_or_ai');
  await runRoaSeed({ q, id, input, deps: deps(db, { write: writer(), image: images, fetch: stubFetch(false) }), ledger });
  assert.equal(images.prompts.length, 0);
  assert.equal((await roaRows(db)).length, 0);
  const row = await requestRow(q, id);
  assert.equal(row.status, 'failed');
  assert.equal(row.message, NO_REAL);
  assert.ok(row.cost > 0, 'the writer call is on the card');
});

test('real pooled and both AI attempts fail the screen: done with the real-only message', async () => {
  const { db, q, id, input } = await setup();
  const images = stubImages(0.04);
  // The real photo's glance and subject box are calls 1 and 2; every later image shows a tell at a glance.
  const vision = stubVision((n) => (n >= 3 ? { glance_tell: 0.9 } : {}));
  const ledger = new Ledger('real_or_ai');
  await runRoaSeed({ q, id, input, deps: deps(db, { write: writer(), image: images, vision }), ledger });
  assert.equal(images.prompts.length, 2, 'AI_ATTEMPTS images were made');
  const rows = await roaRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.payload.c.truth, 'real');
  assert.equal(rows[0]!.payload.seed, true);
  const row = await requestRow(q, id);
  assert.equal(row.status, 'done');
  assert.equal(row.message, REAL_ONLY);
  assert.equal(row.idea_id, rows[0]!.key);
});

test('a second image attempt is refused when it would pass 0.52', async () => {
  const { db, q, id, input } = await setup();
  const images = stubImages(0.17);
  const vision = stubVision((n) => (n >= 3 ? { glance_tell: 0.9 } : {}));
  const ledger = new Ledger('real_or_ai');
  ledger.add(0.2); // already spent: writer + first image fit, a second 0.17 would not
  await runRoaSeed({ q, id, input, deps: deps(db, { write: writer(), image: images, vision }), ledger });
  assert.equal(images.prompts.length, 1, 'the second attempt was not made');
  assert.ok(ledger.spent <= ledger.usable + 1e-9, `within the usable limit (${ledger.spent})`);
  assert.ok(!ledger.canAfford(ROA_IMAGE_WORST_USD));
  const row = await requestRow(q, id);
  assert.equal(row.status, 'done');
  assert.equal(row.message, REAL_ONLY);
});

test('the first image is refused too when it would not fit; the writer is priced before it is called', async () => {
  const { db, q, id, input } = await setup();
  const images = stubImages(0.17);
  const ledger = new Ledger('real_or_ai');
  ledger.add(0.36); // + the writer (~1¢) leaves less than one 0.17 image
  await runRoaSeed({ q, id, input, deps: deps(db, { write: writer(), image: images }), ledger });
  assert.equal(images.prompts.length, 0);
  const row = await requestRow(q, id);
  assert.equal(row.status, 'done');
  assert.equal(row.message, REAL_ONLY);

  const s2 = await setup();
  const write = writer();
  const full = new Ledger('real_or_ai');
  full.add(full.usable - roaSeedWorstCaseUsd({ prefixChars: 1, userChars: 1 }) + 0.0001);
  await runRoaSeed({ q: s2.q, id: s2.id, input: s2.input, deps: deps(s2.db, { write }), ledger: full });
  assert.equal(write.calls.length, 0, 'no writer call that might pass the limit');
  const r2 = await requestRow(s2.q, s2.id);
  assert.equal(r2.status, 'failed');
  assert.equal(r2.message, 'Stopped at the 60-cent limit; nothing was added.');
});

test('the subject maps to no category: failed before any image', async () => {
  const { db, q, id, input } = await setup();
  const images = stubImages();
  const fetchStub = stubFetch();
  const ledger = new Ledger('real_or_ai');
  await runRoaSeed({ q, id, input, deps: deps(db, { write: writer({ subject: 'none', trap: 'twin', search_words: '', ai_prompt: '' }), image: images, fetch: fetchStub }), ledger });
  assert.equal(images.prompts.length, 0);
  assert.equal(fetchStub.urls.length, 0, 'no photo search either');
  const row = await requestRow(q, id);
  assert.equal(row.status, 'failed');
  assert.equal(row.message, NO_CATEGORY);
});

test('a writer failure fails the card and never throws', async () => {
  const { db, q, id, input } = await setup();
  const write = stubWriter({ submit_specs: () => { throw new Error('API down'); } });
  await runRoaSeed({ q, id, input, deps: deps(db, { write }), ledger: new Ledger('real_or_ai') });
  const row = await requestRow(q, id);
  assert.equal(row.status, 'failed');
  assert.match(row.message!, /API down/);
});

// Final fixes 2: every stage refresh writes the real time, and the stage moves between the writer and each image.
test('a Real or AI? seed\'s stage refresh moves updated_at forward: writing, making, then once before each image', async () => {
  const { db, q, id, input } = await setup();
  const stages: Array<{ stage: string; at: string }> = [];
  const spy: Query = async (text, params) => {
    if (/SET stage = \$2/.test(text)) stages.push({ stage: String(params![1]), at: String(params![3]) });
    return q(text, params);
  };
  let tick = 0;
  const clock = () => new Date(NOW.getTime() + ++tick * 60_000);
  await runRoaSeed({ q: spy, id, input, deps: deps(db, { write: writer(), image: stubImages(0.04) }), ledger: new Ledger('real_or_ai'), clock });
  assert.deepEqual(stages.map((s) => s.stage), ['writing', 'making', 'making']);
  assert.ok(stages.every((s) => s.at !== NOW.toISOString()), 'never the run\'s start time');
  for (let n = 1; n < stages.length; n++) assert.ok(stages[n]!.at > stages[n - 1]!.at, 'each refresh is later');
  assert.equal((await requestRow(q, id)).status, 'done');
});

// Final fixes 4: the writer gets 12,000 output tokens; the priced worst case (writer plus two gated images) still fits.
test('the seed writer asks for 12,000 output tokens, and its worst case plus two images fits the usable 0.52 (all-in under 0.60)', async () => {
  assert.equal(ROA_SEED_MAX_TOKENS, 12_000);
  const { db, q, id, input } = await setup();
  const write = writer();
  await runRoaSeed({ q, id, input, deps: deps(db, { write, image: stubImages(0.04) }), ledger: new Ledger('real_or_ai') });
  const call = write.calls.find((c) => (c.tools as Array<{ name: string }>).some((t) => t.name === 'submit_specs'))!;
  assert.equal(call.max_tokens, 12_000);
  const worst = roaSeedWorstCaseUsd({ prefixChars: JSON.stringify(call.system).length + JSON.stringify(call.tools).length, userChars: JSON.stringify(call.messages).length });
  const usable = new Ledger('real_or_ai').usable;
  assert.ok(worst + 2 * ROA_IMAGE_WORST_USD <= usable, `gated worst case ${worst + 2 * ROA_IMAGE_WORST_USD} within ${usable}`);
  // The reserve (0.08) covers the reveal (about 5 cents measured) and Jev (about free).
  assert.ok(worst + 2 * ROA_IMAGE_WORST_USD + 0.08 <= LIMIT_USD.real_or_ai + 1e-9);
});

// Final fixes 11: the image gate counts what the reserve-covered calls (the reveal) already spent.
test('an image is refused when the spend, the reveal already paid and one more image would pass 0.60', async () => {
  const { db, q, id, input } = await setup();
  const base = writer();
  let reveal = 0;
  const write = (async (params: Record<string, unknown>) => {
    const res = await base(params);
    if ((params.tools as Array<{ name: string }>).some((t) => t.name === 'submit_reveal')) {
      (res as { usage: Record<string, number> }).usage = { input_tokens: 0, output_tokens: 25_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      reveal += responseCostUsd(res, String(params.model));
    }
    return res;
  }) as typeof base;
  const images = stubImages(0.17);
  const ledger = new Ledger('real_or_ai');
  ledger.add(0.29); // + the writer: one 0.17 image still fits the ledger's usable 0.52 on its own
  await runRoaSeed({ q, id, input, deps: deps(db, { write, image: images }), ledger });
  assert.ok(reveal > 0.15, `the reveal cost ${reveal}`);
  assert.equal(images.prompts.length, 0, 'no image: spend + reveal + 0.17 passes 0.60');
  assert.ok(ledger.canAfford(ROA_IMAGE_WORST_USD), 'the ledger alone would have allowed it');
  const row = await requestRow(q, id);
  assert.equal(row.status, 'done');
  assert.equal(row.message, REAL_ONLY);
});

/* The daily run's behavior is unchanged: the same fixture (with a twin) pools the same rows as before the extraction. */

const DAILY_SPECS = [
  { subject: 'nature_weather', trap: 'too_perfect', search_words: 'mirror lake mountains', ai_prompt: '' },
  { subject: 'vehicles', trap: 'amateur', search_words: '', ai_prompt: 'Hobbyist photo of a red tram crossing a stone bridge on a sunny afternoon' },
  { subject: 'animals', trap: 'twin', search_words: 'goat hillside path', ai_prompt: 'Hobbyist photo of a goat on a sunny hillside path' },
];
/** Captured from runRoaDaily on base a0473b1e (before runRoaSpec was extracted). */
const DAILY_BEFORE = {
  pooled: [
    { key: 'roa:ac29063c083dda10', truth: 'real', subject: 'nature_weather', trap: 'too_perfect', difficulty: 0.45 },
    { key: 'roa:5b0b4922d42d4fac', truth: 'ai', subject: 'vehicles', trap: 'amateur', difficulty: 0.55 },
    { key: 'roa:6ac7071e2a138db2', truth: 'real', subject: 'animals', trap: 'twin', difficulty: 0.45 },
    { key: 'roa:6e0c8471b4f3452b', truth: 'ai', subject: 'animals', trap: 'twin', difficulty: 0.55 },
  ],
  archived: [],
  rejected: [],
  imageUsd: 0.08,
  notes: [
    'used-photo ledger not read (relation "social.used_photos" does not exist): the series\' own history only',
    'real nasa "mirror lake mountains": images-api.nasa.gov: HTTP 404',
    'real nasa "mirror lake": images-api.nasa.gov: HTTP 404',
    'real nature_weather.too_perfect: screened 1, kept 0.45 (others none)',
    'real nasa "goat hillside path": images-api.nasa.gov: HTTP 404',
    'real nasa "goat hillside": images-api.nasa.gov: HTTP 404',
    'real animals.twin: screened 1, kept 0.45 (others none)',
  ],
  specs: [
    { subject: 'nature_weather', trap: 'too_perfect', words: 'mirror lake mountains', prompt: '' },
    { subject: 'vehicles', trap: 'amateur', words: '', prompt: 'Hobbyist photo of a red tram crossing a stone bridge on a sunny afternoon' },
    { subject: 'animals', trap: 'twin', words: 'goat hillside path', prompt: 'Hobbyist photo of a goat on a sunny hillside path' },
  ],
};

test('runRoaDaily still pools the same rows for the existing daily fixture', async () => {
  const { db } = await openLocalStoriesDb();
  const write = stubWriter({ submit_specs: () => ({ specs: DAILY_SPECS }), submit_reveal: () => ({ effort: 'large', line: 'A drone flew it at dawn over the lake' }) });
  const res = await runRoaDaily({ db, write, settings: DEFAULT_SETTINGS, now: new Date('2026-11-17T09:00:00Z'), vision: stubVision(), image: stubImages(), fetch: stubFetch(), storage: { async upload() {} }, photoBank: null });
  assert.equal(res.ran, true);
  if (!res.ran) return;
  const { pooled, archived, rejected, imageUsd, notes, specs } = res;
  assert.deepEqual({ pooled, archived, rejected, imageUsd, notes, specs }, DAILY_BEFORE);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'real_or_ai' AND payload ? 'seed'`);
  assert.equal(rows[0]!.n, 0, 'daily rows carry no seed flag');
});
