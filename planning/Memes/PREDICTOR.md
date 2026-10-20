# Pre-generation predictor (started 2026-10-17)

**Goal (Lucas, 2026-10-17):** before a meme is generated, predict whether a story and its inputs will give a good meme.

## Integrity rules
- **One regime only.** A regime is a fingerprint of everything that shapes generation and ranking (`lib/memes/regime.ts`):
  - the writer prompt and tools;
  - every card as the writer reads it;
  - the turn types;
  - the geometry;
  - the judge questions and weights;
  - the models;
  - the lints;
  - the brief prompt version;
  - `REGIME_EPOCH`, for code logic that no data captures.

  The predictor learns only from runs of one regime and predicts only for that regime. When the system changes, the old data stops counting. It isn't adjusted to fit; it is simply excluded.
- **The outcome is Lucas's grades,** never the judges. "Strong" means at least two thirds of the graded slate rated Yes or Awesome.
- **Features are fixed in advance** (`STORY_FEATURES`, `TURN_FEATURES` in `lib/memes/predict.ts`). Nothing is selected on the data it is scored on. Per-feature AUCs are printed for exploration only.
- **Out-of-sample only.** Evaluation is leave-one-out. The model may predict only with at least 60 graded runs (`MIN_RUNS`), a leave-one-out AUC of at least 0.65, and a Brier score better than always guessing the base rate.
- **Prospective record.** From now on every run saves its regime id and its predictor inputs on the slate (`shape.regime`, `shape.predictor`). Predictions can then be checked against grades that come later.
- **Backfill.** The 33 v4 runs of 2026-10-17 predate the saved fingerprint. They are assigned regime `d4d7e9370674` by evidence (recorded in `BACKFILLED_REGIMES`): every hashed file was last changed before the batch started.

## Stages
- **story:** features from the story and its brief, known before the run.
- **story+turns:** adds the turns step 1 kept, known before any meme is drafted.

## Status (2026-10-17, regime d4d7e9370674, v4)
- **Data:** 30 graded runs, base rate 70%.
- **Fixed model, leave-one-out:** AUC 0.42 (story stage) and 0.52 (story+turns).
- **Verdict:** no skill. The regime is closed now that v5 replaced it.

## Status (2026-10-19, regime 3af2b639964f, v5, the frozen system)
- **Data:**
  - 79 graded runs;
  - 58 strong, base rate 73%;
  - 70 of 79 (89%) have at least one good meme.
- **Held-out split:** the 44 stories seen in v4 against the 35 brand-new ones (`.memes-local/eval/v5-new-stories.json`).
- **Reproduce:**

```bash
npx tsx scripts/memes_predict.ts --eval .memes-local/eval/graded-2026-10-19.json
```

### The fixed model
- Leave-one-out AUC 0.52 (story) and 0.46 (story+turns).
- Brier 0.223 against 0.200 for the base rate.
- **Verdict: no skill. It may not predict.** Most of the 12–18 features are noise that drowns the one real signal. Most v5 stories produce a good meme, so most of the variance is between memes within a slate, not between stories.

### Signals (AUC for a strong slate: all / seen before / held out; below 0.5 means "less likely strong")
| Feature | Kind | AUC | Reading |
|---|---|---|---|
| `headlineChars` | confirmatory | **0.33 / 0.30 / 0.35** | Shorter headlines give stronger slates, in both halves. The one reliable pre-generation signal. |
| `meanStrength` (after step 1) | confirmatory | 0.42 / 0.39 / 0.47 | The writer's own turn strength still leans backwards, weakly |
| `probeHarm` (Jev: about harm to people) | exploratory | 0.38 / 0.44 / 0.33 | Harm stories are a little weaker; consistent but weak |
| `hubBlockbuster` | exploratory | 0.61 / 0.55 / 0.69 | Reels blockbuster flag is slightly better; small n (52) |
| `headlineUnknownNames` | confirmatory | 0.46 / 0.47 / 0.46 | Consistent but weak |
| `hubNet` (reels score) | exploratory | 0.43 / 0.76 / 0.46 | **Not reliable:** predicts on the seen stories, not on the new high-score ones |
| `probeTwist`, `probeNiche`, `probeKnownEntities` | exploratory | about 0.4–0.6, inconsistent | No use. v5 finds an angle even without a headline twist. |
| Brief richness (facts, quotes, numbers, tensions, claims), `incident`, turn counts | confirmatory | about 0.45–0.56 | Noise |

### Screening rules (precision and coverage, 90% intervals)
| Rule | Stories passing | Strong slate | At least one good meme |
|---|---|---|---|
| None (base) | 79 (100%) | 73% | 89% |
| Headline ≤ 80 characters | 53 (67%) | 79% [69–87] | 49/53 (92%) |
| **Headline ≤ 70 characters** | 34 (43%) | **85% [73–93]** | 32/34 (94%) |
| Headline ≤ 60 characters | 19 (24%) | 89% [73–96] | 18/19 (95%) |

