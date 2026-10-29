/**
 * Targeted Revisions for Last Few Days: a person's fix to ONE story of an `lfd.posts` post.
 * Only that story (`stories[i]`) and what is built from it change: its story slide (`render.slides[i+1]`),
 * its tile in the cover mosaic (the cover shows every non-meme story's photo), and the caption
 * (the template caption lists the headlines; every caption ends with the Sources / Photos credits).
 * New JPEGs go to NEW storage keys (`lfd/<slug>/slide-NN.rev<id>.jpg`); old ones are never
 * overwritten or removed and stay in `before.files` for undo.
 *
 * Order (nothing is written on any non-ok path): checks → the billable calls → render of the
 * touched slides (fit + render problems fail it) → the vision check (photo) → ONE guarded UPDATE of
 * `stories`, `render`, `caption` and `slide_objects` together. JPEGs uploaded before a vision
 * rejection or a lost guarded save stay in storage unreferenced, by design (the never-delete rule).
 *
 * Caption: a template caption is rebuilt whole. A model-written caption keeps its lines on a photo
 * or crop fix (only its credits tail is rebuilt), but a wording fix replaces it with the template
 * (composeCaption without lines, no model call), so the caption never states the old words. The old
 * caption is saved in `before.derived` and comes back on undo while the stories match it again.
 *
 *   layout   the photo's crop (photo.focus): render only, 0 model calls
 *   wording  the writer's limits and normalize() → Jev grounding over the whole slide; a miss gets ONE
 *            Sonnet rewrite (REWRITE_NOTE, as the run does) whose targeted field must pass again
 *   photo    the Stories finder (findPhotos) for that story, never a photo already in the post, in
 *            the 7-day used_photos set or in the last two posts → render → the Haiku vision check
 *
 * Parts: `{ kind: 'story', key: '<1-based story number>' }` (story n is slide n + 1) and the cover
 * `{ kind: 'story', key: 'cover' }`. The cover refuses every fix: its words are the fixed hook, its
 * mosaic is the stories' own photos (fixed per story), and a meme cover was placed by the meme stage,
 * which no revision helper can redo safely.
 */
import { randomUUID } from 'node:crypto';

import type { Pick as LfdPick, StoryCopy, StoryPhotoRequest } from '@/lib/lfd/types';
import type { SlideStory, SlideVerdict } from '@/lib/lfd/vision';
import type { SavedStory } from '@/lib/memes/lfd-sim/post';
import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Post as RenderPost, SlideCopy } from '@/lib/social/render/types';
import type { Query } from '@/lib/social/store/pg';
import type { Photo } from '@/lib/stories/render/types';

import type { ContentTypeDescription, FixKind, PartRef, PartState, PostSnapshot } from '../types';

import type { Metered } from './carousels';
import { liveLastFewDaysDeps } from './last-few-days-live';

export type { Metered };

/** The Last Few Days run's stages (lib/lfd/run.ts): pick → write → ground (fact check) → photo → meme arrange → render. */
export const LFD_STAGE_TAGS = ['pick', 'write', 'ground', 'photo', 'meme', 'render'] as const;

/**
 * A wording fix's worst case: one Sonnet rewrite after a grounding miss, priced at the pipeline's
 * per-call reserve for a Claude call (lib/social/pipeline/live-stages.ts CALL_RESERVE_USD, kept as a
 * literal so the registry does not import the live pipeline; a test pins it). The two Jev grounding
 * calls cost fractions of a cent (JEV_INPUT_USD_PER_MTOK) and are inside it.
 */
export const LFD_WORDING_ESTIMATE_USD = 0.2;

