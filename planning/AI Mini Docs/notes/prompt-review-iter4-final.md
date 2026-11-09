# Prompt review — Reel AI Drama, iteration 4 (final pass)

Read-only review, 2026-11-02. Scope: `explainers/reel-ai-drama/prompts/*.md`, `craft/*.md`, `kit/FRAME.md`,
checked against MD-90–MD-99. Bundles (from `lib/reel-ai-drama/prompts.ts`):

| Role | System prompt it gets |
|---|---|
| spine writer | spine-writer + plot-craft + writer-craft (`prompts.ts:65`) |
| writer / writer-revise | writer(-revise) + writer-craft + plot-craft (`prompts.ts:60`) |
| story editor | story-editor + plot-craft + writer-craft (`prompts.ts:70`) |
| director | director + director-craft + story-timing + FRAME.md (`prompts.ts:77-83`) |
| frame worker / build session / fix | frame-worker / build-workflow / fix, and read FRAME.md from the workspace |
| first viewer, integrity, producer, reporting, sound designer, harvest-look, visuals-look, post-text | their own prompt only |

**Counts:** 5 must-fix, 19 should-fix, 14 nits (plus 6 repeats and 5 dangling pointers, cross-listed where ranked).

---

## Must-fix

1. **The words roles never get the story timing, yet are told it binds them.** No story-timing in
   `writerSystem`, `spineSystem` or `storyEditorSystem` (`prompts.ts:60,65,70`). It is still cited as binding:
   - spine-writer.md:6 "the plot craft (`plot-craft.md`), the story timing (the reel's parts and clock)"
   - writer.md:7 "the writer's craft, the plot craft and the story timing"
   - writer-revise.md:4 "(the writer's craft, the plot craft and the story timing)"
   - story-editor.md:9 "the story timing and the writer's craft follow it too"
   - story-timing.md:3-4 "shared by … the spine writer, the writer and the story editor"
   - writer-craft.md:19 "The hook line (`L1`) carries what the story timing's HARD 1 requires"
   - writer.md:68 "the one silent beat a reel may have (story timing HARD 5)"

   So the MD-90 hook rule (time frame plus give or tease) has no HARD home for the writer. The same is true of the
   setup-after-hook placement, the "new every 8s" clock and "one turn, back half". Fix: add
   `loadCraft('story-timing')` to the three bundles. That changes their cached prefix once, so drop the claim
   where a bundle stays without it.
2. **Slow-delivery rule (MD-91, MD-93).** story-timing.md:55-56 "within the brisk pace, a slower line or a held
   label". MD-93 says one take, sped up about 1.12× as a whole, so a slower line can't be produced, and MD-91
   asks for faster delivery. Keep "a held label", drop "a slower line".
3. **The 1-second pause rule against MD-91 ("pauses ≤ ~0.2s").** writer-craft.md:35-36 "`pause_after`, 1 second
   at most". story-timing.md:26-27 "A silent picture beat is 1 second at most". writer.md:67 and :89 "seconds
   (0–1)". story-editor.md:63 "`pause_after` null or 0–1 seconds". sound-designer.md:83 "put it in a pause of
   the voice, 0.3–1.0 seconds long". No file says the one silent picture beat is an exception to MD-91.
   Either cap it at about 0.2s (`PAUSE_MAX` in `writing/validate.ts:40` too), or have Lucas confirm the exception
   and write it into story-timing HARD 5.
4. **Setup rungs must turn values in the writer's craft (MD-95).** MD-95 exempts the setup, but three
   writer-craft rules apply to every rung:
   - writer-craft.md:87-88 "each rung answers part of the question and opens a sharper one"
   - writer-craft.md:95 "Escalate — each rung raises the stakes or tightens the question"
   - writer-craft.md:155 "Give every rung one visible change that shows its turn"

   These contradict plot-craft Core 4, writer.md:106 and story-timing HARD 2. Scope each to "after the setup".
5. **The mount and sound commands the build steps depend on are missing.** build-workflow.md:35 says "mount every
   frame … with the kit's commands as `assets/kit/FRAME.md` gives them". build-workflow.md:40 says "Run the
   kit's sound placement". fix.md:26 says "re-mount each changed frame … as `FRAME.md` gives the commands".
   FRAME.md § The checks (:432-435) names only `try.mjs` and `bounds.mjs`, and it names no mount
   (`mount.mjs`) or sound-placement command. Add both commands to § The checks.

## Should-fix

1. **Face style: the kit and the director disagree (MD-94).** FRAME.md:257-258 "all cutouts, all photos, all
   halftone or all drawn". director.md:225-226 "all real media in one look (photos or cutouts in the same
   grade and print)". The frame worker reads FRAME, so a photo-plus-cutout frame the director is allowed to plan
   looks forbidden to it. Make FRAME say what HARD 10 says, and point to it.
2. **A generated "fallback object photo" is still allowed.** FRAME.md:389 "a fallback object photo when stock
   has nothing clean". It contradicts FRAME.md:17-18 "never as a photo", director.md:205 "never a photo-like
   picture" and integrity.md:28-29, which disqualifies "a photo-like picture … AI-generated". No make kind
   produces one either (director.md:123-129). Delete it.
