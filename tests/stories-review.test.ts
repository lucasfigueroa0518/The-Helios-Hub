/**
 * Stories M2: the render review (S-33) against a stubbed Haiku 5.5 and a
 * stubbed renderer. No live Claude call, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { priceCall } from '@/lib/stories/cost';
import { FREE_VS_PAID, GUESS_THE_NUMBER, MORNING_DOWNLOAD, asSet } from '@/lib/stories/render/fixtures/m1';
import type { RenderResult } from '@/lib/stories/render/render';
import {
  REVIEW_MODEL,
  REVIEW_SYSTEM,
  SUBMIT_REVIEW_TOOL,
  applyChange,
  createReviewCall,
  frameList,
  reviewSet,
  type FrameFlag,
  type ReviewCall,
} from '@/lib/stories/render/review';
import type { Frame } from '@/lib/stories/render/types';

const gtn = (): Frame[] => asSet('guess_the_number', 'black', GUESS_THE_NUMBER.photo, 'homemade');
const md = (): Frame[] => asSet('morning_download', 'black', MORNING_DOWNLOAD);

const flag = (frame: number, patch: Partial<FrameFlag> = {}): FrameFlag => ({
  frame, hard_to_read: true, clipped: false, bad_photo: false, logo_broken: false, out_of_place: false, broken: false,
  change: 'none', backdrop: null, family: null, crop_x: null, crop_y: null, reason: 'test', ...patch,
});

let tinyJpeg: Buffer;
async function jpeg(): Promise<Buffer> {
  if (!tinyJpeg) {
    const sharp = (await import('sharp')).default;
    tinyJpeg = await sharp({ create: { width: 108, height: 192, channels: 3, background: '#000' } }).jpeg().toBuffer();
  }
  return tinyJpeg;
}
async function rendered(frames: Frame[], problems: Record<number, string[]> = {}): Promise<RenderResult> {
  const j = await jpeg();
  return { ok: true, problems: [], frames: frames.map((f, i) => ({ index: i + 1, role: f.data.role, problems: problems[i] ?? [], jpeg: j, bytes: j.length })) };
}
const usage = { model: REVIEW_MODEL, inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.0003 };

test('applyChange moves settings only; the words never change', () => {
  const frames = gtn();
  const backdrop = applyChange(frames, flag(2, { change: 'backdrop', backdrop: 'green' }));
  assert.equal(backdrop.frames![1]!.backdrop, 'green');
  assert.deepEqual(backdrop.frames![1]!.data, frames[1]!.data);

  const crop = applyChange(frames, flag(2, { change: 'crop', crop_x: 1.4, crop_y: 0.3 }));
  const q = crop.frames![1]!.data as { photo: { focus: { x: number; y: number } }; question: string };
  assert.deepEqual(q.photo.focus, { x: 1, y: 0.3 });
  assert.equal(q.question, (frames[1]!.data as { question: string }).question);

  // A question and its answer change layout together.
  const fam = applyChange(frames, flag(3, { change: 'family', family: 'type' }));
  assert.deepEqual(fam.frames!.map((f) => (f.data as { family?: string }).family), [undefined, 'type', 'type']);

  const drop = applyChange(md(), flag(2, { change: 'drop_photo' }));
  assert.equal('photo' in drop.frames![1]!.data, false);
  assert.equal((drop.frames![1]!.data as { headline: string }).headline, (MORNING_DOWNLOAD[1] as { headline: string }).headline);

  // What doesn't apply says why.
  assert.equal(applyChange(frames, flag(1, { change: 'crop', crop_x: 0.5, crop_y: 0.5 })).frames, null);
  assert.equal(applyChange(frames, flag(2, { change: 'backdrop', backdrop: 'black' })).note, 'backdrop: already black');
  assert.equal(applyChange(md(), flag(2, { change: 'family', family: 'type' })).frames, null);
  assert.equal(applyChange(asSet('free_vs_paid', 'black', FREE_VS_PAID), flag(2, { change: 'drop_photo' })).frames, null);
});

test('frameList tells the model what each frame is', () => {
  assert.equal(frameList(gtn()), [
    '1. intro, homemade, black background, no photo',
    '2. question, homemade, black background, photo layout, photo of a person',
    '3. answer, homemade, black background, photo layout, scene photo',
  ].join('\n'));
});

test('createReviewCall: Haiku 5.5, cached tools and system, the sheet as the per-set suffix', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const call = createReviewCall({
    create: async (params) => {
      sent.push(params);
      return {
        id: 'msg_1', type: 'message', role: 'assistant', model: REVIEW_MODEL, stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 250, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
        content: [
          { type: 'thinking', thinking: '', signature: 'x' },
          { type: 'tool_use', id: 't1', name: 'submit_review', input: { frames: [flag(2, { change: 'backdrop', backdrop: 'white' }), flag(9), flag(1, { change: 'bogus' as never })] } },
        ],
      } as unknown as Anthropic.Message;
    },
  });
  const res = await call(await jpeg(), gtn());
  const p = sent[0] as unknown as Record<string, unknown> & { tools: Array<Record<string, unknown>>; system: Array<Record<string, unknown>>; messages: Array<{ content: Array<Record<string, unknown>> }> };
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.deepEqual(p.tool_choice, { type: 'auto' });
  assert.equal('temperature' in p, false);
  assert.deepEqual(p.tools[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(p.tools[0]!.strict, true);
  assert.equal(p.system[0]!.text, REVIEW_SYSTEM);
  assert.deepEqual(p.system[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  // The per-set suffix carries no breakpoint.
  for (const block of p.messages[0]!.content) assert.equal('cache_control' in block, false);
  assert.equal((p.messages[0]!.content[1]!.source as { media_type: string }).media_type, 'image/jpeg');
  assert.ok('flags' in res);
  // Out-of-range frames and unknown changes are dropped.
  assert.deepEqual(res.flags.map((f) => f.frame), [2]);
  assert.equal(res.usage.cacheReadTokens, 900);
  assert.equal(res.usage.usd, priceCall(REVIEW_MODEL, { input_tokens: 1200, output_tokens: 250, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } as Anthropic.Message['usage']).usd);
});

test('createReviewCall: a refusal, a missing tool call or a thrown error is an error, never a pass', async () => {
  const base = { id: 'm', type: 'message', role: 'assistant', model: REVIEW_MODEL, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
  const refused = createReviewCall({ create: async () => ({ ...base, stop_reason: 'refusal', content: [] }) as unknown as Anthropic.Message });
  assert.deepEqual(await refused(await jpeg(), gtn()).then((r) => 'error' in r && r.error), 'review refused');
  const noTool = createReviewCall({ create: async () => ({ ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: 'looks fine' }] }) as unknown as Anthropic.Message });
  assert.deepEqual(await noTool(await jpeg(), gtn()).then((r) => 'error' in r && r.error), 'no valid review');
  const thrown = createReviewCall({ create: async () => { throw new Error('529 overloaded'); } });
  const t = await thrown(await jpeg(), gtn());
  assert.ok('error' in t && /529 overloaded/.test(t.error) && t.usage === null);
});

test('priceCall: Haiku 5.5 at $0.10/$0.50, cache reads at a tenth, unknown models refused', () => {
  const u = priceCall('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 } as Anthropic.Message['usage']);
  assert.equal(u.usd, 0.61);
  assert.throws(() => priceCall('claude-haiku-4-5', { input_tokens: 1, output_tokens: 1 } as Anthropic.Message['usage']), /no Stories price/);
});

function scripted(...answers: Array<FrameFlag[] | 'error'>): { call: ReviewCall; count: () => number } {
  let n = 0;
  return {
    call: async () => {
      const a = answers[n++] ?? [];
      return a === 'error' ? { error: 'review call failed: boom', usage: null } : { flags: a, usage };
    },
    count: () => n,
  };
}

test('reviewSet: a clean set takes one look and no re-render', async () => {
  const frames = gtn();
  const { call, count } = scripted([]);
  let renders = 0;
  const out = await reviewSet({ frames, first: await rendered(frames), render: async (f) => { renders++; return rendered(f); }, call });
  assert.equal(count(), 1);
  assert.equal(renders, 0);
  assert.equal(out.flagged, false);
  assert.deepEqual(out.calls, [usage]);
});

test('reviewSet: a fix that works is kept; one that still fails after a re-render goes to Lucas', async () => {
  const frames = gtn();
  const { call, count } = scripted(
    [flag(2, { change: 'backdrop', backdrop: 'orange' }), flag(3, { change: 'crop', crop_x: 0.2, crop_y: 0.2 })],
    [flag(3, { bad_photo: true, reason: 'still cropped badly' })],
  );
  let renders = 0;
  const out = await reviewSet({ frames, first: await rendered(frames), render: async (f) => { renders++; return rendered(f); }, call });
  assert.equal(count(), 2);
  assert.equal(renders, 1);
  assert.equal(out.frames[1]!.backdrop, 'orange');
  assert.equal(out.reviews[1]!.flagged, false);
  assert.equal(out.reviews[2]!.flagged, true);
  assert.match(out.reviews[2]!.note!, /still hard_to_read, bad_photo after crop/);
  assert.equal(out.flagged, true);
  assert.equal(out.calls.length, 2);
});

test('reviewSet: no fix on the menu, a fix that breaks the render, or no review at all → flagged', async () => {
  const frames = gtn();
  const none = await reviewSet({ frames, first: await rendered(frames), render: async (f) => rendered(f), call: scripted([flag(1)]).call });
  assert.equal(none.reviews[0]!.flagged, true);

  // The backdrop change breaks the code checks on frame 2: undone and flagged, nothing left to look at again.
  let renders = 0;
  const broke = await reviewSet({
    frames,
    first: await rendered(frames),
    render: async (f) => { renders++; return rendered(f, f[1]!.backdrop === 'white' ? { 1: ['text fit: too long'] } : {}); },
    call: scripted([flag(2, { change: 'backdrop', backdrop: 'white' })]).call,
  });
  assert.equal(broke.frames[1]!.backdrop, 'black');
  assert.equal(broke.reviews[1]!.flagged, true);
  assert.match(broke.reviews[1]!.note!, /broke the render check/);
  assert.equal(renders, 2);

  const failed = await reviewSet({ frames, first: await rendered(frames), render: async (f) => rendered(f), call: scripted('error').call });
  assert.equal(failed.flagged, true);
  assert.match(failed.log[0]!, /set flagged/);

  // A frame the renderer already failed is flagged without asking the model about it.
  const pre = await reviewSet({ frames, first: await rendered(frames, { 2: ['in the bottom 340px'] }), render: async (f) => rendered(f), call: scripted([]).call });
  assert.equal(pre.reviews[2]!.flagged, true);
});

test('the review prompt never invites text changes', () => {
  assert.match(REVIEW_SYSTEM, /never judge or ask to change any text/);
  const props = (SUBMIT_REVIEW_TOOL.input_schema as { properties: { frames: { items: { properties: Record<string, unknown> } } } }).properties.frames.items.properties;
  assert.deepEqual(Object.keys(props).filter((k) => /text|copy|headline|word/.test(k)), []);
});

test('nullable enums are anyOf, never a union type with null in the enum (strict tools reject it)', () => {
  const props = (SUBMIT_REVIEW_TOOL.input_schema as { properties: { frames: { items: { properties: Record<string, Record<string, unknown>> } } } }).properties.frames.items.properties;
  for (const key of ['backdrop', 'family']) {
    const p = props[key]!;
    assert.equal(p.type, undefined, `${key} has no top-level type`);
    assert.equal(p.enum, undefined, `${key} has no top-level enum`);
    const [str, nul] = p.anyOf as Array<{ type: string; enum?: unknown[] }>;
    assert.equal(str!.type, 'string');
    assert.ok(str!.enum!.length > 0 && !str!.enum!.includes(null), `${key} string enum holds no null`);
    assert.deepEqual(nul, { type: 'null' });
  }
});
