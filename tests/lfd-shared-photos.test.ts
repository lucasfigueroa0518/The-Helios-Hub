/** LFD's shared photo finder adopter (PHASE3-CONTRACT.md Owner B). Offline: PGlite, every model and engine stubbed. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { IntakeItem, IntakeJev, ScoredStory } from '@/lib/intake/types';
import { lfdSharedPhotos } from '@/lib/lfd/live';
import type { BuilderHarvest } from '@/lib/lfd/photos';
import { findSharedLfdPhotos, runLastFewDays, type LfdRunDeps, type LfdSharedPhotos } from '@/lib/lfd/run';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import { PHOTO_PROFILE_IDS, type PhotoDeps, type PhotoFinderModes, type PhotoNeed } from '@/lib/photos/types';
import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import type { HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed } from './fixtures/lfd/seed';

const NOW = new Date('2026-11-10T19:00:00Z'); // Tuesday 2 PM NY: a manual run

const noNet = (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch;
const harvestDeps: BuilderHarvest['deps'] = { http: noNet, create: null, loadPrompt: () => '', serperKey: null, photoBank: null, cutouts: [] };
const photoDeps: PhotoDeps = { harvest: harvestDeps, now: () => NOW };

/** The builder slice's engine: must never be called in shared mode. */
function builderEngine() {
  const calls: HarvestInput[] = [];
  const run = async (_d: HarvestDeps, input: HarvestInput): Promise<HarvestResult> => {
    calls.push(input);
    return { inventory: { assets: [], usable_count: 0, counts: {}, kill: null, usd: 0.04 }, rejected: [], notes: [], wants: [], cast: [] };
  };
  return { run, calls };
}

let seq = 0;
function member(url: string, headline: string, seen: string): IntakeItem {
  return {
    key: url, family: 'reels', sourceId: 'hn', sourceName: 'Outlet', sourceType: 'news', headline, body: `${headline}. `.repeat(80), url,
    publishTime: new Date(seen), firstSeenAt: new Date(seen), lastSeenAt: new Date(seen), engagement: null, dropReason: null, storyId: null, role: 'primary',
  } as unknown as IntakeItem;
}
function scored(headline: string, o: { net: number; major?: number; builder?: number; eventDate?: string }): ScoredStory {
  seq += 1;
  const m = member(`https://n${seq}.com/story`, headline, '2026-11-09T06:00:00Z');
  return {
    id: `story-${seq}`, representativeKey: m.key, headline, firstSeenAt: m.firstSeenAt, lastJoinedAt: m.firstSeenAt, mergedInto: null, members: [{ ...m, storyId: `story-${seq}` }],
    scores: { 'reels-score': { net: o.net, blockbuster: 0 } as unknown as InterpretedScore, ...(o.major !== undefined ? { 'major-news': o.major } : {}), ...(o.builder !== undefined ? { 'story-builder': o.builder } : {}) },
    eventDate: o.eventDate ? new Date(o.eventDate) : null, yours: false,
  };
}