/**
 * One photo search for one story (Stories finder: Jev picks + Haiku photo vision) plus one Haiku
 * slide vision check. No constant exists for it (the run records only whole-run totals); Carousels
 * prices one slide's photo chain at $0.05. NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const LFD_PHOTO_SWAP_ESTIMATE_USD = 0.05;

/** Crop positions for a story photo (photo.focus as object-position fractions, lib/stories/render/types.ts). */
const CROPS = {
  top: { x: 0.5, y: 0 },
  center: { x: 0.5, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
} as const;
const WORDING_FIELDS = ['setup', 'headline', 'highlight', 'body'] as const;
type WordingField = (typeof WORDING_FIELDS)[number];
const COPY_FIELDS = ['setup', 'headline', 'highlight', 'names', 'body'] as const;

/** A story as lfd.posts saves it (run.ts insertPost): the copy, the photo and the writer's photo request. */
export type LfdStory = SavedStory & { photoAsk?: StoryPhotoRequest; photoTrace?: string[] };
export type RenderedSlide = { slide: number; file: string; fitProblems: string[]; renderProblems: string[]; png: Buffer | null };

export type LastFewDaysDeps = {
  /**
   * Draw the whole post (so slides keep their place) and store ONLY the listed slides' JPEGs, each
   * under its key. Returns, per listed slide, its stored path, its text-fit and other render problems
   * (broken image, font, bounds) and its PNG for the vision check. No model call, no cost.
   */
  renderSlides: (input: { slug: string; post: RenderPost; slides: Array<{ slide: number; key: string }> }) => Promise<RenderedSlide[]>;
  /** The story's article text (the run's fullText rule), or null when it can't be read. Free. */
  sourceText: (story: { url: string; body: string }) => Promise<string | null>;
  /** The run's Jev grounding check (lib/lfd/ground.ts) on the story copy. Charges `meter` as it pays. */
  grounded: (copy: StoryCopy, source: string, meter: Metered) => Promise<boolean>;
  /** ONE Sonnet rewrite of the story (lib/lfd/write.ts writeStories with `note`), or null. Charges `meter`. */
  rewrite: (input: { pick: LfdPick; body: string; note: string }, meter: Metered) => Promise<StoryCopy | null>;
  /** The Stories finder for one story (lib/lfd/photos.ts findPhotos), never a URL in `exclude`. Charges `meter`. */
  findPhoto: (input: { pick: LfdPick; copy: StoryCopy; exclude: ReadonlySet<string> }, meter: Metered) => Promise<{ photo: Photo | null; trace: string[] }>;
  /** The run's Haiku vision check (lib/lfd/vision.ts checkSlide) on the rendered story slide. Charges `meter`. */
  vision: (png: Buffer, story: SlideStory, meter: Metered) => Promise<SlideVerdict>;
  unschedule: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  /** A short id for the revision's storage keys. Default: random. */
  newId?: () => string;
};

type PostRow = { id: string; slug: string; status: string; stories: LfdStory[]; render: RenderPost; caption: string; slide_objects: string[] | null };
/** The part's state, plus what was built from it (the caption and the cover tiles its cover file shows). */
type LfdState = PartState & { derived?: { caption: string; coverTiles: unknown; from?: unknown } };

const postIdOf = (refs: ActionTarget) => refs.lfdPostId ?? '';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const slideKey = (slug: string, slide: number, id: string) => `lfd/${slug}/slide-${String(slide).padStart(2, '0')}.rev${id}.jpg`;
const isMeme = (s: LfdStory, slide: SlideCopy | undefined) => s.photoSource === 'meme' || slide?.photoKind === 'meme';

/** Story number from the part: 1-based, or 'cover', or 0 when the part is not a story. */
function storyNo(part: PartRef): number | 'cover' {
  if (part.kind !== 'story') return 0;
  if (part.key === 'cover') return 'cover';
  return /^\d+$/.test(part.key) ? Number(part.key) : 0;
}

async function readPost(q: Query, postId: string): Promise<PostRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  const { rows } = await q(`SELECT id::text AS id, slug, status, stories, render, caption, slide_objects FROM lfd.posts WHERE id = $1::uuid`, [postId]);
  return (rows[0] as PostRow | undefined) ?? null;
}

