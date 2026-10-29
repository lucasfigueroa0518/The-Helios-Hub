/**
 * Live deps for the IG Stories revision description (stories.ts). Every service import is lazy, so
 * importing the registry loads no renderer, storage, model or Jev client.
 *
 * Ceilings: the photo finder (searchVisual, the vision check) catches errors from the calls it makes,
 * so a CeilingReached thrown inside a paid call would be swallowed and the search would keep paying.
 * Every paid call goes through meteredCreate / meteredJev / a metered Jev transport, which refuse
 * BEFORE paying once the meter has stopped; each dep re-throws the stored error when it returns.
 *
 * Costs also land in stories.cost_events for the set (as the build's do): the writer and Stories Jev
 * record their own rows.
 */
import type { StoriesDeps, Metered } from './stories';

/** Claude `create` metered at Stories' own prices (lib/stories/cost.ts priceCall), by the model that answered. */
async function meteredStoriesCreate<C extends (params: never) => Promise<unknown>>(create: C, m: Metered): Promise<C> {
  const [{ priceCall }, { meteredCreate }] = await Promise.all([import('@/lib/stories/cost'), import('./carousels-live')]);
  return meteredCreate(create, m, (res, params) => {
    const r = res as { model?: string; usage: Parameters<typeof priceCall>[1] };
    const asked = String((params as { model?: string }).model ?? '');
    try {
      return priceCall(r.model || asked, r.usage).usd;
    } catch {
      return priceCall(asked, r.usage).usd;
    }
  });
}

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
    // The text the build grounded against: the story's stories.pool entry (kept after it is used).
    const { rows } = await q(
      `SELECT payload->'story'->>'body' AS body FROM stories.pool
        WHERE series = 'morning_download' AND (key = $1 OR payload->>'story_key' = $1) AND payload->'story'->>'body' IS NOT NULL
        ORDER BY refreshed_at DESC LIMIT 1`,
      [key],
    );
    const saved = String(rows[0]?.body ?? '').trim();
    if (saved) return saved;
    const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
    const fetched = (await fetchBodyLive(url).catch(() => null))?.trim();
    return fetched || null;
  },

  async grounded({ setId, headline, source }, m) {
    const [{ createStoriesJev }, { liveJevTransport }, { jevUsd }, { MD_GROUNDING }, { liveStoriesDb }, { STORIES_BODY_CHARS }] = await Promise.all([
      import('@/lib/stories/jev'),
      import('@/lib/reels/jev/client'),
      import('@/lib/reels/jev/runner'),
      import('@/lib/stories/questions'),
      import('@/lib/stories/db'),
      import('./stories'),
    ]);
    // The transport refuses before paying once the meter has stopped, and charges each answer.
    const transport = {
      async systemOne(state: never, questions: never) {
        if (m.stopped()) m.halt();
        const res = await liveJevTransport.systemOne(state, questions);
        m.spend(jevUsd(res.usage.input_tokens));
        return res;
      },
    } as typeof liveJevTransport;
    const jev = createStoriesJev(transport, liveStoriesDb);
    const res = await jev.ask({ component: 'md-grounding', set: MD_GROUNDING, setId, state: { headline, source: { untrusted_content: source.slice(0, STORIES_BODY_CHARS) } } });
    if (m.stopped()) m.halt();
    return res.answers.supported.noul;
  },

  async rewrite({ setId, story, note }, m) {
    const [{ writeStructured, liveWriterCreate }, { MD_HEADLINES, material }, { liveStoriesDb }, { loadSettings }, { STORIES_BODY_CHARS }] = await Promise.all([
      import('@/lib/stories/writer'),
      import('@/lib/stories/prompts'),
      import('@/lib/stories/db'),
      import('@/lib/stories/settings'),
      import('./stories'),
    ]);
    const settings = await loadSettings(liveStoriesDb);
    const create = await meteredStoriesCreate(liveWriterCreate(), m);
    // Errors (an outage, a refusal, no tool call) are thrown, never turned into "no rewrite": the
    // description reports them as failed, and only a second grounding miss as blocked.
    try {
      // The build's writer call (morning-download.ts writeFor) for this one story, under a short id.
      const out = await writeStructured<import('@/lib/stories/prompts').MdHeadlinesOut>({
        create, db: liveStoriesDb, setId, component: MD_HEADLINES.id, model: settings.models.copy, system: MD_HEADLINES.system, tool: MD_HEADLINES.tool,
        user: `${note}\n\n${material([{ key: 's1', headline: story.headline, outlet: story.outlet, also_reported_by: [], published: null, url: story.url, text: story.body.slice(0, STORIES_BODY_CHARS) }])}`,
      });
      if (m.stopped()) m.halt();
      const s = out.value.stories.find((x) => x.key === 's1') ?? out.value.stories[0];
      return s?.headline ? { headline: s.headline } : null;
    } catch (e) {
      if (m.stopped()) m.halt();
      throw e;
    }
  },

  async findPhoto({ setId, request }, m) {
    const [{ createLivePhotoFinder }, { newAnthropic }, { createJevAsk, jevCostUsd }, { meteredJev }] = await Promise.all([
      import('@/lib/stories/photos'),
      import('@/lib/anthropic-client'),
      import('@/lib/social/jev/client'),
      import('./carousels-live'),
    ]);
    const client = newAnthropic();
    // Every Jev pick and Haiku photo-vision call the finder makes is metered and refused once the meter stopped.
    const finder = createLivePhotoFinder({
      jev: meteredJev(createJevAsk(), m, jevCostUsd),
      create: await meteredStoriesCreate((p: Parameters<typeof client.messages.create>[0]) => client.messages.create(p as never) as never, m),
      runRef: `stories-revision:${setId}:${new Date().toISOString()}`,
    });
    const photo = await finder.find(request);
    if (m.stopped()) m.halt();
    return photo;
  },

  async photoSize(url) {
    const { createSizeProbe } = await import('@/lib/social/photos/size');
    return createSizeProbe()(url);
  },

  async unschedule(q, setId) {
    const { unscheduleSet } = await import('@/lib/stories/repository');
    return unscheduleSet({ query: async (text, params) => ({ rows: (await q(text, params)).rows }) }, setId);
  },
};
