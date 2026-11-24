# Reel AI Drama: iteration 8 (director, visual system, sound)

Status: **built locally 2026-11-03, not committed or deployed, not yet run live.** Reel tests 383/383. A fresh review of every prompt in the pipeline found 35 problems (contradictions, example pollution, split ownership, altitude); all resolved. Decisions MD-134 to MD-143 are in `PLAN.md`; the shared contract is `ITERATION-8-CONTRACT.md`. Reels reviewed: "The Call That Bought Siri" (Apple) and "Alexa on the Chopping Block" (Amazon), both in
`test-runs/iter7-renders/`.

## Goal, in Lucas's words

> "We need to upgrade the director and visual/design system so that the quality goes up and errors stop happening so
> much!!!"

Calls already made (2026-11-03):
- Design findings keep triggering a fix: "yes they should. we just need to upgrade the system so they happen less."
- Broken screenshots: "If it's a broken screenshot then we shouldn't be using it."

## Lucas's notes, sorted by the part of the system that owns them

### 1. Writer: the hook

- Amazon: "this hook doesn't work because the viewer doesn't care about the layoffs standing alone. The hook should have
  been: 'Two weeks before the launch of ChatGPT, Amazon missed out on the AI race.' that is the actual consequence that
  this reel is talking about and it's what the viewers will understand and care about the most."

### 2. Entities: products and companies are players too

- Amazon 0:16: "Alexa's devices unit is mentioned for the first time. This is a central entity or concept or player in
  the video, and they should be introduced visually as well... there should have been a photo of an Amazon Alexa that
  came up."
- Apple: "there was never a visual representation of Siri, even though Siri has its own logo and Siri has visuals that
  represent it. bottom line, products should be entities as well."
- Apple 0:12: "When SRI International is named at second 12, we should see something of it, like a logo or something."
- Amazon 0:50: "a new player, OpenAI, is mentioned. Their company logo should be shown to introduce them."
- Amazon 0:55: "on the whiteboard at second 55, we should have just seen the Amazon logo drawn on the whiteboard instead
  of the word Amazon."

### 3. Director: the picture follows and is true to the words

- Amazon 0:18: "the number 5 billion should have also been shown visually. That graphic was super lazy from second 14 to
  second 20 because it was literally just one article, and yet three different things were mentioned in that scene."
- Apple 1:00: "the graphic at 1 minute is lazy because it doesn't map to the words that say, 'The price was never
  disclosed.' By saying the words 'the price was never disclosed' and then showing 24 million, it leads the viewer to
  believe that it was sold for 24 million."
- Apple 0:35: "they spent 3 hours by the fireplace. That's a missed opportunity to show a fireplace and also to have
  sound effects of a crackling fireplace to really bring the viewer into this situation."

### 4. Toolbox: more moves for the director

- Numbers (Apple): "it would be great if there was a burst of dollar sign stock images being moved through really
  quickly in the background at low opacity. That's something creative that the director should have in its toolbox."
- People: "The effect where we circle the face of someone is overused. The director should be a little bit more creative
  with what it places on top of the people... it would be great if the director can just place almost like little text
  of what they're saying, paraphrased, right next to them." (Apple 0:25: Jobs says "come over"; Kittlaus says he's going
  to the ballet.)
- Articles: "there should be more that the director can do with it than just show a screenshot of the news article":
  a flash on screen with a shutter sound; a phone showing the article; a mouse clicking something to reveal the breaking
  news notification.
- Scene tools: "we haven't really seen the bulletin board and/or the newspaper settings at all recently. It's like they
  don't even have a use case that they can be used for when they should."

### 5. Composition and errors

- Amazon opening: "the first frame of this one loses absolutely everybody... The start of this video literally just
  shows the screenshot of a news article in the bottom right. That is completely unacceptable. It needs to open on a
  fully formed, sensible, well-composed, visually engaging note."
- Amazon 0:25: "there is a thought cloud graphic drawn for David Limp, but it is drawn all the way up off frame and it is
  in black, so it isn't even visible against the background. First of all, I don't love that the thought cloud is what
  was drawn here, but it should definitely be at least in white and over David Limp directly."
- Apple 0:57 and Amazon 0:30: the underline misses the words: "The screenshot should move, but the underline should be
  tracked to the screenshot moving."
- Apple 1:00: "a weird left border that is white on the side of the graphic... The world of the graphic should expand far
  enough so that that doesn't happen."
- Amazon 1:03: "the label 'August 2023' completely covers two of the main people in that image. That is unacceptable.
  Also, that image is positioned towards the bottom of the screen, and it's going to be covered by captions on social
  media. The viewer wants to look at it in the middle of the screen."

### 6. Sound

- Apple: "There's too much silence. The sound design should be more purposeful. The only time there should really be
  silence is when we're using a moment of silence to really drive something on purpose... when Dag Kittlaus comes on,
  there should be some intense business documentary-style music that comes on."
- Amazon: "I'm 34 seconds into the video, and I haven't heard a single piece of music until now. This is absolutely
  disgusting sound design and cannot happen. Yes, there is merit in leaving some moments silent... but we absolutely need
  to use music as a driving force for emotion through sound design. The music selection through both reels has been
  fantastic, and it's exactly the business documentary vibe that we want. It's just not being used well enough."
