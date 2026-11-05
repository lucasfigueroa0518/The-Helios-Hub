# Explainer ideas: coverage map and lesson frame (living plan)

Started 2026-11-03 (Bald-Eagle-Iteration). Lucas decides; this file records his calls in his words.

## Decided

### Coverage map
- Buckets of idea categories, like AI Drama. Prompt carries the last **90 days**; dedupe runs against **120 days**
  ("including more things in the prompt increases token costs").
- Dedupe: the topic's own bucket's renders (120 days) + the whole pool + a free cross-bucket term match.
- Code picks tonight's buckets (least covered first, 2 AI : 1 CS); each bucket has a concept list (covered vs to teach).
- 13 buckets as drafted 2026-11-03; Lucas: "All four of the questions that you asked me are fine."
- Seeds (hand-placed) are deduped the same way and **auto-win** against a pool duplicate; a seed that repeats a
  render from the last 120 days is **blocked**. Another engineer is building hub-wide seeding: keep changes inside
  explainers code; expect a merge in `lib/explainers/ideas/evaluate.ts`.

### Lesson frame: decisions (2026-11-03, round 2)
- Correction (Lucas): "A definition definitely closes a gap and is helpful. Each reel should still have a definition
  in it." The "gap between the word and the behaviour" framing was wrong and is dropped.
- The principle (agreed framing): **start where the viewer's understanding ends.** Every reel defines its term; how
  far it goes past the definition depends on where the average viewer already stands:
  - *unfamiliar* (most viewers don't really know it, e.g. as Lucas listed: reinforcement learning, MCP, API): the
    definition and how it works **is** the payload;
  - *familiar* (common knowledge as a word): the definition is a quick anchor, and the payload is the mechanism,
    cause or failure behind it (Lucas: "unpack a symptom of a bad prompt", "why bias happens");
  - *embedded* (a part of a larger system): place it in that system before and after defining it.
- Frame = **Payload, Altitude (the viewer's starting point above), Map position**. Lucas: "yes".
- **No rejection gate** for definition-only ideas. Lucas: "some concepts work with just a definition because the
  average viewer doesn't fully understand them." The generator sets the payload depth from the altitude instead.
- Director: payload and map position are required; how much screen time context gets is the director's craft call
  inside the beat rules. Lucas: "Go with your recommendation."

- Altitude: the generator labels it; Jev checks "would the average viewer already know this word?"; on a
  disagreement Jev wins and the generator rewrites the payload once. Lucas: "Yes." (2026-11-03)

### Lesson frame: first proposal (superseded wording, kept for history)
Lucas: "anything that is brain dead simple, such as 'prompt', 'benchmark', or 'bias' don't deserve its own video at
their fundamental level"; simple concepts must be tied "into more advanced concepts"; "when a topic on its own is
either complicated or a part of a complicated concept … the viewer is a little bit lost because the surrounding
context isn't mentioned"; "explaining where a concept lies within the landscape … increases understanding."

The principle (proposed): a reel's value is the **gap between what the word suggests and how the thing actually
behaves**. Every idea is defined as a lesson, not a word:
- **Payload** — the one non-obvious mechanism, cause or consequence the viewer leaves with. Never "what X means".
- **Altitude** — whether the concept is *familiar* (the viewer knows the word: go deeper, to the dynamics behind it)
  or *embedded* (a part of a larger system: zoom out first, then in).
- **Map position** — the system it belongs to, the step it does there, and what comes before and after it, told in
  one line. Comes from the coverage map, so code can supply it.

Owner (proposed): the **idea phase** writes the frame (it alone sees the curriculum); the topic carries it; BRIEF.md
hands it to the director, who stages it but never changes its payload or position. story-design.md owns *how* the
beats express it.

### Flow (approved 2026-11-03: "Yes")
coverage map → code picks buckets (2 AI : 1 CS) → generator (picked buckets' 90-day renders + pool + concepts to
teach; writes bucket + lesson frame) → dedupe (own bucket 120-day renders + pool + term match, all buckets) → Jev
scoring (+ altitude question; disagreement → one payload rewrite) → pool → BRIEF.md `## Lesson frame` → director.
- Buckets and concept lists live in a **code file** (Lucas: "Code file").
- The 3 current pool topics get their frame once at build time (Lucas: "Sure"); not a sweep.

## Contract (shared names; every owner uses exactly these)
- `explainers.topics` new columns (local schema only, db/explainers_schema.sql, idempotent ADD COLUMN IF NOT EXISTS):
  `bucket text`, `lesson_payload text`, `lesson_altitude text CHECK (lesson_altitude IN ('unfamiliar','familiar','embedded'))`,
  `lesson_map text`. Same names on `TopicRow`.
- `lib/explainers/ideas/coverage.ts`: `type Bucket = { id: string; name: string; kind: 'ai' | 'cs'; concepts: readonly string[] }`,
  `BUCKETS`, `BUCKET_IDS`, `bucketById(id)`, `pickBuckets(coverage, { ai: 2, cs: 1 })`, and the one-time map of the 24
  rendered terms to bucket ids (`RENDERED_BUCKETS`).
- Settings: `prompt_history_days` = 90 (new), `dedupe_lookback_days` = 120 (was 45).
- Altitude values and meaning: `unfamiliar` (the definition and how it works is the payload), `familiar` (definition as
  anchor; payload is the mechanism, cause or failure behind it), `embedded` (placed in its system around the definition).
- BRIEF.md section, written by workspace.ts, read by the director:
  ```
  ## Lesson frame
  Payload: <one sentence>
  Altitude: <unfamiliar|familiar|embedded>
  Map position: <one sentence>
  ```
  A topic with no frame writes no section (older topics render as before).

## Localhost hub, catching up to main (2026-11-03)
- Merge of origin/main is applied and uncommitted (`git merge --no-commit`). Backup: `../helios-backups/reels-iterations-2026-11-03`, and the pre-merge stash.
- `.env.development.local` points Next at local database `helios_local` (copy of production, outreach schema-only, explainers from the local database), blanks Meta and Resend keys. Workers need both env files. Publishing and auto-run settings are off in the copy.
- Lucas: seeds for Explainers and Reel AI Drama never expire. No live render without his go-ahead (budget ~$16).

## Which reels count (Lucas, 2026-11-03)
- "The reels that we keep and manually approve through Claude Code will persist with their idea and be served for posting once it is their idea's turn to perform."
- Current system: runs 85 (Git branch) and 86 (prompt), approved. Under review one by one: runs 80-84. Everything else unposted: status `retired` (see retire-old-renders.sql), out of the pool, the night's picks and coverage; nothing deleted. Posted reels still count as covered.
- Prompt reel's card depth fixed by hand with no API spend: kit draw order (`lens.js`), plus the sheet order in that reel's frames 2 and 4. Original kept in the job's depth-fix-backup.
- Before production: apply the schema, replay the SQL with production's job ids, and upload runs 85 and 86 to the bucket (placing needs `storage_location = 'bucket'`).
- Review result (Lucas, 2026-11-03): runs 80-84 all cut, "Don't delete, just don't keep." Only runs 85 and 86 are kept.
- The last 4 older pool ideas were retired too (Lucas: "get rid of them"). The pool holds only runs 85 and 86 until the next idea run.
