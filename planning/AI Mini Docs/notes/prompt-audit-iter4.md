# Prompt audit, iteration 4 (Reel AI Drama)

Date: 2026-11-02. Read-only audit. No files edited, no model or network calls.

## What each role reads together (from `lib/reel-ai-drama/prompts.ts` and the call sites)

| Role | System prompt, in order |
|---|---|
| Spine writer | `spine-writer.md` + `plot-craft.md` + `writer-craft.md` |
| Writer / writer-revise | `writer.md` (or `writer-revise.md`) + `writer-craft.md` + `plot-craft.md` |
| Story editor | `story-editor.md` + `plot-craft.md` + `writer-craft.md` |
| Director | `director.md` + `director-craft.md` + the whole `writer-craft.md` + `kit/FRAME.md` |
| Build session | `build-workflow.md` (laid over faceless-explainer SKILL.md); it reads `kit/FRAME.md` + `STORYBOARD.md` |
| Frame worker | `frame-worker.md` (it **replaces** the Explainer frame-worker prompt in `production/agents.ts`); it reads `kit/FRAME.md`, the storyboard section, timing, inventory |
| Fix | `fix.md` + `kit/FRAME.md` |
| Checks | `first-viewer.md`, `integrity.md`, `visuals-look.md`, `harvest-look.md`, each alone |
| Others | `producer.md` (+ player list), `reporting.md`, `post-text.md`, `sound-designer.md` (+ library) |

`skill-overrides/hyperframes/references/frame-worker-core.md` and `director/scene-builder.md` do **not** reach these roles. The frame-worker prompt is replaced wholesale, the scene-builder agent is deleted, and its skill folder is removed (`render/workspace.ts:115`, `production/agents.ts:25-38`). The drama frame workers are dispatched with their own message, not packets, so `frame-packets` (the only loader of frame-worker-core) never runs. `presets/reel-ai-drama/FRAME.md` is tokens only; `caption-skin.html` has no prompt prose.

Code-level prompt prose that matters here: `lib/reel-ai-drama/render/make.ts:47-65` (image-model briefs for drawn makes) and `harvest/sketch.ts:24`.

Counts: **12 must-fix, 19 should-fix, 9 nits.**

---

## Must-fix

**M1. The join rule produces joins that don't follow.**
- `craft/plot-craft.md:25`: "a *therefore* likewise (so, which is why, as a result, that's why, forcing)"
- `prompts/writer.md:104-105`: "joined to the last by a "but" or "therefore" turn, in varied words?"
- `craft/writer-craft.md:57`: "Join beats with a "but" or a "therefore" turn, never "and then", in varied words"
- Problem: the writer's checklist asks for a spoken connective on every rung, "in varied words", and the plot craft supplies a list to rotate through. Plot-craft's "or with no connective when the cause is plain" is lost. Evidence: the latest Rosewood script says "As a result, Musk becomes central to winning him" with no cause stated before it, plus "So they gather…" and "Yet Dario Amodei…". MD-88 itself names "as a result", so the new requirement amends MD-88.
- Direction: a spoken connective only when the line before it states the cause or obstacle. Drop the rotation list and "in varied words" from the writer's checklist. Log an MD that amends MD-88.

**M2. Nothing establishes the time frame, and several rules push against it.**
- `craft/writer-craft.md:352`: "Use the present tense for immediacy where it fits"
- `craft/writer-craft.md:354`: "Re-live events rather than look back on them"
- `craft/writer-craft.md:43`: "Events are told as they happen, never as someone "later" recalled them."
- `craft/writer-craft.md:411`: "Front-load background or the five Ws; it delays the hook"
- `craft/writer-craft.md:269` / `:307` and `prompts/writer.md:41-42`: dates go to `on_screen` labels, "not in sentences".
- Problem: present tense, no "when", and dates kept out of the narration. The viewer hears "Elon Musk wants Google's own researcher…" as present-day news. The latest Rosewood script has no year; an earlier draft opened "Summer 2015." No HARD rule requires the "when" anywhere (spine, writer, story editor, first viewer).
- Direction: add a writer HARD rule that the first rung after the hook speaks the when (year or period), with its date label. Have the spine record `when` for the point of attack. Exempt "when" from the five-Ws "Don't".

