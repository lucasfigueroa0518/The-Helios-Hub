# Prompt checkpoint, 2026-10-06, copy-caption-v25 (saved)

Frozen on 2026-10-06 before the prompt-contradiction edits (copy-caption-v26). Earlier checkpoints stay: `prompts-checkpoint-2026-10-05/` (before the 2026-10-05 session) and `prompts-checkpoint-2026-10-05-v18/` (complete thought with tension).

Versions frozen here:

- Copy writer (P-10): `copy-caption-v25`. Iteration rounds 1 to 5 (concrete stake nouns, four copies a call, viewer-first openings, blind rewrite, two blind polish passes), three candidate stakes before the viewer stake (D-259), The Number, Ball Knowledge, and The Callout to 26 words (D-267).
- Copy pick (P-15): `copy-pick-v4` (stake level 3 names health and tools, D-260).
- Scoring (P-08, P-09): `scoring-pass1-v4`, `scoring-pass2-v4`; net = psychology + 0.5 × bucket + 2 × value + tiered blockbuster (D-253 to D-257); entertainment ×1.2 when highest or above 0.70, no Ball Knowledge bump (D-261).
- Grouping (P-02, P-07): `grouping-v2`, `idea-merge-v2`, content-overlap candidates, same-story decides the join (D-265).
- Sources: Hugging Face capped at 15 new a night (D-262); Futurism, The Verge, Wired, AI Incident Database, The Guardian, BBC (D-263); quiet-source check (D-264).
- Video: Kling 2.5 Turbo Standard, 10 s, `motion-writer-v4` (D-266).
- Last measured: dry-run day 2026-10-06 on v24, 2 of 5 top ideas passed (`planning/Trial Reels/dry-run-day-2026-10-06.md`).

Each file is a verbatim copy with `.saved` added so it never compiles. Live paths:

| Saved file | Live path |
|---|---|
| `skill.ts.saved` | `lib/reels/copy/skill.ts` |
| `insider-ideas.ts.saved` | `lib/reels/copy/insider-ideas.ts` |
| `source-text.generated.ts.saved` | `lib/reels/copy/source-text.generated.ts` |
| `report.ts.saved` | `lib/reels/copy/report.ts` |
| `assemble.ts.saved` | `lib/reels/copy/assemble.ts` |
| `pick.ts.saved` | `lib/reels/copy/pick.ts` |
| `writer.ts.saved` | `lib/reels/copy/writer.ts` |
| `held-out.ts.saved` | `lib/reels/copy/held-out.ts` |
| `clean-text.ts.saved` | `lib/reels/copy/clean-text.ts` |
| `pipeline-copy.ts.saved` | `lib/reels/pipeline/copy.ts` |
| `pipeline-slots.ts.saved` | `lib/reels/pipeline/slots.ts` |
| `copy-pick.ts.saved` | `lib/reels/jev/questions/copy-pick.ts` |
| `scoring-pass1.ts.saved` | `lib/reels/jev/questions/scoring-pass1.ts` |
| `scoring-pass2.ts.saved` | `lib/reels/jev/questions/scoring-pass2.ts` |
| `scoring-shared.ts.saved` | `lib/reels/jev/questions/scoring-shared.ts` |
| `grouping-question.ts.saved` | `lib/reels/jev/questions/grouping.ts` |
| `idea-merge.ts.saved` | `lib/reels/jev/questions/idea-merge.ts` |
| `decide.ts.saved` | `lib/reels/scoring/decide.ts` |
| `interpret.ts.saved` | `lib/reels/scoring/interpret.ts` |
| `pipeline-grouping.ts.saved` | `lib/reels/pipeline/grouping.ts` |
| `story-terms.ts.saved` | `lib/reels/grouping/story-terms.ts` |
| `content-candidates.ts.saved` | `lib/reels/grouping/content-candidates.ts` |
| `adapters-index.ts.saved` | `lib/reels/adapters/index.ts` |
| `hf-papers.ts.saved` | `lib/reels/adapters/hf-papers.ts` |
| `kling-api.ts.saved` | `lib/reels/visual/kling/api.ts` |
| `motion-writer-prompt.txt.saved` | `lib/reels/visual/motion-writer-prompt.txt` |
| `config.ts.saved` | `lib/reels/config.ts` |
| `PRODUCT_SPEC.md.saved` | `planning/Trial Reels/PRODUCT_SPEC.md` |

The git tag `reels-prompts-checkpoint-2026-10-06-v25` marks the commit that added this folder. That commit holds this folder only: the live files were uncommitted at the time, with another session's ingestion work in some of them (`ingest.ts`, `run.ts`, `types.ts`, `repository.ts`, `net/`), so the saved copies here are the record of this version.

To come back to this version: copy each `.saved` file over its live path, run `npm run reels:sync-copy-text`, `npm test`, then `./scripts/gcp/deploy-worker-code.sh`.
