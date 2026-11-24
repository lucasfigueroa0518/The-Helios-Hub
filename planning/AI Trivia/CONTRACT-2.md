# "Are you smarter than AI?" build contract (AT-41 to AT-53)

Worktree `/Users/lucasfigueroa/HELIOS/CODE/Helios-Hub-trivia`, branch `feat/ai-trivia`. Decisions are in PLAN.md (AT-41 to AT-53).
Visual spec is the mock `planning/AI Trivia/gameshow-options/marquee-create.html`: copy its CSS values and layout exactly.
Every name below is shared. A builder who needs a name that isn't here asks; nobody invents one.
Hard rules: no live Claude, Jev, web_search or HeyGen calls in tests or by builders (CLAUDE.md Rule 1). Never run
`tests/*.integration.ts` and never use a prefix glob. No commits. No DB or VM actions.

## 1. Names and fixed values
- Series key stays `ai_trivia`. Display label becomes `Are you smarter than AI?` (plural label: `Are you smarter than AI? sets`).
  Some label constants may be persisted (e.g. `STORY_SERIES` in `lib/content-type/model.ts` used as stored content-type names).
  If a value is read back from the DB or matched against stored rows, leave it and list it in your report.
- Sign copy: `Are you smarter than AI?` in Bowlby One, uppercase. Footer copy on clip 1: `Tap to reveal`.
- Fonts (already in `lib/stories/render/assets/`): `BowlbyOne-Regular.ttf` (+ `BowlbyOne-LICENSE-OFL.txt`), `Inter-Variable.ttf`
  (weights 500–900; license `Inter-LICENSE-OFL.txt`). `Inter-Medium.ttf` is no longer needed by trivia.
- Colours: orange `#FF5E1A`, background gradient `linear-gradient(160deg,#FF7A2E,#C93A06)`, sign `#170b04`, correct green `#138510`,
  confetti `#FFFFFF`, `#138510`, `#170b04`.
- Durations: clip 1 (`question`) **10.0 s**, clip 2 (`answer`) **5.0 s**, 1080×1920, 30 fps, AAC 192k 48 kHz.
- Sound: one fixed asset, `lib/stories/trivia/render/assets/show-master.flac`, exactly 15.0 s, about -13.4 LUFS. Clip 1 gets 0–10 s,
  clip 2 gets 10–15 s. No music picking, no per-post audio. Generator: `scripts/trivia_show_sound.cjs`.
  Its grid: 120 BPM (beat 0.5 s). Ticks on each whole second of clip 1, tocks on each half, beeps on clip-1 seconds 7, 8, 9.
  Clip 2: drumroll 0–0.5 s, crash + ding on **+0.5 s** (the hit), applause after.
- Posters (for the review): clip 1 at 2.0 s, clip 2 at 0.9 s.

## 2. Layout (both clips identical except the footer slot's content)
- Stage 1080×1920, flex column, centred horizontally and vertically inside the safe area: padding 220 px top, 280 px bottom, 84 px sides, gap 50 px.
- Order: sign, question, choices, footer slot. The footer slot is a fixed 210 px tall box (`.foot`). On clip 1 it holds the tap row
  (timer, `Tap to reveal`, arrow); on clip 2 it holds the answer line. Because the slot is fixed, the sign, question and choices sit on
  identical pixels in both clips.
- Fit rule: if the stack is taller than the safe area, the question font steps down 66 → 60 → 54 → 48 px until it fits. The step is
  computed from the content (the same on both clips) and both clips use it.
- Timer (clip 1 only), left of `Tap to reveal`: 150 px white disc with a draining ring (conic-gradient `#170b04` on rgba(23,11,4,.2)),
  the digit in Inter 900 68 px. Ring drains linearly over 10 s. The digit shows 10 − floor(t) and changes on each whole second.
  On digits 3, 2 and 1 it pulses (scale 1.45 → 1 over 0.35 s).
- Bulbs: chase on clip 1 with 0.5 s steps (on the beat). On clip 2 they flash with 0.25 s steps. Bulbs are lighting, so they get no sound.
- Reveal (clip 2) at +0.5 s: the correct pill turns green with a check icon and pops (scale 1 → 1.12 → 1.05). Wrong pills fade to 50 %.
  30 confetti pieces burst from the correct pill, and the answer line rises in at +0.6 s.
