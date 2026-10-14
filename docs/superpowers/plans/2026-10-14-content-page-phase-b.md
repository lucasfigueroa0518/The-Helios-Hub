# Content Page, Phase B (slots, Approve, honest empty cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card on the Content page tells the truth about its post: Approve always books a time today, an unapproved explainer slot is cancelled (never posted), a failed post can be rescheduled, an empty card says why ("Run didn't finish"), Promote/Demote last until their idea is made, and the 2 AM explainer renders book today's window at finish.

**Architecture:** Publisher gates are pinned by offline tests first, then tightened (explainers cancel instead of fail). Approve's booking reuses each type's own scheduler (`scheduleJob` through today for explainers; `pickPublishAt` + `scheduleSet` for Stories) as a system slot. Card-facing logic stays pure in `lib/social-hub/views/*` and a new read-only `lib/content-type/run-misses.ts`; Promote/Demote gain a `consumed_at` column that the hub sets in one place when it loads the dataset. Worker changes are small and last.

**Tech Stack:** Next.js App Router (server components), TypeScript, Postgres (Supabase) / PGlite in tests, `node:test` via `tsx --test`, GCP VM `helios-social-worker` (systemd units).

**Spec:** `docs/superpowers/specs/2026-10-14-content-page-phase-b-design.md` (binding). Decision ids B1–B9 below refer to it. Phase A plan for style and context: `docs/superpowers/plans/2026-10-13-content-page-phase-a.md`.

## Spec corrections (planned against the code as it is)

1. **Explainers already book approved renders in the worker.** `scripts/explainers_worker.ts` `publishStep` calls `scheduleApproved` on every poll while `publishing_live` is on, with a two-week horizon. So Approve's today-only booking (Task 3) makes the time show at once; when no window is left today, the worker still books the next open day. Approve's message says that ("…takes the next open window after today; Post now can still post it today") instead of only "Post now can still post it". Whether `scheduleApproved` should also become today-only is an open question (see the final report), not changed here.
2. **Stories already book approved sets in the worker** (`lib/stories/worker.ts` step 3, every 15 s while `publishing_live`). Booking at Approve (Task 4) makes it immediate. The spine slot's `source` is set by `projectSet` from the set's `trigger` (`click` → `user`, `auto` → `auto`), not by who booked; quota is unaffected because `seriesDayPlaced` already counts a clicked set once it is approved. No transaction is added: `approveSet` and `scheduleSet` are separate status moves, and if the second fails the worker books the set within 15 s.
3. **Approve books only while `publishing_live` is on** (explainers and Stories). A slot booked while it is off would release late once someone switches it on (`releaseDueSchedules` / `dueSets` take any overdue slot).
4. **Reschedule on failed excludes Stories** (B7). A failed set is final in `stories.sets` (`rescheduleSet` and the hub's `place` need `approved`/`scheduled`; `rejectSet` refuses `failed`); Regenerate builds a new set. It also excludes a failed post with nothing to post (a render that failed).
5. **Failed cards had no Reject plan.** `actionsFor` offered Reject only for `ready`/`scheduled`; Task 5 adds it for failed posts (not Stories). The old `reschedule` entry in the failed card grid never matched (a failed post has no waiting slot); it becomes `place`, labelled "Reschedule".
6. **"Run didn't finish" sources, narrowed:** a Stories set that `failed` after it had a minute (a publish failure, `publish_at` set) is not a run that didn't finish and is left out; carousels use only the latest `daily` run of the day (a failed 3 AM run followed by a good manual run shows nothing); Reels use `finish_requests.updated_at` (when it failed; one row per idea). Carousel copy says "Tonight's…" only for the scheduled run.
7. **Promote/Demote consumption is computed from the posts the hub loads**, not by SQL on `social_hub.content_items`, because Explainers' spine rows can live in their own database (`lib/social-hub/load.ts` `explainersShareMain`). Only content made **after** the move uses it up; "made or rejected" collapses to that, since a rejection follows a making. Stories are consumed in SQL by `stories.pool.used_at`. `readAdjustments` falls back to today's moves if `consumed_at` is not applied yet.
8. **`scheduleJob`'s new `throughDate` goes 5th, before `rng`**, matching `schedulePost` (carousels) and `schedulePostIdea` (reels). Its only positional-`rng` caller, `scheduleApproved`, is updated.
9. **Explainers book at finish (B2) lives in `scripts/explainers_worker.ts` `renderNext`**, through a tested helper `bookFinishedRender` in `lib/explainers/publish/schedule.ts`. `lib/explainers/ideas/cycle.ts` only queues renders; it never sees one finish. Only `trigger = 'auto'` renders (the 2 AM run, per B2) are booked; a person's Regenerate or Make it render waits for Approve (open question in the report).
10. **Deploy path:** `scripts/gcp/deploy-explainers-worker.sh` is now a wrapper over `deploy-social-worker.sh` (Explainers run on `helios-social-worker`). The single publisher unit (`helios-publisher`, `lib/publishing/drivers/explainers.ts`) calls the same `releaseDueSchedules`, so Task 2 changes it too.
11. **B4 copy** uses the hub's existing window format: "No slot yet · posts 8:30–10:00 AM once approved".

## Global Constraints

- No automated test calls the live Claude API, `web_search`, Meta, HeyGen or any network (CLAUDE.md Rule 1). Tests are offline: pure functions, PGlite with the real `db/*.sql` files, stubs.
- Never start a real generation run, run a worker, deploy, apply a schema, or write to Supabase. Task 9 lists those steps for a human; nobody executes them in this plan.
- Nothing posts without a human Approve or Post now. The per-type auto-publish switches (`require_approval`, Stories auto series, Phase A D11) are untouched. No change here may weaken a publisher gate.
- Approve's booking is a system slot, `source = 'auto'`: it never reduces tonight's quota (`lib/social-hub/fill.ts` `userPlaced` counts only `source = 'user'`). A person's Reschedule (`placeItem`) books `source = 'user'`.
- Today-only bookings: Approve (Task 3, 4) and finish booking (Task 8) pass `throughDate = today` (New York). They never book tomorrow.
- Booking paths never call `queuePublish`; only `releaseDueSchedules` (at the slot's time, after the approval gate) and Post now do.
- Branch: stay on `content-page-phase-b` in `.worktrees/content-page-phase-b`. Never create, switch, rename, merge or delete branches. Never touch the main folder. Do not push.
- Commit after each task. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run one test file with `npx tsx --test <file>`; the suite is `npm test`. Type check with `npx tsc --noEmit -p .` (errors in `tests/seo-gsc-auth.test.ts` already exist on `main`; ignore only those).
- Card copy: "Approve", "Reschedule", "Post now", "Try again", "Regenerate", "Reject", "No slot yet", "Run didn’t finish", "Tonight’s carousel run didn’t finish" (typographic apostrophes, as the hub's existing copy).
- Worker-run code needs a VM redeploy (Task 9, by a human, daytime only, never 12:30–5 AM ET):

| Task | What changes | Runs where | VM redeploy |
|---|---|---|---|
| 1 | tests only | — | no |
| 2 | `lib/explainers/publish/schedule.ts` `releaseDueSchedules` | explainers worker + publisher on `helios-social-worker` | **yes** |
| 3 | explainers Approve (web); `scheduleJob` signature (shared file, worker behavior unchanged) | Vercel (+ rides along on the VM) | rides along |
| 4 | Stories Approve, card time line | Vercel | no |
| 5 | Reschedule/Reject on failed cards | Vercel | no |
| 6 | "Run didn't finish" | Vercel | no |
| 7 | schema column; hub reads; Stories build read (`lib/stories/build/index.ts`) | DB + Vercel + stories worker | **yes** (+ schema first) |
| 8 | explainers book at finish (`scripts/explainers_worker.ts`) | explainers worker | **yes** |

## Review Focus

1. **Approve after today's last explainer window (5:00 PM) or with publishing off:** Approve still approves, books no slot (never tomorrow from Approve), and says what happens next. Test in Task 3.
2. **A rejection saved on the review page only, while the spine still says approved (D41), on a booked explainer slot:** at its time the slot is cancelled with the rejected note, never queued. Test in Task 2.
3. **A person's Regenerate/Make it render finishing midday:** it does not grab today's other window by itself (only the 2 AM run's renders book at finish). Test in Task 8.
4. **Promoting an idea that already has content (made before the move):** the move is not used up by that old content; it stays until content is made after it. Test in Task 7.
5. **A Stories set that failed while posting, or a failed 3 AM carousel run followed by a good manual run:** neither card says "Run didn't finish". Test in Task 6.

---

### Task 1: Publisher safety tests (B5)

Pins, per type, that a due slot nobody approved, or a rejected one, never becomes a publish attempt. Carousels, reels and Stories already behave; this file proves it in one place before anything books unapproved slots (Task 8). Explainers today *fail* the slot instead of cancelling it (Task 2 tightens that); here they are pinned only on "never queued".

**Files:**
- Create: `tests/publisher-approval-gate.test.ts`

**Interfaces:**
- Consumes (existing): `releaseDueSchedules(query, { requireApproval })`, `schedulePost(query, postId, source, now, throughDate?, rng?)`, `NOT_APPROVED_NOTE`, `REJECTED_NOTE` from `lib/social/overnight/schedule.ts`; `releaseDueSchedules()`, `schedulePostIdea(postIdeaId, source, videoJobId, now)`, `NOT_APPROVED_NOTE`, `REJECTED_NOTE` from `lib/reels/publish/schedule.ts`; `releaseDueSchedules(db)` from `lib/explainers/publish/schedule.ts`; `dueSets`, `approveSet`, `scheduleSet`, `rejectSet` from `lib/stories/repository.ts`; `bookSlot`, `rejectItem` from `lib/social-hub/spine.ts`.
- Produces: test helpers `explainerRender(db, verdict)`, `dueExplainerSlot(db, jobId)`, `explainerSlot(db)`, `explainerAttempts(db)` inside this file; Task 2 edits the explainers tests in it.

- [ ] **Step 1: Write the gate tests**

Create `tests/publisher-approval-gate.test.ts`:

```ts
/**
 * B5 (Content page Phase B): with require_approval on, a booked slot that no
 * one approved, or one whose content was rejected, never posts, on every
 * type's publisher. Explainers start booking unapproved slots at finish in
 * Phase B (B2), so this gate is proven first. Offline: the real schema files
 * on PGlite, no Meta, no model.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import type { Queryable } from '@/lib/explainers/db';
import { explainerItemId, spineOf } from '@/lib/explainers/publish/items';
import { releaseDueSchedules as releaseExplainers } from '@/lib/explainers/publish/schedule';
import { saveFeedback } from '@/lib/explainers/repository';
import { reelItemId } from '@/lib/reels/publish/items';
import {
  NOT_APPROVED_NOTE as REEL_NOT_APPROVED,
  REJECTED_NOTE as REEL_REJECTED,
  releaseDueSchedules as releaseReels,
  schedulePostIdea,
} from '@/lib/reels/publish/schedule';
import { bookSlot, rejectItem } from '@/lib/social-hub/spine';
import { carouselItemId } from '@/lib/social/overnight/items';
import {
  NOT_APPROVED_NOTE as CAROUSEL_NOT_APPROVED,
  REJECTED_NOTE as CAROUSEL_REJECTED,
  releaseDueSchedules as releaseCarousels,
  schedulePost,
} from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';
import { generate } from '@/lib/stories/api';
import { approveSet, claimNextRequested, dueSets, markReady, rejectSet, saveBuild, scheduleSet } from '@/lib/stories/repository';

import { scratchExplainersDb } from './explainers-pglite';
import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

// ── Carousels ───────────────────────────────────────────────────────────────

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function carouselDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}

/** A carousel in review, booked by the night (source 'auto', unapproved) and due now. */
async function carouselOnTheClock(query: Query, slug: string): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, slide_objects)
     VALUES ($1, $2, 't', 'review', $3::jsonb, $4::jsonb) RETURNING id`,
    [slug, `story-${slug}`, JSON.stringify({ caption: 'A caption.', attributionBlock: 'Photo: Someone', slides: [] }), JSON.stringify(['a.jpg', 'b.jpg', 'c.jpg'].map((f) => `posts/${slug}/${f}`))],
  );
  const postId = rows[0].id as string;
  const booked = await schedulePost(query, postId, 'auto', NOW, undefined, () => 0);
  assert.equal(booked.scheduled, true);
  await query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);
  return postId;
}

const slotRow = async (query: Query, vertical: string) => {
  const row = (await query(`SELECT status, error FROM social_hub.schedule WHERE vertical = $1`, [vertical])).rows[0];
  return [row.status, row.error] as [string, string | null];
};
const attemptCount = async (query: Query) => Number((await query(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n);

test('carousels: a due slot nobody approved is cancelled and never queued', async () => {
  const query = await carouselDb();
  await carouselOnTheClock(query, 'gate-unapproved');
  assert.equal(await releaseCarousels(query, { requireApproval: true }), 0);
  assert.deepEqual(await slotRow(query, 'carousels'), ['cancelled', CAROUSEL_NOT_APPROVED]);
  assert.equal(await attemptCount(query), 0);
});

test('carousels: a due slot whose carousel was rejected is cancelled, even with require_approval off', async () => {
  const query = await carouselDb();
  const postId = await carouselOnTheClock(query, 'gate-rejected');
  await rejectItem(query, (await carouselItemId(query, postId))!);
  assert.equal(await releaseCarousels(query, { requireApproval: false }), 0);
  assert.deepEqual(await slotRow(query, 'carousels'), ['cancelled', CAROUSEL_REJECTED]);
  assert.equal(await attemptCount(query), 0);
});

// ── Trial Reels ─────────────────────────────────────────────────────────────

const IDEA = '60000000-0000-4000-8000-000000000001';
const SLATE = '60000000-0000-4000-8000-000000000002';
const VIDEO = '60000000-0000-4000-8000-000000000003';
const RUN = '60000000-0000-4000-8000-000000000004';

/** Trial Reels read lib/db.ts's shared pool: point it at PGlite holding one finished reel (as tests/reels-spine.test.ts does). */
async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-08', now(), 'p1', 'p2');
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${SLATE}', '${IDEA}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${VIDEO}', '${IDEA}', 'ok', now(), 'aud-7', 'Song', 'Artist');`);
  return pg;
}

const reelDue = (pg: PGlite) => pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);

test('reels: a due slot nobody approved is cancelled and never released', async () => {
  const pg = await reelsDb();
  assert.equal((await schedulePostIdea(IDEA, 'auto', null, NOW)).scheduled, true);
  await reelDue(pg);
  assert.equal(await releaseReels(), 0);
  const row = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', REEL_NOT_APPROVED]);
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0);
});

