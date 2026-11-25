/**
 * Real or AI? engine: the daily run and the import, offline (CONTRACT.md §5 A).
 * Claude, Jev, the image model, Commons and storage are all stubs; PGlite runs
 * the real stories schema plus db/stories_real_or_ai.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Questions, RequestOptions, SystemOneRequest, SystemOneResult } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import type { HeldOfferInput } from '@/lib/media-library/held';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { runRoaDaily } from '@/lib/stories/roa/daily';
import { NASA_API } from '@/lib/stories/roa/real';
import { runRoaImport } from '@/lib/stories/roa/intake';
import { lightOf, screenImage, tooDark, type RoaVisionTransport } from '@/lib/stories/roa/screen';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';

import { stubWriter } from './stories-harness';

const NOW = new Date('2026-11-17T09:00:00Z');

async function solid(seed: number, format: 'png' | 'jpeg' = 'jpeg', size = { width: 600, height: 1300 }): Promise<Buffer> {
  const img = sharp({ create: { ...size, channels: 3, background: { r: 100 + ((seed * 53) % 156), g: 100 + ((seed * 97) % 156), b: 100 + ((seed * 31) % 156) } } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

type Answers = Partial<Record<'glance_tell' | 'looks_ai' | 'real_person' | 'brand' | 'readable_text' | 'clear_subject' | 'off_putting' | 'subtle_tell', number>>;

function stubVision(answers: (call: number) => Answers = () => ({})): RoaVisionTransport & { calls: Array<{ keys: string[]; model?: string; headers?: Record<string, string> }> } {
  const calls: Array<{ keys: string[]; model?: string; headers?: Record<string, string> }> = [];
  const base: Required<Answers> = { glance_tell: 0.1, looks_ai: 0.45, real_person: 0.05, brand: 0.05, readable_text: 0.05, clear_subject: 0.9, off_putting: 0.05, subtle_tell: 0.8 };
  return {
    calls,
    async systemOne<const Q extends Questions>(req: SystemOneRequest<Q>, options?: RequestOptions): Promise<SystemOneResult<Q>> {
      const keys = Object.keys(req.questions);
      calls.push({ keys, model: req.model, headers: options?.headers });
      const a = { ...base, ...answers(calls.length) };
      const out = Object.fromEntries(
        keys.map((k) => [
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
}

/** Commons search and image downloads, keyed by URL. */
function stubFetch(): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
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

function stubImages() {
  let n = 0;
  const prompts: string[] = [];
  const gen = async (prompt: string) => {
    prompts.push(prompt);
    n++;
    return { png: await solid(1000 + n * 7, 'png'), usage: { usd: 0.04 } };
  };
  return Object.assign(gen, { prompts });
}

const SPECS = [
  { subject: 'nature_weather', trap: 'too_perfect', search_words: 'mirror lake mountains', ai_prompt: '' },
  { subject: 'vehicles', trap: 'amateur', search_words: '', ai_prompt: 'Hobbyist photo of a red tram crossing a stone bridge on a sunny afternoon' },
  { subject: 'cities_architecture', trap: 'impossible', search_words: 'fog skyline', ai_prompt: '' },
  { subject: 'animals', trap: 'amateur', search_words: '', ai_prompt: 'Hobbyist photo of a goat on a sunny hillside path' },
];

const EFFORT = 'A drone flew it at dawn over the lake';
function writer(lines: (n: number) => { effort: string; line: string } = () => ({ effort: 'large', line: EFFORT })) {
  return stubWriter({ submit_specs: () => ({ specs: SPECS }), submit_reveal: (_p, n) => lines(n) });
}

function storage() {
  const uploads: Array<{ path: string; bytes: number; type?: string }> = [];
  return { uploads, async upload(path: string, body: Buffer, type?: string) { uploads.push({ path, bytes: body.length, type }); } };
}

