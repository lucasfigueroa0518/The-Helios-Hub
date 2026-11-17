# Real or AI?: living plan (Bald-Eagle-Iteration)

A possible pivot of the Stories series Free vs. Paid. The research is in RESEARCH.md (same folder). Stage: 8, swipe lab rounds (lab 1 $5.71, lab 2 $6.19 after RA-22, lab 3 $6.48 after RA-23). Go-live on hold (RA-21).
Free vs. Paid 2.0 stays parked on `feat/fvp-2` (worktree `Helios-Hub-fvp`).

## Decisions
- **RA-1 Format** (2026-11-15, "sure"):
  - one image per round, "Real or AI?"
  - tap to reveal, with the tell taught on the reveal
  - 2–3 rounds per set
  - an unpredictable, balanced answer mix
- **RA-2 AI side** (2026-11-15, "sure"): we generate our own AI images in the mundane-realism style, plus matched twins of real bank photos.
- **RA-3 Screening model** (2026-11-15): Typesafe's vision model, "basically jev but with the ability to process images".
  - Docs: image input is experimental, opted into with the `TypeSafe-Danger-Zone-Images: true` header. Images are PNG or JPEG.
  - `box` questions, which find a location in an image, need `jev-preview`. They could place the reveal's pen circle on the tell.
  - Needs `@typesafe-ai/sdk` 0.7.0. The Hub has 0.6.0 today, and every Jev caller shares that package.
- **RA-4 Swipe lab tests the engine, not the pool** (2026-11-15):
  - "the swipe lab shouldn't inform which photos specifically are in the pool. The swipe lab should be a test of the selection's quality. So if I score about 60%, then the engine is doing a poor job with its photo selection."
  - The lab shows a blind sample of what the engine would post. The team's accuracy is the engine's grade. Images seen in the lab may still post.

- **RA-5 Sources** (2026-11-15, "Yes"):
  - The AI side may also use AI images from research datasets (Chameleon, HPBench and the like) and lesser-known viral fakes, alongside our own.
  - Real photos come only from the photo bank, Wikimedia Commons and NASA/NOAA/USGS, never from a dataset's real side.
- **RA-6 No real people** (2026-11-15, "Agreed"): no AI image of a real person, however famous.
- **RA-7 Pass mark** (2026-11-15): "62%. I'm good at this. And it's just gonna be me doing it."
  - Lucas is the only lab player. The engine passes a batch when his accuracy is **62% or less**; above 62%, the selection is too easy.
  - This supersedes the earlier "about 60% = poor job". Batch size is 20 rounds (my default).

- **RA-8 Image Stories, not video** (2026-11-15): "This doesn't need to be a video. This can be a set of image stories."
  - Parts approved, except that Video becomes still slides: no music, and the pen circle is drawn on the reveal image.
- **RA-9 Two rounds per set** (2026-11-15, "yeah"): each round is a question image and then a reveal image, so a set is 4 Stories.
- **RA-10 Schedule** (2026-11-15, "Yeah"): Free vs. Paid's Tuesday and Saturday slot stays.

- **RA-11 Principles R1–R8 kept** (2026-11-15, "yeah").
- **RA-12 Look:** AI Trivia's Instagram-native look, as still images (Classic text, highlight boxes, a static pen circle) (2026-11-15, "yeah").
- **RA-13 Reveal text:** one line, about 10 words at most (2026-11-15, "yeah").

