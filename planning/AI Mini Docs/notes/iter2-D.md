# Iteration 2 — builder D (W4: sound designer + voice), 2026-10-29

## Files
- New `explainers/reel-ai-drama/prompts/sound-designer.md`: the designer's prompt. It covers the cold open, music by act, stingers, ambience, density and the ending, then 7 HARD CONSTRAINTs that code also enforces. It follows MD-63: sound is a full layer most viewers hear, designed for emotion, and the facts stay with the voice, captions and picture. The mute rule is not restated.
- New `lib/reel-ai-drama/render/sound-design.ts`: `designSound({ projectDir, draft, plan }, deps)` makes one call with `tool_choice` forced. The prompt and the library list form one cached system block, and the strict tool `submit_sound_cues` is cached too. It writes `sound_cues.json`, records the cost as `component: 'sound_design'` when `deps.db` is given, and fails open. Also exported: `validateCues`, `soundLibrary`, `soundCuesTool` and the `SoundCues` types.
- `kit/sound.mjs`: designed stingers (hit, sub plus a mid layer, riser, whoosh, silence with room tone) and ambience beds. When cues are present the design leads: worker ambience is dropped, a worker impact within 2 s of a designed hit is dropped, and a designed silence is kept clear. Also adds `readCues` (re-times cues from their anchors) and `STINGER_LIBRARY` (curated ids with measured land points).
- `kit/music.mjs`: in cue mode, music sections (start/change/drop/cut/resume) use per-section style and gain. The `MOOD_STYLES` keys are drone, dread, drive and reflect. An envelope (an envelope.wav multiplied in with `amultiply`) ducks music under the voice, lifts it +3.5 dB in pauses, applies swells (3 s rise, 1.5 s fall) and mutes designed silences, capped at 2.2× the bed level. Without cues, behaviour is unchanged.
- New `kit/pronounce.mjs`: `prepareTts`, `restoreSpelling`, plus the pure `ttsText`, `ttsScript` and `restoreWords`.
- Tests: `tests/reel-ai-drama-sound-{design,kit,pronounce}.test.ts` (15 tests) and the helper `tests/reel-ai-drama-sound-fixture.ts`. The kit tests run ffmpeg offline: placeSound and placeMusic place cues from a fixture `sound_cues.json`.

## The cue file
It follows the binding shape in ITERATION-2.md, with some additive fields:
- Each cue carries `at: { frame, word, offset }`, so the kit re-times it after a re-pace. Ambience carries `frames: [from, to]`.
- Stingers carry an optional `id`, and every cue carries a `why`.

Time meanings:
- hit and sub: `t` is the impact.
- riser: `t` is where it lands; it starts `dur` seconds earlier.
- whoosh: `t` is its peak.
- silence: starts at `t` and runs for `dur`.

Validation drops these cues, with a reason for each:
- anchors outside the reel
- unknown ids
- a heavy hit within 10 s of another
- a silence over a spoken word
- a riser that resolves into nothing
- music cues out of order
- more cues than the per-minute density caps allow (research 07 §7)

Overlapping ambience is trimmed rather than dropped. A missing cold-open bed or riser-to-hit arc only produces a `warning:`.

## Integrator: please wire these up
1. **run.ts stage.** After `runVoice` and pace (timing locked) and before the frame build or assemble, call `designSound({ projectDir, draft, plan }, { create, model: settings.orchestrator_model, db, jobId, mode })`. Expected cost is about $0.03–0.08. Add `usd` to the job spend, which `recordCost` already does, and surface `problems` as non-blocking warnings. If the voice is re-run later (lines changed), call it again. A plain re-pace is fine without it, because the cues are re-timed from their anchors. When it writes music cues, it sets `audio_meta.bgm = null` so that assemble lays the designed music.
2. **prompts.ts.** Add `'sound-designer'` to `PROMPT_NAMES`, then pass `loadPrompt: () => loadPrompt('sound-designer')`; the default reads the file directly. Regenerate `prompts-for-review.md`, since the writing test checks that every prompt name appears there.
3. **Voice hook in `runVoice`** (`render/voice.ts`). Pass the draft's `pronounce` in:
   - Before `audio`, call `const { script } = prepareTts(projectDir, draft.pronounce ?? [])`, imported from `@/explainers/reel-ai-drama/kit/pronounce.mjs`. Then use `'--script', script` instead of `'./SCRIPT.md'`.
   - Insert a step right after `audio` and before `sync-durations`: `['restore-spelling', ['assets/kit/pronounce.mjs', 'restore']]`. It rewrites the voiced words in `audio_meta.json` back to the writer's spelling, so captions, line spans and checks never see the respelling.
   - HeyGen takes plain text, so this is respelling, not SSML. The writer should give `say` in plain respelling, for example `duh-LAHNG`.
4. **Pace fix, the long pause before "Elon Musk" (00:07, Rosewood).** Measured:
   - Frame 2's voice ends at 3.163 s and pace computed 3.363 s for the frame, but the delivered STORYBOARD has 4.05 s. That is the director's estimate, written back by `writeProject()` after the integrity fix (W1's root cause). That alone adds 0.69 s of dead air.
   - pace.mjs never trims a non-opener frame's lead-in silence. `silenceCuts` keeps it "as recorded" unless `lead` is passed, and only the opener gets one. Frame 3's WAV starts with 0.138 s of silence, so even a correctly paced cut is TAIL 0.05 + HOLD 0.15 + 0.138 ≈ 0.34 s, above the 0.2 s maximum.
   - The heard gap was ≈ 1.03 s.
   - The caps inside a line (INNER_GAP 0.15, SENTENCE_GAP 0.2) do apply. Frame 3 had no fallback, and its text has no comma or ellipsis before the name.
   - **Fix in pace.mjs:** add `export const LINE_LEAD = 0.02` and in `tightenVoices` pass `{ lead: opener ? OPENER_LEAD : LINE_LEAD }` to `silenceCuts`. Then lower `HOLD` to 0.13 so that TAIL + HOLD + LINE_LEAD = 0.2 s between lines. `lostSound` already allows slack at the first run, so the speech-run check holds. Kit tests that pin HOLD = 0.15 need the new value.

## Open risks
- **Loudness.** The kit keeps the bed at −16.5 LUFS × 0.16 under the voice, and stingers are peak-matched and limited. But nothing in the pipeline masters the final mix to about −14 LUFS integrated with true peak ≤ −1 dBTP (research 07 §5). No `loudnorm` exists anywhere. That belongs in the final render mux, which is the integrator's or render's file.
- **Library.** It is thin for tension: one riser, two sub booms, no drone or pulse sound effects. The drone comes from the HeyGen music search (`drone` / `dread` styles), so a cold-open bed depends on what that search returns. Importing CC0 drones, pulses and reverse swells would help; that is a library gap for Lucas.
- **Ambience gains.** The recordings are quiet (about −38 LUFS). A default gain of 0.3 matches the existing kit, but that should be judged by ear on the first live run.
- **Pronunciation restore** matches the TTS words against `say`. If HeyGen re-spells or splits a respelling unexpectedly, that word keeps the TTS spelling in the captions. Check this on the first run that has a `pronounce` list.
