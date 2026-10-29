/**
 * Targeted Revisions for AI Events: a person's fix to ONE slide of a ranked city post. Only that
 * slide's copy / image / layout is patched in `ai_events.posts.render`, only that slide is rendered
 * again (to a new, versioned storage key; the old JPEG is never overwritten or removed), and
 * `updatePostRender` bumps render_version. The both-cities rebuild (lib/ai-events/run.ts) is never used.
 * No model is called anywhere in this type, so every fix costs 0.
 *
 * Part keys are 1-based slide numbers ("3" = the third slide, how people say it).
 * Colors are fixed by the post's look, so there is no color fix (the engine refuses it).
 */
import { aiEventsItemId } from '@/lib/ai-events/items';
import { COPY_MAX } from '@/lib/ai-events/post';
import { updatePostRender } from '@/lib/ai-events/store';
import type { HubQuery } from '@/lib/social-hub/db';
import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Post as RenderPost, SlideCopy } from '@/lib/social/render/types';
import type { Query } from '@/lib/social/store/pg';

import type { ContentTypeDescription, FixKind, PartRef, PartState, PostSnapshot } from '../types';

export const AI_EVENTS_STAGE_TAGS = ['pick', 'copy', 'layout', 'render'] as const;

const LAYOUTS = ['poster', 'ambient', 'type'] as const;
const TREATS = ['ghost', 'panorama'] as const;
const HOSTED_BY = 'Hosted by ';

export type AiEventsDeps = {
  /** Render and store ONE slide (a one-slide post) under `slug` (a new folder); returns its storage path(s). Throws on any fit problem. */
  renderSlide: (slug: string, post: RenderPost) => Promise<string[]>;
  /** Other image URLs for the event (its listings' posters), any order; may include the one already used. */
  imageCandidates: (q: Query, eventId: string) => Promise<string[]>;
  unschedule: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
};

type PickRow = { when: string; title: string; host?: string; place?: string; icon: string; image?: string };
type Ae = Record<string, unknown> & { role: string; look: string; pick?: PickRow; rank?: number; layout?: string; treat?: string[] };
type PostRow = {
  id: string;
  slug: string;
  status: string;
  run_id: string | null;
  event_ids: string[];
  cities: unknown;
  render: RenderPost;
  caption: string;
  render_version: number;
  slide_objects: string[] | null;
};

const postIdOf = (refs: ActionTarget) => refs.aiEventsPostId ?? '';
const slideNo = (part: PartRef) => (/^\d+$/.test(part.key) ? Number(part.key) : 0);
const ae = (s: SlideCopy) => s.aiEvents as unknown as Ae | undefined;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function readPost(q: Query, postId: string): Promise<PostRow | null> {
  const { rows } = await q(
    `SELECT id::text AS id, slug, status, run_id::text AS run_id, event_ids, cities, render, caption, render_version, slide_objects
       FROM ai_events.posts WHERE id::text = $1`,
    [postId],
  );
  return (rows[0] as PostRow | undefined) ?? null;
}

