# Stories Split: plan and decision log

Status (2026-11-16): **built locally, not committed, not applied anywhere shared.**
- Worktree: `/Users/lucasfigueroa/HELIOS/CODE/Helios-Hub-split`, branch `feat/stories-split` (off origin/main).
- `feat/ai-trivia` is merged in with `--no-commit`, and the Real or AI? work is overlaid.
- Spec: [CONTRACT.md](CONTRACT.md). Screens: [screens/](screens/).

## What changed
- **IG Stories is now Morning Download.** It keeps the internal id `stories`, so production rows need no migration. Its page is /morning-download, and /stories redirects there.
- **New content types.** "Are you smarter than AI?" (`ai_trivia`, /ai-trivia) and "Real or AI?" (`real_or_ai`, /real-or-ai, lab at /real-or-ai/lab) are hub content types of their own. Each has its own:
  - page and calendar slots;
  - card in the central content view;
  - health, cost and revisions entries;
  - settings and Generate button.
- **One Stories engine.** All three share it (tables, renderer, worker). The hub's story-format checks use `isStoryVertical` (lib/social-hub/story-types.ts).

## Decisions
| Id | Decision | By |
|---|---|---|
| SS-0a | Build in a new worktree off main; no commit, push, schema apply or deploy | Lucas |
| SS-0b | Trivia's research runs through the central intake | Lucas |
| SS-0c | Real or AI? AI images go in the photo bank, marked `generated`, never served to another type | Lucas |
| SS-1 | Each Stories-format type has exactly one series (`SERIES_OF_VERTICAL`) | default |
| SS-20 | Settings per type (`stories.settings` key `types`): approval, publishing live, daily spend cap. The old global values are the fallback, and the first save copies them to every type | default |
| SS-21 | Each set projects into the hub under its type's vertical | default |
| SS-22 | The daily spend cap is per type; the monthly watch stays engine-wide | default |
| SS-24 | AI Trivia and Real or AI? post at most once a day. **Morning Download keeps two a day (R25)** | default (MD corrected at integration) |
| SS-26 | One Generate button per type; seeding stays Morning Download only | default |
| SS-27 | Free vs. Paid and Guess the Number leftovers retired from pool, order and photo-profile lists. The series stay readable | default |
| SS-30 | Intake order `trivia` (`search:trivia`, 30-day lookback, no scorecard), open while AI Trivia is on. Real or AI? has no order: its scrapes are photo requests | default |
| SS-31 | Free vs. Paid's intake order removed | default |
| SS-32 | Pages Trivia cites are never grouped as news, unless a feed, Reels or Field Notes also brings them in | default (tightened at review) |
| SS-33 | Consumers switch `trivia` starts on `legacy` | default |
| SS-40 | Photo profiles `trivia` and `roa`. Commons/NASA are shared finder sources; Real or AI? photos come bank-first through the shared finder when `photo_finders.roa = shared` | default |
| SS-41 | Every pooled Real or AI? image is offered to the bank. AI images: licence `generated`, `reuse_ok` false (the DB enforces it), `truth`/`gen_model`/`gen_prompt` kept. `generated` stays sticky across sightings | default |
| SS-42 | The used-photo ledger and photo hold cover both new types; published story photos are logged under their own type | default |
| SS-43 | Set-less costs go to their type by component (`trivia-*`, `roa-*`); the rest stay Morning Download's | default |
| SS-34 | trivia-write@4: one guidance paragraph says to use `research` as leads, still confirmed with web search | Lucas (2026-11-16) |
| SS-35 | No research scorecard: questions are already fact-checked and scored at write and pick, and research is only a lead, so an extra paid score adds nothing | Lucas: "only if needed" |
| SS-44 | Cost page: each Stories-format type's budget is its own daily cap × the days it posts that month. The engine-wide monthly watch is a guard over all three, not Morning Download's budget | Lucas (2026-11-16) |
| RA-28 | Real or AI? text never covers the photo's subject. The screen (roa-screen@4) boxes the subject with one more jev-preview call per passing image; rows screened before that get a box read from the pixels. Code does the rest: the crop, a room check at intake (no room for the reveal beside the subject → archived, `no_room_for_text`, before the reveal writer is paid), and the renderer moving each text stack into the empty space (above, below, or the reveal split around the subject). Text still on the subject is a render problem, so the set is flagged at approval, never blocked | Lucas (2026-11-17) |

## Open for Lucas
Nothing. Prompt line, scorecard and cost page settled 2026-11-16 (SS-34, SS-35, SS-44).

## Go-live order (when approved)
1. Apply the schemas. `npm run db:social-hub` now runs `db/stories_split.sql` after the base schema, and `db:stories` runs it last.
2. Apply `db/media_library_stories_split.sql` (the apply script includes it) and `db/intake_stories_split.sql` (manual: after `intake_schema.sql`).
3. **Only then** deploy the worker and the app. Without the split schema, every Trivia and Real or AI? set write fails the vertical CHECK.

## Verification (2026-11-16)
- `npx tsc --noEmit -p .`: clean.
- 143 test files run by exact name (roa, trivia, stories, intake, slots, social-hub, revisions, photos, media-library, health, preflight): all pass after the integration fixes. No live API calls; PGlite only.
- Every schema file applied twice to a scratch local Postgres, then again over rows with the new types and a `generated` photo: no errors. Marking a `generated` photo reusable is refused. The scratch DB was dropped.
- Local UI (fixture preview, placeholder env, no live DB) showed the three type pages, idea-pool cards for each type, and the calendar tray and slots.
- Trivia visuals (lib/stories/trivia/render) are identical to Helios-Hub-trivia as of today.
