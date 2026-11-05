/**
 * Live deps for the Carousels revision description (carousels.ts). Every service import is lazy,
 * so importing the registry loads no renderer, storage, model or Jev client.
 *
 * Ceilings: vision.ts and find.ts catch errors from the calls they make, so a CeilingReached thrown
 * inside a paid call would be swallowed and the search would keep paying. Every paid call therefore
 * goes through a metered wrapper that refuses BEFORE paying once the meter has stopped, and the
 * request loop breaks out as soon as it has (the description then re-throws the stored error).
 */
import type { CarouselsDeps, Metered } from './carousels';

type AnyCreate = (params: never) => Promise<unknown>;

/** A Claude `create` that refuses before paying once the meter stopped, and charges each response's price. */
export function meteredCreate<C extends AnyCreate>(create: C, m: Metered, price: (res: Awaited<ReturnType<C>>, params: Parameters<C>[0]) => number): C {
  return (async (params: Parameters<C>[0]) => {
    if (m.stopped()) m.halt();
    const res = (await create(params)) as Awaited<ReturnType<C>>;
    m.spend(price(res, params));
    return res;
  }) as C;
}

/** A Jev ask that refuses before paying once the meter stopped, and charges each answer's cost. */
export function meteredJev<A extends (...args: never[]) => Promise<{ usage: { input_tokens: number; output_tokens: number } }>>(ask: A, m: Metered, cost: (usage: { input_tokens: number; output_tokens: number }) => number): A {
  return (async (...args: Parameters<A>) => {
    if (m.stopped()) m.halt();
    const res = await ask(...args);
    m.spend(cost(res.usage));
    return res;
  }) as A;
}

/** Try each request in order; stop at the first usable result, or as soon as the meter has stopped. */
export async function firstUsable<R, P>(requests: readonly R[], searchOne: (r: R) => Promise<P | null>, m: Metered): Promise<P | null> {
  for (const r of requests) {
    if (m.stopped()) return null;
    const found = await searchOne(r);
    if (m.stopped()) return null;
    if (found) return found;
  }
  return null;
}

