/**
 * The Field Notes orchestration core, offline (contract v2: one post from 3-4 tips, one tip per slide): PGlite with the
 * real hub, media_library and field_notes schemas; a stub Claude client, stub Jev transport and a stub render (the real
 * planner, no browser, a stub face detector). Seeded tips run end to end and a seeded tip goes first; scoring refuses
 * without approval; fewer than three supported tips ends the run insufficient_source; the cap stops a run; the
 * pending-drafts limit and the photo rest rule hold; the cover is always a people photo; nothing is booked or posted
 * while publishing is off. `fetch` is replaced for the whole file, so any unplanned network call fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';

import { createFieldNotesBudget, FieldNotesBudgetExhausted } from '@/lib/field-notes/budget';
import { buildFieldNotesCaption, CAPTION_MAX_CHARS, FIELD_NOTES_FOLLOW_LINE, parseHowToTry } from '@/lib/field-notes/caption';
import { firstFieldNotesCheckAt, nextFieldNotesRunAt, noonQueue } from '@/lib/field-notes/clock';
import { FIELD_NOTES_SLIDE_PREFIX } from '@/lib/field-notes/config';
import { queueManualFieldNotesRun } from '@/lib/field-notes/manual';
import { checkPhotoPool, MAX_PER_KIND, pickPostPhotos, pickReplacement } from '@/lib/field-notes/photos/pool';
import { draftToSlideInputs, splitProblems } from '@/lib/field-notes/post';
import { claimAndPublishFieldNotes, queueFieldNotesPublish } from '@/lib/field-notes/publish';
import { FOLLOW_HAND_TEXT } from '@/lib/field-notes/render/layout';
import { runFieldNotes } from '@/lib/field-notes/run';
import { approveFieldNotesPost, hardPublishFieldNotesPost, rejectFieldNotesPost } from '@/lib/field-notes/schedule';
import { parseFieldNotesSettings, readFieldNotesSettings } from '@/lib/field-notes/settings';
import { claimRun, expireOldTips, getPost, getTip, insertPost, listSelectableTips, nextPostSeq, pendingDraftCount, recentPostWants, requestRun, saveCandidateTip, saveSeededLink, scheduledRunToday, setTipContent } from '@/lib/field-notes/store';
import type { TipTags } from '@/lib/field-notes/sources/score';
import { tipToCandidate } from '@/lib/field-notes/run';
import type { Want } from '@/lib/field-notes/types';
import type { TipCandidate } from '@/lib/field-notes/sources/candidate';
import type { PhotoKind, PoolPhoto } from '@/lib/field-notes/types';
import { carryOutFieldNotesRun, type CarryOutDeps } from '@/lib/field-notes/worker';
import type { HubQuery } from '@/lib/social-hub/db';
import type { FieldNotesEngineDeps } from '@/lib/field-notes/run';

import { addPool, CANNED_CAPTION, CANNED_SLIDES, FACELESS_PHOTOS, freshDb, masterPathOf, NOW, photoBytes, setKind, setSetting, stubClaude, stubEngine, stubJev, supportedClaimsFor, type StubEngine } from './fixtures/field-notes/run/seed';

// Rule 1: no network of any kind. The injected clients are the only transports.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
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

function worker(query: HubQuery, engine: StubEngine, over: Partial<CarryOutDeps> = {}) {
  const logs: string[] = [];
  const w: CarryOutDeps = { query, now: () => NOW, log: (m) => void logs.push(m), engine: async () => engine, ...over };
  return { w, logs };
}

async function claim(q: HubQuery, seedTipId: string | null = null) {
  await requestRun(q, 'manual', 0.5, { requestedBy: 'tommy', seedTipId });
  return (await claimRun(q, NOW))!;
}

/** One seed through the seed API's write (store.saveSeededLink), with page text as if the run had fetched it. */
async function seed(q: HubQuery, url = 'https://docs.example.com/review-option', o: { subject?: string; want?: Want } = {}) {
  const out = await saveSeededLink(q, { sourceUrl: url, sourceLabel: 'docs.example.com', subject: o.subject ?? url, leaf: 'coding_agent_feature', want: o.want ?? 'faster', useWithResult: '', seededBy: 'tommy' });
  assert.equal(out.kind, 'created');
  await setTipContent(q, out.tipId, 'Open the settings page, find the review option and switch it on. Type /review after a run to get a second pass.');
  return out.tipId;
}

/** The wants seedSet hands out in turn, so a set of up to 4 seeds never trips the two-per-want rule. */
const SEED_WANTS: Want[] = ['faster', 'better', 'newly_possible', 'cheaper'];

/** `n` seeded tips (distinct links, subjects and wants in turn), oldest first; the first is the one a Generate click names. */
async function seedSet(q: HubQuery, n = 3, tag = 'a'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await seed(q, `https://docs.example.com/${tag}-${i}`, { subject: `${tag} subject ${i}`, want: SEED_WANTS[i % SEED_WANTS.length] });
    // Staggered so "oldest first" never depends on a clock tick.
    await q(`UPDATE field_notes.tips SET created_at = created_at - make_interval(secs => $2::int) WHERE id = $1`, [id, (n - i) * 10]);
    ids.push(id);
  }
  return ids;
}

type PostRow = { id: string; seq: number; status: string; slides: Array<{ kind: string; photoId: string; blocks: Array<{ role: string; text: string }> }>; photo_ids: string[]; caption: string; slide_objects: string[]; tip_id: string; tip_ids: string[]; fit_problems: string[]; soft_notes: string[] };
const posts = async (q: HubQuery) => (await q<PostRow>(`SELECT id::text AS id, seq, status, slides, photo_ids::text[] AS photo_ids, caption, slide_objects, tip_id::text AS tip_id, tip_ids::text[] AS tip_ids, fit_problems, soft_notes FROM field_notes.posts ORDER BY seq`)).rows;
const runRow = async (q: HubQuery, id: string) =>
  (await q<{ status: string; stop_reason: string | null; error: string | null; claude_usd: number; jev_usd: number; total_usd: number; record: Record<string, any> }>(
    `SELECT status, stop_reason, error, claude_usd, jev_usd, total_usd, record FROM field_notes.runs WHERE id = $1`, [id])).rows[0]!;
const tipStatus = async (q: HubQuery, id: string) => (await q<{ status: string }>(`SELECT status FROM field_notes.tips WHERE id = $1`, [id])).rows[0]!.status;
const kindsOf = async (q: HubQuery) => new Map((await q<{ photo_id: string; kind: string }>(`SELECT photo_id::text AS photo_id, kind FROM field_notes.pool`)).rows.map((x) => [x.photo_id, x.kind]));
/** A found candidate; its title (the first line, selection's subject key) is `title`, by default its source label. */
// The body names none of the canned headlines, so a drafted headline never blocks a later run's candidates by itself.
const candidate = (url: string, label: string, publishedAt = '2026-11-01T00:00:00Z', title = label): TipCandidate => ({ sourceUrl: url, sourceKind: 'docs', sourceLabel: label, publishedAt, item: {} as TipCandidate['item'], untrustedContent: `${title}\n\nOpen the settings and switch it on. Type /review after a run.` });

/**
 * Test-only: a score and tags written onto an existing row (the shape a scorer would give). The engine has no such
 * update (CLAUDE.md Rule 2: a found tip is saved with its score and tags in one insert); a seed keeps the seeder's leaf and want.
 */
async function tagRow(q: HubQuery, id: string, score: number, tags: TipTags) {
  await q(
    `UPDATE field_notes.tips SET score = $2,
            leaf = CASE WHEN source_kind = 'seed' AND leaf IS NOT NULL THEN leaf ELSE $3 END,
            want = CASE WHEN source_kind = 'seed' AND want IS NOT NULL THEN want ELSE $4 END,
            tier = $5, purposes = $6::text[], fresh = $7
      WHERE id = $1`,
    [id, score, tags.leaf, tags.want, tags.tier, tags.purposes, tags.fresh],
  );
}

// ── the run ─────────────────────────────────────────────────────────────────

test('a seeded run is one post: a cover, one tip slide per tip, Follow; every tip drafted; no photo repeats; spend recorded', async () => {
  const { query } = await freshDb();
  const photoIds = await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query);
  const { w } = worker(query, engine);
  const r = await carryOutFieldNotesRun(w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);

  const [post] = await posts(query);
  assert.ok(post);
  assert.equal(post.status, 'review');
  assert.deepEqual(post.slides.map((s) => s.kind), ['cover', 'tip', 'tip', 'tip', 'follow'], '5 slides for 3 tips');
  assert.deepEqual(post.tip_ids, tipIds, 'every tip, in slide order');
  assert.equal(post.tip_id, tipIds[0], 'tip_id stays the first tip');
  assert.deepEqual(engine.claudeStub.tipIds, [tipIds.map((_, i) => `tip-${i + 1}`)], 'one Writer call carried all three tips (as short labels)');
  const cover = post.slides[0]!;
  assert.deepEqual(cover.blocks.map((b) => [b.role, b.text]), [['hand', 'field notes'], ['headline', "3 AI hacks we've seen this week"]], 'the cover is code-written (CONTRACT-v4 section 6)');
  assert.deepEqual(post.slides.slice(1, 4).map((s) => s.blocks.find((b) => b.role === 'headline')!.text), CANNED_SLIDES.slice(0, 3).map((x) => x.headline));
  // Follow: one code-written hand line and the handle.
  assert.deepEqual(post.slides.at(-1)!.blocks.map((b) => b.text), [FOLLOW_HAND_TEXT, '@heliosgroup.ai']);
  assert.equal(post.slides.at(-1)!.blocks[0]!.role, 'hand');
  assert.equal(new Set(post.photo_ids).size, post.photo_ids.length, 'no photo twice in a post');
  assert.deepEqual(post.slides.map((s) => s.photoId), post.photo_ids);
  // Photos: the people photo is the cover; Follow's calm photo (the newest scenery) is reserved before the tip slides,
  // which then vary without a neighbour of Follow's kind (Tommy, 2026-11-08).
  const kinds = await kindsOf(query);
  assert.deepEqual(post.photo_ids.map((id) => kinds.get(id)), ['people', 'working', 'event', 'working', 'scenery']);
  assert.deepEqual(post.photo_ids, [photoIds[0], photoIds[4], photoIds[3], photoIds[1], photoIds[5]]);
  // Storage, caption.
  assert.equal(post.slide_objects.length, 5);
  assert.ok(post.slide_objects.every((p) => p.startsWith(`${FIELD_NOTES_SLIDE_PREFIX}/`) && engine.uploaded.has(p)));
  assert.ok(post.caption.includes(CANNED_CAPTION) && post.caption.includes(FIELD_NOTES_FOLLOW_LINE) && post.caption.length <= CAPTION_MAX_CHARS);
  // The photos rest, the tips are drafted, the post is on the spine, nothing is approved or booked.
  const pool = (await query<{ photo_id: string; status: string; last_used_post_seq: number | null }>(`SELECT photo_id::text AS photo_id, status, last_used_post_seq FROM field_notes.pool`)).rows;
  for (const id of post.photo_ids) assert.deepEqual({ s: pool.find((p) => p.photo_id === id)!.status, q: pool.find((p) => p.photo_id === id)!.last_used_post_seq }, { s: 'resting', q: post.seq });
  assert.equal(pool.find((p) => p.photo_id === photoIds[2])!.status, 'live');
  for (const id of tipIds) assert.equal(await tipStatus(query, id), 'drafted');
  assert.equal((await query(`SELECT 1 FROM social_hub.content_items WHERE vertical = 'field_notes' AND native_ref = $1`, [post.id])).rows.length, 1);
  assert.equal((await query(`SELECT 1 FROM social_hub.approvals`)).rows.length, 0);
  assert.equal((await query(`SELECT 1 FROM social_hub.schedule`)).rows.length, 0);
  // Cost: Writer and Editor only, one Writer call for all the tips, recorded on the run and priced.
  assert.deepEqual(engine.claudeStub.calls, ['submit_field_note', 'submit_cut_field_note']);
  assert.equal(engine.jevStub.calls, 0);
  assert.equal(engine.collected.calls, 0, 'scoring is not approved: nothing new is found or scored');
  const row = await runRow(query, r.runId);
  assert.equal(row.status, 'ok');
  assert.ok(row.claude_usd > 0 && row.jev_usd === 0);
  assert.ok(Math.abs(row.total_usd - (row.claude_usd + row.jev_usd)) < 1e-12);
  assert.equal(row.record.spend.calls.length, 2);
  assert.deepEqual(row.record.tipIds, tipIds);
});

