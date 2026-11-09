/**
 * Reel AI Drama and the hub's photo bank (2026-11-03): the bank is asked first, a hit whose identity
 * matched and whose look the bank holds skips the paid look, a stale URL is replaced by the bank's copy,
 * every kept photo is offered back, and an unreachable bank changes nothing. The bank is a stub: no
 * network, no Supabase, no model.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { DramaHit, DramaLookup, DramaOfferInput } from '@/lib/media-library/drama';
import { runHarvest } from '@/lib/reel-ai-drama/harvest/harvest';
import { guardedPhotoBank, offerItems, type BankBackend } from '@/lib/reel-ai-drama/harvest/photo-bank';
import { gather } from '@/lib/reel-ai-drama/harvest/pipeline';
import type { HarvestDeps, HarvestPhotoBank, SourceRun, Want } from '@/lib/reel-ai-drama/harvest/types';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { FactSheet, Pitch } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';
import { makeJpeg, seedOf } from './fixtures/reel-ai-drama/harvest/images';

const FIX = path.join(__dirname, 'fixtures', 'reel-ai-drama', 'harvest');
const pitch = JSON.parse(fs.readFileSync(path.join(FIX, 'pitch.json'), 'utf8')) as Pitch;
const facts = () => JSON.parse(fs.readFileSync(path.join(FIX, 'factsheet.json'), 'utf8')) as FactSheet;
const NOW = new Date('2026-10-28T12:00:00Z');
const SAM = 'Q7407093';
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const LOOK = { shows: 'Sam Altman speaking on a stage', watermark: false, tv_logo: false, ai_generated: false, faces: 1, text_heavy: false, about_story: true, key_moment: false, portrait: true };

const hit = (over: Partial<DramaHit>): DramaHit => ({
  photoId: 'p1', url: 'https://bank.test/sam-stage.jpg', fresh: true, masterPath: 'originals/aa/aa.jpg', source: 'commons', lane: 'headshot',
  credit: 'TechCrunch, CC BY 2.0 · Wikimedia Commons', licence: 'open', reuseOk: true, title: 'Sam Altman on the DevDay stage', date: '2026-10-01',
  width: 1600, height: 1000, qids: [SAM], subjects: ['Sam Altman'], tags: ['sam', 'altman'], overlap: 0, faces: null,
  verdict: { look: LOOK, source_page: 'https://commons.wikimedia.org/wiki/File:Sam.jpg', date_basis: 'commons', people: ['Sam Altman'] },
  ...over,
});

/** A bank holding two photos of Sam Altman: one with a stored look (fresh URL), one stale with no look. */
function stubBank(lookups: DramaLookup[] = [], offers: DramaOfferInput[] = []): HarvestPhotoBank {
  return {
    async lookup(q) {
      lookups.push(q);
      if (!q.qids.includes(SAM)) return [];
      return [
        hit({}),
        hit({ photoId: 'p2', url: 'https://gone.test/sam-old.jpg', fresh: false, masterPath: 'originals/bb/bb.jpg', title: 'Sam Altman portrait, 2019', source: 'article', licence: 'unknown', reuseOk: false, credit: 'Example News', verdict: null }),
      ];
    },
    fetchStored: async (masterPath) => makeJpeg(seedOf(masterPath)),
    offer: (input) => void offers.push(input),
  };
}

/** Only bank.test serves images; everything else is gone, so the bank is the only source that finds anything. */
const http = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://bank.test/')) return new Response(new Uint8Array(await makeJpeg(seedOf(url))), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

/** Answers every tile with a clean look; records each tile's caption. */
function stubLooks(captions: string[]): HarvestDeps['create'] {
  return (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    const text = ((params.messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.TextBlockParam).text;
    const tiles = [...text.matchAll(/^(\d+)\. from (\w+); meant to show: (.*); caption: (.*)$/gm)].map((m) => {
      captions.push(m[4]);
      return { tile: Number(m[1]), ...LOOK, shows: `Stub look: ${m[4]}`.slice(0, 80) };
    });
    return {
      id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: 'submit_looks', input: { tiles } }],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  }) as HarvestDeps['create'];
}

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`);
  const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'production', 8) RETURNING id`, [p.id]);
  return { db, jobId: job.id };
}