3. **Silhouettes: narrower in FRAME than in the director's rule.** FRAME.md:234 "`silhouette` (never for a
   main character: the director's HARD CONSTRAINT 8)". director.md:218-219 says no faceless placeholder for
   *any* named person. The frame worker never sees the director prompt, so this pointer dangles for it too.
   Change it to "never for a named person" and state the rule in FRAME.
4. **Black void against the default backdrop.** director.md:88 "A plain black void is never a backdrop".
   FRAME.md:137-138 `cutout_lift` "`backdrop` … (default a dark ground)". Either change the default or
   require a backdrop in the director's output.
5. **Forced variation per person (MD-94: "no rule forces a different one").**
   - director.md:80-81 "about three times, never in adjacent frames. Between those, show them another way"
   - director.md:223-224 "no person is shown the same way … in more than two … in a row"
   - director-craft.md:132 "Vary a person with more real photos"

   Together these are close to MD-60's "each time a different treatment", which MD-94 amended. Lucas should
   decide whether a repetition cap is still wanted. If it is, call it a repetition limit, not a variety
   requirement, and keep the `variety.ts` check matched to it.
6. **Present tense allowed (MD-93: past tense).** writer-craft.md:134-135 "present works when held through a
   scene". Drop it, or confine it to a quoted moment.
7. **A source-origin filter (MD-96).** director-craft.md:227 "Pull an image whose integrity or origin is in
   doubt". Reposts and aggregators always have a doubtful origin, so this works as a whitelist. Reword:
   "…whose content can't be confirmed as what it is used as".
8. **Two clocks for picture changes.** director-craft.md:161 "A new visual every 2–3 seconds is a starting
   heuristic". story-timing HARD 3 gives "at least every 8 seconds, often every 6", and director-craft.md:15
   says the frames "never re-plan" the clock. Keep one figure, in story-timing (see Repeats).
9. **A `lift` frame against character images.** director.md:207-208 lists `lift` among the frames where a
   character image may appear. Yet director.md:211-212 says "In a `lift` frame the lifted person is the
   artifact's own picture", and director-craft.md:88-90 says "never stack on it". Remove `lift` from HARD 6's
   list.
10. **Id collision.** reporting.md:66 gives source ids "`{ id: "S1"…`", and spine sentences are also
    `S1…` (spine-writer.md:69). The writer receives both: `spine_ids` and facts' `source_ids`. Rename one
    of them, for example sources `R1…`. This needs a code change too.
11. **The sound designer's cold-open template is too narrow.** sound-designer.md:89-90 (HARD 7) "one
    riser-to-hit arc landing on the hook's reveal word". It forces one sound shape on every reel, and a
    teased hook (MD-90) may have no reveal word. sound-designer.md:83 also leaves silences little room under
    MD-91. Make the arc the default, not HARD, and allow a teased opening a hold or swell instead.
12. **The text-element limit against the name rule.** director-craft.md:195 "Limit each moment to the captions
    plus one other text element". director.md:221-222 has every unnamed person shown "carry their name written
    onto the scene", and each line's label also shows. A tableau with three people breaks the limit. Say that
    names on figures don't count.
13. **The attribution label against L1's date label.** writer-craft.md:37-38 credits a `single_source` fact
    "as an `on_screen` label … shown before or with the claim". `L1`'s only label must be the date
    (writer-craft.md:20-21). Say where the credit goes when the hook rests on a single-source fact.
14. **The illustrative spine contradicts its own rules.** plot-craft.md:240-241 makes the curate the
    opposition, but the curate never acts in S1–S7. The board acts instead, which teaches an opposition
    without agency (against §3 and §9's "opponent with agency"). S1 (:245) turns no value, against
    spine-writer HARD 5. Let the curate act once, or name the board as the opposition.
15. **Focus coordinates taught by example.** FRAME.md:77 (ILLUSTRATIVE) passes `focus: [0.48, 0.3]`, while
    FRAME.md:50 says "Pass `focus` only to point at another detail". frame-worker.md:43 says "use
    `ctx.media.<id>.face` for a face", but FRAME.md:102 says "pass the entry, not a box" and :425 "let the kit
    centre it". Drop the focus from the example and fix the frame-worker clause.
16. **Whiteboard marks with no target form.** FRAME.md:322-323 gives `markerCircle(doc, layer, target)` and
    `markerArrow(doc, layer, from, to)` and never says what `target`, `from` or `to` are. § Marks (:302) says
    "never placed at coordinates". Spell out the target forms (`el:` …).
17. **"Stillness" against "never frozen".** director-craft.md:212-213 "(a held frame, a slow push, a
    stillness)". FRAME.md:124 says "a still never sits dead" and frame-worker.md:35 "nothing sits frozen".
    Say "a held frame with a slow drift".
18. **Context stops.** plot-craft.md:203 "use one line of action with brief context stops". That
    contradicts §5 "just in time" (:147) and the fault table's "stops the train mid-ladder" (:321). Reword as
    "context as ammunition between actions".
