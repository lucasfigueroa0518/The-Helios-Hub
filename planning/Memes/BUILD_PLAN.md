# Meme lab: build plan

**Status:** DRAFT for Lucas's go-ahead (2026-10-13). Nothing is built.

The lab is the isolated test bed (ME-21, ME-22): pick a story, click Generate,
get a slate of 3 memes on 3 different templates, pick one or reject with tags.
Nothing publishes, and nothing is wired into carousels or any other content
type. This plan builds it in seven milestones, in order, each with an Accept
bar, reporting at each boundary (CLAUDE.md).

Inputs, all approved: [DECISIONS.md](DECISIONS.md) (ME-01 to ME-74),
[AUDIENCE_SITUATIONS.md](AUDIENCE_SITUATIONS.md) (AS-01 to AS-20),
[TEMPLATE_CARDS.md](TEMPLATE_CARDS.md) (25 cards),
`lib/social-hub/blue-chip-players.ts` and `lib/social-hub/logo-bank.ts`.

## Ground rules

- **Spend (CLAUDE.md Rule 1).** Tests never call Claude or Jev live: every
  model step takes an injected client, and tests pass canned answers. The
  first live run is Lucas clicking Generate. Each click is capped in code at
  **$0.25** (ME-62): a cost meter stops the run before a call that would cross
  it.
- **Prompt caching.** The static prefix (rules, the 25 cards, the 20
  situations, the tool schema) is one cached block; only the story varies.
  Helpers: `lib/anthropic-cache.ts`.
- **Isolation.** The lab lives in its own app route, `/memes/lab`, beside
  `/reels` and `/explainers`. It is not inside `/social`, whose scope tests
  allow hub pages to write only to `social_hub`. No carousel, reel, story or
  explainer code imports the lab, and the lab writes only to its own `memes`
  schema.
- **Database.** The `memes` schema runs on local PGlite first, the pattern
  `lib/stories/local-db.ts` uses. It is applied to Supabase only when Lucas
  says so.
- **Worker.** Generate queues a request; the social worker
  (`helios-social-worker`) claims and runs it, the way Regenerate works
  (`social.rerun_requests`). Deploying the worker change needs Lucas's
  go-ahead (CLAUDE.md worker sync).
- **Model.** Writing uses a `MEME_MODELS` setting like
  `lib/social/pipeline/models.ts` (Claude Sonnet 5.5 to start). Judging uses
  Jev.

## Cost per Generate click (estimate)

With Sonnet 5.5 at $2 per million input tokens and $10 per million output
(`lib/anthropic-pricing.ts`):

| Step | Tokens | Cost |
|---|---|---|
| Writer: cached prefix (~20K) | first click in an hour writes the cache; later clicks read it | ~$0.08 cold, ~$0.004 warm |
| Writer: the story (~5K in) and the mappings (~4K out) | | ~$0.05 |
| Jev judges (4 judges × ~6 candidates, plus a pairwise "funny" round) | ~100K input | < $0.01 |
| **Total** | | **~$0.06 warm, ~$0.14 cold** |

A landscape click adds the stack-up (Jev over every pair of ~15 stories, about
$0.01) and a longer story input (about $0.02). Both stay under the $0.25 cap.

## Milestones

### M0 · The `memes` schema, catalog and situations in code
- `db/memes_schema.sql`:
  - `templates`: the catalog, with family key, card, status and image path.
  - `template_uses`: the 90-day ledger: reserved, published and released dates (ME-44).
  - `requests`: the lab's queue.
  - `slates` and `memes`: what a click produced, with slots, judge scores and cost.
  - `picks`: the pick, reject tags and note (ME-64). This is the reinforcement signal (ME-06).
  - `situation_uses`: the 3-day rest (ME-65).
- `lib/memes/catalog.ts` and `lib/memes/situations.ts`: typed data copied from
  the approved cards and situations. They are the source the prompt and code
  read.
- The 25 template images saved under `lib/memes/assets/templates/`.
- **Accept:** the schema loads on PGlite; tests prove the catalog holds exactly
  the 25 approved cards and none of the 9 excluded, the situations hold
  AS-01 to AS-20, and every situation and template a card names exists.