**M3. Every line must turn a value, so scene-setting can't exist.**
- `craft/plot-craft.md:28-29`: "A new fact that changes nothing is not a beat."
- `craft/writer-craft.md:23-25`: "a new fact that changes nothing doesn't count"
- `craft/plot-craft.md:55`: "Backstory: one line at most, only where a beat needs it."
- `craft/plot-craft.md:130`: "Withhold, don't explain"
- `craft/plot-craft.md:273`: "Exposition dump | Context stops the train | … or cut it."
- `craft/writer-craft.md:79`, `:143`, `:196-197`: "cut the background"; "Keep only the backstory the turn requires"
- `prompts/spine-writer.md:82`: "a sentence that only adds a fact is not a sentence of the spine"
- Problem: the new requirement wants full exposition of who is present and the context before the action. The plot and writer crafts treat that exposition as a fault, and the story editor's table repairs it by cutting.
- Direction: define an "establishing" part (where, when, who is present, how they relate) that is exempt from the value-turn test and placed right after the hook. Rename the "exposition dump" fault to context that arrives after the action needs it.

**M4. The voice direction contradicts itself, and the code gives TTS no direction.**
- `craft/writer-craft.md:282-283`: "a calm, close documentary narrator who … doesn't perform over it"
- `craft/writer-craft.md:371`: "Pitch the emotion at high arousal where the facts allow"
- `craft/writer-craft.md:256`, `:276`, `:278`, `:259`: "Land the climactic idea in the shortest sentence"; "a full stop for a beat"; "give it its own short sentence"; "Allow fragments"
- Problem: short sentences, fragments and full stops used as beats make the voice choppy and staccato. That reads as performance, not storytelling (e.g. "At the table: Greg Brockman… And Ilya Sutskever…"). Code: `render/voice.ts:31` passes no `--speed` or `--style` (audio.mjs defaults to `speed 1.0`), and each frame is a separate HeyGen clip read cold.
- Direction: replace the punctuation micro-rules with one principle: write connected, conversational sentences a storyteller would say in one breath. Drop the "high arousal" pitch. Consider voicing whole rungs per clip, plus a speed setting.

**M5. Pace settings and craft add slowness the pause cap doesn't catch.**
- `craft/writer-craft.md:37-38`: "Budget about 140–170 narrated words for 60 seconds, leaving room for two or three short picture beats"
- `craft/writer-craft.md:25`: "8 seconds is about 22 spoken words" (≈165 wpm baked in)
- `craft/writer-craft.md:164`: "Bring a new image in first and let it land for a moment, then name it."
- `craft/writer-craft.md:276-277`: "the longest pause belongs before a reveal"
- `kit/pace.mjs:61-63`: `PAUSE_MAX = 1`, `SILENT_BEAT = { min: 0.6, max: 4 }`
- `kit/pace.mjs:69-71`: the comment says the opener runs at 1.2×; `OPENER_TEMPO = 1`.
- `prompts/sound-designer.md:64-65`: "1–2 silences" per 60s (these need voice pauses).
- Problem: the inter-word gaps are already tight (0.15/0.2s, MD-58). The slowness comes from the word budget (~150 wpm with pauses), the picture beats, the "let it land" rule, silent beats of up to 4s, and the TTS speed of 1.0.
- Direction: raise the word budget to the caption ceiling (about 170–185 words for 60s) and allow one picture beat at most. Cap silent beats near 1s, and expose voice speed as a setting.

