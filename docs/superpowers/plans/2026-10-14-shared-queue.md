# Shared Queue (lean) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a person promotes an idea, the next overnight run makes it first (one a night per type, oldest first); a demoted idea sinks below every other idea everywhere; fresh ideas fill every other slot, as today.

**Architecture:** One pure, light rule module (`lib/social-hub/views/moves.ts`, type-only imports) decides order for the page, Run now / Make it and all four workers. A light store module (`lib/social-hub/moves-store.ts`) lets workers read a type's active moves, mark a promote used and record why it couldn't be made, and degrades to "no moves" on any failure. Each worker applies the rule at its single ordering point (reels `orderedForSlots`, explainers after `fillCandidates`, carousels a `promotedStages` wrapper over selection, Stories `inDayOrder`). The page shows one tag per moved idea.

**Tech Stack:** Next.js App Router, TypeScript, Postgres (Supabase) / PGlite in tests, `node:test` via `tsx --test`, GCP VM `helios-social-worker` (systemd units).

**Spec:** `docs/superpowers/specs/2026-10-14-shared-queue-design.md` (binding; decisions Q1, Q4–Q7, L1, L2). Style reference: `docs/superpowers/plans/2026-10-14-content-page-phase-b.md`.

## Spec corrections (planned against the code as it is)

