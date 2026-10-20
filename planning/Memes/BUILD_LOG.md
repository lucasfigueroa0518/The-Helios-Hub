# Meme lab: build log

Milestone reports for [BUILD_PLAN.md](BUILD_PLAN.md), newest last. Lucas gave
the go-ahead on 2026-10-13 ("exercise a high degree of autonomy") and asked
for the template images to live in the repo.

Standing limits for the whole build:
- No live Claude or Jev call from the build (CLAUDE.md Rule 1). Tests use
  canned answers; the first live run is Lucas clicking Generate.
- Nothing applied to Supabase, no worker deploy, no git commits.

## M0 · Schema, catalog and situations: done 2026-10-13

- `db/memes_schema.sql`: `templates`, `template_uses` (the 90-day ledger),
  `situation_uses`, `requests`, `slates`, `memes`, `picks`.
- `lib/memes/catalog.ts`: the 25 approved cards as data (slots with what each
  accepts, plus fixed, repeated and derived slots), and the 9 exclusions.
- `lib/memes/situations.ts`: AS-01 to AS-20 and their rules.
- `lib/memes/assets/templates/`: the 25 images.
- `lib/memes/db.ts`: local PGlite (`.memes-local/`, git-ignored), and a
  catalog sync into `memes.templates`.
- **Accept:** `tests/memes-catalog.test.ts`, 6 of 6. The catalog matches the
  approved ids frozen in the test, every image is on disk at its card's size,
  every named situation exists, and the schema loads and syncs on PGlite.

## M1 · The 90-day gate: done 2026-10-13

