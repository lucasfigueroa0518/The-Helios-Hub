# Content Page, Phase A (page only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Content page shows what the night actually made, in one row of cards ordered by posting time, each card previewable (hover-play, slide arrows) and actionable in place (Approve, Schedule/Reschedule, Unschedule, Post now, Regenerate, Reject, Make it).

**Architecture:** All changes are on the Vercel side: the pure view-model in `lib/social-hub/views/*` decides which post fills each card and which buttons it offers (tested offline); thin client components render previews and reuse the existing `ActionBar` for the action round-trip. No worker, VM, or schema change. Phase B (workers book slots, shared queue, "Run didn't finish") gets its own plan.

**Tech Stack:** Next.js App Router (server components + `'use client'` islands), TypeScript, `node:test` via `tsx --test`, lucide-react icons, plain CSS in `app/social-hub.css` and `app/social/(hub)/hub-content.css`.

**Spec:** `docs/superpowers/specs/2026-10-13-content-page-design.md`. Read it before starting; decision ids (D1–D13) below refer to it.

## Global Constraints

- No automated test calls the live Claude API or `web_search` (CLAUDE.md Rule 1). Tests are pure functions over fixtures.
- Never start a real generation run yourself. **Make it** is verified by Tommy clicking it, not by an agent.
- Nothing posts without a human Approve or Post now, unless a human switched that type to auto-publish (D11). No change in this plan may weaken that.
- Branch: stay on `unify-social-hub`. Never create, switch, rename, delete or merge branches except the `main` merge in Task 0. Never merge into `main`.
- Commit after each task. **Do not push** until Tommy says so.
- No file under `scripts/gcp/`, `workers/`, or any worker entrypoint changes in this plan (no VM redeploy needed). If a task seems to need one, stop and ask.
- Copy rules on cards: "Post now" (not "Publish now"), "Schedule" / "Reschedule", "Make it", "Not made yet", "No slot yet". Today only (D12): no tomorrow view, slot picker offers only today's remaining windows.
- Run tests with `npx tsx --test <file>`; the whole suite is `npm test`. Type check with `npx tsc --noEmit -p .` (errors in `tests/seo-gsc-auth.test.ts` already exist on `main`; ignore those only).

## Review Focus

1. **Two versions of the same idea made today** (a Regenerate): one card, the newest version, never two. Test in Task 1.
2. **More made than the type has slots**: only `quota` cards; the extra stays on the type's page. Test in Task 1.
3. **No windows left today**: the Schedule/Reschedule picker returns no choices and says so; it never offers tomorrow. Test in Task 2.
4. **Make it on a card that got made meanwhile** (night finished late, double click, two tabs): the narrowed step is `none` and nothing is started or spent. Test in Task 4.
5. **Touch screens**: tapping a video plays/pauses instead of opening the post; arrows and the speaker never open the post. Manual check in Task 6, step "Verify in the browser".

---

### Task 0: Catch up with `main`

Lucas's PR #5 (`perf/faster-page-loads`) rewrites `lib/social-hub/views/cached-dataset.ts` and `components/social-hub/content/RunsRefresh.tsx` and adds `lib/use-poll.ts`. Its `RunsRefresh` already marks the hub cache stale (`POST /api/content-type/progress`) before `router.refresh()`, which is spec §3 "When a run finishes". This plan builds on that version.

**Files:** none edited by hand (merge only).

- [ ] **Step 1: Check whether PR #5 is merged**

