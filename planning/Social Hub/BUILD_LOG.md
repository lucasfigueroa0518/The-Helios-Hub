# Social Hub Phase 1: build log

## P1-M0: Baseline + Meta check (2026-10-08)

- Scope baseline: `scope-baseline.json`, 4,048 files hashed (everything outside node_modules, .next, .git and the §S3 allowlist). Checker: `node "planning/Social Hub/scope-guard.mjs" check`.
- Test baseline (`npm test`): **1,464 tests, 1,462 pass, 2 fail (pre-existing, not ours)**:
  - `tests/explainers-render.test.ts`: "the workspace holds the project, pinned skills…" (TypeError in `lib/explainers/render/workspace.ts:113`)
  - `tests/reels-visual.test.ts`: "the text engine keeps a short break…" (`helios_text_engine/.venv/bin/python` missing on this machine)
- Typecheck baseline (`npx tsc --noEmit`): **5 pre-existing errors, all in `tests/seo-gsc-auth.test.ts`**. Ours must add none.
- Build baseline (`npm run build`): **succeeds** ("Compiled with warnings": the pre-existing next-auth/jose Edge Runtime warnings).
- Baseline file SHA-256: `aa6cb819ff0f19f9466167d9c963f2b8810178d7c264f28d7e72a27ff32f2e4a`. It was never rebuilt with `--force`.
- Meta check: `META_API_CHECK.md`. Every §5 metric is marked available / unavailable / unverified. Spec §5 trims are listed at the end of that file.
- Scope guard after running tests and tsc: PASS (tooling touches nothing outside the allowlist).
- Scope guard after the build: PASS.
- Critique (fresh subagent, loop 1): 3 MUST-FIX, 7 NICE. Fixed: guard allowlist tightened to §S3 (D9); the named nav.ts exception was dropped because it isn't used (D5); the build baseline was recorded; volatile drift became warnings (D8); the guard tolerates files deleted mid-walk; META_API_CHECK views-split row and demographics note corrected; spec §5 now points to the M0 trim; OUT_OF_SCOPE #1 wording fixed. Left as is: per-line diff check for nav.ts (moot, unused) and symlink detection (no symlinks are created). Playwright runs through the library with screenshots written to `screens/`, so there is no `test-results/`.
- Incident: one read-only `git status` (D6).
- After the fixes, the guard flagged `.impeccable/hook.cache.json` (a plugin hook cache rewritten by the editor tools) and it was classified volatile (D8). **Gate: PASS.**

## P1-M1: Foundations

Built:
- `lib/social-hub/`: `types.ts` (HubPost, HubIdea, HubSource, metrics, statuses), `flags.ts` (§S5: constants, every action off, frozen), `verticals.ts` (labels, colors, own pages), `ids.ts` (durable post ids, D7), `metrics.ts` (catalog trimmed to META_API_CHECK, ranking, top 5, formatting), `time.ts` (NY days, SH-29 ranges, month grid), `links.ts`, `preview.ts`.
- `app/social/(hub)/`: layout with the tab bar (Calendar · Analytics · Content House); placeholder pages at `/social`, `/social/analytics`, `/social/house`, `/social/post/[id]`, each with its own `getSession()` redirect. Development-only fixture mirror at `/social/preview/**` (D10).
- `components/social-hub/HubTabs.tsx`, `PageHead.tsx`; `app/social-hub.css` (tokens only).
- Sidebar item: **not added**. The `nav.ts` exception can't add it without breaking `HubSidebar.tsx` (D5, OUT_OF_SCOPE #2, with the exact patch).
- Tests: `tests/social-hub-scope.test.ts` (SQL writes, transitive network + foreign-write reach, flags, deps, render isolation, preview isolation) and `tests/social-hub-foundations.test.ts` (ids, links, ranges, DST, grid, formatting, ranking).

Gate (loop 1): scope PASS · `npm test` 1,473 tests, 2 failures (both from the baseline) · tsc: only the 5 baseline errors · build OK (routes `/social/*` and `/social/preview/*`, nothing under render) · screens `screens/M1/` at 1440 and 390: no phone overflow, no console errors; `/social` signed-out redirects to sign-in.

Critique (loop 1): 3 MUST-FIX and 9 NICE. Fixed:
- The SQL-write scan now follows imports transitively (with a positive control).
- The regex is case-insensitive and catches `${}` targets, MERGE, COPY, GRANT, UPDATE ONLY and materialized views.
- `parseRange` uses `Object.hasOwn` (no crash on `?range=toString`) and clamps custom ranges.
- `ids` rejects malformed `%` and checks kinds per vertical.
- Years before 2000 are rejected.
- Duration and count rounding are fixed.
- Non-vacuous file-list check; stricter render-isolation and preview-isolation tests; more network packages and `require()` scanned.
- Calendar title fixed; the tab bar no longer has a doubled label; raw px values replaced by tokens.