1. **Explainers read moves from the main database.** `recordRankMove` writes `social_hub.idea_adjustments` through `lib/db` `dbQuery` (main database), but the explainers worker's `db` may be its own Postgres (`EXPLAINERS_DATABASE_URL`, `lib/explainers/connection.ts`). `runIdeaCycle` gets an optional `moves` query; the worker passes `dbQuery`. Absent or failing: no moves.
2. **Stories queue per series.** Each series builds its own set and `activeStoryMoves` reads only that series' moves, so "one promote per type per night" is one per series for Stories. The rule scopes `stories:pool:<series>:` ids by series; the page ranks Stories per series the same way.
3. **`claimRun` did not return the run's trigger.** It now returns `trigger`, so only the scheduled 3 AM carousel run reads moves (spec §4 "scheduled run only").
4. **Carousels' existing guards don't stop a promoted story that already posted.** `storedPostFor` returns null for a published post and `storyOnCalendar` only sees waiting slots, so a promoted, already-posted story would be made again (selection's already-posted check is bypassed by a promote). `loadPromoted` checks that one thing; it is the spec's own L1 "already posted" skip, not a new freshness rule.
5. **Workers mark used / record a skip by (type, idea id), not by move id.** The daily script never sees move ids; the hub's `consumeMoves` already uses up every move of a made idea. Mark used: every active move of that idea. Skip: the idea's active promote rows (`skip_reason`, `skipped_at`, overwritten each time).
6. **Reels: the copied slate row needs a `rank`.** `loadCopyTargets(slateId, { all: true })` reads ranked rows only, so the copy takes the slate's next rank. Moves apply only to the nightly generation (`dailyFill: true`), the reels side of "scheduled run only"; hand-run generations are unchanged. A copied idea that is then held out or placed stays on the slate unselected (harmless).
7. **A promote the night tried but didn't make is recorded as a skip too** (reels copy miss, carousel set-aside, explainer render refused), with that reason, so the page never says "Tonight" about an idea the night already passed over.
8. **Reels lane exception.** The knowledge lane ships its best line even on a miss. A promoted idea outside the lane takes slot 1 (Q4) but, when it misses, falls through like a general idea (spec §2): penalized, and the next lane idea gets the opener. `fillReserved` gets that one exception.

## Global Constraints

- No automated test calls the live Claude API, `web_search`, Jev, Meta or any network (CLAUDE.md Rule 1). Tests are offline: pure functions, PGlite with the real `db/*.sql` files, stubbed stages/clients.
- No new model calls anywhere. An older reel joins tonight's slate by copying its latest stored `reels.idea_scores` row: no re-scoring, no Jev.
- Nothing posts without a human Approve or Post now (unchanged). No change here touches a publisher, a schedule release, or `require_approval`.
- At most one promote per type per night (Stories: per series), oldest first; the order of a promote in line is the time of that idea's latest move. Other promotes wait in their score place. The latest move on an idea wins. Demote sinks below every idea that isn't demoted.
- Workers degrade: a failed moves read is no moves (today's behavior); a failed used/skip write is ignored. Reading never needs the new `skip_reason` / `skipped_at` columns.
- Pools keep their score order apart from the promoted-first / demoted-last rule (L2). No freshness rules beyond each pipeline's own checks (L1). The number of posts a night makes is unchanged.
- The shared rule module `lib/social-hub/views/moves.ts` has only type-only imports; `lib/social-hub/moves-store.ts` imports only that module. Workers import them without Next, `server-only`, Jev or a DB client.
- Never start a generation run, run a worker, deploy, apply a schema, or write to Supabase. Task 7 lists those steps for a human; nobody executes them in this plan.
- Branch: stay on `shared-queue` in `.worktrees/shared-queue`. Never create, switch, rename, merge or delete branches. Never touch the main folder. Do not push.
- Commit after each task. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run one test file with `npx tsx --test <file>`; the suite is `npm test`. Type check with `npx tsc --noEmit -p .` (errors in `tests/seo-gsc-auth.test.ts` already exist on `main`; ignore only those). Known environment-only failures (tests needing `helios_text_engine/.venv` Python) are not regressions; anything else failing is.
- Page copy (typographic apostrophes, as the hub's existing copy): "Tonight", "Promoted · waiting", "Can’t be made: <reason>", "Demoted".
- Worker-run code needs a VM redeploy (Task 7, by a human, daytime only, never 12:30–5 AM ET, avoid ~7:30 AM):

| Task | What changes | Runs where | VM redeploy |
|---|---|---|---|
| 1 | shared rule; `dayRanking`; Stories build order (`lib/stories/build/index.ts`) | Vercel + stories worker | **yes** |
| 2 | schema columns; `moves-store.ts`; hub `readAdjustments` | DB + Vercel (+ rides along) | rides along (+ schema first) |
| 3 | explainers ordering (`lib/explainers/ideas/cycle.ts`, `scripts/explainers_worker.ts`) | explainers worker | **yes** |
| 4 | reels ordering + older idea onto tonight's slate | reels worker | **yes** |
| 5 | carousels `--promote-id` / `--demote-id` (`scripts/social_worker.ts`, `scripts/social_daily.ts`) | carousel worker | **yes** |
| 6 | page tags | Vercel | no |

## Review Focus

1. **Promoting a carousel story that already posted** (its post went out days ago and the story is still in a recent run's shortlist): the 3 AM run never makes it again; it skips it with "This story already posted." and makes its usual posts. Test in Task 5.
2. **Two promotes on one type, or Promote then Demote on one idea:** only the oldest promote is made tonight, the other waits; the latest move on an idea wins (promoted then demoted sinks). Test in Task 1.
3. **Moves can't be read or written** (table missing, `skip_reason`/`skipped_at` not applied yet, a DB error): every worker runs exactly as today and never throws. Tests in Task 2 (store), Task 3 (explainers night), Task 4 (reels night).
4. **Promoting an older reel that isn't on tonight's slate:** it joins the slate from its stored scores with no model call and is made first; a gone or person-placed one is skipped with why, and the rest of the night is unchanged. Tests in Task 4.
5. **A promoted explainer topic that tonight's pool trim would cut:** it is not cut and is rendered first. Test in Task 3.

---

### Task 1: The shared rule (pure) and its two readers

Creates `lib/social-hub/views/moves.ts`: oldest promote per queue, demote sinks, latest move wins, Stories per series. `day-rank.ts` uses it (so `dayRanking`, the page, Run now and Make it switch to the new rule) and re-exports the names other files import. The Stories build switches its import. Today's tests for the old rule (promote = latest wins #1, demote = one place down) are updated. **VM redeploy (Task 7): the Stories build order changes.**

**Files:**
- Create: `lib/social-hub/views/moves.ts`
- Modify: `lib/social-hub/views/day-rank.ts` (header comment, imports, remove `IdeaAdjustment`/`applyMoves`/`movesFor` definitions)
- Modify: `lib/social-hub/run-today.ts` (`ideaRef` moves to the rule module, re-exported)
- Modify: `lib/stories/build/index.ts` (import, `inDayOrder` comment)
- Modify: `lib/content-type/idea-rank.ts` (doc comment)
- Test: `tests/social-hub-moves.test.ts` (new), `tests/social-hub-run-today.test.ts` (first test updated)

**Interfaces:**
- Consumes: `Vertical` (type) from `lib/social-hub/types.ts`; `rankIdeas` from `lib/social-hub/views/pools.ts` (unchanged).
- Produces (from `lib/social-hub/views/moves.ts`, used by Tasks 2–6):
  - `type IdeaAdjustment = { id: string; vertical: Vertical; ideaId: string; nyDate: string; kind: 'promote' | 'demote'; createdAt: string; skipReason?: string | null; skippedAt?: string | null }`
  - `type Move = { ideaId: string; kind: 'promote' | 'demote'; vertical?: string }`
  - `type TonightMoves<M extends Move = IdeaAdjustment> = { promote: M | null; demoted: ReadonlySet<string> }`
  - `const NO_MOVES: TonightMoves<never>`
  - `movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical): IdeaAdjustment[]`
  - `moveScope(m: Move): string`, `latestMoves<M extends Move>(moves: readonly M[]): M[]`, `tonightPromotes<M extends Move>(moves: readonly M[]): M[]`
  - `tonightPromote<M extends Move>(moves: readonly M[], vertical: string): M | null`
  - `demotedIds<M extends Move>(moves: readonly M[], vertical: string): Set<string>`
  - `tonightMoves<M extends Move>(moves: readonly M[], vertical: string): TonightMoves<M>`
  - `orderTonight<T>(list: readonly T[], idOf: (x: T) => string, promoted: ReadonlySet<string>, demoted: ReadonlySet<string>): T[]`
  - `applyMoves<T extends { id: string }>(ranked: readonly T[], moves: readonly Move[]): T[]`
  - `ideaRef(ideaId: string): string` (`reels:idea:<id>` → `<id>`)
  - `day-rank.ts` keeps exporting `applyMoves`, `movesFor`, `IdeaAdjustment` (re-exports); `run-today.ts` keeps exporting `ideaRef` (re-export).

- [ ] **Step 1: Write the failing rule tests**

Create `tests/social-hub-moves.test.ts`:

```ts
/**
 * The shared queue's rule (spec 2026-10-14-shared-queue-design.md §1), pure
 * and offline: one promote a night per type, oldest first; the latest move on
 * an idea wins; Demote sinks below every other idea; Stories queue per series.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking } from '@/lib/social-hub/views/day-rank';
import {
  applyMoves,
  demotedIds,
  ideaRef,
  orderTonight,
  tonightMoves,
  tonightPromote,
  tonightPromotes,
  type IdeaAdjustment,
} from '@/lib/social-hub/views/moves';

const mv = (vertical: IdeaAdjustment['vertical'], ideaId: string, kind: 'promote' | 'demote', createdAt: string): IdeaAdjustment =>
  ({ id: `${ideaId}-${kind}-${createdAt}`, vertical, ideaId, nyDate: createdAt.slice(0, 10), kind, createdAt });
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((x) => x.id);
const LIST = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

test('one promote a night per type: the oldest goes first; the others wait in their score place', () => {
  const moves = [mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z'), mv('reels', 'e', 'promote', '2026-10-13T10:00:00Z')];
  assert.equal(tonightPromote(moves, 'reels')?.ideaId, 'c');
  assert.deepEqual(ids(applyMoves(LIST, moves)), ['c', 'a', 'b', 'd', 'e'], 'e waits at its own place');
  assert.equal(tonightPromote(moves, 'carousels'), null, 'per type');
});

test('Review Focus 2: the latest move on an idea wins', () => {
  const sunk = [mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z'), mv('reels', 'c', 'demote', '2026-10-12T11:00:00Z')];
  assert.equal(tonightPromote(sunk, 'reels'), null);
  assert.deepEqual([...demotedIds(sunk, 'reels')], ['c']);
  assert.deepEqual(ids(applyMoves(LIST, sunk)), ['a', 'b', 'd', 'e', 'c'], 'promoted, then demoted: sinks');

  const raised = [mv('reels', 'c', 'demote', '2026-10-12T10:00:00Z'), mv('reels', 'c', 'promote', '2026-10-12T11:00:00Z')];
  assert.equal(tonightPromote(raised, 'reels')?.ideaId, 'c');
  assert.equal(demotedIds(raised, 'reels').size, 0);

  const handedOn = [
    mv('reels', 'a', 'promote', '2026-10-12T10:00:00Z'),
    mv('reels', 'b', 'promote', '2026-10-12T11:00:00Z'),
    mv('reels', 'a', 'demote', '2026-10-12T12:00:00Z'),
  ];
  assert.equal(tonightPromote(handedOn, 'reels')?.ideaId, 'b', 'the oldest promote was taken back: the next one goes');

  const repromoted = [
    mv('reels', 'a', 'promote', '2026-10-12T10:00:00Z'),
    mv('reels', 'b', 'promote', '2026-10-12T11:00:00Z'),
    mv('reels', 'a', 'promote', '2026-10-12T12:00:00Z'),
  ];
  assert.equal(tonightPromote(repromoted, 'reels')?.ideaId, 'b', 'a promote’s place in line is its idea’s latest move');
});

test('Demote sinks below every idea that is not demoted, keeping order among the demoted; a lone demoted idea is still made', () => {
  assert.deepEqual(ids(applyMoves(LIST, [mv('reels', 'a', 'demote', '2026-10-12T10:00:00Z')])), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(
    ids(applyMoves(LIST, [mv('reels', 'b', 'demote', '2026-10-12T10:00:00Z'), mv('reels', 'a', 'demote', '2026-10-12T11:00:00Z')])),
    ['c', 'd', 'e', 'a', 'b'],
  );
  assert.deepEqual(ids(applyMoves([{ id: 'a' }], [{ ideaId: 'a', kind: 'demote' }])), ['a']);
});

test('Stories queue per series: one promote a night in each series', () => {
  const moves = [
    mv('stories', 'stories:pool:free_vs_paid:k1', 'promote', '2026-10-12T10:00:00Z'),
    mv('stories', 'stories:pool:free_vs_paid:k2', 'promote', '2026-10-12T11:00:00Z'),
    mv('stories', 'stories:pool:morning_download:m1', 'promote', '2026-10-12T12:00:00Z'),
  ];
  assert.deepEqual(tonightPromotes(moves).map((m) => m.ideaId), ['stories:pool:free_vs_paid:k1', 'stories:pool:morning_download:m1']);
  const fvp = ['k0', 'k1', 'k2'].map((k) => ({ id: `stories:pool:free_vs_paid:${k}` }));
  assert.deepEqual(ids(applyMoves(fvp, moves)).map((id) => id.split(':').pop()), ['k1', 'k0', 'k2']);
  // The Stories build passes bare pool keys of one series (no vertical): one queue.
  const keys = ['k0', 'k1', 'k2'].map((id) => ({ id }));
  assert.deepEqual(ids(applyMoves(keys, [{ ideaId: 'k2', kind: 'promote' }, { ideaId: 'k1', kind: 'promote' }])), ['k2', 'k0', 'k1']);
});

const story = (series: string, group: string, key: string, score: number): HubIdea => ({
  id: `stories:pool:${series}:${key}`, vertical: 'stories', title: key, score, scoreLabel: 'Score', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, group,
});

test('dayRanking ranks Stories per series: each series’ promote leads its own series', () => {
  const ideas = [story('free_vs_paid', 'Free vs Paid', 'k0', 9), story('free_vs_paid', 'Free vs Paid', 'k1', 5), story('morning_download', 'Morning Download', 'm0', 9), story('morning_download', 'Morning Download', 'm1', 5)];
  const moves = [mv('stories', 'stories:pool:free_vs_paid:k1', 'promote', '2026-10-12T10:00:00Z'), mv('stories', 'stories:pool:morning_download:m1', 'promote', '2026-10-12T11:00:00Z')];
  const ranked = dayRanking(ideas, 'stories', moves).map((r) => [r.idea.title, r.rank]);
  assert.deepEqual(ranked, [['k1', 1], ['k0', 2], ['m1', 1], ['m0', 2]]);
});

test('orderTonight works on any list by id; tonightMoves gives both halves', () => {
  const rows = [{ topicId: 't1' }, { topicId: 't2' }, { topicId: 't3' }];
  const ordered = orderTonight(rows, (r) => `explainers:topic:${r.topicId}`, new Set(['explainers:topic:t3']), new Set(['explainers:topic:t1']));
  assert.deepEqual(ordered.map((r) => r.topicId), ['t3', 't2', 't1']);
  const t = tonightMoves([mv('explainers', 'explainers:topic:t3', 'promote', '2026-10-12T10:00:00Z'), mv('explainers', 'explainers:topic:t1', 'demote', '2026-10-12T11:00:00Z')], 'explainers');
  assert.equal(t.promote?.ideaId, 'explainers:topic:t3');
  assert.deepEqual([...t.demoted], ['explainers:topic:t1']);
});

test('ideaRef strips the type and kind, keeping colons in the ref', () => {
  assert.equal(ideaRef('reels:idea:0000-aaaa'), '0000-aaaa');
  assert.equal(ideaRef('carousels:story:https://www.theverge.com/a:b'), 'https://www.theverge.com/a:b');
  assert.equal(ideaRef('explainers:topic:t1'), 't1');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/social-hub-moves.test.ts`
Expected: FAIL: `Cannot find module '@/lib/social-hub/views/moves'` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write the rule module**

Create `lib/social-hub/views/moves.ts`:

```ts
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The shared queue (spec docs/superpowers/specs/2026-10-14-shared-queue-design.md §1):
 * one rule for the Content page, Run now / Make it and all four night workers.
 *
 *   Promote  "make this next". In each queue (a type; for Stories, a series:
 *            each series builds its own set) the oldest idea whose latest
 *            move is a promote goes first tonight. Other promotes wait in
 *            their score place: one a night, oldest first.
 *   Demote   the idea sinks below every idea that isn't demoted.
 *
 * The latest move on an idea wins; a promote's place in line is the time of
 * that latest move. Moves always come oldest first. Pure, with a type-only
 * import, so workers import it without Next, Jev or a database.
 */

/** A person's Promote / Demote. `nyDate` is the day it was made; it steers until used (consumed_at, B8). `createdAt` is ISO. */
export type IdeaAdjustment = {
  id: string;
  vertical: Vertical;
  ideaId: string;
  nyDate: string;
  kind: 'promote' | 'demote';
  createdAt: string;
  /** Why the last night couldn't make this promote (a worker wrote it), and when (ISO). */
  skipReason?: string | null;
  skippedAt?: string | null;
};

/** The part of a move the rule reads. The Stories build passes bare pool keys of one series (no vertical). */
export type Move = { ideaId: string; kind: 'promote' | 'demote'; vertical?: string };

/** Tonight's moves for one type: the one promote it makes first, and the ideas that sink. */
export type TonightMoves<M extends Move = IdeaAdjustment> = { promote: M | null; demoted: ReadonlySet<string> };

/** No moves: what a worker uses when it can't read them (today's behavior). */
export const NO_MOVES: TonightMoves<never> = { promote: null, demoted: new Set<string>() };

/** A type's moves, oldest first. */
export function movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical): IdeaAdjustment[] {
  return adjustments.filter((a) => a.vertical === vertical).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The queue a move waits in: its type, or for a Stories pool idea its series. */
export function moveScope(m: Move): string {
  if (m.ideaId.startsWith('stories:pool:')) return m.ideaId.split(':').slice(0, 3).join(':');
  return m.vertical ?? '';
}

/** Each idea's latest move, in the order of those latest moves (oldest first). */
export function latestMoves<M extends Move>(moves: readonly M[]): M[] {
  const last = new Map<string, M>();
  for (const m of moves) {
    last.delete(m.ideaId);
    last.set(m.ideaId, m);
  }
  return [...last.values()];
}

/** Per queue, the oldest idea whose latest move is a promote: what the night makes first. */
export function tonightPromotes<M extends Move>(moves: readonly M[]): M[] {
  const taken = new Set<string>();
  const out: M[] = [];
  for (const m of latestMoves(moves)) {
    if (m.kind !== 'promote' || taken.has(moveScope(m))) continue;
    taken.add(moveScope(m));
    out.push(m);
  }
  return out;
}

/** A type's promote for tonight (Reels, Explainers, Carousels; Stories use tonightPromotes, one per series). */
export function tonightPromote<M extends Move>(moves: readonly M[], vertical: string): M | null {
  return tonightPromotes(moves.filter((m) => m.vertical === vertical))[0] ?? null;
}

/** Ideas of a type whose latest move is a demote. */
export function demotedIds<M extends Move>(moves: readonly M[], vertical: string): Set<string> {
  return new Set(latestMoves(moves.filter((m) => m.vertical === vertical)).filter((m) => m.kind === 'demote').map((m) => m.ideaId));
}

export function tonightMoves<M extends Move>(moves: readonly M[], vertical: string): TonightMoves<M> {
  return { promote: tonightPromote(moves, vertical), demoted: demotedIds(moves, vertical) };
}

/** Stable: the promoted first, then everything not demoted, then the demoted, each in the order given. */
export function orderTonight<T>(list: readonly T[], idOf: (x: T) => string, promoted: ReadonlySet<string>, demoted: ReadonlySet<string>): T[] {
  const first: T[] = [];
  const middle: T[] = [];
  const last: T[] = [];
  for (const x of list) {
    const id = idOf(x);
    if (promoted.has(id)) first.push(x);
    else if (demoted.has(id)) last.push(x);
    else middle.push(x);
  }
  return [...first, ...middle, ...last];
}

/** A ranked list in tonight's order: each queue's promote first, demoted ideas last. */
export function applyMoves<T extends { id: string }>(ranked: readonly T[], moves: readonly Move[]): T[] {
  const demoted = new Set(latestMoves(moves).filter((m) => m.kind === 'demote').map((m) => m.ideaId));
  return orderTonight(ranked, (x) => x.id, new Set(tonightPromotes(moves).map((m) => m.ideaId)), demoted);
}

/** The native id an idea id ends with (`reels:idea:<id>` → `<id>`; colons inside the ref are kept). */
export function ideaRef(ideaId: string): string {
  return ideaId.split(':').slice(2).join(':');
}
```

- [ ] **Step 4: Point `day-rank.ts` at it**

In `lib/social-hub/views/day-rank.ts`:

(a) After `import { isRejected } from '@/lib/social-hub/views/state';` add:

```ts
import { applyMoves, movesFor, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
```

(b) Replace the header lines

```ts
 *   Promote  the idea goes to #1 (a manual bump above everything else)
 *   Demote   the idea drops below the idea right under it (#1 → #2)
 *
 * Moves are applied in the order they were made, on top of that day's score
 * ranking, and last until their idea is made (B8).
```

with

```ts
 *   Promote  "make this next": the type's oldest promote goes first tonight;
 *            other promotes wait in their score place (views/moves.ts)
 *   Demote   the idea sinks below every idea that isn't demoted
 *
 * The shared rule sits on top of that day's score ranking; moves last until
 * their idea is made (B8).
```

(c) Replace

```ts
/** A person's Promote / Demote. `nyDate` is the day it was made; it steers until used (consumed_at, B8). `createdAt` is ISO. */
export type IdeaAdjustment = { id: string; vertical: Vertical; ideaId: string; nyDate: string; kind: 'promote' | 'demote'; createdAt: string };
```

with

```ts
export { applyMoves, movesFor };
export type { IdeaAdjustment };
```

(d) Delete these two definitions (the rule now lives in `views/moves.ts`):

```ts
/** Apply one day's moves, in order, to a ranked list. */
export function applyMoves<T extends { id: string }>(ranked: readonly T[], moves: ReadonlyArray<Pick<IdeaAdjustment, 'ideaId' | 'kind'>>): T[] {
  const list = [...ranked];
  for (const move of moves) {
    const i = list.findIndex((x) => x.id === move.ideaId);
    if (i < 0) continue;
    if (move.kind === 'promote') list.unshift(...list.splice(i, 1));
    else if (i < list.length - 1) [list[i], list[i + 1]] = [list[i + 1]!, list[i]!];
  }
  return list;
}

/** A type's active moves (not used yet, any day), oldest first. */
export function movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical): IdeaAdjustment[] {
  return adjustments.filter((a) => a.vertical === vertical).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

`dayRanking` is unchanged: it already calls `applyMoves(rankIdeas(list), moves)` per Stories group, and the rule scopes Stories by series.

- [ ] **Step 5: `ideaRef` and the Stories build**

In `lib/social-hub/run-today.ts`, after `import { quotaCandidates, type QuotaCandidate } from '@/lib/social-hub/views/day-rank';` add:

```ts
import { ideaRef } from '@/lib/social-hub/views/moves';
```

and replace

```ts
/** The native id an idea id ends with (`reels:idea:<id>` → `<id>`). */
export function ideaRef(ideaId: string): string {
  const parts = ideaId.split(':');
  return parts.slice(2).join(':');
}
```

with

```ts
export { ideaRef };
```

In `lib/stories/build/index.ts`, replace `import { applyMoves } from '@/lib/social-hub/views/day-rank';` with:

```ts
import { applyMoves } from '@/lib/social-hub/views/moves';
```

and replace the comment line

```ts
/** The series' pool in the hub's order: its active moves applied in order, so a promoted idea is first in the build's list. */
```

with

```ts
/** The series' pool in the shared queue's order (views/moves.ts): its oldest promote first, demoted ideas last. */
```

In `lib/content-type/idea-rank.ts`, replace

```ts
 * order by lib/social-hub/views/day-rank.ts. Promote puts the idea at #1;
 * Demote moves it below the idea right under it. A move lasts until its idea is made (B8; lib/social-hub/queries/day.ts consumeMoves).
```

with

```ts
 * by the shared queue (lib/social-hub/views/moves.ts). Promote makes the idea
 * next (one a night per type, oldest first); Demote sinks it below every other
 * idea. A move lasts until its idea is made (B8; lib/social-hub/queries/day.ts consumeMoves).
```

- [ ] **Step 6: Update the old rule's test**

In `tests/social-hub-run-today.test.ts`, replace the whole first test

```ts
test('Promote makes an idea #1 for the day; Demote moves it below the next one', () => {
  assert.deepEqual(titles([]), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1')]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4']);
  assert.deepEqual(titles([move(1, 'demote', 't1')]), ['Idea 2', 'Idea 1', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1'), move(3, 'demote', 't2')]), ['Idea 1', 'Idea 3', 'Idea 2', 'Idea 4'], 'a demoted promoted idea goes from #1 to #2');
  assert.deepEqual(titles([{ ...move(3, 'promote', 't1'), nyDate: '2026-10-08' }]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4'], 'a move from yesterday still steers until its idea is made (B8)');
  assert.deepEqual(applyMoves([{ id: 'a' }, { id: 'b' }], [{ ideaId: 'b', kind: 'demote' }]).map((x) => x.id), ['a', 'b'], 'the last idea stays last');
});
```

with

```ts
test('Promote makes an idea next (one a night, oldest first); Demote sinks it below every other idea', () => {
  assert.deepEqual(titles([]), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1')]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4']);
  assert.deepEqual(titles([move(1, 'demote', 't1')]), ['Idea 2', 'Idea 3', 'Idea 4', 'Idea 1']);
  assert.deepEqual(titles([move(3, 'promote', 't1'), move(3, 'demote', 't2')]), ['Idea 1', 'Idea 2', 'Idea 4', 'Idea 3'], 'the latest move wins: promoted, then demoted, sinks');
  assert.deepEqual(titles([move(3, 'promote', 't1'), move(4, 'promote', 't2')]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4'], 'one promote a night: the newer one waits in its place');
  assert.deepEqual(titles([{ ...move(3, 'promote', 't1'), nyDate: '2026-10-08' }]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4'], 'a move from yesterday still steers until its idea is made (B8)');
  assert.deepEqual(applyMoves([{ id: 'a' }, { id: 'b' }], [{ ideaId: 'b', kind: 'demote' }]).map((x) => x.id), ['a', 'b'], 'the last idea stays last');
});
```

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test tests/social-hub-moves.test.ts tests/social-hub-run-today.test.ts tests/social-hub-idea-moves.test.ts tests/social-run-pinned.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 8: Type check and the suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0` apart from known `helios_text_engine/.venv` environment failures.

- [ ] **Step 9: Commit**

```bash
git add lib/social-hub/views/moves.ts lib/social-hub/views/day-rank.ts lib/social-hub/run-today.ts lib/stories/build/index.ts lib/content-type/idea-rank.ts tests/social-hub-moves.test.ts tests/social-hub-run-today.test.ts
git commit -m "feat(social-hub): shared queue rule: one promote a night, oldest first; demote sinks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema columns and the workers' store helpers

Adds `skip_reason` / `skipped_at` to `social_hub.idea_adjustments`, a light store module the workers use (read a type's tonight moves, mark a promote used, record a skip), and has the hub read the skip columns (falling back when they aren't applied yet). No worker calls the helpers yet. **Schema first at deploy (Task 7); the module rides along on the VM.**

**Files:**
- Modify: `db/social_hub_schema.sql` (after the `consumed_at` index)
- Create: `lib/social-hub/moves-store.ts`
- Modify: `lib/social-hub/queries/day.ts` (`AdjustmentRow`, `toAdjustment`, `readAdjustments`)
- Test: `tests/social-hub-idea-moves.test.ts` (three tests added)

**Interfaces:**
- Consumes: `NO_MOVES`, `tonightMoves`, `IdeaAdjustment`, `TonightMoves` from Task 1.
- Produces (from `lib/social-hub/moves-store.ts`, used by Tasks 3–5):
  - `type MovesQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>` (a `HubQuery`, the social `Query`, `dbQuery` and `(t, p) => db.query(t, p)` all fit)
  - `readTonightMoves(q: MovesQuery, vertical: Vertical): Promise<TonightMoves>` (never throws; failure → `NO_MOVES`)
  - `markPromoteUsed(q: MovesQuery, vertical: Vertical, ideaId: string): Promise<boolean>` (never throws)
  - `recordPromoteSkip(q: MovesQuery, vertical: Vertical, ideaId: string, reason: string): Promise<boolean>` (never throws)
  - `readAdjustments` now fills `skipReason` / `skippedAt` (ISO) on each `IdeaAdjustment` (Task 6 reads them).

- [ ] **Step 1: Write the failing tests**

In `tests/social-hub-idea-moves.test.ts`, add after the `import { consumeMoves, readAdjustments } from '@/lib/social-hub/queries/day';` line:

```ts
import { markPromoteUsed, readTonightMoves, recordPromoteSkip } from '@/lib/social-hub/moves-store';
```

and append these tests at the end of the file:

```ts
test('workers read a type’s active moves: tonight’s promote (the oldest) and the demoted ideas; used moves and other types are left out', async () => {
  const { query: q } = await openHubTestDb();
  await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await addMove(q, 'reels', 'reels:idea:c', TODAY, 'demote', '2026-10-14T13:05:00Z');
  const used = await addMove(q, 'reels', 'reels:idea:z', YESTERDAY, 'promote', '2026-10-13T09:00:00Z');
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = $1`, [used]);
  await addMove(q, 'carousels', 'carousels:story:s1', YESTERDAY, 'promote', '2026-10-13T08:00:00Z');
  const tonight = await readTonightMoves(q, 'reels');
  assert.equal(tonight.promote?.ideaId, 'reels:idea:a');
  assert.deepEqual([...tonight.demoted], ['reels:idea:c']);
});

test('a skip is written on the idea’s promote and keeps it active (the hub reads why); used marks every active move of the idea', async () => {
  const { query: q } = await openHubTestDb();
  await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:00:00Z');
  assert.equal(await recordPromoteSkip(q, 'reels', 'reels:idea:a', 'It isn’t in the reels pool any more.'), true);
  const read = await readAdjustments(q, TODAY);
  const a = read.find((m) => m.ideaId === 'reels:idea:a')!;
  assert.equal(a.skipReason, 'It isn’t in the reels pool any more.');
  assert.match(a.skippedAt ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(read.find((m) => m.ideaId === 'reels:idea:b')!.skipReason, null);
  assert.equal((await readTonightMoves(q, 'reels')).promote?.ideaId, 'reels:idea:a', 'a skipped promote stays first in line');

  assert.equal(await markPromoteUsed(q, 'reels', 'reels:idea:a'), true);
  assert.equal((await readTonightMoves(q, 'reels')).promote?.ideaId, 'reels:idea:b', 'used: the next promote goes');
});

test('Review Focus 3: before the skip columns or the table exist, workers read no moves or their moves as before, and writes are ignored, never thrown', async () => {
  const { pg, query: q } = await openHubTestDb();
  await addMove(q, 'reels', 'reels:idea:a', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await pg.exec(`ALTER TABLE social_hub.idea_adjustments DROP COLUMN skip_reason`);
  assert.equal(await recordPromoteSkip(q, 'reels', 'reels:idea:a', 'x'), false);
  assert.equal((await readTonightMoves(q, 'reels')).promote?.ideaId, 'reels:idea:a', 'reading never needs the new columns');
  assert.deepEqual((await readAdjustments(q, TODAY)).map((m) => [m.ideaId, m.skipReason ?? null]), [['reels:idea:a', null]], 'the hub still reads its moves');
  await pg.exec(`DROP TABLE social_hub.idea_adjustments`);
  const none = await readTonightMoves(q, 'reels');
  assert.deepEqual([none.promote, none.demoted.size], [null, 0]);
  assert.equal(await markPromoteUsed(q, 'reels', 'reels:idea:a'), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/social-hub-idea-moves.test.ts`
Expected: FAIL: `Cannot find module '@/lib/social-hub/moves-store'`.

- [ ] **Step 3: Schema**

In `db/social_hub_schema.sql`, after

```sql
CREATE INDEX IF NOT EXISTS idx_social_hub_idea_adjustments_active
    ON social_hub.idea_adjustments (vertical, created_at) WHERE consumed_at IS NULL;
```

add

```sql

-- Shared queue (2026-10-14): why the last night couldn't make a promote, and when.
-- A worker overwrites them on each skip; the move stays active (consumed_at stays NULL).
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS skip_reason text;
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS skipped_at timestamptz;
```

- [ ] **Step 4: The store module**

Create `lib/social-hub/moves-store.ts`:

```ts
import type { Vertical } from '@/lib/social-hub/types';
import { NO_MOVES, tonightMoves, type IdeaAdjustment, type TonightMoves } from '@/lib/social-hub/views/moves';

/**
 * The night workers' side of the shared queue (spec 2026-10-14 §6): read a
 * type's active moves, mark a promote used once the night made its idea, and
 * record why it couldn't. Every call degrades: a failed read is no moves (the
 * night runs as it did before the shared queue) and a failed write returns
 * false. Reading never needs the skip columns. Light: no Next, no Jev, no
 * database client of its own; callers pass their query function.
 */

export type MovesQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

type Row = { id: string; vertical: Vertical; idea_id: string; ny_date: string; kind: 'promote' | 'demote'; created_at: string };

/** A type's active moves (not used yet, any day), oldest first, as tonight's promote and demoted ideas. */
export async function readTonightMoves(q: MovesQuery, vertical: Vertical): Promise<TonightMoves> {
  try {
    const { rows } = await q(
      `SELECT id::text AS id, vertical, idea_id, ny_date::text AS ny_date, kind,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM social_hub.idea_adjustments
        WHERE vertical = $1 AND consumed_at IS NULL
        ORDER BY created_at, id`,
      [vertical],
    );
    const moves: IdeaAdjustment[] = (rows as Row[]).map((r) => ({
      id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: String(r.ny_date).slice(0, 10), kind: r.kind, createdAt: r.created_at,
    }));
    return tonightMoves(moves, vertical);
  } catch {
    return NO_MOVES;
  }
}

/** The night made the idea: every active move on it is used up (as the hub's consumeMoves does). */
export async function markPromoteUsed(q: MovesQuery, vertical: Vertical, ideaId: string): Promise<boolean> {
  try {
    await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND consumed_at IS NULL`, [vertical, ideaId]);
    return true;
  } catch {
    return false;
  }
}

/** The night couldn't make the idea: why, on its active promote. The move stays active. */
export async function recordPromoteSkip(q: MovesQuery, vertical: Vertical, ideaId: string, reason: string): Promise<boolean> {
  try {
    await q(
      `UPDATE social_hub.idea_adjustments SET skip_reason = $3, skipped_at = now()
        WHERE vertical = $1 AND idea_id = $2 AND kind = 'promote' AND consumed_at IS NULL`,
      [vertical, ideaId, reason.slice(0, 500)],
    );
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: The hub reads the skip columns**

In `lib/social-hub/queries/day.ts`, replace

```ts
type AdjustmentRow = { id: string; vertical: IdeaAdjustment['vertical']; idea_id: string; ny_date: string; kind: IdeaAdjustment['kind']; created_at: string };
```

with

```ts
type AdjustmentRow = {
  id: string; vertical: IdeaAdjustment['vertical']; idea_id: string; ny_date: string; kind: IdeaAdjustment['kind']; created_at: string;
  skip_reason?: string | null; skipped_at?: string | null;
};
```

replace

```ts
const toAdjustment = (r: AdjustmentRow): IdeaAdjustment => ({ id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: r.ny_date.slice(0, 10), kind: r.kind, createdAt: r.created_at });
```

with

```ts
/** The shared queue's skip columns (2026-10-14): why the last night couldn't make a promote. */
const SKIP_COLS = `, skip_reason, to_char(skipped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS skipped_at`;

const toAdjustment = (r: AdjustmentRow): IdeaAdjustment => ({
  id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: r.ny_date.slice(0, 10), kind: r.kind, createdAt: r.created_at,
  skipReason: r.skip_reason ?? null, skippedAt: r.skipped_at ?? null,
});
```

and replace the whole `readAdjustments` function (its doc comment stays) body:

```ts
export async function readAdjustments(q: HubQuery, nyDate: string): Promise<IdeaAdjustment[]> {
  try {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE consumed_at IS NULL ORDER BY created_at`);
    return rows.map(toAdjustment);
  } catch {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE ny_date = $1::date ORDER BY created_at`, [nyDate]);
    return rows.map(toAdjustment);
  }
}
```

with

```ts
export async function readAdjustments(q: HubQuery, nyDate: string): Promise<IdeaAdjustment[]> {
  const active = (cols: string) => q<AdjustmentRow>(`SELECT ${cols} FROM social_hub.idea_adjustments WHERE consumed_at IS NULL ORDER BY created_at`);
  try {
    return (await active(ADJUSTMENT_COLS + SKIP_COLS)).rows.map(toAdjustment);
  } catch {
    // The skip columns are not applied yet: the moves without them.
  }
  try {
    return (await active(ADJUSTMENT_COLS)).rows.map(toAdjustment);
  } catch {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE ny_date = $1::date ORDER BY created_at`, [nyDate]);
    return rows.map(toAdjustment);
  }
}
```

and add one sentence to its doc comment, after `Before the consumed_at column is applied, today's moves, as before Phase B.`:

```ts
 * Before the skip columns are applied, the same moves without a skip reason.
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/social-hub-idea-moves.test.ts`
Expected: PASS, `ℹ fail 0` (the five existing tests and the three new ones).

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add db/social_hub_schema.sql lib/social-hub/moves-store.ts lib/social-hub/queries/day.ts tests/social-hub-idea-moves.test.ts
git commit -m "feat(social-hub): skip_reason/skipped_at on moves; worker helpers to read, use and skip a promote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Explainers (2 AM) make tonight's promote first

`runIdeaCycle` gets an optional `moves` query (the main database, Spec correction 1). It reads tonight's explainer moves before the pool trim, exempts the promoted topic from `trimPool`, orders `fillCandidates` with the shared rule before `.slice(0, fill.making)`, marks the promote used when it is rendered or placed, and records why when it isn't. The worker passes `dbQuery`. **VM redeploy (Task 7).**

**Files:**
- Modify: `lib/explainers/ideas/evaluate.ts` (`trimPool`)
- Modify: `lib/explainers/ideas/cycle.ts` (imports, `IdeaCycleDeps`, the fill block)
- Modify: `scripts/explainers_worker.ts` (pass `moves`)
- Test: `tests/shared-queue-explainers.test.ts` (new)

**Interfaces:**
- Consumes: `readTonightMoves`, `markPromoteUsed`, `recordPromoteSkip`, `MovesQuery` (Task 2); `ideaRef`, `orderTonight`, `NO_MOVES` (Task 1); existing `fillCandidates(db, approvalNeeded)`, `requestRender`, `scheduleJob`.
- Produces: `IdeaCycleDeps.moves?: MovesQuery`; `trimPool(db, poolSize, keep?: string | null)`; `export const EXPLAINER_GONE = 'It isn’t in the explainers pool any more (rendered, posted or cut).'` from `lib/explainers/ideas/cycle.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared-queue-explainers.test.ts`:

```ts
/**
 * Shared queue, Explainers (the 2 AM idea cycle), offline on PGlite with the
 * real schema files: tonight's promoted topic is rendered first and never cut
 * from the pool, a demoted topic goes last, the promote is used when made, a
 * gone one is skipped with why, and a moves read that fails leaves the night
 * as it was. Stubbed idea model and Jev: no live calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { EXPLAINER_GONE, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { trimPool } from '@/lib/explainers/ideas/evaluate';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { saveSetting } from '@/lib/explainers/settings';
import type { ScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { MovesQuery } from '@/lib/social-hub/moves-store';

import { scratchExplainersDb } from './explainers-pglite';

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York

/** Below the E-15 gates: generated ideas never enter the pool, so the seeded pool decides the ranking. */
const BROAD: Record<ScoreKey, number> = { audience_fit: 4, teachability_45s: 0, analogy_potential: 4, visual_potential: 4, accuracy_under_simplification: 1, hook_strength: 3 };

function stubJev(): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const keys = Object.keys(questions);
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        answers[key] = keys[0] === 'duplicate_of_existing_topic' || key.startsWith('pair_')
          ? { type: 'noul', noul: 0.1 }
          : { type: 'score', score: BROAD[key as ScoreKey], confidence: 1 };
      }
      void state;
      return { model: 'jev-stub', answers, usage: { input_tokens: 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

function stubIdeas(): IdeaModel {
  return {
    async writeScopes(request: { titles: string[] }) {
      return { scopes: request.titles.map((t) => `Explain ${t}.`), usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub' };
    },
    async propose() {
      return {
        ideas: [1, 2, 3].map((n) => ({ topic_title: `Generated ${n} ${Math.random()}`, topic_scope: 'Scope.' })),
        usage: { input_tokens: 10, output_tokens: 10 },
        model: 'stub',
      };
    },
  } as unknown as IdeaModel;
}

async function explainersOn(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  return db;
}

async function topic(db: ExplainersDb, title: string, score: number, status = 'pool'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score) VALUES ($1, 'manual', $2, $3) RETURNING id`,
    [title, status, score],
  );
  return rows[0]!.id;
}

const addMove = (db: ExplainersDb, ideaId: string, kind: 'promote' | 'demote', at: string) =>
  db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('explainers', $1, $2::date, $3, $4::timestamptz)`, [ideaId, at.slice(0, 10), kind, at]);

const moveRow = async (db: ExplainersDb, ideaId: string) =>
  (await db.query<{ used: boolean; skip_reason: string | null }>(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [ideaId])).rows[0]!;

const statusOf = async (db: ExplainersDb, id: string) => (await db.query<{ status: string }>(`SELECT status FROM explainers.topics WHERE id = $1`, [id])).rows[0]!.status;

const movesOf = (db: ExplainersDb): MovesQuery => (text, params) => db.query(text, params);

test('Review Focus 5: tonight’s promoted topic is rendered first even below the pool cut; a demoted topic goes last; the promote is used', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'pool_size', 2);
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:00:00Z');
  await addMove(db, `explainers:topic:${a}`, 'demote', '2026-10-07T20:05:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [p, b], 'the promote first, then the best topic not demoted');
  assert.notEqual(await statusOf(db, p), 'displaced', 'the pool trim did not cut it');
  assert.deepEqual(await moveRow(db, `explainers:topic:${p}`), { used: true, skip_reason: null });
  assert.equal((await moveRow(db, `explainers:topic:${a}`)).used, false, 'only the made idea’s moves are used');
});

test('trimPool keeps the exempt topic and cuts the next one instead', async () => {
  const { db } = await scratchExplainersDb();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  assert.equal(await trimPool(db, 1, p), 1);
  assert.deepEqual([await statusOf(db, a), await statusOf(db, b), await statusOf(db, p)], ['pool', 'displaced', 'pool']);
});

test('a promoted topic that is no longer in the pool is skipped with why; the night renders as it would without it', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const gone = await topic(db, 'Gone', 95, 'displaced');
  await addMove(db, `explainers:topic:${gone}`, 'promote', '2026-10-07T20:00:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [a, b]);
  assert.deepEqual(await moveRow(db, `explainers:topic:${gone}`), { used: false, skip_reason: EXPLAINER_GONE });
});

test('Review Focus 3: a moves read that fails leaves the night exactly as before', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:00:00Z');
  const broken: MovesQuery = async () => {
    throw new Error('relation "social_hub.idea_adjustments" does not exist');
  };
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: broken });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [a, b]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/shared-queue-explainers.test.ts`
Expected: FAIL: `EXPLAINER_GONE` is not exported by `lib/explainers/ideas/cycle.ts` (a SyntaxError on import), or, once it is, `renders` is `[a, b]` instead of `[p, b]`.

- [ ] **Step 3: `trimPool` exempts one topic**

In `lib/explainers/ideas/evaluate.ts`, replace

```ts
/** Keep the best `poolSize`; displace the rest (E-16 step 7). Returns how many. */
export async function trimPool(db: ExplainersDb, poolSize: number): Promise<number> {
  const pool = await listPool(db);
  const cut = pool.slice(poolSize);
```

with

```ts
/** Keep the best `poolSize`; displace the rest (E-16 step 7). `keep` (tonight's promoted topic, shared queue) is never cut. Returns how many. */
export async function trimPool(db: ExplainersDb, poolSize: number, keep: string | null = null): Promise<number> {
  const pool = await listPool(db);
  const cut = pool.slice(poolSize).filter((topic) => topic.id !== keep);
```

- [ ] **Step 4: The cycle applies the shared rule**

In `lib/explainers/ideas/cycle.ts`:

(a) After `import { consoleFillLog, dailyFillOrQuota, reportFill, type DailyFill, type FillLog } from '@/lib/social-hub/fill';` add:

```ts
import { markPromoteUsed, readTonightMoves, recordPromoteSkip, type MovesQuery } from '@/lib/social-hub/moves-store';
import { ideaRef, NO_MOVES, orderTonight } from '@/lib/social-hub/views/moves';
```

(b) In `IdeaCycleDeps`, after the `log?: FillLog;` member add:

```ts
  /**
   * The main database, where the hub records Promote / Demote
   * (social_hub.idea_adjustments; Spec correction 1: the explainers handle may
   * be a database of its own). Absent or failing: no moves, as before.
   */
  moves?: MovesQuery;
```

(c) After the `IdeaCycleDeps` type, add:

```ts
/** Why tonight's promoted topic wasn't made: it is no longer a pool topic or a placeable render. */
export const EXPLAINER_GONE = 'It isn’t in the explainers pool any more (rendered, posted or cut).';
```

(d) Replace

```ts
    await trimPool(db, settings.pool_size);

    // Daily fill (D54): the top `quota − placed` candidates, fresh topics and surviving renders ranked together.
    // A surviving render is placed, not rendered again; at most `daily_render_cap` pool topics are rendered
    // (SH-49: two a day), and requestRender still enforces both caps.
    const chosen = (await fillCandidates(db, await requireApproval(db))).slice(0, fill.making);
```

with

```ts
    // Shared queue: tonight's promoted topic is never cut from the pool and goes first; demoted topics go last.
    const tonight = deps.moves ? await readTonightMoves(deps.moves, 'explainers') : NO_MOVES;
    const promoteIdea = tonight.promote?.ideaId ?? null;
    const promoteTopic = promoteIdea ? ideaRef(promoteIdea) : null;
    const usePromote = async () => {
      if (deps.moves && promoteIdea) await markPromoteUsed(deps.moves, 'explainers', promoteIdea);
    };
    const skipPromote = async (reason: string) => {
      if (deps.moves && promoteIdea) await recordPromoteSkip(deps.moves, 'explainers', promoteIdea, reason);
    };
    await trimPool(db, settings.pool_size, promoteTopic);

    // Daily fill (D54): the top `quota − placed` candidates, fresh topics and surviving renders ranked together.
    // A surviving render is placed, not rendered again; at most `daily_render_cap` pool topics are rendered
    // (SH-49: two a day), and requestRender still enforces both caps.
    const ranked = orderTonight(
      await fillCandidates(db, await requireApproval(db)),
      (c) => `explainers:topic:${c.topicId}`,
      new Set(promoteIdea ? [promoteIdea] : []),
      tonight.demoted,
    );
    if (promoteTopic && !ranked.some((c) => c.topicId === promoteTopic)) await skipPromote(EXPLAINER_GONE);
    const chosen = ranked.slice(0, fill.making);
```

(e) Replace

```ts
        allocated.push({ topicId: candidate.topicId, jobId: candidate.jobId, scheduled });
        continue;
```

with

```ts
        allocated.push({ topicId: candidate.topicId, jobId: candidate.jobId, scheduled });
        if (candidate.topicId === promoteTopic) await usePromote();
        continue;
```

(f) Replace

```ts
      render ??= requested;
      if (!requested.ok) capped = true;
```

with

```ts
      render ??= requested;
      if (!requested.ok) capped = true;
      if (candidate.topicId === promoteTopic) {
        if (requested.ok) await usePromote();
        else await skipPromote(`The render didn’t start (${requested.reason.replace(/_/g, ' ')}).`);
      }
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test tests/shared-queue-explainers.test.ts tests/social-fill.test.ts`
Expected: PASS, `ℹ fail 0` (the existing explainers fill tests pass no `moves`, so they are unchanged).

- [ ] **Step 6: The worker passes the main database (worker code)**

In `scripts/explainers_worker.ts`, after `const { liveJevTransport } = await import('@/lib/reels/jev/client');` add:

```ts
  // Promote / Demote live in the main database (social_hub.idea_adjustments), whichever database explainers use.
  const { dbQuery } = await import('@/lib/db');
```

and replace

```ts
          cycle = await runIdeaCycle({ db, ideaModel: anthropicIdeaModel(anthropic), jevTransport: liveJevTransport, log });
```

with

```ts
          cycle = await runIdeaCycle({ db, ideaModel: anthropicIdeaModel(anthropic), jevTransport: liveJevTransport, log, moves: (text, params) => dbQuery(text, params) });
```

- [ ] **Step 7: Type check and the suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0` apart from known environment failures.

- [ ] **Step 8: Commit**

```bash
git add lib/explainers/ideas/evaluate.ts lib/explainers/ideas/cycle.ts scripts/explainers_worker.ts tests/shared-queue-explainers.test.ts
git commit -m "feat(explainers): the 2 AM cycle renders tonight's promote first, never trims it, sinks demotes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reels (1 AM) make tonight's promote first

`orderedForSlots` takes optional moves (promoted first, demoted last); both slot pools lead with the promote (Q4: it may take the knowledge-lane slot); a promoted non-lane idea that misses slot 1 falls through like a general idea (Spec correction 8). `generatePassingReels` (nightly only) reads moves, puts an older promoted idea on tonight's slate by copying its latest stored `idea_scores` row (no re-scoring, no Jev), marks the promote used when filled, and records why when not. `rerankSlate` is unchanged (L2). **VM redeploy (Task 7).**

**Files:**
- Modify: `lib/reels/copy/slots.ts` (import, `SlotMoves`, `orderedForSlots`, `fillSlots` input, `pool`, `fillReserved`)
- Create: `lib/reels/pipeline/promote.ts`
- Modify: `lib/reels/pipeline/slots.ts` (`generatePassingReels`)
- Test: `tests/shared-queue-reels.test.ts` (new)

**Interfaces:**
- Consumes: `orderTonight`, `ideaRef`, `NO_MOVES` (Task 1); `readTonightMoves`, `markPromoteUsed`, `recordPromoteSkip`, `MovesQuery` (Task 2); existing `HeldOutReason`, `placedIdeas`, `fillSlots`.
- Produces: `export type SlotMoves = { promote: string | null; demoted: ReadonlySet<string> }` and `orderedForSlots(ideas, penaltyOf, moves?: SlotMoves)`, `fillSlots({ ..., moves?: SlotMoves })` in `lib/reels/copy/slots.ts`; `REEL_SKIP`, `reelsMovesQuery`, `putOnSlate(slateId: string, postIdeaId: string): Promise<boolean>` in `lib/reels/pipeline/promote.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared-queue-reels.test.ts`:

```ts
/**
 * Shared queue, Trial Reels (the 1 AM run), offline: slot order with a
 * promoted and a demoted idea (pure fillSlots with a stub attempt), and the
 * nightly generation on PGlite: an older promoted idea joins tonight's slate
 * from its stored scores (no re-scoring, no model call) and is made first; a
 * gone or person-placed one is skipped with why; no moves table, no change.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { fillSlots, orderedForSlots, type GradedLine, type SlotAttempt, type SlotIdea } from '@/lib/reels/copy/slots';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { REEL_SKIP } from '@/lib/reels/pipeline/promote';
import { generatePassingReels } from '@/lib/reels/pipeline/slots';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';

import { openHubTestDb } from './fixtures/social-hub/pglite';

// ── Slot order (pure) ───────────────────────────────────────────────────────

const idea = (id: string, net: number, framework: FrameworkId, bucket: BucketId): SlotIdea =>
  ({ id, net, bucketScore: 1, psychologyScore: 1, lastJoinedMs: 0, confidence: 1, framework, bucket });
const line = (ideaId: string, level: number): GradedLine =>
  ({ ideaId, lineIndex: 0, plain: level, stake: level, loop: 2, care: 2, reward: 2, sameStory: 0.9, inRange: true });
const pass = (id: string): SlotAttempt => ({ passed: true, judged: true, lines: [line(id, 4)] });
const miss = (id: string): SlotAttempt => ({ passed: false, judged: true, lines: [line(id, 1)] });

function recorder(result: (id: string) => SlotAttempt) {
  const tried: Array<[string, boolean]> = [];
  return { tried, attempt: async (row: SlotIdea, rewrite: boolean) => { tried.push([row.id, rewrite]); return result(row.id); } };
}

test('Q4: a promoted idea outside the knowledge lane takes slot 1 first', async () => {
  const ideas = [idea('know', 5, 'identity', 'ball_knowledge'), idea('saga', 4, 'arousal', 'the_saga'), idea('low', 1, 'arousal', 'the_warning')];
  const r = recorder(pass);
  const filled = await fillSlots({ ideas, locks: [], count: 2, penalties: new Map(), attempt: r.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: 'low', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId]), [[1, 'low'], [2, 'saga']]);
  assert.deepEqual(r.tried, [['low', true], ['saga', true]]);
});

test('a promoted non-lane idea that misses slot 1 falls through like a general idea (penalized); the lane idea opens fresh', async () => {
  const ideas = [idea('know', 5, 'identity', 'ball_knowledge'), idea('low', 1, 'arousal', 'the_warning')];
  const r = recorder((id) => (id === 'low' ? miss(id) : pass(id)));
  const penalties = new Map<string, number>();
  const shipped: string[] = [];
  const filled = await fillSlots({ ideas, locks: [], count: 1, penalties, attempt: r.attempt, onPenalty: () => undefined, onFallback: (row) => { shipped.push(row.id); }, moves: { promote: 'low', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId, s.passed]), [[1, 'know', true]]);
  assert.deepEqual(r.tried, [['low', true], ['know', true]]);
  assert.ok(penalties.has('low'), 'penalized like a general miss');
  assert.deepEqual(shipped, [], 'its miss never ships on its best line');
});

test('a demoted idea is tried last; with a lock on the lane slot a promoted lane idea leads the general pool', async () => {
  const flat = [idea('a', 5, 'arousal', 'the_saga'), idea('b', 4, 'arousal', 'the_saga'), idea('c', 3, 'arousal', 'the_saga')];
  assert.deepEqual(orderedForSlots(flat, () => 0, { promote: null, demoted: new Set(['a']) }).map((i) => i.id), ['b', 'c', 'a']);
  const r1 = recorder(pass);
  const one = await fillSlots({ ideas: flat, locks: [], count: 1, penalties: new Map(), attempt: r1.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: null, demoted: new Set(['a']) } });
  assert.deepEqual(one.map((s) => s.postIdeaId), ['b']);

  const ideas = [idea('locked', 5, 'identity', 'ball_knowledge'), idea('saga', 4, 'arousal', 'the_saga'), idea('know2', 2, 'identity', 'ball_knowledge')];
  const r2 = recorder(pass);
  const filled = await fillSlots({ ideas, locks: [{ slot: 1, postIdeaId: 'locked' }], count: 2, penalties: new Map(), attempt: r2.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: 'know2', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId]), [[1, 'locked'], [2, 'know2']]);
});

// ── The nightly generation (PGlite) ─────────────────────────────────────────

const R = {
  RUN: 'a0000000-0000-4000-8000-000000000001',
  RUN2: 'a0000000-0000-4000-8000-000000000002',
  YESTERDAY: 'a0000000-0000-4000-8000-000000000003',
  TODAY: 'a0000000-0000-4000-8000-000000000004',
  OLD: 'a0000000-0000-4000-8000-000000000011',
  CARRY: 'a0000000-0000-4000-8000-000000000012',
  GONE: 'a0000000-0000-4000-8000-000000000013',
  VIDEO_OLD: 'a0000000-0000-4000-8000-000000000021',
  VIDEO_CARRY: 'a0000000-0000-4000-8000-000000000022',
};

/** Trial Reels read lib/db.ts's shared pool: point it at PGlite (as tests/social-fill.test.ts does). */
async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  return pg;
}

/**
 * Yesterday's slate scored OLD (a saga idea, not on today's slate) and CARRY;
 * both have a finished, unposted video. Today's slate carries CARRY over
 * (knowledge lane), so without moves the one reel tonight reuses CARRY's video.
 */
async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${R.RUN}', 'scheduled', 'ok'), ('${R.RUN2}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${R.OLD}'), ('${R.CARRY}'), ('${R.GONE}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
      ('${R.YESTERDAY}', '${R.RUN2}', '2026-10-07', '2026-10-07T05:30:00Z', 'p1', 'p2'),
      ('${R.TODAY}', '${R.RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components) VALUES
      ('${R.YESTERDAY}', '${R.OLD}', 'timely', 1.1, 2, true, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{"stored":"yesterday"}'::jsonb),
      ('${R.YESTERDAY}', '${R.CARRY}', 'timely', 2.4, 1, true, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb),
      ('${R.TODAY}', '${R.CARRY}', 'carryover', 2.4, 1, false, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb);
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags) VALUES
      ('${R.YESTERDAY}', '${R.OLD}', 'v1', 'm', 'the_saga', 'arousal', 'ok', 'Old caption.', 'Follow.', ARRAY['#ai']),
      ('${R.YESTERDAY}', '${R.CARRY}', 'v1', 'm', 'ball_knowledge', 'identity', 'ok', 'Carry caption.', 'Follow.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES
      ('${R.VIDEO_OLD}', '${R.OLD}', '${R.YESTERDAY}', 'ok', '2026-10-07T07:00:00Z', 'videos/old.mp4'),
      ('${R.VIDEO_CARRY}', '${R.CARRY}', '${R.YESTERDAY}', 'ok', '2026-10-07T07:10:00Z', 'videos/carry.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist) VALUES
      ('${R.VIDEO_OLD}', '${R.OLD}', 'ok', '2026-10-07T07:05:00Z', 'aud-1', 'Song', 'Artist'),
      ('${R.VIDEO_CARRY}', '${R.CARRY}', 'ok', '2026-10-07T07:15:00Z', 'aud-2', 'Song', 'Artist');`);
}

const promote = (pg: PGlite, postIdeaId: string) =>
  pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('reels', $1, '2026-10-07', 'promote', '2026-10-07T20:00:00Z')`, [`reels:idea:${postIdeaId}`]);
const moveRow = async (pg: PGlite, postIdeaId: string) =>
  (await pg.query<{ used: boolean; skip_reason: string | null }>(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`reels:idea:${postIdeaId}`])).rows[0]!;
const onToday = async (pg: PGlite, postIdeaId: string) =>
  (await pg.query<{ origin: string; net: number; components: unknown }>(`SELECT origin, net, components FROM reels.idea_scores WHERE slate_id = $1 AND post_idea_id = $2`, [R.TODAY, postIdeaId])).rows[0] ?? null;

function noCopyClient(): CopyClient & { calls: number } {
  const client = { calls: 0, messages: { create: async () => { client.calls += 1; throw new Error('no live call in tests'); } } };
  return client as unknown as CopyClient & { calls: number };
}

test('Review Focus 4: an older promoted idea joins tonight’s slate from its stored scores, no model call, and is made first; the promote is used', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  const client = noCopyClient();
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client, dailyFill: true });
  assert.deepEqual(out.filled.map((s) => [s.postIdeaId, s.reused === true]), [[R.OLD, true]], 'its finished video takes the one reel');
  assert.equal(client.calls, 0, 'no copy written, no model call');
  const copied = await onToday(pg, R.OLD);
  assert.deepEqual([copied?.origin, Number(copied?.net), copied?.components], ['carryover', 1.1, { stored: 'yesterday' }], 'a copy of the stored row, not a new score');
  assert.deepEqual(await moveRow(pg, R.OLD), { used: true, skip_reason: null });
});

test('Review Focus 4: a promoted idea with no stored score is skipped with why; the night is unchanged', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.GONE);
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => s.postIdeaId), [R.CARRY]);
  assert.equal(await onToday(pg, R.GONE), null);
  assert.deepEqual(await moveRow(pg, R.GONE), { used: false, skip_reason: REEL_SKIP.gone });
});

test('a promoted idea a person already placed is skipped with why, not made twice', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  await pg.query(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source) VALUES ('reels', $1, '2026-10-08', 'midday', '2026-10-08T16:30:00Z', 'scheduled', 'user')`,
    [R.OLD],
  );
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => s.postIdeaId), [R.CARRY]);
  assert.deepEqual(await moveRow(pg, R.OLD), { used: false, skip_reason: REEL_SKIP.placed });
});

