/**
 * Stubs for Morning Download's locked news chain (BuildDeps.news, WIRING-CONTRACT Phase 2 Owner D) and its video
 * finder, scripted per story headline: how the rerank grades it and what media it has. Nothing reaches the network.
 * Shared by tests/stories-md-chain.test.ts and the MD build tests that run through the chain.
 */
import os from 'node:os';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import type { NewsChainDeps } from '@/lib/stories/build/common';
import type { StoryVideoDeps } from '@/lib/stories/video';

/** One story's script. Rank follows the order of the scripts (first = best). */
export type NewsScript = { headline: string; top: boolean; photo: 'good' | 'usable' | 'none'; video?: 'golden' | 'good'; duplicateOf?: string };

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const msg = (name: string, input: unknown): Anthropic.Message => ({
  id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: 'tool_use', id: `t_${name}`, name, input }],
} as unknown as Anthropic.Message);

const firstText = (p: Record<string, unknown>) => {
  const c0 = (p.messages as Array<{ content: unknown }>)[0]!.content;
  return Array.isArray(c0) ? c0.map((b: { text?: string }) => b.text ?? '').join('') : String(c0);
};

/** The writer's material (lib/news-writer: key, source_headline, we_already_said?, text) from its first call. */
export const writerMaterial = (p: Record<string, unknown>) =>
  JSON.parse(/<material>\n([\s\S]*)\n<\/material>/.exec(firstText(p))![1]!) as Array<{ key: string; source_headline: string; we_already_said?: string; text: string }>;

export async function newsStubs(scripts: NewsScript[]) {
  const byHeadline = new Map(scripts.map((s) => [s.headline, s]));
  const scriptOf = (h: string) => {
    const s = byHeadline.get(h);
    if (!s) throw new Error(`no news script for "${h}"`);
    return s;
  };
  const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 90, g: 120, b: 160 } } }).png().toBuffer();
  const calls = {
    rerank: [] as Array<Record<string, unknown>>,
    writer: [] as Array<Record<string, unknown>>,
    readPage: [] as string[],
    uploads: [] as string[],
    videoFound: [] as string[],
    videoStored: [] as string[],
  };
  const create = async (p: Record<string, unknown>): Promise<Anthropic.Message> => {
    const tools = p.tools as Array<{ name: string }>;
    const messages = p.messages as Array<{ content: unknown }>;
    const first = firstText(p);
    switch (tools[0]!.name) {
      case 'grade_stories': {
        calls.rerank.push(p);
        const ids = [...first.matchAll(/<story id="(s\d+)">\n<headline>(.*?)<\/headline>/g)].map((m) => ({ id: m[1]!, h: m[2]! }));
        const idOf = (h?: string) => ids.find((x) => x.h === h)?.id ?? null;
        return msg('grade_stories', {
          grades: ids.map(({ id, h }) => {
            const s = scriptOf(h);
            const at = scripts.indexOf(s);
            return { id, cool: 9 - at * 0.5, value: 9 - at * 0.5, duplicate_of: idOf(s.duplicateOf), top_tier: s.top, crowds: null, angle: `editor angle for ${h}` };
          }),
        });
      }
      case 'photo_brief': {
        const h = /<headline>(.*?)<\/headline>/.exec(first)![1]!;
        return msg('photo_brief', { kind: 'person', subject: h, good_if: 'it shows the subject' });
      }
      case 'real_check':
        return msg('real_check', { blatantly_ai: false });
      case 'check_facts':
        calls.writer.push(p);
        return msg('check_facts', { claims: [] });
      case 'propose_angles': {
        calls.writer.push(p);
        const stories = writerMaterial(p);
        if (messages.length === 1) return msg('propose_angles', { angles: stories.map((s) => ({ key: s.key, angle: 'mine' })) });
        return msg('write_stories', { stories: stories.map((s) => ({ key: s.key, chosen: 'editor', angle: 'editor', headline: s.source_headline, body: 'Here is why it matters to you today.' })) });
      }
      default:
        throw new Error(`unexpected tool ${tools[0]!.name}`);
    }
  };
  const verdictAnswers = (tier: NewsScript['photo']) => ({
    logo: { noul: 0 }, overlay: { noul: 0 }, thumbnail: { noul: 0 },
    specific: { noul: tier === 'good' ? 0.9 : 0.1 }, related: { noul: tier === 'none' ? 0.1 : 0.9 },
    clarity: { probabilities: { [tier === 'good' ? '8' : '6']: 1 } },
  });
  const news: NewsChainDeps = {
    create,
    jevAsk: async () => ({ answers: new Proxy({}, { get: () => ({ noul: 0.5, choice: '5', probabilities: { '5': 1 } }) }) as never, usage: { input_tokens: 100, output_tokens: 1 }, model: 'jev-stub' }),
    photo: {
      jev: {
        async systemOne(a: { state: { context?: string }; model?: string }) {
          if (a.model === 'jev-preview') return { answers: { essential: { box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 } }, text: { noul: 0 } }, usage: { input_tokens: 10, output_tokens: 1 } };
          const h = /Story headline: (.*)\n/.exec(a.state.context ?? '')![1]!;
          return { answers: verdictAnswers(scriptOf(h).photo), usage: { input_tokens: 10, output_tokens: 1 } };
        },
      },
      readPage: async (url) => { calls.readPage.push(url); return { images: [{ src: `${url}/photo.jpg`, credit: 'Photo: Wire' }] }; },
      serper: null,
      fetchImage: async () => png,
    },
    upscaler: null,
    tmpDir: os.tmpdir(),
    storage: { upload: async (p) => void calls.uploads.push(p), sign: async (p) => `https://store.test/${p}` },
  };
  const video: StoryVideoDeps = {
    async find(s) {
      calls.videoFound.push(s.headline);
      const tier = scriptOf(s.headline).video ?? 'none';
      return { tier, clip: tier === 'none' ? null : { file: '/x.mp4', poster: '/x.jpg', sourceUrl: `https://video.test/${slug(s.headline)}`, title: s.headline, channel: 'Ch', site: 'youtube', start: 0, len: 6, muted: false, lowRes: false }, brief: null, candidates: 1, trace: [], costUsd: 0 };
    },
    async store(clip, tier, key) {
      calls.videoStored.push(key);
      return { video: { path: 'sets/x/video/a.mp4', seconds: 6, tier, sourceUrl: clip.sourceUrl, fit: 'crop' }, poster: { src: `https://poster.test/${slug(clip.title)}.jpg`, credit: 'Video: Ch', kind: 'scene' }, usd: 0 };
    },
    spent: () => ({ anthropic: 0, jev: 0, search: 0 }),
  };
  return { news, video, calls };
}
