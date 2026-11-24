# Pre-mortem — iteration 3 (2026-11-02)

Premise: the next two full reels came back bad. Why? Every complaint Lucas made on the v1 and v2 reels, the
fix that targets it, the evidence so far, and the honest verdict.

**Verdicts:**
- **Fixed:** root cause found, fixed and tested offline.
- **Likely:** the right mechanism is in place, but not yet proven live.
- **Partial:** a gap remains.
- **Unverified:** never run live.

## Writing and story (v2's main failure)

| Complaint | Fix | Evidence | Verdict |
|---|---|---|---|
| Wrong scope (dinner → lawsuit) | Bounded pitch (MD-66), the spine's question and end point, episode length (MD-78), the editor's step 1 | Rosewood's spine is now the dinner; GPUs drifted, which is why MD-78 exists | **Likely**, after MD-78/79 |
| Facts with no plot | The spine's but/therefore and value turns; the editor's steps 4 and 6 | All 3 spines are causal; Best on Paper is properly dramatic | **Likely** |
| Characters used before they're introduced | Spine cast `introduced_in`, writer HC, editor step 5 | Spines pass; never tested on a script | **Likely** |
| Lawsuit with no reason | Motive before action (spine HC5), the "orphan event" repair | Rosewood's spine no longer plays the lawsuit | **Likely** |
| Close question off-thread | MD-79: it comes from the climax | Rosewood's spine still did it (pre-MD-79) | **Partial** until the re-run |
| Attribution clutter | Credited on screen once per source | Prompt only; the reviewer says it isn't a HARD CONSTRAINT yet | **Partial** |
| Opening on a hotel, nobody named | Writer craft: introduce central figures in the opening; director: named = shown | Prompt only | **Likely** |
| "The head of Google DeepMind" (a title instead of a name) | Writer HC8: a name always, with role | The editor's "call them by role" repair contradicts it (reviewer must-fix) | **Partial** until fixed |

**Residual writing risks:**
1. **Thin source material.** When the record has no opponent and no hard choice, an honest spine is a flat
   one (GPUs: churn as the opponent). Nothing upstream screens for it: the producer's story test and the
   drama score don't ask for an opposition with agency or a bounded episode, and the 3 pitches left in the
   pool predate MD-66.
2. **The story editor is unproven.** It has never run live. If its repair fails validation, the writer's
   draft ships with flags (fail open). It might also over-edit or under-edit.
3. **The facts check runs after the editor.** A line it cuts can reopen a hole the editor closed (an orphan
   event). Today that's only a flag.
4. **The writer can still dilute a good spine** (overloaded lines, device-first rungs). The editor is the
   only guard, with one repair round.

## Visuals

| Complaint | Fix | Evidence | Verdict |
|---|---|---|---|
| Altman broken into pieces | Upscaler ×4 bug fixed; a garble check; re-anchoring | Reproduced and fixed on a copy | **Fixed** |
| Mixed media (a cutout beside a drawing) | MD-69 HC, `medium_mix` check, one fix round | Offline tests | **Likely** (fail open → can ship flagged) |
| Brockman with no cutout | Cutouts for central people; cutout treatments need cutouts | Central people are guessed before the spine exists; wished photos come back without cutouts | **Partial** |
| A named person not shown | MD-75 HC, `named_not_shown` check | Offline tests | **Likely** |
| Ring around blank paper | Marks tied to their target; `mark_on_nothing` | Flags Rosewood v2's frames 4/6/10 | **Fixed** |
| First caption letter missing | Caption skin root cause (GSAP at t=0) | Reproduced in headless Chrome, now tested | **Fixed** (the Explainers skin has the same bug, outside scope) |
| A 2009 hotel entrance as "evidence" | Integrity check, shots-first + wish search for the real image | Wish search never run live | **Unverified** |
| Too few photos per person | Harvest: 6+ verified for central people, ≥1 for every named person; wish search | Offline only; harvest caps raised | **Unverified** |
| Amodei's cutout doesn't look like him | — | Builder B found it; bank cutouts are never identity-checked | **Not addressed** |
| Iteration-2 breakage (cut-offs, empty frames, off-edge, contrast) | Measure → rebuild ×2 | v2 shipped with no breakage flags | **Fixed** |

**Residual visual risks:**
1. **Too many rules at once for the director.** It now has to satisfy, all together:
   - one medium per frame;
   - everyone named is shown;
   - no person shown the same way three times in a row;
   - no two adjacent frames with the same staging type (MD-64);
   - cutout treatments must use cutouts.

   Removing marker-sketch overlays also removes v2's main source of variety. If the wish search brings back
   few photos, the director may fall back to plain photo + label (v1's "lazy" look), or fix rounds may fail
   and ship flags.
2. **Wished photos may be the wrong person or low quality.** It uses the same checks as the harvest, but
   it's new code that has never run live.

## Sound

| Complaint | Fix | Verdict |
|---|---|---|
| No tension or emotion in the sound | Sound designer step (MD-61); tool_choice 400 fixed | **Unverified**: it has never produced cues in a real run, and cue playback has never been heard |

## System

- **Live-only bugs.** Tests never call the API, which is how the tool_choice 400 shipped. New live paths in
  the next run: the story editor, the wish search, the sound designer, the bigger harvest and its
  cutouts. Each fails open, so they degrade rather than crash, but one could quietly no-op the way the
  sound designer did in v2.
- **Cost.** Spine ~$0.36, editor ~$0.8 (2 rounds), wish search ~$0.3, bigger harvest ~+$0.2. Expect
  ~$10–12 per reel under the $15 cap.
- **Duplicate flags:** dedupe added. **Resume:** reuses the fact sheet and harvest, redoes from the spine.

## Cheap moves before the full runs (proposed)

1. **Cutouts after the spine.** Use rembg locally (free) for every spine-cast person and every wished
   person photo used in a cutout treatment.
2. **Bank identity check.** A one-time vision comparison of bank cutouts against a verified portrait,
   costing a few cents.
3. **Pitch gate.** The producer's story test and the drama score ask for an opposition with agency and a
   bounded episode; re-screen the 3 pooled pitches.
4. **A no-op detector.** A run that ends with zero sound cues, zero wishes searched or a skipped editor
   gets a loud flag in the delivery report.
5. **Scripts before videos.** After the spines are approved, run writer + story editor only (about $1 per
   reel) so the scripts can be read before $10 renders.
