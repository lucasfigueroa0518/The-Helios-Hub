# Hook sound effects: build plan

A standalone build plan for adding seeded sound effects to the visual hooks. It is separate from the music-selection plan (`MUSIC_SELECTION_PLAN.md`) and from the numbered builds in `BUILD_PLAN.md`.

Operating rules R1–R10 in `BUILD_PLAN.md` Section 1 apply here in full. Lucas makes the product decisions. Every decision below came from the planning interview on 2026-09-27. Anything not written here is open: ask Lucas before building it. Carry the decisions in Section 4 into the Decision Log (`BUILD_PLAN.md` 8.1) per R8.

## 1. Goal

Each visual hook gets a sound effect that lines up exactly with the frames where the hook is shown.

- There are 6 hooks and 3 timing patterns, which makes 18 combinations. Each combination gets its own finished sound effect.
- A hook uses one source SFX across its 3 timings. That source SFX is never used for any of the other 5 hooks.
- The source SFX may be manipulated so it lines up with the frames.
- After the last flicker there is a cushion of up to 2 frames, so the sound doesn't cut off unnaturally at the exact last frame.

## 2. Current state (verified in the repo, 2026-09-27)

**Hooks** (`lib/reels/visual/hook.ts`): `glitch`, `color_bars`, `invert`, `vhs`, `thermal`, `blue_screen`.

**Timings** (`HOOK_TIMINGS`). Spans alternate on/off, starting with on:

- `double`: 0.2 on, 0.1 off, 0.2 on
- `strobe`: 0.1 on, 0.1 off, 0.1 on, 0.1 off, 0.1 on
- `tail`: 0.1 on, 0.1 off, 0.1 on, 0.1 off, 0.2 on

**Rendering:**

- The hook starts at frame 0 of the reel.
- The timing is picked at random with `pickHookTiming()` when the hook is stamped.
- Frames are rounded by `timingSpanFrames()`.
- `overlayPlate()` in `lib/reels/visual/overlay.ts` renders with `-an`, so reels are currently silent.

**Fallbacks** (`compose()` in `lib/reels/visual/video-run.ts`): if the chosen hook fails, the renderer retries with `invert`. If that also fails, the reel ships without a hook.

**Frame rate:** reel clips are 24 fps, 720×1280. This was probed from `tmp/hook-test/*.mp4`.

### 2.1 Frame map at 24 fps

This comes from the repo's own rounding in `timingSpanFrames()`. One frame is 41.67 ms.

| Timing | On-frames | Off-frames | Last on-frame | Cushion ends by (last + 2) | Audio must be silent from |
|---|---|---|---|---|---|
| double | 0–4, 7–11 | 5–6 | 11 | frame 13 | frame 14 (0.583 s) |
| strobe | 0–1, 5–6, 10–11 | 2–4, 7–9 | 11 | frame 13 | frame 14 (0.583 s) |
| tail | 0–1, 5–6, 10–13 | 2–4, 7–9 | 13 | frame 15 | frame 16 (0.667 s) |

Build these from `timingOnRanges()` and the probed fps. Don't hardcode them. The table is here so everyone can check the numbers.

### 2.2 Source SFX library

The files are in `planning/Trial Reels/SFX candidates/`. There are 16 WAVs, all 96 kHz, 24-bit, stereo.

First-pass analysis:

- Envelope is RMS in 10 ms windows.
- "Audible" means within 30 dB of the file's peak.
- "Bursts" means within 20 dB of the peak.

| File | Length | Peak | Audible | Shape |
|---|---|---|---|---|
| Crackle Glitch | 1.068 s | −10.9 dBFS | 110–580 ms | one dense burst |
| Deep End Glitch | 0.634 s | −8.0 | 20–520 ms | one burst, decays |
| Double Glitch | 1.535 s | −6.9 | 10–1440 ms | many short bursts |
| Fast Distort Glitch | 0.968 s | −7.6 | 70–950 ms | sustained |
| Glitch Bass Fast | 0.667 s | −3.4 | 130–430 ms | short, loud bass hit |
| Glitch Bass | 0.801 s | −2.3 | 130–520 ms | bass hit, slightly longer |
| Glitch Close Long | 2.803 s | −6.9 | 0–830 ms | stuttered bursts, long silent tail |
| Glitch Sci-Fi | 1.235 s | −6.6 | 50–1150 ms | sustained |
| Old TV Error | 3.971 s | −32.0 | 0–3960 ms | steady noise, very quiet |
| Old TV | 3.570 s | −18.5 | 290–2900 ms | irregular bursts |
| On OFF Noise | 1.902 s | −12.7 | 100–1330 ms | on/off noise pattern |
| Pulse Glitch | 1.201 s | −10.0 | 270–910 ms | sustained, late start |
| TV Glitch | 1.201 s | −21.4 | 30–610 ms | sustained, quiet |
| TV Noise | 2.402 s | −24.9 | 0–2390 ms | steady noise, quiet |
| VHS Smooth Glitch | 0.567 s | −14.1 | 50–540 ms | sustained |
| Whoosh Glitch | 0.968 s | −15.9 | 40–660 ms | swell |

Every source is longer than the 0.58–0.67 s hook window. Several start 100–300 ms late, and some are 20–30 dB quieter than others. Trimming, gating, and loudness matching will be needed.

## 3. Out of scope

- Music. The music plan covers it.
- Changing the hook visuals, timings, or frame rate.
- Adding new source SFX beyond the 16 in the folder.
- Any other change to the render pipeline beyond adding this audio track.