test('six tips (TIP_SLIDES_MAX): eight photos make one post of cover + 6 tip slides + Follow, with six how-to-try lines', async () => {
  const { query } = await freshDb();
  await addPool(query, 8);
  const tipIds = await seedSet(query, 6);
  const engine = stubEngine(query);
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.deepEqual(post!.slides.map((s) => s.kind), ['cover', 'tip', 'tip', 'tip', 'tip', 'tip', 'tip', 'follow']);
  assert.deepEqual(post!.tip_ids, tipIds, 'every tip, in slide order');
  assert.deepEqual(engine.claudeStub.tipIds, [tipIds.map((_, i) => `tip-${i + 1}`)], 'one Writer call carried all six tips');
  assert.equal(post!.slides[0]!.blocks.find((b) => b.role === 'headline')!.text, "6 AI hacks we've seen this week");
  assert.equal(new Set(post!.photo_ids).size, 8, 'eight different photos');
  assert.equal(post!.slide_objects.length, 8);
  assert.deepEqual(parseHowToTry(post!.caption).map((l) => l.name), CANNED_SLIDES.map((x) => x.name));
  assert.ok(post!.caption.length <= CAPTION_MAX_CHARS);
  // Seven photos for the same six seeds: five tips (photo-capped); the sixth seed waits for a later post.
  const again = await freshDb();
  await addPool(again.query, 7);
  const ids7 = await seedSet(again.query, 6, 'b');
  const r7 = await carryOutFieldNotesRun(worker(again.query, stubEngine(again.query)).w, await claim(again.query, ids7[0]));
  assert.equal(r7.status, 'ok', r7.note);
  const [post7] = await posts(again.query);
  assert.deepEqual(post7!.tip_ids, ids7.slice(0, 5));
  assert.equal(await tipStatus(again.query, ids7[5]!), 'candidate');
  assert.deepEqual((await runRow(again.query, r7.runId)).record.seedsWaiting, [ids7[5]]);
});

test('a seeded tip goes first and, with scoring approved, the post fills with scored candidates of DISTINCT subjects', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const [seedId] = await seedSet(query, 1);
  const found = [
    candidate('https://docs.example.com/a', 'Alpha docs', '2026-11-03T00:00:00Z'),
    candidate('https://docs.example.com/b', 'Alpha docs', '2026-11-02T00:00:00Z'), // same subject as the one above
    candidate('https://docs.example.com/c', 'Beta docs', '2026-11-01T00:00:00Z'),
    candidate('https://docs.example.com/d', 'Gamma docs', '2026-10-31T00:00:00Z'),
    candidate('https://docs.example.com/e', 'Delta docs', '2026-10-30T00:00:00Z'),
  ];
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, seedId));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.equal(post!.tip_ids.length, 5, 'seven photos: cover + 5 tip slides + Follow (the photo-capped size, under TIP_SLIDES_MAX)');
  assert.equal(post!.tip_ids[0], seedId, 'the seeded tip is first');
  const subjects = (await query<{ id: string; subject: string; source_label: string; status: string }>(`SELECT id::text AS id, subject, source_label, status FROM field_notes.tips`)).rows;
  // The candidates' titles are their labels here, so the label shows which subject each one stood for.
  const used = post!.tip_ids.slice(1).map((id) => subjects.find((t) => t.id === id)!.source_label);
  assert.equal(new Set(used).size, 4, `distinct subjects: ${used.join(', ')}`);
  // Each drafted tip's subject is now its slide's headline.
  assert.deepEqual(post!.tip_ids.map((id) => subjects.find((t) => t.id === id)!.subject), CANNED_SLIDES.slice(0, 5).map((x) => x.name));
  assert.ok(used.every((x) => ['Alpha docs', 'Beta docs', 'Gamma docs', 'Delta docs'].includes(x)));
  assert.ok(used.filter((x) => x === 'Alpha docs').length <= 1, 'the two Alpha pages never share a post');
  assert.equal(engine.jevStub.calls, 5, 'only the five newly found candidates were scored');
  assert.equal(subjects.filter((t) => t.status === 'drafted').length, 5);
  assert.equal(subjects.filter((t) => t.status === 'candidate').length, 1, 'the duplicate subject stays a candidate');
});

test('an unseeded run with no approved scoring stops with a clear reason, scores nothing and spends nothing', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const engine = stubEngine(query, { config: { questionsApproved: false } });
  const { w } = worker(query, engine);
  const r = await carryOutFieldNotesRun(w, await claim(query));
  assert.equal(r.status, 'skipped');
  const row = await runRow(query, r.runId);
  assert.equal(row.status, 'skipped');
  assert.match(row.stop_reason ?? '', /^scoring-not-approved: .*Lucas/);
  assert.equal(engine.jevStub.calls, 0);
  assert.equal(engine.claudeStub.calls.length, 0);
  assert.equal(engine.collected.calls, 0);
  assert.equal(row.total_usd, 0);
  assert.equal((await posts(query)).length, 0);
});

test('fewer than three tips available: the run stops before any paid call and the seeded tip is untouched', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const [one] = await seedSet(query, 2);
  const engine = stubEngine(query);
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, one));
  assert.equal(r.status, 'skipped');
  const row = await runRow(query, r.runId);
  assert.match(row.stop_reason ?? '', /^no-tip: a post needs at least 3 tips/);
  assert.equal(engine.claudeStub.calls.length, 0);
  assert.equal(row.total_usd, 0);
  assert.equal(await tipStatus(query, one!), 'candidate');
  assert.equal((await posts(query)).length, 0);
});

