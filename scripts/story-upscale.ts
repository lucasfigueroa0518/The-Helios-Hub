/**
 * Upscaling for the Morning Download story frame, 2026-11-23. Lucas: "I want all the photos to be CLEAN and SHARP.
 * But upscaling should only happen when it needs to."
 *
 * Code measures how far the shown part of the photo is stretched to fill the frame (storyStretch) and upscales when it
 * is stretched 1.25× or more (needsUpscale). The upscaler is the local Real-ESRGAN that AI Drama already uses (free),
 * at native input, with its garble check; a garbled or failed upscale falls back to the plain frame.
 *
 *   npx tsx scripts/story-upscale.ts fetch            originals of the posted + photo-test photos (free)
 *   npx tsx scripts/story-upscale.ts frames --yes     Jev fit + plain frames + 1:1 patches (~$0.01)
 *   npx tsx scripts/story-upscale.ts ask jev|haiku --yes   is the plain patch soft?
 *   npx tsx scripts/story-upscale.ts upscale          Real-ESRGAN frames + blind pairs for review (free)
 */
import fs from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { box, image, noul, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { findUpscaler, realEsrgan } from '@/lib/reel-ai-drama/harvest/live';
import { upscaleDiff, UPSCALE_MAX_BLOCK_DIFF, UPSCALE_MAX_MEAN_DIFF } from '@/lib/reel-ai-drama/harvest/media';
import { jevCostUsd } from '@/lib/social/jev/client';

import { decideFit, ESSENTIAL, HAS_TEXT, renderBand, renderStory, storyStretch, type BandPlan, type Box, type FitDecision, type Sharpen } from './story-crop';

/**
 * Shipped rule (D22, Lucas 2026-11-23: "ship that upscaler"): upscale exactly when the shown region is stretched this
 * far or more. Below it the source already has the pixels, and upscaling hurt more than it helped. No model is asked:
 * neither Jev's nor Haiku's "looks soft" answer predicted when it helps.
 */
export const UPSCALE_FROM_STRETCH = 1.25;
/** Lab only: the soft question tested and dropped. */
export const SOFT_QUESTION = 'Looking at this picture at full size, does it look soft, blurry, pixelated or blocky from compression, rather than clean and sharp?';
export const PATCH = 720;

/** Pure: should this frame be upscaled? */
export function needsUpscale(stretch: number): boolean {
  return stretch >= UPSCALE_FROM_STRETCH;
}

/**
 * Real-ESRGAN at ×4 on the region at its native size; the caller resizes the result to the target. (Reducing it
 * first, the first variant, threw detail away: UPSCALE_V=1 keeps it for the lab record.)
 */
export function esrganSharpen(bin: string, tmpDir: string): Sharpen {
  const up = realEsrgan(bin);
  return async (region, tw, th) => {
    const m = await sharp(region).metadata();
    const k = process.env.UPSCALE_V === '1' ? Math.min(1, tw / 2 / m.width!, th / 2 / m.height!) : 1;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inp = path.join(tmpDir, `${id}.png`), out = path.join(tmpDir, `${id}.up.png`);
    await sharp(region).resize(Math.max(1, Math.round(m.width! * k)), Math.max(1, Math.round(m.height! * k)), { kernel: 'lanczos3' }).png().toFile(inp);
    try {
      await up(inp, out, 4);
      const diff = await upscaleDiff(inp, out);
      if (diff.mean > UPSCALE_MAX_MEAN_DIFF || diff.worstBlock > UPSCALE_MAX_BLOCK_DIFF) throw new Error(`garbled upscale ${diff.mean.toFixed(3)}`);
      return fs.readFileSync(out);
    } finally { for (const f of [inp, out]) fs.rmSync(f, { force: true }); }
  };
}

/**
 * The story frame as shipped: vertical fit (D20) plus upscaling when the photo is stretched (D22). A missing upscaler or a
 * failed/garbled upscale never blocks the post; it falls back to the plain frame and says so.
 */
export async function storyFrame(input: Buffer, fit: FitDecision, tmpDir: string, bin: string | null = findUpscaler()): Promise<{ frame: Buffer; upscaled: boolean; note?: string }> {
  const m = await sharp(input).metadata();
  if (!needsUpscale(storyStretch(m.width!, m.height!, fit).stretch)) return { frame: await renderStory(input, fit), upscaled: false };
  if (!bin) return { frame: await renderStory(input, fit), upscaled: false, note: 'needs upscaling, but realesrgan-ncnn-vulkan is not installed' };
  try {
    return { frame: await renderStory(input, fit, esrganSharpen(bin, tmpDir)), upscaled: true };
  } catch (e) {
    return { frame: await renderStory(input, fit), upscaled: false, note: `upscale failed, plain frame used: ${e instanceof Error ? e.message : e}` };
  }
}

/** The band photo as shipped: band fit plus upscaling when the photo is stretched (D22); never blocks the post. */
export async function bandFrame(input: Buffer, plan: BandPlan, tmpDir: string, bin: string | null = findUpscaler()): Promise<{ frame: Buffer; upscaled: boolean; note?: string }> {
  if (!needsUpscale(plan.scale)) return { frame: await renderBand(input, plan), upscaled: false };
  if (!bin) return { frame: await renderBand(input, plan), upscaled: false, note: 'needs upscaling, but realesrgan-ncnn-vulkan is not installed' };
  try {
    return { frame: await renderBand(input, plan, esrganSharpen(bin, tmpDir)), upscaled: true };
  } catch (e) {
    return { frame: await renderBand(input, plan), upscaled: false, note: `upscale failed, plain frame used: ${e instanceof Error ? e.message : e}` };
  }
}

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab');
const DIR = path.join(LAB, 'upscale');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
type Item = { id: string; src: string; w: number; h: number; fit?: FitDecision; stretch?: number };
const items = (): Item[] => JSON.parse(fs.readFileSync(path.join(DIR, 'items.json'), 'utf8'));
const save = (x: Item[]) => fs.writeFileSync(path.join(DIR, 'items.json'), JSON.stringify(x, null, 1));

function ledger(cost: number, spec: string) {
  const f = path.join(LAB, 'tourney/ledger.json');
  const l = JSON.parse(fs.readFileSync(f, 'utf8'));
  l.spent += cost; l.runs.push({ spec, cost, at: new Date().toISOString() });
  fs.writeFileSync(f, JSON.stringify(l, null, 1));
}

async function fetchAll() {
  fs.mkdirSync(path.join(DIR, 'orig'), { recursive: true });
  const srcs: string[] = [];
  const final = JSON.parse(fs.readFileSync(path.join(LAB, 'md-trial/final.json'), 'utf8'));
  for (const d of Object.values(final.days) as { posts: { photo: { src: string } | null }[] }[]) for (const p of d.posts) if (p.photo?.src) srcs.push(p.photo.src);
  for (const i of JSON.parse(fs.readFileSync(path.join(LAB, 'photo-test/items.json'), 'utf8')) as { group: string; src: string }[]) if (i.group === 'candidate') srcs.push(i.src);
  const out: Item[] = [];
  for (const [n, src] of [...new Set(srcs)].entries()) {
    try {
      const res = await fetch(src, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const id = String(n).padStart(2, '0');
      const info = await sharp(Buffer.from(await res.arrayBuffer())).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toFile(path.join(DIR, 'orig', `${id}.jpg`));
      out.push({ id, src, w: info.width, h: info.height });
    } catch { /* skip */ }
  }
  save(out);
  console.log(`fetched ${out.length}/${new Set(srcs).size}`);
}

async function frames() {
  const all = items();
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  let cost = 0;
  fs.mkdirSync(path.join(DIR, 'plain'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'patch-plain'), { recursive: true });
  for (const it of all) {
    const orig = fs.readFileSync(path.join(DIR, 'orig', `${it.id}.jpg`));
    const small = await sharp(orig).resize(1024, 1024, { fit: 'inside' }).jpeg().toBuffer();
    const res = await jev.systemOne({ state: image(small), questions: { essential: box(ESSENTIAL), text: noul(HAS_TEXT, { true: 'Text to read in full', false: 'No text that matters' }) } as unknown as Questions, model: 'jev-preview' } as never);
    cost += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
    const a = res.answers as Record<string, { box?: Box; noul?: number }>;
    it.fit = decideFit(it.w, it.h, a.essential?.box ?? null, (a.text?.noul ?? 0) >= 0.5);
    it.stretch = storyStretch(it.w, it.h, it.fit).stretch;
    const frame = await renderStory(orig, it.fit);
    fs.writeFileSync(path.join(DIR, 'plain', `${it.id}.jpg`), frame);
    fs.writeFileSync(path.join(DIR, 'patch-plain', `${it.id}.jpg`), await patch(frame));
  }
  save(all);
  ledger(cost, 'upscale frames jev');
  console.log(`frames ${all.length}, $${cost.toFixed(4)}; stretch ≥2: ${all.filter((x) => x.stretch! >= 2).length}, 1–2: ${all.filter((x) => x.stretch! >= 1 && x.stretch! < 2).length}, <1: ${all.filter((x) => x.stretch! < 1).length}`);
}

/** The 1:1 centre of the frame, where the subject sits. */
const patch = (frame: Buffer) => sharp(frame).extract({ left: (1080 - PATCH) / 2, top: (1920 - PATCH) / 2, width: PATCH, height: PATCH }).jpeg({ quality: 92 }).toBuffer();

async function ask(who: 'jev' | 'haiku') {
  const all = items();
  const out: Record<string, number> = {};
  let cost = 0;
  const msgs: Anthropic.Message[] = [];
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  const claude = new Anthropic();
  const tool: Anthropic.Tool = { name: 'sharpness', description: 'Whether the picture looks soft.', input_schema: { type: 'object', properties: { soft: { type: 'boolean', description: SOFT_QUESTION } }, required: ['soft'] } };
  for (const it of all) {
    const buf = fs.readFileSync(path.join(DIR, 'patch-plain', `${it.id}.jpg`));
    if (who === 'jev') {
      const res = await jev.systemOne({ state: image(buf), questions: { soft: noul(SOFT_QUESTION, { true: 'Soft, blurry or blocky', false: 'Clean and sharp' }) } as unknown as Questions } as never);
      cost += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
      out[it.id] = (res.answers as Record<string, { noul: number }>).soft!.noul;
    } else {
      const m = await claude.messages.create({ model: 'claude-haiku-5-5', max_tokens: 400, system: cachedSystemText('You check picture quality for a phone story. Answer through the sharpness tool.'), tools: [withToolCache(tool)],
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }, { type: 'text', text: 'Is this picture soft?' }] }] });
      msgs.push(m);
      const u = m.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use');
      out[it.id] = u ? Number((u.input as { soft: boolean }).soft) : 0;
    }
  }
  if (who === 'haiku') cost = Number(priceAnthropicMessages(msgs, { modelId: 'claude-haiku-5-5' }).costUsd);
  ledger(cost, `upscale soft ${who}`);
  fs.writeFileSync(path.join(DIR, `soft-${who}.json`), JSON.stringify({ costUsd: cost, results: out }, null, 1));
  console.log(`${who}: soft ${Object.values(out).filter((v) => v >= 0.5).length}/${all.length}, $${cost.toFixed(4)}`);
}

