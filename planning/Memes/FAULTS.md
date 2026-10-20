# What bad memes have in common (2026-10-19)

**Source:**
- Every meme Lucas has rated 1 (Horrible) or 2 (No) in any round: **131 memes** (v2 41, v3 10, v4 25, v5 55), from `.memes-local/eval/graded-2026-10-19.json`.
- Claude read each one and tagged it with every fault it shows. A meme can have several.

**Use:** this list is the basis of the fault scorer (`lib/memes/faults.ts`, `meme-faults@1`), a Jev node that counts each slate meme's faults. It was built to let a picker pass over a bad #1. It could not (see Validation), so its counts are reference only. The question wording is in the code. Whether each question separates bad memes from good is measured on all 405 graded memes before it is used (see "Validation" below).

## The faults, most common first
| # | Fault | Bad memes with it | Example (headline → meme) |
|---|---|---|---|
| 1 | **Confuses a first-time viewer.** With only the headline, a viewer can't tell what the meme says or why it's funny. | 64 of 131 (49%) | "Anthropic's Claude Sent a False Homicide Tip": *Test Claude Haiku 4.5 / gives the test live internet / cuts live internet for all tests* (Lucas: "Makes no sense.") |
| 2 | **Rests on a detail the headline doesn't give:** a name, number, quote or event from deep in the article. | 62 (47%) | "Judge orders OpenAI to turn over hiring records": *Judge: no to metal finishes and power management files* |
| 3 | **Template misused:** the boxes don't play the roles the format needs (the "culprit" isn't the cause, the "patch" isn't an inadequate fix, the panels don't contrast the way the format does). | 56 (43%) | Disaster Girl on "Grace Hopper Celebration Cancelled": mess *Registrations below the costs*, culprit *Cancelled the whole celebration* |
| 4 | **No joke:** a plain restatement of the news in the template's shape, with no turn, exaggeration or punch. | 33 (25%) | Mocking SpongeBob: *Industrial Next says it retools lines in minutes* |
| 5 | **Carried by numbers:** the joke only works by comparing figures. | 21 (16%) | Buff Doge: *I guarantee up to US$105 billion / i just invest US$30 billion in my customer* |
| 6 | **Technical or insider relation:** getting it needs developer, research, legal or industry knowledge. | 20 (15%) | Tuxedo Pooh on xtool: *Posing as a Pixel 7 / Updating the device fingerprint* |
| 7 | **Muddled:** more than one idea, or no single clear contrast between the boxes. | 19 (15%) | Two Guys on a Bus: *Job hunters outside Dublin / Job hunters in Dublin* |
| 8 | **Off the point:** the joke is about a side detail, not the story's main news. | 8 (6%) | Trophy on the Grace Hopper cancellation: *refund answer / If it came before October 26* |
| 9 | **Too long:** full sentences, several clauses, four crowded panels. | 8 (6%) | Expanding Brain with four sentence-long takes |
| 10 | **Wrong figure:** a logo or person who isn't who the story is about, or a subject cast in a role it didn't play. | 7 (5%) | Disaster Girl with Apple as the culprit for OpenAI's files (rated 1) |
| 11 | **Mocks a sympathetic person:** a victim, a private individual, someone the story treats kindly. | 3 (2%) | Roll Safe on the man who found his birth mother: *if you only ask ChatGPT at 66* |

**Coverage:** 130 of the 131 bad memes show at least one of faults 1–4.

## What this says
- **The viewer's position drives it.** Faults 1, 2, 6 and 8 are all "the meme assumes knowledge the viewer doesn't have". Lucas named the same thing: a viewer sees only the headline and the meme.
- **Format mechanics matter as much as the idea.** Fault 3 sits on 43% of bad memes. Disaster Girl, Flex Tape, Evil Kermit and Buff Doge account for most of it.
- **Numbers and insider relations** are smaller but sharp. They also match the story-level finding that stories whose point is a number do poorly.

## How the scorer uses this
- **Jev questions:** one yes/no question per fault, 1 to 8, 10 and 11. Fault 9 ("too long") is measured in code: the longest written line over 45 characters, or 4 or more written boxes.
- **Input:** Jev sees the headline, the template's name and how it works (`howItWorks`), the printed lines in reading order, and the story's news line, which is needed for "off the point" and "wrong figure".
- **Fault count:** the number of faults at 0.5 or above.

## Validation (2026-10-19, `meme-faults@1`, 405 graded memes, Jev $0.036)
Reproduce: `npx tsx scripts/memes_faults_validate.ts --eval .memes-local/eval/graded-2026-10-19.json`. Scores are cached in `.memes-local/predict/meme-faults-meme-faults-1.json`.

**Across all graded memes it separates bad from good, modestly.**
- The AUC of the fault count for a bad meme is 0.67 overall:

  | Version | AUC |
  |---|---|
  | v2 | 0.76 |
  | v3 | 0.55 |
  | v4 | 0.64 |
  | v5 | 0.59 |

- The good rate falls as faults rise:

  | Faults | Good |
  |---|---|
  | 0–1 | 84% |
  | 2–3 | 77% |
  | 4–5 | 62% |
  | 6 or more | 47% |

**Jev over-flags.** It flags "template misused" on 92% of bad memes but also 82% of good ones. "Confuses a first-time viewer" is 70% against 61%.

**Two questions carry nothing.** "No joke" (AUC 0.50) and "carried by numbers" (flagged on 4% and 3%).

**Within a v5 slate it cannot pick.** Fewer faults matched Lucas's order in only 22 of 49 pairs (45%).
- Per-fault bars fitted on v2–v4 and tested on v5 don't fix it (45–51%).
- No single question exceeds about 60%.

For comparison, Claude's blind reading ordered the same slates 64–73% of the time (PREDICTOR.md "Deep read"). The within-slate judgment is beyond what this Jev model does today.

**Picker on the 72 graded v5 slates**
- "Always #1": 54 of 72 good (75%).
- Every switching margin did worse. The best was m2 2 / m3 3 at 72%; m2 1 / m3 2 was 69%.
- Every drop limit below 8 dropped more good #1s than bad ones. At 6 it drops 4, only 1 of them bad.

**Decision (ME-134): no picker.** A story's meme is always its slate's #1, with no drop rule. The fault counts are still computed and shown on every lab meme, for reference only, so a better scorer can be measured against them later with this script.

**Next options**, if choosing among a slate is tried again:
- a stronger model for the fault pass (a Claude Haiku call per meme is about $0.003);
- or a fault-set `@2`, rewritten from the 10 v5 slates where #1 was bad and another meme was good.