/** Spine status for the engine: approved / scheduled come from the item's approval and slot. */
async function statusOf(q: Query, post: PostRow): Promise<PostSnapshot['status']> {
  if (post.status === 'rejected' || post.status === 'published' || post.status === 'preview') return post.status;
  const item = (await q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'ai_events' AND native_ref = $1`, [post.id])).rows[0]?.id as string | undefined;
  if (!item) return 'review';
  const slot = await q(`SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`, [item]);
  if (slot.rows.length) return 'scheduled';
  const ok = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [item]);
  return ok.rows.length ? 'approved' : 'review';
}

function slideText(a: Ae): string {
  if (a.pick) {
    const p = a.pick;
    const mentions = Array.isArray(a.mentions) ? ` Also: ${(a.mentions as Array<{ day: string; title: string }>).map((m) => `${m.day} ${m.title}`).join('; ')}.` : '';
    return `${a.rank ? `#${a.rank}: ` : ''}${[p.when, p.title, p.host, p.place].filter(Boolean).join(' | ')}${mentions}`;
  }
  return [a.lead, a.lit, a.label, a.line].filter((x) => typeof x === 'string' && x).join(' ');
}

/** The slide's part state: everything a person can change on it, and its current JPEG. */
function stateOf(slide: SlideCopy, file: string | undefined): PartState {
  const a = ae(slide)!;
  return {
    copy: a.pick ? { title: a.pick.title, host: a.pick.host ?? null, place: a.pick.place ?? null, altText: slide.altText } : { altText: slide.altText },
    photo: { image: a.pick?.image ?? null },
    colors: { look: a.look },
    layout: { layout: a.layout ?? null, treat: a.treat ?? null },
    files: file ? [file] : [],
  };
}

const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });

export function createAiEventsDescription(deps: AiEventsDeps): ContentTypeDescription {
  async function save(q: Query, post: PostRow, render: RenderPost, objects: string[]): Promise<boolean> {
    return updatePostRender(q as unknown as HubQuery, post.id, Number(post.render_version) + 1, {
      runId: post.run_id,
      eventIds: post.event_ids,
      cities: post.cities as never,
      render,
      caption: post.caption,
      slideObjects: objects,
    });
  }

  return {
    vertical: 'ai_events',
    label: 'AI events',
    stageTags: AI_EVENTS_STAGE_TAGS,
    fixKinds: ['photo', 'wording', 'layout'],

    async load(q, refs) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return null;
      return {
        vertical: 'ai_events',
        refs,
        status: await statusOf(q, post),
        parts: post.render.slides.map((s, i) => {
          const a = ae(s)!;
          return {
            ref: { kind: 'slide', key: String(i + 1) },
            text: slideText(a),
            ...(a.pick?.image ? { photoUrl: a.pick.image } : {}),
            color: a.look,
            ...(a.layout ? { layout: a.layout } : {}),
          };
        }),
      };
    },

    /** No model anywhere in this type (render and image lookups are free). */
    estimate: (_fix: FixKind) => 0,

    async revise({ q, refs, interpretation: it }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return failed('This AI events post could not be found, so nothing was changed.');
      if (post.status === 'rejected') return blocked('This post was rejected, so it was not changed.');
      if (post.status === 'published') return blocked('This post is already published, so it was not changed.');
      const n = slideNo(it.part);
      const slide = post.render.slides[n - 1];
      const a = slide && ae(slide);
      if (!slide || !a) return failed(`There is no slide ${it.part.key} on this post, so nothing was changed.`);
      const objects = [...(post.slide_objects ?? [])];
      const render = clone(post.render);
      const next = render.slides[n - 1]!;
      const na = ae(next)!;
      const before = stateOf(slide, objects[n - 1]);
      const args = it.args ?? {};

      if (it.fixKind === 'wording') {
        if (!na.pick) return blocked(`Slide ${n} has fixed wording, so it was not changed. Only the event slides (title, host, place) can be reworded.`);
        const field = (args.field ?? 'title').toLowerCase();
        if (field !== 'title' && field !== 'host' && field !== 'place') return blocked(`Only the title, host or place of an event slide can be reworded (not "${field}").`);
        let value = (args.value ?? args.text ?? '').trim();
        if (field === 'host' && value.toLowerCase().startsWith(HOSTED_BY.toLowerCase())) value = value.slice(HOSTED_BY.length).trim();
        if (!value) return failed(`I could not tell what slide ${n}'s ${field} should say, so nothing was changed.`);
        const cap = COPY_MAX[field];
        if (value.length > cap) return blocked(`That ${field} is ${value.length} characters; a slide takes at most ${cap}, so it was not changed. Try a shorter one.`);
        const oldText = na.pick[field];
        const newText = field === 'host' ? `${HOSTED_BY}${value}` : value;
        na.pick[field] = newText;
        if (oldText) next.altText = next.altText.split(oldText).join(newText);
      } else if (it.fixKind === 'layout') {
        if (na.role !== 'rank') return blocked(`Slide ${n} has one fixed layout, so it was not changed. Only the ranked event slides have layouts (poster, ambient or type).`);
        const layout = args.layout?.toLowerCase();
        const treat = args.treat?.toLowerCase();
        if (!layout && !treat) return failed(`I could not tell which layout slide ${n} should use (poster, ambient or type), so nothing was changed.`);
        if (layout && !(LAYOUTS as readonly string[]).includes(layout)) return blocked(`"${layout}" is not a layout. Choose poster, ambient or type.`);
        if (treat && !(TREATS as readonly string[]).includes(treat)) return blocked(`"${treat}" is not a number style. Choose ghost or panorama.`);
        if (layout) na.layout = layout;
        if (treat) na.treat = [treat];
      } else if (it.fixKind === 'photo') {
        if (na.role !== 'rank' || !na.pick || typeof na.rank !== 'number') return failed(`Slide ${n} has no event photo to swap, so nothing was changed.`);
        const eventId = post.event_ids[na.rank - 1];
        if (!eventId) return failed(`I could not find which event slide ${n} shows, so its photo was not changed.`);
        const current = na.pick.image ?? null;
        const used = new Set(render.slides.map((s, i) => (i === n - 1 ? null : ae(s)?.pick?.image)).filter((u): u is string => !!u));
        const found = [...new Set(await deps.imageCandidates(q, eventId))].filter((u) => u && u !== current);
        if (!found.length) return failed(`I looked for another image for this event and found none, so slide ${n}'s photo was not changed.`);
        const fresh = found.filter((u) => !used.has(u));
        if (!fresh.length) return blocked(`Every other image I found for this event is already used on another slide, so slide ${n}'s photo was not changed.`);
        na.pick.image = fresh[0]!;
      } else {
        return blocked(`${it.fixKind} fixes are not available for AI events (colors come from the post's look).`);
      }

      // Render only this slide, to a new versioned key; the old JPEG is left in place.
      const version = Number(post.render_version) + 1;
      let file: string;
      try {
        const out = await deps.renderSlide(`${post.slug}/s${String(n).padStart(2, '0')}-v${version}`, { ...render, slides: [{ ...next, position: 0 }] });
        if (!out[0]) throw new Error('no image came back');
        file = out[0];
      } catch (e) {
        return failed(`Slide ${n} could not be drawn with that change, so the original was kept (${e instanceof Error ? e.message : String(e)}).`);
      }
      objects[n - 1] = file;
      if (!(await save(q, post, render, objects))) return failed('The post is no longer in review, so it was not changed.');
      return { ok: true, before, after: stateOf(next, file) };
    },

    async restore({ q, refs, part, state }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) throw new Error('The AI events post is gone.');
      const n = slideNo(part);
      const slide = post.render.slides[n - 1];
      if (!slide || !ae(slide)) throw new Error(`There is no slide ${part.key} to restore.`);
      const render = clone(post.render);
      const next = render.slides[n - 1]!;
      const na = ae(next)!;
      const copy = (state.copy ?? {}) as { title?: string; host?: string | null; place?: string | null; altText?: string };
      if (na.pick) {
        if (copy.title !== undefined) na.pick.title = copy.title;
        if (copy.host !== undefined) copy.host === null ? delete na.pick.host : (na.pick.host = copy.host);
        if (copy.place !== undefined) copy.place === null ? delete na.pick.place : (na.pick.place = copy.place);
        const image = (state.photo as { image?: string | null } | undefined)?.image;
        if (image !== undefined) image === null ? delete na.pick.image : (na.pick.image = image);
      }
      if (copy.altText !== undefined) next.altText = copy.altText;
      const lay = state.layout as { layout?: string | null; treat?: string[] | null } | undefined;
      if (lay && na.role === 'rank') {
        if (lay.layout) na.layout = lay.layout;
        if (lay.treat === null) delete na.treat;
        else if (lay.treat) na.treat = lay.treat;
      }
      const objects = [...(post.slide_objects ?? [])];
      if (state.files[0]) objects[n - 1] = state.files[0];
      // Already in that state: nothing to write (idempotent, no extra render_version).
      if (JSON.stringify(render) === JSON.stringify(post.render) && JSON.stringify(objects) === JSON.stringify(post.slide_objects ?? [])) return;
      if (!(await save(q, post, render, objects))) throw new Error('The post is no longer in review, so the slide could not be restored.');
    },

    unschedule: (q, refs) => deps.unschedule(q, postIdOf(refs)),
  };
}

