/**
 * Photo Link 6: the render review (photo spec §5b, option B). Offline: the
 * model is a stub that returns canned flags; the render check is a stub that
 * writes tiny screenshots. Covers the settings menu, the text-never-changes
 * rule, round 2 dropping to the icon, the saved before/after, and caching.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { PhotoTrace } from '@/lib/social/photos/find';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { REVIEW_SYSTEM, SUBMIT_REVIEW_TOOL, applyChange, createRenderReview, createReviewCall, toIcon, type ReviewCall, type SlideFlag } from '@/lib/social/render/review';
import type { Post } from '@/lib/social/render/types';
import { fillDraft } from '@/lib/social/writer/draft';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function post(): Post {
  const filled = fillDraft(sifDraftHandoff(), briefSuperIntelligenceForce());
  const scene = { url: 'https://s/scene.jpg', credit: 'A, CC BY · via flickr', source: 'stock' as const, width: 1600, height: 1000, qid: null, subject: null };
  return toRenderPost(filled, { cover: scene, slides: filled.slides.map((_, i) => (i === 0 ? { ...scene, url: 'https://s/scene-2.jpg' } : null)) }, { source: 's', sourceUrl: 'u', publishedAt: '2026-10-07T00:00:00Z' });
}

/** A render check stub that writes 1-pixel screenshots and reports `bad` slides as failing. */
function shootingFit(bad: (p: Post) => number[] = () => []): FitCheck {
  return async (p, opts) => {
    const r = fitOkFor(p);
    if (opts?.screenshotDir) {
      writeFileSync(path.join(opts.screenshotDir, `${opts.name}-contact-sheet.png`), PNG);
      p.slides.forEach((_, i) => writeFileSync(path.join(opts.screenshotDir!, `${opts.name}-slide-${String(i + 1).padStart(2, '0')}.png`), PNG));
    }
    const b = bad(p);
    return b.length ? { ...r, ok: false, problems: b.map((n) => `slide ${n} contrast: x sits on a photo with no scrim`) } : r;
  };
}

const flag = (slide: number, change: SlideFlag['change'], extra: Partial<SlideFlag> = {}): SlideFlag => ({ slide, face_covered: false, too_busy: true, over_zoomed: false, crowds_mark: false, awkward: false, same_as_neighbour: false, broken: false, change, crop_x: null, crop_y: null, reason: 'too busy behind the text', ...extra });

const traces = (n: number): PhotoTrace[] => Array.from({ length: n }, () => ({ request: { kind: 'none', value: '' }, photo: null, via: 'icon', icon: 'clock', identity: null, steps: [], alternates: [] }));

test('the settings menu: each change touches settings only, never text; what does not apply is refused', () => {
  const p = post();
  const cover = p.slides[0]!;
  const text = p.slides[2]!; // no photo
  const f = (change: SlideFlag['change'], extra: Partial<SlideFlag> = {}) => flag(1, change, extra);
  assert.equal(applyChange(cover, f('stronger_fade'), undefined).slide?.fade, 'strong');
  assert.deepEqual(applyChange(cover, f('crop', { crop_x: 0.5, crop_y: 1.4 }), undefined).slide?.photoFocus, { x: 0.5, y: 1 }, 'clamped');
  assert.equal(applyChange(text, f('stronger_fade'), undefined).slide, null, 'no photo, no fade');
  assert.equal(applyChange(text, f('text_bottom'), undefined).slide?.textAnchor, 'bottom');
  const next = { url: 'https://s/other.jpg', credit: 'B, CC BY', source: 'article' as const, width: null, height: null, qid: null, subject: null };
  assert.equal(applyChange(p.slides[1]!, f('next_photo'), next).slide?.photoUrl, 'https://s/other.jpg');
  assert.equal(applyChange(p.slides[1]!, f('next_photo'), undefined).slide?.photoUrl, undefined, 'none verified → icon background');
  for (const change of ['crop', 'stronger_fade', 'layout_split', 'next_photo'] as const) {
    const s = applyChange(p.slides[1]!, f(change, { crop_x: 0.4, crop_y: 0.3 }), next).slide;
    if (s) assert.deepEqual([s.headline, s.body, s.title, s.quoteText], [p.slides[1]!.headline, p.slides[1]!.body, p.slides[1]!.title, p.slides[1]!.quoteText], change);
  }
  assert.equal(toIcon(cover).photoUrl, undefined);
  assert.equal(toIcon(cover).headline, cover.headline);
});

