/**
 * Field Notes in intake mode (Central Intake Phase 2, Owner D), offline: PGlite with the hub, media_library,
 * field_notes and intake schemas; the intake reads are stubs (listOrderStories returns in-memory stories, the stored
 * field-notes-score rows live in intake.scores). In 'intake' mode a run never collects or scores: the order's scored
 * stories become candidate tips with the stored score, tags and scorecard version, links already stored are dropped,
 * and selection runs as today. 'stale-fallback', a failed intake read and no intake wiring take the legacy path.
 * `fetch` is replaced for the whole file, so any network call fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { fieldNotesSourceIdOf, storyToCandidate, type FieldNotesIntakeDeps, type FieldNotesIntakeMode } from '@/lib/field-notes/intake';
import { claimRun, requestRun, saveCandidateTip } from '@/lib/field-notes/store';
import type { TipCandidate } from '@/lib/field-notes/sources/candidate';
import { carryOutFieldNotesRun, type CarryOutDeps } from '@/lib/field-notes/worker';
import type { IntakeItem, ScoredStory } from '@/lib/intake/types';
import type { HubQuery } from '@/lib/social-hub/db';

import { addPool, freshDb, NOW, stubEngine, type StubEngine } from './fixtures/field-notes/run/seed';

const realFetch = globalThis.fetch;
let fetchCalls = 0;
let intakeLoaded = false;
before(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network is off in tests');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, 'no test reached the network');
});

/** freshDb plus the intake schema (loaded once into the shared database; its tables emptied per test). */
async function db() {
  const out = await freshDb();
  if (!intakeLoaded) {
    const sql = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
    await out.pg.exec(sql);
    intakeLoaded = true;
  }
  await out.pg.exec(`TRUNCATE intake.scores, intake.stories CASCADE`);
  return out;
}

const BODY = 'Open the settings and switch it on. Type /review after a run.';

function member(o: { key: string; sourceId: string; headline: string; family?: IntakeItem['family'] }): IntakeItem {
  return {
    key: o.key, family: o.family ?? 'field-notes', sourceId: o.sourceId, sourceName: o.sourceId, sourceType: 'A6',
    headline: o.headline, body: BODY, url: o.key, publishTime: new Date('2026-11-01T00:00:00Z'),
    firstSeenAt: NOW, lastSeenAt: NOW, engagement: null, dropReason: null, storyId: null, role: 'primary',
  };
}

type StorySpec = { key: string; sourceId: string; headline: string; score?: number; want?: string };

/** Stories in intake.stories (+ a field-notes-score row when `score` is set), returned as listOrderStories would. */
async function stories(q: HubQuery, specs: StorySpec[]): Promise<ScoredStory[]> {
  const out: ScoredStory[] = [];
  for (const s of specs) {
    const { rows } = await q<{ id: string }>(`INSERT INTO intake.stories (representative_key, headline) VALUES ($1, $2) RETURNING id::text AS id`, [s.key, s.headline]);
    const id = rows[0]!.id;
    if (s.score != null) {
      const result = { kind: 'field-notes-score', score: s.score, tags: { leaf: 'coding_agent_feature', want: s.want ?? 'faster', tier: 'middle', purposes: ['professional'], fresh: true }, answers: { about_ai: 1 } };
      await q(`INSERT INTO intake.scores (story_id, scorecard, version, member_hash, answers, result) VALUES ($1::uuid, 'field-notes-score', 'field-notes-score@3', 'h', '{}'::jsonb, $2::jsonb)`, [id, JSON.stringify(result)]);
    }
    const m = { ...member(s), storyId: id };
    out.push({ id, representativeKey: s.key, headline: s.headline, firstSeenAt: NOW, lastJoinedAt: NOW, mergedInto: null, members: [m], scores: {}, eventDate: m.publishTime, yours: false });
  }
  return out;
}

