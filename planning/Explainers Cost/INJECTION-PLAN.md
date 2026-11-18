# Instruction injection + learning loop (approved and built 2026-11-16)

**Lucas's calls:** 1. Jev picks every section (no rules tier). 2. Thresholds OK. 3. Session A
included, since it has a benefit.

**Built (uncommitted, tests offline):**
- Index: `explainers/injection/sections.json`. It is a sidecar file, not tag lines in the docs, to
  keep the prompts clean. It holds 75 sections: 32 core (about 51k characters of the 194k stack),
  41 pick and 2 ref.
- Code: `lib/explainers/injection/{sections,ledger,recorder,catalog}.ts` and
  `lib/explainers/jev/questions/section-picker.ts`.
- Wiring: `agent.ts` builds the core stack, `job.ts` handles dispatch and session A, and
  `policy.ts` makes the sections read-only.
- Each builder window: Jev answers one yes/no question per pick section, and sections scoring 0.6 (raised from 0.35 on 2026-11-17)
  or more are injected. The ledger's promotions, demotions and lessons are added after that. Fix
  rounds reuse the same picks.
- Ledger: `<jobsRoot>/injection-ledger.json`. Locally this is `.explainers-local/jobs/`, and the VM
  keeps its own. Its overrides can be edited by hand.
- Per render: `telemetry/injection.jsonl`.
- Session A: Jev trims `CATALOG.md` to the props this reel could use. The full catalog is
  `CATALOG-FULL.md`, and a Read of it is logged as a miss. The full catalog is restored after
  session A.
- Demotion approximation: we can't see whether a builder used an injected section. So "never
  needed" means never missed, never tied to an error, and always picked on a borderline score.

---

## Original plan

Covers your items 1 and 2 from the Session B cost review: a Jev-driven system that gives each context
window only the instructions it needs, and a loop that learns from every render so frames pass their
self-check on the first try. Nothing in this plan is built yet.

## Why (from the RL and MoE telemetry)

- Every builder gets the same stack, inlined at the top: craft, house-style, minimums, frame.md and
  KIT-REFERENCE. That is about 196k characters, or roughly 50k tokens. The harness adds another ~50k,
  so each turn starts at about 100k tokens.
- Re-reading that base on every turn (224 turns per reel) costs about **$4.5 of the ~$13 Session B
  spend**.
- About **85% of `try` self-checks come back with errors**. That is why a frame takes 22–45 turns.
- New: the prop catalog grew from 15k to 52k characters with today's tripling (158 assets). Only the
  planner and the scene builder read it, but it should be injected by match too.

## Design

### 1. Section index (code, built once)
Split every instruction source into sections by `##` heading: the stack files, CATALOG.md and the
role files. Each section gets an id, a token count and tags, set in one hand-written
`<!-- inject: … -->` line per section:
- **roles:** planner, scene, world, tech, blend, fix
- **topics:** camera, critters, text, props, motion, sound, glass, layout …
- **tier:** `core` (always), `pick` (when relevant), `ref` (on request only)

A test fails if any section has no tag line, so new instructions can't slip in untagged.

### 2. The picker (rules first, Jev for the borderline)
For each context window (planner, scene builder, each frame builder, each fix round):
1. **Rules (code, free).** The role gives its core sections. The frame packet (look, storyboard
   fields, named props and critters, text on screen, mechanism objects) selects `pick` sections by
   tag. Storyboard props pull only their own CATALOG entries.
2. **Jev (cheap).** One call ranks only the sections the rules left uncertain, with the packet as
   input. It is skipped when the rules cover everything.
3. **Ledger (learned, see 4).** Sections the ledger has promoted for this role and look are always
   added.

### 3. Cache-safe prompt shape
Order: **shared core** (identical for every builder in a reel, so one cache write) → **role tier**
(scene or tech, cached per role) → **picked sections + packet** (the per-frame suffix).
- Picked sections go after the stable prefix, so we never break the prefix cache.
- A section is moved out of the shared core only when it is big and seldom used. Shrinking the core
  is where the savings come from.

### 4. Safety net and learning loop (your item 2)
- **On-demand sections.** Builders can fetch any section by id through the existing lookup path in
  `agent.ts`. Each fetch is logged as a **miss**.
- **Per-render log.** Each render writes `telemetry/injection.jsonl`. For every context it records the
  sections injected, the misses, the sections never referenced, and every `try` error code. Each error
  code maps to the section that governs it, so an error points at the instruction that should have
  prevented it.
- **Cumulative ledger.** After each render, code folds that log into
  `explainers/injection/ledger.json`, tallied by role and look:
  - a section missed 2 or more times in the last 5 renders is **promoted** to auto-inject;
  - a section injected but never needed in the last 10 renders is **demoted** to on-demand;
  - recurring `try` errors build a short **first-try lessons** block for that look: the error, then
    the pattern that avoids it. It is injected up front, so the next frame gets it right before its
    first `try`.
- The ledger is plain data you can read and edit. Code applies the thresholds; no model judges the
  renders.

## Expected effect (estimate, to be confirmed on the next renders)
- Base context per turn: **~100k → ~60k tokens**. That saves about **$1.5–2 per reel** in cache reads
  and writes.
- First-try `try` pass rate rising from ~15% would cut frame turns. Each turn avoided saves about
  $0.05–0.08.
- **Combined target:** Session B down from about $15–16 to **~$10–11 per reel** after a few renders
  of learning.

## Build (all $0 API; tests offline with canned Jev answers)
1. Section index, tag lines on every section, and the coverage test.
2. Rules picker plus the Jev ranker (stubbed in tests).
3. Prompt assembly in `agent.ts`/`build.ts`: core → role → picked suffix; logging of the lookup path.
4. Per-render `injection.jsonl`, the error-code → section map, and the ledger fold with its
   thresholds.
5. Telemetry summary gains an "injection" table: injected, misses and errors by section.

**Validation needs one live render (about $15, your go-ahead).** We compare against RL ($16.50) and
MoE ($15.38): cost, turns per frame, first-try pass rate and misses.

## Your calls
1. **Picker:** rules first with Jev for the borderline sections (my pick: cheapest and predictable),
   or Jev picks everything.
2. **Thresholds:** promote at 2 misses in 5 renders, demote after 10 renders unused. OK?
3. **Scope:** include the Session A planner, which would only see the catalog entries it needs, or
   only Session B builders for now?