export const liveCarouselsDeps: CarouselsDeps = {
  async renderSlide({ slug, post, slide, key }) {
    const [{ checkRenderFit }, { storeSlideJpegs }, { mediaBucket }, { SLIDE_BUCKET }] = await Promise.all([
      import('@/lib/social/render/fit-check'),
      import('@/lib/social/overnight/slides'),
      import('@/lib/media-bucket'),
      import('@/lib/social/overnight/config'),
    ]);
    const bucket = mediaBucket(SLIDE_BUCKET);
    const own = `/slide-${String(slide).padStart(2, '0')}.jpg`;
    let text = '';
    let stored = false;
    // The whole post is drawn (local Chromium, no AI) so the slide keeps its place and numbering;
    // only this slide's problems fail it, and only its JPEG is uploaded, to the revision's own key.
    await storeSlideJpegs(slug, post, {
      fitCheck: async (p, opts) => {
        const r = await checkRenderFit(p, opts);
        const mine = (x: string) => x.startsWith(`slide ${slide} `) || !/^slide \d+ /.test(x);
        const problems = [...r.problems.filter(mine), ...r.violations.filter((v) => v.slide === slide).map((v) => `bounds: ${v.element} "${v.text}"`)];
        if (problems.length) throw new Error(`${problems.length} render problem(s): ${problems.slice(0, 3).join('; ')}`);
        text = r.slideText[slide - 1] ?? '';
        return r;
      },
      upload: async (p, b) => {
        if (!p.endsWith(own)) return;
        await bucket.upload(key, b, 'image/jpeg');
        stored = true;
      },
    });
    if (!stored) throw new Error(`slide ${slide} was not rendered`);
    return { file: key, text };
  },

  async factCheck({ brief, draft, slide }, m) {
    const [{ runFactCheck }, { fillDraft }, { newAnthropic }, { liveMessagesCreate }, { priceAnthropicMessages }] = await Promise.all([
      import('@/lib/social/factcheck/factcheck'),
      import('@/lib/social/writer/draft'),
      import('@/lib/anthropic-client'),
      import('@/lib/social/reporter/reporter'),
      import('@/lib/anthropic-pricing'),
    ]);
    type B = Parameters<typeof runFactCheck>[0];
    type D = Parameters<typeof fillDraft>[0];
    const b = brief as B;
    const submission = draft as D;
    // Each attempt (the structured call may retry) is charged as it is paid for, and refused once the meter stopped.
    const create = meteredCreate(liveMessagesCreate(newAnthropic()), m, (res, params) =>
      Number(priceAnthropicMessages([res as never], { modelId: String((params as { model?: string }).model ?? '') }).costUsd));
    const r = await runFactCheck(b, { submission, filled: fillDraft(submission, b) }, { create });
    if (m.stopped()) m.halt();
    if (!r.ok) return { ok: false, flagged: false, reason: r.detail || r.reason };
    if (r.flags.main_claim_false) return { ok: false, flagged: true, reason: 'it says the story\'s main claim is false' };
    const chosen = submission.chosen_cover;
    const here = r.flags.flags.filter((f) => (slide === 1 ? f.where.part === 'cover' && f.where.number === chosen : f.where.part === 'slide' && f.where.number === slide));
    if (!here.length) return { ok: true };
    const why = here.map((f) => `"${f.quoted_text}" is not what the brief says${f.fix.kind === 'swap' && f.fix.replacement ? ` (the brief has "${f.fix.replacement}")` : ''}`);
    return { ok: false, flagged: true, reason: why.join('; ') };
  },

  async findPhoto({ brief, draft, slide, exclude, hint }, m) {
    const [find, { fillDraft }, { coverRequest }, { createVisionCheck }, { createJevAsk, jevCostUsd }, { createSizeProbe }, { checkPhotoCredit }, { newAnthropic }, { priceAnthropicMessages }] = await Promise.all([
      import('@/lib/social/photos/find'),
      import('@/lib/social/writer/draft'),
      import('@/lib/social/photos/design'),
      import('@/lib/social/photos/vision'),
      import('@/lib/social/jev/client'),
      import('@/lib/social/photos/size'),
      import('@/lib/social/mechanical/checks'),
      import('@/lib/anthropic-client'),
      import('@/lib/anthropic-pricing'),
    ]);
    type B = Parameters<typeof find.newSearchContext>[0];
    type D = Parameters<typeof fillDraft>[0];
    type Req = Parameters<typeof find.searchVisual>[0];
    type VisionCreate = Parameters<typeof createVisionCheck>[0]['create'];
    const b = brief as B;
    const filled = fillDraft(draft as D, b);
    const client = newAnthropic();
    // Every Haiku vision call and every Jev call is charged as it is made, and refused once the meter stopped.
    const create = meteredCreate(((params) => client.messages.create(params as never)) as VisionCreate, m, (res, params) =>
      Number(priceAnthropicMessages([res as never], { modelId: String((params as { model?: string }).model ?? '') }).costUsd));
    const jev = meteredJev(createJevAsk(), m, jevCostUsd);
    const deps = { jev, http: fetch, vision: createVisionCheck({ create, http: fetch }), size: createSizeProbe(fetch) };
    const requests: Req[] = [];
    if (hint) requests.push({ kind: 'thematic', query: hint } as Req);
    if (slide === 1) {
      const c = filled.cover_options[filled.chosen_cover - 1]!;
      requests.push(coverRequest(c.visual), coverRequest(c.fallback_visual), ...(c.alt_visuals ?? []).map(coverRequest));
    } else {
      const s = filled.slides[slide - 2]!;
      requests.push(s.visual, s.fallback_visual, ...(s.alt_visuals ?? []));
    }
    const ctx = find.newSearchContext(b, [], { recent: new Set(exclude) });
    return firstUsable(requests, async (request) => {
      const r = await find.searchVisual(request, ctx, deps, { cover: slide === 1 });
      // Logo cards need the plate chosen from the logo's luminance; a swap only takes a logo that has one.
      const ok = r.candidates.find((c) => !exclude.has(c.url) && (c.source !== 'logo' || c.plate) && checkPhotoCredit(c, `slide ${slide}`, b).length === 0);
      // A stock photo is banked under the scene it was searched for (the daily runner's used_photos tag).
      return ok ? { ...ok, ...(ok.source === 'stock' ? { scene: request.query } : {}) } : null;
    }, m);
  },

  async unschedule(q, postId) {
    const { unschedulePost } = await import('@/lib/social/overnight/schedule');
    return unschedulePost(q, postId);
  },
};