test('reels: a due slot whose video was rejected is cancelled, even with require_approval off', async () => {
  const pg = await reelsDb();
  await schedulePostIdea(IDEA, 'auto', null, NOW);
  // The rejection sits on the video's item (D39), and the slot was left waiting (as a failed cancel would leave it).
  const itemId = (await reelItemId(VIDEO))!;
  await pg.query(`UPDATE social_hub.schedule SET content_item_id = $1 WHERE vertical = 'reels'`, [itemId]);
  await pg.query(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'rejected', 'user')`, [itemId]);
  await pg.query(`INSERT INTO reels.settings (key, value) VALUES ('require_approval', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await reelDue(pg);
  assert.equal(await releaseReels(), 0);
  const row = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', REEL_REJECTED]);
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0);
});

// ── Explainers ──────────────────────────────────────────────────────────────

/** A finished render with its video in Storage and a caption; `approved` writes the review verdict (mirrored onto the spine). */
async function explainerRender(db: Queryable, verdict: 'approved' | null): Promise<string> {
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'auto', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', $2, 5000000, 'bucket')`, [jobId, `jobs/${jobId}/video.mp4`]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'The door between two programs.')`, [jobId]);
  if (verdict) await saveFeedback(db, { jobId, verdict, tags: [] });
  return jobId;
}

/** A system slot (source 'auto') for the render, already due. */
async function dueExplainerSlot(db: Queryable, jobId: string): Promise<void> {
  const itemId = (await explainerItemId(db, jobId))!;
  await bookSlot(spineOf(db), { vertical: 'explainers', itemId, nyDate: '2026-10-08', slot: 'afternoon', publishAt: new Date(Date.now() - 60_000), source: 'auto' });
}

const explainerSlot = async (db: Queryable) =>
  (await db.query<{ status: string; error: string | null }>(`SELECT status, error FROM social_hub.schedule WHERE vertical = 'explainers'`)).rows[0]!;
const explainerAttempts = async (db: Queryable) =>
  Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n);

test('explainers: a due slot nobody approved never becomes a publish attempt', async () => {
  const { db } = await scratchExplainersDb();
  await dueExplainerSlot(db, await explainerRender(db, null));
  assert.equal(await releaseExplainers(db), 0);
  assert.equal(await explainerAttempts(db), 0);
  assert.ok(!['publishing', 'published'].includes((await explainerSlot(db)).status));
});

test('explainers: a slot rejected on the review page only (spine still approved, D41) never becomes a publish attempt', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await explainerRender(db, 'approved');
  await dueExplainerSlot(db, jobId);
  await db.query(`UPDATE explainers.feedback SET verdict = 'rejected' WHERE job_id = $1`, [jobId]);
  assert.equal(await releaseExplainers(db), 0);
  assert.equal(await explainerAttempts(db), 0);
  assert.ok(!['publishing', 'published'].includes((await explainerSlot(db)).status));
});

// ── Stories ─────────────────────────────────────────────────────────────────

/** A Free vs. Paid set built and waiting at `ready` (Saturday 2026-10-10 is one of its days). */
async function readyStorySet() {
  const { db } = await harnessDb();
  const { set } = await generate(db, 'free_vs_paid', 'lucas@x', new Date('2026-10-10T12:00:00Z'));
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: {}, frames: [{ seq: 1, role: 'intro', backdrop: 'black', copy: { role: 'intro' } }], candidates: [] });
  await markReady(db, set.id, false);
  return { db, id: set.id };
}

test('stories: a built set nobody approved is never due, even with a minute on it; approved and scheduled, it is', async () => {
  const { db, id } = await readyStorySet();
  const minute = new Date('2026-10-10T13:00:00Z');
  const after = new Date('2026-10-10T13:30:00Z');
  await db.query(`UPDATE stories.sets SET publish_at = $2 WHERE id = $1`, [id, minute.toISOString()]);
  assert.deepEqual(await dueSets(db, after), [], 'ready, with a minute: not due');
  await approveSet(db, id);
  assert.deepEqual(await dueSets(db, after), [], 'approved but not scheduled: not due');
  await scheduleSet(db, id, minute);
  assert.deepEqual((await dueSets(db, after)).map((s) => s.id), [id]);
});

test('stories: a rejected set is never due', async () => {
  const { db, id } = await readyStorySet();
  await approveSet(db, id);
  await scheduleSet(db, id, new Date('2026-10-10T13:00:00Z'));
  await rejectSet(db, id, { note: 'no', by: 'tommy' });
  assert.deepEqual(await dueSets(db, new Date('2026-10-10T13:30:00Z')), []);
});
```

- [ ] **Step 2: Run the tests**

Run: `npx tsx --test tests/publisher-approval-gate.test.ts`
Expected: PASS, `ℹ fail 0` (these pin behavior that exists). If any case fails, **stop**: that is a real gap in a publisher gate. Fix it in the owning `releaseDueSchedules` / `dueSets` within this task (spec build order step 1: "fix any gap found"), add the fix to this task's commit, and say so in the report.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add tests/publisher-approval-gate.test.ts
git commit -m "test(publishing): pin that an unapproved or rejected slot never posts, every type (B5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Unapproved explainer slots are cancelled (B3) — worker code

`releaseDueSchedules` (explainers) cancels a rejected slot with the rejected note and, with `require_approval` on, an unapproved slot with a not-approved note, before claiming it. Only approved slots (or any non-rejected one with `require_approval` off) reach `queuePublish`, whose `publishReadiness` stays as a second guard. Runs in the explainers worker and in the single publisher (`lib/publishing/drivers/explainers.ts`): **VM redeploy (Task 9).**

**Files:**
- Modify: `lib/explainers/publish/schedule.ts:160-188` (`releaseDueSchedules`) and its imports
- Test: `tests/publisher-approval-gate.test.ts` (tighten the two explainers tests, add one)

**Interfaces:**
- Consumes: `REJECTED_SLOT_NOTE` from `lib/explainers/repository.ts` (`'This reel was rejected, so it was not posted.'`, what `setVerdict` already writes on a cancelled slot); `requireApproval(db)` in the same file.
- Produces: `export const NOT_APPROVED_NOTE = 'Nobody approved this explainer before its slot, so it was not posted.'` from `lib/explainers/publish/schedule.ts`. Task 8 relies on an unapproved explainer slot ending `cancelled`.

- [ ] **Step 1: Tighten the explainers tests (failing)**

In `tests/publisher-approval-gate.test.ts`:

(a) Change the explainers schedule import to:

```ts
import { NOT_APPROVED_NOTE as EXPLAINER_NOT_APPROVED, releaseDueSchedules as releaseExplainers } from '@/lib/explainers/publish/schedule';
import { REJECTED_SLOT_NOTE, saveFeedback } from '@/lib/explainers/repository';
```

(and delete the old `saveFeedback` import line).

(b) Replace the two `explainers:` tests with:

```ts
test('explainers: a due slot nobody approved is cancelled and never queued (B3)', async () => {
  const { db } = await scratchExplainersDb();
  await dueExplainerSlot(db, await explainerRender(db, null));
  assert.equal(await releaseExplainers(db), 0);
  const slot = await explainerSlot(db);
  assert.deepEqual([slot.status, slot.error], ['cancelled', EXPLAINER_NOT_APPROVED]);
  assert.equal(await explainerAttempts(db), 0);
});

test('explainers: a slot rejected on the review page only (spine still approved, D41) is cancelled, never queued (Review Focus 2)', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await explainerRender(db, 'approved');
  await dueExplainerSlot(db, jobId);
  await db.query(`UPDATE explainers.feedback SET verdict = 'rejected' WHERE job_id = $1`, [jobId]);
  assert.equal(await releaseExplainers(db), 0);
  const slot = await explainerSlot(db);
  assert.deepEqual([slot.status, slot.error], ['cancelled', REJECTED_SLOT_NOTE]);
  assert.equal(await explainerAttempts(db), 0);
});

