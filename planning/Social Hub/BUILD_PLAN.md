# Social Hub — Build Plan

Spec: `PRODUCT_SPEC.md` (decisions SH-xx; repo state §0; cost model §8a). Final revision 2026-10-08.

The build has two phases:

- **Phase 1 — Autonomous (this run).** UI/UX, read-only data wiring, and one new hub-owned schema. Runs start to finish without Tommy (§A). Its limits are set by **§S, Scope confinement**, which overrides everything else in this file.
- **Phase 2 — Supervised (not this run).** Anything that changes how content is generated, scheduled, published or collected. Tommy starts it separately. Phase 1 must not do any Phase 2 work, even partly.

---

## S. Scope confinement (overrides everything below)

The autonomous builder is a **UI/UX and wiring** agent. It builds screens over data that already exists. It does not change how any pipeline behaves.

### S1. What it may do
1. **Build UI**: new pages, components and styles under the allowed paths (S3), using existing tokens in `app/globals.css` / `app/components.css` and existing patterns (Trial Reels analytics, `components/hub-shell`).
2. **Read data**: `SELECT`-only queries against the `reels`, `explainers`, `social`, `stories` schemas, inside `lib/social-hub/`.
3. **Pure logic**: adapters, factor grouping, filters, compare, cost attribution (§8a) — pure functions over rows, fully unit-tested.
4. **One new schema**: `db/social_hub_schema.sql` (schema `social_hub`) plus `scripts/apply_social_hub_schema.js` modeled on `scripts/apply_social_schema.js`. Additive and idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Tables: `account_insights_daily`, `account_demographics_daily`, `online_followers_daily`, `refreshes`. **No other schema is altered.**
5. **Thin action wiring, flagged off**: new API routes under `app/api/social-hub/` that call **existing exported functions only** (e.g. `approveSchedule()` in `lib/social/overnight/schedule.ts`). Every action is behind a feature flag that **defaults off** (S5). If no existing function does the action, the button links to the content type's own page instead. The builder never writes a new publish, schedule or run-insert path.

### S2. What it must never do
- Edit any file outside the allowed paths (S3), except the named one-line exceptions there.
- Write (`INSERT`/`UPDATE`/`DELETE`/DDL) to any schema other than `social_hub`, from any code it writes.
- Change pipeline behavior: generation, scoring, selection, scheduling, windows, cadence, caps, publishing, insights polling, music, approval rules, worker loops, systemd units, deploy scripts.
- Touch settings rows or env vars; add, remove or upgrade dependencies (`package.json` / lockfile unchanged).
- Refactor, rename, reformat or "clean up" existing code, even when it looks wrong. Log it instead (S6).
- Call any live service (Claude, Jev, Meta Graph, `web_search`, HeyGen, Supabase Storage writes). Tests use fixtures and stubs.
- Run git, delete files, run workers, apply schema to a live database, or redeploy anything.

### S3. Allowed paths (the only places it may create or modify files)
| Path | Purpose |
|---|---|
| `app/social/(hub)/**` and any new `app/social/<segment>/**` other than `render` | Hub pages (SH-57) |
| `app/api/social-hub/**` | Read endpoints and flagged-off action wiring (S1.5) |
| `lib/social-hub/**` | Types, adapters, read queries, pure logic |
| `components/social-hub/**` | Hub components |
| `app/social-hub.css` (or a CSS file inside the hub route) | Hub styles, token-based only |
| `db/social_hub_schema.sql`, `scripts/apply_social_hub_schema.js` | The one new schema (not applied) |
| `tests/social-hub-*.test.ts`, `tests/fixtures/social-hub/**` | Tests and fixtures |
| `planning/Social Hub/**` | Logs, screenshots, report |

**Named exceptions (one edit each, nothing else in the file):** add the Social Hub item to `HUB_NAV` in `components/hub-shell/nav.ts` (and its `id` union type); if the sidebar needs it, one import line in the shared layout.

