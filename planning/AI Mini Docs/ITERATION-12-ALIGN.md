# Iteration 12: living plan (aligning, nothing built)

Status: stage 1 (Align). **No system changes until the two in-flight renders are served and Lucas has seen them.**
Base reel: job `2a98cfa0`, "The Intern Who Took Redmond's Recipe to Google". Compare: Siri `34d7446b`, browser offer `5ebc20ef`.

## Lucas's words

- Failures: "If there's anything that isn't related to network outages or machines going to sleep, you need to absolutely make sure that the harness does not fail when it is running."
- Opening: "the absolute weakest part of the reels as a whole, systemically, is that the opening scene of the videos is really boring... it doesn't communicate well, it gives the viewer too much to look at, and it just is not optimized for social media."
- Title: "One thing that I can definitively say is incorrect is that title that is shown at the opening of each reel."
- Collage: "too small individually for the viewer to instantly understand what they're looking at."
- Direction: "It needs to be a drastic change... engineered for social media." But not as far as Explainers: "We don't want to lean that far into the hook of it all by trying to over-engineer something that won't fit the rest of the vibe of the video."
- Confusion: "There was a lot of unfamiliarity" and "There were just too many players in the game for that story." Treat as two separate issues, then examine how they combined. Wants "high-altitude responses".
- Sequence: "I don't want to alter the system at all until we see these two renders."

## Map, in work order

| Part | Issue it touches |
|---|---|
| Story selection (producer, drama score) | unfamiliarity, too many players |
| Reporting (cast, relations) | too many players |
| Writer (L1, `hook.on_screen`) | title, opening line, player handling |
| Story editor | should catch confusion |
| Director (frame 1, `on_screen`) | title, collage, density |
| Compile / frame look | piece size, text layers |
| Voice, render, worker | harness failures |
| First viewer, design review | should catch a confusing open; crashing now |

## 1. Harness failures

| Job | Ended | Cause | Class |
|---|---|---|---|
| `42f24a18` (the render that ran beside the Redmond reel) | voice, $5.60 | One-take voice failed, fallback voiced 11 of 16 frames. **Reason not recorded.** | Unknown |
| `3cd35b52`, `928e976d` | voice, $5.00, $4.61 | HeyGen wallet $0 | Not network: found only after the money was spent |
| `34d7446b`, `5ebc20ef` first try | director, ~$1.92 each | "Connection error." at 12:41 | Mac asleep |
| `34d7446b` second try | voice | No voice files at all | Likely offline, not proven |
| `5ebc20ef` second try | render | gsap from CDN failed to load; other steps also logged "Connection error." | Offline, but the CDN dependency is ours |
| `be31cfc8` | render, $5.10 | Audio mix: ffmpeg exit 255, twice; a re-run 11 hours later passed. **Reason cut off.** | Unknown |

