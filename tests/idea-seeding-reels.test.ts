/**
 * Idea seeding, Text on Screen (design 2026-10-26-text-on-screen-seeding), offline on PGlite with the real reels and hub
 * schemas and a stubbed Jev transport (no live calls): a typed idea becomes a source and post idea marked 'seed', is scored
 * once and written as one carryover row on the newest slate, is invisible to every grouping read, is listed in the pool as
 * the person's own, and is held to 7 days, 10,000 characters of text, and a refusal before any spend.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { listUngroupedSources, shortlistCandidates, shortlistIdeaMerges, createPostIdea, insertSource } from '@/lib/reels/repository';
import { groupRun } from '@/lib/reels/pipeline/grouping';
import { putOnSlate } from '@/lib/reels/pipeline/promote';
import { carryoverMisses, heldFromCarryover } from '@/lib/reels/scoring/decide';
import { loadSlateRanked } from '@/lib/reels/scoring/store';
import type { SeedCandidate } from '@/lib/reels/seed-search';
import { MAX_TEXT_CHARS, SeedError, addReelSeed, isUnscoredSeed, readOpenSeeds, type ReelSeedOutcome } from '@/lib/reels/seeds';
import { reelIdeas } from '@/lib/social-hub/adapters/reels';
import { REEL_IDEAS_SQL, type ReelIdeaRow } from '@/lib/social-hub/queries/reels';
import { capQueued, queueOrder } from '@/lib/social-hub/queue';

import { NEW_SLATE, NORMAL, OLD_SLATE, PAGE, RUN, reelsDb, stub } from './fixtures/reels-seed';

type Added = Extract<ReelSeedOutcome, { status: 'added' }>;
/** A seed that is expected to be added: fails the test with the outcome if it was stopped instead. */
async function add(input: Parameters<typeof addReelSeed>[0], deps: Parameters<typeof addReelSeed>[1]): Promise<Added> {
  const out = await addReelSeed(input, deps);
  assert.equal(out.status, 'added', JSON.stringify(out));
  return out as Added;
}

