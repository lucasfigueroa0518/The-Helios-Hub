# AI Trivia: living plan (Bald-Eagle-Iteration)

Replaces the Stories series **Guess the Number** (`lib/stories/build/guess-the-number.ts`, series `guess_the_number`).
Stage: 1, Align. Nothing built. Prompts are not edited until the build.

## Lucas's brief (2026-11-10, his words)
- "Guess the number should realistically just be an AI Trivia question. We're going to fully pivot that content type into something completely new."
- "engineered for social media. Viewers should really care."
- "just be two slides. First slide shows the question, second slide shows the answer."
- "questions can't repeat ever but deduplication should also be cheap. (maybe an exhaustive content map)"
- "a single llm call each day that comes up with the ideas and they compete in the pool, and it won't need any ingestion of other stuff."
- "we're no longer going to scrape different things ... just use a sonnet call once per day that will come up with 3 trivia questions and then they'll all compete in the pool based on what questions the viewers will care about."
- "a content type that can be used as kind of visual glue."
- "look very much like the field notes content type when it comes to the fonts."
- "Both slides will now use the photo finder + our bank of photos to find a background that is relevant to the question and put it as the background, dimmed."
- "The headline on the first slide, 'AI TRIVIA', should be really big, and then the question should be right under it, also big, and then below it says 'tap to reveal'."
- "that copy that I just gave you is SO BORING. It has zero personality. Please come up with 10 different ideas to give the copy personality."

## System map (in the order work flows)
| Part | Today (Guess the Number) | New (AI Trivia) |
|---|---|---|
| Sources | carousel brief numbers, shortlist stories, reels "The Number" ideas | none. No ingestion. |
| Ideation | `gtn-pick@1` with web search + fetch, 3 ranked candidates | one Sonnet call per day, 3 questions, no tools |
| Dedup | `gtn-same-subject@1` vs recent sets, 30-day window | never repeat, ever. Cheap: content map (open question) |
| Gates | page read + Jev `gtn-gate@1` (verifiable, want_to_guess, newly_changed…) | open question: accuracy without sources |
| Pool | ranked pool, highest passing candidate wins | the 3 join the pool and compete on "will viewers care" |
| Frames | multi-frame game, difficulty, families | 2 slides: question, answer |
| Visuals | current Stories frame look | Field Notes fonts (Pragmatica Extended Bold head, Roboto Light body); photo finder + bank, dimmed, on both slides |
| Copy | fixed lines ("Can you guess the number?", "Lock it in. Tap to reveal"…) | personality (10 ideas offered, Lucas to pick) |

