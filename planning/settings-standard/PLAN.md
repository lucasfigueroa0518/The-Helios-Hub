# Standardize settings for all content types — living plan

Trello card: "Standardize settings for all content types"
Stage: **Contract** (draft in `CONTRACT.md`, awaiting review; no code edits until approved)

## The card's questions
- (a) Where do we control whether a content type is "live"?
- (b) What does "live" mean?
- (c) Why aren't idea pools refreshing for some content types?

## Decisions (user's words quoted)
- **D1 (2026-11-18): "Live" means only "posts actually go to Instagram"** (`publishing_live`). Generating gets its own name, for example "making posts". User: "1 yes".
- **D2 (2026-11-18): Pool refill is its own switch, separate from Generate**, with a small spend cap for each type. User: "2 yes".

- **D3 (2026-11-18): Refill runs even when the day's quota is full.** User: "yes".
- **D4 (2026-11-18): Retired series (Free vs Paid, Guess the Number) stop refilling as part of the build, not sooner.** User: "yes".
  _Correction, same day:_ they have already stopped. The last refill was the 3:00 AM run on Nov 17, before the Stories-split merge (Nov 17 09:15) retired them in code, and nothing refilled them on Nov 18. Left over: `stories.settings.series` still says `auto: true, enabled: true` for both, and 58 old rows are still open in `stories.pool` (Free vs Paid 28, Guess the Number 30). Pending the user's call: proposed cleanup in the build.
- **D5 (2026-11-18): Four switches per type, in lifecycle order: Refill → Generate → Approval → Live.** Quotas, caps and windows sit under their switch. User: "yes".
- **D6 (2026-11-18): A missing setting counts as off for every type.** Text on Screen gets a saved "on" so its behavior doesn't change. User: "yes".
- **D7 (2026-11-18): Stored setting names stay as they are.** Standardize only the UI and the spec, through the existing mapping in `lib/content-type/posting.ts`. User: "yes".
- Out of scope: the committed `.env.local.bak.*` file. User: "Lucas is handling it".

- **D8 (2026-11-18): Settings live inside each content type's idea pool menu.** User: "This would be a section within the individual content type's idea pool menu".
  Today Settings is a gear button that opens a drawer on the type's page (`components/content-type/TypeControls.tsx` `SettingsButton` / `PostingSettings`), while the pool has its own Ideas | Made tabs (`components/content-type/pool/PoolTabs.tsx`).
  Proposed, awaiting the user's answer: a third tab, **Ideas | Made | Settings**, laid out like this:

  ```
  Settings
  ① Refill    [on/off]  how often · pool size · spend cap per refill
  ② Generate  [on/off]  posts per day (or days) · run spend cap
  ③ Approval  [on/off]  "a person approves every post"
  ④ Live      [on/off]  posting windows · days
  ─ This type only ─  (e.g. AI Drama's extra form, Stories series, AI Events cities)
  ```

- **D9 (2026-11-18): The gear-button Settings drawer goes away; the pool's Settings tab is the only place.** User: "yes".
- **D10 (2026-11-18): Settings that cover every type** (calendar template mode, publisher on/off) **stay on the Social Hub's main settings.** Each type's tab shows one line, "also affected by: …". User: "yes".
- **Context from Lucas (text, 2026-11-18):** the retired Stories types "are no longer in the software at all". **Carousels is iced** but "has potential to make a comeback in the future". Lucas also on Live: "our 'live' button is a bit misleading … live now mean fr live, like [it's] getting posted", which agrees with D1.
  Carousels today: `auto_run` off (switched off 2026-11-18 16:28 UTC), `publishing_live` still **on**, `require_approval` on, no future carousel slots on the spine. Nothing posts unless a person approves a carousel that's waiting in review.
  Proposed, awaiting the user's answer: three type states, **Active / Paused / Retired**.
  - Paused: the code stays, all four switches are off, and the type collapses to a "Paused" row in the hub with one "Bring back" button.
  - Retired: the code is gone, the saved settings are switched off, and leftover pool rows are archived with reason `retired`. History is kept and nothing is deleted.

- **D11 (2026-11-18): The build cleans up leftovers from every retired type, not just the two Stories series.** User: "And other retired types".
  Inventory (read-only check, 2026-11-18):
  - Free vs Paid and Guess the Number: still listed in `stories.settings.series` with `auto: true`, and 58 rows still open in `stories.pool`. Plan: switch them off and archive the rows with reason `retired`.
  - `helios_social` schema: 6 tables (`posts`, `post_assets`, `post_slides`, `judge_shadow_ledger`, `article_queue`, `image_cache`), `posts` is empty, and nothing in the code reads it. Looks like an abandoned early version. Dropping it is destructive, so it needs the user's explicit go-ahead.
  - Code state on `main` (f940369, 2026-11-18 12:33; this branch is level with it): Free vs Paid and Guess the Number have no pages, pools, refills or settings rows in the hub. What's left in code only shows their past posts (`lib/stories/render`, `adapters/stories.ts`) and has their defaults set to off (`lib/stories/settings.ts`). The saved DB row overrides those defaults and still says on, so the cleanup is limited to the DB.
  - The other 10 types in `Vertical` are active, or paused in the case of Carousels. `lib/memes` is still used (43 references), so it isn't retired.

