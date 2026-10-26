# AI Events This Week: hand-off

Written 2026-10-21 at the end of the build. Decisions are in `DECISIONS.md` (AE-01 to AE-21). Nothing is committed, merged or deployed.
- Hub: branch `feat/ai-events-weekly`, uncommitted, in `/Users/lucasfigueroa/HELIOS/CODE/The-Helios-Hub`.
- Website: branch `feat/free-tools-events`, uncommitted, in the worktree `/Users/lucasfigueroa/HELIOS/CODE/FIGMAHELIOSWEBSITE-free-tools`.
- The VMs still run `origin/main` 0bd52b7 and know nothing about this type.

## What was built

**Networking ingest v2 (`lib/networking/*`, `db/networking_schema.sql`).**
- The ingest now covers four metros: Miami, Boston, NYC (30 mi) and the SF Bay Area (45 mi, San Jose included). The internal `/events` calendar still shows only Boston and Miami (`INTERNAL_METROS`).
- Fixed sources:
  - Luma calendars resolve again, and calendar copies of an event are merged.
  - Meetup resolves its `__ref` pointers, so venue and group are kept.
  - Bevy uses a fixed lat/long search.
  - The conferences source maps the new row shape and stores anchors.
- Eventbrite is out of the registry (AE-07).
- Every event now keeps the signals the ranking needs:
  - organizer and hosts (names, short bios)
  - guest count and capacity
  - sold out, waitlist, approval and price
  - organizer track record
- Luma `featured_guests` are never read.
- The orchestration worker:
  - queues the weekly ingest from **Sunday 9:00 AM New York time**, once per ISO week (dedupe key `sunday:<week>`).
  - runs a separate `networking.event_details` job after each successful ingest. It fetches Luma `event/get` and Meetup event pages for kept events in the next 10 days that have no details yet, 3 at a time. Each event is fetched once.
  - publishes the public calendar snapshot when that job finishes.

**Event ranking (`lib/networking/pick/*`).**
- Candidates are the coming Monday to Sunday's in-person tech/both events in each city, capped at 30 per city.
- Each event is asked Jev `event-pick@1` once. It is 10 yes/no questions, wording approved in AE-18, merged with `planted-v1`. Answers are cached in `networking.event_scores`, so an event already scored is never asked again (AE-05).
- The score adds code terms to the answers: attendance, demand, anchor roster, satellite of a tech week, and track record.
- Picks, per city:
  - pins first
  - at most one per organizer
  - day spread
  - bar 3.0
  - top 3
- Jev spend:
  - Each call is logged in `networking.jev_logs` and `networking.cost_events`.
  - A run is capped at `run_cap_usd` ($0.50).
  - Expect about $0.02 a week.
- No Claude calls anywhere in this type, and the Social Hub never imports the Jev side (pinned in `tests/social-hub-scope.test.ts`).

**Public snapshot, bucket and deploy hook (`lib/networking/public-snapshot.ts`, `public-feed-storage.ts`, `deploy-hook.ts`).**
- The snapshot is `public-feeds/networking/events.v1.json` with `Cache-Control: public, max-age=300`.
- It holds scheduled tech/both events in the 4 metros for the next 60 days, plus this week's Helios picks.
- It never carries bios, LinkedIn handles, access evidence, raw payloads, database ids or featured guests.
- It is published:
  - after the details job
  - after each AI Events run
  - when an AI Events post goes live
  - from the "Publish to website" button on `/events`
- An empty feed is refused once something has been published.
- The Vercel deploy hook fires only when `VERCEL_DEPLOY_HOOK_URL` is set, the content changed, and at least an hour passed since the last fire. It retries once. The URL is never logged or sent to a browser.