Correction: the "two jobs hit HeyGen at the same moment" explanation is not proven, and the timing argues against it for `42f24a18` (its voice began 15:06; the Redmond job's voice stages began 14:59 and 15:11). The voice lock is uncommitted in `lib/reel-ai-drama/render/voice.ts`, with the retry. The CDN wait is uncommitted in `lib/reel-ai-drama/render/video.ts`. Both went in before the freeze; re-evaluate them in this iteration.

Proposed (not built):
- **Say why.** Keep each step's full error. Now the one-take reason is flagged only when the fallback succeeds, and the error text keeps only the tail, which hid the real message every time.
- **Check before paying.** A free preflight before any model call: voice wallet, keys, binaries, network.
- **Partial voice is not a result.** Re-voice only the missing frames, then fail clearly.
- **Fix the first-viewer and design-review crash** ("reading 'length'"). It appeared in each reel checked, so those reads are often skipped.
- **Pause, don't fail, on outages.** Wait out a connection loss; hold the machine awake during a job on a Mac.
- **Environment failures don't count against a story.** Now they retire the pitch after two.
- **Resume further.** Resume reuses research and story, but the director runs again: `34d7446b` went $1.92, $4.65, $7.66 across three tries.
- **No CDN at render time.** Ship gsap with the project.

## 2. The opening

Seen in the Redmond reel's frame 1: 8.66 s on one composition, with a 23-word first line, title box, date tag, running captions, campus photo, logo, phone and Google logo. Three text layers compete, and the story opens on a company.

Where the title comes from: the writer's required `hook.on_screen`, placed in frame 1 by the director.

Shared direction, whichever option wins: no title, one thing to read at a time, legible at phone size in under a second, a much shorter first line.

Options to react to:
- **A. One face.** The story's person fills the screen, with only the voice and captions.
- **B. Start at the turn.** Open on the story's most charged moment as one image, then go back.
- **C. Start from what the viewer knows.** Something already in their life first, then the story behind it.
- **D. The receipt.** One real artifact, full screen and readable.
- **E. Fast single images.** Replace the collage with a few full-screen images in quick cuts, one per beat.

## 3. Confusion

**Too many players.** In 11 frames: five people (Hinton, Deng, an unnamed student, Jaitly, Vanhoucke), plus Microsoft, Google, Bing, Android, Siri, Fortune and an IEEE magazine, and six dates. A search of the prompts found no limit on players.

**Unfamiliarity.** Only Hinton, Microsoft and Google are likely to ring a bell; none of the people is a household name. A search of the prompts found nothing asking whether the viewer knows a player, or how to introduce one they don't.

**Together.** The story is a relay: each stranger hands off to the next and most appear once, so learning a name never pays off and there is nobody to follow. Tension needs two sides the viewer can hold in mind, and it never forms. The result looks like a budget problem: a known name is nearly free, a new one costs attention, and this reel spent more than 60 seconds can repay.

High-altitude response, proposed:
- Budget for new names per reel; everyone else is a role or is cut.
- One person to follow from start to finish, with one opposing force.
- Every stranger gets a plain handle the moment they appear, and a known anchor where one exists.
- Enforce at selection first, then the writer; the story editor and first viewer check it.

**Decided (Lucas, 2026-11-06).**
- Limit is strict: one person to follow, one opposing force, about two new names. "people who are widely known, so anybody on our blue chip list, don't spend attention... they don't contribute towards the limit of new players."
- The central person need not be famous. Each story needs a known anchor, strangers get a plain handle, selection scores this first, then the writer. ("agreed")
- Gap found: the blue-chip list (`lib/social-hub/blue-chip-players.ts`) has Pichai, Cook, Google, Apple, Microsoft and Perplexity, but not Steve Jobs or Geoffrey Hinton. Open question below.

## 4. Opening mockups

Stills A–D and video E for the Siri, Chrome and Redmond reels: `planning/AI Mini Docs/test-runs/iter12-openers/`. Hand-made, no model cost, not system output. A–C lines were written by hand from each script's facts; E keeps each reel's existing long first line, so it shows the pacing only.

Seen so far: D reads as a small white card on black, the weakest. A and E need a large, sharp photo, and some reels don't have one (Jaitly's photo at full height is a giant head; the judge's photo is low resolution). The photo bank limits this choice.

## 5. Labels

Lucas: "the labels that you're putting on the frame don't really make sense, and they're shown kind of at random times... evaluate whether some of those labels need to be there."

**Why the timing looks random.** A label appears when its line starts (`lineLabels` in `explainers/reel-ai-drama/kit/components/compiled.js`), not when its words are said. A line can run 8 seconds. The deadline label showed 7 s before the voice said "August 15"; Kittlaus 4.3 s early, Jaitly 4.6 s, "October 2011" 4.5 s.

**Audit of the 18 line labels.**

| Kind | Labels | Verdict |
|---|---|---|
| New person, name and role (9) | Kittlaus, Cheyer, Mehta, Srinivas, Pichai, Hinton, Deng, Jaitly, Vanhoucke | Keep, but only when the name is said and the person is on screen. The player limit cuts several anyway. |
| Date the voice also says (4) | April 2010, October 2011, Sept 2 2025, Nov 2012 | Cut: repeats the voice and captions. |
| Date the voice doesn't say (4) | Feb 2010, Aug 12 2025, 2010–2011 (all forced by the writer's "L1's label is the date"), April 2025 | Cut. The frame-1 date requirement goes with the new opening. April 2025 was voiced as "four months earlier", which is the clearer version. |
| Fact added on top (1) | Deadline: Aug 15, 6 p.m. Pacific | Cut: "6 p.m. Pacific" is never said, and it breaks the writer's own "never an extra fact" rule. |

Result: about half the labels go, and every remaining one is tied to a spoken word.

Not audited one by one: small labels on pieces ("SRI", "A surprise", "Old system"). The same rule should cover them.

## 6. Visual defects to fix at the system level

| Seen | Class | Proposed owner |
|---|---|---|
| Siri 12 s: white SRI logo on white card. Browser 40 s: dark Perplexity logo on dark card | Logo disappears into its ground | Code, at compile: read the logo's own brightness and choose the ground. |
| Chrome and Siri logos in a bordered white card | Logos need open space, not a box | Code: logos sit directly on the ground, with clear space. No card. |
| Browser 18 s: "three billion" runs off screen | Text doesn't fit | Code: measure and fit text to the safe area, so it can't overflow. Cause not traced yet. |
| Browser 33 s: label overlaps "$3 billion" | Accidental overlap | Label rule above removes this one. Why the placement solver allowed it is not traced yet. Overlap only when deliberate. |
| Browser 51 s: cutout carries a blurred object covering the person | Bad source photo | Problem solver's taste call, not an algorithm: he looks at each person cutout and swaps the photo if something covers the person or the cutout looks odd. Lucas: "That photo of him shouldn't have been used." |

Per "right first time": the first three are geometry, so code owns them and no model has to remember. The fourth and fifth are judgment and go to the role that looks.

## 7. Decisions, round 2 (Lucas, 2026-11-06)

**Opening: A, B and C, chosen per reel.** "a combination of A, B, and C... some really simple logic that just allows, probably, the director to choose which of the three is going to be used based on which would be strongest." D and E are out as openings.