test('explainers: an approved due slot is still released; with require_approval off an unreviewed one is too', async () => {
  const { db } = await scratchExplainersDb();
  await dueExplainerSlot(db, await explainerRender(db, 'approved'));
  assert.equal(await releaseExplainers(db), 1);
  assert.equal(await explainerAttempts(db), 1);

  const off = (await scratchExplainersDb()).db;
  await off.query(`UPDATE explainers.settings SET value = 'false'::jsonb WHERE key = 'require_approval'`);
  await dueExplainerSlot(off, await explainerRender(off, null));
  assert.equal(await releaseExplainers(off), 1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/publisher-approval-gate.test.ts`
Expected: FAIL. `NOT_APPROVED_NOTE` is not exported by `lib/explainers/publish/schedule.ts` yet (a load error), or, once it is, the slot reads `failed` instead of `cancelled`.

- [ ] **Step 3: Cancel before queueing**

In `lib/explainers/publish/schedule.ts`, change the repository import to:

```ts
import { POOL_ORDER_BY, REJECTED_SLOT_NOTE } from '@/lib/explainers/repository';
```

Replace the whole `releaseDueSchedules` function (the doc comment `/** Due slots become publish attempts. A failing readiness check fails the slot, with the reason. */` through its closing brace) with:

```ts
/** The note on a slot cancelled because nobody approved its render in time (B3; carousels and reels say the same). */
export const NOT_APPROVED_NOTE = 'Nobody approved this explainer before its slot, so it was not posted.';

/**
 * Due slots become publish attempts (B3, like carousels and reels): a
 * rejected render's slot is cancelled (a rejection in either place wins,
 * D41); with require_approval on (the default), so is one nobody approved.
 * Only the rest reach queuePublish, whose readiness check stays as a second
 * guard and fails the slot, with the reason.
 */
export async function releaseDueSchedules(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string; job_id: string; source: string; decision: string | null }>(
    `SELECT s.id, ci.native_ref AS job_id, s.source,
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE ap.decision END AS decision
       FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
       LEFT JOIN explainers.feedback f ON f.job_id::text = ci.native_ref
      WHERE s.vertical = 'explainers' AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
  );
  const cancel = (id: string, note: string) =>
    db.query(`UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [id, note]);
  const approvalNeeded = rows.some((row) => row.decision !== 'approved') && (await requireApproval(db));
  let released = 0;
  for (const row of rows) {
    if (row.decision === 'rejected') {
      await cancel(row.id, REJECTED_SLOT_NOTE);
      continue;
    }
    if (approvalNeeded && row.decision !== 'approved') {
      await cancel(row.id, NOT_APPROVED_NOTE);
      continue;
    }
    const claimed = await db.query(
      `UPDATE social_hub.schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;
    const result = await queuePublish(db, row.job_id, row.source === 'user' ? 'approve' : 'auto');
    if (result.queued) {
      await db.query(`UPDATE social_hub.schedule SET publish_attempt_id = $2 WHERE id = $1`, [row.id, result.id]);
      released += 1;
    } else if (result.alreadyPublished) {
      await db.query(`UPDATE social_hub.schedule SET status = 'published', error = NULL WHERE id = $1`, [row.id]);
    } else if (result.terminal) {
      await db.query(`UPDATE social_hub.schedule SET status = 'failed', error = $2 WHERE id = $1`, [row.id, result.note]);
    } else {
      await db.query(`UPDATE social_hub.schedule SET status = 'scheduled', error = $2 WHERE id = $1`, [row.id, result.note]);
    }
  }
  return released;
}
```

- [ ] **Step 4: Run the gate tests and the explainers suite**

Run: `npx tsx --test tests/publisher-approval-gate.test.ts tests/explainers-publish.test.ts tests/social-publisher.test.ts`
Expected: PASS, `ℹ fail 0` (the end-to-end explainer test approves its render first, so it still releases).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/explainers/publish/schedule.ts tests/publisher-approval-gate.test.ts
git commit -m "fix(explainers): cancel an unapproved or rejected slot at its time instead of failing it (B3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Explainers Approve books today's window (B1)

`scheduleJob` gains `throughDate` (5th, before `rng`). The hub's explainers Approve sets the verdict, then, while publishing is live, books today's next open window as a system slot (`source = 'auto'`). A job already booked keeps its slot. No window left today: Approve still succeeds and says so. Web code; the schedule file also ships to the VM (no worker behavior change).

**Files:**
- Modify: `lib/explainers/publish/schedule.ts:44-123` (`scheduleJob` signature and "no window" note; `scheduleApproved`'s call)
- Modify: `lib/publishing/actions/explainers.ts` (deps and `approve`)
- Modify: `lib/publishing/actions/live.ts:65-76` (wire the new deps)
- Modify: `tests/social-hub-actions.test.ts:69-96` (registry gets the new deps)
- Test: `tests/social-hub-placement.test.ts` (Explainers section: `explainerLayer` and new tests)

**Interfaces:**
- Consumes: `publishingLive(db)`, `chooseFromWindows(..., rng, throughDate)`; `formatPlacement(at)` from `lib/social-hub/placement.ts` ("Thu Oct 8, 1:00 PM"); `nyDateOf(now)` from `lib/social-hub/time.ts`.
- Produces: `scheduleJob(db: Queryable, jobId: string, source: 'auto' | 'user', now?: Date, throughDate?: string, rng?: (count: number) => number): Promise<ScheduleOutcome>`; with `throughDate` and nothing open: `{ scheduled: false, note: 'No explainer window is open through <throughDate>.' }`. `explainerActions` deps gain `scheduleJob: (db, jobId, source: 'auto', now: Date, throughDate: string) => Promise<{ scheduled: true; publishAt: string } | { scheduled: false; note: string }>`, `publishingLive: (db) => Promise<boolean>`, `now?: () => Date`. Task 8 calls `scheduleJob(db, jobId, 'auto', now, today, rng)`.

- [ ] **Step 1: Give the action registry and the placement layer the new deps**

In `tests/social-hub-actions.test.ts`, in `registry`'s parameter type, change the line `explainerItemId?: unknown; verdictOf?: unknown;` to:

```ts
  explainerItemId?: unknown; verdictOf?: unknown; scheduleJob?: unknown; publishingLive?: unknown;
```

and in the `explainers: explainerActions({ ... })` block add, after the `placeItem:`/`rescheduleItem:` line:

```ts
      scheduleJob: pick(o.scheduleJob, 'scheduleJob'), publishingLive: pick(o.publishingLive, 'publishingLive'),
```

In `tests/social-hub-placement.test.ts`, change the schedule import to:

```ts
import { publishingLive, scheduleApproved, scheduleJob, unscheduleJob } from '@/lib/explainers/publish/schedule';
```

add `import { userPlaced } from '@/lib/social-hub/fill';` next to the other `@/lib/social-hub/*` imports, and replace `explainerLayer` with:

```ts
function explainerLayer(pg: PGlite, at: Date = NOW) {
  const db = explainersDb(pg);
  return explainerActions({
    db: async () => db,
    setVerdict,
    hardPublishJob: async () => ({ queued: false }),
    loadSettings: async () => ({}),
    requestRerender: async () => ({ ok: false }),
    itemId: explainerItemId,
    unscheduleJob,
    verdictOf: async (d, jobId) => (await getFeedback(d, jobId))?.verdict ?? null,
    placeItem: (query, input) => placeItem(query, { ...input, now: NOW, rng: first }),
    rescheduleItem: (query, input) => rescheduleItem(query, { ...input, now: NOW, rng: first }),
    scheduleJob: (d, jobId, source, now, through) => scheduleJob(d, jobId, source, now, through, first),
    publishingLive,
    now: () => at,
  });
}
```

- [ ] **Step 2: Write the failing Approve tests**

Append to the Explainers section of `tests/social-hub-placement.test.ts`:

```ts
const publishingOn = (pg: PGlite) =>
  pg.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
const explainerSlots = async (pg: PGlite) =>
  (await pg.query<{ id: string; ny_date: string; slot: string; source: string }>(
    `SELECT id::text AS id, ny_date::text AS ny_date, slot, source FROM social_hub.schedule WHERE vertical = 'explainers' AND status = 'scheduled'`,
  )).rows;

test('explainers Approve books today’s next open window as a system slot; tonight’s quota is untouched; nothing is queued (B1)', async () => {
  const { pg, q } = await spineDb();
  await publishingOn(pg);
  const e = await explainer(pg);
  const out = await explainerLayer(pg).approve!({ jobId: e.job }, 'tommy', {});
  assert.deepEqual(out, { ok: true, note: 'Approved. It posts Thu Oct 8, 1:00 PM.' });
  assert.deepEqual((await explainerSlots(pg)).map((s) => [s.ny_date, s.slot, s.source]), [['2026-10-08', 'afternoon', 'auto']]);
  assert.equal(await userPlaced(q, 'explainers', '2026-10-08'), 0, 'source auto: the night still makes its full quota');
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0, 'booking only');
  assert.equal((await getFeedback(explainersDb(pg), e.job))?.verdict, 'approved');
});

test('explainers Approve after today’s last window approves, books nothing, never tomorrow, and says so (Review Focus 1)', async () => {
  const { pg } = await spineDb();
  await publishingOn(pg);
  const e = await explainer(pg);
  const out = await explainerLayer(pg, new Date('2026-10-08T21:30:00Z')).approve!({ jobId: e.job }, 'tommy', {}); // 5:30 PM New York
  assert.deepEqual(out, { ok: true, note: 'Approved. No window is left today, so it takes the next open window after today; Post now can still post it today.' });
  assert.deepEqual(await explainerSlots(pg), []);
  assert.equal((await getFeedback(explainersDb(pg), e.job))?.verdict, 'approved', 'the approval stands');
});

test('explainers Approve with publishing off approves and books nothing (Review Focus 1)', async () => {
  const { pg } = await spineDb();
  const e = await explainer(pg);
  const out = await explainerLayer(pg).approve!({ jobId: e.job }, 'tommy', {});
  assert.deepEqual(out, { ok: true, note: 'Approved. Publishing is switched off, so it gets a time once publishing is back on.' });
  assert.deepEqual(await explainerSlots(pg), []);
});

test('explainers Approve on a render that already has a slot keeps that slot', async () => {
  const { pg } = await spineDb();
  await publishingOn(pg);
  const e = await explainer(pg);
  const layer = explainerLayer(pg);
  const placed = await layer.place!({ jobId: e.job }, 'tommy', { nyDate: '2026-10-08', slot: 'late' });
  assert.ok(placed.ok, placed.note);
  const out = await layer.approve!({ jobId: e.job }, 'tommy', {});
  assert.deepEqual(out, { ok: true, note: 'Approved. It posts Thu Oct 8, 3:30 PM.' });
  assert.deepEqual((await explainerSlots(pg)).map((s) => [s.slot, s.source]), [['late', 'user']]);
});

test('scheduleJob through today never reaches tomorrow; without a limit it does', async () => {
  const { pg } = await spineDb();
  const e = await explainer(pg);
  const late = new Date('2026-10-08T21:30:00Z');
  assert.deepEqual(await scheduleJob(explainersDb(pg), e.job, 'auto', late, '2026-10-08', first), { scheduled: false, note: 'No explainer window is open through 2026-10-08.' });
  const next = await scheduleJob(explainersDb(pg), e.job, 'auto', late, undefined, first);
  assert.equal(next.scheduled, true);
  assert.deepEqual((await explainerSlots(pg)).map((s) => s.ny_date), ['2026-10-09']);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx tsx --test tests/social-hub-placement.test.ts`
Expected: FAIL. Approve returns the old note ("Approved. It gets the next free window."), no slot is booked, and `scheduleJob`'s 5th argument is still `rng` (a type error under `tsc`; at runtime `'2026-10-08'` is called as a function).

- [ ] **Step 4: Add `throughDate` to `scheduleJob`**

In `lib/explainers/publish/schedule.ts`, replace the `scheduleJob` signature lines

```ts
export async function scheduleJob(
  db: Queryable,
  jobId: string,
  source: 'auto' | 'user',
  now = new Date(),
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
```

with

```ts
/**
 * Book a render into the next free explainer window, or return its waiting
 * slot. `throughDate` (a New York day, YYYY-MM-DD) is the last day it may
 * book: Approve and the finish booking pass today (B1, B2); without it the
 * search runs two weeks ahead (the worker's scheduleApproved, the 2 AM fill).
 */
export async function scheduleJob(
  db: Queryable,
  jobId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
```

replace the two lines

```ts
    const choice = chooseFromWindows(windows, now, new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot))), busy, rng);
    if (!choice) return { scheduled: false, note: 'No explainer window is open in the next two weeks.' };
```

with

```ts
    const choice = chooseFromWindows(windows, now, new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot))), busy, rng, throughDate);
    if (!choice) {
      return { scheduled: false, note: throughDate ? `No explainer window is open through ${throughDate}.` : 'No explainer window is open in the next two weeks.' };
    }
```

and in `scheduleApproved` change `const result = await scheduleJob(db, row.id, 'auto', now, rng);` to:

```ts
    const result = await scheduleJob(db, row.id, 'auto', now, undefined, rng);
```

- [ ] **Step 5: Approve books today**

In `lib/publishing/actions/explainers.ts`, replace the import line

```ts
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
```

with

```ts
import { formatPlacement, type Placement, type PlacementOutcome, type PlacementTarget } from '@/lib/social-hub/placement';
import { nyDateOf } from '@/lib/social-hub/time';
```

In the `deps` type, after `rescheduleItem: Place;`, add:

```ts
  /** Today's next open window (B1): lib/explainers/publish/schedule.ts scheduleJob, through `throughDate`. */
  scheduleJob: (
    db: ExplainersDb,
    jobId: string,
    source: 'auto',
    now: Date,
    throughDate: string,
  ) => Promise<{ scheduled: true; publishAt: string } | { scheduled: false; note: string }>;
  publishingLive: (db: ExplainersDb) => Promise<boolean>;
  /** The clock (tests pin it). */
  now?: () => Date;
```

Replace the `approve` method with:

```ts
    async approve(t, by) {
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      await deps.setVerdict(db, jobId, 'approved', by);
      // Never while publishing is off: a slot booked then would post late once it is switched back on.
      if (!(await deps.publishingLive(db))) {
        return { ok: true, note: 'Approved. Publishing is switched off, so it gets a time once publishing is back on.' };
      }
      // B1: today's next open window, as a system slot (source 'auto', so tonight's quota is untouched).
      // A render that already has a slot keeps it. Booking only: the slot posts at its time, never now.
      const now = deps.now?.() ?? new Date();
      const booked = await deps.scheduleJob(db, jobId, 'auto', now, nyDateOf(now)!);
      return booked.scheduled
        ? { ok: true, note: `Approved. It posts ${formatPlacement(new Date(booked.publishAt))}.` }
        : { ok: true, note: 'Approved. No window is left today, so it takes the next open window after today; Post now can still post it today.' };
    },
```

Update the doc comment above `explainerActions`: change "approve and reject set the review verdict" to "approve sets the review verdict and books today's next open window (B1); reject sets it too".

- [ ] **Step 6: Wire the live deps**

In `lib/publishing/actions/live.ts`, in the `explainers: explainerActions({ ... })` block, after `rescheduleItem: placement.rescheduleItem,` add:

```ts
      scheduleJob: (d, jobId, source, now, through) => explainersSchedule.scheduleJob(d, jobId, source, now, through),
      publishingLive: explainersSchedule.publishingLive,
```

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test tests/social-hub-placement.test.ts tests/social-hub-actions.test.ts tests/explainers-publish.test.ts tests/explainers-ideas.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 8: Type check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add lib/explainers/publish/schedule.ts lib/publishing/actions/explainers.ts lib/publishing/actions/live.ts tests/social-hub-placement.test.ts tests/social-hub-actions.test.ts
git commit -m "feat(explainers): Approve books today's next open window as a system slot (B1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stories Approve books today's window; honest "No slot yet" (B1, B4)

`approve` in `lib/stories/api.ts` moves the set to `approved` as before, then, while publishing is live and the set is today's with its window still open, gives it its minute at once (`scheduleSet`, the same draw the worker's step 3 makes). The card's time line for an unapproved Stories set says when it would post. Web only.

**Files:**
- Modify: `lib/stories/api.ts:20,90-105` (`approve`)
- Create: `lib/social-hub/views/card-time.ts`
- Modify: `components/social-hub/content/TodayStrip.tsx:13,43-53` (`Made` uses `cardTimeLine`)
- Test: `tests/stories-approval-note.test.ts` (append), `tests/social-hub-card-time.test.ts` (create)

**Interfaces:**
- Consumes: `pickPublishAt(window, date, notBefore)` and `approvalNote` from `lib/stories/schedule.ts`; `scheduleSet(db, setId, publishAt)`, `nyDate(at)` from `lib/stories/repository.ts`; `PLAN`, `windowRange` from `lib/social-hub/views/plan.ts`; `clock` from `lib/social-hub/views/format.ts`.
- Produces: `approve(db, id, now?)` returns `StorySet & { approvalNote: string }`, with `status: 'scheduled'` and `approvalNote: 'Approved. It posts at 9:12 AM.'` when booked. `cardTimeLine(post: HubPost): string` from `lib/social-hub/views/card-time.ts`; Task 6 keeps using it in `TodayStrip`.

- [ ] **Step 1: Write the failing Stories Approve tests**

Append to `tests/stories-approval-note.test.ts`:

```ts
async function publishingOn(db: Awaited<ReturnType<typeof ready>>['db']) {
  await db.query(`INSERT INTO stories.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

test('approve with publishing live books today’s window at once (B1); the spine slot follows the set', async () => {
  const s = await ready(at('2026-10-10T08:00:00Z'));
  await publishingOn(s.db);
  const done = await approve(s.db, s.id, at('2026-10-10T12:00:00Z')); // 8:00 AM NY, Saturday
  assert.equal(done.status, 'scheduled');
  const t = new Date(done.publish_at as unknown as string).getTime();
  assert.ok(t >= Date.parse('2026-10-10T12:30:00Z') && t <= Date.parse('2026-10-10T14:00:00Z'), 'inside 8:30–10:00 AM');
  assert.match(done.approvalNote, /^Approved\. It posts at \d{1,2}:\d{2} AM\.$/);
  const slots = (await s.db.query<{ status: string }>(`SELECT status FROM social_hub.schedule WHERE vertical = 'stories'`)).rows;
  assert.deepEqual(slots.map((r) => r.status), ['scheduled']);
  assert.equal((await s.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0, 'booking only');
});

test('approve after the window, or with publishing off, approves without a minute (Review Focus 1)', async () => {
  const late = await ready(at('2026-10-10T08:00:00Z'));
  await publishingOn(late.db);
  const lateDone = await approve(late.db, late.id, at('2026-10-10T15:00:00Z')); // 11:00 AM NY
  assert.equal(lateDone.status, 'approved');
  assert.equal(lateDone.publish_at, null);
  assert.match(lateDone.approvalNote, /window has passed/);

  const off = await ready(at('2026-10-10T08:00:00Z'));
  const offDone = await approve(off.db, off.id, at('2026-10-10T12:00:00Z'));
  assert.equal(offDone.status, 'approved');
  assert.equal(offDone.publish_at, null);
  assert.match(offDone.approvalNote, /Publishing is switched off/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/stories-approval-note.test.ts`
Expected: FAIL on the first new test: `status` is `approved`, not `scheduled`.

- [ ] **Step 3: Book at Approve**

In `lib/stories/api.ts`, change the schedule import to:

```ts
import { approvalNote as approvalNoteFor, pickPublishAt } from '@/lib/stories/schedule';
```

and replace the `approve` function and its doc comment with:

```ts
const NY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

/**
 * Approve. While publishing is live and the set is today's with its window
 * still open, it gets its minute now (B1), the same draw the worker makes
 * (worker.ts step 3), so the Content page shows its time at once. The
 * returned set carries `approvalNote`: when it posts, or why it won't (the
 * window has passed: only Publish now posts it; publishing is off: it waits).
 * The spine slot's source follows the set's trigger (spine.ts projectSet).
 */
export async function approve(db: Queryable, id: string, now = new Date()): Promise<StorySet & { approvalNote: string }> {
  const set = await guard(() => approveSet(db, id));
  let out: StorySet = set;
  let approvalNote = 'Approved.';
  try {
    const settings = await loadSettings(db);
    const window = settings.series[set.series].window;
    approvalNote = approvalNoteFor(window, set.ny_date, now, settings.publishingLive);
    const minute = settings.publishingLive && set.ny_date === nyDate(now) ? pickPublishAt(window, set.ny_date, now) : null;
    if (minute) {
      out = await scheduleSet(db, id, minute);
      approvalNote = `Approved. It posts at ${NY_TIME.format(minute)}.`;
    }
  } catch {
    // The note and the minute are conveniences: the approval already happened, and the worker books an approved set within 15 seconds.
  }
  return { ...out, approvalNote };
}
```

- [ ] **Step 4: Run the Stories tests**

Run: `npx tsx --test tests/stories-approval-note.test.ts tests/stories-api.test.ts tests/stories-pipeline.test.ts tests/stories-spine.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 5: Write the failing card time-line test**

Create `tests/social-hub-card-time.test.ts`:

```ts
/**
 * The time line on a Today's Content card (B4): a Stories set waiting for
 * Approve says when its window is, since Stories book only at Approve.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubPost } from '@/lib/social-hub/types';
import { cardTimeLine } from '@/lib/social-hub/views/card-time';
import { clock } from '@/lib/social-hub/views/format';

import { previewDataset } from './fixtures/social-hub/preview-dataset';

const d = previewDataset();
const base = (vertical: HubPost['vertical']) => {
  const p = d.posts.find((x) => x.vertical === vertical);
  assert.ok(p, `fixture has a ${vertical} post`);
  return p!;
};

test('a Stories set waiting for Approve says when it would post (B4)', () => {
  const s = base('stories');
  const waiting: HubPost = { ...s, status: 'ready', publishAt: null, postedAt: null, approval: { ...s.approval, approvedAt: null }, idea: { id: 'stories:morning_download:2026-10-09', label: 'Morning Download' } };
  assert.equal(cardTimeLine(waiting), 'No slot yet · posts 8:30–10:00 AM once approved');
  assert.equal(cardTimeLine({ ...waiting, approval: { ...waiting.approval, approvedAt: '2026-10-09T15:00:00Z' } }), 'No slot yet', 'approved after its window: no promise');
});

test('other cards: their time, Being made, or No slot yet', () => {
  const r = base('reels');
  assert.equal(cardTimeLine({ ...r, status: 'ready', publishAt: null, postedAt: null }), 'No slot yet');
  assert.equal(cardTimeLine({ ...r, status: 'generating', publishAt: null, postedAt: null }), 'Being made');
  assert.equal(cardTimeLine({ ...r, status: 'scheduled', publishAt: '2026-10-09T13:05:00Z', postedAt: null }), clock('2026-10-09T13:05:00Z'));
});
```

Run: `npx tsx --test tests/social-hub-card-time.test.ts`
Expected: FAIL with "Cannot find module '@/lib/social-hub/views/card-time'".

- [ ] **Step 6: Write `cardTimeLine` and use it on the card**

Create `lib/social-hub/views/card-time.ts`:

```ts
import type { HubPost } from '@/lib/social-hub/types';
import { clock } from '@/lib/social-hub/views/format';
import { PLAN, windowRange } from '@/lib/social-hub/views/plan';

/**
 * The time line on a Today's Content card: when it posts (or posted); "Being
 * made"; for a Stories set waiting for Approve, when its window is (B4:
 * Stories book a minute only once approved); otherwise "No slot yet".
 */
export function cardTimeLine(post: HubPost): string {
  const when = post.postedAt ?? post.publishAt;
  if (when) return clock(when);
  if (post.status === 'generating') return 'Being made';
  if (post.vertical === 'stories' && post.status === 'ready' && !post.approval.approvedAt) {
    const w = PLAN.stories.find((x) => x.label === post.idea?.label);
    if (w) return `No slot yet · posts ${windowRange(w)} once approved`;
  }
  return 'No slot yet';
}
```

In `components/social-hub/content/TodayStrip.tsx`:
- replace `import { clock, displayName } from '@/lib/social-hub/views/format';` with `import { displayName } from '@/lib/social-hub/views/format';` and add `import { cardTimeLine } from '@/lib/social-hub/views/card-time';`
- in `Made`, delete the line `const when = post.postedAt ?? post.publishAt;` and replace `<span>{when ? clock(when) : post.status === 'generating' ? 'Being made' : 'No slot yet'}</span>` with `<span>{cardTimeLine(post)}</span>`.

- [ ] **Step 7: Run tests and type check**

Run: `npx tsx --test tests/social-hub-card-time.test.ts tests/stories-approval-note.test.ts` then `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: PASS, `ℹ fail 0`; no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/stories/api.ts lib/social-hub/views/card-time.ts components/social-hub/content/TodayStrip.tsx tests/stories-approval-note.test.ts tests/social-hub-card-time.test.ts
git commit -m "feat(stories): Approve books today's window at once; waiting sets say when they post (B1, B4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reschedule on failed posts (B7)

A failed post with something to post (carousels, reels, explainers) offers `place`, labelled "Reschedule", which books one of today's remaining windows beside the failed slot (`placeItem`, `source = 'user'`: a person picked it), and Reject. Stories are left out (a failed set is final). Web only.

**Files:**
- Modify: `lib/social-hub/house.ts:153-233` (`actionsFor`)
- Modify: `lib/social-hub/views/card-actions.ts:21-25,66-71`
- Test: `tests/social-hub-card-actions.test.ts` (append), `tests/social-hub-placement.test.ts` (append)

**Interfaces:**
- Consumes: `placeItem(query, { vertical, itemId, nyDate, slot, now, rng })` from `lib/social-hub/placement.ts` (unchanged; the spine's active-slot index ignores `failed`).
- Produces: for a failed non-Stories post with content, `actionsFor` includes `{ action: 'place', label: 'Reschedule', pick: 'slot', body: { vertical, refs: contentRefs(post) } }` and a `reject` plan; `cardActions` failed grid order: `place` ("Reschedule"), `hardRegenerate` ("Regenerate"), `reject` ("Reject"), after the primary "Try again".

- [ ] **Step 1: Write the failing card tests**

Append to `tests/social-hub-card-actions.test.ts`:

```ts
const published = (vertical: HubPost['vertical']) => find((p) => p.vertical === vertical && p.status === 'published' && p.media.kind !== 'none');

test('failed: Try again, then Reschedule (one of today’s windows), Regenerate, Reject (B7)', () => {
  const base = published('reels');
  const post: HubPost = { ...base, status: 'failed', postedAt: null, permalink: null, statusNote: 'Container never reached FINISHED' };
  const c = card(post);
  assert.equal(c.primary?.label, 'Try again');
  assert.deepEqual(c.grid.map((a) => [a.key, a.label]), [['place', 'Reschedule'], ['hardRegenerate', 'Regenerate'], ['reject', 'Reject']]);
  assert.equal(c.grid[0]!.plan.pick, 'slot');
  assert.deepEqual((c.grid[0]!.plan.body as { refs: Record<string, string> }).refs, { postIdeaId: post.refs.postIdeaId });
});

test('a failed Story set offers no Reschedule or Reject: a failed set is final, Regenerate builds a new one', () => {
  const base = published('stories');
  const c = card({ ...base, status: 'failed', postedAt: null, permalink: null });
  assert.ok(!c.grid.some((a) => a.key === 'place' || a.key === 'reject'));
});

test('a failed render with nothing to post offers no Reschedule', () => {
  const base = find((p) => p.vertical === 'explainers');
  const c = card({ ...base, status: 'failed', postedAt: null, publishAt: null, permalink: null, media: { kind: 'none', note: 'The render failed.' } });
  assert.ok(!c.grid.some((a) => a.key === 'place'));
});
```

Run: `npx tsx --test tests/social-hub-card-actions.test.ts`
Expected: FAIL: the failed grid is `['hardRegenerate']` only.

- [ ] **Step 2: Offer Reschedule and Reject on failed posts**

In `lib/social-hub/house.ts`, add above `actionsFor`:

```ts
/** Something to post: a video, slides or frames. A render that failed has none. */
function hasContent(post: HubPost): boolean {
  return !(post.media.kind === 'none' || (post.media.kind === 'slides' && post.media.slides.length === 0) || (post.media.kind === 'frames' && post.media.frames.length === 0));
}
```

In `actionsFor`, replace the Reject block's opening

```ts
  // Reject (D47): content that hasn't posted yet never will, for every type (2026-10-13: explainers too).
  if (post.status === 'ready' || post.status === 'scheduled') {
```

with

```ts
  // A failed post can go again (Phase B, B7): Reschedule into one of today's windows, or Reject.
  // Not a Story set (a failed set is final; Regenerate builds a new one), and not a render with nothing to post.
  const failedRetry = post.status === 'failed' && post.vertical !== 'stories' && hasContent(post);
  // Reject (D47): content that hasn't posted yet never will, for every type (2026-10-13: explainers too).
  if (post.status === 'ready' || post.status === 'scheduled' || failedRetry) {
```

replace

```ts
  if (post.status === 'ready' && !rejected) {
    plans.push({ kind: 'post', action: 'place', label: 'Schedule', endpoint: '/api/social-hub/actions/place', body: { vertical: post.vertical, refs: placeRefs }, disabled: Object.values(placeRefs).some((v) => !v) ? 'This content can’t be found any more.' : null, pick: 'slot' });
  }
```

with

```ts
  // A failed post's Reschedule books a new slot beside the failed one (placeItem, source 'user': a person picked it).
  if ((post.status === 'ready' || failedRetry) && !rejected) {
    plans.push({ kind: 'post', action: 'place', label: post.status === 'failed' ? 'Reschedule' : 'Schedule', endpoint: '/api/social-hub/actions/place', body: { vertical: post.vertical, refs: placeRefs }, disabled: Object.values(placeRefs).some((v) => !v) ? 'This content can’t be found any more.' : null, pick: 'slot' });
  }
```

and inside `if (live) {`, replace the `noContent` expression with:

```ts
    const noContent = hasContent(post) ? null : 'Nothing to publish yet. Regenerate first.';
```

- [ ] **Step 3: The failed card grid**

In `lib/social-hub/views/card-actions.ts`, change the `failed` entry of `GRID` to:

```ts
  failed: ['place', 'hardRegenerate', 'reject'],
```

and in `cardActions`, replace

```ts
      return p ? [offered(p, LABEL[a]!)] : [];
```

with

```ts
      // On a failed card, placing it again is a Reschedule (B7).
      return p ? [offered(p, group === 'failed' && a === 'place' ? 'Reschedule' : LABEL[a]!)] : [];
```

- [ ] **Step 4: Prove Reschedule books beside the failed slot (placement test)**

Append to `tests/social-hub-placement.test.ts`:

```ts
test('Reschedule on a failed post books a new slot today beside the failed one, as a person’s slot (B7)', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const booked = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-08', slot: 'morning', now: NOW, rng: first });
  assert.ok(booked.ok, booked.note);
  await pg.query(`UPDATE social_hub.schedule SET status = 'failed', error = 'Container never reached FINISHED' WHERE id = $1`, [(booked as { scheduleId: string }).scheduleId]);
  const again = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-08', slot: 'morning', now: NOW, rng: last });
  assert.ok(again.ok, again.note);
  const rows = (await pg.query<{ status: string; source: string }>(`SELECT status, source FROM social_hub.schedule WHERE content_item_id = $1 ORDER BY created_at`, [c.itemId])).rows;
  assert.deepEqual(rows.map((r) => [r.status, r.source]), [['failed', 'user'], ['scheduled', 'user']]);
});
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test tests/social-hub-card-actions.test.ts tests/social-hub-placement.test.ts tests/social-hub-actions.test.ts tests/social-hub-viewmodels.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/social-hub/house.ts lib/social-hub/views/card-actions.ts tests/social-hub-card-actions.test.ts tests/social-hub-placement.test.ts
git commit -m "feat(social-hub): Reschedule and Reject on a failed post's card (B7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Run didn't finish" on empty cards (B6)

A read-only reader turns today's run records into misses; a pure function matches them to empty cards. The page passes them to the strip. No worker change. Web only.

**Files:**
- Create: `lib/content-type/run-misses.ts`
- Modify: `components/social-hub/content/TodayStrip.tsx` (full file below)
- Modify: `components/social-hub/content/ContentScreen.tsx:10,25,67`
- Modify: `app/social/(hub)/page.tsx`
- Test: `tests/social-hub-run-misses.test.ts` (create)

**Interfaces:**
- Consumes: `HubQuery`, `liveHubQuery` from `lib/social-hub/db.ts`; `QuotaCandidate` from `lib/social-hub/views/day-rank.ts`; `ProgressItem` from `lib/content-type/progress.ts`; `cardTimeLine` (Task 4).
- Produces: `type RunMiss = { key: string | null; title: string; detail: string | null }`; `type RunMisses = Record<Vertical, RunMiss[]>`; `NO_MISSES`; `MISS_TITLE = 'Run didn’t finish'`; `readRunMisses(q: HubQuery, now?: Date): Promise<RunMisses>`; `missFor(c: QuotaCandidate, misses: RunMisses, run: ProgressItem | null): RunMiss | null`. `TodayStrip` and `ContentScreen` take an optional `misses?: RunMisses`.

- [ ] **Step 1: Write the failing tests**

Create `tests/social-hub-run-misses.test.ts`:

```ts
/**
 * "Run didn't finish" (B6): today's run records, per type, onto the empty
 * cards they explain. Only today's records (New York) count; a card with
 * content, or a run in flight, never shows it. Offline: the real schema
 * files on PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { ProgressItem } from '@/lib/content-type/progress';
import { MISS_TITLE, missFor, NO_MISSES, readRunMisses, type RunMisses } from '@/lib/content-type/run-misses';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-14T16:00:00Z'); // noon New York
const TODAY_2AM = '2026-10-14T06:05:00Z';
const YESTERDAY = '2026-10-13T16:00:00Z';

async function topic(pg: PGlite, title: string): Promise<string> {
  return (await pg.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ($1, 'manual', 'pool') RETURNING id::text AS id`, [title])).rows[0]!.id;
}
async function job(pg: PGlite, topicId: string, status: 'ok' | 'failed', requestedAt: string, error: string | null = null): Promise<void> {
  await pg.query(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, requested_at, error)
     VALUES ($1, $2, 'auto', 'production', 5, 'o', 'f', $3::timestamptz, $4)`,
    [topicId, status, requestedAt, error],
  );
}

test('explainers: the topic’s latest render failed today; yesterday’s, or one tried again since, does not count', async () => {
  const { pg, query } = await openHubTestDb();
  const a = await topic(pg, 'A');
  const b = await topic(pg, 'B');
  const c = await topic(pg, 'C');
  await job(pg, a, 'failed', TODAY_2AM, 'HeyGen render timed out');
  await job(pg, b, 'failed', YESTERDAY, 'old');
  await job(pg, c, 'failed', TODAY_2AM, 'first try');
  await job(pg, c, 'ok', '2026-10-14T09:00:00Z');
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.explainers, [{ key: a, title: MISS_TITLE, detail: 'HeyGen render timed out' }]);
});

test('stories: a set skipped or failed while being built today; a set that failed while posting is not one (Review Focus 5)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.query(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style, error, publish_at) VALUES
       ('free_vs_paid', '2026-10-14', 'skipped', 'auto', 'homemade', 'no good pair found', NULL),
       ('morning_download', '2026-10-14', 'failed', 'auto', 'polished', 'publish: container ERROR', '2026-10-14T13:00:00Z'),
       ('guess_the_number', '2026-10-13', 'failed', 'auto', 'homemade', 'old', NULL)`,
  );
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.stories, [{ key: 'free_vs_paid', title: MISS_TITLE, detail: 'Free vs. Paid: skipped, no good pair found' }]);
});

test('reels: an idea’s finish request failed today', async () => {
  const { pg, query } = await openHubTestDb();
  const run = (await pg.query<{ id: string }>(`INSERT INTO reels.runs (trigger, status) VALUES ('scheduled', 'ok') RETURNING id::text AS id`)).rows[0]!.id;
  const slate = (await pg.query<{ id: string }>(`INSERT INTO reels.score_slates (run_id, ny_date, pass1_version, pass2_version) VALUES ($1, '2026-10-14', 'p1', 'p2') RETURNING id::text AS id`, [run])).rows[0]!.id;
  const today = (await pg.query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text AS id`)).rows[0]!.id;
  const old = (await pg.query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text AS id`)).rows[0]!.id;
  await pg.query(
    `INSERT INTO reels.finish_requests (post_idea_id, slate_id, status, error, updated_at) VALUES
       ($1, $3, 'failed', 'Copy gate missed twice', $4::timestamptz),
       ($2, $3, 'failed', 'old', $5::timestamptz)`,
    [today, old, slate, TODAY_2AM, YESTERDAY],
  );
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.reels, [{ key: today, title: MISS_TITLE, detail: 'Copy gate missed twice' }]);
});

test('carousels: today’s latest daily run failed; a good run after it clears the line (Review Focus 5)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.query(
    `INSERT INTO social.runs (kind, hook_pass, cap_usd, trigger, status, requested_at, error)
     VALUES ('daily', true, 2, 'scheduled', 'failed', '2026-10-14T07:00:00Z', 'Spend cap reached')`,
  );
  assert.deepEqual((await readRunMisses(query, NOW)).carousels, [{ key: null, title: 'Tonight’s carousel run didn’t finish', detail: 'Spend cap reached' }]);
  await pg.query(
    `INSERT INTO social.runs (kind, hook_pass, cap_usd, trigger, status, requested_at)
     VALUES ('daily', true, 2, 'manual', 'ok', '2026-10-14T13:00:00Z')`,
  );
  assert.deepEqual((await readRunMisses(query, NOW)).carousels, []);
});

const idea = (id: string, vertical: HubIdea['vertical']) => ({ id, vertical, title: id }) as unknown as HubIdea;
const card = (o: Partial<QuotaCandidate> & Pick<QuotaCandidate, 'vertical'>): QuotaCandidate => ({ idea: null, post: null, locked: false, rank: 1, moved: null, ...o });
const MISSES: RunMisses = {
  ...NO_MISSES,
  explainers: [{ key: 'T1', title: MISS_TITLE, detail: 'HeyGen render timed out' }],
  stories: [{ key: 'free_vs_paid', title: MISS_TITLE, detail: 'Free vs. Paid: skipped, no good pair found' }],
  carousels: [{ key: null, title: 'Tonight’s carousel run didn’t finish', detail: null }],
};

test('missFor: the idea’s or series’ miss on an empty card; every empty carousel card; never on a card with content or a run in flight', () => {
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T1', 'explainers') }), MISSES, null)?.detail, 'HeyGen render timed out');
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T2', 'explainers') }), MISSES, null), null);
  assert.equal(missFor(card({ vertical: 'stories', seriesId: 'free_vs_paid', series: 'Free vs. Paid' }), MISSES, null)?.key, 'free_vs_paid');
  assert.equal(missFor(card({ vertical: 'carousels' }), MISSES, null)?.title, 'Tonight’s carousel run didn’t finish');
  assert.equal(missFor(card({ vertical: 'carousels', post: { id: 'p' } as HubPost }), MISSES, null), null, 'a card with content');
  const running = { id: 'r', label: 'x', state: 'running', stage: null, error: null, topicId: 'T1', requestedAt: TODAY_2AM, startedAt: TODAY_2AM, typicalSeconds: null } as ProgressItem;
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T1', 'explainers') }), MISSES, running), null, 'a run in flight');
});
```

Run: `npx tsx --test tests/social-hub-run-misses.test.ts`
Expected: FAIL with "Cannot find module '@/lib/content-type/run-misses'".

- [ ] **Step 2: Write the reader and the matcher**

Create `lib/content-type/run-misses.ts`:

```ts
import type { ProgressItem } from '@/lib/content-type/progress';
import type { HubQuery } from '@/lib/social-hub/db';
import { nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

/**
 * "Run didn't finish" (Content page Phase B, B6): today's runs (New York
 * date) that ended without content, read from the records each type already
 * writes. Read only; no worker change.
 *
 *   Explainers  the topic's latest render failed, requested today        → that idea's card
 *   Stories     today's set was skipped, or failed while being built     → that series' card
 *   Reels       the idea's finish request failed today                   → that idea's card
 *   Carousels   today's latest daily run failed                          → every empty carousel card
 *
 * A Stories set that failed after it had a minute failed while posting: it was
 * made, so it is not a run that didn't finish.
 */
export type RunMiss = { key: string | null; title: string; detail: string | null };
export type RunMisses = Record<Vertical, RunMiss[]>;

export const NO_MISSES: RunMisses = { reels: [], carousels: [], explainers: [], stories: [] };
export const MISS_TITLE = 'Run didn’t finish';

const DETAIL_MAX = 140;
const short = (text: string | null | undefined): string | null => {
  const t = text?.trim();
  if (!t) return null;
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX - 1)}…` : t;
};
const SERIES: Record<string, string> = SERIES_LABEL;

export async function readRunMisses(q: HubQuery, now = new Date()): Promise<RunMisses> {
  const today = nyDateOf(now)!;
  // A type whose tables can't be read shows no line; the card keeps "Not made yet".
  const read = <T,>(p: Promise<{ rows: T[] }>): Promise<T[]> => p.then((r) => r.rows).catch(() => [] as T[]);
  const [explainers, stories, reels, carousels] = await Promise.all([
    read(q<{ key: string; reason: string | null }>(
      `SELECT j.topic_id::text AS key, j.error AS reason
         FROM explainers.jobs j
        WHERE j.id IN (SELECT DISTINCT ON (topic_id) id FROM explainers.jobs ORDER BY topic_id, requested_at DESC, seq DESC)
          AND j.status = 'failed'
          AND (j.requested_at AT TIME ZONE 'America/New_York')::date = $1::date`,
      [today],
    )),
    read(q<{ key: string; status: string; reason: string | null }>(
      `SELECT series AS key, status, error AS reason
         FROM stories.sets
        WHERE ny_date = $1::date
          AND (status = 'skipped' OR (status = 'failed' AND publish_at IS NULL))
        ORDER BY updated_at DESC`,
      [today],
    )),
    read(q<{ key: string; reason: string | null }>(
      `SELECT post_idea_id::text AS key, error AS reason
         FROM reels.finish_requests
        WHERE status = 'failed' AND (updated_at AT TIME ZONE 'America/New_York')::date = $1::date`,
      [today],
    )),
    read(q<{ status: string; trigger: string; reason: string | null }>(
      `SELECT status, trigger, error AS reason
         FROM social.runs
        WHERE kind = 'daily' AND (requested_at AT TIME ZONE 'America/New_York')::date = $1::date
        ORDER BY requested_at DESC
        LIMIT 1`,
      [today],
    )),
  ]);
  return {
    explainers: explainers.map((r) => ({ key: r.key, title: MISS_TITLE, detail: short(r.reason) })),
    reels: reels.map((r) => ({ key: r.key, title: MISS_TITLE, detail: short(r.reason) })),
    stories: stories.map((r) => {
      const why = short(r.reason);
      return { key: r.key, title: MISS_TITLE, detail: `${SERIES[r.key] ?? r.key}: ${r.status}${why ? `, ${why}` : ''}` };
    }),
    carousels: carousels
      .filter((r) => r.status === 'failed')
      .map((r) => ({
        key: null,
        title: r.trigger === 'scheduled' ? 'Tonight’s carousel run didn’t finish' : 'The carousel run didn’t finish',
        detail: short(r.reason),
      })),
  };
}

/** The miss an empty card shows: never on a card with content or with a run in flight. */
export function missFor(c: QuotaCandidate, misses: RunMisses, run: ProgressItem | null): RunMiss | null {
  if (c.post || run) return null;
  const list = misses[c.vertical] ?? [];
  if (c.vertical === 'carousels') return list[0] ?? null;
  if (c.vertical === 'stories') return c.seriesId ? list.find((m) => m.key === c.seriesId) ?? null : null;
  const ideaId = c.idea?.id;
  if (!ideaId) return null;
  return list.find((m) => m.key != null && (ideaId === m.key || ideaId.endsWith(`:${m.key}`))) ?? null;
}
```

Run: `npx tsx --test tests/social-hub-run-misses.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 3: Show it on the card**

Replace `components/social-hub/content/TodayStrip.tsx` with:

```tsx
import { Loader2, TriangleAlert } from 'lucide-react';

import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import { missFor, NO_MISSES, type RunMiss, type RunMisses } from '@/lib/content-type/run-misses';
import { stageLabel } from '@/lib/content-type/run-status';
import { CardMedia } from '@/components/social-hub/content/CardMedia';
import { MakeItButton } from '@/components/social-hub/content/MakeItButton';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TYPE_ICON, TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import type { HubPost } from '@/lib/social-hub/types';
import { ideaRef } from '@/lib/social-hub/run-today';
import { cardTimeLine } from '@/lib/social-hub/views/card-time';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { canMakeCard, runForCandidate, runOnMadeCard } from '@/lib/social-hub/views/run-for';

/**
 * Today's Content (spec 2026-10-13 §2): the day's cards in one row, in posting
 * order. A made card shows the content itself (hover to play or step through)
 * and its buttons; a card not made yet shows its idea and Make it, and says
 * why when today's run for it didn't finish (Phase B, B6).
 */

function RunChip({ run }: { run: ProgressItem | null }) {
  if (!run) return null;
  return (
    <span className="sh-run-chip" role="status">
      <Loader2 size={13} className="sh-spin" aria-hidden="true" />
      {run.state === 'running' ? stageLabel(run.stage) : 'Queued'}
    </span>
  );
}

export function TodayStrip({ candidates, o, runs, misses = NO_MISSES, controls = true }: { candidates: QuotaCandidate[]; o: Offerer; runs: AllProgress; misses?: RunMisses; /** False on the preview page: buttons show but can't be clicked, and Make it is hidden. */ controls?: boolean }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {candidates.map((c, i) => {
        const run = runForCandidate(c, runs);
        return c.post
          ? <Made key={c.post.id} post={c.post} o={o} run={runOnMadeCard(c.post, run)} controls={controls} />
          : <Pending key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} run={run} miss={missFor(c, misses, run)} controls={controls} />;
      })}
    </ul>
  );
}

