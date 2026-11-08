# Reel AI Drama — the process (draft for Lucas, 2026-10-28)

Built from PLAN.md decisions MD-01 to MD-48.

```
DEVELOPMENT (weekly + when news reopens a cell; ~$3/week)
  ledger picks cells ─► producer pitches ─► same-event dedupe ─► Jev drama ─► Jev material ─► visuals check ─► POOL
  (player×type×era)    (one cell per call)   (vs every pitch)                               (< $0.35)          ranked, spread,
                                                                                                                 tended
PRODUCTION (3 a week, automatic, ≤ $8 each)
  POOL top ─► reporting ──┐
              (can kill)  ├─► writer ─► director ─(lines back once)─► script lock ─► facts check ─► voice
         ─► media harvest ┘                                                       (Jev, loose)
              (<15 kills)
  voice ─► integrity check ─► frame builders + sound + music ─► render ─► first-viewer + breakage checks ─► deliver
           (image = claim)                                                   (one fix each, then warn)
```

| # | Step | Reads | Responsible for | Never decides | Hands on |
|---|---|---|---|---|---|
| D1 | **Ledger picker** (code) | the search ledger, the blue-chip list, story types, eras, news touching a player | which grid cells to explore: unexplored or due, or reopened by news | whether a story is good | a few cells |
| D2 | **Development producer** (LLM + web search) | one cell, the search criteria (MD-24), the story-type definition, the nearest past pitches for that cell, related news | 3–5 candidate pitches per cell: cast and their wants, the scene, why now, date, a suggested engine, expected visuals, sources | scores, rank | pitches |
| D3 | **Same-event dedupe** (code, then Jev on borderline pairs) | the pitch, every past pitch | dropping a pitch about an event already pitched or made; recording why | drama | new pitches |
| D4 | **Jev drama score** | the pitch | whether a central figure's want drives events, stakes, a scene, a turn, an implication for the AI world | material | score and notes |
| D5 | **Jev material score** | the pitch | how likely real visuals exist: faces, places, artifacts, photographed events, variety, era | drama | score and notes |
| D6 | **Visuals check** (free counts, 1–2 image searches, one cheap look at a thumbnail sheet; < $0.35) | pitches that clear D4 and D5 | proving material exists: a face per central figure, 3+ story-specific visuals, 4+ kinds | the story | a visuals card (green / amber / red) |
| D7 | **Pool** (code) | scored pitches with visuals cards | ranking (MD-32), the one-per-player-per-week spread, fading news, rechecking visuals, revive conditions | what gets written | the ranked pool |
| P1 | **Pick** (code) | the pool, the schedule | the next story, automatically (MD-30) | — | one story |
| P2 | **Reporting** (LLM + web search and fetch) | the pitch and its sources | the verified fact sheet: timeline, cast, verbatim quotes and artifacts, each claim's sources (key claims two). **Kills** the story if the core doesn't hold | the telling | fact sheet, or a kill and the next story |
| P3 | **Media harvest** (code + cheap vision) | the pitch's cast, places, events, artifacts | gathering every usable visual: no watermarks, no AI images, identity and date checked, duplicates removed, credits recorded, what each image shows; the 20-day reuse rule. **Kills** under 15 usable visuals | the story | the visuals inventory |
| P4 | **Writer** (LLM, writer craft) | fact sheet, visuals inventory, suggested engine | the narration, the on-screen words, each rung's purpose, which facts each line uses, the question over the close | shots, motion, music | the script |
| P5 | **Director** (LLM, director craft) | script, visuals inventory, the kit's tools | the shot plan: which image, treatment, motion, marks, sound and music cue for each moment; image-reuse rules; sends lines back **once** | the words (only flags) | the shot plan and the locked script |
| C1 | **Facts check** (Jev, loose and semantic) | locked script, fact sheet | flagging a claim the facts don't support; one fix, then cut the line | style | a checked script |
| P6 | **Voice** (HeyGen, Lucas's voice) | the checked script | narration audio and word timing | — | audio and timing |
| C2 | **Integrity check** | shot plan, inventory | each image shows what its line claims; sources recorded; one fix, then a warning | taste | a checked shot plan |
| P7 | **Frame builders, sound and music** | shot plan, timing, the kit, the sound library | building the frames; foley and ambience on their actions; music changing at act turns | the plan | the project |
| P8 | **Render** | the project | the MP4 (about 60s, up to 75s) | — | the video |
| C3 | **First-time viewer + breakage** | stills and the video | hook within 1.5s, story understood (on mute too); nothing out of bounds, no face covered | — | warnings or one fix |
| P9 | **Deliver** | everything | the MP4, a contact sheet, cost, warnings, credits | — | the finished reel |