Proposed logic: the strongest of the three that has a large, sharp picture. Ties go to A. No usable photo of the person means B or C.

Superseded by round 3 (section 8): the writer writes one short line, and the director picks the best image for it.

**Flicker hook at the very start.** "bring that system into this... they happen right at the start... you can pretty much just take that whole logic and just apply it to these reels."

What exists, reusable as is:
- Six full-screen ffmpeg hooks: `glitch`, `color_bars`, `invert`, `vhs`, `thermal`, `blue_screen` (`lib/reels/visual/hook.ts`).
- Three random timings, each 0.5 s.
- A small model call that reads the on-screen copy and picks the hook (`lib/reels/visual/hook-route.ts`). Here it would read the opening line.
- 18 matched sound files (`lib/reels/sfx/final`), one per hook and timing.

What has to change:
- The sounds are built for 24 fps only (`lib/reels/sfx/frame-map.ts`), and these reels render at 30 fps. Rebuild them at 30 fps with the existing scripts and frame test. No model cost.
- Trial Reels have no voice, so the hook's sound has to sit under the spoken line in the first 0.5 s (decided in section 8).

**Widely known people.** "Steve Jobs counts as widely known. Hinton does not." Michael Dell counts. "I want this added system to be really conservative... someone that the general public would know." List expansion: pass.

Proposed logic:
- A person not on the blue-chip list is exempt only if most adults outside tech and business news would recognize the name with no explanation. If in doubt, no.
- One owner decides once, at story selection, and it is stored on the cast so every later step reads the same answer.
- No example names in the prompt (example pollution). Jobs, Dell and Hinton are used only to check the result by hand, not as prompt text.

**Labels: the rule from section 5 stands, with two additions.** "include labels for when a photo is shown of a place, and it should label the place... dating a photograph. If a photograph is from years past, then the label should be applied there with a date and the place, and maybe even labeling who's in the photo if it's necessary."

The full set a label can be:
1. A new person's name and role, when the voice says the name.
2. A place photo: the place.
3. An old photo: its date and place, and who is in it if that isn't otherwise clear.

Photo labels arrive and leave with the photo. A label is shown only when the source data backs it; never guessed.

Data gap:
- `place` is empty on every asset in all three reels, although `shows` often names the place in its text. Harvest has to fill it.
- `date_taken` is set on about half the non-logo assets (111 of 216). An unknown date gets no label. An approximate date shows only as a year.
- Screenshots carry the capture date, not an old date, so they are excluded.
- Some identities are marked "not confirmed" in `shows`, so "who" needs confirmation first.

Replaces: the writer's `on_screen` jobs and "L1's label is the date" (`writer.md` lines 42–45, MD-126), and date labels' extra prominence (MD-130).

Suggested extra cases (Lucas to keep or cut): a figure that's hard to catch by ear (already a writer job; keep only if not already on screen as a stat); nothing but the hook line on screen during the opening.

## 8. Round 3: the hook as visual storytelling (Lucas, 2026-11-06)

"I don't just want the opening photo to scale in slowly. I want different parts to be cut out and then for there to be a layered scaling effect... the director decided to mark it up or do something creative to it." "the way that the image is treated... need[s] to be semantically driven. They should be really, really visually interesting, and they should serve as a pattern interrupt." "hierarchically strong at a high altitude of thought but can be driven reliably for all reels." "everything that it does needs to be logistically conservative."

**Decided.**
- "The voice should not wait for the flicker. The flicker should duck under the voice if necessary." The voice starts at 0; the hook's sound is lowered in the mix.
- "The director should probably just pick the best image for the spoken line, but obviously have a preference towards starting on a photo of a person." One short line from the writer; A/B/C are no longer line types.
- Photo dating as proposed: a full-screen photo, 2 or more years old, first appearance, true date.

**Proposed shape (for Lucas to approve).** One principle: the picture acts out the line. Top down:
1. **The idea.** The director names the line's most charged word and the one thing on screen it acts on.
2. **Three hits in the opening.** Flicker at 0. The move lands on the charged word. A hard cut as the line ends. Each hit gets a sound. The rule: something visibly changes at least three times, never one slow push.
3. **One preset from a small set**, chosen by the director by what the line means.
4. **Code does the geometry.** Each preset has an eligibility check on the asset. If it fails, the reel falls back rather than breaking.

**Rejected, round 4.** "The markup shouldn't be a circle arrow or underline." "All of these are super boring and trash." The earlier six (layered pop, mark-up, crossed out, poster, collision, punch-in) are out. "Think like a documentarian. Don't just rely on what's possible with the things that are already in the repo." "keep in mind that the sound designer has to be included in the hooks." Preset moves the director picks from stay.

**Proposed presets (new builds, for Lucas to react to):**