**M6. Face placement contradicts itself and pushes subjects to the bottom.**
- `kit/FRAME.md:76`: "keep it in the upper third of the frame and out of the caption band"
- `prompts/frame-worker.md:45`: "A face sits in the upper third of the frame and out of the caption band"
- `kit/FRAME.md:23,33`: caption keep-out is y 260–560.
- Problem: the upper third is y 0–640, and almost all of it is the Reels header plus the caption keep-out, so the rule can't be met. The defaults then put people low: `cutoutLift` bottom 180 with height 1440 (`treatments.js:152`), seeded seats at baseline y 1250–1560 with x 150/890/930 (`kit/settings/index.js:39-153`), lower third y 1300, number y 1130. `director.md:89` "Ground everything", plus "never floating" (`frame-worker.md:46`), adds to this.
- Direction: a single placement rule that the subject's visual centre sits at about y 800–1100 in the centre column, faces just below the caption band. Move the defaults and seats to match.

**M7. One look per person per reel is blocked; variety is mandated.**
- `prompts/director.md:77-83`: "each time in a different treatment … another print (a halftone in a collage, on a screen)"
- `prompts/director.md:215-216` (HARD 9): "no person is shown the same way … in more than two of their appearances"
- `prompts/director.md:217-219` (HARD 10): "One medium for the people in a frame." (frame-level only)
- `craft/director-craft.md:98`: "Match the visual style to the subject"
- Problem: the rules require each person to look different across frames: halftone, cutout, drawn sketch, photo grades (`cool`, `warm`, `mono`, `archival`), and per-treatment filters (collision `grayscale(.3)`, `treatments.js:187`). The new requirement is one visual style for all people in the reel. MD-60 and MD-69 need amending.
- Direction: add a reel-level HARD rule that the director picks one people style per reel (e.g. cutout + one grade) and every person appearance uses it. Variety comes from scale, pose and staging, not medium.

**M8. Stat beats are static cards over a photo.**
- `kit/FRAME.md:163-168`: "A `number` frame renders over the frame's first asset, built as a `photo`"
- `craft/director-craft.md:82`: "`number` — one big figure in Helios type, over the frame's first asset."
- `craft/director-craft.md:222`: "Show each key number as one large figure paired with an image, one number per screen."
- Problem: the kit's only number vocabulary is a figure with a 0.7s count-up placed on a photo. There is no animated graphic (bar, scale, comparison, accumulation), and `writer.md:60-61` limits on-screen words to labels.
- Direction: add a `stat` treatment family (animated bar, counter, scale comparison) built in code. The director picks it for a number beat; "over a photo" becomes one option, not the definition.

**M9. Drawn elements get white boxes.**
- `lib/reel-ai-drama/render/make.ts:47,51,65`: "on a plain white background"
- `kit/FRAME.md:210-212`: "its white paper drops out on a whiteboard or paper ground"
- Problem: drawings and collage elements are generated on white. White is removed only by `multiply`, and only on a white or paper ground. On kraft, charcoal, a photo or a dark ground, collage layers (no blend in `collage()`) and drawn sketches show a white rectangle. FRAME.md never tells workers to remove it.
- Direction: background-remove every made drawing and collage element at make time (transparent PNG, like the cutouts), and state in FRAME.md that a drawn element never shows its paper.

**M10. Creative manipulation of the source is forbidden or has no tool.**
- `craft/director-craft.md:250-251`: "Never add, remove, move or clone anything inside a photo's scene"
- `prompts/frame-worker.md:23-24`: "Adding, removing, moving or cloning anything inside a photo's scene is forbidden"
- `craft/director-craft.md:68-69`: "never a board with photos pinned to it"
- `craft/director-craft.md:207`: "Keep graphics restrained in style"
- `kit/FRAME.md:254`: "No bounce, no spin, no decorative float"
- `kit/FRAME.md:111`: `cutout` is "the person's banked character cutout" only
- Problem: the owner wants a person cut out of an article and animated scrapbook-style, with sound and markups. The ethics rules don't separate editing the evidence from lifting a piece out as a visible collage. The kit can only lift a banked cutout, not a figure from a page, post or headline. `lower_third` and `number` are defined as overlays stacked on a photo.
- Direction: add an explicit "lift from the artifact" treatment (a page or article with its photo cut out and animated off it, the original left visible). Reword the ethics rules to "never alter what the evidence shows; visible lifting and collage are allowed". Loosen "restrained" for code-built graphics.