async function harvest(photoBank: HarvestPhotoBank | null, captions: string[] = []) {
  const { db, jobId } = await freshJob();
  const deps: HarvestDeps = { db, http, create: stubLooks(captions), loadPrompt: () => 'LOOK', cutouts: [], photoBank, now: () => NOW, sleep: async () => undefined, log: () => undefined };
  const result = await runHarvest(deps, { pitch, facts: facts(), jobDir: tmp('rad-bank-'), jobId, mode: 'production', settings: { ...DEFAULT_SETTINGS, min_visuals: 1 } });
  return { result, jobId };
}

test('gather asks the photo bank first for a photo want, and never for a page or a logo', async () => {
  const lookups: DramaLookup[] = [];
  const dir = tmp('rad-gather-');
  let n = 0;
  const run: SourceRun = {
    deps: { db: {} as never, http, create: null, loadPrompt: () => 'p', cutouts: [], photoBank: stubBank(lookups) },
    notes: [], now: NOW, tmpDir: dir, isNews: true, eventDate: '2026-10-01', cast: ['Sam Altman'],
    spend: { serperQueries: 0, serperUsd: 0, lookUsd: 0 }, nextName: (ext) => path.join(dir, `c${++n}.${ext}`),
  };
  const want = (over: Partial<Want>): Want => ({ id: 'w', kind: 'event_photo', what: 'x', terms: 'x', people: [], qids: [], playerId: null, key_moment: false, sources: [], ...over });
  const found = await gather([
    want({ id: 'person:sam-altman', kind: 'person_photo', terms: 'Sam Altman', people: ['Sam Altman'], qids: [SAM], sources: ['wikidata'] }),
    want({ id: 'page:1', kind: 'web_page', sources: [] }),
    want({ id: 'company:openai', kind: 'logo', sources: [] }),
  ], run);
  assert.deepEqual(found.map((c) => c.source), ['photo_bank', 'photo_bank'], 'the bank leads; wikidata (gone) found nothing');
  assert.deepEqual(lookups, [{ qids: [SAM], words: [], limit: 4 }], 'by the cast member’s QID; pages and logos are not asked');
  const [fresh, stale] = found;
  assert.deepEqual([fresh.url, fresh.localFile, fresh.prior_look?.watermark, fresh.qids, fresh.people], ['https://bank.test/sam-stage.jpg', undefined, false, [SAM], ['Sam Altman']]);
  assert.ok(stale.localFile && fs.existsSync(stale.localFile), 'a stale URL: the bank’s own copy, read from its bucket');
  assert.equal(stale.prior_look, null, 'no stored look: it is looked at like any find');
});

test('the harvest reuses a stored look (no paid look), screens the rest, and offers every kept photo to the bank', async () => {
  const lookups: DramaLookup[] = [];
  const offers: DramaOfferInput[] = [];
  const captions: string[] = [];
  const { result, jobId } = await harvest(stubBank(lookups, offers), captions);
  const fromBank = result.inventory.assets.filter((a) => a.flags.includes('photo_bank'));
  assert.equal(fromBank.length, 2, JSON.stringify({ notes: result.notes, rejected: result.rejected }));
  const reused = fromBank.find((a) => a.flags.includes('look:from_bank'))!;
  assert.ok(reused && reused.flags.includes('identity:verified'), 'the bank’s identity verdict stands');
  assert.ok(!captions.some((c) => /DevDay stage/.test(c)), 'the photo with a stored look was not looked at again');
  assert.ok(captions.some((c) => /portrait, 2019/.test(c)), 'the photo without one was');
  assert.ok(fromBank.some((a) => a.flags.includes('bank_copy') && a.url === 'https://gone.test/sam-old.jpg'), 'the bank copy keeps its original URL for credit');

  assert.equal(offers.length, 1);
  const offer = offers[0]!;
  assert.equal(offer.runRef, jobId);
  assert.ok(offer.subjects.includes('Sam Altman') && offer.organizations?.includes('OpenAI'));
  assert.deepEqual(offer.items.map((i) => i.url).sort(), ['https://bank.test/sam-stage.jpg', 'https://gone.test/sam-old.jpg']);
  for (const item of offer.items) {
    assert.deepEqual([item.outcome, item.kind, item.verified], ['picked', 'person_photo', [{ name: 'Sam Altman', qid: SAM }]]);
    assert.ok(item.look && item.credit && item.slide >= 1);
  }
  assert.equal(offer.items.find((i) => i.url === 'https://bank.test/sam-stage.jpg')!.sourcePage, 'https://commons.wikimedia.org/wiki/File:Sam.jpg');
  assert.ok(result.notes.some((n) => /photo bank: offered 2 photo/.test(n)));
});