test('Review Focus 3: no moves table: the night runs as before; a hand-run generation never reads moves', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  const hand = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient() });
  assert.equal(await onToday(pg, R.OLD), null, 'hand-run: nothing copied onto the slate');
  assert.equal(hand.filled.some((s) => s.postIdeaId === R.OLD), false);
  assert.equal((await moveRow(pg, R.OLD)).used, false);

  await pg.exec(`DROP TABLE social_hub.idea_adjustments`);
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => [s.postIdeaId, s.reused === true]), [[R.CARRY, true]]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/shared-queue-reels.test.ts`
Expected: FAIL: `Cannot find module '@/lib/reels/pipeline/promote'`.

- [ ] **Step 3: Slot order takes moves**

In `lib/reels/copy/slots.ts`:

(a) After `import { rankForSlate, type BucketId, type FrameworkId, type RankedIdea } from '@/lib/reels/scoring/decide';` add:

```ts
import { orderTonight } from '@/lib/social-hub/views/moves';
```

(b) After the `SlotLock` type, add:

```ts
/** Shared queue: tonight's promoted idea (post idea id) and the demoted ones. */
export type SlotMoves = { promote: string | null; demoted: ReadonlySet<string> };
```

(c) Replace

```ts
export function orderedForSlots(ideas: readonly SlotIdea[], penaltyOf: (id: string) => number): SlotIdea[] {
```

with

```ts
export function orderedForSlots(ideas: readonly SlotIdea[], penaltyOf: (id: string) => number, moves?: SlotMoves): SlotIdea[] {
```

and, in the same function, replace

```ts
  return rankForSlate(ranked)
    .map((idea) => byId.get(idea.id))
    .filter((idea): idea is SlotIdea => idea != null);
}
```

with

```ts
  const ordered = rankForSlate(ranked)
    .map((idea) => byId.get(idea.id))
    .filter((idea): idea is SlotIdea => idea != null);
  // Shared queue: tonight's promoted idea first, demoted ideas last; the rest keep net − penalty order.
  return moves ? orderTonight(ordered, (idea) => idea.id, new Set(moves.promote ? [moves.promote] : []), moves.demoted) : ordered;
}
```

(d) In `fillSlots`'s input type, after `reusable?: ReadonlySet<string>;` add:

```ts
  /** Shared queue (nightly run): tonight's promote leads either pool (Q4); demoted ideas come last. */
  moves?: SlotMoves;
