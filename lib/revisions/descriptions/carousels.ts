/**
 * Targeted Revisions for Carousels: a person's fix to ONE slide of a `social.posts` carousel.
 * Only that slide's copy / photo / canvas / layout is patched in `render.slides[n-1]` (and, for
 * wording, the matching line of the saved `draft`, so a later fact-check reads the same words).
 * Only that slide's JPEG is made again, to a NEW storage key (`posts/<slug>/slide-NN.rev<id>.jpg`);
 * the old JPEG is never overwritten or removed and stays in `before.files` for undo.
 *
 * Order (nothing is written on any non-ok path): checks → the one billable call (fact-check or
 * photo chain) → render + fit check of that slide → ONE guarded UPDATE of `render`, `draft` and
 * `slide_objects` together (the publisher reads both `slide_objects` and `render.caption`), which
 * also logs a new photo in `social.used_photos` (the 7-day rule) in the same statement.
 *
 *   color    canvas only: render + fit check, 0 model calls
 *   layout   layoutVariant (text|image) / photoPlacement / photoTreatment / photoBleed: render only, 0 calls
 *   wording  the silent fixes and copy limits (mechanical/checks.ts) → ONE fact-check call (Sonnet)
 *            → render, and the new words must show on the rendered slide (C7, dropped text)
 *   photo    ONE photo-chain call (Jev + Haiku vision) that never returns a photo already in the post,
 *            in the 7-day used_photos set, or the one being replaced → render (faces-under-text and
 *            the other fit rules are the render check's)
 *
 * Part keys are 1-based slide numbers ("2" = the second slide; the cover is 1), the numbering the
 * fact-checker uses too. Spread halves (one photo across two slides) refuse photo and layout fixes.
 */
import { randomUUID } from 'node:crypto';

import { NO_REPEAT_DAYS } from '@/lib/social/photos/used-photos';
import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Photo } from '@/lib/social/photos/find';
import type { Post as RenderPost, SlideCopy, SpanRun } from '@/lib/social/render/types';
import type { Query } from '@/lib/social/store/pg';

import type { ContentTypeDescription, FixKind, PartRef, PartState, PostSnapshot } from '../types';

/** The carousel pipeline's stages a fix can be put down to (lib/social/pipeline/orchestrator.ts, design-stage, render). */
export const CAROUSELS_STAGE_TAGS = ['writer', 'editor', 'fact-check', 'photo', 'layout', 'canvas', 'render'] as const;

/**
 * One photo-chain call for one slide (search + Jev fit + Haiku vision). No constant exists for it:
 * the stub design stage prices a whole post's photos at about $0.05 (pipeline/stubs.ts), and one
 * slide is a fraction of that. NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const CAROUSEL_PHOTO_SWAP_ESTIMATE_USD = 0.05;

/**
 * One Sonnet fact-check call's worst case: the pipeline's per-call reserve for a Claude call
 * (lib/social/pipeline/live-stages.ts CALL_RESERVE_USD, "≈ max_tokens of output plus a large cached
 * prompt"). Kept as a literal so the registry does not import the live pipeline; a test pins it.
 */
export const FACT_CHECK_CALL_ESTIMATE_USD = 0.2;

/** Mirrors SLIDE_CANVASES (render/types.ts). */
const CANVASES = ['black', 'green', 'orange', 'white'] as const;
/** Story slides switch between the split / photo-on-top text layout and the full photo (the render review's menu). */
const LAYOUTS = ['text', 'image'] as const;
const PLACEMENTS = ['below', 'top'] as const;
const TREATMENTS = ['card', 'bottom-fade'] as const;
const BLEEDS = ['true', 'false'] as const;

const PHOTO_FIELDS = ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus', 'photoSize', 'logoPlate', 'logoWide', 'photoIsSpeaker'] as const;
const LAYOUT_FIELDS = ['layoutVariant', 'photoPlacement', 'photoTreatment', 'photoBleed', 'textAnchor', 'fade', 'bleedText'] as const;

type Spend = (usd: number) => void;
export type FactCheckVerdict = { ok: true } | { ok: false; flagged: boolean; reason: string };

