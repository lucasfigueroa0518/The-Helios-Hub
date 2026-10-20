# v5 grades: findings and suggestions (2026-10-19)

**Status:** the system is frozen at v5, regime `3af2b639964f` (Lucas, 2026-10-19: "good memes more often than not"). This file is intel; nothing here has been changed. The suggestions are for a future iteration if one is ever wanted.

**Data:**
- 79 v5 slates (44 stories also run in v4, plus 35 brand-new high-score stories), 203 slate memes, all graded.
- Analysis scripts are in the session scratchpad. The predictor numbers come from `scripts/memes_predict.ts`.

## Where v5 stands
- **Overall:**
  - good 148 of 203 (73%);
  - Awesome 7 (3%);
  - Horrible 3.
- **By story set:** the stories seen before were good 71% of the time (83/117), the 35 new ones 76% (65/86). The system generalizes to unseen, high-score stories.
- **Paired with v4** (30 stories graded in both):
  - good 74% against 68%;
  - v5 better on 11 stories, worse on 7, the same on 12;
  - slates with at least one good meme: 27 and 27.
- **Slates:**
  - with a good meme: 70 of 79 (89%);
  - strong (at least two thirds good): 58 (73%);
  - every meme good: 44 (56%).

## What v5 fixed (the v4 gaps that closed)
| Gap in v4 | v4 | v5 |
|---|---|---|
| Text-carried vs picture-carried templates | 40% vs 72% | 70% vs 73% |
| Incident (harm, crime, courts) stories | 46% | 72% (non-incident 73%) |
| Restructured templates vs the rest | 52% vs 79% | 70% vs 75% |
| Writer turn strength (rated 3 vs rated 2) | 56% vs 73% | 70% vs 74% |
| Lines with a number the headline doesn't show | 20% of memes | 9% (and 53% good when present) |

## What got worse, and the remaining weaknesses
1. **Peak quality dropped.** On the paired stories, slates with an Awesome fell from 8 to 1, and the overall Awesome rate fell from 12% to 3%.
   - v4's Awesomes leaned on one vivid, concrete detail from the article body ("i'm wrapped in toilet paper", "The trail ends at our own engineer").
   - v5's headline-visible and number rules made the writer cautious. Average up, ceiling down.
2. **The ranking lost its power.** The judges' combined score agrees with Lucas within a slate 54% of the time (v4: 76%).
   - `real_meme` (given weight in v5) is at 40%, worse than chance.
   - `gets_it`, the headline-only reader, is at chance (51%; AUC 0.48).
   - The best within-slate orderers are now `off_limits`, where lower is better (71%), the shortest longest line (70%), and `legible` (65%).
   - Slates are more even now: #1 is good 76% of the time, #3 71%.
3. **Number-contrast turns:** `scale-gap` turns were good 4 of 13 times. Bad examples: "I guarantee up to US$105 billion", "I'm on 51 in all".
4. **Long memes:** 3 text boxes were good 62% of the time and 4 boxes 43%, against 75–79% for 1–2 boxes. A line over 45 characters: 62%.
5. **Templates that still go literal** (n ≥ 7): Flex Tape 3/8, Buff Doge 4/9, Evil Kermit 3/7, Disaster Girl 3/7, Monkey Puppet 1/4. The strong ones: Tuxedo Pooh 16/17, Anakin 11/11, Trophy 9/10, Absolute Cinema 6/6, No-Yes 9/11.
6. **Unmemeable stories.** The same stories fail in every version: the Xcode-replacement tool, the AI-leader quote tracker, NVIDIA's UK compute pledge, the Apple hiring-records order, the NZ voter survey, the Grace Hopper cancellation. This is a story problem, not a template problem, and the predictor's job (`PREDICTOR.md`).

## What the good memes share
- **A single sharp contrast in parallel words:** "I answer to safety rules and inspection / my safety rules are voluntary"; "Revenue down $20bn / A different way of counting".
- **The figure speaking in its own voice, deadpan.**
- **The headline's main company on the image.** Memes with one logo were good 78% of the time, against 71% with none.

## Suggestions (only if iteration resumes)
1. ~~Allow one vivid body detail per meme.~~ **Withdrawn after the deep read** (`PREDICTOR.md`): memes that need a detail the headline doesn't show were good 68% of the time, against 83% for those that don't, in both halves, and they don't produce more Awesomes (5 of 137 against 2 of 66). The headline-visible rule is right. The ceiling has to come from somewhere else. Story choice is one lead: 4 of the 7 Awesomes came from stories with built-in irony, which supplied only a third of the memes (small numbers).
2. **Re-fit the ranking on the v5 grades.** Drop `real_meme`'s weight, add `off_limits` (lower is better) and the longest-line term, and keep `gets_it` out. Replay on v5 first, as before. The deep read adds candidate judge questions that order Lucas's ratings within a slate: "one sharp contrast" (73%), "template mechanism used correctly" (67%), "a headline-only viewer gets it" (64%).
3. **Number contrasts:** make `scale-gap` require the contrast to be readable without the numbers, or route it to templates where a single number is the punch.
4. **Cap memes at 2–3 written boxes** unless the format needs more (Gru's Plan, Expanding Brain).
5. **Template work:** re-read the dossiers for Flex Tape, Buff Doge, Evil Kermit and Disaster Girl; their v5 failures repeat the misreads the dossiers name.
6. **Don't generate for stories the predictor screens out**, rather than trying to make every story work. The deep read's candidate screen is irony or a product launch, and not a story whose point is a number (`PREDICTOR.md`).
8. **Weak template families only on tense stories.** "Then vs now" (Buff Doge, Evil Kermit) and "calm amid chaos" (This Is Fine, Hide the Pain, Monkey Puppet) were good 2 of 8 and 3 of 9 on plain stories, but 7 of 10 and 9 of 10 on stories with built-in irony.
7. **Raise the writer's max tokens** from 8,000 back toward 10,000: 3 of about 80 runs (4%) were cut off.