function Made({ post, o, run, controls }: { post: HubPost; o: Offerer; run: ProgressItem | null; controls: boolean }) {
  const offer = o.offer(post);
  const { primary, grid } = offer.card;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card" style={{ listStyle: 'none' }}>
      <CardMedia post={post} />
      <div className="sh-gallery__meta">
        <TypeMark vertical={post.vertical} />
        <span>{cardTimeLine(post)}</span>
      </div>
      <PostLink id={post.id} className="sh-strip__name">{displayName(post)}</PostLink>
      {run ? <RunChip run={run} /> : <StateBadge state={offer.state} />}
      {post.status === 'published' && post.permalink ? (
        <a className="sh-out sh-gallery__view" href={post.permalink} target="_blank" rel="noreferrer">View on Instagram</a>
      ) : null}
      {!run && (primary || grid.length) ? (
        <ActionBar menu={{ primary, secondary: grid, more: [], links: [], offNote: null }} variant="card" showOffNote={false} readOnly={!controls} />
      ) : null}
    </li>
  );
}

function Pending({ c, run, miss, controls }: { c: QuotaCandidate; run: ProgressItem | null; miss: RunMiss | null; controls: boolean }) {
  const Icon = TYPE_ICON[c.vertical];
  const tag = c.rank == null ? null : `#${c.rank} in the queue${c.moved === 'promoted' ? ' · Promoted' : c.moved === 'demoted' ? ' · Demoted' : ''}`;
  const target = c.vertical === 'stories' ? c.seriesId : c.idea ? ideaRef(c.idea.id) : undefined;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card is-pending" style={{ listStyle: 'none' }}>
      <span className={`sh-strip__art sh-gallery__art${c.vertical === 'carousels' ? '' : ' is-tall'}`}>
        <span className="sh-gallery__frame" style={typeStyle(c.vertical)} aria-hidden="true">
          {miss
            ? <span className="sh-gallery__empty"><TriangleAlert size={22} />{miss.title}</span>
            : <span className="sh-gallery__empty"><Icon size={22} />Not made yet</span>}
        </span>
      </span>
      <div className="sh-gallery__meta">
        <TypeMark vertical={c.vertical} />
        <span>{tag ?? (c.series ? c.series : 'Open slot')}</span>
      </div>
      <span className="sh-strip__name">{c.idea?.title ?? (c.series ? `${c.series}: today’s set` : 'Open slot: the next run picks its idea')}</span>
      {miss ? <span className="sh-muted sh-gallery__hint" role="status">{miss.title}{miss.detail ? `: ${miss.detail}` : ''}</span> : null}
      {run ? <RunChip run={run} /> : !controls ? <span className="sh-muted sh-gallery__hint">Make it builds this card.</span> : canMakeCard(c) ? <MakeItButton vertical={c.vertical} target={target} /> : <span className="sh-muted sh-gallery__hint">Run now makes it.</span>}
    </li>
  );
}
```

(The art frame is `aria-hidden`, so the visible-to-screen-readers line under the name carries the title and reason.)

- [ ] **Step 4: Pass misses from the page**

In `components/social-hub/content/ContentScreen.tsx`:
- add `import type { RunMisses } from '@/lib/content-type/run-misses';` under the `AllProgress` import;
- change the signature to `export function ContentScreen({ dataset, base, now, libraries, progress, misses, controls = true }: { dataset: HubDataset; base: string; now: Date; libraries: LibrariesModel; progress?: AllProgress; misses?: RunMisses; controls?: boolean }) {`;
- change `<TodayStrip candidates={today} o={o} runs={runs} controls={controls} />` to `<TodayStrip candidates={today} o={o} runs={runs} misses={misses} controls={controls} />`.

Replace `app/social/(hub)/page.tsx` with:

```tsx
import { notFound, redirect } from 'next/navigation';

import { ContentScreen } from '@/components/social-hub/content/ContentScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { loadLibraries } from '@/lib/social-hub/views/libraries';
import { readAllProgress } from '@/lib/content-type/progress';
import { NO_MISSES, readRunMisses } from '@/lib/content-type/run-misses';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.house) notFound();
  const params = toParams(await searchParams);
  const legacy = legacyRootRedirect(HUB_BASE, params);
  if (legacy) redirect(legacy);
  const session = await getSession();
  if (!session) redirect('/');
  const [loaded, libraries, progress, misses] = await Promise.all([
    loadForPage(session.email),
    loadLibraries(liveHubQuery),
    readAllProgress(),
    readRunMisses(liveHubQuery).catch(() => NO_MISSES),
  ]);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return <ContentScreen dataset={loaded} base={HUB_BASE} now={new Date()} libraries={libraries} progress={progress} misses={misses} />;
}
```

- [ ] **Step 5: Type check and the hub suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npx tsx --test tests/social-hub-run-misses.test.ts tests/social-hub-scope.test.ts tests/social-hub-run-for.test.ts tests/social-hub-card-time.test.ts`
Expected: no type errors; PASS, `ℹ fail 0` (`social-hub-scope` confirms the new reader only SELECTs and reaches no network module).