export type CarouselsDeps = {
  /**
   * Render the post (with the changed slide) and store ONLY slide `slide`'s JPEG under `key`.
   * Throws on any render-check problem on that slide (text fit, bounds, faces under text, photo
   * that will not load). Returns the stored path and the slide's rendered text.
   */
  renderSlide: (input: { slug: string; post: RenderPost; slide: number; key: string }) => Promise<{ file: string; text: string }>;
  /**
   * ONE fact-check call on the draft carrying the new words. `flagged`: the checker rejected
   * words on this slide (or the main claim); otherwise the check could not run. Calls `spend` as it pays.
   */
  factCheck: (input: { brief: unknown; draft: unknown; slide: number }, spend: Spend) => Promise<FactCheckVerdict>;
  /** ONE photo-chain call for the slide: a usable photo whose URL is not in `exclude`, or null. Calls `spend` as it pays. */
  findPhoto: (input: { brief: unknown; draft: unknown; slide: number; exclude: ReadonlySet<string>; hint?: string }, spend: Spend) => Promise<Photo | null>;
  unschedule: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  /** A short id for the revision's storage key. Default: random. */
  newId?: () => string;
};

type DraftLine = { text: string; facts: string[] };
type Draft = { cover_options: Array<{ text: string }>; chosen_cover: number; slides: Array<{ headline: DraftLine; body: DraftLine | null }> };
type PostRow = { id: string; slug: string; story_id: string | null; status: string; brief: unknown; draft: Draft | null; render: RenderPost; slide_objects: string[] | null };

