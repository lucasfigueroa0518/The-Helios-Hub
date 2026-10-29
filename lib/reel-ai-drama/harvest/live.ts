import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import type { Queryable } from '@/lib/explainers/db';
import { streamingCreate } from '@/lib/reel-ai-drama/reporting/llm';

import { liveDetectFaces } from './faces';
import { playwrightScreenshot } from './screens';
import { openAiSketch } from './sketch';
import type { HarvestDeps, RenderMap, Upscale, VideoFrames } from './types';

/**
 * The live harvest dependencies (never used by tests). Optional tools are found on PATH; a missing one
 * becomes null, and its adapter skips with a note (CONTRACT § Secrets: never an error).
 */

const run = promisify(execFile);

export function onPath(cmd: string): boolean {
  return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
}

export const RENDER_MAP_MODULE = path.join('explainers', 'reel-ai-drama', 'kit', 'maps', 'render-map.mjs');

/** B4's renderer, loaded at run time so nothing here depends on the kit at build time. */
export async function loadRenderMap(root: string = process.cwd()): Promise<RenderMap | null> {
  const file = path.join(root, RENDER_MAP_MODULE);
  if (!fs.existsSync(file)) return null;
  const mod = (await import(pathToFileURL(file).href)) as { renderMap?: RenderMap };
  return mod.renderMap ?? null;
}

/** The first three minutes of an official video, one frame every 12 seconds (yt-dlp + ffmpeg). */
export const ytDlpFrames: VideoFrames = async (url, { outDir, max }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const id = (url.match(/[\w-]{11}/g) ?? ['video']).pop()!;
  const { stdout } = await run('yt-dlp', ['--skip-download', '--no-warnings', '--print', '%(channel)s\t%(title)s\t%(upload_date)s', url], { timeout: 60_000 });
  const [channel = '', title = '', upload = ''] = stdout.trim().split('\t');
  const video = path.join(outDir, `v-${id}.mp4`);
  await run('yt-dlp', ['-f', 'bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b', '--download-sections', '*0-180', '--no-warnings', '-o', video, url], { timeout: 300_000 });
  const pattern = path.join(outDir, `v-${id}-%02d.jpg`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', 'fps=1/12', '-frames:v', String(max), '-q:v', '2', pattern], { timeout: 120_000 });
  fs.rmSync(video, { force: true });
  const frames = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(`v-${id}-`) && f.endsWith('.jpg'))
    .sort()
    .map((f, i) => ({ file: path.join(outDir, f), at: i * 12 }));
  const date = /^\d{8}$/.test(upload) ? `${upload.slice(0, 4)}-${upload.slice(4, 6)}-${upload.slice(6, 8)}` : null;
  return { frames, channel, title, date };
};

/** The Real-ESRGAN wrapper: on PATH, else Homebrew's install (a server's PATH often lacks /opt/homebrew/bin). */
export const REALESRGAN = 'realesrgan-ncnn-vulkan';
export const REALESRGAN_BREW = '/opt/homebrew/bin/realesrgan-ncnn-vulkan';

export function findUpscaler(): string | null {
  if (onPath(REALESRGAN)) return REALESRGAN;
  return fs.existsSync(REALESRGAN_BREW) ? REALESRGAN_BREW : null;
}

/** The model scale for a requested factor: the wrapper runs ×2 or ×4 (it adds the model flags itself). */
export const modelScale = (scale: number): 2 | 4 => (scale <= 2 ? 2 : 4);

/** Real-ESRGAN at ×2 or ×4, resized to the exact factor asked for (MD-16: sparingly; the harvest decides when). */
export function realEsrgan(bin: string = REALESRGAN): Upscale {
  return async (input, output, scale) => {
    const model = modelScale(scale);
    const tmp = `${output}.x${model}.png`;
    await run(bin, ['-i', input, '-o', tmp, '-s', String(model)], { timeout: 180_000 });
    if (scale === model) {
      fs.renameSync(tmp, output);
      return;
    }
    const m = await sharp(input).metadata();
    await sharp(tmp).resize(Math.round((m.width ?? 0) * scale)).png().toFile(output);
    fs.rmSync(tmp, { force: true });
  };
}

export async function liveHarvestDeps(
  db: Queryable,
  opts: { anthropic: Anthropic | null; loadPrompt: HarvestDeps['loadPrompt']; env?: NodeJS.ProcessEnv; root?: string },
): Promise<{ deps: HarvestDeps; notes: string[]; close: () => Promise<void> }> {
  const env = opts.env ?? process.env;
  const notes: string[] = [];
  const screens = playwrightScreenshot();
  const renderMap = await loadRenderMap(opts.root).catch((error) => {
    notes.push(`map renderer failed to load: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (!renderMap) notes.push(`maps: ${RENDER_MAP_MODULE} not available`);
  const video = onPath('yt-dlp') && onPath('ffmpeg');
  if (!video) notes.push('video frames: yt-dlp or ffmpeg not on PATH');
  const upscaler = findUpscaler();
  if (!upscaler) notes.push('upscaling: realesrgan-ncnn-vulkan not found');
  if (!env.SERPER_API_KEY) notes.push('serper: SERPER_API_KEY not set');
  if (!env.OPENAI_API_KEY) notes.push('sketches: OPENAI_API_KEY not set; cast with no clean photo get no sketch');
  return {
    deps: {
      db,
      http: fetch,
      create: opts.anthropic ? streamingCreate(opts.anthropic) : null,
      loadPrompt: opts.loadPrompt,
      serperKey: env.SERPER_API_KEY ?? null,
      screenshot: screens.screenshot,
      renderMap,
      videoFrames: video ? ytDlpFrames : null,
      upscale: upscaler ? realEsrgan(upscaler) : null,
      detectFaces: liveDetectFaces,
      sketch: env.OPENAI_API_KEY ? openAiSketch(env.OPENAI_API_KEY) : null,
      root: opts.root,
    },
    notes,
    close: screens.close,
  };
}
