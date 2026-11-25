# Real or AI?: research for a possible pivot of Free vs. Paid (2026-11-15)

Status: research only. Nothing decided, nothing built. The Free vs. Paid 2.0 build stays parked in the
`Helios-Hub-fvp` worktree (branch `feat/fvp-2`) until Lucas decides.

## 1. What the research says makes people fail

| Finding | Source | What it means for the game |
|---|---|---|
| People are right only **62%** of the time (12,500 people, 287,000 judgements). Faces 65%, **landscapes 59%**. | Microsoft AI for Good, "Real or Not" quiz (2025) | Scenes and landscapes are harder than faces. Lead with them. |
| The **three hardest images were real photos** (only 12%, 14% and 18% of people called them right). They had unusual lighting or looked "too perfect". | Same study | The best item is often a **real photo that looks fake**. People now over-call "AI". |
| Humans mislabel **38.7%** of images; portraits are the easiest kind to call. | Lu et al., HPBench, NeurIPS 2023 | Same direction: objects, animals, places and scenes beat close-up faces. |
| Detection depends on **scene complexity, artifact type, display time and human curation**. Less time = worse accuracy (50,444 people, 749,828 judgements). | Kamali, Groh et al., CHI 2025 | A 5-second Story helps the game. A human picking the best image is itself a big part of how real an AI image looks. |
| People catch AI through five kinds of tells: **anatomy** (hands, teeth), **style** (too smooth, too glossy), **function** (objects that wouldn't work), **physics** (shadows, reflections), **sociocultural** (things that wouldn't happen). | Kamali et al., "How to distinguish AI images" guide | The checklist for screening: an AI image with any visible tell is too easy, so reject it. A real photo that seems to break one of these rules is a strong pick. |
| A dataset was built only from AI images that human annotators thought were real, and almost every detector failed on it too. | Yan et al., "Chameleon", 2024 | Proof that a "fooled humans" set can be curated. Their licence is research-only, so it's a model to copy, not a source. |
| AI faces can be judged **more** real than real faces. | Nightingale & Farid, PNAS 2022; Miller et al., Psych. Science 2023 | Faces can work, but they carry deepfake and real-person risk. Keep them rare and never of a real person. |

**The two levers that make an item hard:**
- **Real but looks AI:** surreal nature, perfect symmetry, odd coincidences, strange animals, extreme lighting or colour, macro shots, space.
- **AI but looks real:** mundane, amateur and imperfect. Phone-snapshot framing, flash, grain, slight blur, clutter, no readable text, no close-up hands.

## 2. How others run it

- **Big quiz formats** (Microsoft "Real or Not", NYT "Which faces were made by AI?", UW "Which Face Is Real", Northwestern "Detect Fakes") share a pattern:
  - one image at a time
  - a forced choice
  - an instant reveal that teaches **the tell**
  - a running score
- **InvestigateTV's "AI or Real?"** news series reports videos reaching up to 15M views each. The hook is the curiosity gap, and the payoff is learning how to tell.
- **"Siblings or Dating"** on Instagram is the closest Stories-native analogue: one photo, a guess in a Story poll, and the answer next.
- **A TikTok "which photo is real?" challenge** reportedly reached about 150× the creator's usual views. This comes from one vendor case study, so treat it as a weak signal.
- **What none of them do:** repeat a pattern viewers can learn. The answer mix has to stay unpredictable.

**Our constraint:**
- The Instagram API can't add poll or quiz stickers to a Story, so the game works like AI Trivia: guess, tap, reveal.
- A reveal frame that shows proof is the payoff:
  - **real:** where and when, plus the photographer credit, which doubles as proof
  - **AI:** "AI", with the tell circled in pen

## 3. Where the images come from

