/**
 * The LFD AI cover (lib/lfd/cover): hook rotation, the Jev direction, the cached writer request, the Higgsfield
 * flow and every fallback. Jev, the writer and Higgsfield are stubs; no network, no spend (CLAUDE.md Rule 1).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import { HIGGSFIELD_IMAGE_USD, makeLfdAiCover, pickCoverDirection, type LfdAiCoverDeps, type LfdAiCoverInput } from '@/lib/lfd/cover';
import { toolJson } from '@/lib/lfd/cover/higgsfield-image';
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

type Fail = 'media_upload' | 'put' | 'media_confirm' | 'generate_image' | 'jobs_wait' | 'timeout' | 'download' | 'store' | 'photo';

async function higgsStub(o: { fail?: Fail; asText?: boolean } = {}) {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 50, b: 0 } } }).png().toBuffer();
  const tools: Array<{ name: string; args: Record<string, unknown> }> = [];
  const puts: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetched: string[] = [];
  const uploads: Array<{ path: string; type?: string; bytes: number }> = [];
  let waits = 0;
  const wrap = (v: unknown) => (o.asText ? { content: [{ type: 'text', text: JSON.stringify(v) }] } : v);
  const callTool = async (name: string, args: Record<string, unknown>) => {
    tools.push({ name, args });
    if (o.fail === name) throw new Error(`${name} exploded`);
    if (name === 'media_upload') {
      const files = args.files as Array<{ filename: string }>;
      return wrap({ uploads: files.map((f, i) => ({ upload_url: `https://up.test/${i}/${f.filename}`, media_id: `m${i}`, url: `https://cdn.test/m${i}`, method: 'PUT', content_type: 'image/jpeg' })) });
    }
    if (name === 'media_confirm') return wrap({ results: (args.media_ids as string[]).map((media_id) => ({ media_id, status: 'uploaded' })) });
    if (name === 'generate_image') return wrap({ results: [{ id: 'job-1', status: 'pending' }] });
    if (name === 'jobs_wait') {
      waits += 1;
      if (o.fail === 'timeout' || waits < 2) return wrap({ results: [{ job_id: 'job-1', status: 'in_progress' }] });
      return wrap({ results: [{ job_id: 'job-1', status: 'completed', result_url: 'https://cdn.test/result.png' }] });
    }
    throw new Error(`unexpected tool ${name}`);
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push({ url, headers: init.headers as Record<string, string> });
      return new Response(null, { status: o.fail === 'put' ? 400 : 200 });
    }
    fetched.push(url);
    if (url === 'https://cdn.test/result.png') return o.fail === 'download' ? new Response('no', { status: 404 }) : new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    if (o.fail === 'photo') return new Response('gone', { status: 404 });
    return new Response(new Uint8Array(Buffer.from('jpegbytes')), { headers: { 'content-type': 'image/jpeg' } });
  };
  let t = 0;
  const deps = (over: Partial<LfdAiCoverDeps> = {}): LfdAiCoverDeps => ({
    jev: jevSays(0.9),
    create: writerStub().create,
    higgsfield: { callTool },
    fetch: fetchImpl,
    upload: async (p, b, type) => {
      if (o.fail === 'store') throw new Error('bucket down');
      uploads.push({ path: p, type, bytes: b.length });
    },
    remainingUsd: () => 1,
    wait: { now: () => (t += 10_000), sleep: async () => {}, deadlineMs: 60_000 },
    ...over,
  });
  return { deps, tools, puts, fetched, uploads };
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

test('only the referenced photos go up, each PUT carries If-None-Match: *, and the stored image comes back', async () => {
  const h = await higgsStub({ asText: true });
  const w = writerStub({ references: [2, 3, 9] });
  const res = await makeLfdAiCover(h.deps({ create: w.create }), INPUT);
  assert.equal(res.fallback, undefined, res.fallback);
  assert.equal(res.direction, 'Standoff');
  assert.deepEqual(res.references, [2, 3], 'an unknown reference number is dropped');
  assert.equal(res.hook.text, '3 things happened in AI you need to know.');
  assert.deepEqual(h.fetched.filter((u) => u.startsWith('https://img.test/')), ['https://img.test/b.jpg', 'https://img.test/c.jpg']);
  assert.deepEqual((h.tools[0]!.args.files as Array<{ filename: string }>).map((f) => f.filename), ['lfd-ref-2.jpg', 'lfd-ref-3.jpg']);
  assert.equal(h.puts.length, 2);
  for (const p of h.puts) {
    assert.equal(p.headers['If-None-Match'], '*');
    assert.equal(p.headers['Content-Type'], 'image/jpeg');
  }
  assert.deepEqual(h.tools.map((t) => t.name), ['media_upload', 'media_confirm', 'generate_image', 'jobs_wait', 'jobs_wait']);
  const params = h.tools[2]!.args.params as Record<string, unknown>;
  assert.equal(params.model, 'gpt_image_2_6');
  assert.equal(params.aspect_ratio, '4:3');
  assert.deepEqual(params.medias, [{ value: 'm0', role: 'image_references' }, { value: 'm1', role: 'image_references' }]);
  assert.deepEqual(h.uploads.map((u) => [u.path, u.type]), [[INPUT.objectPath, 'image/jpeg']]);
  assert.match(res.image!.url, /^data:image\/jpeg;base64,/);
  assert.equal(res.image!.object, INPUT.objectPath);
  assert.equal(res.imageUsd, HIGGSFIELD_IMAGE_USD);
  assert.ok(res.costUsd > HIGGSFIELD_IMAGE_USD, 'writer and Jev spend count too');
});

test('a failure at each stage falls back with its reason, keeps the hook, and never throws', async () => {
  const cases: Array<{ name: string; reason: RegExp; image: boolean; over?: (h: Awaited<ReturnType<typeof higgsStub>>) => Partial<LfdAiCoverDeps>; fail?: Fail }> = [
    { name: 'not wired', reason: /not wired/, image: false, over: () => ({ higgsfield: null }) },
    { name: 'cap', reason: /run cap/, image: false, over: () => ({ remainingUsd: () => 0.05 }) },
    { name: 'writer throws', reason: /prompt writer: overloaded/, image: false, over: () => ({ create: writerStub({ fail: new Error('overloaded') }).create }) },
    { name: 'writer no tool', reason: /no write_cover_prompt call/, image: false, over: () => ({ create: writerStub({ noTool: true }).create }) },
    { name: 'photo', reason: /reference photos/, image: false, fail: 'photo' },
    { name: 'media_upload', reason: /Higgsfield: media_upload exploded/, image: false, fail: 'media_upload' },
    { name: 'put', reason: /PUT failed \(400\)/, image: false, fail: 'put' },
    { name: 'media_confirm', reason: /media_confirm exploded/, image: false, fail: 'media_confirm' },
    { name: 'generate_image', reason: /generate_image exploded/, image: false, fail: 'generate_image' },
    { name: 'jobs_wait', reason: /jobs_wait exploded/, image: true, fail: 'jobs_wait' },
    { name: 'timeout', reason: /did not finish/, image: true, fail: 'timeout' },
    { name: 'download', reason: /storing the image: download failed/, image: true, fail: 'download' },
    { name: 'store', reason: /storing the image: bucket down/, image: true, fail: 'store' },
  ];
  for (const c of cases) {
    const h = await higgsStub({ fail: c.fail });
    const res = await makeLfdAiCover(h.deps(c.over?.(h) ?? {}), INPUT);
    assert.equal(res.image, undefined, c.name);
    assert.match(res.fallback ?? '', c.reason, `${c.name}: ${res.fallback}`);
    assert.equal(res.hook.text, '3 things happened in AI you need to know.', c.name);
    // The image is charged once the job is started, so a failure after that still counts.
    assert.equal(res.imageUsd, c.image ? HIGGSFIELD_IMAGE_USD : 0, c.name);
  }
});

test('an MCP result as text content or structuredContent parses; an isError result throws', () => {
  assert.deepEqual(toolJson({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
  assert.deepEqual(toolJson({ structuredContent: { b: 2 }, content: [] }), { b: 2 });
  assert.throws(() => toolJson({ isError: true, content: [{ type: 'text', text: 'bad args' }] }), /bad args/);
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
  assert.deepEqual(lfdReviewNotes({ ...row, cover_fallback: 'Higgsfield: login rejected' }), ['Cover: no AI image (Higgsfield: login rejected); today\'s cover was used.']);
  assert.deepEqual(lfdReviewNotes({ ...row, cover_fallback: null }), []);
});
