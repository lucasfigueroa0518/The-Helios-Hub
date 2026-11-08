# Field Notes: build contract (DRAFT, 2026-11-04)

Status: **APPROVED by Tommy 2026-11-04** ("Approve contract"). Open items below took the proposed defaults on that approval; any can be reopened. Nothing built, nothing committed. This is the one place every name, field, setting and format that more than one builder touches is fixed. Builders may not rename anything here; they ask first. Decisions come from `PLAN.md`; look comes from `DESIGN_SPEC.md`. Items marked **[OPEN]** are not decided.

Pattern to copy: `ai_events` (own schema file, own `lib/` folder, driver, adapter, health reporter). Layout verified against `lib/ai-events` on 2026-11-04: it holds `types, store, settings, config, pool, pool-week, schedule, clock, items, manual, run, worker, publish, post, caption, title, looks, live, hooks`; the apply script is `scripts/apply_ai_events_schema.js`; the page lives at top-level `app/ai-events`. Field Notes mirrors that file set under `lib/field-notes/`, adding only what its photo pool and annotations need.

## 1. Names
| Thing | Name |
|---|---|
| Content type id (DB value, `Vertical` union member) | `field_notes` |
| Display label everywhere (UI, logs, specs, chat) | `Field Notes` |
| Page / route | `/field-notes` (`app/field-notes`, top-level like `app/ai-events`, `app/stories`) |
| Schema file | `db/field_notes_schema.sql` + `scripts/apply_field_notes_schema.js` |
| Code folder | `lib/field-notes/` |
| Planning folder | `planning/Field Notes/` |
| Worker | runs on `helios-social-worker`; deploy `./scripts/gcp/deploy-social-worker.sh` after the schema is applied |

## 2. Settings (shipped values)
| Setting | Value |
|---|---|
| `auto_run` | **off** (decided) |
| `publishing_live` | **off** (global, unchanged) |
| `require_approval` | **on**: nothing posts without a human |
| Cadence target | 1-2 posts per week |
| Photo rest | a photo sits out the next **8 posts** after use, then may return; newest-first pick |
| Photo pool size | about 25 live photos |
| Slides per post | 3-5 content slides + 1 Follow slide (4-6 total); `CAROUSEL_MAX_ITEMS=10` unaffected |
| Cap on pending drafts | 3 (default on approval) |
| Idea expiry | unused tips expire after 30 days (default on approval) |

## 3. Records
### 3.1 Tip (the idea)
- `id`, `created_at`, `source_kind` (`docs | github | hn | rss | seed`), `source_url`, `source_label`
- `subject` (one tool, skill or repo; one subject per post, decided)
- `branch` (`open_source_skill | open_source_repo | paid_tool_feature`)
- `use_with_result` (what to do and what you get; skills and repos qualify only with a result)
- `levels` (which of the four audience levels each slide serves; layered default)
- `status` (`candidate | selected | drafted | approved | posted | expired | rejected`)
- `untrusted_content` holds scraped text; it is data and never goes into instructions.

### 3.2 Photo
- Stored in the existing photo bank `media_library.photos`; Field Notes adds a **pool membership**, not a second bank.
- Required new field: licence value for "ours". The CHECK is `open | government | company | unknown`; Default on approval: add `own` to the CHECK.
- Dedupe: exact (`sha256` UNIQUE, exists) and near-duplicate (`dhash`, stored today but unused; Field Notes starts using it). Metadata read at upload; location stripped from anything published.
- Format: iPhone HEIC must be converted on upload; `lib/image-preprocess.ts` rejects HEIC/HEIF today.
- `uploaded_by` (Tommy or Lucas), `last_used_post_seq`, `status` (`live | resting | retired`).

### 3.3 Post
- `id`, `tip_id`, `status`, `slides[]` (ordered), `photo_ids[]`, `created_at`, `approved_by`.
- Slide: `kind` (`hook | steps | why_catch | follow`), `photo_id`, `blocks[]`.
- Block: `text`, `role` (`headline | body | eyebrow | step | callout`), `placement` (region), `fill` (`white | off_black`), `darken` (0-cap), `marks[]` (underline, bracket, box, arrow, step marker).

