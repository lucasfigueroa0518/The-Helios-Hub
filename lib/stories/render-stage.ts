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
 */
import type { StoriesDb } from '@/lib/stories/db';
import type { Renderer as RendererHandle } from '@/lib/stories/render/render';
import { reviewSet, type ReviewCall } from '@/lib/stories/render/review';
import { framePhoto, MAX_JPEG_BYTES, type Frame, type FrameData, type Series, type Style } from '@/lib/stories/render/types';
import { getSet, markReady, recordCost, saveFrameRender, type FrameRow } from '@/lib/stories/repository';
import { frameObjectPath, type StoriesStorage } from '@/lib/stories/storage';

/** The words of a frame: every string in its data except photo and layout settings. */
export function wordsOf(d: FrameData): string {
  const { photo: _p, logo: _l, family: _f, ...rest } = d as FrameData & { photo?: unknown; logo?: unknown; family?: unknown };
  void _p; void _l; void _f;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function framesFromRows(rows: FrameRow[], series: Series, style: Style): Frame[] {
  return rows.map((r) => ({ series, style, backdrop: r.backdrop, index: r.seq, total: rows.length, data: r.copy }));
}

export type RenderStageResult = { flagged: boolean; jpegBytes: number[]; reviewUsd: number; log: string[] };

export async function runRenderStage(deps: { db: StoriesDb; storage: StoriesStorage; renderer: RendererHandle; review: ReviewCall; setId: string }): Promise<RenderStageResult> {
  const got = await getSet(deps.db, deps.setId);
  if (!got) throw new Error(`no set ${deps.setId}`);
  if (got.set.status !== 'building') throw new Error(`set ${deps.setId} is ${got.set.status}, not building`);
  const frames = framesFromRows(got.frames, got.set.series, got.set.style);

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
    const family = 'family' in f.data ? (f.data as { family?: string }).family : undefined;
    await saveFrameRender(deps.db, row.id, {
      storagePath: path,
      jpegBytes: r.bytes,
      review: { round1: rv.round1, change: rv.change, round2: rv.round2, note: rv.note, problems: r.problems },
      flagged: rv.flagged,
      backdrop: f.backdrop,
      template: family ?? row.template,
      copy: f.data,
      photo: framePhoto(f.data) ?? null,
    });
  }
  for (const c of out.calls) {
    await recordCost(deps.db, { setId: deps.setId, vendor: 'anthropic', component: 'stories-render-review@1', model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens, cacheReadTokens: c.cacheReadTokens, cacheWriteTokens: c.cacheWriteTokens, usd: c.usd });
  }
  await markReady(deps.db, deps.setId, out.flagged);
  return { flagged: out.flagged, jpegBytes: out.render.frames.map((r) => r.bytes), reviewUsd: out.calls.reduce((s, c) => s + c.usd, 0), log: out.log };
}
