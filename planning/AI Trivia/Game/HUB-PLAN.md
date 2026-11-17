# "Are you Smarter Than AI?" web game — the hub side (built by Claude)

Companion to `BUILD-PLAN.md` (the website side, built by Cursor). This is what The Helios Hub must do so the site
gets a fresh, fact-checked 5-question game every day. Decisions are logged in `../PLAN.md` as AT-76 to AT-79.

## Lucas's decisions (2026-11-16)

- **AT-76 Review window.** A game day is built about 21 hours ahead and shown in the hub. Lucas can pull any
  question until 11 pm New York; the builder swaps in the next one. At 11 pm the day locks and is exported. If he
  does nothing, it goes live at midnight.
- **AT-77 Build order.** The hub side is built on top of the per-type Stories engine once that split is merged into
  main. Until then only trivia-only parts are built here (the supply change and the game-day logic, with tests).
- **AT-78 Cells hold many questions.** The writer sees the questions already written in each cell it is offered and
  must use a different fact. A cell retires after the writer twice reports it has no fresh fact left. The fact-check
  still fails a repeat of any fact the series has posted on the same theme.
- **AT-79 (from the site plan)** 5 game questions a day, separate from the IG story; the AI (GPT-5 nano) usually
  scores 3 of 5; Day 1 is launch day; midnight New York flip.

## The flow

| Step | When | What |
|---|---|---|
| Question writer (`runTriviaDaily`) | 3:00 daily | **Two** writer calls, each offered 10 open cells and asked for 4 questions (was one call, 12 cells, 3 questions). Validation, Jev scoring and pooling as today. About 8 new pooled questions a day. |
| IG story build | 3:00 Sun/Mon/Thu | Unchanged (fact-check, opponent lean, render). Takes the top question on its days. |
| **Game day builder** | from 3:30, every worker pass until done | Builds **tomorrow's** game day (below). |
| **Pull** (hub UI) | until 11 pm NY | Lucas pulls a question; the builder replaces it on its next pass. |
| **Lock** | 11 pm NY | The day is final: status `locked`, its questions marked used for good. |
| **Export** | always | `GET /api/public/trivia-game/days?after=YYYY-MM-DD`, Bearer `HUB_GAME_EXPORT_TOKEN`: locked days only, in the contract of `BUILD-PLAN.md` §6.2. |

### Game day builder

1. Skip if tomorrow's day exists and has 5 questions; before the launch date (setting `trivia_game_launch`, the NY
   date of Day 1); or over the day's spend cap.
2. Candidates: the open AI Trivia pool in score order (the story takes its pick first on its days; a question used by
   either is never offered again).
3. Fact-check from the top with `trivia-check` (same check and bar as the IG story; a fail archives the question as
   today). The repeat test sees every question posted on the same theme, plus the questions already in this day.
4. The opponent answers each passing question once (`askOpponent`, the answer stored on its pool row).
5. Choose the 5 so the AI scores 3 when possible: keep checking further candidates (at most 10 fact-checks a day)
   to swap a question of the over-represented kind (AI right / AI wrong) for one of the other kind. Never trade a
   question for a lower-scored one of the same kind.
6. Order: easiest first (higher fair-shot score first, the mean of the writer's and Jev's scores on tests 1 and 2;
   on a tie, an AI-right question first).
7. Save `stories.trivia_game_days (day_number, ny_date, status 'draft', questions jsonb, built_at)`; the questions
   are reserved (not offered to the story) while the day is a draft, and marked used at lock.
8. Fewer than 5 by 11 pm: the day is not exported, the log says why, and the site shows "Today's game is on its way".

### Supply (AT-78)

- `stories.trivia_cells`: states become `open | retired` (was `open | reserved | closed`), plus `questions int` and
  `spent int`. Offered cells are sampled from open cells, weighted toward those with fewer questions.
- Pool keys become `trivia:<cellId>:<n>` (n = the cell's question number); existing keys keep working.
- Writer material: each offered cell carries the questions already written in it (`asked`), so the list stays small
  (about 9 a cell per year) instead of every question ever asked.
- Writer output gains `spent_cells`. Two reports retire the cell.
- Fact-check material: `asked` = questions posted (story or game) on the same theme.
- Pool cap 20 → 40.

### Prompt changes (wording in `PROMPT-DRAFT.md`, approved 2026-11-16)

`trivia-write@5` and `trivia-check@4` (the split had already moved the writer to @4). The repeat definition moves into one shared sentence; each prompt only says
where its list comes from (single ownership).

## Cost (estimate, confirmed before the first live run)

About $0.50–0.70 a day (today about $0.20): two writer calls with web search, Jev scoring of ~8 questions, 5–10
fact-checks, 5–10 opponent answers (about $0.00002 each). About $15–21 a month. Held under the AI Trivia spend cap.

## Build order

1. **Built 2026-11-16 in Helios-Hub-split, uncommitted** (trivia-only, tests offline): supply change, the prompts,
   game-day selection as pure functions (`lib/stories/trivia/game.ts`), the `trivia_game_days` table
   (`db/stories_ai_trivia.sql`).
2. After the per-type engine split is merged: the builder in the worker, the lock, the export route, the hub UI
   (tomorrow's day, Pull), the setting `trivia_game_launch`, the spend cap.
3. A live check of one game day, only with Lucas's go-ahead and a cost estimate.
4. Deploy: schema to production, Vercel env `HUB_GAME_EXPORT_TOKEN`, social worker redeploy (Lucas runs it).