test('daily: four candidates, 2 real and 2 AI, stored and pooled, recorded once a day', async () => {
  const { db } = await openLocalStoriesDb();
  const write = writer();
  const vision = stubVision();
  const images = stubImages();
  const fetchStub = stubFetch();
  const store = storage();
  const res = await runRoaDaily({ db, write, settings: DEFAULT_SETTINGS, now: NOW, vision, image: images, fetch: fetchStub, storage: store });
  assert.equal(res.ran, true);
  if (!res.ran) return;
  assert.deepEqual(res.rejected, []);
  assert.equal(res.pooled.length, 4);

  const { rows } = await db.query<{ key: string; origin: string; score: number; truth: string; reveal: string; payoff: string; tellbox: unknown; kind: string }>(
    `SELECT key, origin, score::float8 AS score, payload->'c'->>'truth' AS truth, payload->>'reveal' AS reveal, payload->>'payoff' AS payoff, payload->'screen'->'tellBox' AS tellbox, payload->'c'->'provenance'->>'kind' AS kind
       FROM stories.pool WHERE series = 'real_or_ai' ORDER BY key`,
  );
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.truth === 'real').length, 2);
  assert.equal(rows.filter((r) => r.truth === 'ai').length, 2);
  for (const r of rows) {
    assert.match(r.key, /^roa:[0-9a-f]{16}$/);
    assert.equal(r.origin, 'model');
    // RA-26: no tell box is kept; real rounds carry the effort line, AI rounds the prompt (no model call).
    assert.equal(r.tellbox, null);
    if (r.truth === 'real') {
      assert.equal(r.kind, 'commons');
      assert.equal(r.score, 0.45, 'real difficulty = looks AI');
      assert.equal(r.payoff, 'effort');
      assert.equal(r.reveal, EFFORT);
    } else {
      assert.equal(r.kind, 'generated');
      assert.equal(r.score, 0.55, 'AI difficulty = 1 - looks AI');
      assert.equal(r.payoff, 'prompt');
      assert.equal(r.reveal, '');
    }
  }
  // Stored as JPEG at the contract path.
  assert.equal(store.uploads.length, 4);
  for (const u of store.uploads) {
    assert.match(u.path, /^roa\/candidates\/[0-9a-f]{16}\.jpg$/);
    assert.equal(u.type, 'image/jpeg');
  }
  // The writer prompt is cached; the reveal carries the image in the uncached user turn.
  const specCall = write.calls.find((c) => (c.tools as Array<{ name: string }>).some((t) => t.name === 'submit_specs'))!;
  assert.ok(JSON.stringify(specCall.system).includes('cache_control'));
  assert.ok(!(specCall.tools as Array<{ type?: string }>).some((t) => t.type?.startsWith('web_search')), 'no web search');
  const revealCall = write.calls.find((c) => (c.tools as Array<{ name: string }>).some((t) => t.name === 'submit_reveal'))!;
  const content = (revealCall.messages as Array<{ content: Array<{ type: string }> }>)[0]!.content;
  assert.equal(content[0]!.type, 'image');
  assert.equal(content[1]!.type, 'text');
  // Jev: every call carries the images header; boxes ask jev-preview; real photos never reach the close look.
  assert.ok(vision.calls.every((c) => c.headers?.['TypeSafe-Danger-Zone-Images'] === 'true'));
  assert.ok(vision.calls.filter((c) => c.keys.includes('tell_box')).every((c) => c.model === 'jev-preview'));
  assert.equal(vision.calls.filter((c) => c.keys.includes('tell_box')).length, 2);
  assert.equal(images.prompts.length, 2);
  // Real cells gather up to REAL_CANDIDATES photos, so a short Commons result moves on to NASA.
  assert.ok(fetchStub.urls.every((u) => u.startsWith('https://commons.wikimedia.org/') || u.startsWith('https://upload.test/') || u.startsWith(NASA_API)));

  // Recorded; a second pass the same pool day does nothing.
  const rec = await db.query<{ value: { day: string; pooled: unknown[] } }>(`SELECT value FROM stories.settings WHERE key = 'roa_daily'`);
  assert.equal(rec.rows[0]!.value.pooled.length, 4);
  const again = await runRoaDaily({ db, write, settings: DEFAULT_SETTINGS, now: NOW, vision, image: images, fetch: fetchStub, storage: store });
  assert.equal(again.ran, false);
});

