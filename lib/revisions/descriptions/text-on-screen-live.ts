/**
 * Live deps for the text on screen revision description (text-on-screen.ts). Every service import is
 * lazy, so importing the registry loads no storage client, text engine, ffmpeg wrapper or model client.
 *
 * Ceilings: the scene and motion writers catch errors from their own Claude call (they fail open), so
 * a CeilingReached thrown inside it would be swallowed. Every paid call goes through meteredCreate (or
 * an explicit stopped check), which refuses BEFORE paying once the meter has stopped, and each dep
 * re-throws the stored error when it returns. Kling is charged by the description before it is called.
 *
 * Costs also land in the reels ledger (reels.cost_events) as the pipeline's do: reel-scene, reel-motion
 * (anthropic) and reel-background (openai). Kling is counted from video_jobs, as everywhere in reels.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { PlateDeps } from '../text-on-screen-plate';

import type { Metered } from './carousels';
import type { TextOnScreenDeps } from './text-on-screen';

/** lib/reels/sfx/manifest.ts FINAL_DIR: the finished hook sounds ship with the worker. */
const SFX_DIR = path.join(process.cwd(), 'lib', 'reels', 'sfx', 'final');

type Message = import('@anthropic-ai/sdk').default.Message;
type Params = import('@anthropic-ai/sdk').default.MessageCreateParamsNonStreaming;

/**
 * An Anthropic client whose create is metered at the reels price for `modelId`, records the call in
 * the reels ledger, and adds the person's note as its own labelled block at the end of the user turn
 * (after the cached system prefix and tools, so the cache still hits).
 */
async function meteredClient(m: Metered, modelId: string, component: string, note: string | null) {
  const [{ newAnthropic }, { priceAnthropicMessages }, { meteredCreate }, { recordCost }] = await Promise.all([
    import('@/lib/anthropic-client'),
    import('@/lib/anthropic-pricing'),
    import('./carousels-live'),
    import('@/lib/reels/repository'),
  ]);
  const client = newAnthropic();
  const priced = (res: Message) => priceAnthropicMessages([res], { modelId, fallbackCacheTtl: '5m' });
  const create = meteredCreate(
    async (params: Params) => {
      const res = (await client.messages.create(withNote(params, note))) as Message;
      const p = priced(res);
      const input = p.uncached_input_tokens + p.cache_read_input_tokens + p['cache_creation.ephemeral_5m_input_tokens'] + p['cache_creation.ephemeral_1h_input_tokens'];
      await recordCost({ runId: null, vendor: 'anthropic', component, inputTokens: input, outputTokens: p.output_tokens, usd: Number(p.costUsd) }).catch(() => undefined);
      return res;
    },
    m,
    (res) => Number(priced(res).costUsd),
  );
  return { messages: { create: (params: Params) => create(params) } };
}

/** The person's note as its own block at the end of the last user turn. */
function withNote(params: Params, note: string | null): Params {
  if (!note) return params;
  const messages = [...params.messages];
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return params;
  const block = { type: 'text' as const, text: note };
  const content = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }, block] : [...last.content, block];
  messages[messages.length - 1] = { ...last, content };
  return { ...params, messages };
}

const plate: PlateDeps = {
  probeVideo: async (p) => (await import('@/lib/reels/visual/overlay')).probeVideo(p),
  renderTextPlate: async (copy, w, h, profile, cue) => (await import('@/lib/reels/visual/engine')).renderTextPlate(copy, w, h, profile, cue ?? null),
  overlayPlate: async (v, p, out, hook) => (await import('@/lib/reels/visual/overlay')).overlayPlate(v, p, out, hook),
  overlayStillPlate: async (v, p, out) => (await import('@/lib/reels/visual/overlay')).overlayStillPlate(v, p, out),
  muxHookSfx: async (v, sfx, out) => (await import('@/lib/reels/visual/overlay')).muxHookSfx(v, sfx, out),
  writeFile: (p, body) => writeFile(p, body),
  sfxDir: SFX_DIR,
};