**Social Hub type `ai_events` (`lib/ai-events/*`, `db/ai_events_schema.sql`, `/ai-events`).**
- The weekly pool shows tabs per city with score, parts and gate reasons.
- Each event has Pin, Exclude and Clear buttons.
- **Generate** queues a build. **Rebuild post** re-renders from cached scores, without asking Jev.
- A run:
  1. ranks the week
  2. draws a hook (7 lines, none of the last 4) and a look (4 looks, none of the last 2)
  3. builds the caption by code
  4. renders up to 6 slides
  5. books Sunday 6:00 to 7:00 PM only while `publishing_live` is on
  6. republishes the snapshot
- Settings ship safe: `auto_run` false, `publishing_live` false, `require_approval` true, days `[0]` (Sunday), cap $0.50.
- Worker wiring in `scripts/social_worker.ts`:
  - the Sunday 12:00 PM clock
  - the claim, after Last Few Days', under a 30-minute timeout
  - release and publish while the single publisher doesn't drive the type
  - insights
- The publisher driver is in `scripts/publisher_worker.ts`.
- The deploy guard line is in `scripts/gcp/deploy-social-worker.sh`.

**Carousel templates (`lib/social/render/ai-events/*`).**
- Four looks: Spotlight, Obsidian glass, Daylight (the white exception, AE-14) and The orb.
- Each has a cover, up to 4 city slides and a CTA slide.
- The whole Helios mark is never cropped or covered, the lit line is solid orange with a glow, icons are Lucide, and there are no emoji.
- Gallery: `/social/render/preview/ai-events`.
- Fit check: `npx tsx --test tests/ai-events-render.integration.ts`.

**Website (worktree `feat/free-tools-events`).**
- `/free-tools` index page.
- `/free-tools/ai-networking-events`, a phone-first calendar:
  - Helios picks first, then an agenda by week.
  - Filters for city, free, picks and apply/waitlist live in the URL. The city choice is remembered on the device.
  - RSVP and Add to calendar (`.ics`).
  - Prerender bakes the events in.
- `/social-landing` is Home plus the Free Tools popup, with `noindex`.
- Phone nav is a hamburger menu below 768px (AE-17).
- Design-system tokens and Roboto are scoped to `.hds`, so the rest of the site is untouched.

## Commands for Lucas, in order

All of these hit the production database that `.env.local` points at. Agents do not run them.

### 1. Schemas and bucket

- **Networking:** applied 2026-10-21. Re-applying is safe: `npm run db:networking`.
- **`public-feeds` bucket:** created. Re-running is safe: `npx tsx scripts/create_public_feeds_bucket.ts`.
- **ai_events and social_hub:** listed as "to apply" in the plan. A read-only check during the final review (2026-10-21) found both already in production:
  - `ai_events.runs`, `posts`, `pool` (with `pick_rank`) and `settings` exist, with the safe seeds.
  - `social_hub` content_items, schedule, publish_attempts and idea_adjustments checks include `ai_events`.

  Both scripts are idempotent. Run them again before merging so any late edit lands, ai_events first (its pool references `networking.events`):

  ```bash
  node scripts/apply_ai_events_schema.js
  node scripts/apply_social_hub_schema.js
  ```

- **Known gap:** the production `social_hub.settings` `daily_caps` row predates `ai_events`, and the seed is insert-if-missing, so it has no `ai_events` key. The code falls back to the default cap of 1, so nothing breaks.

### 2. Refresh the events: $0, HTTP only

Already run once on 2026-10-21 (977 kept events, feed live with 910). Run again any time:

```bash
npx tsx scripts/networking_ingest_once.ts
```

- It runs the ingest across all sources and the four metros, then the detail fetches, then the snapshot.
- It prints per-source and per-metro counts and signal coverage.
- It writes `networking.*`.

### 3. A ranked run: Jev, about $0.02

1. Open the hub. Use `npm run dev:web`, which serves http://localhost:3000.
   - Plain `npm run dev` also starts a local orchestration worker. That worker becomes primary over the VM and runs this branch's orchestration code, including the Sunday ingest.
