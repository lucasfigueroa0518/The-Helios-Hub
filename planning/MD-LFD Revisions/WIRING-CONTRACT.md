# Production wiring contract: the locked news chain (2026-11-24)

Lucas (2026-11-24): "EVERYTHING needs to be wired up so that we're using all the decisions we made! … The new reranker, as well as the new photo finder, are both crucial parts of the new system!" Fact checks: "whatever we decided most recently" = the locked writer's Haiku fact check with one rewrite (W3, W12), which replaces MD's md-grounding and LFD's `grounded`.

Calls made 2026-11-24 (Lucas):
- **WC1** A golden video moves a story up only when that story is top tier; it never carries a story past the top-tier stop.
- **WC2** Last Few Days uses the reranker's order over its whole window and keeps its 5–6 count, filled in reranker order, skipping stories without usable media. No top-tier stop for LFD.

Integrator defaults (follow the most recent decision; recorded so Lucas can overrule):
- **WC3** Media verdict for the walk: golden video → `good`; good photo → `good`; good video with no good photo → `good` (a good video saves a story, D18/11-24, it never reorders); usable photo → `usable`; else `none`. Shown media follows the existing ladder (`mdMedia`/`lfdMedia`).
- **WC4** Check depth is 8 (MD_VIDEO_WINDOW, the newer number) for both photos and video.
- **WC5** No-media at the minimum: a story with no media never posts, except to reach MIN_STORIES (2) under the 11-24 build note (`keepWithMedia`).
- **WC6** Memory stays as it is in production: MD keeps md-development@1 (MASSIVE_BAR is uncalibrated, D11); LFD keeps its own past-post exclusion. MD passes `we_already_said` to the writer.
- **WC7** The reranker's angle is a field on the rerank tool (W12, WRITER-DRAFT §1) with ANGLE_FIELD's text verbatim.
- **WC8** RERANK_SYSTEM's "one day's shortlist" wording becomes format-neutral ("the shortlist for one post"); the user turn names the window. Nothing else in it changes.
- **WC9** Over-cap copy and failed facts share ONE rewrite turn. After it: a story whose claim is still unsupported drops; a story still over cap is kept and logged (the renderer's fit regions shrink it).
- **WC10** LFD `names` (orange marks, vision check) come from code: words of `namesIn(headline + body)` that appear verbatim in the copy. `setup` is always ''.
- **WC11** Photo band fit (D24 revised) is MD only. LFD keeps its current slide photo fit (no LFD band decision).
- **WC12** CI-32's used-photo ledger (`recentPhotoUses`/`usedReason`) and the size floor (`clearsFloor`) stay in force on every candidate.

Out of scope (undecided): LFD AI cover image and its prompt writer; MASSIVE_BAR calibration; per-format cool/value mix; shortlist depth beyond 25; opinion-piece fix; HAS_TEXT over-firing; writer Sonnet A/B.

## Hard rules for every owner
- No live Anthropic, Jev, Serper or web calls in tests or while building. Stub with canned tool responses. Never run tests/*.integration.ts or prefix globs.
- Every `messages.create` caches its stable prefix (`lib/anthropic-cache.ts`: `cachedSystemText`, `withToolCache`, `withConversationCache`).
- Prompt text is copied VERBATIM from the lab source named below. The only prompt wording change allowed is WC8.
- Clients are injected (deps), never constructed inside lib modules.
- One owner per file. Touch only the files you own. Don't commit.

## Phase 1 (parallel)

### Owner A: ranker — `lib/news-ranker/shortlist.ts`, `lib/news-ranker/rerank.ts`, `lib/news-ranker/posts.ts`, tests `tests/news-ranker-chain.test.ts`; may edit `scripts/news-ranker-rerank.ts` only to import RERANK_SYSTEM/tool from lib.
```ts
// shortlist.ts — Build B R8 (spec .memes-local/news-ranker-lab/tourney/build-b/spec-r8.json, copied into code verbatim as R8_SPEC; scoring as scripts/news-ranker-tourney.ts toQuestions/answerValue/score)
export type ChainStory = { id: string; headline: string; text: string; outlets: string[]; published: string | null; url: string };
export type Shortlisted = ChainStory & { cool: number; value: number; final: number };
export const SHORTLIST_TOP = 25;
export async function shortlist(stories: ChainStory[], deps: { jev: import('@/lib/social/jev/client').JevAsk; component: string; concurrency?: number }): Promise<{ ranked: Shortlisted[]; costUsd: number }>; // all stories, sorted by final desc; a story whose Jev call fails 3 times is dropped and logged via thrown-free result
// rerank.ts — RERANK_SYSTEM + grade tool from scripts/news-ranker-rerank.ts, plus `angle` (ANGLE_FIELD from scripts/news-writer.ts), WC8
export const RERANK_ID = 'news-rerank@1';
export const RERANK_MODEL = 'claude-opus-5-5'; // effort 'low' via output_config
export type Graded = Shortlisted & { grade: { cool: number; value: number; duplicate_of: string | null; top_tier: boolean; crowds: string[]; angle: string } };
export async function rerank(items: Shortlisted[], deps: { create: import('@/lib/stories/writer').WriterCreate; windowLabel: string }): Promise<{ graded: Graded[]; costUsd: number }>; // sorted as the lab (non-duplicates first, cool+value, cool); input text ≤700 chars as the lab
// posts.ts — cleanup + choosePosts from scripts/news-ranker-rerank.ts / md-photo-trial.ts cleanup()
export type MediaVerdict = 'good' | 'usable' | 'none';
export const CHECK_DEPTH = 8; export const MIN_POSTS = 2; export const MAX_POSTS = 5;
export function cleanup(graded: Graded[]): { kept: Graded[]; merged: Map<string, Graded[]> }; // drop duplicates (kept id → its duplicates, so photos can reuse their URLs); union-find crowds, keep the highest ranked per group
export function checkWindow(kept: Graded[]): Graded[]; // first CHECK_DEPTH
export function choosePosts(kept: Graded[], verdict: (id: string) => MediaVerdict, o?: { min?: number; max?: number }): string[]; // D16/D17/"D23 corrected" + WC1 + WC5: walk, stop at first non-top-tier, post `good`; under min fill in rank order from checked `good|usable`, then (WC5) from checked `none`
export function fillInOrder(kept: Graded[], verdict: (id: string) => MediaVerdict, o: { min: number; max: number }): string[]; // WC2 (LFD): rank order, skip `none`, stop at max
```

### Owner B: photos — `lib/news-photos/brief.ts`, `candidates.ts`, `grade.ts`, `pick.ts`, `band.ts`, `index.ts`, tests `tests/news-photos.test.ts`.
Lab sources: `scripts/md-photo-trial.ts` (brief, candidates, toJpeg, grade, pick, blatantlyAi), `scripts/photo-vision-test.ts` (BRIEF_SYSTEM, PHOTO_QUESTIONS, tier, THUMBNAIL_CUTOFF; REAL_CHECK_SYSTEM: import it from `lib/video-finder/find.ts` if it is exported there; otherwise keep a verbatim copy in `pick.ts`. Never edit find.ts), `scripts/story-crop.ts` (ESSENTIAL, HAS_TEXT, band constants, decideBand, renderBand), `scripts/story-upscale.ts` (needsUpscale, esrganSharpen, bandFrame). Upscaler binary is optional: none found → no upscale, logged.
```ts
export type PhotoStory = { id: string; headline: string; text: string; url: string; duplicateUrls: string[] };
export type Candidate = { src: string; source: 'article' | 'other_outlet' | 'search' | 'extra'; credit: string };
export type GradedPhoto = Candidate & { tier: MediaVerdict; clarity: number; jpeg: Buffer; width: number; height: number };
export type PhotoResult = { id: string; tier: MediaVerdict; pick: GradedPhoto | null; brief: { kind: string; subject: string; good_if: string } | null; costUsd: number; log: string[] };
export type PhotoDeps = {
  create: WriterCreate;                       // Haiku brief + AI check (claude-haiku-5-5)
  jev: { systemOne: (...a: any[]) => Promise<any> }; // TypeSafe client, header TypeSafe-Danger-Zone-Images
  readPage: (url: string) => Promise<{ images: string[] } | null>; // adapt lib/social/reporter/read-page
  serper: ((q: string) => Promise<string[]>) | null;
  fetchImage: (url: string) => Promise<Buffer | null>;
  usedReason?: (src: string) => string | null; // WC12 ledger
  minShortSide?: number;                       // WC12 floor
};
export async function findStoryPhoto(s: PhotoStory, deps: PhotoDeps, o?: { extra?: Candidate[] }): Promise<PhotoResult>; // brief → candidates (+extra, e.g. LFD lead image / builder harvest) → Jev grade → good then usable → AI check on the pick (fail → next)
export type BandFit = { jpeg: Buffer; contained: boolean; upscaled: boolean; costUsd: number };
export async function fitToBand(img: Buffer, deps: { jev: PhotoDeps['jev']; upscaler: string | null; tmpDir: string }): Promise<BandFit>; // Jev jev-preview box (ESSENTIAL + HAS_TEXT in one call) → decideBand → band frame JPEG for the MD photo band; `contained` maps to Photo.contained
```
Credits: reuse the production credit rules in `lib/stories/photos.ts` / `lib/social/photos` (read them); never invent a credit.

### Owner C: writer — `lib/news-writer/index.ts` (+ `prompts.ts`), tests `tests/news-writer.test.ts`; may edit `scripts/news-writer.ts` only to import WRITER_CORE/FORMATS/FACT_CHECK_SYSTEM/ANGLE_FIELD/tools from lib so the lab never drifts.
```ts
export const WRITER_ID = 'news-writer@1'; export const WRITER_MODEL = 'claude-opus-5-5'; /* effort low */ export const CHECK_MODEL = 'claude-haiku-5-5';
export type Format = 'md' | 'lfd';
export type WriterStory = { key: string; headline: string; text: string; weAlreadySaid?: string | null }; // material adds we_already_said when set (FORMATS.md refers to it)
export type Written = { key: string; chosen: 'mine' | 'editor'; angle: string; headline: string; body: string; highlight: string; names: string[] }; // highlight '' for md; names per WC10
export async function writeStories(f: Format, stories: WriterStory[], editorAngles: Record<string, string>, deps: { create: WriterCreate }): Promise<{ written: Written[]; dropped: Array<{ key: string; reason: string }>; over: string[]; costUsd: number; log: string[] }>;
```
Flow = `writeDay` (blind angles → reveal → write → Haiku fact check with code-verified quotes) + WC9 (one rewrite turn for failed facts AND over-cap; recheck rewritten stories' facts; still unsupported → dropped). A missing editor angle shows as "(none)" in the reveal. A story missing from the write call is dropped.

## Phase 2 (after Phase 1 passes; parallel)

### Owner D: Morning Download — `lib/stories/build/morning-download.ts`, `lib/stories/build/common.ts`, `lib/stories/build/index.ts`, `scripts/stories_worker.ts`, `tests/stories-pipeline.test.ts` (+ new `tests/stories-md-chain.test.ts`).
Chain: candidates (as today, incl. md-development memory) → `shortlist` → top SHORTLIST_TOP → `rerank` (windowLabel = the NY date) → `cleanup` → `checkWindow` → per story in parallel: `findStoryPhoto` (duplicateUrls from `merged`) and the video finder (existing) → WC3 verdicts → `choosePosts` → writer (`writeStories('md', …)`, editor angles = grade.angle) → frame copy joins as `${headline with a final period added if missing} ${body}` so `splitLead` bolds the headline → source line from code (`via <c.sourceName>`) → media per ladder; photo frames use `fitToBand` output uploaded with the existing storage upload, `contained` set → opener peek, cover headline rotation unchanged. Remove from the MD path: md-final-rank@1, chooseLeads/chooseStories ranking, SAME_EVENT spin-off/merge passes (rerank duplicates/crowds replace them), md-headlines@5, md-grounding, writer photo requests and the opener photo search. Keep exports other modules/tests import (re-export or adapt their tests). Worker wires `serper`, `readPage`, `fetchImage`, upscaler (`findUpscaler`), Jev client.

### Owner E: Last Few Days — `lib/lfd/run.ts`, `lib/lfd/pick.ts`, `lib/lfd/write.ts`, `lib/lfd/ground.ts`, `lib/lfd/types.ts`, `lib/lfd/live.ts`, `lib/lfd/photos.ts`, LFD tests.
Chain: window candidates (as today, incl. own-repeat exclusion) → `shortlist` → `rerank` (windowLabel = window dates) → `cleanup` → walk in rerank order with `fillInOrder({min:5,max:6})`, with replacement from further down the reranked list instead of the Selector lanes → per story: media in the D16/D19 (11-24) order golden video → meme that clears the gate → `findStoryPhoto` (extra = lead image + builder harvest) → writer `writeStories('lfd', …)` once per round with editor angles; `setup` '' → existing render, vision, canvas rotation, cover hook rotation, captions unchanged. Remove `LFD_SYSTEM` use, `grounded`, `leadOrder` (rerank order is final), Selector lanes and `scoreMajor` from the run path.

## Integration (integrator)
Mechanical cross-check of every name above against the code; `npx tsc --noEmit`; the offline test files named above plus existing stories/lfd tests (filtered to pass/fail). Then a fresh read-only reviewer. VM: `scripts/gcp/deploy-social-worker.sh` (Lucas runs it).

Estimated production spend per MD day: Jev shortlist ≈ $0.02, Opus rerank ≈ $0.07, photos ≈ $0.04, writer + check ≈ $0.07, video ≤ $0.50 cap. LFD similar per post.