export const liveTextOnScreenDeps: TextOnScreenDeps = {
  async readObject(key) {
    const { downloadFrameObject } = await import('@/lib/reels/visual/storage');
    return downloadFrameObject(key);
  },

  async storeFile(key, localPath, contentType) {
    const { uploadFrameObject } = await import('@/lib/reels/visual/storage');
    await uploadFrameObject(key, await readFile(localPath), contentType);
  },

  async storeBuffer(key, body, contentType) {
    const { uploadFrameObject } = await import('@/lib/reels/visual/storage');
    await uploadFrameObject(key, body, contentType);
  },

  async workDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-reel-revision-'));
    return { dir, done: () => rm(dir, { recursive: true, force: true }) };
  },

  writeLocal: (p, body) => writeFile(p, body),

  async renderText(png, copy, profile, cue) {
    const { renderTextPng } = await import('@/lib/reels/visual/engine');
    const out = await renderTextPng(png, copy, profile, cue);
    return out.ok ? { ok: true, png: out.rendered.png, lines: out.rendered.lines, warnings: out.rendered.warnings } : { ok: false, error: out.error };
  },

  async checkBackground(png, profile) {
    const { checkBackgroundPng } = await import('@/lib/reels/visual/engine');
    return checkBackgroundPng(png, profile);
  },

  plate,

  async readClip(key, toPath) {
    const { downloadFrameObject } = await import('@/lib/reels/visual/storage');
    try {
      await writeFile(toPath, await downloadFrameObject(key));
      return true;
    } catch {
      return false;
    }
  },

  /** Fal's stored result for the clip's request. Retention of old results is not guaranteed: false when gone. */
  async falClip(requestId, toPath) {
    const key = process.env.FAL_API_KEY?.trim();
    if (!key) return false;
    try {
      const { FAL_KLING_I2V } = await import('@/lib/reels/visual/kling/api');
      const res = await fetch(`https://queue.fal.run/${FAL_KLING_I2V}/requests/${encodeURIComponent(requestId)}`, {
        headers: { authorization: `Key ${key}` },
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => null)) as { video?: { url?: string } } | null;
      const url = body?.video?.url;
      if (!res.ok || !url) return false;
      const video = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!video.ok) return false;
      await writeFile(toPath, Buffer.from(await video.arrayBuffer()));
      return true;
    } catch {
      return false;
    }
  },

  async writeScene({ story, category, onScreenText, recentScenes, profile, hint }, m) {
    const [{ writeScene }, { VISUAL_SCENE_MODEL }] = await Promise.all([import('@/lib/reels/visual/scene-writer'), import('@/lib/reels/config')]);
    const client = await meteredClient(m, VISUAL_SCENE_MODEL, 'reel-scene', hint ? `A PERSON ASKED FOR THIS BACKGROUND\n${hint}` : null);
    const out = await writeScene(client, { story, category, onScreenText, recentScenes, profile });
    if (m.stopped()) m.halt();
    if (!out.scene && out.error) throw new Error(out.error);
    return out.scene;
  },

  async generateBackground(prompt, m) {
    const [{ generateBackground }, { recordCost }] = await Promise.all([import('@/lib/reels/visual/image'), import('@/lib/reels/repository')]);
    if (m.stopped()) m.halt();
    const out = await generateBackground(prompt);
    await recordCost({
      runId: null,
      vendor: 'openai',
      component: 'reel-background',
      inputTokens: out.usage.textInputTokens + out.usage.imageInputTokens,
      outputTokens: out.usage.imageOutputTokens,
      usd: out.usage.usd,
    }).catch(() => undefined);
    m.spend(out.usage.usd);
    return { png: out.png };
  },

  async writeMotion({ png, scene, story, onScreenCopy, profile, hint }, m) {
    const [{ writeMotion }, { MOTION_MODEL }] = await Promise.all([import('@/lib/reels/visual/motion-writer'), import('@/lib/reels/config')]);
    const client = await meteredClient(m, MOTION_MODEL, 'reel-motion', hint ? `A PERSON ASKED FOR THIS MOVEMENT\n${hint}` : null);
    const out = await writeMotion(client, { png, scene, story, onScreenCopy, profile });
    if (m.stopped()) m.halt();
    if (!out.prompt) throw new Error(out.error ?? 'The motion writer returned no prompt.');
    return out.prompt;
  },

  async kling({ prompt, backgroundKey, profile }, m) {
    const [{ generateKlingClip, ORANGE_HAND_NEGATIVE }, { signFrameObject }] = await Promise.all([import('@/lib/reels/visual/kling/api'), import('@/lib/reels/visual/storage')]);
    if (m.stopped()) m.halt();
    const imageUrl = await signFrameObject(backgroundKey);
    // One attempt (the pipeline retries once; a revision reports the failure instead of paying twice).
    return generateKlingClip({ prompt, imageUrl, negativePrompt: profile === 'orange' || profile === 'green' ? ORANGE_HAND_NEGATIVE : undefined });
  },

  async unschedule(_q, postIdeaId) {
    const { unscheduleIdea } = await import('@/lib/reels/publish/schedule');
    return unscheduleIdea(postIdeaId);
  },

  async withdrawItem(q, itemId) {
    const { unscheduleItem } = await import('@/lib/social/overnight/schedule');
    return unscheduleItem(q, itemId);
  },
};
