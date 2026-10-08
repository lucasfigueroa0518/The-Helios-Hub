/**
 * The render review (photo spec §5b; Link 6): one Haiku look at a finished
 * post's contact sheet, with the target look (§5a) in the cached prefix. It
 * judges only how the post LOOKS; the finder already verified every photo.
 *
 *   classification: written exception (photo spec §5b, rebuild spec §2.2) ·
 *   new AI call · 0 new stages (inside design) · at most 2 calls per post
 *
 * Option B (Tommy, 2026-10-07): the model answers fixed questions per slide
 * and picks one change from a fixed menu of slide SETTINGS; code applies it
 * and the renderer rebuilds the slide. The model never edits HTML, CSS or
 * text. A change that alters a slide's text, or breaks the render check, is
 * thrown away and logged.
 *
 *   round 1   review → apply the changes → re-render (code) → keep only the
 *             changes that pass the render check with the text unchanged
 *   round 2   review once more → a slide still flagged takes its next
 *             verified photo; the icon background only when there is none
 *             (fifth round, Tommy 2026-10-07: a photo on every slide)
 *
 * Spreads are one photo across two slides: the model is told so, and code
 * applies only a stronger fade, to both halves; any other change on a half is
 * skipped and logged, so the review can't break a spread. A next photo is
 * never the photo of a neighbouring slide.
 *
 * First end-to-end run (Tommy, 2026-10-07): fixes on, and the before and
 * after of every changed slide is saved with its reason, as the calibration.
 *
 * Caching: tools → system → the reference image (all static, marked); the
 * contact sheet and the slide list are the per-post suffix.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, ephemeralCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { PhotoTrace } from '@/lib/social/photos/find';
import { PHOTO_VISION_MODEL } from '@/lib/social/pipeline/models';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import type { FitCheck, FitResult } from './fit-check';
import { canBleedPerson, photoKindOf } from './from-draft';
import { layoutOf } from './layout-rotation';
import type { Post, SlideCopy } from './types';

export const REFERENCE_LOOK = path.join(process.cwd(), 'lib/social/render/assets/reference-look.png');

/** The fixed menu (photo spec §5b): each a slide setting the renderer understands. */
export const CHANGES = ['none', 'crop', 'zoom_out', 'stronger_fade', 'text_top', 'text_bottom', 'layout_full_photo', 'layout_photo_top', 'layout_split', 'next_photo'] as const;
export type Change = (typeof CHANGES)[number];

export const REVIEW_SYSTEM = `You review how a finished Instagram carousel LOOKS. You get the target look (a reference carousel) and a contact sheet of the post: every slide, numbered left to right, top to bottom, starting at 1 (the cover). The photos were already checked for who and what they show; never judge that. Judge only the look. Never ask to change any text.

For each slide answer these questions:
1. face_covered: is any face covered by text, or cut off at the edge?
2. too_busy: is the photo too busy or bright behind the text to read easily?
3. over_zoomed: is the photo zoomed in so far it looks blurry or odd?
4. crowds_mark: does the text crowd the HELIOS mark or the arrow?
5. awkward: does the photo look awkward or out of place on the slide?
6. same_as_neighbour: does the slide look nearly the same as the slide before it?
7. broken: does the slide look broken or bare?

For a slide with any "yes", pick ONE change from this menu, the one most likely to fix it:
- crop: move the photo's crop (give crop_x and crop_y, 0 to 1: where the photo's centre of interest should sit; 0.5 0.3 moves a face up)
- zoom_out: show more of the photo
- stronger_fade: a darker fade under the text
- text_top / text_bottom: move the text block on a full-photo slide
- layout_full_photo / layout_photo_top / layout_split: change the slide's layout
- next_photo: use the next-best photo for that slide (its icon background only if there is none)
- none: nothing on the menu helps (for "broken": always none; it is logged as a render bug)

Slides marked "spread" are one photo across two slides: judge them as a pair; a photo cut at their shared edge is intended.

List only slides with at least one "yes". Give a one-line reason for each. Call submit_review once.`;

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const SUBMIT_REVIEW_TOOL = {
  name: 'submit_review',
  description: 'Submit the review. Call it once.',
  input_schema: obj({
    slides: {
      type: 'array',
      items: obj({
        slide: { type: 'integer', description: '1 = the cover.' },
        face_covered: { type: 'boolean' },
        too_busy: { type: 'boolean' },
        over_zoomed: { type: 'boolean' },
        crowds_mark: { type: 'boolean' },
        awkward: { type: 'boolean' },
        same_as_neighbour: { type: 'boolean' },
        broken: { type: 'boolean' },
        change: { type: 'string', enum: [...CHANGES] },
        crop_x: { type: ['number', 'null'] },
        crop_y: { type: ['number', 'null'] },
        reason: { type: 'string' },
      }),
    },
  }),
} as unknown as Anthropic.Tool;