### M1 · The 90-day gate (ME-40 to ME-45)
- `templateAvailable(family, at)`: one query, run before generation and again
  before any publish.
- `reserve`, `markPublished` and `release`.
- The image-similarity safety net: a perceptual hash, so a template that
  near-duplicates one on cooldown is blocked too.
- **Accept:** SQL tests on PGlite:
  - a reservation blocks its family;
  - a publish blocks it for 90 days and frees it on day 91;
  - a release frees it;
  - a variant in the same family is blocked;
  - a near-duplicate image is blocked.

### M2 · The renderer
- Per-template slot geometry: a box for every slot, measured on the image.
- An HTML template rendered by headless Chromium (Playwright), the Stories
  renderer's pattern, onto the 1080×1350 carousel canvas. Instagram crops
  every slide of a carousel to one ratio, so the meme is placed on the canvas
  rather than shown at its own size.
- Inter Medium for text (ME-23), logo chips from the logo bank, and no
  Helios branding (ME-24).
- Code checks:
  - text fits at a minimum size;
  - no chip or text box overlaps a face, using the MediaPipe face detector the
    photo step already uses (ME-12);
  - burned-in text is left clear.
- **Accept:** all 25 templates render with sample fills and pass the checks.
  Lucas reviews a contact sheet.

### M3 · The writer (single-story)
- Input: a carousel's Reporter brief (`social.posts.brief`), read per request.
  It is a lookup, never a sweep.
- One cached Claude call, with structured tool output:
  - the story's shape and the situations that fit;
  - about 6 mappings across at least 3 templates, chosen only from templates
    the gate says are available;
  - every slot filled: entity slots by player id, text slots with the fact
    IDs they rest on (ME-32), viewer slots from the situation's line.
- Code validation, with one retry:
  - ids exist in the registry;
  - cited facts exist in the brief;
  - slot kinds match the card;
  - lines fit their boxes;
  - no excluded template is used.
- **Accept:** with canned tool answers, tests cover a valid slate, each
  validation failure, the retry, and the cost cap stopping a run.

### M4 · The judges and the slate
- Jev question sets, each a new versioned set whose wording Lucas approves
  before it is wired in:
  - **relevant:** does the mapping fit the story's shape?
  - **accurate:** is every claim supported by the facts?
  - **clear:** a back-translation test: from the meme and the headline alone,
    would a reader take away the intended relation?
  - **funny:** a pairwise round between candidates.
- The slate is the top 3 on 3 different templates (ME-61). The voice-block and
  humanizer checks run on every line (ME-07).
- **Accept:** with stubbed Jev, tests cover the ranking, the
  three-different-templates rule, and a candidate dropped by each judge.

### M5 · The lab page, the queue and the worker job
- `/memes/lab`:
  - a picker of recent carousel stories that have a brief;
  - Generate, which queues a request;
  - the slate of 3 rendered memes;
  - Pick, and Reject with the ME-64 tags and an optional note;
  - each click's cost.
- The social worker claims requests and runs M3 → M4 → M2.
- **Accept:** end to end on PGlite with stubbed models. Then, with Lucas's
  go-ahead, the worker is deployed, and **the first live run is Lucas clicking
  Generate**.

### M6 · Landscape memes (ME-70 to ME-74)
- The pool: blue-chip stories from the last 7 days (ME-72).
- Jev's stack-up decides the stories and their relation (ME-71). The writer
  gets several stories.
- The lighter fact check: one grounding question per claim against that
  story's source text (ME-74).
- A "Landscape" tab in the lab.
- **Accept:** stubbed tests for the pool window, the stack-up choice and the
  grounding drop. Then a live run by Lucas.

## Not in this plan

- Trending intake (ME-51, ME-52), after the lab works on the classic catalog.
  Know Your Meme's terms on scraping are read first.
- Wiring into carousels (ME-20, ME-21, ME-73), when Lucas says the lab is ready.
- Learning from picks (ME-06). M0 and M5 store every pick and reason from day
  one; using them comes later.
- Cards for the next 11 templates.

## Decisions this plan needs

1. **Go-ahead to start M0.**
2. **The 25 template images in the repo.** They are copyrighted stills used the
   way memes use them. Keeping them in the repo makes renders exact and
   offline; the alternative is fetching them from Imgflip at render time.