- [ ] **Step 6: Commit**

```bash
git add lib/content-type/run-misses.ts components/social-hub/content/TodayStrip.tsx components/social-hub/content/ContentScreen.tsx "app/social/(hub)/page.tsx" tests/social-hub-run-misses.test.ts
git commit -m "feat(social-hub): empty cards say when today's run didn't finish, and why (B6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Promote/Demote last until used (B8) — schema + worker code

A move stays active until its idea gets content made after it (reels, carousels, explainers) or its Stories pool entry is used. The hub marks used moves `consumed_at` in one place when it loads the dataset; nothing else writes it. The Stories build reads active moves instead of today's. **Schema first, then VM redeploy (Task 9).**

**Files:**
- Modify: `db/social_hub_schema.sql:338-355` (comment; append the column and index)
- Modify: `lib/social-hub/views/day-rank.ts:7-24,26,64-90` (type, `movesFor`, `dayRanking`, `ownsIdeaId`, `madeMoveIds`)
- Modify: `lib/content-type/model.ts:124`
- Modify: `lib/social-hub/queries/day.ts:1-20` (`readAdjustments`, `consumeMoves`)
- Modify: `lib/social-hub/load.ts:12,53-70`
- Modify: `lib/content-type/idea-rank.ts:5-10` (doc comment only)
- Modify: `lib/stories/build/index.ts:96-130` (`activeStoryMoves`, `inDayOrder`)
- Test: `tests/social-hub-run-today.test.ts` (update), `tests/social-hub-idea-moves.test.ts` (create)

**Interfaces:**
- Consumes: `HubPost.idea.id`, `HubPost.generatedAt`, `HubPost.status`; `stories.pool.used_at`.
- Produces: `IdeaAdjustment = { id: string; vertical: Vertical; ideaId: string; nyDate: string; kind: 'promote' | 'demote'; createdAt: string }` (`createdAt` ISO, e.g. `2026-10-14T13:00:00.000Z`); `movesFor(adjustments, vertical)`; `dayRanking(ideas, vertical, adjustments)` (the `nyDate` parameter is gone); `ownsIdeaId(ideaId: string, post: HubPost): boolean`; `madeMoveIds(adjustments, posts): string[]`; `readAdjustments(q, nyDate)` returns active moves (fallback: today's); `consumeMoves(q: HubQuery, adjustments: readonly IdeaAdjustment[], posts: readonly HubPost[]): Promise<IdeaAdjustment[]>`; `activeStoryMoves(db: StoriesDb, series: string): Promise<Array<{ ideaId: string; kind: 'promote' | 'demote' }>>` from `lib/stories/build/index.ts`.

- [ ] **Step 1: Add the column (schema)**

In `db/social_hub_schema.sql`, change the comment above `CREATE TABLE IF NOT EXISTS social_hub.idea_adjustments` from

```sql
-- demote moves it below the idea right under it. They expire with the day.
```

to

```sql
-- demote moves it below the idea right under it. Since Phase B (B8) a move lasts
-- until its idea is made (or its Stories pool entry is used): consumed_at.
```

and append at the end of the file:

```sql