The reach scan then surfaced two real paths:
- The reels adapter → `lib/reels/copy/slots.ts` → Jev. Fixed by copying the 3-line `inKnowledgeLane` predicate.
- Pages → `lib/session.ts` → `lib/auth.ts` (sign-in upsert of `outreach.users`). Made `lib/session.ts` the one documented scan boundary, since every page must check the session.

Loop 2: scope PASS, scope test 12/12, foundations 9/9, tsc clean apart from the baseline errors. Deferred: view flags are read by the pages from M4 on.

## P1-M2: Read model

Built:
- `lib/social-hub/queries/{reels,explainers,carousels,stories}.ts`: SELECT-only reads. The Trial Reels attempt query copies `performance-store.ts`'s shape.
- `lib/social-hub/adapters/*.ts`: rows → `HubPost` / `HubIdea`. Story set = post, frames = pages. Completion and frames 1–3 exits mirror `setInsights`.
- `factors.ts`: generalized `factorGroups` (category, median bands, tags, shared slot split by vertical), thin < 3.
- `sources.ts` (dedupe by URL); `dataset.ts` (per-vertical error isolation); `load.ts`; `db.ts` (SELECT-only handle, plus the explainers handle, D19).

Tests (`tests/social-hub-adapters.test.ts`):
- Real SQL on PGlite loaded with the four unmodified schema files plus a tiny seed (`tests/fixtures/social-hub/`).
- One adapter test per vertical.
- **Group vs group equals Trial Reels `factorGroups` on the same reels for all 13 factors and 3 seeds.**
- Thin < 3, tags and mixed slots, error isolation, source dedupe.

Critique (loop 1): 3 MUST-FIX, 1 to verify, 8 NICE. Fixed:
- Published-but-unlinked slots are no longer listed twice.
- Carousel photo sources now match by story, because the pipeline rarely sets `post_id`.
- Trial Reels ideas never show "Content ready" (SH-59).
- Explainers are read through their own DB handle (D19).
- Approval times per trigger (D24); "required" applies only to auto slots.
- An Explainers force post counts as approval.
- A failed try doesn't block "Content ready".
- Timestamps are compared as dates, not strings; dead code removed.

Note for M5: Trial Reels group numbers equal `/reels/analytics/performance` only on published reels with a media id, and analytics filters to those. Known gap: the §9a "Retired" state is not derived (no retirement flag is stored). A regression test covers the fixes.

## P1-M3: Cost model (§8a)

Built:
- `lib/social-hub/cost.ts` (pure): integer micro-dollars; largest-remainder split; allocations keep the row's day; "Unattributed (no output)" per day and vertical; window summaries at every level; item totals; `withCosts` (a reused post shows "generated <date>" and adds $0); `costOfPosts` (each item counted once); `costStats` (numerator ÷ denominator: per published post, per generated item, yield, unshipped, unattributed); per-dollar values.
- `lib/social-hub/queries/costs.ts`: ledger reads (D20–D23) and an `agreement` check of denormalized totals vs rows (reported as notes, never added).

Tests (`tests/social-hub-cost.test.ts`), property tests over random ledgers (4 seeds × 4 windows × 5 vertical filters):
- `Σ items + Unattributed = Σ ledger` to the micro-dollar, and `Σ verticals = total`.
- Each row allocates exactly its own amount once.
- Unattributed never spreads across days.
- A reused post adds $0.
- Items shared by several posts are counted once.
- Stats shapes are numerator ÷ denominator.
- The real ledger SQL on PGlite reconciles end to end with hand-checked attribution for every vertical.
- A denormalized-total disagreement is reported, not added.

M2–M3 gate (loop 1): scope PASS · `npm test` 1,506 tests, only the 2 baseline failures · tsc baseline only · build OK.

M3 critique (loop 1): 5 MUST-FIX and 6 NICE; no double count found. Fixed in loop 2:
- A carousel run whose Σ story costs exceed `total_usd` is reported and never allocated as negative money.
- Carousel agreement checks (Σ stories ≤ total; total ≈ Claude + Jev).
- Preview-run spend stays on a preview item (unshipped) instead of the shipped post with the same story id.
- Real-SQL cases added: a weighted direct split across two reels, a story touched by two runs, a preview run, two posts sharing one content item counted once, every `buildLedger` row counted exactly once, and no negative allocation.
- Carousel posts with no story have no cost key, instead of one that can never match.
- Duplicate unweighted pool entries no longer double a share.

Known (NICE, logged): in-flight runs aren't counted until they finish. Story and Explainer set-less rows are bucketed by spend day, so a set built the evening before its `ny_date` sends that day's set-less rows to Unattributed. One weight serves all direct reel activities.