### S4. Scope guard (enforced at every gate)
At the start of the run, before any change, the builder writes `planning/Social Hub/scope-baseline.json`: a SHA-256 of every file in the repo outside `node_modules`, `.next`, `.git` and the allowed paths. At every gate it recomputes and compares.
- **Any changed, added or removed file outside the allowed paths fails the gate.** The builder must revert its own change (restore the content it read before editing) and record the incident. It may not widen the allowlist.
- A test `tests/social-hub-scope.test.ts` scans `lib/social-hub/**` and `app/api/social-hub/**` and fails on any SQL write keyword (`INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE`, `TRUNCATE`) that targets a schema other than `social_hub`, and on any import of a module that performs network calls (Graph clients, Anthropic client, Jev client) outside flagged action routes.
- A second check confirms `package.json` and the lockfile hashes are unchanged.

### S5. Feature flags
One flag file `lib/social-hub/flags.ts`, constants only (no env, no DB). All **action** flags default `false`: `approveCarousel`, `approveTrialReel`, `hardPublish`, `hardRegenerate`, `refreshOnVisit`. Read-only views default `true`. With all action flags off, the hub is read-only and cannot change anything anywhere; tests assert this.

### S6. When the right fix is outside scope
The builder does **not** work around it. It writes an entry in `planning/Social Hub/OUT_OF_SCOPE.md` (what, why it's needed, which file, suggested change, which Phase 2 milestone) and builds the UI to degrade gracefully (empty state, "coming in Phase 2" note, or link to the type's own page). Then it continues.

### S7. Size sanity
If one milestone's diff exceeds ~2,500 changed lines, or a single new file exceeds ~600 lines, the builder stops adding scope to that milestone, splits files, and logs why. Prefer small composable components over large ones.

---

## A. Autonomy (Phase 1)

**Phase 1 runs from P1-M0 to P1-M7 without Tommy and never comes back to the chat to ask.** It ends with `BUILD_REPORT.md`.

### A1. Gates are self-verification
Each milestone ends with this loop, run by the builder on itself:
1. **Scope guard** (S4) passes.
2. `npm test` green (existing + new; record any pre-existing failures as baseline and add none), `npx tsc --noEmit` clean, `npm run build` succeeds.
3. **Look at it:** Playwright (installed; Chromium preinstalled) renders each new page with fixture data at **1440 px and 390 px**; screenshots to `planning/Social Hub/screens/<milestone>/`. Check: no horizontal scroll on phone, readable text, empty / loading / error states, every spec click path, the same post opens identically everywhere, action buttons hidden or disabled while their flag is off.
4. **Critique it:** a fresh subagent with no build context reviews the milestone against the spec sections, §S and `CLAUDE.md`, and lists defects, scope violations, spec gaps and simpler options. Fix real findings; repeat 1–4. **Max 3 loops**; leftovers go to `BUILD_REPORT.md` as known issues.
5. **Log it** in `planning/Social Hub/BUILD_LOG.md`: built items, test counts, screenshots, findings, fixes, scope-guard result.

### A2. Deciding without asking
Order: spec decisions (SH-xx) and §0 → `docs/social-overnight.md`, `planning/Stories/BUILD_PLAN.md`, `planning/Trial Reels/*`, `CLAUDE.md` → nearest existing pattern (Trial Reels first) → the smallest reversible choice **inside §S**. Log each call in `DECISIONS_LOG.md` (question, choice, why, how to reverse). If every option would break §S, it's S6, not a decision.

### A3. External failures
| Failure | Fallback |
|---|---|
| Meta docs unreachable (P1-M0) | Mark metrics "unverified"; the UI shows only metrics present in fixture/collected data and hides empty ones. |
| Database unreachable | Not needed: Phase 1 builds against fixtures. Read queries are tested with SQL fixtures / local-db helpers. |
| A pre-existing test fails | Record as baseline; do not fix unrelated code (S2). |
| Install blocked | Use only installed packages (S2 forbids new ones anyway). |
| A milestone can't be finished within §S | Ship what works behind its flag, log the rest (S6), continue. |

---

## B. Phase 1 milestones (autonomous)