## Defaults I'm assuming (say if wrong)
- Still an Instagram Stories series; "tap to reveal" = tap forward to slide 2 (the API can't post quiz stickers).
- Answer slide gets its own photo when the finder has one that fits the answer; otherwise it reuses slide 1's.
- The daily call also scores each question on a fixed "will viewers care" rubric; the pool posts the top open one and leftovers keep competing.

## Open questions
(none open)

## New process (Stage 5, draft)
```
DAILY 3:00 AM (every day, at the Stories pool turnover)
 content map ──12 random open cells──▶ WRITER (Sonnet, ≤5 searches)
                                          │ 3 questions + difficulty + options + answer + scorecard
                                          ▼
                                   VALIDATOR (code) ──fail──▶ dropped, cell stays open
                                          │ pass: cells reserved
                                          ▼
                                   JEV scorecard ×3 ──▶ score = mean(writer, Jev)
                                          ▼
                                   POOL (cap 20; lowest dropped, cell freed)

POST DAYS (Mon / Thu / Sun, Stories build hour)
 POOL top ──▶ FACT-CHECKER (≤3 searches) ──not clean──▶ archived, cell freed, next (≤5 tries)
                 │ clean pass
                 ▼
          PHOTO FINDER (slide 1; slide 2 if one fits)
                 ▼
          MUSIC (one mood, not recent) + beat grid + signature sting
                 ▼
          RENDER: HTML slides ──HyperFrames──▶ 2 × 5 s MP4, audio mixed, reveal on the beat
                 ▼
          HUB REVIEW (auto off) ──approve──▶ PUBLISH 2 video Stories ──▶ cell closed
```

| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Content map | cell table | 12 random open cells | cells to writer |
| Writer | cells, 10 principles, timeless-facts guidance, difficulty→option table | 3 questions, each in its own cell | JSON: cell, question, difficulty, options, correct, answer line, photo subject, scorecard 0–1 |
| Validator | writer JSON | option count matches difficulty, no `!` or emoji, length limits, cell still open | valid questions; reserves cells |
| Jev scorecard | each question | the same 3 scorecard questions, 0–1 | Jev scores |
| Pool | both scores | rank by the mean, cap 20 | ranked pool |
| Fact-checker | the top question | clean pass or not: fact true, exactly one option right, answer line holds | pass, or archive |
| Photo finder | photo subjects | relevant photo per slide, not recently used | photos |
| Music | mood tag, recent tracks | track, beat grid, sting | audio plan |
| Renderer | question, photos, audio plan | timing M1–M7, fonts, dimming, contrast on every frame | 2 MP4s |
| Hub + publisher | set | review, then post 2 video Stories | posted; cell closed |

## Motion and sound principles (Stage 3 research, draft for Lucas to keep or cut)
Lucas: "What's important is that the animation is visually and auditorily satisfying and triggers a dopamine reaction from the viewer."
- **M1 Build, then release.** Slide 1 builds tension slowly (the glow strengthens, the music swells) and ends unresolved; slide 2 opens on the payoff. Why: dopamine neurons ramp up with uncertainty until the moment of reward, most of all at 50/50 odds (Fiorillo, Tobler and Schultz 2003). Hard A/B questions get the biggest ramp.
- **M2 One synced hit.** The reveal (the correct option lights orange) lands exactly on a sound accent, snapped to the track's beat. Why: sound and sight in sync grab attention and make the event feel caused (PMC10798022; Guski and Troje). The BPM detection we need already exists (`lib/reels/music/audio.ts`).
- **M3 Layered but restrained.** The hit stacks a few small effects: a glow bloom, a slight scale overshoot that settles, one light sweep. One hit per slide. Why: game feel ("juice") comes from layered feedback, and too much stops it reading as feedback (Swink, *Game Feel*; Jonasson and Purho, GDC 2012; Lin et al. 2022, impact feel).
- **M4 Natural easing.** Everything eases in and out; the reveal overshoots and settles. Nothing moves linearly. Why: linear motion reads as mechanical (Thomas and Johnston, Disney's principles: slow in/out, follow-through).
- **M5 A settled ending.** Slide 2 holds a calm, complete final frame for about the last 1.5 s. Why: completion and the "just right" feeling are a core part of "oddly satisfying" (Live Science, Discover); this pairs with principle 10, peak-end.
- **M6 Ambient life, always slow.** The photo drift and light movement never fully stop, so no frame looks like a still, but they stay slow enough not to distract from the text.
- **M7 It works with the sound off.** Every beat of the story (tension, hit, settle) reads from the visuals alone; sound amplifies it.
Sources: pubmed.ncbi.nlm.nih.gov/12649484 · pmc.ncbi.nlm.nih.gov/articles/PMC10798022 · faculty.washington.edu/zkwen/articles/lin22features.pdf · livescience.com/62091 · discovermagazine.com (oddly satisfying)

Timing (code-owned, AT-30): slide 1, everything visible at 0 s; 0–5 s glow and swell build (lighting only). Slide 2, 0 s card flip (sting starts), 0.6 s the hit on the beat, with the answer line arriving on it; settled by 2.5 s; one sweep around 3 s; hold.

## Video (AT-15): how it fits what we have
- Animation: the slides are already HTML. HyperFrames (HTML to video, already used by Explainers on `helios-social-worker`) records them as MP4.
- Music: the reels music library (`lib/reels/music`, mood-tagged), mixed in with ffmpeg.
- Posting: the Instagram API accepts Story videos (MP4, at most 60 s). Today's Stories publisher only posts JPEGs (`lib/stories/render-stage.ts`), so the video upload and status polling are new work.
- The contrast check must hold on every frame, not just one, because the photo moves.
- No API cost. Rendering takes about a minute per set on the VM. Worker changes mean a social VM redeploy (Lucas runs it).

## Inventory (Stage 4)
**Stays**
- The Stories pool machinery (`lib/stories/pool.ts`), 4:00 AM turnover and Hub review flow (`auto: false` stays as it is today).
- Photo finder and bank (`findPhoto`, `keysToAvoid`, the used-photo ledger), so the same photo isn't reused too soon.
- The Jev question-set framework (`defineQuestionSet`, `noul` 0–1 scale), now used for the scorecard.
- Social Hub slots and placement; only the series name and label change.
- Field Notes fonts: Pragmatica Extended Bold and Roboto Light.

**Goes**
- All sources: carousel brief numbers, shortlist stories without a brief, reels "The Number" ideas (`sources/carousel`, `sources/reels` use by GTN).
- `gtn-pick@1`, `gtn-gate@1` (verifiable / want_to_guess / newly_changed / copy_says_new), `gtn-same-subject@1`, page reading (`source-page`) for GTN.
- The 30-day same-subject window, replaced by the content map.
- The intro slide (S-49), layout families photo / marquee / type (S-13) and the homemade frame for this series.
- All fixed GTN copy ("Can you guess the number?", "Lock it in. Tap to reveal", "How close did you get?", 🎯 🤔).
- The old difficulty formula (O-10) and the `gtnSkip` record.

**New**
- Content map: about 400 cells in code, plus a cell-state table (open / reserved / closed).
- Writer prompt (Sonnet, up to 5 web searches): 3 questions a day, each tied to an open cell, carrying the 10 principles and the timeless-facts guidance.
- Scorecard Jev question set (surprise, about-you, social currency), answered on the same 0–1 scale by the writer and by Jev; score = average of the two.
- Fact-checker call (up to 3 web searches) at pick; anything short of a clean pass archives the question and frees its cell.
- Difficulty → option count (hard 2, medium 3, easy 4).
- Two-slide renderer: big "AI TRIVIA", question, options, tap line / answer slide; dimmed photo; contrast handling; no exclamation marks or emoji.
- Pool cap 20; the lowest-ranked questions are dropped and their cells freed.

## Part responsibilities (draft, Stage 2)
| Part | Responsible for | Reads | Must never decide |
|---|---|---|---|
| Content map (code) | which cells are open; reserving a cell when a question is written, closing it on post, freeing it on archive | its own cell table | wording or quality |
| Writer (Sonnet + web search, once a day) | 3 questions, each anchored to a different open cell, with options, the correct option, the answer line, its difficulty and scorecard answers | a random handful of open cells, the 10 principles | how many options a question gets (code maps that from difficulty) |
| Pool (code) | ranking open questions on the scorecard, picking the top one | writer's scorecard answers | whether a fact is true |
| Fact-checker (LLM + web search, at pick) | clean pass or fail: the fact is true, exactly one option is right, and the answer line holds | the one question picked | wording, ranking |
| Photo finder + bank | one relevant photo per slide (answer slide reuses slide 1's photo if nothing fits) | each slide's subject | copy |
| Renderer (code) | 2 slides, Field Notes fonts, dimmed photo, contrast; rejects exclamation marks and emoji | the post-ready question | content |

## Research behind the 10 principles (Stage 3: no new research needed)
Loewenstein 1994 (information gap); generation and prediction effects (Slamecka and Graf 1978); Berger and Milkman 2012 (high-arousal emotion drives sharing); Rogers et al. 1977 (self-reference effect); Berger 2013, *Contagious* (social currency); misconception-correction research (Kowalski and Taylor 2009); picture superiority (Paivio); processing fluency (Alter and Oppenheimer 2009); variable reward (Eyal, *Hooked*); Kahneman's peak-end rule.

## Decisions
- **AT-1 Timeless facts are guidance, not a rule** (2026-11-10). "Don't add it as a hard rule. Add it as guidance towards those." The ideation prompt leans toward facts that don't go stale. No confidence field.
- **AT-2 Fact-check before content** (2026-11-10). "When a fact is going to be made into content, the first part of it should be another llm call that fact checks it. If it doesn't pass cleanly, the idea is archived." The check runs only on the pool item picked to post. A verdict that is anything but a clean pass archives the item, and the next one in the pool is tried.
- **AT-3 Content map for dedup** (2026-11-10). "Sure." Fixed map in code of about 400 cells (theme × angle). The daily call sees a random handful of open cells and must anchor each question to one. A cell closes when its question posts. Cells get added when fewer than about 60 days of open cells remain.
- **AT-4 Personality ideas rejected** (2026-11-10). "I don't like those 10 personality ideas." What's wanted instead: social psychology mechanisms that drive engagement.
- **AT-5 Only the fonts carry over from Field Notes** (2026-11-10). "Only the fonts carry over from field notes." Its layout and other design rules do not apply.
- **AT-6 No exclamation marks or emoji** (2026-11-10). "I don't want exclamation marks or emojis here." This is a required rule for all AI Trivia copy, checked in code.
- **AT-7 Both calls get web search** (2026-11-10). "Yes and the ORIGINAL writer should also get web search." The fact-checker and the daily writer both search, with capped counts (proposed: writer 5, checker 3). Estimated cost: about $0.10–0.15 a day, or $3–5 a month.
- **AT-8 All 10 psychology principles** (2026-11-10). "Use all 10." Principles 3, 4 and 5 (surprise, about-you, social currency) form the pool's "will viewers care" scorecard; the rest guide the writing. Each is written as a principle with no examples.
- **AT-9 Multiple choice, option count set by difficulty** (2026-11-10). "It can be A/B, A/B/C, or A/B/C/D. The hardest questions get A/B, the easiest ones A-D." The writer rates difficulty in 3 levels; code maps hard → 2 options, medium → 3, easy → 4. The fact-checker confirms exactly one option is right.
- **AT-10 Writer and Jev both score** (2026-11-10). "Writer should score AND jev should score. They should use the same questions and scale, use the average of both." One scorecard set; the writer answers it on the 0–1 scale in its output, Jev answers it separately for each new question (3 small Jev calls a day). Pool rank = the mean of the two.
- **AT-11 Pool cap 20** (2026-11-10). "Pool caps at 20, lowest ranked ones get dropped." Questions don't expire otherwise. A dropped question frees its content map cell.
- **AT-12 Part responsibilities approved** (2026-11-10). "sure." The writer can't choose the option count.
- **AT-13 Posts 3 days a week** (2026-11-10). "We can do 3 days a week by adding Sunday, but that's it." Monday, Thursday and Sunday. The writer still runs daily (AT-11's cap keeps the pool at 20).
- **AT-14 New series key** (2026-11-10). "Yes." New series `ai_trivia`. `guess_the_number` is retired: its history is kept and it stops producing.
- **AT-15 Subtly animated video with music** (2026-11-10). "I want these to actually be SUBTLY animated (orange glows, nice finishes, some cool lighting movement, etc.) and have some music behind it. And then they're posted to the story as a 5 second video."
- **AT-16 Two 5-second clips** (2026-11-10). "yes agreed." Question clip, then answer clip, so tapping still reveals. The music carries on from clip 1 into clip 2.
- **AT-17 Music rotates within one mood** (2026-11-10). "Yes ageed." A different track from the reels library each time, from one fixed mood (calm, a little groovy).
- **AT-18 The goal of the motion and sound** (2026-11-10). "What's important is that the animation is visually and auditorily satisfying and triggers a dopamine reaction from the viewer. You can do some research to make the right decisions here." This replaces my proposed motion set; the research is in M1–M7.
- **AT-19 Keep M1–M7** (2026-11-10). "keep."
- **AT-20 Signature reveal sting** (2026-11-10). "Agreed." The same short sting on every reveal; the music rotates.
- **AT-21 Flow approved** (2026-11-10). "Yes, flow is approved."
- **AT-22 Up to 5 fact-check tries per post day** (2026-11-10). "Ok." If none pass, the day is skipped and the reason logged.
- **AT-23 Taste picks during the build** (2026-11-10). "Ok." Lucas approves the 20 themes (CONTENT-MAP-DRAFT.md) and picks the sting from 3 options (sting-options/).

## Corrections found while mapping the code (2026-11-10)
- AT-17 assumed the "reels music library". In fact those are Instagram trending-audio previews, which can only be attached to a Reel by `audio_id`; we can't mix them into our own video. The one mood-based music source we have is the HeyGen catalog used by AI Drama (`explainers/reel-ai-drama/kit/music.mjs`). See Q21.
- The Stories pool turns over at 3:00 AM, not 4:00.
- Stories are images-only end to end today; the video path (storage, review on stills, Instagram `video_url` containers, longer polling) is new work, owned by C in CONTRACT.md.
- Video renders must not overlap on the social VM (per-hour rule). The 3:00 hour has no other video renderer today.
- **AT-24 Content map approved** (2026-11-10). "Themes and angles approved." All 20 themes × 20 angles as in CONTENT-MAP-DRAFT.md.
- **AT-25 Fixed copy on slide 1** (2026-11-10). "Tap to reveal is fine." "AI TRIVIA" and "Tap to reveal" are fixed in the renderer; the writer writes neither.
- **AT-26 Music from HeyGen** (2026-11-10). "yes, heygen." The HeyGen catalog, one fixed mood, the same path AI Drama uses (`explainers/reel-ai-drama/kit/music.mjs`). This replaces AT-17's source.
- Sting round 1 (sparkle, heavy bell, pizzicato) rejected: "i don't like any of those 3, try again." Round 2 is options 4–8 in sting-options/.
- **AT-27 The reveal sting** (2026-11-10). Lucas: "combine the sparkle, cardflip, and whoosh bass hit ... Cardflip first, whoosh bass spans the whole thing, sparkle on the hit", then "lets use the first one." Option 9: card flip at 0, reversed whoosh rising into a bass hit plus sparkle at 0.60 s. It starts on clip 2's first frame; the reveal lands on the hit.
- **AT-28 Named photos, never a giveaway** (2026-11-10). "yes, allow people and companies when the question or answer is about them (just make sure it's done in a way that doesn't give away the answer on the question slide)." The writer gives each photo a kind (person / company / thematic) and a name. Slide 1 may name only someone the question itself names, never the correct option. validate.ts checks both: the name must appear in the question, and neither the subject nor the name may contain the correct option's text. Slide 2 may show the answer's person or company.
- **AT-29 B's own music search** (2026-11-10). "The builder's own music search is fine."
- **AT-30 Everything on screen from the first frame** (2026-11-10). "I want the full question and all the answer choices shown at the start. The viewer won't wait for them to come in." Slide 1 has no entrance stagger: the header, question, options and tap line are all visible at frame 0. On slide 2 the options are there at frame 0, and the answer line arrives with the reveal hit at 0.6 s, not later.
- **AT-31 Every motion has a sound, except lighting** (2026-11-10). "any motion needs an accompanying sound effect. Not lighting though." Glows, sweeps and light movement need no sound. Any element that moves (enters, scales, fades, slides) gets a synced sound effect.
- **AT-32 Keep the photo drift, with sound** (2026-11-10). "Keep it with sound." The slow background drift stays (M6) and gets a soft ambient sound that follows it, mixed well under the music so it adds texture without competing.
- **AT-33 IG-natural redesign, max 5 elements on slide 1** (2026-11-10). "this looks super corporate. I want you to make it more IG natural (the old ones leaned all the way IG natural) and the "tap to reveal should be bigger. Also, ONLY 5 ELEMENTS ARE ALLOWED TO BE ON THE SCREEN for the first slide: "AI Trivia", question, answer choices, "Tap to reveal" and an arrow on the right side of tap to reveal pointing to the right. Move away from the feel of the current design state and make the design more natural (aligned with what IG stories actually look like) because that will make people trust it. Obviously we can't actually put stickers or IG's in-app writing on the story, but that's the gold standard we're aiming for while at the same time making it a great story. Please also apply all this thinking to the answer slide as well." Gold standard: what someone builds in Instagram's own story editor (the old Homemade style, `lib/stories/render/HomemadeFrame.tsx`: Classic text, highlight boxes, quiz-sticker feel, pen arrows, slight tilt). The background photo is not an element.
- **AT-34 Instagram's Classic text replaces the Field Notes fonts** (2026-11-10). "Ok that's fine." This reverses AT-5. All text uses Instagram's Classic style (Inter Medium stand-in, as in HomemadeFrame); Pragmatica Extended and Roboto are out for this series.
- **AT-35 No photo credits** (2026-11-10). "Remove photo credits entirely." Neither slide shows a credit line.
- **AT-36 Editor-native motion replaces the glows and sweep** (2026-11-10). "Yes good call." The orange glows and the glossy sweep are dropped. The photo drift with its ambient sound stays (AT-32), and the reveal sting stays (AT-27). Motion is limited to what Instagram's editor itself does: a slight tilt, a text box popping in on the reveal. Every motion still has a sound (AT-31).
- **AT-37 No tilts** (2026-11-10). "get rid of the tilts. Make everything level." Every element sits level on both slides.
- **AT-38 A dopamine reveal** (2026-11-10). "the right answer reveal animation should trigger dopamine." Built on M1–M3 (one synced hit, layered effects) and Instagram's own quiz-sticker feedback: on the 0.6 s hit, the correct row fills with orange in a fast left-to-right wipe and punches (scale overshoot and settle), a drawn check mark pops in, and a short confetti burst comes off the row. The wrong rows shrink slightly and fade. All of it starts on the sting's hit, so the sting covers its sound (AT-31).
- **AT-39 No photo restriction** (2026-11-10). "No don't restrict the photos." The finder keeps every source, and there are no credits (AT-35). Lucas was told that some sources (CC BY, many Wikimedia photos) require a visible credit by license.
- **AT-40 Sting and loudness unchanged** (2026-11-10). "Ok all approved." The sting stays as mixed (its card flip is quiet, and there's no visual flip), and the clips stay about -12.6 LUFS.

## Rename and gameshow direction (2026-11-13)
- **AT-41 Title becomes "Are you smarter than AI?"** (2026-11-13). "I want to change the title of this series to 'Are you smarter than AI?' and I want it to have a gameshow feel." This replaces the fixed "AI Trivia" headline (AT-25). Whether the internal series key and Hub label change too is still open.
- Options served: `gameshow-options/reference-sheet.html` (13 looks, each with question and answer mocks) and `gameshow-options/audio/` (21 locally made sounds, including 4 reveal packages built on the AT-27 sting). Nothing has been picked yet, and nothing is built.
- Tensions to settle: a gameshow look against IG-native trust (the redesign pushed toward IG-native), the 5-element rule for slide 1 (YOU vs AI and the countdown ring break it), and HeyGen music against our own show theme.
- **AT-42 Marquee sign chosen; everything else goes organic IG** (2026-11-13). "The marquee sign is perfect, but everything outside of the marquee sign needs to be pushed more towards 'Typical organic instagram story' and away from 'corporate feel'. The darkened background photo honestly isn't a great look." The sign is look 02 from the reference sheet, unchanged. No photo dimming: text stays readable through IG-style text boxes, stickers and shadows. Five layouts served in `gameshow-options/marquee-organic.html` (A bright photo + white text boxes, B photo card on a colour fill, C sharp band with blurred fill, D typewriter + pen, E create mode + photo sticker). Not picked yet.
- **AT-43 Create-mode layout, no photo** (2026-11-13). "Lets go with the create mode option. However, I want to get RID of the photo sticker and move the question up to under the sign. And then the answer choices will be right under the question. And then UNDER the answer choices will show 'Tap to reveal'." Order, top to bottom: sign, question, choices, "Tap to reveal" with arrow, on a warm orange gradient. The answer slide puts the answer line where "Tap to reveal" was. Mock: `gameshow-options/marquee-create.html`, preview `marquee-create-preview.mp4`. This drops the photo from both slides, so the photo finder step (and AT-28's named photos) is no longer needed for this series. Sound tour for picking: `gameshow-options/sound-tour.mp4`.
- **AT-44 Centred stack, chosen sounds** (2026-11-13). "1. go with your rec 2. Drum roll reveal, theme plus clock should both be used". The stack (sign, question, choices, tap) is centred vertically inside IG's safe area (220 px top, 280 px bottom), so 2-, 3- and 4-choice questions all sit balanced. Clip 1 sound = our show theme with the ticking clock (tour #4, `21-question-bed-theme-plus-clock`). Clip 2 = the drumroll reveal (tour #2, `19-reveal-drumroll-ding-applause`): the roll starts on the tap, and the crash and ding land on the 0.6 s hit. Our theme replaces the HeyGen music, and the preview keeps it running quietly under the reveal. Preview: `gameshow-options/marquee-create-preview.mp4`.
- **AT-45 Same positions on both slides** (2026-11-13). "Everything has to stay in the same place from the first story to the second story." Both slides lay out the same stack: sign, question, choices and a fixed 210 px footer slot. "Tap to reveal" sits at the top of the slot on slide 1, and the answer line fills it on slide 2. The stack is centred once, so the sign, question and choices land on identical pixels (checked for 2, 3 and 4 choices). Build rule: if a long question plus 4 choices won't fit the safe area, the question font steps down, the same way on both slides.
- **AT-46 Theme and clock on the beat** (2026-11-13). "Please align the song and clock so that they match up beat wise." The theme runs at 128.571 BPM (beat 0.4667 s) so that beat 12, the downbeat of bar 4, lands exactly on the reveal hit (clip 2 + 0.6 s = 5.6 s). The clock ticks on every beat of clip 1, alternating tick and tock. The theme continues at a lower level under clip 2. Because it's one fixed asset with its downbeat at 0, the renderer needs no beat detection. Assets: `audio/23-theme-on-grid-bed.mp3`, `audio/22-preview-mix-on-beat.mp3`.
- **AT-47 10-second question slide with a countdown** (2026-11-13). "The first story needs to be longer. 10 seconds… there should be a COUNTDOWN TIMER on the first slide. It should be next to 'Tap to Reveal'." Clip 1 is 10 s and clip 2 stays 5 s. Slide 1 now has 6 elements: Lucas's explicit ask overrides the earlier 5-element rule. The timer is a white disc with a draining dark ring and a digit from 10 down to 1. It sits to the left of "Tap to reveal", so the arrow still points to the tap side. The digits pulse on 3, 2 and 1. Sound and beat: the theme is re-timed to 120 BPM (beat 0.5 s), so each countdown second is exactly two beats. The tick plays on the digit change and the tock on the half. Beeps replace the tick on 3, 2 and 1 (higher on 1). Clip 2 starts on a downbeat (beat 20). The drumroll is 0.5 s and the hit lands on beat 21 (+0.5 s), and the green reveal and confetti move to +0.5 s to match. This supersedes AT-46's 128.571 BPM. Assets: `audio/24-theme-120bpm-bed.mp3`, `audio/25-preview-mix-10s-countdown.mp3`. Preview: `marquee-create-preview.mp4` (15 s).

## Question logic: audience (2026-11-15, in progress)
- Lucas: "We don't need to align all the content types. A lot of those have an audience specific to the content type on purpose… dive into the logic of how we're coming up with the questions for AI trivia… try to come up with the best audience profile for AI trivia questions."
- Finding: the writer prompt `trivia-write@1` names no audience ("questions about AI that viewers will care about"). Only the scorecard's surprise item says "viewers who follow AI on Instagram". Difficulty ("most viewers would not know it") is measured against an undefined viewer.
- **AT-48 (draft, awaiting Lucas)**: one audience profile for the series, owned in one place and read by the writer, the Jev scorecard and the difficulty definitions. The draft profile and the calibration rules are in the 2026-11-15 chat reply.
- **AT-48 Audience = the general follower, no builder questions** (2026-11-15). "YES, BIG TIME, lets LEAN INTO THAT." Every question is written for the everyday AI user who follows the account. No questions are for people who build with AI.
- **AT-49 American, 18–45** (2026-11-15). "America, 18-45". Amounts are in dollars and references are to US places, brands and events. References must land with both ends of the age range.
- **AT-50 Fair-shot score** (2026-11-15). "YES, this is important." This is a fourth scorecard item that both the writer and Jev answer: can this viewer reach an answer without insider knowledge? The score becomes the mean of 8 numbers. Proposed (awaiting Lucas): a mean fair_shot below 0.5 archives the question and frees its cell.
- Proposed wording for AT-48–50 is in the 2026-11-15 chat reply. One owner: a new `lib/stories/trivia/audience.ts`, read by `trivia-write@2` and `trivia-score@2`. Not yet edited; it goes into the build with the design.
- **AT-51 Fair shot is also a gate** (2026-11-15). "1. yes". A question whose mean fair_shot (writer and Jev) is below 0.5 is archived and its cell is freed, the same as a fact-check fail.
- **AT-52 Insider themes removed** (2026-11-15). "No, get rid of the themes that lean insider." Out: 6 The people who built AI, 11 Chips, power and the cost of running AI, 15 AI and money: the companies and the deals, 16 The words of AI: where the terms came from, 17 AI rules, laws and lawsuits. Borderline and kept for now: 4 Firsts and origins, 10 How AI learns, 20 Discoveries AI made in science. Proposed (awaiting Lucas): fill the five slots in place with everyday themes, so the map stays 20 × 20 and the schema seed (`generate_series(1, 20)`) and the cell ids don't change.
- **AT-53 Five everyday themes fill the slots** (2026-11-15). "Yes, use those five". 6 AI at work: the jobs and tasks it's changing; 11 Scams, fakes and deepfakes; 15 AI at home: speakers, cameras and smart gadgets; 16 AI in school and homework; 17 AI in dating, friendships and social life. Filled in place, so the cell ids and the schema seed don't change. CONTENT-MAP-DRAFT.md is updated; `lib/stories/trivia/map.ts` changes in the build.

## Calibration from the 15-day simulation (2026-11-15, in progress)

Source: `SIM-REVIEW.md` (15 winners, $2.26 live run on a local DB). Lucas's critiques, his words:
1. "people are confused about the context of the question on first read … the general public doesn't know 'Bard' … asking the consumer to pick a number when it doesn't understand the context the numbers are playing in"
3. "The viewer will EASILY be able to infer this when they look at the two choices … The nature of the question quite literally implies [the answer]"
5. "a third option here would've been good to make the question a little harder"
7, 11. "Repeat (obviously bad)"
8. "too many elements at play to follow in the story … we once again don't know the context the numbers are playing in"
10. "'ONE AI checker tool'. Ok… why should we care about this? … generic in a bad way"
15. "why would somebody care WHICH contest the photo won in?"
Liked: 2, 4, 6 ("Great"), 9, 12, 13, 14 ("Great!"); 5 good apart from the option count.
His constraint: fix "at a HIGH LEVEL OF PROMPTING ALTITUDE. You CANNOT start to layer specific instructions."

Root causes (my diagnosis):
- R1 Not clear on first read (1, 8): too many moving parts, an entity the viewer doesn't know, a number with no scale.
- R2 Not a real guess (3, 5): the wording or the options give the answer away; two options are a coin flip.
- R3 The guess isn't the point (10, 15, and 1's number): the blank the viewer fills is an incidental detail or a one-off.
- R4 Repeats (7, 11): dedup is per cell, so the same real-world story can return under another cell.
- Why the rules didn't stop it: the writer prompt carries ~25 rules at mixed altitudes, so the ones that matter compete with formatting; the scorer that picks winners measures surprise, about-you, social currency and fair shot, but not clarity, a real guess or whether the guess is the point; "hard" maps to 2 options (AT-9) and the writer rates most questions hard (11 of 15).

Proposed (awaiting Lucas):
- P1 One definition of a good question, written once and read by the writer, the scorer and the gate: four viewer-centred qualities (clear at first read; a real guess; the guess is the point; worth knowing). It replaces the ten principles and the audience rule list; fair shot folds into the first two.
- P2 Floors gate, appeal ranks: clear and real-guess are gates (archive below the floor); point and worth-knowing rank the pool.
- P3 The writer prompt shrinks to role, viewer, the four qualities, and the mechanical requirements (cell, true facts, fields).
- P4 Story ledger: each question names the real-world story it rests on; posted and pooled stories are shown to the writer and a repeat is rejected in code.
- P5 Option count no longer set by difficulty (conflicts with AT-9; Lucas to decide).
- P6 A field over its length limit goes back to the writer once to shorten instead of being dropped (11 of 45 were lost, mostly by 1–4 characters).
- Verify: replay the 15 rated questions through the new scorer and gate (Jev only, cents) and confirm it catches 1, 3, 8, 10, 15 and keeps 2, 6, 14; then a fresh 5-day simulation.

Decisions (2026-11-15, Lucas's answers):
- **AT-54 Always three options** (supersedes AT-9). "Ok 3 every day". Difficulty no longer sets the count; the difficulty field retires (nothing displays it).
- **AT-55 One definition of a good question, four tests** (P1, P3). "Yes these are good." Clear at first read, a real guess, the guess is the point, worth knowing. Written once, read by the writer, the scorer and the gate. The ten principles and the audience rule list go.
  Stress, his words: "a majority of the general public needs to be familiar with every person/place/thing/event in the question or answer choices." This is the heart of the first test and is required. It replaces the old escape hatch ("or the question says who or what it is in a few words").
- **AT-56 First two tests gate, last two rank** (P2). "Sure". Fair shot folds into the first two; its gate carries over to them.
- **AT-57 No repeated facts, not "no repeated stories"** (P4, revised). "stories don't need to JUST be about stories … Trivia questions come in other shapes and sizes. And when a question IS about a story there can be different questions about the same stories." A repeat is a question whose answer turns on the same fact as one already asked. A different question about the same event, person or thing is allowed.
- **AT-58 One shortening try, then graded like any question** (P6). "the new question needs to be graded and if it doesn't work shortened then it's thrown out." A question over a length limit goes back to the writer once; the shortened version is validated and scored like any other; if it still breaks a limit or fails a gate, it is dropped.

Proposed wording (awaiting Lucas; one owner, a new `lib/stories/trivia/quality.ts`, read by trivia-write, trivia-score and trivia-check):

What a good question is. These are required.
1. Clear at first read. In one read, the viewer knows what the question is about and what they are choosing between. Every person, place, thing and event in the question or the options is one most Americans already know; nothing unfamiliar is named, even with an explanation. The options can be weighed as written, without context the question leaves out.
   Yes: most Americans know everything named, and one read is enough to understand it and weigh the options. No: something named is unfamiliar to most Americans, it takes more than one read, or the options can't be weighed without missing context.
2. A real guess. A viewer who doesn't know the answer has to actually guess: nothing in the wording or the options points to the right one, and each option is one a reasonable viewer might pick.
   Yes: each option is a believable pick and the answer can't be worked out from how the question is put. No: the wording or the options give it away, or an option is one nobody would pick.
3. The guess is the point. What the viewer guesses is the most interesting part of the fact, and the fact says something true about the world rather than resting on one odd case.
   Yes: the thing guessed is the heart of the fact and the answer holds up in general. No: it asks about a side detail, or the answer is a one-off that says little.
4. Worth knowing. Once revealed, the answer surprises the viewer, touches their own life, or is something they'd want to repeat.
   Yes: they'd be glad to know it. No: they'd shrug.
Never repeat a fact. The material lists every question already posted or waiting in the pool, with its answer. A question repeats one when its answer turns on the same fact. A different question about the same subject is fine.

Mechanics: the writer and Jev each score the four tests (0–1). Gate: the mean of the two scores on test 1, and on test 2, must each be at least 0.5, or the question is archived and its cell freed. Pool score = the mean of the writer's and Jev's scores on tests 3 and 4. The fact-check also fails a repeat. Writer prompt keeps role and format, the viewer, cells, true facts and sources, fields and limits, timeless-facts guidance, voice and humanizer; it loses the ten principles, the audience rule list and the difficulty section.

Revision after Lucas's challenge (2026-11-15): "these rules are enforcing against what's BAD … Are you sure you're not getting rid of the best parts of the engine in this build?"
What made the liked questions (2, 4, 5, 6, 9, 12, 13, 14):
- The content map's angles. Both "Great" questions (6, 14) came from "The myth most people believe"; the others from "Where the name came from", "Who was really behind it", "What it was originally built for", "Older than you think". Kept unchanged.
- Overturning a common belief (old principle 6): 4, 6 and 14 all do it. The draft only had "surprises" inside test 4. Kept by name.
- The answer line as the payoff (old principle 10): the liked lines tell the viewer why it matters to them. The draft's four tests didn't cover the answer line at all. Kept.
- Concrete (old principle 7): every liked question turns on one specific thing. Folded into test 3.
- Variety across the day's three (old principle 9). Kept as a task line for the writer.
- The audience profile, web research, the fact-check and the timeless-facts guidance. Kept unchanged.
The old scores did not pick the good ones: the disliked 10 (0.72) and 3 (0.72) outscored both "Great" questions (6: 0.69, 14: 0.67). Replacing the ranking is low risk; the replay check must show the liked questions ranking above the disliked ones.

Revised proposed wording (supersedes the draft above; same owner, quality.ts):
A good question is fair to play and worth playing. These are required.
Fair to play (each is a gate):
1. Clear at first read. (unchanged from the draft)
2. A real guess. (unchanged from the draft)
Worth playing (these rank the pool):
3. The guess is the point. What the viewer guesses is one concrete thing and the most interesting part of the fact, and the fact says something true about the world rather than resting on one odd case.
4. Worth knowing. The answer lands away from what most viewers expect, at its best overturning something they believed, and it touches their own life or is something they'd want to repeat.
5. It pays off. The answer line tells the viewer why the answer matters to them and goes beyond restating the correct option.
Never repeat a fact. (unchanged from the draft)
Writer task line, not a test: across the day's three questions, vary the theme, the kind of fact and the shape of the question.
Scoring: tests 1–4 are scored by the writer and Jev, with tests 1 and 2 gating and tests 3 and 4 ranking. Test 5 is required of the writer and judged by Jev as part of test 4, which reads the question, the answer and the answer line together.

Build (2026-11-15): AT-54 to AT-58 built locally, uncommitted. quality.ts (one owner), trivia-write@3, trivia-shorten@1, trivia-check@3, trivia-score@3, asked.ts, gates in daily.ts. tsc clean; trivia-ideas 10/0, stories-pipeline 23/0, render 19/0.

Replay of the 15 rated questions through trivia-score@3 (Jev alone) and trivia-check@3 ($0.05):
- Repeat rule: both repeats caught (7 vs 3, 11 vs 8), each failed as "turns on the same fact".
- Test 3 (the guess is the point) sorts Lucas's ratings almost perfectly: disliked 1 0.39, 8 0.28, 10 0.31, 15 0.27; liked 0.72–0.90 except 12 (0.50). Miss: 3 (0.83), whose flaw is the giveaway.
- Test 1 (clear) is harsher than Lucas: it fails the "Great" 14 (Waymo, 0.44) and the liked 2, 5, 9, 12, 13; it does fail 1, 8 and 15.
- Test 2 (real guess) only half-catches 3 (0.57, passes).
- Test 4 (worth knowing) runs against Lucas: highest on the disliked dramatic ones (1, 8, 10, 11: 0.79–0.85), lowest on the "Great" 6 (0.33).
- The gate averages the writer's own score with Jev's; the writer scores itself high, which would have let Bard through (old fair_shot: writer 0.7, Jev 0.66).
Fresh 5-day simulation held until the scorer is recalibrated (Lucas to decide).

Recalibration (2026-11-15, Lucas: "1. Sure 2. Yes 3. Yes"):
- **AT-59 Test 1 says "familiar with"**, not "already know" (his word). Built.
- **AT-60 Gates judged by Jev alone**; the writer never grades its own gate. Built.
- **AT-61 The pool ranks on test 3 alone**; test 4 stays in the writer's definition but does not rank. Built.
Second replay (Jev, $0.001): test 3 now ranks every disliked question at 0.25–0.35 and the liked ones at 0.73–0.89 (12: 0.48). The real-guess gate catches 3 (0.49). But the clear gate still fails 6 of the 8 liked questions (2, 5, 9, 12, 13, 14 "Great"), and the real-guess gate also fails 2 and 12.
Experiment, Sonnet as judge with the same test text ($0.03): lenient and flat. It rates everything clear (Bard 0.80, Arup 0.80) and test 3 at 0.60–0.85 regardless of rating. No separation.
Reading: neither model judges clarity the way Lucas does; Jev's test 3 is the one score that matches his taste. Open: whether tests 1 and 2 stay score gates.
- **AT-62 No score gates** (2026-11-15, supersedes AT-51, AT-56's gates and AT-60). "ok remove the two score gates." Tests 1 and 2 stay required rules in the writer's definition; nothing is archived for its scores. The pool ranks on test 3 (AT-61); the fact-check still fails false facts and repeats. Built; trivia-ideas 10/0, stories-pipeline 23/0, tsc clean.

## Content map cut (2026-11-15, in progress)

Lucas on SIM-REVIEW-2 (his words): "4 and 5 are great."
1 (Echo wake word): "a nontechnical user isn't thinking about these mechanics when they read the question, and a lot of people may not be familiar with the specific workings of the Echo".
2 (CAPTCHA): "You're dropping the user into a story midway through that it doesn't really have much context on."
3 (checkers): "The user doesn't care which game it was."
"We definitely need to get rid of all the weak parts of the content map (categories and angles). Let me know which ones you're going to get rid of before you do."
Note: Jev's test 3 rated 1, 2 and 3 high (0.87, 0.91, 0.76), so the ranking alone did not catch them; the map is the upstream lever.

All 20 rated winners by angle (good = good/great/fine; bad = bad or a repeat born of a bad shape):
- A5 myth: 2 Great. A19 originally built for: good, great. A12 record holder: great. A9 name origin: good. A3 who was really behind it: good. A14 older than you think: fine. A18 how big it really is: fine, bad. A6 what it cost: fine, repeat.
- A4 how it actually works: bad, bad, repeat (0 of 3). A7 something you use without knowing: bad, bad. A8 close call or near miss: bad, bad. A2 the first time it happened: bad.
By theme: T10 How AI learns gave fine, bad, bad; the rest are mixed or untested.

Proposed cuts (awaiting Lucas):
- Angles, on evidence: A4 How it actually works, A7 Something you use without knowing, A8 A close call or near miss, A2 The first time it happened.
- Angles, same failure shape, untested: A13 The year it happened (guess a date: a side detail), A16 What went wrong (a story joined midway), A17 The rule nobody knows about (needs backstory).
- Themes: T10 How AI learns: data and training (mechanics, 1 of 3), T20 Discoveries AI made in science (lab science most people aren't familiar with; its pool question was protein folding).
- Mechanism: retired themes and angles are never offered; cell ids and the table stay as they are. The map goes from 400 cells to 18 × 13 = 234.
- **AT-63 Weak map parts retired** (2026-11-15). "Agreed, cut all of them." Retired in place (RETIRED_THEMES / RETIRED_ANGLES in map.ts; cells stay on the grid, never offered): themes 10 and 20; angles 2, 4, 7, 8, 13, 16, 17. 234 active cells. Built; trivia-ideas 11/0, stories-pipeline 23/0, stories-repository 12/0, tsc clean.

## Days 6–15 on the trimmed map (2026-11-15)

Lucas: "This set is GREAT but the worst questions here are the following. I want you to figure out why they're weaker: 11, 13, 14, 15" (11 the 1770 chess "machine", 13 Ashley Madison bots, 14 OpenAI began as a nonprofit, 15 OpenAI's AI-text detector caught 1 in 4).

Diagnosis (mine, awaiting Lucas):
- D1 The subject isn't in the viewer's world. The strong ones start from something the viewer already uses, sees or says (Google Maps traffic, Face ID, the word "computer", ChatGPT, gaming chips) and reveal something new about it. The weak four start from something the question has to introduce first: an 18th-century hoax, a 2015 investigation of a dating site, a company's legal structure, a tool that was pulled in 2023.
- D2 Event-shaped, not thing-shaped. 11, 13 and 15 are incidents with a cast and a date (who, where, when) that the viewer must take in before the question starts; the same failure as the earlier Arup and CAPTCHA questions ("dropping the user into a story midway"). The current test 1 checks that names are familiar, not that the question needs no backstory.
- D3 Company-centric. 14 and 15 are about OpenAI as an organisation (its corporate form, a product it withdrew), not about what the viewer experiences. Products the viewer uses win; the companies behind them don't.
- D4 The twist is signalled in the wording. 11 puts "machine" in quotes and asks what "really" made the moves; 13 asks who was "really" behind the profiles in an AI series. Jev's real_guess caught 11 (0.15) but not 13 (0.78).
- D5 Theme evidence: "Scams, fakes and deepfakes" has produced 0 good winners in 4 (Arup twice, 11, 15). Scams are incidents by nature, so the theme keeps generating event-shaped questions.
- D6 Brand: 13 is about an infidelity site, an odd fit for an AI consultancy's account.
Scores don't separate weak from strong (8, a liked question, has real_guess 0.14), so the fix is in what the writer is asked to start from, not in the scorer.
Lucas's correction (2026-11-15): "No. That's not why they're bad."
- 11: "it doesn't connect well to the viewer's life" (D1 right for this one).
- 13: "Gizmodo isn't known by a majority of people." (A test 1 breach: the writer credited the fact to an outlet most people don't know.)
- 14: "honestly isn't that bad, it's just basic."
- 15: "it's outdated to the point where it isn't really relevant in the AI checker industry conversation anymore. That wasn't really a significant moment in that discourse."
D2–D6 withdrawn; the Scams retirement and the brand line are not proposed.
Proposed (awaiting Lucas), each an edit to an existing test in quality.ts, no new rules:
- Test 4 ends "and it connects to the viewer's own life and is something they'd want to repeat" (was "touches their own life or is something they'd want to repeat": the "or" let a curiosity with no link to the viewer through). For 11.
- Test 1 adds "That includes anyone the question credits for a fact." For 13.
- Test 3 ends "rather than resting on one odd case or a moment that has since stopped mattering." For 15.
- **AT-64 Three test edits** (2026-11-15, "yes"). Test 1 adds "That includes anyone the question credits for a fact."; test 3 ends "or a moment that has since stopped mattering"; test 4 requires that the answer "connects to the viewer's own life and is something they'd want to repeat". Jev's check, yes and no lines follow the same wording.
- **AT-65 "What it cost" retired** (2026-11-16). "please get RID of the 'what it costs' angle. All of those are weak." Angle 6 added to RETIRED_ANGLES (retired in place, same as AT-63). 18 × 12 = 216 active cells.
