import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage } from '@/lib/anthropic-pricing';
import { PICTURE_CHECK_QUESTIONS, PICTURE_CHECK_VIEWER } from '@/lib/explainers/render/agent';
import type { LintViolation } from '@/lib/explainers/types';

/**
 * The cheap picture check (cost fix 2026-10-28): every frame's stills, downsized and tiled into one or
 * two contact grids, sent in ONE vision call (picture_check_model, Haiku by default) instead of an
 * agent session. Risk is scored in code from what is already known; a risky frame gets large tiles, a
 * quiet one small tiles, and every frame is still seen. The reply keeps the checker's schema, so
 * job.ts pictureCheckViolations is unchanged.
 */

export type ManifestFrame = { id: string; number: number; look?: string; voiceover?: string; stills: { t: number; file: string; shot?: number }[] };

/** Code's risk score for one frame: breakage left, many shots, things near the edges, a look change. */
export function frameRisk(frame: ManifestFrame, breakage: LintViolation[]): number {
  const mine = breakage.filter((v) => v.frame === frame.number);
  let score = 0;
  if (mine.length) score += 2;
  if (mine.some((v) => /framing|safe|text|label|bounds|face_cut|objects/.test(v.rule))) score += 1;
  const shots = new Set(frame.stills.map((s) => s.shot ?? s.t)).size;
  if (shots >= 4) score += 1;
  if (frame.look === 'blend') score += 1;
  return score;
}

export const RISKY_AT = 2;

/**
 * Whether a frame the picture checker flagged gets the picture fix round: not when it passes every
 * code check (no breakage left for it) and its risk is low (under RISKY_AT). Its picture notes still
 * ship as warnings.
 */
export function pictureFixNeeded(frame: ManifestFrame, breakage: LintViolation[]): boolean {
  if (breakage.some((v) => v.frame === frame.number)) return true;
  return frameRisk(frame, breakage) >= RISKY_AT;
}
/** Tile sizes (portrait 9:16). The grid's long edge stays under the vision downscale (1568px). */
export const TILE = { small: { w: 216, h: 384 }, large: { w: 324, h: 576 } } as const;
export const GRID_MAX = 1560; // the API downsizes past ~1568 px, so larger tiles mean more grids, not bigger ones
const GAP = 6;
const HEAD = 26;

export type GridItem = { file: string; label: string; x: number; y: number; w: number; h: number };
export type Grid = { width: number; height: number; items: GridItem[]; heads: { text: string; x: number; y: number }[] };

/** Pure layout: one block per frame (a header, then its tiles wrapping at GRID_MAX), stacked; a new grid when one is full. */
export function gridLayout(frames: { id: string; size: 'small' | 'large'; tiles: { file: string; label: string }[] }[]): Grid[] {
  const grids: Grid[] = [];
  let cur: Grid = { width: 0, height: 0, items: [], heads: [] };
  for (const f of frames) {
    const { w, h } = TILE[f.size];
    const perRow = Math.max(1, Math.floor((GRID_MAX + GAP) / (w + GAP)));
    const rows = Math.max(1, Math.ceil(f.tiles.length / perRow));
    const blockH = HEAD + rows * (h + GAP);
    if (cur.items.length && cur.height + blockH > GRID_MAX) {
      grids.push(cur);
      cur = { width: 0, height: 0, items: [], heads: [] };
    }
    const top = cur.height;
    cur.heads.push({ text: f.id, x: 4, y: top + HEAD - 7 });
    f.tiles.forEach((t, i) => {
      const x = (i % perRow) * (w + GAP);
      const y = top + HEAD + Math.floor(i / perRow) * (h + GAP);
      cur.items.push({ file: t.file, label: t.label, x, y, w, h });
      cur.width = Math.max(cur.width, x + w);
    });
    cur.height = top + blockH;
  }
  if (cur.items.length) grids.push(cur);
  return grids;
}

