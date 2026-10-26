# Upgrade v5: headline-visible memes (2026-10-18)

## Context
On the 26 stories Lucas graded in both versions, v4 beat v2: 67% of memes good against 52%, and 8 slates with an Awesome against 2. The bad v4 memes share one cause, seen from two sides:
- **The writer's side (Claude's analysis): transcription.**
  - Lines carry facts and numbers from deep in the brief.
  - Memes copying 75% or more of their words from it were good 54% of the time; anchored-but-reshaped ones (50–75%) 88%.
  - Lines with a number not in the headline: 47% good against 75%.
- **The viewer's side (Lucas): the viewer only has the headline.**
  - A meme built on entities, numbers or technical relations from the article body makes no sense to them.
  - In the data, memes whose words are 40% or more from the headline or news line were good 86% of the time, against 64%.
  - Two or more named things outside the headline: 59%, against 77%.

Smaller findings:
- The writer's own turn strength rating runs backwards: turns rated 3 gave 56% good memes, turns rated 2 gave 73%.
- Text-carried templates were good 40% of the time, against 72% picture-carried; this replicates v3's 44% vs 73%.
- Memes with 4 text boxes: 1 of 3 good.
- Harm and incident stories: 42–46% good.
- The ranking works: the #1 meme is good 83% of the time.

## The rule for every change: additive only
A change goes in only if it targets an observed failure and cannot plausibly cost good memes:
- **Code gates and ranking changes** are replayed on the graded v4 set first, and adopted only if no measure gets worse.
- **Prompt changes** are scoped to the failure they target.
- Anything that failed its replay is listed under "Tested and not adopted".

## Changes
| # | Change | Kind | Evidence or replay |
|---|---|---|---|
| U1 | **Headline-visible rule.** The writer is told the viewer sees only the headline and the meme. Every meme is built on the headline's main entities, and their relation must make sense from common sense. Any other name, term or number has to explain itself or stay out. Step 2's message opens with what the viewer sees. | Writer prompt (steps 1 and 2) | Lucas's observation; the anchoring, outside-names and transcription splits above |
| U2 | **Numbers:** a number only when it is in the headline or the news line, or when the number itself is the joke. | Writer prompt | Lines with digits: 47% vs 75%. A hard gate was replayed and rejected (it would drop 6 of 53 good memes along with 9 of 25 bad). |
| U3 | **Turn strength redefined:** 3 means a follower who reads only the headline gets it at a glance and it stings; a turn that needs the article body is a 1. | Writer prompt (step 1) | The writer's strength ran backwards (56% vs 73%); code keeps the strongest turns, so it was picking worse ones. |
| U4 | **Fill only what carries the joke:** an optional slot stays empty unless it adds the joke, and no box restates a fact for completeness. | Writer prompt (step 2) | 4-text-box memes 1/3; the restructured templates were filled with fact logs |
| U5 | **Incident stories get their own angle.** When the story reads as harm, crime or the courts (code-detected), step 1 is told to aim at the company's process, spin or absurd detail, never the harm or the people. | A note on the step-1 message, only for those stories | Incident stories 42–46%; in 2 of them the judges dropped 9 of 10 drafts as off limits; the absurd incident produced 3 Awesomes |
| U6 | **`real_meme` gets rank weight 1.** | judges.ts RANK_WEIGHTS | Replay on v4: within-slate agreement 76% to 79%, #1 good 25 to 26 of 30, AUC 0.73 unchanged, top-2 unchanged. It also predicts Imgflip winners (0.67) and Lucas's grades (0.62). |
| U7 | **New judge question `gets_it`:** it sees only the headline and the printed meme (no facts) and asks whether a casual follower would get it. | judges.ts, weight 0 | The current `legible` sees the facts too, which is likely why it barely separates (72% vs 58%). It is asked now and weighted only once calibrated on graded memes. |
| U8 | **Predictor v2 features,** fixed before any v5 grade: how familiar the headline's names are, and its uncommon words. | predict.ts | Lucas's observation. They are scored prospectively only, never on the v4 grades that suggested them. |
| U9 | **Pipeline v5;** the regime fingerprint changes automatically. | run.ts | Integrity: v4 data never trains or scores v5 |

## Tested and not adopted
- **A number gate (drop the meme):** it costs 6 good memes for 9 bad.
- **A number ranking penalty:** AUC 0.73 to 0.77, but within-slate agreement drops 76% to 71% and top-2 good drops 43 to 42.
- **A heavier picture weight in the ranking:** no change in any measure.
- **Reordering turns by headline anchoring:** the signal is not monotonic (63%, 77%, 67% across thirds).
- **A slate of two:** #3 is still good 48% of the time, and one Awesome came from #3. Fewer memes would lose good ones.

## Not changed, on purpose
- **Text-carried templates:** a real effect, but no change that leaves everything else no worse has been found yet. U1, U2 and U4 target the transcription that sinks them.
- **The restructured templates:** their 52% is confounded with transcription (fact logs in the new boxes). U1 and U4 come first; they are re-measured on v5.
- **Viewer lines:** too little evidence (v2: 4 of 5 good).

## The run (Lucas, 2026-10-18)
- **The same 44 briefed stories as v4:** 33 graded in v4, plus 11 never run.
- **35 brand-new stories the meme generator has never seen, chosen by score** (Lucas, 2026-10-18: "use high scoring stories ... stories likely to be published"):
  - **Pool:** the lab's candidates with no brief, no meme run and a body of at least 500 characters.
  - **Scores:** read from the Hub (read-only): the reels' best nightly net score, and the carousel daily shortlist rank.
  - **Pick:** 20 by highest reels net, then 15 by carousel rank (1–4).
  - **Skipped:** stories in the skip-list categories (children, sexual content, CSAM, terrorism, killing or homicide; 11 headlines), and near-duplicates of a v4 story or an earlier pick (two or more shared distinctive words).
  - **Briefs** come from the article body (from-body mode).
  - **List:** `.memes-local/eval/v5-new-stories.json`.
- **Estimated cost:**
  - briefs: about $1–1.5;
  - 79 runs at about $0.13: about $10.3;
  - total: about $12.
- **Measures after grading:**
  - paired v4 vs v5 on the same stories: good rate, slates with a good meme, Awesomes;
  - v5 on the new stories, to check it generalizes;
  - the headline anchoring and number splits, re-measured;
  - `gets_it` calibration;
  - the predictor, scored prospectively.