The ≤ 70 rule holds in both halves: 86% on the seen stories, 85% on the new ones.

**Confound check:** 19 carousel headlines end with " - Outlet name", which pads them. With that suffix stripped, the signal is a little stronger (AUC 0.30 all, 0.29 seen, 0.29 new), and "≤ 70 characters, stripped" passes 39 stories at 85% strong. It is the headline itself, not the lane or the outlet suffix. Measure the screen on the stripped headline.

### Pre-registered for the next graded batch
Before it is used to decide anything, the next graded batch in this regime is the test:

1. **Candidate screen:** "headline ≤ 70 characters". Prediction: about 85% strong slates and about 94% with a good meme, against a base of about 73% and 89%. The cut was chosen after seeing these grades, so it is confirmed only if the next batch matches within its interval.
2. **Secondary:** a story the probe calls harm to people (`probeHarm` ≥ 0.5) is expected below the base rate.
3. **Retired as signals:** the Hub's reels net score, the headline-twist probe, and brief richness.
4. **To reach a fitted model:** keep logging. A one- or two-feature model (headline length, plus harm) is the candidate to fit once a second batch confirms them. More features than signal is what sank the 12-feature model.

## Deep read (2026-10-19, same 79 v5 runs)
Lucas asked for a deeper look at the nature of the stories, the templates, and what good and bad memes share. Data, codes and scripts: `.memes-local/predict/deep-2026-10-19/` (`deep_join.py` first, then `deep1`–`deep5`), plus `story-codes-2026-10-19.json` and `meme-codes-2026-10-19.json`.

**Method and its limits**
- Claude coded all 79 stories on 13 traits (`story_codes.py`, codebook in the JSON) from a dump showing only the headline, the news line, the players and three facts. Grades were hidden.
- Claude coded all 203 slate memes on 6 qualities from a shuffled dump with grades and judge scores hidden.
- **Not fully blind:** the aggregate v5 results and a few story outcomes (the "unmemeable" list) had already been seen. Where Claude's irony code and Jev's twist probe disagree (13 stories), Claude's code matches the outcome every time. That is either a better reading or contamination; it can't be told apart here. Everything below is **exploratory** until an independent coder reproduces it on a new batch.
- About 20 splits were examined, so expect one or two to look strong by chance. Each one is shown on both halves (44 seen, 35 new).

**Story nature matters a lot.** A third of the variance in whether a meme is good sits between stories (ICC 0.34, permutation p < 0.001). The same 30 stories' good rates correlate r = 0.46 between v4 and v5. Memeability is partly a property of the story.

**Story traits (story-level; strong slate %, seen / new)**
| Trait | Stories | Strong slate | Memes good | Reading |
|---|---|---|---|---|
| Base | 79 | 73% | 73% | |
| **Built-in irony** (contradiction, hypocrisy, backfire or reversal visible from headline and news) | 26 | **85%** (92 / 79) | 81% | The strongest trait. Strength 2 gives 89%. |
| **Product launch** | 18 | **100%** (100 / 100) | 85% | "Marketing name vs plain truth" works on every launch |
| Two parties in conflict | 30 | 80% (76 / 85) | 79% | Mild |
| **Story's point is a number** (funding, pay, revenue, valuation) | 10 | **60%** (75 / 50) | **53%** | The weakest kind. Matches `scale-gap` turns at 31%. |
| Business archetype | 12 | 58% | 57% | Mostly the number stories |
| Fame of the main entity, absurdity, everyday relevance, AI acting on its own, jargon, abstraction | | | | Small or inconsistent between halves |

**The candidate screen (exploratory, strongest found)**
| Rule | Stories passing | Strong slate | Any good meme | Memes good |
|---|---|---|---|---|
| (Irony or launch) and not a number story | 34 / 79 (43%) | **97% [88–99]**; seen 95%, new 100% | 34 / 34 | 90% |
| Neither irony nor launch | 37 / 79 | 54% [41–67] | 29 / 37 | 61% |
| Checklist (irony or launch; not number; headline ≤ 70): score ≥ 2 | 56 / 79 | 89% [81–94]; seen 90%, new 88% | 54 / 56 | 85% |
| Checklist score ≤ 1 | 23 / 79 | 35% | 16 / 23 | 46% |

**Contamination-free cross-checks**
- A mechanical "launch word in headline" regex (no human coding): 16 stories, 94% strong (seen 91%, new 100%).
- (Jev twist ≥ 0.5 or a launch word) and no number in the headline: 30 stories, 87% strong (79 / 100).
- The direction holds without Claude's codes; the size is smaller.

