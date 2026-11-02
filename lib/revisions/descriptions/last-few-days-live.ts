/**
 * Live deps for the Last Few Days revision description (last-few-days.ts). Every service import is
 * lazy, so importing the registry loads no renderer, storage, model or Jev client.
 *
 * Ceilings: vision.ts (checkSlide), the Stories finder and the structured writer call catch errors
 * from the calls they make, so a CeilingReached thrown inside a paid call would be swallowed and the
 * search would keep paying. Every paid call goes through meteredCreate / meteredJev, which refuse
 * BEFORE paying once the meter has stopped; each dep re-throws the stored error when it returns.
 */
import type { LastFewDaysDeps, Metered } from './last-few-days';

/** Claude's price for one reply, by the model the request named. */
async function pricer() {
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');
  return (res: unknown, params: unknown) => Number(priceAnthropicMessages([res as never], { modelId: String((params as { model?: string }).model ?? '') }).costUsd);
}

async function meteredClaude(m: Metered) {
  const [{ newAnthropic }, { liveMessagesCreate }, { meteredCreate }] = await Promise.all([
    import('@/lib/anthropic-client'),
    import('@/lib/social/reporter/reporter'),
    import('./carousels-live'),
  ]);
  return meteredCreate(liveMessagesCreate(newAnthropic()), m, await pricer());
}

async function meteredJevAsk(m: Metered) {
  const [{ createJevAsk, jevCostUsd }, { meteredJev }] = await Promise.all([import('@/lib/social/jev/client'), import('./carousels-live')]);
  return meteredJev(createJevAsk(), m, jevCostUsd);
}

export const liveLastFewDaysDeps: LastFewDaysDeps = {
  async renderSlides({ slug, post, slides }) {
    const [fsp, { checkRenderFit }, { storeSlideJpegs }, { mediaBucket }, { SLIDE_BUCKET }] = await Promise.all([
      import('node:fs/promises'),
      import('@/lib/social/render/fit-check'),
      import('@/lib/social/overnight/slides'),
      import('@/lib/media-bucket'),
      import('@/lib/social/overnight/config'),
    ]);
    const bucket = mediaBucket(SLIDE_BUCKET);
    // The saved render keeps memes as `storage:<object>` (run.ts persistEngineMemes, the meme stage); the renderer needs a URL.
    const draw = JSON.parse(JSON.stringify(post)) as typeof post;
    const signed = new Map<string, string>();
    const resolve = async (url: string | undefined) => {
      if (!url?.startsWith('storage:')) return url;
      if (!signed.has(url)) signed.set(url, await bucket.sign(url.slice('storage:'.length), 900));
      return signed.get(url)!;
    };
    for (const sl of draw.slides) {
      if (sl.photoUrl) sl.photoUrl = (await resolve(sl.photoUrl))!;
      if (sl.lfdCover?.meme) sl.lfdCover.meme.url = (await resolve(sl.lfdCover.meme.url))!;
      for (const t of sl.lfdCover?.photos ?? []) t.url = (await resolve(t.url))!;
    }
    const wanted = new Map(slides.map((s) => [s.slide, s.key]));
    const out = new Map(slides.map((s) => [s.slide, { slide: s.slide, file: '', fitProblems: [] as string[], renderProblems: [] as string[], png: null as Buffer | null }]));
    // The whole post is drawn (local Chromium, no AI) so slides keep their place; only the listed slides'
    // problems count against the fix, and only their JPEGs are uploaded, each to its own new key.
    await storeSlideJpegs(slug, draw, {
      prefix: 'lfd',
      fitCheck: async (p, opts) => {
        const r = await checkRenderFit(p, opts);
        for (const [n, o] of out) {
          const own = JSON.stringify(draw.slides[n - 1] ?? {});
          const mine = (x: string) => {
            if (x.startsWith(`slide ${n} `)) return true;
            if (/^slide \d+ /.test(x)) return false;
            // An image that failed to load counts against the slide that shows it; a font problem against every slide.
            const img = /^image failed to load: (.*)$/.exec(x)?.[1];
            return img ? own.includes(JSON.stringify(img).slice(1, -1)) : true;
          };
          o.fitProblems = r.problems.filter((x) => mine(x) && /text fit/.test(x));
          o.renderProblems = [
            ...r.problems.filter((x) => mine(x) && !/text fit/.test(x)),
            ...r.violations.filter((v) => v.slide === n).map((v) => `bounds: ${v.element} "${v.text}"`),
          ];
          if (opts?.screenshotDir) o.png = await fsp.readFile(`${opts.screenshotDir}/slide-slide-${String(n).padStart(2, '0')}.png`).catch(() => null);
        }
        return r;
      },
      upload: async (p, b) => {
        const n = Number(/slide-(\d+)\.jpg$/.exec(p)?.[1] ?? 0);
        const key = wanted.get(n);
        if (!key) return;
        await bucket.upload(key, b, 'image/jpeg');
        out.get(n)!.file = key;
      },
    });
    return [...out.values()];
  },

  async sourceText({ url, body }) {
    const [{ fetchBodyLive }, { MIN_TEXT_CHARS }] = await Promise.all([import('@/lib/social/ingest/select/enrich'), import('@/lib/lfd/run')]);
    // The run's fullText rule: the longer of the fetched article and what is saved, if it is long enough.
    const fetched = await fetchBodyLive(url).catch(() => null);
    const best = fetched && fetched.length > body.length ? fetched : body;
    return best.length >= MIN_TEXT_CHARS ? best : null;
  },

  async grounded(copy, source, m) {
    const { grounded } = await import('@/lib/lfd/ground');
    const ok = await grounded(await meteredJevAsk(m), copy, source);
    if (m.stopped()) m.halt();
    return ok;
  },

  async rewrite({ pick, body, note }, m) {
    const { writeStories } = await import('@/lib/lfd/write');
    const res = await writeStories(await meteredClaude(m), [{ pick, body }], note);
    if (m.stopped()) m.halt();
    return res.ok ? (res.stories[0] ?? null) : null;
  },

  async findPhoto({ pick, copy, exclude }, m) {
    const [{ createLivePhotoFinder }, { findPhotos }] = await Promise.all([import('@/lib/stories/photos'), import('@/lib/lfd/photos')]);
    // Every Jev pick and Haiku photo-vision call the finder makes is metered and refused once the meter stopped.
    const finder = createLivePhotoFinder({ jev: await meteredJevAsk(m), create: await meteredClaude(m), runRef: `lfd-revision:${pick.key}:${new Date().toISOString()}` });
    const found = await findPhotos(finder, [{ pick, copy }], new Set(exclude));
    if (m.stopped()) m.halt();
    return { photo: found.photos[0] ?? null, trace: found.traces[0] ?? [] };
  },

  async vision(png, story, m) {
    const { checkSlide } = await import('@/lib/lfd/vision');
    const v = await checkSlide(await meteredClaude(m), png, story);
    if (m.stopped()) m.halt();
    return v;
  },

  async unschedule(q, postId) {
    const { unscheduleLfdPost } = await import('@/lib/lfd/schedule');
    return unscheduleLfdPost(q, postId);
  },
};