-- Content page Phase B (B8, 2026-10-14): a move steers until it is used, not until midnight.
-- ny_date stays the day it was made. The hub sets consumed_at when it loads (lib/social-hub/queries/day.ts).
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_social_hub_idea_adjustments_active
    ON social_hub.idea_adjustments (vertical, created_at) WHERE consumed_at IS NULL;
```

- [ ] **Step 2: Update the ranking tests (failing)**

In `tests/social-hub-run-today.test.ts`:

(a) change the day-rank import to `import { applyMoves, dayRanking, madeMoveIds, orderCards, quotaCandidates, type IdeaAdjustment } from '@/lib/social-hub/views/day-rank';`

(b) replace the `move` and `titles` helpers with:

```ts
const move = (n: number, kind: 'promote' | 'demote', at: string): IdeaAdjustment => ({ id: `m-${n}-${kind}-${at}`, vertical: 'reels', ideaId: IDEAS[n - 1]!.id, nyDate: TODAY, kind, createdAt: at });
const titles = (adj: IdeaAdjustment[]) => dayRanking(IDEAS, 'reels', adj).map((r) => r.idea.title);
```

(c) in the test `'Promote makes an idea #1 for the day; Demote moves it below the next one'`, replace the line asserting `'yesterday’s moves are gone'` with:

```ts
  assert.deepEqual(titles([{ ...move(3, 'promote', 't1'), nyDate: '2026-10-08' }]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4'], 'a move from yesterday still steers until its idea is made (B8)');
```

(d) append, after the `reelPost` helper's tests:

```ts
test('a move is used up when its idea gets content made after it; content made before it, or still being made, keeps it (B8)', () => {
  const m = move(1, 'promote', '2026-10-09T06:00:00.000Z');
  const madeAfter = reelPost(1, { generatedAt: '2026-10-09T07:00:00Z' });
  assert.deepEqual(madeMoveIds([m], [madeAfter]), [m.id]);
  assert.deepEqual(madeMoveIds([m], [reelPost(1, { generatedAt: '2026-10-09T05:00:00Z' })]), [], 'Review Focus 4: content made before the move keeps it');
  assert.deepEqual(madeMoveIds([m], [reelPost(1, { status: 'generating', generatedAt: '2026-10-09T07:00:00Z' })]), [], 'still being made');
  assert.deepEqual(madeMoveIds([m], [reelPost(2, { generatedAt: '2026-10-09T07:00:00Z' })]), [], 'another idea');
  const rejected = reelPost(1, { generatedAt: '2026-10-09T07:00:00Z', tries: [{ status: 'cancelled', at: '2026-10-09T08:00:00Z', note: 'This reel was rejected, so it was not posted.' }] });
  assert.deepEqual(madeMoveIds([m], [rejected]), [m.id], 'made, then rejected: used up');
  assert.deepEqual(madeMoveIds([{ ...m, vertical: 'stories', ideaId: 'stories:pool:free_vs_paid:k' }], [madeAfter]), [], 'Stories go by their pool entry');
});
```

Run: `npx tsx --test tests/social-hub-run-today.test.ts`
Expected: FAIL: `madeMoveIds` is not exported, and yesterday's move is still filtered out.

- [ ] **Step 3: Moves by use, not by day (pure)**

In `lib/social-hub/views/day-rank.ts`:

(a) in the header comment, replace `ranking, and expire with the day.` with `ranking, and last until their idea is made (B8).`

(b) replace the `IdeaAdjustment` type with:

```ts
/** A person's Promote / Demote. `nyDate` is the day it was made; it steers until used (consumed_at, B8). `createdAt` is ISO. */
export type IdeaAdjustment = { id: string; vertical: Vertical; ideaId: string; nyDate: string; kind: 'promote' | 'demote'; createdAt: string };
```

(c) replace `movesFor`, `dayRanking`'s signature line and its `const moves` line, and `ideaOwns` with:

```ts
/** A type's active moves (not used yet, any day), oldest first. */
export function movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical): IdeaAdjustment[] {
  return adjustments.filter((a) => a.vertical === vertical).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

```ts
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[]): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical);
```

```ts
/** A post belongs to an idea id when it names it (bare, or as the id's last part). */
export function ownsIdeaId(ideaId: string, post: HubPost): boolean {
  const ref = post.idea?.id;
  return Boolean(ref) && (ideaId === ref || ideaId.endsWith(`:${ref}`));
}

/** A post belongs to an idea when it names it (bare, or as the idea id's last part). */
export function ideaOwns(idea: HubIdea, post: HubPost): boolean {
  return ownsIdeaId(idea.id, post);
}

/**
 * Moves used up (B8): the idea got content made after the move (anything but
 * still being made; a rejection follows a making, so it counts too). Content
 * made before the move doesn't use it: a person promoted an idea that already
 * had content on purpose. Stories go by their pool entry (queries/day.ts).
 */
export function madeMoveIds(adjustments: readonly IdeaAdjustment[], posts: readonly HubPost[]): string[] {
  return adjustments
    .filter((a) => a.vertical !== 'stories' && posts.some((p) =>
      p.vertical === a.vertical
      && p.status !== 'generating'
      && ownsIdeaId(a.ideaId, p)
      && p.generatedAt != null
      && Date.parse(p.generatedAt) >= Date.parse(a.createdAt)))
    .map((a) => a.id);
}
```

(d) in `quotaCandidates`, change `const full = dayRanking(data.ideas, vertical, data.adjustments ?? [], today);` to `const full = dayRanking(data.ideas, vertical, data.adjustments ?? []);`.

In `lib/content-type/model.ts:124`, change `const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? [], today);` to `const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? []);` (`today` stays: the function still uses it for `byDay`).

Run: `npx tsx --test tests/social-hub-run-today.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 4: Write the database tests (failing)**

Create `tests/social-hub-idea-moves.test.ts`:

```ts
/**
 * Promote / Demote last until used (B8), on PGlite with the real schema
 * files: the hub reads active moves from any day, marks used ones consumed in
 * one place, and falls back to today's moves before the column exists. The
 * Stories build reads the same active moves.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubQuery } from '@/lib/social-hub/db';
import { consumeMoves, readAdjustments } from '@/lib/social-hub/queries/day';
import type { HubPost } from '@/lib/social-hub/types';
import { activeStoryMoves } from '@/lib/stories/build';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const TODAY = '2026-10-14';
const YESTERDAY = '2026-10-13';

async function addMove(q: HubQuery, vertical: string, ideaId: string, nyDate: string, kind: 'promote' | 'demote', createdAt: string): Promise<string> {
  return (await q<{ id: string }>(
    `INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ($1, $2, $3::date, $4, $5::timestamptz) RETURNING id::text AS id`,
    [vertical, ideaId, nyDate, kind, createdAt],
  )).rows[0]!.id;
}

test('readAdjustments: unused moves from any day, oldest first, with ISO times; used ones are gone', async () => {
  const { query: q } = await openHubTestDb();
  const old = await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  const used = await addMove(q, 'reels', 'reels:idea:b', YESTERDAY, 'demote', '2026-10-13T16:00:00Z');
  const fresh = await addMove(q, 'carousels', 'carousels:story:s1', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = $1`, [used]);
  const got = await readAdjustments(q, TODAY);
  assert.deepEqual(got.map((a) => [a.id, a.nyDate, a.createdAt]), [[old, YESTERDAY, '2026-10-13T15:00:00.000Z'], [fresh, TODAY, '2026-10-14T13:00:00.000Z']]);
});

test('readAdjustments before the consumed_at column is applied: today’s moves, as before Phase B', async () => {
  const { pg, query: q } = await openHubTestDb();
  await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  const today = await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await pg.exec(`ALTER TABLE social_hub.idea_adjustments DROP COLUMN consumed_at`);
  assert.deepEqual((await readAdjustments(q, TODAY)).map((a) => a.id), [today]);
});

test('consumeMoves: a move whose idea got content after it, and a Stories move whose pool entry was used, are marked and drop out', async () => {
  const { query: q } = await openHubTestDb();
  const reel = await addMove(q, 'reels', 'reels:idea:a', TODAY, 'promote', '2026-10-14T13:00:00Z');
  const keep = await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:05:00Z');
  const story = await addMove(q, 'stories', 'stories:pool:free_vs_paid:pair-1', YESTERDAY, 'promote', '2026-10-13T12:00:00Z');
  await q(`INSERT INTO stories.pool (series, key, origin, ref, title, used_at) VALUES ('free_vs_paid', 'pair-1', 'catalog', 'r', 'Pair 1', now())`);
  const posts = [{ id: 'p1', vertical: 'reels', status: 'ready', idea: { id: 'a', label: 'A' }, generatedAt: '2026-10-14T14:00:00Z' }] as unknown as HubPost[];
  const active = await consumeMoves(q, await readAdjustments(q, TODAY), posts);
  assert.deepEqual(active.map((a) => a.id), [keep]);
  const consumed = (await q<{ id: string }>(`SELECT id::text AS id FROM social_hub.idea_adjustments WHERE consumed_at IS NOT NULL`)).rows.map((r) => r.id);
  assert.deepEqual(consumed.sort(), [reel, story].sort());
  assert.deepEqual((await readAdjustments(q, TODAY)).map((a) => a.id), [keep], 'the next read no longer sees them');
});

test('the Stories build reads the series’ unused moves from any day, as pool keys', async () => {
  const { db } = await harnessDb();
  const add = (ideaId: string, kind: string, at: string) =>
    db.query<{ id: string }>(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('stories', $1, $2::date, $3, $4::timestamptz) RETURNING id::text AS id`, [ideaId, at.slice(0, 10), kind, at]);
  await add('stories:pool:free_vs_paid:k1', 'promote', '2026-10-13T12:00:00Z');
  const used = (await add('stories:pool:free_vs_paid:k2', 'demote', '2026-10-13T12:05:00Z')).rows[0]!.id;
  await add('stories:pool:morning_download:k3', 'promote', '2026-10-14T12:00:00Z');
  await db.query(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = $1`, [used]);
  assert.deepEqual(await activeStoryMoves(db, 'free_vs_paid'), [{ ideaId: 'k1', kind: 'promote' }]);
});
```

Run: `npx tsx --test tests/social-hub-idea-moves.test.ts`
Expected: FAIL: `consumeMoves` and `activeStoryMoves` are not exported; `readAdjustments` still filters by day.

- [ ] **Step 5: Read active moves; consume in one place**

In `lib/social-hub/queries/day.ts`:

(a) replace its two import lines (`import type { HubQuery } …` and `import type { DayQuotas, IdeaAdjustment } …`) with:

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import type { HubPost } from '@/lib/social-hub/types';
import { madeMoveIds, type DayQuotas, type IdeaAdjustment } from '@/lib/social-hub/views/day-rank';
```

(b) in the file's header comment, replace `The day's ranking inputs (SELECT only): a person's Promote / Demote moves for the day, and each type's posts per day.` with `The day's ranking inputs: a person's Promote / Demote moves still in force (consumeMoves is the only write: it marks used moves), and each type's posts per day.` (keep the comment's line breaks as they are);

(c) leave `DEFAULT_DAY_QUOTAS` and `readDayQuotas` as they are, and replace the whole `readAdjustments` function with:

```ts
type AdjustmentRow = { id: string; vertical: IdeaAdjustment['vertical']; idea_id: string; ny_date: string; kind: IdeaAdjustment['kind']; created_at: string };

const ADJUSTMENT_COLS = `id::text AS id, vertical, idea_id, ny_date::text AS ny_date, kind,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;

const toAdjustment = (r: AdjustmentRow): IdeaAdjustment => ({ id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: r.ny_date.slice(0, 10), kind: r.kind, createdAt: r.created_at });

/**
 * The moves still steering (B8): not used yet, from any day, oldest first.
 * Before the consumed_at column is applied, today's moves, as before Phase B.
 */
export async function readAdjustments(q: HubQuery, nyDate: string): Promise<IdeaAdjustment[]> {
  try {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE consumed_at IS NULL ORDER BY created_at`);
    return rows.map(toAdjustment);
  } catch {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE ny_date = $1::date ORDER BY created_at`, [nyDate]);
    return rows.map(toAdjustment);
  }
}

/**
 * Use up moves (B8), the one place it happens: a move whose idea got content
 * after it (madeMoveIds, from the posts the hub just loaded, whichever
 * database they live in), or a Stories move whose pool entry the build used
 * (stories.pool.used_at). Marks them consumed and returns the rest. No worker
 * writes consumed_at.
 */
export async function consumeMoves(q: HubQuery, adjustments: readonly IdeaAdjustment[], posts: readonly HubPost[]): Promise<IdeaAdjustment[]> {
  if (!adjustments.length) return [];
  const used = new Set(madeMoveIds(adjustments, posts));
  if (adjustments.some((a) => a.vertical === 'stories')) {
    const { rows } = await q<{ id: string }>(
      `SELECT a.id::text AS id
         FROM social_hub.idea_adjustments a
         JOIN stories.pool p ON a.idea_id = 'stories:pool:' || p.series || ':' || p.key
        WHERE a.vertical = 'stories' AND a.consumed_at IS NULL AND p.used_at IS NOT NULL`,
    );
    for (const r of rows) used.add(r.id);
  }
  if (!used.size) return [...adjustments];
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = ANY($1::uuid[]) AND consumed_at IS NULL`, [[...used]]);
  return adjustments.filter((a) => !used.has(a.id));
}
```

In `lib/social-hub/load.ts`, change `import { readAdjustments, readDayQuotas } from '@/lib/social-hub/queries/day';` to `import { consumeMoves, readAdjustments, readDayQuotas } from '@/lib/social-hub/queries/day';`, and replace the last line of `loadDataset`

```ts
  return { ...withoutDeleted(buildDataset(reads, costs, now, newest, account), deleted), adjustments, dayQuotas };
```

with

```ts
  const dataset = withoutDeleted(buildDataset(reads, costs, now, newest, account), deleted);
  // B8: moves last until their idea is made; used ones are marked here and drop out. A failure never fails the page.
  const active = await consumeMoves(q, adjustments, dataset.posts).catch(() => adjustments);
  return { ...dataset, adjustments: active, dayQuotas };
```

In `lib/content-type/idea-rank.ts`, replace the doc sentence `Moves expire with the day.` with `A move lasts until its idea is made (B8; lib/social-hub/queries/day.ts consumeMoves).` (`recordRankMove` is unchanged).

- [ ] **Step 6: The Stories build reads active moves**

In `lib/stories/build/index.ts`, replace `inDayOrder` and its doc comment with:

```ts
/**
 * A series' active Promote / Demote moves (social_hub.idea_adjustments, the
 * hub's `stories:pool:<series>:<key>` ids), oldest first, as pool keys. A
 * move steers until its pool entry is used (B8; the hub marks it consumed),
 * not until midnight.
 */
export async function activeStoryMoves(db: SetBuilderDeps['db'], series: string): Promise<Array<{ ideaId: string; kind: 'promote' | 'demote' }>> {
  const prefix = `stories:pool:${series}:`;
  const { rows } = await db
    .query<{ idea_id: string; kind: 'promote' | 'demote' }>(
      `SELECT idea_id, kind FROM social_hub.idea_adjustments
        WHERE vertical = 'stories' AND consumed_at IS NULL AND idea_id LIKE $1
        ORDER BY created_at`,
      [`${prefix}%`],
    )
    .catch(() => ({ rows: [] as Array<{ idea_id: string; kind: 'promote' | 'demote' }> }));
  return rows.map((r) => ({ ideaId: r.idea_id.slice(prefix.length), kind: r.kind }));
}

/** The series' pool in the hub's order: its active moves applied in order, so a promoted idea is first in the build's list. */
async function inDayOrder(db: SetBuilderDeps['db'], series: string, pool: OpenPool): Promise<OpenPool> {
  const moves = await activeStoryMoves(db, series);
  if (!moves.length) return pool;
  const order = <T>(list: T[], key: (x: T) => string) => applyMoves(list.map((x) => ({ id: key(x), x })), moves).map((w) => w.x);
  return {
    stories: order(pool.stories, (c) => c.key),
    numbers: order(pool.numbers, (n) => n.key),
    unbriefed: order(pool.unbriefed, (c) => `story:${c.key}`),
    leads: order(pool.leads, (l) => storyKey(l.url)),
  };
}
```

and in `seriesPool` change `return await inDayOrder(deps.db, series, await openPool(deps.db, series), now);` to `return await inDayOrder(deps.db, series, await openPool(deps.db, series));`.

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test tests/social-hub-idea-moves.test.ts tests/social-hub-run-today.test.ts tests/stories-pipeline.test.ts tests/social-hub-account.test.ts tests/social-hub-scope.test.ts`
Expected: PASS, `ℹ fail 0` (`social-hub-account` applies the schema file twice: the new statements are idempotent; `social-hub-scope` accepts the UPDATE because it targets `social_hub.`).

- [ ] **Step 8: Type check and the whole suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add db/social_hub_schema.sql lib/social-hub/views/day-rank.ts lib/content-type/model.ts lib/social-hub/queries/day.ts lib/social-hub/load.ts lib/content-type/idea-rank.ts lib/stories/build/index.ts tests/social-hub-run-today.test.ts tests/social-hub-idea-moves.test.ts
git commit -m "feat(social-hub): Promote/Demote last until their idea is made (B8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Explainers book at finish (B2) — worker code, last

When the 2 AM run (`trigger = 'auto'`) finishes a render, it takes today's next open window as a system slot, unapproved. It still needs Approve to post; without it the slot is cancelled at its time (Task 2). Booking only, never `queuePublish`, only while `publishing_live`. **VM redeploy (Task 9).**

**Files:**
- Modify: `lib/explainers/publish/schedule.ts:1-10` (import), add `bookFinishedRender` after `scheduleJob`
- Modify: `scripts/explainers_worker.ts:67,97-105` (import; `renderNext`)
- Test: `tests/explainers-publish.test.ts` (`renderedJob` gets a `trigger` option; new tests)

**Interfaces:**
- Consumes: `scheduleJob(db, jobId, 'auto', now, throughDate, rng)` (Task 3); `publishingLive(db)`; `calendarDateKey(now, SOCIAL_TIMEZONE)` from `lib/instagram/clock.ts`; an unapproved slot is cancelled at its time (Task 2).
- Produces: `bookFinishedRender(db: Queryable, job: { id: string; trigger: string }, now?: Date, rng?: (count: number) => number): Promise<ScheduleOutcome | null>`: `null` when not booked by rule (not the 2 AM run, or publishing off), else `scheduleJob`'s outcome.

- [ ] **Step 1: Give `renderedJob` a trigger and write the failing tests**

In `tests/explainers-publish.test.ts`:

(a) change the import `import { publishingLive, releaseDueSchedules, scheduleApproved } from '@/lib/explainers/publish/schedule';` to:

```ts
import { bookFinishedRender, publishingLive, releaseDueSchedules, scheduleApproved } from '@/lib/explainers/publish/schedule';
```

(b) in `renderedJob`, change the `opts` type to `{ verdict?: 'approved' | 'rejected' | null; location?: 'local' | 'bucket'; caption?: string | null; title?: string; trigger?: 'click' | 'auto' }` and replace its job insert with:

```ts
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', $2, 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id, opts.trigger ?? 'click'],
  );
```

(c) append:

```ts
const liveOn = (db: Queryable) =>
  db.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
const explainerSlots = async (db: Queryable) =>
  (await db.query<{ d: string; slot: string; source: string; status: string }>(`SELECT ny_date::text AS d, slot, source, status FROM social_hub.schedule WHERE vertical = 'explainers'`)).rows;
const FINISHED_3AM = new Date('2026-10-08T07:10:00Z'); // 3:10 AM New York

test('B2: a render the 2 AM run finished takes today’s next open window, unapproved, and is never queued', async () => {
  const { db } = await scratchExplainersDb();
  await liveOn(db);
  const jobId = await renderedJob(db, { verdict: null, trigger: 'auto' });
  const out = await bookFinishedRender(db, { id: jobId, trigger: 'auto' }, FINISHED_3AM, () => 0);
  assert.equal(out?.scheduled, true);
  assert.deepEqual((await explainerSlots(db)).map((s) => [s.d, s.slot, s.source, s.status]), [['2026-10-08', 'afternoon', 'auto', 'scheduled']]);
  assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n), 0, 'booking only');
  // Nobody approves it before its time: cancelled, never posted (B3).
  await db.query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(db), 0);
  assert.equal((await explainerSlots(db))[0]!.status, 'cancelled');
});