test('round 1 applies the changes that pass; round 2: a slide still flagged drops to its icon; before and after are saved with the reason', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'review-'));
  const calls: Post[] = [];
  const call: ReviewCall = async (_sheet, p) => {
    calls.push(p);
    return calls.length === 1
      ? { flags: [flag(1, 'stronger_fade'), flag(2, 'crop', { crop_x: 0.5, crop_y: 0.2, face_covered: true, too_busy: false, reason: 'face under the headline' })], costUsd: 0.006 }
      : { flags: [flag(2, 'none', { reason: 'still busy' })], costUsd: 0.006 };
  };
  const p = post();
  const review = createRenderReview({ call, dir });
  const r = await review({ post: p, storyId: 'story-1', traces: traces(p.slides.length), fit: fitOkFor(p), fitCheck: shootingFit() });
  assert.equal(r.post.slides[0]!.fade, 'strong', 'the cover kept its fix');
  assert.equal(r.post.slides[1]!.photoUrl, undefined, 'slide 2 still flagged after its fix → icon background');
  assert.deepEqual(r.post.slides.map((s) => s.headline), p.slides.map((s) => s.headline), 'no text changed');
  const saved = JSON.parse(readFileSync(path.join(dir, 'story-1', 'review.json'), 'utf8'));
  assert.equal(saved.costUsd, 0.012);
  assert.deepEqual(saved.changes.map((c: { slide: number; round: number; change: string }) => [c.slide, c.round, c.change]), [[1, 1, 'stronger fade'], [2, 1, 'crop → 0.50 0.20'], [2, 2, 'icon background']]);
  for (const c of saved.changes) {
    assert.ok(existsSync(path.join(dir, 'story-1', c.before)), c.before);
    assert.ok(existsSync(path.join(dir, 'story-1', c.after)), c.after);
  }
  assert.ok(r.log.some((l) => /slide 2: still too_busy after its fix \(still busy\) → icon background/.test(l)), r.log.join(' | '));
});

test('a change that breaks the render check is thrown away; a broken slide with no change is logged as a render bug; no second call without changes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'review-'));
  let n = 0;
  const call: ReviewCall = async () => {
    n++;
    return { flags: [flag(1, 'layout_split'), flag(3, 'none', { broken: true, too_busy: false, reason: 'empty slide' })], costUsd: 0.006 };
  };
  const p = post();
  // Every render where slide 1 isn't a full-bleed cover fails (the split change breaks it).
  const r = await createRenderReview({ call, dir })({ post: p, storyId: 's', traces: traces(p.slides.length), fit: fitOkFor(p), fitCheck: shootingFit((x) => (x.slides[0]!.fade ? [1] : [])) });
  assert.equal(n, 1);
  assert.deepEqual(r.post, p, 'nothing applied (split does not apply to a cover; the broken slide is only logged)');
  assert.ok(r.log.some((l) => /slide 3: looks broken or bare \(empty slide\) → logged as a render bug/.test(l)));
  assert.ok(r.log.some((l) => /slide 1: .* → layout_split: not on this slide: not applied/.test(l)), r.log.join(' | '));

  let m = 0;
  const fadeBreaks: ReviewCall = async () => (++m === 1 ? { flags: [flag(1, 'stronger_fade')], costUsd: 0.006 } : { flags: [], costUsd: 0.006 });
  const r2 = await createRenderReview({ call: fadeBreaks, dir })({ post: p, storyId: 's2', traces: traces(p.slides.length), fit: fitOkFor(p), fitCheck: shootingFit((x) => (x.slides[0]!.fade ? [1] : [])) });
  assert.equal(r2.post.slides[0]!.fade, undefined, 'the fade broke the render check → thrown away');
  assert.ok(r2.log.some((l) => /slide 1: stronger fade broke the render check or changed text → thrown away/.test(l)));
  assert.equal(m, 1, 'no second look when nothing changed');
});

test('the review call: Haiku (the photo vision model), cached tools → system → reference image, the contact sheet after the breakpoint, forced tool', async () => {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const usage = { input_tokens: 3000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 2500 };
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    requests.push(params);
    return { id: 'm', type: 'message', role: 'assistant', model: params.model, stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: 't', name: 'submit_review', input: { slides: [flag(2, 'stronger_fade'), flag(99, 'crop')] } }] } as unknown as Anthropic.Message;
  };
  const p = post();
  const r = await createReviewCall({ create, referencePng: PNG })(PNG, p);
  assert.ok(!('error' in r));
  if (!('error' in r)) assert.deepEqual(r.flags.map((f) => f.slide), [2], 'slide numbers outside the post are dropped');
  const req = requests[0]! as unknown as { model: string; system: Array<{ text: string; cache_control?: unknown }>; tools: Array<{ name: string; cache_control?: unknown }>; tool_choice: unknown; messages: Array<{ content: Array<{ type: string; cache_control?: unknown; text?: string }> }> };
  assert.equal(req.model, 'claude-haiku-4-5-20251001');
  assert.equal(req.system[0]!.text, REVIEW_SYSTEM);
  assert.ok(req.system[0]!.cache_control && req.tools[0]!.cache_control);
  assert.equal(req.tools[0]!.name, SUBMIT_REVIEW_TOOL.name);
  assert.deepEqual(req.tool_choice, { type: 'tool', name: 'submit_review' });
  const blocks = req.messages[0]!.content;
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'image', 'text', 'image']);
  assert.ok(blocks[1]!.cache_control, 'the reference image is the last cached block');
  assert.ok(!blocks[3]!.cache_control, 'the contact sheet is the per-post suffix');
  assert.match(blocks[2]!.text!, /^THIS POST \(contact sheet\):\n1\. cover, scene photo/);
  assert.ok(REVIEW_SYSTEM.includes('Never ask to change any text.'));
});
