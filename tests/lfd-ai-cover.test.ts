/**
 * The LFD AI cover (lib/lfd/cover): hook rotation, the Jev direction, the cached writer request, the fal queue
 * flow and every fallback. Jev, the writer and fal's fetch are stubs; no network, no spend (CLAUDE.md Rule 1).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import { FAL_COVER_IMAGE_USD, makeLfdAiCover, pickCoverDirection, type LfdAiCoverDeps, type LfdAiCoverInput } from '@/lib/lfd/cover';
import { LFD_COVER_SYSTEM } from '@/lib/lfd/cover/prompts';
import { coverWriterRequest } from '@/lib/lfd/cover/writer';
import { buildPost, LFD_COVER_HOOKS, nextLfdCoverHook } from '@/lib/lfd/post';
import type { Ready } from '@/lib/lfd/types';
import type { JevAsk } from '@/lib/social/jev/client';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';

const STORIES = [
  { headline: 'Nvidia sues a rival chip startup', body: 'Nvidia filed suit on Monday.' },
  { headline: 'A court pauses an AI law', body: 'The judge granted the stay.' },
];
const INPUT: LfdAiCoverInput = {
  stories: STORIES,
  photos: [
    { url: 'https://img.test/a.jpg', headline: STORIES[0]!.headline, kind: 'person' },
    { url: 'https://img.test/b.jpg', headline: STORIES[1]!.headline, kind: 'scene' },
    { url: 'https://img.test/c.jpg', headline: 'Third story', kind: 'logo' },
  ],
  prevHook: LFD_COVER_HOOKS[0]!.text,
  storyCount: 3,
  objectPath: 'lfd/lfd-2026-11-24/cover-ai-abcd1234.jpg',
};

const jevSays = (noul: number): JevAsk => async () => ({ answers: { two_sides: { noul } }, usage: { input_tokens: 100, output_tokens: 0 }, model: 'jev' });

function writerStub(o: { references?: number[]; fail?: Error; noTool?: boolean } = {}) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(p);
    if (o.fail) throw o.fail;
    const content = o.noTool
      ? [{ type: 'text', text: 'no' }]
      : [{ type: 'tool_use', id: 't', name: 'write_cover_prompt', input: { prompt: '1. Capture: 35mm\n2. Subjects: [1]', references: o.references ?? [2] } }];
    return { id: 'w', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 }, content } as unknown as Anthropic.Message;
  };
  return { create, calls };
}

type Fail = 'submit' | 'failed' | 'status_http' | 'timeout' | 'no_images' | 'download' | 'store' | 'photo';

const QUEUE = 'https://queue.fal.run/openai/gpt-image-2.6/flare/edit';
const RESULT = 'https://v3.fal.media/files/result.jpg';

async function falStub(o: { fail?: Fail } = {}) {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 50, b: 0 } } }).png().toBuffer();
  // A large story photo, so the ≤1024 px downscale shows.
  const photo = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 10, g: 120, b: 60 } } }).jpeg().toBuffer();
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> }> = [];
  const uploads: Array<{ path: string; type?: string; bytes: number }> = [];
  let polls = 0;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: (init?.headers as Record<string, string>) ?? {}, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) });
    if (url === QUEUE) {
      if (o.fail === 'submit') return json({ detail: 'image_urls invalid' }, 422);
      return json({ request_id: 'r1', status_url: `${QUEUE}/requests/r1/status`, response_url: `${QUEUE}/requests/r1` });
    }
    if (url === `${QUEUE}/requests/r1/status`) {
      polls += 1;
      if (o.fail === 'failed') return json({ status: 'FAILED', error: 'content policy' });
      if (o.fail === 'status_http') return json({ detail: 'server error' }, 500);
      if (o.fail === 'timeout' || polls < 2) return json({ status: 'IN_PROGRESS' });
      return json({ status: 'COMPLETED' });
    }
    if (url === `${QUEUE}/requests/r1`) return json({ images: o.fail === 'no_images' ? [] : [{ url: RESULT, width: 1536, height: 1152 }] });
    if (url === RESULT) return o.fail === 'download' ? new Response('no', { status: 404 }) : new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    if (o.fail === 'photo') return new Response('gone', { status: 404 });
    return new Response(new Uint8Array(photo), { headers: { 'content-type': 'image/jpeg' } });
  };
  let t = 0;
  const deps = (over: Partial<LfdAiCoverDeps> = {}): LfdAiCoverDeps => ({
    jev: jevSays(0.9),
    create: writerStub().create,
    fal: { apiKey: 'test-key', fetch: fetchImpl },
    fetch: fetchImpl,
    upload: async (p, b, type) => {
      if (o.fail === 'store') throw new Error('bucket down');
      uploads.push({ path: p, type, bytes: b.length });
    },
    remainingUsd: () => 1,
    wait: { now: () => (t += 10_000), sleep: async () => {}, deadlineMs: 60_000 },
    ...over,
  });
  return { deps, calls, uploads };
}

test('the hook rotates from the previous post’s hook, with {N} filled in', () => {
  assert.equal(nextLfdCoverHook(null, 5).text, LFD_COVER_HOOKS[0]!.text);
  const second = nextLfdCoverHook(LFD_COVER_HOOKS[0]!.text, 5);
  assert.equal(second.text, '5 things happened in AI you need to know.');
  assert.equal(second.accent, '5 things');
  assert.equal(nextLfdCoverHook('4 things happened in AI you need to know.', 5).text, LFD_COVER_HOOKS[2]!.text);
  assert.equal(nextLfdCoverHook(LFD_COVER_HOOKS.at(-1)!.text, 5).text, LFD_COVER_HOOKS[0]!.text);
});

test('the system prompt is COVER-PROMPT-WRITER.md’s, verbatim', () => {
  const md = fs.readFileSync(path.join(process.cwd(), 'planning/MD-LFD Revisions/COVER-PROMPT-WRITER.md'), 'utf8');
  const section = md.split('## System prompt')[1]!.split('\n## ')[0]!;
  const quoted = section.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^> ?/, '')).join('\n');
  assert.equal(LFD_COVER_SYSTEM, quoted);
});

test('Jev picks Standoff on yes, Unaware on no or an error', async () => {
  assert.equal((await pickCoverDirection(jevSays(0.8), STORIES, 'x')).direction, 'Standoff');
  assert.equal((await pickCoverDirection(jevSays(0.2), STORIES, 'x')).direction, 'Unaware');
  const failed = await pickCoverDirection(async () => { throw new Error('jev down'); }, STORIES, 'x');
  assert.equal(failed.direction, 'Unaware');
  assert.match(failed.error ?? '', /jev down/);
});

test('the writer request caches the stable prefix (tools, then system) and keeps the stories in the user turn', () => {
  const req = coverWriterRequest('Unaware', STORIES, [{ n: 1, headline: STORIES[0]!.headline, kind: 'person' }]);
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual((req.tools![0] as { cache_control?: unknown }).cache_control, { type: 'ephemeral', ttl: '1h' });
  const system = req.system as Array<{ text: string; cache_control?: unknown }>;
  assert.equal(system.length, 1);
  assert.equal(system[0]!.text, LFD_COVER_SYSTEM);
  assert.deepEqual(system[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  const user = req.messages[0]!.content as string;
  assert.equal(typeof user, 'string', 'the per-post suffix carries no breakpoint');
  assert.match(user, /Direction: Unaware/);
  assert.match(user, /1\. Nvidia sues a rival chip startup \(person\)/);
  assert.doesNotMatch(LFD_COVER_SYSTEM, /Nvidia/);
});

test('fal: the request goes to the GPT Image 2.6 edit queue with the Key header, only the referenced photos as data URIs, and the stored image comes back', async () => {
  const h = await falStub();
  const w = writerStub({ references: [2, 3, 9] });
  const res = await makeLfdAiCover(h.deps({ create: w.create }), INPUT);
  assert.equal(res.fallback, undefined, res.fallback);
  assert.equal(res.direction, 'Standoff');
  assert.deepEqual(res.references, [2, 3], 'an unknown reference number is dropped');
  assert.equal(res.hook.text, '3 things happened in AI you need to know.');
  assert.deepEqual(h.calls.filter((c) => c.url.startsWith('https://img.test/')).map((c) => c.url), ['https://img.test/b.jpg', 'https://img.test/c.jpg']);
  // submit → status (twice) → result → download
  assert.deepEqual(h.calls.filter((c) => !c.url.startsWith('https://img.test/')).map((c) => `${c.method} ${c.url}`), [
    `POST ${QUEUE}`,
    `GET ${QUEUE}/requests/r1/status`,
    `GET ${QUEUE}/requests/r1/status`,
    `GET ${QUEUE}/requests/r1`,
    `GET ${RESULT}`,
  ]);
  for (const c of h.calls.filter((x) => x.url.startsWith('https://queue.fal.run/'))) assert.equal(c.headers.authorization, 'Key test-key', c.url);
  for (const c of h.calls.filter((x) => !x.url.startsWith('https://queue.fal.run/'))) assert.equal(c.headers.authorization, undefined, `no fal key on ${c.url}`);
  const body = h.calls[2]!.body!;
  assert.equal(h.calls[2]!.url, QUEUE);
  assert.equal(body.prompt, '1. Capture: 35mm\n2. Subjects: [1]');
  assert.equal(body.image_size, 'landscape_4_3');
  assert.equal(body.quality, 'medium');
  assert.equal(body.output_format, 'jpeg');
  assert.equal(body.num_images, 1);
  const urls = body.image_urls as string[];
  assert.equal(urls.length, 2, 'only the two referenced photos');
  for (const u of urls) {
    assert.match(u, /^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(u.split(',')[1]!, 'base64')).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(Math.max(meta.width!, meta.height!), 1024, 'downscaled to 1024 on the long side');
  }
  assert.deepEqual(h.uploads.map((u) => [u.path, u.type]), [[INPUT.objectPath, 'image/jpeg']]);
  assert.match(res.image!.url, /^data:image\/jpeg;base64,/);
  assert.equal(res.image!.object, INPUT.objectPath);
  assert.equal(res.imageUsd, FAL_COVER_IMAGE_USD);
  assert.equal(FAL_COVER_IMAGE_USD, 0.1);
  assert.ok(res.costUsd > FAL_COVER_IMAGE_USD, 'writer and Jev spend count too');
});

test('at most 6 references go to fal', async () => {
  const h = await falStub();
  const photos = Array.from({ length: 8 }, (_, i) => ({ url: `https://img.test/${i}.jpg`, headline: `S${i}` }));
  const w = writerStub({ references: [1, 2, 3, 4, 5, 6, 7, 8] });
  const res = await makeLfdAiCover(h.deps({ create: w.create }), { ...INPUT, photos });
  assert.equal(res.fallback, undefined, res.fallback);
  assert.equal((h.calls.find((c) => c.url === QUEUE)!.body!.image_urls as string[]).length, 6);
});

test('a failure at each stage falls back with its reason, keeps the hook, and never throws', async () => {
  const cases: Array<{ name: string; reason: RegExp; image: boolean; over?: () => Partial<LfdAiCoverDeps>; fail?: Fail }> = [
    { name: 'not wired', reason: /not wired/, image: false, over: () => ({ fal: null }) },
    { name: 'cap', reason: /run cap/, image: false, over: () => ({ remainingUsd: () => 0.05 }) },
    { name: 'writer throws', reason: /prompt writer: overloaded/, image: false, over: () => ({ create: writerStub({ fail: new Error('overloaded') }).create }) },
    { name: 'writer no tool', reason: /no write_cover_prompt call/, image: false, over: () => ({ create: writerStub({ noTool: true }).create }) },
    { name: 'photo', reason: /reference photos/, image: false, fail: 'photo' },
    { name: 'submit rejected', reason: /fal: fal rejected the image \(422\): image_urls invalid/, image: false, fail: 'submit' },
    { name: 'FAILED status', reason: /fal: the image failed .*content policy/, image: true, fail: 'failed' },
    { name: 'status http error', reason: /fal: the image failed \(500\)/, image: true, fail: 'status_http' },
    { name: 'timeout', reason: /did not finish/, image: true, fail: 'timeout' },
    { name: 'no images', reason: /fal: fal returned no image/, image: true, fail: 'no_images' },
    { name: 'download', reason: /storing the image: download failed/, image: true, fail: 'download' },
    { name: 'store', reason: /storing the image: bucket down/, image: true, fail: 'store' },
  ];
  for (const c of cases) {
    const h = await falStub({ fail: c.fail });
    const res = await makeLfdAiCover(h.deps(c.over?.() ?? {}), INPUT);
    assert.equal(res.image, undefined, c.name);
    assert.match(res.fallback ?? '', c.reason, `${c.name}: ${res.fallback}`);
    assert.equal(res.hook.text, '3 things happened in AI you need to know.', c.name);
    // The image is charged once the queue accepts it, so a failure after that still counts.
    assert.equal(res.imageUsd, c.image ? FAL_COVER_IMAGE_USD : 0, c.name);
    if (c.name === 'not wired') assert.equal(h.calls.length, 0, 'not wired calls nothing');
  }
});

// SlideTemplate is compiled with the classic JSX runtime (jsx: preserve), as fit-check.ts sets up.
(globalThis as { React?: unknown }).React = React;

const ready = (i: number): Ready => ({
  pick: { key: `k${i}`, url: `https://n.test/${i}`, headline: `H${i}`, sourceName: 'Outlet', lane: 'major', origin: 'feed', refs: [] },
  copy: { setup: '', headline: `Story ${i}`, highlight: '', names: [], body: 'Body.', photo: { query: '', kind: 'scene', alts: [] } },
  photo: { src: `https://p.test/${i}.jpg`, credit: 'C', kind: 'scene' },
} as unknown as Ready);

test('buildPost: the hook is on the cover and in the alt text; with an image the cover is LfdCoverSlide’s AI cover', () => {
  const hook = { text: 'Everyone in AI is talking about this. Are you?', accent: 'Are you?' };
  const plain = buildPost([ready(1), ready(2)], new Date(0), null, { coverHook: hook });
  assert.equal(plain.slides[0]!.altText, `${hook.text} Trending in AI.`);
  assert.deepEqual(plain.slides[0]!.lfdCover!.hook, hook);
  assert.equal(plain.slides[0]!.lfdCover!.image, undefined);
  const plainHtml = renderToStaticMarkup(React.createElement(SlideTemplate, { post: plain, position: 0 }));
  assert.doesNotMatch(plainHtml, /lfd-cover--ai/);
  assert.match(plainHtml, /lfd-mosaic/);

  const ai = buildPost([ready(1), ready(2)], new Date(0), null, { coverHook: hook, coverImage: { url: 'data:image/jpeg;base64,AAAA' } });
  assert.deepEqual(ai.slides[0]!.lfdCover!.image, { url: 'data:image/jpeg;base64,AAAA' });
  const html = renderToStaticMarkup(React.createElement(SlideTemplate, { post: ai, position: 0 }));
  assert.match(html, /lfd-cover--ai/);
  assert.match(html, /Are you\?/);
});

test('the hub shows the cover fallback reason among the review notes', async () => {
  const { lfdReviewNotes } = await import('@/lib/social-hub/adapters/last-few-days');
  const row = { post_id: 'p', run_id: 'r', slug: 's', ny_date: '2026-11-24', status: 'review', caption: null, created_at: '', published_at: null, render: null, stories: [], slide_count: 0, has_slide_objects: false, fit_problems: [], render_problems: [], short: false };
  assert.deepEqual(lfdReviewNotes({ ...row, cover_fallback: 'fal: the image failed (500)' }), ['Cover: no AI image (fal: the image failed (500)); today\'s cover was used.']);
  assert.deepEqual(lfdReviewNotes({ ...row, cover_fallback: null }), []);
});