- Apple 1:00: "the sound design for that graphic was lazy. We should see sound design with motion for graphics."

### 7. The close

- "for the closing of these reels, I want to use the same close that AI Brain Break uses so that our reels are consistent
  visually and they fit within the brand. Please use the same type of closing graphic that is used visually for AI Brain
  Break, but obviously show real AI drama on this one instead."
- "I want a visual transition to the closing graphic that is clean and smooth. Currently, the jump from the close of the
  story to the close of the episode with the graphic and the closing question is pretty abrupt."

## What the code shows (checked 2026-11-03)

**The music was never missing: it was inaudible by design.** In the Alexa reel, the music starts at 0:00 and plays the
`drone` style until 0:33, at volume 0.16. At 0:33 it hands over to `dread`, the low strings, which is the moment Lucas
first heard music. The Siri reel does the same for 0:00 to 0:18. The causes:
- `prompts/sound-designer.md` tells it to open on "a tension bed (a low drone, a pulse, a ticking figure), not a full
  track", and that the music "supports and never pushes" the voice.
- `kit/music.mjs` sets `BED_VOLUME = 0.16`, so a low drone sits far under the voice. Phone speakers probably lose most of
  it too (my inference; I measured the levels, not a phone).

**The review can't see what Lucas saw.**
- Design-review stills are taken 60% into each frame (`stillAt` in `render/video.ts`), and the contact sheet adds one at
  1.0s. Nothing looks at the first instant, so the bad opening could not be caught. A still also can't show a mark
  drifting off its target.
- At t=0.04s, the Alexa reel shows one page low on the right and an empty upper half. Siri is better composed but still
  mid-arrival.

**Why some moves never appear.**
- The kit has no phone, cursor, notification, flash or speech-text component, and no burst behind a number.
- `kit/FRAME.md` and `director-craft.md` give board, whiteboard and newspaper one vague line of use, and none are
  required or suggested anywhere. Lucas also called an earlier newspaper "boring" (`PLAN.md`, iteration notes), so the
  look may need work as well as the use case.
- The director's frames are about 7s and each holds one treatment, so one article can sit under three different claims.
- The Alexa frame 4 thought cloud is `nk.expressionMarks` with `kind: 'thought'`, and the bounds and contrast checks
  passed it.

**Sources and sound library.**
- Harvest has Commons, Openverse, Serper (Google Images), articles, logos and the bank. See the correction below on why
  the fireplace wish found nothing.
- The ambience library has no fire. `tools/ambience-import.mjs` can add it (Freesound CC0, no key).

**Conflicts with earlier decisions to resolve.**
- Principle 18 ("Put a person at the centre of the hook") conflicts with the hook Lucas wrote, which centres on Amazon.
- MD-05/MD-13/MD-18 specify the current dark close with the question spoken over it. The AI Brain Break close is white,
  logo at centre, handwritten wordmark, 2.5s, no voice, no captions.
- `kit/FRAME.md` says "only the verbatim artifact and printed logos are paper" on the whiteboard and forbids recoloring a
  logo. A logo drawn in marker needs an explicit allowance, whiteboard only.
- Writer rule: "Quotes are verbatim." Paraphrased speech text must read as paraphrase, so no quote marks.
- Sound designer HARD 3 (no two heavy impacts within 10 seconds) and "Fewer, better cues" may hold back the fuller sound
  design Lucas wants. Revisit both.

## Proposed changes

**A. Writer**
- Rewrite principle 18 so the hook leads with the real consequence the viewer cares about, carried by a person or a
  company they know. No example hook goes in the prompt.

**B. Entities**
- Products and organizations join people as cast. Harvest finds each one's logo and a photo of the product.
- Every central entity is shown on screen when it is first named. A code check flags any that isn't.
- On a whiteboard, a logo is drawn in marker rather than written as a word.

**C. Director: a shot map**
- Each frame lists shots tied to spoken words. Every first-named entity, every number and every new claim gets its own
  picture beat, and no shot holds too long.
- Code checks the map against the script.
- A picture may never imply something the line doesn't say. The integrity check tests that pairing.
- Places and atmospheres named in the script are looked for and shown, with matching ambience.