| Preset | What you see | Use when the line is about | Needs | Sound | Risk |
|---|---|---|---|---|---|
| Double Exposure | The person's silhouette becomes a window onto what they built or wanted; the rest falls away | A person and their obsession | Clean cutout, second image | Low swell, reversed hit into the charged word | Low to medium |
| Flashbulb Burst | 3–4 different photos of one person, each on a flash; the last freezes in black and white | Fame, pressure, a public moment | 3+ sharp photos | Shutter and flash pops building, then silence on the freeze | Low |
| Contact Sheet | A film strip races past; a red china marker slashes a crop around one frame; we push through it | One person or moment out of many | Several photos | Film advance, marker squeak, thump | Medium |
| Ink Over | Hand-drawn jittering ink acts out the meaning on the photo: a price tag swings, a crown drops, a scrawled "NO" | A price, a status, a verdict | Prop library of about 20 drawings; face or logo position | Pencil scratch in rhythm, one hit | Medium |
| Rewind | Today's image; tape rewinds through photos with a year counter spinning down, clunks onto the moment | It started long before you noticed | Photos with known dates | Tape whirr, hard clunk | Low to medium |
| Lock-On | A wide photo; a frame steps in from mosaic to sharp and locks on one face | The one person no one noticed | Wide photo with a known face | A tick per step, a lock tone | Low |
| Darkroom | Red safelight; blank paper in a tray; the image rises as the line plays | Hidden, revealed, a stranger | Any one photo; forgiving of soft sources | Water, hum, hit as the face clears | Low; the fallback |
| Wall of Screens | Dozens of old TVs show one face; static clicks them off until one fills the frame | Scale, the whole world watching | One image | CRT clunks cascading, static, silence | Low to medium |

The two answers to "more creative markup" are Contact Sheet and Ink Over. Ink props never imply something the facts don't state.

Left out on purpose as too likely to break or look off: generated video, 3D, morphs, anything putting extra words on screen beyond the line and its one charged word.

**Sound designer.** Each preset ships with a score: ordered cue slots tied to its hits. The designer picks the exact sounds and levels and can add, but can't drop a slot; the voice stays on top. If the problem solver swaps the preset, its score swaps with it. Existing catalog (1,340 sounds): text search finds shutter/camera 8, pencil 77, scribble 44, marker 48, paper 249, impact 138. It finds nothing for projector, rewind, CRT, water or servo, and "tape" (24) is probably adhesive tape, not checked. Those sounds have to be sourced.

**How it stays reliable.** Each preset is built once as a template and rendered on real reels offline, at no model cost, before it's allowed. The director only fills in who, which image and which word. The check is mechanical: cutout present, face position known, enough resolution at full size, enough photos. Photo supply varies: Jobs, Hinton and Pichai have 12 large photos each, Vanhoucke 8, but Jaitly, Mehta and Deng only 2. So Flashbulb can't always run. Any failed check falls back to Darkroom, so no reel is held back. The problem solver looks at the rendered opening and can swap the preset or the photo, including an obstructed cutout. Captions stay on top of the flicker, as the Trial Reels plate does, so the first word still reads.

**Illustrations for Lucas only (never prompt text):**
- Siri, "told Steve Jobs no": Ink Over, a scrawled "NO" slams across Jobs.
- Chrome, "He tried to buy Google Chrome": Double Exposure, Srinivas's silhouette filled with Chrome.
- Redmond, "A summer intern": Rewind from a phone listening today to 2011.

## Open questions

See the current reply. Answers get recorded here.

## 9. Hook preset renders (2026-11-06)

Lucas: "render all these. Just do one each... I will evaluate whether or not they can be used long term." One mockup per preset in `planning/AI Mini Docs/test-runs/iter12-hooks/`, with real reel voice, music, Trial Reels flicker and its sound lowered under the voice. Real plates and missing sounds came from Higgsfield (`plates/`, `sfx/`), about 7 credits.

Mapping: Flashbulb, Ink Over, Contact Sheet on Siri. Double Exposure, Wall of Screens, Lock-On on Chrome. Rewind, Darkroom on Redmond. Verdicts pending from Lucas.

Findings for the build:
- Each mockup keeps its reel's existing long first line, so reveals are stretched to fit it; the Darkroom print takes about 4 s to develop. A short line changes pacing.
- Green-screen plates work: real screens and film frames take any photo, and a screen or frame position comes from the plate, not from guessing.
- Text baked into a photo is a real risk. Jaitly's only large photos carry his name, so they were zoomed until the face fills the frame. A system check has to catch this.
- Flicker sounds are still 24 fps sounds on a 30 fps picture.

## 10. Verdicts on the renders (Lucas, 2026-11-06)

**This section overrides sections 7–9 wherever they conflict.**

**Flicker is out.** "let's get rid of the flickers. The flickers plus the new hook templates don't work." Dropped: the Trial Reels hook in this system, the 30 fps sound rebuild, the "three hits" opening with flicker at 0, captions over flicker.