test('with approved scoring, an unseeded run finds, scores and picks three or four tips (Jev under the cap)', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const engine = stubEngine(query, {
    config: { questionsApproved: true },
    collect: async () => [candidate('https://docs.example.com/one', 'One docs'), candidate('https://docs.example.com/two', 'Two docs'), candidate('https://docs.example.com/three', 'Three docs')],
  });
  // A posted tip and an old rejected one already exist: the run must leave them alone (Rule 2).
  const posted = await query<{ id: string }>(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result, status, score) VALUES ('docs', 'https://docs.example.com/old', 's', 'u', 'posted', 0.99) RETURNING id::text AS id`);
  const { w } = worker(query, engine);
  const r = await carryOutFieldNotesRun(w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  const row = await runRow(query, r.runId);
  const dupeAsked = (row.record.dupeCheck?.asked as number | undefined) ?? 0;
  assert.equal(engine.jevStub.calls - dupeAsked, 3, 'only the three newly found candidates were scored (duplicate-check questions counted apart)');
  assert.ok(row.jev_usd > 0 && row.claude_usd > 0);
  assert.equal(row.record.found.added, 3);
  const tips = (await query<{ source_url: string; status: string }>(`SELECT source_url, status FROM field_notes.tips ORDER BY source_url`)).rows;
  assert.equal(tips.filter((t) => t.status === 'drafted').length, 3);
  assert.equal(await tipStatus(query, posted.rows[0]!.id), 'posted');
  assert.equal((await posts(query)).length, 1);
  assert.equal((await posts(query))[0]!.tip_ids.length, 3);

  // Two candidates only: scored (that is paid), but the run stops before the Writer.
  const { query: q2 } = await freshDb();
  await addPool(q2, 6);
  const two = stubEngine(q2, { config: { questionsApproved: true }, collect: async () => [candidate('https://docs.example.com/x', 'X docs'), candidate('https://docs.example.com/y', 'Y docs')] });
  const r2 = await carryOutFieldNotesRun(worker(q2, two).w, await claim(q2));
  assert.equal(r2.status, 'skipped');
  assert.match((await runRow(q2, r2.runId)).stop_reason ?? '', /^no-tip:/);
  assert.equal(two.claudeStub.calls.length, 0);
});

test('insufficient source: no draft, spend recorded; the skipped tips are rejected, the supported ones count an attempt', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 4);
  const engine = stubEngine(query, { claudeStub: stubClaude({ supported: 2 }) });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'skipped');
  const row = await runRow(query, r.runId);
  assert.match(row.stop_reason ?? '', /^insufficient_source:/);
  assert.deepEqual(engine.claudeStub.calls, ['submit_field_note'], 'the Editor is never paid for a draft that does not exist');
  assert.ok(row.claude_usd > 0 && row.total_usd === row.claude_usd, 'the Writer call is on the run');
  assert.equal(row.record.insufficientSource.supported, 2);
  assert.equal((await posts(query)).length, 0);
  assert.equal(engine.uploaded.size, 0);
  const after = (await query<{ id: string; status: string; attempts: number; reject_reason: string | null }>(`SELECT id::text AS id, status, attempts, reject_reason FROM field_notes.tips`)).rows;
  const of = (id: string) => after.find((t) => t.id === id)!;
  for (const id of tipIds.slice(0, 2)) assert.deepEqual([of(id).status, of(id).attempts], ['candidate', 1], 'supported: one attempt, still waiting');
  for (const id of tipIds.slice(2)) assert.deepEqual([of(id).status, of(id).attempts], ['rejected', 0], 'skipped by the Writer: set aside');
  assert.match(of(tipIds[2]!).reject_reason ?? '', /^writer-skipped: /);
  assert.equal((await query(`SELECT 1 FROM field_notes.pool WHERE status <> 'live'`)).rows.length, 0, 'photos untouched');
});

test('a skipped tip gets no slide and is rejected (never paid for again); the three supported tips are drafted', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 4);
  const engine = stubEngine(query, { claudeStub: stubClaude({ supported: 3 }) });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.deepEqual(post!.tip_ids, tipIds.slice(0, 3));
  assert.deepEqual(post!.slides.map((s) => s.kind), ['cover', 'tip', 'tip', 'tip', 'follow']);
  assert.equal(post!.slides[0]!.blocks.at(-1)!.text, "3 AI hacks we've seen this week", 'n is the supported slide count');
  assert.deepEqual(await Promise.all(tipIds.map((id) => tipStatus(query, id))), ['drafted', 'drafted', 'drafted', 'rejected']);
  const row = await runRow(query, r.runId);
  assert.equal(row.record.write.skippedTips.length, 1);
  assert.equal(post!.photo_ids.length, 5);
  // The Writer-skipped tip is never selected again: the next run's seed list leaves it out.
  const { listUnusedSeedTips } = await import('@/lib/field-notes/store');
  assert.ok(!(await listUnusedSeedTips(query)).some((t) => t.id === tipIds[3]));
  assert.match((await query<{ reject_reason: string }>(`SELECT reject_reason FROM field_notes.tips WHERE id = $1`, [tipIds[3]])).rows[0]!.reject_reason, /^writer-skipped: /);
});

test('a slide the fact check drops is set aside like a Writer skip; the post, cover count and photos follow the other three', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 4);
  // The model fact check files one unsupported claim under the second slide (label tip-2, the second seeded tip).
  const claims = (request: string) => [
    ...supportedClaimsFor(request),
    { claim: 'it works on every thread', tipId: 'tip-2', kind: 'limit', supported: false, evidence: 'the source does not say every thread' },
  ];
  const engine = stubEngine(query, { claudeStub: stubClaude({ claims }), factCheck: 'model' });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  assert.deepEqual(engine.claudeStub.calls, ['submit_field_note', 'submit_cut_field_note', 'report_claim_check']);
  const [post] = await posts(query);
  assert.deepEqual(post!.tip_ids, [tipIds[0], tipIds[2], tipIds[3]], 'the dropped tip is never on the post');
  assert.deepEqual(post!.slides.map((s) => s.kind), ['cover', 'tip', 'tip', 'tip', 'follow']);
  assert.equal(post!.slides[0]!.blocks.at(-1)!.text, "3 AI hacks we've seen this week", 'the cover counts the remaining slides');
  assert.equal(post!.photo_ids.length, 5, 'cover + 3 tips + follow');
  assert.deepEqual(await Promise.all(tipIds.map((id) => tipStatus(query, id))), ['drafted', 'rejected', 'drafted', 'drafted']);
  const t = (await query<{ attempts: number; reject_reason: string }>(`SELECT attempts, reject_reason FROM field_notes.tips WHERE id = $1`, [tipIds[1]])).rows[0]!;
  assert.match(t.reject_reason, /^fact-check: unsupported limit: "it works on every thread"/);
  assert.equal(t.attempts, 0, 'set aside, not counted as an attempt');
  const row = await runRow(query, r.runId);
  assert.deepEqual(row.record.write.dropped.map((d: { tipId: string }) => d.tipId), [tipIds[1]], 'the run record carries the real tip id');
  assert.match(row.record.write.dropped[0].problems[0], /every thread/);
  assert.ok(row.record.write.notes.some((n: string) => n.startsWith(`Tip ${tipIds[1]} dropped by the fact check: `)));
  assert.deepEqual(row.record.tipIds, [tipIds[0], tipIds[2], tipIds[3]]);
});

test('the cap stops a run before the first call, and a spent cap skips the Editor but never overspends', async () => {
  // 1. A cap too small for one call: the Writer is refused, nothing is stored, photos untouched.
  {
    const { query } = await freshDb();
    await addPool(query, 6);
    const tipIds = await seedSet(query, 3);
    await setSetting(query, 'run_cap_usd', 0.05);
    const engine = stubEngine(query);
    const { w } = worker(query, engine);
    const r = await carryOutFieldNotesRun(w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'failed');
    const row = await runRow(query, r.runId);
    assert.equal(row.stop_reason, 'cap');
    assert.equal(engine.claudeStub.calls.length, 0, 'the refused call never reached the client');
    assert.equal(row.total_usd, 0);
    assert.equal((await posts(query)).length, 0);
    for (const id of tipIds) assert.equal(await tipStatus(query, id), 'candidate', 'the tips stay usable');
    assert.equal((await query(`SELECT 1 FROM field_notes.pool WHERE status <> 'live'`)).rows.length, 0);
  }
  // 2. The Writer's call uses up the cap: the Editor is refused (skipped as a note), the post still lands, spend stays at the Writer's.
  {
    const { query } = await freshDb();
    await addPool(query, 6);
    const tipIds = await seedSet(query, 3);
    await setSetting(query, 'run_cap_usd', 0.2);
    const engine = stubEngine(query, { claudeStub: stubClaude({ usage: { output_tokens: 13000 } }) });
    const { w } = worker(query, engine);
    const r = await carryOutFieldNotesRun(w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'ok', r.note);
    assert.deepEqual(engine.claudeStub.calls, ['submit_field_note']);
    const row = await runRow(query, r.runId);
    assert.ok(row.total_usd > 0 && row.total_usd <= 0.2);
    const stored = (await posts(query))[0]!;
    assert.ok(stored.soft_notes.some((n: string) => /Editor pass skipped/.test(n)), 'writer notes are stored as soft notes');
    assert.ok(!stored.fit_problems.some((n: string) => /Editor pass skipped/.test(n)), 'and never counted as fit problems');
  }
});

test('max_pending_drafts: a full review queue refuses Generate and skips the run; approving one makes room', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const dummy = (n: number) => insertPost(query, `field-notes-2026-10-0${n}`, { runId: null, tipIds: [], nyDate: `2026-10-0${n}`, slides: [], photoIds: [], caption: 'c', slideObjects: ['a', 'b'], fitProblems: [], renderProblems: [], softNotes: [] });
  const ids = [(await dummy(1)).id, (await dummy(2)).id, (await dummy(3)).id];
  assert.equal(await pendingDraftCount(query), 3);
  const refused = await queueManualFieldNotesRun(query, 'tommy');
  assert.equal(refused.ok, false);
  assert.match(refused.note, /waiting for review \(the limit is 3\)/);
  // The engine itself refuses too (a run queued before the queue filled).
  const [tipId] = await seedSet(query, 3);
  const engine = stubEngine(query);
  const { w } = worker(query, engine);
  const r = await carryOutFieldNotesRun(w, await claim(query, tipId));
  assert.equal(r.status, 'skipped');
  assert.match((await runRow(query, r.runId)).stop_reason ?? '', /^pending-drafts:/);
  assert.equal(engine.claudeStub.calls.length, 0);
  // A person approves one: it no longer waits on anyone.
  const out = await approveFieldNotesPost(query, ids[0]!, NOW, 'lucas');
  assert.equal(out.scheduled, false);
  assert.equal(await pendingDraftCount(query), 2);
  assert.equal((await queueManualFieldNotesRun(query, 'tommy', { seedTipId: tipId })).ok, true);
  // A lower setting counts the same way.
  await setSetting(query, 'max_pending_drafts', 2);
  assert.equal((await readFieldNotesSettings(query)).maxPendingDrafts, 2);
});

test('the photo rest rule: used photos sit out the next 8 posts, newest first, and come back after', async () => {
  const { query } = await freshDb();
  const ids = await addPool(query, 6);
  // First post uses 5 of 6 (the only people photo among them).
  const first = await seedSet(query, 3, 'first');
  const { w } = worker(query, stubEngine(query));
  assert.equal((await carryOutFieldNotesRun(w, await claim(query, first[0]))).status, 'ok');
  // Second post: the one photo of our faces is resting and one photo is left: skipped, tips untouched, nothing paid.
  const second = await seedSet(query, 3, 'second');
  const engine2 = stubEngine(query);
  const r2 = await carryOutFieldNotesRun(worker(query, engine2).w, await claim(query, second[0]));
  assert.equal(r2.status, 'skipped');
  assert.match((await runRow(query, r2.runId)).stop_reason ?? '', /^photos-short: no photo of your faces is ready/);
  assert.equal(engine2.claudeStub.calls.length, 0);
  assert.equal(await tipStatus(query, second[0]!), 'candidate');
  // The rest ends after 8 further posts: with nextSeq 9 (posts 1..8 exist) 9 - 1 = 8 is not > 8; at nextSeq 10 it is.
  for (let n = 2; n <= 9; n++) await insertPost(query, `field-notes-2026-09-${String(n).padStart(2, '0')}`, { runId: null, tipIds: [], nyDate: '2026-09-01', slides: [], photoIds: [], caption: 'c', slideObjects: ['a', 'b'], fitProblems: [], renderProblems: [], softNotes: [] });
  await query(`UPDATE field_notes.posts SET status = 'published' WHERE seq > 1`);
  assert.equal(await nextPostSeq(query), 10);
  const engine3 = stubEngine(query);
  const r3 = await carryOutFieldNotesRun(worker(query, engine3).w, await claim(query, second[0]));
  assert.equal(r3.status, 'ok', r3.note);
  const used = (await posts(query)).at(-1)!;
  // All six photos are available again: the people photo leads, the tip slides take the newest of each kind, no repeats.
  assert.equal(used.photo_ids[0], ids[0]);
  assert.equal(new Set(used.photo_ids).size, used.photo_ids.length);
  // A photo used at seq 1 rests until post 10: at nextSeq 9 it is still resting (checked by the pool rule itself).
  const { pickPhotos } = await import('@/lib/field-notes/photos/pool');
  const poolRow = { photoId: 'x', uploadedBy: 't', uploadedAt: NOW.toISOString(), status: 'resting' as const, lastUsedPostSeq: 1, rejectReason: null, kind: 'working' as const, opener: false };
  assert.equal(pickPhotos({ pool: [poolRow], nextSeq: 9, restPosts: 8, count: 1 }).length, 0);
  assert.equal(pickPhotos({ pool: [poolRow], nextSeq: 10, restPosts: 8, count: 1 }).length, 1);
});

test('photos: the cover is the starred people opener even when an unstarred people photo is newer; tip slides keep to two of a kind', async () => {
  const { query } = await freshDb();
  // 0 people (starred, oldest), 1-3 working, 4 scenery, 5 event, 6 people (newest, not starred), 7 scenery (Follow's).
  const ids = await addPool(query, 8, ['people', 'working', 'working', 'working', 'scenery', 'event', 'people', 'scenery']);
  await setKind(query, ids[0]!, 'people', true);
  const tipIds = await seedSet(query, 4);
  const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.equal(post!.photo_ids.length, 6, 'cover, four tip slides, Follow');
  assert.equal(post!.photo_ids[0], ids[0], 'the starred opener leads');
  const kinds = await kindsOf(query);
  const tipKinds = post!.photo_ids.slice(1, 5).map((id) => kinds.get(id)!);
  assert.ok(tipKinds.every((k) => k !== 'people'), tipKinds.join(','));
  for (const k of new Set(tipKinds)) assert.ok(tipKinds.filter((x) => x === k).length <= MAX_PER_KIND, `at most ${MAX_PER_KIND} ${k} photos: ${tipKinds.join(',')}`);
  assert.ok(new Set(tipKinds).size >= 3, 'working, scenery and event are all spread in');
  const run = await runRow(query, r.runId);
  assert.ok(Array.isArray(run.record.photoWarnings));
  assert.equal(run.record.weakOpener, undefined, 'the old weak-opener notion is gone');
});

test('photos: no starred opener is a warning, and the newest people photo is the cover', async () => {
  const { query } = await freshDb();
  const ids = await addPool(query, 7, ['people', 'working', 'scenery', 'event', 'working', 'scenery', 'people']);
  const tipIds = await seedSet(query, 3);
  const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  assert.equal((await posts(query))[0]!.photo_ids[0], ids[6]);
  assert.ok(((await runRow(query, r.runId)).record.photoWarnings as string[]).some((x) => /no people photo is starred as an opener/.test(x)));
});

test('photo pre-check: no people photo, or fewer than five photos, refuses before anything is paid, with a clear message', async () => {
  // No photo of our faces at all.
  {
    const { query } = await freshDb();
    await addPool(query, 6, ['working', 'scenery', 'event', 'working', 'scenery', 'event']);
    const tipIds = await seedSet(query, 3);
    const engine = stubEngine(query);
    const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'skipped');
    const row = await runRow(query, r.runId);
    assert.match(row.stop_reason ?? '', /^photos-short: no photo of your faces is ready .*Faces/);
    assert.equal(engine.claudeStub.calls.length, 0);
    assert.equal(row.total_usd, 0);
    for (const id of tipIds) assert.equal(await tipStatus(query, id), 'candidate');
  }
  // A people photo but only four photos.
  {
    const { query } = await freshDb();
    await addPool(query, 4);
    const tipIds = await seedSet(query, 3);
    const engine = stubEngine(query);
    const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'skipped');
    assert.match((await runRow(query, r.runId)).stop_reason ?? '', /^photos-short: 4 photo\(s\) are ready and a post needs 5/);
    assert.equal(engine.claudeStub.calls.length, 0);
  }
  // Exactly five photos: a post of three tips fits, and a fourth tip is left out rather than paid for without a photo.
  {
    const { query } = await freshDb();
    await addPool(query, 5);
    const tipIds = await seedSet(query, 4);
    const engine = stubEngine(query);
    const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'ok', r.note);
    assert.deepEqual(engine.claudeStub.tipIds, [['tip-1', 'tip-2', 'tip-3']], 'the Writer was asked for three tips, the most five photos can carry');
    assert.equal(await tipStatus(query, tipIds[3]!), 'candidate');
  }
});

test('a cover with no face swaps for another people photo; with none left the problem is stored and shown on review', async () => {
  const { query } = await freshDb();
  // 0 people (older, has a face), 1-4 others, 5 people (newest, no face in it).
  const ids = await addPool(query, 6, ['people', 'working', 'scenery', 'event', 'working', 'people']);
  FACELESS_PHOTOS.add(ids[5]!);
  const tipIds = await seedSet(query, 3);
  const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.equal(post!.photo_ids[0], ids[0], 'the cover swapped to the other people photo');
  const run = await runRow(query, r.runId);
  assert.deepEqual(run.record.photoSwaps, [{ slide: 1, from: ids[5], to: ids[0] }]);
  assert.ok(!post!.fit_problems.some((x) => /cover_no_face/.test(x)));

  // Only one people photo and it has no face: nothing to swap to, the post is stored with the problem for a person to see.
  const { query: q2 } = await freshDb();
  const ids2 = await addPool(q2, 6);
  FACELESS_PHOTOS.add(ids2[0]!);
  const tips2 = await seedSet(q2, 3);
  const r2 = await carryOutFieldNotesRun(worker(q2, stubEngine(q2)).w, await claim(q2, tips2[0]));
  assert.equal(r2.status, 'ok', r2.note);
  assert.ok((await posts(q2))[0]!.fit_problems.some((x) => /cover_no_face/.test(x)));
});

test('the photo picker: people cover, at most two of a kind on the tip slides, Follow takes scenery, relaxations are warned', () => {
  const R = { nextSeq: 20, restPosts: 8 };
  let n = 0;
  const photo = (id: string, kind: PhotoKind, o: Partial<PoolPhoto> = {}): PoolPhoto => ({ photoId: id, uploadedBy: 't', uploadedAt: new Date(NOW.getTime() - (100 - n++) * 3_600_000).toISOString(), status: 'live', lastUsedPostSeq: null, rejectReason: null, kind, opener: false, ...o });
  const many = (kind: PhotoKind, count: number, tag = kind) => Array.from({ length: count }, (_, i) => photo(`${tag}${i}`, kind));
  const kindOf = (pool: PoolPhoto[]) => new Map(pool.map((p) => [p.photoId, p.kind]));

  // A rich pool: nothing is relaxed.
  const rich = [photo('face', 'people'), ...many('working', 5), ...many('scenery', 2), ...many('event', 2)];
  const a = pickPostPhotos({ pool: rich, ...R, count: 6 });
  const ka = a.photoIds.map((id) => kindOf(rich).get(id));
  assert.equal(ka[0], 'people');
  assert.equal(a.photoIds.length, 6);
  assert.equal(new Set(a.photoIds).size, 6);
  const tips = ka.slice(1, 5);
  assert.ok(!tips.includes('people'));
  for (const k of new Set(tips)) assert.ok(tips.filter((x) => x === k).length <= MAX_PER_KIND);
  assert.equal(ka[5], 'scenery', 'Follow takes the calmest left');
  assert.ok(!a.warnings.some((w) => /no other choice|too narrow/.test(w)), a.warnings.join(' | '));

  // A pool of working photos only: the limit of two is relaxed, and says so.
  const flat = [photo('face', 'people'), ...many('working', 6)];
  const b = pickPostPhotos({ pool: flat, ...R, count: 6 });
  assert.equal(b.photoIds.length, 6);
  assert.ok(b.warnings.some((w) => /working photos on the tip slides; the pool had no other choice/.test(w)));

  // Starred opener beats a newer unstarred people photo; the rest rule still applies to both.
  const faces = [photo('old', 'people', { opener: true }), photo('new', 'people'), ...many('working', 4)];
  assert.equal(pickPostPhotos({ pool: faces, ...R, count: 5 }).photoIds[0], 'old');
  const resting = faces.map((p) => (p.photoId === 'old' ? { ...p, status: 'resting' as const, lastUsedPostSeq: 15 } : p));
  assert.equal(pickPostPhotos({ pool: resting, ...R, count: 5 }).photoIds[0], 'new', 'a resting opener is not offered');
  assert.equal(pickPostPhotos({ pool: faces.map((p) => ({ ...p, uploadedAt: p.photoId === 'old' ? NOW.toISOString() : p.uploadedAt })), ...R, count: 5 }).photoIds[0], 'old', 'starred wins over newest');

  // Replacements: the cover's is always another people photo; a tip slide's is not a people photo while others remain.
  const pool = [photo('face1', 'people'), photo('face2', 'people'), ...many('working', 3), ...many('scenery', 3)];
  const chosen = ['face1', 'working0', 'scenery0', 'working1', 'scenery1'];
  assert.equal(pickReplacement({ pool, ...R, chosen, index: 0, exclude: ['face1'] })!.photoId, 'face2');
  assert.equal(pickReplacement({ pool: pool.filter((p) => p.photoId !== 'face2'), ...R, chosen, index: 0, exclude: ['face1'] }), null, 'no other people photo: nothing to swap to');
  const tip = pickReplacement({ pool, ...R, chosen, index: 2, exclude: ['scenery0'] })!;
  assert.notEqual(kindOf(pool).get(tip.photoId), 'people');
  assert.ok(!chosen.includes(tip.photoId));

  // The pre-check, on its own.
  assert.equal(checkPhotoPool({ pool: rich, ...R }).ok, true);
  assert.deepEqual(checkPhotoPool({ pool: many('working', 8), ...R }).ok, false);
  const four = checkPhotoPool({ pool: [photo('face', 'people'), ...many('working', 3)], ...R });
  assert.ok(!four.ok && /needs 5/.test(four.message));
});

const tipState = async (q: HubQuery, ids: string[]) =>
  (await q<{ status: string; attempts: number; reject_reason: string | null }>(`SELECT status, attempts, reject_reason FROM field_notes.tips WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids])).rows;