test('B2: a person’s render (Regenerate, Make it) is not booked at finish; Approve books it (Review Focus 3)', async () => {
  const { db } = await scratchExplainersDb();
  await liveOn(db);
  const jobId = await renderedJob(db, { verdict: null, trigger: 'click' });
  assert.equal(await bookFinishedRender(db, { id: jobId, trigger: 'click' }, FINISHED_3AM, () => 0), null);
  assert.deepEqual(await explainerSlots(db), []);
});

test('B2: nothing is booked while publishing is off, or once today’s windows are over (never tomorrow)', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await renderedJob(db, { verdict: null, trigger: 'auto' });
  assert.equal(await bookFinishedRender(db, { id: jobId, trigger: 'auto' }, FINISHED_3AM, () => 0), null, 'publishing_live is off by default');
  await liveOn(db);
  const late = await bookFinishedRender(db, { id: jobId, trigger: 'auto' }, new Date('2026-10-08T21:30:00Z'), () => 0); // 5:30 PM New York
  assert.equal(late?.scheduled, false);
  assert.deepEqual(await explainerSlots(db), []);
});
```

Run: `npx tsx --test tests/explainers-publish.test.ts`
Expected: FAIL: `bookFinishedRender` is not exported.

- [ ] **Step 2: The booking helper**

In `lib/explainers/publish/schedule.ts`, change `import { calendarDateKey } from '@/lib/instagram/clock';` to:

```ts
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
```

and add, right after `scheduleJob`:

```ts
/**
 * B2: when the 2 AM run (trigger 'auto') finishes a render, it takes today's
 * next open window as a system slot (source 'auto'), unapproved: it still
 * needs Approve, and without one releaseDueSchedules cancels it at its time.
 * Today only; nothing left today books nothing. A person's render
 * (Regenerate, Make it) waits for Approve, which books it. Only while
 * publishing is live, like every other booking. Booking only, never
 * queuePublish. Null: not booked by rule.
 */