const refused = (p: Promise<unknown>, status: number, match: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof SeedError && e.status === status && match.test(e.message));
const count = async (pg: PGlite, sql: string) => Number((await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`)).rows[0]!.n);
// Unrelated headlines: the duplicate check would (rightly) stop a run of near-identical ones.
const TOPICS = ['Quantum chips shrink again', 'Wildfire season starts early', 'Bakery chain files for bankruptcy', 'Rocket lands upright on barge', 'Museum recovers stolen sculpture', 'Transit strike halts commuters', 'Vaccine trial shows promise', 'Chess champion loses to bot', 'Glacier collapse floods valley', 'Retailer recalls baby strollers', 'Solar farm powers whole county', 'Pilot lands plane on highway'];
const headline = (n: number) => TOPICS[n]!;

test('a typed idea is a seed source and idea, scored once (two Jev calls), and written as one carryover row on the newest slate', async () => {
  const pg = await reelsDb();
  const { calls, jev } = stub();
  const slatesBefore = await count(pg, 'reels.score_slates');
  const runsBefore = await count(pg, 'reels.runs');
  const out = await add({ headline: 'Anthropic ships a new model', text: PAGE, url: 'https://news.test/a?utm_source=x' }, { jev, readPage: async () => assert.fail('own text: the page is not read') });
  assert.equal(out.status, 'added');
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
  const out = await add({ headline: 'Seed to pin', text: PAGE }, { jev });
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
  const seed = await add({ headline: title, text: PAGE }, { jev });
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
  const seed = await add({ headline: 'Mine on the newest slate', text: PAGE }, { jev });
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

test('the queue puts a seed where its score falls, not last, though its stored rank is last', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const A = 'a0000000-0000-4000-8000-0000000000a1';
  const B = 'a0000000-0000-4000-8000-0000000000b1';
  await pg.exec(`INSERT INTO reels.post_ideas (id, timely) VALUES ('${A}', false), ('${B}', false);
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, components) VALUES
      ('${NEW_SLATE}', '${A}', 'timely', 3.0, 2, false, 'the_saga', 'arousal', '{}'::jsonb),
      ('${NEW_SLATE}', '${B}', 'timely', 0.8, 3, false, 'the_saga', 'arousal', '{}'::jsonb)`);
  const seed = await add({ headline: 'A seed between the others', text: PAGE }, { jev });
  await pg.query(`UPDATE reels.idea_scores SET net = 2.0 WHERE post_idea_id = $1`, [seed.id]);
  const { rows } = await pg.query<any>(REEL_IDEAS_SQL);
  const stored = (rows as ReelIdeaRow[]).find((r) => String(r.post_idea_id) === seed.id)!;
  assert.equal(Number(stored.rank), 4, 'stored last: the seed row takes max(rank) + 1');
  const shown = queueOrder(reelIdeas(rows as ReelIdeaRow[]), []).map((q) => q.item.id.replace('reels:idea:', ''));
  assert.deepEqual(shown, [A, seed.id, NORMAL, B], 'but the queue sorts by net, so the seed sits between 3.0 and 1.5');
});

test('an 11th open seed is accepted; archiving, making or expiring one still leaves the open list', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const OPEN = 11;
  const ids: string[] = [];
  for (let i = 0; i < OPEN; i++) ids.push((await add({ headline: headline(i), text: PAGE }, { jev })).id);
  assert.equal((await readOpenSeeds()).length, OPEN, 'no cap on open seeds');
  await pg.query<any>(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reels', $1, '2026-10-08', 'archive')`, [`reels:idea:${ids[0]}`]);
  assert.equal((await readOpenSeeds()).length, OPEN - 1);
  await pg.query<any>(`UPDATE reels.sources SET ingest_time = now() - interval '8 days' WHERE headline = $1`, [headline(1)]);
  assert.equal((await readOpenSeeds()).length, OPEN - 2, 'an expired seed leaves the list');
  await pg.query<any>(`INSERT INTO reels.video_jobs (post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ($1, '${NEW_SLATE}', 'ok', now(), 'v.mp4')`, [ids[2]]);
  assert.equal((await readOpenSeeds()).length, OPEN - 3, 'a made seed leaves the list');
});

test('expired and archived seeds are gone from the pool view', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const a = await add({ headline: 'Will expire', text: PAGE }, { jev });
  const b = await add({ headline: 'Will be archived', text: PAGE }, { jev });
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
  const exact = await add({ headline: 'Exactly at the limit', text: 'y'.repeat(MAX_TEXT_CHARS) }, { jev });
  const body = (await pg.query<{ body: string }>(`SELECT s.body FROM reels.sources s JOIN reels.post_idea_members m ON m.source_id = s.id WHERE m.post_idea_id = $1`, [exact.id])).rows[0]!.body;
  assert.equal(body.length, MAX_TEXT_CHARS, 'kept whole');
});

// Searches are always stubbed in these tests: nothing here may reach the network.
const NO_SEARCH = { collected: async () => [], news: async () => [] };
const story = (url: string, title: string, source: SeedCandidate['source'] = 'collected'): SeedCandidate => ({ url, headline: title, body: PAGE, outlet: 'Wire', source });

test('a readable link with no text of the person’s own is used as the idea’s text, and nothing is searched', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const search = { collected: async () => assert.fail('no search when the page reads'), news: async () => assert.fail('no search when the page reads') };
  const read = await add({ headline: 'A readable page', url: 'https://ok.test/story' }, { jev, readPage: async () => PAGE, search });
  assert.equal(read.flags.length, 0);
  assert.equal(read.substitute, undefined);
  assert.equal((await pg.query<{ body: string }>(`SELECT s.body FROM reels.sources s JOIN reels.post_idea_members m ON m.source_id = s.id WHERE m.post_idea_id = $1`, [read.id])).rows[0]!.body, PAGE.trim());
});

