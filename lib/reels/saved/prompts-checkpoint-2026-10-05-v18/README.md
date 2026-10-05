# Prompt checkpoint, 2026-10-05, copy-caption-v18 (saved)

Frozen on 2026-10-05 after the complete-thought wave (D-250 to D-252), before the three iteration rounds Lucas asked for. This is the second checkpoint of the day. The first, `prompts-checkpoint-2026-10-05/` (tag `reels-prompts-checkpoint-2026-10-05`), is the system as it stood before any of this session's edits, and it stays.

Versions frozen here:

- Copy writer (P-10): `copy-caption-v18`. On-screen copy is a complete thought with tension (hard constraint), the tension is written first in a required field, The Number and Ball Knowledge run to 22 words. Includes the v17 wave (stake and figure checks, Saga landing, escape repair, returning-idea lines).
- Copy pick (P-15): `copy-pick-v3`, unchanged. Close nearest misses on plain read (within 0.05) ship on loop, care, and reward (D-252).
- Eye test on this version: 0 of 6 ideas cleared the gate (`planning/Trial Reels/eye-test-copy-v18-2026-10-05.md`).

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
| `pipeline-copy.ts.saved` | `lib/reels/pipeline/copy.ts` |
| `copy-pick.ts.saved` | `lib/reels/jev/questions/copy-pick.ts` |
| `config.ts.saved` | `lib/reels/config.ts` |
| `PRODUCT_SPEC.md.saved` | `planning/Trial Reels/PRODUCT_SPEC.md` |

The git tag `reels-prompts-checkpoint-2026-10-05-v18` marks the commit that added this folder; that commit's tree is the whole v18 system.

To come back to this version: copy each `.saved` file over its live path (or `git checkout reels-prompts-checkpoint-2026-10-05-v18 -- <path>`), run `npm run reels:sync-copy-text`, `npm test`, then `./scripts/gcp/deploy-worker-code.sh`.