## 4. Pipeline (from the approved flow)
1. **Find**: adapters for vendor docs, GitHub, HN, RSS yield `AdapterItem`s (read-only import like `lib/stories`). Vendor docs and help centers need a **new adapter**; the other three exist in `lib/reels/adapters/`.
2. **Score**: Jev question set, `defineQuestionSet`, scraped text only under `untrusted_content`. **Question wording requires Lucas's approval before it produces anything Tommy reviews.**
3. **Select**: pick one subject; skills and repos only with a use-and-result.
4. **Write**: Writer owns adding and creating text; Editor owns cutting. Never both.
5. **Place**: pick photo from the pool (rest rule), choose calm regions away from faces and the logo zone, apply the contrast rule.
6. **Render**: React slide components to 1080x1350, `fit-check` (text fit, bounds, contrast, face clearance), `storeSlideJpegs`.
7. **Review**: human approves on the type's page. Hard gates (safety only): fact check, slide repeat, over 50% field overrun. Everything else is soft guidance on the review screen.
8. **Publish**: existing publisher, disabled until `publishing_live`; quota gate and 30-minute feed spacing apply.

## 5. Contrast rule (code, not prompt)
As in `DESIGN_SPEC.md` section 3. Contract values: white if contrast against the region is at least 4.5:1 (3:1 for large type); else `#171717`; else darken until white passes; if the needed darkening exceeds the cap (starting value 45% black overlay equivalent, to be calibrated on real photos in Stage 7), move the block to a calmer region. Black means `#171717`, never `#000`.

## 6. Cost table
| Step | Model call | Prompt caching | Autonomous test use |
|---|---|---|---|
| Find / adapters | none | n/a | live fetch of public pages only, no model |
| Score | Jev | per `jevUsd` accounting | stubbed in tests |
| Write / Edit | Claude Messages | **required**: stable prefix first, breakpoint on prefix (`lib/anthropic-cache.ts`) | stubbed in tests |
| Render / place / contrast | none | n/a | runs offline on fixtures |
| Photo dedupe | none | n/a | offline |
Rule 1 holds: no live Claude or `web_search` in tests or agent runs; a human clicking the run button in the built app is the approval boundary; fixtures are 1-2 items. Rule 2 holds: only new uploads and new tips are processed; no sweep of any existing table.

## 7. Seed form and upload box
- **Upload box**: easy to reach inside the Field Notes page; multi-file; HEIC accepted and converted; shows duplicates found and why; Tommy and Lucas both can use it.
- **Seed form**: paste a link or text for a tip; follows `docs/superpowers/specs/2026-10-30-seeding-paths-by-content-type.md` (Field Notes path: source link first, no LLM enrichment on seed; **[OPEN]** confirm).

## 8. Schema touch list (known landmines)
- Add `field_notes` to the `Vertical` union in `lib/social-hub/types.ts`.
- Re-declare CHECK constraints that list verticals: `content_items_vertical_check`, `schedule_slot_check`, `publish_attempts_trigger_check`, `idea_adjustments`. They are repeated in several blocks of `db/social_hub_schema.sql`; every copy must change together.
- About 60 files hard-code a vertical; builders grep for an existing sibling (`ai_events`) and mirror each hit, or document why not.
- Apply the schema to the database **before** redeploying the worker.

## 9. Build split (Stage 6, after this contract is approved)
One owner per file set; none touches another's files.
| Owner | Files | Pass criteria |
|---|---|---|
| A. Schema and types | `db/field_notes_schema.sql`, apply script, `Vertical` union, constraint edits | Applies clean on an empty test DB; sibling types unaffected |
| B. Photo pool | upload route, HEIC convert, dedupe, rest rule | Duplicate upload is caught; HEIC works; rest rule unit-tested |
| C. Sources and scoring | docs adapter, wiring of existing adapters, Jev question set (wording pending Lucas) | Offline adapters return `AdapterItem`s on fixtures; no live calls |
| D. Writing | Writer and Editor prompts, caching | Cached prefix verified; stubbed output parses; no example pollution |
| E. Render | slide components, contrast, placement, `fit-check` | Fixtures pass contrast and face clearance; text never below minimum size |
| F. Page and settings | type page, upload box, seed form, settings, review screen | Renders; auto_run off; approval required |
Then Stage 7: cross-check every name here against code, fresh read-only review, tests and type check green. Stage 8: one live run only on Tommy's go-ahead and a cap he sets.

## 10. Still needed from Tommy or Lucas
- Lucas: approve the scoring question wording.
- Tommy: the **[OPEN]** items above and the **[TASTE]** items in `DESIGN_SPEC.md` (a mock sheet on real photos is the way to settle these).