```

(e) Replace the `pool` function

```ts
  const pool = (mode: 'reserved' | 'general', tried: ReadonlySet<string>): SlotIdea[] => {
    const available = orderedForSlots(input.ideas, penaltyOf).filter(
      (idea) => !used.has(idea.id) && !tried.has(idea.id),
    );
    if (mode === 'reserved') {
      const lane = available.filter(inKnowledgeLane);
      return lane.length > 0 ? lane : available;
    }
    const general = available.filter((idea) => !inKnowledgeLane(idea));
    return general.length > 0 ? general : available;
  };
```

with

```ts
  const pool = (mode: 'reserved' | 'general', tried: ReadonlySet<string>): SlotIdea[] => {
    const available = orderedForSlots(input.ideas, penaltyOf, input.moves).filter(
      (idea) => !used.has(idea.id) && !tried.has(idea.id),
    );
    // Shared queue (Q4): tonight's promoted idea leads either pool, in the knowledge lane or not.
    const promoted = input.moves?.promote ? available.find((idea) => idea.id === input.moves!.promote) : undefined;
    const first = (list: SlotIdea[]) => (promoted ? [promoted, ...list.filter((idea) => idea !== promoted)] : list);
    if (mode === 'reserved') {
      const lane = available.filter(inKnowledgeLane);
      return first(lane.length > 0 ? lane : available);
    }
    const general = available.filter((idea) => !inKnowledgeLane(idea));
    return first(general.length > 0 ? general : available);
  };