/** Live deps: every import is lazy, so importing the registry loads no renderer, storage or HTTP client. */
const liveDeps: AiEventsDeps = {
  async renderSlide(slug, post) {
    const [{ checkRenderFit }, { storeSlideJpegs }, { mediaBucket }, { SLIDE_BUCKET }, { AI_EVENTS_SLIDE_PREFIX }] = await Promise.all([
      import('@/lib/social/render/fit-check'),
      import('@/lib/social/overnight/slides'),
      import('@/lib/media-bucket'),
      import('@/lib/social/overnight/config'),
      import('@/lib/ai-events/config'),
    ]);
    const bucket = mediaBucket(SLIDE_BUCKET);
    return storeSlideJpegs(slug, post, {
      prefix: AI_EVENTS_SLIDE_PREFIX,
      fitCheck: async (p, opts) => {
        const r = await checkRenderFit(p, opts);
        const problems = [...r.problems, ...r.violations.map((v) => `bounds: ${v.element} "${v.text}"`)];
        if (problems.length) throw new Error(`${problems.length} render problem(s): ${problems.slice(0, 3).join('; ')}`);
        return r;
      },
      upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
    });
  },
  async imageCandidates(q, eventId) {
    const { resolveListingCover } = await import('@/lib/networking/covers');
    const urls: string[] = [];
    const own = (await q(`SELECT signals->>'coverUrl' AS cover FROM networking.events WHERE id::text = $1`, [eventId])).rows[0]?.cover as string | undefined;
    if (own) urls.push(own);
    const listings = (await q(`SELECT source, source_event_id, url FROM networking.event_listings WHERE event_id::text = $1`, [eventId])).rows;
    for (const l of listings) {
      try {
        const u = await resolveListingCover({ source: l.source, sourceEventId: l.source_event_id, url: l.url });
        if (u) urls.push(u);
      } catch {
        /* a listing that will not answer just has no candidate */
      }
    }
    return urls;
  },
  async unschedule(q, postId) {
    const { unscheduleAiEventsPost } = await import('@/lib/ai-events/schedule');
    return unscheduleAiEventsPost(q, postId);
  },
};

export const aiEventsDescription: ContentTypeDescription = createAiEventsDescription(liveDeps);