test('a failed paid write (no draft) stores nothing; its tips count an attempt each and are set aside, with the reason, at two', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query, { claudeStub: stubClaude({ failWith: 'I cannot help with that' }) });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'failed');
  const row = await runRow(query, r.runId);
  assert.equal(row.stop_reason, 'write-failed');
  assert.equal((await posts(query)).length, 0);
  assert.equal(engine.uploaded.size, 0);
  assert.deepEqual((await tipState(query, tipIds)).map((t) => `${t.status}/${t.attempts}`), ['candidate/1', 'candidate/1', 'candidate/1'], 'one failed write never sinks a seed for good');
  assert.equal((await query(`SELECT 1 FROM field_notes.pool WHERE status <> 'live'`)).rows.length, 0);
  // A second failed write: two attempts, set aside with a reason (never a bare reject).
  const again = stubEngine(query, { claudeStub: stubClaude({ failWith: 'I cannot help with that' }) });
  const r2 = await carryOutFieldNotesRun(worker(query, again).w, await claim(query, tipIds[0]));
  assert.equal((await runRow(query, r2.runId)).stop_reason, 'write-failed');
  for (const t of await tipState(query, tipIds)) {
    assert.deepEqual([t.status, t.attempts], ['rejected', 2]);
    assert.match(t.reject_reason ?? '', /^attempts: 2 runs drafted it without a saved post \(last: write-failed\)/);
  }
  // The next Generate has no seeded tip waiting and no approved scoring: it stops without paying anything.
  const third = stubEngine(query);
  const r3 = await carryOutFieldNotesRun(worker(query, third).w, await claim(query));
  assert.equal(third.claudeStub.calls.length, 0);
  assert.match((await runRow(query, r3.runId)).stop_reason ?? '', /scoring-not-approved/);
});

test('a paid write that throws (a 529 in the fact check) or returns an invalid draft: every tip, seeds included, counts an attempt', async () => {
  for (const [name, over] of [
    ['throws', { factCheck: async () => { throw Object.assign(new Error('529 overloaded_error'), { status: 529 }); } }],
    ['invalid draft', { claudeStub: stubClaude({ draft: () => ({ slides: 'not a list', caption: 7 }) }) }],
  ] as const) {
    const { query } = await freshDb();
    await addPool(query, 6);
    const tipIds = await seedSet(query, 3);
    const r = await carryOutFieldNotesRun(worker(query, stubEngine(query, over as Partial<FieldNotesEngineDeps>)).w, await claim(query, tipIds[0]));
    assert.equal(r.status, 'failed', name);
    assert.equal((await posts(query)).length, 0, name);
    const state = await tipState(query, tipIds);
    assert.deepEqual(state.map((t) => `${t.status}/${t.attempts}`), ['candidate/1', 'candidate/1', 'candidate/1'], `${name}: an attempt each, never a bare reject`);
  }
});

test('a hard gate fails the draft and nothing is stored; its tips count an attempt and are set aside at two', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const repeated = (ids: string[]) => ({
    slides: [{ tipId: ids[0], ...CANNED_SLIDES[0]! }, { tipId: ids[1], ...CANNED_SLIDES[1]! }, { tipId: ids[2], ...CANNED_SLIDES[1]!, headline: CANNED_SLIDES[2]!.headline }],
    skipped: [],
    caption: CANNED_CAPTION,
  });
  const engine = stubEngine(query, { claudeStub: stubClaude({ draft: repeated }) });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'failed');
  assert.equal((await runRow(query, r.runId)).stop_reason, 'gate');
  assert.equal((await posts(query)).length, 0);
  const state = async () => (await query<{ status: string; attempts: number }>(`SELECT status, attempts FROM field_notes.tips WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [tipIds])).rows.map((t) => `${t.status}/${t.attempts}`);
  assert.deepEqual(await state(), ['candidate/1', 'candidate/1', 'candidate/1'], 'one near-duplicate slide no longer sinks every tip for good');
  // Second try fails the same gate: two attempts, set aside, never selected again.
  const again = stubEngine(query, { claudeStub: stubClaude({ draft: repeated }) });
  const r2 = await carryOutFieldNotesRun(worker(query, again).w, await claim(query, tipIds[0]));
  assert.equal((await runRow(query, r2.runId)).stop_reason, 'gate');
  assert.deepEqual(await state(), ['rejected/2', 'rejected/2', 'rejected/2']);
  const third = stubEngine(query);
  const r3 = await carryOutFieldNotesRun(worker(query, third).w, await claim(query));
  assert.equal(third.claudeStub.calls.length, 0, 'a third run pays nothing for them');
  assert.match((await runRow(query, r3.runId)).stop_reason ?? '', /scoring-not-approved/);
});

test('old unused tips expire; used and expired ones are never touched or sweep-enriched', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result, status, created_at) VALUES ('docs', 'https://docs.example.com/stale', 's', 'u', 'candidate', '2026-09-01T00:00:00Z')`);
  const tipIds = await seedSet(query, 4);
  const engine = stubEngine(query, { config: { questionsApproved: true } });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const tips = (await query<{ source_url: string; status: string }>(`SELECT source_url, status FROM field_notes.tips ORDER BY source_url`)).rows;
  assert.equal(tips.find((t) => t.source_url === 'https://docs.example.com/stale')!.status, 'expired');
  assert.equal(engine.jevStub.calls, 0, 'four seeds fill the post: nothing is scored, stale tips included');
});

test('tip_ids: stored in slide order, read back by getPost; the schema file is idempotent and backfills an older row', async () => {
  const { pg, query } = await freshDb();
  const tipIds = await seedSet(query, 3);
  const [olderTip] = await seedSet(query, 1, 'older');
  const saved = await insertPost(query, 'field-notes-2026-11-04', { runId: null, tipIds, nyDate: '2026-11-04', slides: [], photoIds: [], caption: 'c', slideObjects: ['a'], fitProblems: [], renderProblems: [], softNotes: [] });
  const got = await getPost(query, saved.id);
  assert.deepEqual(got!.tipIds, tipIds);
  assert.equal(got!.tipId, tipIds[0]);
  // An older row (tip_id only, tip_ids defaulted) is backfilled by the schema file; running it twice is harmless.
  const old = await query<{ id: string }>(`INSERT INTO field_notes.posts (tip_id, slug, ny_date, slides, caption) VALUES ($1, 'field-notes-2026-10-01', '2026-10-01', '[]'::jsonb, 'c') RETURNING id::text AS id`, [olderTip]);
  assert.deepEqual((await getPost(query, old.rows[0]!.id))!.tipIds, [olderTip], 'read through the fallback even before the backfill');
  const schema = readFileSync('db/field_notes_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(schema);
  await pg.exec(schema);
  assert.deepEqual((await query<{ tip_ids: string[] }>(`SELECT tip_ids::text[] AS tip_ids FROM field_notes.posts WHERE id = $1`, [old.rows[0]!.id])).rows[0]!.tip_ids, [olderTip]);
  assert.equal((await query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'field_notes' AND table_name = 'posts' AND column_name = 'tip_ids'`)).rows.length, 1);
});

// ── tags (CONTRACT-v4 sections 2 and 3) ─────────────────────────────────────

test('the tag columns: the schema applies twice, the CHECKs reject an unknown leaf, want, tier or purpose, branch is optional', async () => {
  const { pg, query } = await freshDb();
  const schema = readFileSync('db/field_notes_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(schema);
  await pg.exec(schema);
  const cols = (await query<{ column_name: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'field_notes' AND table_name = 'tips'`)).rows;
  const col = (n: string) => cols.find((c) => c.column_name === n)!;
  for (const n of ['leaf', 'want', 'tier', 'purposes', 'fresh', 'attempts', 'reject_reason']) assert.ok(col(n), n);
  assert.deepEqual([col('attempts').is_nullable, col('attempts').column_default], ['NO', '0'], 'attempts: idempotent, NOT NULL DEFAULT 0');
  assert.equal(col('reject_reason').is_nullable, 'YES');
  assert.equal(col('branch').is_nullable, 'YES', 'branch is no longer required');
  assert.equal(col('purposes').is_nullable, 'NO');
  assert.equal(col('fresh').is_nullable, 'NO');
  const named = (await query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = 'field_notes.tips'::regclass AND conname LIKE 'field_notes_tips_%_check'`)).rows.map((r) => r.conname).sort();
  assert.deepEqual(named, ['field_notes_tips_leaf_check', 'field_notes_tips_purposes_check', 'field_notes_tips_tier_check', 'field_notes_tips_want_check']);

  const insert = (url: string, cols: string, vals: string) =>
    query(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result${cols}) VALUES ('docs', '${url}', 's', 'u'${vals})`);
  // Untagged is fine, and the defaults hold.
  await insert('https://e.com/untagged', '', '');
  const untagged = (await query<{ leaf: string | null; purposes: string[]; fresh: boolean }>(`SELECT leaf, purposes, fresh FROM field_notes.tips WHERE source_url = 'https://e.com/untagged'`)).rows[0]!;
  assert.deepEqual(untagged, { leaf: null, purposes: [], fresh: false });
  await insert('https://e.com/ok', ', leaf, want, tier, purposes, fresh', ", 'repo_mcp', 'cheaper', 'higher', ARRAY['builder','personal'], true");
  await assert.rejects(insert('https://e.com/l', ', leaf', ", 'subagent'"), /field_notes_tips_leaf_check/);
  await assert.rejects(insert('https://e.com/w', ', want', ", 'avoid_mistakes'"), /field_notes_tips_want_check/);
  await assert.rejects(insert('https://e.com/t', ', tier', ", 'lower'"), /field_notes_tips_tier_check/);
  await assert.rejects(insert('https://e.com/p', ', purposes', ", ARRAY['student']"), /field_notes_tips_purposes_check/);
});

test('store: the tags read back both ways, and a seeded tip keeps the seeder\'s leaf and want when scoring runs', async () => {
  const { query } = await freshDb();
  const seeded = await saveSeededLink(query, { sourceUrl: 'https://github.com/o/r', sourceLabel: 'github.com', subject: 'o/r', useWithResult: '', seededBy: 'tommy', leaf: 'repo_free_alternative', want: 'cheaper' });
  assert.equal(seeded.kind, 'created');
  const id = seeded.tipId;
  let tip = (await getTip(query, id))!;
  assert.deepEqual([tip.leaf, tip.want, tip.tier, tip.purposes, tip.fresh], ['repo_free_alternative', 'cheaper', null, [], false]);
  // Scoring a seeded tip may fill tier, purposes and fresh; it never overwrites the seeder's leaf and want.
  await tagRow(query, id, 0.7, { leaf: 'skill', want: 'faster', tier: 'higher', purposes: ['builder', 'hobbyist'], fresh: true });
  tip = (await getTip(query, id))!;
  assert.deepEqual([tip.leaf, tip.want, tip.tier, tip.purposes, tip.fresh, tip.score], ['repo_free_alternative', 'cheaper', 'higher', ['hobbyist', 'builder'], true, 0.7]);
  // A found tip takes scoring's tags.
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result) VALUES ('docs', 'https://e.com/found', 's', 'u')`);
  const found = (await query<{ id: string }>(`SELECT id::text AS id FROM field_notes.tips WHERE source_url = 'https://e.com/found'`)).rows[0]!.id;
  await tagRow(query, found, 0.4, { leaf: 'skill', want: 'faster', tier: 'middle', purposes: [], fresh: false });
  assert.deepEqual([(await getTip(query, found))!.leaf, (await getTip(query, found))!.want], ['skill', 'faster']);
  // An unknown tag from a raw body is refused before any write.
  await assert.rejects(saveSeededLink(query, { sourceUrl: 'https://e.com/bad', sourceLabel: 'e.com', subject: 'e.com', useWithResult: '', seededBy: 'tommy', leaf: 'skill', want: 'avoid_mistakes' as never }), /unknown want/);
  assert.equal((await query(`SELECT 1 FROM field_notes.tips WHERE source_url = 'https://e.com/bad'`)).rows.length, 0);
});

test('saveSeededLink (the seed API write): created with the seeder\'s leaf and want; reopened takes the new ones; a duplicate changes nothing', async () => {
  const { query } = await freshDb();
  const base = { sourceUrl: 'https://docs.example.com/guide', sourceLabel: 'docs.example.com', subject: 'docs.example.com', useWithResult: '', seededBy: 'tommy' };
  const made = await saveSeededLink(query, { ...base, leaf: 'technique', want: 'better' });
  assert.equal(made.kind, 'created');
  const tip = (await getTip(query, made.tipId))!;
  assert.deepEqual([tip.sourceKind, tip.leaf, tip.want, tip.status, tip.seededBy], ['seed', 'technique', 'better', 'candidate', 'tommy']);
  assert.equal(tip.useWithResult.length > 0, true, 'an empty note stores the placeholder');
  const dupe = await saveSeededLink(query, { ...base, leaf: 'skill', want: 'faster', seededBy: 'lucas' });
  assert.deepEqual([dupe.kind, (dupe as { status: string }).status], ['duplicate', 'candidate']);
  assert.deepEqual([(await getTip(query, made.tipId))!.leaf, (await getTip(query, made.tipId))!.want], ['technique', 'better']);
  await query(`UPDATE field_notes.tips SET status = 'rejected' WHERE id = $1`, [made.tipId]);
  const back = await saveSeededLink(query, { ...base, leaf: 'llm_app_feature', want: 'stay_current', useWithResult: 'Turn it on in settings.', seededBy: 'lucas' });
  assert.equal(back.kind, 'reopened');
  const reopened = (await getTip(query, made.tipId))!;
  assert.deepEqual([reopened.status, reopened.leaf, reopened.want, reopened.useWithResult, reopened.seededBy], ['candidate', 'llm_app_feature', 'stay_current', 'Turn it on in settings.', 'lucas']);
  await assert.rejects(saveSeededLink(query, { ...base, sourceUrl: 'https://e.com/x', leaf: 'subagent' as never, want: 'better' }), /unknown content leaf/);
});

test('recentPostWants: the wants on the last 7 posts that were not rejected, one per tagged tip', async () => {
  const { query } = await freshDb();
  const tip = async (url: string, want: string | null) =>
    (await query<{ id: string }>(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result, want, status) VALUES ('docs', $1, 's', 'u', $2, 'drafted') RETURNING id::text AS id`, [url, want])).rows[0]!.id;
  const post = async (n: number, tipIds: string[], status = 'review') => {
    const saved = await insertPost(query, `field-notes-2026-10-${String(n).padStart(2, '0')}`, { runId: null, tipIds, nyDate: `2026-10-${String(n).padStart(2, '0')}`, slides: [], photoIds: [], caption: 'c', slideObjects: [], fitProblems: [], renderProblems: [], softNotes: [] });
    if (status !== 'review') await query(`UPDATE field_notes.posts SET status = $2 WHERE id = $1`, [saved.id, status]);
  };
  await post(1, [await tip('https://e.com/oldest', 'cheaper')]); // the 8th newest kept post: out of the window
  for (let i = 2; i <= 7; i++) await post(i, [await tip(`https://e.com/p${i}`, 'faster')]);
  await post(8, [await tip('https://e.com/rej', 'better')], 'rejected');
  await post(9, [await tip('https://e.com/a', 'stay_current'), await tip('https://e.com/b', null), await tip('https://e.com/c', 'newly_possible')]);
  const wants = await recentPostWants(query);
  assert.deepEqual([...wants].sort(), ['faster', 'faster', 'faster', 'faster', 'faster', 'faster', 'newly_possible', 'stay_current']);
});

