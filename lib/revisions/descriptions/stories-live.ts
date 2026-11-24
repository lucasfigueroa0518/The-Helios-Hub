/**
 * Live deps for the IG Stories revision description (stories.ts). Every service import is lazy, so
 * importing the registry loads no renderer, storage, model or Jev client.
 *
 * Morning Download's wording and photo fixes run the build's own pieces (lib/stories/build/morning-download.ts):
 * the news writer (lib/news-writer writeStories('md') and its Haiku fact check, checkFacts) and the news photo
 * finder (lib/news-photos findStoryPhoto) with the build's band fit (bandPhotoFor: fitToBand/decideBand).
 *
 * Ceilings: the photo finder and its graders catch errors from the calls they make, so a CeilingReached thrown
 * inside a paid call would be swallowed and the search would keep paying. Every paid call (Claude, Jev, Serper) goes
 * through a metered wrapper that refuses BEFORE paying once the meter has stopped; each dep re-throws the stored
 * error when it returns. Claude calls send the cached prefixes the news pieces build (lib/anthropic-cache.ts).
 */
import type { Metered, StoriesDeps } from './stories';

const meteredWriterCreate = async (m: Metered) => (await import('./carousels-live')).meteredNewsCreate(m);

export const liveStoriesDeps: StoriesDeps = {
  async renderFrame({ frame, key }) {
    const [{ openRenderer }, { createStoriesStorage }, { MAX_JPEG_BYTES }] = await Promise.all([
      import('@/lib/stories/render/render'),
      import('@/lib/stories/storage'),
      import('@/lib/stories/render/types'),
    ]);
    // Local Chromium, no AI. Only this frame is drawn; its own code checks decide, and only a clean JPEG is stored.
    const renderer = await openRenderer();
    try {
      const res = await renderer.render([frame]);
      const r = res.frames[0];
      if (!r) return { file: '', bytes: 0, problems: ['the renderer returned no frame', ...res.problems] };
      const problems = [...new Set([...r.problems, ...res.problems])];
      if (problems.length || r.bytes > MAX_JPEG_BYTES) return { file: '', bytes: r.bytes, problems };
      await createStoriesStorage().upload(key, r.jpeg, 'image/jpeg');
      return { file: key, bytes: r.bytes, problems: [] };
    } finally {
      await renderer.close().catch(() => {});
    }
  },

  async heldPhotos(q) {
    const { recentPhotoUses } = await import('@/lib/stories/sources/carousel');
    const uses = await recentPhotoUses({ query: async (text, params) => ({ rows: (await q(text, params)).rows }) }, new Date());
    return new Set(uses.keys());
  },

  async sourceText(q, { key, url }) {
    // The text the build wrote from: the story's stories.pool entry (kept after it is used), with the source's headline.
    const { rows } = await q(
      `SELECT payload->'story'->>'body' AS body, payload->'story'->>'headline' AS headline FROM stories.pool
        WHERE series = 'morning_download' AND (key = $1 OR payload->>'story_key' = $1) AND payload->'story'->>'body' IS NOT NULL
        ORDER BY refreshed_at DESC LIMIT 1`,
      [key],
    );
    const saved = String(rows[0]?.body ?? '').trim();
    if (saved) return { text: saved, headline: String(rows[0]?.headline ?? '').trim() || null };
    const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
    const fetched = (await fetchBodyLive(url).catch(() => null))?.trim();
    return fetched ? { text: fetched, headline: null } : null;
  },

  async factCheck({ story, words }, m) {
    const { checkFacts } = await import('@/lib/news-writer');
    try {
      const res = await checkFacts([{ key: 's1', headline: story.headline, text: story.text }], [{ key: 's1', headline: words, body: '' }], { create: await meteredWriterCreate(m) });
      if (m.stopped()) m.halt();
      return { ok: res.failed.length === 0, why: res.failed.map((c) => `"${c.claim}": ${c.evidence}`).join('; ') };
    } catch (e) {
      if (m.stopped()) m.halt();
      throw e;
    }
  },

  async rewrite({ story, instruction }, m) {
    const [{ writeStories }, { frameCopy }] = await Promise.all([import('@/lib/news-writer'), import('@/lib/stories/build/morning-download')]);
    // Errors (an outage, a refusal, no tool call) are thrown, never turned into "no rewrite": the description reports
    // them as failed, and only a story the writer's own fact check dropped as blocked.
    try {
      // The build's writer call for this one story (editor angle: the build's saved angle), under a short id.
      const res = await writeStories('md', [{ key: 's1', headline: story.headline, text: story.text }], { s1: story.angle }, { create: await meteredWriterCreate(m) }, { instruction });
      if (m.stopped()) m.halt();
      const w = res.written.find((x) => x.key === 's1');
      if (!w) return { dropped: res.dropped[0]?.reason ?? 'the writer wrote no story' };
      return { headline: frameCopy(w.headline, w.body) };
    } catch (e) {
      if (m.stopped()) m.halt();
      throw e;
    }
  },

  async findPhoto({ setId, story, hint, exclude }, m) {
    const [np, { findPhotoUpscaler }, { bandPhotoFor }, { createStoriesStorage }, { meteredNewsPhotos }, fs, os, path] = await Promise.all([
      import('@/lib/news-photos'),
      import('@/lib/news-photos/band'),
      import('@/lib/stories/build/morning-download'),
      import('@/lib/stories/storage'),
      import('./carousels-live'),
      import('node:fs'),
      import('node:os'),
      import('node:path'),
    ]);
    const create = await meteredWriterCreate(m);
    const { jev, serper, fetchImage } = await meteredNewsPhotos(m);
    // The person's hint: one image search whose results join the finder's own candidates (graded the same way).
    const extra: import('@/lib/news-photos').Candidate[] = hint && serper ? (await serper(hint).catch(() => [] as string[])).map((src) => ({ src, source: 'extra', credit: '' })) : [];
    // CI-32 and the set: the build's ledger check, plus this set's own and turned-down photos.
    const usedReason = (src: string) => (exclude.has(src) ? 'on this set, turned down before, or published in the last 20 days' : null);
    const res = await np.findStoryPhoto(story, { create, jev, readPage: np.readPageImages(), serper, fetchImage, usedReason }, { extra });
    if (m.stopped()) m.halt();
    const log = [...res.log];
    if (!res.pick || res.tier === 'none') return { photo: null, log };
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-band-rev-'));
    try {
      const band = await bandPhotoFor(res.pick, { fetchImage, jev, upscaler: findPhotoUpscaler(), tmpDir, storage: createStoriesStorage() }, setId, story.id);
      if (m.stopped()) m.halt();
      return { photo: band.photo, log: [...log, band.step] };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },

  async unschedule(q, setId) {
    const { unscheduleSet } = await import('@/lib/stories/repository');
    return unscheduleSet({ query: async (text, params) => ({ rows: (await q(text, params)).rows }) }, setId);
  },
};
