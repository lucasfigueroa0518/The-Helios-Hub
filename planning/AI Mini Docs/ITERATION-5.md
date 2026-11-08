# Iteration 5: the writing, simplified (draft for Lucas)

Scope: the writing and storytelling logic only (MD-100–MD-102). The director, its craft, the kit and the build are
not touched. The writer's output keeps the shape the director already reads (lines, on-screen labels, fact ids,
pauses), so the director needs no change.

## New process

```
Producer ──► prose brief ─┐
Reporting ──► facts ──► (code) dated timeline ─┤
Harvest ──► visual inventory ─────────────────┤
                                              ▼
                     Writer (owns the story) ──► script
                                              ▼
                     Blind editor (script only) ──► notes
                                              ▼
                     Writer, one rewrite ──► final script ──► facts check ──► director (untouched)
```

| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Producer | the night's search lens, what's already pitched, the web | finding and picking true stories worth telling | a prose brief (who, what, when, the main tension, what to focus on) + plumbing: title, date, cast, sources, expected visuals |
| Reporting | the pitch | verifying; can kill the story | the fact sheet (unchanged) |
| Timeline (code) | the fact sheet | turning facts into a dated, plain-language timeline with fact ids | the writer's view of the facts |
| Harvest | the pitch, the facts | finding pictures | the visual inventory (unchanged) |
| Writer | short role prompt + principles; brief, timeline, inventory, length budget | the whole story: what to tell, in what order, how | the script (same shape as today) + who is central (drives cutouts) |
| Blind editor | the script only | reading it as a first-time listener and naming what loses or confuses them | notes |
| Writer rewrite | its script, the notes, its inputs | one rewrite | the final script |
| Facts check → writer-revise | unchanged | unchanged | unchanged |

## Inventory

**Goes**
- `spine-writer.md`, the spine stage, the `Spine` contract and its tests.
- `plot-craft.md`, `writer-craft.md`, `story-timing.md` (merged into one principles file).
- Producer story-shaping fields: `logline`, `pitch`, `story_question`, `end_point`, `turn`, `engine`, `scene`,
  `implication`, `central_figure` (replaced by one prose `brief`).
- Story editor round 0 (repairs from pitch and spine); the editor no longer sees pitch, spine or facts.
- The flags.json verbatim test for writing entries (W-…); director entries (D-…) keep it.
- Rules retired with the structure: "one story question", "one turn in the back half", the setup block exempt from
  value turns.

**Stays**
- The producer's search, its story types as a search lens only (MD-105), its selection criteria (MD-24), dedupe,
  real sources, the scoring of pitches. The "central figure's want drives the events" rule is relaxed (MD-105).
- Reporting, the fact sheet, the facts check, writer-revise for facts fixes and the director's send-backs.
- Harvest and the visual inventory.
- Voice D and tempo; hook decision MD-90 (as a must). Length cap 80s and pause 0.15s (MD-103).
- The director and everything after it.

**New**
- `craft/principles.md` (short, Lucas-approved).
- The pitch's prose `brief`.
- The fact timeline renderer (code).
- The writer's `central` list (replaces `spine.cast` for cutouts).
- The blind editor's notes and the one rewrite.

## Principles (approved 2026-11-03, MD-104)

**Musts** (already decided; checkable)
- M1. The first line is the hook: it gives the time frame and gives away or teases the outcome, whichever pulls
  harder. [MD-90, MD-34]
- M2. Every claim, name, number, date and quote comes from the facts and lists its fact ids; quotes are verbatim.
- M3. About 60 seconds, up to 80 when the story needs it; at most one pause, about 0.15s. [MD-103]
- M4. Settled facts stand bare; attribution only for allegations, disputed claims, or one person's account,
  credited once. [MD-74]
- M5. A close question of about six words plays over the brand close. [MD-05, MD-18]

**Principles** (craft)
1. Find the main tension first: what is at stake, between whom or what, and why it mattered then. Every line serves it.
2. Tell one episode: a short span around that tension. Anything much later is mentioned briefly, and only when it
   is important to situate the story against present-day reality. [MD-104]
3. Set the scene before the action: when, where, who is there and what they are to each other, so the viewer is
   never lost.
4. Motive before action: before someone acts, the viewer knows what they want and why.
5. Each line follows from the one before. Claim a cause only when the facts give one; otherwise say what happened next.
6. Keep the viewer leaning forward: raise a question before you answer it, hold the answer back, let the stakes grow.
7. Let the pressure act: whatever stands in the way (a person, a rival, a deadline, money, the odds) does something
   the viewer sees.
8. Show the cost: what each choice risks or loses is what makes the outcome matter.
9. Something new every few seconds: a person, a fact, a stake, a shift. Never a line that only restates.
10. Specific beats general: names, dates, numbers, the concrete detail of the moment, the words people really said.
11. A natural storyteller's voice: connected sentences you would say to a friend, one breath each; no fragments,
    drumroll colons or one-word sentences. [MD-93]
12. Write for the ear: a listener can't re-read. Name people with their role the first time; keep each "he" or
    "she" unmistakable.
13. A stranger with little AI background can follow every line. [MD-104]
14. Land it: the ending pays off the tension the hook opened; never open a new conflict at the end.
15. Write toward pictures that exist: favor moments the visual inventory can show.

## Build plan (Phase 0 contract)

**Shared names** (every owner uses these exactly)
- `Pitch.brief: string` — prose, about 120–180 words: who, what, when, the main tension, what to focus on, why it
  mattered. The producer's tool drops `logline`, `pitch`, `story_question`, `end_point`, `turn`, `engine`, `scene`,
  `implication`, `central_figure`, and `cast[].want`. They stay optional on the type for old rows; every reader goes
  through `pitchBrief(p)` (`p.brief`, else the old `pitch` text).
- `factTimeline(facts: FactSheet): string` — code, no model: the facts in date order, plain sentences, each ending
  with its fact id.
- Writer input: `brief`, `factTimeline`, the visual inventory, the length budget. No spine.
- `WriterDraft.central: string[]` — the cast names central to the story; replaces `spine.cast` for cutouts and the
  no-cutout check. `WriterDraft.spine` is removed.
- `StoryNotes { notes: { lines: string[]; note: string }[] }` — the blind editor's output. Its input is the script
  only: each line's id, narration and on-screen words.
- Flow: writer → blind editor → writer rewrite (only when there are notes; one round) → cutouts → director (as today).
  Notes left after the rewrite are not re-checked; the editor's notes are kept as flags.
- Settings: `max_seconds` 80, `silent_beat_max` 0.15 (MD-103).
- Bundles: writer, writer-revise = role prompt + `principles.md`; story editor = `story-editor.md` + `principles.md`.

**Owners**
- **Prompts (me):** `craft/principles.md` (new), `prompts/producer.md`, `writer.md`, `writer-revise.md`,
  `story-editor.md`; delete `spine-writer.md`, `plot-craft.md`, `writer-craft.md`. Output-format rules the director
  relies on (on-screen labels, fact ids, pauses) move into `writer.md`'s output section.
- **Code (one agent):** types, schemas, the producer tool and every pitch reader (scores, dedupe, visuals check,
  harvest plan, lab UI, calibration data), `factTimeline`, `run.ts` flow, cutouts from `central`, settings,
  `prompts.ts` bundles, review doc, the flags.json test (writing entries retired), tests.

**Acceptance:** all reel tests and the typecheck pass; no prompt mentions the spine, engines, story questions or
turns; a name cross-check finds every field the prompts use in the schemas; a fresh read-only review finds no
must-fix contradictions.