## 4. Decisions (planning interview, 2026-09-27)

| ID | Decision |
|---|---|
| SFX-01 | **Gated per flicker.** Sound plays only on the on-frames and is silent on the off-frames, so the stutter is audible. |
| SFX-02 | **Pre-built, stored files.** The 18 finished sound effects are made once and stored. At render time, the pipeline attaches the file for the hook and timing actually used. |
| SFX-03 | **Pairing: the agent proposes, Lucas listens.** The agent proposes 2 candidate source SFX per hook. Lucas picks one per hook by ear. The final six must be six different source files. A candidate may be proposed for more than one hook. |
| SFX-04 | **Allowed manipulations:** trim and gate, time-stretch, pitch shift, gain, and short fades at gate edges to prevent clicks. Nothing else, such as layering or combining sources, without asking. |
| SFX-05 | **Cushion:** the sound may end anywhere within the 2 frames after the last on-frame. The agent tunes this per SFX, and Lucas judges it by ear at review. |
| SFX-06 | **Loudness:** all 18 finished files are normalized to the same loudness target. |
| SFX-07 | **Fallbacks follow the actual hook.** If the render falls back to `invert`, it gets invert's SFX for the same timing. If there's no hook, there's no SFX. |
| SFX-08 | **Review happens on a page in the Hub**, in Trial Reels. |
| SFX-09 | **Verification:** an automated frame test on every finished file, plus a waveform-over-frames chart for every combination on the review page. |

## 5. Values Lucas sets from evidence (R4, R5)

These change what gets heard, so the agent brings options and evidence, and Lucas picks.

| ID | Value | How to bring it |
|---|---|---|
| SFX-V1 | The six pairings | Two candidates per hook, rendered on the review page (Stage 2). |
| SFX-V2 | Loudness target, in LUFS or peak | Two or three targets applied to the finished files. Lucas listens on the review page. |
| SFX-V3 | Gate-edge fade length | Show whether the proposed length clicks or smears across a 1-frame gap. It has to fit inside the 2-frame on-spans of `strobe` and `tail`. |
| SFX-V4 | Frame-test tolerances | The silence threshold for off-frames and the allowed onset slop at the start of each on-span. Show the test results at 2–3 settings. |

## 6. Stages

### Stage 1: Analyze the sources

- Build a script that reads each of the 16 WAVs and writes an analysis record. Each record holds the onset times, the envelope, the audible span, and the peak/loudness.
- This drives the candidate proposals and is saved for the review page.
- It doesn't change any audio.

### Stage 2: Propose candidates (review gate 1)

- For each hook, propose 2 candidate source SFX, with a one-line reason for each. The reason covers why the source's character fits that hook's look.
- For each candidate, make a draft of all 3 timings. Apply SFX-01 and SFX-04, and the cushion from SFX-05.
- Render each draft onto a real reel clip with that hook stamped, so Lucas hears it with the picture.
- The review page shows each hook with its 2 candidates, all 3 timings each, playable, next to the waveform-over-frames chart (Stage 4).
- Lucas picks one source per hook. That settles SFX-V1.
- If he rejects both candidates for a hook, propose 2 more.

### Stage 3: Produce the 18 finished files (review gate 2)

- From the six chosen sources, produce the finished file for every hook × timing. Apply:
  - SFX-01: gated per flicker
  - SFX-04: only the allowed manipulations
  - SFX-05: cushion
  - SFX-06: matched loudness, at the target Lucas picks for SFX-V2
- Each file starts at frame 0, which is when the hook starts. Its length runs to the end of its cushion.
- Store the 18 files, plus a manifest recording, for each file, the source used and the manipulations applied. Use names like `<hook>-<timing>.wav`.
- Lucas listens to all 18 on the review page and approves or sends back specific files.

### Stage 4: Verification

**Automated frame test.** It runs in the test suite against every file in the manifest. It computes the frame map from `timingOnRanges()` at the reel fps and checks three things:

- Sound is present in every on-span, starting within the SFX-V4 onset tolerance.
- Every off-span is below the SFX-V4 silence threshold.
- Nothing is above the threshold after the cushion end in Section 2.1.

**Waveform-over-frames chart.** One per combination, on the review page. It shows the audio envelope with the frame grid, the shaded on-frames, and the cushion window marked. Lucas sees the alignment, not just a pass/fail.

**Render check.** A test renders a real reel for each timing and confirms that the muxed audio in the final MP4 starts at 0 with no offset.

### Stage 5: Wire it into the render

- Change `overlayPlate()` so the final reel carries the SFX file for the hook and timing that was actually stamped, per SFX-07.
- The rest of the reel after the SFX is silent. There is no other audio in this build.
- Log which SFX file was attached, alongside the existing hook and timing record (`motionRecord`).
- If attaching the audio fails, follow the render pipeline's existing fail-open pattern: the reel ships silent, with a notice. Confirm this with Lucas at the Stage 3 gate before relying on it.

## 7. Done when

- Lucas has picked the six pairings (SFX-V1) and approved all 18 finished files.
- The frame test passes for all 18 files at the tolerances Lucas set.
- The review page shows every combination with its chart.
- New reels render with the correct SFX for the hook and timing actually used, including the `invert` fallback, and render silent when there's no hook.

## 8. Dependency on the music plan

The music plan's song-versus-SFX mix test (MUS-V2) needs these finished SFX files. Finish Stage 3 before that test runs.