- `lib/memes/gate.ts`: `availableTemplates` (before generation), `reserve`
  (re-checks under a table lock, so two runs can't take one template),
  `markPublished` and `release`.
- A family is blocked while reserved and for 90 days after publish.
- `lib/memes/phash.ts`: a 64-bit dHash per image. A template within 10 bits
  of a blocking use's image is blocked whatever its family. Hashes are
  computed at catalog sync.
- **Accept:** `tests/memes-gate.test.ts`, 6 of 6, on PGlite:
  - a reservation blocks its family and a release frees it;
  - a publish blocks the family through day 89 and frees it by day 91;
  - a family variant is blocked;
  - a recropped, recompressed re-upload under another family is blocked;
  - no two catalog templates are within 10 bits of each other.

## M2 · The renderer: done 2026-10-13

- `lib/memes/geometry.ts`: a box and text style for every slot of all 25
  templates, measured against a 10% grid, plus hand-marked faces the detector
  missed (cartoons, a turned head).
- `scripts/memes_faces.ts` → `lib/memes/faces.generated.ts`: the MediaPipe
  face boxes of every template.
- `lib/memes/fill.ts`: resolves a fill into what to draw. Fixed text, repeats,
  Mocking SpongeBob's alternating caps and "X everywhere" are filled by code. A
  player id becomes its exact registry name and bank logo.
- Label rule:
  - a company's wordmark logo stands alone, since it already spells the name;
  - a symbol-only logo (Mistral, Apple, Tesla, SpaceXAI, Higgsfield) carries
    the name;
  - a person shows their name, plus their company's logo when it fits.
- `lib/memes/render.ts`: Chromium on the 1080×1350 canvas (template fitted
  whole on a white letterbox), Inter Medium, no branding. Checks: font and
  images loaded; text fits at 24px or more with no broken words; labels fit
  at 26px or more; nothing drawn touches a face.
- **Accept:**
  - `tests/memes-render.test.ts`, 9 of 9: geometry, no box touches a face, no
    boxes overlap, resolution, label rules, escaping.
  - `npx tsx scripts/memes_render_samples.ts`: 25 of 25 render with every
    check passing. Review sheet: `.memes-local/samples/sheet.png`.
  - Three fit failures and one clipped line (UNO's card text on the black
    border) were found and fixed on the way.

## M3 · The writer: done 2026-10-13

- `lib/memes/story.ts`: a carousel's Reporter brief as the writer reads it:
  the news, plot, tensions, and every fact, number and quote by ID. Also the
  blue-chip players the brief names, the only ones a label may show.
- `lib/memes/writer.ts` (`meme-writer@1`): one Claude call (Sonnet 5.5, high
  effort, 10K max output) with a `submit_memes` tool.
  - Cached: the tool and a ~15.5K-token system prompt (rules, voice block,
    humanizer, 25 cards, 20 situations, players). Only the story and today's
    free templates vary.
  - Every rule is a hard constraint checked in code:
    - free templates only;
    - slots and kinds match the card;
    - players must be in the story;
    - text lines cite brief IDs that exist, at most 60 characters;
    - viewer lines use a situation the card allows;
    - no em dashes, exclamation marks or emoji;
    - 4 to 6 memes on 3 or more templates;
    - an explicit "no meme" for harm, war, sexual content or partisan
      politics.
  - A broken submission goes back once with every error. On the retry, broken
    memes are dropped if 3 templates survive.
- `lib/memes/cost.ts`: the $0.25 cap per click.
  - A call runs only if its worst case, plus $0.02 held back for the judges,
    fits.
  - Worst first call: $0.17. Worst retry: $0.12.
  - When a retry can't be afforded, the first submission's valid memes are
    kept.
- **Accept:** `tests/memes-writer.test.ts`, 10 of 10, with canned Claude
  responses. Covers the cached prompt, a valid run, the retry, dropping, too
  few templates, no meme, the cap blocking a call, the cap keeping first-pass
  memes, and each check's message.

## M4 · The judges and the slate: done 2026-10-13

- `lib/memes/judges.ts`, all DRAFT wording awaiting Lucas:
  - `meme-judges@1`: four questions per candidate (relevant, accurate,
    clear, off-limits).
  - `meme-funny@1`: pairwise "which is funnier", asked in both orders so
    position bias cancels.
- Bars: relevant ≥ 0.5, accurate ≥ 0.6, clear ≥ 0.5, off-limits < 0.3.
- The slate is the 3 funniest that pass, one per template. Ties go to the
  steadier meme.
- `lib/memes/run.ts`: one Generate end to end. Claim the request, read the
  story, ask the 90-day gate, write, render every candidate (drop fit or face
  failures), judge, rank, choose. Every candidate is saved with its fate. Jev
  runs through a 6-wide pool under the same spend meter.
- **Accept:** `tests/memes-run.test.ts`, 9 of 9, on PGlite with stubbed
  Claude, Jev and renderer. Covers each bar, slate choice, both-order funny,
  a full run (3 on 3 templates, images on disk), render and judge drops, a
  missing brief, a writer failure with its cost, "no meme", and cooldown
  templates never reaching the writer.

## M5 · The lab page, the queue and the runner: done 2026-10-13

- `/memes/lab`: a story picker (carousel posts with a Reporter brief, read
  only from Supabase), a Landscape tab, Generate, runs with live status and
  cost, and the slate. Each slate card shows the image, the point, the judge
  scores, Pick, and Reject with the ME-64 tags plus a note. Dropped
  candidates are shown with their reasons.
- API: `/api/memes/{stories, generate, runs, runs/[id], picks, image/[id]}`.
  Each checks the session; the middleware now protects `/memes`.
- **Runs locally, in the Next server process.** A Generate click queues a
  request and wakes an in-process runner. The lab database is local PGlite
  (`.memes-local/`, owned by the dev server). No Supabase schema and no
  worker deploy, per Lucas. A run cut off by a server restart is marked
  failed on the next start.
- Playwright is imported with `webpackIgnore`, so Next never bundles it, and
  `next.config` is untouched.
- **Accept:**
  - `tests/memes-api.test.ts`, 6 of 6: generate validation and the queue cap,
    run read-back, one pick per slate, tag filtering, image path safety, the
    session check, and a server render of the page.
  - `scripts/memes_lab_dryrun.ts`: a full run with the real renderer (canned
    models) produced a slate of 3.
  - A read-only probe found 14 carousel posts with briefs.
  - On the running dev server, signed-out `/memes/lab` redirects (307) and
    `/api/memes/runs` returns 401.

## M6 · Landscape memes: done 2026-10-13

- `lib/memes/landscape.ts`:
  - **Pool:** the last 7 days of carousel stories that name a blue-chip
    player (up to 12).
  - **Pairs:** Jev reads every pair about different companies
    (`meme-stackup@1`, DRAFT): overtakes, contradicts, same move, answers,
    or unrelated.
  - **Choice:** the strongest relation wins. A "same move" grows to up to 4
    stories. Below 0.5 there is no landscape meme.
  - **Merge:** the chosen stories become one story with lettered fact IDs.
    The writer gets the landscape-flagged templates only, plus a hard
    constraint to draw on at least two stories, which code also enforces.
  - The slate records the newest story as the meme's home (ME-73).
- **Accept:** `tests/memes-landscape.test.ts`, 5 of 5. Covers pair
  selection (same-company pairs never asked), "nothing stacks up", lettered
  merge, the two-story rule, a full landscape run, and landscape templates
  only.

## Ready for Lucas

- **Open it:** your dev server on :3000 already serves it at
  `http://localhost:3000/memes/lab`, signed in.
- **Use it:** pick a story, then Generate. Each Generate is one live run:
  roughly $0.06–0.14, never over $0.25. The page polls while the run works
  (about a minute). Then Pick one, or Reject with tags and a note.
- **Not yet exercised live:** no live Claude or Jev call was made during the
  build (Rule 1), so your first click is the first real run. Inside the Next
  server, the live wiring (`lib/memes/live.ts`) has been typechecked,
  server-rendered and dry-run with the real renderer, but never driven by a
  signed-in click.
- **A good first test:** the Philadelphia false-homicide-tip story. The
  writer should answer "no meme" (ME-30).
- **Full suite:** 1,953 of 1,953 tests pass.

## Round 2 · after the first live runs: done 2026-10-13

Lucas ran 6 live Generates. The worst two were Bike Fall on the
false-homicide-tip story and You Guys Are Getting Paid on xAI's bundle. The
fixes, ME-90 to ME-96:

- **Template misuse (ME-91).** Cause: slots carried terse roles ("who they
  blame"), the writer never had to justify a fill, and Jev judged fit only for
  the whole meme. Bike Fall put Anthropic's own excuse (F7, a claim) where a
  blame belongs and passed at 0.86. Fix:
  - a MUST on all 58 fillable slots, written from the approved roles;
  - a `why` required per fill;
  - `role_<slot>` questions in `meme-judges@2`, all in one Jev call per meme,
    with a 0.6 bar.
- **Dropped format line (ME-92).** Cause: the set phrase lived only in the
  role's description, so the slot was free text. Fix: `pattern` slots
  printed by code (You Guys, Is This a Pigeon, Anakin's ", right?"
  repeated by code in the last panel).
- **Sales pitch as fact (ME-93).** Cause: the prompt's only rule was "every
  claim is in the facts". F5 was in the facts (tagged [CLAIM: xAI]), and the
  judges never saw the tag. Fix: a CLAIMS ARE CLAIMS rule in
  `meme-writer@2`, `accurate` now reads the [CLAIM] marks, and a new
  `ad_copy` judge.
- **No "no meme" (ME-90):** the writer always finds an angle; landscape
  always pairs, widening to 14 days.
- **Funny pairs and ranking only (ME-94).**
- **More drafts only when needed (ME-95):** at most one extra call, on the
  same conversation. Measured worst case: $0.175 first call, $0.097 extra
  call, under the $0.25 cap.
- **Clarity bar 0.55 (ME-96).**
- **Smarter landscape (`meme-stackup@2`):**
  - pairs are compared by each story's main company, taken from the headline
    (this had paired two Anthropic-incident stories);
  - a `same_event` answer excludes one event told twice;
  - an `at_a_glance` question scores whether a casual follower sees the link.
- **Accept:** the full suite passes, 1,967 of 1,967, with the meme tests
  rewritten for the new behavior. The dry run is ok, and all 25 samples
  render with the new format lines. All the new Jev wording is DRAFT.

## Last Few Days lab: done 2026-10-14

The lab now tests memes against Last Few Days stories (ME-97 to ME-100).
Tommy's pipeline is not merged.

- Snapshot from `unify-social-hub@a16d9c8`: `db/lfd_schema.sql`,
  `lib/lfd/types.ts`, `lib/lfd/sources.ts`, `lib/lfd/window.ts`. Missing
  `lfd.posts` is an empty list, not a crash.
- `/memes/lab`: finished posts first, then candidates. Briefs from copy
  (free) or structure-from-body in parallel ($0.50 batch). Thin bodies can
  take the full Reporter one at a time.
- One-story and spread Generate. Spread must cover every selected story.
  Preview cover is a mosaic of original photos unless a spread meme is
  attached as cover. Attachments: `memes.lfd_attachments`.
- Results board: pass rate by template, situation, kind, failed bar.
- 35 Imgflip drafts toward 60, awaiting approval. Catalog still 25.
- **Accept:** `tests/memes-lfd.test.ts` plus the existing meme suite. No
  live model calls. No write to `lfd.posts`. No catalog change.

## Catalog to 60: done 2026-10-14

Lucas approved the 35 Imgflip drafts. They are in `TEMPLATE_CATALOG` with
slot geometry, sample fills, and MediaPipe faces. Seven more imagery
exclusions from the ranks-46+ walk are in `EXCLUDED_TEMPLATES`.

- Images under `lib/memes/assets/templates/` (60 total). Tuxedo Pooh was
  cropped 8px on the left so its dHash is not a near-duplicate of Drake.
- **Accept:** catalog, render, gate, and writer tests, 31 of 31.

## Cards 26–60 re-encoded from the images: done 2026-10-14

The first encoding of the 35 put text and labels in the wrong places and
missed how several formats work. It was discarded unread, and the 35 cards,
boxes and sample fills were rebuilt from scratch: each image was opened on a
5% grid (1% where a box sits in a bubble or over a printed word), each card
written like the first 25, each box placed where the format puts its text.
None of the previous geometry was used.

- **Images.** 34 files are byte-identical to Imgflip's. Tuxedo Pooh is a fresh
  download with 12 px of white trimmed on the right (788×582); the picture is
  untouched and it is 15 bits from Drake (the net needs more than 10).
- **Format lines code prints** (ME-92): Trophy "This is where I'd put my
  {x}" + "If I had one!"; Absolute Cinema "ABSOLUTE" / "CINEMA" beside the
  hands; Oprah "You get {x}!" twice, then "Everybody gets {x}!"; Megamind "No
  {x}?"; Pawn Stars "Best I can do is {x}"; They Don't Know "They don't know
  {x}"; Where Monkey "Where {x}?"; All My Homies Hate "All my homies hate
  {x}"; Something of a Scientist "You know, I'm something of a {x} myself".
  Bell Curve's right-hand take repeats the left-hand one by code.
- **Two small code additions.** A derived slot may carry its own `pattern`,
  which wraps the source slot's `{x}` (Oprah's top lines). A `plate` box style
  draws black text on a white plate that fills the box, used only for
  Friendship Ended, whose format pastes over the printed "MUDASIR" and
  "SALMAN". The writer's "write only {x}" check now reads every fixed part of
  a pattern, punctuation aside.
- **Faces.** MediaPipe re-run for all 60. Hand faces added for the cartoons
  and for the real faces it missed (All My Homies Hate, Flex Tape, the lower
  Clown and Harold panels, No - Yes, the two small photos in Friendship
  Ended).
- **Departures from the approved table, for Lucas:** Boardroom has a fourth
  slot, the boss's question (the top bubble would otherwise be empty).
  Sleeping Shaq has a third slot, what wakes them (the "real shit?" half
  would otherwise be empty), and its image says "real shit?". No - Yes is a
  Drake image under its own family, so Drake's cooldown does not cover it.
- **Accept:** catalog, render, gate and writer tests 31 of 31; full suite
  1,983 of 1,983; `scripts/memes_render_samples.ts` 60 of 60 with no fit or
  face problem; every new sample image looked at.

## Cards 26–60: bigger boxes and company logos: done 2026-10-14

Lucas: the boxes were not generous enough, and some templates need an
optional logo for when the meme speaks from a company's perspective.

- **Bigger boxes.** Every box of the 35 now fills its free area: whole panels,
  whole caption bands, clear wall beside a figure, still off every face.
- **Optional logo slots** (`entity`, optional), placed on clothing or beside
  the figure: Trophy (speaker), Oprah (giver), Imagination SpongeBob
  (pitcher), Clown Makeup (clown), Roll Safe (dodger), Friendship Ended
  (speaker), Boardroom (boss), Evil Kermit (kermit), Flex Tape (patcher),
  Laughing Leo (laugher), Bad Luck Brian (unlucky), Inhaling Seagull
  (yeller), No - Yes (chooser), Surprised Pikachu (surprised).
- **Viewer slots that also take a logo** (Two Buttons' pattern): This Is Fine
  (sitter), They Don't Know (knower), Two Guys on a Bus (stuck), Monkey
  Puppet (looker), and Scooby's new optional revealer (Fred).
- Left without one: templates whose figure is a group of people or a real
  person the logo would stand in for (Bell Curve, All My Homies Hate,
  Absolute Cinema), and those with no free spot (Megamind, Panik Kalm Panik).
- The samples fill the new logos so every logo box is rendered and checked.
- **Accept:** catalog, render, gate and writer tests 31 of 31; full suite
  1,982 of 1,983, the one failure a Trial Reels text-engine timing test that
  passes alone (10 of 10); samples 60 of 60; every changed render looked at.

## Upgrade v3 (UPGRADE_PLAN U0–U5): done 2026-10-14

Lucas approved the plan's recommendations (ME-101 to ME-109) and asked for
the whole plan to be built and run on the lab's stories while he was away.
All new Jev and writer wording, the turn types and the card rewrites were
made under that go-ahead and are flagged for his review (ME-110 to ME-114).

### U0 · Evaluation harness
- `scripts/memes_eval_export.ts` copies the lab's PGlite folder to a temp
  dir (the dev server owns the live one) and writes
  `.memes-local/eval/graded-2026-10-14.json`: 41 runs, 264 memes, 100 rated.
- `scripts/memes_eval.ts` reproduces the baseline: 59% good, 85% of slates
  with a good meme, 18% with an Awesome, Jev agreeing with Lucas within a
  slate 36% to 43% of the time. (The judge drop rate is 53% of drafts; the
  plan's 62% also counted drafts ranked below the slate.)
- `lib/memes/lint.ts`: hedges (30% good with a hit vs 62% without),
  narrated speech (20% vs 63%), names a follower would not know (33% vs
  64%), line length (a line over 50 characters: 41% vs 64%).
- **Blind check** (a fresh agent, images and printed text only, no ratings;
  `.memes-local/eval/blind-check-2026-10-14.md`): legibility (blind N 17%
  good, Y 66%) and the picture-vs-text template split (picture 73% good, 5
  Awesome; text 44%, 2 Awesome) hold up. The "turn visible" split does not
  (blind Y 62%, N 68%): Claude's post-hoc 91% vs 5% was shaped by the
  ratings. `carriedBy` on the cards uses the blind sort.
- Lab: reason chips under the rating (REASON_TAGS for 1–2, WORKED_TAGS for
  3–4); a rating change keeps the chips and note (it used to wipe them);
  the pipeline version on every slate; a Blind grading toggle (hides the
  version, Jev's scores and rank, and shuffles the slate); the results board
  adds rated, good, awesome and mean per bucket, and splits by pipeline,
  turn type and reason chip.

### U1 · Turns
- `lib/memes/turns.ts` and `TURN_TYPES.md`: 17 turn types with beat roles.
  `checkTurn`: beat roles in order, real fact IDs, blue-chip players only,
  claims cast, no hedge in the payoff, no narration, spread/landscape
  coverage. `checkTurns` keeps up to three, one per type first.
- **Loosened after the first smoke run:** the beat cap went from 90 to 160
  characters (beats are never printed; cards cap printed lines), and the
  obscure-name lint left the turns (it stays on printed lines). At 90 the
  check had dropped the Apple-backfire turn behind the batch's Awesome Gru.
- `meme-brief-from-body@2` asks for tensions explicitly. ME-107: a copy
  brief with a body of 500+ characters no longer loads for memes, so the
  lab offers Generate briefs.

### U2 · Cards v2
- `lib/memes/cards-v2.ts`: carries, beats, carriedBy (blind sort), stance,
  usage, punch, maxChars, spoken, voice, benched for all 60. The 13 cards
  in the plan have rewritten logic and MUSTs in `catalog.ts`. Mocking
  SpongeBob, Imagination SpongeBob and Laughing Leo are benched (ME-103).
  Every turn type has at least 3 active carriers, 2 picture-carried.

### U3 · Matching
- `lib/memes/match.ts`: free, not benched, landscape-only for landscape and
  spread runs, carries the type, holds the beat count (a second look
  without it), a viewer-only slot only for a viewer turn. Order: picture
  first, then templates the last 12 lab slates used least, then the more
  specific, then Imgflip rank. Four per turn.

### U4 · Writer v3 (`meme-writer@3`)
- One conversation, two tools on every call (`submit_turns`,
  `submit_memes`): turns at medium effort, then memes at high effort from
  each turn's short list, with only those cards sent in full. Fewer than
  two kept turns gets one retry for more. Every meme names its turn and a
  short-listed template; hard checks for the card's length cap, hedges,
  narration, obscure names, claims shown by casting (ME-93), viewer lines
  only on viewer turns (ME-105), exclamation marks only where a card allows
  (ME-104).
- Caching: tools and system cached for an hour; the conversation cached on
  its last block. The system prefix no longer holds the 60 cards.

### U5 · Judges v3 (`meme-judges@3`) and calibration
- Gates: accurate, off_limits, ad_copy. Ranking questions: turn_visible,
  legible, format_true, punch_last. Jev sees the printed text, the card's
  usage and each line's fact citations; never the writer's relation or
  reasons. Pairwise funny is gone (ME-106).
- `scripts/memes_calibrate.ts` on the 86 graded memes with a brief ($0.007
  of Jev per pass, two passes): legible AUC 0.61 (67% within-slate),
  format_true 0.66, turn_visible 0.54 (40%), punch_last 0.56. No question
  could gate (none removed 70% of bad memes while keeping 90% of good).
- Ranking: legible + format_true + brevity (the longest line, AUC 0.66) +
  picture-carried, equal weights: AUC 0.74, 65% within-slate.
- The accuracy bar is 0.4 (ME-110): at 0.6 the @3 question dropped 16 of
  the 47 good graded memes.
- The slate takes the best meme of each kept turn first (up to three), then
  fills by score (ME-61: a choice between ideas).

### Accept
- Meme suite 81 of 81 (`tests/memes-*.test.ts`), no live calls; types clean
  for the new files.
- Live smoke runs (Lucas's go-ahead to own the run end to end): the Apple
  hiring-records story twice. The first ($0.111) exposed the beat cap; the
  second ($0.075, cache warm) kept 3 turns, wrote 6 drafts, showed a slate
  of 3.
- U6: 7 body briefs ($0.28), then all 44 briefed stories queued on v3.

### U6 · The 44 stories on v3 (2026-10-14, Lucas's go-ahead to run end to end)
- **Stories:** the 39 briefed Last Few Days stories, plus 5 of the 6 earlier
  carousel stories found among the candidates (the xAI bundle, Anthropic's
  live-internet cut, AWS backing both labs, Google's Gemini agent,
  TechCrunch's Anthropic false-tip story; Microsoft's Maia 300 has no Last
  Few Days copy). Seven body briefs first ($0.28): the five, plus White
  House and Brad Smith under ME-107.
- **First pass, 44 runs ($3.64), all ok.** It exposed a bug in the claims
  check: every [CLAIM] mark had to be cast, but the briefs mark people's and
  police statements too, which can't be logos and can't be named without
  breaking the legibility rule. 32 turns and 38 drafts were lost across 18
  runs. Fixed: only a blue-chip company's claim must be cast (ME-93's
  scope); anyone else's goes to the accuracy judge. The legibility lint
  stopped treating words inside long organization names ("Philadelphia
  Police Department") as names. The 20 affected stories were re-run
  ($1.54). The newest run of each story is the one to grade; the older 20
  stay in the lab, unrated.
- **Final slates (newest run per story):** 44 stories, 115 memes; 29 slates
  of 3, 13 of 2, 2 of 1 (Pulse Local and the Cerebras home-assistant story,
  both zero-good in the graded batch: their drafts failed accuracy or the
  Boardroom bubble's fit). 38 distinct templates; the most used (Buff Doge)
  is in 23% of slates; Gru's Plan in 2. 15 turn types. 35 of 44 slates offer
  two or more turns. No benched template appeared. No meme used a viewer
  line.
- **Live spend this session:** about $5.66 (smoke runs $0.19, briefs $0.28,
  first pass $3.64, re-runs $1.54, two Jev calibrations $0.014). Mean cost
  per final run $0.076, max $0.149; every click under the $0.25 cap.
- **Seen in the renders (objective, not quality):** text fits, logos place,
  format lines print. One slate (Cerebras doom) has two memes from one turn
  with identical lines on two templates; "vary the mapping, not the
  wording" is not checked in code yet.
- **Open for Lucas:** grade the 44 newest runs with Blind grading on; then
  `npx tsx scripts/memes_eval_export.ts` and
  `npx tsx scripts/memes_eval.ts --pipeline v3` compare v3 with the
  baseline, and `scripts/memes_calibrate.ts` refits the ranking.


## Golden set (2026-10-15)

Plan: `virtual-honking-dove`. Findings and the per-template dossiers are in `GOLDEN_SET.md`; decisions are ME-115 to ME-121.

**G1, harvest.** `scripts/memes_golden_harvest.ts` collected:
- 10,103 Imgflip posts for the 60 cards (818 pages);
- 768 tech-stream memes;
- 39 Know Your Meme entries.

Three snags:
- Imgflip's Top sorts and tag pages throttle with HTTP 429, so the harvester skips them for 10 minutes rather than waiting. In the end only 5 templates got Top pages, and the winner pool is mostly the hot listing ranked by upvotes.
- An early run with three parallel harvesters set off the throttle.
- A fetch without a timeout hung once.

**G2, writing features.** `lib/memes/golden.ts` holds the features and `scripts/memes_golden_report.ts` prints them. The gaps are voice and parallel structure, not length.

**G3, coding.** Twelve helper agents each took five templates and worked offline from `scripts/memes_golden_packets.ts` packets. They coded 3,995 top uses and 1,659 flops into `.memes-local/golden/dossiers/`.

**G4, system.** Built:
- golden cards (57 active);
- 22 hand restructures and a 27-card overlay;
- the slot `fallback` field;
- the writer's pattern requirement and real-meme rules;
- per-slot caps;
- meme-judges@4;
- the `dilemma` rewording;
- MEME_PIPELINE v4;
- writer max tokens down to 8,000.

Tests: the meme suite passes 93 of 93 and the full repo suite 2,002 of 2,002. tsc adds no new errors (the remaining errors are pre-existing ones in tests/seo-gsc-auth.test.ts).

**Not run.** The auto-mode permission check blocked live API calls, so neither the golden calibration (`scripts/memes_calibrate_golden.ts`, about $0.10) nor the 44-story v4 regeneration (about $4) ran. Both are waiting on Lucas. No live spend this session.

## Upgrade v5: headline-visible (2026-10-18)

The plan is `UPGRADE_V5_PLAN.md` and the decisions are ME-122 to ME-129. The changes were built from Claude's analysis of the v4 grades (78 memes, 30 slates) and Lucas's two observations.

**Built:**
- **The writer (U1–U5):**
  - a "what the viewer sees" block, plus hard rules about headline entities, common-sense relations and outside names, terms and numbers;
  - turn strength redefined as "gets it from the headline alone";
  - fill only the boxes that carry the joke;
  - step 2 opens with the headline;
  - incident stories get a step-1 note (`INCIDENT` in lint.ts).
- **The judges, meme-judges@5 (U6–U7):**
  - `real_meme` now carries rank weight 1;
  - a second Jev call per candidate, meme-reader@1, asks `gets_it` from the headline and the printed meme only, with weight 0.
- **The predictor (ME-128):**
  - `lib/memes/regime.ts` holds the regime fingerprint and the v4 backfill `d4d7e9370674`;
  - `lib/memes/predict.ts` holds the story and turn features, the regime-filtered dataset, the ridge logistic model, the leave-one-out evaluation and the readiness guard;
  - `scripts/memes_predict.ts` prints the report;
  - every run now saves `shape.regime` and `shape.predictor`;
  - v2 adds two headline features, `headlineUnknownNames` and `headlinePlayers`.
- **The pipeline is v5,** regime `3af2b639964f`.
- **Lab:** grading uses a feedback text field instead of reason chips, and the story list carries candidate scores (`net`, `blockbuster`).

**Replays on the graded v4 set before shipping:**
- **Adopted:** `real_meme` weight (within-slate agreement 76% to 79%, #1 good 25 to 26 of 30).
- **Rejected:**
  - a number gate (it would drop 6 good memes along with 9 bad);
  - a number ranking penalty (within-slate agreement down to 71%);
  - a heavier picture weight (no change);
  - turn ordering by headline anchoring (not monotonic).

**The v5 run:**
- the same 44 briefed stories;
- 35 new stories picked by Hub score (`.memes-local/eval/v5-new-stories.json`; the 11 skip-list headlines were excluded);
- from-body briefs for the 35 cost $1.29.

**One correction before any v5 grade:** the first saved runs showed `headlineUnknownNames` counting every word of a title-case headline. It now counts only name-shaped words in title case. The predictor recomputes features from the story, so the saved values don't matter.

**Tests:** meme suite 99 of 99; full suite passes.

**v5 run results (2026-10-18/19).** Regime `3af2b639964f` throughout. All 79 stories have a v5 slate: the 44 from v4 plus the 35 new ones.
- **Slates:** 52 of three memes, 20 of two, 7 of one; 203 slate memes in all, on 39 templates.
- **Failures:**
  - 22 runs died on "Connection error" while the machine slept. They were re-queued, and the app now keeps the machine awake during batches.
  - 3 died on "output cut off at max_tokens". They were re-queued once on the same regime and succeeded.
  - So the 8,000-token cap on the writer's step 2 (set in v4) is too tight about 4% of the time. Raise it in the next regime; it was not changed mid-batch, to keep the batch on one regime.
- **Spend:** runs $10.21, plus briefs $1.29, comes to about $11.50 (estimate: about $12).
- **Objective measures, v4 (33 newest slates) vs v5 (79):**

  | | v4 | v5 |
  |---|---|---|
  | Lines with a number the headline doesn't show | 20% | 9% |
  | Memes with 40% or more of their words from the headline or news line | 23% | 24% |
  | Characters per meme, median | 61.5 | 56 |

  The anchoring share barely moved, so the headline rule has not changed which words the writer uses yet. The grades will show whether it changed what the memes are about.
- **gets_it:** mean 0.49; 51% of slate memes score 0.5 or more.
- **Lab fix:** the runs list showed only the newest 30. That is why 3 v4 slates went ungraded. It is now 300 (`RUN_LIST_LIMIT`).

## 2026-10-19: the gate, the fault picker and the LFD lab
- **Faults (`FAULTS.md`):**
  - 131 memes rated 1 or 2, read and tagged into 11 faults;
  - `meme-faults@1` is validated on 405 graded memes (Jev $0.036);
  - the count's AUC for a bad meme is 0.67 overall (v2 0.76, v5 0.59);
  - within a v5 slate it orders Lucas's ratings only 45% of the time, so the picker keeps #1 by default.
- **Tagger:**
  - `meme-story-tags@3` (three wording rounds, $0.012 in total);
  - agreement with Claude's codes: irony 71%, launch 94%, number 96%;
  - the seed is `.memes-local/predict/story-tags-meme-story-tags-3.json`.
- **Gate:** the odds (`odds.ts`) and the evidence (`odds-store.ts`), with a 92% threshold and at least 5 graded stories per cell.
- **LFD engine, additive only:**
  - `LfdRunDeps.replay`, plus optional bounds on `previousPosts`, `carouselLane` and `lastCarouselRunAt`, with unchanged defaults;
  - the render gains `lfdCover.meme` (the meme above the hook banner) and `photoKind: 'meme'` (the meme whole in the photo box).
- **Simulation:**
  - `lib/memes/lfd-sim/*` holds the query router (Hub read only), the runner, the post with memes and the API;
  - the meme's white render canvas is trimmed before placing.
- **Lab:** `/memes/lfd-lab`.
  - Run as of now, or replay a day picked from a calendar of days with a story batch.
  - Runs need an on-page confirm, because the app's browser pane blocks `window.confirm`.
  - Each run shows the original and with-memes posts side by side, the stories with tags, odds, faults and the pick, and grades for memes and posts.
  - The Gate statistics tab holds the settings.
- **Tests:**
  - `tests/memes-lfd-lab.test.ts`: 18 tests, including an offline end-to-end simulation;
  - the LFD and meme tests: 296 of 296 pass;
  - the full suite: 2,466 of 2,472. The 6 failures are in `shared-queue-explainers.test.ts`, which a separate `lib/explainers/ideas/cycle.ts` commit 2 hours earlier left out of step. They are unrelated.
- **Follow-up, same day (Lucas):**
  - The 5-graded-stories minimum per cell stays; I removed it by mistake and restored it. The lab now shows how many more graded stories each short cell needs.
  - The picker and the drop rule are removed (ME-134). The simulation always uses the slate's #1, and the fault counts are saved for reference only.
  - The would-be pickers survive only as the check in `scripts/memes_faults_validate.ts`.
  - LFD lab tests: 17 of 17 pass.
- **Filling the short cells (ME-137):**
  - Jev tagged the Hub pool for number stories: the top 300 recent, plus the 166 that mention figures ($0.027).
  - Chose 13, leaving out repeats of graded stories and ads, and added a 14th because the full-text retag moved one story to another cell.
  - All 14 went through the new fill route. The gate tab now shows "+N waiting for grades" per cell.
  - Once Lucas grades them, every cell reaches at least 5 graded stories.
- **Simulations run outside Next (2026-10-19):** the first live run failed because the slide renderer is a client component Next won't call from the server. Tommy's engine and the final render now run in a child Node process (`lib/memes/lfd-sim/child.ts`), as the worker runs them; the engine's writes go to an in-memory database there.
- **Live run report:** `memes.lfd_sim_events` plus the lab's "Live run report" panel, which shows:
  - stage chips;
  - elapsed time;
  - spend so far;
  - every step as it happens.

  The engine's steps are read off its calls without changing it (`report.ts` `tap`): scoring candidates, de-duplicating, writing, fact-checking, photos, vision, rendering. Repeated steps fold into one line with a count. Meme runs report each stage.
- **Grade-note fixes (ME-138):**
  - Monkey Puppet: the logo moved onto the puppet.
  - Evil Kermit: the text moved onto each Kermit; face boxes were tightened.
  - The regime is now `fd22b427977c`, declared equivalent to `3af2b639964f` for the gate's evidence.
  - Simulations now queue (up to 3).
  - The LFD lab was reorganised: a fixed run list, a sticky run header with the post grade, and Post, Grade memes, Stories & gate and Run report tabs.
- **Ban and parallel runs (ME-139):**
  - Sleeping Shaq is banned through the availability check.
  - LFD simulations now run up to 3 at once, one lane each; meme runs still go through the one meme runner.
  - Listing simulations starts any queued run that has a free lane.
  - The meme-run wait went from 20 to 45 minutes, so three simulations' runs fit.

## 2026-10-19: LFD with memes ships (ME-140)
- **Production meme stage:** `lib/memes/lfd-post.ts` (live wiring in `lfd-post-live.ts`), called by `carryOutLfdRun` after the engine finishes and before the post is placed. Stories that get memes carry `meme` on `lfd.posts.stories[i]` (template, rank, role, storage object, text). The run record gets `memes`, and the meme spend is added to the run's total.
- **Frozen evidence:** `scripts/memes_gate_snapshot.ts` writes `lib/memes/gate-evidence.generated.json`: 128 graded stories, regime `fd22b427977c` (equivalent to `3af2b639964f`), tagger `@3`, threshold 0.92. The production stage skips memes if the code's regime or tagger no longer match it.
- **Logged data:** `.memes-local/eval/graded-2026-10-20.json` holds 525 rated memes.
- **Shipped from a clean checkout:** branch `feat/lfd-memes`, made from `origin/main` plus only the memes and LFD work, so unrelated in-progress Explainers changes stay out of production.
- **Tests:** `tests/lfd-memes-post.test.ts` (4) cover placement, the post update, the 90-day ledger from posts, the regime guard, and the worker hook (order, spend, failure isolation, off switch). LFD and meme suites: 301 of 301.
- **Full suite in the release checkout:** 2,470 of 2,478; the 8 failures fail the same way on pristine `main` (`shared-queue-explainers`, `explainers-render`, `reels-visual`).
