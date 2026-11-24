# Iteration 4 — inventory, process and build contract (approved 2026-11-02: MD-90–99)

Sources: Lucas's notes and MD-90–95 (`PLAN.md` § Iteration 4), the prompt audit (`notes/prompt-audit-iter4.md`,
ids M1–M12 / S1–S19 / N1–N9), the visual audits and the blind writing review (`test-runs/iter3-renders/`).

## Inventory

**Stays:** the flow from iteration 3 (pick → reporting ‖ harvest → spine → writer → story editor → cutouts → director →
wishes → makes → facts → voice → build → checks → deliver); fail-open (MD-65); per-scene one medium for people (MD-69);
anchors and "never not shown" (MD-60, variety by photo/framing/scale, not forced treatment, per MD-94); the whiteboard
and the 00:48-style "people drawn together on one board"; the kit's code-built treatments; prompt caching.

**Goes:**
- "Every line turns a value" applied to the opening; "backstory one line"; "exposition dump → cut it" (M3).
- Dates/names/roles "in labels, not sentences" (M2, M12); present-tense-for-immediacy and "never 'later'" as rules (M2, S14).
- The connective rotation list and "in varied words" checklist item; forced but/therefore alternation (M1, S9).
- Voice micro-rules: fragments, "a full stop for a beat", shortest-sentence climax, "high arousal", "documentary voice" (M4, N9).
- Per-frame voice clips read cold; the dead `speed` setting; silent beats up to 4s; 2–3 picture beats (M4, M5).
- "Each time a different treatment" as a mandate (director HARD 9 as written) (M7 → MD-94).
- Marks placed by eye/coordinates; fixed label spots; caption colour by frame type (S13, visual audits).
- "Upper third" face rule and the low default seats/lifts (M6).
- Unmarked or topic-specific examples: FRAME.md `$4M`/`founder`, "Six weeks earlier…", the 1854 "bad" example, "Nguyen" (S10–S12, N4).
- The director reading the whole writer craft (S6); rules repeated across layers (S7) — one owner each.

**New:**
- **Writing:** a setup block after the hook (time frame, where, who is present and how they relate, what each wants
  and why) exempt from the value-turn test (MD-95); hook may give away or tease the outcome per story (MD-90); every
  new part placed relative to one already set (S2); motive before any act that depends on it, for every person (S1);
  a join claims cause only when the line before states it (MD-95); narration speaks name + plain role + when/where,
  labels add exact titles/figures (M12); storyteller register (MD-93).
- **Script check before the voice:** see Question 1.
- **Voice/pace:** one take per script (or per rung), split into frames by HeyGen word timestamps; atempo ≈1.12 after
  recording; word budget up to the caption ceiling; silent beats ≈1s max; one picture beat at most (MD-91, MD-93).
- **Close:** the close stretches to fit its question (Best on Paper ended inside "chatbots?").
- **Director craft:** manipulate sources ("lift from the artifact": cut a person or item out of an article/post/page,
  original left visible, scrapbook motion + sound + marks); animated `stat` graphics with their own sound; the
  whiteboard carries context (event, year, names, prize); every drawn person labelled; no on-screen text that repeats
  the narration or the article; opening frame = the image that carries the hook (+ a small date label).
