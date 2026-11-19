# Resource Tracker + game retune + hub card click (living plan)

Started 2026-11-19 with Bald-Eagle-Iteration. Lucas decides; open questions are marked **OPEN**.

## Lucas's asks (his words, 2026-11-19)

1. **Resource Tracker** — "a page in the website hub" that shows "when people click onto the networking calendar
   or into the game". "Toggle between the resources and just see the relevant stats for each one … I want each to
   have their own view." Build with "the impeccable UI/UX skill and also the dataviz skill".
   - Networking calendar: "how many people clicked through to RSVP on an event".
   - Are You Smarter Than AI: "how many people play each day"; for the players with the most games, "how people
     are performing each day overall"; "trends in players over time"; "trends in the AI's performance over time";
     "which questions were selected for that day".
   - "If you feel strongly that anything else should be shown, you can recommend it."
2. **Remove the question list** from the top of the Are You Smarter Than AI content page (`GameDayPanel`).
3. **Retune the game's question selection** so the AI does better: "3 out of 5 very quickly or 4 out of 5.
   Sometimes it can even be 5 out of 5 … because now we're also grading on speed." The lever is the selection rule.
4. **Social Hub cards:** "if I click anywhere on the card for a video or a post, then it should expand the sidebar".

## What exists today (checked 2026-11-19)

- Website Hub nav group: `/seo` and `/traffic` (`components/hub-shell/nav.ts`). Traffic reads Vercel Analytics for
  the marketing site (`lib/traffic/*`). The tracker becomes a third child.
- The networking calendar people see lives on heliosgroup.ai. The hub publishes its snapshot
  (`POST /api/networking/publish`), so the hub controls the RSVP links in it. No click data is stored anywhere.
- The game runs on heliosgroup.ai; plays live in the **site's** Supabase (`uxyvaknayquzgsglktow`, schema `game`:
  `days`, `questions`, `plays` with anonymous `player_id`, `score`, `ai_score`, `answers`). The hub has no access to it.
- Game days so far: AI scored 2, 3, 3 (days 1–3). The builder aims for exactly 3 (HUB-PLAN step 5).
- `GameDayPanel` also holds **Pull** (pull a question from tomorrow's draft until 11 pm).
- The "impeccable" skill is not installed here; `dataviz` and `artifact-design` are.

## Decisions (2026-11-19)

- **RT-1 Game stats source:** a read-only Postgres role on the site's Supabase, SELECT on schema `game` only; the
  hub reads it through a new env var `GAME_STATS_DATABASE_URL`. Claude writes the SQL; Lucas creates the role.
- **RT-2 RSVP clicks:** the published snapshot's RSVP links go through a hub redirect
  (`/api/public/go/rsvp/<eventId>`) that counts the click, then 302s to the event. Counting starts at deploy.
  Calendar page views come from the Vercel Analytics client the Traffic page uses, so the view shows a click rate.
- **RT-3 AI score:** "Don't aim for 3 out of 5 anymore. Aim for 4 out of 5 always, but it doesn't have to be a
  super strict target." The builder aims for 4; 3 or 5 is fine when the fact-check cap is reached first.
- **RT-4 AI speed:** "The AI needs to be faster … We're normalizing it too slow." Lucas: "2-6s". The AI's answer
  time lives in the website repo (`FIGMAHELIOSWEBSITE/api/_lib/rules.ts`): `AI_MIN_SECONDS` 4 → 2, `AI_MAX_SECONDS`
  11 → 6. The hub sends no latency, so each question gets a stable time in that window (about 4 s on average).
- **RT-5 Extras:** "yes". Calendar click rate, top events, clicks by city; game finish rate, returning players,
  per-question players vs the AI.
- Top players are named by their saved email when they saved progress (`game.accounts`), else a short device id.
  Synthetic players are computed on the site, never stored, so every stored play is a real person.
- Tracker views: one segmented toggle, Networking calendar | Smarter Than AI; one view at a time.
- Game view keeps today's and tomorrow's questions, with Pull moved here from the content page.
- Card click: the whole card opens the sidebar; buttons and links inside it keep their own action.

## The build (for approval)

| # | Part | Where | What changes |
|---|---|---|---|
| 1 | Click counter | hub: new table `networking.rsvp_clicks`, route `/api/public/go/rsvp/[eventId]`, publish step | Snapshot RSVP links point at the redirect; each click is one row (event, time, metro, bot flag) |
| 2 | Game stats reader | hub: `lib/resource-tracker/game-stats.ts` over `GAME_STATS_DATABASE_URL` | Read-only queries on `game.plays`, `answers`, `questions`, `accounts`; daily mode only |
| 3 | Tracker page | hub: `/resource-tracker` under Website Hub | Toggle Networking calendar / Smarter Than AI; one view at a time; charts per the dataviz skill |
| 4 | Content page | hub: `/ai-trivia` | `GameDayPanel` removed; Pull moves into the tracker's game view |
| 5 | Selection | hub: `lib/stories/trivia/game.ts` (+ tests) | Target AI right = 4 (was 3); social worker redeploy (Lucas runs it) |
| 6 | AI speed | site: `FIGMAHELIOSWEBSITE/api/_lib/rules.ts` | Faster AI answer window (RT-4) |
| 7 | Card click | hub: Social Hub content cards | Whole card opens the sidebar; inner buttons and links keep their action |

Tests stay offline (pure functions, SQL shape, redirect). No model calls anywhere in this work.

## Build status (2026-11-19, uncommitted)

| # | Part | State |
|---|---|---|
| 1 | Click counter | Built: `lib/networking/rsvp-tracking.ts`, route `app/api/public/go/rsvp/[id]`, tables in `db/networking_schema.sql` (end), publish wiring in `lib/networking/public-snapshot.ts`, public path in `middleware.ts` |
| 2 | Game stats reader | Built: `lib/resource-tracker/game-stats.ts`; role SQL `db/site_game_reader_role.sql` (Lucas runs it on the site project) |
| 3 | Tracker page | Built: `/resource-tracker` (Website Hub nav), `app/resource-tracker/*`, `components/resource-tracker/TrackerChart.tsx` |
| 4 | Content page | Built: `GameDayPanel` → `components/resource-tracker/GameDaysPanel.tsx` (Today and tomorrow, with Pull) |
| 5 | Selection | Built: `AI_RIGHT_TARGET` 3 → 4 in `lib/stories/trivia/game.ts` |
| 6 | AI speed | Built in worktree `FIGMAHELIOSWEBSITE-faster-ai`, branch `feat/stai-faster-ai` |
| 7 | Card click | Built: `components/social-hub/nav/PostCard.tsx` on Today cards and lineup rows |

Go-live order: networking schema tables → hub deploy (Vercel) → orchestration + social worker redeploys (both publish
the calendar; the social worker runs the game builder) → site role SQL + `GAME_STATS_DATABASE_URL` → site deploy.