| Preset | Verdict | Lucas |
|---|---|---|
| Flashbulb Burst | Keep, as is | "great. No notes." |
| Ink Over | Out | "won't work across more reels" |
| Contact Sheet | Out | "sucks" |
| Double Exposure | Out | "sucks" |
| Wall of Screens | Keep, with changes | "great, but there need to be different images on the TVs" |
| Lock-On | Keep, with changes | "great, except it needs better sound design on each zoom-in" |
| Rewind | Keep, with changes | "also great" |
| Darkroom | Keep, with changes | "also great"; photo "way too close to his face"; "a little more sound design" |

**Wall of Screens changes.**
- At least five different images across the TVs, each treated about five ways: "zoom in on different parts of the image to show it as something else, or as a different shot." That gives 25 distinct screens, and the current plate has 32.
- "The TV glitch effect should stay for the rest of the hook." Once we're inside the TV, everything stays composited in that world.
- The Chrome logo "didn't show for long enough. It felt like a really fast cut."

**What follows the hook.** "after that first image is treated well as the hook, the following images are really lazily shown... no part of our reel should feel like that." Applies to Wall of Screens, Lock-On and Rewind. These were mockup shortcuts, but the system needs a rule, proposed:
1. The hook's visual world lasts until the opening line ends, not just its first image.
2. Then frames follow the reel's normal composition; no flat full-screen image with a slow push, anywhere.
3. Anything shown gets a minimum hold, so it can be read.

**Sound.** Every visible camera move or step in a hook gets its own sound. Lock-On needs one per zoom; Darkroom needs more than water and one hit.

**Photos.** Face too close is a failure. Proposed check: face size within the frame, read from the existing face box. Baked-in text stays the problem solver's taste call. This also changes the earlier fallback plan: Darkroom was the fallback because it "forgives" poor photos, and it doesn't.

**Preset meanings (5):** Flashbulb: fame, pressure, a public moment. Wall of Screens: scale, the world watching. Lock-On: the one person no one noticed. Rewind: it started long ago. Darkroom: hidden, revealed, a stranger.

## 11. Re-render of the four kept presets (2026-11-06)

Files: `planning/AI Mini Docs/test-runs/iter12-hooks/*-v2.mp4`. No flicker. New sounds in `sfx/`.

Found while re-rendering, for the build:
- **Wrong person risk.** The harvest lists a classroom photo as Jaitly ("captioned as Navdeep Jaitly, not confirmed"), but it visibly shows a different, older man. Proposed rule: an unconfirmed identity never represents a named person.
- **Weak photo, better treatment.** Jaitly's only confirmed photo is a graphic headshot. Showing it smaller as a bordered print solves both "too close" and the baked-in text, without zooming.
- **Worlds carry through.** Each hook's look now holds to the end of the line: CRT in Wall of Screens, targeting in Lock-On, tape playback in Rewind, the tray in Darkroom.

## 12. Approved look, and scaling (Lucas, 2026-11-06)

"These 4 are GREAT! But please make sure they'll scale well. They need to be at least moderately dynamic so the director can use them well." "Own Siri" is disregarded.

Passed: Wall of Screens, Lock-On, Rewind, Darkroom (v2 files), plus Flashbulb from the earlier round. Target: "6 great hook options".

**Proposed scaling contract.** Each preset is one code template. The director fills a few slots; code does crops, timing and sound.

| Preset | Director fills | Code handles | Can't run when |
|---|---|---|---|
| Flashbulb | Person, 3–5 photos, the freeze word | Order, flashes, shutter sounds | Fewer than 3 sharp photos of the person |
| Wall of Screens | 5+ images, the screen we enter, what appears inside | Crops from face and object boxes, kill order, one clunk per TV, CRT world | Fewer than 5 usable images |
| Lock-On | 1–4 targets, each with a word | Zoom steps, mosaic, brackets, servo and lock sounds | A target has no known position |
| Rewind | Landing photo and year, 2–4 dated photos before it | Counter, tape effects, tape playback for what follows | Fewer than 3 photos with known dates |
| Darkroom | 1–2 prints, the word it finishes on | Print framing with border, develop speed, tray sounds | No confirmed photo |

All cues anchor to spoken words, so any line length works. What follows the hook is any assets, shown in that preset's world.

Not proven yet: the mockups use hand-picked crops and hand-tuned timing. Wall crops have to come from face and box data, which needs testing on unseen reels. Darkroom's develop time depends on the new short lines.

**New preset ideas for Lucas to choose from:** Slide Carousel, Face-Off, Split-Flap Board, Front Page, Burn. Details in the reply; chosen ones get recorded here.

## 13. Slide Carousel, Front Page, Burn (mockups, 2026-11-06)
Lucas: "Make slide carousel, front page, and burn for me to see." Goal: "6 great" hook options; verdicts pending.
- **Slide Carousel** (Siri): real projector plate, slides change on the spoken words, shutter gap and jitter on each change, kachunk on each. Scales with any 4-7 images.
- **Front Page** (Chrome): press run, spinning page lands on a word, moves to the photo, then more pages land. Open point: the headline is the real Verge wording typeset as newsprint, and the build must never invent a headline.
- **Burn** (Redmond): generated real-paper burn footage (35 credits, reusable across reels) keyed as a mask, three burns revealing the next image. Scales with 2-4 images.
- Bank problem seen again: the Jaitly photo has baked-in text, so it needed a print crop.

