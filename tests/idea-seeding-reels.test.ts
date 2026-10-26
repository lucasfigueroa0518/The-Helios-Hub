/**
 * Idea seeding, Text on Screen (design 2026-10-26-text-on-screen-seeding), offline on PGlite with the real reels and hub
 * schemas and a stubbed Jev transport (no live calls): a typed idea becomes a source and post idea marked 'seed', is scored
 * once and written as one carryover row on the newest slate, is invisible to every grouping read, is listed in the pool as
 * the person's own, and is held to 10 open, 7 days, 10,000 characters of text, and a refusal before any spend.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';
import type { EntryType, Questions } from '@typesafe-ai/sdk';

import { listUngroupedSources, shortlistCandidates, shortlistIdeaMerges, createPostIdea, insertSource } from '@/lib/reels/repository';
import { RecordingJevRunner, type JevTransport } from '@/lib/reels/jev/runner';
import { groupRun } from '@/lib/reels/pipeline/grouping';
import { putOnSlate } from '@/lib/reels/pipeline/promote';
import { carryoverMisses, heldFromCarryover } from '@/lib/reels/scoring/decide';
import { loadSlateRanked } from '@/lib/reels/scoring/store';
import { MAX_OPEN_SEEDS, MAX_TEXT_CHARS, SeedError, addReelSeed, isUnscoredSeed, readOpenSeeds } from '@/lib/reels/seeds';
import { reelIdeas } from '@/lib/social-hub/adapters/reels';
import { REEL_IDEAS_SQL, type ReelIdeaRow } from '@/lib/social-hub/queries/reels';
import { capQueued, queueOrder } from '@/lib/social-hub/queue';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const RUN = 'a0000000-0000-4000-8000-000000000001';
const OLD_SLATE = 'a0000000-0000-4000-8000-000000000003';
const NEW_SLATE = 'a0000000-0000-4000-8000-000000000004';
const NORMAL = 'a0000000-0000-4000-8000-000000000011';
const PAGE = 'A long page about a new model and what it changes for everyone building with it. '.repeat(6);

/** A stub transport: every score question answers 3 of 4 at 0.9 confidence, every yes/no 0.1. Counts the calls. */
function stub(opts: { fail?: boolean } = {}) {
  const calls = { n: 0 };
  const transport: JevTransport = {
    async systemOne<const Q extends Questions>(_state: EntryType, questions: Q) {
      calls.n += 1;
      if (opts.fail) throw new Error('stub: model unavailable');
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, ['frontierDrop', 'blueChipCompany', 'blueChipPerson'].includes(k) ? { noul: 0.1 } : { score: 3, confidence: 0.9 }]));
      return { answers, usage: { input_tokens: 1000, output_tokens: 0 }, model: 'stub' } as never;
    },
  };
  return { calls, jev: new RecordingJevRunner(transport) };
}

async function reelsDb(opts: { withSlate?: boolean } = {}): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  const query = (text: string, params?: unknown[]) => pg.query<any>(text, params as unknown[]);
  // dbTransaction needs a connect(); a PGlite session is one connection, so BEGIN/COMMIT on it is the transaction.
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query, connect: async () => ({ query, release: () => undefined }) };
  if (opts.withSlate !== false) {
    await pg.exec(`
      INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
      INSERT INTO reels.post_ideas (id, timely) VALUES ('${NORMAL}', false);
      INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
        ('${NEW_SLATE}', '${RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2');
      INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components) VALUES
        ('${NEW_SLATE}', '${NORMAL}', 'timely', 1.5, 1, true, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{}'::jsonb);`);
  }
  return pg;
}

