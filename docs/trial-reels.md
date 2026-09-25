# Trial Reels — Build 1 operations

Nightly source ingestion and post-idea grouping. Product direction lives in
`planning/Trial Reels/PRODUCT_SPEC.md`; every decision behind the code is in
`planning/Trial Reels/BUILD_PLAN.md` §8.1.

Build 1 is sources and post ideas. Build 2 scores those ideas at the end of the
same nightly run and shows the leaderboard on `/reels`. Build 2 is signed off
(D-089). Copy and captions are Build 3. A scored idea with on-screen copy can
be sent to the visual pipeline from the Scores tab. A Jev call (P-12,
`color-route-v2`) picks a grade from the on-screen copy: `noir` (the dark
room), `paper` (white field, black type), or `orange` (about 80% of the frame
in #FF5E1A, white type with a black stroke). That produces one 9:16 still. **Generate video** appears beside Generate frame once that still is
ready. The click only queues a row. The worker writes a Kling 3.0 motion
prompt from the background PNG, calls Kling 3.0 Standard on Fal for an
8-second clip with audio off, then overlays the text plate. The video model never receives the words.
Before that, a Jev call (P-11, `hook-route-v1`) reads only the on-screen copy
and picks a full-screen hook: `glitch`, `color_bars`, `invert`, `vhs`,
`thermal`, or `blue_screen`. When the hook is about to be stamped, one of
three timings is picked with equal chance: on 0.2 / off 0.1 / on 0.2, five
0.1-second beats, or the same beats inside 0.6 seconds ending on a 0.2-second
hold (`lib/reels/visual/hook.ts`). Kling never
receives the hook. `video_jobs.motion_prompt` stores the `Hook:` line followed
by the block Kling received.

## Where it runs

| Piece | Where |
|---|---|
| Review page `/reels` | Vercel, with the rest of the app |
| Nightly run | GCP VM `helios-orch-worker`, systemd unit **`helios-reels`** |
| Storage | Existing Supabase Postgres, schema `reels` |

The app never executes a run itself. **Run now** on `/reels` inserts a row with
status `requested`; the worker claims it within about 15 seconds. A full ingest
outlives any serverless request, which is why it works this way.

## First-time setup

```bash
npm run db:reels                        # create the reels schema

# worker.env needs TYPESAFE_API_KEY (and optionally GITHUB_TOKEN)
./scripts/gcp/deploy-worker-code.sh     # ships current repo code to the VM
./scripts/gcp/deploy-reels-worker.sh    # installs + starts the helios-reels unit
```

Verify:

```bash
gcloud compute ssh helios-orch-worker --zone=us-west1-a \
  --command='sudo systemctl status helios-reels --no-pager'
```

## Local

```bash
npm run reels:probe            # dry-run every source: no Jev, no Claude, no writes
npm run reels:probe -- --full  # also follow one pointer per source to test full-text
npm run reels:run              # one real run now, then exit
npm run reels:worker           # schedule 1 AM America/New_York and poll for Run now
npm run test:db:reels          # whole pipeline against the DB, Jev and HTTP stubbed
```

Start with `reels:probe`. It proves every feed URL and parser for free, so a
broken source shows up before a paid run rather than during one.

`npm run dev` does **not** start the reels worker. Run it in a second terminal
if you want Run now to do anything locally.

## REELS_GITHUB_TOKEN (required for A1 and A4)

GitHub allows 60 API calls an hour unauthenticated, and each repo costs three
(metadata, README, latest release). One night needs roughly 40 to 70, so
Trending fails and the A4 editor cannot build its picks. A token raises it to
5,000 an hour, which makes both problems disappear.

**A personal access token is all this needs. A GitHub App is not required.**
Everything Reels reads is public, so the token needs no permissions at all and
there is nothing for an App's installation model to add.

### Classic PAT (simplest)

1. https://github.com/settings/tokens/new
2. Note: `helios-trial-reels`
3. Expiration: 90 days, or no expiration if you would rather not rotate it
4. **Tick no scopes.** Leave every checkbox empty. An unscoped classic token
   still gets the full 5,000/hour authenticated limit on public data.
5. Generate and copy the `ghp_…` value

### Fine-grained PAT (equivalent, if you prefer)

1. https://github.com/settings/personal-access-tokens/new
2. Resource owner: your account. Repository access: **Public repositories
   (read-only)**
3. Leave every account and repository permission at **No access**
4. Generate and copy the `github_pat_…` value

### Install it

```bash
# .env.local, and scripts/gcp/worker.env when the VM unit goes in
REELS_GITHUB_TOKEN=ghp_your_token_here
```

Use `REELS_GITHUB_TOKEN` rather than `GITHUB_TOKEN`. The plain name is also the
bootstrap fallback for Client Dashboards' repo sync, and giving that product a
public-read token would turn "no token configured" into a confusing 404 on
private repos. Reels falls back to `GITHUB_TOKEN` if the specific one is unset.

Check it:

```bash
curl -sS -H "Authorization: Bearer $REELS_GITHUB_TOKEN" https://api.github.com/rate_limit \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["resources"]["core"])'
# expect limit: 5000
npm run reels:probe    # GitHub Trending should return ~25 repos, A4 its lists
```

### Why not a GitHub App

An App would mean registering it, storing a private key, signing a JWT,
exchanging that for an installation token, and refreshing it every hour. The
payoff would be a higher rate limit, and there isn't one: an App installation
gets the same 5,000 requests an hour for this workload. Apps earn their keep
when you need per-organization installs, fine-grained write access, or webhook
identity. Reads of public repositories need none of that.

## Cost

Jev makes every judgment at $0.042 per million input tokens; a night is
fractions of a cent. Claude is called once per night for the B6 story, and only
after that prompt is approved.

Measured on the first nights: about **$0.02 of Jev** for a full night (roughly
350 ingest, grouping, and editor calls) and **$0.25 to $0.35 for the single B6
story**, which is most of the bill. Roughly $8 to $11 a month at nightly
cadence.

The spend watch is **$50/month** (D-023). It is checked once before a run
starts: at or over the ceiling the run records `skipped` and does nothing. A run
already under way is never aborted partway, because a half-ingested night is
worse than a slightly expensive one.

## The B6 gate

The nightly web-search story is the one language-model prompt in Build 1. It
was approved 2026-09-22 as `web-search-v1` (D-070), but the flag is still the
operational switch: the source reports `skipped` and makes no Claude call
anywhere `REELS_B6_PROMPT_APPROVED=true` is not set.

Set it in `.env.local` to include B6 in local runs, and in `worker.env` when
the VM unit goes in. Changing any wording in
`lib/reels/prompts/web-search.ts` means a new version and a new registry row —
old records have to keep meaning what they said.

## The copy writer gate (Build 3)

After scoring, the run writes one on-screen copy and one caption for each of
the three selected ideas (P-10, `copy-caption-v5`, `claude-sonnet-5`, one cached
call each). Lucas approved that prompt on 2026-09-23. It makes no call anywhere
`REELS_COPY_PROMPT_APPROVED=true` is not set, and the page says so.

On the Scores tab, **Generate Copy + Captions** queues that same writer for
one post idea, including ideas that were not selected. The idea needs a
winning bucket and framework. The `helios-reels` worker claims the job; the
page does not call Claude itself. A second click replaces that slate's copy.
The on-screen copy comes back with a line break at each natural pause, on
one screen, inside the bucket's word range.

The writer from before that word-count reinforcement (`copy-caption-v1`) is
kept, unused, at `lib/reels/threads/post-engine-candidate.ts` as a candidate
Meta Threads post engine. The reel pipeline does not call it.

The prompt's bucket, framework, and humanizer text is frozen from
`planning/Trial Reels/PRODUCT_SPEC.md` and `.cursor/skills/humanizer/SKILL.md`
into `lib/reels/copy/source-text.generated.ts`, because the worker deploy
excludes `.cursor/`. After editing either file run
`npm run reels:sync-copy-text`, bump `COPY_PROMPT_VERSION`, and get the new
wording approved. `npm run reels:copy-preview` writes the assembled prompt for
the latest slate's three to `tmp/reels-copy-preview/` without calling a model.

## Whole generation

On the Scores tab, **Whole generation** walks one scored post from whatever
stage it has reached to a finished reel. No copy yet starts at copy. Copy
already written starts at the frame. A frame already made starts at the video.
The page records `reels.finish_requests` and queues only the first missing
stage. After each stage the `helios-reels` worker queues the next, including
when the tab is closed. A failed stage stops the walk. Clicking the button
again retries that stage.

## Reel frames

On the Scores tab, **Generate frame** queues one still for a post idea that
already has on-screen copy. The `helios-reels` worker runs it: Claude writes
the scene, GPT Image 2 (`gpt-image-2`, 1152×2048) makes the 9:16 background,
the text engine checks the dark center band, then composites the whole
on-screen copy onto that one still. A reel is one screen. A background that
fails the check is stored as that status and is not retried. Copy longer than
a headline is rebroken and may step down
to the preferred minimum so the block stays in the dark center, inside the
side margin, with clear space around it. Lines that still do not fit at that
size are left off the still.

A passing background is reused when the same post idea is generated again with
the same on-screen copy, so a second click does not buy another image. The
scene, the prompt, the QA, and the cost are written on the job even when the
PNG upload fails. Uploads time out and retry on a gateway error.

The worker needs `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. Text compositing
uses `helios_text_engine/` (Pillow and NumPy in `helios_text_engine/.venv`,
created on deploy). Frames are PNGs in the private Supabase bucket
`reels-frames`.

## What a night does

1. **Ingest.** Each adapter pulls, code follows pointers to full text, and
   anything without freely available full text is skipped. Papers and model
   cards are exempt: an abstract counts as full text.
2. **Screen.** One Jev call per item covers off-topic, junk, non-English, and
   planted instructions. Only a decisive yes drops an item; anything uncertain
   stays in the pool.
3. **A4 editor.** The awesome-lists are a standing catalog. Jev picks which
   entries deserve tonight's slots, with a floor of 2 so the type is always in
   the mix.
4. **B6**, if approved.
5. **Group.** Exact URL matches auto-merge with no model call. Otherwise a
   Postgres shortlist of up to 5 candidates from the 72-hour reference pool
   goes to Jev: same event? then merge, link, or leave. The whole shortlist is
   scored and the source attaches to the strongest match. Below the confidence
   bar it stays its own post idea and is not flagged.
6. **Fuse ideas.** A source only ever joins one idea, so two ideas can form
   around one event. A second pass proposes idea pairs in code (headline
   similarity across their members) and asks Jev whether to fuse them,
   repeating while anything still merges.
7. **Score and write.** Jev scores and ranks the timely ideas, the top three
   are selected, and, if P-10 is approved, the writer produces their copy and
   captions.
8. **Retain.** Sources older than 3 weeks are hard-deleted. Fingerprints,
   published-status rows, and Jev logs outlive them.

## Tuning after real nights

These are the numbers most likely to be wrong, all in `lib/reels/config.ts`:

- `HIGH_CONFIDENCE` (0.8) — the merge/link bar. Set provisionally; tune against
  the wrong-merge and missed-link marks on the page, which are the calibration
  set.
- `FULL_TEXT_MIN_CHARS` (600) — below this a page is treated as a teaser. If
  real articles show up under `no_full_text` on the pool tab, lower it.
- `ARTICLE_FEED_CAP` (15), `A4_NIGHTLY_FLOOR` (2), `A4_NIGHTLY_CEILING` (5).

Every drop stays visible on the pool tab with its reason, so an over-aggressive
filter shows up as a pile of dropped rows rather than a quiet empty pool.

## Worker sync

`helios-reels` runs the same checkout as `helios-worker`. Changing anything
under `lib/reels/**` or `scripts/reels_worker.ts` means redeploying:

```bash
./scripts/gcp/deploy-worker-code.sh     # new code (restarts helios-worker)
gcloud compute ssh helios-orch-worker --zone=us-west1-a \
  --command='sudo systemctl restart helios-reels'
```

A Vercel deploy updates the `/reels` page only, never the nightly run.