test('a headline with no link builds from the best related collected story, with that story’s link and text', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const search = {
    collected: async () => [story('https://wire.test/opus', 'Anthropic releases Claude Opus 5.5 with lower prices')],
    news: async () => assert.fail('collected stories answered; Google News is not asked'),
  };
  const out = await add({ headline: 'Anthropic releases Claude Opus 5.5' }, { jev, search });
  assert.deepEqual(out.substitute, { url: 'https://wire.test/opus', title: 'Anthropic releases Claude Opus 5.5 with lower prices', why: 'headline_only' });
  assert.ok(out.flags.some((f) => /found from your headline/.test(f)), out.flags.join('|'));
  const src = (await pg.query<any>(`SELECT canonical_url, headline, body FROM reels.sources WHERE adapter_id = 'seed'`)).rows;
  assert.deepEqual(src, [{ canonical_url: 'https://wire.test/opus', headline: 'Anthropic releases Claude Opus 5.5', body: PAGE.trim() }], 'your headline, the story’s link and text');
  assert.equal(calls.n, 2, 'the winner’s score is the idea’s score: no second scoring');
  assert.equal(await count(pg, `reels.idea_scores WHERE post_idea_id = '${out.id}'`), 1);
});

test('collected stories first, then Google News: the news tier answers when nothing collected is related', async () => {
  await reelsDb();
  const { jev } = stub();
  const search = { collected: async () => [story('https://x.test/a', 'Local bakery wins regional award')], news: async () => [story('https://publisher.test/n', 'Anthropic releases Claude Opus 5.5 - The Verge', 'news')] };
  const out = await add({ headline: 'Anthropic releases Claude Opus 5.5' }, { jev, search });
  assert.equal(out.substitute?.url, 'https://publisher.test/n');
});

test('nothing related anywhere adds nothing and spends nothing', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const out = await addReelSeed({ headline: 'Bitcoin' }, { jev, search: { ...NO_SEARCH, collected: async () => [story('https://x.test/a', 'Local bakery wins regional award')] } });
  assert.deepEqual(out, { status: 'no_match', reason: 'nothing_found' });
  assert.equal(calls.n, 0);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
});

test('an unreadable link searches for the story; the idea says the link could not be read and which story it used', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const search = { ...NO_SEARCH, news: async () => [story('https://publisher.test/n', 'Behind a paywall: the full story', 'news')] };
  const out = await add({ headline: 'Behind a paywall', url: 'https://paywalled.test/story' }, { jev, readPage: async () => null, search });
  assert.equal(out.substitute?.why, 'link_unreadable');
  assert.ok(out.flags.some((f) => /couldn’t read your link/.test(f) && /Behind a paywall: the full story/.test(f)), out.flags.join('|'));
  assert.equal((await pg.query<any>(`SELECT canonical_url FROM reels.sources WHERE adapter_id = 'seed'`)).rows[0].canonical_url, 'https://publisher.test/n');
});

test('an unreadable link and no related story adds nothing, and says the link was the problem', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const out = await addReelSeed({ headline: 'Behind a paywall', url: 'https://paywalled.test/story' }, { jev, readPage: async () => null, search: NO_SEARCH });
  assert.deepEqual(out, { status: 'no_match', reason: 'nothing_found', linkUnreadable: true });
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
});

test('a substitute story already in the queue stops as a duplicate', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const existing = await ordinaryIdea(pg, { url: 'https://wire.test/opus', headline: 'Anthropic releases Claude Opus 5.5 with lower prices', queued: true });
  const out = await addReelSeed({ headline: 'Opus 5.5 is out' }, { jev, search: { ...NO_SEARCH, collected: async () => [story('https://www.wire.test/opus?utm_source=x', 'Claude Opus 5.5 is out from Anthropic')] } });
  assert.equal(out.status, 'duplicate');
  assert.equal(out.status === 'duplicate' && out.existing.id, existing);
});