- **Kit:** marks anchored to measured targets (face boxes, Tesseract word boxes, a drawing's alpha bounds), ring size
  = target; keep-out zones (faces, captions, article text) for labels; subject centre at y≈800–1100 in the centre
  column, defaults moved there; caption colour/backing plate from sampling what's under it; nothing visible before its
  content (no empty boxes, entrances start off-screen fully); `stat` family (counter, bar, scale comparison) with cues;
  `lift` treatment; made drawings background-removed at make time (transparent PNG).
- **Harvest:** no source whitelist (MD-96): reposts and aggregators stay; integrity judges whether an image IS the
  real artifact it is used as (a parody/"pretend" recreation is not); identity check on person photos; prefer period-matching photos in dated beats (S15);
  resolution floor; diagnose why every wish search found nothing and why anchors went to the wrong person.
- **Checks (fail-open, one fix):** screen check adds caption contrast, mark-on-target, text over a face, duplicate
  person, white box, blank/empty-box frames, subject off-centre; first viewer asks when/where/who/why (S16); script
  findings never go to the picture-only fixer (M11).

## Process (what changes, step by step)

| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Reporting | pitch, web | facts + **relations** (near/across/same day/rival of) and the **when** of each event | fact sheet |
| Harvest | fact sheet | **vetted** media; identity + period checks | inventory |
| Spine | facts, inventory | plot + **setup part** (when, where, who present, wants) | spine |
| Writer | spine, facts | script: hook + setup block + story, storyteller register | draft |
| Story editor | draft, spine | ranked faults **+ an always-checked list** (when, who present, motive-before-act, joins) | repaired draft, flags |
| Story editor, round 1 (MD-97) | **the narration only** (blind) | comprehension read + always-checked list | faults → flags (one repair round as today) |
| Director | script, inventory, structure craft (not the whole writer craft) | shots, **lifts, stat graphics, board context** | plan |
| Wishes / makes | plan | search; drawings **transparent** | assets |
| Voice | script | **one take**, split by word timestamps, **atempo ≈1.12** | audio + timing |
| Build / kit | plan, FRAME.md | **anchored marks, keep-outs, centred subjects, sampled caption colour** | frames |
| Checks | render | new screen checks; one fix; ship with warnings | reel + flags |

## Build plan (after approval; same shape as iteration 3)

- **Phase 0 (me):** contract — new fields (`spine.setup`, `facts.relations`, `facts.when`, plan treatments `lift`,
  `stat`, mark `target` refs), check ids, settings (`voice_tempo`, word budget). Logged MDs first for every amended
  decision (MD-60/69/88 done as MD-94/95).
- **Phase 1, parallel (one owner per file):**
  - **Me — prompts:** spine-writer, writer, writer-revise, story-editor, plot-craft, writer-craft (collapse to principles,
    S8), director, director-craft, FRAME.md prose, first-viewer, integrity, sound-designer; a shared short
    structure/timing file for the director (S6). Lens on every edit.
  - **Builder A — writing code, voice, pace, close:** one-take voice + split, atempo, pace.mjs limits, close timing,
    script-reader step (if Q1 = yes), routing of script findings.
  - **Builder B — harvest:** vetting, identity/period checks, wish-search diagnosis + fix, anchor mix-up diagnosis +
    fix, transparent makes, `lift` asset prep (crop + cut out of an artifact).
  - **Builder C — kit + checks:** anchored marks (faces/Tesseract/alpha), keep-outs, centring defaults, caption
    sampling, no-empty-entrances, `stat` family with cues, `lift` treatment, new screen checks.
- **Phase 2:** name cross-check script; a fresh read-only prompt reviewer (contradictions, altitude, pollution,
  repeats); I review every prompt diff; tests + typecheck green. Re-run the visual audits' failing cases on single
  test frames (no model) before any live run.
- **Phase 3:** one live run per reel on Lucas's go-ahead (~$7–9 each at iteration-3 prices).

---

# Build contract (Phase 0 — shared names; nobody renames these)

Hard limits for every builder: edit only your files below. Never edit `lib/explainers/**`, `lib/real-case/**`, or
`explainers/` outside `explainers/reel-ai-drama/` (shared skill scripts such as the job's `faceless-explainer`
`audio.mjs` and `media-use/audio/*` may be CALLED, never edited). No live Claude/HeyGen/web calls in tests or
during the build. No commits. No DB session `SET`s. Prompt caching on any new `messages.create`.
Coordinate through `planning/AI Mini Docs/notes/iter4-builders.md` (append; say who needs what).

## Shared names
- `Spine.setup` (types.ts): `{ when: string; where: string; present: { name: string; relation: string }[];
  wants: { name: string; want: string; why: string }[]; fact_ids: string[] }` — the establishing block after the
  hook (MD-95). Exempt from value turns. Writer rungs voicing it carry `spine_ids: ['setup']`.
- `FactSheet.relations?` (types.ts): `{ a: string; relation: string; b: string; fact_ids: string[] }[]` — places
  and people relative to each other (near, across from, same week as, rival of, works for). Optional on old sheets.
- Treatments (schemas.ts `TREATMENTS`): add `'stat'` (code-built animated number beat: counter, bar, scale
  comparison; no asset required) and `'lift'` (an artifact asset with a person or picture lifted off it, the
  original page left visible; in `ASSET_TREATMENTS` and `CHARACTER_TREATMENTS`).
- **Box sidecars** (B writes, C reads): for every image in the job media, `<file>.boxes.json` =
  `{ faces: Box[]; words: { text: string; box: Box }[]; photos: Box[]; lift: string | null }`, Box =
  `{ x, y, w, h }` normalised 0–1 to the image, top-left origin. `words` from Tesseract TSV (local, no AI);
  `photos` = picture regions inside a page/post/article image; `lift` = file name of a transparent PNG cut out of
  the main face-bearing photo region (rembg), or null. Copied into the render project with the media.
- Kit mark API (C): marks name a target by kind — `face:<person or index>`, `text:"<phrase>"`, `el:<element>` —
  and the kit computes the box from the sidecar or the element's measured bounds through every transform; ring
  size = target. No coordinate input remains in FRAME.md for marks.
- Settings (settings.ts, DB-backed like the others): `voice_tempo` (default 1.12, applied with ffmpeg `atempo`
  after recording), `words_per_minute_target` (default 180), `silent_beat_max` (default 1.0 s).
- Prompts/craft: new craft file `craft/story-timing.md` (the short structure + timing rules the director needs;
  replaces the director's copy of writer-craft — S6). Prompt names unchanged otherwise.
- Check ids (screen, C): `caption_contrast`, `mark_off_target`, `text_over_face`, `duplicate_person`, `white_box`,
  `empty_frame`, `subject_off_centre` (plus existing). All fail open: one fix round, then a flag.

## Owners
### D — prompts (a builder; Claude reviews every diff)
`explainers/reel-ai-drama/prompts/{spine-writer,writer,writer-revise,story-editor,director,first-viewer,integrity,
sound-designer,reporting,frame-worker,fix}.md`, `craft/{plot-craft,writer-craft,director-craft}.md`, new
`craft/story-timing.md`. Work list: every M/S/N finding in `notes/prompt-audit-iter4.md`, re-read against MD-90–99
(MD-94 replaces the audit's M7 "one style per reel" direction; MD-96 replaces any whitelist idea), and the
"Plan changes" of this file. Collapse writer-craft to principles (S8). One owner per rule (S7).
### A — writing code, voice, pace, close, run
`lib/reel-ai-drama/types.ts`, `writing/**`, `reporting/**`, `prompts.ts`, `settings.ts`, `production/**`,
`render/voice.ts`, `render/assemble.ts`, `kit/pace.mjs`, `kit/close.js`, `kit/close-timing.js`, tests for these.
- Spine/writer/editor schemas + validators for `setup`; reporting schema for `relations`; TREATMENTS additions.
- Story editor round 1 reads the narration only (MD-97); the always-checked list's faults are never capped away.
- First-viewer findings about the words become flags, never inputs to the picture-only fix (M11).
- One-take voice: voice the whole script (or per rung if HeyGen limits length) via the shared heygen TTS script,
  split per frame with the returned word timestamps, `atempo` by `voice_tempo`, write the same `audio_meta.json`
  shape downstream already reads. Pace: silent beats ≤ `silent_beat_max`; fix the `OPENER_TEMPO` comment/value.
- Close: its length stretches to fit the close question's voice (BoP ended inside "chatbots?").
- `directorSystem()` = director + director-craft + story-timing + FRAME.md.
### B — harvest and assets
`lib/reel-ai-drama/harvest/**`, `render/make.ts`, `render/wishes.ts` (search side only if it lives there; else
`harvest/`), `prompts/harvest-look.md`, harvest tests.
- **Diagnose first, report in the notes file, then fix:** (1) why every wish search in jobs `9a30dce0…` and
  `e0b585e7…` found nothing (W2–W6 Rosewood, W4–W6 BoP); (2) why anchors went to the wrong person (Rosewood frame 1:
  Sutskever's picture under a Musk caption; frame 8: Musk for an Amodei line; frame 5: a Hassabis label on a drawing
  of other people). If a cause lives in another owner's file, write the fix request in the notes file.
- Box sidecars (above). Made drawings and harvest sketches background-removed at make time (transparent PNG).
- No source whitelist (MD-96). Identity check on person photos; prefer period photos when the story is dated;
  resolution floor with upscale for small useful images.
### C — kit, captions, screen checks
`explainers/reel-ai-drama/kit/**` except A's three files, `presets/reel-ai-drama/caption-skin.html`,
`kit/FRAME.md` (API + mechanics; prose rules come from D — put D's requested wording in verbatim),
`lib/reel-ai-drama/checks/variety.ts`, kit/screen tests.
- Anchored marks (above). Keep-out zones: labels never on faces, captions or article text. Subject visual centre
  y≈800–1100 in the centre column; seats/lifts/lower-third/number defaults moved. Caption colour or backing plate
  from sampling what's under the caption. Nothing visible before its content (no empty boxes, entrances fully
  off-screen). `stat` family with sound cues. `lift` treatment from the sidecar's `lift` PNG. Drawn elements never
  show paper. Per-scene one style for faces (MD-94) as a variety check (`style_mix`). New screen checks above.
- A local gallery page (`kit/gallery.mjs`) rendering each fixed case (marks on target, centred subject, caption on
  white article, stat, lift, transparent drawing on a dark ground) for screenshots — no model.

## Acceptance (offline)
- `npx tsx --test tests/reel-ai-drama*.test.ts` passes; no new `tsc` errors in reel-ai-drama files.
- Gallery screenshots show each visual fix. B's diagnosis is written with evidence.
- Prompts regenerated into `prompts-for-review.md`; fresh read-only reviewer: no must-fix left.
- Then live (MD-99): Rosewood and Best on Paper, fresh spine and writer, ~$8–9 each.
