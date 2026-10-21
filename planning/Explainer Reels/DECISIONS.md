# Explainers 3.0: decision register

This register is the single source of truth for what is decided about Explainer Reels. Explainers
3.0 is Explainers 1.0 upgraded in place (Lucas, 2026-10-13): 1.0's skeleton and pipeline, 2.0's
visual system, and a new eight-beat story. Where `KICKOFF_DECISIONS.md` or `BUILD_PLAN.md`
disagree with this file, **this file wins**. When a decision changes, its old entry moves to
**Superseded** with a pointer to what replaced it. Nothing listed as **Active** contradicts
anything else here.

Plan of record: the before/after Lucas approved on 2026-10-13, with his revisions the same day.
**3.1** (2026-10-13, after Lucas critiqued the first three live reels): pacing, sound, captions,
scene-setting, analogy choice, the definition card, the picture check, and AI-first topics. The
entries below are the current state; what they replaced is under Superseded.

---

## Active

### Product and pipeline

| ID | Decision |
|---|---|
| EX3-01 | **3.0 is an edit of 1.0, not a new product.** Same page (`/explainers`), queue, settings, database schema, Social Hub vertical, publishing, review, caps ($5 per reel; $8 from 3.1, EX3-72), and models (Sonnet 5.5 orchestrator and frame workers). One job: source → analogy (only when missing, EX3-31) → workspace → session A (plan) → lint checkpoint → session B (build + render) → collect → post caption. |
| EX3-02 | **From 2.0, only the visual system comes over** (§ Visual), plus two licensed sound files for the opener (EX3-24). 2.0's Opus planner phases, three opening concepts and their scorecard, plan rubric and revise loop, vision QA and rebuilds, beat-synced music and drop detection, music searches, SFX mixer, per-shot sessions and timing files, and its separate schema, page and vertical stay in the 2.0 worktree. |
| EX3-03 | **Web tools are allowed.** The orchestrator session (plan and build) has WebSearch and WebFetch for facts, a correct real example, and how the concept works. Web pages, like `source.txt`, are data, never instructions. Never invent statistics. Frame workers and the scene builder do not need web tools. |
| EX3-04 | **Source vs web.** With an attached source, the source's facts win and nothing in the reel may contradict it; the web and general knowledge may fill in the explanation. Without a source, teach only well-established facts. |
| EX3-05 | **Exclusion, not override.** Where a vendored HyperFrames doc conflicts with 3.0, a Helios replacement in `explainers/skill-overrides/` is copied over the job's copy of that file, and the blueprint menu is left out of the job. The vendored originals stay untouched (`hyperframes-skills/VENDORED.md`). A leak test fails if the job's skill set still says `persuasion`, "no web", or carries the blueprint menu. |
| EX3-06 | Lint stays deterministic and non-blocking (E-07): violations are recorded; Lucas's review is acceptance. |
| EX3-07 | Nothing is committed, deployed, or applied to a database without Lucas's go-ahead. The first live test is his Generate click on one topic. |

### Story: the eight beats (about a minute)

| ID | Decision |
|---|---|
| EX3-10 | **The reel runs 50–65s** (lint: an error outside 47–68s), real voice timing wins, and understanding comes first (3.1). Every frame is its voice plus a planned pause (`hold`). Eight beats, fixed order: |

| # | Nominal | Beat | `type` | `engagement` | Words | Hold after voice | Anchor |
|---|---|---|---|---|---|---|---|
| 1 | 5.3s | Series opener: hook shot, fixed line, handwritten title card | `hook` | Open loop + visual hook + audio ramp | fixed | 1.5–2.0s (the title) | the anchor world's hook |
| 2 | 6.5s | Curiosity gap, inside the anchor world | `pain_point` | Attention reset + curiosity gap | 10–22 | ≥0.8s | the scene (required) |
| 3 | 7s | Define the concept: dictionary card + a visual | `product_intro` | Grounding definition | 12–26 | ≥1.5s | own (the card and its visual) |
| 4 | 12s | Everyday analogy: set the scene, then play the process | `feature_showcase` | Scene setting + analogy anchor + anticipation | 20–36 | ≥1.0s | the scene |
| 5 | 10s | Map each part onto the real component, saying why | `feature_showcase` | Cached understanding + progressive disclosure | 18–34 | ≥1.0s | the scene (required) |
| 6 | 10s | One tiny real example, with the technical step tracker | `social_proof` | Worked example + progress tracker | 18–32 | ≥1.0s | the scene (required) |
| 7 | 6s | Meet it in the real world, after a transition | `benefit_highlight` | Recognition | 12–26 | ≥0.8s | a new drawn scene |
| 8 | 4s | Logo + last line | `branding` | Callback + distillation | 6–14 | ≥1.0s | — |