**M11. The checker loop can't repair script confusion.**
- `prompts/fix.md:18-19`: "Picture only. The script is locked and the voice is recorded"
- `prompts/fix.md:9-11`: the fix receives first-viewer findings ("the story wasn't understood")
- Problem: the first viewer catches confusion that starts in the words (no year, who is who, joins that don't follow). It is routed to a picture-only fixer, so it can't be fixed after the voice is recorded. Before the voice, `story-editor.md:26-27` caps at three faults and puts line faults last.
- Direction: add a script-level comprehension pass before the voice (story editor or a cheap first-viewer-on-text) that checks when, who is present, motive-before-act and joins. Route script findings to warnings, not the picture fixer.

**M12. Name and role: spoken or label? The rules disagree.**
- `prompts/writer.md:37-38`: "Introduce every person at their first appearance … name and role together"
- `craft/writer-craft.md:307-308`: "Put names, roles, places, dates and sources in short labels (`on_screen`) … not in sentences."
- `craft/writer-craft.md:269-270`, `:315`: "Hand exact figures, full names, titles, dates and places to the screen"; "When the narrator and a label would say the same thing, cut one."
- Problem: the writer, spine and story editor require a spoken introduction; the craft says roles, places and dates go to labels and duplicates get cut. The sound-on viewer loses who and where, which is exactly what the new exposition requirement needs.
- Direction: narration says the name, the role in plain words, and the when and where; labels add exact titles, dates and figures. Delete "not in sentences".

---

## Should-fix

**S1. The motive rule covers only the opposition.**
- `craft/plot-craft.md:100`: "Make the opposition's motive known before it acts"
- `prompts/spine-writer.md:86`: HARD 7, opposition only.
- `craft/plot-craft.md:136-137`: "A named person who isn't central gets their introduction and their one act"
- Problem: anyone else can act without a stated motive (e.g. "Yet Dario Amodei … weighs joining").
- Direction: generalize: any act that depends on a motive gets the motive in the same or the previous line, for every person.

**S2. Nothing asks for relative positioning.**
- `prompts/reporting.md:45-46,67`: places carry `{ name, address, lat, lon, role }` and no relation to each other or to the cast.
- `kit/FRAME.md:144-148` / `craft/director-craft.md:164`: "Maps look printed, with one pin and one Helios label"
- Problem: no role records or writes where, when or who relative to whom. The map can't show two places relative to each other.
- Direction: the reporter records relations (near, across, same day, rival of), the writer places each new part relative to one already set, and the map allows two pins with a relation.

**S3. The story editor's cap drops the new requirements.**
- `prompts/story-editor.md:26-27`: "Record at most three serious faults … note line-level faults (step 8) only if there is room"
- `craft/plot-craft.md:255`: "Attribution, devices, pace, the ear. Cheap; fix only after 1–7."
- Problem: time frame, joins and positioning are steps 5 and 8, so they are routinely dropped.
- Direction: make "when, who is present, motive before act, joins follow" an always-checked list beside the ranked diagnosis.

**S4. The pause count disagrees between files.**
- `prompts/writer.md:66-67`: "Use it once or twice at most."
- `craft/writer-craft.md:38`: "two or three short picture beats"
- Problem: same role, two counts.
- Direction: one count, in the craft only (and lower, per M5).

**S5. A quote-reading pause can't fit in 1 second.**
- `craft/writer-craft.md:309-311`: "give the line a `pause_after` so the viewer can read it, rather than reading it aloud"
- `kit/pace.mjs:61`: `PAUSE_MAX = 1`
- Problem: a verbatim quote can't be read in ≤1s; either it goes unread or pressure to slow builds.
- Direction: the narrator reads short quotes aloud while the words show; mark only long ones.

**S6. The director carries the whole writer craft.**
- `lib/reel-ai-drama/prompts.ts:76-80`: the director gets all 419 lines of `writer-craft.md`, including "a draft that breaks one is wrong" and ear rules.
- Problem: the wrong altitude for the director, and it adds conflicting craft (labels, tense).
- Direction: split structure and timing into a short shared file; the director reads that.

**S7. The same rule lives in several layers.**

Each line below names the layer that should own the rule:
- Hook ≤1.5s: writer-craft HARD 1, director-craft HARD 1, FRAME.md Motion, writer.md. Owner: writer-craft (words) and director-craft (picture). FRAME.md keeps only the mechanics.
- Something new every 8s: writer-craft HARD 2, director-craft HARD 2, director.md:33, FRAME.md:249. Owner: writer-craft; director-craft points to it.
- One image, one job: director-craft HARD 4, director.md step 5, FRAME.md:25-27, integrity.md:17-20. Owner: director-craft.
- One medium per frame: director.md HARD 10, director-craft §3, FRAME.md:212-214. Owner: director.md.
- Marks on target: director-craft §4, director.md:150-152, frame-worker HARD 4, FRAME.md Marks. Owner: FRAME.md.
- Never change a photo: director-craft §9, frame-worker HARD 2, fix HARD 3. Owner: director-craft.
- Sound must not imply events: director.md:153-154, director-craft §8, FRAME.md:271-273, frame-worker HARD 10. Owner: FRAME.md.
- Join rule: plot-craft Core 3 says "the one home", but it is restated in writer-craft:57, writer.md:104, spine:35, and story-editor HARD 2. Owner: plot-craft.
- Larger forces: plot-craft:67-69 says "the one home", but it is restated in writer-craft:65-66 and :136-140. Owner: plot-craft.
- Introduce before act: plot-craft Core 5 and §5, writer.md step 4, HARD 8 and checklist, spine HARD 6, story-editor HARD 4, writer-craft:345. Owner: plot-craft.
- Close question: writer.md HARD 6, writer-craft HARD 4 and §5, plot-craft §8, spine step 7. Owner: plot-craft.

**S8. The writer craft is too granular.**
- `craft/writer-craft.md:148-190`: the 17 curiosity bullets are near-duplicates ("Open a gap", "Prime it", "Release in stages", "Keep raising", "Re-hook", "Escalate"…). §6-§7 hold about 40 micro-rules; research ids appear on nearly every line.
- Problem: the wrong altitude. Rules this granular invite mechanical compliance (staccato sentences, forced joins).
- Direction: collapse each section to 3-5 principles. Move the research ids to a footnote table.

**S9. The plot craft forces mechanical alternation.**
- `craft/plot-craft.md:120`: "Alternate the turns: a *but* against the want, then a *therefore* in response"
- `prompts/spine-writer.md:95`: "is it *but, therefore, but, therefore*"
- Problem: too narrow; it pushes a fixed rhythm the writer then voices.
- Direction: "mix buts and therefores; never a run of either".

**S10. The Snow example teaches away from opening on a date.**
- `craft/plot-craft.md:210`: "*A topic, not a plot:* "In 1854 cholera struck London."
- Problem: the only example in the craft opens on a year and labels it the bad version.
- Direction: keep the date in the good version (e.g. a world sentence carrying the time) or note that the fault is the missing want, not the date.

**S11. FRAME.md's example leaks specifics.**
- `kit/FRAME.md:56`: `value: '$4M', label: 'then the board met.'`
- `kit/FRAME.md:67`: `/founder/i`
- Problem: a concrete figure, a story phrase and "founder" in the one code example every frame worker reads.
- Direction: neutral placeholders (`value: ctx…label`, `/<cue word>/i`), marked as illustrative.

**S12. An unmarked sample sentence.**
- `craft/writer-craft.md:93`: "Signpost the rewind in words ("Six weeks earlier…")"
- Problem: an unmarked sample sentence; likely to be copied verbatim.
- Direction: describe the move ("name how far back") without a sample phrase.

**S13. Marks placed by eye contradict the "never coordinates" rule.**
- `kit/FRAME.md:231-232`: "drawn from that thing's measured box, never placed at coordinates"
- `kit/FRAME.md:237-239`: "`nk.markTarget(doc, holder, { x, y, w, h })`, in 0–1 of the element"
- `kit/FRAME.md:217`: expression marks take "the face's box in the coordinates of the layer you append to"
- Problem: picture details and expression marks are placed by eye, in hand-converted coordinates, which is the misalignment source.
- Direction: targets come from measured boxes (`media.face`, harvest boxes, or a vision box step); the kit converts layer coordinates itself.

**S14. The "later recalled" ban strains accuracy.**
- `craft/writer-craft.md:43`: "Events are told as they happen, never as someone "later" recalled them."
- Problem: a single-source recollection (testimony, a memoir) gets told as plain fact in present tense, which clashes with `writer-craft.md:356` (fact vs allegation). This is craft written as a HARD rule.
- Direction: move it to craft. Allow "X said" once where the only source is a recollection.

**S15. A present-day portrait passes the image check.**
- `prompts/integrity.md:12-13`: "A recent portrait of a person while the line speaks about that person in general matches."
- Problem: a 2025 portrait over a 2015 story undercuts the time frame.
- Direction: prefer period-matching photos when the line is set in a dated moment; flag a present-day face in a dated beat as `unsure`.

**S16. The first viewer is never asked "when".**
- `prompts/first-viewer.md:23-28`
- Problem: no question about when it happened, who was there, or why someone acted.
- Direction: add: "When and where did this happen? Who was there? Did anyone act without a reason you'd been given?"

**S17. The text budget blocks a date label in frame 1.**
- `craft/director-craft.md:211`: "Limit each frame to the captions plus one other text element"
- `prompts/director.md:196`: frame 1's `on_screen` is the hook's words.
- Problem: the hook's words fill frame 1's one text slot, so L1's date label (the time frame) can't show there.
- Direction: allow the hook words plus a small date label in the opening frame.

**S18. Opening-frame guidance conflicts.**
- `craft/director-craft.md:190` "Open on the most arresting real artifact" vs `:135` "Put a human face in the first frame"
- Problem: a soft always-vs-always conflict on the same frame; the second also clashes with `:197`, "Delay a headline image".
- Direction: one opening rule: the image that carries the hook's question.

**S19. The staging table narrows to the seeded settings.**
- `prompts/director.md:56`: "a meal, a meeting, a call, a hearing, a stage"
- Problem: the tableau list mirrors the five seeded settings, which narrows staging to the seeds (the dinner-table reels).
- Direction: describe the job ("people together in one place") and leave the seeds to FRAME.md.

---

## Nits

- N1. `prompts/sound-designer.md:58-59`: "one recurring stinger at one structural spot (the title, or the turn)". There is no title (MD-13). Say "the turn".
- N2. `kit/FRAME.md:282`: "a tense documentary bed" vs `sound-designer.md:47`, "a release or a reflective close". Let the sound designer own the mood.
- N3. `craft/writer-craft.md:210`: "Don't open with … a quotation" vs the engine at `:98`, "Mystery artifact. Open on a document, message". Exempt the artifact engine.
- N4. `prompts/writer.md:74`: `{ "word": "Nguyen", "say": "win" }`. Marked illustrative, but it is a real surname; use a placeholder.
- N5. `prompts/harvest-look.md:15` and `visuals-look.md:27`: sample descriptions ("a woman at a lectern…"). Fine and marked; keep them generic.
- N6. `kit/FRAME.md:334-335`: "sit on a plate … `light`, ink on a paper plate". A paper plate over a photo reads as a white box; prefer dark plates or shadow.
- N7. `craft/director-craft.md:173` ("a new visual every 2–3 seconds") vs `:111` ("Let key images hold"). The soft tension is resolved at `:115`; one sentence would do.
- N8. `kit/pace.mjs:69-70`: the comment claims a 1.2× opener; the code sets `OPENER_TEMPO = 1`. Fix the comment or the value.
- N9. `craft/writer-craft.md:6`: "a cloned documentary voice". "Documentary" primes newsreader delivery; "storyteller" fits the new direction.

---

## Blocks the new requirements

### 1. Opens on a hook
Mostly supported (writer-craft HARD 1, director-craft HARD 1, sound-designer HARD 7). The blockers are indirect:
- `plot-craft.md:88-90`: "question and protagonist in the first seconds; inciting incident by about 8s". With M3's establishing beat, the windows need room.
- `director-craft.md:190` vs `:135`: the soft conflict over what frame 1 shows (S18).

### 2. The opening establishes the time frame
- `writer-craft.md:352`: present tense for immediacy (M2)
- `writer-craft.md:354`: re-live, don't look back (M2)
- `writer-craft.md:43`: never "later" (M2, S14)
- `writer-craft.md:411`: "Front-load background or the five Ws" (M2)
- `writer-craft.md:269,307` and `writer.md:41-42`: dates go to labels, not sentences (M2, M12)
- `director-craft.md:211`: the frame-1 text budget (S17)
- `plot-craft.md:210`: the 1854 example taught as the bad version (S10)
- `integrity.md:12-13`: a present-day portrait passes (S15)
- `first-viewer.md`: never asks when (S16)
- No HARD rule anywhere requires it (spine, writer, story editor).

### 3. Story parts positioned relative to each other
- No line asks for it. `reporting.md:45-46` has no relation fields. `writer-craft.md:270` says "a map beats a described location". `FRAME.md:144-148` and `director-craft.md:164` allow one pin per map (S2).
- `writer.md:37-39` introduces by name and role only, never relative to someone already set.

### 4. Exhaustive scene-setting exposition
- `plot-craft.md:28-29`, `writer-craft.md:23-25`, `spine-writer.md:82`: a fact that turns nothing isn't a beat (M3)
- `plot-craft.md:49`: "Enter as late as the question allows"
- `plot-craft.md:55`: backstory one line at most
- `plot-craft.md:128-130`: just in time; "Withhold, don't explain"
- `plot-craft.md:273`: exposition dump → "cut it"
- `writer-craft.md:79`, `:143-144`, `:196-197`, `:411`: one fact of backstory; cut the background; don't front-load
- `writer-craft.md:307`, `:315`: who and where go to labels; cut the duplicate (M12)

### 5. Motive stated before the dependent action
- `plot-craft.md:100` and `spine-writer.md:86`: opposition only (S1)
- `plot-craft.md:136-137`: a peripheral person gets "their one act" with no motive (S1)
- `writer.md:38`: "for a central person what they want". Non-central people are exempt.

### 6. Joins follow from what was just said
- `plot-craft.md:25`: the connective list including "as a result" (M1; amends MD-88)
- `writer.md:104-105` and `writer-craft.md:57`: "in varied words" (M1)
- `plot-craft.md:120` and `spine-writer.md:95`: mechanical but/therefore alternation (S9)
- `plot-craft.md:195`: "Every join *but* / *therefore*". Fine for the spine, but it is read as a spoken requirement.
- `story-editor.md:26-27` and `plot-craft.md:255`: line-level faults come last and are capped (S3)

### 7. Pace: too slow
- `writer-craft.md:37-38`: 140–170 words / 60s, and 2–3 picture beats (M5, S4)
- `writer-craft.md:25`: 22 words per 8s
- `writer-craft.md:164`: "let it land for a moment, then name it"
- `writer-craft.md:276-279`: the longest pause before a reveal; slow down on the hinge fact
- `writer-craft.md:294-295`: "Don't fill every second with words"
- `writer-craft.md:309-311`: a pause to read quotes (S5)
- `director-craft.md:111`, `:174`: let key images hold; slow the visual rate when content is intense
- `kit/pace.mjs:61` `PAUSE_MAX = 1`; `:63` `SILENT_BEAT` up to 4s; `:71` `OPENER_TEMPO = 1`
- `sound-designer.md:64-65`: 1–2 silences, which need pauses
- `render/voice.ts:31`: no speed passed; audio.mjs defaults to `speed 1.0`
- `settings.ts:75-78`: target 60 / max 75. The gaps (`INNER_GAP 0.15`, `SENTENCE_GAP 0.2`, `HOLD 0.13`) are already tight; they are not the cause.

### 8. Natural storyteller voice, not performative
- `writer-craft.md:371`: high arousal (M4)
- `writer-craft.md:256`, `:259`, `:276`, `:278`, `:280-281`: shortest sentence; fragments; a full stop for a beat; own short sentence; vary the shape so the pitch varies (M4)
- `writer-craft.md:6`: "a cloned documentary voice" (N9)
- `sound-designer.md:5-6`, `FRAME.md:282`: "tension from the first frame"; "a tense documentary bed" (a tense bed under the voice adds to the sense of performance)
- `render/voice.ts:22-31`: HeyGen clips per frame, no style or speed; short frames ("Sam Altman wants to start an AI lab too.") are voiced in isolation.

### 9. Visuals
**Creative manipulation of the source (scrapbook lift-outs, not photos stacked on articles):**
- `director-craft.md:250-251`; `frame-worker.md:23-24` (M10)
- `director-craft.md:68-69`: "never a board with photos pinned"
- `director-craft.md:207`: "restrained"
- `FRAME.md:254`: no bounce or float
- `FRAME.md:111`: banked cutout only
- `FRAME.md:160-161,167`: `lower_third` and `number` are "over the frame's first asset" (stacking by definition)

**Numbers and stats as animated graphics:**
- `FRAME.md:163-168`; `director-craft.md:82`, `:222` (M8)
- `writer.md:60-61`: no words beyond labels, so no axis or comparison text
- `writer-craft.md:410`: "make the viewer compare figures" is banned; this blocks comparison graphics.

**People share one visual style:**
- `director.md:77-83`; HARD 9 `:215-216`; HARD 10 frame-level only `:217-219` (M7)
- `director-craft.md:98`, `:140-142`: match style to subject; vary with more photos
- `FRAME.md:101` (per-frame grades), `:204` (halftone), `:209-214` (drawn people allowed in all-drawn frames)
- `treatments.js:152,187`: different filters per treatment
- MD-60 and MD-69 need amending.

**Drawn elements without a white box:**
- `make.ts:47,51,65` and `harvest/sketch.ts:24`: plain white backgrounds (M9)
- `FRAME.md:210-212`: white drops out only on whiteboard or paper
- `FRAME.md:199-207`: collage layers have no blend
- `FRAME.md:334-335`: light plates (N6)

**Marks align with targets:**
- `FRAME.md:237-239`: `markTarget` boxes typed by eye
- `FRAME.md:217`: expression-mark face box in hand-converted layer coordinates (S13)
- `FRAME.md:129-130`: page `tilt`/`push`/`fit` transforms (the kit must carry boxes through them; worth a check)

**Subjects centred, not at the bottom:**
- `FRAME.md:76` and `frame-worker.md:45`: the "upper third" that can't be met (M6)
- `director.md:89`, `frame-worker.md:46`: ground everything; never floating
- Defaults that place subjects low: `treatments.js:152` cutoutLift bottom 180; `kit/settings/index.js:39-153` seat baselines y 1250–1560 (`stage-left`/`stage-right` y 1560, `witness` y 1520), x 150–930; `FRAME.md:159` lower third y 1300; `FRAME.md:166` number y 1130.
- `director-craft.md:204` says "centre column" (horizontal only).