- **RA-14 Inventory approved** (2026-11-15, "yes"). The series becomes `real_or_ai`, labelled "Real or AI?".
- **RA-15 Process approved** (2026-11-15, "yes").
- **RA-16 Four candidates a day** (2026-11-15, "yes").
- **RA-17 AI reveal** (2026-11-15, "sure"): screening rejects only tells a viewer would spot in a 3-second look. The reveal circles a subtle tell found on close inspection; if there isn't one, it shows the short prompt that made the image.
- **RA-18 Dataset fetch** (2026-11-15): "feel free to fetch the dataset." The lead session fetches it; the builders download nothing.
- **Build go-ahead** (2026-11-15, "go ahead").
- **RA-19 Prompt wording approved** (2026-11-15, "Approved"): `roa-write@1`, `roa-reveal@1`, `roa-screen@1`.
- **RA-20 Scope baseline** (2026-11-15, "Approved"): the package hashes are updated for the Typesafe SDK 0.7.0 upgrade.
- **RA-21 Hold go-live** (2026-11-15, "lets hold off on that"): no schema apply, VM deploy or merge for now. It also waits on AI Trivia landing.
- **RA-22 Pleasant, readable, balanced** (2026-11-16, after playing lab 1): Lucas found the picks hard but many "just weird": a finger at the edge, blurry personal-life shots, a cluttered home, leftovers ("kind of uncomfortable to see"); others too nondescript; and many too dark ("basically just looking at a black screen", hard to see on a phone outdoors). He also allowed making the picks less predictable. Built:
  - Light check in code before Jev (screen.ts): mean luma under 70 or over half the pixels dark rejects (`too_dark`). His three named images measured 21–35.
  - roa-screen@2: two glance questions, `clear_subject` (reject under 0.5) and `off_putting` (reject at 0.5 or more).
  - roa-write@2: rule 7 (easy and pleasant on a phone outdoors: clear subject, bright, sharp, nothing in front of the lens, nothing messy, unappetising or private; no dark or night scenes). The AI principle moves from "ordinary, imperfect" to natural realism with no deliberate flaws. Map: `mundane` and `amateur` reworded to good casual photos; interiors tidy and well lit; space bright and filling the frame.
  - Balance: lab 1 was 23 real and 7 AI because 19 of about 30 AI images failed the screen and the builder fell back to real. An AI cell now makes one more image when the screen fails it (AI_ATTEMPTS 2).
  - The 3-second tell now rejects an AI image only at glance_tell 0.7 or more (was 0.5). Jev answers 0.43–0.72 for almost every AI image while judging most viewers would still call it real (looks_ai 0.20–0.44 over 23 images); at 0.5 lab 2's first day lost all four AI images.
  - The new wording awaits Lucas's read.
- **RA-23 Cut the dead-easy type; frame real photos** (2026-11-16, "It's too easy", then "Yes, all three"): Lab 2 scored 23/30 for both Lucas and JJ. On a review page he marked 5 photos dead easy, all AI `mundane` shots of food or interiors; both players got all 6 `mundane` rounds right, and no real photo was marked. Lab 2 also showed wide real photos cut badly by the centre crop (the fox, Saturn).
  - `mundane` is retired from the writer (RETIRED_TRAPS; kept in the type for imports and old rows). AI traps are now `amateur` and `twin`.
  - No AI image of food or everyday_interiors in any trap (NO_AI_SUBJECTS, roa-write@3 rule 8, checked in validateSpecs and candidateProblems). Real photos of both stay.
  - Real photos are cut to 9:16 around their most salient region at fetch (toStoryFrame, sharp attention), never enlarged; wider than 16:9 is skipped. Jev screens the cut frame, and roa-screen@3's clear_subject asks for the subject whole and well placed.
  - Lab 3 (2026-11-16): 17 simulated days for 30 photos (two days built no set when the stricter framing check left one usable image), $6.48. 17 real, 13 AI (11 hobbyist, 2 twins); no repeats from labs 1–2; every real photo 9:16.
- **Test-day fixes** (2026-11-15):
  - Jev vision gets a 1024 copy.
  - The real-photo search loosens its words until something matches.
  - The reveal line revises from its earlier draft and fails open, flagged for approval ("We shouldn't be dropping photos because of the reveal line").
  - Real cells screen up to 6 photos and keep the hardest.