2. Open http://localhost:3000/ai-events and click **Generate**. This queues a `requested` run; the click is the approval for the spend.
3. Carry the run out locally:

   ```bash
   npx tsx scripts/ai_events_once.ts --peek   # shows what is queued, claims nothing
   npx tsx scripts/ai_events_once.ts          # claims the queued run and carries it out
   ```

   - It asks Jev about events not yet scored (about $0.02, capped at $0.50).
   - It renders with local Chromium, uploads the slides and publishes the snapshot.
   - `publishing_live` is off, so nothing is booked or posted.
4. Back on `/ai-events`, check the pool:
   - 4 city tabs with scores, parts and gate reasons
   - pin or exclude an event, then **Rebuild post**
   - run `npx tsx scripts/ai_events_once.ts` again. The rebuild asks Jev nothing.

### 4. Website

```bash
cd /Users/lucasfigueroa/HELIOS/CODE/FIGMAHELIOSWEBSITE-free-tools
npm run dev            # http://localhost:5173
```

- Pages:
  - http://localhost:5173/free-tools
  - http://localhost:5173/free-tools/ai-networking-events
  - http://localhost:5173/social-landing
- Feed: https://okslkogkokdwylmcsygz.supabase.co/storage/v1/object/public/public-feeds/networking/events.v1.json
  - Set `VITE_EVENTS_FEED_URL` in that worktree's `.env.local` to point at another snapshot.
- Sample mode, for dev only: add `?sample=1`, e.g. http://localhost:5173/free-tools/ai-networking-events?sample=1. It uses a bundled sample feed and is dropped from production builds.
- Production build with prerender: `npm run build`. The events are baked into `dist/free-tools/ai-networking-events/index.html`.

### 5. Vercel deploy hook

Do this after the website branch is merged to `main`. Before that, the hook would rebuild a `main` that has no calendar page.

1. In Vercel, open the project **heliosmarketingwebsite**, then Settings, then Git, then **Deploy Hooks**.
2. Create a hook (name e.g. `hub-events-snapshot`) on branch `main`, and copy its URL. The URL is a secret.
3. Set `VERCEL_DEPLOY_HOOK_URL=<url>`, with no quotes, in three places:
   - the hub's `.env.local`
   - the orchestration VM's `/opt/helios-worker/worker.env`, via `scripts/gcp/worker.env` (the "Update env on the VM" steps in `docs/gcp-e2-micro-worker.md`)
   - the social VM's `/opt/helios-social/worker.env`, via `SOCIAL_WORKER_ENV_FILE=… ./scripts/gcp/deploy-social-worker.sh`
4. The orchestration VM also needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the snapshot upload. Without them the details job still succeeds, but its snapshot step reports an error.

Without the URL, every publish logs `skipped:no_hook_url` and the site only picks up new events on its next normal deploy. The page also fetches the live JSON, so visitors see fresh events either way. The hook is only for SEO.

### 6. Deploy order, later and only when you say so

1. **Apply schemas** (step 1). The social VM's deploy guard skips the `ai_events` line until `ai_events.runs` exists, so a deploy before the apply no longer turns the whole in-flight check off.
2. **Merge** `feat/ai-events-weekly` into `main`. Vercel then serves `/ai-events`.
3. **Orchestration VM** (Sunday ingest, details job, snapshot):

   ```bash
   ./scripts/gcp/deploy-worker-code.sh
   ```

   Deploy soon after the merge. A `networking.event_details` job claimed by old VM code fails with "No orchestration handler registered", and that week's detail fetches are skipped.
4. **Social VM** (noon clock, runs, release and publish, publisher driver):
   1. Hash a few files on the VM (`/opt/helios-social/app`) against `origin/main` and any open PR branches. The VM has run unmerged branches before.
   2. Re-read the worker log right before deploying (`sudo journalctl -u helios-social -n 200`). A restart kills a run in flight.
   3. Deploy from a clean worktree of `origin/main`, never from the main folder:

      ```bash
      ./scripts/gcp/deploy-social-worker.sh
      ```