test('daily: a visible tell is archived (screen) and made once more, AI rounds keep their prompt, and the record survives a writer failure', async () => {
  const { db } = await openLocalStoriesDb();
  // Calls 1 and 2 are the first real photo's glance and subject box; the first AI image's glance is call 3. It shows a tell at a glance.
  const vision = stubVision((n) => (n === 3 ? { glance_tell: 0.9 } : { subtle_tell: 0.2 }));
  const res = await runRoaDaily({ db, write: writer(() => ({ effort: 'unclear', line: '' })), settings: DEFAULT_SETTINGS, now: NOW, vision, image: stubImages(), fetch: stubFetch(), storage: storage() });
  assert.equal(res.ran, true);
  if (!res.ran) return;
  // The failed AI image is made once more from the same prompt (RA-22), so all four cells still pool.
  assert.equal(res.pooled.length, 4);
  assert.equal(res.archived.length, 1);
  assert.deepEqual(res.archived[0]!.problems, ['visible_tell']);
  assert.ok(res.notes.some((n) => /made again/.test(n)));
  const arch = await db.query<{ reason: string }>(`SELECT reason FROM stories.roa_archive`);
  assert.deepEqual(arch.rows.map((r) => r.reason), ['screen']);
  // No tell box is kept (RA-26): the builder shows our prompt.
  const ai = await db.query<{ tb: unknown }>(`SELECT payload->'screen'->'tellBox' AS tb FROM stories.pool WHERE payload->'c'->>'truth' = 'ai'`);
  assert.equal(ai.rows.length, 2);
  assert.ok(ai.rows.every((r) => r.tb === null));

  const { db: db2 } = await openLocalStoriesDb();
  const broken = stubWriter({ submit_specs: () => { throw new Error('API down'); } });
  await assert.rejects(runRoaDaily({ db: db2, write: broken, settings: DEFAULT_SETTINGS, now: NOW, vision: stubVision(), image: stubImages(), fetch: stubFetch(), storage: storage() }));
  const rec = await db2.query<{ value: { error?: string } }>(`SELECT value FROM stories.settings WHERE key = 'roa_daily'`);
  assert.match(rec.rows[0]!.value.error ?? '', /API down/);
});

test('import (RA-27): dataset and viral AI images go by the effort gap: a line when large, else the origin card; both pool', async () => {
  const { db } = await openLocalStoriesDb();
  const manifest = [
    { file: 'a.png', subject: 'animals', provenance: { kind: 'dataset', dataset: 'Example set', id: 'img-001', model: 'some-model' } },
    { file: 'b.png', subject: 'vehicles', trap: 'amateur', provenance: { kind: 'viral', url: 'https://example.test/post' } },
    { file: 'c.png', subject: 'food' },
  ];
  const files: Record<string, Buffer> = { 'a.png': await solid(11, 'png'), 'b.png': await solid(12, 'png') };
  const store = storage();
  const res = await runRoaImport(
    {
      db, write: writer((n) => (n === 1 ? { effort: 'large', line: EFFORT } : { effort: 'unclear', line: '' })),
      settings: DEFAULT_SETTINGS, vision: stubVision(() => ({ subtle_tell: 0.2 })), storage: store, now: NOW, day: '2026-11-17', used: new Set(),
    },
    manifest,
    async (f) => files[f]!,
  );
  assert.deepEqual(res.refused.map((r) => r.file), ['c.png']);
  assert.deepEqual(res.outcomes.map((o) => o.status), ['pooled', 'pooled']);
  assert.equal(store.uploads.length, 2);
  const pooled = await db.query<{ payoff: string; reveal: string }>(`SELECT payload->>'payoff' AS payoff, payload->>'reveal' AS reveal FROM stories.pool WHERE series = 'real_or_ai' ORDER BY payload->'c'->'provenance'->>'kind'`);
  assert.deepEqual(pooled.rows, [{ payoff: 'effort', reveal: EFFORT }, { payoff: 'origin', reveal: '' }]);
  const arch = await db.query<{ reason: string }>(`SELECT reason FROM stories.roa_archive`);
  assert.deepEqual(arch.rows, []);
});

test('screen: a dark image is rejected in code before any Jev call; a bright one goes on to Jev', async () => {
  const { db } = await openLocalStoriesDb();
  const vision = stubVision();
  const dark = await sharp({ create: { width: 300, height: 600, channels: 3, background: { r: 20, g: 22, b: 30 } } }).jpeg().toBuffer();
  const out = await screenImage({ db, vision }, { jpeg: dark, imageKey: 'dark0000000000aa', truth: 'real' });
  assert.equal(out.pass, false);
  assert.deepEqual(out.reasons, ['too_dark']);
  assert.equal(vision.calls.length, 0);
  assert.ok(tooDark(await lightOf(dark)));
  const bright = await solid(3);
  assert.equal(tooDark(await lightOf(bright)), false);
  const ok = await screenImage({ db, vision }, { jpeg: bright, imageKey: 'brite000000000aa', truth: 'real' });
  assert.equal(ok.pass, true);
  // The glance, then the subject box (RA-28) on jev-preview.
  assert.equal(vision.calls.length, 2);
  assert.equal(vision.calls[1]!.model, 'jev-preview');
  assert.deepEqual(Object.fromEntries(Object.entries(ok.subjectBox ?? {}).map(([k, v]) => [k, Number(v.toFixed(3))])), { x: 0.2, y: 0.6, w: 0.6, h: 0.3 });
});

