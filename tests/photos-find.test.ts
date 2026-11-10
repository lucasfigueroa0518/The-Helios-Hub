// tests/photos-find.test.ts — the shared photo finder (findPhotos), its profiles and its need mappers.
// Offline: the harvest engine (`run`) is a stub; no model, Serper or HTTP call is made (CLAUDE.md Rule 1).
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pick as LfdPick, StoryCopy } from '@/lib/lfd/types';
import { findPhotos, LOOK_HEADROOM_USD, MIN_ALLOWANCE_USD, nativeShortSide, pitchForNeed, SERPER_SHARE, serperLimited } from '@/lib/photos/find';
import { draftSlotIndex, needForLfd, needFromRequest, needsForDraft, specificityFor } from '@/lib/photos/needs';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import { PHOTO_PROFILE_IDS, SHARED_PHOTO_CAP_USD, type PhotoBudget, type PhotoDeps, type PhotoNeed } from '@/lib/photos/types';
import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import type { HarvestDeps, HarvestPhotoBank } from '@/lib/reel-ai-drama/harvest/types';
import type { Asset } from '@/lib/reel-ai-drama/types';
import type { Brief } from '@/lib/social/reporter/brief';
import type { FilledDraft } from '@/lib/social/writer/draft';

const NOW = new Date('2026-11-10T19:00:00Z');
const STORY = 'https://news.example/maya-app';

function asset(o: Partial<Asset> & { id: string }): Asset {
  return {
    kind: 'person_photo', file: `media/${o.id}.jpg`, url: `https://img.example/${o.id}.jpg`, source_page: null, credit: 'Reuters', license: null, shows: 'a photo',
    people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...o,
  };
}

type Step = Asset[] | Error | { assets: Asset[]; usd: number };
/** A stub engine: one step per call (the last repeats); records each call. */
function engine(...steps: Step[]) {
  const calls: Array<{ deps: HarvestDeps; input: HarvestInput }> = [];
  const run = async (deps: HarvestDeps, input: HarvestInput): Promise<HarvestResult> => {
    calls.push({ deps, input });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    const { assets, usd } = Array.isArray(step) ? { assets: step, usd: 0.02 } : step;
    return { inventory: { assets, usable_count: assets.length, counts: {}, kill: null, usd }, rejected: [], notes: [], wants: [], cast: [] };
  };
  return { run, calls };
}