```

(f) In `fillReserved`, replace

```ts
      tried.add(idea.id);
      const result = await input.attempt(idea, opener);
      opener = false;
      if (!result.judged) continue;
```

with

```ts
      tried.add(idea.id);
      const result = await input.attempt(idea, opener);
      opener = false;
      // A promoted idea outside the lane that misses falls through like a general idea (penalized, never shipped
      // on its best line); the lane idea after it opens fresh.
      if (!result.passed && idea.id === input.moves?.promote && !inKnowledgeLane(idea)) {
        if (result.judged) await penalize(idea, tried, 'general');
        opener = true;
        continue;
      }
      if (!result.judged) continue;
```

- [ ] **Step 4: The older-idea copy and skip reasons**

Create `lib/reels/pipeline/promote.ts`:

```ts
import { dbQuery } from '@/lib/db';
import type { HeldOutReason } from '@/lib/reels/copy/held-out';
import type { MovesQuery } from '@/lib/social-hub/moves-store';

/**
 * Trial Reels' side of the shared queue (spec 2026-10-14 §2): the night's
 * moves through the shared pool, an older promoted idea onto tonight's slate,
 * and the words the page shows when the night can't make it.
 */

export const reelsMovesQuery: MovesQuery = (text, params) => dbQuery(text, params);

/** Why tonight's promoted reel wasn't made (shown on the page as “Can’t be made: …”). */
export const REEL_SKIP: Record<HeldOutReason | 'gone' | 'placed' | 'missed' | 'full', string> = {
  gone: 'It isn’t in the reels pool any more.',
  placed: 'A person already put it on the calendar.',
  missed: 'Its copy missed the bar tonight.',
  full: 'Tonight’s reels were already locked.',
  already_published: 'This story already posted.',
  published_url: 'This story already posted.',
  teaser_only: 'Its sources are only teasers.',
  copy_wide_miss: 'Its last copy missed the bar by a lot.',
};

/**
 * Put an idea on tonight's slate by copying its latest stored score row from
 * an earlier slate: no re-scoring, no Jev. Origin `carryover`, the slate's
 * next rank (loadCopyTargets reads ranked rows), not selected. True when the
 * idea is on the slate with scores (already, or now); false when it has none
 * to copy or the copy fails.
 */