const refused = (p: Promise<unknown>, status: number, match: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof SeedError && e.status === status && match.test(e.message));
const count = async (pg: PGlite, sql: string) => Number((await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`)).rows[0]!.n);
const headline = (n: number) => `Seeded idea ${n} about topic ${n * 7919}`;

test('a typed idea is a seed source and idea, scored once (two Jev calls), and written as one carryover row on the newest slate', async () => {
  const pg = await reelsDb();
  const { calls, jev } = stub();
  const slatesBefore = await count(pg, 'reels.score_slates');
  const runsBefore = await count(pg, 'reels.runs');
  const out = await addReelSeed({ headline: 'Anthropic ships a new model', text: PAGE, url: 'https://news.test/a?utm_source=x' }, { jev, readPage: async () => assert.fail('own text: the page is not read') });
  assert.equal(out.scored, true);
  assert.equal(calls.n, 2, 'pass 1 and pass 2');
  const src = (await pg.query<any>(`SELECT run_id, adapter_id, source_name, canonical_url, drop_reason, raw_payload FROM reels.sources WHERE adapter_id = 'seed'`)).rows;
  assert.deepEqual(src, [{ run_id: null, adapter_id: 'seed', source_name: 'Your seed', canonical_url: 'https://news.test/a', drop_reason: 'seed', raw_payload: { seed: true } }]);
  const idea = (await pg.query<any>(`SELECT timely FROM reels.post_ideas WHERE id = $1`, [out.id])).rows[0];
  assert.equal(idea.timely, false, 'the night never treats a seed as tonight’s new material');
  const rows = (await pg.query<any>(`SELECT slate_id, origin, selected, rank, net, chosen_bucket, chosen_framework FROM reels.idea_scores WHERE post_idea_id = $1`, [out.id])).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].slate_id, rows[0].origin, rows[0].selected, rows[0].rank], [NEW_SLATE, 'carryover', false, 2]);
  assert.ok(rows[0].net != null && rows[0].chosen_bucket && rows[0].chosen_framework);
  assert.equal(await count(pg, 'reels.score_slates'), slatesBefore, 'no new slate');
  assert.equal(await count(pg, 'reels.runs'), runsBefore, 'no run row');
  assert.equal(await count(pg, `reels.jev_logs WHERE run_id IS NULL`), 2);
});

test('putOnSlate copies the seed’s stored row onto a new slate, as it does for any idea', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const out = await addReelSeed({ headline: 'Seed to pin', text: PAGE }, { jev });
  await pg.exec(`INSERT INTO reels.runs (id, trigger, status) VALUES ('a0000000-0000-4000-8000-000000000002', 'scheduled', 'ok');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', '2026-10-09', '2026-10-09T05:30:00Z', 'p1', 'p2')`);
  assert.equal(await putOnSlate('a0000000-0000-4000-8000-000000000005', out.id), true);
  const copied = (await pg.query<any>(`SELECT origin, net FROM reels.idea_scores WHERE slate_id = 'a0000000-0000-4000-8000-000000000005' AND post_idea_id = $1`, [out.id])).rows[0];
  assert.equal(copied.origin, 'carryover');
  assert.ok(copied.net != null);
});

