# Helios Social: Last Few Days (design spec)

**Owner:** Tommy Pozo
**Status:** DRAFT for review (design agreed in chat with Tommy, 2026-10-13). v1.1 items are PARKED.
**Template (DECIDED, final):** `Claude outputs/last-few-days-template/` (`cover.html`, `story.html`,
`last-few-days.css`, fonts, assets). Built in Claude Design and render-checked in headless Chromium on 2026-10-13.

## 1. What it is

A **new, fifth content type**, a peer of Trial Reels, Explainers, Carousels and IG Stories. It is a recap of the top AI
stories from the last few days, posted **every Tuesday and Friday morning**. Its purpose is to add variety to the feed. It
follows a format that's trending on Instagram: a question hook on the cover, then one headline and a short blurb per story.

On Instagram it is a multi-image ("carousel") feed post:

- **Cover:** a fixed hook plus a mosaic of the story photos.
- **5–6 story slides:** the same layout every time. Text sits on top and the photo below.
- **The existing Follow Helios slide** closes the post.

**Built as its own type:**

- it has its own schema, runs, settings, hub page and spine vertical (`last_few_days`);
- it shares **code**, not identity, with the rest of Helios Social: the slide renderer, the photo finder, the Jev checks and
  the Instagram feed-post publishing.

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| LFD-01 | Posts every Tuesday and Friday in a morning window (9:00–10:00 AM NY). | DECIDED |
| LFD-02 | Carousels do **not** run or post on Tuesday and Friday. Last Few Days replaces them on those days, so those days have 1 feed post. | DECIDED |
| LFD-03 | Stories enter two ways. **Major headlines** (both pools, judged by Jev `major-news@2`) are guaranteed a place, **up to 3**. Jev decides the slide order (§4.2; Tommy, 2026-10-14). The remaining slots are filled from the **Text on Screen (reels) idea pool**, which runs punchier and more niche. Niche is fine for this format. | DECIDED |
| LFD-04 | Repeats are checked **only against earlier Last Few Days posts**. A story that had its own carousel can still appear. | DECIDED |
| LFD-05 | **5–6 stories** per post. The post is **never skipped**. | DECIDED |
| LFD-06 | No score floor. Stories are taken in rank order, and when one drops out the next one in line replaces it. | DECIDED |
| LFD-07 | The hook is fixed text written by code: **"DO YOU REALIZE WHAT JUST HAPPENED IN AI IN THE LAST FEW DAYS?"** | DECIDED |
| LFD-08 | The cover visual is a mosaic of the story photos. Story 1 gets the largest tile. | DECIDED |
| LFD-09 | Headline tone is **punchy and literally true**. Nothing goes beyond what the source says. | DECIDED |
| LFD-10 | **Its own content type** (a fifth spine vertical), not a kind of Carousels post. | DECIDED |
| LFD-11 | v1 visuals are photos plus the article's own images. Screenshots of X posts come in v1.1. | DECIDED |
| LFD-12 | Nothing posts without human approval, the same as every other type. | DECIDED |

## 3. Picking the stories

### 3.1 Window

- A post covers **every nightly reels batch dated after the previous Last Few Days post, up to and including that morning's
  batch**. The reels run at 1:00 AM, so the morning's batch is already in.
  - Tuesday covers the Saturday, Sunday, Monday and Tuesday batches.
  - Friday covers the Wednesday, Thursday and Friday batches.
  - The very first run looks back 4 batches.
- An idea is **eligible when its first `timely` appearance** in `reels.idea_scores` falls inside the window.
  - `carryover` rows are the reels scorer taking a second look at yesterday's near misses. They are not a different kind of
    story. They don't make an idea eligible, but they count toward its score (§3.2).
  - An idea that first appeared before the window was already available to the previous post. It is excluded.
- **Read-only sources:** Last Few Days only reads `reels.*`, `social.runs` and the news feeds. It never writes to another type's tables.

### 3.2 Two lanes