test('screen: no clear subject or an off-putting image fails the glance', async () => {
  const { db } = await openLocalStoriesDb();
  const jpeg = await solid(5);
  const murky = await screenImage({ db, vision: stubVision(() => ({ clear_subject: 0.2 })) }, { jpeg, imageKey: 'murk000000000aaa', truth: 'real' });
  assert.deepEqual(murky.reasons, ['no_clear_subject']);
  const ugly = await screenImage({ db, vision: stubVision(() => ({ off_putting: 0.8 })) }, { jpeg, imageKey: 'ugly000000000aaa', truth: 'real' });
  assert.deepEqual(ugly.reasons, ['off_putting']);
});

test('screen: a borderline glance tell keeps an AI image that viewers would call real; a clear one rejects it', async () => {
  const { db } = await openLocalStoriesDb();
  const jpeg = await solid(7);
  const borderline = await screenImage({ db, vision: stubVision(() => ({ glance_tell: 0.6, looks_ai: 0.3, subtle_tell: 0.2 })) }, { jpeg, imageKey: 'bord000000000aaa', truth: 'ai' });
  assert.equal(borderline.pass, true);
  const clear = await screenImage({ db, vision: stubVision(() => ({ glance_tell: 0.75 })) }, { jpeg, imageKey: 'clea000000000aaa', truth: 'ai' });
  assert.deepEqual(clear.reasons, ['visible_tell']);
});

test('daily (SS-22..SS-24): shared finder, ledger read once, every pooled candidate offered to the bank; a broken bank drops nothing', async () => {
  const { db } = await openLocalStoriesDb();
  const offers: HeldOfferInput[] = [];
  let ledgerReads = 0;
  let drained = 0;
  const res = await runRoaDaily({
    db, write: writer(), settings: DEFAULT_SETTINGS, now: NOW, vision: stubVision(), image: stubImages(), fetch: stubFetch(), storage: storage(),
    finder: 'shared',
    used: async () => (ledgerReads++, { urls: new Set<string>(), phashes: [], dhashes: [] }),
    photoBank: { offerHeld: (o) => offers.push(o), drain: async () => void drained++ },
  });
  assert.equal(res.ran, true);
  if (!res.ran) return;
  assert.equal(res.pooled.length, 4);
  assert.equal(ledgerReads, 1);
  assert.equal(drained, 1);
  assert.ok(res.notes.some((n) => n.startsWith('real shared: archives')), 'real photos came through the shared finder');
  const items = offers.flatMap((o) => o.items.map((i) => ({ ...i, runKind: o.runKind, runRef: o.runRef })));
  assert.equal(items.length, 4);
  for (const i of items) assert.equal(i.runKind, 'real_or_ai');
  const real = items.filter((i) => i.truth === 'real');
  const ai = items.filter((i) => i.truth === 'ai');
  assert.equal(real.length, 2);
  for (const r of real) assert.deepEqual([r.licence, r.reuseOk, r.url.startsWith('https://upload.test/')], ['open', true, true]);
  for (const a of ai) {
    assert.deepEqual([a.licence, a.reuseOk, a.genModel !== null, a.url.startsWith('storage:stories/roa/candidates/')], ['generated', false, true, true]);
    assert.match(a.genPrompt ?? '', /^Hobbyist photo/);
  }
  // The pooled real photo's own image URL is remembered, so a later day never fetches it again.
  const { rows } = await db.query<{ src: string | null }>(`SELECT payload->'c'->'provenance'->>'src' AS src FROM stories.pool WHERE payload->'c'->>'truth' = 'real'`);
  assert.ok(rows.every((r) => r.src?.startsWith('https://upload.test/')));

  const { db: db2 } = await openLocalStoriesDb();
  const broken = await runRoaDaily({
    db: db2, write: writer(), settings: DEFAULT_SETTINGS, now: NOW, vision: stubVision(), image: stubImages(), fetch: stubFetch(), storage: storage(),
    finder: 'legacy', used: async () => { throw new Error('ledger down'); },
    photoBank: { offerHeld: () => { throw new Error('bank down'); } },
  });
  assert.equal(broken.ran, true);
  if (!broken.ran) return;
  assert.equal(broken.pooled.length, 4, 'a failed offer never drops the candidate');
  assert.ok(broken.notes.some((n) => /bank offer roa:.*bank down/.test(n)));
  assert.ok(broken.notes.some((n) => /used-photo ledger not read \(ledger down\)/.test(n)));
});