test('offerItems: only web photos; a QID from the want when the find had none; the licence joins the credit', () => {
  const wants: Want[] = [{ id: 'person:sam-altman', kind: 'person_photo', what: 'a photo of Sam Altman', terms: 'Sam Altman', people: ['Sam Altman'], qids: [SAM], playerId: null, key_moment: false, sources: [] }];
  const base = { source: 'openverse' as const, credit: 'Jane Doe', license: 'CC BY 4.0', source_page: 'https://x/p', date_taken: null, date_basis: 'unknown' as const, kind: 'person_photo' as const, people: ['Sam Altman'], qids: [], made: false, flags: ['identity:verified'], caption: 'c', wants: ['person:sam-altman'], look: null, faces: null };
  const items = offerItems([
    { c: { ...base, url: 'https://x/1.jpg' }, slide: 1, outcome: 'picked' },
    { c: { ...base, url: null }, slide: 2, outcome: 'picked' },
    { c: { ...base, url: 'https://x/shot.png', source: 'screen', kind: 'web_page' }, slide: 3, outcome: 'picked' },
    { c: { ...base, url: 'https://x/sketch.png', made: true }, slide: 4, outcome: 'picked' },
    { c: { ...base, url: 'https://x/2.jpg', flags: ['identity:probable'] }, slide: 5, outcome: 'passed' },
  ], wants);
  assert.deepEqual(items.map((i) => [i.url, i.outcome, i.verified.map((v) => v.qid)]), [['https://x/1.jpg', 'picked', [SAM]], ['https://x/2.jpg', 'passed', []]]);
  assert.equal(items[0]!.credit, 'Jane Doe (CC BY 4.0)');
  assert.equal(items[0]!.request, 'a photo of Sam Altman');
});

test('fail open: an unreachable bank leaves the harvest exactly as without one', async () => {
  const calls: string[] = [];
  const broken: BankBackend = {
    settings: async () => (calls.push('settings'), Promise.reject(new Error('ECONNREFUSED'))),
    lookup: async () => (calls.push('lookup'), []),
    download: async () => (calls.push('download'), Buffer.alloc(0)),
    offer: () => void calls.push('offer'),
    drain: async () => void calls.push('drain'),
  };
  const logs: string[] = [];
  const without = await harvest(null);
  const withBroken = await harvest(guardedPhotoBank(broken, { log: (l) => logs.push(l) }));
  assert.deepEqual(
    [withBroken.result.inventory.usable_count, withBroken.result.inventory.kill, withBroken.result.rejected.length],
    [without.result.inventory.usable_count, without.result.inventory.kill, without.result.rejected.length],
  );
  assert.deepEqual(calls, ['settings'], 'down after the first failure: no more calls, no offers');
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /photo bank down/);
});

test('the guarded bank: finder_source off reads nothing; a hung bank costs one timeout; capture is the media library’s gate', async () => {
  const calls: string[] = [];
  const backend = (over: Partial<BankBackend>): BankBackend => ({
    settings: async () => ({ present: true, capture: true, finderSource: 'compete' }),
    lookup: async () => (calls.push('lookup'), [hit({})]),
    download: async () => Buffer.alloc(1),
    offer: () => void calls.push('offer'),
    drain: async () => undefined,
    ...over,
  });
  const off = guardedPhotoBank(backend({ settings: async () => ({ present: true, capture: true, finderSource: 'off' }) }));
  assert.deepEqual(await off.lookup({ qids: [SAM], words: [], limit: 4 }), []);
  assert.deepEqual(calls, [], 'off: the bank is not searched');
  const absent = guardedPhotoBank(backend({ settings: async () => ({ present: false, capture: false, finderSource: 'off' }) }));
  assert.deepEqual(await absent.lookup({ qids: [SAM], words: [], limit: 4 }), []);

  const on = guardedPhotoBank(backend({}));
  assert.equal((await on.lookup({ qids: [SAM], words: [], limit: 4 })).length, 1);
  on.offer({ runRef: 'j', subjects: [], items: [] });
  assert.deepEqual(calls, ['lookup', 'offer']);

  const hung = guardedPhotoBank(backend({ settings: () => new Promise(() => undefined) }), { timeoutMs: 30 });
  const t0 = Date.now();
  assert.deepEqual(await hung.lookup({ qids: [SAM], words: [], limit: 4 }), []);
  assert.deepEqual(await hung.lookup({ qids: [SAM], words: [], limit: 4 }), []);
  assert.ok(Date.now() - t0 < 1_000, 'one timeout, then the bank is skipped');
  await assert.rejects(hung.fetchStored('originals/x.jpg'));
});