test('no grouping read returns a seed, and the night’s grouping leaves it alone', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const title = 'OpenAI releases a brand new frontier model today';
  const seed = await addReelSeed({ headline: title, text: PAGE }, { jev });
  // A machine story with the same headline joins the pool after it (the case the drop reason exists for).
  const sid = await insertSource({ runId: RUN, canonicalUrl: 'https://wire.test/x', headline: title, body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
  const other = await createPostIdea(sid!, RUN, 'test');
  const ungrouped = await listUngroupedSources();
  assert.deepEqual(ungrouped.map((s) => s.adapter_id).filter((a) => a === 'seed'), []);
  const near = await shortlistCandidates(sid!, title);
  assert.deepEqual(near.filter((c) => c.source_name === 'Your seed'), []);
  const merges = await shortlistIdeaMerges();
  assert.deepEqual(merges.filter((m) => [m.left_id, m.right_id].includes(seed.id)), []);
  const throwing = { callCount: 0, ask: async () => assert.fail('grouping must not ask about a seed') };
  await groupRun(RUN, new Date(Date.now() - 3600_000), { jev: throwing as never });
  assert.equal(await count(pg, `reels.post_ideas WHERE id = '${seed.id}'`), 1, 'the seed idea was not merged away');
  assert.equal(await count(pg, `reels.post_ideas WHERE id = '${other}'`), 1);
  assert.equal(await count(pg, `reels.post_idea_members WHERE post_idea_id = '${seed.id}'`), 1);
});

test('the pool view lists the seed as the person’s own, off an older slate too, and the 30 cap keeps it', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const seed = await addReelSeed({ headline: 'Mine on the newest slate', text: PAGE }, { jev });
  const view = async () => {
    const { rows } = await pg.query<any>(REEL_IDEAS_SQL);
    return reelIdeas(rows as ReelIdeaRow[]);
  };
  let ideas = await view();
  const mine = ideas.find((i) => i.id === `reels:idea:${seed.id}`)!;
  assert.equal(mine.yours, true);
  assert.equal(ideas.find((i) => i.id === `reels:idea:${NORMAL}`)!.yours, false);
  assert.match(mine.detail ?? '', /You typed this idea/);
  assert.doesNotMatch(mine.detail ?? '', /Carryover/, 'the carryover chip is hidden for a seed');

  // A newer slate that does not carry the seed: it still shows, with its stored score.
  await pg.exec(`INSERT INTO reels.runs (id, trigger, status) VALUES ('a0000000-0000-4000-8000-000000000002', 'scheduled', 'ok');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', '2026-10-09', '2026-10-09T05:30:00Z', 'p1', 'p2')`);
  for (let i = 0; i < 40; i++) {
    const id = `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    await pg.exec(`INSERT INTO reels.post_ideas (id, timely) VALUES ('${id}', false);
      INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, components) VALUES ('a0000000-0000-4000-8000-000000000005', '${id}', 'timely', ${3 - i / 100}, ${i + 1}, false, 'the_saga', 'arousal', '{}'::jsonb)`);
  }
  ideas = await view();
  const off = ideas.find((i) => i.id === `reels:idea:${seed.id}`)!;
  assert.equal(off.yours, true);
  assert.ok(off.score != null, 'its stored net still shows');
  const shown = capQueued(queueOrder(ideas, []));
  assert.ok(shown.length < ideas.length, 'the cap cut the pool');
  assert.ok(shown.some((q) => q.item.id === off.id), 'but not the seed');
});

test('the 11th open seed is refused; archiving, making or expiring one frees a place', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const ids: string[] = [];
  for (let i = 0; i < MAX_OPEN_SEEDS; i++) ids.push((await addReelSeed({ headline: headline(i), text: PAGE }, { jev })).id);
  const spent = calls.n;
  await refused(addReelSeed({ headline: headline(99), text: PAGE }, { jev }), 409, /make or archive one first/);
  assert.equal(calls.n, spent, 'refused before any spend');
  await pg.query<any>(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reels', $1, '2026-10-08', 'archive')`, [`reels:idea:${ids[0]}`]);
  assert.equal((await readOpenSeeds()).length, MAX_OPEN_SEEDS - 1);
  await addReelSeed({ headline: headline(98), text: PAGE }, { jev });
  await refused(addReelSeed({ headline: headline(97), text: PAGE }, { jev }), 409, /make or archive/);
  await pg.query<any>(`UPDATE reels.sources SET ingest_time = now() - interval '8 days' WHERE headline = $1`, [headline(1)]);
  assert.equal((await readOpenSeeds()).length, MAX_OPEN_SEEDS - 1, 'an expired seed frees its place');
  await pg.query<any>(`INSERT INTO reels.video_jobs (post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ($1, '${NEW_SLATE}', 'ok', now(), 'v.mp4')`, [ids[2]]);
  assert.equal((await readOpenSeeds()).length, MAX_OPEN_SEEDS - 2, 'a made seed frees its place');
});

test('expired and archived seeds are gone from the pool view', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const a = await addReelSeed({ headline: 'Will expire', text: PAGE }, { jev });
  const b = await addReelSeed({ headline: 'Will be archived', text: PAGE }, { jev });
  const ids = async () => ((await pg.query<any>(REEL_IDEAS_SQL)).rows as ReelIdeaRow[]).map((r) => r.post_idea_id);
  assert.ok((await ids()).includes(a.id));
  await pg.query<any>(`UPDATE reels.sources SET ingest_time = now() - interval '8 days' WHERE headline = 'Will expire'`);
  assert.ok(!(await ids()).includes(a.id), 'expired: gone from the view');
  await pg.query<any>(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reels', $1, '2026-10-08', 'archive')`, [`reels:idea:${b.id}`]);
  const ideas = reelIdeas(((await pg.query<any>(REEL_IDEAS_SQL)).rows as ReelIdeaRow[]));
  const adjustments = [{ vertical: 'reels', ideaId: `reels:idea:${b.id}`, kind: 'archive' }] as never;
  assert.ok(!queueOrder(ideas, adjustments).some((q) => q.item.id === `reels:idea:${b.id}`), 'archived: gone from the queue');
});

test('text over the limit is refused with how much to cut, never trimmed, and nothing is spent or written', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  await refused(addReelSeed({ headline: 'Too long', text: 'x'.repeat(MAX_TEXT_CHARS + 25) }, { jev }), 400, /25 characters over/);
  await refused(addReelSeed({ headline: 'h'.repeat(210), text: PAGE }, { jev }), 400, /10 characters over/);
  await refused(addReelSeed({ headline: '   ' }, { jev }), 400, /headline/);
  await refused(addReelSeed({ headline: 'Private link', url: 'http://localhost:3000/x' }, { jev }), 400, /private|look right/);
  await refused(addReelSeed({ headline: 'Bad link', url: 'not a link' }, { jev }), 400, /http/);
  assert.equal(calls.n, 0);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
  const exact = await addReelSeed({ headline: 'Exactly at the limit', text: 'y'.repeat(MAX_TEXT_CHARS) }, { jev });
  const body = (await pg.query<{ body: string }>(`SELECT s.body FROM reels.sources s JOIN reels.post_idea_members m ON m.source_id = s.id WHERE m.post_idea_id = $1`, [exact.id])).rows[0]!.body;
  assert.equal(body.length, MAX_TEXT_CHARS, 'kept whole');
});