A big but straightforward release (for example, a new Claude model) can rank low in the Text on Screen pool, which scores for
scroll-stopping stories. So a story can get in two ways.

**Lane 1: major headlines (guaranteed, up to 3, placed first)**

- **Candidates.** All three sources below are merged, and each event is counted once (§3.3, step 1):
  - the carousel shortlists stored on `social.runs.record` from carousel runs in the window, top 10 per run;
  - **a fresh feed pass:** the carousel news feeds fetched at Last Few Days run time, covering only the hours since the last
    carousel run. Carousels don't run on Tuesday or Friday, so without this a release that broke the afternoon before would
    sit in no carousel shortlist. It reuses `lib/social/ingest` (fetch, code filters, freshness window) and does **no**
    `story-scoring` and no writing;
  - the window's Text on Screen ideas, top 10 by best `net` per nightly batch, plus every blockbuster.
- **Cap:** about 60 candidates in total.
- **Judgment:** each candidate gets one Jev `major-news@2` judgment (`lib/stories/questions.ts`). The score uses Morning
  Download's weights (`MAJOR_NEWS_WEIGHTS`) and bar (`MAJOR_NEWS_BAR`, 0.55).
- **Placement:** the stories that clear the bar take **up to 3 slots**, highest score first. Where they sit is Jev's call
  (§4.2 slide order); story 1 gets the big tile on the cover mosaic.
- **None clear the bar:** none are forced in, and lane 2 fills the post.

**Lane 2: the punchy rundown (fills the remaining slots)**

- The window's Text on Screen ideas that lane 1 didn't take.
- Ranked with blockbusters first, then by **best `net` score across every night they were scored**, carryover nights
  included.
- Each idea appears once.

### 3.3 Cleaning, in order (across both lanes)

1. **One slide per event.** Candidates about the same event are merged with the Jev same-event judgment Morning Download
   already uses, after a cheap pre-filter on shared proper names (`namesIn`).
   - A merged story keeps the stronger article.
   - It stays in lane 1 if either side cleared the major bar.
2. **At most 2 stories per company.** Lane 1 picks are placed first; a company already at 2 is skipped in lane 2.
3. **No repeats from earlier Last Few Days posts:**
   - any idea or story ID stored on the last 2 Last Few Days posts (`lfd.posts.idea_ids`, holding reels idea IDs and
     carousel story IDs) is excluded;
   - the new picks are checked against the previous post's headlines with the same-event judgment, which catches the same
     story arriving through a different article.
   - A major headline that had its own carousel is still allowed (LFD-04).

### 3.4 Count and replacements

- 6 stories in total: up to 3 from lane 1, then lane 2 fills the rest.
- **Replacements:** a story that later fails the fact check (§4.4) or gets no usable photo (§5) is replaced by the next
  candidate **in its own lane**. If lane 1 runs out, lane 2 fills the slot. A low score is not a reason to drop a story.
- **Minimum 5.**
- Safety net if fewer than 5 eligible ideas are left (not expected, given the size of the pool):
  1. extend the window back 3 more batches, keeping the same repeat rules;
  2. if it is still short, post what's there with a "short post: only N stories" note on the review screen.
- The post is never skipped.

**Cost:** SQL, a free feed fetch, about 60 Jev `major-news@2` judgments, and the same-event checks. All of it is Jev or free, and it is metered by the run cap (§9).

## 4. Writing and fact check

### 4.1 One writing call per post