function intakeDeps(mode: FieldNotesIntakeMode, list: () => Promise<ScoredStory[]>) {
  const calls = { mode: 0, list: 0, args: [] as unknown[] };
  const deps: FieldNotesIntakeDeps = {
    readConsumerMode: async (_q, order) => {
      calls.mode += 1;
      assert.equal(order, 'field-notes');
      return mode;
    },
    listOrderStories: async (_q, order, o) => {
      calls.list += 1;
      calls.args.push({ order, ...o });
      return list();
    },
  };
  return { deps, calls };
}

function worker(query: HubQuery, engine: StubEngine): CarryOutDeps {
  return { query, now: () => NOW, log: () => undefined, engine: async () => engine };
}

async function run(query: HubQuery, engine: StubEngine) {
  await requestRun(query, 'manual', 0.5, { requestedBy: 'tommy', seedTipId: null });
  const r = await carryOutFieldNotesRun(worker(query, engine), (await claimRun(query, NOW))!);
  const row = (await query<{ status: string; record: Record<string, any> }>(`SELECT status, record FROM field_notes.runs WHERE id = $1`, [r.runId])).rows[0]!;
  return { r, row };
}

const SPECS: StorySpec[] = [
  { key: 'https://code.claude.com/docs/en/changelog#review', sourceId: 'claude-code-changelog', headline: 'Alpha review command', score: 0.9, want: 'faster' },
  { key: 'https://developers.openai.com/codex/changelog#plans', sourceId: 'field-notes:codex-changelog', headline: 'Beta plan mode', score: 0.8, want: 'better' },
  { key: 'https://cursor.com/changelog/bugbot', sourceId: 'cursor-changelog', headline: 'Gamma bug finder', score: 0.7, want: 'newly_possible' },
  { key: 'https://github.com/google-gemini/gemini-cli/releases#hooks', sourceId: 'gemini-cli-releases', headline: 'Delta hooks', score: 0.6, want: 'cheaper' },
];