| Side | Source | Licence | Fit |
|---|---|---|---|
| Real | **Our photo bank** (StockSnap CC0, Openverse, Wikimedia Commons, government) | cleared, already filtered | Good base. Needs a "looks-AI" tag or score, which it doesn't have today. |
| Real | **Wikimedia Commons Featured / Quality pictures**, NASA, NOAA, USGS | CC BY-SA (credit needed) or public domain | Best for "too perfect to be real" shots. The credit belongs on the reveal anyway. |
| Real | Viral "real photos people thought were AI" (e.g. the 2024 1839 Awards flamingo) | copyrighted | No. Only as a talking point. |
| AI | **We generate them** (our image models, e.g. via Higgsfield) | ours | Recommended: clean rights, any theme, and we can hit the "mundane realism" recipe. Cost is cents per image. Make about 6–10 candidates to keep 1. |
| AI | Research datasets (Chameleon, HPBench) | research-only | No for a commercial account. |
| AI | Famous viral fakes (Pope puffer jacket and the like) | unclear, real people | No. |

**A strong recipe: matched pairs.**
1. Take a real bank photo.
2. Describe it with a vision model.
3. Generate an AI twin in the same style.

The subject then gives nothing away. This works for "Which one is real?" and also gives a steady supply of single-image rounds.

## 4. Thematic map (draft, like Trivia's content map)

Cross a **subject** with a **trap**:
- **Subjects:**
  - nature and weather
  - animals
  - cities and architecture
  - food
  - everyday interiors
  - travel spots
  - space
  - vehicles
  - crowds and events (no identifiable people)
  - history (old photos)
- **Traps:**
  - real looks too perfect
  - real looks impossible
  - AI looks mundane
  - AI looks amateur
  - matched twin

The trap decides whether the round's answer is Real or AI. The scheduler keeps the answer mix close to 50/50 and avoids runs of the same answer.

## 5. Proving an image is "hard" before it posts

The whole game rests on this step. Cheapest first:
1. **Tell scan** (vision model, cheap). Score each candidate on the five tell categories.
   - An AI image with any visible tell is rejected.
   - A real image scores higher the more it *seems* to break one.
   - This is a filter, not proof: model difficulty is not the same as human difficulty.
2. **Human calibration lab** in the Hub, like the meme lab. Lucas and the team swipe Real or AI with each image shown for 3 seconds. Only images that fool at least ~40% go into the pool. This is a real human signal at zero API cost.
3. **Optional paid panel** (Prolific or similar) for a larger sample: about $0.10–0.20 per judgement.
4. **Feedback over time:** keep Story metrics per round (replies, taps). We can't read poll answers through the API, so this signal is weak. The lab becomes the training data for a predictor later.

## 6. Risks
- **Meta's "AI info" label.**
  - Meta auto-labels uploads that carry C2PA or IPTC "AI generated" metadata.
  - Our clips are rendered video, which drops the source image's metadata, so an auto-label is unlikely.
  - Meta also asks creators to disclose photorealistic AI video. The reveal frame discloses it every time.
  - Worth one check of current policy before launch.
- **Never** an AI image of a real person, a real news event or a real brand. This avoids misinformation and the rules on deceptive content.
- **CC BY-SA credit.** Commons photos need a credit. Put it on the reveal frame; FVP's "no credits" rule (FVP-10) can't carry over here.

## Sources
- Microsoft AI for Good, "How good are humans at detecting AI-generated images?": https://www.microsoft.com/en-us/research/?p=1157417 ; coverage: https://petapixel.com/2025/07/30/a-little-over-50-of-people-can-recognize-ai-images-from-real-photos , https://www.neowin.net/news/barely-better-than-chance-microsoft-reveals-just-how-bad-we-are-at-detecting-ai-images/
- Kamali, Groh et al., CHI 2025: https://arxiv.org/abs/2502.11989v1 ; https://www.hullmanlab.northwestern.edu/paper/2025/06/01/photorealism.html
- Lu et al., HPBench / Fake2M, NeurIPS 2023: https://arxiv.org/abs/2304.13023
- Yan et al., Chameleon / AIDE, 2024: https://arxiv.org/html/2406.19435v3
- Meta AI labelling: https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads/ ; https://getcoai.com/news/facebook-and-instagram-make-ai-labels-less-prominent-on-edited-content
- InvestigateTV "AI or Real?": https://www.atlantanewsfirst.com/2025/08/25/ai-or-real-how-you-can-spot-real-content-versus-ai-manipulated-fakes/
- "Siblings or Dating": https://melmagazine.com/en-us/story/siblings-or-dating-instagram
- TikTok challenge case study: https://dapta.ai/?p=6883
