# Explainers 3.8 checkpoint (2026-10-25)

A checkpoint of the analogy-led Explainer Reels work. It is on a local branch only: not pushed, not merged, not deployed. Lucas is switching gears to explore other kinds of educational reels that lean less on analogies.

## What the code on this branch contains (uncommitted on main until now)

Register rows EX3-104 to EX3-122 (`../DECISIONS.md`):

| Round | Rows | What changed |
|---|---|---|
| 3.5 | EX3-104–108 | Analogy quality bar with retries; the example is never the analogy; every word can be said aloud; locked looks (orange hero); comprehension check covers the whole reel |
| 3.6 | EX3-109–114 | Objects can act; the anchor block names its hero; object-led openers; draw to fit; exact asset descriptors; the self-growing asset bank |
| 3.7 | EX3-115–117 | The curiosity gap is about the real technology; no toss; negative space first |
| 3.8 | EX3-118–122 | Analogy writer v7 (guided, not limited, from Lucas's doc); scoring v6 (aptness, interest); the gap writer with Jev's pick; never say "critter"; five candidates per pass |

Validation status:
- 3.7 made the cache, RAG and API reels.
- The 3.8 round on 6 past topics finished one reel (cache). It failed at the analogy bar on 2 topics and at the gap bar on 2 more. Lucas stopped it ("This clearly isn't working").

## The plan and the audit (this folder)

| File | What it is |
|---|---|
| `gap-analysis.html` | The full gap analysis: 24 gaps, the contradiction ledger, the 4-phase fix plan |
| `3.8-plan.md` | The approved 3.8 before/after plan |
| `analogy-writer-prompt.md` | The v6 analogy writer prompt Lucas marked up |
| `3.8-test-round.md`, `3.8-round-notes.json` | Every 3.8 analogy candidate and gap line, with Jev's scores |
| `writers-draft-v8.md` | DRAFT analogy writer v8 and gap writer v2, before and after (not in the code) |
| `draft-v8-run.mjs`, `draft-v8-output.json` | The live scratch run of those drafts on 8 topics, about $1.46 |
| `golden-round1-items.json`, `golden-round2-items.json` | The two rating sets, with their sources and Jev scores |

## Lucas's decisions on the gap analysis (2026-10-25, not built)

1. **The opener:** fix the facts ("In the next minute", AI or tech concept).
2. **The understanding test:** serious first-viewer failures block audio for one rewrite, then build and flag.
3. **Pauses:** keep 0.2s everywhere.
4. **Beat jobs:**
   - 4: name each part as it appears;
   - 5: why it works, then where it breaks;
   - 7: the payoff and takeaway.
5. **The real example:** walks the same steps as the analogy, in a different world.
6. **The hook-to-gap jump:** a visual echo.
7. **The hero's orange:** analogy frames only.

## What we learned about analogies

- **Proxy tests failed every time.** "Simple" became the ladder, "interesting" became exotic worlds, and "fresh" became novelty, which Lucas rejected.
- **Care has to be judged directly**, in three ways:
  - **recognition:** the viewer has lived this moment;
  - **tension inside the scene;**
  - **illumination:** the "oh, that's it" moment.
- **A per-topic seat** decides whose problem it is: user, builder or curiosity.
- **Lucas's reasons the round-1 sets were horrible:**
  - not apt, doesn't map well;
  - weird or too niche;
  - complicated in weird ways;
  - not easy to understand or relate to;
  - zero viewer interest.
- **The draft v8's cache analogies still "SUCK"** (Lucas, on the grocery-aisle eggs one).
- **Round 2 was left unrated** when Lucas switched gears.
