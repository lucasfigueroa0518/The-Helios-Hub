/**
 * Live deps for the Last Few Days revision description (last-few-days.ts). Every service import is
 * lazy, so importing the registry loads no renderer, storage, model or Jev client.
 *
 * Wording and photo fixes run the run's own pieces (lib/lfd/run.ts): the news writer (lib/news-writer
 * writeStories('lfd') and its Haiku fact check, checkFacts) and the photo rung (lfdPhotoRung: findStoryPhoto with the
 * lead image and, for a builder story, AI Drama's harvest as extra candidates).
 *
 * Ceilings: vision.ts (checkSlide), the photo finder and its graders catch errors from the calls they make, so a
 * CeilingReached thrown inside a paid call would be swallowed and the search would keep paying. Every paid call goes
 * through a metered wrapper (meteredCreate / meteredNewsCreate / meteredNewsPhotos), which refuses BEFORE paying once
 * the meter has stopped; each dep re-throws the stored error when it returns. A builder story's harvest runs under its
 * own cap (BUILDER_HARVEST_CAP_USD) and is charged to the meter when it returns.
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

const meteredWriterCreate = async (m: Metered) => (await import('./carousels-live')).meteredNewsCreate(m);

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
      if (sl.lfdCover?.image) sl.lfdCover.image.url = (await resolve(sl.lfdCover.image.url))!;
      for (const t of sl.lfdCover?.photos ?? []) t.url = (await resolve(t.url))!;
    }
    const wanted = new Map(slides.map((s) => [s.slide, s.key]));
    const out = new Map(slides.map((s) => [s.slide, { slide: s.slide, file: '', fitProblems: [] as string[], renderProblems: [] as string[], png: null as Buffer | null }]));
    // The whole post is drawn (local Chromium, no AI) so slides keep their place; only the listed slides'
    // problems count against the fix, and only their JPEGs are uploaded, each to its own new key.
    await storeSlideJpegs(slug, draw, {
      failedImagesCheckedPerSlide: true,
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

  async factCheck(copy, source, m) {
    const [{ checkFacts }, { WRITER_SOURCE_CHARS: SOURCE_CHARS }] = await Promise.all([import('@/lib/news-writer'), import('@/lib/lfd/run')]);
    // The saved story keeps no source headline: the article text alone is the evidence.
    const body = [copy.setup, copy.body].filter((x) => x?.trim()).join(' ');
    const res = await checkFacts([{ key: 's1', headline: '', text: source.slice(0, SOURCE_CHARS) }], [{ key: 's1', headline: copy.headline, body }], { create: await meteredWriterCreate(m) });
    if (m.stopped()) m.halt();
    return { ok: res.failed.length === 0, why: res.failed.map((c) => `"${c.claim}": ${c.evidence}`).join('; ') };
  },

  async rewrite({ pick, source, instruction }, m) {
    const [{ writeStories }, { copyOf, WRITER_SOURCE_CHARS: SOURCE_CHARS }] = await Promise.all([import('@/lib/news-writer'), import('@/lib/lfd/run')]);
    // The run's writer call (run.ts writeSome) for this one story, under its ordinal key; no editor angle is saved.
    const res = await writeStories('lfd', [{ key: 's1', headline: '', text: source.slice(0, SOURCE_CHARS) }], { s1: '' }, { create: await meteredWriterCreate(m) }, { instruction });
    if (m.stopped()) m.halt();
    const w = res.written.find((x) => x.key === 's1');
    return w ? copyOf(pick.key, w) : { dropped: res.dropped[0]?.reason ?? 'the writer wrote no story' };
  },

  async findPhoto({ pick, exclude, ledger, hint }, m) {
    const [np, { lfdPhotoRung }, { BUILDER_HARVEST_CAP_USD }, { liveBuilderHarvest }, { readPage }, { meteredNewsPhotos }] = await Promise.all([
      import('@/lib/news-photos'),
      import('@/lib/lfd/run'),
      import('@/lib/lfd/photos'),
      import('@/lib/lfd/live'),
      import('@/lib/social/reporter/read-page'),
      import('./carousels-live'),
    ]);
    const create = await meteredWriterCreate(m);
    const { jev, serper, fetchImage } = await meteredNewsPhotos(m);
    // One read per article page: the lead image and the finder share it (as the run does).
    const pages = new Map<string, ReturnType<typeof readPage>>();
    const read = (url: string) => {
      if (!pages.has(url)) pages.set(url, readPage(url));
      return pages.get(url)!;
    };
    // The person's hint: one image search whose results join the candidates (graded the same way).
    const extra: import('@/lib/news-photos').Candidate[] = hint && serper ? (await serper(hint).catch(() => [] as string[])).map((src) => ({ src, source: 'extra', credit: '' })) : [];
    const harvestBudget = { usd: 0, capUsd: BUILDER_HARVEST_CAP_USD };
    const harvest = pick.lane === 'builder' && !m.stopped() ? { deps: await liveBuilderHarvest(), budget: harvestBudget, now: new Date() } : undefined;
    const rung = await lfdPhotoRung(pick, {
      readPage: read,
      findPhoto: (s, o) => np.findStoryPhoto(s, { create, jev, serper, fetchImage, readPage: np.readPageImages(read), usedReason: o.usedReason }, { extra: o.extra }),
      taken: exclude,
      ledger,
      // CI-32: a lead image is downloaded and hashed to check it against the ledger's pictures.
      usedPhotos: { http: fetch },
      ...(harvest ? { harvest } : {}),
      extra,
    });
    if (harvestBudget.usd > 0) m.spend(harvestBudget.usd);
    if (m.stopped()) m.halt();
    return { photo: rung.photo ?? null, trace: rung.trace, ...(rung.source ? { source: rung.source } : {}) };
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