test('intake mode: no collect and no scoring; candidate tips come from the stored scores with the same columns', async () => {
  const { query } = await db();
  await addPool(query, 7);
  // A link already a tip (an earlier run's candidate): dropped, its row untouched.
  const storedKey = 'https://docs.example.com/already';
  const old: TipCandidate = { sourceUrl: storedKey, sourceKind: 'docs', sourceLabel: 'Old', publishedAt: null, item: {} as TipCandidate['item'], untrustedContent: `Old page\n\n${BODY}` };
  await saveCandidateTip(query, old, 0.1, { leaf: 'technique', want: 'stay_current', tier: 'higher', purposes: [], fresh: false, questionSetVersion: 'field-notes-score@3' });
  const list = await stories(query, [
    ...SPECS,
    { key: storedKey, sourceId: 'claude-code-changelog', headline: 'Old page again', score: 0.95 },
    { key: 'https://example.com/not-a-field-notes-source', sourceId: 'reels:A1', headline: 'Not ours', score: 0.99 },
  ]);
  const { deps, calls } = intakeDeps('intake', async () => list);
  const engine = stubEngine(query, { config: { questionsApproved: true }, intake: deps });
  const { r, row } = await run(query, engine);

  assert.equal(r.status, 'ok', r.note);
  assert.equal(engine.collected.calls, 0, 'collect is never called in intake mode');
  assert.equal(engine.jevStub.calls, 0, 'nothing is scored in intake mode');
  assert.equal(calls.list, 1);
  const args = calls.args[0] as { order: string; since: Date; needScores: string[] };
  assert.equal(args.order, 'field-notes');
  assert.deepEqual(args.needScores, ['field-notes-score']);
  assert.equal(NOW.getTime() - args.since.getTime(), 45 * 86_400_000);
  assert.equal(row.record.intake.mode, 'intake');
  assert.deepEqual(
    { stories: row.record.found.stories, scored: row.record.found.scored, unmapped: row.record.found.unmapped, alreadyStored: row.record.found.alreadyStored, added: row.record.found.added },
    { stories: 6, scored: 6, unmapped: 1, alreadyStored: 1, added: 4 },
  );

  const tips = (await query<Record<string, any>>(
    `SELECT source_kind, source_url, source_label, untrusted_content, score, leaf, want, tier, purposes, fresh, score_version, published_at FROM field_notes.tips ORDER BY score DESC`,
  )).rows;
  assert.equal(tips.length, 5, 'four new tips plus the one already stored; the unmapped story is not saved');
  const old2 = tips.find((t) => t.source_url === storedKey)!;
  assert.equal(Number(old2.score), 0.1, 'an already-stored link keeps its own row');
  assert.equal(old2.leaf, 'technique');
  const alpha = tips.find((t) => t.source_url === 'https://code.claude.com/docs/en/changelog#review')!;
  assert.equal(Number(alpha.score), 0.9);
  assert.deepEqual(
    { kind: alpha.source_kind, label: alpha.source_label, leaf: alpha.leaf, want: alpha.want, tier: alpha.tier, purposes: alpha.purposes, fresh: alpha.fresh, version: alpha.score_version },
    { kind: 'docs', label: 'Claude Code changelog', leaf: 'coding_agent_feature', want: 'faster', tier: 'middle', purposes: ['professional'], fresh: true, version: 'field-notes-score@3' },
  );
  assert.equal(alpha.untrusted_content, `Alpha review command\n\n${BODY}`);
  assert.equal(new Date(alpha.published_at).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(tips.find((t) => t.source_url === 'https://cursor.com/changelog/bugbot')!.source_kind, 'rss');
  assert.equal(tips.find((t) => t.source_url === 'https://developers.openai.com/codex/changelog#plans')!.source_label, 'Codex changelog', "a 'field-notes:' prefix maps to the registry id");
  assert.ok(!tips.some((t) => t.source_url === 'https://example.com/not-a-field-notes-source'));
});

test('intake mode with nothing new saves nothing and still selects from stored tips', async () => {
  const { query } = await db();
  await addPool(query, 7);
  const { deps } = intakeDeps('intake', async () => []);
  const engine = stubEngine(query, { config: { questionsApproved: true }, intake: deps });
  const { r, row } = await run(query, engine);
  assert.equal(r.status, 'skipped');
  assert.match(String(r.note), /at least 3 tips/);
  assert.equal(engine.collected.calls, 0);
  assert.equal(row.record.found.added, 0);
});

test('stale-fallback takes the legacy path: collect and score as today, the intake never read', async () => {
  const { query } = await db();
  await addPool(query, 7);
  const { deps, calls } = intakeDeps('stale-fallback', async () => {
    throw new Error('must not be read');
  });
  const found: TipCandidate[] = ['One', 'Two', 'Three'].map((n) => ({ sourceUrl: `https://docs.example.com/${n}`, sourceKind: 'docs', sourceLabel: n, publishedAt: '2026-11-01T00:00:00Z', item: {} as TipCandidate['item'], untrustedContent: `${n} docs\n\n${BODY}` }));
  const engine = stubEngine(query, { config: { questionsApproved: true }, intake: deps, collect: async () => found });
  const { r, row } = await run(query, engine);
  assert.equal(r.status, 'ok', r.note);
  assert.equal(calls.mode, 1);
  assert.equal(calls.list, 0, 'the intake is not read when stale');
  assert.equal(engine.jevStub.calls, 3, 'the legacy path scores what it collected');
  assert.equal(row.record.found.collected, 3);
  assert.deepEqual(row.record.intake, { mode: 'stale-fallback' });
});

test('a failed intake read falls back to the legacy path; no intake wiring is the legacy path with no intake record', async () => {
  const { query } = await db();
  await addPool(query, 7);
  const found = (tag: string): TipCandidate[] => ['One', 'Two', 'Three'].map((n) => ({ sourceUrl: `https://docs.example.com/${tag}-${n}`, sourceKind: 'docs', sourceLabel: n, publishedAt: '2026-11-01T00:00:00Z', item: {} as TipCandidate['item'], untrustedContent: `${tag} ${n} docs\n\n${BODY}` }));
  const { deps } = intakeDeps('intake', async () => {
    throw new Error('intake down');
  });
  const broken = stubEngine(query, { config: { questionsApproved: true }, intake: deps, collect: async () => found('a') });
  const one = await run(query, broken);
  assert.equal(one.r.status, 'ok', one.r.note);
  assert.equal(broken.jevStub.calls, 3);
  assert.equal(one.row.record.intake.mode, 'intake');
  assert.match(one.row.record.intake.fallback, /intake down/);

  const { query: q2 } = await db();
  await addPool(q2, 7);
  const plain = stubEngine(q2, { config: { questionsApproved: true }, collect: async () => found('b') });
  const two = await run(q2, plain);
  assert.equal(two.r.status, 'ok', two.r.note);
  assert.equal(plain.jevStub.calls, 3);
  assert.equal('intake' in two.row.record, false, 'legacy runs keep the same record shape');
});

test('storyToCandidate maps a member back through SOURCE_REGISTRY, field-notes members first', () => {
  const base = { id: 's', representativeKey: 'k', headline: 'h', firstSeenAt: NOW, lastJoinedAt: NOW, mergedInto: null, scores: {}, eventDate: null, yours: false };
  const reelsFirst = member({ key: 'https://github.com/Owner/Repo/tree/main', sourceId: 'gh-mcp-server-topic', headline: 'Repo', family: 'reels' });
  const c = storyToCandidate({ ...base, members: [reelsFirst, member({ key: 'https://cursor.com/changelog/x', sourceId: 'cursor-changelog', headline: 'X' })] });
  assert.equal(c?.sourceUrl, 'https://cursor.com/changelog/x', "a 'field-notes' member wins over a shared one");
  const gh = storyToCandidate({ ...base, members: [reelsFirst] });
  assert.equal(gh?.sourceUrl, 'https://github.com/owner/repo', 'the key in Field Notes canonical form');
  assert.equal(gh?.sourceKind, 'github');
  assert.equal(storyToCandidate({ ...base, members: [member({ key: 'https://x.com/a', sourceId: 'reels:A1', headline: 'A' })] }), null);
  assert.equal(fieldNotesSourceIdOf({ ...member({ key: 'k', sourceId: 'reels:A1', headline: 'A' }), fieldNotesSourceId: 'field-notes:show-hn' } as IntakeItem), 'show-hn');
});

test("storyToCandidate takes published_at from the item's Field Notes metadata, as the legacy collect stored it", () => {
  const base = { id: 's', representativeKey: 'k', headline: 'h', firstSeenAt: NOW, lastJoinedAt: NOW, mergedInto: null, scores: {}, eventDate: null, yours: false };
  const plain = member({ key: 'https://cursor.com/changelog/y', sourceId: 'cursor-changelog', headline: 'Y' });
  const withMeta = { ...plain, fieldNotesMeta: { kind: 'changelog', label: 'Cursor changelog', item: { version: '1.2' }, enrich: null, publishedAt: '2026-10-20T00:00:00.000Z' } } as IntakeItem;
  const c = storyToCandidate({ ...base, members: [withMeta] });
  assert.equal(c?.publishedAt, '2026-10-20T00:00:00.000Z', 'the metadata date, not the item publish_time');
  assert.equal((c?.item as Record<string, unknown> | undefined)?.version, '1.2');
  const noDate = { ...plain, fieldNotesMeta: { kind: 'changelog', label: 'Cursor changelog', item: {}, enrich: null, publishedAt: null } } as IntakeItem;
  assert.equal(storyToCandidate({ ...base, members: [noDate] })?.publishedAt, '2026-11-01T00:00:00.000Z', 'publish_time when the metadata has no date');
  assert.equal(storyToCandidate({ ...base, members: [plain] })?.publishedAt, '2026-11-01T00:00:00.000Z', 'no metadata: publish_time');
});