/** Writer stub: valid copy for every story. Vision verdicts: `reject(headline, n)` names a reason to reject (n = that story's nth look). */
function writer(reject: (headline: string, n: number) => string | null = () => null) {
  const looks = new Map<string, number>();
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    if ((p as { output_config?: { format?: unknown } }).output_config?.format) throw new Error('no caption in this test');
    if ((p.tools?.[0] as { name?: string } | undefined)?.name === 'submit_verdict') {
      const blocks = p.messages[0]!.content as Array<{ type: string; text?: string }>;
      const s = JSON.parse(blocks.find((b) => b.type === 'text')!.text!) as { headline: string };
      const n = (looks.get(s.headline) ?? 0) + 1;
      looks.set(s.headline, n);
      const why = reject(s.headline, n);
      const input = why ? { shows_story_subject: false, generic_stock: true, reason: why } : { shows_story_subject: true, generic_stock: false, reason: 'ok' };
      return { id: 'v', type: 'message', role: 'assistant', model: 'h', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input }] } as unknown as Anthropic.Message;
    }
    const user = String((p.messages.at(-1) as { content: unknown }).content);
    const material = JSON.parse(user.slice(user.indexOf('<material>') + 10, user.indexOf('</material>'))) as { stories: Array<{ key: string; headline: string }> };
    const stories = material.stories.map((s) => ({
      key: s.key, setup: '', headline: `Story ${s.headline.slice(0, 40)}`, highlight: '', names: [], body: 'It happened this week. More is coming',
      photo: s.headline.includes('Builds')
        ? { kind: 'person', query: 'Maya Chen app', subjects: [{ name: 'Maya Chen', type: 'person' }], alts: [] }
        : { kind: 'company', query: s.headline, subjects: [], alts: [] },
    }));
    return { id: 'm', type: 'message', role: 'assistant', model: 's', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't', name: 'submit_rundown', input: { stories } }] } as unknown as Anthropic.Message;
  };
  return { create, looks };
}

const jev: JevAsk = async (_req, meta): Promise<JevResult> => {
  const usage = { input_tokens: 1, output_tokens: 0 };
  if (meta.version.startsWith('md-grounding')) return { answers: { supported: { noul: 0.9 } }, usage, model: 's' };
  if (meta.version.startsWith('major-news')) return { answers: {}, usage, model: 's' };
  return { answers: { same_event: { noul: 0.1 }, lead: { noul: 0.5 } }, usage, model: 's' };
};

/** Today's finder: fills every request it is asked, by source URL. */
function finder() {
  const asked: string[] = [];
  const photos: PhotoFinder = {
    usd: 0,
    find: async () => null,
    findSet: async (reqs: PhotoRequest[]) => {
      asked.push(...reqs.map((r) => r.sourceUrls[0]!));
      return reqs.map((r) => ({ src: `https://finder/${encodeURIComponent(r.sourceUrls[0]!)}.jpg`, credit: 'F', kind: 'scene' as const }));
    },
  };
  return { photos, asked };
}

/** The shared finder stub: fills needs whose headline matches `hit`, spending `usd` per need; records every set. */
function sharedStub(hit: (n: PhotoNeed) => boolean, usd = 0.03) {
  const sets: PhotoNeed[][] = [];
  const s: LfdSharedPhotos = {
    profile: PHOTO_PROFILES.lfd,
    deps: photoDeps,
    find: async (needs, _profile, _deps, opts) => {
      sets.push(needs);
      return {
        photos: needs.map((n) => {
          opts.budget.usd += usd;
          return hit(n) && !opts.exclude.has(`https://shared/${n.id}.jpg`) ? { src: `https://shared/${n.id}.jpg`, credit: 'AP', kind: 'person' as const } : null;
        }),
        traces: needs.map((n) => [`shared: need ${n.id}`]),
      };
    },
  };
  return { s, sets };
}

async function deps(over: Partial<LfdRunDeps> = {}, w = writer()) {
  resetSeed();
  const { query } = await openHubTestDb();
  const f = finder();
  const stories = [
    scored('Maya Chen Builds Her Own Reading App', { net: 0.1, major: 0.2, builder: 0.9, eventDate: '2026-11-08T00:00:00Z' }),
    ...Array.from({ length: 6 }, (_, i) => scored(`Niche Thing ${i} Happens`, { net: 0.9 - i / 20, major: 0.1 })),
  ];
  const leadUrl = stories[1]!.members[0]!.url;
  const d: LfdRunDeps = {
    query,
    jev,
    create: w.create as LfdRunDeps['create'],
    photos: f.photos,
    fetchFeeds: async () => { throw new Error('intake mode never fetches feeds'); },
    fetchBody: async () => null,
    // One story has an article lead image.
    readPage: async (url) => (url === leadUrl
      ? { ok: true, url, resolvedUrl: url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: `${leadUrl}/lead.jpg`, caption: null, credit: 'BBC', alt: null, from: 'figure', width: 1400 }] }
      : { ok: false, url, error: 'stub' }),
    fitCheck: async (post, opts) => {
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        for (let i = 1; i <= post.slides.length; i++) {
          const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
          await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
        }
      }
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async () => undefined,
    now: NOW,
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0, jevUsd: 0 }),
    intake: {
      jev: {} as IntakeJev,
      mode: async () => 'intake',
      ensureFresh: async () => ({ ran: false, reason: 'fresh' }),
      lanes: { listStories: async () => stories, readCarouselPosted: async () => [], postedCheck: async () => new Set() },
    },
    ...over,
  };
  return { d, f, leadUrl, builderUrl: stories[0]!.members[0]!.url };
}