- No photo and no dim layer on either clip.

## 3. Shapes
- Frame given to the renderer: `TriviaFrameInput = { role: 'question' | 'answer'; copy: TriviaCopy }` where
  `TriviaCopy = Pick<TriviaQuestion, 'question' | 'options' | 'correct' | 'answerLine'>`. There is no `photo` and no `music`.
- `renderTriviaClips(frames: TriviaFrameInput[], deps?: RenderDeps): Promise<{ clips: { role; mp4: Buffer; poster: Buffer }[] }>`.
- Set payload `payload.trivia = { q: TriviaQuestion, scores: {...}, factCheck: FactCheck }`. No `music`, no photos.
- `Scorecard = { surprise; about_you; social_currency; fair_shot }` (each 0–1). Pool score = the mean of 8 numbers (writer's 4 + Jev's 4).
- Fair-shot gate: `FAIR_SHOT_FLOOR = 0.5`. If the mean of the writer's and Jev's `fair_shot` is below it, the question is archived
  (`stories.trivia_archive`, reason `fair-shot`), its cell is freed, and it never enters the pool.
- `TriviaQuestion` loses `photoSubject`, `answerPhotoSubject`, `photoKind`, `photoName`, `answerPhotoKind`, `answerPhotoName`; `PhotoKind`
  and `PHOTO_KINDS` go.
- Prompt ids: `trivia-write@2`, Jev set `trivia-score@2`. `trivia-check@1` is unchanged unless it mentions photos.
- Audience text lives once, in `lib/stories/trivia/audience.ts` (`TRIVIA_AUDIENCE`), and is read by the writer and the Jev set.

## 4. Owners (one owner per file)
| Owner | Files |
|---|---|
| **A: Render** | `lib/stories/trivia/render/**` (rewrite; delete `reveal-sting.wav`, `ambient-air.ogg` and the music code), delete `lib/stories/trivia/music.ts`, `lib/stories/render-stage.ts` (trivia branch), `lib/stories/build/index.ts` (renderer type only), `scripts/trivia_render_fixture.ts`, `lib/social-hub/cost-page/stages/stories.ts` (drop `trivia-music`), `tests/trivia-render-*.test.ts` |
| **B: Questions + pipeline** | `lib/stories/trivia/{types,audience,map,validate,prompts,questions,daily,cells}.ts`, `lib/stories/build/ai-trivia.ts`, the registry lines in `lib/stories/prompts.ts` and `lib/stories/questions.ts`, the label files (`lib/content-type/*`, `lib/social-hub/views/plan.ts`, `lib/social-hub/slots/*`, `lib/stories/render/copy.ts`, `lib/revisions/descriptions/stories.ts`), `docs/social-overnight.md`, `tests/trivia-ideas.test.ts`, `tests/trivia-photo-validate.test.ts` (delete), `tests/stories-pipeline.test.ts` and any other non-render test that stubs trivia photos or music |

Interfaces: A exports `renderTriviaClips` and `TriviaFrameInput` and never imports anything B deletes. B imports nothing from `music.ts`.
Shared types (`TriviaQuestion`, `TriviaOption`) come from B's `types.ts`.

## 5. Acceptance (offline)
- A: the fixture script renders 2 MP4s: clip 1 is 10.0 s ±0.05 and clip 2 is 5.0 s ±0.05, both 1080×1920, 30 fps, with audio. Clip 1's
  audio equals `show-master.flac` 0–10 and clip 2's equals 10–15. The sign, question and choices have identical bounding boxes in both
  clips (a test asserts it from the layout function), and so does the fit rule on 2-, 3- and 4-option fixtures. Render tests pass.
- B: with a stubbed `create`, `runTriviaDaily` pools questions scored on 4 items. A canned question with mean fair_shot 0.4 is archived
  with reason `fair-shot` and its cell freed, and 0.5 passes. Map themes 6, 11, 15, 16 and 17 have the new names, and the cell ids are
  unchanged. The builder returns 2 frames with no photo and no music and makes no photo or music calls. Ideas and pipeline tests pass.
- Both: `tsc --noEmit` is clean for your files. Every prompt diff passes the review lens (altitude, no examples, no contradictions,
  single ownership, strength matches intent).
