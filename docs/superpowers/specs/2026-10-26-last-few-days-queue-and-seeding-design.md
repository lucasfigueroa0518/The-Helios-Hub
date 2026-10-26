# Last Few Days: the pool standard and seeding (2026-10-26)

**Status:** design pass for Tommy's review; not built. Everything marked **(my call)** or **(guess)** is mine to be checked; nothing here was decided in an interview yet.
**Part of:** [2026-10-21-idea-pool-standard-design.md](2026-10-21-idea-pool-standard-design.md) and [2026-10-21-idea-seeding-design.md](2026-10-21-idea-seeding-design.md) (the Last Few Days rows). Model for shape: [2026-10-25-carousels-seeding-design.md](2026-10-25-carousels-seeding-design.md).
**Branch:** `unify-social-hub`.

## What I found (read from the current tree)

- **There is no standing pool.** A run builds its candidates from scratch each time ([lib/lfd/run.ts](../../../lib/lfd/run.ts) `gather`): the Text on Screen lane (`reelsLane`: reels ideas whose first timely slate falls in the window since the last post), the carousel shortlists since the window start, and a fresh-feed pass ([lib/lfd/sources.ts](../../../lib/lfd/sources.ts)). About 60 are judged once by Jev (`scoreMajor`, major-news@2, bar 0.55), merged one-per-event, then `Selector.fill` takes up to 3 **major headlines** (judged at or above the bar, best first), then fills to 6 from the **Text on Screen ideas** lane (blockbusters, then best net), at most 2 per company, none repeating the last 2 posts ([lib/lfd/pick.ts](../../../lib/lfd/pick.ts)). Slides then go majors first, rundown after; Jev `lfd-lead` re-orders for the cover.
- **The hub's "pool" is a display of the last run** ([queries/last-few-days.ts](../../../lib/social-hub/queries/last-few-days.ts) `LFD_LATEST_RUN_SQL`, [adapters/last-few-days.ts](../../../lib/social-hub/adapters/last-few-days.ts) `lfdIdeas`): its picks, its drops, and the top 10 of each lane's queue (`record.queues`, rows of key, headline, scores; **no url**). It is rebuilt by the next run, whose window starts after the last post, so most unpicked rows are not candidates again. `QUEUE_LIVE` in [lib/social-hub/queue.ts](../../../lib/social-hub/queue.ts) does not list Last Few Days, so no pin/drag controls show today.
- **One post per run (Tue and Fri by default), triggered by the 3:00 clock or "Make Last Few Days now"** ([manual.ts](../../../lib/lfd/manual.ts), `requestRun`). There is no per-story Generate: a story is never made alone.

## Decisions

### The pool standard, honestly (question 1)

- **Archive: yes (my call).** An archive row in `social_hub.idea_adjustments` (id `last_few_days:story:<key>`, the id `lfdIdeas` already gives) keeps that story out of every later run. Cheap and exact: the run adds archived keys to the `used` set it already passes to `withoutUsed`. Works for machine stories and seeds.
- **Pin: not on run-record rows today.** Their record has a key but no url, and the key is a hash of the url, so a pin has nothing to fetch. **Smaller version, phase 2 (guess):** write `url` into `record.queues` rows (one field in `queueRow`), then a pin on a row copies it into a seed ("Include in next run"). Until then, Pin does not show on Last Few Days.
- **Drag: out.** Post order is lanes plus Jev's cover choice; a hand order would override the cover judgment, and with one post a run there is no queue to drag within. No false promise: no handle.
- **30 open ideas:** already met by construction (2 lanes x 10 shown, seeds capped at 10). Generate: the existing "Make Last Few Days now" always works; idea rows get no Generate button. Add `last_few_days` to `QUEUE_LIVE` only if Archive-only controls are wanted, with the page showing just Archive for it (builder decides the cleanest way).

### What a seed is (question 2)

- **A link to the story, optional headline (my call, as Carousels).** The run needs the article's full text (500+ characters, fact-checked against it), a url for the lead photo and the repeat check. A bare headline cannot supply that without web research, so it is out. Pasted story text with no link: question 3.
- **Where it lives: no schema change (my call).** One row per seed in the existing `lfd.settings` table: key `seed:<storyKey>`, value `{ url, headline, outlet, body, addedAt, expiresAt, status, outcome? }`. A row per seed (not one JSON list) so the hub write and the worker's "mark made" never overwrite each other. `parseLfdSettings` ignores unknown keys. Expiry 7 days (two runs), at most 10 open.
- **Marked "Yours"** in the Ideas view (state idea_only, chip), with its outcome after a run: used, or why not.
- **Adding costs nothing:** `addLfdSeed` validates the link, reads the page with the plain `fetchBody` (no model), refuses an unreadable page or the 11th open seed, and refuses a duplicate of a story already in the latest post. No scoring at add time: the run scores every candidate anyway.

### How the run reads them (question 3 of the brief)

