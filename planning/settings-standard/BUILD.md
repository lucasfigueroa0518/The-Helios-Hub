# Build brief — settings standard (shared by every builder)

Read first: `CONTRACT.md` (this folder), D16–D18 in `PLAN.md`, `lib/content-type/state.ts` (the shared model; **do not edit it**, report any change you need), and `CLAUDE.md`.

## Hard rules
- **No live spend:** no live Claude, `web_search` or Jev calls, and no running workers, night runs or scripts that call models.
- **No database writes:** no `psql` or Supabase writes, and no applying migrations. Migration files are written, not run.
- **No deploys and no git commits or pushes.** The lead commits.
- **Only edit the files you own (below).** If you need a change in someone else's file, stop and put it in your report.
- **Tests are offline only,** using stubbed queries and transports, in `tests/<name>.test.ts`. Run just your files with `npx tsx --test tests/<file>.test.ts`.
- **Typecheck:** `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json` (the baseline is clean). Another builder may break the build mid-way; your own files must have no errors.
- **Labels:** say "Text on Screen" in UI text and comments, but don't rename the `reels` code identifiers.
- Keep the repo's comment style: short doc comments that say why, and cite decision ids (D16–D18) where they apply.

## The fixed interface (`lib/content-type/posting.ts`, owned by builder A; everyone codes against this)
```ts
import type { TypeState } from '@/lib/content-type/state';
export type PostingState = {
  type: ContentType;
  state: TypeState;              // D16
  stateMismatch: boolean;        // stored Generate off + Live on (reads as paused)
  refillCapUsd: number;          // D14, via refillCapUsd(type, stored)
  scheduledAhead: number;        // this type's future scheduled slots: what Pause sends back to Made (D17)
  /** @deprecated read-only, derived from state; kept for health/scoreboard readers. */ live: boolean;
  /** @deprecated read-only, derived from state. */ generate: boolean | null;
  // autoPublish is REMOVED (approval is always required)
  perDay, maxPerDay, series, days?, schedule, nights, cap, costPerPostMicros   // unchanged
};
export type PostingPatch = { state?: TypeState; perDay?: number; cap?: number; refillCapUsd?: number };
// live / generate / autoPublish are no longer patchable.
// writePosting(type, { state: 'paused' }) also unslots the type's future scheduled posts (D17).
export async function readPosting(type, now?): Promise<PostingState>;
export async function writePosting(type, patch, by): Promise<PostingState>;
```
The route `app/api/content-type/posting/route.ts` keeps its URL. GET returns `PostingState`, and POST takes a `PostingPatch`.

## Stored keys (contract §3)
- **State:** the Generate key (`auto_run` / `auto_render` / `auto` / `series[s].auto`) plus `publishing_live`, through `keysOf` / `stateOf`.
- **Refill cap:** `pool_refill_cap_usd` in each type's settings table. Stories types use `stories.settings.types[<type>].refill_cap_usd`. Read it with `refillCapUsd(type, stored)`.
- **Approval:** `require_approval` is treated as always true. Code must never read it as false.

## Owners
- **A (state + storage):** `lib/content-type/posting.ts`; `app/api/content-type/posting/route.ts`; `app/api/field-notes/settings/*`; `lib/reel-ai-drama/hub.ts`; `lib/stories/settings.ts`; `lib/lfd/settings.ts`, `lib/ai-events/settings.ts`, `lib/field-notes/settings.ts`, `lib/social/overnight/settings.ts`, `lib/explainers/settings.ts`, `lib/reels/music/store.ts` (settings reads only); the new `lib/content-type/unslot.ts`; `lib/social-hub/health/load.ts`, `lib/content-type/run-today-live.ts`, `scripts/overnight_scoreboard.ts`, `scripts/overnight_check.ts`; `scripts/publisher_worker.ts` (verify the slot-passed rule); the new migration `db/settings_standard_states.sql`; tests `tests/content-type-state.test.ts`, `tests/content-type.test.ts`.
- **B (Settings tab UI):** `components/content-type/**` (except files A or C own); `components/social-hub/content/ContentScreen.tsx`, `HubControls.tsx`; `app/reels/reels-hub.tsx`; `app/explainers/page.tsx`, `app/reel-ai-drama/page.tsx`; tests `tests/content-type-settings-tab.test.ts`.
- **C (refill split: Text on Screen, Explainers, AI Drama):** `scripts/reels_worker.ts`, `lib/reels/**` (except `lib/reels/music/store.ts`), `scripts/explainers_worker.ts`, `lib/explainers/**` (except `settings.ts`), `scripts/reel_ai_drama_worker.ts`, `lib/reel-ai-drama/**` (except `hub.ts`); tests `tests/refill-split-video.test.ts`.
- **D (refill split: social worker, intake, Stories):** `scripts/social_worker.ts`, `lib/intake/**`, `lib/social/**` (except `overnight/settings.ts`), `lib/lfd/**`, `lib/ai-events/**`, `lib/field-notes/**` (each except its `settings.ts`), `scripts/stories_worker.ts`, `lib/stories/**` (except `settings.ts`); tests `tests/refill-split-social.test.ts`.

## What "refill split" means (C and D)
In each worker:
1. Refill runs **in every state** and is **never skipped for a full quota**.
2. Each refill is held to its refill cap. When the cap is reached, the refill ends and logs `refill_capped`.
3. Making posts happens only when `makesPosts(state)` is true and stays under `quota − placed`.
4. Scheduling or posting happens only when `postsToInstagram(state)` is true.

Read the state with `stateOf(generate, publishing_live)`. Log `state_mismatch` when it's flagged. A person's manual "run now" keeps working in every state, as it does today.