test('a scored run tags the found tips, caps one want at two per post, and hands each tip\'s want to the Writer', async () => {
  const { query } = await freshDb();
  // Six photos: a 4-tip post, whose per-want cap is 2 (a 5- or 6-tip post allows 3: maxPerWant).
  await addPool(query, 6);
  const wantOf: Record<string, string> = { one: 'cheaper', two: 'cheaper', three: 'cheaper', four: 'newly_possible', five: 'better' };
  const found = Object.keys(wantOf).map((k) => ({ ...candidate(`https://docs.example.com/${k}`, `${k} docs`), untrustedContent: `Switch on the review option in settings. Type /review after a run. [${k}]` }));
  const jevStub = stubJev({ pick: (text) => ({ want: wantOf[/\[(\w+)\]/.exec(text)?.[1] ?? 'one']!, leaf: 'skill', tier: 'higher' }) });
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, jevStub });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(jevStub.calls, 5);
  const tips = (await query<{ id: string; want: string; leaf: string; tier: string; purposes: string[]; fresh: boolean; status: string }>(
    `SELECT id::text AS id, want, leaf, tier, purposes, fresh, status FROM field_notes.tips`)).rows;
  assert.ok(tips.every((t) => t.leaf === 'skill' && t.tier === 'higher' && t.purposes.length === 4 && t.fresh), 'every scored tip is tagged');
  const [post] = await posts(query);
  const onPost = post!.tip_ids.map((id) => tips.find((t) => t.id === id)!.want);
  assert.equal(onPost.length, 4);
  assert.equal(onPost.filter((w) => w === 'cheaper').length, 2, `never three of one want: ${onPost.join(', ')}`);
  assert.equal(tips.filter((t) => t.want === 'cheaper' && t.status === 'candidate').length, 1, 'the third cheaper tip waits for another post');
  // The Writer's request carries each tip's want (CONTRACT-v4 section 1: "The Writer's input tip carries `want`").
  const req = engine.claudeStub.writerRequests[0]!;
  for (const w of ['cheaper', 'newly_possible', 'better']) assert.ok(req.includes(w), `the Writer sees want ${w}`);
});

test('a scored run: a non-AI tip scores 0 and is never picked; at most two repo tips; the feature tip is on the post', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const leafOf: Record<string, string> = { notai: 'repo_automation', mcp: 'repo_mcp', memory: 'repo_memory', runtime: 'repo_agent_runtime', feature: 'coding_agent_feature' };
  const found = Object.keys(leafOf).map((k, i) => ({
    ...candidate(`https://docs.example.com/${k}`, `${k} docs`, `2026-11-0${3 - (i % 3)}T00:00:00Z`),
    untrustedContent: `${k} docs\n\nSwitch on the review option in settings. Type /review after a run. [${k}]`,
  }));
  const key = (text: string) => /\[(\w+)\]/.exec(text)?.[1] ?? 'mcp';
  const jevStub = stubJev({
    pick: (text) => ({ leaf: leafOf[key(text)]! }),
    // Every other answer is a top yes; only the AI gate says no for the emulator-like tip.
    nouls: (text): Record<string, number> => (key(text) === 'notai' ? { about_ai: 0.1, value: 1, concrete_result: 1, single_subject: 1, lesser_known: 1, past_basics: 1 } : {}),
  });
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, jevStub });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(jevStub.calls, 5, 'every new find is scored once (stub, no live call)');
  const tips = (await query<{ id: string; source_url: string; leaf: string; score: number; status: string }>(
    `SELECT id::text AS id, source_url, leaf, score, status FROM field_notes.tips`)).rows;
  const notAi = tips.find((t) => t.source_url.endsWith('/notai'))!;
  assert.equal(Number(notAi.score), 0, 'the AI gate zeroes it');
  assert.equal(notAi.status, 'candidate', 'stored as found, never drafted');
  const [post] = await posts(query);
  const onPost = post!.tip_ids.map((id) => tips.find((t) => t.id === id)!);
  assert.ok(!onPost.some((t) => t.id === notAi.id), 'the non-AI tip is not on the post');
  assert.equal(onPost.filter((t) => t.leaf.startsWith('repo_')).length, 2, `two repo tips at most: ${onPost.map((t) => t.leaf).join(', ')}`);
  assert.ok(onPost.some((t) => t.leaf === 'coding_agent_feature'), 'the feature tip is on the post');
  assert.equal(onPost.length, 3, 'the repo cap holds once the post reaches TIP_SLIDES_MIN');
});

test('approving, rejecting and publishing a post move every one of its tips', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)).w, await claim(query, tipIds[0]));
  const postId = r.postId!;
  await approveFieldNotesPost(query, postId, NOW, 'tommy');
  assert.deepEqual(await Promise.all(tipIds.map((id) => tipStatus(query, id))), ['approved', 'approved', 'approved']);
  const { markFieldNotesPublished } = await import('@/lib/field-notes/publish');
  await markFieldNotesPublished(query, postId, NOW.toISOString());
  assert.deepEqual(await Promise.all(tipIds.map((id) => tipStatus(query, id))), ['posted', 'posted', 'posted']);

  // Rejecting a fresh post rejects all of its tips.
  const more = await seedSet(query, 3, 'later');
  await query(`UPDATE field_notes.pool SET status = 'live', last_used_post_seq = NULL`);
  const r2 = await carryOutFieldNotesRun(worker(query, stubEngine(query)).w, await claim(query, more[0]));
  assert.equal(r2.status, 'ok', r2.note);
  assert.equal(await rejectFieldNotesPost(query, r2.postId!, 'lucas'), true);
  assert.deepEqual(await Promise.all(more.map((id) => tipStatus(query, id))), ['rejected', 'rejected', 'rejected']);

  // A row made before tip_ids existed (tip_id only) still moves its tip.
  const [solo] = await seedSet(query, 1, 'solo');
  await query(`UPDATE field_notes.tips SET status = 'drafted' WHERE id = $1`, [solo]);
  const row = await query<{ id: string }>(`INSERT INTO field_notes.posts (tip_id, slug, ny_date, slides, caption) VALUES ($1, 'field-notes-2026-10-02', '2026-10-02', '[]'::jsonb, 'c') RETURNING id::text AS id`, [solo]);
  await approveFieldNotesPost(query, row.rows[0]!.id, NOW, 'tommy');
  assert.equal(await tipStatus(query, solo!), 'approved');
});

test('the budget meter prices every call and refuses past the cap', async () => {
  const budget = createFieldNotesBudget({ capUsd: 0.12 });
  const client = budget.guardClaude(stubClaude({ usage: { output_tokens: 3000 } }));
  const params = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [], tools: [{ name: 'submit_field_note' }] } as never;
  await client.messages.create(params);
  assert.ok(budget.claudeUsd() > 0 && budget.spent() === budget.claudeUsd());
  await assert.rejects(() => client.messages.create(params), FieldNotesBudgetExhausted);
  assert.equal(budget.exhausted(), true);
  assert.equal(budget.calls().length, 1);
  assert.throws(() => createFieldNotesBudget({ capUsd: Number.NaN }), /positive number/);
});


test('auto_run false means the clock says off, whatever the day', () => {
  const off = parseFieldNotesSettings([{ key: 'auto_run', value: false }]);
  assert.equal(off.autoRun, false);
  for (const day of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06']) {
    const d = noonQueue(new Date(`${day}T07:00:00Z`), off);
    assert.equal(d.queue, false);
    assert.equal(d.reason, 'Field Notes auto_run is off');
  }
  assert.equal(noonQueue(NOW, null).queue, false);
  const on = parseFieldNotesSettings([{ key: 'auto_run', value: true }]);
  assert.equal(noonQueue(new Date('2026-11-03T07:00:00Z'), on).queue, true, 'Tuesday');
  assert.equal(noonQueue(new Date('2026-11-04T07:00:00Z'), on).queue, false, 'Wednesday');
  assert.equal(noonQueue(new Date('2026-11-03T07:00:00Z'), parseFieldNotesSettings([{ key: 'auto_run', value: true }, { key: 'run_cap_usd', value: 0 }])).queue, false);
  assert.ok(firstFieldNotesCheckAt(NOW).getTime() >= NOW.getTime());
});