export async function putOnSlate(slateId: string, postIdeaId: string): Promise<boolean> {
  try {
    const on = await dbQuery(
      `SELECT 1 FROM reels.idea_scores
        WHERE slate_id = $1::uuid AND post_idea_id = $2::uuid
          AND net IS NOT NULL AND chosen_bucket IS NOT NULL AND chosen_framework IS NOT NULL`,
      [slateId, postIdeaId],
    );
    if (on.rows.length > 0) return true;
    const { rows } = await dbQuery(
      `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework,
                                      psychology, bucket_score, value_score, blockbuster, confidence, components)
       SELECT $1::uuid, s.post_idea_id, 'carryover', s.net,
              (SELECT COALESCE(max(rank), 0) + 1 FROM reels.idea_scores WHERE slate_id = $1::uuid), false,
              s.chosen_bucket, s.chosen_framework, s.psychology, s.bucket_score, s.value_score, s.blockbuster, s.confidence, s.components
         FROM reels.idea_scores s
         JOIN reels.score_slates ss ON ss.id = s.slate_id
        WHERE s.post_idea_id = $2::uuid AND s.slate_id <> $1::uuid
          AND s.net IS NOT NULL AND s.chosen_bucket IS NOT NULL AND s.chosen_framework IS NOT NULL
        ORDER BY ss.ny_date DESC, ss.scored_at DESC
        LIMIT 1
       ON CONFLICT (slate_id, post_idea_id) DO NOTHING
       RETURNING post_idea_id::text`,
      [slateId, postIdeaId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: The nightly generation reads moves**

In `lib/reels/pipeline/slots.ts`:

(a) After `import { placedIdeas, reusableVideos } from '@/lib/reels/pipeline/fill';` add:

```ts
import { putOnSlate, reelsMovesQuery, REEL_SKIP } from '@/lib/reels/pipeline/promote';
import { markPromoteUsed, readTonightMoves, recordPromoteSkip } from '@/lib/social-hub/moves-store';
import { ideaRef, NO_MOVES } from '@/lib/social-hub/views/moves';
```

(b) Replace

```ts
  const [slotIdeas, locks, penalties, published, wideMisses] = await Promise.all([
```

with

```ts
  // Shared queue (nightly run only): tonight's Promote goes first, Demotes go last. An older promoted idea joins
  // tonight's slate from its stored scores (no re-scoring). A failed read is no moves: the night runs as before.
  const tonight = input.dailyFill ? await readTonightMoves(reelsMovesQuery, 'reels') : NO_MOVES;
  const promoteId = tonight.promote ? ideaRef(tonight.promote.ideaId) : null;
  const promoteOnSlate = promoteId ? await putOnSlate(input.slateId, promoteId) : false;

  const [slotIdeas, locks, penalties, published, wideMisses] = await Promise.all([
```

(c) In the `fillSlots({ ... })` call, replace

```ts
    reusable: new Set(reusable.keys()),
```

with

```ts
    reusable: new Set(reusable.keys()),
    moves: { promote: promoteOnSlate ? promoteId : null, demoted: new Set([...tonight.demoted].map(ideaRef)) },
```

(d) Replace

```ts
  await selectFilledIdeas(
    input.slateId,
    filled.map((slot) => slot.postIdeaId),
  );
```

with

```ts
  if (tonight.promote && promoteId) {
    const made = filled.some((slot) => slot.postIdeaId === promoteId);
    const why = !promoteOnSlate
      ? REEL_SKIP.gone
      : held.has(promoteId)
        ? REEL_SKIP[held.get(promoteId)!]
        : placed.has(promoteId)
          ? REEL_SKIP.placed
          : outcomes.has(promoteId)
            ? REEL_SKIP.missed
            : REEL_SKIP.full;
    if (made) await markPromoteUsed(reelsMovesQuery, 'reels', tonight.promote.ideaId);
    else await recordPromoteSkip(reelsMovesQuery, 'reels', tonight.promote.ideaId, why);
    console.info(`[reels] tonight's promote ${promoteId}: ${made ? 'made' : `skipped (${why})`}`);
  }

  await selectFilledIdeas(
    input.slateId,
    filled.map((slot) => slot.postIdeaId),
  );
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/shared-queue-reels.test.ts tests/reels-copy-slots.test.ts tests/social-fill.test.ts`
Expected: PASS, `ℹ fail 0` (existing slot and fill tests pass no moves and are unchanged).

- [ ] **Step 7: Type check and the suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0` apart from known environment failures.

- [ ] **Step 8: Commit**

```bash
git add lib/reels/copy/slots.ts lib/reels/pipeline/promote.ts lib/reels/pipeline/slots.ts tests/shared-queue-reels.test.ts
git commit -m "feat(reels): the 1 AM run makes tonight's promote first (older ideas join from stored scores), sinks demotes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Carousels (3 AM) take `--promote-id`

`claimRun` returns the run's trigger. On the scheduled run only (no `--story-id` pinning, no rerun), the worker reads tonight's carousel moves and passes `--promote-id <story id>` and repeatable `--demote-id <story id>` to `scripts/social_daily.ts`. The script keeps fresh fetching and selection; a `promotedStages` wrapper puts the promoted story (from `loadPinnedCandidates`) above every fresh score (dedupe by id) and demoted stories below every other score; `targetPosts` is unchanged. A promoted story that already posted or isn't in a recent shortlist is skipped with why; after the run the promote is used if shipped, else skipped with why. `--story-id` pinning is untouched. **VM redeploy (Task 7).**

**Files:**
- Modify: `lib/social/overnight/runs.ts` (`claimRun` returns `trigger`)
- Create: `lib/social/overnight/promote.ts`
- Modify: `scripts/social_worker.ts` (imports, `runDailyScript`, `carryOutRun`)
- Modify: `scripts/social_daily.ts` (args, load, stages, settle)
- Test: `tests/shared-queue-carousels.test.ts` (new)

**Interfaces:**
- Consumes: `readTonightMoves`, `markPromoteUsed`, `recordPromoteSkip` (Task 2); `ideaRef` (Task 1); existing `loadPinnedCandidates(query, storyIds)`, `runDay`, `RunDayResult`, `PipelineStages`, `ScoredCandidate`, `Query`.
- Produces (from `lib/social/overnight/promote.ts`): `NOT_IN_SHORTLIST`, `ALREADY_POSTED`, `ON_CALENDAR`, `carouselIdeaId(storyId)`, `loadPromoted(query, storyId): Promise<ScoredCandidate | null>`, `promotedStages(stages, promoted: ScoredCandidate | null, demoted: ReadonlySet<string>): PipelineStages`, `settlePromote(query, storyId, result: Pick<RunDayResult, 'shipped' | 'onCalendar' | 'setAsides'>): Promise<void>`; `claimRun(...)` → `{ id, capUsd, hookPass, storyIds, trigger: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared-queue-carousels.test.ts`:

```ts
/**
 * Shared queue, Carousels (the 3 AM run), offline: the promoted story goes
 * ahead of the fresh candidates (deduped) and takes one of the usual posts,
 * demoted stories go last, a promoted story that already posted or is in no
 * recent shortlist is skipped with why, and the move is used once shipped.
 * Stub stages and PGlite: no feeds, no model calls.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { ALREADY_POSTED, NOT_IN_SHORTLIST, ON_CALENDAR, loadPromoted, promotedStages, settlePromote } from '@/lib/social/overnight/promote';
import { claimRun, requestRun } from '@/lib/social/overnight/runs';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages, stubCandidates } from '@/lib/social/pipeline/stubs';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import type { Query } from '@/lib/social/store/pg';

const NIGHT = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function carouselDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}

/** A real story id is its URL (the database tests below); the stub selection uses the URL's last segment. */
const OLD = 'https://example.com/story-old';

/** A stored story from an earlier night's shortlist, as selection would rank it (stub id `story-old`). */
const oldCandidate = (): ScoredCandidate => stubCandidates([{ ...STUB_ARTICLES[0]!, sourceUrl: OLD, headline: 'Old promoted story' }])[0]!;

async function night(promoted: ScoredCandidate | null, demoted: string[]) {
  return runDay({
    articles: STUB_ARTICLES,
    stages: promotedStages(createStubStages(), promoted, new Set(demoted)),
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts: 2,
  });
}

test('the promoted story goes ahead of the fresh candidates and takes one of the usual posts; a demoted story goes last', async () => {
  const result = await night(oldCandidate(), ['story-a']);
  assert.deepEqual(result.shipped.map((e) => e.storyId), ['story-old', 'story-b'], 'two posts, as usual: the promote, then the best fresh story not demoted');
});

test('a promoted story that is also a fresh candidate appears once', async () => {
  const fresh = stubCandidates(STUB_ARTICLES);
  const stages = promotedStages(createStubStages(), { ...fresh[2]!, score: 0 }, new Set());
  const res = await stages.score(STUB_ARTICLES, NIGHT);
  assert.ok(res.ok);
  if (res.ok) assert.deepEqual(res.value.map((c) => c.id), ['story-c', 'story-a', 'story-b']);
  assert.deepEqual((await night({ ...fresh[2]!, score: 0 }, [])).shipped.map((e) => e.storyId), ['story-c', 'story-a']);
});

const group = (id: string, headline: string) => ({
  id,
  members: [{ url: id, title: headline, outlet: 'Example', feedSlug: 'x', publishedAt: '2026-10-05T12:00:00.000Z' }],
  outlets: ['Example'],
  outletCount: 1,
  publishedAt: '2026-10-05T12:00:00.000Z',
  representative: { headline, sourceUrl: id },
  articles: [],
  body: `${headline} body`,
  read: [{ url: id, chars: 900, outlet: 'Example' }],
  answers: {},
  status: 'qualified',
  passes: 4,
  probSum: 4.1,
});

async function shortlist(query: Query, ids: string[]) {
  await query(
    `INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, record, status) VALUES ('daily', '2026-10-06T07:00:00Z', true, 2, $1::jsonb, 'ok')`,
    [JSON.stringify({ selection: { shortlist: ids.map((id) => group(id, `Story ${id}`)) } })],
  );
}

async function promote(query: Query, storyId: string) {
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('carousels', $1, '2026-10-07', 'promote')`, [`carousels:story:${storyId}`]);
}

const moveRow = async (query: Query, storyId: string) =>
  (await query(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`carousels:story:${storyId}`])).rows[0] as { used: boolean; skip_reason: string | null };

test('loadPromoted: a story in an earlier shortlist is loaded; one in none is skipped with why', async () => {
  const query = await carouselDb();
  await shortlist(query, [OLD]);
  assert.equal((await loadPromoted(query, OLD))?.id, OLD);
  await promote(query, 'https://example.com/never-seen');
  assert.equal(await loadPromoted(query, 'https://example.com/never-seen'), null);
  assert.deepEqual(await moveRow(query, 'https://example.com/never-seen'), { used: false, skip_reason: NOT_IN_SHORTLIST });
});

test('Review Focus 1: a promoted story that already posted is never made again; it is skipped with why', async () => {
  const query = await carouselDb();
  await shortlist(query, [OLD]);
  await promote(query, OLD);
  await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, slide_objects) VALUES ('posted-old', $1, 't', 'published', $2::jsonb, $3::jsonb)`,
    [OLD, JSON.stringify({ caption: 'c', attributionBlock: null, slides: [] }), JSON.stringify(['posts/posted-old/a.jpg'])],
  );
  assert.equal(await loadPromoted(query, OLD), null);
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: ALREADY_POSTED });
});

test('settlePromote: shipped uses the move; on the calendar or set aside records why and keeps it', async () => {
  const query = await carouselDb();
  await promote(query, OLD);
  await settlePromote(query, OLD, { shipped: [], onCalendar: [OLD], setAsides: [] });
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: ON_CALENDAR });
  await settlePromote(query, OLD, { shipped: [], onCalendar: [], setAsides: [{ day: '2026-10-08', storyId: OLD, stage: 'reporter', reasonCode: 'service-error', kind: 'glitch', detail: 'x', at: NIGHT.toISOString() } as never] });
  assert.match((await moveRow(query, OLD)).skip_reason ?? '', /set it aside at reporter/);
  await settlePromote(query, OLD, { shipped: [{ storyId: OLD, reusedPostId: null }], onCalendar: [], setAsides: [] });
  assert.equal((await moveRow(query, OLD)).used, true);
});