const noNet = (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch;
function deps(run: PhotoDeps['run'], photoBank: HarvestPhotoBank | null = null): PhotoDeps {
  return { harvest: { http: noNet, create: null, loadPrompt: () => '', serperKey: null, photoBank, cutouts: [] }, run, now: () => NOW };
}
const budget = (usd = 0): PhotoBudget => ({ usd, capUsd: SHARED_PHOTO_CAP_USD });

function need(o: Partial<PhotoNeed> = {}): PhotoNeed {
  return {
    id: 'n1', headline: 'A blind student built her own reading app', brief: 'Maya Chen trained it herself.', copy: 'A blind student built her own reading app',
    query: 'Maya Chen demo of reading app', kind: 'event', subjects: [{ name: 'Maya Chen', type: 'person' }], storyUrls: [STORY], sourceName: 'news.example',
    storyDate: '2026-11-08', specificity: 'story', ...o,
  };
}

const moment = () => asset({ id: 'M', kind: 'event_photo', flags: ['key_moment', 'want:moment', 'source:serper'] });
const page = () => asset({ id: 'P', kind: 'event_photo', source_page: STORY, flags: ['want:article:1', 'source:article'] });
const portrait = () => asset({ id: 'R', people: ['Maya Chen'], flags: ['want:person:maya-chen'], face: { x: 0.4, y: 0.2, w: 0.2, h: 0.2 } });

test('profiles: every type, editorial credited, the $0.30 cap, the contract floors and logo rules', () => {
  assert.deepEqual(Object.keys(PHOTO_PROFILES).sort(), [...PHOTO_PROFILE_IDS].sort());
  const shape = Object.fromEntries(Object.values(PHOTO_PROFILES).map((p) => [p.id, [p.minShortSide, p.coverMinShortSide, p.allowLogo]]));
  assert.deepEqual(shape, { lfd: [600, 600, false], md: [600, 1080, false], gtn: [600, 1080, false], fvp: [600, 1080, true], carousel: [600, 1080, true] });
  for (const p of Object.values(PHOTO_PROFILES)) {
    assert.equal(p.licence, 'editorial_credited');
    assert.equal(p.capUsd, 0.3);
  }
});

test('find: a bank hit is picked; the bank reaches the harvest; the db is a sink; the pitch carries every subject', async () => {
  const bank: HarvestPhotoBank = { lookup: async () => [], fetchStored: async () => Buffer.alloc(0), offer: () => undefined };
  const e = engine({ assets: [asset({ id: 'B1', people: ['Maya Chen'], credit: 'AP', flags: ['source:photo_bank', 'want:person:maya-chen'] })], usd: 0.004 });
  const b = budget();
  const subjects: PhotoNeed['subjects'] = [{ name: 'Maya Chen', type: 'person' }, { name: 'BBC', type: 'organization' }, { name: 'ReadIt', type: 'product' }, { name: 'maya chen', type: 'person' }];
  const got = await findPhotos([need({ specificity: 'subject', kind: 'person', subjects })], PHOTO_PROFILES.md, deps(e.run, bank), { exclude: new Set(), budget: b });
  assert.equal(got.photos[0]?.src, 'https://img.example/B1.jpg');
  assert.equal(got.photos[0]?.credit, 'AP');
  assert.equal(got.photos[0]?.kind, 'person');
  assert.equal(e.calls.length, 1);
  const { deps: d, input } = e.calls[0]!;
  assert.equal(d.photoBank, bank, 'kept photos still go to the shared photo bank');
  assert.deepEqual(await d.db.query('SELECT 1'), { rows: [] }, 'the harvest database is a sink');
  assert.ok(Math.abs(d.capUsd! - (0.3 - LOOK_HEADROOM_USD)) < 1e-9, 'one frame: the whole cap, less the look headroom');
  assert.equal(input.mode, 'production');
  assert.equal(input.facts, null);
  assert.equal(input.settings.min_visuals, 1);
  assert.equal(input.settings.reuse_days, 0);
  assert.equal(input.settings.vision_model, 'claude-haiku-5-5', 'the harvest look on Haiku (CI-31)');
  assert.deepEqual(input.pitch.cast.map((c) => [c.name, c.kind]), [['Maya Chen', 'person'], ['BBC', 'company'], ['ReadIt', 'product']]);
  assert.deepEqual(input.pitch.sources.map((s) => s.url), [STORY]);
  assert.equal(input.pitch.scene, 'Maya Chen demo of reading app');
  assert.equal(input.pitch.event_date, '2026-11-08');
  assert.ok(Math.abs(b.usd - 0.004) < 1e-9, 'a harvest that returns charges its real cost');
  assert.ok(got.traces[0]!.every((t) => t.startsWith('shared:')), got.traces[0]!.join(' | '));
  assert.ok(got.traces[0]![0]!.includes('person:maya-chen') && got.traces[0]![0]!.includes('moment'), got.traces[0]![0]);
});

test("find: 'story' takes the story's own moment over a portrait; then the story pages' images", async () => {
  const one = await findPhotos([need()], PHOTO_PROFILES.md, deps(engine([portrait(), page(), moment()]).run), { exclude: new Set(), budget: budget() });
  assert.equal(one.photos[0]?.src, 'https://img.example/M.jpg', 'the key moment first');
  assert.equal(one.photos[0]?.kind, 'scene');
  const two = await findPhotos([need()], PHOTO_PROFILES.md, deps(engine([portrait(), page()]).run), { exclude: new Set(), budget: budget() });
  assert.equal(two.photos[0]?.src, 'https://img.example/P.jpg', "then the story page's own image, before a portrait");
  // A story-page image found again by another want keeps only that want's mark: its source page still counts.
  const again = asset({ id: 'Q', kind: 'event_photo', source_page: 'https://www.news.example/maya-app/?utm=x', flags: ['want:visual:1', 'source:serper'] });
  const three = await findPhotos([need()], PHOTO_PROFILES.md, deps(engine([portrait(), again]).run), { exclude: new Set(), budget: budget() });
  assert.equal(three.photos[0]?.src, 'https://img.example/Q.jpg');
});

test("find: 'subject' takes the named subject's portrait over the moment; a company ask takes its photos/logo", async () => {
  const got = await findPhotos([need({ specificity: 'subject', kind: 'person' })], PHOTO_PROFILES.md, deps(engine([moment(), page(), portrait()]).run), { exclude: new Set(), budget: budget() });
  assert.equal(got.photos[0]?.src, 'https://img.example/R.jpg');
  assert.equal(got.photos[0]?.kind, 'person');
  assert.deepEqual(got.photos[0]?.focus, { x: 0.5, y: 0.30000000000000004 }, 'focus from the face box');

  const hq = asset({ id: 'H', kind: 'place_photo', flags: ['want:company-place:bbc'] });
  const logo = asset({ id: 'L', kind: 'logo', width: 300, height: 120, flags: ['want:company:bbc'] });
  const org = need({ specificity: 'subject', kind: 'company', query: 'BBC headquarters', subjects: [{ name: 'Maya Chen', type: 'person' }, { name: 'BBC', type: 'organization' }] });
  const company = await findPhotos([org], PHOTO_PROFILES.carousel, deps(engine([moment(), portrait(), logo, hq]).run), { exclude: new Set(), budget: budget() });
  assert.equal(company.photos[0]?.src, 'https://img.example/H.jpg', "the company's own photo before its portrait or the moment");
  const logoAsk = await findPhotos([{ ...org, kind: 'logo' }], PHOTO_PROFILES.md, deps(engine([moment(), portrait(), hq, logo]).run), { exclude: new Set(), budget: budget() });
  assert.equal(logoAsk.photos[0]?.src, 'https://img.example/L.jpg', 'a logo ask takes the logo (exempt from the inner floor), even where allowLogo is false');
  assert.equal(logoAsk.photos[0]?.kind, 'logo');
});

test("find: nothing usable → null with a trace saying why; a failing harvest → null; neither throws", async () => {
  const assets = [
    asset({ id: 'U', url: null }),
    asset({ id: 'S', kind: 'web_page', made: true }),
    asset({ id: 'T', kind: 'event_photo', width: 500, height: 400, flags: ['key_moment'] }),
    asset({ id: 'X', kind: 'event_photo', flags: ['key_moment'] }),
  ];
  const got = await findPhotos([need()], PHOTO_PROFILES.md, deps(engine(assets).run), { exclude: new Set(['https://img.example/X.jpg']), budget: budget() });
  assert.equal(got.photos[0], null);
  const last = got.traces[0]!.at(-1)!;
  assert.match(last, /^shared: nothing usable/);
  assert.match(last, /1 no web URL/);
  assert.match(last, /1 made/);
  assert.match(last, /1 too small/);
  assert.match(last, /1 excluded/);
  assert.match(last, /today's finder takes over/);

  const boom = await findPhotos([need()], PHOTO_PROFILES.md, deps(engine(new Error('serper down')).run), { exclude: new Set(), budget: budget() });
  assert.equal(boom.photos[0], null);
  assert.match(boom.traces[0]!.at(-1)!, /^shared: harvest failed \(serper down\)/);
});

test('find: frames run serially; each frame gets (cap - spent) / frames left; a throwing harvest keeps its allowance charged', async () => {
  const e = engine({ assets: [], usd: 0.02 }, new Error('looked, then crashed'), { assets: [], usd: 0.05 });
  const b = budget();
  const got = await findPhotos([need({ id: 'a' }), need({ id: 'b' }), need({ id: 'c' })], PHOTO_PROFILES.md, deps(e.run), { exclude: new Set(), budget: b });
  // The harvest's look cap holds back LOOK_HEADROOM_USD (one sheet can run past the cap check).
  const caps = e.calls.map((c) => c.deps.capUsd! + LOOK_HEADROOM_USD);
  assert.equal(caps.length, 3);
  assert.ok(Math.abs(caps[0]! - 0.1) < 1e-9, `frame 1: 0.30 / 3 (${caps[0]})`);
  assert.ok(Math.abs(caps[1]! - 0.14) < 1e-9, `frame 2: unused money rolls forward, 0.28 / 2 (${caps[1]})`);
  assert.ok(Math.abs(caps[2]! - 0.14) < 1e-9, `frame 3: the crash kept its 0.14 charged, 0.14 / 1 (${caps[2]})`);
  assert.ok(Math.abs(b.usd - 0.21) < 1e-9, `0.02 + 0.14 (charged) + 0.05 (${b.usd})`);
  assert.match(got.traces[1]!.at(-1)!, /allowance counts as spent/);

  // A spent cap never calls the engine: every frame left goes to today's finder.
  const spent = engine([moment()]);
  const none = await findPhotos([need(), need({ id: 'n2' })], PHOTO_PROFILES.md, deps(spent.run), { exclude: new Set(), budget: { usd: 0.3, capUsd: 0.3 } });
  assert.equal(spent.calls.length, 0);
  assert.deepEqual(none.photos, [null, null]);
  assert.match(none.traces[0]![0]!, /^shared: skipped, the post's \$0\.30 cap is spent/);
});

test('find: no photo twice in a set, by URL or by pHash (Hamming ≤ NEAR_DUPLICATE)', async () => {
  const a = asset({ id: 'A', kind: 'event_photo', phash: 'ffffffffffffffff', flags: ['key_moment'] });
  const sameUrl = asset({ id: 'A2', kind: 'event_photo', url: 'https://img.example/A.jpg', flags: ['key_moment'] });
  const near = asset({ id: 'N', kind: 'event_photo', phash: 'fffffffffffffff0', flags: ['key_moment'] }); // 4 bits off
  const far = asset({ id: 'F', kind: 'event_photo', phash: '0000000000000000', flags: ['key_moment'] });
  const e = engine([a], [sameUrl, near, far]);
  const got = await findPhotos([need({ id: 'a' }), need({ id: 'b' })], PHOTO_PROFILES.md, deps(e.run), { exclude: new Set(), budget: budget() });
  assert.deepEqual(got.photos.map((p) => p?.src), ['https://img.example/A.jpg', 'https://img.example/F.jpg']);
  assert.match(got.traces[1]!.join(' '), /picked F/);
  const onlyDupes = await findPhotos([need({ id: 'a' }), need({ id: 'b' })], PHOTO_PROFILES.md, deps(engine([a], [sameUrl, near]).run), { exclude: new Set(), budget: budget() });
  assert.equal(onlyDupes.photos[1], null);
  assert.match(onlyDupes.traces[1]!.at(-1)!, /1 already in the set, 1 near-duplicate in the set/);
});

test('find: the cover floor (1080) and no logo on a cover; inner frames keep the 600 floor and the logo rules', async () => {
  const mid = asset({ id: 'MID', kind: 'event_photo', width: 1200, height: 800, flags: ['key_moment'] });
  const big = asset({ id: 'BIG', kind: 'event_photo', width: 1920, height: 1280 });
  const logo = asset({ id: 'LOGO', kind: 'logo', width: 2000, height: 1200, flags: ['want:company:bbc'] });
  const org = [{ name: 'BBC', type: 'organization' as const }];
  const cover = await findPhotos([need({ cover: true, specificity: 'subject', kind: 'company', subjects: org })], PHOTO_PROFILES.carousel, deps(engine([logo, mid, big]).run), { exclude: new Set(), budget: budget() });
  assert.equal(cover.photos[0]?.src, 'https://img.example/BIG.jpg', 'the 800px moment is under the cover floor; the logo is never a cover');
  const inner = await findPhotos([need({ specificity: 'subject', kind: 'company', subjects: org })], PHOTO_PROFILES.carousel, deps(engine([mid, big, logo]).run), { exclude: new Set(), budget: budget() });
  assert.equal(inner.photos[0]?.src, 'https://img.example/LOGO.jpg', 'carousels allow a logo on an inner frame');
  const noLogo = await findPhotos([need({ kind: 'event' })], PHOTO_PROFILES.md, deps(engine([logo]).run), { exclude: new Set(), budget: budget() });
  assert.equal(noLogo.photos[0], null);
  assert.match(noLogo.traces[0]!.at(-1)!, /logo not allowed/);
  const coverOnlyLogo = await findPhotos([need({ cover: true, kind: 'company', subjects: org })], PHOTO_PROFILES.carousel, deps(engine([logo, mid]).run), { exclude: new Set(), budget: budget() });
  assert.equal(coverOnlyLogo.photos[0], null);
  assert.match(coverOnlyLogo.traces[0]!.at(-1)!, /1 logo on the cover, 1 too small/);
  // The floor reads the web image's own size: a resized save is scaled back, an upscaled one down.
  assert.equal(nativeShortSide(asset({ id: 'r', width: 2160, height: 1000, flags: ['resized:0.5'] })), 2000);
  assert.equal(nativeShortSide(asset({ id: 'u', width: 1200, height: 900, upscaled: true, flags: ['upscaled:1.5x'] })), 600);
  assert.equal(nativeShortSide(asset({ id: 'v', width: 1200, height: 900, upscaled: true })), 0);
});

test('pitchForNeed: the scene falls back to the copy, then the headline', () => {
  assert.equal(pitchForNeed(need({ query: '' })).scene, 'A blind student built her own reading app');
  assert.equal(pitchForNeed(need({ query: '', copy: '' })).title, 'A blind student built her own reading app');
});

/* ── Mappers ─────────────────────────────────────────────────────────────── */

test('specificityFor: person/company/logo/product → subject, else story', () => {
  for (const k of ['person', 'company', 'logo', 'product', 'Person']) assert.equal(specificityFor(k), 'subject', k);
  for (const k of ['event', 'thematic', 'setting', 'scene', '']) assert.equal(specificityFor(k), 'story', k);
});

test('needFromRequest: a Stories request as a need', () => {
  const n = needFromRequest(
    { kind: 'person', query: 'Sam Altman', subjects: [{ name: 'Sam Altman', type: 'person' }, { name: 'OpenAI', type: 'organization' }], storyDate: '2026-11-07T12:00:00Z', sourceUrls: ['https://www.theverge.com/a', 'ftp://x', 'https://www.theverge.com/a'], copy: 'Altman says X', exclude: new Set(), cover: true },
    '0',
    { headline: 'OpenAI ships X', brief: 'b'.repeat(1500) },
  );
  assert.deepEqual(n, {
    id: '0', headline: 'OpenAI ships X', brief: 'b'.repeat(1200), copy: 'Altman says X', query: 'Sam Altman', kind: 'person',
    subjects: [{ name: 'Sam Altman', type: 'person' }, { name: 'OpenAI', type: 'organization' }], storyUrls: ['https://www.theverge.com/a'], sourceName: 'theverge.com',
    storyDate: '2026-11-07', specificity: 'subject', cover: true,
  });
  const bare = needFromRequest({ kind: 'product', query: 'Vision Pro', subjects: [], storyDate: null, sourceUrls: [], exclude: new Set() }, '1', { sourceName: null });
  assert.equal(bare.headline, '');
  assert.equal(bare.sourceName, null);
  assert.equal(bare.cover, undefined);
  assert.deepEqual(bare.subjects, [{ name: 'Vision Pro', type: 'product' }], 'a product ask names its product');
});

test('needForLfd: an LFD slide as a need', () => {
  const pick = {
    key: 'k', refs: [], origin: 'reels', headline: 'Blind Student Builds App', sourceName: 'BBC', url: 'https://bbc.example/a', body: 'x'.repeat(2000), publishedAt: '2026-11-08T10:00:00.000Z',
    net: 0.4, blockbuster: 0, firstSeen: '2026-11-09', alsoFrom: [], major: 0.2, builder: 0.9, eventDate: '2026-11-07T00:00:00.000Z', lane: 'builder',
  } as unknown as LfdPick;
  const copy: StoryCopy = { key: 'k', setup: 'Setup.', headline: 'A blind student built an app', highlight: '', names: [], body: 'She trained it.', photo: { kind: 'scene', query: 'student reading app demo', subjects: [{ name: 'Maya Chen', type: 'person' }], alts: [] } };
  assert.deepEqual(needForLfd(pick, copy, '3'), {
    id: '3', headline: 'A blind student built an app', brief: 'Setup. She trained it.', copy: 'A blind student built an app', query: 'student reading app demo', kind: 'scene',
    subjects: [{ name: 'Maya Chen', type: 'person' }], storyUrls: ['https://bbc.example/a'], sourceName: 'BBC', storyDate: '2026-11-07', specificity: 'story',
  });
  const noCopy = needForLfd({ ...pick, eventDate: null } as LfdPick, { ...copy, setup: '', body: '' }, '4');
  assert.equal(noCopy.brief, 'x'.repeat(1200));
  assert.equal(noCopy.storyDate, '2026-11-08');
});

test("needsForDraft: the chosen cover (cover: true, logo → company), then each slide, in the design stage's slot names", () => {
  const brief = {
    the_news: { text: 'OpenAI shipped X.', ids: [] }, why_it_matters: [{ text: 'It matters.', ids: [] }],
    subjects: [{ id: 'S1', name: 'OpenAI', role: null, type: 'organization' }, { id: 'S2', name: 'Sam Altman', role: 'CEO', type: 'person' }],
    events: [{ what: 'launch', date: '2026-11-06', place: null }],
    sources: [{ outlet: 'The Verge', date: null, url: 'https://theverge.com/x', kind: 'original' }, { outlet: 'OpenAI', date: '2026-11-07', url: 'https://openai.com/x', kind: 'official' }],
  } as unknown as Brief;
  const v = (kind: string, query: string) => ({ kind, query });
  const draft = {
    cover: 'OpenAI ships X',
    chosen_cover: 2,
    cover_options: [{ visual: v('event', 'unused'), subject_ids: [] }, { visual: v('logo', 'OpenAI'), subject_ids: ['S1'] }],
    slides: [
      { type: 'text', headline: { text: 'What it does', facts: [] }, body: { text: 'It does Y.', facts: [] }, visual: v('thematic', 'robot arm'), subject_ids: [], quote: null },
      { type: 'quote', headline: { text: 'He said', facts: [] }, body: null, visual: v('person', 'Sam Altman'), subject_ids: ['S1'], quote: { speaker_subject: 'Sam Altman' } },
    ],
  } as unknown as FilledDraft;
  const got = needsForDraft(draft, brief);
  assert.deepEqual(got.map((g) => g.slot), ['cover', 'slide 2', 'slide 3']);
  assert.deepEqual(got.map((g) => draftSlotIndex(g.slot)), [0, 1, 2], 'slot names map back to [cover, ...slides]');
  const [cover, s2, s3] = got.map((g) => g.need);
  assert.equal(cover!.cover, true);
  assert.equal(cover!.kind, 'company', 'no logo-only covers (design.ts coverRequest)');
  assert.equal(cover!.query, 'OpenAI');
  assert.equal(cover!.specificity, 'subject');
  assert.deepEqual(cover!.subjects, [{ name: 'OpenAI', type: 'organization' }]);
  assert.equal(cover!.copy, 'OpenAI ships X');
  for (const n of [cover!, s2!, s3!]) {
    assert.equal(n.headline, 'OpenAI ships X');
    assert.equal(n.brief, 'OpenAI shipped X. It matters.');
    assert.deepEqual(n.storyUrls, ['https://theverge.com/x', 'https://openai.com/x']);
    assert.equal(n.sourceName, 'The Verge');
    assert.equal(n.storyDate, '2026-11-07');
    assert.equal(n.id, got[[cover, s2, s3].indexOf(n)]!.slot);
  }
  assert.equal(s2!.cover, undefined);
  assert.equal(s2!.specificity, 'story');
  assert.equal(s2!.copy, 'What it does It does Y.');
  assert.deepEqual(s2!.subjects, []);
  assert.equal(s3!.specificity, 'subject');
  assert.deepEqual(s3!.subjects, [{ name: 'Sam Altman', type: 'person' }, { name: 'OpenAI', type: 'organization' }], 'the named subject first, then the slide tags');
  assert.equal(draftSlotIndex('slide 1'), null);
  assert.equal(draftSlotIndex('nope'), null);
});

test('find (review fix 2): Serper stays inside its share of the allowance; a tiny allowance skips the frame', async () => {
  let real = 0;
  const http = (async () => { real += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  const limited = serperLimited(http, 0.0025);
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await limited('https://google.serper.dev/images', { method: 'POST' })).status);
  assert.deepEqual(statuses, [200, 200, 429, 429], 'two $0.001 searches fit in $0.0025');
  assert.equal(real, 2);
  assert.equal((await limited('https://img.example/a.jpg')).status, 200, 'downloads are never limited');

  // The harvest gets the limited http, sized SERPER_SHARE of the frame's allowance.
  const e = engine([moment()]);
  await findPhotos([need()], PHOTO_PROFILES.md, deps(e.run), { exclude: new Set(), budget: budget() });
  assert.notEqual(e.calls[0]!.deps.http, noNet, 'the harvest sees the Serper-limited http');
  assert.ok(SERPER_SHARE > 0 && SERPER_SHARE < 1);

  const tiny = engine([moment()]);
  const got = await findPhotos([need()], PHOTO_PROFILES.md, deps(tiny.run), { exclude: new Set(), budget: { usd: 0.3 - MIN_ALLOWANCE_USD / 2, capUsd: 0.3 } });
  assert.equal(tiny.calls.length, 0, 'under MIN_ALLOWANCE_USD the engine is never called');
  assert.deepEqual(got.photos, [null]);
});

test('find (review fix 4): a candidate the type refuses gives way to the next-ranked one', async () => {
  const e = engine([moment(), page(), portrait()]);
  const seen: string[] = [];
  const got = await findPhotos([need()], PHOTO_PROFILES.carousel, deps(e.run), {
    exclude: new Set(),
    budget: budget(),
    accept: (p) => { seen.push(p.src); return p.src.endsWith('/M.jpg') ? 'C6: agency credit' : null; },
  });
  assert.equal(got.photos[0]?.src, 'https://img.example/P.jpg', 'the story page image after the refused moment');
  assert.deepEqual(seen, ['https://img.example/M.jpg', 'https://img.example/P.jpg']);

  const all = engine([moment(), page()]);
  const none = await findPhotos([need()], PHOTO_PROFILES.carousel, deps(all.run), { exclude: new Set(), budget: budget(), accept: () => 'no' });
  assert.equal(none.photos[0], null);
  assert.match(none.traces[0]!.at(-1)!, /refused by the type \(no\)/);
});

test("find: a building or place photo fills a frame only when the writer asked for a place", async () => {
  const hq = () => asset({ id: 'H', kind: 'place_photo', flags: ['want:company-place:acme', 'source:commons'] });
  const acme = { subjects: [{ name: 'Acme', type: 'organization' as const }], kind: 'company', specificity: 'subject' as const };
  const product = await findPhotos([need({ ...acme, query: 'Acme reports dashboard', kind: 'product' })], PHOTO_PROFILES.md, deps(engine([hq()]).run), { exclude: new Set(), budget: budget() });
  assert.equal(product.photos[0], null);
  assert.match(product.traces[0]!.at(-1)!, /a building or place/);
  const place = await findPhotos([need({ ...acme, query: 'Acme headquarters' })], PHOTO_PROFILES.md, deps(engine([hq()]).run), { exclude: new Set(), budget: budget() });
  assert.equal(place.photos[0]?.src, 'https://img.example/H.jpg');
  // Found by the story-moment search too: still a building, so still refused for a frame that didn't ask for a place.
  const both = asset({ id: 'B', kind: 'place_photo', flags: ['want:company-place:acme', 'want:moment', 'key_moment'] });
  const moment2 = await findPhotos([need({ ...acme, query: 'Acme launch event', kind: 'event', specificity: 'story' })], PHOTO_PROFILES.md, deps(engine([both]).run), { exclude: new Set(), budget: budget() });
  assert.equal(moment2.photos[0], null);
  assert.match(moment2.traces[0]!.at(-1)!, /a building or place/);
});