/** The frames as grid input: risk sets each frame's tile size; every still is labelled `<id> <t>s`. */
export function gridFrames(frames: ManifestFrame[], breakage: LintViolation[]) {
  return frames.map((f) => ({
    id: f.id,
    size: (frameRisk(f, breakage) >= RISKY_AT ? 'large' : 'small') as 'small' | 'large',
    tiles: f.stills.map((s) => ({ file: s.file, label: `${f.id} ${s.t.toFixed(2)}s` })),
  }));
}

const esc = (v: string) => v.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Render the grids to JPEGs with sharp (missing stills are skipped). */
export async function renderGrids(projectDir: string, grids: Grid[]): Promise<Buffer[]> {
  const sharp = (await import('sharp')).default;
  const out: Buffer[] = [];
  for (const g of grids) {
    const layers: { input: Buffer; left: number; top: number }[] = [];
    for (const it of g.items) {
      const file = path.join(projectDir, it.file);
      if (!fs.existsSync(file)) continue;
      layers.push({ input: await sharp(file).resize(it.w, it.h, { fit: 'contain', background: '#ffffff' }).toBuffer(), left: it.x, top: it.y });
    }
    const labels = [
      ...g.heads.map((hd) => `<text x="${hd.x}" y="${hd.y}" font-size="18" font-family="sans-serif" font-weight="700" fill="#111">${esc(hd.text)}</text>`),
      ...g.items.map((it) => `<rect x="${it.x}" y="${it.y}" width="${Math.min(it.w, 96)}" height="18" fill="#000" fill-opacity="0.65"/><text x="${it.x + 3}" y="${it.y + 14}" font-size="13" font-family="sans-serif" fill="#fff">${esc(it.label.split(' ').at(-1)!)}</text>`),
    ];
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}">${labels.join('')}</svg>`), left: 0, top: 0 });
    out.push(await sharp({ create: { width: Math.max(1, g.width), height: Math.max(1, g.height), channels: 3, background: '#f2f2f2' } }).composite(layers).jpeg({ quality: 80 }).toBuffer());
  }
  return out;
}

/** What the grid check adds to the checker's questions (Lucas's MCP review, 2026-10-28). */
export const PICTURE_GRID_EXTRA =
  'Also, per frame, add three lists to its JSON: "disconnected": every cable, wire or plug whose end is not seated in a port or device, and every device whose parts are not joined (a screen detached from its base, a base hovering over its surface); "vanished": every object that is in one still of a place and missing from another still of the same place without being shown leaving, or that appears without being shown arriving (between which times); "overlaps": every caption-free text, label or card that covers or collides with an object, icon, number or button, or a subject cut off by the frame edge. Use [] when there is none.';

export const GRID_INTRO =
  'Each image is a contact grid: every frame is a block headed by its id, its stills in play order left to right (the time in each corner), the first of each shot just after a cut. Read each block as one sequence of consecutive moments of that frame.';

/** The one vision call's request: the instructions are the cached prefix; the grids and lines follow. */
export function pictureGridParams(model: string, frames: ManifestFrame[], jpegs: Buffer[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 4000,
    system: cachedSystemText([PICTURE_CHECK_VIEWER, GRID_INTRO, PICTURE_CHECK_QUESTIONS, PICTURE_GRID_EXTRA].join(' ')),
    messages: [
      {
        role: 'user',
        content: [
          ...jpegs.flatMap((b, i) => [
            { type: 'text' as const, text: `Grid ${i + 1}:` },
            { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b.toString('base64') } },
          ]),
          { type: 'text' as const, text: ['The line heard over each frame, in play order:', ...frames.map((f) => `- ${f.id} (stills ${f.stills.map((s) => `${s.t.toFixed(2)}s`).join(', ')}): "${f.voiceover ?? ''}"`)].join('\n') },
        ],
      },
    ],
  };
}

/** A swappable vision model (tests stub it): request in, reply text, usage and USD out. */
export type PictureVision = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<{ text: string; model: string; usage: unknown; usd: number }>;

export function anthropicPictureVision(client: Anthropic): PictureVision {
  return async (params) => {
    const message = await client.messages.create(params);
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const usd = Number(priceAnthropicUsage(usageBucketsFromMessage({ usage: message.usage }, '1h'), { modelId: message.model }).costUsd);
    return { text, model: message.model, usage: message.usage, usd };
  };
}
