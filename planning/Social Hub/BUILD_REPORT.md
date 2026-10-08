# Social Hub Phase 1: build report

Run: 2026-10-08, autonomous, P1-M0 → P1-M7 (BUILD_PLAN §B). No Phase 2 work. Details per milestone are in `BUILD_LOG.md`, every judgment call is in `DECISIONS_LOG.md` (D1–D32), and every needed out-of-scope change is in `OUT_OF_SCOPE.md` (#1–#4).

## Where things stand

- **The hub exists at `/social`, read-only.** Every action flag is off (`lib/social-hub/flags.ts`), and every action route answers 404 before it reads the session or the body.
- **No live calls of any kind.** No Claude, Jev, Meta, Storage or web calls. The schema is written but not applied, and nothing was deployed. The only network reads were Meta's public documentation pages (P1-M0).
- **Final gate:**

| Check | Result |
|---|---|
| `npm test` | 1,539 tests, 1,537 pass. The 2 failures are the baseline ones (`explainers-render` workspace, missing Python venv). |
| `tsc` | Only the 5 baseline errors (`tests/seo-gsc-auth.test.ts`). |
| `npm run build` | OK. |
| Scope guard | Nothing the builder touched outside the §S3 allowlist. `package.json` and the lockfile are byte-identical. The guard shows **3 externally changed files** from your commit `d215adf` during the run (`scripts/gcp/deploy-social-worker.sh`, `scripts/gcp/remote-bootstrap-social.sh`, `scripts/reels_worker.ts`). They weren't reverted (D32). Re-baseline when you accept Phase 1: `node "planning/Social Hub/scope-guard.mjs" baseline --force`. |

- **Hub tests:** 75 across 7 files (`tests/social-hub-*.test.ts`).

## What was built

| Milestone | Delivered |
|---|---|
| M0 | `scope-baseline.json` + `scope-guard.mjs`; test/tsc/build baseline; `META_API_CHECK.md` (every §5 metric marked available / unavailable / unverified; spec §5 trimmed). |
| M1 | Route group `app/social/(hub)` with tabs (Calendar · Analytics · Content House); types, flags, ids, metrics, NY time; `tests/social-hub-scope.test.ts` (SQL writes and network reach followed through imports, flags, deps, render isolation). |
| M2 | SELECT-only reads and adapters for Trial Reels, Explainers (own DB handle, D19), Carousels and IG Stories (set = post, frames = pages; completion and frames 1–3 exits as in `setInsights`). Factor groups generalized from Trial Reels. **Equal to `factorGroups` on the same reels for all 13 factors.** Real SQL is tested on PGlite against the unmodified schema files. |
| M3 | Cost model (§8a): integer micro-dollars, largest-remainder splits, Unattributed per day, each item counted once, a reused post adds $0. Property tests: **Σ items + Unattributed = Σ ledger to the micro-dollar, Σ verticals = total**, plus end-to-end reconciliation on the real ledgers. |
| M4 | Calendar: month (chips, outlined / struck / failed marks, +N more, dots on a phone), day timeline. One post view everywhere: native `<dialog>` drawer, deep link `/social/post/[id]`, media, metrics, cost, chart, details, versions, sources. |
| M5 | Analytics: Profile · Content · Compare; range / vertical-first / metric / filters (shared filters in mixed views); per-format tiles; paged posts table → compare; side by side; group vs group (thin < 3). |
| M6 | Content House: Needs approval, Today, On deck, All content, Ideas (Has content), Sources (deduped), Types chart, 24 h quota card. Four flagged action routes calling existing functions only. |
| M7 | `db/social_hub_schema.sql` (4 tables, additive, idempotent) and `scripts/apply_social_hub_schema.js` (refuses without `--apply`), **not applied**. The Profile tab reads them when present and otherwise says "No account data yet". |

**Screens:** `planning/Social Hub/screens/<milestone>/`, 108 PNGs at 1440 and 390 px. The final set is `screens/M7-final/` (44 shots, no horizontal scroll on a phone, no console errors).

To look at the hub with fixture data locally: run `npx next dev -p 3123` (not `npm run dev`, which starts the worker), then open `/social/preview`. That route returns 404 in production builds.

## Action wiring (all flags off)

| Button | Flag | Calls (existing function) |
|---|---|---|
| Approve carousel slot | `approveCarousel` | `approveSchedule(query, scheduleId)` |
| Approve Trial Reel slot | `approveTrialReel` | `schedulePostIdea(postIdeaId, 'user', videoJobId)` |
| Hard publish | `hardPublish` | Carousels: `queuePublish(q, postId, 'force')`. Explainers: `queuePublish(db, jobId, 'force')`. Stories: `publishNow(db, setId)`. Trial Reels: link to `/reels` (D28). |
| Hard regenerate | `hardRegenerate` | Stories: `regenerate(db, setId, email)`. Explainers, Carousels and Trial Reels: link out (D28, D28b). |
| Refresh on visit | `refreshOnVisit` | No route. It needs the Phase 2 collector. |

## Known issues (left from critique loops)

1. **No sidebar item.** The `nav.ts` exception alone breaks `HubSidebar.tsx`. The three-line patch is in OUT_OF_SCOPE #2. Until then, type `/social`.
2. **Carousels still can't post.** Approve is flagged off, and a carousel in review has no slot to approve (P2-M4). Hard publish doesn't mark the slot approved (D28b).
3. **Carousel media is a slide outline**, not the rendered JPEGs (OUT_OF_SCOPE #3).
4. **Explainers:** Hard publish still needs an approved verdict, so SH-17 isn't met there yet. Hard regenerate is a link-out because `requestRender` refuses topics that already rendered.
5. **Quota "left" is usually "Not reported"**, because publishers log it only when they refuse (OUT_OF_SCOPE #4). The 24 h count from pipeline rows is always shown.
6. **The §9a "Retired" idea state is never derived** (no retirement flag is stored). "Knowledge lane" is shown as eligibility, not the actual pick (D13). Voice id isn't a factor (D16).
7. **The Stories regenerate confirm** shows the typical cost but not the remaining daily cap.
8. **Profile "most active times"** uses NY weekdays with Meta's hour, so a cell can be a day off near midnight.
9. **Smaller items:**
   - A missing post id shows the empty card with status 200.
   - Compare picks come from one table page at a time.
   - The table is sorted only through the metric picker.
   - Set-less Story and idea-cycle costs are bucketed by spend day (D23 notes).
   - Runs still in flight aren't in the cost model.
10. **The preview mirror imports `tests/fixtures`** (blocked in production by `notFound()`, but bundled).

## Out of scope (summary of `OUT_OF_SCOPE.md`)

| # | What | Phase 2 |
|---|---|---|
| 1 | Add `/social` to `middleware.ts` (pages already check the session) | P2-M3 |
| 2 | Sidebar item (patch for `nav.ts` + `HubSidebar.tsx`) | any supervised session |
| 3 | Signed-URL route for carousel slide JPEGs | P2-M3 |
| 4 | Log the 24 h quota on every publish | P2-M1 |

## Tommy's first-use checklist

1. **Look first.** Open `/social` signed in, or run `npx next dev -p 3123` and open `/social/preview`. Check the calendar, a post of each type, Analytics, and Content House against what you expect.
2. **Sidebar** (optional, 2 minutes): apply OUT_OF_SCOPE #2's patch, and #1 (middleware) at the same time.
3. **Apply the schema** when you're ready for account data: `node scripts/apply_social_hub_schema.js --apply`. It only creates `social_hub.*`. The Profile tab then says "applied but empty" until the P2-M1 collector writes rows.
4. **Check cost reconciliation on real data.** On Analytics → Content, the per-format "Cost to make" plus the posts table should match each pipeline's own cost page for the same range. Any "Data notes" box lists rows the hub couldn't reconcile (denormalized totals vs ledger rows). Note: the hub counts development-mode spend too (D23).
5. **Turn on one action flag at a time** in `lib/social-hub/flags.ts` (constants), in this order:
   1. `approveTrialReel`: approve one slot and confirm `/reels` shows it approved.
   2. `approveCarousel`: needs a scheduled carousel slot.
   3. `hardPublish`: a Story set first (lowest stakes), then a carousel.
   4. `hardRegenerate`: Stories only.

   For each: deploy, click once on a real item, check the pipeline's own page and the worker log, then move to the next.
6. **Remember the worker sync rule.** None of this touched workers. Phase 2 items that do (collector, cadence, reuse) need the social-worker redeploy (CLAUDE.md).
7. **Re-baseline the scope guard** once you accept Phase 1 (see above).
