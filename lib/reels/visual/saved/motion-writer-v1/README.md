# Motion writer v1 (saved)

Frozen on 2026-09-24, before the polarity and grade-routing upgrade (`motion-writer-v2`).

This is the image-to-video prompt as it was producing clips. Claude (the motion writer, `claude-sonnet-5`) read `motion-writer-prompt.txt` with the background still and wrote one timestamped block. `motion-prompt.ts` rebuilt that block into the text Kling 3.0 Standard on Fal received, ending with `Camera: slow dolly in, one move, the full 8 seconds.` (or `out`). Every grade got the same prompt.

| Saved copy | Live file |
|---|---|
| `motion-writer-prompt.txt` | `lib/reels/visual/motion-writer-prompt.txt` |
| `motion-prompt.ts.saved` | `lib/reels/visual/motion-prompt.ts` |
| `motion-writer.ts.saved` | `lib/reels/visual/motion-writer.ts` |
| `video-run.ts.saved` | `lib/reels/visual/video-run.ts` |
| `reels-motion.test.ts.saved` | `tests/reels-motion.test.ts` |

Each copy is byte-for-byte. The code copies end in `.saved` so TypeScript and the test runner skip them. `lib/reels` is not in git yet, so these copies are the only record of v1.

## Switching back to v1

From the repo root:

```bash
S=lib/reels/visual/saved/motion-writer-v1
cp "$S/motion-writer-prompt.txt" lib/reels/visual/motion-writer-prompt.txt
cp "$S/motion-prompt.ts.saved" lib/reels/visual/motion-prompt.ts
cp "$S/motion-writer.ts.saved" lib/reels/visual/motion-writer.ts
cp "$S/video-run.ts.saved" lib/reels/visual/video-run.ts
cp "$S/reels-motion.test.ts.saved" tests/reels-motion.test.ts
npx tsx --test tests/reels-motion.test.ts
```

Then redeploy the worker, because the VM runs its own copy (see "Worker sync" in `docs/trial-reels.md`).

v2 changed one line in `video-run.ts` (`profile: target.colorProfile,` in the `writeMotion` call). If that file has changed for other reasons since, delete that line instead of copying the whole file over it. The same goes for the test file: `diff` before you copy.

After a restore, nothing reads `lib/reels/visual/motion-grades/`. It can stay or be deleted.

Rows written by v2 carry a `Motion: motion-writer-v2, <grade>` line in `video_jobs.motion_prompt`. Rows without that line came from v1.
