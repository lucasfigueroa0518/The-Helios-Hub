# Iteration 10: repair every visual error at its source

**Status: approved by Lucas 2026-11-04. Build in progress.**

Input: the 158 findings in `test-runs/iter9-final-renders/VISUAL-AUDIT.md`. Each has an id and belongs to one workstream below. That file is the acceptance ledger: this iteration is done when every id is marked fixed, or Lucas has agreed to leave it.

## What Iteration 9 got wrong

The principle stands: the model says what the shot is, and code decides where it goes. It was applied only partly, and five gaps remain:

1. **A model still retypes the plan by hand.** The director's `motion` and `marks` are free text, and a frame worker turns them into code. Things get lost: Apple frame 8's module never creates its highlight. Musk frame 7's worker made the laptop the lead when the director named Musk.
2. **The measurements can be wrong, and bad pictures still count as usable.** Detection called Nosek's coffee cup a face, and the layout protected it. Nothing grades a cutout, so a smear passes as a laptop.
3. **The layout engine covers only some treatments and some items.** Photos, tours, pages, lifts, speech plates and hook words sit outside it. It also re-solves at each arrival, so frames keep reshuffling.
4. **Plan checks exempt the worst cases.** `repeatedPictures` skips character images and cut-outs, so one Musk portrait passed in 6 of 10 frames. A failed picture search silently hands the frame to an unrelated stand-in.
5. **Checks flag problems, then the reel ships.** The integrity check flagged the wrong pictures in Apple frames 2 and 10 before the build, and they shipped anyway. The design review named many of the errors, and repair was another blind guess.

## The new flow

```
pictures measured and cleaned → director plans in structured fields → plan checked and fixed once, before any build
→ code compiles every frame → layout engine places everything → creative pass watches the compiled reel and proposes touches
→ code adds the touches → render → measured checks as the net (a failing touch is removed) → ships, flagged if needed
```

## Workstreams

### P: Honest pictures (15 findings)
Runs at harvest, locally, for free.
- **Faces:** keep a face only if it is confident and the right person. Anything else is never a head.
- **Cutout clean-up:** remove stray islands and old-background fringe, and tighten the edge. Keep the person and drop what's beside them where measured.
- **Cutout grade:** score edge softness, islands, straight cuts and sharpness as clean, rough or rejected. A rejected cut isn't offered as a cutout; the director sees that and picks another picture, or the frame shows a framed print.
- **Open edges:** record which sides of a cutout stop at the image border, so layout can hide them.
- **Sharpness limit:** record the native size of every picture. Code never enlarges past what stays sharp.
- **Duplicates:** a perceptual hash treats near-identical photos as one picture.
- **Brightness and expression:** record how dark a picture is, and the expression from the look step already paid for, so the director can choose by feeling.
- **Logos:** key to transparent where possible. Otherwise use a paper chip in the frame's style.

### L: One layout engine for everything (60 findings)
- **Everything on screen goes through it:** photos, tours, pages, lifts, cards, stats, hook words, speech plates, labels and marks.
- **Plan the final layout first.** Pieces land in their final spots and the camera reveals them. A slide is one named move, limited in distance and size change, and peak frames don't use it (decision 3).
- **New guarantees, added to the random-layout test:**
  - Open edges are off-frame or behind another piece, and bodies never dissolve in mid-air (decision 2).
  - Nothing a marked phrase or subject needs leaves the frame at any point in a camera move. Cameras aim at measured words and faces, never guessed numbers.
  - A wide picture that can't fit full screen without cutting its subject becomes a print.
  - A background picture's subject counts as a keep, so people stand beside it or it gets its own beat first.
  - Words inside a picture stay clear of the caption band.
  - Heads have a maximum size as well as a minimum. People in one frame stay within a set size ratio, except a deliberate inset.
  - The frame's usable area must be filled, so no small card sits on a void. Plain black isn't a ground.
- **Labels:** code sets each label's lifetime, and it leaves after a beat or when the next person arrives. Only a first appearance gets a name. Names sit in clear space beside their owner, or at the outer edge of the body, never on the chest or tie. Dates and places take a free band, never a person.
- **Hook words:** large, in a protected band, by 1.2s.
- **Marks and plates:** expression marks clear the hair and stay clear of plates. Plates never sit on a head, face or chin, and always stay inside the frame.
- **Whole-picture tone:** people in a frame are matched in colour and tone, with one outline weight and no glow.

### C: Compile, don't retype (14 findings, and it stops new ones)
- The director's `motion` and `marks` become structured fields: who and what, who leads at each beat, which side, order of arrival by spoken word, what each label belongs to, each mark and its target, the camera move by name.
- Code compiles each frame from those fields, so a planned mark or move can't be dropped (decision 1).
- The kit gains the moves workers had to hand-write: a ground that brightens or darkens, marker notes that write in turn, a piece placed on a named spot in a picture, and a crop.
- The plan check catches a planned drawing that doesn't exist and gets it made before the build.
- A check compares the rendered frame with the plan: every planned piece, label, mark and move must appear on its word. A miss triggers one rebuild, then a flag.
- Timed beats are held long enough to read, so a number isn't gone as it lands.