**D. Kit: new moves**
- Articles: `flash` with shutter, `phone` showing the article, `cursor` click that reveals a breaking-news notification.
- Numbers: a fast low-opacity image burst behind the number, plus sound on every number move.
- People: speech text beside a person (paraphrase styling, drawn from the script's facts). Face rings are limited per
  reel; thought clouds become a last resort, in light ink, placed over the person.
- Board and newspaper: specific jobs. Board for three or more connected players; newspaper for how the world read a
  moment. Show Lucas fresh stills, since he called the earlier newspaper boring.

**E. Stop errors at build time** (code runs free, before anything renders)
- The first frame is fully composed at its first instant, with the main subject near the centre. The reviewer gets a
  still at t≈0.1s.
- Marks are re-measured against their target as it moves, every 0.2s, and any drift is flagged. The cause of the underline
  drift still needs confirming.
- Labels choose a spot away from faces and the focus. Grounds always extend past the frame under camera moves. Main
  subjects stay in the centre band, away from where platform captions sit. Ink contrast is measured against what's behind it.
- Harvest rejects captures with error states, broken players, broken images or ads, and crops pages to the headline
  block.

**F. Sound**
- Drop `drone` as a lead bed. Open on real music, keeping the styles Lucas likes (`pulse`, `dread`, `drive`, `reflect`).
- Raise the music level. Find the right level by ear: remix one reel from its existing stems (no Claude API spend) and
  send Lucas 2–3 levels.
- Silence is a deliberate, rare event. Add a code check for long stretches with quiet music.
- Every animated graphic beat gets a sound. Add fire and other specific ambience beds through the importer.

**G. Close**
- Port the AI Brain Break close (white, logo in, handwritten wordmark) with the "Reel AI Drama" wordmark into this kit,
  without editing `explainers/world-kit`. Add one clean transition from the last story frame, with sound and music
  resolving across it.

## Lucas's answers (2026-11-03)

1. A known company may carry a hook: yes.
2. The close question stays spoken over the white close: yes.
3. No Pexels: "new pexels api key issuance is currently paused site-wide. However, all of the systems that we have put in
   place previously for finding images should work easily."

**Correction to "What the code shows":** the missing stock source was not why the fireplace failed. The wish asked for "A
real brick or stone residential fireplace with a mantel, front view, cut out", and `wishWants` searched "brick stone
residential" and "brick stone". The word "fireplace" was never sent. A wish now carries its own query (MD-139).

**Later the same day:**
- Board and newspaper: "You shouldn't require every reel to use the board or the newspaper at least once, you should just give them clear roles!!!!"
- Music: "Use 0.36. Here's the thing: some songs are loud, and some songs are quiet. Some songs have a hard time complementing
  dialogue well, whereas others complement dialogue easily behind it. Additionally, we don't want to use the same songs in
  every single reel, so take all this into account, please, for the music logic." (MD-144)
- Song rotation: "It can span the last four. And one song of the three. For example, if two songs are used, then none of them
  should be repeats from any of the past reels. However, if three or more songs are used, then one of the songs can be a repeat
  from a prior reel. Let's do this to allow the sound designer to use the strongest songs when it needs to." (MD-144)
- Prompts: "be wary of example pollution. Be extremely aware of contradicting instructions or introducing contradicting
  instructions into system prompts. Make sure responsibilities are clearly split, and make sure everything is written at the
  right hierarchyical level of thought." A fresh read-only reviewer checks every prompt across the pipeline for this before the
  iteration is called done.
- Music level, final: "I think the right level is in between 0.26 and 0.36. If you can just put it at 0.31, I think that'll be right." (replaces 0.36)

## First live run (2026-11-03)

"The CEO Who Walked Into Ukraine", job `96e75873-12f4-4c96-848a-15d85beb7c88`, full pipeline: ok, 67.1s, $10.80, 50 min (fix
$3.16, build $2.74, director $1.38, director fix $0.97). Output: `test-runs/iter8-renders/`.

- Worked: formed opening, shot maps in every story frame, white close with fade, music from the first instant, rotation (two
  fresh songs, one allowed repeat), no crash.
- Not exercised: the director made no wishes, so the new image search didn't run; `nk.phoneShot`, `clickReveal`, `burst` and
  `speech` were never picked (`flashReveal` once).
- Open: 49 flags, including `render(0.00)` non-determinism on frames 03, 04, 08, 09; expression strokes across Fedorov's
  forehead; labels stacked on Karp in frame 1; a clipped laptop drawing in frame 7; the first viewer not following the story.

## Lucas's notes on the Ukraine reel (2026-11-03)

- Moves: "I don't think they have to be absolutely used in every reel. The fact that they weren't used here could mean that each reel that we make will be slightly different."
- 0:29: "that photo almost has a seizure. You keep moving to different parts of the photo. For most of the time that we're on the photo, the Mikhailo Fedorov name tag is on, which doesn't make sense because we're talking about all of them... It could have just panned across and pointed at people or named people... should not have tried to jump cut the image. It should have just worked with the image."
- 0:37: "the TIME Magazine animated up in a similar way two times more over. If we're going to use the same image then it's got to be wide, and it's got to have something in particular that it can zoom in on. That can be the second shot, almost like a close-up of the same entity... In general, we want to try to not have to reuse the same asset, but if we're going to reuse the same asset, it needs to be done in a creative manner."
- 0:52: "there's a weird quiet spot. If that was purposeful and you're trying to use silence to emphasize something, it needed to be better timed, and there needed to be some kind of ramp-up before the silence."
- A hand-repaired copy of this reel goes to his dad; it says nothing about the system's quality. Frame 3 and frame 9 stay as they are.

Cause of 0:52: the designer planned a `cut` on "responsible" and a `resume` on "targeting", 1.64s of no music under the line. Its swell peaked 1.1s before the cut, on a word too early for a 3s rise, so no build was heard. The prompt asks for this: "On the biggest reveal, cut the music dead."
