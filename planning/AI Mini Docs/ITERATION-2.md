# Iteration 2 — build contract (2026-10-29)

Source: Lucas's notes on the Rosewood and TensorFlow reels (PLAN.md § Iteration 2) and decisions MD-58 to
MD-62. Every builder reads PLAN.md § Iteration 2, this file, `CONTRACT.md` and the prompt-review lens below.

## Diagnosis (measured, not guessed)
- **Cut-off scenes:** `run.ts` rewrites STORYBOARD.md after the integrity fix (`writeProject()`) with the
  director's estimated durations; `assemble.mjs` only paces when `assets/timing/` is missing, so the voice
  durations are never restored. 9/18 Rosewood and 6/15 TensorFlow frames are shorter than their voice.
- **Empty frames / photos "not loading":** the harvest found 6 Brockman photos and the frames used them.
  Media is unresized (3840 px, 214 MB in Rosewood). Images are not ready when the renderer captures.
- **Lazy, uniform visuals:** a direction problem (prompt + missing tools), not a sourcing gap.

## Workstreams and owners (one owner per file)

### W1 — Breakage: measure, rebuild ×2, fail open (MD-58) — owner: integrator (Claude, main session)
Files: `lib/reel-ai-drama/production/run.ts`, `lib/reel-ai-drama/render/{voice,assemble,workspace}.ts`,
`explainers/reel-ai-drama/kit/{assemble,pace,bounds,browser,mount}.mjs`, new `kit/screen.mjs`,
`kit/components/{camera,treatments,dom}.js` (entrance + plate fixes only), tests.
- Timing can't drift: assemble always re-paces from audio_meta (pace must be idempotent); any change to a
  frame's lines re-runs the voice for that frame. Check `voice_cut`: every voiced frame ≥ voice_end + hold.
- Media is normalised at harvest copy: long edge ≤ 2160 px, JPEG/PNG re-encoded; frames await every image
  `decode()` before the first painted frame in the real render path, not only in the check browser.
- New measured checks (deterministic, real browser, every 0.2 s), problem ids below.
- Overlay text on photos/pages gets a backing plate from the kit automatically (not a director choice).
- Entrances start fully outside the frame, computed from the element's own box.
- run.ts: breakage → rebuild session → re-measure → rebuild session → re-measure → flag what's left.
  Re-measure again after the first-viewer fix (one more rebuild if it broke something).

### W2 — Harvest: every character, many looks, one anchor (MD-60) — owner: builder B
Files: `lib/reel-ai-drama/harvest/**`, `explainers/reel-ai-drama/prompts/harvest-look.md`, tests.
- Every cast person gets ≥ 1 usable portrait (target ≥ 4 distinct looks for main characters) from
  Wikidata/Commons, Serper image search (watermark/TV-logo filter stays), official bio/press pages, the
  cutout bank. One per person is marked `anchor_for`.
- Face box per portrait (`face`), so crops keep the face in the upper third, never "a shot of his shirt".
- Low-res portraits (< 1200 px short edge) used as anchors or full-frame are upscaled (Real-ESRGAN).
- No clean photo anywhere → a line sketch traced from any reference photo (MD-14), marked `made`.

### W3 — Director, makes and kit (MD-59, MD-60) — owner: builder C (after research 06 lands)
Files: `explainers/reel-ai-drama/prompts/{director,frame-worker,build-workflow,fix}.md`,
`explainers/reel-ai-drama/kit/components/scenes.js` + new `kit/settings/` (seeded inspiration),
new `lib/reel-ai-drama/render/make.ts` (generate requested assets), `lib/reel-ai-drama/writing/schemas.ts`
(plan schema fields only), plan checks, tests.
- Seeded settings (dinner table, boardroom, stage, split phone call, courtroom/hearing), expression sketches
  and collage layers are **inspiration used only on an exact match**; otherwise the director requests a
  `make` that fits the moment precisely (MD-59). Makes are drawn, traced or code-built, never photoreal.
- Variety with an anchor: no person shown the same way more than twice in a row (code check on the plan);
  each main character's anchor image recurs (MD-60).
- Craft from research 06: composed shots (cutouts staged in settings, whiteboard sketches with expression,
  collage), the subject framed as the subject, on-screen text never repeating text already in the shot.

### W4 — Sound designer + voice (MD-61) — owner: builder D (after research 07 lands)
Files: new `explainers/reel-ai-drama/prompts/sound-designer.md`, new `lib/reel-ai-drama/render/sound-design.ts`,
`explainers/reel-ai-drama/kit/{music,sound}.mjs` (cue consumption), voice pronunciation, tests.
- Runs after timing is locked (after pace), Sonnet, one call, cached prefix, ≈ $0.10. Writes `sound_cues.json`.
- Cold-open tension (riser → hit on the hook), music drops/swells on reveals, a change at the turn,
  stingers on key lines, silence used on purpose.
- Pronunciation: the writer's `pronounce` list is applied to the TTS text (respelling or SSML if HeyGen
  supports it) without changing captions.

### W5 — Writer — owner: integrator
Files: `explainers/reel-ai-drama/prompts/{writer,writer-revise,post-text}.md`, `writing/schemas.ts` (draft field).
- Any phrase a newcomer can't decode is an error ("It turned on one weekend").
- The close question is one viewers would genuinely argue both ways.
- `pronounce: { word, say }[]` for non-English names.