- Built in the worktree `Helios-Hub-roa`, branch `feat/real-or-ai`, created from `feat/ai-trivia` at ebf69de1.
- **RA-24 As-built look, "Are you smarter than AI?" type** (2026-11-16, "let's use as-built, but … adapt the fonts … to follow the new design of Are You Smarter Than AI?"). Picked from five story looks (artifact NrhXsfFVR7EK42QonaRBo7). The layout stays as built; the type follows the local trivia build (`Helios-Hub-trivia`, 54d73620 plus uncommitted work): Bowlby One, uppercase, for "Real or AI?" and the REAL / AI verdict; Inter 700 for the line and the proof. Courier Prime stays on the AI prompt box (RA-17). roa.css now owns every rule and RoaSlide owns its pen seed helpers, because the trivia branch removed its `.tv-*` look and `pen.ts`; the font files are the trivia branch's (same path, same bytes), so the merge is clean. Built locally, uncommitted; roa tests 60/0, tsc clean.
- **RA-25 Pragmatica Extended + Roboto** (2026-11-16, supersedes RA-24's type). "Lets do Pragmatica extended + roboto", after "this font … really just hasn't been used in anything else, hub-wide" (comparison: artifact Vwn1LfRnaYa8AZ6DxzBTaV). "Real or AI?" and the verdict in Pragmatica Extended, uppercase (76 px and 132 px); the line in Roboto 500, the proof in Roboto 400; Courier Prime stays on the prompt box. Both fonts come from the Stories renderer, so roa.css declares none of its own and the Bowlby One and Inter files are gone from this worktree. "Are you smarter than AI?" switched the same way (AT-71). Uncommitted.
- **RA-26 Reveal payoffs, no tells** (2026-11-16, supersedes RA-17's pen circle). "I don't like how on the reveal we're circling stuff and giving tells", then from ten options: "use 1 for AI always and … use 4 for real photos where the effort gap is large and use 2 for real photos where the effort gap is low or hard to pinpoint". AI → the prompt that made it on a white card ("The prompt", Courier body), no model call; an AI image with no prompt to show (dataset, viral) or a prompt over 25 words is archived. Real → `roa-reveal@2` judges the effort gap (large only when the material states what it took, never from how the photo looks): large → "what it took" line (≤ 10 words, ≤ 70 chars, fails open with flags); low or unclear → camera card built by code (camera, settings, month and place; "Taken" with date and place only when no EXIF). EXIF comes from Commons `iiprop=metadata` and NASA metadata.json; the photo bank has none. Pool rows from before RA-26 read as prompt (AI) or camera (real). Look: planning/Real or AI/ra-26-payoffs.jpg. Uncommitted.
- **RA-27 Imported AI images stay usable** (2026-11-16, amends RA-26's archive rule). "I want to keep being able to use images brought in by the manual import script. You can just use the effort gap payoff for those." An AI image with no prompt to show (dataset, viral, or our own with an unusable prompt) is no longer archived: `roa-reveal@2` judges its effort gap from what the image shows, as if the scene were real. Large → a line saying what a real photo of it would have taken (never claims the scene exists); low or unclear → an origin card built by code ("Made with": the model, then the dataset or "Shared online · month year"). Our generated images still show their prompt with no model call. Uncommitted.

## Stage 4: inventory (approved, RA-14)
- **Stays (from Free vs. Paid 2.0 on `feat/fvp-2`, and from AI Trivia):**
  - **series:** key `free_vs_paid` → renamed (see below), Tuesday and Saturday, `auto:false`, your approval in the Hub
  - **daily candidate run:** at the 3:00 pool turnover, with a `finally` record
  - **pool:** cap 20, exempt from the stale drops, archive table
  - **photos:** the bank reader (cleared licences, 7-day rule)
  - **review and publish:** Haiku review, plus image Story publishing, which predates the video path
  - **look:** AI Trivia's slide CSS and pen marks
- **Goes (FVP 2.0 pieces with no place here):**
  - pair writer and fact-check: `fvp-write@1`, `fvp-check@1`, `fvp-score@1`
  - prices and logos
  - the video renderer, music and marker sound
  - `FVP_VIDEO` wiring
  - FVP 2.0 is not merged; its branch is kept as a record
- **New:**
  - content map (subject × trap)
  - AI image making: `gpt-image-2`, already in the Hub at about $0.01–0.05 an image; Higgsfield as the alternative
  - dataset and viral-fake intake (AI side only, no real people)
  - Jev vision screener: SDK 0.6.0 → 0.7.0, experimental image header, `box` on `jev-preview`
  - answer-balance rule
  - question and reveal slides
  - swipe lab page in the Hub
  - provenance record per image (source, licence, credit or generation record)
- **Name:** series key and label. My suggestion: key `real_or_ai`, label "Real or AI?". Old `free_vs_paid` history still loads.

## Stage 5: process (approved, RA-15)
```
DAILY 3:00                                                POST DAY (Tue, Sat)
content map ─► candidate maker ─► Jev vision screen ─► pool (20 hardest)   ─► builder: 2 rounds, unpredictable mix,
 open cells    AI: gpt-image-2      tells? → reject        balance tracked        provenance confirmed
               AI: dataset/viral    real people/brands/                        ─► 4 still slides: Q1, reveal 1, Q2, reveal 2
               real: bank/Commons   text? → reject                             ─► Haiku review ─► your approval ─► publish
               twin: real → AI      difficulty + tell box
                                                          SWIPE LAB (any time): blind sample of the pool → your score
                                                          ≤ 62% over 20 rounds = engine passes; it never edits the pool
```
| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Candidate maker | open cells, used images | about 4 candidates a day for one cell each | images + truth + provenance |
| Screener (Jev vision) | image + truth | reject visible tells, real people, brands, readable text; predict difficulty; box the tell | scored candidates |
| Pool | scored candidates | keep the 20 hardest; record real/AI balance | ranked pool |
| Builder | pool, recent answers | 2 rounds, answer mix unpredictable, provenance complete | rounds |
| Slides | rounds | question slide ("Real or AI?" only) + reveal slide (answer, ≤10-word line, pen circle or credit) | 4 JPEGs |
| Review + publish | slides | Haiku review, your approval, 4 image Stories in order | posted set |
| Swipe lab | pool sample | your blind score, 3-second view | engine grade |

## Stage 3: principles (approved, RA-11)
Each one is "do X because Y".
- **R1 Use the over-call bias.** Favour real photos that look too perfect or impossible, because people now say "AI" too readily. Microsoft's three hardest images were real.
- **R2 Mundane realism for AI.** Ordinary, imperfect, phone-like images, because polish is the tell people look for (Kamali et al., stylistic artifacts).
- **R3 Scenes over faces.** Landscapes, objects, animals and places, because people are worst at these (59% vs 65% on faces; HPBench: portraits are easiest).
- **R4 Zero visible tells.** An AI image with any anatomical, stylistic, functional, physics or sociocultural tell is out, because one tell gives the round away.
- **R5 No learnable pattern.** Real and AI land unpredictably across rounds and sets, because a pattern lets viewers win without looking.
- **R6 Little to read.** The question image carries only "Real or AI?", because less time on the image means more mistakes, and less text was your brief.
- **R7 The reveal teaches one thing.** For AI, the one tell (circled). For a real photo, the one fact that makes it real. A takeaway is what people share.
- **R8 Show the proof.** Real: place, year and photographer credit. AI: the model or source. This builds trust in the game and covers the credit the licences require.

## Stage 2: parts (approved, RA-8 for Video)
| Part | Responsible for | Reads | Never decides |
|---|---|---|---|
| Candidate maker (daily) | New candidates for open cells (subject × trap). **AI traps:** writes the generation prompt (mundane realism) and makes the image, or takes a dataset or viral fake. **Real traps:** finds bank, Commons or NASA photos. **Twin:** describes a real photo, then generates its AI twin. | content map, used images | difficulty, the answer mix |
| Screener (Jev vision) | Tell scan on the five categories: an AI image with a visible tell is rejected, and a real photo is scored on how AI it looks. Checks for real people, brands and readable text. Predicts difficulty. Finds where the tell is (`box`). | the image + its truth | wording, the set |
| Pool (code) | Keeps the 20 hardest by predicted difficulty, tracks the answer balance | screened candidates | content |
| Builder (post day) | Picks the rounds; keeps the answer mix unpredictable; confirms provenance (real: source, licence, credit; AI: generation record or dataset id) | pool, recent answers | difficulty |
| Video | Question and reveal clips in the IG-native look; the reveal shows the answer, the tell circled in pen (AI) or the credit and place (real) | rounds, music | content |
| Swipe lab (Hub) | Blind sample of what the engine would post. Lucas swipes Real or AI with a 3-second view, and his accuracy grades the engine (≤ 62% passes). Never adds or removes pool images. | pool sample | the pool |