export type SlideFlag = {
  slide: number;
  face_covered: boolean;
  too_busy: boolean;
  over_zoomed: boolean;
  crowds_mark: boolean;
  awkward: boolean;
  same_as_neighbour: boolean;
  broken: boolean;
  change: Change;
  crop_x: number | null;
  crop_y: number | null;
  reason: string;
};

const FLAGS = ['face_covered', 'too_busy', 'over_zoomed', 'crowds_mark', 'awkward', 'same_as_neighbour', 'broken'] as const;
const flagged = (f: SlideFlag) => FLAGS.some((k) => f[k]);
const flagNames = (f: SlideFlag) => FLAGS.filter((k) => f[k]).join(', ');

/** What each slide shows, as text beside the contact sheet. */
export function slideList(post: Post): string {
  return post.slides
    .map((s, i) => `${i + 1}. ${s.layoutVariant === 'cover' ? 'cover' : layoutOf(s)}${s.panoramaSide ? `, spread, ${s.panoramaSide} half` : ''}${s.photoUrl ? `, ${s.photoKind === 'logo' ? 'logo' : s.photoKind === 'subject' ? 'photo of a person or the story' : 'scene photo'}` : s.layoutVariant === 'follow' ? '' : ', icon background (no photo)'}`)
    .join('\n');
}