Loop 2: hub tests 45/45, tsc clean (baseline only).

## P1-M4: Calendar + single-post view

Built:
- `lib/social-hub/calendar.ts` (pure; tested).
- Components: `CalendarMonth` (chips with ET time and short name; outlined when scheduled, struck through and reasoned when cancelled, a mark when failed; "+N more"; one Stories chip per set with frame count; dots on a phone, where the day number covers the cell), `CalendarDay` (timeline with metric line), `PostView` (media, header, performance, cost to make plus per-dollar values, approval and review notes, metrics-over-time chart, grouped details, version history, sources), `PostDrawer` (native modal `<dialog>`: right side on desktop, full screen on a phone, Escape and backdrop close, `?post=` deep link), `MediaPreview` (video and frames through the pipelines' existing routes; carousel slide outline, OUT_OF_SCOPE #3), `MetricChart`, `DataNotes`, `LoadError`.
- `loading.tsx` / `error.tsx` for the hub.
- Pages read the view flags.
- Fixture dataset: `tests/fixtures/social-hub/preview-dataset.ts` (~7 weeks, every status, through the real adapters and cost model).

Gate loop 1: scope PASS · tests 1,509 (2 baseline failures) · tsc baseline only · build OK · screens `screens/M4/` (month, day, drawer, one post per type, not-found, at 1440 and 390): no overflow, no console errors.

Critique loop 1: 4 MUST-FIX, 9 NICE. Fixed:
- Table roles instead of `grid`.
- Chip status as hidden text, and the cancel reason in the title.
- Native `<dialog>` drawer (focus contained, background inert).
- Loading and error states.
- Chart labels moved to HTML.
- Slot label no longer repeated.
- "Slot was …" wording for missed slots.
- Close goes back when the drawer was opened in-app.
- The chart remounts per post.
- "Open as a page" is hidden when the post view flag is off.
- Empty-month note; key collisions fixed.

Loop 2 screens: `screens/M4-loop2/`, clean. Left: a missing post returns 200 with the empty card (NICE).

## P1-M5: Analytics

Built:
- `lib/social-hub/analytics.ts`: query parsing, posts in view (published only, Trial Reels' rule), vertical-first filters (SH-05; native filters ignored without a vertical; a format-only metric falls back in mixed views), headlines, per-format blocks, ranking, top 5 (SH-30), side by side (shared rows, then each post's fields, blanks where a field doesn't apply, differing rows flagged), group vs group, pagination.
- UI: `Controls` (range links plus a custom date form, vertical links, metric and native filter selects in an auto-submitting GET form, so all state is in the URL), `ContentTab` (per-format tiles with cost; ranked, paged posts table with thumbnails, key columns and cost; checkboxes → compare), `ProfileTab` (top performers; account section waits for M7 tables), `CompareTab` (side by side with Remove; group vs group with thin marks and cost per post).

Tests: `tests/social-hub-analytics.test.ts`, 9 cases covering every filter and compare path, and that mixed views offer shared filters and metrics only.

Screens: `screens/M5/` (content, profile, native filter, side by side, mixed groups, stories groups, empty compare, empty custom range, at 1440 and 390). The table was paged after the first look (D26). Uncollected feed metrics are hidden (D25). Screenshot hydration noise was traced to Playwright (D27).

M5 critique loop 1: 3 MUST-FIX, 11 NICE. Fixed in loop 2:
- One `hrefWith(action, q, changes)` carries all state (range, vertical, metric, filters, tab, mode, factor, compare ids). A vertical change clears its filters and factor; every change resets the page.
- The custom range keeps filters and has an Apply button (no early submit).
- **Shared filters (format, slot) in the mixed view** (SH-05).
- An active filter with no matches can still be cleared.
- Compare keeps published posts only.
- `aria-current="page"`; scrollable table regions are focusable and labeled.
- Profile shows totals from our posts plus the account-level discovery note; the Top 5 title follows the view.

Tests: the state-keeping link table, repeated `cmp`, slot and format filters, a stale filter. Screens: `screens/M5-loop2/`, clean. Left (NICE): sorting only through the metric picker; compare picks only from one table page.

## P1-M6: Content House

Built:
- `lib/social-hub/house.ts`: Needs approval (soonest slot first, time left), Today, On deck, All content (vertical and status filters), Ideas (Has-content filter and column), Sources (reuse and mean metric), Types (mean per post by vertical, posts, cost per post), typical cost per post, per-post action plans with reasons, quota parsing.
- `lib/social-hub/queries/quota.ts` (SELECT only; OUT_OF_SCOPE #4).
- `lib/social-hub/action-route.ts`: the flag is checked first, then session, body and one existing function.
- Four action routes under `app/api/social-hub/actions/`, each with an injectable handler:
  - approve-carousel → `approveSchedule`;
  - approve-trial-reel → `schedulePostIdea(…, 'user')`;
  - hard-publish → carousel/explainer `queuePublish(…, 'force')`, stories `publishNow`;
  - hard-regenerate → explainers `requestRender`, stories `regenerate`.
  - Trial Reels Force and Carousel / Trial Reels reruns link out (D28).
- UI: `HouseScreen` (quota card, read-only banner, 7 tabs, carousel inline review of slides, checks and sources), `ActionBar` (disabled while flagged off; a confirm with the typical cost before Hard regenerate), `PostRow`, `TypesChart`.

Tests (`tests/social-hub-actions.test.ts`):
- Each real route answers 404 while its flag is off, before session, body or call.
- With the flag forced on, each calls its stubbed existing function with the right arguments.
- 400 for bad bodies, 401 without a session; the pipeline's own refusals and caps pass through.
- House selections and the quota.

Scope test: the browser fetch in the buttons is a narrow, tested exception (D29). Screens: `screens/M6/` (all 7 tabs plus filters, at 1440 and 390): no overflow, no console errors. After the first look: the per-button flag-off notes were made screen-reader-only (the banner says it once), and the quota time is readable.

M6 gate loop 1: scope PASS · tests 1,533 (2 baseline failures) · tsc baseline only · build OK.

M6 critique loop 1: 2 MUST-FIX, 6 NICE. All signatures were verified against the real functions; the flag posture is correct. Fixed:
- Hard regenerate ignored `requestRender`'s `{ok:false}`, and `requestRender` refuses rendered topics anyway. Explainers regenerate is now a link-out; Stories `regenerate` is the only wired rerun (D28b).
- The Hard publish confirm says per vertical what really happens.
- Carousels in review show a disabled Approve with the reason (needs a slot, P2-M4).
- Action routes accept JSON only (415 otherwise).
- The quota card says the publisher guard still applies.
- Failure-path tests for every route.

Loop 2: actions and scope tests 26/26.

## P1-M7: Hub schema (written, not applied) + final pass

Built:
- `db/social_hub_schema.sql`: schema `social_hub` with `account_insights_daily`, `account_demographics_daily`, `online_followers_daily`, `refreshes` (single running and single queued unique indexes). Additive, idempotent, `IF NOT EXISTS` everywhere; metric columns match META_API_CHECK.
- `scripts/apply_social_hub_schema.js` (refuses without `--apply`, D31). **Not run.**
- `lib/social-hub/queries/account.ts`: SELECT only; `to_regclass` existence check first.
- `lib/social-hub/account.ts`: pure Profile summary (summed daily reach and views, engaged, interactions, link taps, net follows, follower share, latest follower count, top-5 demographics, weekday × hour active times).
- `AccountSection` in the Profile tab; "No account data yet" when the tables are absent.

Tests (`tests/social-hub-account.test.ts`):
- Absent tables → no account data.
- The schema applies twice on PGlite and adds exactly the four `social_hub` tables (nothing removed, no ALTER/DROP/DML, every CREATE has IF NOT EXISTS, single-queued index enforced).
- Seeded rows → expected summary (range filter, blanks out of sums, latest demographics only, weekday cells).
- The apply script refuses without `--apply`.

Final screens: `screens/M7-final/`, 44 shots: every page and tab, a post per type, the drawer, signed-out real routes, at 1440 and 390. One overflow found and fixed: `.sh-sr` spans inside scroll wrappers escaped clipping because they're absolutely positioned; wrappers are now `position: relative`. Re-shot: all clean.

M7 gate (loop 1): `npm test` 1,539 (2 baseline failures) · tsc: 1 new error in my test (`ProcessEnv` typing) · build OK · scope: 3 files drifted outside the allowlist, all from Tommy's mid-run commit `d215adf` (D32).

Final critique (whole run): 4 MUST-FIX, 5 NICE; scope audit clean apart from the external drift. Fixed in loop 2:
- tsc error.
- Demographics use one timeframe (this_month first), with a test seeding three timeframes.
- The Profile message separates "tables not applied", "applied but empty" and "read failed".
- "Summed daily" labels.
- External drift recorded (D32).
- This entry, and BUILD_REPORT.md.
- Also: the stylesheet was split under 600 lines (§S7) into `app/social-hub.css` + `app/social/(hub)/hub-sections.css`.

**Final gate (loop 2):** `npm test` **1,539 tests, 1,537 pass, 2 fail (both baseline)** · tsc **5 errors, all baseline** · build **OK** · scope guard: **no file of the builder's outside the allowlist; 3 externally changed files (D32)**; package.json and lockfile unchanged.