export async function bookFinishedRender(
  db: Queryable,
  job: { id: string; trigger: string },
  now = new Date(),
  rng?: (count: number) => number,
): Promise<ScheduleOutcome | null> {
  if (job.trigger !== 'auto') return null;
  if (!(await publishingLive(db))) return null;
  return scheduleJob(db, job.id, 'auto', now, calendarDateKey(now, SOCIAL_TIMEZONE), rng);
}
```

Run: `npx tsx --test tests/explainers-publish.test.ts tests/publisher-approval-gate.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 3: Call it when a render finishes (worker)**

In `scripts/explainers_worker.ts`, change the schedule import line to:

```ts
  const { bookFinishedRender, publishingLive, releaseDueSchedules, scheduleApproved } = await import('@/lib/explainers/publish/schedule');
```

and in `renderNext`, replace

```ts
    log('job_finished', { jobId: job.id, ...outcome });
    return true;
```

with

```ts
    log('job_finished', { jobId: job.id, ...outcome });
    if (outcome.status === 'ok') {
      // B2: the night's own render takes today's next open window (booking only; it still needs Approve).
      try {
        const booked = await bookFinishedRender(db, job);
        if (booked) log('render_booked', { jobId: job.id, ...booked });
      } catch (error) {
        log('render_book_failed', { jobId: job.id, error: errorText(error) });
      }
    }
    return true;
```

- [ ] **Step 4: Type check and the whole suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0`.

- [ ] **Step 5: Confirm no booking path queues a publish**

Run: `grep -n "queuePublish" lib/explainers/publish/schedule.ts lib/publishing/actions/explainers.ts lib/stories/api.ts scripts/explainers_worker.ts`
Expected: only the import line and the single call inside `releaseDueSchedules` in `lib/explainers/publish/schedule.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/explainers/publish/schedule.ts scripts/explainers_worker.ts tests/explainers-publish.test.ts
git commit -m "feat(explainers): the 2 AM run's renders book today's next window at finish (B2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final check and the deploy list for a human (do not execute)

**Files:** none.

- [ ] **Step 1: Whole suite, types, and a clean tree**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`, `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`, `git status --short`
Expected: `fail 0`; no type errors; no uncommitted tracked changes.

- [ ] **Step 2: List the worker files that changed**

Run: `git diff --stat origin/main...HEAD -- lib/explainers lib/stories scripts db`
Expected: `lib/explainers/publish/schedule.ts`, `scripts/explainers_worker.ts`, `lib/stories/build/index.ts`, `lib/stories/api.ts` (web only), `db/social_hub_schema.sql`.

- [ ] **Step 3: Report to Tommy with this deploy list. Do not run any of it.**

These are for a person to run, in this order, after reviewing the branch. Nothing here is executed by an agent.

1. **Schema (before either deploy):** from a checkout with `.env.local` (`DIRECT_DATABASE_URL`), run `node scripts/apply_social_hub_schema.js --apply`. It is idempotent; it adds `social_hub.idea_adjustments.consumed_at` and its index. Check: `psql "$DIRECT_DATABASE_URL" -c '\d social_hub.idea_adjustments'` lists `consumed_at`. (If the web deploys first, the hub falls back to today's moves; the Stories build reads no moves until the column exists.)
2. **Web (Vercel):** push `content-page-phase-b` and open a PR to `main` (`gh pr create --base main --head content-page-phase-b`); merge after review. Vercel deploys `main`.
3. **Workers (`helios-social-worker`), daytime only:** never between 12:30 and 5:00 AM ET, and not around the 7:30 AM health report. After the PR is merged, from a clean checkout at the merged commit (this worktree is fine once merged; it needs a local `.env.local` for the script's in-flight guard, never committed), run `./scripts/gcp/deploy-social-worker.sh`. It ships all units (`helios-reels helios-social helios-explainers helios-stories helios-publisher`) and refuses while a run, job or build is in flight. Tasks 2, 7 and 8 need this; Task 3's shared file rides along. (`deploy-explainers-worker.sh` is only a wrapper over this script.)
4. **Check after deploy:** the explainers unit logs `render_booked` after the next 2 AM render (or nothing, with publishing off); an unapproved explainer slot at its time ends `cancelled` with "Nobody approved this explainer before its slot, so it was not posted."
5. **Manual, by Tommy on the live app** (no agent runs these): one Approve on an explainer with no slot (expect "Approved. It posts …" and a time on the card); one Approve on a Morning Download set before 10 AM (expect a time on the card); a failed card's Reschedule if one occurs; Promote an idea, then check it is still promoted tomorrow until it is made.

Then report: each task's commit, the test totals, and the open questions (below). Ask before pushing.

**Open questions to raise in the report:**
- After 5 PM, explainers Approve books nothing today, but the worker's `scheduleApproved` books the next open day (two-week horizon). Should `scheduleApproved` become today-only too (leaving tomorrow to the 2 AM fill), to match "today only" (Phase A D12)?
- Book-at-finish covers only the 2 AM run's renders (`trigger = 'auto'`). Should a person's Make it render also book today's window at finish?
