# Prompt checkpoint, 2026-09-29 (saved)

Frozen on 2026-09-29, before the viewer-feedback wave (D-210 onward). This is the copy, pick, scoring, and color-routing text the `helios-reels` worker was running at that moment, including the uncommitted Opus 5.5 and green-grade edits that were already deployed.

Versions frozen here:

- Copy writer (P-10): `copy-caption-v8` on `claude-opus-5-5`, tool choice auto, strict `report_copy`, `COPY_MAX_TOKENS` 16,000
- Copy pick (P-15): `copy-pick-v2`, four Scores, plain-read gate 0.75, and the clearest line ships when none passes
- Scoring (P-08, P-09): `scoring-pass1-v2`, `scoring-pass2-v2`, blue-chip bonus 0.25
- Color router (P-12): `color-route-v4` (noir, paper, orange, green)
- Saga on-screen range: 40 to 70 words

Each file is a verbatim copy with `.saved` added so it never compiles. Live paths:

| Saved file | Live path |
|---|---|
| `skill.ts.saved` | `lib/reels/copy/skill.ts` |
| `source-text.generated.ts.saved` | `lib/reels/copy/source-text.generated.ts` |
| `report.ts.saved` | `lib/reels/copy/report.ts` |
| `assemble.ts.saved` | `lib/reels/copy/assemble.ts` |
| `writer.ts.saved` | `lib/reels/copy/writer.ts` |
| `pick.ts.saved` | `lib/reels/copy/pick.ts` |
| `store.ts.saved` | `lib/reels/copy/store.ts` |
| `score.ts.saved` | `lib/reels/copy/score.ts` |
| `copy.ts.saved` | `lib/reels/pipeline/copy.ts` |
| `copy-pick.ts.saved` | `lib/reels/jev/questions/copy-pick.ts` |
| `scoring-shared.ts.saved` | `lib/reels/jev/questions/scoring-shared.ts` |
| `scoring-pass1.ts.saved` | `lib/reels/jev/questions/scoring-pass1.ts` |
| `scoring-pass2.ts.saved` | `lib/reels/jev/questions/scoring-pass2.ts` |
| `color-route.ts.saved` | `lib/reels/jev/questions/color-route.ts` |
| `config.ts.saved` | `lib/reels/config.ts` |
| `PRODUCT_SPEC.md.saved` | `planning/Trial Reels/PRODUCT_SPEC.md` |

The git tag `reels-prompts-checkpoint-2026-09-29` marks the commit that added this folder.

To come back to this version:

1. Copy each `.saved` file over its live path, dropping the `.saved` suffix.
2. Run `npm run reels:sync-copy-text` so the generated bucket text matches the restored spec.
3. Remove or revert anything the later wave added outside these files (new question sets, the copy history table stays harmless).
4. Run `npm test`, then `./scripts/gcp/deploy-worker-code.sh` and `sudo systemctl restart helios-reels` on the VM.

Records written before or after keep their own version strings, so a restore does not change what old rows mean.