test('an unreadable link still adds the idea, with the headline as its text and a note', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const out = await addReelSeed({ headline: 'Behind a paywall', url: 'https://paywalled.test/story' }, { jev, readPage: async () => null });
  assert.equal(out.scored, true);
  assert.ok(out.flags.some((f) => /couldn’t read that page/.test(f)));
  const body = (await pg.query<{ body: string }>(`SELECT body FROM reels.sources WHERE adapter_id = 'seed'`)).rows[0]!.body;
  assert.equal(body, 'Behind a paywall');
  // A readable page with no text of the person's own is used as the idea's text.
  const read = await addReelSeed({ headline: 'A readable page', url: 'https://ok.test/story' }, { jev, readPage: async () => PAGE });
  assert.equal(read.flags.length, 0);
  assert.equal((await pg.query<{ body: string }>(`SELECT s.body FROM reels.sources s JOIN reels.post_idea_members m ON m.source_id = s.id WHERE m.post_idea_id = $1`, [read.id])).rows[0]!.body, PAGE.trim());
});

test('a failed model call keeps the idea, shown “not scored yet”, and a pin on it is refused', async () => {
  const pg = await reelsDb();
  const { jev } = stub({ fail: true });
  const out = await addReelSeed({ headline: 'Model is down', text: PAGE }, { jev });
  assert.deepEqual([out.scored, out.net], [false, null]);
  assert.equal(await count(pg, `reels.idea_scores WHERE post_idea_id = '${out.id}'`), 0);
  const ideas = reelIdeas((await pg.query<any>(REEL_IDEAS_SQL)).rows as ReelIdeaRow[]);
  const mine = ideas.find((i) => i.id === `reels:idea:${out.id}`)!;
  assert.deepEqual([mine.yours, mine.score], [true, null]);
  assert.match(mine.detail ?? '', /Not scored yet/);
  assert.equal(mine.breakdown?.note, 'Not scored yet.');
  assert.equal(await isUnscoredSeed(out.id), true);
  assert.equal(await isUnscoredSeed(NORMAL), false, 'only a seed is guarded');
});

test('no scored night refuses before anything is spent or written', async () => {
  const pg = await reelsDb({ withSlate: false });
  const { jev, calls } = stub();
  await refused(addReelSeed({ headline: 'Nowhere to go', text: PAGE }, { jev }), 409, /Nothing was spent/);
  assert.equal(calls.n, 0);
  assert.equal(await count(pg, 'reels.sources'), 0);
});

test('a double-click returns the first seed and spends nothing more', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const first = await addReelSeed({ headline: 'Clicked twice', text: PAGE }, { jev });
  const again = await addReelSeed({ headline: 'Clicked twice', text: PAGE }, { jev });
  assert.equal(again.id, first.id);
  assert.equal(again.repeat, true);
  assert.equal(calls.n, 2);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});

test('warnings: the same link already in the pool, and a headline close to a recent idea; the seed is added anyway', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const sid = await insertSource({ runId: RUN, canonicalUrl: 'https://wire.test/story', headline: 'Anthropic releases Claude Opus 5.5 with lower prices', body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
  await createPostIdea(sid!, RUN, 'test');
  const out = await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5 with lower prices', text: PAGE, url: 'https://www.wire.test/story?utm_source=x' }, { jev });
  assert.ok(out.flags.some((f) => /already in the pool/.test(f)), out.flags.join('|'));
  assert.ok(out.flags.some((f) => /Close to a recent idea/.test(f)), out.flags.join('|'));
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1, 'added anyway');
});

test('the night’s carryover rule picks up a high-net seed from yesterday’s slate', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const seed = await addReelSeed({ headline: 'Yesterday’s seed', text: PAGE }, { jev });
  const ranked = await loadSlateRanked('2026-10-08');
  assert.ok(ranked.some((r) => r.id === seed.id), 'the seed row is on the slate');
  const misses = carryoverMisses(ranked, heldFromCarryover(ranked));
  assert.ok(misses.some((m) => m.id === seed.id), 'and it is among the misses the next night rescores');
  void pg;
});