| ID | Decision |
|---|---|
| EX3-11 | **Series opener.** The spoken line is fixed: "In the next 30 seconds, you'll learn an AI concept." (`OPENER_LINE`; Lucas kept "30 seconds" on 2026-10-13). The picture opens on the anchor world's **hook** (EX3-62), already moving. From the end of the line, the **handwritten title card** owns the screen for 1.5–2.0s (EX3-61). A riser builds under the whole opener and crests on the 1→2 cut. |
| EX3-12 | **The 1→2 break is an attention reset, every reel.** A sound hit lands exactly on the cut. Frame 2 opens with at least one visual attention reset, declared in `reset:`: a camera punch-in, a color change (paper → night or forest ground), an in-frame zoom-through out of the teased moment (the kit's `seams.js`), or a visual effect on the cut (shock marks, a palette flash). |
| EX3-13 | **Curiosity gap, posed inside the anchor world** (3.1, Lucas: "it ABSOLUTELY should've been tied to the actual anchor analogy"). The line briefly names the world, then asks the question the analogy answers. The director writes three candidate gaps and rates each on reach, value, and **closable** (the analogy answers it); the pick names where it closes (`closed_by`), and the close calls back to it. A deep technical concept stays in a computer-science framing a non-technical person can follow. The gap is never a loop the reel leaves open. |
| EX3-14 | **Define: a dictionary card plus a visual** (3.1). The top half (about y 260–900) is a paper dictionary entry: the headword, its part of speech (`noun`), and the definition filling in word by word as it is spoken, then staying. Captions are quiet for this frame. The bottom half (about y 950–1600) shows a visual of what the definition says. The definition is one sentence a first-time viewer can picture: **what it is** (its category), **what it does**, **when or why**, with the trigger and the receiver named. No vague phrases ("when something happens", "some data"). |
| EX3-15 | **Everyday analogy = the anchor scene.** The analogy is picked in the idea phase (EX3-30) and arrives in `BRIEF.md`; the director builds the scene from it and may not swap in another. **Set the scene first** (3.1): the first sentence puts the viewer in it and names the setting in everyday words ("Let's say…", "Picture…", "Imagine…", "Let's look at a ___ to understand how ___ works"); then every element is introduced by name and job before it acts, as it appears on screen (an establishing shot; a cast may acknowledge the viewer). Then the process plays out to its payoff. Motion is semantic, anticipatory, and state-driven. |
| EX3-16 | **Map, saying why** (3.1). Each pair is "the X is the Y because the shared job" ("The chef is the model, because it writes the instructions"), landing as a label on the scene's object as it is spoken. Always on the scene; a list, node grid or slideshow view is banned. |
| EX3-17 | **Tiny real example, on the same scene, with a technical step tracker** (3.1). Framed ("Here's a real example:"), with real values, narrated through the steps the viewer already learned, in order. The scene shows it with the same elements; a numbered path or timeline along one edge carries the **real technical step names** (`steps[].technical`), each lighting on its cue. |
| EX3-18 | **Real world, after a transition** (3.1). The line opens with a transition that breaks it into its own thing ("Another example would be…", "In everyday life, you meet ___ when…", "Outside our ___, …"), and the picture is a new drawn scene with a visible break (a new ground). One scenario, at most two. Naming it on a card fails. |
| EX3-19 | **Close.** As 1.0: a white screen, only the Helios logo, the thesis as the last line, which does not say Helios. It calls back to the curiosity gap. |
| EX3-20 | **`persuasion` becomes `engagement`** in every layer: a named engagement or learning technique per beat (open loop, visual hook, audio ramp, attention reset, curiosity gap, grounding definition, scene setting, analogy anchor, anticipation, cached understanding, progressive disclosure, state change, worked example, progress tracker, recognition, callback, distillation). |
| EX3-21 | **`## Anchor scene`** in `STORYBOARD.md`, built from the picked analogy: metaphor, setting (table or scene), ground, **hook** (the opener's moment, EX3-62), **steps** (3–5, each with its analogy action and its technical name), entities (id, what it is, what real component it stands for, how it is built from simple solids, its beats), states, layout. Frame 3 carries `definition:` and `part_of_speech:`; frame 2 carries `reset:`; every frame carries `hold:`. |
| EX3-22 | **No blueprints.** The product-launch shot shapes (kinetic type, grid-card cascades, cursor demos) are where the list-and-slideshow mapping came from. Shots are composed from the scene and the kit. |
| EX3-23 | **Voiceover word ranges per beat** (the table above), plain-spoken, short sentences with full stops, one new idea per sentence, no hype words, no exclamation marks, no emoji. **Context at every level** (3.1): every beat tells the viewer what they are looking at before asking them to follow it. |
| EX3-24 | **Opener sounds** are ours and placed by code: `explainers/design/sfx/riser.mp3` (end-aligned to the 1→2 cut, so it builds under the line and the title) and `impact-bass-1.mp3` (on the cut), both from 2.0's licensed Pixabay set (free commercial use, X-40). Lucas may swap them after hearing them. |

### Idea phase

| ID | Decision |
|---|---|
| EX3-30 | **The idea phase owns the analogy.** When a topic makes the pool (`entered_pool` or `won_head_to_head`), one Sonnet call (the analogy writer, v2 in 3.1: EX3-66) returns exactly three distinct candidates (scene, elements with what each stands for, process, payoff, visual, hook, steps). Jev scores each with `explainers-analogy-scoring-v1` (one call per candidate, five 0–4 questions). Code picks: equal weights, 20 points each; ties break by mapping fidelity, then reach, simplicity, visual payoff, visual strength, then candidate order. Candidates, scores and the pick are stored in the topic's `jev_notes.analogy`. Costs: `analogy_writer` and `analogy_scoring`. Rejected and duplicate topics get no analogy spend. A failed pass never fails the idea cycle: it is recorded on the topic and the render retries it. |
| EX3-31 | **A topic with no analogy** (in the pool before 3.0, or whose pass failed), **or whose analogy came from an older analogy writer** (3.1), gets the same pass as the render's first stage, on the Generate click, for that one topic only. Never a sweep. If it still has none, the render fails with that reason. |
| EX3-32 | **Beginner concepts score a little higher**, baked into Q1 `audience_fit` (§ Packets). Gates, keys and tie-breaks are unchanged; the six weights scale by 0.9 in 3.1 to make room for `ai_focus` (EX3-73). |
| EX3-33 | **Scoring text follows the new reel:** Q2 assumes the eight beats (no technical catch), Q3 rewards an analogy that becomes one drawable scene, Q4 describes the new visual system, Q6 rewards gaps that reach the most viewers or are worth the most. Q5 is unchanged. |
| EX3-34 | **Theme brief v3** (§ Packets; 3.1): the one-minute reel shape, a preference for beginner concepts, and the AI skew (EX3-73). A new database starts on v3; `theme_brief_version` flips to `v3` at rollout. |
| EX3-35 | Idea generator and scope writer drop "one technical insight or caveat" for the eight-beat shape and describe a one-minute reel (`idea-generator-v3` with the AI skew, `scope-writer-v3`). |

### Visual system (2.0's, adopted whole)

| ID | Decision |
|---|---|
| EX3-40 | **2.0's approved style is the visual language** (2.0 X-34 to X-39): warm paper `#F3F0EA` with a fading ink grid and grain; isometric paper objects with ink outlines, three flat tones, riso stipple and contact shadows; the line boils; drawn things move on twos; one Helios-orange focal per beat; critters as an optional cast. The style is how things are drawn, never what is drawn. |
| EX3-41 | **Objects are drawn on demand** from the world-kit's primitives (2.0 X-39). Ready-made kit pieces are examples, not a menu. Pre-made assets are not the default: Lucide icons appear only as small markings on drawn objects. |
| EX3-42 | **Grounds:** paper (default), night, forest; never blue. The close is white (EX3-19). Status colors only for their meaning, on the signal itself (2.0 X-24). |
| EX3-43 | **Motion has a job:** semantic, anticipatory, state-driven, or the camera directing attention. Polarity curves; squash and overshoot on things with weight; anticipation before big actions. Calm, motivated camera (≤1.2× zoom per move, roll ≤3°, no tilt), plus the one mandatory attention reset at the 1→2 cut (EX3-12). Speed ramps where they serve. |
| EX3-44 | **One read at a time; no headlines** (2.0 X-26, X-32): captions carry the spoken words; short labels sit on objects and show only in voice gaps. Two exceptions, each with captions quiet: the opener's handwritten title card (EX3-61) and the dictionary card (EX3-14). Negative space is a tension dial (crowd, isolate, open, snap); visual balance and color hierarchy keep it clean; each beat states its eye path. |
| EX3-45 | **Captions** (2.0 X-36, paging from 3.1): big lowercase Pragmatica Extended Bold, top-left of the caption band (y 250–570), no plate, ground-aware color. A page holds up to 7 words on two lines, breaks at sentence ends and never crosses a frame; it stays until the next page starts or 1.2s after its last word. Each word appears with a 0.08s fade and no rise; pages switch instantly. Quiet during the title card and the dictionary card. |
| EX3-46 | **Seams: `cut` only** (3.1; the vendored `zoom-through` draws a gray panel over the frame). A continuity cut: the next frame starts in the state the last one ended. A zoom-through feel is built inside frames with the kit's `seams.js`. No crossfades, slides, or wipes. |
| EX3-47 | **Safe area:** 1.0's bands plus 2.0's right column (x 940–1080) for Instagram's buttons. |

### Engineering

| ID | Decision |
|---|---|
| EX3-50 | **The world-kit** (2.0's `world-kit/`, copied to `explainers/world-kit/`) is copied into each job as `assets/kit/`. |
| EX3-51 | **Scene builder:** one subagent (frame-worker model) writes `assets/world/world.js` from `## Anchor scene` before the frame workers run, so every frame that uses the scene draws it with the same code. |
| EX3-52 | **Frame workers write `assets/frames/<frame id>.js`** (a pure `draw(t)`); `assets/kit/mount.mjs` writes every `compositions/frames/<frame id>.html` wrapper (one clock, seek-safe). `assets/kit/try.mjs` runs the world and each frame in Node before assembly; a failure gets one re-dispatch with the errors. The worker mounts any unmounted frames before its render fallback. |
| EX3-53 | **`assets/kit/opener-sfx.mjs`** runs after `pace.mjs` (so frame 1's length includes the title hold) and adds the two host SFX entries (EX3-24) to `audio_meta.json`, both hung on frame 1. The worker adds them if they are missing before its render fallback. |

### 3.1: the upgrade from the first three reels (2026-10-13)

| ID | Decision |
|---|---|
| EX3-60 | **Pacing engine.** `assets/kit/pace.mjs` runs after `audio.mjs sync-durations`: each frame's `duration` becomes its voice length plus its storyboard `hold` (idempotent), and it writes `voice_end` and `assets/timing/<frame id>.json` (the frame's word times, `voice_end`, `hold`), so titles, the definition fill-in, labels and sound events land on exact words. |
| EX3-61 | **The handwritten title card.** From `voice_end` to the end of frame 1 (1.5–2.0s), the scene dims to 25% and a paper note card (paper sheet, ink outline, grain, a slight tilt) slides in; "today's brain break:" writes itself in ink across it and the concept writes itself in orange ink beneath. It owns the screen; captions are quiet. Drawn by the kit's `handwrite()`: the public-domain single-stroke Hershey Script font through the kit's freehand ink. |
| EX3-62 | **The opener hook fits the anchor world** (replaces "the peak"). The analogy writer proposes a `hook` per candidate; the director refines it in `## Anchor scene`. A world with characters: a reaction whose behavior suits the setting. A world of objects: an object or state moment (mid-collapse, about to overflow, a connection snapping, a wrong or impossible state, a frozen near-miss, one against many). A conceptual world: a visible contradiction (identical things behaving differently, a pattern with one piece breaking it, an effect with no visible cause). Always in motion at frame 0, raising a question the reel answers, never the payoff. |
| EX3-63 | **Event-timed sound design.** Frame workers declare every moment of motion in `assets/frames/<frame id>.events.json` (`{ t, kind, what? }`: impact, pop, tick, click, whoosh, foley with `what`, sting): each arrival, landing, object sitting down, footstep, number or label landing, line draw, state flip, and the payoff. `assets/kit/sound.mjs` resolves them against our sound library (2.0's 625 Kenney CC0 and Pixabay sounds plus the paper and pen set of EX3-75, `explainers/design/sfx/`), level-matches them, turns effects under speech down 6 dB, and premixes one `assets/sfx/events.wav` placed as a host entry. Storyboard `sfx:` lines and the HeyGen `fetch-sfx` step are retired. |
| EX3-64 | **Caption paging** (EX3-45). |
| EX3-65 | **Set the scene and give context at every level** (EX3-15, EX3-23). |
| EX3-66 | **Analogy writer v2.** It asks for (Lucas's wording) "The simplest physical or conceptual metaphor that carries the mechanism. Start from basic elements, situations, objects that are universally understandable or part of everyday life. Use an everyday place only if it requires 3 or fewer recognizable parts for the viewer to understand the everyday place." At most 4 elements, each recognizable at phone size without a label. No example lists in the prompt. Adds `hook` (EX3-62) and `steps` (3–5, each `{ analogy, technical }`). |
| EX3-67 | **Analogy scoring v2** (§ Packets): rewards simplicity without punishing a richer analogy that fits the mechanism perfectly; neutral reach; recognizability without labels. Keys and equal weights unchanged. |
| EX3-68 | **The curiosity gap lives in the anchor world** (EX3-13). |
| EX3-69 | **The dictionary card plus a visual** (EX3-14). |
| EX3-70 | **Map says why, the example has a technical tracker, the real world has a transition** (EX3-16 to EX3-18). |
| EX3-71 | **The picture check.** After assembly, the orchestrator snapshots fixed moments (the hook at 0.5s, the title at `voice_end` + 1s, the dictionary card at its end, beat 4 mid and end, beat 6 end, beat 7 mid), looks at each, and answers a written checklist: recognizable without labels, fills the frame, nothing cut off, title readable, one read at a time. Each failing frame gets one fix, then a re-snapshot. The verdicts are kept as a lint report (`phase: picture_check`). |
| EX3-72 | **Housekeeping.** Cut-only seams (EX3-46). The job's `CLAUDE.md` and `AGENTS.md` (written by `hyperframes init`, pointing at the generic HyperFrames router) are replaced with a pointer to the director. The per-reel cap is **$8** (Lucas, 2026-10-13). Topics re-pick their analogy when it came from an older writer (EX3-31). |
| EX3-73 | **AI topics first.** Idea scoring v3 adds `ai_focus` (0–4, § Packets), worth 10 of 100 points (the other six weights ×0.9), with no gate. It is stored in `jev_notes.ai_focus` and counted in `weighted_score`. The idea generator proposes 2 AI ideas and 1 computer-science or tech idea per call, so CS and tech keep coming and win their place as AI concepts get covered. Rescoring the current pool runs only on Lucas's OK. |
| EX3-74 | **Scale and recognizability** (frame.md): the anchor scene spans at least 60% of the safe-area width, the focal is at least 20% of the safe area, every object is recognizable at phone size without a label, and nothing readable crosses the safe area at rest. |
| EX3-75 | **Paper, pen and writing sounds** (Lucas, 2026-10-13: "those types of sound effects are key to our visual style"). The library adds 684 sounds cut from 220 Freesound recordings released under CC0, across 34 kinds of paper-world foley: pencil, pen and marker writing, chalk, eraser, crayon, pen clicks and caps, crumple, tear, fold, page turn, slide, rustle, drop, shuffle, flutter, cardboard, envelope, sticky notes, scissors, tape, stapler, hole punch, stamp, clipboard, notebook, pushpin, paper clip, ruler, typewriter (`explainers/design/sfx/freesound/`, sources and credits beside them, import tools in `explainers/design/sfx/tools/`). Continuous actions are kept as beds tagged `sustain`: a foley event may carry `dur` (0.2–8s) and plays exactly that long ("pencil writing" for the length of a handwritten line). Foley descriptions match by every word, rarer words weighing more; the non-foley kinds (impact, whoosh, tick, click, pop, sting) keep to the original library. Frame workers draw sound for writing, paper and stationery from this set first. |
| EX3-76 | **Explainers 3.2** (Lucas, 2026-10-13, from the hallucination and agent-loop reels' critiques; plan approved with his edits). Critters always, a real prop library, an analogy ladder of simplicity, the topic's `term`, shots, an illustrated example, pauses of at most 0.2s, groovy music, a blind picture check, kit text cards, and print handwriting. Reel length is not chased: understanding comes first, so word counts are not cut (Lucas: "I'm ok with the long reel duration"). |
| EX3-77 | **Critters are the cast, a HARD CONSTRAINT.** Every character is a critter (`cast.js`); never a person, a figure built from solids, or a body part (Lucas: "You cannot build a hand from geometric shapes"). When an analogy has someone doing something, a critter does it; a body part is never an analogy element. Critters are the default cast: hooks, reactions, the real-world beat and the close lean on them. The cast kit adds arm poses (reach, feel, point, hold, offer, write, wave, shrug, think, cover, cheer, hips), `handAt()` so a critter holds any prop, a walk cycle, brows and moods (confident, confused, panicked, proud, sly, worried, surprised, sad, angry, focused), a paper body for a second cast member, and role accessories (cap, top hat, chef hat, grad cap, glasses, headset, apron, backpack, bowtie, scarf). Lint rejects people and body parts in the anchor block. |
| EX3-78 | **The prop library** (`explainers/world-kit/props.js`, batches in `props/`). About 50 everyday objects drawn once in the paper-and-ink style, each with its states (switch on/off, jar empty/full, door open/closed) and an orange focal part, approved by Lucas on a contact sheet (`explainers/design/tools/props-sheet.mjs`). A scene uses a prop when the library has the thing; organic shapes may be ink contours with flat fills, not forced into boxes. A new object is drawn as a prop, must pass the blind picture check (EX3-84), and joins the library after Lucas approves it. The library is never shown to the analogy writer (V-16). |
| EX3-79 | **Pauses of at most 0.2s** (Lucas: "A pause shouldn't be longer than 0.2 seconds"). `pace.mjs` tightens each voice line: a silence between two words is cut to 0.15s, or 0.2s after a word that ends a sentence (Lucas found 0.12s "a tiny bit rushed"; the WAV cut with 5 ms fades; word times shifted to match), and the silence after the last word to 0.05s. Each frame's hold is 0.15s, so lines are 0.2s apart; the logo end card keeps 1s. The originals are kept, so pacing is idempotent. The title card writes itself during the opener line (EX3-80). The length check is a warning above 65s, never an error. |
| EX3-80 | **Text is kit components** (`cards.js`). `dictionaryCard()` lays the definition with measured font widths (`metrics.js`, generated by `explainers/design/tools/measure-fonts.mjs`), one `<text>` per line with a `<tspan>` per word, filling in on the voice's word times; its headword is the topic's `term`. `titleCard()` is a paper card in the top band that writes "today's brain break:" and the term while the opener line plays; the hook keeps playing below, undimmed, and captions are quiet for all of frame 1. Frame workers call these and never lay out text themselves. |
| EX3-81 | **Print handwriting: Hershey Sans** (Lucas's pick of five samples, 2026-10-13; "It shouldn't be cursive"). Single-stroke glyphs (`hershey-sans.js`, public domain via hersheytext, MIT), drawn as an even round-capped pen line under the kit's wobble, so letters still write themselves stroke by stroke and short stems never taper away. |
| EX3-82 | **Music: the search looks for what we want** (Lucas: "groovy funk, driving indie, hip hop instrumental, 105-128 BPM"; not calm or business music, not upbeat electronic; he does not pick tracks). `music.mjs` rotates the three styles per reel, searches HeyGen's catalog, drops any track whose words read calm, corporate, ambient, piano, cinematic, meditative, lo-fi or electronic and any of the last three used, and fits the pick to the reel: a long track is cut, a short one is looped with crossfades (lead-in and fade-out removed), so there is never a hard seam. The bed sits at 0.16. The director no longer writes a music mood (`music: none`). |
| EX3-83 | **Shots: same scene ≠ same shot** (Lucas: "We need to use camera angles, closeups, and cutaway shots"). A scene frame lists its shots (`shots.js`: wide, medium, close, insert, reaction, over-the-shoulder, reverse) and hard-cuts between them on voice cues. Every frame longer than 6s has at least 2 shots with a cut every 2.5–4s; no frame opens on the same shot kind and subject the previous frame ended on; the wide establishing shot appears once (beat 4's opening); beats 1, 2, 4 and 5 each use a shot kind the others don't. Cuts reframe freely; moves inside a shot stay within 1.2×. |
| EX3-84 | **The blind picture check** (replaces EX3-71's self-check, which passed a box "hand"). The snapshots go to a `picture-checker` subagent with no storyboard context, on the cheapest model (Haiku 5.5) with only Read, reading the snapshot command's 3×3 contact sheets (Lucas: "the cheapest way possible"). It says in plain words what a stranger sees per tile; the orchestrator compares that with the intended entities and the hook. An entity not named correctly fails and is redrawn (as a library prop when one exists); only failed tiles are re-checked. Snapshots add one per shot cut in beats 1, 2, 4 and 5. The descriptions are kept in `picture-check.json`. |
| EX3-85 | **The ladder of simplicity** (analogy writer v3, analogy scoring v3; Lucas: "It should have logic for what rung on the ladder of simplicity it should be resorting to"). Rung 1: one object or physical effect. Rung 2: one everyday action by a critter with at most 3 objects. Rung 3: a familiar everyday situation or place everyone has lived. The writer chooses the lowest rung that needs zero invented rules (anything the viewer must be told about how the analogy works); the three candidates sit on different rungs when they can, with `rung`, `invented_rules` (must be empty) and `actor`. The hook is judged standalone: a viewer with no context knows what they are looking at within 1 second. Scoring adds `familiarity` and `hook_clarity` (7 equal keys), and simplicity means the right rung. |
| EX3-86 | **The topic's `term`** (Lucas: "This video is supposed to be about Agentic loops, and yet we defined AI agent?"). Idea generator v4 and scope writer v4 write the exact phrase the reel defines, and the scope says what is in and what is out. The brief carries it; frame 3's headword is the term, the definition defines it, and the title card writes it. Lint errors when the headword is not the term. The current pool's terms are backfilled only on Lucas's OK. |
| EX3-87 | **The example is illustrated** (Lucas: the numbered example "needs to have a matching visual illustration"). Beat 6's tracker stops are the example's own concrete steps (`example_steps:`), each with an insert shot of the real thing; one cut back to the anchor scene may tie them together. Beat 6 no longer requires the anchor scene. |
| EX3-88 | **Hooks are judged standalone** (Lucas: "the viewer cannot be confused about why they are looking at this"). The director writes three hook candidates and rates each on standalone clarity and thumb-stop, then picks one; the blind check at 0.5s must name the situation. |

### 3.3: the upgrade from the RAG, training and fine-tuning reels (2026-10-13)

| ID | Decision |
|---|---|
| EX3-89 | **Cut only real silence** (Lucas: "VOICEOVERS ARE GETTING CUT OFF", "returns" became "turns"). 3.2's tightener cut by HeyGen's word timestamps, which are coarse and ~0.1s off: 39 of 53 cuts in the RAG reel touched sound. `pace.mjs` now cuts only inside silence measured in the waveform (ffmpeg silencedetect at −40 dB, ≥ 50 ms), keeping each cap (0.15s, 0.2s at a sentence end) split evenly on both sides so words keep their onsets and decays; the line's tail is measured from its last real sound. After cutting, the speech runs must match the original's one for one, or the line keeps its untightened voice. Word times shift with the cuts and snap to the real onset where a timestamp fell inside a silence. Reels run about 3s longer; the longest pause stays 0.2s. |
| EX3-90 | **A shot is only a camera.** Every shot draws the same scene; the camera chooses what is in view. An insert is a tight camera (2.2× or more) on one object; nothing is hidden (3.2's RAG insert dropped the critters while the voice said "the hire pulls") and nothing is added. Over-the-shoulder is removed (it drew a second copy of the hire in the corner), and so is reverse (mirroring makes critters jump sides). Critters carry their world id (`critter({ who })`); `try.mjs` errors on a critter drawn twice at once or one that vanishes mid-frame and comes back. |
| EX3-91 | **Shots follow the voice** (Lucas: "'This new hire' is the subject of the scene, so the camera should be focused on HIM"). A shot's subject is what the voice is naming while it is on screen; variety comes from the shot kind. Lint errors when a shot's subject is not spoken in its window on frames 2, 4 and 5 (a warning on 6 and 7). Session A runs the storyboard lint itself and fixes every error before it stops. |
| EX3-92 | **Text inside a shape is a kit component; every moment's text is measured.** `textBox()` (speech or chat bubble, note, sign, screen) sizes the shape around measured text, so text cannot leave it (3.2's "happy to help!" ran off its bubble and the screen). `bounds.mjs` draws every frame every 0.2s in headless Chrome and reports text cut by the frame edge, text crossing its box, and readable text in the keep-outs; failures go back to the frame's worker. The picture check snapshots near the end of every shot in frames 1–7. |
| EX3-93 | **The title card animates from the first frame** (Lucas: "should start animating in as soon as the video starts"). It slides in over the first 0.25s and writes as it lands. |
| EX3-94 | **The same bed loudness every reel** (Lucas: training's music "just a tiny teensy bit too loud"; its master was 5 dB hotter). `music.mjs` brings each fitted bed to −16.5 LUFS (the RAG and fine-tuning beds' level) before the 0.16 mix, with a limiter. |
| EX3-95 | **The close: 2.5s, no voice** (Lucas). A white screen; the Helios logo animates in and "AI BRAIN BREAK" writes itself beneath it in the print handwriting; the two are centred on the screen together, top of the logo to the bottom of the words (Lucas, after the first close). It is the kit's `close.js`, written and mounted by code (no worker, no director copy). Its sounds are fixed: a whoosh into a chime as the logo lands, pencil writing for exactly the strokes, and a pen click as the writing ends. The music fades out across it. |
| EX3-96 | **The opener points at the scene** (Lucas's pick, option 4). The opener line is the template below; its slot (1–3 words) names what the hook shows ("this little shop", "this soggy forecaster"). |
| EX3-97 | **The gap bridges to the AI and names the term** (Lucas's pick, option 1). Beat 2 is four parts: the scene's problem; one sentence saying an AI is in the same spot; the question; then "That's <term>." (20–36 words). Beat 4 continues the scene the viewer has seen ("Here's what the hire does:") and never restarts it with "Picture…". |
| EX3-98 | **Typewriter captions** (Lucas: "come out letter by letter instead of word by word"). Each word types in letter by letter across the time it is spoken, so the letters keep pace with the voice; pages and colors are unchanged. |
| EX3-99 | **A tighter opener** (Lucas: the opener line "should start RIGHT at the first frame and the words should naturally be said a little faster"; of three samples he chose B, then asked for it 20% faster and without the "!" reading). The HeyGen voice ignores its speed setting, so `pace.mjs` cuts the opener's lead-in to 0.02s so the first word lands on frame 0, and speeds the line up 1.2× with its pitch kept (ffmpeg atempo), scaling its word times. The text is read as written. The opener runs about 0.9s shorter. |
| EX3-100 | **The bounds check runs in the build** (the embeddings reel's 17 text problems went unchecked: no Chrome was in the job's home before the first snapshot, and the check skipped). The workspace runs `hyperframes browser ensure` while preparing the job, and `node assets/kit/bounds.mjs all` runs outside the OS sandbox like HyperFrames' own Chrome commands. |
| EX3-101 | **The curiosity gap is a story a stranger follows, never a puzzle** (Lucas, 2026-10-14: "Curiosity gap doesn't mean that the viewer gets confused… The viewer should understand what they are missing and want to get it"). Read cold, every gap since 3.0 failed one of three ways: a question about somewhere else (3.0 webhooks), a question inside a world the viewer does not understand yet (3.1, 3.2), or a claimed parallel plus a label (3.3's "same spot… That's <term>."); the root is the writer's mechanism question in place of the viewer's own. Beat 2 is now one tiny story in the hook's scene (18–36 words): the goal, the obstacle, the twist or stakes, the viewer's own question about how it plays out, and a promise naming something in their life. No term, no "same spot", plain roles; `gap_question:` is written down and frame 4's last sentence answers it in its words. Candidates are rated on clarity, pull, relevance and closable. Session A runs a first-time-viewer test (a `first-viewer` subagent on Haiku 5.5 reads only the opener, the hook and the gap) and rewrites a gap a stranger cannot follow or does not want to finish; the verdict is kept (`gap-check.json`). Lint: `gap_term`, `gap_same_spot`, `gap_question`, `gap_promise`, `gap_closed` errors. |
| EX3-102 | **Every reel opens on an animated intro drawn from the opener bank** (Lucas, 2026-10-19). From two review batches of 10 (planning/Explainer Reels/intros/INTROS.md) Lucas kept 11: Paper Rip, Record Scratch Freeze, Typewriter, Big Bang, Knock Knock, Eye Zoom-Out, Balloon Pop, Block Drop, Unboxing, Paper Plane, Scissors Cut-Out. Each is an audio and visual pattern break built over the reel's own hook and critter (`explainers/world-kit/openers/`). Each render draws one at random, **never one of the last 8 reels' openers** (failed jobs do not count; a resumed job keeps its draw), records it on `explainers.jobs.opener`, and writes `assets/opener.json`. The first text an opener shows is "AI BRAIN BREAK" alone, never the term (Lucas: "most of these are repeating the topic"); the title card with the term follows the break. The frame worker writes only the hook, `01-hook.js`, to a contract (`hero` = its critter's spot, scale, id and look; `draw(t, { hideHero, heroPose })`; no text); code writes `01-opener.js`. `pace.mjs` puts the opener's wait before frame 1's line; `opener-sfx.mjs` mixes the opener's stem (library sounds and synthesized breaks), holds the bed back until its drop, and keeps the hit on the 1→2 cut. Replaces EX3-93's title card from frame 0 and EX3-24's riser for new jobs; jobs from before the bank keep both. |
| EX3-103 | **Nothing a critter wears covers or crowds its eyes or mouth, a HARD CONSTRAINT** (Lucas, 2026-10-21: "Accessories/clothing cannot cover critters' eyes or mouth. There needs to even be reasonable negative space around them"; glasses are the exception, "that's how glasses work"). `cast.js` exports `FACE_KEEPOUT`: the eyes and brows with about 10px clear around them, and every mouth shape with 8px. 3.2's apron and scarf covered the mouth, the bowtie touched it, the headset mic sat on its corner, the backpack strap ran beside the left eye, and the cap brim and top hat brim sat on the brows. Now hats sit above the brows, the mic stops at the cheek, the strap follows the body's edge, and the apron (a waist apron), scarf and bowtie sit at the base below the mouth. An ink accessory on a dark ground gets a paper edge so what hangs past the body still reads. `tests/explainers-kit.test.ts` measures every accessory on every body and ground against the keep-outs; frame.md and the scene builder forbid frames from drawing their own masks, blindfolds, hoods, visors, sunglasses or scarves over the face. The `feel` pose no longer says "blindfolded". Sheet: `explainers/design/tools/wear-sheet.html` (`?zone=1` outlines the keep-outs). |

---

## Packets (verbatim; tests compare the code with these)

### Opener line template

```
In the next 30 seconds, this ___ will teach you an AI concept.
```

(EX3-96; the 3.2 fixed line was "In the next 30 seconds, you'll learn an AI concept.")

### Theme brief v3

**Explainer Reels — Idea Generation Theme Brief**

Generate educational topics for short, one-minute Explainer Reels that help a broad business audience understand how modern software, computer science, and AI systems work. The audience ranges from nontechnical business owners and operators to technically curious professionals. Assume intelligence, but do not assume technical vocabulary or prior engineering knowledge.

Prefer beginner concepts. The more beginner a concept is, the more people it reaches, because more viewers can enter it with no prior knowledge. Between two equally valuable ideas, propose the more beginner one.

Skew toward AI. Most topics should teach how artificial intelligence works: how models, tokens, context, prompts, agents, tools, retrieval, training, and evaluation fit together. Computer-science and tech concepts remain part of the curriculum, and they matter most when they help someone understand AI.

The goal is not to cover technology news. The goal is to build durable technical literacy over time, so that following the page feels like taking a practical curriculum in modern technology.

Topic areas may include: AI and LLM fundamentals; agents and agentic systems; context windows and memory; RAG, embeddings, and vector search; MCP and APIs; databases, SQL, schemas, tables, keys, and relationships; frontend and backend systems; HTTP and web infrastructure; authentication and authorization; Git, GitHub, branches, and repositories; local, preview, and production environments; cloud computing, workers, cron jobs, and deployment; integrations, webhooks, backfills, and secrets; programming languages; frameworks and libraries; runtimes and package managers; state management; UI/UX concepts; software architecture; data flow; orchestration and workflows; model routing; tokenization; and other foundational computer-science concepts that help people understand how technology actually works.

Scope every idea aggressively. One reel should teach one complete thought. A topic is suitable only if it can be explained accurately in about a minute with one curiosity gap, one plain definition, one everyday analogy that can carry the whole reel as a single scene, one tiny real example, and one real-world application. Broad concepts are allowed only when the objective is to explain what the concept is and how its major pieces fit together. Do not cram several lessons into one reel.

Use a plain-spoken, authoritative tone. Teach the underlying mechanism, not just a definition. Avoid hype, jargon for its own sake, and claims that oversimplify a concept into something inaccurate.

Do not generate: AI news, model-release commentary, “best AI tools” content, product roundups, consumer-tech news, prompt hacks, speculative AGI content, future-of-work predictions, trend commentary, or content whose primary purpose is opinion rather than teaching durable knowledge.

Deduplication: Treat two ideas as duplicates when the viewer would learn essentially the same core concept or leave with the same primary takeaway, even if the title, hook, analogy, or example differs. Compare against all available queued, rendered, and previously published topics. A new topic may revisit the same broad domain only when it teaches a materially different concept or layer of understanding.

10 good example topics
1. What actually happens when you call an API? — One mechanism, easy analogy, clear request/response example.
2. What is a context window? — Foundational AI concept with one clean mental model.
3. Why does a database need a primary key? — Extremely specific and can use one tiny table example.
4. What is a webhook? — Single integration concept with a strong real-world analogy.
5. What does “running locally” actually mean? — Common phrase that nontechnical operators hear constantly.
6. What is a Git branch? — One concept, visual, and directly useful for understanding software teams.
7. How does vector search find similar ideas instead of matching words? — One RAG mechanism with high visual potential.
8. What is authentication vs. authorization? — A narrow comparison that fits naturally into one thought.
9. What does React actually do? — A framework/language-adjacent topic framed around its fundamental role rather than a tutorial.
10. Why do AI agents need tools? — Explains one building block of agentic systems rather than trying to explain all of agents.

10 bad example topics
1. Everything you need to know about AI agents — Far too broad for one thought.
2. APIs, MCPs, webhooks, and integrations explained — Four separate lessons combined.
3. The 10 best AI tools for business owners — Tool roundup, not durable education.
4. What Claude 6 means for the future of work — Model news plus speculation.
5. Will AI replace software engineers? — Future-of-work opinion rather than technical education.
6. 5 prompts that will make you 10× more productive — Prompt-hack content.
7. The new iPhone's AI features explained — Consumer-tech/product news.
8. Learn Python in 45 seconds — Impossible scope and implicitly a tutorial.
9. How to build a full RAG application — Multi-stage implementation tutorial rather than one concept.
10. AI is about to change everything — Hype without a concrete learning objective.

### Theme brief v2 (superseded by v3; kept because existing databases still hold it)

**Explainer Reels — Idea Generation Theme Brief**

Generate educational topics for short, 45-second Explainer Reels that help a broad business audience understand how modern software, computer science, and AI systems work. The audience ranges from nontechnical business owners and operators to technically curious professionals. Assume intelligence, but do not assume technical vocabulary or prior engineering knowledge.

Prefer beginner concepts. The more beginner a concept is, the more people it reaches, because more viewers can enter it with no prior knowledge. Between two equally valuable ideas, propose the more beginner one.

The goal is not to cover technology news. The goal is to build durable technical literacy over time, so that following the page feels like taking a practical curriculum in modern technology.

Topic areas may include: AI and LLM fundamentals; agents and agentic systems; context windows and memory; RAG, embeddings, and vector search; MCP and APIs; databases, SQL, schemas, tables, keys, and relationships; frontend and backend systems; HTTP and web infrastructure; authentication and authorization; Git, GitHub, branches, and repositories; local, preview, and production environments; cloud computing, workers, cron jobs, and deployment; integrations, webhooks, backfills, and secrets; programming languages; frameworks and libraries; runtimes and package managers; state management; UI/UX concepts; software architecture; data flow; orchestration and workflows; model routing; tokenization; and other foundational computer-science concepts that help people understand how technology actually works.

Scope every idea aggressively. One reel should teach one complete thought. A topic is suitable only if it can be explained accurately in 45 seconds with one curiosity gap, one plain definition, one everyday analogy that can carry the whole reel as a single scene, one tiny real example, and one real-world application. Broad concepts are allowed only when the objective is to explain what the concept is and how its major pieces fit together. Do not cram several lessons into one reel.

Use a plain-spoken, authoritative tone. Teach the underlying mechanism, not just a definition. Avoid hype, jargon for its own sake, and claims that oversimplify a concept into something inaccurate.

Do not generate: AI news, model-release commentary, “best AI tools” content, product roundups, consumer-tech news, prompt hacks, speculative AGI content, future-of-work predictions, trend commentary, or content whose primary purpose is opinion rather than teaching durable knowledge.

Deduplication: Treat two ideas as duplicates when the viewer would learn essentially the same core concept or leave with the same primary takeaway, even if the title, hook, analogy, or example differs. Compare against all available queued, rendered, and previously published topics. A new topic may revisit the same broad domain only when it teaches a materially different concept or layer of understanding.

10 good example topics
1. What actually happens when you call an API? — One mechanism, easy analogy, clear request/response example.
2. What is a context window? — Foundational AI concept with one clean mental model.
3. Why does a database need a primary key? — Extremely specific and can use one tiny table example.
4. What is a webhook? — Single integration concept with a strong real-world analogy.
5. What does “running locally” actually mean? — Common phrase that nontechnical operators hear constantly.
6. What is a Git branch? — One concept, visual, and directly useful for understanding software teams.
7. How does vector search find similar ideas instead of matching words? — One RAG mechanism with high visual potential.
8. What is authentication vs. authorization? — A narrow comparison that fits naturally into one thought.
9. What does React actually do? — A framework/language-adjacent topic framed around its fundamental role rather than a tutorial.
10. Why do AI agents need tools? — Explains one building block of agentic systems rather than trying to explain all of agents.

10 bad example topics
1. Everything you need to know about AI agents — Far too broad for one thought.
2. APIs, MCPs, webhooks, and integrations explained — Four separate lessons combined.
3. The 10 best AI tools for business owners — Tool roundup, not durable education.
4. What Claude 6 means for the future of work — Model news plus speculation.
5. Will AI replace software engineers? — Future-of-work opinion rather than technical education.
6. 5 prompts that will make you 10× more productive — Prompt-hack content.
7. The new iPhone's AI features explained — Consumer-tech/product news.
8. Learn Python in 45 seconds — Impossible scope and implicitly a tutorial.
9. How to build a full RAG application — Multi-stage implementation tutorial rather than one concept.
10. AI is about to change everything — Hype without a concrete learning objective.

### Idea scoring v3 (`explainers-idea-scoring-v3`)

Gates, state fields and tie-breaks are E-15's. Weights (points out of 100): audience_fit 18, teachability_45s 18, analogy_potential 11.25, visual_potential 11.25, accuracy_under_simplification 18, hook_strength 13.5, ai_focus 10. `ai_focus` has no gate.

**Q1 — Audience fit + durable utility**
Key: audience_fit
Question:
How strongly would teaching this topic advance durable practical literacy in AI, software, or computer science for the Explainer Reels audience?
State fields:
- topic_title
- theme_brief

Judge rule:
Judge the educational value of the underlying concept for a broad audience ranging from nontechnical business people to technically curious professionals. Reward durable mental models that help someone understand how modern technology works. Favor beginner concepts: the more beginner the concept, the larger its total addressable audience, because more viewers can enter it with no prior knowledge and use it in their own life. Between two equally valuable concepts, the more beginner one scores higher. Do not reward a beginner topic that teaches little, and do not reward a topic merely because it is timely, popular, surprising, or related to AI.
Levels:
- 0 — Outside the curriculum. Primarily news, consumer technology, product commentary, speculation, prompt hacks, future-of-work discussion, opinion, or another subject that does not meaningfully teach durable AI/software/computer-science knowledge.
- 1 — Weak fit. Technically related to the curriculum, but mostly trivia, an excessively niche implementation detail, an advanced concept only specialists meet, or a concept with little useful mental-model value for this audience.
- 2 — Valid curriculum topic. Teaches a legitimate technical concept with some practical value. A viewer would learn something useful, but the concept is not especially high-leverage or broadly relevant.
- 3 — Strong curriculum topic. A durable concept that people working around modern software or AI are likely to encounter and benefit from understanding, and that a beginner can follow with no background. It clearly improves the viewer's technical literacy.
- 4 — Exceptional curriculum topic. A foundational, beginner-level mental model that nearly everyone in the audience meets and that unlocks understanding of multiple other concepts or meaningfully changes how a nontechnical person understands modern technology. Merely being relevant is not enough.

**Q2 — One-minute teachability + scope**
Key: teachability_45s
Question:
Can this topic be taught as one complete and genuinely understandable thought in a one-minute Explainer Reel?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge scope, not underlying technical difficulty. An advanced concept may score highly if one useful thought about it can genuinely be taught to a nontechnical viewer. Assume the reel must support a curiosity-gap hook, a plain definition, one everyday analogy, a mapping of that analogy onto the real components, one tiny real example, and one real-world context beat. Do not reward a topic that only fits by racing through several subtopics or removing information necessary for understanding.
Levels:
- 0 — Cannot fit. The topic contains several independent lessons, requires substantial prerequisite knowledge, or is so broad that a one-minute explanation would be superficial rather than educational.
- 1 — Fits only through harmful compression. A reel could technically discuss it, but only by hand-waving important mechanics, skipping necessary context, or cramming multiple thoughts together.
- 2 — Teachable with careful narrowing. There is a coherent one-minute lesson inside the topic, although the treatment must be tightly scoped and some surrounding complexity must be deliberately excluded.
- 3 — Naturally teachable. The topic maps cleanly onto one curiosity gap, definition, analogy, mapping, tiny example, and real-world implication with little prerequisite knowledge.
- 4 — Exceptionally clean learning unit. The topic contains one crisp mechanism or distinction that can be fully developed rather than merely summarized within the format. The definition, analogy, mapping, example, and real-world beat all fit comfortably.

**Q3 — Everyday analogy potential**
Key: analogy_potential
Question:
How naturally can this concept be mapped to one everyday analogy without materially distorting how the concept actually works?
State fields:
- topic_title
- topic_scope

Judge rule:
Reward analogies whose parts map meaningfully onto the technical concept and that can become one full, drawable everyday scene the whole reel revolves around, with the mapping and the example playing out inside it. Do not reward catchy metaphors that break down immediately or teach the wrong mental model.
Levels:
- 0 — No useful analogy. An everyday analogy would substantially misrepresent the concept or provide no meaningful help.
- 1 — Forced or misleading analogy. A metaphor can be invented, but important parts of the mapping fail and could leave the viewer with the wrong understanding.
- 2 — Workable analogy. There is a reasonable everyday comparison that communicates the central idea, although its limits need careful handling.
- 3 — Strong analogy. A familiar situation maps naturally onto the concept's important components and would materially improve comprehension.
- 4 — Exceptional analogy. The everyday system maps unusually cleanly onto the technical system and becomes one scene that can carry multiple beats of the reel—including the mapping and the example—without becoming inaccurate.

**Q4 — Visual potential**
Key: visual_potential
Question:
How much potential does this topic have for an engaging, visually explanatory one-minute animation, including a highly visual everyday analogy?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge how effectively the intended lesson could be communicated and made entertaining through code-drawn animation in the Helios paper style: isometric paper objects with ink outlines, drawn on demand for each reel, so any everyday object or place can be built from simple solids; simple characters when someone has to act or react; short labels on objects; lines and paths that draw themselves; and a calm camera. Do not assume photography, stock footage, realistic illustration, or 3D renders.
Reward visuals that actively explain the mechanism rather than merely decorate narration: semantic motion that communicates the idea, anticipatory motion that builds an outcome to await, and state-driven motion where a rule produces a visible consequence. Consider whether processes, relationships, transformations, sequences, comparisons, data flows, or changing states can be animated clearly.
Also give modest additional credit when the concept naturally supports a highly visual everyday analogy that can anchor the whole reel as one scene, with a satisfying visual payoff and moments for synchronized sound effects. Do not make analogy potential the dominant factor here; it has its own separate score.
Levels:
- 0 — Poor visual fit. The lesson is fundamentally difficult to demonstrate visually in the available medium. Even with drawn objects, labels, and motion, most of the understanding would have to come from narration.
- 1 — Limited visual potential. Recognizable visuals can accompany the explanation, but they would mostly decorate the narration. The concept offers little useful animation, visual transformation, or engaging analogy material.
- 2 — Solid visual potential. The topic supports at least one useful explanatory animation or drawn analogy scene, plus some meaningful use of objects, labels, flows, comparisons, or changing state. Visuals improve the lesson but do not carry most of it.
- 3 — Strong visual potential. The reel can repeatedly show rather than tell. The analogy can become an engaging animated scene that the mapping or the example plays out in, with clear motion, relationships, or visual state changes.
- 4 — Exceptional visual potential. The topic naturally lends itself to a memorable visual story. A compelling everyday analogy can be richly animated as one scene of simple drawn objects, labels, motion, and sound cues; it maps cleanly onto the technical system; and multiple beats can communicate meaning primarily through animation rather than narration. This level should be difficult to reach.

**Q5 — Accuracy under simplification**
Key: accuracy_under_simplification
Question:
Can this concept be simplified enough for the format while remaining materially correct?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge the risk created by simplifying the topic for a nontechnical audience. Reward concepts whose essential mechanism remains correct when jargon and secondary details are removed. Penalize topics where crucial exceptions, prerequisites, disputed claims, or interacting mechanisms would need to be omitted. When source text is provided, the proposed lesson must also be supportable from that source because sourced reels may not introduce unsupported claims.
Levels:
- 0 — Cannot be simplified safely. Any one-minute treatment would likely communicate a materially false mental model, omit a defining qualification, or—when a source exists—require claims the source does not support.
- 1 — High distortion risk. The concept can only be made accessible by removing so many essential caveats or mechanics that the explanation risks being misleading.
- 2 — Accurate with careful framing. A correct simplified lesson is possible if the scope is explicitly constrained and at least one important caveat is handled well.
- 3 — Strong simplification resilience. The important mechanism can be expressed plainly while remaining materially correct. Secondary details can be excluded without changing the viewer's core mental model.
- 4 — Exceptionally robust. The concept has a precise central mechanism or distinction that remains fully valid after simplification and lends itself to a concrete, accurate miniature example. There are few material traps.

**Q6 — Hook strength**
Key: hook_strength
Question:
How strong is the truthful, non-hype hook potential inherent in this topic?
State fields:
- topic_title
- topic_scope

Judge rule:
Judge whether the lesson naturally creates immediate curiosity, recognition, useful tension, or a knowledge gap for the target audience. Reward a gap that reaches the most viewers, because it touches almost everyone's life, or whose answer is the most valuable to know. The hook must emerge from the concept itself. Do not reward sensationalism, fear, exaggerated claims, artificial controversy, or clickbait wording.
Levels:
- 0 — No credible hook. There is little reason for the intended viewer to care immediately unless the topic is exaggerated or sensationalized.
- 1 — Weak hook. A reasonable introduction can be written, but the concept creates little natural curiosity or relevance.
- 2 — Solid hook. The topic connects to a recognizable question, confusion, system, or problem and can support a credible opening.
- 3 — Strong hook. The concept contains a meaningful curiosity gap, misconception, counterintuitive mechanism, or familiar technology the viewer likely uses without understanding.
- 4 — Exceptional hook. The topic contains an immediate, specific, and truthful tension that naturally makes someone want the explanation, and it reaches almost everyone or answers something genuinely valuable to know. It is surprising or highly recognizable without needing hype.

**Q7 — AI focus**
Key: ai_focus
Question:
How directly does this topic teach a concept about artificial intelligence?
State fields:
- topic_title
- topic_scope

Judge rule:
Judge the subject of the lesson, not its wording. Reward topics whose core concept is part of how AI systems work. Give partial credit to computer-science or tech concepts that directly enable or explain AI systems, when the lesson makes that link. Do not reward a general computing topic merely because AI uses it, and do not reward the word AI in a title when the lesson itself is not about AI.
Levels:
- 0 — Not about AI. A general computing or technology concept with no direct link to how AI works.
- 1 — General computing that AI merely uses. A general building block taught without its role in AI.
- 2 — Enables AI. A computer-science or tech concept that directly enables or explains AI systems, taught with that link.
- 3 — An AI concept. The lesson teaches how some part of AI systems works.
- 4 — A core AI concept. A foundational idea about how modern AI works that many other AI concepts depend on.

**End of idea scoring v3**

### Analogy scoring v3 (`explainers-analogy-scoring-v3`)

Each candidate is scored on all seven questions in one Jev call. Code combines them (EX3-30,
EX3-85): each score / 4 × 100/7, summed to 0–100; ties break by mapping fidelity, familiarity,
hook clarity, reach, simplicity, visual payoff, visual strength, then candidate order. A candidate
whose `invented_rules` is not empty is picked only when every candidate has one.

**A1 — Simplicity (the right rung)**
Key: simplicity
Question:
Is this analogy on the lowest rung of the ladder of simplicity that still carries the whole mechanism without invented rules?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
The ladder: rung 1 is one object or physical effect; rung 2 is one everyday action by one character with at most three objects; rung 3 is a familiar everyday situation or place almost everyone has lived. Judge whether the candidate sits on the lowest rung that carries the whole mechanism, including why the concept matters, with no invented rules (anything the viewer must be told about how the analogy itself works). A lower rung that needs an invented rule is worse than a higher rung that needs none. Count the parts the viewer must track and penalize parts that add tracking without helping the mechanism. Do not reward simplicity for its own sake: a slightly richer analogy that fits the mechanism perfectly is not penalized for its extra fitting parts.
Levels:
- 0 — Wrong rung. Cluttered with parts and rules the mechanism does not need, or stripped down so far that it only works once its own rules are explained.
- 1 — Off. Either an invented contraption the viewer must be taught, or a busy situation whose parts compete with the mechanism.
- 2 — Workable. Close to the right rung: one part could be cut, or the scene leans on one small rule the viewer must be told.
- 3 — Right rung. The lowest rung that carries the mechanism without invented rules; every part helps.
- 4 — Effortless. The simplest picture that could carry this mechanism: nothing to cut and nothing to explain, whether a basic object or a familiar situation.

**A2 — Reach**
Key: reach
Question:
How many people would instantly understand the everyday situation this analogy uses?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Judge the everyday situation or objects themselves, not the technical concept. Reward situations and objects that nearly anyone understands instantly, whatever their country, job, or age, whether they are basic objects or familiar everyday situations. Penalize situations that need a specific culture, profession, hobby, or prior knowledge to understand.
Levels:
- 0 — Niche. Only people with specific expertise or experience would follow the situation.
- 1 — Limited. Familiar to a particular group, region, or profession, but many viewers would not recognize it.
- 2 — Common. Most adults would recognize the situation, though some details need explaining.
- 3 — Widely shared. Almost everyone has been in this situation and understands how it works without any setup.
- 4 — Universal. Anybody understands the situation instantly, with no setup, whoever they are.

**A3 — Mapping fidelity**
Key: mapping_fidelity
Question:
How closely does the way this analogy's elements interact, or the way its process unfolds, match how the concept actually works?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Compare the analogy's elements and process with the real mechanism, step by step. Reward analogies where each element stands for a real component and the interactions happen for the same reasons and in the same order as in the real system. Penalize mappings that break at an important step, teach a wrong mental model, or match only on the surface.
Levels:
- 0 — Misleading. The process works differently from the real mechanism; the viewer would learn the wrong model.
- 1 — Surface match. The elements resemble the real parts, but how they interact does not match how the system works.
- 2 — Partial. The central interaction matches, but at least one important step or part breaks and needs careful handling.
- 3 — Strong. The elements map onto the real components and the process unfolds the way the real one does, with only minor limits.
- 4 — Exact. Every element and every step corresponds to the real mechanism; the scene could carry the mapping and the example without becoming inaccurate.

**A4 — Visual strength**
Key: visual_strength
Question:
How strong is this analogy as a picture in the Helios paper style?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Judge the scene as drawn animation: isometric paper objects with ink outlines, simple cartoon critters for every character, everyday props, short labels, lines that draw themselves, and cuts between wide shots, close-ups and cutaways. Reward scenes where every element is recognizable at phone size without a label, from its silhouette alone, and whose mechanism is visible as motion and changing state rather than explained by narration. Penalize scenes that need people, hands or other body parts, facial detail, text, or things that are hard to draw simply.
Levels:
- 0 — Hard to show. The analogy lives in words; drawn, it would be static or unreadable.
- 1 — Weak picture. Some objects can be drawn, but the mechanism would mostly be told rather than shown.
- 2 — Workable picture. Recognizable objects and at least one meaningful motion show part of the mechanism.
- 3 — Strong picture. Clear silhouettes, a readable layout, and motion that shows the mechanism at work.
- 4 — Exceptional picture. The scene is instantly readable at phone size, the mechanism plays out as visible motion and state changes, and the eye moves through it naturally.

**A5 — Visual payoff**
Key: visual_payoff
Question:
How satisfying is the visual payoff this analogy builds to?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Judge the moment the analogy builds toward: the outcome the scene resolves on. Reward a payoff the viewer can anticipate and then see land as a clear, physical result (a stack completes, a door opens, the right package arrives). It must come from the mechanism itself. Penalize payoffs that are only stated, arbitrary, or decorative.
Levels:
- 0 — No payoff. Nothing in the scene resolves; it only shows a state.
- 1 — Weak payoff. Something resolves, but it is small, unclear, or only explained by narration.
- 2 — Clear payoff. A visible result lands, though with little anticipation or satisfaction.
- 3 — Satisfying payoff. The scene builds anticipation and resolves on a clear, physical result that comes from the mechanism.
- 4 — Memorable payoff. A built-up, visible, physical result that resolves the scene's tension so cleanly the viewer remembers it.

**A6 — Familiarity**
Key: familiarity
Question:
Does the viewer already know how this analogy behaves, without being told?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Judge the analogy on its own, as a viewer who has never seen it before. Reward situations, objects, and actions whose behavior the viewer already knows from life, so the reel can use what they know instead of teaching it. List any rule the viewer would have to be told for the analogy to work, such as what an invented object does or a property a familiar object does not really have; a candidate with any such invented rule scores at most 1. Penalize contraptions built to fit the concept.
Levels:
- 0 — Invented. A made-up contraption; nothing about it works until it is explained.
- 1 — Needs teaching. At least one rule about how it works must be told to the viewer.
- 2 — Mostly known. The viewer knows the situation, but one behavior the analogy relies on is unusual or must be pointed out.
- 3 — Known. The viewer already knows how everything in it behaves; the reel only has to show it.
- 4 — Second nature. Behavior so familiar the viewer predicts what happens next before it happens.

**A7 — Hook clarity**
Key: hook_clarity
Question:
Would a viewer with no context understand this analogy's opening moment within one second?
State fields:
- topic_title
- topic_scope
- candidate

Judge rule:
Judge the candidate's hook alone, as the very first thing a scrolling viewer sees, with no title, no narration, and no idea what the video is about. Reward a familiar situation with recognizable characters and objects and an obvious problem, surprise, or near-miss that makes the viewer want to see what happens. Penalize hooks that are niche, strange for their own sake, depend on the analogy's own rules, or show something the viewer cannot name.
Levels:
- 0 — Baffling. The viewer cannot tell what they are looking at.
- 1 — Confusing. Recognizable pieces, but the moment only makes sense once the analogy is explained.
- 2 — Readable. The viewer gets what they see after a moment, but nothing pulls them in.
- 3 — Clear. Understood at a glance, with a problem or surprise that invites a second look.
- 4 — Instant. Understood in a heartbeat and impossible not to watch: a familiar moment going wrong or about to happen.

**End of analogy scoring v3**

### Model-written prompts (text lives in code, approved by Lucas as text, R6)

| Prompt | File | Version | Status |
|---|---|---|---|
| Idea generator | `lib/explainers/ideas/generator.ts` | `idea-generator-v4` | approved in the 3.2 plan |
| Scope writer | `lib/explainers/ideas/generator.ts` | `scope-writer-v4` | approved in the 3.2 plan |
| Analogy writer | `lib/explainers/ideas/generator.ts` | `analogy-writer-v3` | approved in the 3.2 plan |
| Post caption | `lib/explainers/caption.ts` | `explainer-caption-v5` | draft, awaiting Lucas. Social captions redesign (2026-10-19): the Helios line closes the caption, at most 2 emoji (none in the Helios line or hashtags), and a rejected caption is retried once with the rejection reason. v4 was superseded before it shipped. Amended before v5 shipped (Tommy, 2026-10-20, after the first live check): the Helios line makes one concrete point in Helios's view (what Helios builds only when `include_build_line` is true), never a recent closing's opening, never a generic "how we think about it" tag, and a follow clause is rare; paragraphs are one or two sentences; usually one emoji leads the hook and one follows the ask. |
| Director | `explainers/director/SKILL.md` | `director-v7` | approved in the curiosity-gap plan (EX3-101) |
| Design truth | `explainers/frame-presets/helios/FRAME.md` = `explainers/recipe/frame.md` | `helios-explainer-v6` | approved in the 3.3 plan |

---

## Superseded (kept for the record; not in force)

| Was | Replaced by |
|---|---|
| EX3-60's holds (0.8–1.8s after each line, 1.5–2.0s on the opener) | EX3-79 (0.2s between lines; gaps inside lines cut to 0.15s, 0.2s at sentence ends) |
| EX3-61's title card in the opener's hold, cursive Hershey Script, the scene dimmed | EX3-79, EX3-80, EX3-81 (the top-band card writes during the line, in Hershey Sans) |
| EX3-70's "beat 6 on the same scene" and the tracker of the analogy's technical steps | EX3-87 (the example illustrated, tracker = the example's own steps) |
| EX3-71's picture check by the orchestrator itself | EX3-84 (the blind check) |
| frame.md and the scene builder: "a person is a critter or a figure built from simple solids"; critters optional | EX3-77 |
| Analogy writer v2's ask alone ("the simplest…") and analogy scoring v2's five keys | EX3-85 (the ladder; seven keys) |
| The director's `music:` mood ("calm, minimal, modern; never none") | EX3-82 |
| The 50–65s length as an error | EX3-79 (a warning; no word cuts) |
| EX3-79's tightening by word timestamps | EX3-89 (only measured silence) |
| EX3-83's over-the-shoulder and reverse shots, and an insert that "draws only the subject" | EX3-90 (a shot is a camera) |
| EX3-80's title card sliding in at about 0.6s | EX3-93 (from the first frame) |
| EX3-11's fixed opener line | EX3-96 (the template) |
| EX3-15's "beat 4 opens by setting the scene" | EX3-97 (beat 4 continues the scene) |
| EX3-97's frame 2 bridge (an "AI is in the same spot" sentence and "That's <term>.") | EX3-101 (the gap story and its promise) |
| The logo plate with the one-line thesis callback, and its 1s end hold | EX3-95 (the 2.5s voiceless close) |
| EX3-45's word-by-word caption fade | EX3-98 (typewriter) |
| BUILD_PLAN §7: the fixed seven-beat sheet (hook, analogy, mapping, worked example, technical catch, real-world context, close) | EX3-10 to EX3-19 |
| BUILD_PLAN §7 and the director: `persuasion` per frame | EX3-20 |
| BUILD_PLAN §5 and the director: "No network research. You have no web tools." | EX3-03, EX3-04 |
| BUILD_PLAN §8, E-12, A-1: white canvas, Lucide icons and geometric primitives, simple HTML/CSS scene-objects, eyebrows and headlines, expo.out-only motion, the beat-5 night ground | EX3-40 to EX3-47 |
| 1.0 caption skin: white pill, Roboto, centered | EX3-45 |
| 1.0 transitions: crossfade, push-slide, cut | EX3-46 |
| Optional `blueprint:` per frame | EX3-22 |
| The director invents the analogy in session A | EX3-15, EX3-30 |
| E-15 rationale: "Advanced concepts are not penalized simply for being advanced." | EX3-32 |
| E-15 Q1, Q2, Q3, Q4, Q6 text (`explainers-idea-scoring-v1`) | Idea scoring v2 (§ Packets) |
| E-14 theme brief v1 | Theme brief v2 (§ Packets) |
| `idea-generator-v1`, `scope-writer-v1`: "one technical insight or caveat" | EX3-35 |
| `explainer-caption-v2`: "analogy, example, catch … do not walk the seven beats" | `explainer-caption-v3` |
| `explainer-caption-v3` (and `explainer-caption-v4`, superseded before it shipped) | `explainer-caption-v5` (social captions redesign, 2026-10-19) |
| `director-v1`, `helios-explainer-v1` | `director-v3`, `helios-explainer-v3` |
| EX3-10 (3.0): the reel is 45s ± 3, frames as long as their voice | EX3-10 (3.1): 50–65s, voice + hold |
| EX3-11 (3.0): the opener shows the scene at its peak; the title in a voice gap | EX3-11, EX3-61, EX3-62 |
| EX3-12 (3.0): a `zoom-through` transition as a reset option | an in-frame zoom-through (EX3-12, EX3-46) |
| EX3-13 (3.0): the curiosity gap is not the analogy and uses its own visuals | EX3-13 (3.1): posed inside the anchor world |
| EX3-14 (3.0): the term appears as a label, never a headline | EX3-14 (3.1): the dictionary card plus a visual |
| EX3-16, EX3-17 (3.0): own visuals allowed with the trade-off stated | the scene, required; "because"; the technical tracker |
| EX3-23 (3.0): 6–20 words per frame | per-beat word ranges |
| EX3-35 (3.0): `idea-generator-v2`, `scope-writer-v2` (45-second wording) | `idea-generator-v3`, `scope-writer-v3` |
| EX3-45 (3.0): caption pages from the vendored grouping (2–3 words), 0.18s rise | EX3-45 (3.1): 7-word pages, 0.08s fade |
| EX3-46 (3.0): `cut` and `zoom-through` | `cut` only |
| Storyboard `sfx:` lines and the HeyGen `fetch-sfx` step | EX3-63: event-timed sound design |
| `analogy-writer-v1`; analogy scoring v1 | `analogy-writer-v2` (EX3-66); analogy scoring v2 (EX3-67) |
| Idea scoring v2 (`explainers-idea-scoring-v2`) | Idea scoring v3 (`ai_focus`, one-minute wording; EX3-73) |
| Theme brief v2 | Theme brief v3 (EX3-34) |
| `director-v3`, `helios-explainer-v3` | `director-v4`, `helios-explainer-v4` |
| Per-reel cap $5 | $8 (EX3-72) |