test('claimRun says which trigger queued the run (only the scheduled run reads moves)', async () => {
  const query = await carouselDb();
  await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  assert.equal((await claimRun(query))?.trigger, 'scheduled');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/shared-queue-carousels.test.ts`
Expected: FAIL: `Cannot find module '@/lib/social/overnight/promote'`.

- [ ] **Step 3: `claimRun` returns the trigger**

In `lib/social/overnight/runs.ts`, in `claimRun` replace

```ts
export async function claimRun(query: Query, now = new Date()): Promise<{ id: string; capUsd: number; hookPass: boolean; storyIds: string[] } | null> {
```

with

```ts
export async function claimRun(query: Query, now = new Date()): Promise<{ id: string; capUsd: number; hookPass: boolean; storyIds: string[]; trigger: string } | null> {
```

replace

```ts
        RETURNING id, cap_usd, hook_pass, story_ids`,
```

with

```ts
        RETURNING id, cap_usd, hook_pass, story_ids, trigger`,
```

and replace

```ts
    return r ? { id: r.id as string, capUsd: Number(r.cap_usd), hookPass: r.hook_pass as boolean, storyIds: (r.story_ids as string[] | null) ?? [] } : null;
```

with

```ts
    return r ? { id: r.id as string, capUsd: Number(r.cap_usd), hookPass: r.hook_pass as boolean, storyIds: (r.story_ids as string[] | null) ?? [], trigger: String(r.trigger) } : null;
```

- [ ] **Step 4: The carousel promote module**

Create `lib/social/overnight/promote.ts`:

```ts
import { loadPinnedCandidates } from '@/lib/social/overnight/pinned';
import type { RunDayResult } from '@/lib/social/pipeline/orchestrator';
import type { PipelineStages } from '@/lib/social/pipeline/stages';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import type { Query } from '@/lib/social/store/pg';
import { markPromoteUsed, recordPromoteSkip } from '@/lib/social-hub/moves-store';

/**
 * Carousels' side of the shared queue (spec 2026-10-14 §4). The 3 AM run
 * keeps its fresh fetch and selection; tonight's promoted story (from an
 * earlier run's shortlist) goes ahead of every fresh candidate and takes one
 * of the usual posts; demoted stories go below every other. The existing
 * guards still apply (storedPostFor, storyOnCalendar in runDay); a story that
 * already posted is the one check added, since a promote skips selection's
 * already-posted check (Spec correction 4). Distinct from --story-id pinning.
 */

export const NOT_IN_SHORTLIST = 'It isn’t in any recent run’s shortlist any more.';
export const ALREADY_POSTED = 'This story already posted.';
export const ON_CALENDAR = 'It’s already on the calendar.';

export const carouselIdeaId = (storyId: string) => `carousels:story:${storyId}`;

/** True when any post of the story went out (its post is published, or a publish try for it was). */
async function storyPosted(query: Query, storyId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM social.posts p
         LEFT JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = p.id::text
        WHERE p.story_id = $1
          AND (p.status = 'published'
               OR EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.content_item_id = ci.id AND a.status = 'published'))) AS posted`,
    [storyId],
  );
  return rows[0]?.posted === true;
}

/** Tonight's promoted story as a candidate, or null (skipped with why on the move; a failed read: no promote, as before). */
export async function loadPromoted(query: Query, storyId: string): Promise<ScoredCandidate | null> {
  try {
    if (await storyPosted(query, storyId)) {
      await recordPromoteSkip(query, 'carousels', carouselIdeaId(storyId), ALREADY_POSTED);
      return null;
    }
  } catch {
    return null;
  }
  try {
    return (await loadPinnedCandidates(query, [storyId]))[0] ?? null;
  } catch {
    await recordPromoteSkip(query, 'carousels', carouselIdeaId(storyId), NOT_IN_SHORTLIST);
    return null;
  }
}

/** Selection as usual, then: the promoted story above every fresh score (once), demoted stories below every other. */
export function promotedStages(stages: PipelineStages, promoted: ScoredCandidate | null, demoted: ReadonlySet<string>): PipelineStages {
  return {
    ...stages,
    async score(articles, now) {
      const res = await stages.score(articles, now);
      if (!res.ok) return res;
      const fresh = res.value.filter((c) => c.id !== promoted?.id);
      const scores = fresh.map((c) => c.score);
      const top = Math.max(0, ...scores);
      const bottom = Math.min(0, ...scores);
      const kept = fresh.filter((c) => !demoted.has(c.id));
      const sunk = fresh.filter((c) => demoted.has(c.id)).map((c, i) => ({ ...c, score: bottom - 1 - i }));
      return { ...res, value: [...(promoted ? [{ ...promoted, score: top + 1 }] : []), ...kept, ...sunk] };
    },
  };
}

/** After the run: the promote is used when shipped (made or a stored post reused); otherwise why, on the move. */
export async function settlePromote(query: Query, storyId: string, result: Pick<RunDayResult, 'shipped' | 'onCalendar' | 'setAsides'>): Promise<void> {
  const ideaId = carouselIdeaId(storyId);
  if (result.shipped.some((e) => e.storyId === storyId)) {
    await markPromoteUsed(query, 'carousels', ideaId);
    return;
  }
  const aside = result.setAsides.find((s) => s.storyId === storyId);
  const reason = result.onCalendar.includes(storyId)
    ? ON_CALENDAR
    : aside
      ? `The pipeline set it aside at ${aside.stage} (${aside.reasonCode}).`
      : 'Tonight’s run stopped before it.';
  await recordPromoteSkip(query, 'carousels', ideaId, reason);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test tests/shared-queue-carousels.test.ts tests/social-run-pinned.test.ts tests/social-overnight.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 6: The worker passes tonight's moves (worker code)**

In `scripts/social_worker.ts`:

(a) After `const { quotaFilledNote, reportFill } = await import('@/lib/social-hub/fill');` add:

```ts
  const { readTonightMoves } = await import('@/lib/social-hub/moves-store');
  const { ideaRef } = await import('@/lib/social-hub/views/moves');
```

(b) Replace

```ts
  function runDailyScript(runId: string, stories: number, capUsd: number, rerunPostId?: string, storyIds: readonly string[] = []): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const args = ['scripts/social_daily.ts', '--run-id', runId, '--stories', String(stories), '--cap-usd', String(capUsd), ...(rerunPostId ? ['--rerun-post', rerunPostId] : []), ...storyIds.flatMap((id) => ['--story-id', id])];
```

with

```ts
  function runDailyScript(
    runId: string,
    stories: number,
    capUsd: number,
    rerunPostId?: string,
    storyIds: readonly string[] = [],
    moves: { promoteId: string | null; demoteIds: readonly string[] } = { promoteId: null, demoteIds: [] },
  ): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const args = [
        'scripts/social_daily.ts', '--run-id', runId, '--stories', String(stories), '--cap-usd', String(capUsd),
        ...(rerunPostId ? ['--rerun-post', rerunPostId] : []),
        ...storyIds.flatMap((id) => ['--story-id', id]),
        ...(moves.promoteId ? ['--promote-id', moves.promoteId] : []),
        ...moves.demoteIds.flatMap((id) => ['--demote-id', id]),
      ];
```

(c) Replace

```ts
  async function carryOutRun(run: { id: string; capUsd: number; storyIds?: string[] }, rerun?: { requestId: string; postId: string }): Promise<void> {
    const pinned = run.storyIds ?? [];
    let stories = pinned.length || 1;
```

with

```ts
  async function carryOutRun(run: { id: string; capUsd: number; storyIds?: string[]; trigger?: string }, rerun?: { requestId: string; postId: string }): Promise<void> {
    const pinned = run.storyIds ?? [];
    let stories = pinned.length || 1;
    let moves: { promoteId: string | null; demoteIds: string[] } = { promoteId: null, demoteIds: [] };
```

(d) Replace

```ts
      if (fill && stories < 1) {
        const note = `${quotaFilledNote(fill, 'carousel')} The run made nothing new.`;
        await runs.skipRun(query, run.id, note);
        log('run_skipped', { runId: run.id, reason: 'quota_filled', note });
        return;
      }
    }
```

with

```ts
      if (fill && stories < 1) {
        const note = `${quotaFilledNote(fill, 'carousel')} The run made nothing new.`;
        await runs.skipRun(query, run.id, note);
        log('run_skipped', { runId: run.id, reason: 'quota_filled', note });
        return;
      }
      // Shared queue: the 3 AM run makes tonight's carousel promote first and sinks demoted stories (a failed read: no moves).
      if (run.trigger === 'scheduled') {
        const tonight = await readTonightMoves(query, 'carousels');
        moves = { promoteId: tonight.promote ? ideaRef(tonight.promote.ideaId) : null, demoteIds: [...tonight.demoted].map(ideaRef) };
        if (moves.promoteId || moves.demoteIds.length) log('run_moves', { runId: run.id, ...moves });
      }
    }
```

(e) Replace

```ts
    const { code, tail } = await runDailyScript(run.id, stories, run.capUsd, rerun?.postId, pinned);
```

with

```ts
    const { code, tail } = await runDailyScript(run.id, stories, run.capUsd, rerun?.postId, pinned, moves);
```

- [ ] **Step 7: The daily script takes `--promote-id` / `--demote-id` (worker code)**

In `scripts/social_daily.ts`:

(a) After

```ts
  if (pinnedIds.length && (!runIdArg || rerunPostArg)) throw new Error('--story-id needs a --run-id and cannot be combined with --rerun-post');
```

add

```ts
  // --promote-id / --demote-id (repeatable): the 3 AM run's shared queue (social_worker reads the moves). The promoted
  // story goes ahead of the fresh candidates and takes one of the usual posts; demoted stories rank last.
  const promoteId = (() => {
    const i = process.argv.indexOf('--promote-id');
    return i > 0 ? process.argv[i + 1] : undefined;
  })();
  const demoteIds = process.argv.flatMap((a, i) => (a === '--demote-id' && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
  if ((promoteId || demoteIds.length) && (!runIdArg || rerunPostArg || pinnedIds.length)) {
    throw new Error('--promote-id and --demote-id need a --run-id and cannot be combined with --rerun-post or --story-id');
  }
```

(b) After

```ts
  const pinned = pinnedLib ? await pinnedLib.loadPinnedCandidates(store.query!, pinnedIds) : null;
```

add

```ts
  // Tonight's promote: its newest shortlist entry. Already posted or not found: skipped, with why on the move.
  const promoteLib = promoteId || demoteIds.length ? await import('@/lib/social/overnight/promote') : null;
  const promoted = promoteLib && promoteId ? await promoteLib.loadPromoted(store.query!, promoteId) : null;
```

(c) Replace

```ts
    stages: rerun && rerunLib ? rerunLib.rerunStages(stages, rerun, rerunLib.rereadPages(rerun, readPage)) : pinned && pinnedLib ? pinnedLib.pinnedStages(stages, pinned) : stages,
```

with

```ts
    stages: rerun && rerunLib
      ? rerunLib.rerunStages(stages, rerun, rerunLib.rereadPages(rerun, readPage))
      : pinned && pinnedLib
        ? pinnedLib.pinnedStages(stages, pinned)
        : promoteLib
          ? promoteLib.promotedStages(stages, promoted, new Set(demoteIds))
          : stages,
```

(d) Before

```ts
  // 7-day rule: a photo counts as used once its post reaches the review queue (today: the preview).
```

add

```ts
  // Shared queue: a promote the run shipped is used; one it didn't is skipped with why (it stays promoted).
  if (promoteLib && promoted) await promoteLib.settlePromote(store.query!, promoted.id, result);

```

- [ ] **Step 8: Type check and the suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0` apart from known environment failures.

- [ ] **Step 9: Confirm `--story-id` pinning is untouched**

Run: `git diff HEAD -- lib/social/overnight/pinned.ts && grep -n "story-id" scripts/social_daily.ts scripts/social_worker.ts`
Expected: no diff for `pinned.ts`; the existing `--story-id` lines are present and unchanged apart from the new combination guard.

- [ ] **Step 10: Commit**

```bash
git add lib/social/overnight/runs.ts lib/social/overnight/promote.ts scripts/social_worker.ts scripts/social_daily.ts tests/shared-queue-carousels.test.ts
git commit -m "feat(carousels): the 3 AM run makes tonight's promote first (--promote-id), sinks demotes (--demote-id)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The page says what the night will do

One tag per moved idea, from the shared rule: "Tonight" on the idea the night makes first, "Promoted · waiting" on other promotes, "Can’t be made: <reason>" when a worker skipped tonight's promote today (New York date), "Demoted" on demoted ideas. Shown on the type page's bench (`TypeHub`), Today's cards (`TodayStrip`) and the pool page (`PoolScreen`, which also puts the promote first and demoted last; otherwise score order, L2). Promote/Demote button titles say the new rule. Web only, no VM redeploy.

**Files:**
- Modify: `lib/social-hub/views/moves.ts` (add `MoveTag`, `moveTags`)
- Modify: `lib/social-hub/views/day-rank.ts` (`RankedIdea.tag`, `QuotaCandidate.tag`, `dayRanking(…, now)`, `quotaCandidates`)
- Modify: `lib/content-type/model.ts` (`TypeBenchItem.tag`, `dayRanking(…, now)`, `row`)
- Modify: `lib/social-hub/views/pools.ts` (`poolList(…, adjustments)`)
- Modify: `components/content-type/TypeHub.tsx`, `components/social-hub/content/TodayStrip.tsx`, `components/social-hub/content/PoolScreen.tsx`, `components/content-type/RankButtons.tsx`
- Test: `tests/social-hub-move-tags.test.ts` (new)

**Interfaces:**
- Consumes: `IdeaAdjustment.skipReason` / `skippedAt` (Task 2 `readAdjustments`); `tonightPromotes`, `latestMoves`, `applyMoves`, `movesFor` (Task 1).
- Produces: `type MoveTag = { kind: 'tonight' | 'waiting' | 'cant' | 'demoted'; text: string }`; `moveTags(moves: readonly IdeaAdjustment[], vertical: Vertical, now: Date): Map<string, MoveTag>`; `RankedIdea.tag: MoveTag | null`; `QuotaCandidate.tag?: MoveTag | null`; `TypeBenchItem.tag?: MoveTag | null`; `dayRanking(ideas, vertical, adjustments, now = new Date())`; `poolList(ideas, vertical, filter, adjustments = [])`.

- [ ] **Step 1: Write the failing tests**

Create `tests/social-hub-move-tags.test.ts`:

```ts
/**
 * Shared queue, the page (spec 2026-10-14 §7), pure and offline: one tag per
 * moved idea ("Tonight", "Promoted · waiting", "Can’t be made: …" for a skip
 * from today's night, "Demoted"), on the ranking, Today's candidates and the
 * pool, which puts the promote first and demoted last and is otherwise in
 * score order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { moveTags, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { poolList } from '@/lib/social-hub/views/pools';

const NOW = new Date('2026-10-14T15:00:00Z'); // 11 AM New York

const idea = (n: number, score: number): HubIdea => ({
  id: `reels:idea:${n}`, vertical: 'reels', title: `Idea ${n}`, score, scoreLabel: 'Net', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null,
});
const IDEAS = [idea(1, 4), idea(2, 3), idea(3, 2), idea(4, 1)];
const mv = (n: number, kind: 'promote' | 'demote', createdAt: string, over: Partial<IdeaAdjustment> = {}): IdeaAdjustment =>
  ({ id: `m${n}${kind}`, vertical: 'reels', ideaId: `reels:idea:${n}`, nyDate: createdAt.slice(0, 10), kind, createdAt, ...over });
const MOVES = [mv(3, 'promote', '2026-10-13T12:00:00.000Z'), mv(4, 'promote', '2026-10-13T13:00:00.000Z'), mv(1, 'demote', '2026-10-13T14:00:00.000Z')];
const text = (tags: Map<string, { text: string }>, n: number) => tags.get(`reels:idea:${n}`)?.text ?? null;

test('one tag per moved idea: Tonight, Promoted · waiting, Demoted', () => {
  const tags = moveTags(MOVES, 'reels', NOW);
  assert.deepEqual([1, 2, 3, 4].map((n) => text(tags, n)), ['Demoted', null, 'Tonight', 'Promoted · waiting']);
  assert.equal(moveTags(MOVES, 'carousels', NOW).size, 0, 'per type');
});

test('a skip from today’s night reads “Can’t be made”; one from an earlier night reads Tonight again', () => {
  const reason = 'It isn’t in the reels pool any more.';
  const today = moveTags([mv(3, 'promote', '2026-10-13T12:00:00.000Z', { skipReason: reason, skippedAt: '2026-10-14T05:20:00.000Z' })], 'reels', NOW);
  assert.deepEqual(today.get('reels:idea:3'), { kind: 'cant', text: `Can’t be made: ${reason}` });
  const stale = moveTags([mv(3, 'promote', '2026-10-13T12:00:00.000Z', { skipReason: reason, skippedAt: '2026-10-13T05:20:00.000Z' })], 'reels', NOW);
  assert.deepEqual(stale.get('reels:idea:3'), { kind: 'tonight', text: 'Tonight' });
});

test('the ranking and Today’s candidates carry the tag', () => {
  const ranked = dayRanking(IDEAS, 'reels', MOVES, NOW);
  assert.deepEqual(ranked.map((r) => [r.idea.title, r.tag?.text ?? null]), [['Idea 3', 'Tonight'], ['Idea 2', null], ['Idea 4', 'Promoted · waiting'], ['Idea 1', 'Demoted']]);
  const cards = quotaCandidates({ posts: [], ideas: IDEAS, adjustments: MOVES, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(cards.map((c) => [c.idea?.title, c.tag?.text ?? null]), [['Idea 3', 'Tonight'], ['Idea 2', null]]);
});

test('the pool puts the promote first and demoted last; otherwise score order (L2)', () => {
  assert.deepEqual(poolList(IDEAS, 'reels', 'open').map((i) => i.title), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(poolList(IDEAS, 'reels', 'open', MOVES).map((i) => i.title), ['Idea 3', 'Idea 2', 'Idea 4', 'Idea 1']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test tests/social-hub-move-tags.test.ts`
Expected: FAIL: `moveTags` is not exported by `lib/social-hub/views/moves.ts`.

- [ ] **Step 3: `moveTags` in the rule module**

Append to `lib/social-hub/views/moves.ts`:

```ts
/** What the page says about a moved idea. */
export type MoveTag = { kind: 'tonight' | 'waiting' | 'cant' | 'demoted'; text: string };

const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/**
 * One tag per moved idea of a type (spec §7): the promote the night makes
 * first is "Tonight", or "Can’t be made: <reason>" when a worker skipped it
 * on today's (New York) night; other promotes "Promoted · waiting"; demoted
 * ideas "Demoted". Latest move per idea, as the rule.
 */
export function moveTags(moves: readonly IdeaAdjustment[], vertical: Vertical, now: Date): Map<string, MoveTag> {
  const mine = moves.filter((m) => m.vertical === vertical);
  const tonight = new Set(tonightPromotes(mine).map((m) => m.ideaId));
  const today = NY_DAY.format(now);
  const tags = new Map<string, MoveTag>();
  for (const m of latestMoves(mine)) {
    if (m.kind === 'demote') tags.set(m.ideaId, { kind: 'demoted', text: 'Demoted' });
    else if (!tonight.has(m.ideaId)) tags.set(m.ideaId, { kind: 'waiting', text: 'Promoted · waiting' });
    else if (m.skipReason && m.skippedAt && NY_DAY.format(new Date(m.skippedAt)) === today) tags.set(m.ideaId, { kind: 'cant', text: `Can’t be made: ${m.skipReason}` });
    else tags.set(m.ideaId, { kind: 'tonight', text: 'Tonight' });
  }
  return tags;
}
```

- [ ] **Step 4: The ranking carries the tag**

In `lib/social-hub/views/day-rank.ts`:

(a) Replace

```ts
import { applyMoves, movesFor, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
```

with

```ts
import { applyMoves, movesFor, moveTags, type IdeaAdjustment, type MoveTag } from '@/lib/social-hub/views/moves';
```

and replace

```ts
export type { IdeaAdjustment };
```

with

```ts
export type { IdeaAdjustment, MoveTag };
```

(b) Replace

```ts
export type RankedIdea = { idea: HubIdea; rank: number; moved: 'promoted' | 'demoted' | null };
```

with

```ts
export type RankedIdea = { idea: HubIdea; rank: number; moved: 'promoted' | 'demoted' | null; tag: MoveTag | null };
```

(c) In `QuotaCandidate`, after `moved: RankedIdea['moved'];` add:

```ts
  /** The shared queue's tag: Tonight, Promoted · waiting, Can’t be made: …, Demoted. */
  tag?: MoveTag | null;
```

(d) Replace

```ts
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[]): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical);
```

with

```ts
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[], now = new Date()): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical);
  const tags = moveTags(moves, vertical, now);
```

and replace

```ts
    applyMoves(rankIdeas(list), moves).forEach((idea, i) => out.push({ idea, rank: i + 1, moved: lastMove.get(idea.id) ?? null }));
```

with

```ts
    applyMoves(rankIdeas(list), moves).forEach((idea, i) => out.push({ idea, rank: i + 1, moved: lastMove.get(idea.id) ?? null, tag: tags.get(idea.id) ?? null }));
```

(e) In `quotaCandidates`, replace

```ts
  const full = dayRanking(data.ideas, vertical, data.adjustments ?? []);
```

with

```ts
  const full = dayRanking(data.ideas, vertical, data.adjustments ?? [], now);
```

replace

```ts
    return { vertical, idea: r?.idea ?? null, post, locked: locked.includes(post), rank: r?.rank ?? null, moved: r?.moved ?? null };
```

with

```ts
    return { vertical, idea: r?.idea ?? null, post, locked: locked.includes(post), rank: r?.rank ?? null, moved: r?.moved ?? null, tag: r?.tag ?? null };
```

and replace

```ts
    out.push({ vertical, idea: r.idea, post: contentFor(r.idea, data.posts), locked: false, rank: r.rank, moved: r.moved });
```

with

```ts
    out.push({ vertical, idea: r.idea, post: contentFor(r.idea, data.posts), locked: false, rank: r.rank, moved: r.moved, tag: r.tag });
```

- [ ] **Step 5: The pool order**

In `lib/social-hub/views/pools.ts`, after `import type { HubIdea, IdeaState, Vertical } from '@/lib/social-hub/types';` add:

```ts
import { applyMoves, movesFor, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
```

and replace

```ts
export function poolList(ideas: readonly HubIdea[], vertical: Vertical, filter: PoolFilter): HubIdea[] {
  const mine = ideas.filter((i) => i.vertical === vertical);
  const kept = filter === 'all' ? mine : filter === 'ready' ? mine.filter((i) => i.state === 'content_ready') : mine.filter((i) => OPEN.has(i.state));
  return rankIdeas(kept);
}
```

with

```ts
/** A type's pool in score order, with the shared queue on top: tonight's promote first, demoted ideas last (L2). */
export function poolList(ideas: readonly HubIdea[], vertical: Vertical, filter: PoolFilter, adjustments: readonly IdeaAdjustment[] = []): HubIdea[] {
  const mine = ideas.filter((i) => i.vertical === vertical);
  const kept = filter === 'all' ? mine : filter === 'ready' ? mine.filter((i) => i.state === 'content_ready') : mine.filter((i) => OPEN.has(i.state));
  return applyMoves(rankIdeas(kept), movesFor(adjustments, vertical));
}
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/social-hub-move-tags.test.ts tests/social-hub-moves.test.ts tests/social-hub-run-today.test.ts`
Expected: PASS, `ℹ fail 0`.

- [ ] **Step 7: The type page model and the components**

In `lib/content-type/model.ts`:

(a) After `import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';` add:

```ts
import type { MoveTag } from '@/lib/social-hub/views/moves';
```

(b) In `TypeBenchItem`, after `moved?: 'promoted' | 'demoted' | null;` add:

```ts
  /** The shared queue's tag (Tonight, Promoted · waiting, Can’t be made: …, Demoted). */
  tag?: MoveTag | null;
```

(c) Replace

```ts
  const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? []);
  const open = ranking.map((r) => r.idea);
  const movedOf = new Map(ranking.map((r) => [r.idea.id, r.moved]));
```

with

```ts
  const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? [], now);
  const open = ranking.map((r) => r.idea);
  const movedOf = new Map(ranking.map((r) => [r.idea.id, r.moved]));
  const tagOf = new Map(ranking.map((r) => [r.idea.id, r.tag]));
```

(d) Replace

```ts
    idea, rank, card, made: card ? madeKind(card.post) : null, moved: movedOf.get(idea.id) ?? null, inQuota: quotaIdeas.has(idea.id),
```

with

```ts
    idea, rank, card, made: card ? madeKind(card.post) : null, moved: movedOf.get(idea.id) ?? null, tag: tagOf.get(idea.id) ?? null, inQuota: quotaIdeas.has(idea.id),
```

In `components/content-type/TypeHub.tsx`, replace

```tsx
                      {item.moved ? <span className="rh-chip">{item.moved === 'promoted' ? 'Promoted' : 'Demoted'}</span> : null}
```

with

```tsx
                      {item.tag ? <span className="rh-chip" title={item.tag.text}>{item.tag.text}</span> : null}
```

In `components/social-hub/content/TodayStrip.tsx`, replace

```tsx
  const tag = c.rank == null ? null : `#${c.rank} in the queue${c.moved === 'promoted' ? ' · Promoted' : c.moved === 'demoted' ? ' · Demoted' : ''}`;
```

with

```tsx
  const tag = c.rank == null ? null : `#${c.rank} in the queue${c.tag ? ` · ${c.tag.text}` : ''}`;
```

In `components/social-hub/content/PoolScreen.tsx`:

(a) After `import { IDEA_STATE_LABEL, poolList, poolStale, poolSummary, type PoolFilter } from '@/lib/social-hub/views/pools';` add:

```tsx
import { moveTags } from '@/lib/social-hub/views/moves';
```

(b) Replace

```tsx
  const ideas = poolList(dataset.ideas, vertical, filter);
```

with

```tsx
  const ideas = poolList(dataset.ideas, vertical, filter, dataset.adjustments ?? []);
  const tags = moveTags(dataset.adjustments ?? [], vertical, now);
```

(c) Replace

```tsx
                        <span className="sh-cell-post__name">{idea.title}</span>
```

with

```tsx
                        <span className="sh-cell-post__name">{idea.title}</span>
                        {tags.get(idea.id) ? <span className="sh-chip">{tags.get(idea.id)!.text}</span> : null}
```

In `components/content-type/RankButtons.tsx`, replace

```tsx
 * Promote makes it #1 for today; Demote moves it below the idea right under
 * it. Today's quota goes to the top of the ranking, so this decides what
 * today's content is. Moves expire with the day.
```

with

```tsx
 * Promote makes it next: the night makes one promote per type, oldest first
 * (lib/social-hub/views/moves.ts). Demote sinks it below every other idea.
 * A move lasts until its idea is made.
```

and replace

```tsx
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('promote')} title="Promote: #1 for today" aria-label="Promote to #1 for today">
```

with

```tsx
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('promote')} title="Promote: the night makes it next (one a night, oldest first)" aria-label="Promote: make it next">
```

and replace

```tsx
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('demote')} title="Demote: below the next idea, for today" aria-label="Demote one place for today">
```

with

```tsx
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('demote')} title="Demote: below every other idea" aria-label="Demote below every other idea">
```

- [ ] **Step 8: Type check and the suite**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no type errors; `fail 0` apart from known environment failures.

- [ ] **Step 9: Commit**

```bash
git add lib/social-hub/views/moves.ts lib/social-hub/views/day-rank.ts lib/content-type/model.ts lib/social-hub/views/pools.ts components/content-type/TypeHub.tsx components/social-hub/content/TodayStrip.tsx components/social-hub/content/PoolScreen.tsx components/content-type/RankButtons.tsx tests/social-hub-move-tags.test.ts
git commit -m "feat(social-hub): Tonight / Promoted · waiting / Can't be made / Demoted tags on the pool and type pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final check and the deploy list for a human (do not execute)

