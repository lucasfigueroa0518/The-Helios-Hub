/**
 * The render stage of a build (plan §6, S-33): a set's saved frames →
 * render (React → Chromium → JPEG, code checks) → one Haiku 5.5 review →
 * upload each JPEG → save each frame's render and review → the set is
 * `ready` (flagged when any frame needs Lucas). The worker calls this after
 * the copy stage (M3) has saved the frames.
 *
 * The review may move settings only. Before anything is saved, this checks
 * every frame's words are exactly what the build wrote; a change that touched
 * them would throw (it can't by construction; the check keeps it that way).
 *
 * AI Trivia (VIDEO_SERIES) renders each frame as a 5-second MP4 instead
 * (renderTriviaClips, lib/stories/trivia/render): the same review runs on the
 * clips' posters, a change re-renders the clips, and each frame uploads its
 * MP4 (storage_path, what Instagram fetches) and its poster JPEG
 * (poster_path, what the hub shows), media = 'video'.
 *
 * Per-hour rule (docs/social-overnight.md): no shared video-render lock
 * exists, so the clips render inside the Stories worker's build step, one set
 * at a time. AI Trivia is auto off; its renders happen when a person clicks
 * Generate, or in the 3:00 Stories hour once auto is on, an hour with no
 * other video renderer.
 */
import type { StoriesDb } from '@/lib/stories/db';
import type { Renderer as RendererHandle, RenderResult } from '@/lib/stories/render/render';
import { reviewSet, type ReviewCall, type ReviewOutcome } from '@/lib/stories/render/review';
import { framePhoto, MAX_JPEG_BYTES, MAX_MP4_BYTES, VIDEO_SERIES, type Frame, type FrameData, type Series, type Style } from '@/lib/stories/render/types';
import { getSet, markReady, recordCost, saveFrameRender, type FrameRow, type StorySet } from '@/lib/stories/repository';
import { frameObjectPath, type StoriesStorage } from '@/lib/stories/storage';