- **D12 (2026-11-18): Lucas replied "Yes to all"** to Tommy's text asking three things: switch off the retired series' settings, archive their 58 ideas, and drop `helios_social`. **Carousels' Live was not part of that text**, so it is still open.
  Correction from the full count: `helios_social` is **not** empty. `article_queue` has 1,000 rows of old v1 carousel stories (hooks, plans, copy, review status) and `image_cache` has 4. The other four tables are empty. There are no views, foreign keys or functions outside the schema that depend on it. The repo mentions it only in `docs/superpowers/specs/2026-10-08-social-storage.md` ("dropping it is Tommy's call") and in comments in `fixtures/social/example-post.ts`.

- **D13 (2026-11-18): "Retired" is not a setting option.** User: "I don't want 'retired' to be a setting option." The type states are **Active / Paused** only. A retired type is removed from the software and has no switch.
- **Done 2026-11-18 (DB, one transaction, approved by Tommy and Lucas):**
  - In `stories.settings.series`, `free_vs_paid` and `guess_the_number` now have `auto` and `enabled` set to false. `updated_by` is "claude (Tommy request; Lucas approved)".
  - 89 open `stories.pool` rows were archived with `archived_reason = 'series-removed'`: 28 Free vs Paid and 61 Guess the Number. The earlier "58" only counted rows refreshed in the last 10 days. Nothing was deleted.
  - Carousels `social.settings.publishing_live` was set to false.
  - To undo: set the series flags back, clear `archived_at` and `archived_reason` WHERE `archived_reason = 'series-removed'`, and set `publishing_live` back to true.
  - **Done 2026-11-19: `helios_social` archived, then dropped.** All 1,004 rows (article_queue 1,000, image_cache 4; the other four tables were empty) are kept as JSON in `archive.helios_social_v1`. A row-count check ran inside the same transaction before the drop. Script: `db/archive_helios_social_v1.sql`.

## Pool check (read-only DB, 2026-11-18, Supabase `lucas-outreach-hub`)
| Type | Generate now | Newest pool refill | Verdict |
|---|---|---|---|
| Text on Screen | no row (counts as on) | today 06:02, 7 slates in 7 days | healthy |
| Explainers | `auto_render` on since **today 16:24** | idea cycle today 16:24, only 2 in 7 days | **stalled until Generate was switched on**: refill depends on Generate |
| Carousels | `auto_run` off (set today 16:28) | last finished run **Oct 28** | **stale 3 weeks**: since Nov 2 every run ends `skipped / quota-filled` (7 of them) before any story work |
| Last Few Days | on | Nov 17 | healthy (twice a week) |
| AI Events | on | Nov 15 (Sunday) | healthy (weekly) |
| Field Notes | on | tips Nov 13 | check: Tue Nov 17 added nothing |
| Stories: Morning Download, Trivia, Real or AI? | per series | today | healthy |
| Stories: Free vs Paid, Guess the Number (retired) | `auto` still true | Nov 17 | still refilling after retirement (wasted work) |
| AI Drama | `auto` on | not checked (pool may be on another DB handle) | open |

**Cause of (c):** the pool refills only inside the "make posts" run, so it stops whenever that run doesn't do work. There are two ways it gets switched off:
1. **Generate is off.** Explainers' idea cycle, AI Drama development, Stories series with `auto`, and the intake's "open orders" (`lib/intake/orders.ts`: no Generate means no fetch for that type) all wait on Generate.
2. **The day's quota is already filled.** Carousels and Explainers skip the whole run, refill included, when people have placed enough posts (`docs/social-overnight.md` §Daily fill). Carousels have hit this every night since Nov 2.

D2 fixes both, as long as the refill switch is independent of Generate **and of the quota**.

## Grounding (read-only pass, 2026-11-18)
- There is already a shared settings model with three switches per type: **Generate**, **Auto-publish**, **Live**.
  `lib/content-type/posting.ts` maps them onto each type's own stored keys. `lib/content-type/config.ts` holds per-type data.
- The stored keys differ by type:

  | Shared switch | Carousels / Text on Screen / LFD / AI Events / Field Notes | Explainers | AI Drama | Stories series |
  |---|---|---|---|---|
  | Generate | `auto_run` | `auto_render` | `auto` | per-series `auto` |
  | Auto-publish | `require_approval` = off | same | same | same |
  | Live | `publishing_live` | same | same | same |

- Defaults differ too. Text on Screen's Generate counts as **on** when the row is missing (`run !== false`), and every other type counts it as off.
- "Live" means at least four different things today: `publishing_live` (posting), Generate (the night run makes things), the "Status: live" column in `docs/social-overnight.md`, and `publisher_mode` (AI Drama).
- Pool refill cadences are listed in `lib/social-hub/views/pools.ts` (`REFILL_CADENCE`, stale thresholds).
- **Hypothesis for (c), not verified:** for several types, the pool only refills during the run that Generate gates. Examples: the Explainers idea cycle runs "only with `auto_render` on", AI Drama develops "while Generate is on", and Stories makes sets "for series with `auto` on". If that holds, switching Generate off also stops pool refill. Not yet checked against the DB or the worker logs.

## Draft MECE tree (for discussion)
Scope × stage. Each knob lives in exactly one cell.

```
Settings
├── Global (all types)          — slot_source (template/legacy), publisher on/off, spend caps
├── Per content type
│   ├── 1 Source / pool refill  — refill on/off, cadence, pool size, seeding
│   ├── 2 Generate              — make posts on/off, per-day quota, render cap, run $ cap
│   ├── 3 Review                — require approval
│   └── 4 Publish               — live on/off, posting windows, days
└── Per series / city (only where the type has groups) — overrides of the above
```

## Open questions
See the latest chat turn.