const postIdOf = (refs: ActionTarget) => refs.postId ?? '';
const slideNo = (part: PartRef) => (part.kind === 'slide' && /^\d+$/.test(part.key) ? Number(part.key) : 0);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const runText = (r?: SpanRun) => (r ?? []).map((s) => s.text).join('');
const oneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T => v !== undefined && (list as readonly string[]).includes(v);
const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** C7's comparison (mechanical/checks.ts checkDroppedText): case, quote marks and spacing do not count. */
const flat = (s: string) => s.toLowerCase().replace(/[“”"‘’'…]/g, '').replace(/\s+/g, ' ').trim();

async function readPost(q: Query, postId: string): Promise<PostRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  const { rows } = await q(
    `SELECT id::text AS id, slug, story_id, status, brief, draft, render, slide_objects FROM social.posts WHERE id = $1::uuid`,
    [postId],
  );
  return (rows[0] as PostRow | undefined) ?? null;
}

/** Spine status for the engine: approved / scheduled come from the item's approval and waiting slot (unscheduleItem's view). */
async function statusOf(q: Query, post: PostRow): Promise<PostSnapshot['status']> {
  if (post.status === 'rejected' || post.status === 'published' || post.status === 'preview') return post.status;
  const item = (await q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'carousels' AND native_ref = $1`, [post.id])).rows[0]?.id as string | undefined;
  if (!item) return 'review';
  const slot = await q(`SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`, [item]);
  if (slot.rows.length) return 'scheduled';
  const ok = await q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [item]);
  return ok.rows.length ? 'approved' : 'review';
}

function slideText(s: SlideCopy): string {
  const parts = [
    runText(s.title),
    s.numberNote,
    s.secondNumber,
    s.secondNote,
    runText(s.headline),
    runText(s.body),
    runText(s.bodyBottom),
    s.quoteText ? `"${runText(s.quoteText)}"` : '',
    s.quoteBy ? `(${s.quoteBy})` : '',
    s.note,
  ];
  const t = parts.filter((x) => typeof x === 'string' && x.trim()).join(' ');
  return t || s.altText;
}

function layoutText(s: SlideCopy): string {
  const bits: string[] = [s.layoutVariant];
  if (s.photoPlacement) bits.push(`photo ${s.photoPlacement}`);
  if (s.photoTreatment) bits.push(`treatment ${s.photoTreatment}`);
  if (s.photoBleed) bits.push('full-bleed photo');
  if (s.panoramaSide) bits.push(`spread, ${s.panoramaSide} half`);
  return bits.join(', ');
}

const pick = (s: SlideCopy, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, (s as unknown as Record<string, unknown>)[k] ?? null]));

/** The slide's part state: its copy (and the draft's line), photo, canvas, layout, and current JPEG. */
function stateOf(post: { render: RenderPost; draft: Draft | null }, n: number, file: string | undefined): PartState {
  const s = post.render.slides[n - 1]!;
  return {
    copy: { headline: s.headline ?? null, body: s.body ?? null, altText: s.altText, draft: draftLine(post.draft, n) },
    photo: pick(s, PHOTO_FIELDS),
    colors: { canvas: s.canvas ?? null },
    layout: pick(s, LAYOUT_FIELDS),
    files: file ? [file] : [],
  };
}

/** The draft's words for slide n (cover = the chosen cover option), or null when the draft does not line up. */
function draftLine(draft: Draft | null, n: number): { headline: string; body: string | null } | null {
  if (!draft || !Array.isArray(draft.slides) || !Array.isArray(draft.cover_options)) return null;
  if (n === 1) {
    const c = draft.cover_options[(draft.chosen_cover ?? 1) - 1];
    return c ? { headline: c.text, body: null } : null;
  }
  const d = draft.slides[n - 2];
  return d ? { headline: d.headline.text, body: d.body?.text ?? null } : null;
}

function setDraftLine(draft: Draft, n: number, field: 'headline' | 'body', text: string): boolean {
  if (n === 1) {
    const c = draft.cover_options[(draft.chosen_cover ?? 1) - 1];
    if (!c || field !== 'headline') return false;
    c.text = text;
    return true;
  }
  const d = draft.slides[n - 2];
  if (!d) return false;
  if (field === 'headline') d.headline.text = text;
  else if (d.body) d.body.text = text;
  else return false;
  return true;
}

/** New words as a span run, keeping each old hook / pivot phrase's colour where the new words still carry it. */
function respan(old: SpanRun | undefined, value: string): SpanRun {
  let out: SpanRun = [{ text: value, role: 'narrative' }];
  for (const m of (old ?? []).filter((s) => s.role !== 'narrative' && s.text.trim())) {
    const mark = m.text.trim();
    let done = false;
    out = out.flatMap((sp) => {
      if (done || sp.role !== 'narrative') return [sp];
      const i = sp.text.indexOf(mark);
      if (i < 0) return [sp];
      done = true;
      return [
        { text: sp.text.slice(0, i), role: 'narrative' as const },
        { text: mark, role: m.role },
        { text: sp.text.slice(i + mark.length), role: 'narrative' as const },
      ].filter((x) => x.text);
    });
  }
  return out;
}

function setOrDelete(s: SlideCopy, key: string, value: unknown): void {
  const o = s as unknown as Record<string, unknown>;
  if (value === null || value === undefined) delete o[key];
  else o[key] = value;
}

const bleedable = (s: SlideCopy) => Boolean(s.photoUrl) && ((s.photoKind ?? 'scene') === 'scene' || s.photoBleed === true);

export function createCarouselsDescription(deps: CarouselsDeps): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));

  /** Write render + draft + slide_objects in one statement, only if the post is still as read (and revisable). */
  async function save(q: Query, post: PostRow, render: RenderPost, draft: Draft | null, objects: string[], used?: { photo: Photo; slide: number }): Promise<boolean> {
    const { rows } = await q(
      `WITH up AS (
         UPDATE social.posts SET render = $2::jsonb, draft = $3::jsonb, slide_objects = $4::jsonb
          WHERE id = $1::uuid AND status IN ('preview', 'review') AND render = $5::jsonb AND slide_objects IS NOT DISTINCT FROM $6::jsonb
          RETURNING id, story_id),
       logged AS (
         INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, post_id)
         SELECT $7::text, now(), coalesce(up.story_id, up.id::text), $8::int, $9::text, $10::text, $11::text, $12::text, up.id FROM up WHERE $7::text IS NOT NULL
         ON CONFLICT (url, used_at, story_id, slide) DO NOTHING
         RETURNING 1)
       SELECT count(*)::int AS n FROM up`,
      [
        post.id,
        JSON.stringify(render),
        draft === null ? null : JSON.stringify(draft),
        JSON.stringify(objects),
        JSON.stringify(post.render),
        post.slide_objects === null ? null : JSON.stringify(post.slide_objects),
        used?.photo.url ?? null,
        used?.slide ?? null,
        used?.photo.source ?? null,
        used?.photo.qid ?? null,
        used?.photo.subject ?? null,
        used?.photo.credit ?? null,
      ],
    );
    return Number(rows[0]?.n ?? 0) === 1;
  }

  /** Charges the meter; a CeilingReached thrown inside a dep is remembered so a dep that swallows it cannot hide it. */
  function spender(meter: { spend(usd: number): void }) {
    let stop: unknown = null;
    const spend: Spend = (usd) => {
      try {
        meter.spend(usd);
      } catch (e) {
        stop ??= e;
        throw e;
      }
    };
    return { spend, check: () => { if (stop) throw stop; } };
  }

  const objectsMatch = (p: PostRow) => Array.isArray(p.slide_objects) && p.slide_objects.length === p.render.slides.length;

  return {
    vertical: 'carousels',
    label: 'carousels',
    stageTags: CAROUSELS_STAGE_TAGS,
    fixKinds: ['photo', 'wording', 'color', 'layout'],
    argsGuide: {
      wording: 'args.field is headline or body (the slide\'s big line or its smaller sentence), and args.value is the exact new text for that field.',
      color: 'args.canvas is the slide\'s new background: one of black, green, orange or white.',
      layout:
        'Give at least one of: args.layoutVariant (text = words with the photo in its own box, image = the photo fills the slide under the words), args.photoPlacement (below or top), args.photoTreatment (card or bottom-fade), args.photoBleed (true or false).',
      photo: 'No args are needed; args.hint is an optional short description of the photo wanted (for example "a data center").',
    },

    async load(q, refs) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return null;
      return {
        vertical: 'carousels',
        refs,
        status: await statusOf(q, post),
        parts: post.render.slides.map((s, i) => ({
          ref: { kind: 'slide', key: String(i + 1) },
          text: `${i === 0 ? 'Cover: ' : s.layoutVariant === 'follow' ? 'Closing slide: ' : ''}${slideText(s)}`,
          ...(s.photoUrl ? { photoUrl: s.photoUrl } : {}),
          ...(s.photoCredit ? { photoCredit: s.photoCredit } : {}),
          color: s.canvas ?? 'black',
          layout: layoutText(s),
        })),
      };
    },

    /** Render-only fixes call no model; wording is one fact-check call; a photo is one photo-chain call. */
    estimate(fix: FixKind) {
      if (fix === 'wording') return FACT_CHECK_CALL_ESTIMATE_USD;
      if (fix === 'photo') return CAROUSEL_PHOTO_SWAP_ESTIMATE_USD;
      return 0;
    },

    async revise({ q, refs, interpretation: it, meter }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) return failed('This carousel could not be found, so nothing was changed.');
      if (post.status === 'rejected') return blocked('This carousel was rejected, so it was not changed.');
      if (post.status === 'published') return blocked('This carousel is already published, so it was not changed.');
      if (!objectsMatch(post)) return failed('This carousel\'s stored slide images do not match its slides, so nothing was changed.');
      const n = slideNo(it.part);
      const old = post.render.slides[n - 1];
      if (!old) return failed(`There is no slide ${it.part.key} on this carousel (it has ${post.render.slides.length}), so nothing was changed.`);
      const render = clone(post.render);
      const next = render.slides[n - 1]!;
      let draft = post.draft ? clone(post.draft) : null;
      const objects = [...(post.slide_objects ?? [])];
      const before = stateOf(post, n, objects[n - 1]);
      const args = it.args ?? {};
      const { spend, check } = spender(meter);
      let usedPhoto: Photo | undefined;
      let mustShow: string | null = null;

      if (it.fixKind === 'color') {
        const canvas = args.canvas?.trim().toLowerCase();
        if (!canvas) return failed(`I could not tell which color slide ${n} should be (black, green, orange or white), so nothing was changed.`);
        if (!oneOf(CANVASES, canvas)) return failed(`"${canvas}" is not a slide color I know. Choose black, green, orange or white; nothing was changed.`);
        if ((old.canvas ?? 'black') === canvas) return failed(`Slide ${n} is already ${canvas}, so nothing was changed.`);
        next.canvas = canvas;
      } else if (it.fixKind === 'layout') {
        const lv = args.layoutVariant?.trim().toLowerCase();
        const pl = args.photoPlacement?.trim().toLowerCase();
        const tr = args.photoTreatment?.trim().toLowerCase();
        const bl = args.photoBleed?.trim().toLowerCase();
        if (!lv && !pl && !tr && !bl) return failed(`I could not tell what to change about slide ${n}'s layout, so nothing was changed.`);
        if (lv && !oneOf(LAYOUTS, lv)) return failed(`"${lv}" is not a layout I can switch to. Choose text (photo in its own box) or image (photo fills the slide); nothing was changed.`);
        if (pl && !oneOf(PLACEMENTS, pl)) return failed(`"${pl}" is not a photo position I know. Choose below or top; nothing was changed.`);
        if (tr && !oneOf(TREATMENTS, tr)) return failed(`"${tr}" is not a photo style I know. Choose card or bottom-fade; nothing was changed.`);
        if (bl && !oneOf(BLEEDS, bl)) return failed(`I could not tell whether the photo should fill the slide (true or false), so nothing was changed.`);
        if (old.panoramaSide) return blocked(`Slide ${n} is half of a two-slide photo spread, so its layout was not changed (it would break the spread).`);
        const story = old.layoutVariant === 'text' || old.layoutVariant === 'image';
        if (lv && !story) return blocked(`Slide ${n} is a ${old.layoutVariant} slide, whose layout is fixed. Only story slides switch between text and image.`);
        if ((pl || tr || bl) && !old.photoUrl) return blocked(`Slide ${n} has no photo, so there is no photo layout to change.`);
        if (bl === 'true' && (old.photoKind === 'subject' || old.photoKind === 'logo')) {
          return blocked(`Slide ${n}'s photo shows a person, an organization or a logo, which may not sit full-bleed under text; it was not changed. Try a different photo first.`);
        }
        if (lv) next.layoutVariant = lv as (typeof LAYOUTS)[number];
        if (pl) next.photoPlacement = pl as (typeof PLACEMENTS)[number];
        if (tr) next.photoTreatment = tr as (typeof TREATMENTS)[number];
        if (bl) setOrDelete(next, 'photoBleed', bl === 'true' ? true : null);
        if (next.layoutVariant === 'image') {
          if (!bleedable(next)) return blocked(`Slide ${n}'s photo may not fill the slide under text (it shows a person or a logo, or there is no photo), so the layout was not changed.`);
          delete next.photoPlacement;
        }
      } else if (it.fixKind === 'wording') {
        const field = args.field?.trim().toLowerCase();
        if (field !== 'headline' && field !== 'body') return failed(`I could not tell which words on slide ${n} to change (the headline or the body), so nothing was changed.`);
        const { fixDashes, fixQuoteMarks, fixWhitespace, LIMITS } = await import('@/lib/social/mechanical/checks');
        const value = fixWhitespace(fixQuoteMarks(fixDashes(args.value ?? '')));
        if (!value) return failed(`I could not tell what slide ${n}'s ${field} should say, so nothing was changed.`);
        if (old.layoutVariant === 'follow') return blocked(`Slide ${n} is the closing "follow" slide, whose words are written by code, so it was not changed.`);
        const oldRun = old[field];
        if (!oldRun || !runText(oldRun).trim()) return blocked(`Slide ${n} has no ${field}, so there is nothing to reword there.`);
        if (runText(oldRun) === value) return failed(`Slide ${n}'s ${field} already says that, so nothing was changed.`);
        const max = n === 1 ? LIMITS.cover : field === 'headline' ? LIMITS.headline : LIMITS.body;
        if (value.length > max) return blocked(`That ${field} is ${value.length} characters; slide ${n} takes at most ${max}, so it was not changed. Try a shorter one.`);
        if (n > 1 && field === 'headline' && value.length < LIMITS.headlineMin) return blocked(`That headline is ${value.length} characters; a headline needs at least ${LIMITS.headlineMin} (a headline, not a fragment), so it was not changed.`);
        const other = field === 'headline' ? runText(old.body) : runText(old.headline);
        if (n > 1 && value.length + other.length > LIMITS.slide) return blocked(`The headline and body together would be ${value.length + other.length} characters; a slide takes at most ${LIMITS.slide}, so it was not changed.`);
        if (!post.brief || !draft || !draftLine(draft, n)) return failed(`This carousel has no saved brief and draft for slide ${n}, so new words could not be fact-checked; nothing was changed.`);
        if (!setDraftLine(draft, n, field, value)) return blocked(`Slide ${n} has no ${field} in its draft, so it was not changed.`);
        const oldText = runText(oldRun);
        next[field] = respan(oldRun, value);
        if (oldText && next.altText.includes(oldText)) next.altText = next.altText.split(oldText).join(value);
        const verdict = await deps.factCheck({ brief: post.brief, draft, slide: n }, spend);
        check();
        if (!verdict.ok) {
          return verdict.flagged
            ? blocked(`The fact-checker did not pass the new words on slide ${n}: ${verdict.reason}. Nothing was changed.`)
            : failed(`The fact-check could not run (${verdict.reason}), so slide ${n} was not changed.`);
        }
        mustShow = value;
      } else if (it.fixKind === 'photo') {
        if (old.layoutVariant === 'follow') return blocked(`Slide ${n} is the closing "follow" slide, which has no photo, so it was not changed.`);
        if (old.panoramaSide) return blocked(`Slide ${n} is half of a two-slide photo spread, so its photo was not changed (it would break the spread).`);
        if (!post.brief || !draft || !draftLine(draft, n)) return failed(`This carousel has no saved brief and draft for slide ${n}, so I could not search for another photo; nothing was changed.`);
        const exclude = new Set<string>(render.slides.map((s) => s.photoUrl).filter((u): u is string => !!u));
        const recent = await q(
          `SELECT DISTINCT url FROM social.used_photos WHERE used_at <= now() AND used_at > now() - make_interval(days => $1)`,
          [NO_REPEAT_DAYS],
        );
        for (const r of recent.rows) exclude.add(r.url as string);
        const hint = args.hint?.trim();
        const found = await deps.findPhoto({ brief: post.brief, draft, slide: n, exclude, ...(hint ? { hint } : {}) }, spend);
        check();
        if (!found || exclude.has(found.url) || !found.credit?.trim()) {
          return failed(`I searched for another photo for slide ${n} and couldn't find a different usable photo (one not already in this post or used in the last ${NO_REPEAT_DAYS} days), so the original was kept.`);
        }
        const { canBleedPerson, photoKindOf, LOGO_WIDE_ASPECT } = await import('@/lib/social/render/from-draft');
        const kind = photoKindOf(found);
        for (const k of [...PHOTO_FIELDS, 'photoBleed', 'fade', 'bleedText']) delete (next as unknown as Record<string, unknown>)[k];
        next.photoUrl = found.url;
        next.photoCredit = found.credit;
        next.photoKind = kind;
        if (found.width && found.height) next.photoSize = { w: found.width, h: found.height };
        if (found.plate) next.logoPlate = found.plate;
        if (kind === 'logo' && found.width && found.height && found.width / found.height > LOGO_WIDE_ASPECT) next.logoWide = true;
        if (canBleedPerson(found)) next.photoBleed = true;
        // A photo that may show people can't sit under text unless framed for it (render review's next_photo rule).
        if (next.layoutVariant === 'image' && kind !== 'scene' && !next.photoBleed) {
          next.layoutVariant = 'text';
          next.photoPlacement = 'top';
        }
        usedPhoto = found;
      } else {
        return blocked(`${it.fixKind} fixes are not available for carousels.`);
      }

      // Render only this slide's new JPEG, to a new key; the old one is left in place.
      const key = `posts/${post.slug}/slide-${String(n).padStart(2, '0')}.rev${newId()}.jpg`;
      let out: { file: string; text: string };
      try {
        out = await deps.renderSlide({ slug: post.slug, post: render, slide: n, key });
        if (!out.file) throw new Error('no image came back');
      } catch (e) {
        return failed(`Slide ${n} could not be drawn with that change (${errText(e)}), so the original was kept.`);
      }
      if (mustShow && !flat(out.text).includes(flat(mustShow))) {
        return failed(`The new words did not all fit on slide ${n} when it was drawn, so the original was kept. Try shorter words.`);
      }
      objects[n - 1] = out.file;
      if (!(await save(q, post, render, draft, objects, usedPhoto ? { photo: usedPhoto, slide: n } : undefined))) {
        return failed('The carousel changed or left review while the fix ran, so it was not changed.');
      }
      return { ok: true, before, after: stateOf({ render, draft }, n, out.file) };
    },

    async restore({ q, refs, part, state }) {
      const post = await readPost(q, postIdOf(refs));
      if (!post) throw new Error('The carousel is gone.');
      if (!objectsMatch(post)) throw new Error('The carousel\'s stored slide images do not match its slides, so nothing was restored.');
      const n = slideNo(part);
      if (!post.render.slides[n - 1]) throw new Error(`There is no slide ${part.key} to restore.`);
      const render = clone(post.render);
      const s = render.slides[n - 1]!;
      const draft = post.draft ? clone(post.draft) : null;
      const copy = state.copy as { headline?: SpanRun | null; body?: SpanRun | null; altText?: string; draft?: { headline: string; body: string | null } | null } | undefined;
      if (copy) {
        if (copy.headline !== undefined) setOrDelete(s, 'headline', copy.headline);
        if (copy.body !== undefined) setOrDelete(s, 'body', copy.body);
        if (copy.altText !== undefined) s.altText = copy.altText;
        if (copy.draft && draft) {
          setDraftLine(draft, n, 'headline', copy.draft.headline);
          if (copy.draft.body !== null) setDraftLine(draft, n, 'body', copy.draft.body);
        }
      }
      for (const group of [state.photo, state.layout] as Array<Record<string, unknown> | undefined>) {
        if (group) for (const [k, v] of Object.entries(group)) setOrDelete(s, k, v);
      }
      const colors = state.colors as { canvas?: string | null } | undefined;
      if (colors && 'canvas' in colors) setOrDelete(s, 'canvas', colors.canvas);
      const objects = [...(post.slide_objects ?? [])];
      if (state.files[0]) objects[n - 1] = state.files[0];
      // Already in that state: nothing to write (idempotent).
      if (JSON.stringify(render) === JSON.stringify(post.render) && JSON.stringify(objects) === JSON.stringify(post.slide_objects) && JSON.stringify(draft) === JSON.stringify(post.draft)) return;
      if (!(await save(q, post, render, draft, objects))) throw new Error('The carousel changed or left review, so the slide could not be restored.');
    },

    unschedule: (q, refs) => deps.unschedule(q, postIdOf(refs)),
  };
}