Run: `git fetch origin && git log --oneline origin/main -5 && gh pr view 5 --json state,mergedAt`
Expected: `"state":"MERGED"`. If it is still OPEN, **stop and ask Tommy**: wait, merge `origin/perf/faster-page-loads` into this branch now, or proceed without it (then spec §3's cache item stays undone and must be listed in the final report).

- [ ] **Step 2: Merge `main` into the branch**

Run: `git status --short` (must show no tracked changes; the untracked overnight plan is fine), then `git merge origin/main --no-edit`
Expected: a clean merge. On conflict, resolve keeping both sides' intent, then `git commit`.

- [ ] **Step 3: Confirm the suite is green before changing anything**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`.

---

### Task 1: Made content wins on every type (D1, D13)

Rewrites how `quotaCandidates` fills a type's cards: booked slots first, then content made today with no slot (every type, not just explainers), then the ranking. Rejected content never fills a card. Adds `seriesId` for Stories (Make it needs it) and `orderCards` (posting-time order).

**Files:**
- Modify: `lib/social-hub/views/state.ts` (export the rejected rule)
- Modify: `lib/social-hub/views/day-rank.ts`
- Test: `tests/social-hub-run-today.test.ts`

**Interfaces:**
- Produces: `isRejected(post: HubPost): boolean` from `state.ts`.
- Produces: `QuotaCandidate.seriesId?: string` (a Stories window id: `'morning_download' | 'guess_the_number' | 'free_vs_paid'`).
- Produces: `orderCards(cards: readonly QuotaCandidate[]): QuotaCandidate[]`; `allQuotaCandidates` now returns cards already ordered.

- [ ] **Step 1: Export the rejected rule from `state.ts`**

In `lib/social-hub/views/state.ts`, rename the private `rejected` function to an exported `isRejected` and update its two callers (`needsPerson` and the `ready` case of `postState`):

```ts
/**
 * Rejected, on the post or on its last slot. Carousels keep the rejection on
 * the slot they cancel ("This carousel was rejected, so it was not posted."),
 * not on the post's approval, so the post reads as rejected from its last try.
 */
export function isRejected(post: HubPost): boolean {
  return rejectedNote(post.approval.note) || rejectedNote(post.tries?.[0]?.note ?? null);
}
```

`needsPerson`: `if (isRejected(post) || pastStorySet(post, now)) return false;`
`postState` `ready` case: `if (isRejected(post)) return { ...S.rejected, line: 'Won’t post.' };`

- [ ] **Step 2: Replace the explainers-only tests with the every-type rule (failing tests)**

In `tests/social-hub-run-today.test.ts`:

(a) Replace the test `'the quota goes to the top of the day’s ranking, made or not; promoting changes what fills it'` with:

```ts
test('made content fills the day ahead of the ranking; Promote only reorders what is not made yet', () => {
  // Ideas 1 and 4 have videos made today; the quota is 2.
  const data = { posts: [reelPost(1), reelPost(4)], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const plain = quotaCandidates(data, 'reels', NOW);
  assert.deepEqual(plain.map((c) => [c.idea?.title, Boolean(c.post)]).sort(), [['Idea 1', true], ['Idea 4', true]], 'both made reels fill the day');
  const one = { ...data, posts: [reelPost(4)], dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const promoted = quotaCandidates({ ...one, adjustments: [move(3, 'promote', 't1')] }, 'reels', NOW);
  assert.deepEqual(promoted.map((c) => [c.idea?.title, Boolean(c.post)]), [['Idea 4', true], ['Idea 3', false]], 'the made reel holds; the promoted idea takes the open card');
  assert.deepEqual(todaysContent(data, NOW).map((p) => p.name).sort(), ['REEL 1', 'REEL 4']);
});
```

(b) Replace the last test, `'only explainers get this: a reel made today for a lower-ranked idea is still not a candidate (the Oct 9 rule)'`, with:

```ts
test('every type: a reel made today for a lower-ranked idea fills the day (2026-10-13)', () => {
  const data = { posts: [reelPost(4)], ideas: IDEAS, dayQuotas: { reels: 1, carousels: 1, explainers: 1 } };
  const c = quotaCandidates(data, 'reels', NOW);
  assert.deepEqual(c.map((x) => [x.idea?.title, Boolean(x.post)]), [['Idea 4', true]]);
});

test('two versions of one idea made today show once, the newest (Review Focus 1)', () => {
  const older = reelPost(4, { generatedAt: '2026-10-09T05:00:00Z' });
  const newer = reelPost(4, { id: 'reels:video:newer', generatedAt: '2026-10-09T07:00:00Z' });
  const c = quotaCandidates({ posts: [older, newer], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(c.map((x) => x.post?.id ?? x.idea?.title), ['reels:video:newer', 'Idea 1']);
});

test('more made than slots: only the quota shows (Review Focus 2)', () => {
  const posts = [reelPost(1), reelPost(2), reelPost(3)];
  const c = quotaCandidates({ posts, ideas: IDEAS, dayQuotas: { reels: 2, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.post));
});

test('a rejected post never fills a card; its slot falls back to the ranking', () => {
  const rejected = reelPost(4, { tries: [{ status: 'cancelled', at: '2026-10-09T06:00:00Z', note: 'This reel was rejected, so it was not posted.' }] });
  const c = quotaCandidates({ posts: [rejected], ideas: IDEAS, dayQuotas: { reels: 1, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(c.map((x) => [x.idea?.title, Boolean(x.post)]), [['Idea 1', false]]);
});
```

(c) Add, next to the other `import`s, `orderCards` from `day-rank`, and this test:

```ts
test('cards read as the day: booked by time, then made with no slot, then being made, then not made yet', () => {
  const at = (iso: string) => reelPost(1, { id: `p-${iso}`, status: 'scheduled', publishAt: iso, nyDate: TODAY });
  const cards = [
    { vertical: 'reels' as const, idea: null, post: null, locked: false, rank: 1, moved: null },
    { vertical: 'reels' as const, idea: null, post: reelPost(2, { status: 'generating' }), locked: false, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: reelPost(3), locked: false, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: at('2026-10-09T22:00:00Z'), locked: true, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: at('2026-10-09T13:00:00Z'), locked: true, rank: null, moved: null },
  ];
  assert.deepEqual(orderCards(cards).map((c) => c.post?.id ?? 'not made'), ['p-2026-10-09T13:00:00Z', 'p-2026-10-09T22:00:00Z', cards[2]!.post!.id, cards[1]!.post!.id, 'not made']);
});
```

Also in the explainers block, keep the existing explainer tests as they are (they still hold under the every-type rule).

- [ ] **Step 3: Run to see the new tests fail**

Run: `npx tsx --test tests/social-hub-run-today.test.ts`
Expected: FAIL. `orderCards` is not exported; the made-content and rejection tests fail against the old rule.

- [ ] **Step 4: Implement in `day-rank.ts`**

Add the import: `import { isRejected } from '@/lib/social-hub/views/state';`

Update the header doc comment's rule paragraph to:

```ts
 * The quota candidates are, in order: what already holds a slot today
 * (scheduled, posting, posted); then content made today with no slot, for
 * any idea (the night picks its own, 2026-10-13: made content wins); then the
 * top of the adjusted ranking for what's left. Rejected content never fills a
 * card. One card per idea.
```

Add `seriesId?: string;` to `QuotaCandidate` under `series`, documented `/** Stories: the series window id (Make it's target). */`.

In `contentFor`, skip rejected posts: change the `ready` filter to `.filter((p) => p.status === 'ready' && hasMedia(p) && !isRejected(p))`.

In the Stories branch of `quotaCandidates`, return `seriesId: w.id` alongside `series: w.label`.

Replace the `madeToday` block and the `held`/`ranking` lines with:

```ts
  const sameIdea = (a: HubPost, b: HubPost) => a.idea?.id != null && a.idea.id === b.idea?.id;
  // Made today with no slot, any idea (2026-10-13): the night picks its own topic, so what it made holds the
  // day's place ahead of the ranking. Newest first, one per idea, never one already in a slot.
  const madeToday: HubPost[] = [];
  for (const p of data.posts
    .filter((p) => p.vertical === vertical && p.status === 'ready' && hasMedia(p) && !isRejected(p) && p.generatedAt != null && nyDateOf(new Date(p.generatedAt)) === today)
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') || a.id.localeCompare(b.id))) {
    if (madeToday.length >= Math.max(0, quota - locked.length)) break;
    if (locked.includes(p) || locked.some((l) => sameIdea(l, p)) || madeToday.some((m) => sameIdea(m, p))) continue;
    madeToday.push(p);
  }
  const held = [...locked, ...madeToday];
  const ranking = full.filter((r) => !held.some((p) => ideaOwns(r.idea, p)));
```

Add after `quotaCandidates`:

```ts
const cardAt = (c: QuotaCandidate) => c.post?.postedAt ?? c.post?.publishAt ?? '';

/** 0 booked or posted, 1 made with no slot, 2 being made, 3 not made yet. */
function cardTier(c: QuotaCandidate): number {
  if (!c.post) return 3;
  if (c.post.status === 'generating') return 2;
  return c.locked || cardAt(c) ? 0 : 1;
}

/** Today's cards in posting order: booked slots by time, then made with no slot, then being made, then not made yet (2026-10-13). */
export function orderCards(cards: readonly QuotaCandidate[]): QuotaCandidate[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => cardTier(a.c) - cardTier(b.c) || cardAt(a.c).localeCompare(cardAt(b.c)) || a.i - b.i)
    .map((x) => x.c);
}
```

Change `allQuotaCandidates` to return ordered cards:

```ts
/** Every type's quota candidates for today, as the day's cards in posting order. */
export function allQuotaCandidates(data: Parameters<typeof quotaCandidates>[0], now: Date): QuotaCandidate[] {
  return orderCards(DAY_TYPES.flatMap((v) => quotaCandidates(data, v, now)));
}
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test tests/social-hub-run-today.test.ts tests/social-hub-viewmodels.test.ts tests/social-hub-look-ahead.test.ts`
Expected: PASS. If a look-ahead test fails only on order, leave it: Task 2 deletes that file.

- [ ] **Step 6: Commit**

```bash
git add lib/social-hub/views/state.ts lib/social-hub/views/day-rank.ts tests/social-hub-run-today.test.ts
git commit -m "feat(social-hub): made content fills today's cards on every type, in posting order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Today only (D12)

Removes the tomorrow look-ahead and limits Schedule/Reschedule to today's remaining windows.

**Files:**
- Delete: `lib/social-hub/views/look-ahead.ts`, `tests/social-hub-look-ahead.test.ts`
- Modify: `components/social-hub/content/ContentScreen.tsx` (look-ahead parts only; the header rewrite is Task 5)
- Modify: `components/social-hub/content/TodayStrip.tsx` (drop the `ahead` prop)
- Modify: `app/social/(hub)/page.tsx`, `app/social/(hub)/preview/page.tsx`
- Modify: `lib/social-hub/views/offer.ts`
- Modify: `components/social-hub/house/ActionBar.tsx` (picker copy)
- Test: `tests/social-hub-viewmodels.test.ts`

**Interfaces:**
- Produces: `slotChoices(dataset, post, now, days = 1)`: today's windows still open.
- Produces: `ContentScreen` props without `look`; `TodayStrip` props without `ahead`.

- [ ] **Step 1: Write the failing test**

Add to `tests/social-hub-viewmodels.test.ts` (it already imports `slotChoices`, `d` = `previewDataset()`, `now` = `FIXTURE_NOW`):

```ts
test('Schedule and Reschedule offer only today’s remaining windows (D12, Review Focus 3)', () => {
  const ready = d.posts.find((p) => p.vertical === 'carousels' && p.status === 'ready')!;
  const today = nyDateOf(now)!;
  assert.ok(slotChoices(d, ready, now).every((s) => s.nyDate === today), 'never tomorrow');
  const lateNight = new Date(`${today}T23:30:00-04:00`);
  assert.deepEqual(slotChoices(d, ready, lateNight), [], 'after the last window, nothing is offered');
});
```

Add `import { nyDateOf } from '@/lib/social-hub/time';` if the file doesn't import it.

- [ ] **Step 2: Run to see it fail**

Run: `npx tsx --test tests/social-hub-viewmodels.test.ts`
Expected: FAIL on "never tomorrow" (the default is 7 days).

- [ ] **Step 3: Implement**

`lib/social-hub/views/offer.ts`: change the signature to `export function slotChoices(dataset: HubDataset, post: HubPost, now: Date, days = 1): SlotChoice[]` and its doc line to `Today's remaining posting windows for the type (place and reschedule, D50; today only, D12)`. If the existing test at `tests/social-hub-viewmodels.test.ts` (around line 66, `slotChoices(d, ready, now)`) asserts a later day, update that assertion to today.

`components/social-hub/house/ActionBar.tsx`:
- picker paragraph: `<p>Pick one of today’s remaining windows.</p>`
- `SlotPicker` empty state: `<p className="sh-subtle">No windows left today. Post now or Reject instead.</p>`
- doc comment of `SlotPicker`: `/** Today's remaining windows for the type; taken ones are shown unavailable. */`

Delete `lib/social-hub/views/look-ahead.ts` and `tests/social-hub-look-ahead.test.ts`.

`app/social/(hub)/page.tsx` and `app/social/(hub)/preview/page.tsx`: remove the `LOOK_PARAM` import and the `look={params[LOOK_PARAM]}` prop. In `preview/page.tsx`, `params` is still used by `legacyRootRedirect`, so keep it.

`components/social-hub/content/ContentScreen.tsx`: remove the `look` prop and its type, the `contentDay`/`LOOK_PARAM`/`LOOK_TOMORROW` import, `view`, `ahead`, `dayLabel`, `aheadHref`, the `DayArrow` component and its `ChevronLeft`/`ChevronRight`/`HubLink` imports, and every `view.ahead ? … : …` branch (keep the today branch). Use `now` where it used `view.at`. Section title: `Today’s Content`. Empty state: keep the today text. Pass no `ahead` to `TodayStrip`.

`components/social-hub/content/TodayStrip.tsx`: remove the `ahead` prop from `TodayStrip` and `Pending`. Pending's caption is `'Not made yet'`, its hint `'Run now makes it.'`, and its name fallback `c.series ? \`${c.series}: today’s set\` : 'Open slot: the next run picks its idea'`.

- [ ] **Step 4: Run tests and the type check**

Run: `npx tsx --test tests/social-hub-*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"` then `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: `fail 0`; no type errors outside `seo-gsc-auth`.

- [ ] **Step 5: Commit**

```bash
git add -A lib/social-hub/views/offer.ts lib/social-hub/views/look-ahead.ts tests/social-hub-look-ahead.test.ts tests/social-hub-viewmodels.test.ts components/social-hub/content/ContentScreen.tsx components/social-hub/content/TodayStrip.tsx components/social-hub/house/ActionBar.tsx "app/social/(hub)/page.tsx" "app/social/(hub)/preview/page.tsx"
git commit -m "feat(social-hub): Content is today only; scheduling offers today's windows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Card actions, Delete removed, Reject on every type (D5, D6, D7)

A pure function decides each card's buttons from its state. Delete leaves the hub's actions (its soft-delete data path stays, so posts deleted earlier stay hidden). Explainers get Reject like every other type.

**Files:**
- Create: `lib/social-hub/views/card-actions.ts`
- Modify: `lib/social-hub/views/offer.ts` (add `card` to `Offer`)
- Modify: `lib/social-hub/house.ts` (remove the delete plan; Reject for explainers)
- Modify: `lib/social-hub/views/actions.ts` (remove delete ranking, label, title)
- Modify: `lib/social-hub/flags.ts` (remove the `delete` flag)
- Modify: `components/social-hub/house/ActionBar.tsx` (remove the delete navigation branch)
- Delete: `app/api/social-hub/actions/delete/route.ts`, `app/api/social-hub/actions/delete/handler.ts`
- Test: create `tests/social-hub-card-actions.test.ts`; modify `tests/social-hub-actions.test.ts` (lines ~416–425), `tests/social-hub-delete.test.ts` (remove the two menu tests at ~205 and ~223)

**Interfaces:**
- Consumes: `flagOf`, `OfferedAction`, `SlotChoice` from `views/actions.ts`; `ActionPlan` from `house.ts`; `PostState` from `views/state.ts`.
- Produces: `type CardActions = { primary: OfferedAction | null; grid: OfferedAction[] }` and `cardActions(state: PostState, plans: readonly ActionPlan[], enabled: Readonly<Record<ActionFlag, boolean>>, slots?: SlotChoice[]): CardActions`.
- Produces: `Offer = { state: PostState; menu: ActionMenu; card: CardActions }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/social-hub-card-actions.test.ts`:

```ts
/**
 * Each Today's Content card's buttons (spec §2, offline). Needs you: Approve +
 * Schedule/Reschedule, Post now, Regenerate, Reject. Approved/scheduled:
 * Reschedule, Unschedule, Post now, Reject. Failed: Try again + what's left.
 * Nothing on posting, posted or being made. Only Post now, Regenerate and
 * Reject ask first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTION_FLAGS, type ActionFlag } from '@/lib/social-hub/flags';
import { actionsFor } from '@/lib/social-hub/house';
import type { HubPost } from '@/lib/social-hub/types';
import { cardActions } from '@/lib/social-hub/views/card-actions';
import { postState } from '@/lib/social-hub/views/state';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const d = previewDataset();
const ON = Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as Record<ActionFlag, boolean>;
const OFF = Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as Record<ActionFlag, boolean>;
const card = (post: HubPost, on = ON) => cardActions(postState(post, FIXTURE_NOW), actionsFor(post, { quota: null, typicalCostLabel: '$1.00' }), on);
const keys = (c: ReturnType<typeof card>) => [c.primary?.key ?? null, ...c.grid.map((a) => a.key)];
const find = (pred: (p: HubPost) => boolean) => {
  const p = d.posts.find(pred);
  assert.ok(p, 'fixture has this post');
  return p!;
};

test('needs you, no slot: Approve, then Schedule, Post now, Regenerate, Reject', () => {
  const post = find((p) => p.vertical === 'carousels' && p.status === 'ready' && postState(p, FIXTURE_NOW).id === 'needs_you');
  const c = card(post);
  assert.equal(c.primary?.label, 'Approve');
  assert.deepEqual(c.grid.map((a) => a.label), ['Schedule', 'Post now', 'Regenerate', 'Reject']);
});

test('needs you, slot booked: Approve, then Reschedule (not Schedule), and no Unschedule', () => {
  const post = find((p) => p.status === 'scheduled' && postState(p, FIXTURE_NOW).id === 'needs_you' && (p.vertical === 'carousels' || p.vertical === 'reels'));
  const c = card(post);
  assert.equal(c.primary?.label, 'Approve');
  assert.ok(c.grid.some((a) => a.label === 'Reschedule'));
  assert.ok(!c.grid.some((a) => a.key === 'unschedule' || a.key === 'place'));
});

test('approved and scheduled: Reschedule, Unschedule, Post now, Reject; no Approve', () => {
  const post = find((p) => p.status === 'scheduled' && postState(p, FIXTURE_NOW).id === 'scheduled');
  const c = card(post);
  assert.equal(c.primary, null);
  assert.deepEqual(c.grid.map((a) => a.key), ['reschedule', 'unschedule', 'hardPublish', 'reject'].filter((k) => c.grid.some((a) => a.key === k)));
  assert.ok(c.grid.some((a) => a.key === 'unschedule'), 'Unschedule stays (D7)');
});

test('posted, posting and being made: no buttons', () => {
  for (const status of ['published', 'publishing', 'generating'] as const) {
    const post = d.posts.find((p) => p.status === status);
    if (!post) continue;
    assert.deepEqual(keys(card(post)), [null], status);
  }
});

test('only Post now, Regenerate and Reject ask first; Approve, Schedule and Unschedule are one click', () => {
  const posts = d.posts.filter((p) => ['ready', 'scheduled'].includes(p.status));
  for (const post of posts) {
    const c = card(post);
    for (const a of [c.primary, ...c.grid].filter(Boolean)) {
      const asks = a!.key === 'hardPublish' || a!.key === 'hardRegenerate' || a!.key === 'reject';
      assert.equal(Boolean(a!.plan.confirm), asks, `${post.vertical} ${a!.key}`);
    }
  }
});

test('every card button turns off with its flag; Delete is never offered', () => {
  for (const post of d.posts) {
    assert.deepEqual(keys(card(post, OFF)), [null]);
    assert.ok(!card(post).grid.some((a) => (a.key as string) === 'delete'));
  }
});

test('explainers can be rejected from the card', () => {
  const post = find((p) => p.vertical === 'explainers' && p.status === 'ready' && postState(p, FIXTURE_NOW).id === 'needs_you');
  const reject = card(post).grid.find((a) => a.key === 'reject');
  assert.ok(reject);
  assert.deepEqual((reject!.plan.body as { refs: Record<string, string> }).refs, { jobId: post.refs.jobId });
});
```

If the fixture lacks a post for one of the `find` predicates, add one to `tests/fixtures/social-hub/preview-dataset.ts` by copying a neighboring post of that type and changing only `id`, `status`, `publishAt`/`approval` as needed.

- [ ] **Step 2: Run to see them fail**

Run: `npx tsx --test tests/social-hub-card-actions.test.ts`
Expected: FAIL with "Cannot find module '@/lib/social-hub/views/card-actions'".

- [ ] **Step 3: Create `lib/social-hub/views/card-actions.ts`**

```ts
import type { ActionFlag } from '@/lib/social-hub/flags';
import type { ActionPlan } from '@/lib/social-hub/house';
import { flagOf, type OfferedAction, type SlotChoice } from '@/lib/social-hub/views/actions';
import type { PostState, StateId } from '@/lib/social-hub/views/state';

/**
 * A Today's Content card's buttons (spec 2026-10-13 §2): a fixed list per
 * state, so the rows line up across the day. Built from the same plans as the
 * post page (lib/social-hub/house.ts actionsFor); this file only picks and
 * labels them for a card.
 */

type PostPlan = Extract<ActionPlan, { kind: 'post' }>;

export type CardActions = { primary: OfferedAction | null; grid: OfferedAction[] };

const APPROVE = new Set<PostPlan['action']>(['approveCarousel', 'approveTrialReel', 'approveContent']);
const NEEDS: ReadonlySet<StateId> = new Set(['needs_you', 'slot_booked', 'ready', 'approved']);
const BOOKED: ReadonlySet<StateId> = new Set(['scheduled', 'late']);

const GRID: Record<'needs' | 'booked' | 'failed', PostPlan['action'][]> = {
  needs: ['place', 'reschedule', 'hardPublish', 'hardRegenerate', 'reject'],
  booked: ['reschedule', 'unschedule', 'hardPublish', 'reject'],
  failed: ['hardRegenerate', 'reschedule', 'reject'],
};

const LABEL: Partial<Record<PostPlan['action'], string>> = {
  place: 'Schedule',
  reschedule: 'Reschedule',
  unschedule: 'Unschedule',
  hardPublish: 'Post now',
  hardRegenerate: 'Regenerate',
  reject: 'Reject',
};

const TITLE: Partial<Record<PostPlan['action'], string>> = {
  hardPublish: 'Post now?',
  hardRegenerate: 'Make a new version?',
  reject: 'Reject this post?',
};

/** Only what posts live, can't be undone here, or spends money asks first. */
const ASKS = new Set<PostPlan['action']>(['hardPublish', 'hardRegenerate', 'reject']);

export function cardActions(state: PostState, plans: readonly ActionPlan[], enabled: Readonly<Record<ActionFlag, boolean>>, slots?: SlotChoice[]): CardActions {
  const group = NEEDS.has(state.id) ? 'needs' : BOOKED.has(state.id) ? 'booked' : state.id === 'failed' ? 'failed' : null;
  if (!group) return { primary: null, grid: [] };
  const usable = plans.filter((p): p is PostPlan => p.kind === 'post' && enabled[flagOf(p.action)]);
  const offered = (plan: PostPlan, label: string): OfferedAction => ({
    key: plan.action,
    label,
    plan: ASKS.has(plan.action) ? plan : { ...plan, confirm: undefined },
    disabled: plan.disabled,
    danger: plan.action === 'reject',
    confirmTitle: TITLE[plan.action] ?? null,
    ...(plan.pick === 'slot' && slots ? { slots } : {}),
  });
  let primary: OfferedAction | null = null;
  if (group === 'failed') {
    const p = usable.find((x) => x.action === 'hardPublish');
    primary = p ? offered(p, 'Try again') : null;
  } else if (group === 'needs' && state.id !== 'approved') {
    const p = usable.find((x) => APPROVE.has(x.action));
    primary = p ? offered(p, 'Approve') : null;
  }
  const grid = GRID[group]
    .filter((a) => !(group === 'failed' && a === 'hardPublish'))
    .flatMap((a) => {
      const p = usable.find((x) => x.action === a);
      return p ? [offered(p, LABEL[a]!)] : [];
    });
  return { primary, grid };
}
```

- [ ] **Step 4: Wire `card` into the offerer**

`lib/social-hub/views/offer.ts`:
- import: `import { cardActions, type CardActions } from '@/lib/social-hub/views/card-actions';`
- type: `export type Offer = { state: PostState; menu: ActionMenu; card: CardActions };`
- in `build`, after `menu`: `const card = cardActions(state, plans, enabled, slots);`
- the approval-off return: `return { state: approvalOffState(post, now), menu: { ...menu, offNote: null }, card: { primary: null, grid: [] } };`
- the normal return: `return { state, menu, card };`

- [ ] **Step 5: Remove Delete from the hub's actions; add Reject for explainers**

`lib/social-hub/house.ts`:
- Remove `'delete'` from the `ActionPlan` `action` union.
- Delete the whole `// Delete: anything not yet live …` block in `actionsFor`.
- Reject: change the condition to `if (post.status === 'ready' || post.status === 'scheduled') {`, change the comment to `// Reject (D47): content that hasn't posted yet never will, for every type (2026-10-13: explainers too).`, and the refs to:

```ts
    const refs = post.vertical === 'carousels'
      ? { postId: post.refs.postId }
      : post.vertical === 'reels'
        ? { postIdeaId: post.refs.postIdeaId, ...(post.refs.videoJobId ? { videoJobId: post.refs.videoJobId } : {}) }
        : post.vertical === 'explainers'
          ? { jobId: post.refs.jobId }
          : { setId: post.refs.setId };
```

`lib/social-hub/views/actions.ts`: delete `NOT_DELETABLE` and its comment, the `if (action === 'delete') …` line in `rankFor`, the `case 'delete':` in `labelFor`, the `delete:` entry in `TITLE`, and `|| plan.action === 'delete'` in `danger`.

`lib/social-hub/flags.ts`: remove `delete` from `ActionFlag`, from `SOCIAL_HUB_FLAGS.actions` (with its comment), and from `ACTION_FLAGS`.

`components/social-hub/house/ActionBar.tsx`: in `run`, replace the delete branch with just `if (res.ok) router.refresh();`, then remove now-unused `usePathname`, `pathname` and `hubBaseOf`.

Delete `app/api/social-hub/actions/delete/route.ts` and `handler.ts`. Keep `lib/social-hub/spine.ts deleteItem`, `lib/social-hub/deleted.ts`, and `lib/publishing/actions/delete.ts`: earlier deletions must stay hidden.

Run: `grep -rn "actions/delete\|'delete'" app lib components tests --include=*.ts --include=*.tsx | grep -i "social-hub\|publishing"` and fix each remaining hub reference the type check flags.

- [ ] **Step 6: Update the existing tests**

`tests/social-hub-actions.test.ts` (~lines 416–425): drop `'delete'` from both expected action lists and delete the `cDelete` lines.
`tests/social-hub-delete.test.ts`: delete the tests `'Delete is a visible button (not under More)…'` and `'Delete is not offered on posting or posted content, and turns off with its flag'`, plus their helpers (`menuOf`, the key collector) and the `actionMenu`/`actionsFor`/`postState` imports if nothing else uses them. Keep every data-layer test (`delete:`, `withoutDeleted:`, the verb tests).

- [ ] **Step 7: Run tests and the type check**

Run: `npx tsx --test tests/social-hub-*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"` then `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: `fail 0`; no new type errors.

- [ ] **Step 8: Check what Approve does on a no-slot explainer or Stories card (read only, report)**

Open `lib/publishing/actions/explainers.ts` and `lib/publishing/actions/stories.ts`, find `approve`, and note whether it books today's next open window like carousels and reels do (spec §2: "Approve on a No slot yet card books the next open slot"). **Do not change it in this task.** Write the finding in the task report. If either doesn't book, Tommy decides whether Phase B covers it.

- [ ] **Step 9: Commit**

```bash
git add -A lib/social-hub app/api/social-hub/actions/delete components/social-hub/house/ActionBar.tsx tests/social-hub-card-actions.test.ts tests/social-hub-actions.test.ts tests/social-hub-delete.test.ts tests/fixtures/social-hub/preview-dataset.ts
git commit -m "feat(social-hub): card buttons per state; Delete folds into Reject; explainers can be rejected

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Make it, a run for one card (D9)

Run now's plan already works step by step; this narrows a step to one card's target.

**Files:**
- Modify: `lib/social-hub/run-today.ts`
- Modify: `lib/content-type/run-today-live.ts`
- Modify: `app/api/content-type/run-today/route.ts`
- Test: `tests/social-hub-run-today.test.ts`

**Interfaces:**
- Produces: `narrowStep(step: PlanStep, target: string | undefined): PlanStep`.
- Produces: `stepsFor(plan: RunPlan, only?: Vertical, target?: string): PlanStep[]`.
- Produces: `runToday(by: string, now = new Date(), only?: Vertical, target?: string)`.
- Produces: `POST /api/content-type/run-today` accepts an optional JSON body `{ only?: Vertical; target?: string }`. With no body it behaves exactly as today (Run now).
- Card targets: reels, carousels and explainers use `ideaRef(candidate.idea.id)`; Stories use `candidate.seriesId`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/social-hub-run-today.test.ts` (extend the `run-today` import with `narrowStep, stepsFor`):

```ts
test('Make it runs only its card: one target, its share of the estimate', () => {
  const plan = planFrom({ ...base, explainers: { quota: 2, held: 0, missing: [{ ideaId: 'explainers:topic:t1', ref: 't1', title: 'A' }, { ideaId: 'explainers:topic:t2', ref: 't2', title: 'B' }] } });
  const [one] = stepsFor(plan, 'explainers', 't2');
  assert.deepEqual([one!.action, one!.targets, one!.estimateUsd], ['explainer_renders', ['t2'], 5]);
});

test('Make it on a card made meanwhile starts nothing and spends nothing (Review Focus 4)', () => {
  const plan = planFrom(base);
  const [step] = stepsFor(plan, 'explainers', 'already-made-topic');
  assert.deepEqual([step!.action, step!.estimateUsd, step!.targets], ['none', 0, []]);
  const [stories] = stepsFor(planFrom({ ...base, series: [{ id: 'morning_download', label: 'Morning Download', held: true }] }), 'stories', 'morning_download');
  assert.equal(stories!.action, 'none');
});

test('a step that cannot be split (no reels slate yet) runs whole, and says so', () => {
  const plan = planFrom({ ...base, reels: { ...base.reels, slateToday: false } });
  const [step] = stepsFor(plan, 'reels', 'r2');
  assert.equal(step!.action, 'reels_run');
  assert.equal(step!.estimateUsd, base.cost.reelsNight);
});

test('a carousel run for one story keeps its run cap as the estimate', () => {
  const plan = planFrom({ ...base, carousels: { quota: 2, held: 0, missing: [{ ideaId: 'carousels:story:s1', ref: 's1', title: 'S1' }, { ideaId: 'carousels:story:s2', ref: 's2', title: 'S2' }] } });
  const [step] = stepsFor(plan, 'carousels', 's2');
  assert.deepEqual([step!.targets, step!.estimateUsd], [['s2'], base.cost.carouselCap]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx tsx --test tests/social-hub-run-today.test.ts`
Expected: FAIL: `narrowStep` / `stepsFor`'s third argument does nothing.

- [ ] **Step 3: Implement in `lib/social-hub/run-today.ts`**

Replace `stepsFor` with:

```ts
/**
 * One card's share of a type's step (Make it, 2026-10-13): only that target,
 * with its share of the estimate. A carousel run's cap is per run, so it
 * stays whole. A step with no targets to split (a reels night with no slate,
 * a carousel run picking from fresh news) runs as a whole. A target the plan
 * no longer needs (made meanwhile) is `none`.
 */
export function narrowStep(step: PlanStep, target: string | undefined): PlanStep {
  if (!target || step.action === 'none' || step.targets.length === 0) return step;
  if (!step.targets.includes(target)) return { ...step, action: 'none', targets: [], needed: 0, note: 'Already made or being made.', estimateUsd: 0 };
  const share = step.action === 'carousel_run' ? step.estimateUsd : step.estimateUsd / step.targets.length;
  return { ...step, targets: [target], needed: 1, note: 'Makes this card only.', estimateUsd: Number(share.toFixed(2)) };
}

/** The steps a Run button starts: Content's Run now every step, a type's own button its step, a card's Make it that step narrowed to the card. */
export function stepsFor(plan: RunPlan, only?: Vertical, target?: string): PlanStep[] {
  const steps = only ? plan.steps.filter((s) => s.vertical === only) : plan.steps;
  return only && target ? steps.map((s) => narrowStep(s, target)) : steps;
}
```

Note: for Stories, `step.targets` holds series ids, and a series already held is not in it, so `narrowStep` returns `none` for it. That's the second assertion of the Review Focus 4 test.

- [ ] **Step 4: Thread `target` through the live layer and the route**

`lib/content-type/run-today-live.ts`: change the signature to `export async function runToday(by: string, now = new Date(), only?: Vertical, target?: string)`, and the loop to `for (const step of stepsFor(plan, only, target)) {`. Update its doc comment: `` `only` + `target`: a card's Make it runs just that card. ``

`app/api/content-type/run-today/route.ts`: replace `POST` with:

```ts
const TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];

/** Run now, or one card's Make it (`{ only, target }`): the person's click approves this spend. The plan is made again here, so only what today still needs starts. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { only?: unknown; target?: unknown } | null;
  const only = TYPES.includes(body?.only as Vertical) ? (body!.only as Vertical) : undefined;
  const target = only && typeof body?.target === 'string' && body.target.length > 0 && body.target.length <= 600 ? body.target : undefined;
  if (body?.only !== undefined && !only) return NextResponse.json({ error: 'Unknown content type.' }, { status: 400 });
  try {
    const out = await runToday(session.email, new Date(), only, target);
    revalidateTag(HUB_DATA_TAG);
    return NextResponse.json(out);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}
```

with `import type { Vertical } from '@/lib/social-hub/types';`. If Task 0's merge changed this route, keep the merged structure and apply only the body parsing and the `runToday(…, only, target)` call.

- [ ] **Step 5: Run tests and the type check**

Run: `npx tsx --test tests/social-hub-run-today.test.ts tests/social-hub-scope.test.ts` then `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: PASS; no new type errors. (`social-hub-scope` pins which routes the hub may write to; Make it uses the existing run-today route, so it should still pass.)

- [ ] **Step 6: Commit**

```bash
git add lib/social-hub/run-today.ts lib/content-type/run-today-live.ts app/api/content-type/run-today/route.ts tests/social-hub-run-today.test.ts
git commit -m "feat(content-type): Make it runs one card's step of today's plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The header

**Files:**
- Modify: `components/social-hub/content/ContentScreen.tsx`
- Modify: `app/social/(hub)/page.tsx` (remove `RefreshNote`)
- Delete: `components/social-hub/content/NeedsYouMenu.tsx`
- Modify: `app/social-hub.css` (remove `.sh-needs-*` rules only if nothing else uses them)

**Interfaces:**
- Consumes: `allQuotaCandidates` (ordered, Task 1); `Offer.state` from the offerer.

- [ ] **Step 1: Rewrite the header**

In `ContentScreen.tsx`, compute after `const today = allQuotaCandidates(dataset, now);`:

```ts
  // The count is today's cards still waiting on approval, so it matches the cards' Needs you badges (2026-10-13).
  const toApprove = today.filter((c) => c.post && o.offer(c.post).state.id === 'needs_you').length;
```

Replace the `PageHead` with:

```tsx
      <PageHead
        title="Today"
        aside={todayLabel}
        actions={controls ? <><HubSettingsButton /><RunTodayButton /></> : undefined}
        meta={
          <>
            <strong>{m.plan.filled}</strong> of {m.plan.slots} slots filled
            {' · '}
            {toApprove ? <span className="sh-needs-count">{toApprove} to approve</span> : 'nothing to approve'}
            {summary.length ? <> · <strong>{summary.join(' · ')}</strong></> : null}
          </>
        }
      />
```

Remove the now-unused code: `NeedsYouMenu` import and usage, `off`, `needs`, `parked`, `countOf`, `actNow`, `later`, and any import the type check reports unused (`PostLink`, `displayName`, `slotsForDay`, …). Keep `TypeMark` (the pools use it).

Delete `components/social-hub/content/NeedsYouMenu.tsx`. Run `grep -rn "sh-needs-trigger\|sh-needs-list\|sh-needs-group\|sh-needs-row\|sh-needs-menu" app components`; delete each CSS rule in `app/social-hub.css` whose class no component uses any more. Keep `.sh-needs-count`.

- [ ] **Step 2: Remove "Numbers last refreshed" from Content**

`app/social/(hub)/page.tsx`: delete the `RefreshNote` import and `<RefreshNote refresh={loaded.refresh} />`, and return `<ContentScreen … />` directly. Leave Analytics, Calendar and the post page as they are.

- [ ] **Step 3: Type check and tests**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npx tsx --test tests/social-hub-*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: clean; `fail 0`.

- [ ] **Step 4: Verify in the browser**

Start the preview: `preview_start` with name `social-hub-preview`, open `http://localhost:3123/social/preview`. With `read_page`, check the header reads `Today <date>`, then `N of M slots filled · K to approve` (or `nothing to approve`), with no day arrows, no dropdown, and no "Numbers last refreshed" line. Check `read_console_messages` for errors.

- [ ] **Step 5: Commit**

```bash
git add -A components/social-hub/content/ContentScreen.tsx components/social-hub/content/NeedsYouMenu.tsx app/social-hub.css "app/social/(hub)/page.tsx"
git commit -m "feat(social-hub): Content header is a plain count; analytics freshness leaves Content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One row of cards with previews and buttons

**Files:**
- Create: `lib/social-hub/views/card-media.ts` (pure: which images a card can step through)
- Create: `components/social-hub/content/CardMedia.tsx` (client: hover-play, speaker, arrows, dots, swipe)
- Create: `components/social-hub/content/MakeItButton.tsx` (client)
- Modify: `components/social-hub/content/TodayStrip.tsx`
- Modify: `components/social-hub/content/ContentScreen.tsx` (pass `controls` to `TodayStrip`)
- Modify: `components/social-hub/house/ActionBar.tsx` (a `card` variant and `readOnly`)
- Modify: `app/social/(hub)/hub-content.css`
- Test: create `tests/social-hub-card-media.test.ts`

**Interfaces:**
- Consumes: `Offer.card` (Task 3); `narrowStep` (Task 4); `ideaRef` from `lib/social-hub/run-today.ts`; `QuotaCandidate.seriesId` (Task 1).
- Produces: `mediaFrames(media: HubMedia): Array<{ src: string; remote: boolean }>`.
- Produces: `ActionBar` props `variant?: 'bar' | 'card'` (default `'bar'`) and `readOnly?: boolean` (default `false`).
- Produces: `TodayStrip({ candidates, o, runs, controls })`.

- [ ] **Step 1: Write the failing test for `mediaFrames`**

Create `tests/social-hub-card-media.test.ts`:

```ts
/** The images a card steps through with its arrows (offline). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mediaFrames } from '@/lib/social-hub/views/card-media';

test('slides: rendered image first, else the photo (remote), and outline-only slides are skipped', () => {
  const frames = mediaFrames({ kind: 'slides', slides: [
    { src: '/r/1.jpg', alt: '', photo: null, layout: null, headline: null, body: null },
    { src: null, alt: '', photo: 'https://img/2.jpg', layout: null, headline: null, body: null },
    { src: null, alt: '', photo: null, layout: 'text', headline: 'H', body: null },
  ] });
  assert.deepEqual(frames, [{ src: '/r/1.jpg', remote: false }, { src: 'https://img/2.jpg', remote: true }]);
});

test('frames: only those with an image; video and none have no frames', () => {
  assert.deepEqual(mediaFrames({ kind: 'frames', frames: [{ src: '/f/1.png', label: 'a' }, { src: null, label: 'b' }] }), [{ src: '/f/1.png', remote: false }]);
  assert.deepEqual(mediaFrames({ kind: 'video', src: 'v.mp4' }), []);
  assert.deepEqual(mediaFrames({ kind: 'none', note: 'x' }), []);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx tsx --test tests/social-hub-card-media.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `lib/social-hub/views/card-media.ts`**

```ts
import type { HubMedia } from '@/lib/social-hub/types';

/**
 * The images a Today's Content card steps through with its arrows: rendered
 * slides (or their photo when only the outline exists) and story frames.
 * `remote`: a third-party photo, loaded without a referrer.
 */
export function mediaFrames(media: HubMedia): Array<{ src: string; remote: boolean }> {
  if (media.kind === 'slides') {
    return media.slides.flatMap((s) => (s.src ? [{ src: s.src, remote: false }] : s.photo ? [{ src: s.photo, remote: true }] : []));
  }
  if (media.kind === 'frames') return media.frames.flatMap((f) => (f.src ? [{ src: f.src, remote: false }] : []));
  return [];
}
```

Run: `npx tsx --test tests/social-hub-card-media.test.ts`. Expected: PASS.

- [ ] **Step 4: Create `components/social-hub/content/CardMedia.tsx`**

Controls sit beside the post link, never inside it (a button inside a link is invalid and would open the post).

```tsx
'use client';

import { ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { PostLink } from '@/components/social-hub/nav/PostLink';
import { TYPE_ICON, typeStyle } from '@/components/social-hub/ui/marks';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import type { HubPost } from '@/lib/social-hub/types';
import { mediaFrames } from '@/lib/social-hub/views/card-media';

/**
 * A Today's Content card's media (spec 2026-10-13 §2). Video plays muted on
 * hover and resets on leave; the speaker turns sound on. Slides and story
 * frames get arrows and dots on hover. Clicking the media opens the post. On
 * touch screens a tap plays or pauses a video, and a swipe changes the slide.
 */
export function CardMedia({ post }: { post: HubPost }) {
  const tall = post.format !== 'feed';
  const art = `sh-strip__art sh-gallery__art${tall ? ' is-tall' : ''}`;
  if (post.media.kind === 'video' && post.media.src) return <VideoPreview post={post} src={post.media.src} poster={post.media.poster ?? null} className={art} />;
  if (mediaFrames(post.media).length) return <SlidesPreview post={post} className={art} />;
  return (
    <PostLink id={post.id} className={art} decorative>
      <StillArt post={post} />
    </PostLink>
  );
}

const touchOnly = () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

function VideoPreview({ post, src, poster, className }: { post: HubPost; src: string; poster: string | null; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  const play = () => void ref.current?.play().catch(() => undefined);
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };
  return (
    <div
      className={`${className} sh-cardmedia`}
      style={typeStyle(post.vertical)}
      onMouseEnter={play}
      onMouseLeave={stop}
      onClickCapture={(e) => {
        // Touch: a tap plays or pauses instead of opening the post. Next's Link skips a prevented click.
        if (!touchOnly() || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const v = ref.current;
        if (v) v.paused ? play() : v.pause();
      }}
    >
      <PostLink id={post.id} className="sh-cardmedia__open" decorative>
        <video ref={ref} src={poster ? src : `${src}#t=0.5`} poster={poster ?? undefined} muted playsInline loop preload="metadata" />
      </PostLink>
      <button type="button" className="sh-cardmedia__sound" aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={() => setMuted((m) => !m)}>
        {muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function SlidesPreview({ post, className }: { post: HubPost; className: string }) {
  const frames = mediaFrames(post.media);
  const [i, setI] = useState(0);
  const start = useRef<number | null>(null);
  const go = (d: number) => setI((n) => Math.min(frames.length - 1, Math.max(0, n + d)));
  const frame = frames[Math.min(i, frames.length - 1)]!;
  return (
    <div
      className={`${className} sh-cardmedia`}
      style={typeStyle(post.vertical)}
      onTouchStart={(e) => { start.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (s != null && end != null && Math.abs(end - s) > 40) go(end < s ? 1 : -1);
      }}
    >
      <PostLink id={post.id} className="sh-cardmedia__open" decorative>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frame.src} alt="" loading="lazy" decoding="async" {...(frame.remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      </PostLink>
      {frames.length > 1 ? (
        <>
          {i > 0 ? <button type="button" className="sh-cardmedia__arrow sh-cardmedia__arrow--prev" aria-label="Previous slide" onClick={() => go(-1)}><ChevronLeft size={16} aria-hidden="true" /></button> : null}
          {i < frames.length - 1 ? <button type="button" className="sh-cardmedia__arrow sh-cardmedia__arrow--next" aria-label="Next slide" onClick={() => go(1)}><ChevronRight size={16} aria-hidden="true" /></button> : null}
          <span className="sh-thumb__count">{i + 1}/{frames.length}</span>
          <span className="sh-cardmedia__dots" aria-hidden="true">
            {frames.map((f, n) => <i key={`${n}-${f.src}`} className={n === i ? 'is-on' : undefined} />)}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** No video or slides to step through: the poster or first image, else the type's icon. */
function StillArt({ post }: { post: HubPost }) {
  const { src, remote } = thumbOf(post.media);
  const Icon = TYPE_ICON[post.vertical];
  return (
    <span className="sh-gallery__frame" style={typeStyle(post.vertical)} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      ) : (
        <span className="sh-gallery__empty"><Icon size={22} />{post.status === 'generating' ? 'Being made' : 'No preview'}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Add the `card` variant and `readOnly` to `ActionBar`**

In `components/social-hub/house/ActionBar.tsx`:
- signature: `export function ActionBar({ menu, compact = false, showOffNote = true, variant = 'bar', readOnly = false }: { menu: ActionMenu; compact?: boolean; showOffNote?: boolean; /** `card`: Today's Content, primary full width over a 2-column grid. */ variant?: 'bar' | 'card'; /** Shown but not clickable (the preview page). */ readOnly?: boolean })`
- root class: ``className={`sh-actions${compact ? ' sh-actions--compact' : ''}${variant === 'card' ? ' sh-actions--card' : ''}`}``
- in `button(…)`: `disabled={readOnly || Boolean(action.disabled) || busy != null}`

- [ ] **Step 6: Create `components/social-hub/content/MakeItButton.tsx`**

```tsx
'use client';

import { Loader } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { narrowStep, type PlanStep, type RunPlan } from '@/lib/social-hub/run-today';
import type { Vertical } from '@/lib/social-hub/types';

const RUN_TODAY = '/api/content-type/run-today';
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Make it (spec D9): one card's run. The plan is read first so the person sees
 * the cost; the server plans again on the click, so a card made meanwhile
 * starts nothing.
 */
export function MakeItButton({ vertical, target }: { vertical: Vertical; target: string | undefined }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<PlanStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function open() {
    setNote(null);
    setBusy(true);
    try {
      const res = await fetch(RUN_TODAY, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const plan = (await res.json()) as RunPlan;
      const own = plan.steps.find((s) => s.vertical === vertical);
      const narrowed = own ? narrowStep(own, target) : null;
      if (!narrowed || narrowed.action === 'none') {
        setNote({ ok: true, text: narrowed?.note ?? 'Nothing to make for this card.' });
        router.refresh();
        return;
      }
      setStep(narrowed);
      dialog.current?.showModal();
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    dialog.current?.close();
    setBusy(true);
    try {
      const res = await fetch(RUN_TODAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ only: vertical, ...(target ? { target } : {}) }) });
      const out = (await res.json().catch(() => ({}))) as { results?: Array<{ ok: boolean; note: string }>; error?: string };
      const r = out.results?.[0];
      setNote(r ? { ok: r.ok, text: r.note } : { ok: res.ok, text: out.error ?? (res.ok ? 'Nothing needed making.' : 'That didn’t work. Try again in a moment.') });
      router.refresh();
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sh-actions sh-actions--card">
      <div className="sh-actions__row">
        <button type="button" className="sh-btn sh-btn--primary" disabled={busy} data-busy={busy ? '' : undefined} onClick={() => void open()}>
          {busy ? <Loader size={14} aria-hidden="true" /> : null}
          Make it
        </button>
      </div>
      {note ? <p className={`sh-actions__note${note.ok ? '' : ' sh-actions__note--failed'}`} role="status">{note.text}</p> : null}
      <dialog ref={dialog} className="sh-confirm" aria-labelledby="sh-makeit-title" onClose={() => setStep(null)}>
        <h2 id="sh-makeit-title">Make it?</h2>
        <p>{step?.note} Up to {usd(step?.estimateUsd ?? 0)}. Your click approves this spend.</p>
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="sh-btn sh-btn--primary" onClick={() => void run()}>Make it (up to {usd(step?.estimateUsd ?? 0)})</button>
        </div>
      </dialog>
    </div>
  );
}
```

`lib/social-hub/run-today.ts` imports only pure modules (`day-rank`, `verticals`), so importing it into a client component is safe. If the bundler complains about a server-only import in its graph, move `narrowStep` and the `PlanStep`/`RunPlan` types to a new `lib/social-hub/run-step.ts`, re-export them from `run-today.ts`, and import from there.

- [ ] **Step 7: Rebuild `TodayStrip.tsx` around these pieces**

Replace the file with:

```tsx
import { Loader2 } from 'lucide-react';

import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import { stageLabel } from '@/lib/content-type/run-status';
import { CardMedia } from '@/components/social-hub/content/CardMedia';
import { MakeItButton } from '@/components/social-hub/content/MakeItButton';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TYPE_ICON, TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import type { HubPost } from '@/lib/social-hub/types';
import { ideaRef } from '@/lib/social-hub/run-today';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { clock, displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { runForCandidate } from '@/lib/social-hub/views/run-for';

/**
 * Today's Content (spec 2026-10-13 §2): the day's cards in one row, in posting
 * order. A made card shows the content itself (hover to play or step through)
 * and its buttons; a card not made yet shows its idea and Make it.
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

export function TodayStrip({ candidates, o, runs, controls = true }: { candidates: QuotaCandidate[]; o: Offerer; runs: AllProgress; /** False on the preview page: buttons show but can't be clicked, and Make it is hidden. */ controls?: boolean }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {candidates.map((c, i) => (c.post
        ? <Made key={c.post.id} post={c.post} o={o} run={runForCandidate(c, runs)} controls={controls} />
        : <Pending key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} run={runForCandidate(c, runs)} controls={controls} />))}
    </ul>
  );
}

function Made({ post, o, run, controls }: { post: HubPost; o: Offerer; run: ProgressItem | null; controls: boolean }) {
  const when = post.postedAt ?? post.publishAt;
  const offer = o.offer(post);
  const { primary, grid } = offer.card;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card" style={{ listStyle: 'none' }}>
      <CardMedia post={post} />
      <div className="sh-gallery__meta">
        <TypeMark vertical={post.vertical} />
        <span>{when ? clock(when) : post.status === 'generating' ? 'Being made' : 'No slot yet'}</span>
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

function Pending({ c, run, controls }: { c: QuotaCandidate; run: ProgressItem | null; controls: boolean }) {
  const Icon = TYPE_ICON[c.vertical];
  const tag = c.rank == null ? null : `#${c.rank} in the queue${c.moved === 'promoted' ? ' · Promoted' : c.moved === 'demoted' ? ' · Demoted' : ''}`;
  const target = c.vertical === 'stories' ? c.seriesId : c.idea ? ideaRef(c.idea.id) : undefined;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card is-pending" style={{ listStyle: 'none' }}>
      <span className={`sh-strip__art sh-gallery__art${c.vertical === 'carousels' ? '' : ' is-tall'}`}>
        <span className="sh-gallery__frame" style={typeStyle(c.vertical)} aria-hidden="true">
          <span className="sh-gallery__empty"><Icon size={22} />Not made yet</span>
        </span>
      </span>
      <div className="sh-gallery__meta">
        <TypeMark vertical={c.vertical} />
        <span>{tag ?? (c.series ? c.series : 'Open slot')}</span>
      </div>
      <span className="sh-strip__name">{c.idea?.title ?? (c.series ? `${c.series}: today’s set` : 'Open slot: the next run picks its idea')}</span>
      {run ? <RunChip run={run} /> : controls ? <MakeItButton vertical={c.vertical} target={target} /> : <span className="sh-muted sh-gallery__hint">Make it builds this card.</span>}
    </li>
  );
}
```

In `ContentScreen.tsx`, render `<TodayStrip candidates={today} o={o} runs={runs} controls={controls} />`.

- [ ] **Step 8: The row and card styles**

Append to `app/social/(hub)/hub-content.css`, **after** the existing `.sh-gallery__*` rules (it must come after `.sh-strip` to win):

```css
/* Today's Content (2026-10-13): the cards share one row; below ~170px each, the row scrolls sideways instead of shrinking. */
.sh-gallery { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(170px, 1fr); align-items: stretch; }
.sh-gallery__card { width: auto; min-width: 0; }
.sh-gallery__card > .sh-actions--card { margin-top: auto; }
.sh-gallery__view { font-size: var(--sh-fs-small); }
@media (max-width: 640px) { .sh-gallery__card { width: auto; } .sh-gallery { grid-auto-columns: minmax(160px, 70%); } }

/* Card media: controls sit beside the post link, over the image. */
.sh-cardmedia { position: relative; }
.sh-cardmedia__open { display: block; width: 100%; height: 100%; }
.sh-cardmedia__open img, .sh-cardmedia__open video { display: block; width: 100%; height: 100%; object-fit: cover; }
.sh-cardmedia__arrow, .sh-cardmedia__sound { position: absolute; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 999px; background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); cursor: pointer; }
.sh-cardmedia__arrow { top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity 120ms var(--sh-ease); }
.sh-cardmedia__arrow--prev { left: 6px; }
.sh-cardmedia__arrow--next { right: 6px; }
.sh-cardmedia:hover .sh-cardmedia__arrow, .sh-cardmedia:focus-within .sh-cardmedia__arrow { opacity: 1; }
.sh-cardmedia__sound { right: 6px; bottom: 6px; }
.sh-cardmedia__dots { position: absolute; left: 50%; bottom: 10px; display: flex; gap: 4px; transform: translateX(-50%); pointer-events: none; }
.sh-cardmedia__dots i { display: block; width: 5px; height: 5px; border-radius: 999px; background: rgba(255, 255, 255, 0.5); }
.sh-cardmedia__dots i.is-on { background: #fff; }
@media (hover: none) { .sh-cardmedia__arrow { opacity: 1; } }

/* Card buttons: the primary full width over a two-column grid of labeled buttons. */
.sh-actions--card { width: 100%; }
.sh-actions--card .sh-actions__row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sh-actions--card .sh-btn { min-width: 0; padding: 0 6px; font-size: var(--sh-fs-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sh-actions--card .sh-btn--primary { grid-column: 1 / -1; }
```

Prefer existing tokens where the design system has them (the impeccable hook may flag literal colors). Swap in a token if one exists for the white dot or the shadow; otherwise leave the literal and say so in the report.

- [ ] **Step 9: Type check and tests**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head` then `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: clean; `fail 0`.

- [ ] **Step 10: Verify in the browser**

`preview_start` `social-hub-preview` and open `http://localhost:3123/social/preview`. Then:
1. `read_page`: Today's Content is one row in posting order (booked times first, then "No slot yet", then "Not made yet"). Made cards have no `#N` rank tag; "Not made yet" cards show `#N in the queue`.
2. Buttons per state match Task 3's table. On the preview they show but are disabled (`readOnly`); "Not made yet" cards show the hint, not Make it.
3. `javascript_tool`: dispatch `mouseenter` on a video card's `.sh-cardmedia` and confirm `video.paused === false`; dispatch `mouseleave` and confirm it paused with `currentTime === 0`. Click the speaker and confirm `video.muted === false` and that the URL didn't change.
4. Hover a carousel or Stories card, click the right arrow, and confirm the counter moves to `2/N` and the URL didn't change.
5. `resize_window` `mobile`: arrows visible without hover; the row scrolls sideways. Reload with the mobile preset (touch emulation), click a video, and confirm the URL is unchanged and the video toggled (Review Focus 5). Reset with preset `desktop`.
6. `resize_window` desktop, about 1440 wide: six cards fit in one row with no horizontal scroll, and the button rows line up along the bottom.
7. `read_console_messages` with `onlyErrors`: none.
8. Take a screenshot for the report.

- [ ] **Step 11: Commit**

```bash
git add lib/social-hub/views/card-media.ts components/social-hub/content/CardMedia.tsx components/social-hub/content/MakeItButton.tsx components/social-hub/content/TodayStrip.tsx components/social-hub/content/ContentScreen.tsx components/social-hub/house/ActionBar.tsx "app/social/(hub)/hub-content.css" tests/social-hub-card-media.test.ts
git commit -m "feat(social-hub): Today's Content is one row of playable, actionable cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final check and hand-off

- [ ] **Step 1: Whole suite and types**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` and `npx tsc --noEmit -p . 2>&1 | grep -v seo-gsc-auth | head`
Expected: `fail 0`; no new type errors.

- [ ] **Step 2: Confirm nothing worker-side changed**

Run: `git diff --stat origin/unify-social-hub...HEAD | grep -E "scripts/gcp|worker" || echo "no worker files"`
Expected: `no worker files` (no VM redeploy needed).

- [ ] **Step 3: Report to Tommy, do not push**

Report: each task's commit, the preview screenshot, Task 3 step 8's finding (does Approve book a slot for explainers and Stories?), whether Task 0 ran with PR #5 merged, and any token literals left in CSS. Then list what Tommy checks himself on the live app after he pushes and Vercel deploys: hover-play with sound, arrows, each button on a real card, and one real **Make it** that he clicks. Ask before pushing.