### X: Creative pass (decision 1)
Runs once per reel, after compile, and sees the compiled reel as pictures plus the script. It can only add. It can't move, change or remove anything code built.
- **Simple touches, with no new code:** an extra line, words written in turn, closer cuts instead of one push. At most three per reel.
- **Custom pieces, in small code:** a new picture or move, inside a box code assigns, touching nothing else. At most two per reel. A custom move Lucas likes is added to the kit for every reel.
- **None are required.** Each touch must make its line clearer or make it hit harder. A reel that needs none gets none.
- **Failure:** a touch that breaks a check is removed, the frame falls back to its compiled version, the reel still ships, and the dropped touch is flagged on delivery.

### D: A director's plan that shows the story (28 findings)
All checked at plan stage, where a fix is cheapest. One fix round, then a flag, so nothing blocks a reel.
- **Repetition:** one picture of a person appears at most three times in a reel and never in adjacent frames, counting near-duplicates and cutouts. Consecutive frames can't reuse the same cast in the same arrangement. Harvest supplies more photos per main person.
- **Feeling:** pick the picture by the beat's feeling, using the recorded expression and brightness.
- **Named things are shown:** every person, company and product the line names gets a beat with a real picture or logo. Cast logos are collected automatically at harvest.
- **Places:** a line that names a place gets that place, as a real picture or a built scene, never a plain ground.
- **Failed searches:** a stand-in must show what the shot says, and is never used just because it was found. When a key picture can't be found, the director first rebuilds the frame's message from the real pictures it has. Only when the frame can't communicate its message with real images does it become drawn or code-built from verified words (decision 4). The plan check catches this before any build.
- **Integrity findings get acted on:** a wrong-picture finding goes back to the director once before the build. The check also reads the shot map, so it stops false alarms like a line's label judged against the frame's first picture, and it checks a picture's visible words against the story's date.

### B: Whiteboards that explain (27 findings)
- **Size by importance:** the person the line is about is largest, and a key figure is big. Notes have a role (figure, place, date) that sets their size.
- **Relationships:** arrangements show how things relate, such as facing, turning away, or leading to, not a grid.
- **Arrows:** computed between the two real items, with a minimum length, and spacing makes room for them.
- **Collisions:** drawings, notes and marks go through the layout engine.
- **Clean drawing:** remove the fixed stains from the board, draw logos cleanly instead of with a smudgy hatch, and let the first item draw in, except in frame 1.
- **Fill the board:** use the whole usable area.

### K: Kit defects (14 findings)
- **Lift:** no ghost head (the original spot gets covered) and no dimming of the frame.
- **Captions:** keep one bright colour throughout, with a new check for dimming.
- **Credits:** one per picture on screen, never stacked, and never lost on a body.
- **Cards and prints:** a page or article is never keyed to bare text, one picture can't be repeated within a stage, and plates fit their words.
- **Handwriting:** switch to a face that keeps every letter clear.
- **Backdrops:** blur and darkening stop short of erasing the place.
- **Black-and-white pictures:** matched to the frame's other pictures, or not placed on a colour ground.

## Build order

1. **P** first, since everything reads its measurements.
2. **L**, with the new guarantees added to the random-layout test.
3. **C** and the structured plan fields.
4. **B** and **K**, which can run alongside L and C.
5. **D**, the plan checks and prompt edits. Claude writes the prompts and reviews each for altitude, examples, contradictions, ownership and strength.

Build uses about three or four agents, each owning its own files, with a shared contract written first. Rough time: half a day. That's an estimate, and visual testing is the part most likely to run over.

## Proof

**Free, with no API calls:**
- Every ledger finding that can be measured becomes a test or a check.
- The new checks must fire on the current renders and stay quiet on the replays.
- Convert the saved Musk and Apple plans to the new fields and compile both whole reels with existing assets and voice. This shows every frame, not a hand-picked set.
- Claude audits the replays frame by frame and updates the ledger.

**Needs Lucas's go-ahead:**
- Findings that depend on new picture choices (most of D) can only be proved by re-running the director: about $2–4 for both stories.
- Then one full live reel. Rough cost: $6.50–8, if the hybrid costs about $0.50–1 in place of today's $2 build and $1.40–1.70 fix. The creative pass calls the model, so it's first seen in this reel or in a paid test of about $0.50 on the saved plans, with Lucas's go-ahead.

Lucas's own viewing stays the final test. Commits and VM deploys wait for his approval.

## Decisions for Lucas

1. **Frame workers are replaced by a hybrid.** Decided by Lucas: yes (2026-11-04). Code compiles every frame, then one creative pass per reel adds at most three simple touches and two custom pieces, none required. Custom code is allowed from day one. This decision followed a review of the last five reels: `test-runs/worker-creativity/`.
2. **Bodies run off the bottom of the frame instead of fading out.** Decided by Lucas: yes (2026-11-04).
3. **Pieces hold their final spots and the camera reveals them, with one limited slide available.** Decided by Lucas: yes (2026-11-04).
4. **A missing key picture.** Decided by Lucas (2026-11-04): "If a key picture can't be found and the slide is weak on content aside from the key picture (to the point where the overall message isn't communicable with real images), then it should become drawn or code-built." Anything recreated reads clearly as made, never passed off as the real page.