test('the 2:00 AM check never queues twice a day: a scheduled run today, or a check over 2 h late, says no (fix 8)', async () => {
  const on = parseFieldNotesSettings([{ key: 'auto_run', value: true }]);
  const tuesday2am = new Date('2026-11-03T07:00:00Z');
  assert.equal(noonQueue(tuesday2am, on, false).queue, true);
  assert.equal(noonQueue(tuesday2am, on, null).queue, true, 'unknown: the check goes on');
  const again = noonQueue(tuesday2am, on, true);
  assert.equal(again.queue, false);
  assert.match(again.reason, /already exists for 2026-11-03/);
  assert.equal(noonQueue(new Date('2026-11-03T08:59:00Z'), on, false).queue, true, '3:59 AM: still catching up');
  const restart = noonQueue(new Date('2026-11-03T09:01:00Z'), on, false);
  assert.equal(restart.queue, false, '4:01 AM: a restart later in the day does not run it');
  assert.match(restart.reason, /catch-up only within 2 h/);
  assert.equal(noonQueue(new Date('2026-11-04T03:00:00Z'), on, false).queue, false, '10 PM restart: no run');

  const { query } = await freshDb();
  assert.equal(await scheduledRunToday(query, '2026-11-03'), false);
  await query(`INSERT INTO field_notes.runs (trigger, kind, status, cap_usd, requested_at) VALUES ('scheduled', 'build', 'ok', 0.5, $1)`, [tuesday2am]);
  assert.equal(await scheduledRunToday(query, '2026-11-03'), true);
  assert.equal(await scheduledRunToday(query, '2026-11-04'), false);
  await query(`INSERT INTO field_notes.runs (trigger, kind, status, cap_usd, requested_at) VALUES ('manual', 'build', 'ok', 0.5, '2026-11-04T08:00:00Z')`);
  assert.equal(await scheduledRunToday(query, '2026-11-04'), false, 'a person\'s Generate is not the clock');
});

test('the Field Notes check runs at 2:00 AM New York (night schedule v2)', () => {
  // 2026-11-03 is a Tuesday; 07:00Z is 2:00 AM EST.
  assert.equal(nextFieldNotesRunAt(new Date('2026-11-03T05:30:00Z')).toISOString(), '2026-11-03T07:00:00.000Z', '12:30 AM -> 2:00 AM today');
  assert.equal(nextFieldNotesRunAt(new Date('2026-11-03T07:00:00Z')).toISOString(), '2026-11-04T07:00:00.000Z', 'at 2:00 -> tomorrow');
  assert.equal(nextFieldNotesRunAt(new Date('2026-11-03T17:00:00Z')).toISOString(), '2026-11-04T07:00:00.000Z', 'noon -> tomorrow 2:00 AM');
  // A worker starting before today's 2:00 waits for it; after it, it checks right away (once).
  assert.equal(firstFieldNotesCheckAt(new Date('2026-11-03T06:00:00Z')).toISOString(), '2026-11-03T07:00:00.000Z', '1:00 AM start waits');
  const late = new Date('2026-11-03T08:00:00Z');
  assert.equal(firstFieldNotesCheckAt(late).toISOString(), late.toISOString(), '3:00 AM start checks now');
  const evening = new Date('2026-11-04T03:00:00Z'); // 10:00 PM Nov 3
  assert.equal(firstFieldNotesCheckAt(evening).toISOString(), evening.toISOString(), '10 PM start checks now');
});


test('settings parse to the shipped defaults; a bad run cap refuses Generate', async () => {
  const { query } = await freshDb();
  const s = await readFieldNotesSettings(query);
  assert.deepEqual({ ...s, runCapRaw: undefined }, { autoRun: false, publishingLive: false, requireApproval: true, runCapUsd: 0.5, runCapRaw: undefined, photoRestPosts: 8, maxPendingDrafts: 3, tipExpiryDays: 30, darkenCap: 0.45 });
  assert.equal(parseFieldNotesSettings([{ key: 'photo_rest_posts', value: 'x' }, { key: 'darken_cap', value: 7 }]).photoRestPosts, 8);
  await setSetting(query, 'run_cap_usd', 'free');
  const out = await queueManualFieldNotesRun(query, 'tommy');
  assert.equal(out.ok, false);
  assert.match(out.note, /run_cap_usd is not a positive number/);
  await setSetting(query, 'run_cap_usd', 0.5);
  assert.equal((await queueManualFieldNotesRun(query, 'tommy')).ok, true);
  assert.equal((await queueManualFieldNotesRun(query, 'tommy')).ok, false, 'a second click answers a note');
});


test('seeding: the link is stored canonical, so the same page (www, trailing slash, tracking params) is one tip', async () => {
  const { query } = await freshDb();
  const base = { sourceLabel: 'docs.example.com', subject: 'docs.example.com', useWithResult: '', leaf: 'technique', want: 'better' } as const;
  const a = await saveSeededLink(query, { ...base, sourceUrl: 'https://www.docs.example.com/x/?utm_source=feed', seededBy: 'tommy' });
  assert.equal(a.kind, 'created');
  assert.equal(a.sourceUrl, 'https://docs.example.com/x');
  const b = await saveSeededLink(query, { ...base, sourceUrl: 'http://docs.example.com/x', seededBy: 'lucas' });
  assert.deepEqual([b.kind, b.tipId], ['duplicate', a.tipId]);
  const rows = (await query<{ source_url: string; seeded_by: string }>(`SELECT source_url, seeded_by FROM field_notes.tips`)).rows;
  assert.deepEqual(rows, [{ source_url: 'https://docs.example.com/x', seeded_by: 'tommy' }]);
});

test('seeding a link a source already found (still a candidate) makes it the seeder\'s: source_kind seed, their leaf and want', async () => {
  const { query } = await freshDb();
  const foundId = (await saveCandidateTip(query, candidate('https://docs.example.com/found', 'Found docs')))!;
  await tagRow(query, foundId, 0.6, { leaf: 'skill', want: 'faster', tier: 'middle', purposes: ['builder'], fresh: false });
  const out = await saveSeededLink(query, { sourceUrl: 'https://docs.example.com/found/', sourceLabel: 'docs.example.com', subject: 'docs.example.com', useWithResult: 'Turn it on in settings.', leaf: 'coding_agent_feature', want: 'better', seededBy: 'lucas' });
  assert.deepEqual([out.kind, out.tipId], ['reopened', foundId]);
  const tip = (await getTip(query, foundId))!;
  assert.deepEqual([tip.sourceKind, tip.leaf, tip.want, tip.seededBy, tip.status, tip.useWithResult], ['seed', 'coding_agent_feature', 'better', 'lucas', 'candidate', 'Turn it on in settings.']);
  // A seed already waiting is a duplicate: a second seeder changes nothing.
  const again = await saveSeededLink(query, { sourceUrl: 'https://docs.example.com/found', sourceLabel: 'docs.example.com', subject: 'docs.example.com', useWithResult: '', leaf: 'skill', want: 'cheaper', seededBy: 'tommy' });
  assert.equal(again.kind, 'duplicate');
  assert.deepEqual([(await getTip(query, foundId))!.want, (await getTip(query, foundId))!.seededBy], ['better', 'lucas']);
});

test('a re-seeded expired or rejected link restarts its age, so the next run\'s expiry does not expire it again', async () => {
  const { query } = await freshDb();
  const base = { sourceUrl: 'https://docs.example.com/old', sourceLabel: 'docs.example.com', subject: 'docs.example.com', useWithResult: '', leaf: 'technique', want: 'better', seededBy: 'tommy' } as const;
  const made = await saveSeededLink(query, base);
  for (const status of ['expired', 'rejected']) {
    // Seeded long ago, then expired (or set aside).
    await query(`UPDATE field_notes.tips SET created_at = now() - interval '90 days', status = $2 WHERE id = $1`, [made.tipId, status]);
    assert.equal((await saveSeededLink(query, base)).kind, 'reopened');
    // The run expires before it reads the seeds: the reopened tip must survive it.
    assert.equal(await expireOldTips(query, new Date(), 30), 0, status);
    assert.equal((await getTip(query, made.tipId))!.status, 'candidate', status);
  }
});

test('seeds obey the post rules: at most two of one want and distinct subjects; the overflow waits for a later post', async () => {
  const { query } = await freshDb();
  // Six photos: a 4-tip post, so two of one want (the per-want cap scales with the post).
  await addPool(query, 6);
  const ids: string[] = [];
  const add = async (path: string, subject: string, want: Want) => {
    const id = await seed(query, `https://docs.example.com/${path}`, { subject, want });
    await query(`UPDATE field_notes.tips SET created_at = created_at - make_interval(secs => $2::int) WHERE id = $1`, [id, 100 - ids.length]);
    ids.push(id);
    return id;
  };
  const c1 = await add('c1', 'one', 'cheaper');
  const c2 = await add('c2', 'two', 'cheaper');
  const c3 = await add('c3', 'three', 'cheaper'); // a third cheaper: waits
  const dupe = await add('dupe', 'one', 'faster'); // the same subject as c1: waits
  const b = await add('b', 'four', 'better');
  const engine = stubEngine(query);
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, c1));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.deepEqual(post!.tip_ids, [c1, c2, b]);
  assert.deepEqual(await Promise.all([c3, dupe].map((id) => tipStatus(query, id))), ['candidate', 'candidate'], 'the overflow seeds wait');
  assert.deepEqual((await runRow(query, r.runId)).record.seedsWaiting, [c3, dupe]);
});

test('found tips keep the source\'s publish date, and scoring sees it as `published`', async () => {
  const { query } = await freshDb();
  await saveCandidateTip(query, candidate('https://docs.example.com/dated', 'Dated docs', '2026-10-20T00:00:00Z'));
  await saveCandidateTip(query, { ...candidate('https://docs.example.com/undated', 'Undated docs'), publishedAt: null });
  const tips = await listSelectableTips(query);
  const byUrl = new Map(tips.map((t) => [t.sourceUrl, t]));
  assert.equal(byUrl.get('https://docs.example.com/dated')!.publishedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(byUrl.get('https://docs.example.com/undated')!.publishedAt, null);
  assert.equal(tipToCandidate(byUrl.get('https://docs.example.com/dated')!).publishedAt, '2026-10-20T00:00:00.000Z');
  // The state Jev reads carries it.
  const { buildScoreState } = await import('@/lib/field-notes/sources/score');
  assert.equal((buildScoreState(tipToCandidate(byUrl.get('https://docs.example.com/dated')!), '2026-11-04') as unknown as { published: string }).published, '2026-10-20T00:00:00.000Z');
});

test('Rule 2: a run scores only candidates it just found that are not stored, never an unscored candidate an earlier run left', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const leftover = (await saveCandidateTip(query, candidate('https://docs.example.com/leftover', 'Leftover docs')))!;
  const found = [candidate('https://docs.example.com/n1', 'N1 docs'), candidate('https://docs.example.com/n2', 'N2 docs'), candidate('https://docs.example.com/n3', 'N3 docs')];
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(engine.jevStub.calls, 3, 'the three new tips only');
  const left = (await getTip(query, leftover))!;
  assert.deepEqual([left.score, left.leaf, left.status], [null, null, 'candidate'], 'the earlier candidate is untouched');
});

// ── ingestion and dedup over many runs (F1, 2026-11-06) ────────────────────

/** `n` candidates from one source, newest first by index, each with its own title. */
const fromSource = (label: string, n: number, day0 = 20): TipCandidate[] =>
  Array.from({ length: n }, (_, i) => candidate(`https://${label.toLowerCase()}.example.com/item-${i}`, label, `2026-10-${String(day0 + 9 - i).padStart(2, '0')}T00:00:00Z`, `${label} item ${i}`));

test('ingest: 30 candidates from 3 sources; each source gets turns, at most 5 each; only scored ones are saved; the rest are found again next run', async () => {
  const { query } = await freshDb();
  // Two people photos, so both runs have a cover.
  await addPool(query, 14, ['people', 'people']);
  const found = [...fromSource('Alpha', 10), ...fromSource('Beta', 10), ...fromSource('Gamma', 10)];
  const order: string[] = [];
  const jevStub = stubJev({ pick: (text) => (order.push(text.split('\n')[0]!), {}) });
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, jevStub });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(jevStub.calls, 15, 'the flood cap: 5 per source');
  // Round-robin in registry order, newest first inside a source: every source gets a turn before any gets a second.
  assert.deepEqual(order.slice(0, 6), ['Alpha item 0', 'Beta item 0', 'Gamma item 0', 'Alpha item 1', 'Beta item 1', 'Gamma item 1']);
  const stored = (await query<{ source_url: string; score: number | null }>(`SELECT source_url, score FROM field_notes.tips`)).rows;
  assert.equal(stored.length, 15, 'only the scored candidates were saved');
  assert.ok(stored.every((t) => t.score !== null), 'no unscored row is left to be burned');
  const row = await runRow(query, r.runId);
  assert.deepEqual([row.record.found.collected, row.record.found.alreadyStored, row.record.found.queued, row.record.found.added, row.record.found.leftForLater], [30, 0, 15, 15, 15]);

  // The next run sees the same 30: the 15 stored are dropped with one lookup, and the next 5 of each source are scored.
  const order2: string[] = [];
  const jev2 = stubJev({ pick: (text) => (order2.push(text.split('\n')[0]!), {}) });
  const second = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, jevStub: jev2 });
  const r2 = await carryOutFieldNotesRun(worker(query, second).w, await claim(query));
  assert.equal(r2.status, 'ok', r2.note);
  const asked2 = ((await runRow(query, r2.runId)).record.dupeCheck?.asked as number | undefined) ?? 0;
  assert.equal(jev2.calls - asked2, 15, 'scoring calls (duplicate-check questions counted apart)');
  assert.deepEqual(order2.slice(0, 3), ['Alpha item 5', 'Beta item 5', 'Gamma item 5'], 'the unscored ones were found again');
  assert.equal((await query(`SELECT 1 FROM field_notes.tips`)).rows.length, 30);
  assert.equal((await runRow(query, r2.runId)).record.found.alreadyStored, 15);
});