/** Live deps: every import is lazy, so importing the registry loads no renderer, storage, model or Jev client. */
const liveDeps: CarouselsDeps = {
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

  async factCheck({ brief, draft, slide }, spend) {
    const [{ runFactCheck }, { fillDraft }, { newAnthropic }, { liveMessagesCreate }] = await Promise.all([
      import('@/lib/social/factcheck/factcheck'),
      import('@/lib/social/writer/draft'),
      import('@/lib/anthropic-client'),
      import('@/lib/social/reporter/reporter'),
    ]);
    type B = Parameters<typeof runFactCheck>[0];
    type D = Parameters<typeof fillDraft>[0];
    const b = brief as B;
    const submission = draft as D;
    const r = await runFactCheck(b, { submission, filled: fillDraft(submission, b) }, { create: liveMessagesCreate(newAnthropic()) });
    spend(r.costUsd);
    if (!r.ok) return { ok: false, flagged: false, reason: r.detail || r.reason };
    if (r.flags.main_claim_false) return { ok: false, flagged: true, reason: 'it says the story\'s main claim is false' };
    const chosen = submission.chosen_cover;
    const here = r.flags.flags.filter((f) => (slide === 1 ? f.where.part === 'cover' && f.where.number === chosen : f.where.part === 'slide' && f.where.number === slide));
    if (!here.length) return { ok: true };
    const why = here.map((f) => `"${f.quoted_text}" is not what the brief says${f.fix.kind === 'swap' && f.fix.replacement ? ` (the brief has "${f.fix.replacement}")` : ''}`);
    return { ok: false, flagged: true, reason: why.join('; ') };
  },

  async findPhoto({ brief, draft, slide, exclude, hint }, spend) {
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
    const b = brief as B;
    const filled = fillDraft(draft as D, b);
    const client = newAnthropic();
    // Every Haiku vision call and every Jev call is charged to the revision's meter as it is made.
    const create: Parameters<typeof createVisionCheck>[0]['create'] = async (params) => {
      const res = await client.messages.create(params as never);
      spend(Number(priceAnthropicMessages([res as never], { modelId: String((params as { model?: string }).model ?? '') }).costUsd));
      return res as never;
    };
    const ask = createJevAsk();
    const jev: typeof ask = async (request, meta) => {
      const res = await ask(request, meta);
      spend(jevCostUsd(res.usage));
      return res;
    };
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
    for (const request of requests) {
      const r = await find.searchVisual(request, ctx, deps, { cover: slide === 1 });
      // Logo cards need the plate chosen from the logo's luminance; a swap only takes a logo that has one.
      const ok = r.candidates.find((c) => !exclude.has(c.url) && (c.source !== 'logo' || c.plate) && checkPhotoCredit(c, `slide ${slide}`, b).length === 0);
      if (ok) return ok;
    }
    return null;
  },

  async unschedule(q, postId) {
    const { unschedulePost } = await import('@/lib/social/overnight/schedule');
    return unschedulePost(q, postId);
  },
};

export const carouselsDescription: ContentTypeDescription = createCarouselsDescription(liveDeps);