## 14. Verdict on the new hooks, and when a hook may run (2026-11-06)
Lucas: "All three are good, though, so we can use all three to complete the set and just have seven total."

**Requested fixes, applied in the re-render:** louder slide sound on Slide Carousel; quieter press on Front Page; articles land whole with the headline visible and the photo in place, not scaled in; no low hit on Burn; louder fire.

**Choosing a hook (Lucas's rule).** "The constraints of each hook need to be enforced. If there's not enough of what a hook type needs to be really strong, then it shouldn't really be used." "Hooks should be first and foremost used when the proper assets for them to be strong are there, in unison with the right situations for hooks semantically."
- A hook is only choosable when both hold: the bank has what it needs to be strong, and the story fits its meaning. Code removes hooks that fail on assets before the director chooses. The director chooses among the rest by meaning.
- Requirements for the first five are in section 12's table. New ones (proposed):

| Hook | Fits when the line is about | Needs to be strong | Can't run when |
|---|---|---|---|
| Slide Carousel | A sequence of events, a story told step by step | 4–7 varied images, each tied to a spoken word | Fewer than 4 usable images |
| Front Page | News, a public announcement, a deal, a scandal | A real headline from a source, plus 2–4 images | No real headline: never invent one |
| Burn | Something destroyed, replaced or taken over | 2–4 strong images in sequence, no baked-in text | Fewer than 2 such images |

**Sound finding (build requirement).** The generated effects came out far too quiet (peaks of -24 to -44 dB), and the ka-chunk started 0.27 s late. Generated sounds must be peak-normalized and trimmed to their onset before they enter the sound bank, or the designer's levels mean nothing.

**Mock-only choice.** Front Page repeats one real headline on all four pages, and a Pichai page was added on "billion" so the page doesn't sit still for almost 4 seconds. The build should use a different real headline per page when the sources have them.

**Hook set is final at eight (2026-11-06).** Lucas: "Yes, keep eight". Flashbulb, Wall of Screens, Lock-On, Rewind, Darkroom, Slide Carousel, Front Page, Burn. This replaces "seven total" above.

## 15. Build inventory (proposed, 2026-11-06; nothing built)

**Goes:** the opening title (`hook.on_screen`), the frame-1 collage and date rule, the long first line, flicker hooks, about half the line labels, white logo cards, flat full-screen images with a slow push.

**Stays:** the 11-frame story flow, the normal frame composition after the hook, voice at 0 with hook sound under it, "never block a reel", the problem solver's right to swap.

**New, in five owned parts:**

| Part | What it delivers | Accepted when |
|---|---|---|
| A. Harness | Full error kept per step; free preflight before any spend; re-voice only missing frames; first-viewer crash fixed; wait out outages, keep the Mac awake; environment failures never retire a story; resume past the director; gsap shipped locally. Re-evaluate the uncommitted voice and video edits. | Offline tests simulate each failure class in section 1 and each behaves as stated |
| B. Story and writer | Player limit at selection, then the writer; "general public would know" decided once and stored on the cast; plain handles for strangers; one short first line; stories run through a person. | Replayed against the three reels' stored inputs with a stubbed model; rules pass the prompt-review lens |
| C. Hook engine | Eight templates in code; asset gates that run before the director chooses; shared plates and burn footage; normalized, onset-trimmed sounds; real headline text captured at harvest; face-size check; unconfirmed identity never represents a named person. | Each template renders offline from slots alone, with no hand-tuned crops, on reels it wasn't built for |
| D. Director, sound, problem solver | Director picks by meaning among eligible hooks and fills slots; world holds to the end of the line; sound designer can add to a score but not drop a slot; problem solver swaps only among eligible hooks. | Contract names match code; prompt diffs reviewed line by line |
| E. Frames and labels | Label rule from sections 5 and 7, tied to spoken words; `place` filled at harvest; logos on open ground chosen by brightness; text fitted to the safe area; minimum holds. | Replays on the three reels show the section 6 defects gone |

**Order:** shared contract first (slot names, gate results, cast fields), then parts in parallel with one owner per file, then integration review, then one real run started by Lucas.

## 16. Build approved (Lucas, 2026-11-06)
"Yes, start the build."
- **Fallback chain.** "Do darkroom as the ultimate fallback, TV grid with 3 photos as the first fallback." When no hook qualifies: Wall of Screens at a lowered bar of 3 photos first, then Darkroom with one confirmed photo as a bordered print. Flagged on delivery.
- **Assets over meaning.** Assets are the hard rule; meaning decides among what's left.
- **Section 14's requirements stand** as written.

## 17. Build state (2026-11-07; uncommitted, not run live)
Built to `ITERATION-12-CONTRACT.md` by five owners, integrated, reviewed by a fresh read-only reviewer.
- **Tests:** the reel suite passes 757 of 758; the one failure (`score combination`, drama gate) predates this work. Type check clean.
- **Hook renders from slots alone:** `test-runs/iter12-build/`, 23 hook/reel pairs. Flashbulb didn't qualify on Redmond, so that pair wasn't rendered.
- **Review fixes applied:** a fix round no longer loses the hook; a kept hook isn't re-resolved, and a pre-hook plan stays without one; the problem solver's swap survives a picture fix that keeps the hook; hook-timing findings on a hook frame ship as flags instead of paying for a fix that can't change a template; a failed hook falls back to a plain frame without its score; Darkroom's code pick opens on a confirmed photo; the design review sees the hook that plays; the HARD CONSTRAINT 18 / fix-round contradiction resolved.
- **Left as nits:** a re-resolved Wall of Screens fallback can add a misleading flag; a swap that can't be filled takes code's pick rather than the plan's hook; the blueprint fallback shows the blueprint's first picture, which may differ from the hook's first beat.
- **Open for Lucas:** whether "about two new names" includes the person followed and the opposing force (built: it does); a voice or render step that keeps failing no longer retires a story, so an automatic run could keep paying until someone notices; sound levels in the hook scores were set by numbers, not by ear.
- **Not verified:** a full reel end to end with a hook; `place` labels from a live harvest; the HeyGen wallet check against the live API.

## 18. Answers and the real run (Lucas, 2026-11-07)
1. "About two new names" includes the followed person and the opposing force when they're strangers: "Yes".
2. Stop auto runs after two such failures in a row: "Yes, but if a job is failing PLEASE repair the voice/render jobs so that they run well."
3. Real run approved: "lets start a real run. Please set 2 reels to be generated... the whole run (idea search and generation all the way through to the finished video)... videos we haven't done before. Run them in parrallel. If anything fails, please repair it and RESUME the render, don't restart it." Plus the Alex Karp reel with its hook added surgically.

## 19. Run results and Front Page demotion (2026-11-07)
- **Front Page** (Lucas): "demote the printing press hook... only usable as a backup... behind the tv grid with 3, but still in front of the darkroom". Built: `hookOptions` no longer offers it; the fallback chain is Wall of Screens at 3 → Front Page → Darkroom → blueprint. Each page lands on its own crinkle (`sfx/crinkle1–5`, never repeated in a hook), at its own angle and offset so the pages beneath show; the press bed is at -26 dB.
- **Karp reel**: Slide Carousel hook spliced onto the repaired Nov 3 cut (`test-runs/karp-hook/karp-slide-carousel-repaired.mp4`). Lucas dropped the Front Page version.
- **Harness**: the worker turns `auto` off after two non-story failures in a row (`harnessFailureStreak`). The `.env.local` Anthropic key had been revoked; Lucas rotated it.
- **Idea search** (past the spent weekly cap, one-off override, $0.90): 4 pitches, all rejected (2 under the drama bar, 2 thin visuals). The two best unmade pool stories ran instead.
- **Marked Bills in the Search Box** (job f7c8420d): ok, 68.9 s, $6.03. The Darkroom hook was picked for a search-page screenshot and reads poorly under the red light (Darkroom should require a person photo). Flags: too many unnamed players, unclear stakes, logos clipped at the edges, underlines missing their targets, empty Bing-blog stand-in.
- **Alexa on the Chopping Block** (job d58696ea): ok, 72.7 s, $7.48, Burn hook. Flags: no single person to follow (Jassy, then Limp), date labels that contradict the voice (August 2020, May 2015 shown for 2022 events), the hook landing at 3.8 s, a middle of reaction quotes.
- Both ran in parallel with no failure and no repair needed. `test-runs/iter12-run/`.

## 20. Fix plan for the first-run flags (draft, 2026-11-07; Lucas decides)
Root causes, read from the stored artifacts of jobs f7c8420d and d58696ea (no live calls):
1. **Darkroom on a screenshot.** Both prints (V52, V55) are search-page screenshots that the look pass tagged `event_photo` (`text_heavy`, `faces:0`, no people). Darkroom's pool takes confirmed people *or any unnamed photo* (`eligibility.ts` gatedOptions), so they qualified. Fix: Darkroom pool = confirmed person photos only; and in hook eligibility a `text_heavy` + `faces:0` picture never counts as a photo (protects Lock On and Burn too).
2. **Date labels contradict the voice.** `photoLabel` (`kit/components/compiled.js`) dates any photo 2+ years old by its true capture date. Honest, but over a 2022 line "August 2020" reads as the event's date. Options: (a) mark it archival, "File photo · 2020"; (b) hide the date whenever it differs from the year the frame's words speak about; (c) both.
3. **Player limit leak.** The limit counts only *names spoken* (≤ 2 new). Alexa passed it (Jassy, Limp) but splits the story between two people; Marked Bills piles up *unnamed roles*, which are never counted. Fix: story selection names one lead person the viewer follows (required), the writer keeps the lead central and everyone else as one opposing side or a plain role, and the count includes unnamed human roles. Old pooled pitches lack `widely_known`; the blue-chip list still covers Amazon/Google, so no change there.
4. **Hook lands late (Alexa 3.8 s).** The Burn hook reveals on its charged words, "two weeks before ChatGPT arrived", which sit at the end of a long first line. Fix: the charged words must be spoken by a fixed time (proposal 2.5 s); the writer gets one round to move them, else code picks the earliest charged phrase.
5. **Frame layout (Marked Bills).** Logos clipped at the edges, underlines missing their targets, an empty Bing-blog stand-in. Cause not yet traced; diagnose in the build by replaying the stored plan offline (no spend).

### 20a. Lucas's calls and build (2026-11-08, uncommitted)
- **Dates** (Lucas: "1. yes"): an old photo reads "File photo · 2020", year only (`compiled.js` photoLabel/photoDate).
- **Lead person** (Lucas: "It shouldn't be REQUIRED, it should be suggested/recommended/nudged"): no new requirement. Must 6 (`craft/principles.md`) now adds as guidance that unnamed people count as players and the person followed stays central to the end; the story editor's player check names unnamed people. Producer HARD 1 (a named central figure) predates this and is untouched.
- **Hook by 2.5 s** (Lucas: "3. yes"): `CHARGED_BY_WORD` = 7 spoken words at 180 wpm. `resolveHook` moves later charged words to `chargedWords` within that window and flags it; the director prompt and hook principle 18 say so.
- **Darkroom**: prints are confirmed person photos only; a `text_heavy` + `faces:0` picture with no people is never a photo to any hook.
- Tests: 116/116 Iteration 12 tests pass; tsc clean.
- **Layout (traced, not fixed)**: the Marked Bills design flags fall into three patterns: wide screenshots cover-cropped to portrait so their words are cut at both edges (frames 1, 4); logos placed flush to or past the frame edge (frames 3, 8, 9, 12), likely made worse by camera push-ins; and an underline drawn under the first headline line rather than the words the focus names (frame 12). All are geometry in `kit/stage-layout.js` / `components/stage.js`; needs a decision before building.
- **Layout (built 2026-11-08, Lucas: "Yes, build layout")**, all in `kit/stage-layout.js`:
  - *Logos off the edge*: the slow push during a hold grew the shot 5% and checked only the aimed piece. Drift now checks everything on screen, and logos, notes and words keep 16 px from the side under any camera pose. Offline probe (person + two logos, push 1.1/1.3): old code cut a logo 18 px off the frame, new code keeps it 17 px inside.
  - *Underline on the wrong line*: a measured phrase that wraps came back as one box per line, each carrying the whole phrase, so "Microsoft denies cheating" matched inside line one. `splitWrapped` shares the words out over the line boxes by width; this also fixes stored assets.
  - *Wide screenshots cropped*: a `text_heavy` + `faces:0` picture with no named people is laid out as a page of words (`card`), not a photo print.
  - Tests: `tests/reel-ai-drama-iter12-layout.test.ts` (3). Reel AI Drama suite 763/764; the one failure (`combineDrama(all(2))` expects 0.5, gets 0.45 from CENTRAL_WANT_GATE 3) also fails at HEAD 22bf8617 and was left alone.

## 21. Live check of the §20 fixes (2026-11-08)
**The Dataset Run by 'An Employee No Longer With Microsoft'** (job f86c0f90, the last unmade pooled pitch): ok, 64.7 s, $6.06, Burn hook (Microsoft logo burning through to a wall of faces). `test-runs/iter12-run/microsoft-dataset.mp4`.
- Held: hook hits at 1.6 s (Alexa 3.8 s); hook on photos, no screenshot; old photo reads "Berlin / File photo · 2016"; no logo cut by a camera push.
- New or remaining flags: frame 2's counting "10 million" runs off the right edge and collides with "8,682" (stat treatment, not covered by §20); frame 8's underline sits through the bottom of "deletes" rather than beneath it, and the page's text line is cut by the frame edge; frame 9's Microsoft logo sits at the 30 px rest margin with a tiny, unreadable "statement, recreated" strip; two near-empty openings (frames 5, 9); the first viewer did not understand how faces got into the dataset (never said how the photos were collected); story editor: timeline jumps (April → months earlier → June).

## 22. Two more reels, no code changes (2026-11-08)
Two idea searches ($1.40, $0.74) gave two passing pitches, neither made before.
- **The Thousand Researchers and the Free Graphics Card** (job de3e224d): ok, 65.0 s, $5.14, Lock On. Flags: two pictures render empty (frames 4, 11), the headline underline runs through the letters (as in §21), "then 2020" just under phone size, frame 3 opens near empty. `test-runs/iter12-run/free-graphics-card.mp4`.
- **The Speech Scientist Microsoft Tried to Keep Out of Google** (Kai-Fu Lee, 2005; job 97b99983): ok, 68.9 s, $6.28, Lock On. Flags: the opening's logo is cropped and the face pixelated (story clear only at 3–4 s), an unnamed engineer, an unclear ruling, a tacked-on Wikipedia ending, a crowded frame 10 headline. `test-runs/iter12-run/kai-fu-lee.mp4`.