19. **Source on screen.** director-craft.md:200 "Name the source on screen whenever it affects belief".
    director.md:213-214 allows only the script's labels ("never words of your own"). Make it "use the
    writer's source label, or send the line back".

## Nits

1. FRAME.md:5-7 lists its decisions but omits MD-94, MD-95 and MD-96. FRAME.md:280 cites "MD-69", which
   MD-94 amended.
2. director-craft.md:135 cites MD-90 for "show the person as they were then". MD-90 is the hook rule
   (give away or tease).
3. FRAME.md:384 repeats itself: "Changing what a photo shows. Never change what a photo shows."
4. FRAME.md:251 mentions "(a seat's `facing`)", but the seat shape at :254 `{ id, x, y, h, under? }` has no
   `facing` field. This is a dangling pointer.
5. FRAME.md:427 uses `nk.plate(el, { tone })`, which the Helpers list (:293-298) doesn't include.
6. director.md:72-73 "stage their cutouts in a place … seated in it" is too narrow. The `stage`,
   `phone-call` and `hearing-room` settings are not all seated.
7. story-timing.md:21 HARD 3 includes "often every 6", which is craft, not a must. Move it to Rhythm.
8. director-craft.md:146-147 "Circle a number or a single word; underline a phrase" is too granular.
9. story-editor.md:50-51 "a motive given after its act step 3 or 5" is ambiguous: say which step applies
   when.
10. director.md:46 "One round only; the script then locks" doesn't match :181, where the facts check
    rewrites lines afterwards. Say "locked except for the facts check".
11. director.md:177-178 says the image check reports "a missing source or credit", but integrity.md checks
    no credit. Either name the code check that does, or drop the clause.
12. Unmarked samples that could leak into outputs: producer.md:31-32 "retail, cloud-contract, labor or
    political stories" reads as particular companies. harvest-look.md:15 "a woman at a lectern…",
    visuals-look.md:27 "a man in a grey suit…" and spine-writer.md:74 "trusted ally → suspect" are not marked
    ILLUSTRATIVE.
13. story-timing.md:49-50 "about 180 words a minute" doesn't say whether that is before or after the
    ~1.12× speed-up (MD-93). That changes the word budget by about 12%.
14. director-craft.md:151 "[§13 of the writing research]" and :190 "[Research 06 §5]" cite documents no
    role receives. They are harmless as provenance, but they read as pointers.

## Repeats (owner in bold)

- **Pause and length.** It appears in writer-craft HARD 5, story-timing HARD 5, writer HARD 7 and
  story-editor HARD 1. Owner: **story-timing** (it says it is "the one home", :6). The others should point to
  it once must-fix 1 lands.
- **The setup.** It appears in story-timing HARD 2, plot-craft §5 and §9, spine HARD 8, writer HARD 10 and
  story-editor HARD 2. Owner: **plot-craft §5** for what the setup holds, **story-timing** for where it sits.
  Story-timing's "one home" claim overreaches.
- **Face style.** It appears in director HARD 10, director-craft §3 and FRAME :257, :266 and :280, in three
  wordings (see should-fix 1). Owner: **director HARD 10**. FRAME should give one sentence that matches it.
- **The change clock.** It appears in story-timing HARD 3, director-craft §5 and FRAME Motion :332. Owner:
  **story-timing**.
- **One image, one job.** It appears in director-craft HARD 2, FRAME :28-30 and integrity :24-27, which is
  acceptable because their consumers differ. FRAME's version drops the anchor-image exception; add it.
- story-editor HARD 2 restates the spine rules. That is acceptable, because the editor never receives the
  spine-writer prompt.

## Dangling pointers (summary)

- Story timing is cited by 4 prompts and 2 craft files that don't receive it (must-fix 1).
- The mount and sound-placement commands that "FRAME.md gives" don't exist (must-fix 5).
- FRAME.md:234 points to "the director's HARD CONSTRAINT 8", but the frame worker never receives the
  director prompt (should-fix 3).
- FRAME.md:251 refers to a seat's `facing`, which isn't in the seat shape (nit 4).
- director.md:177 says the image check covers credits, but integrity.md doesn't (nit 11).

## Checked and clean

- MD-90: the give-away-or-tease choice is consistent in story-timing, writer-craft §4 and plot-craft §7, and no
  rule forces always teasing.
- MD-95 joins: plot-craft Core 3, writer-craft §6, the editor's always-checked list and the fault table agree.
- MD-96: no source whitelist anywhere in the harvest prompts. Integrity judges the artifact, not the source.
- MD-97: round 1 of the story editor is blind (story-editor.md:22-24), and the always-checked list sits
  outside the three-fault cap.
- MD-94 within a frame: director HARD 10 and director-craft §3 say "across frames, nothing forces one look".
- Marks: § Marks, frame-worker HARD 4 and director.md:150-153 forbid coordinates (apart from should-fix 16).
- No fragment or drumroll rule survives: writer-craft HARD 3 and writer.md:112 forbid them.