/** Spine status: approved / scheduled from the item's approval and waiting slot (unscheduleItem's view). */
async function statusOf(q: Query, post: PostRow): Promise<PostSnapshot['status']> {
  if (post.status === 'rejected' || post.status === 'published' || post.status === 'preview') return post.status;
  const item = (await q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'last_few_days' AND native_ref = $1`, [post.id])).rows[0]?.id as string | undefined;
  if (!item) return 'review';
  const slot = await q(`SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`, [item]);
  if (slot.rows.length) return 'scheduled';
  const ok = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [item]);
  return ok.rows.length ? 'approved' : 'review';
}

const coverOf = (render: RenderPost) => (render.slides[0]?.layoutVariant === 'lfd_cover' ? render.slides[0] : undefined);

function stateOf(post: { stories: LfdStory[]; render: RenderPost; caption: string }, i: number, objects: string[]): LfdState {
  const s = post.stories[i]!;
  return {
    copy: { setup: s.setup, headline: s.headline, highlight: s.highlight, names: s.names, body: s.body },
    photo: { photo: s.photo, photoSource: s.photoSource ?? null, photoTrace: s.photoTrace ?? [] },
    layout: { focus: s.photo?.focus ?? null },
    files: [objects[i + 1], objects[0]].filter((f): f is string => typeof f === 'string'),
    derived: { caption: post.caption, coverTiles: coverOf(post.render)?.lfdCover?.photos ?? null, from: captionInputs(post.stories) },
  };
}

function setOrDelete(o: Record<string, unknown>, key: string, value: unknown): void {
  if (value === null || value === undefined) delete o[key];
  else o[key] = value;
}

/** The story words a caption can state (the template lists headlines; a model caption retells setups, headlines and bodies). */
const CAPTION_WORDS = ['setup', 'headline', 'body'] as const;
/** What a caption is built from: each story's words, outlet and photo credit. */
const captionInputs = (stories: LfdStory[]) => stories.map((s) => ({ setup: s.setup, headline: s.headline, body: s.body, outlet: s.outlet, credit: s.photo?.credit ?? null }));

/** The template caption (composeCaption without lines: no model call) for these stories. */
async function templateCaption(stories: LfdStory[]): Promise<string> {
  const [{ composeCaption }, { readyFromSaved }] = await Promise.all([import('@/lib/lfd/post'), import('@/lib/memes/lfd-sim/post')]);
  return composeCaption(stories.map(readyFromSaved), null).caption;
}

/**
 * The caption for `to`, from the caption built for `from`, by the pipeline's own functions:
 * - a template caption is rebuilt whole;
 * - a model caption whose stories' words changed becomes the template (its prose may state the old words);
 * - otherwise a model caption keeps its lines and only its credits (creditsFor, always last) are rebuilt.
 * `error`: the credits can't be rebuilt (the caption does not end with them) or the result is over
 * Instagram's limit; the caller changes nothing.
 */
async function recaption(caption: string, from: LfdStory[], to: LfdStory[]): Promise<{ caption: string } | { error: string }> {
  const [{ CAPTION_MAX_CHARS, composeCaption, creditsFor }, { readyFromSaved }] = await Promise.all([import('@/lib/lfd/post'), import('@/lib/memes/lfd-sim/post')]);
  const a = from.map(readyFromSaved);
  const b = to.map(readyFromSaved);
  if (caption === composeCaption(a, null).caption) return { caption: composeCaption(b, null).caption };
  if (from.some((s, i) => CAPTION_WORDS.some((k) => !same(s[k], to[i]?.[k])))) return { caption: composeCaption(b, null).caption };
  const oldCredits = creditsFor(a);
  const newCredits = creditsFor(b);
  if (oldCredits === newCredits) return { caption };
  let head: string;
  if (!oldCredits) head = caption;
  else if (caption.endsWith(`\n\n${oldCredits}`)) head = caption.slice(0, -(oldCredits.length + 2));
  else if (caption === oldCredits) head = '';
  else return { error: 'the caption does not end with its Sources and Photos credits, so the new photo\'s credit could not be added' };
  const next = [head, newCredits].filter(Boolean).join('\n\n');
  if (next.length > CAPTION_MAX_CHARS) return { error: `the caption with the new photo credit would be ${next.length} characters, over Instagram's ${CAPTION_MAX_CHARS}` };
  return { caption: next };
}

/**
 * Story i becomes `next`: its slide's words and photo are rebuilt by buildPost (the pipeline's own
 * slide), its cover tile follows its photo, and the caption is rebuilt from all stories as they are now.
 * Only what changed is touched, so a meme slide's image and other stories stay byte-identical.
 */
async function applyStory(post: PostRow, i: number, next: LfdStory): Promise<{ stories: LfdStory[]; render: RenderPost; caption: { caption: string } | { error: string }; coverChanged: boolean }> {
  const [{ buildPost }, { readyFromSaved }] = await Promise.all([import('@/lib/lfd/post'), import('@/lib/memes/lfd-sim/post')]);
  const cur = post.stories[i]!;
  const stories = clone(post.stories);
  stories[i] = next;
  const render = clone(post.render);
  const slide = render.slides[i + 1]! as unknown as Record<string, unknown>;
  const built = buildPost([readyFromSaved(next)], new Date(0)).slides[1]! as unknown as Record<string, unknown>;
  if (COPY_FIELDS.some((k) => !same(cur[k], next[k]))) {
    slide.lfdStory = built.lfdStory;
    slide.altText = built.altText;
  }
  let coverChanged = false;
  if (!same(cur.photo, next.photo)) {
    for (const k of ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus', 'photoAspect']) delete slide[k];
    for (const k of ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus']) setOrDelete(slide, k, built[k]);
    const tiles = coverOf(render)?.lfdCover?.photos;
    const at = tiles ? tiles.findIndex((t) => t.url === cur.photo?.src) : -1;
    if (tiles && at >= 0) {
      tiles[at] = { url: next.photo.src, kind: next.photo.kind, ...(next.photo.focus ? { focus: next.photo.focus } : {}) };
      coverChanged = true;
    }
  }
  const caption = await recaption(post.caption, post.stories, stories);
  if ('caption' in caption) render.caption = caption.caption;
  return { stories, render, caption, coverChanged };
}

/** The meter as a billable dep sees it: once it has thrown, `stopped()` is true and every spend re-throws. */
function metered(meter: { spend(usd: number): void }): Metered & { check(): void } {
  let stop: unknown = null;
  const halt = (): never => {
    throw stop;
  };
  return {
    spend(usd) {
      if (stop) halt();
      try {
        meter.spend(usd);
      } catch (e) {
        stop = e;
        throw e;
      }
    },
    stopped: () => stop !== null,
    halt,
    check: () => {
      if (stop) halt();
    },
  };
}

export function createLastFewDaysDescription(deps: LastFewDaysDeps): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));

  /** One write of everything the fix changed, only if the post is still as read and still in review. */
  async function save(q: Query, post: PostRow, next: { stories: LfdStory[]; render: RenderPost; caption: string; objects: string[] }): Promise<boolean> {
    const { rows } = await q(
      `UPDATE lfd.posts SET stories = $2::jsonb, render = $3::jsonb, caption = $4, slide_objects = $5::jsonb
        WHERE id = $1::uuid AND status IN ('preview', 'review') AND stories = $6::jsonb AND render = $7::jsonb
          AND caption = $8 AND slide_objects IS NOT DISTINCT FROM $9::jsonb
        RETURNING id`,
      [
        post.id,
        JSON.stringify(next.stories),
        JSON.stringify(next.render),
        next.caption,
        JSON.stringify(next.objects),
        JSON.stringify(post.stories),
        JSON.stringify(post.render),
        post.caption,
        post.slide_objects === null ? null : JSON.stringify(post.slide_objects),
      ],
    );
    return rows.length === 1;
  }

  const objectsMatch = (p: PostRow) => Array.isArray(p.slide_objects) && p.slide_objects.length === p.render.slides.length;
  /** Story i is slide i + 2 (1-based) and must be the story slide it was saved as. */
  const lined = (p: PostRow, i: number) => {
    const sl = p.render.slides[i + 1];
    return sl?.layoutVariant === 'lfd_story' && sl.lfdStory?.headline === p.stories[i]?.headline;
  };

  /** The words a fix wants, checked like the writer's output (write.ts LIMITS, normalize, MAX_SETUPS). */
  async function newWords(post: PostRow, i: number, field: WordingField, raw: string): Promise<{ copy: StoryCopy } | { refuse: ReturnType<typeof blocked> | ReturnType<typeof failed> }> {
    const { LIMITS, MAX_SETUPS, normalize } = await import('@/lib/lfd/write');
    const s = post.stories[i]!;
    const n = i + 1;
    let value = raw.trim();
    if (field === 'setup' && !value.endsWith(':')) value = `${value.replace(/[.\s]+$/, '')}:`;
    const base: StoryCopy = { key: s.key, setup: s.setup, headline: s.headline, highlight: s.highlight, names: s.names, body: s.body, photo: s.photoAsk ?? { kind: '', query: '', subjects: [], alts: [] } };
    // normalize() drops a highlight no longer in the headline and strips the dash and final period, as the run does.
    const copy = normalize([{ ...base, [field]: value }], [s.key])[0]!;
    const got = copy[field];
    if (field === 'highlight' && got !== value) return { refuse: failed(`"${value}" is not words from story ${n}'s headline, so it can't be highlighted; nothing was changed.`) };
    if (same(got, base[field])) return { refuse: failed(`Story ${n}'s ${field} already says that, so nothing was changed.`) };
    const max = field === 'highlight' ? Infinity : LIMITS[field];
    if (got.length > max) return { refuse: blocked(`That ${field} is ${got.length} characters; a story takes at most ${max}, so it was not changed. Try a shorter one.`) };
    if (field === 'setup' && !s.setup.trim()) {
      const setups = post.stories.filter((x, j) => j !== i && x.setup?.trim()).length;
      if (setups >= MAX_SETUPS) return { refuse: blocked(`This post already has ${MAX_SETUPS} stories with a setup line (the most a post takes), so story ${n} was not given one.`) };
    }
    return { copy };
  }

  return {
    vertical: 'last_few_days',
    label: 'last few days',
    stageTags: LFD_STAGE_TAGS,
    fixKinds: ['photo', 'wording', 'layout'],
    argsGuide: {
      wording:
        'args.field is one of setup (the small line above the headline, ending in a colon), headline, highlight (words of the headline shown in color) or body (the sentence under the headline), and args.value is the exact new text for that field.',
      layout: 'args.crop is where the story\'s photo is cropped to: one of top, center, bottom, left or right.',
      photo: 'No args are needed; args.hint is an optional short description of the photo wanted (for example "a GPU factory").',
    },

    async load(q, refs) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return null;
      const cover = coverOf(post.render);
      const parts: Array<PostSnapshot['parts'][number]> = [
        {
          ref: { kind: 'story', key: 'cover' },
          text: `Cover: the fixed "Do you realize what just happened in AI" hook, over ${cover?.lfdCover?.meme ? 'a meme' : 'a mosaic of the story photos'}.`,
          layout: cover?.lfdCover?.meme ? 'meme cover' : 'photo mosaic',
        },
      ];
      post.stories.forEach((s, i) => {
        const slide = post.render.slides[i + 1];
        const meme = isMeme(s, slide);
        parts.push({
          ref: { kind: 'story', key: String(i + 1) },
          text: `Story ${i + 1}: ${[s.setup, `– ${s.headline}.`, s.body].filter(Boolean).join(' ')}${s.highlight ? ` (highlighted: "${s.highlight}")` : ''}`,
          ...(s.photo?.src && !meme ? { photoUrl: s.photo.src } : {}),
          ...(s.photo?.credit && !meme ? { photoCredit: s.photo.credit } : {}),
          layout: meme ? 'meme picture' : s.photo?.kind === 'logo' ? 'logo shown whole' : s.photo?.focus ? `photo cropped at ${Math.round(s.photo.focus.x * 100)}% ${Math.round(s.photo.focus.y * 100)}%` : 'photo cropped at center',
        });
      });
      return { vertical: 'last_few_days', refs, status: await statusOf(q, post), parts };
    },

    /** Layout is a render only; wording is a grounding check plus at most one rewrite; a photo is one search plus one vision check. */
    estimate(fix: FixKind) {
      if (fix === 'wording') return LFD_WORDING_ESTIMATE_USD;
      if (fix === 'photo') return LFD_PHOTO_SWAP_ESTIMATE_USD;
      return 0;
    },

    async revise({ q, refs, interpretation: it, meter }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return failed('This Last Few Days post could not be found, so nothing was changed.');
      if (post.status === 'rejected') return blocked('This Last Few Days post was rejected, so it was not changed.');
      if (post.status === 'published') return blocked('This Last Few Days post is already published, so it was not changed.');
      const no = storyNo(it.part);
      if (no === 'cover') {
        if (it.fixKind === 'wording') return blocked('The cover\'s words are the fixed Last Few Days hook, so they were not changed.');
        if (it.fixKind === 'photo') return blocked('The cover is made from the stories\' own photos (or a meme the meme stage placed), so it was not changed. Ask for a new photo on a story instead.');
        return blocked('The cover\'s layout is fixed (a mosaic of the story photos, or a meme), so it was not changed.');
      }
      if (!no || !post.stories[no - 1]) return failed(`There is no story ${it.part.key} on this post (it has ${post.stories.length}), so nothing was changed.`);
      if (!objectsMatch(post)) return failed('This post\'s stored slide images do not match its slides, so nothing was changed.');
      const i = no - 1;
      if (!lined(post, i)) return failed(`Story ${no}'s slide does not match the saved story, so nothing was changed.`);
      const cur = post.stories[i]!;
      const slide = post.render.slides[i + 1];
      const next: LfdStory = clone(cur);
      const args = it.args ?? {};
      const m = metered(meter);

      if (it.fixKind === 'layout') {
        const crop = args.crop?.trim().toLowerCase();
        if (!crop) return failed(`I could not tell where story ${no}'s photo should be cropped (top, center, bottom, left or right), so nothing was changed.`);
        if (!(crop in CROPS)) return failed(`"${crop}" is not a crop I know. Choose top, center, bottom, left or right; nothing was changed.`);
        if (isMeme(cur, slide)) return blocked(`Story ${no}'s picture is a meme, which is always shown whole, so its layout was not changed.`);
        if (cur.photo?.kind === 'logo') return blocked(`Story ${no}'s picture is a logo, which is always shown whole on a plate, so it can't be cropped.`);
        if (!cur.photo?.src) return blocked(`Story ${no} has no photo, so there is nothing to crop.`);
        const focus = CROPS[crop as keyof typeof CROPS];
        if (same(cur.photo.focus ?? CROPS.center, focus)) return failed(`Story ${no}'s photo is already cropped at the ${crop}, so nothing was changed.`);
        next.photo = { ...cur.photo, focus: { ...focus } };
      } else if (it.fixKind === 'wording') {
        const field = args.field?.trim().toLowerCase() as WordingField | undefined;
        if (!field || !(WORDING_FIELDS as readonly string[]).includes(field)) return failed(`I could not tell which words of story ${no} to change (setup, headline, highlight or body), so nothing was changed.`);
        if (!args.value?.trim()) return failed(`I could not tell what story ${no}'s ${field} should say, so nothing was changed.`);
        const want = await newWords(post, i, field, args.value);
        if ('refuse' in want) return want.refuse;
        let copy = want.copy;
        // A highlight only colors words already in the headline: nothing new to fact-check.
        if (field !== 'highlight') {
          const source = await deps.sourceText({ url: cur.url, body: cur.body });
          if (!source) return failed(`I could not re-read story ${no}'s article to fact-check the new words, so nothing was changed.`);
          const ok = await deps.grounded(copy, source, m);
          m.check();
          if (!ok) {
            // The run's rule: a grounding miss gets ONE rewrite, which must pass again.
            const [{ REWRITE_NOTE }, { readyFromSaved }] = await Promise.all([import('@/lib/lfd/ground'), import('@/lib/memes/lfd-sim/post')]);
            const pick = { ...readyFromSaved(cur).pick, body: source };
            const note = `${REWRITE_NOTE}\n\nA person asked for this change to the story's ${field}: "${args.value.trim()}". Keep that change as far as the source supports it.`;
            const retry = await deps.rewrite({ pick, body: source, note }, m);
            m.check();
            const again = retry && typeof retry[field] === 'string' && retry[field].trim() ? await newWords(post, i, field, retry[field]) : null;
            const passed = again && 'copy' in again ? await deps.grounded(again.copy, source, m) : false;
            m.check();
            if (!again || !('copy' in again) || !passed) {
              return blocked(`The fact check could not match the new ${field} of story ${no} to its article, even after one rewrite, so it was not changed. Try words the article states.`);
            }
            copy = again.copy;
          }
        }
        for (const k of COPY_FIELDS) (next as Record<string, unknown>)[k] = copy[k];
      } else if (it.fixKind === 'photo') {
        if (isMeme(cur, slide)) return blocked(`Story ${no}'s picture is a meme the meme stage placed, so its photo was not changed.`);
        const exclude = new Set<string>();
        for (const s of post.stories) if (s.photo?.src) exclude.add(s.photo.src);
        for (const sl of post.render.slides) {
          if (sl.photoUrl) exclude.add(sl.photoUrl);
          for (const t of sl.lfdCover?.photos ?? []) exclude.add(t.url);
          if (sl.lfdCover?.meme?.url) exclude.add(sl.lfdCover.meme.url);
        }
        // The shared 7-day rule (store.ts recentPhotoUrls) and the repeat check's last two posts.
        const recent = await q(`SELECT DISTINCT url FROM social.used_photos WHERE used_at > now() - make_interval(days => 7)`);
        for (const r of recent.rows) exclude.add(r.url as string);
        const prev = await q(
          `SELECT p.stories FROM lfd.posts p WHERE p.status <> 'rejected' AND p.id <> $1::uuid ORDER BY p.ny_date DESC, p.created_at DESC LIMIT 2`,
          [post.id],
        );
        for (const r of prev.rows) for (const s of (r.stories as Array<{ photo?: { src?: string } }>) ?? []) if (s?.photo?.src) exclude.add(s.photo.src);
        const { readyFromSaved } = await import('@/lib/memes/lfd-sim/post');
        const ready = readyFromSaved(cur);
        const ask: StoryPhotoRequest = cur.photoAsk ?? { kind: 'thematic', query: cur.headline, subjects: [], alts: [] };
        const hint = args.hint?.trim();
        const photoReq: StoryPhotoRequest = hint ? { ...ask, kind: 'thematic', query: hint, alts: [{ kind: ask.kind, query: ask.query }, ...ask.alts] } : ask;
        const found = await deps.findPhoto({ pick: ready.pick, copy: { ...ready.copy, photo: photoReq }, exclude }, m);
        m.check();
        const photo = found.photo;
        if (!photo || !photo.src || exclude.has(photo.src) || !photo.credit?.trim()) {
          return failed(`I searched for another photo for story ${no} and couldn't find a different usable one (not already in this post, the last two posts, or used in the last 7 days), so the original was kept.`);
        }
        next.photo = photo;
        next.photoSource = 'finder';
        next.photoTrace = [...found.trace, 'revision: a person asked for a different photo'];
      } else {
        return blocked(`${it.fixKind} fixes are not available for Last Few Days.`);
      }

      const built = await applyStory(post, i, next);
      if ('error' in built.caption) return failed(`Story ${no} was not changed: ${built.caption.error}. Nothing was written.`);
      const caption = built.caption.caption;
      const id = newId();
      const want = [{ slide: i + 2, key: slideKey(post.slug, i + 2, id) }];
      if (built.coverChanged && !coverOf(built.render)?.lfdCover?.meme) want.unshift({ slide: 1, key: slideKey(post.slug, 1, id) });
      let out: RenderedSlide[];
      try {
        out = await deps.renderSlides({ slug: post.slug, post: built.render, slides: want });
      } catch (e) {
        return failed(`Story ${no}'s slide could not be drawn with that change (${errText(e)}), so the original was kept.`);
      }
      const fit = out.flatMap((r) => r.fitProblems);
      if (fit.length) return failed(`The words did not fit story ${no}'s slide when it was drawn (${fit[0]}), so the original was kept. Try shorter words.`);
      const broken = out.flatMap((r) => r.renderProblems);
      if (broken.length) return failed(`Story ${no}'s slide did not draw cleanly (${broken[0]}), so the original was kept.`);
      if (want.some((w) => !out.find((r) => r.slide === w.slide && r.file))) return failed(`Story ${no}'s slide was not stored, so the original was kept.`);
      if (it.fixKind === 'photo') {
        const png = out.find((r) => r.slide === i + 2)?.png ?? null;
        const { VISION_UNAVAILABLE } = await import('@/lib/lfd/vision');
        // Fails open like the run: no image or no verdict passes as "vision unavailable".
        const v = png ? await deps.vision(png, { headline: next.headline, body: next.body, names: next.names, outlet: next.outlet }, m) : { ok: true, reason: VISION_UNAVAILABLE, costUsd: 0 };
        m.check();
        if (!v.ok) return failed(`I found a new photo for story ${no}, but the photo check turned it down (${v.reason}), so the original was kept.`);
      }
      const objects = [...(post.slide_objects ?? [])];
      for (const r of out) objects[r.slide - 1] = r.file;
      const after = { stories: built.stories, render: built.render, caption, objects };
      if (!(await save(q, post, after))) return failed('The post changed or left review while the fix ran, so it was not changed.');
      return { ok: true, before: stateOf(post, i, post.slide_objects ?? []), after: stateOf(after, i, objects) };
    },

    async restore({ q, refs, part, state }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) throw new Error('The Last Few Days post is gone.');
      if (!objectsMatch(post)) throw new Error('The post\'s stored slide images do not match its slides, so nothing was restored.');
      const no = storyNo(part);
      if (!no || no === 'cover' || !post.stories[no - 1]) throw new Error(`There is no story ${part.key} to restore.`);
      const i = no - 1;
      const s = state as LfdState;
      const next: LfdStory = clone(post.stories[i]!);
      const copy = s.copy as Partial<Record<(typeof COPY_FIELDS)[number], unknown>> | undefined;
      if (copy) for (const k of COPY_FIELDS) if (copy[k] !== undefined) (next as Record<string, unknown>)[k] = copy[k];
      const photo = s.photo as { photo?: Photo; photoSource?: LfdStory['photoSource'] | null; photoTrace?: string[] } | undefined;
      if (photo?.photo) next.photo = clone(photo.photo);
      if (photo && 'photoSource' in photo) setOrDelete(next as Record<string, unknown>, 'photoSource', photo.photoSource);
      if (photo?.photoTrace) next.photoTrace = photo.photoTrace;
      const layout = s.layout as { focus?: { x: number; y: number } | null } | undefined;
      if (layout && 'focus' in layout && next.photo) setOrDelete(next.photo as unknown as Record<string, unknown>, 'focus', layout.focus);

      // Undo is per story, so another story may have changed since: the caption and the cover are rebuilt from now.
      const built = await applyStory(post, i, next);
      // The saved caption comes back while the stories are again the ones it was built from (a model caption a
      // wording fix replaced); otherwise it is rebuilt from now, and the template stands in if that can't apply.
      const caption = s.derived?.from !== undefined && same(captionInputs(built.stories), s.derived.from)
        ? s.derived.caption
        : 'caption' in built.caption ? built.caption.caption : await templateCaption(built.stories);
      built.render.caption = caption;
      const objects = [...(post.slide_objects ?? [])];
      if (s.files[0]) objects[i + 1] = s.files[0];
      const tiles = coverOf(built.render)?.lfdCover?.photos ?? null;
      if (built.coverChanged && !coverOf(built.render)?.lfdCover?.meme) {
        if (s.files[1] && same(tiles, s.derived?.coverTiles)) objects[0] = s.files[1];
        else {
          // No saved cover image shows this mix of photos: draw the cover alone (a render, no model call, no cost).
          const [r] = await deps.renderSlides({ slug: post.slug, post: built.render, slides: [{ slide: 1, key: slideKey(post.slug, 1, newId()) }] });
          if (!r?.file || r.fitProblems.length || r.renderProblems.length) throw new Error(`The cover could not be drawn again (${[...(r?.fitProblems ?? []), ...(r?.renderProblems ?? [])][0] ?? 'nothing stored'}), so nothing was restored.`);
          objects[0] = r.file;
        }
      }
      // Already in that state: nothing to write (idempotent).
      if (same(built.stories, post.stories) && same(built.render, post.render) && caption === post.caption && same(objects, post.slide_objects)) return;
      if (!(await save(q, post, { stories: built.stories, render: built.render, caption, objects }))) throw new Error('The post changed or left review, so the story could not be restored.');
    },

    unschedule: (q, refs) => deps.unschedule(q, postIdOf(refs)),
  };
}

export const lastFewDaysDescription: ContentTypeDescription = createLastFewDaysDescription(liveLastFewDaysDeps);