- **Model:** Sonnet 5.5, through the existing structured-call pattern (Morning Download's `writeStructured`).
- **Prompt caching:** the system prompt, the style guide and the tool schema are a fixed prefix marked `cache_control`. Only
  the story material changes per run. This follows CLAUDE.md and `lib/anthropic-cache.ts`.
- **Input for each story:** headline, outlet, other outlets that reported it, publish time, canonical URL, and the full article
  text.
  - Text on Screen ideas: from `reels.sources.body`.
  - Carousel and fresh-feed stories: from the stored brief, or fetched with the existing article fetcher. A story whose full
    text can't be fetched is dropped and replaced (§3.4).
- **Output for each story:**

| Field | Rule |
|---|---|
| `setup` | Optional. Target 85 characters, hard max 90. Ends with ":". **At most 2 per post.** Only when there is a natural, relatable angle. |
| `headline` | Target 65 characters, hard max 70. Title case. Code adds the leading "– ". |
| `highlight` | Optional. Copied exactly from the headline and coloured orange. |
| `names` | The company and people names to colour green. Never used on the cover. |
| `body` | Target 170 characters, hard max 190. **No final period.** |
| `photo` | Subject, search query and fallbacks, in the format the photo finder already takes. |

### 4.2 Style guide (goes into the prompt)

These patterns come from the reference post, where about 10 of the 13 headlines were literal news written punchily.

- **Lead with a name or a number:** a company or person first, and a dollar figure, count or multiple where the story has one.
- **Use present-tense "just happened" verbs:** "Just Dropped", "Is Here", "Is Now", "Wants to", "Will Now".
- **Colour must come from the source.** A model's own nickname is fine. An invented claim of the "killed 10,000 startups"
  kind is not.
- **Body:** 2 sentences. First what happened, then one hard detail (a number, who, when), credited where natural
  ("Anthropic says…").
- The same anti-hype and anti-AI-tell rules as the carousel Writer.
- **Slide order is Jev's call** (Tommy, 2026-10-14). After writing, each story gets one Jev `lfd-lead@1` judgment
  (`lib/lfd/questions.ts`; draft wording until Lucas approves it) on its written headline, blurb, the outlets that
  reported it and the source text: `stop_scroll`, `talked_about` and `human_drama` add a third each, `routine` takes a
  third away. The highest score leads, whatever lane picked the story; ties keep the lane order. A story is judged once
  per run. If any judgment fails, the lane order stands (majors by score, then the rundown) and the run record says
  `lead.by = 'fallback'`. Each story's score is saved on the post and in the run record.

### 4.3 Code checks (free)

- **Highlight:** it must appear exactly in the headline. If it doesn't, drop it and leave the slide plain.
- **Hard maximums:** a field over its limit gets one rewrite request for that story.
- **Setup lines:** if there are more than 2, keep the setups of the 2 highest-ranked stories and remove the rest.

### 4.4 Fact check

- For each story, a Jev grounding check compares the setup, headline and body with the source text. It is Morning
  Download's check (`md-grounding@1`) with the same pass bar, 0.6.
- **A story that fails** gets one rewrite (a small Claude call for that story only) and is checked again.
- **If it fails a second time,** it is dropped and the next idea in line replaces it (§3.4).

### 4.5 Caption (written by code)

1. "Do you realize what just happened in AI in the last few days? Swipe ⬅️ to catch up."
2. One short line per story (its headline).
3. The standard Follow Helios line.
4. The credits block, covering sources and every photo.

No hashtags. Hard cap `CAPTION_MAX_CHARS` (2,200).

## 5. Photos

- **Article lead image first** (Tommy approved 2026-10-13, after the first live run put a generic "stack of newspapers"
  photo on 4 of 5 story slides; `lib/lfd/lead-image.ts`). The story's own article page is read once per run. Its largest
  in-body figure that has a credit and is at least 600px wide is used, credited as the page shows it. Otherwise the page's
  og:image is used, credited "Image via <outlet>" (a known width under 600px is not). SVGs, GIFs and images named as logos,
  icons, avatars or sprites are skipped, as are photos already in the post or used in the last 7 days. Only stories
  without a lead image go to the finder.
- **The generic icon-scene fallback is refused.** The finder's last resort is a plain scene for the slide's icon; Last Few
  Days slides have no icon, so it falls to the default (a stack of newspapers). A photo found that way is treated as no
  photo, and the story is replaced. Each saved story keeps the writer's request (`photoAsk`), the photo (`photo`), where it
  came from (`photoSource`: `lead` or `finder`) and how it was chosen (`photoTrace`).
- Each story's photo request (when it has no lead image) goes to the existing finder (`lib/stories/photos.ts`, `createLivePhotoFinder`). The whole post
  is found as one set (`findSet`), so no two slides share a photo.
- **Article images:** the article's own images (announcement cards, benchmark charts) reach the finder because it reads the
  source page, which is passed in `sourceUrls`. `reels.sources.media_urls` is not needed (corrected 2026-10-13: the finder
  has no separate image-candidate input).
- **Existing rules that still apply:**
  - the 7-day no-repeat rule (`social.used_photos`, shared across types), with the existing exemption for logos and
    headshots on story slides;
  - the fallback order of person or product, then CEO, logo, HQ, and finally conceptual stock.
- **If the whole chain fails,** the story is dropped and the next one in line replaces it. A slide never goes out without a
  photo.
- **Framing:** when the finder returns a focus point (`Photo.focus`), the image is framed on it. Otherwise it is
  `50% / 40%`.
- **Cover mosaic:** reuses the slide photos in rank order. No extra searches.

## 6. Rendering

- **Shared renderer, new slide types:** `lfd_cover` and `lfd_story` are added to `LayoutVariant`
  (`lib/social/render/types.ts`), each with a component in `SlideTemplate.tsx`. The template CSS is ported as-is, using the
  `.story--card` variant. The existing Follow slide is reused.
- **Post shape:** the cover, then 5–6 `lfd_story` slides, then the Follow slide, for 7–8 images. That stays under the
  10-image limit in `storeSlideJpegs`.
- **Overflow:** the template's height limits become the overflow rule for these slides: setup ≤ 88px, headline ≤ 100px,
  body ≤ 126px.
  - An overflowing slide is **recorded on the post** (`lfd.posts.fit_problems`) and shown on the review screen. Corrected
    2026-10-13: the carousel pipeline has no OVERFLOW stamp; `storeSlideJpegs` ignores fit results.
  - Text never shrinks and is never cut off: each text region's minimum size equals its design size.
- **JPEGs:** `storeSlideJpegs` gains an optional `prefix`, so these upload to `lfd/{slug}/slide-NN.jpg` in the `social-slides`
  bucket. Carousels keep `posts/`.
- **Post-render vision check** (approved 2026-10-13; `lib/lfd/vision.ts`): one Haiku 5.5 call per rendered story slide
  (cached system and tool; the slide PNG and the story's headline, body, names and outlet in the user turn). The photo
  passes when it shows the story's subject (company, product, person, place or a directly related scene; a logo or
  official product shot of the named company counts) and is not generic stock. A graphic that is mostly text or publisher
  branding (headline card, a news site's share image or logo, an article screenshot) counts as generic.
  - A rejected slide gets one replacement round before anything is uploaded. A rejected article lead image first falls
    back to the finder for the same story; a finder photo that is rejected (or a lead with no finder photo) drops the
    story as `vision-rejected` and the next one in line replaces it. Then the post is re-rendered once.
  - On the re-render, rejections are not replaced again; they are recorded in `lfd.posts.render_problems` as
    `vision: <headline>: <reason>`.
  - The check is a backstop and fails open: no verdict (a failed or refused call) passes the slide as "vision
    unavailable". The run record carries `vision: { checked, rejected, unavailable, usd }`.
- **Two template fixes during the port:**
  - replace the avatar, whose "HELIOS" lettering is unreadable at 44px;
  - try the hook one size larger, since there's spare room under the kicker.

## 7. Joining the overnight contract (`docs/social-overnight.md`)

### 7.1 Schema `lfd` (additive, idempotent)

Applied with `node scripts/apply_lfd_schema.js`. There is no npm script, because `tests/social-hub-scope.test.ts` requires
`package.json` to stay unchanged.

| Table | What it holds |
|---|---|
| `lfd.runs` | The contract's run shape: `status requested|running|ok|partial|failed|skipped`, the two single-row unique indexes, `trigger scheduled|manual`, `claude_usd`, `total_usd`, `stop_reason`, `record jsonb` (window, pool, picks, drops with reasons). |
| `lfd.settings` | Key/value. `auto_run` (off), `publishing_live` (off), `require_approval` (on), `days` (`[2,5]`), `run_cap_usd` (`1.00`). |
| `lfd.posts` | `id`, `run_id`, `slug`, `ny_date`, `status preview|review|published|rejected`, `idea_ids text[]`, `stories jsonb` (written copy and photo for each story), `render jsonb`, `caption`, `slide_objects jsonb`, `fit_problems jsonb`, `short boolean`, `created_at`, `published_at`. |

### 7.2 On the spine (`social_hub`)

- **New vertical `last_few_days`** in every vertical CHECK list in `db/social_hub_schema.sql`. Per D45, every definition
  carries the full list.
- **`schedule_slot_check`** gains `(vertical = 'last_few_days' AND slot = 'morning')`.
- **`content_items`** gets `vertical = 'last_few_days'`, `format = 'feed'`, and `native_ref` set to `lfd.posts.id`.
- **Approvals, schedule, publish attempts and media insights** all use the spine tables, as for the other spine types.

### 7.3 The clock

- **3:00 AM Tuesday and Friday,** run by the existing `helios-social` worker (`scripts/social_worker.ts`).
  - This is the slot the carousel run would otherwise use, so the "one type per hour" rule still holds.
  - The carousel run reads `lfd.settings.days` and does not run on those days while Last Few Days `auto_run` is on (LFD-02).
  - **One process, not a new unit:** both types share the worker process, so they can never overlap. This replaces step 3 of
    the "Adding a content type" checklist (a new systemd unit); the clock table records why.
- **The overnight doc** gets a new clock row. Insights are swept by the shared spine sweep, so Last Few Days needs no insights
  hour of its own.
- **Worker sync:** this changes the social worker, so the same session redeploys `helios-social-worker` with
  `./scripts/gcp/deploy-social-worker.sh` (CLAUDE.md).

### 7.4 Scheduling and publishing

- **Booking:** the finished post is booked into the **morning window (9:00–10:00 AM)** on its day, with the shared 30-minute
  feed spacing (`lib/instagram/feed-spacing.ts`, `chooseFromWindows`).
- **Placement rules** (`lib/social-hub/placement.ts`) and **plan windows** (`lib/social-hub/views/plan.ts`) get a
  `last_few_days` window with `days: [2,5]`. The Carousels windows get `days` that leave out Tuesday and Friday while Last
  Few Days is on.
- **Daily fill** (`lib/social-hub/fill.ts`): one post per Last Few Days day, minus what a person placed. Carousels' quota on
  Tuesday and Friday is 0 while Last Few Days is on.
- **Publish driver:** a new `lib/publishing/drivers/last-few-days.ts`, plus matching actions. It posts the image set as a
  feed carousel through the same Instagram calls and account gate the Carousels driver uses. The shared code moves into a
  helper rather than being copied.
- **`run-today.ts`:** gets a Last Few Days entry, which powers the hub's Run button.

## 8. In the hub

- **A "Last Few Days" type page** next to the other four, with its own `VERTICALS` entry and `TYPE_PAGE_IDS` id, its own
  `--sh-v-*` colour, a hub adapter (`lib/social-hub/adapters/last-few-days.ts`) and a query
  (`lib/social-hub/queries/last-few-days.ts`).
- **Ideas view:** the ranked pool for the next post, showing the window, the picks and the drop reasons.
- **Review screen:** the 7–8 slides, caption and per-story sources, with Approve, Reject and Delete. These work the same as on
  the other types.
- **Run button:** "Make Last Few Days now" queues a manual run. This is how a person triggers the first live run.
- **Shared views** (Content/calendar, Today, costs, the "N need you" count, insights) count it as its own type. That includes
  every list of verticals the exploration found (`day-rank.ts`, `fill.ts`, `costs.ts`, `feed-spacing.ts`, `lib/content-type/*`,
  `components/content-type/*`). The implementation plan lists each one.

## 9. Cost

| Step | Estimate per post |
|---|---|
| Picking stories (SQL, free feed fetch, about 60 Jev `major-news@2` judgments, Jev same-event checks, 5–7 Jev `lfd-lead@1` judgments) | a few cents (Jev, metered) |
| Writing call plus the occasional one-story rewrite (Sonnet 5.5, cached prefix) | ~$0.10–0.20 |
| Photos (Haiku tag and vision checks, Jev photo-fit) | ~$0.10–0.30 |
| Post-render vision check (Haiku 5.5, one call per story slide, 5–6 slides plus replacements) | ~$0.002–0.01 per slide |
| Fact checks (Jev) | a few cents |
| **Total** | **≤ ~$0.50 per post, about $1 a week** |

- **Hard cap:** the run uses the same guard pattern as the carousel run (a run budget that refuses a call that would cross
  `run_cap_usd`, the capped Jev wrapper and a cost meter), capped at $1.
- **Real figures:** `lfd.runs.claude_usd` and `lfd.runs.total_usd` record the actual spend. The estimates get confirmed after
  the first runs.

## 10. Testing

Automated tests are offline only. They make **no live Claude, Jev or `web_search` calls**, and model steps are stubbed with
canned tool responses (CLAUDE.md). They cover:

- the window and first-timely-appearance rules, with carryover rows counting toward the score but not eligibility;
- the two lanes, with `major-news` stubbed:
  - up to 3 major headlines are guaranteed and lead the post;
  - none clearing the bar means lane 2 fills everything;
  - a merged story keeps lane 1;
  - the fresh feed pass covers only the hours since the last carousel run;
- the repeat checks by ID and by event (event check stubbed), the 2-per-company cap, the 5–6 count rule and the safety net;
- replacement order when a story fails the fact check or has no photo, within its own lane, falling back to lane 2;
- the caption builder, the highlight rule and the setup-line cap;
- `lfd_cover` (4, 5 and 6 photos) and `lfd_story` (short copy and copy at the hard maximums) rendered from fixed test data
  against the overflow limits;
- the clock: on Tuesday and Friday, Last Few Days is queued and the carousel run is not; on other days nothing changes;
- the spine: the CHECK lists accept `last_few_days`, the morning slot books, and fill counts a person's placement;
- the publish driver against a stubbed Instagram client.

**Live acceptance:** Tommy clicks "Make Last Few Days now" and judges the result. Agents may report telemetry such as cost,
timings, drop reasons and overflow flags. They do not start live runs.

## 11. Rollout

1. Ship with `auto_run` and `publishing_live` off, as the overnight contract requires.
2. Tommy runs it by hand from the hub, reviews the result, and approves.
3. Tommy turns on `auto_run`. From then on, Carousels stops running on Tuesday and Friday.
4. Tommy turns on `publishing_live`.

**Known knock-on:** Morning Download pools carousel stories from the last 30 hours. On Wednesday and Saturday mornings, after
a day with no carousel run, its carousel side will be thin. Its reels side, which is the same pool Last Few Days uses, is
unaffected.

## 12. Out of scope (PARKED)

- **v1.1, X post screenshots.**
  - Find the post IDs embedded in the source article's HTML (free, and always about the right story).
  - Render them with `vercel/react-tweet` (MIT, reads the public syndication endpoint, no API key), screenshot them, and use
    them as the slide image.
  - Needs one rule for when a post beats a photo: when the post *is* the news.
- **Later:** X API search (pay-per-use, about $0.005 per post returned by third-party reports), only if embedded posts turn
  out to be too rare.
- **Not planned:** scrapers such as twscrape or snscrape. They break X's terms and break often.
- Cut-out collage covers.
- Weekday hook variants ("…THIS WEEKEND?").