type Story = { lane: string; url: string; photo: { src: string }; photoSource: string; photoTrace: string[] };
type Rec = { photoShared?: { usd: number; slides: Array<{ key: string; found: boolean }> }; photoHarvest?: unknown; drops: Array<{ reason: string }>; vision: { rejected: number } };

async function read(d: LfdRunDeps) {
  const post = await d.query<{ stories: Story[] }>(`SELECT stories FROM lfd.posts`);
  const run = await d.query<{ record: Rec; claude_usd: number }>(`SELECT record, claude_usd FROM lfd.runs`);
  return { stories: post.rows[0]!.stories, record: run.rows[0]!.record, claudeUsd: Number(run.rows[0]!.claude_usd) };
}

test('shared mode order: every slide tries the shared finder first, then lead image → today\'s finder; the builder harvest is skipped; spend counts', async () => {
  const e = builderEngine();
  const shared = sharedStub((n) => n.headline.includes('Maya Chen'));
  const { d, f, leadUrl, builderUrl } = await deps({ harvest: { deps: harvestDeps, run: e.run }, sharedPhotos: shared.s });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { stories, record, claudeUsd } = await read(d);
  assert.equal(e.calls.length, 0, 'shared mode skips the builder-only harvest slice');
  assert.equal(record.photoHarvest, undefined);
  // Every slide in the post went through the shared finder.
  const askedShared = shared.sets.flat();
  for (const s of stories) assert.ok(askedShared.some((n) => n.storyUrls.includes(s.url)), `${s.url} asked the shared finder`);
  assert.equal(shared.sets[0]!.length, stories.length, 'one shared set over the round\'s slides');
  const b = stories.find((s) => s.url === builderUrl)!;
  assert.equal(b.photoSource, 'harvest');
  assert.ok(b.photo.src.startsWith('https://shared/'));
  assert.ok(b.photoTrace.every((t) => t.startsWith('shared:')));
  assert.ok(!f.asked.includes(builderUrl), 'today\'s finder is not asked for a shared hit');
  const lead = stories.find((s) => s.url === leadUrl)!;
  assert.equal(lead.photoSource, 'lead', 'a shared miss takes the article lead image next');
  assert.ok(lead.photoTrace[0]!.startsWith('shared:'), 'shared steps first');
  const rest = stories.filter((s) => s.url !== builderUrl && s.url !== leadUrl);
  assert.ok(rest.length > 0 && rest.every((s) => s.photoSource === 'finder' && s.photoTrace[0]!.startsWith('shared:')));
  assert.ok(rest.every((s) => f.asked.includes(s.url)));
  assert.ok(record.photoShared && record.photoShared.usd > 0);
  assert.ok(Math.abs(claudeUsd - record.photoShared.usd) < 1e-9, 'the shared spend is in the run\'s cost');
});

