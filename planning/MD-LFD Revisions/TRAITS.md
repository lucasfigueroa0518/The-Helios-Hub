# What makes a story good: Lucas's 79 ratings (2026-11-22)

Source: lab set `set-2026-11-222108`. 79 of 80 stories rated 0–10 on Cool and Need, 24 with notes. No model calls: these are free comparisons against the scores already stored in the intake.

## Stats (rank correlation with your ratings, −1 to 1)
| Today's signal | Cool | Need | Your best of the two |
|---|---|---|---|
| major-news@3 | **−0.09** | +0.39 | +0.12 |
| story-builder@2 | +0.38 | +0.10 | +0.35 |
| Number of sources | +0.05 | +0.27 | +0.18 |
| max(major, builder), i.e. today's lead logic | +0.09 | +0.35 | +0.25 |

- Today's top 10 by stored score averaged **1.8 Cool / 4.5 Need**. Your own top 10 averaged **6.6 / 6.0**.
- Major-news can't see Cool at all. Builder sees some of it.
- Cool and Need are only loosely related (+0.30), so they really are two different things, and the ranker needs both.
- 14 of 79 stories got 0/0. Today's logic let them all through.

## Shared traits, from concrete to abstract

### 1. Concrete: what's on the page
- **A specific, checkable feat or number.** These score high: 400 novels, a woman found after 5 years, 70 mph food drones, a $100B IPO. Vague items score low ("the text gives no further details", "not enough juice").
- **A picture exists, or could.** You conditioned many Cool scores on a visual: the game, the interactive explainer, the SNES chatbot, Garfield as Altman, Etisalat, AdMob. *Visualizability* is a real input, not decoration.
- **Plain language.** Jargon sinks a story even when the thing matters (ExtendDB 1/1; the Autopilot note: "talking in technical terms").
- **US reach lifts Need.** NY attorney general: "relevant to our American audience." UK Palantir: "if it was USA, the need score would leap." EU, Italy and Ontario rulings all sat at 0–1 Need.

### 2. Middle: what kind of story it is
- **An event, never commentary.** Every op-ed, column, letter, panel or radio segment scored 0. Your notes say the *underlying event* can still be great (the priest piece: Anthropic courting clergy is "a GREAT story"; Newsom's proposal would have been good). The ranker has to judge **the event the article points to, not the article itself.**
- **Ordinary or unexpected people using AI in real life** are your Cool peak: police, a romance author, Paul Schrader, a writer rebuilding a childhood game, a Stripe manager.
- **Power shifts at the top** are your Need peak: a CEO resigns under a spy probe, a frontier model release, a record IPO, a state suing OpenAI.
- **Being part of a bigger ongoing story raises a minor item.** Nvidia's H200 halt, the Megaspeed probe and OpenAI's AMD move each scored only because they tie to the Huang story.
- **A big name alone isn't enough.** Altman on RAM (0/1), Google's Gemini deal with US agencies (0/0) and Nadella's opinions (5/4): "only matters when he's saying something shocking or that affects people."
- **Wrong format.** Tools, libraries and how-tos (Ragas, last30days, the compiler guide, SolidJS) "should be Field Notes": an intake routing problem, not a ranking one.

### 3. Abstract: why a person cares
- **Cool = a "wait, really?" you can picture.** AI doing something in the physical or everyday world that a person can imagine happening to them or someone they know, or something that used to be impossible becoming normal.
- **Need = the ground shifting under people like the audience.** Who holds power, what rules they live under, what threatens them, or what they can now buy or do.
- **Best = both at once:** a big, concrete change with people at its center and a picture to show.
- **Worst = talk about AI**, or a niche institution's process the audience can't feel.

## Stories that break the pattern (honest gaps)
- The Riemann Hypothesis proof with Claude had 54 sources and a huge claim, but scored only 5/2. Maybe abstract achievements don't land without a human, picture-able angle. Worth asking you.
- The Anthropic IPO got 5/5 and 2/4 for two versions of the same event. The duplicate scored lower: the same-event check should keep only the stronger write-up.
- The UN/UCL climate-flipping study got 1/5. A safety finding with a measured result still wasn't Cool.

## What this means for the ranker (candidate questions, to be written without examples)
1. **Event gate:** judge the event the article reports or points to. Pure opinion or commentary with no event fails.
2. **Picturable surprise** (Cool): would a non-expert picture it and say "wait, really?"
3. **People at the center** (Cool): a person or group doing or suffering something concrete.
4. **Power or rules shift** (Need): changes who leads, what's allowed or what's safe, for a broad audience.
5. **Audience reach** (Need): does it reach US people's lives or money? Outside the US, only if it touches them.
6. **Thread:** is it part of a larger story the audience is already following?
7. **Substance:** does the text carry enough specific detail to make a post?
8. **Visual potential:** is there a strong image or demo to show?
9. **Routing:** tools and how-tos go to Field Notes, before ranking.

## Round 2: the 20 hand-picked stories (2026-11-22)
- **Picks averaged 11.6 (Cool + Value).** The best 20 of the original 80 averaged 11.2, and all 80 averaged 5.8. Picking by the traits beat the top quarter of a random set.
- **Proven picks 12.2, chances 9.6.** Irony and hypocrisy worked (Dartmouth provost, 8/3). Grief (Jeju mother, 7/2) and an abstract feat with a historic figure (Gödel, 6/2) didn't, which confirms the Riemann signal. Backlash and spectacle (Amsterdam protest, 5/5) and infrastructure absurdity (jet engines, 4/6) were middling.
- **Top scores:** the airspace shutdown after the AI tool (7/9) and Apple's home robot (9/7). Both are concrete, US-wide or picturable, and touch ordinary life.
- **Another state lawsuit (Oregon, 2/6)** scored low. One more suit in a series adds little unless it's new or human.
- **"Visual important"** appeared on 5 of the 20. Visual potential belongs in the ranker as its own question.

## Lucas on how he grades (2026-11-22)
> "I do consider the sum of the grades. I'm hesitant to give a story that isn't truly amazing high grades on both."

- **The target is Cool + Value**, not each scale on its own. Across 99 ratings, only 2 stories got 7+ on both, and the highest sum is 16.
- **What that means for the ranker:**
  - Rank by the sum (the 50/50 mix).
  - Judge variants on how they match your sum.
  - Let a story win by being very high on one scale and solid on the other. Never require both to be high.
  - Scores should be calibrated, keeping 9–10 for the rare story, so the sum doesn't saturate.
