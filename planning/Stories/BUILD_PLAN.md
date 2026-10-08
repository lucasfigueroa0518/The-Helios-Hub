# Instagram Stories: build plan

A new Helios Hub product. A worker builds short Instagram Story sets from content the Hub already produces (Trial Reels ideas and Tommy's carousel stories), renders them as 9:16 frames in premium Helios templates, and publishes them on a schedule. A new **Stories** tab shows every set for review. Three series in version one: **Helios Morning Download**, **Guess the Number**, and **Free vs. Paid**.

This file is the spec for the implementing agent. It follows the conventions of `planning/Trial Reels/BUILD_PLAN.md` and `planning/Explainer Reels/BUILD_PLAN.md`: Lucas decides, no silent defaults, every decision logged. Read `CLAUDE.md` first. Its hard rules apply here.

## Status

| Field | Value |
|---|---|
| Active build | Instagram Stories, version one |
| Stage | M1 accepted 2026-10-08 (Lucas: "Move forward to M2"). M2 in progress. |
| Branch | `stories` at `54e794d` (= `main` on 2026-10-07: Trial Reels, the carousel pipeline, and Explainer Reels). No upstream, not pushed; a push does not update `main`. |
| Next action | M2: schema, repository, render review, storage, publisher and insights against stubs. |
| Last updated | 2026-10-07 (M1 report, decisions S-34 to S-43) |

## 0. Rules that override everything here

From `CLAUDE.md`, restated because this build calls models every day.

1. **No live Claude API, `web_search`, or Jev calls in automated tests or agent development runs.** Tests stub every model and vendor call. The autonomous spend ceiling is about $1.50 without Lucas's in-the-moment go-ahead. **Lucas's click on Generate (or his switching a series to automatic) is the approval boundary for live runs.** Agents report telemetry; Lucas judges quality.
2. **Prompt caching** on every `messages.create`: stable prefix first (tools → system → messages), the breakpoint on the last stable block, never on the per-day payload. Helpers in `lib/anthropic-cache.ts`. Clients come from `newAnthropic()` in `lib/anthropic-client.ts` (the workspace header, `a4a5186`).
3. **Worker sync.** Not while Stories is in isolation: its worker runs on Lucas's Mac and nothing is deployed to the VM (S-35). Once Stories has a VM unit, any worker code or env change is deployed in the same session, only from `main` (Section 6).
4. **Milestones in order**, each with its Accept met and a report to Lucas.
5. **Prompts and Jev question sets need Lucas's approval** before they produce anything he reviews. Draft, show, revise, log in the registry (Section 8.2).
6. **Stories never edits `lib/reels/` or `lib/social/`.** It imports from them read-only. Tommy owns `lib/social/` and signs off on it alone. Stories writes to Tommy's tables only where his storage spec allows it: a row in `social.used_photos` for a photo Stories actually published (`docs/superpowers/specs/2026-10-08-social-storage.md` §3).
7. **Rule 2 of `CLAUDE.md` does not change.** Stories reads content the pipelines already made. It never enriches, backfills, or sweeps any table.

## 1. Decisions

Interview with Lucas, 2026-10-07. "Default" rows were stated to Lucas at the end of the interview and not objected to; he can overturn any of them.

| ID | Decision | Source |
|---|---|---|
| S-01 | Three series. **Helios Morning Download** once a day. **Guess the Number** every Monday and Thursday. **Free vs. Paid** every Tuesday and Saturday. | Lucas |
| S-02 | Carousel data comes from Tommy's `social` schema through `lib/social/store/read.ts` and `social.runs.record` (the full `run.json`, including `selection.scored`, `selection.shortlist` and `selection.winners`). Built against the schema with fixtures; goes live when Tommy's daily runner writes rows. Verified 2026-10-07 at `54e794d`: the carousel pipeline is on `main`, but its Postgres storage (`db/social_schema.sql`, `lib/social/store/`, the daily runner's writes; commits `0489fea` and neighbors) is still only on `feature/helios-social-rebuild`. The tables exist in Supabase and are empty. Until it merges, read the API with `git show` and build against fixtures. Never merge Tommy's branch from here. | Lucas |
| S-03 | Morning Download ranks every candidate from both systems with **one new "major news" Jev node**. Native scores only decide what enters the pool. | Lucas |
| S-04 | Morning Download shows **2 to 5 stories**. Every story that clears the major-news bar is shown, up to 5. Fewer than 2 clear: the top 2 are shown anyway. | Lucas |
| S-05 | Lucas reviews the first one or two sets of each series. Then a **per-series switch** lets that series schedule and publish on its own. | Lucas |
| S-06 | Guess the Number has **no prompt and no sticker**. Two slides: question, then answer. Fully API-publishable. | Lucas |
| S-07 | Free vs. Paid is **two slides**: slide 1 poses the paid tool and teases the free alternative; slide 2 serves the free alternative and how to get it. | Lucas |
| S-08 | Free tools are **mostly general-public** (app store, website, browser extension), with an occasional developer tool labeled as one. | Lucas |
| S-09 | The Morning Download closer points to **heliosgroup.ai**. It is the first pitch on the account: a deliberate exception to D-211 (no pitch), scoped to Stories. | Lucas |
| S-10 | Guess the Number pulls from carousel statistics **more than** from Trial Reels' The Number, because carousels skew to headline stories that more people care about. | Lucas |
| S-11 | Guess the Number has its own **Jev scoring node** that qualifies: (1) the general public understands the question and its context; (2) the average person would want to guess and could reasonably guess; (3) the category is one people most want to know about. | Lucas |
| S-12 | Guess the Number images: a statistic from a carousel post reuses that post's image when it has a relevant one; otherwise **Tommy's photo finder** finds one. Slide 1 shows the image with the question. Slide 2 shows the answer, with an image only when a good-enough one exists; a typographic slide 2 is acceptable. | Lucas |
| S-13 | Guess the Number has **several visual templates**, not one. | Lucas |
| S-14 | Morning Download opener: **Helios logo at the top, centered; "Morning Download" below it; "Today's major AI news"; a cue to the next frame.** A photo related to one of the stories, never a photo any story frame uses. It is found by probing each story for a **second photo** with the photo finder's logic (all its sources plus the photo bank); a candidate is used only when it is good quality and very relevant, otherwise not. | Lucas |
| S-15 | Morning Download story frame: a **self-contained headline** (who, what, when, why) in one or two full sentences that delivers the main point, plus a source tag: "via", "reported by", or "from" (article, repo, or social post). No more detail. | Lucas |
| S-16 | Morning Download closer: plugs Helios. Follow us for AI updates, learning, and news; Helios is an AI consultancy. | Lucas |
| S-17 | All slide copy goes through the **humanizer**: as casual as it can be within professionalism. Loose, not weird, not unprofessional. | Lucas |
| S-18 | Templates follow the **Helios design system** as the foundation, and are **premium**: elevated, with premium finishes and accents in Helios colors. Backdrops range across **black, white, orange, and green**. | Lucas |
| S-19 | Separate product: `lib/stories/`, schema `stories`, branch `stories`. Imports `lib/reels` and `lib/social` read-only. | Default |
| S-20 | Posting windows (America/New_York): Morning Download 8:45–10:00 AM; Guess the Number and Free vs. Paid 6:00–9:00 PM. Same minute-picking as `lib/reels/publish/slots.ts`. | Default |
| S-21 | Copy is written by the latest Sonnet on the models list (as D-222), with prompt caching. The humanizer text is frozen into a generated file, the way `lib/reels/copy/source-text.generated.ts` freezes it for reels. | Default |
| S-22 | Every Morning Download headline passes a Jev check that its source supports it. Every Free vs. Paid set verifies the paid tool's current price and the free tool's install path with a live web lookup. | Default |
| S-23 | Frames keep clear of Instagram's own on-screen controls, and every template has room for a photo credit line (CC BY needs one). | Default |
| S-24 | Stories shares Tommy's 7-day no-repeat photo rule: it reads `social.used_photos` before picking and records the photos it publishes. | Default |
| S-25 | Lucas approves design mock-ups before any template code is written. | Default |
| S-26 | Numbers for shortlisted carousel stories without a brief come from a Stories-owned extraction step. Guess the Number's pool covers the last 7 days, not just yesterday. | Default |
| S-27 | Build order: Morning Download first (it runs on Trial Reels data alone before Tommy's tables fill), then Guess the Number, then Free vs. Paid. | Default |
| S-28 | **Brand: Helios Group, an AI consultancy, heliosgroup.ai, slogan "We build your unfair advantage."** All Stories wording uses it. The design system at `/Users/lucasfigueroa/HELIOS/Helios Design System/` was updated to match on 2026-10-07 (`SKILL.md`, `README.md`, deck and website-kit name and URL). Supersedes the "Helios Marketing / We Build AI Marketing Systems" lines. | Lucas |
| S-29 | **Morning Download story frames may use the same photo the carousel post used** for that story. The opener's photo still never repeats a photo on any story frame in the set (S-14). | Lucas |
| S-30 | **Stories works in isolation first, then assimilates into Tommy's Social Hub.** Tommy is bringing the carousel and explainer systems under one roof, organized, published, and scheduled. Carousel scheduling and data freshness are his, not this build's concern. Assimilation is a later merge plan (Section 12), possibly run from Tommy's machine once Stories is validated and its outputs approved. | Lucas |
| S-31 | **Anything that touches the explainer system yields to Tommy's changes** at merge time. Stories does not commit explainer-related changes (including the deploy script's explainer-folder exclusion) and never edits `explainers/` or `lib/explainers/`. | Lucas |
| S-32 | **Rendering: fill React templates with each set's data**, the way the carousel fills `lib/social/render/SlideTemplate.tsx`, and render them to images the same way it does. | Lucas |
| S-33 | **One Haiku 5.5 review per set** (`claude-haiku-5-5`): the set's frames are composited into one contact sheet, and the review checks they are OK (text legible and inside the safe zones, nothing clipped, photo fits the frame and the copy, logo intact, frames consistent). Its fixes change template settings only (backdrop, layout variant, photo framing), never the words. A frame it still fails after one re-render goes to Lucas flagged. Modeled on Tommy's render review (photo spec §5b). | Lucas |

**Verified facts behind these decisions (2026-10-07):**

- **The carousel system has no blockbuster bump.** It ranks by how many of three Jev checks pass (`why_it_matters`, `sourcing`, `photographable_subject`), then outlet count, then probability sum, then recency (`lib/social/ingest/select/rank.ts`, `story-scoring@2`). Shortlist ≤ 10, two winners.
- **Trial Reels' blockbuster bump** is three Nouls in `scoring-pass1-v4`: `frontierDrop`, `blueChipCompany`, `blueChipPerson`, over the 15 companies and 15 people in `lib/reels/jev/questions/scoring-shared.ts` (`BLUE_CHIP_COMPANIES`, `BLUE_CHIP_PEOPLE`). Any at or above 0.8 (`BLOCKBUSTER_BAR`) adds +0.10, or +0.20 when value is at least 0.70 (D-077, D-217, D-254). Stored in `reels.idea_scores.blockbuster`.
- **The Graph API cannot add stickers to Stories** ("Publishing stickers (i.e., link, poll, location) is not supported"). All three series are designed without stickers. Image stories are JPEG, 8 MB max, sRGB, 9:16 recommended.
- **The API key is organization-level.** `ANTHROPIC_WORKSPACE_ID` is set locally and on the VM; every client must send the header (`a4a5186`).

## 2. What exists (reuse, don't rebuild)

| Need | Reuse | How |
|---|---|---|
| Instagram publishing | `lib/reels/music/meta.ts` (`createLiveMetaClient`, containers, `media_publish`, `META_USER_ACCESS_TOKEN`, `META_IG_BUSINESS_ACCOUNT_ID`) | Container flow is the same with `media_type=STORIES` and `image_url`. Stories gets its own small client in `lib/stories/publish/` modeled on it, because `meta.ts` hard-codes `REELS` and trial params. |
| Insights | `lib/reels/media-insights/client.ts` (`createInsightsClient`, metric fallback when a name is rejected) | Same call shape on the story media id with story metrics (Section 7). |
| Signed media URLs for Meta | `lib/reels/visual/storage.ts` (`signFrameObject`), `lib/reels/music/publish.ts` | Copy the pattern into `lib/stories/storage.ts` with a `stories` bucket. Do not import reels storage. |
| Posting windows | `lib/reels/publish/slots.ts` | Same minute-picking, Stories' own windows (S-20). |
| Worker loop | `scripts/reels_worker.ts` (15s poll, `requested` → `running` → `ok`/`failed`, SIGTERM, `--once`) | Mirror for `scripts/stories_worker.ts`. |
| Jev | `lib/reels/jev/{client,runner,question-set}.ts`, `RecordingJevRunner` | Stories has its own runner writing `stories.jev_logs` and `stories.cost_events`, so Stories spend never counts toward the Reels watch (the Explainers precedent). |
| Reels candidates | `reels.score_slates`, `reels.idea_scores` (`net`, `blockbuster`, `chosen_bucket`, `selected`), `reels.post_ideas`, `reels.post_idea_members`, `reels.sources` (`headline`, `source_name`, `canonical_url`, `body`) | Read-only SQL. |
| Carousel candidates | `lib/social/store/read.ts` (`listSocialPosts`, `getSocialPost`, `recentUsedPhotos`), `social.runs.record.selection`, `social.posts.brief` (`numbers` typed money/count/percent/duration/date with source IDs; `article_photos`; `subjects`), `social.posts.render` (placed photos) | Read-only. Not on `main` yet: it arrives when Tommy merges `feature/helios-social-rebuild`. Until then, fixtures shaped like his schema. |
| Photo finder | `lib/social/photos/find.ts` (`searchVisual`, `newSearchContext`, `ROUTES`, `PhotoDeps`), `pick.ts`, `second-photo.ts`, `sources/stock.ts` (StockSnap lane, Commons, Openverse), `vision.ts`, `jev/questions/photo-fit.v1.ts` | Called, never edited. `searchVisual` needs a `Brief` and read pages: Stories builds a minimal brief (subjects typed person/organization, story date) per story (Section 5.4). |
| Photo bank and 7-day rule | `social.used_photos` | Read before picking; insert only photos Stories published (S-24). |
| Humanizer | `.cursor/skills/humanizer/SKILL.md`, frozen by `npm run reels:sync-copy-text` into `lib/reels/copy/source-text.generated.ts` | Stories gets its own generated file and sync script (the worker deploy excludes `.cursor/`). |
| Design system | `/Users/lucasfigueroa/HELIOS/Helios Design System/` (`SKILL.md`, `README.md`, `colors_and_type.css`, `assets/Helios-logo.png`, `assets/Helios-mark.png`, `fonts/PragmaticaExtended-Bold.otf`); Roboto woff2 (`explainers/design/fonts/`, on `main`). `explainers/design/helios-design-system/` is an older copy that still says Helios Marketing; it belongs to the explainer system (S-31), so read fonts from it but take brand wording only from the updated folder | Copy what templates need into `lib/stories/render/assets/` (fonts as files: the renderer is a clean headless browser). |
| Templates → image | The carousel's pattern: React `SlideTemplate.tsx` + CSS filled from data, rendered in headless Chromium by `lib/social/render/fit-check.ts` (`playwright` 1.63.0), plus `sharp` 0.35.4 | Stories has its own React templates in `lib/stories/render/` and its own renderer modeled on `fit-check.ts` (copied, not imported, so Tommy can change his). `sharp` writes the sRGB JPEG under 8 MB. |
| Render review | Tommy's render review (Haiku on a contact sheet, fixed questions, settings-only fixes) | Same idea on Haiku 5.5 (S-33). |
| Auth and nav | `getSession()` (`lib/session.ts`), `middleware.ts` handling of `/reels`, `components/hub-shell/nav.ts` (`HUB_NAV`), `app/reels/layout.tsx`, `reels-nav.tsx`, `ui.tsx` | Mirror for `/stories` and `/api/stories`. |
| Free tool sources | `reels.list_catalog` (2,831 entries from awesome-lists), A1 GitHub Trending sources, Ball Knowledge ideas (`chosen_bucket = 'ball_knowledge'`, copy names what a tool replaces) | Read-only pool for Free vs. Paid (Section 5.3). |

## 3. Open items (before or during the named milestone)

| # | Item | Who | Needed by |
|---|---|---|---|
| O-1 | ~~Closer wording vs. the brand.~~ **Resolved by S-28.** Lucas still approves the exact closer line on the M1 mock-up. | Lucas | M1 |
| O-2 | ~~Do story frames carry a photo?~~ **Resolved by S-29:** yes, and the carousel's photo for that story is allowed. | — | — |
| O-3 | **Heads-up to Tommy.** Stories reads `social.*`, calls his photo finder as-is (his changes flow into Stories), and inserts rows into `social.used_photos` for photos it publishes. | Lucas tells Tommy | M3 |
| O-4 | ~~Carousel runs only when Tommy starts it.~~ **Not this build's concern (S-30).** Until the merge, Morning Download simply uses whatever carousel runs exist, and Trial Reels alone on days with none. | — | — |
| O-5 | **Where the renderer's browser runs.** React templates become images in headless Chromium, as the carousel's do (S-32). `npm ci` installs the `playwright` package but not Chromium or its system libraries. In isolation, Stories renders on Lucas's Mac: dependencies are installed, and Playwright 1.63's own headless Chromium (build 1243) was installed into `~/Library/Caches/ms-playwright` during M1 (the cache only had 1200 and 1217; S-42); on the VM it needs `npx playwright install --with-deps chromium` and a memory check beside the other units. At the merge it renders wherever Tommy's hub renders. | Lucas | M8 |
| O-6 | **Story insights window.** Confirm in M2 which story metrics the Graph API returns and for how long after posting; the poller is built to capture before expiry. | Agent | M2 |
| O-7 | **Brand bends** to accept on the mock-ups: flooded orange and green backdrops (the system says orange for action, green for metadata, white canvas); a black backdrop (the system says off-black `#171717` for text, never `#000`). Trial Reels already ships flooded grades (D-219, D-221). | Lucas | M1 |
| O-8 | **Unconfirmed brand details.** The design system still lists `@heliosmarketingg` and `lucas@heliosmarketing.org`. The closer doesn't need them, but say if they changed. | Lucas | M1 |
| O-9 | **The installed `helios-design-system` skill** in the Claude app is a separate copy managed through claude.ai. It still says Helios Marketing until the updated folder is re-uploaded. | Lucas | Any time |
| O-10 | **Who sets Guess the Number's difficulty** (S-49). Recommendation: code maps it from the `gtn-candidate@1` answers (`guessable` and `surprise` probabilities → Low / Medium / High, thresholds calibrated on the first runs) so it's measured, not a model's opinion; the writing call only writes the topic. | Lucas | M6 |
| O-11 | ~~Which style ships~~ **Resolved by S-54.** **Which style ships** for Guess the Number and Free vs. Paid: polished, homemade, or both in rotation (the review could then A/B them on completion and replies). Homemade emoji are the Mac's Apple Color Emoji; a Linux renderer would draw Noto (Android-looking) emoji, which matters for O-5. | Lucas | M6 |

## 4. Architecture

```
Vercel (Next.js)                          Stories worker (Lucas's Mac in isolation; VM optional, O-5)
─────────────────                         ─────────────────────────────────────────
/stories (tabs)                           npm run stories:worker
  Queue · History · Settings                scripts/stories_worker.ts
/api/stories/* (queue + read only)          after the nightly reels run (≈ 1 AM ET) and on demand:
        │                                     build due sets → render (React → Chromium)
        │                                     → Haiku 5.5 review → upload → wait for slot
        ▼                                     publish frames in order → poll insights
Supabase Postgres  schema `stories`         reads reels.* and social.* (read-only)
Supabase Storage   bucket `stories`         writes social.used_photos (published photos only)
```

The app never builds or publishes a set. It inserts rows (Generate, Approve, Publish now) and reads rows. The worker does the work, as Trial Reels does.

**Data model** (`db/stories_schema.sql`, `scripts/apply_stories_schema.js`, `npm run db:stories`; additive DDL only, own schema):

- `sets`: `id`, `series` (`morning_download`, `guess_the_number`, `free_vs_paid`), `ny_date`, `status` (`requested`, `building`, `ready`, `approved`, `scheduled`, `publishing`, `published`, `rejected`, `failed`), `slot`, `publish_at`, `trigger` (`click`, `auto`), `payload jsonb` (the chosen stories or number or pair, with sources), `error`, `spend_usd`, timestamps. One set per series per day (unique partial index).
- `frames`: `set_id`, `seq`, `role` (`opener`, `story`, `closer`, `intro`, `question`, `answer`, `paid`, `free`), `template`, `backdrop` (`black`, `white`, `orange`, `green`), `copy jsonb`, `photo jsonb` (url, source, credit, qid, scene), `storage_path`, `ig_container_id`, `ig_media_id`, `published_at`.
- `candidates`: every candidate a build considered: `set_id`, `origin` (`reels`, `carousel`, `catalog`, `generated`), `ref` (idea id, post slug, run id + story id, catalog id), `payload jsonb`, Jev answers, `score`, `chosen boolean`, `reason`.
- `history`: what has been shown, for repeat checks: series, story key or number key or tool pair key, `shown_at`.
- `insights`: `frame_id`, `captured_at`, `reach`, `views`, `replies`, `shares`, `follows`, `profile_visits`, `taps_forward`, `taps_back`, `exits`, `swipe_forward`, `raw jsonb`.
- `jev_logs`, `cost_events` (`vendor`: `anthropic`, `jev`, `web_search`; `component`; tokens; `usd`).
- `settings`: per series `auto` (false), `enabled`; windows; `monthly_watch_usd`; model ids; template rotation state.
- `feedback`: `set_id`, `verdict`, `tags text[]` (`story_choice`, `copy`, `photo`, `design`, `accuracy`), `note`.

## 5. The three series

### 5.1 Helios Morning Download (daily, 8:45–10:00 AM)

**Frames:** opener → 2 to 5 story frames → closer (4 to 7 frames).

**Pool (built after the nightly reels run):**
1. Trial Reels: the latest slate's timely ideas, top 15 by `net`, plus every idea in that slate with `blockbuster > 0`.
2. Carousel: every `qualified` story in `selection.scored` from carousel runs that finished in the last 30 hours (shortlist first). Empty when no run happened (O-4).
3. Drop anything already in a Morning Download in the last 3 days (`stories.history`).
4. Merge the same story across systems: one Jev same-event check per cross-system pair whose headlines share a named entity (Tommy's `same-event@1` wording is the reference; Stories versions its own copy).

**Major-news Jev node** (`major-news@1`, DRAFT, needs R6). One call per candidate; state is the headline, outlets or source name, publish time, and the first 1,500 words. Questions:
- `blockbuster_entity`: is the subject one of the seeded companies or people (the reels lists, read from `scoring-shared.ts` at run time) or a frontier model drop by one of them?
- `political_relevance`: does it involve a government, law, regulator, court, election, or national policy?
- `global_relevance`: does it matter across countries or to a whole industry, not one firm's niche?
- `broad_effect`: does it change something for a large number of ordinary people (prices, jobs, privacy, safety, everyday tools)?
- `headline_news`: would a general news front page or a TV newscast run it?

Code turns the answers into one score (weights calibrated from the first runs and logged as a decision), applies a bar, and picks up to 5 that clear it, or the top 2 when fewer clear (S-04). Order on screen is by score.

**Writing** (`md-headlines@1`, DRAFT, needs R6). One cached Sonnet call writes every story frame: one or two full sentences carrying who, what, when, and why, and the source tag ("via The Verge", "reported by Reuters", "from OpenAI's blog", "from a post by @handle", "via GitHub"). Humanized (S-17). The opener and closer text is fixed copy approved on the M1 mock-up, not model-written.

**Grounding** (`md-grounding@1`, DRAFT). Per headline, Jev asks whether the source text supports every claim in it. A miss gets one rewrite; a second miss drops the story (the set still needs 2).

**Photos** (Section 5.4): each story frame gets its photo, first choice being the carousel post's photo when the story was a carousel post (S-29); the opener gets a second photo from one of the stories, used only when it passes the bar, otherwise the opener uses a stock scene from the finder's thematic route, otherwise a typographic opener.

### 5.2 Guess the Number (Monday and Thursday, 6:00–9:00 PM)

**Frames:** intro (S-49: today's game, difficulty, topic) → question (with image) → answer (image when good enough).

**Pool (last 7 days, S-26):**
1. Carousel posts (`social.posts` with status `review` or `published`): every `brief.numbers` entry, with its fact, source, and the post's photos.
2. Shortlisted carousel stories without a brief: a Stories extraction call (`gtn-extract@1`, DRAFT, cached) pulls up to 3 sourced numbers per story from the article text.
3. Trial Reels ideas whose `chosen_bucket` is `the_number`, with the figure from their sources.
4. Drop numbers whose story was a Guess the Number in the last 30 days.

Carousel candidates carry a source weight above reels candidates (S-10); its size is calibrated on the first runs and logged.

**Two passes:**
1. **Pre-score** (`gtn-candidate@1`, DRAFT, needs R6) on the raw number and its fact sentence: `public_context` (would an average person understand what is being counted and why it matters, with one line of context?), `guessable` (could they make a reasonable guess, neither trivial nor impossible?), `want_to_guess` (would they want to?), `interest_category` (is it about something people most want to know: money, jobs, everyday tools, famous companies or people, safety, health, the future?), `surprise` (does the true answer land differently from most guesses?), and `verifiable` (is the number stated plainly in the source, not derived?). Top 4 go on.
2. **Write** (`gtn-question@1`, DRAFT, cached Sonnet): the question line, the answer, one line of what it means, and the intro's topic line, humanized. No hint or context line (S-51). Difficulty: see O-10. **Re-score** the written question with the same node; the best clears the bar or the set is skipped for that day and the Hub says so.

**Images (S-12):** a carousel number reuses its post's photo when the photo-fit check passes for the question; otherwise the finder runs with a request written in the same call as the question. The answer frame takes a second distinct photo only when it passes the bar.

**Templates (S-13, S-44, S-45):** three families (photo-led, marquee, type-led), each on the four backdrops; every photo a bleed fade. Rotation never repeats the previous set's family and backdrop.

### 5.3 Free vs. Paid (Tuesday and Saturday, 6:00–9:00 PM)

**Frames:** intro (S-50, fixed copy) → paid tool + price + tease → free tool + what it does + how to get it.

**Pool:** Ball Knowledge ideas from the last 14 days (their copy names what a tool replaces), GitHub Trending sources, and `reels.list_catalog`, filtered to tools a general user can install (S-08).

**Pairing** (`fvp-pair@1`, DRAFT, cached Sonnet with `web_search`, at most 5 searches): proposes up to 3 pairs, each with the paid tool's current price page, the free tool's official page, platforms, and the install path. Then a verification pass checks the price and the install path on the pages found (S-22).

**Scoring** (`fvp-pair-score@1`, DRAFT, needs R6): `paid_known` (do most people know or pay for the paid tool?), `does_the_job` (does the free tool do the paid tool's core job, per its own page?), `accessible` (no setup beyond install or sign-up; a developer tool is marked as one, and at most one in four sets is a developer tool), `viewer_value` (would the viewer act on it?). Drop a pair shown in the last 90 days.

**Writing** (`fvp-copy@1`, DRAFT, cached Sonnet): slide 1 names the paid tool and its price and teases a free one; slide 2 names the free tool, one plain line on what it does, and how to get it ("free on the App Store", "a Chrome extension", "free download at site.com"). Humanized.

**Images:** logos through the finder's `logo` route (Wikidata P154, identity-checked), else official product images, else a type-led frame.

### 5.4 Photos (all series)

Stories calls `searchVisual` with a minimal `Brief`: the story's subjects (typed person or organization by Tommy's identity check), its date, and read pages for its source URLs (Tommy's `read-page`). A visual request (`kind`, `query`) is written in the same call that writes the copy, using Tommy's kinds (`person`, `company`, `logo`, `product`, `event`, `thematic`, `setting`). Recent photos from `social.used_photos` are excluded (S-24), with one exception: a story frame may reuse the photo the carousel post placed for that same story (S-29). The pick uses the photo-fit check and the close-up vision check as the carousel does. Every placed photo carries its credit on the frame (S-23).

For the Morning Download opener, a "second photo" means: for a person, Tommy's second-photo search (Commons depicts by Wikidata ID, title match, one face); for anything else, the finder's second-ranked candidate. Either is used only when it clears the fit bar.

## 6. Rendering, VM, and deploy

- **Templates** are React components plus CSS in `lib/stories/render/` (S-32), 1080×1920, one component per frame role with its variants (backdrop, layout family, photo or type-led). Fonts and the logo ship as files. The data each frame gets is plain JSON from the build (copy, photo, credit, source tag), so a template never calls a model.
- **Render:** the renderer (modeled on `lib/social/render/fit-check.ts`, copied) loads each frame in headless Chromium, runs the code checks (no overflow, no clipped words, text inside the safe zones, photo loaded), and screenshots it. `sharp` writes an sRGB JPEG under 8 MB.
- **Review (S-33):** the renderer also composites the set into one contact sheet. One Haiku 5.5 call (`stories-render-review@1`, fixed questions, structured output) reviews it. A failed frame is re-rendered once with the setting it names; a second failure goes to Lucas flagged. Cost is about a cent a set.
- **Safe zones:** nothing important in the top 250 px (progress bar, account name) or bottom 340 px (reply bar). The credit line sits just above the bottom zone.
- **Where it runs (O-5, S-30):** in isolation, the worker runs on Lucas's Mac, where Chromium is available. The VM unit (`scripts/gcp/helios-stories.service` from the shared `/opt/helios-worker/app`, restarted by `deploy-worker-code.sh`) comes only if Lucas wants Stories scheduled before the merge, and then needs Chromium installed on the VM. `deploy-worker-code.sh` ships the working tree of whatever branch it runs from, so **deploy only from `main`**.
- **Explainer folders (S-31):** what `deploy-worker-code.sh` ships is the explainer system's and Tommy's call, not this build's. Stories never edits the deploy script. Note for whoever deploys: the script tars the working tree, so the local `.explainers-local/` data folder (about 665 MB, gitignored but not excluded by `tar`) would go along.

## 7. Publishing and insights

- **Publish:** at the set's `publish_at`, the worker creates one container per frame (`media_type=STORIES`, `image_url` = a signed URL), waits for `FINISHED`, then publishes the frames **in order**, a few seconds apart, recording each media id. The Graph API has no scheduled publish for Stories; the worker is the clock.
- **Partial failure:** a frame that fails after retries stops the set; frames already live stay live (the API cannot take them down). The set is marked `failed` with what went out, and the Hub says so.
- **Insights:** the poller reads each story frame's metrics (reach, views, replies, shares, follows, profile visits, navigation: taps forward, taps back, exits, swipes forward) every 2 hours and a final capture before expiry (O-6). The Hub shows completion (last-frame reach ÷ first-frame reach) and exits on frames 1–3 per set.

## 8. UI

New `HUB_NAV` entry `stories`, label `Stories`, badge `Beta`. `/stories` and `/api/stories` protected like `/reels`.

- **Queue:** today's and upcoming sets per series, frames as phone-sized previews, the candidates considered with their scores, sources linked, cost. **Approve**, **Reject** (tags + note), **Regenerate**, **Publish now**.
- **History:** published sets with their insights.
- **Settings:** per series `enabled` and the **auto switch** (S-05: off until Lucas has reviewed one or two sets; turning it on asks for confirmation), windows, monthly watch.

### 8.1 Decision log

Decisions after kickoff go here, numbered from S-34.

| ID | Decision | Source |
|---|---|---|
| S-34 | **S-25 is superseded by M1 and S-32.** The mock-ups Lucas approves *are* the real React templates in `lib/stories/render/`, rendered on fixture data. | Lucas, 2026-10-07 |
| S-35 | **No VM deploys while Stories is in isolation.** The worker runs on Lucas's Mac; rule 0.3 applies only once a VM unit exists, and only from `main`. | Lucas, 2026-10-07 |
| S-36 | **Contrast per backdrop.** Text on orange is off-black `#171717` (white on Helios orange is about 3.1:1; off-black about 5.9:1). White on green (about 4.8:1). The black backdrop is near-black `#0A0A0A`, never `#000`. Accents: the logo gradient on black and white; white on orange and green. | Lucas, 2026-10-07 (part of O-7) |
| S-37 | **Logo treatment.** Always the whole full-colour sun mark (`assets/helios-logo.png`), never recoloured, cropped or covered, below the 250 px line with clear space. On orange and green it carries a thin white ring so it doesn't melt into the field. | Lucas, 2026-10-07 (part of O-7) |
| S-38 | **The closer shows heliosgroup.ai only**, no Instagram handle, until the handle is confirmed (O-8; the carousel's follow slide prints `@heliosgroup.ai`, the design system still says `@heliosmarketingg`). | Lucas, 2026-10-07 |
| S-39 | **Type.** Pragmatica Extended for the opener title, questions, numbers, prices, tool names and the closer headline. Morning Download headlines (two full sentences) are Roboto: the first sentence Medium in full ink, the rest Light; the split skips abbreviations ("Gov.", "Sept.", "U.S."). | Lucas, 2026-10-07 |
| S-40 | **Fixture photos** are real Commons files fetched once into `lib/stories/render/fixtures/photos/` with `credits.json` (artist, license, page). Free, about 3 MB. | Lucas, 2026-10-07 |
| S-41 | **Bleed photos fade long on black and start fading later on the other backdrops.** A long fade into a flooded colour tints the photo. Stops live in `lib/stories/render/fades.ts`, the one source for the mask and the check; text may sit on a bleed photo only where it has faded below 30%. | Agent, M1 (revised after S-44) |
| S-42 | **Playwright's own Chromium** (headless shell build 1243, about 94 MB) was installed on Lucas's Mac with `npx playwright install chromium`; Playwright 1.63 can't launch the cached 1200/1217 builds. | Agent, M1 |
| S-43 | **Credits are never truncated.** A credit wraps to two lines and shrinks to 16 px at most; it sits just above the reply bar (bottom edge at y=1576). | Agent, M1 |
| S-44 | **Every photo is a bleed fade, never a card.** Story frames and photo-led Guess the Number frames hang the photo from the top edge and fade it into the backdrop; the Morning Download opener and the marquee family use a "window" that fades in and out between two text blocks (so the logo stays top center). Guess the Number's split family is replaced by the marquee family. | Lucas, M1 review |
| S-45 | **Guess the Number plays like a game show, through the copy.** "Can you guess the number?" is the dominant line on every question frame (Pragmatica, largest type on the frame); the question follows as the challenge; the context becomes a **Hint**; the cue is "Lock it in. Tap to reveal". The answer frame opens "The answer is", then the number, and asks "How close did you get?". Question data carries `hint`, not `context`. | Lucas, M1 review |
| S-46 | **Free vs. Paid leads with the series title.** "FREE / vs. / PAID" stacked large at the top of both slides like a fight card; the side the slide is about is lit (PAID on slide 1, FREE on slide 2). The masthead drops its label on Guess the Number and Free vs. Paid, since the title carries the series. | Lucas, M1 review |
| S-47 | **No pills or buttons in Stories.** The next-frame cue is type and an arrow, right-aligned, on the side people tap to go forward. The closer's heliosgroup.ai is type with an underline, not a button (a Story can't link without a sticker). | Lucas, M1 review |
| S-48 | Story frames carry no layout setting any more (bleed only); the render review's (S-33) settings for a story frame are backdrop and photo focus. | Agent, follows S-44 |
| S-49 | **Guess the Number opens with an intro slide:** Today's "Guess the Number", **Difficulty:** Low / Medium / High, **Topic:** one line the model writes. Type-led with the "?" watermark; cue "Tap to play". A set is intro → question → answer. | Lucas, M1 review |
| S-50 | **Free vs. Paid opens with an intro slide** in Lucas's words, verbatim: "Free Vs. Paid is our series where we give you guys open source or free tools that can replace the tech you're currently paying for, enjoy :)" under the stacked FREE / vs. / PAID title, both words lit; cue "Tap for today's pick". The ":)" is a deliberate bend of the no-emoji rule. A set is intro → paid → free. | Lucas, M1 review |
| S-51 | **No hints on Guess the Number.** The question frame is the game line, the question and the cue; question data has no `hint`/`context` field. | Lucas, M1 review |
| S-52 | **Closer headline:** "Follow for AI news, updates and lessons." ("every morning" removed). | Lucas, M1 review |
| S-53 | **Homemade style (exploration).** Guess the Number and Free vs. Paid can also render as if built in Instagram's own story editor: Classic text (Inter Medium, Trial Reels' stand-in for San Francisco), the editor's per-line highlight boxes (white, black, see-through, colour), full-screen photos or tilted photo stickers, logos as white-edged cutouts, pen-tool arrows and strike-throughs, emoji glued to their words, a few degrees of tilt, no logo or masthead. Same frame data; `Frame.style` picks `polished` or `homemade`. Safe zones, text fit and credits still apply; text over a full-screen photo must sit in a box and never on a sticker (renderer checks). The polished templates were checkpointed first (`765b922`). | Lucas asked, 2026-10-08 |
| S-54 | **Guess the Number and Free vs. Paid ship in the homemade style; Morning Download stays polished** (`SERIES_STYLE` in `lib/stories/render/types.ts`). Resolves O-11. | Lucas, 2026-10-08 |
| S-55 | **Homemade full-screen photos are darkened and see-through** (60% opacity over the backdrop fill, then a 40% black shade) so the typed lines read. | Lucas, 2026-10-08 |

### 8.2 Prompt and question-set registry

| ID | Component | Engine | Status |
|---|---|---|---|
| `major-news@1` | Morning Download ranking | Jev | Draft, needs approval |
| `md-headlines@1` | Morning Download story frames | Sonnet | Draft, needs approval |
| `md-grounding@1` | Headline supported by source | Jev | Draft, needs approval |
| `gtn-extract@1` | Numbers from shortlisted stories | Sonnet | Draft, needs approval |
| `gtn-candidate@1` | Guess the Number scoring | Jev | Draft, needs approval |
| `gtn-question@1` | Question and answer copy | Sonnet | Draft, needs approval |
| `fvp-pair@1` | Pair finding and verification | Sonnet + web_search | Draft, needs approval |
| `fvp-pair-score@1` | Pair scoring | Jev | Draft, needs approval |
| `fvp-copy@1` | Free vs. Paid copy | Sonnet | Draft, needs approval |
| `same-event` (Stories copy) | Cross-system merge | Jev | Draft, needs approval |
| `stories-render-review@1` | Contact-sheet review of a rendered set | Haiku 5.5 | Draft, needs approval |

### 8.3 Milestone reports

**M1 (2026-10-07 to 10-08): templates on fixture data. No model calls, $0 spent. Accepted by Lucas 2026-10-08** with the homemade style for the two games (S-54, S-55), the closer line (S-52) and the backdrop bends (O-7) as rendered.

- **Built:** `lib/stories/render/`: `types.ts` (frame data, safe zones, 8 MB cap), `copy.ts` (fixed opener, closer and label copy: DRAFT until approved), `StoryFrame.tsx` (one component per role: opener, story, closer, question, answer, paid, free), `stories.css` (Helios tokens, four backdrops), `text-fit.ts` (copied from Tommy's), `render.ts` (React → Chromium → checks → sRGB JPEG, contact sheet; modeled on `fit-check.ts`, copied), `assets/` (Pragmatica, Roboto 300–700, the sun mark), `fixtures/m1.ts` + `fixtures/photos/`. Script `npm run stories:mockups`. Test `tests/stories-render.test.ts` (5, offline).
- **Variants:** Morning Download opener (photo window and typographic), story frame (bleed and typographic), closer; Guess the Number photo-led, marquee and type-led, each question and answer; Free vs. Paid paid and free. Every one on black, white, orange and green: 60 frames.
- **Homemade exploration (S-53):** both series also render in an Instagram-editor style: `npm run stories:mockups -- --homemade` writes `exports/stories/m1-homemade/sheets/` (40 frames, all checks passing, largest JPEG 623 KB). `npm test` 1390/1390 (1380 + 10). Polished renders kept in `exports/stories/m1-polished/sheets/` (committed at `765b922`).
- **Revision 2 (Lucas's review):** intro slides for Guess the Number (S-49) and Free vs. Paid (S-50), no hints (S-51), closer without "every morning" (S-52). 68 frames.
- **Revision 1 (Lucas's review):** bleed fades everywhere (S-44), game-show Guess the Number (S-45), Free vs. Paid title-led (S-46), no pills (S-47). The fade check was proven with a negative test (copy moved onto a photo fails: "text on a photo (95% visible)").
- **Renderer checks, all passing:** fonts and images loaded, text fit, nothing out of frame, every text block, logo, cue and credit inside y 250–1580, no text on a bleed photo above 30% opacity. Largest JPEG 389 KB (68 frames).
- **Baselines:** `npm test` 1388/1388 (1380 + 8 new). `tsc --noEmit`: only the 5 known errors in `tests/seo-gsc-auth.test.ts`.
- **For Lucas:** `exports/stories/m1/sheets/` (`morning-download.jpg`, `morning-download-typographic.jpg`, `guess-the-number.jpg`, `free-vs-paid.jpg`); full frames under `exports/stories/m1/<series>/<backdrop>/`.
- **Needs approval:** the revised templates, the closer wording (`copy.ts`: CLOSER), the fixed labels ("Today's \"Guess the Number\"", "Difficulty", "Topic", "Tap to play", "Can you guess the number?", "Lock it in. Tap to reveal", "The answer is", "How close did you get?", "Free vs. Paid", "Tap for today's pick", "The paid one", "The free one", "Tap for the free one", "Tap for today's N stories"), and the brand bends (O-7, S-36, S-37).
- **Known gaps, by design for M2:** no face detection or face-centred crops yet (fixture crops are set by hand); no matte framing for small photos; the render review (S-33) is M2.

## 9. Cost

Rough, to be replaced by measurements: Morning Download about $0.08–0.15 a day (Jev under a cent, one Sonnet call, photo vision checks, the Haiku 5.5 review); Guess the Number about $0.10–0.20 a set; Free vs. Paid about $0.25–0.45 a set (web search). About **$5–10 a month**. A `monthly_watch_usd` of $25 in `stories.settings`, checked before each build like the reels watch (D-023); at or over it, a build records `skipped`.

## 10. Milestones

Build in order. Each ends with a report to Lucas.

| M | Scope | Accept |
|---|---|---|
| M0 | This plan, decisions S-01 to S-27, open items | Lucas approves the plan |
| M1 | **Design mock-ups as the real React templates** on fixture data, no model calls: the Morning Download opener, story frame, and closer; Guess the Number in three families; Free vs. Paid both slides; each on black, white, orange, and green, with fixture copy and real fixture photos, rendered to JPEGs and a contact sheet | Lucas approves the templates, the closer line, and the brand bends (O-7) |
| M2 | Schema, settings, repository; renderer (React templates → Chromium → JPEG with code checks, contact sheet); `stories-render-review@1` against a stubbed Haiku; storage; Stories publisher and insights client against stubs; insights window confirmed (O-6) | Tests pass offline with PGlite and stubbed Meta and Haiku. A fixture set renders to JPEGs under 8 MB |
| M3 | Morning Download pipeline: pool from reels and social fixtures, merge, `major-news@1`, headlines, grounding, photos, render. Prompts and question sets shown to Lucas for approval | Pure and SQL tests pass with stubbed Jev, Sonnet, and finder. No live call |
| M4 | `/stories` Queue, History, Settings; Generate, Approve, Reject, Publish now; auto switch | Pages render with fixture data; auth blocks unauthenticated requests |
| M5 | **Lucas clicks Generate for the first Morning Download**, reviews it, publishes it. Repeat once if he wants | Agent reports telemetry only: spend by component, wall time, candidates, failures |
| M6 | Guess the Number (pool, extraction, two-pass scoring, writing, images, templates); then Lucas's first click | Same as M3 and M5 for this series |
| M7 | Free vs. Paid (pairing with web search, verification, scoring, copy); then Lucas's first click | Same as M3 and M5 for this series |
| M8 | Scheduling: `npm run stories:worker` on Lucas's Mac publishes on the windows; Lucas flips each series' auto switch when ready. A VM unit only if Lucas wants it before the merge (O-5) | First automatic set publishes in its window |

## 11. Risks

1. **Thin carousel days.** Until Tommy's hub runs the carousel daily (his work, S-30), Morning Download sometimes runs on Trial Reels alone and Guess the Number's preferred source (S-10) may be thin.
2. **Shared code owned by someone else.** The photo finder, read API, and question wording can change under Stories. Mitigation: pin behavior with fixture tests that fail loudly, and never patch `lib/social/` from this branch.
3. **Accuracy.** Headlines and numbers are claims under the Helios name. Grounding checks, sourced numbers only, and Lucas's review of the first sets are the guardrails.
4. **Price claims go stale.** Free vs. Paid verifies on the day it builds; a price can still change before the set expires.
5. **Partial publishes** cannot be pulled back by the API (Section 7).
6. **The worker on a laptop** publishes only while Lucas's Mac is awake and online. A missed window is skipped, not posted late. The fix is the merge (Section 12) or the VM (O-5).
7. **Brand.** Flooded backdrops and the first pitch on the account are deliberate bends (O-1, O-7, S-09). Any further bend is a decision.
8. **Deploying from the wrong branch** replaces the shared app directory with that branch's code (Section 6). The VM was last deployed before Explainer Reels reached `main`; Stories does not change that.
9. **Secrets in git.** `main` tracks `.env.local.bak.1790223134` (from the carousel push). Never read it, copy from it, or print it.
10. **Merge drift.** Tommy's hub is moving while Stories is built in isolation. Keep Stories' seams narrow (Section 12) so assimilation is a swap of a few adapters, not a rewrite.

## 12. Later: assimilation into Tommy's Social Hub (S-30)

Not part of this build. Tommy is putting the carousel and explainer systems under one roof, organized, published, and scheduled. Once Stories is validated and its outputs approved, it moves into that hub, possibly run from Tommy's machine and pushed to the repo. To keep that a small job, Stories keeps every outside dependency behind one adapter:

- **Data in:** `lib/stories/sources/reels.ts` and `lib/stories/sources/carousel.ts` (read-only).
- **Photos:** `lib/stories/photos.ts` wraps Tommy's finder and the `social.used_photos` log.
- **Render:** `lib/stories/render/` (templates, renderer, review).
- **Publish and insights:** `lib/stories/publish/`.
- **Schedule:** `scripts/stories_worker.ts` and the `stories.sets` queue.

At the merge, Tommy's scheduler and publisher can replace the last two, his renderer can host the templates, and anything that touches the explainer system takes his version (S-31). The `stories` schema can stay or fold into `social`; that is Tommy's call then.