/** Apply one menu change to one slide: the new slide, or why it doesn't apply. Text is never touched. */
export function applyChange(s: SlideCopy, f: SlideFlag, next: PhotoTrace['alternates'][number] | undefined): { slide: SlideCopy; note: string } | { slide: null; note: string } {
  const hasPhoto = Boolean(s.photoUrl);
  const bleedable = hasPhoto && ((s.photoKind ?? 'scene') === 'scene' || s.photoBleed === true);
  const story = s.layoutVariant === 'text' || s.layoutVariant === 'image';
  switch (f.change) {
    case 'crop': {
      if (!hasPhoto || f.crop_x === null || f.crop_y === null) return { slide: null, note: 'crop: no photo or no position' };
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      return { slide: { ...s, photoFocus: { ...(s.photoFocus ?? {}), x: clamp(f.crop_x), y: clamp(f.crop_y) } }, note: `crop → ${clamp(f.crop_x).toFixed(2)} ${clamp(f.crop_y).toFixed(2)}` };
    }
    case 'zoom_out':
      if (!hasPhoto) return { slide: null, note: 'zoom_out: no photo' };
      if (s.layoutVariant === 'image' && story) return { slide: { ...s, layoutVariant: 'text', photoPlacement: 'top' }, note: 'zoom_out → photo on top (a smaller window shows more of it)' };
      return { slide: { ...s, photoFocus: { x: s.photoFocus?.x ?? 0.5, y: s.photoFocus?.y ?? 0.5, windowW: 760 } }, note: 'zoom_out → a narrower photo window' };
    case 'stronger_fade':
      return hasPhoto ? { slide: { ...s, fade: 'strong' }, note: 'stronger fade' } : { slide: null, note: 'stronger_fade: no photo' };
    case 'text_top':
    case 'text_bottom': {
      const where = f.change === 'text_top' ? 'top' : 'bottom';
      if (s.layoutVariant === 'image') return { slide: { ...s, bleedText: where }, note: `text ${where}` };
      if (s.layoutVariant === 'text' && !hasPhoto) return { slide: { ...s, textAnchor: where }, note: `text ${where}` };
      return { slide: null, note: `${f.change}: not on this layout` };
    }
    case 'layout_full_photo':
      if (s.template) return { slide: null, note: `${f.change}: the layout is Jev's variant (${s.template}); the review never changes it` };
      return story && bleedable ? { slide: { ...s, layoutVariant: 'image', photoPlacement: undefined }, note: 'layout → full photo' } : { slide: null, note: 'layout_full_photo: this photo may not sit under text' };
    case 'layout_photo_top':
    case 'layout_split':
      if (s.template) return { slide: null, note: `${f.change}: the layout is Jev's variant (${s.template}); the review never changes it` };
      return story && hasPhoto ? { slide: { ...s, layoutVariant: 'text', photoPlacement: f.change === 'layout_photo_top' ? 'top' : 'below' }, note: `layout → ${f.change === 'layout_photo_top' ? 'photo on top' : 'split'}` } : { slide: null, note: `${f.change}: not on this slide` };
    case 'next_photo':
      if (next) {
        const kind = photoKindOf(next);
        return { slide: { ...s, photoUrl: next.url, photoCredit: next.credit, photoKind: kind, photoFocus: undefined, photoBleed: canBleedPerson(next) || undefined, ...(s.layoutVariant === 'image' && kind !== 'scene' && !canBleedPerson(next) ? { layoutVariant: 'text' as const, photoPlacement: 'top' as const } : {}) }, note: `next photo: ${next.url}` };
      }
      return hasPhoto ? { slide: toIcon(s), note: 'next photo: none verified → icon background' } : { slide: null, note: 'next_photo: no photo and no alternate' };
    default:
      return { slide: null, note: 'none' };
  }
}

/** The slide without its photo: its icon background (photo spec §5). */
export function toIcon(s: SlideCopy): SlideCopy {
  const { photoUrl: _u, photoCredit: _c, photoKind: _k, photoFocus: _f, photoBleed: _b, logoPlate: _p, logoWide: _w, photoIsSpeaker: _s, fade: _fd, bleedText: _bt, ...rest } = s;
  void _u; void _c; void _k; void _f; void _b; void _p; void _w; void _s; void _fd; void _bt;
  return { ...rest, ...(s.layoutVariant === 'image' ? { layoutVariant: 'text' as const } : {}) };
}

export type ReviewCall = (contactSheetPng: Buffer, post: Post) => Promise<{ flags: SlideFlag[]; costUsd: number } | { error: string; costUsd: number }>;

/** The live review call: Haiku, the reference look and the contact sheet as images. */
export function createReviewCall(deps: { create: MessagesCreate; model?: string; referencePng?: Buffer }): ReviewCall {
  const model = deps.model ?? PHOTO_VISION_MODEL.model;
  const tools = [withToolCache(SUBMIT_REVIEW_TOOL)];
  let reference: Promise<string> | null = null;
  const referenceB64 = () => (reference ??= (deps.referencePng ? Promise.resolve(deps.referencePng) : fsp.readFile(REFERENCE_LOOK)).then((b) => b.toString('base64')));
  return async (sheet, post) => {
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model,
        max_tokens: 2000,
        system: cachedSystemText(REVIEW_SYSTEM),
        tools,
        tool_choice: { type: 'tool', name: SUBMIT_REVIEW_TOOL.name },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'TARGET LOOK (a reference carousel; its photos are placeholders):' },
            // The last static block: the cache breakpoint for tools → system → reference.
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: await referenceB64() }, cache_control: ephemeralCache() },
            { type: 'text', text: `THIS POST (contact sheet):\n${slideList(post)}` },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: sheet.toString('base64') } },
          ],
        }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { error: `review call failed: ${err instanceof Error ? err.message : String(err)}`, costUsd: 0 };
    }
    const costUsd = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: model }).costUsd);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_REVIEW_TOOL.name);
    const input = block?.input as { slides?: SlideFlag[] } | undefined;
    if (!input || !Array.isArray(input.slides)) return { error: 'no valid review', costUsd };
    return { flags: input.slides.filter((f) => Number.isInteger(f.slide) && f.slide >= 1 && f.slide <= post.slides.length && (CHANGES as readonly string[]).includes(f.change)), costUsd };
  };
}