test('shared mode: the vision check rejects a shared photo → today\'s finder for the same story, never the shared photo again', async () => {
  const shared = sharedStub((n) => n.headline.includes('Maya Chen'));
  const w = writer((headline, n) => (headline.includes('Maya Chen') && n === 1 ? 'generic stock photo' : null));
  const { d, f, builderUrl } = await deps({ sharedPhotos: shared.s }, w);
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { stories, record } = await read(d);
  assert.equal(record.vision.rejected, 1);
  const b = stories.find((s) => s.url === builderUrl)!;
  assert.ok(b, 'the story stays: today\'s finder replaced its photo');
  assert.equal(b.photoSource, 'finder');
  assert.ok(!b.photo.src.startsWith('https://shared/'));
  assert.match(b.photoTrace[0]!, /^shared photo rejected by vision: generic stock photo: https:\/\/shared\//);
  assert.ok(f.asked.includes(builderUrl));
  assert.ok(!record.drops.some((x) => x.reason === 'vision-rejected'));
  const maya = [...w.looks.keys()].find((k) => k.includes('Maya'))!;
  assert.ok(w.looks.get(maya)! >= 2, 'the new photo is looked at again');
});

test('legacy mode: no sharedPhotos, today\'s chain; the builder harvest still runs and nothing is recorded for the shared finder', async () => {
  const e = builderEngine();
  const { d } = await deps({ harvest: { deps: harvestDeps, run: e.run } });
  assert.ok((await runLastFewDays(d)).ok);
  const { record } = await read(d);
  assert.equal(record.photoShared, undefined);
  assert.equal(e.calls.length, 1, 'the builder slide asks the harvest, as today');
});

test('the LFD switch read: legacy, garbage, or an error → no shared finder (deps never built); shared → the lfd profile', async () => {
  const legacy = Object.fromEntries(PHOTO_PROFILE_IDS.map((id) => [id, 'legacy'])) as PhotoFinderModes;
  const q = (async () => { throw new Error('no db'); }) as unknown as Parameters<typeof lfdSharedPhotos>[0];
  let built = 0;
  const make = (readModes: () => Promise<PhotoFinderModes>) => ({ readModes, profiles: PHOTO_PROFILES, deps: async () => { built += 1; return photoDeps; } });
  const quiet = () => {};
  assert.equal(await lfdSharedPhotos(q, make(async () => legacy), quiet), undefined);
  assert.equal(await lfdSharedPhotos(q, make(async () => { throw new Error('no table'); }), quiet), undefined);
  assert.equal(await lfdSharedPhotos(q, make(async () => ({ lfd: 'on' }) as unknown as PhotoFinderModes), quiet), undefined);
  assert.equal(await lfdSharedPhotos(q, { deps: async () => { built += 1; return photoDeps; } }, quiet), undefined, 'the real switch over a failing query');
  assert.equal(built, 0);
  const on = await lfdSharedPhotos(q, make(async () => ({ ...legacy, lfd: 'shared' })), quiet);
  assert.equal(on?.profile, PHOTO_PROFILES.lfd);
  assert.equal(on?.deps, photoDeps);
  assert.equal(await lfdSharedPhotos(q, { readModes: async () => ({ ...legacy, lfd: 'shared' }), deps: async () => { throw new Error('no key'); } }, quiet), undefined);
});

test('findSharedLfdPhotos never throws: an error leaves every story to today\'s chain, the reason traced', async () => {
  const s: LfdSharedPhotos = { profile: PHOTO_PROFILES.lfd, deps: photoDeps, find: async () => { throw new Error('boom'); }, need: () => ({}) as PhotoNeed };
  const items = [{ pick: { key: 'a' }, copy: {} }, { pick: { key: 'b' }, copy: {} }] as unknown as Parameters<typeof findSharedLfdPhotos>[1];
  const got = await findSharedLfdPhotos(s, items, new Set(), { usd: 0, capUsd: 0.3 });
  assert.deepEqual(got.photos, [null, null]);
  assert.deepEqual(got.traces, [['shared: failed: boom'], ['shared: failed: boom']]);
});