test('every candidate failing to score adds nothing and says scoring was unavailable', async () => {
  const pg = await reelsDb();
  const { jev } = stub({ fail: true });
  const out = await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5' }, { jev, search: { ...NO_SEARCH, collected: async () => [story('https://wire.test/opus', 'Anthropic releases Claude Opus 5.5 with lower prices')] } });
  assert.deepEqual(out, { status: 'no_match', reason: 'scoring_unavailable' });
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
});

const paid = (run: () => Promise<{ candidates: SeedCandidate[]; usd: number }>, approved = true) => {
  const spent = { n: 0 };
  return { spent, paid: { approved: () => approved, run: async () => { spent.n += 1; return run(); } } };
};

test('paid search: not approved means nothing is spent and nothing is offered', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const { spent, paid: p } = paid(async () => ({ candidates: [], usd: 0 }), false);
  const out = await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5', confirmPaid: true }, { jev, search: NO_SEARCH, paid: p });
  assert.deepEqual(out, { status: 'no_match', reason: 'nothing_found' });
  assert.equal(spent.n, 0);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
});

test('paid search: approved but not confirmed offers the estimate and spends nothing', async () => {
  await reelsDb();
  const { jev } = stub();
  const { spent, paid: p } = paid(async () => ({ candidates: [], usd: 0 }));
  const out = await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5' }, { jev, search: NO_SEARCH, paid: p });
  assert.deepEqual(out, { status: 'needs_paid_confirm', estimateUsd: 0.1, maxUsd: 0.15 });
  assert.equal(spent.n, 0);
});

test('paid search: confirmed, it runs once, builds the idea from the best article, and a repeated confirm adds nothing more', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const { spent, paid: p } = paid(async () => ({ candidates: [story('https://publisher.test/n', 'Anthropic releases Claude Opus 5.5 - Verge', 'web')], usd: 0.07 }));
  const input = { headline: 'Anthropic releases Claude Opus 5.5', confirmPaid: true };
  const out = await add(input, { jev, search: NO_SEARCH, paid: p });
  assert.equal(out.substitute?.url, 'https://publisher.test/n');
  const again = await add(input, { jev, search: NO_SEARCH, paid: p });
  assert.equal(again.repeat, true);
  assert.equal(spent.n, 1, 'one paid search in total');
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});

test('paid search: a free tier that answers means the paid tier is never offered', async () => {
  await reelsDb();
  const { jev } = stub();
  const { spent, paid: p } = paid(async () => ({ candidates: [], usd: 0 }));
  const out = await add({ headline: 'Anthropic releases Claude Opus 5.5' }, { jev, search: { ...NO_SEARCH, collected: async () => [story('https://wire.test/opus', 'Anthropic releases Claude Opus 5.5 with lower prices')] }, paid: p });
  assert.equal(out.substitute?.why, 'headline_only');
  assert.equal(spent.n, 0);
});

test('paid search: a search that fails or finds nothing related adds nothing', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const boom = paid(async () => { throw new Error('529 overloaded'); });
  assert.deepEqual(await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5', confirmPaid: true }, { jev, search: NO_SEARCH, paid: boom.paid }), { status: 'no_match', reason: 'nothing_found' });
  const unrelated = paid(async () => ({ candidates: [story('https://x.test/a', 'Local bakery wins regional award', 'web')], usd: 0.05 }));
  assert.deepEqual(await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5', confirmPaid: true }, { jev, search: NO_SEARCH, paid: unrelated.paid }), { status: 'no_match', reason: 'nothing_found' });
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0);
});

test('a failed model call keeps the idea, shown “not scored yet”, and a pin on it is refused', async () => {
  const pg = await reelsDb();
  const { jev } = stub({ fail: true });
  const out = await add({ headline: 'Model is down', text: PAGE }, { jev });
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
  const first = await add({ headline: 'Clicked twice', text: PAGE }, { jev });
  const again = await add({ headline: 'Clicked twice', text: PAGE }, { jev });
  assert.equal(again.id, first.id);
  assert.equal(again.repeat, true);
  assert.equal(calls.n, 2);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});