/** The words of a frame: every string in its data except its photo or logo. */
export function wordsOf(d: FrameData): string {
  const { photo: _p, logo: _l, ...rest } = d as FrameData & { photo?: unknown; logo?: unknown };
  void _p; void _l;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function framesFromRows(rows: FrameRow[], series: Series, style: Style): Frame[] {
  return rows.map((r) => ({ series, style, backdrop: r.backdrop, index: r.seq, total: rows.length, data: r.copy }));
}

export type RenderStageResult = { flagged: boolean; jpegBytes: number[]; reviewUsd: number; log: string[] };

/** One rendered video frame: the MP4 Instagram posts and the poster JPEG the review and the hub look at. */
export type VideoClip = { role: string; mp4: Buffer; poster: Buffer };
/** AI Trivia's clip renderer (renderTriviaClips' shape, CONTRACT §4 B). `music` is the build's plan (payload.trivia.music). */
export type RenderClips = (frames: Frame[], music: unknown) => Promise<{ clips: VideoClip[] }>;

/** The live renderer, loaded only when a video set renders (HyperFrames and ffmpeg stay out of every other path). */
const liveRenderClips: RenderClips = async (frames, music) => {
  const { renderTriviaClips } = await import('@/lib/stories/trivia/render');
  const input = frames.map((f) => {
    if (f.data.role !== 'question' && f.data.role !== 'answer') throw new Error(`an AI Trivia set has no ${f.data.role} frame`);
    return { role: f.data.role, copy: f.data, photo: framePhoto(f.data) ?? null };
  });
  return renderTriviaClips(input, music as Parameters<typeof renderTriviaClips>[1]);
};

export type RenderStageDeps = { db: StoriesDb; storage: StoriesStorage; renderer: RendererHandle; review: ReviewCall; setId: string; triviaRender?: RenderClips };

export async function runRenderStage(deps: RenderStageDeps): Promise<RenderStageResult> {
  const got = await getSet(deps.db, deps.setId);
  if (!got) throw new Error(`no set ${deps.setId}`);
  if (got.set.status !== 'building') throw new Error(`set ${deps.setId} is ${got.set.status}, not building`);
  const frames = framesFromRows(got.frames, got.set.series, got.set.style);
  if (VIDEO_SERIES.has(got.set.series)) return runVideoStage(deps, got, frames);

  const render = (f: Frame[]) => deps.renderer.render(f);
  const first = await render(frames);
  const out = await reviewSet({ frames, first, render, call: deps.review });

  for (const [i, f] of out.frames.entries()) {
    if (wordsOf(f.data) !== wordsOf(frames[i]!.data)) throw new Error(`frame ${i + 1}: the review changed its words`);
    const bytes = out.render.frames[i]!.bytes;
    if (bytes > MAX_JPEG_BYTES) throw new Error(`frame ${i + 1}: JPEG is ${bytes} bytes, over Instagram's 8 MB`);
  }

  for (const [i, f] of out.frames.entries()) {
    const row = got.frames[i]!;
    const r = out.render.frames[i]!;
    const path = frameObjectPath(deps.setId, row.seq, row.role);
    await deps.storage.upload(path, r.jpeg, 'image/jpeg');
    const rv = out.reviews[i]!;
    await saveFrameRender(deps.db, row.id, {
      storagePath: path,
      jpegBytes: r.bytes,
      review: { round1: rv.round1, change: rv.change, round2: rv.round2, note: rv.note, problems: r.problems },
      flagged: rv.flagged,
      backdrop: f.backdrop,
      template: row.template,
      copy: f.data,
      photo: framePhoto(f.data) ?? null,
    });
  }
  return finish(deps, out);
}

async function finish(deps: Pick<RenderStageDeps, 'db' | 'setId'>, out: ReviewOutcome): Promise<RenderStageResult> {
  for (const c of out.calls) {
    await recordCost(deps.db, { setId: deps.setId, vendor: 'anthropic', component: 'stories-render-review@1', model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens, cacheReadTokens: c.cacheReadTokens, cacheWriteTokens: c.cacheWriteTokens, usd: c.usd });
  }
  await markReady(deps.db, deps.setId, out.flagged);
  return { flagged: out.flagged, jpegBytes: out.render.frames.map((r) => r.bytes), reviewUsd: out.calls.reduce((s, c) => s + c.usd, 0), log: out.log };
}

/**
 * A video set (AI Trivia): clips → review on the posters (a change re-renders the clips) → upload each MP4 and its
 * poster → save each frame as media 'video'.
 */
async function runVideoStage(deps: RenderStageDeps, got: { set: StorySet; frames: FrameRow[] }, frames: Frame[]): Promise<RenderStageResult> {
  const music = (got.set.payload.trivia as { music?: unknown } | undefined)?.music;
  if (!music) throw new Error('no music plan on the set (payload.trivia.music)');
  const renderClips = deps.triviaRender ?? liveRenderClips;
  const clipsOf = new Map<RenderResult, VideoClip[]>();
  const render = async (f: Frame[]): Promise<RenderResult> => {
    const { clips } = await renderClips(f, music);
    if (clips.length !== f.length) throw new Error(`the clip renderer returned ${clips.length} clips for ${f.length} frames`);
    const result: RenderResult = {
      ok: true,
      problems: [],
      frames: clips.map((c, i) => {
        const problems = c.role === f[i]!.data.role ? [] : [`clip ${i + 1} is a ${c.role}, the frame a ${f[i]!.data.role}`];
        return { index: i + 1, role: c.role, problems, jpeg: c.poster, bytes: c.poster.length };
      }),
    };
    result.ok = result.frames.every((r) => !r.problems.length);
    clipsOf.set(result, clips);
    return result;
  };
  const first = await render(frames);
  const out = await reviewSet({ frames, first, render, call: deps.review });
  const clips = clipsOf.get(out.render);
  if (!clips) throw new Error('the reviewed render has no clips');

  for (const [i, f] of out.frames.entries()) {
    if (wordsOf(f.data) !== wordsOf(frames[i]!.data)) throw new Error(`frame ${i + 1}: the review changed its words`);
    if (clips[i]!.mp4.length > MAX_MP4_BYTES) throw new Error(`frame ${i + 1}: MP4 is ${clips[i]!.mp4.length} bytes, over Instagram's 100 MB`);
  }

  for (const [i, f] of out.frames.entries()) {
    const row = got.frames[i]!;
    const clip = clips[i]!;
    const videoPath = frameObjectPath(deps.setId, row.seq, row.role, 'mp4');
    const posterPath = frameObjectPath(deps.setId, row.seq, row.role, 'jpg');
    await deps.storage.upload(videoPath, clip.mp4, 'video/mp4');
    await deps.storage.upload(posterPath, clip.poster, 'image/jpeg');
    const rv = out.reviews[i]!;
    await saveFrameRender(deps.db, row.id, {
      storagePath: videoPath,
      jpegBytes: clip.poster.length,
      media: 'video',
      posterPath,
      mediaBytes: clip.mp4.length,
      review: { round1: rv.round1, change: rv.change, round2: rv.round2, note: rv.note, problems: out.render.frames[i]!.problems },
      flagged: rv.flagged,
      backdrop: f.backdrop,
      template: row.template,
      copy: f.data,
      photo: framePhoto(f.data) ?? null,
    });
  }
  return finish(deps, out);
}