async function upscaleAll() {
  const bin = findUpscaler();
  if (!bin) throw new Error('realesrgan-ncnn-vulkan not found');
  const V = process.env.UPSCALE_V === '2' ? '-v2' : ''; const all = items().filter((x) => !V || x.stretch! >= 1.25);
  const tmp = path.join(DIR, 'tmp');
  for (const d of [`up${V}`, `pairs${V}`, tmp]) fs.mkdirSync(path.isAbsolute(d) ? d : path.join(DIR, d), { recursive: true });
  const sharpen = esrganSharpen(bin, tmp);
  const key: Record<string, { left: 'plain' | 'up'; ms: number; error?: string }> = {};
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const it of all) {
    const t0 = Date.now();
    const orig = fs.readFileSync(path.join(DIR, 'orig', `${it.id}.jpg`));
    let frame: Buffer;
    try { frame = await renderStory(orig, it.fit!, sharpen); } catch (e) { key[it.id] = { left: 'plain', ms: 0, error: String(e) }; continue; }
    fs.writeFileSync(path.join(DIR, `up${V}`, `${it.id}.jpg`), frame);
    const a = fs.readFileSync(path.join(DIR, 'patch-plain', `${it.id}.jpg`)), b = await patch(frame);
    const left = rand() < 0.5 ? 'plain' : 'up';
    const [l, r] = left === 'plain' ? [a, b] : [b, a];
    await sharp({ create: { width: PATCH * 2 + 16, height: PATCH, channels: 3, background: '#808080' } })
      .composite([{ input: l, left: 0, top: 0 }, { input: r, left: PATCH + 16, top: 0 }]).jpeg({ quality: 92 }).toFile(path.join(DIR, `pairs${V}`, `${it.id}.jpg`));
    key[it.id] = { left, ms: Date.now() - t0 };
  }
  fs.writeFileSync(path.join(DIR, `pair-key${V}.json`), JSON.stringify(key, null, 1));
  const ms = Object.values(key).map((k) => k.ms);
  console.log(`upscaled ${ms.length}, errors ${Object.values(key).filter((k) => k.error).length}, avg ${(ms.reduce((s, x) => s + x, 0) / ms.length / 1000).toFixed(1)}s`);
}

if (process.argv[1]?.endsWith('story-upscale.ts')) {
  const [cmd, who] = process.argv.slice(2);
  const yes = process.argv.includes('--yes');
  const run = cmd === 'fetch' ? fetchAll() : cmd === 'frames' && yes ? frames() : cmd === 'ask' && yes && (who === 'jev' || who === 'haiku') ? ask(who) : cmd === 'upscale' ? upscaleAll() : Promise.resolve(console.log('usage: fetch | frames --yes | ask jev|haiku --yes | upscale'));
  run.catch((e) => { console.error(e); process.exitCode = 1; });
}