/** An ordinary idea from a source; `queued` puts it on the newest slate (the queue), otherwise it is only in the reference pool. */
async function ordinaryIdea(pg: PGlite, input: { url: string; headline: string; net?: number; queued: boolean }): Promise<string> {
  const sid = await insertSource({ runId: RUN, canonicalUrl: input.url, headline: input.headline, body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
  const id = await createPostIdea(sid!, RUN, 'test');
  if (input.queued) {
    await pg.query(`INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, components) VALUES ($1, $2, 'timely', $3, 9, false, 'the_saga', 'arousal', '{}'::jsonb)`, [NEW_SLATE, id, input.net ?? 1]);
  }
  return id;
}

test('a link already in the queue stops with the existing idea and spends nothing', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const existing = await ordinaryIdea(pg, { url: 'https://wire.test/story', headline: 'Wire story about a model launch', net: 2.5, queued: true });
  const out = await addReelSeed({ headline: 'My own words about cats', text: PAGE, url: 'https://www.wire.test/story?utm_source=x' }, { jev });
  assert.equal(out.status, 'duplicate');
  if (out.status !== 'duplicate') return;
  assert.deepEqual(out.existing, { id: existing, headline: 'Wire story about a model launch', net: 2.5, yours: false });
  assert.equal(calls.n, 0, 'nothing spent');
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0, 'nothing written');
});

test('a headline close to a queued idea stops the same way', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const existing = await ordinaryIdea(pg, { url: 'https://wire.test/story', headline: 'Anthropic releases Claude Opus 5.5 with lower prices', queued: true });
  const out = await addReelSeed({ headline: 'Anthropic releases Claude Opus 5.5 with lower prices', text: PAGE, url: 'https://other.test/same-story' }, { jev });
  assert.equal(out.status, 'duplicate');
  assert.equal(out.status === 'duplicate' && out.existing.id, existing);
});

test('a seed already waiting counts as in the queue, and is marked yours', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const first = await add({ headline: 'First words', text: PAGE, url: 'https://news.test/a' }, { jev });
  const out = await addReelSeed({ headline: 'Other words entirely about dogs', text: PAGE, url: 'https://news.test/a?utm_medium=y' }, { jev });
  assert.equal(out.status, 'duplicate');
  assert.deepEqual(out.status === 'duplicate' && [out.existing.id, out.existing.yours], [first.id, true]);
});

test('an idea only in the reference pool, not on the slate, is not in the queue', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  await ordinaryIdea(pg, { url: 'https://wire.test/story', headline: 'Anthropic releases Claude Opus 5.5 with lower prices', queued: false });
  const out = await add({ headline: 'Anthropic releases Claude Opus 5.5 with lower prices', text: PAGE, url: 'https://wire.test/story' }, { jev });
  assert.equal(out.status, 'added');
});

test('seedAnyway adds it after a duplicate stop', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  await ordinaryIdea(pg, { url: 'https://wire.test/story', headline: 'Wire story about a model launch', queued: true });
  const input = { headline: 'My own words about cats', text: PAGE, url: 'https://wire.test/story' };
  assert.equal((await addReelSeed(input, { jev })).status, 'duplicate');
  assert.equal((await addReelSeed({ ...input, seedAnyway: true }, { jev })).status, 'added');
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});

test('the night’s carryover rule never picks up a seed, however high its net', async () => {
  const pg = await reelsDb();
  const { jev } = stub();
  const seed = await add({ headline: 'Yesterday’s seed', text: PAGE }, { jev });
  await pg.query(`UPDATE reels.idea_scores SET net = 9 WHERE post_idea_id = $1`, [seed.id]);
  const ranked = await loadSlateRanked('2026-10-08');
  assert.ok(!ranked.some((r) => r.id === seed.id), 'the night does not read the seed row');
  const misses = carryoverMisses(ranked, heldFromCarryover(ranked));
  assert.ok(!misses.some((m) => m.id === seed.id), 'so it is never among the misses the next night rescores');
  assert.ok(ranked.some((r) => r.id === NORMAL), 'an ordinary idea on the same slate is still read');
});