export type RenderReviewDeps = { call: ReviewCall; dir: string };

/** The design stage's review step (pipeline/design-stage.ts RenderReviewStep). */
export function createRenderReview(deps: RenderReviewDeps) {
  return async ({ post, storyId, traces, fit, fitCheck }: { post: Post; storyId: string; traces: PhotoTrace[]; fit: FitResult; fitCheck: FitCheck }): Promise<{ post: Post; fit: FitResult; log: string[] }> => {
    const dir = path.join(deps.dir, storyId.replace(/[^a-z0-9]+/gi, '-').slice(0, 60));
    await fsp.mkdir(dir, { recursive: true });
    const log: string[] = [];
    const record: Array<Record<string, unknown>> = [];
    let spent = 0;
    const shoot = async (p: Post, name: string) => {
      const r = await fitCheck(p, { screenshotDir: dir, name });
      return { r, sheet: await fsp.readFile(path.join(dir, `${name}-contact-sheet.png`)) };
    };
    const textSame = (a: FitResult, b: FitResult, n: number) => a.slideText[n - 1] === b.slideText[n - 1];
    // Alternates per rendered slide: cover = trace 0, story slides = traces 1…; the follow slide has none.
    const alternates = traces.map((t) => [...t.alternates]);
    /** The next verified photo for slide n (1-based) that isn't on a neighbouring slide. */
    const nextFor = (p: Post, n: number) => {
      const near = new Set([p.slides[n - 2]?.photoUrl, p.slides[n]?.photoUrl].filter(Boolean));
      const list = alternates[n - 1] ?? [];
      while (list.length && near.has(list[0]!.url)) list.shift();
      return list.shift();
    };
    /** A spread half (and its partner): only a stronger fade, on both halves. */
    const spreadChange = (p: Post, n: number, f: SlideFlag): { post: Post; note: string } | { post: null; note: string } => {
      const s = p.slides[n - 1]!;
      if (f.change !== 'stronger_fade') return { post: null, note: `${f.change}: a spread half (one photo across two slides) → skipped` };
      const partner = s.panoramaSide === 'left' ? n + 1 : n - 1;
      return { post: { ...p, slides: p.slides.map((x, i) => (i === n - 1 || i === partner - 1 ? { ...x, fade: 'strong' as const } : x)) }, note: 'stronger fade on both spread halves' };
    };

    // ── Round 1 ──
    const before = await shoot(post, 'before');
    const r1 = await deps.call(before.sheet, post);
    spent += r1.costUsd;
    if ('error' in r1) {
      log.push(`render review: ${r1.error} → post unchanged`);
      await fsp.writeFile(path.join(dir, 'review.json'), JSON.stringify({ error: r1.error, costUsd: spent }, null, 2));
      return { post, fit, log };
    }
    let current = post;
    const changed = new Map<number, { flag: SlideFlag; note: string }>();
    for (const f of r1.flags.filter(flagged)) {
      const s = current.slides[f.slide - 1]!;
      if (f.broken && f.change === 'none') {
        log.push(`slide ${f.slide}: looks broken or bare (${f.reason}) → logged as a render bug`);
        continue;
      }
      if (s.panoramaSide) {
        const sp = spreadChange(current, f.slide, f);
        if (!sp.post) {
          log.push(`slide ${f.slide}: ${flagNames(f)} (${f.reason}) → ${sp.note}`);
          continue;
        }
        current = sp.post;
        changed.set(f.slide, { flag: f, note: sp.note });
        continue;
      }
      const a = applyChange(s, f, f.change === 'next_photo' ? nextFor(current, f.slide) : undefined);
      if (!a.slide) {
        log.push(`slide ${f.slide}: ${flagNames(f)} (${f.reason}) → ${a.note}: not applied`);
        continue;
      }
      current = { ...current, slides: current.slides.map((x, i) => (i === f.slide - 1 ? a.slide! : x)) };
      changed.set(f.slide, { flag: f, note: a.note });
    }
    let after = changed.size ? await shoot(current, 'after-1') : before;
    // Keep only the changes that pass the render check with the slide's text unchanged.
    const failing = new Set<number>([...changed.keys()].filter((n) => !textSame(before.r, after.r, n) || after.r.problems.some((p) => p.startsWith(`slide ${n} `)) || after.r.violations.some((v) => v.slide === n)));
    if (failing.size) {
      for (const n of failing) {
        log.push(`slide ${n}: ${changed.get(n)!.note} broke the render check or changed text → thrown away`);
        current = { ...current, slides: current.slides.map((x, i) => (i === n - 1 ? post.slides[i]! : x)) };
        changed.delete(n);
      }
      after = await shoot(current, 'after-1');
    }
    for (const [n, c] of changed) {
      log.push(`slide ${n}: ${flagNames(c.flag)} (${c.flag.reason}) → ${c.note}`);
      record.push({ slide: n, round: 1, flags: flagNames(c.flag), reason: c.flag.reason, change: c.note, before: `before-slide-${String(n).padStart(2, '0')}.png`, after: `after-1-slide-${String(n).padStart(2, '0')}.png` });
    }

    // ── Round 2: anything still flagged takes its next verified photo; the icon only when there is none ──
    let final = after;
    if (changed.size) {
      const r2 = await deps.call(after.sheet, current);
      spent += r2.costUsd;
      if ('error' in r2) {
        log.push(`render review, second look: ${r2.error} → round 1 kept`);
      } else {
        const still = r2.flags.filter((f) => flagged(f) && changed.has(f.slide));
        for (const f of still) {
          const s = current.slides[f.slide - 1]!;
          if (!s.photoUrl || s.panoramaSide) {
            log.push(`slide ${f.slide}: still ${flagNames(f)} (${f.reason}), ${s.panoramaSide ? 'a spread half (kept whole)' : 'no photo to change'} → logged`);
            continue;
          }
          const next = nextFor(current, f.slide);
          const a = next ? applyChange(s, { ...f, change: 'next_photo' }, next) : null;
          const slide = a?.slide ?? toIcon(s);
          const change = a?.slide ? a.note : 'icon background (no other verified photo)';
          current = { ...current, slides: current.slides.map((x, i) => (i === f.slide - 1 ? slide : x)) };
          log.push(`slide ${f.slide}: still ${flagNames(f)} after its fix (${f.reason}) → ${change}`);
          record.push({ slide: f.slide, round: 2, flags: flagNames(f), reason: f.reason, change, before: `after-1-slide-${String(f.slide).padStart(2, '0')}.png`, after: `final-slide-${String(f.slide).padStart(2, '0')}.png` });
        }
        if (still.length) final = await shoot(current, 'final');
      }
    }
    // The run's own screenshots show the final post.
    if (record.length) final = { ...final, r: await fitCheck(current) };
    log.push(`render review: ${record.length} change(s), $${spent.toFixed(4)}`);
    await fsp.writeFile(path.join(dir, 'review.json'), JSON.stringify({ storyId, costUsd: spent, round1: r1.flags, changes: record, log }, null, 2));
    return { post: current, fit: final.r, log };
  };
}
