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