**Meme qualities (blind to grades; good rate, seen / new)**
| Quality | With | Without |
|---|---|---|
| A headline-only viewer fully gets it | 88% (86 / 89) | 67–71% |
| Needs a detail not in the headline | 68% | 83% (79 / 92) |
| Template mechanism used correctly | 77% | 59% |
| One sharp contrast or punch | 78% | 65% |
| Literal restatement; maps onto the viewer's own life | about the same; inconsistent between halves | |

- Body details don't buy Awesomes either: 5 of 137 with one, against 2 of 66 without.
- Within a slate, "one sharp contrast" orders Lucas's ratings 73% of the time, template fit 67%, headline-only 64%. The judges' combined score: 54%.

**Templates are mostly a story effect**
| Template family | Good | On irony stories | On plain stories (no irony, not a launch) |
|---|---|---|---|
| Relabel or spin (Tuxedo Pooh, Scooby Mask, Pigeon) | 82% | 9 / 11 | 10 / 14 |
| Choice (Drake, No-Yes, Left Exit 12) | 81% | 6 / 7 | 7 / 10 |
| Self-own sequence (Gru, Bike Fall, Bad Luck Brian, Anakin) | 79% | 12 / 13 | 17 / 23 |
| One-line caption formats | 73% | 9 / 13 | 15 / 22 |
| Then vs now, strong vs weak (Buff Doge, Evil Kermit) | 57% | 7 / 10 | **2 / 8** |
| Calm amid chaos, awkward (This Is Fine, Hide the Pain, Monkey Puppet) | 56% | 9 / 10 | **3 / 9** |

The weak families fail on stories with no tension to carry. Given a real irony, they work.

**Pre-registered for the next graded batch (same regime, new unscreened stories)**
1. Before grades are opened, an independent coder (Lucas, or a fresh model with this codebook) codes each story for irony (0 / 1 / 2), launch, and "the point is a number".
2. **Predictions:**
   - "(irony or launch) and not a number story": at least 90% strong slates and essentially every slate with a good meme;
   - "neither": about 55% strong;
   - number stories: below the base rate.
3. The mechanical launch-word proxy is scored too: expected about 90% strong.
4. If it holds, this replaces headline length as the main screen. Headline length stays as the tiebreak.

## Next
- Grade a fresh batch of v5 runs (new stories, no screening) and score both pre-registered rules on it with `scripts/memes_predict.ts --split <new ids>` and the deep-read scripts.
- Then decide whether to screen story picks with the checklist.

## The gate in use (2026-10-19, LFD lab)
The deep read became a working gate (DECISIONS ME-130 to ME-136):
- `lib/memes/story-tags.ts` is the Jev tagger.
- `lib/memes/odds.ts` holds the cells and shrinkage.
- `lib/memes/odds-store.ts` counts the evidence from the grades.

The lab's "Gate statistics" tab shows the evidence live.

**Starting evidence (79 v5 stories, tagged by Jev `@3`):**
- "Irony or launch, not a number story, short headline": 19 of 20 had a good meme (94% after shrinking). This is the only cell that clears 92% with 5 or more graded stories.
- Four cells have fewer than 5 graded stories, all of them number stories. Each must be filled through grading so it can be judged (Lucas, 2026-10-19).
- On the gate's outcome (any good meme), Jev's irony tag splits stories about as well as Claude's did: 27/29 against 43/50, where Claude's codes gave 25/26 against 45/53.
- On strong slates, Jev's tags separate stories much less. "Irony or launch, not a number" gave 97% strong with Claude's codes and 74% (34/46) with Jev's.

That gap is the honest cost of an automatable tagger. Lab grades only come from gated stories, so the blocked cells won't gain evidence from the lab.

### Evidence after the number-story fill (2026-10-19, evening)
102 graded stories, tagger `@3`, regime `3af2b639964f`: 89 of 102 (87%) had a good meme in their slate. Every cell now has at least 5 graded stories.

| Cell (irony or launch / number story / short headline) | Good | Odds | Gate at 92% |
|---|---|---|---|
| Yes / No / Yes | 20/21 | 94.6% | **passes** |
| Yes / No / No | 24/27 | 89.2% | – |
| Yes / Yes / Yes | 6/7 | 83.9% | – |
| Yes / Yes / No | 5/7 | 74.8% | – |
| No / No / Yes | 13/14 | 91.0% | – (just under) |
| No / No / No | 9/12 | 77.4% | – |
| No / Yes / Yes | 6/7 | 85.7% | – |
| No / Yes / No | 6/7 | 85.7% | – |

**By factor:**

| Factor | With it | Without it |
|---|---|---|
| Number story | 23/28 (82%) | 66/74 (89%) |
| Irony or launch | 55/62 (89%) | 34/40 (85%) |
| Short headline | 45/49 (92%) | 44/53 (83%) |

**Reading:**
- The extra number stories confirm the deep read: stories whose point is a figure do worse.
- Short headlines remain the strongest single signal.
- One cell passes the gate.