test('ingest: enrichment runs after stored links are dropped and only for the scoring slots (never for a stored row)', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const found = [...fromSource('Alpha', 8), ...fromSource('Beta', 2)];
  // Two Alpha links are already tips (an earlier run's): they are dropped before anything is fetched for them.
  for (const c of found.slice(0, 2)) await saveCandidateTip(query, c, 0.1);
  const enriched: string[][] = [];
  const enrich = async (cs: TipCandidate[]) => {
    enriched.push(cs.map((c) => c.sourceUrl));
    return cs.map((c) => ({ ...c, untrustedContent: `${c.untrustedContent}\n\nEnriched README text.` }));
  };
  const seenByJev: string[] = [];
  const jevStub = stubJev({ pick: (text) => (seenByJev.push(text), {}) });
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, enrich, jevStub });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(enriched.length, 1, 'one enrichment pass');
  const stored = new Set(found.slice(0, 2).map((c) => c.sourceUrl));
  assert.ok(enriched[0]!.every((u) => !stored.has(u)), 'no stored link is fetched for');
  // The per-source cap (5) then the round-robin: Alpha 2..6 and Beta 0..1, nothing else.
  assert.equal(enriched[0]!.length, 7);
  assert.deepEqual(enriched[0]!.slice(0, 4), ['https://alpha.example.com/item-2', 'https://beta.example.com/item-0', 'https://alpha.example.com/item-3', 'https://beta.example.com/item-1']);
  assert.equal(jevStub.calls, 7);
  assert.ok(seenByJev.every((t) => t.includes('Enriched README text.')), 'Jev scores the enriched text');
  const row = await runRow(query, r.runId);
  assert.deepEqual([row.record.found.alreadyStored, row.record.found.queued, row.record.found.enriched], [2, 7, 7]);
  // With no Jev there is nothing to score, so nothing is fetched either.
  const { query: q2 } = await freshDb();
  await addPool(q2, 6);
  enriched.length = 0;
  await carryOutFieldNotesRun(worker(q2, stubEngine(q2, { config: { questionsApproved: true }, collect: async () => found, enrich, jev: undefined })).w, await claim(q2));
  assert.equal(enriched.length, 0);
});

test('ingest: with no Jev nothing is scored, so nothing found is saved (nothing is burned unscored)', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => fromSource('Alpha', 4), jev: undefined });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.match((await runRow(query, r.runId)).stop_reason ?? '', /^no-tip:/);
  assert.equal((await query(`SELECT 1 FROM field_notes.tips`)).rows.length, 0);
});

test('dedup: a blog post about an already-posted feature, and a link into an already-posted GitHub repo, are skipped', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  // Posted earlier: a changelog tip named by its post's headline, and a GitHub repo.
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, status) VALUES
    ('docs', 'https://changelog.example.com/#nov-1', 'Changelog', 'Snapshot option', 'u', 'posted'),
    ('github', 'https://github.com/acme/widget', 'GitHub search', 'acme/widget', 'u', 'approved'),
    ('docs', 'https://old.example.com/x', 'Old docs', 'Old docs', 'u', 'posted')`);
  const found = [
    candidate('https://blog.example.com/review', 'Blog', '2026-11-03T00:00:00Z', 'Snapshot Option!'),
    { ...candidate('https://github.com/Acme/Widget/blob/main/docs/usage.md', 'HN', '2026-11-03T00:00:00Z', 'Show HN: Widget usage'), sourceKind: 'hn' as const },
    candidate('https://one.example.com/a', 'One', '2026-11-02T00:00:00Z', 'Old docs is not a blocker'),
    candidate('https://two.example.com/a', 'Two', '2026-11-02T00:00:00Z', 'Old docs'),
    candidate('https://three.example.com/a', 'Three', '2026-11-02T00:00:00Z', 'Third thing'),
  ];
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  const urls = (await query<{ id: string; source_url: string }>(`SELECT id::text AS id, source_url FROM field_notes.tips`)).rows;
  const onPost = post!.tip_ids.map((id) => urls.find((t) => t.id === id)!.source_url).sort();
  // 'Old docs' as a stored label (subject = source label) never blocks a title; a real posted subject does.
  assert.deepEqual(onPost, ['https://one.example.com/a', 'https://three.example.com/a', 'https://two.example.com/a']);
  assert.ok(urls.some((t) => t.source_url === 'https://github.com/acme/widget/blob/main/docs/usage.md'), 'the GitHub link is stored canonical (owner/repo lowercased)');
});

test('dedup: one post never takes two candidates with the same title or the same GitHub repo', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const found = [
    candidate('https://changelog.example.com/#nov-3', 'Changelog', '2026-11-03T00:00:00Z', 'Snapshot flag'),
    candidate('https://blog.example.com/snapshot', 'Blog', '2026-11-03T00:00:00Z', 'Snapshot  flag.'),
    { ...candidate('https://github.com/acme/tool', 'GitHub search', '2026-11-02T00:00:00Z', 'acme/tool: a tool'), sourceKind: 'github' as const },
    { ...candidate('https://github.com/ACME/tool/releases', 'HN', '2026-11-02T00:00:00Z', 'Tool 2.0 is out'), sourceKind: 'hn' as const },
    candidate('https://x.example.com/a', 'X', '2026-11-01T00:00:00Z', 'Something else'),
    candidate('https://y.example.com/a', 'Y', '2026-11-01T00:00:00Z', 'Another thing'),
  ];
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  const rows = (await query<{ id: string; source_url: string }>(`SELECT id::text AS id, source_url FROM field_notes.tips`)).rows;
  const onPost = post!.tip_ids.map((id) => rows.find((t) => t.id === id)!.source_url);
  assert.equal(onPost.length, 4);
  assert.equal(onPost.filter((u) => u.includes('snapshot')).length, 1, `one snapshot flag: ${onPost.join(', ')}`);
  assert.equal(onPost.filter((u) => u.includes('github.com/acme/tool')).length, 1, `one acme/tool: ${onPost.join(', ')}`);
});

test('a found tip the Writer skipped is rejected and never selected again; its subject-mates are drafted under their headline', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const found = ['a', 'b', 'c', 'd'].map((k) => candidate(`https://${k}.example.com/x`, k.toUpperCase(), '2026-11-02T00:00:00Z', `Thing ${k}`));
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found, claudeStub: stubClaude({ supported: 3 }) });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  const rows = (await query<{ id: string; status: string; reject_reason: string | null }>(`SELECT id::text AS id, status, reject_reason FROM field_notes.tips`)).rows;
  const skippedTip = rows.find((t) => t.status === 'rejected')!;
  assert.match(skippedTip.reject_reason ?? '', /^writer-skipped: /);
  const { listSelectableTips: selectable } = await import('@/lib/field-notes/store');
  assert.ok(!(await selectable(query)).some((t) => t.id === skippedTip.id), 'never selected again');
});