| M | Scope (all within §S) | Gate (A1 plus) |
|---|---|---|
| **P1-M0** | **Baseline + Meta check.** Write `scope-baseline.json`; run the full test suite and record the baseline. Research Meta's Instagram Graph API docs and write `META_API_CHECK.md` (account and media metrics, breakdowns); trim spec §5 to it. | Baseline files exist; every §5 metric marked available / unavailable / unverified. |
| **P1-M1** | **Foundations.** Sidebar item (named exception), hub route group and shell with tabs (Calendar · Analytics · Content House), `lib/social-hub/` types, `flags.ts`, scope test. | Builds; no route under `render`; scope test green; all action flags off. |
| **P1-M2** | **Read model.** SELECT-only adapters for Trial Reels, Explainers, Carousels, Stories (set = post, frames = pages); factor groups copied from `lib/reels/analytics/performance.ts` (copied, not edited); approval state; Stories completion and frame 1–3 exits. | Fixture tests per adapter; group-vs-group equals Trial Reels output on the same reels; thin < 3. |
| **P1-M3** | **Cost model (§8a)** as pure functions over ledger rows read SELECT-only. | Reconciliation property tests: `Σ items + Unattributed = Σ ledger` to the micro-dollar, `Σ verticals = total`, nothing counted twice, reused post adds $0. |
| **P1-M4** | **Calendar + single-post view** (month, day, mobile; post drawer/page with media preview from existing signed-URL helpers read-only, metadata, analytics, cost, metrics-over-time, version history). | Screenshots of month, day and one post per type at both widths. |
| **P1-M5** | **Analytics** (Profile from existing data + `social_hub` tables when present, Content per format, posts table, Compare side-by-side and group-vs-group, ranges, vertical-first filters, selectable metric, cost columns). | Every filter/compare path tested; mixed view offers shared filters only. |
| **P1-M6** | **Content House** (Needs approval, Today, On deck, All content, Ideas with Has-content, Sources deduped, Types chart, 24 h quota display read from the latest publish logs if present). Approve / Hard publish / Hard regenerate buttons wired **only** to existing exported functions through `app/api/social-hub/`, all behind off flags; otherwise link out. | Tests prove each action route is unreachable while its flag is off; with the flag forced on in a test, it calls the existing function (stubbed) with the right arguments. |
| **P1-M7** | **Hub schema (written, not applied).** `db/social_hub_schema.sql` + apply script; adapters read these tables when they exist and show "no account data yet" when they don't. Final full A1 pass across the hub; write `BUILD_REPORT.md` (built items, tests, screenshots, decisions, known issues, `OUT_OF_SCOPE.md` summary, and Tommy's first-use checklist: apply schema, flip one action flag at a time, check cost reconciliation on real data). | Scope guard clean against the start baseline for the whole run. |

## C. Phase 2 milestones (supervised; started by Tommy, not this run)

| M | Scope |
|---|---|
| **P2-M1** | Account insights collector in `lib/instagram/`, worker wiring, overnight hub sweep, refresh-on-visit (SH-23); follows / profile visits for feed posts per `META_API_CHECK.md`. Worker redeploy. |
| **P2-M2** | Cadence and windows (SH-46 – SH-49): Explainers two windows / 2 a day / render cap 2; Carousels two windows / top two posts; shared ≥ 30-min feed spacing including Trial Reels (SH-59 principles intact); update `docs/social-overnight.md`. Worker redeploy. |
| **P2-M3** | Turn on action flags one at a time after checking each against real data (approve, Hard publish, Hard regenerate); add any missing action functions in the owning system. |
| **P2-M4** | Content survives with its idea (SH-50 – SH-54, SH-60): carousel stories with a finished post are skipped by the pipeline and the stored post scheduled; cancelled-unapproved posts return to Content ready. Trial Reels unchanged (SH-59). Worker redeploy. |
| **P2-M5** | Stories assimilation (S-30) with Lucas. |
| **—** | Every item in `OUT_OF_SCOPE.md` from Phase 1. |

Out of v1: forecast/capacity, unified metadata schema, saved views, CSV export, roles, drag-reschedule, notes/tags, statistical tests, AI insights, music on carousels/Stories.