5. **Website:** merge `feat/free-tools-events`, let Vercel deploy, then create the deploy hook (step 5).
6. **Turn it on** on `/ai-events`:
   - Settings, "Generate on Sundays": this sets `auto_run`, for the Sunday noon run.
   - The Live toggle: this sets `publishing_live`. Turn it on once you trust the posts. Leave auto-publish off so approval stays required.

### 7. Instagram bio link

Set the bio link to **heliosgroup.ai/social-landing**, after the website deploy. It opens Home with the Free Tools popup on every visit. Every slide says "link in bio" (AE-16).

## Known limitations

- **Late starts catch up.** A social worker that starts after 12:00 PM checks the clock at once (`firstAiEventsCheckAt`), so a Sunday-afternoon restart still runs the week. A week that already has a post skips itself.
- **A slot more than 60 minutes late is cancelled.** A post never goes out late (e.g. Monday).
- **Template mode needs a slot.** In template mode (`slot_source = 'template'`, still `legacy` today), the Sunday run and booking need an AI Events slot on the calendar. Add one, Sunday 6:00 PM, before flipping the switch.
- **Type casts.** `lib/ai-events/config.ts` uses `AI_EVENTS_SPINE_VERTICAL` and `AI_EVENTS_SLOT_VERTICAL`, which are `as unknown as` casts, because `SpineVertical` and `Vertical` were not widened together. They are harmless, and can be removed once both unions include `ai_events`.
- **Stored scores move on a rerun.** A rerun recomputes `score`, `gate` and `parts` in `networking.event_scores` from the stored Jev answers plus current attendance. Jev is never asked again. Switching to write-once is a small change if you prefer it.
- **Outcome text needs your approval.** The yes/no outcome descriptions under each `event-pick@1` question (`lib/networking/pick/questions.ts`) are Claude's drafts. Only the question wording was approved (AE-18). Check them before trusting the ranking.
- **The cap can be overshot slightly.** Up to 6 Jev calls already in flight can finish past the $0.50 cap.
- **Emails stay in summaries.** Email addresses written in a listing description stay in the public 280-character summary. Links are removed.
- **Analytics needs Pro.** Website custom events (`popup_shown`, `rsvp_click`, …) record only on Vercel Pro. Check the plan.
- **Eventbrite is off** until the VM's IP is unblocked (AE-07).
- **Mixed versions.** Until the merge and deploys, the production hub on Vercel and the VMs run `main`. A local test run writes `ai_events.*` and a spine item, but books no slot while `publishing_live` is off, so the live workers never see an AI Events slot.

## Calibration next steps for `event-pick@1`

The v1 weights in `DECISIONS.md` (Score v1) are a starting guess. Calibrate them on your grades, with the memes method (`planning/Memes/PREDICTOR.md`, `scripts/memes_calibrate_golden.ts`):

1. **Collect grades.** Run 3 to 4 weeks and grade every pooled event per city: would you post it, yes or no, and optionally 1 to 5. Aim for at least 150 graded events, including gated-out ones.
   - The hub has no grading control for this type yet. Grade in a sheet keyed by event title and week, or add a small grade column to `ai_events.pool` first.
   - Pins and excludes count as weak labels.
2. **Measure AUC.** For each question and each code term (attendance, demand, roster, satellite, track record), compute AUC against your grades. Do the same for the full score and for a length-only baseline.
3. **Re-weight.**
   - Keep weight only on parts at or above the 0.7 bar (ME-111).
   - Set a part below the bar to weight 0, but keep asking it for the record (as ME-112 and ME-120 did).
   - Re-fit the remaining weights, and check the bar of 3.0 against the score of your lowest "yes".
4. **Re-check the gates.** Look at events a gate dropped that you would have picked. Move a threshold only where the AUC supports it.
5. **Version and log.** Ship the result as `event-pick@2`, or `score v2` if only the formula changes, with a `DECISIONS.md` row. A new question-set version makes each event be scored once more under it. That is about $0.02 per week of events, and only for the weeks being ranked, never a sweep (AE-05).