New file `lib/lfd/seeds.ts` (reads open seeds, archived keys, and writes outcomes), so changes to Lucas's files stay small:
1. `gather` adds seeds as candidates (`origin: 'seed'`, `yours: true`), scored by the same `scoreMajor` (one more Jev call each, inside the run cap), placed first in the `mergeSameEvent` list so a seed absorbs a same-event duplicate rather than being folded into it (`fold` keeps the earlier key).
2. `Selector` gets a `forced` list taken before the lanes: up to **3 seeds per run (guess)**, lane `major` if at or above 0.55, else `rundown`. They bypass the company cap and the "covered last time" check, which exist to stop machine repeats. If a person's story cannot be used, it is kept open and the run record says why.
3. **Never silently dropped:** `record.seeds` lists each taken seed and its outcome (`in the post`, or `thin-text`, `not-grounded`, `no-photo` and the other existing drop reasons, or `waiting: this run already had 3`). The Ideas view prints it. A seed that shipped is marked made; one that failed stays open until it expires or is archived.
4. **No seeds, no archives: nothing changes.** `forced` is empty, the extra candidates list is empty, the used set is unchanged; the only addition is two SELECTs. A test asserts identical picks.

### Cost and Rule 1 (question 4)

- Adding a seed: no model, no search, $0. The button says so.
- Using it: one `major-news` Jev call (a fraction of a cent) plus the story's share of the normal run (writing, fact check, photo), within the existing `run_cap_usd` and for a post the run was making anyway (6 slots). A seed replaces a machine story rather than adding one, so it does not raise the run's cost.
- Who pays: the run's own click or schedule. A seed never queues a run and never starts one. Tommy's "Make Last Few Days now" click authorizes it as today; the scheduled run is unchanged.

## Risks (question 5)

- **Live run:** the new reads must never fail a run. Seed and archive reads are wrapped so an error means "none" (as `seeds.ts` for Carousels does), recorded in `record.seedError`. A bad seed takes the existing drop-and-replace path, not a failed run.
- **Lucas:** he is changing LFD on main (Helios Premium in `app/social/render/preview/preview.css`, memes in `lib/memes/lfd-post.ts`, `lib/memes/lfd-sim/run.ts`, `lib/social/render/SlideTemplate.tsx`, `lib/lfd/worker.ts`, `lib/lfd/schedule.ts`, `lib/lfd/caption-lines.ts`). **Files I'd edit and their risk:** `lib/lfd/run.ts` (`gather`, the record) **medium**, `lib/lfd/pick.ts` (`Selector`) **low-medium**, `lib/lfd/types.ts` (Origin, `yours`) low, `lib/social-hub/adapters/last-few-days.ts` (`lfdIdeas`) **medium** (touched by the slot work), `lib/memes/lfd-sim/run.ts` calls the same run code (replay, no seeds). Worker, schedule, render, captions, memes: not touched.
- A meme or lighting change cannot clash with a seed; the one shared surface is `Origin`/`LfdCandidate`, so ask Lucas before merging that line.
- **Worker sync:** run changes are worker logic: redeploy `helios-social-worker` with `./scripts/gcp/deploy-social-worker.sh`, daytime, not before a Tue/Fri 3:00 run.

## Build (question 6)

1. `lib/lfd/seeds.ts`: `addLfdSeed`, `readOpenSeeds`, `readArchivedKeys`, `recordSeedOutcomes`.
2. `gather`, `Selector.forced`, `record.seeds`, the archive keys in `used`; mark made after `insertPost`.
3. `lfdIdeas`: seeds join as `yours` with outcome; archive hides a row.
4. `POST /api/last-few-days/seed` (session), "Seed an idea" form on the Last Few Days pool: "Adds the story to the next run. Nothing is made and nothing is spent."
5. Archive action on Last Few Days rows (existing archive handler; check it accepts the vertical).
6. Redeploy the social worker.

## Tests (offline; stubs only, no live model or web)

- No seeds or archives: `Selector` and `gather` give the same picks as before (golden).
- A seeded story with stubbed fetch and Jev is taken first, lands in the right lane, keeps its key through `mergeSameEvent`, and is marked made; a failed one stays open with its reason in `record.seeds`.
- 4 open seeds: 3 are taken, 1 shows "waiting". The 11th seed, an unreadable page, a bad link and a duplicate are refused with why. Expired and archived seeds are skipped.
- Archived machine story is not a candidate. A throwing seed read leaves the run unchanged.
- Jev call count: +1 per taken seed.

## Not in this design

Pin and drag, description-only or pasted-text seeds (unless question 3 says yes), editing a seed, per-story Generate, restoring archived stories.

## Questions only Tommy can answer, ranked

1. **Is Archive plus seeding enough, with Pin and drag left off Last Few Days?** Recommend yes: they promise a queue that does not exist. Phase 2 pin = copy a row into a seed.
2. **How many of your stories may one post hold?** Recommend 3 of 6, the rest wait.
3. **Allow pasted story text with no link?** Recommend no for now: no url means no lead photo and no repeat check; link first.
4. **Does a seed bypass the "already covered last time" and company-limit checks?** Recommend yes: it is your explicit choice, and the run says so if it was a repeat.
5. **7-day expiry (two runs)?** Recommend yes.
6. **Should a seed that fails (thin text, no photo) stay open for the next run or go?** Recommend stay, with the reason shown.

## Left to the builder

Exact copy, the duplicate wording, the Archive control placement, and fixtures.

## Decisions so far (Tommy, 2026-10-26)

- **Question 3: a seed needs a link.** Pasted text with no link is not accepted: a Last Few Days story carries an outlet, a headline and a link that the run reads, credits and repeat-checks, and text alone has none of that.
- Questions 1, 2, 4, 5 and 6 are still open (the recommended answers above stand until Tommy says otherwise).