**Files:** none.

- [ ] **Step 1: Whole suite, types, and a clean tree**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`, `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`, `git status --short`
Expected: `fail 0` apart from known `helios_text_engine/.venv` environment failures; no type errors; no uncommitted tracked changes.

- [ ] **Step 2: No live call slipped into a test, and no new model call in code**

Run: `grep -nE "anthropic|newAnthropic|liveJevTransport|web_search|createJevAsk" tests/shared-queue-*.test.ts tests/social-hub-moves.test.ts tests/social-hub-move-tags.test.ts; git diff --stat main...HEAD -- lib scripts | tail -1; git diff main...HEAD -- lib scripts | grep -nE "^\+.*(messages\.create|systemOne\(|createJevAsk)"`
Expected: no matches from either grep (the `diff --stat` line just counts the changed files).

- [ ] **Step 3: List the worker files that changed**

Run: `git diff --stat main...HEAD -- lib/stories lib/explainers lib/reels lib/social scripts db lib/social-hub/moves-store.ts lib/social-hub/views/moves.ts`
Expected: `lib/stories/build/index.ts`, `lib/explainers/ideas/cycle.ts`, `lib/explainers/ideas/evaluate.ts`, `scripts/explainers_worker.ts`, `lib/reels/copy/slots.ts`, `lib/reels/pipeline/promote.ts`, `lib/reels/pipeline/slots.ts`, `lib/social/overnight/runs.ts`, `lib/social/overnight/promote.ts`, `scripts/social_worker.ts`, `scripts/social_daily.ts`, `db/social_hub_schema.sql`, `lib/social-hub/moves-store.ts`, `lib/social-hub/views/moves.ts`.

- [ ] **Step 4: Report to Tommy with this deploy list. Do not run any of it.**

These are for a person to run, in this order, after reviewing the branch. Nothing here is executed by an agent.

1. **Schema (first):** from a checkout with `.env.local` (`DIRECT_DATABASE_URL`), run `node scripts/apply_social_hub_schema.js --apply`. Idempotent; it adds `social_hub.idea_adjustments.skip_reason` and `skipped_at`. Check: `psql "$DIRECT_DATABASE_URL" -c '\d social_hub.idea_adjustments'` lists both. (Any order is safe: before the columns exist, the hub reads moves without a skip reason and workers' skip writes are ignored.)
2. **Web (Vercel):** push `shared-queue` and open a PR to `main` (`gh pr create --base main --head shared-queue`); merge after review. Vercel deploys `main`.
3. **Workers (`helios-social-worker`), daytime only:** never between 12:30 and 5:00 AM ET, and not around the 7:30 AM health report. After the PR is merged, from a clean checkout at the merged commit (it needs a local `.env.local` for the script's in-flight guard, never committed), run `./scripts/gcp/deploy-social-worker.sh`. It ships all units (`helios-reels helios-social helios-explainers helios-stories helios-publisher`) and refuses while a run, job or build is in flight. Tasks 1, 3, 4 and 5 need this; Task 2's module rides along.
4. **Check after the first night:** `helios-reels` logs `[reels] tonight's promote <id>: made` or `skipped (…)` when a reels promote exists; `helios-social` logs `run_moves` on the 3 AM run when a carousel promote or demote exists; the explainers worker's `idea_cycle` line lists the promoted topic first in `renders`. The explainers worker needs `DATABASE_URL` (the main database) in its environment to read moves; without it the night runs as before.
5. **Manual, by Tommy on the live app** (no agent runs these): Promote one idea in one type in the evening; the pool shows it first with "Tonight". Next morning: it was made and the tag is gone, or the pool says "Can’t be made: <reason>". Demote one idea and check it sits at the bottom of its pool.

Then report: each task's commit, the test totals, and the open question (below). Ask before pushing.

**Open question to raise in the report:**
- A promote that can never be made (gone, already posted, placed) stays first in its type's line every night (the spec keeps it active), so later promotes of that type wait until a person demotes it. Should a skipped promote step aside after one skip?