## Shared names (Phase 0 — nobody renames these)
```ts
// Asset (types.ts) additions
anchor_for: string | null;                       // cast name this is the anchor portrait of
face: { x: number; y: number; w: number; h: number } | null; // normalised 0–1 box of the main face
made_kind: 'sketch' | 'setting' | 'expression' | 'collage' | 'drawing' | null;

// DirectorPlan additions
makes: MakeRequest[];
type MakeRequest = {
  id: string;                 // M1, M2… (frames reference it in asset_ids like any asset)
  kind: 'setting' | 'expression' | 'collage' | 'drawing';
  brief: string;              // exactly what the moment needs
  people: string[];           // cast names involved (expression sketches trace their anchor/portrait)
  from_assets: string[];      // asset ids it traces/composes from
  seed: string | null;        // a seeded setting id when it is an EXACT match; else null
};
// StoryboardFrame addition: who appears and how (for the variety check)
shows: { person: string; asset_id: string; treatment: string }[];

// WriterDraft addition
pronounce: { word: string; say: string }[];
```
Breakage problem ids (W1, `assembled.problems[].id`): `voice_cut`, `empty_frame`, `image_unloaded`,
`text_cut_off`, `off_frame`, `text_over_text`, `low_contrast`, `early_visible`, `under_captions`, `too_small`.
Sound cues file `sound_cues.json`:
```json
{ "music": [{ "t": 0, "action": "start|drop|swell|change|cut|resume", "style": "string|null", "gain": 0.16 }],
  "stingers": [{ "t": 0, "kind": "hit|riser|whoosh|sub|silence", "dur": 0.0, "gain": 1 }],
  "ambience": [{ "start": 0, "end": 0, "id": "string", "gain": 0.1 }] }
```

## Prompt-review lens (every prompt edit)
1. Altitude that covers every story, never the two test reels. 2. No example pollution (any example is
marked illustrative and generic). 3. No contradictions with the rest of the prompt. 4. MECE: each rule in
one prompt. 5. Musts are HARD CONSTRAINTs; the rest is craft.

## Acceptance (all offline; no live Claude/HeyGen/web calls in tests)
- `npx tsx --test tests/reel-ai-drama*.test.ts` and `npx tsc --noEmit` pass.
- Re-running assemble on the two delivered projects reports `voice_cut` = 0 after the pace fix, and the
  measured checks reproduce at least the empty-frame and off-edge problems Lucas listed (offline, local files).
- Prompts regenerated into `prompts-for-review.md`; Lucas approves before the next live run.
- One live run, with Lucas's go-ahead and cap.

## Status — W1 + W5 (integrator, 2026-10-29)
- **Three more root causes found by running the new screen check offline on both delivered reels:**
  1. Image paths: frames wrote `ctx.assets + file` where `file` already starts with `assets/`
     (→ `assets/assets/media/…`, broken in the render), or passed the media record itself as `src`
     (`[object Object]`). Fixed in the kit: `settleImages` canonicalises every `<img>` path and awaits
     load + `decode()` before frame 0 (mount + check harness); `h()` accepts a media record for `src`.
  2. Brockman's 10 photos were all `identity:probable`, so the director staged a faceless placeholder
     (routed to builder B; director prompt forbids placeholders for main characters — builder C).
  3. Collision cutouts started at a fixed −520 px offset, which left wide cutouts on screen before
     their entrance; now offset by their own width.
- `kit/screen.mjs` (new, deterministic, every 0.2 s): empty_frame, image_unloaded, off_frame (parked, or
  mostly off for ≥ 1 s), early_visible, low_contrast (WCAG, sampled from the picture behind),
  text_over_text (busy picture, no plate). Reproduces Lucas's notes at Rosewood 00:41/00:48/00:50/1:01
  and TensorFlow 0:01, 00:20, 00:49, 1:11, the whiteboard text. **Known limit:** framing inside a
  picture (a logo cropped off inside a page screenshot) is invisible to DOM checks; the first viewer
  (vision) owns it.
- `assemble.mjs` always re-paces (idempotent) and reports `[voice_cut]`; run.ts re-voices when a fix
  changed the lines; breakage: measure → rebuild ×2 → flag; one more rebuild after the first-viewer fix.
- `nk.plate(el, {tone})`; lower thirds plated by default.
- Writer: HARD CONSTRAINT 8 (every line decodes for a newcomer), close question must be arguable,
  `pronounce` output field (schema field pending — `writing/schemas.ts` is builder C's file).
- Tests: 123 pass (5 new in `tests/reel-ai-drama-screen.test.ts`).

## Status — integration (2026-10-29)
- W2 harvest (B), W3 director/makes/kit (C), W4 sound/voice (D) wired into run.ts/live.ts: variety
  findings → one director fix round → flags; makes before the workspace and after the integrity fix
  (fail open, `planWithoutFailedMakes`); sound design before the build; `pronounce` through the writer,
  revision and voice; pace LINE_LEAD 0.02 + HOLD 0.13; loudness mastered to −14 LUFS / −1 dBTP after
  render; face-following crop (`faceFocus`, face on the upper third); number + lower third plated.
- Prompt review (fresh reviewer): 3 must-fix, 13 should-fix, 6 nits — all applied (pronounce in the
  tool schemas, image check exempts made visuals and anchors, MD-63 mute framing, sound ownership,
  cold-open arc, seeds vs makes, HC wording, bounds ids, MECE pointers to FRAME.md).
- Open for Lucas: HC9 "no two adjacent frames share a staging type" is a builder-added must (Lucas asked
  only for the same-person rule); prompts approval; the live run.
- Tests: 167 Reel AI Drama + 588 Explainers/Real Case pass; tsc clean.
