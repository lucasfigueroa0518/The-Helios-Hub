# Complete-thought plan, 2026-10-05

Status: approved by Lucas on 2026-10-05, with three changes: the name is "tension" (not "turn") in the plan and the code, v17 is committed only because the pre-session system stays checkpointed, and close nearest misses are picked by loop, care, and reward (D-252). Being built as `copy-caption-v18`. Decisions D-250 (22-word cap for The Number and Ball Knowledge) and D-251 (every on-screen copy is a complete thought with tension, mandatory, in the prompts, no gate change). Builds on `copy-caption-v17` (the copy-quality wave, still uncommitted). The result would be `copy-caption-v18`.

## The goal

Every on-screen copy is a complete thought with tension: what happened, what makes it surprising, and a reason to stay. A first-time viewer should never finish the line wondering why this is a reel, why this page posted it, or what they got from it. A true, plain, relevant fact with no tension is a failed copy.

The five v17 eye-test lines failed this: each stated a fact and stopped.

## How a prompt rule is made mandatory

1. It is defined once, as the purpose of the copy, with the skill's strongest device: a HARD CONSTRAINT and failed-report wording. HARD CONSTRAINT is the existing top tier, so the precedence order does not change.
2. Every layer that shapes the copy agrees with it: the bucket rules, the framework logic, the bucket examples, and the rewrite call. Nothing anywhere asks for a bare fact.
3. The writer has to commit to the tension in writing before it drafts, in a required report field. The field is stored, so every line can be traced to the tension it was built on.

The gate does not change. Loop, care, and reward already measure this.

## Steps

### 0. Commit `copy-caption-v17`

Lucas: commit v17 only because the system as it stood before this session stays checkpointed. It does: tag `reels-prompts-checkpoint-2026-10-05` (commit `a68ff7d`) holds the verbatim files from `89ee9a3`, with restore steps. v17 is committed on top, with only this wave's files.

### 1. The definition (skill.ts, On-screen copy)

The paragraph that defines the copy today says it has two jobs: the viewer understands what happened and why it matters, then wants the caption. That definition is the root cause, because a bare fact satisfies it. It is replaced by a HARD CONSTRAINT that defines the copy as a complete thought with three parts:

- What happened, plain on one read. The existing plain-read rules all stay.
- The tension: what makes it surprising. Examples of kinds: a reversal, a contradiction, an escalation, a consequence, an absurd detail, a stake out of proportion. These are kinds to choose from, never a template.
- The reason to stay: what the viewer gets by reading on, which they can sense even while the specifics are held back.

A copy without a tension is a failed report, in the same words the skill uses for an out-of-range word count.

The hook questions become the working check for those three parts. The stake and figure checks from v17 stay inside them.

### 2. The writer names the tension before drafting (skill.ts How to work, report.ts)

- Step 1 of How to work: after the stake, the writer names the tension it found in the sources. If the sources hold no tension, the writer says so rather than inventing one.
- A new required field in `report_copy`: the tension, in one or two sentences: what happened, what makes it surprising, and what the viewer gets by staying. Both copies are built on it. Strict tool use guarantees it is present, and it is stored with the other working fields for review.

### 3. The bucket rules (PRODUCT_SPEC.md, then `npm run reels:sync-copy-text`)

- The Number. The copy line goes from "Under 15 words" to 22 words. The resolution line "Self-contained. The stat is the payload." is what tells the writer a fact is the reel. It is rewritten so the figure is the premise, the whole thought lands on screen, and the caption carries the source, the method, and what to do.
- The Number's examples. The three examples added this morning in D-249 are fact-shaped themselves: a figure plus a consequence, with no tension. They are replaced with three new examples of different shapes that each carry tension, up to 22 words.
- Ball Knowledge. "8–14 words" becomes "8–22 words". The copy line adds that the copy says why the get is worth stopping for: what it replaces, what it costs today, or what it suddenly makes possible. The shape-of-the-get requirement (D-232) stays.
- The Saga. Its rule (cold open at peak tension, then chronology, and land on an outcome that already happened) already describes a tension. One clause makes the tension explicit.
- Personal Profile, The Warning, and The Callout already build a tension into their copy rules (two facts that don't belong together, the stop and its cost, the stance), and none of them conflict. No edit.

### 4. The framework logic (skill.ts FRAMEWORK_WRITING_LOGIC)

- Arousal on-screen says "Lead with the fact in the source that raises anger, awe, anxiety, or amusement, and state it flatly. The fact does the work." That literally asks for a fact. It is rewritten to lead with the moment that raises the emotion and to give it its tension. "No adjectives that add heat" stays.
- Curiosity on-screen says to open a gap and hold back the piece that closes it. Held back wrongly, the tension itself goes missing. It is edited so the tension is on screen, and the gap opens after it: how it happened or what comes next, never what the point is.
- Identity on-screen names a group and says where the post stands. It is edited so the line says what changes for that group, not only that something exists (the rank 6 line was a product announcement).

### 5. Word ranges in code (report.ts)

- `ON_SCREEN_WORD_RANGE`: The Number 1–22 and Ball Knowledge 8–22. The reading-time comment and the tests that pin "8 to 14 words" are updated.
- The Number's minimum stays at 1 word. Lucas did not ask to change it.
- The frame renderer already fits Saga copy at 32 words, so 22 fits. A test proves it on a 22-word Number line.

### 6. The rewrite call (assemble.ts)

The rewrite shows the plain and stake standards in full, says "Keep what scored well and fix what the lowest scores name", and says loop, care, and reward "cannot rescue a copy under the bar". In practice, that teaches the rewrite to raise plain read by stripping the tension. One sentence is added: a rewrite keeps the tension, and a plainer line that drops it is a failed report. Nothing else in the rewrite changes, so the rewrite risk set aside earlier stays set aside.

### 7. Jev and the gate

No change. Jev's viewer description is shared with plain and stake, which decide the gate, so editing it would move the gate. Loop and reward already penalize "a poster line a viewer can nod at and keep scrolling" and "staying promises nothing".

Nearest miss (D-252, not a gate): when no line clears the bar, the line ranked first today (in range, then the highest gate) is the reference. Every line in the same range state whose plain read (payoff on Ball Knowledge) is within 0.05 of the reference's is a close tie, and among close ties the one with the highest loop, care, and reward ships.

### 8. Verification

- Offline: the wording is present at every layer, the tells test passes, the tension field is required and stored, the ranges and renderer accept 22 words, and nothing calls a model.
- Local eye test, with Lucas's go-ahead at the time: the same five ideas as today (ranks 4 to 8), so before and after differ only by the prompt, plus one Saga (rank 11) so the Saga rule is exercised. About $1.00 to $1.20, captured locally, nothing written to prod. Jev's loop and reward before and after are reported as telemetry. Lucas judges the copy.

### 9. Order

1. Lucas approves this plan.
2. Before/after wording for every edit, for approval.
3. Build, offline tests.
4. Local eye test.
5. Lucas judges, then commit and deploy (v17 and v18 together if v17 is not committed by then).

## Risks to watch

- Longer, fuller lines may score lower on plain read, so more nights ship a nearest miss. The gate is unchanged by choice; the eye test will show it.
- A tension could be stretched past the source. The Facts rules and "never stretch a possibility" still apply, and the writer has to say when the sources hold no tension.
- Every copy could fall into one shape ("X happened. Then Y."). The tension kinds are a menu, the examples show three different shapes, and two copies per call still need different ways in.
- Sources with no tension at all (a lab result, a list of incidents) will still produce weak reels. That is topic selection, a separate upstream problem.
