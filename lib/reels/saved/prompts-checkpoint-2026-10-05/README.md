# Prompt checkpoint, 2026-10-05 (saved)

Frozen on 2026-10-05 at commit `89ee9a3`, before the copy-quality wave (D-237 onward). This is the copy writer, copy pick, ingestion, grouping, and posting code as committed at that moment.

Versions frozen here:

- Copy writer (P-10): `copy-caption-v16` (the `copy-caption-v12` wording, D-235), latest Sonnet with fallback `claude-sonnet-5-5`
- Copy pick (P-15): `copy-pick-v3`. Gate: plain (payoff on Ball Knowledge) and stake at least 0.75, words in range, same story at least 0.50. After four ideas miss a slot, the nearest miss ships (D-224).
- Ball Knowledge payoff (P-19): `copy-payoff-v2`
- Same-story check (P-18): `copy-story-match-v1`
- Web search (P-01): `web-search-v2`, two stories a night (D-236)
- Ingestion full-text floor: `FULL_TEXT_MIN_CHARS` 600, no teaser detection
- Caption repair: literal `\n` restored to line breaks (`restoreLineBreaks`). Escaped quotes are not repaired.

Each file is a verbatim copy with `.saved` added so it never compiles. Live paths:

| Saved file | Live path |
|---|---|
| `skill.ts.saved` | `lib/reels/copy/skill.ts` |
| `insider-ideas.ts.saved` | `lib/reels/copy/insider-ideas.ts` |
| `source-text.generated.ts.saved` | `lib/reels/copy/source-text.generated.ts` |
| `report.ts.saved` | `lib/reels/copy/report.ts` |
| `assemble.ts.saved` | `lib/reels/copy/assemble.ts` |
| `writer.ts.saved` | `lib/reels/copy/writer.ts` |
| `pick.ts.saved` | `lib/reels/copy/pick.ts` |
| `slots.ts.saved` | `lib/reels/copy/slots.ts` |
| `store.ts.saved` | `lib/reels/copy/store.ts` |
| `jobs.ts.saved` | `lib/reels/copy/jobs.ts` |
| `pipeline-copy.ts.saved` | `lib/reels/pipeline/copy.ts` |
| `pipeline-ingest.ts.saved` | `lib/reels/pipeline/ingest.ts` |
| `pipeline-grouping.ts.saved` | `lib/reels/pipeline/grouping.ts` |
| `copy-pick.ts.saved` | `lib/reels/jev/questions/copy-pick.ts` |
| `copy-payoff.ts.saved` | `lib/reels/jev/questions/copy-payoff.ts` |
| `copy-story-match.ts.saved` | `lib/reels/jev/questions/copy-story-match.ts` |
| `idea-merge.ts.saved` | `lib/reels/jev/questions/idea-merge.ts` |
| `grouping.ts.saved` | `lib/reels/jev/questions/grouping.ts` |
| `prompt-web-search.ts.saved` | `lib/reels/prompts/web-search.ts` |
| `adapter-web-search.ts.saved` | `lib/reels/adapters/web-search.ts` |
| `rss-feed.ts.saved` | `lib/reels/adapters/rss-feed.ts` |
| `hacker-news.ts.saved` | `lib/reels/adapters/hacker-news.ts` |
| `adapters-index.ts.saved` | `lib/reels/adapters/index.ts` |
| `net-html.ts.saved` | `lib/reels/net/html.ts` |
| `net-http.ts.saved` | `lib/reels/net/http.ts` |
| `music-publish.ts.saved` | `lib/reels/music/publish.ts` |
| `config.ts.saved` | `lib/reels/config.ts` |
| `PRODUCT_SPEC.md.saved` | `planning/Trial Reels/PRODUCT_SPEC.md` |

The git tag `reels-prompts-checkpoint-2026-10-05` marks the commit that added this folder. The whole tree at `89ee9a3` is the same system, so `git checkout 89ee9a3 -- <path>` also restores any file.

To come back to this version:

1. Copy each `.saved` file over its live path, dropping the `.saved` suffix.
2. Run `npm run reels:sync-copy-text` so the generated bucket text matches the restored spec.
3. Remove or revert anything the later wave added outside these files (new modules, tests, migrations). New columns or tables can stay; old code ignores them.
4. Run `npm test`, then `./scripts/gcp/deploy-worker-code.sh` and `sudo systemctl restart helios-reels` on the VM.

Records written before or after keep their own version strings, so a restore does not change what old rows mean.