test('expiry: an old technique tip stays (evergreen); other old candidates expire', async () => {
  const { query } = await freshDb();
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result, status, created_at, leaf, score) VALUES
    ('docs', 'https://guide.example.com/#section', 's', 'u', 'candidate', '2026-08-01T00:00:00Z', 'technique', 0.8),
    ('docs', 'https://docs.example.com/old', 's', 'u', 'candidate', '2026-08-01T00:00:00Z', 'skill', 0.8)`);
  assert.equal(await expireOldTips(query, NOW, 30), 1);
  const rows = (await query<{ source_url: string; status: string }>(`SELECT source_url, status FROM field_notes.tips ORDER BY source_url`)).rows;
  assert.deepEqual(rows.map((t) => t.status), ['expired', 'candidate']);
});

// ── publish and schedule ───────────────────────────────────────────────────


test('publishing_live off: nothing is queued, claimed, booked or sent to Instagram', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query);
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  const postId = r.postId!;
  const meta = new Proxy({}, { get: () => { throw new Error('Instagram was touched while publishing is off'); } });
  const deps = { query, meta, signImage: async () => { throw new Error('signed an image'); } } as never;
  assert.equal(await claimAndPublishFieldNotes(deps), null);
  const q1 = await queueFieldNotesPublish(query, postId, 'approve');
  assert.equal(q1.queued, false);
  const q2 = await hardPublishFieldNotesPost(query, postId);
  assert.equal(q2.queued, false);
  const approved = await approveFieldNotesPost(query, postId, NOW, 'tommy');
  assert.equal(approved.scheduled, false);
  assert.match(approved.note, /scheduled when Field Notes publishing is on/);
  assert.equal((await query(`SELECT 1 FROM social_hub.publish_attempts`)).rows.length, 0);
  assert.equal((await query(`SELECT 1 FROM social_hub.schedule`)).rows.length, 0);
  assert.equal((await query(`SELECT 1 FROM social_hub.approvals WHERE decision = 'approved'`)).rows.length, 1, 'the person approved; that is all that happened');
  assert.equal((await query<{ approved_by: string }>(`SELECT approved_by FROM field_notes.posts`)).rows[0]!.approved_by, 'tommy');
  for (const id of tipIds) assert.equal(await tipStatus(query, id), 'approved');
  // Turned on, a post in review queues an attempt (still no Meta call: only the worker's claim reaches it).
  await setSetting(query, 'publishing_live', true);
  const q3 = await queueFieldNotesPublish(query, postId, 'approve');
  assert.equal(q3.queued, true);
});

test('the stored slides are the layout, mapped to types.ts Slide, and the draft maps to render inputs', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query);
  await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  const [post] = await posts(query);
  for (const s of post!.slides) {
    assert.ok(s.blocks.length > 0);
    for (const b of s.blocks as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(b).sort(), ['darken', 'fill', 'region', 'role', 'text']);
      assert.ok(b.fill === 'white' || b.fill === 'off_black');
    }
  }
  const tipSlide = post!.slides[1]!;
  assert.equal(tipSlide.blocks.find((b) => b.role === 'headline')!.text, CANNED_SLIDES[0]!.headline);
  const bodyText = tipSlide.blocks.filter((b) => b.role === 'body').map((b) => b.text);
  // One block: the value headline, then the plain body; the name and tryIt go to the caption, never the slide.
  assert.deepEqual(bodyText, [CANNED_SLIDES[0]!.body], 'one plain body paragraph');
  assert.ok(!JSON.stringify(tipSlide.blocks).includes(CANNED_SLIDES[0]!.tryIt), 'the usage line is not on the slide');
  const photos = await Promise.all([0, 1, 2, 3, 4].map(async (i) => ({ photoId: `p${i}`, bytes: await photoBytes(i) })));
  const draft = { slides: CANNED_SLIDES.slice(0, 3).map((x, i) => ({ kind: 'tip' as const, tipId: tipIds[i]!, ...x })), caption: CANNED_CAPTION };
  const inputs = draftToSlideInputs({ draft, photos });
  assert.deepEqual(inputs.map((i) => i.kind), ['cover', 'tip', 'tip', 'tip', 'follow']);
  assert.equal(inputs[0]!.headline, '3 AI tips to try');
  assert.equal(inputs[1]!.body, CANNED_SLIDES[0]!.body);
  assert.ok(!('name' in inputs[1]!) && !('tryIt' in inputs[1]!), 'the slide payload never carries name or tryIt');
  assert.throws(() => draftToSlideInputs({ draft, photos: photos.slice(0, 3) }), /needs 5 photos/);
});

test('render problems: the interim cap check is dropped, fonts missing is fatal, the logo goes to render problems', () => {
  const p = (kind: string, message = kind) => ({ kind, slide: 2, message }) as never;
  const out = splitProblems([p('cap_exceeded'), p('too_long'), p('logo_missing'), p('font_missing'), p('low_contrast')]);
  assert.equal(out.fatal.length, 1);
  assert.equal(out.render.length, 1);
  assert.deepEqual(out.fit.map((s) => s.split(' ')[2]!.replace(':', '')), ['too_long', 'low_contrast']);
  assert.ok(!out.fit.concat(out.render).some((s) => /cap_exceeded/.test(s)));
});


test('a slide the source gives no exact usage for still posts: its how-to-try line links the tip\'s source', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const claudeStub = stubClaude({
    draft: (ids) => ({ slides: ids.map((tipId, i) => ({ tipId, ...CANNED_SLIDES[i]!, ...(i === 1 ? { tryIt: '' } : {}) })), skipped: [], caption: CANNED_CAPTION }),
  });
  const engine = stubEngine(query, { claudeStub });
  const { w } = worker(query, engine);
  const r = await carryOutFieldNotesRun(w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const [post] = await posts(query);
  assert.deepEqual(post!.tip_ids, tipIds, 'no tip was skipped for a missing install command');
  const url = (await query<{ source_url: string }>(`SELECT source_url FROM field_notes.tips WHERE id = $1`, [tipIds[1]])).rows[0]!.source_url;
  assert.ok(url);
  assert.ok(post!.caption.includes(`1. ${CANNED_SLIDES[0]!.name}: ${CANNED_SLIDES[0]!.tryIt}`), post!.caption);
  assert.ok(post!.caption.includes(`2. ${CANNED_SLIDES[1]!.name}: ${url}`), post!.caption);
});

test('the caption keeps the writer text, adds the follow line and tags, keeps at most one exclamation mark and fits 2,200', () => {
  const c = buildFieldNotesCaption('Turn on the review option! Save this post!');
  assert.ok(c.startsWith('Turn on the review option! Save this post.'));
  assert.ok(c.includes(FIELD_NOTES_FOLLOW_LINE) && c.includes('#FieldNotes'));
  assert.equal((c.match(/!/g) ?? []).length, 1);
  const long = buildFieldNotesCaption('A sentence that goes on. '.repeat(200));
  assert.ok(long.length <= CAPTION_MAX_CHARS && long.includes(FIELD_NOTES_FOLLOW_LINE));
});


test('no live call: the injected clients were the only transports and the engine builds none of its own', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query);
  await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(engine.claudeStub.calls.length, 2, 'one Writer call for all the tips, one Editor call');
  assert.equal(fetchCalls, 0);
  // The photo bank paths the engine read are the fixture's.
  assert.ok((await query<{ master_path: string }>(`SELECT master_path FROM media_library.photos`)).rows.every((r) => r.master_path.startsWith('field-notes/test/')));
  assert.equal(masterPathOf(1), 'field-notes/test/master-1.jpg');
  // A run engine called directly (no worker) stores one post and finishes nothing itself.
  const next = await seedSet(query, 3, 'direct');
  await query(`UPDATE field_notes.pool SET status = 'live', last_used_post_seq = NULL`);
  const direct = await runFieldNotes(engine, { runId: await (async () => { await requestRun(query, 'manual', 0.5); return (await claimRun(query, NOW))!.id; })(), kind: 'build', seedTipId: next[0]!, capUsd: 0.5, settings: { photoRestPosts: 8, maxPendingDrafts: 5, tipExpiryDays: 30, darkenCap: 0.45 } });
  assert.equal(direct.ok, true);
  if (direct.ok && direct.outcome === 'saved') assert.deepEqual(direct.tipIds, next);
});

// ── score_version: only tips scored by the current question set are selectable (2026-11-06) ──

test('score_version: a tip scored by an older question set (or with no version) is never selected and never modified', async () => {
  const { FIELD_NOTES_SCORE } = await import('@/lib/field-notes/sources/questions');
  const { query } = await freshDb();
  await addPool(query, 7);
  // An earlier run's tips: a top score under @2 (before the about_ai gate), and one with no recorded version.
  const old = (await query<{ id: string }>(
    `INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, untrusted_content, status, score, leaf, want, score_version) VALUES
      ('docs', 'https://emulator.example.com/old', 'Old source', 'Old source', 'u', 'Firebase emulator suite', 'candidate', 0.99, 'coding_agent_feature', 'faster', 'field-notes-score@2'),
      ('docs', 'https://nover.example.com/old', 'No version', 'No version', 'u', 'Some tool', 'candidate', 0.98, 'coding_agent_feature', 'better', NULL)
     RETURNING id::text AS id`,
  )).rows.map((r) => r.id);
  const snapshot = async () => (await query<{ j: unknown }>(`SELECT row_to_json(t)::text AS j FROM field_notes.tips t WHERE id = ANY($1::uuid[]) ORDER BY id`, [old])).rows;
  const before = await snapshot();
  assert.deepEqual(await listSelectableTips(query), [], 'neither is listed as selectable');

  const found = ['a', 'b', 'c'].map((k) => candidate(`https://${k}.example.com/new`, k.toUpperCase(), '2026-11-02T00:00:00Z', `New thing ${k}`));
  const engine = stubEngine(query, { config: { questionsApproved: true }, collect: async () => found });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(engine.jevStub.calls, 3, 'only the new finds are scored; the old rows are never re-scored');
  const [post] = await posts(query);
  assert.ok(post!.tip_ids.every((id) => !old.includes(id)), 'no old-version tip on the post');
  assert.deepEqual(await snapshot(), before, 'the old rows are untouched (no re-score, no rewrite)');
  const saved = (await query<{ score_version: string | null }>(`SELECT score_version FROM field_notes.tips WHERE id <> ALL($1::uuid[])`, [old])).rows;
  assert.equal(saved.length, 3);
  assert.ok(saved.every((t) => t.score_version === FIELD_NOTES_SCORE.version), 'each new tip records the version that scored it');
});

test('score_version: saveCandidateTip writes the scorer\'s version; a score without one is stored NULL and not listed', async () => {
  const { FIELD_NOTES_SCORE } = await import('@/lib/field-notes/sources/questions');
  const { query } = await freshDb();
  const tags = { leaf: 'skill', want: 'faster', tier: 'middle', purposes: [], fresh: false } as const;
  const current = (await saveCandidateTip(query, candidate('https://docs.example.com/now', 'Now'), 0.7, { ...tags, purposes: [], questionSetVersion: FIELD_NOTES_SCORE.version }))!;
  const bare = (await saveCandidateTip(query, candidate('https://docs.example.com/bare', 'Bare'), 0.7, { ...tags, purposes: [] }))!;
  const rows = new Map((await query<{ id: string; score_version: string | null }>(`SELECT id::text AS id, score_version FROM field_notes.tips`)).rows.map((t) => [t.id, t.score_version]));
  assert.equal(rows.get(current), FIELD_NOTES_SCORE.version);
  assert.equal(rows.get(bare), null);
  assert.deepEqual((await listSelectableTips(query)).map((t) => t.id), [current]);
  // A different (newer) version would see neither of them.
  assert.deepEqual(await listSelectableTips(query, 'field-notes-score@99'), []);
});

test('score_version: the schema applies twice; the column is added without a backfill (an older row stays NULL)', async () => {
  const { pg, query } = await freshDb();
  const schema = readFileSync('db/field_notes_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, subject, use_with_result, status, score) VALUES ('docs', 'https://docs.example.com/older', 's', 'u', 'candidate', 0.5)`);
  await pg.exec(schema);
  await pg.exec(schema);
  const cols = (await query<{ data_type: string }>(`SELECT data_type FROM information_schema.columns WHERE table_schema = 'field_notes' AND table_name = 'tips' AND column_name = 'score_version'`)).rows;
  assert.deepEqual(cols.map((c) => c.data_type), ['text']);
  assert.equal((await query<{ v: string | null }>(`SELECT score_version AS v FROM field_notes.tips`)).rows[0]!.v, null);
});

test('a Claude call that fails before any Claude spend (bad key, outage) never counts an attempt against the tips', async () => {
  const src = (await import('node:fs')).readFileSync('lib/field-notes/run.ts', 'utf8');
  assert.match(src, /budget\.claudeUsd\(\) <= 0\) return;/);
});

test('refill: when the Writer skips tips and too few are left, one round swaps in the next stored tips and writes again', async () => {
  const { FIELD_NOTES_SCORE } = await import('@/lib/field-notes/sources/questions');
  const { query } = await freshDb();
  // Six photos: a 4-tip post, so two stored tips are left for the refill.
  await addPool(query, 6);
  const leaves = ['coding_agent_feature', 'llm_app_feature', 'technique', 'skill', 'coding_agent_feature', 'llm_app_feature'];
  const wants = ['faster', 'better', 'newly_possible', 'cheaper', 'better', 'faster'];
  for (const [i, leaf] of leaves.entries()) {
    await query(
      `INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, untrusted_content, status, score, leaf, want, score_version)
       VALUES ('docs', $1, $2, $2, 'u', $3, 'candidate', $4, $5, $6, $7)`,
      [`https://t${i}.example.com/x`, `Thing ${i}`, `Thing ${i} does a distinct job number ${i}. ${CANNED_SLIDES.map((x) => `${x.name} ${x.tryIt} ${x.headline} ${x.body}`).join(' ')}`, 0.9 - i * 0.05, leaf, wants[i], FIELD_NOTES_SCORE.version],
    );
  }
  const first = stubClaude({ supported: 2 });
  const second = stubClaude({ supported: 4 });
  let writerCalls = 0;
  const combo = Object.assign(
    { messages: { create: async (p: { tools?: { name: string }[] }) => {
      if (p.tools?.[0]?.name === 'submit_field_note') writerCalls += 1;
      return (writerCalls <= 1 ? first : second).messages.create(p as never);
    } } },
    { calls: [] as string[], tipIds: [] as string[][], writerRequests: [] as string[] },
  );
  const engine = stubEngine(query, { config: { questionsApproved: true }, claudeStub: combo as never });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  assert.equal(writerCalls, 2, 'one refill round, never more');
  const [post] = await posts(query);
  assert.ok(post!.tip_ids.length >= 3);
  const row = await runRow(query, r.runId);
  assert.equal(row.record.write.refilled, true);
  assert.equal(row.record.write.skippedTips.length, 2);
  const rejected = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM field_notes.tips WHERE status = 'rejected' AND reject_reason LIKE 'writer-skipped:%'`)).rows[0]!.n;
  assert.equal(rejected, 2, 'the two skipped tips are set aside for good');
  assert.ok(post!.tip_ids.every((id) => !first.tipIds[0]!.slice(2).includes(id)), 'no skipped tip on the post');
});

test('the Writer sees short tip labels, never the stored uuids; the post maps them back to the real tips', async () => {
  const { query } = await freshDb();
  await addPool(query, 7);
  const tipIds = await seedSet(query, 3);
  const engine = stubEngine(query);
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query, tipIds[0]));
  assert.equal(r.status, 'ok', r.note);
  const req = engine.claudeStub.writerRequests.join('\n');
  assert.match(req, /tip_id: tip-1/);
  for (const id of tipIds) assert.ok(!req.includes(id), 'no uuid reaches the Writer');
  const [post] = await posts(query);
  assert.deepEqual(post!.tip_ids, tipIds);
});

test('reworded duplicate: a top candidate judged the same as a posted feature is set aside and never on the post', async () => {
  const { FIELD_NOTES_SCORE } = await import('@/lib/field-notes/sources/questions');
  const { query } = await freshDb();
  await addPool(query, 8);
  // Something already posted.
  await query(`INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, status) VALUES ('docs', 'https://posted.example.com/a', 'Src', 'Remote control for local agents', 'u', 'posted')`);
  const content = (i: number) => (i === 0 ? 'Reply to your agents from your phone while they run at home. ' : `Distinct thing ${i}. `) + CANNED_SLIDES.map((x) => `${x.name} ${x.tryIt} ${x.headline} ${x.body}`).join(' ');
  for (let i = 0; i < 5; i++) {
    await query(
      `INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, untrusted_content, status, score, leaf, want, score_version)
       VALUES ('docs', $1, $2, $2, 'u', $3, 'candidate', $4, $5, $6, $7)`,
      [`https://d${i}.example.com/x`, `Thing ${i}`, content(i), 0.95 - i * 0.05, i % 2 ? 'llm_app_feature' : 'coding_agent_feature', ['faster', 'better', 'newly_possible', 'cheaper', 'faster'][i], FIELD_NOTES_SCORE.version],
    );
  }
  const jevStub = stubJev({ nouls: (u) => ({ same_as_posted: /from your phone/.test(u) ? 0.9 : 0.1 }) });
  const engine = stubEngine(query, { config: { questionsApproved: true }, jevStub });
  const r = await carryOutFieldNotesRun(worker(query, engine).w, await claim(query));
  assert.equal(r.status, 'ok', r.note);
  const dup = (await query<{ id: string; status: string; reject_reason: string }>(`SELECT id::text AS id, status, reject_reason FROM field_notes.tips WHERE source_url = 'https://d0.example.com/x'`)).rows[0]!;
  assert.equal(dup.status, 'rejected');
  assert.match(dup.reject_reason, /^duplicate-of-posted/);
  const [post] = await posts(query);
  assert.ok(!post!.tip_ids.includes(dup.id));
  const row = await runRow(query, r.runId);
  assert.ok(row.record.dupeCheck.asked >= 1 && row.record.dupeCheck.duplicates === 1);
});
