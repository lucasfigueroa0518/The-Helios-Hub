import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { messagesUsd, usageTotals, type CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import type { Mode } from '@/lib/reel-ai-drama/types';

import type { Look } from './filters';

/**
 * The cheap Haiku look (research 04 §4.1 layer 6, §6.4): 16 thumbnails per numbered contact sheet, one
 * call per sheet, the `harvest-look` prompt (B3) as the cached system block and the sheet as the
 * per-request suffix. Per tile it answers watermark, TV channel logo (MD-16), AI-made, faces, what the
 * image shows, whether it belongs to this story, whether it shows the key moment and whether it is a clean
 * portrait (anchor material, MD-60). Face boxes come from the local detector (faces.ts), not from here.
 */

export const TILES_PER_SHEET = 16;
export const TILE_PX = 256;
const COLS = 4;

const obj = <P extends Record<string, unknown>>(properties: P) =>
  ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const;

/** Shared with anything else that calls `harvest-look` on a sheet. */
export const SUBMIT_LOOKS_TOOL = {
  name: 'submit_looks',
  description: 'Submit one look per numbered tile on the sheet. Call it exactly once.',
  strict: true,
  input_schema: obj({
    tiles: {
      type: 'array',
      items: obj({
        tile: { type: 'integer' },
        shows: { type: 'string' },
        watermark: { type: 'boolean' },
        tv_logo: { type: 'boolean' },
        ai_generated: { type: 'boolean' },
        faces: { type: 'integer' },
        text_heavy: { type: 'boolean' },
        about_story: { type: 'boolean' },
        key_moment: { type: 'boolean' },
        portrait: { type: 'boolean' },
      }),
    },
  }),
} as const;

const LOOK_TOOLS = [withToolCache(SUBMIT_LOOKS_TOOL as unknown as Anthropic.Tool)];

export type LookItem = { file: string; claim: string; caption: string; source: string };
export type LookContext = { title: string; keyMoment: string; cast: string[] };

/** A numbered grid of thumbnails (1-based, left to right, top to bottom) as JPEG. */
export async function contactSheet(files: readonly string[]): Promise<Buffer> {
  const rows = Math.ceil(files.length / COLS);
  const tiles = await Promise.all(
    files.map(async (file, i) => {
      const thumb = await sharp(file).flatten({ background: '#ffffff' }).resize(TILE_PX, TILE_PX, { fit: 'contain', background: '#808080' }).png().toBuffer();
      const label = Buffer.from(
        `<svg width="44" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="34" fill="#000"/><text x="22" y="25" font-size="22" font-family="sans-serif" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`,
      );
      const tile = await sharp(thumb).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer();
      return { input: tile, left: (i % COLS) * TILE_PX, top: Math.floor(i / COLS) * TILE_PX };
    }),
  );
  return sharp({ create: { width: COLS * TILE_PX, height: rows * TILE_PX, channels: 3, background: '#ffffff' } }).composite(tiles).jpeg({ quality: 82 }).toBuffer();
}

export function lookUserText(ctx: LookContext, items: readonly LookItem[]): string {
  return [
    `Story: ${ctx.title}`,
    `Key moment: ${ctx.keyMoment}`,
    `Cast: ${ctx.cast.join(', ')}`,
    '',
    'Tiles:',
    ...items.map((it, i) => `${i + 1}. from ${it.source}; meant to show: ${it.claim}; caption: ${it.caption.slice(0, 200) || '(none)'}`),
  ].join('\n');
}

export function parseLooks(input: unknown, n: number): Map<number, Look> {
  const out = new Map<number, Look>();
  const tiles = (input as { tiles?: unknown[] })?.tiles;
  if (!Array.isArray(tiles)) return out;
  for (const t of tiles as Partial<Look & { tile: number }>[]) {
    const i = Number(t.tile) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= n || out.has(i)) continue;
    out.set(i, {
      shows: String(t.shows ?? '').trim(),
      watermark: t.watermark === true,
      tv_logo: t.tv_logo === true,
      ai_generated: t.ai_generated === true,
      faces: Math.max(0, Math.round(Number(t.faces ?? 0))),
      text_heavy: t.text_heavy === true,
      about_story: t.about_story !== false,
      key_moment: t.key_moment === true,
      portrait: t.portrait === true,
    });
  }
  return out;
}

export type LookDeps = {
  db: import('@/lib/explainers/db').Queryable;
  create: CreateMessage;
  loadPrompt: (name: 'harvest-look') => string;
  model: string;
  log?: (entry: Record<string, unknown>) => void;
};

/**
 * Looks at every item in sheets of 16 while spend stays under `capUsd`. A sheet whose call fails is sent
 * once more; items on a sheet the model did not answer, or on a sheet never sent, have no look (the
 * harvest decides what that means).
 */
export async function lookAt(
  deps: LookDeps,
  items: readonly LookItem[],
  ctx: LookContext & { jobId: string | null; mode: Mode; capUsd: number },
): Promise<{ looks: Map<number, Look>; usd: number; sheets: number; errors: string[] }> {
  const system = deps.loadPrompt('harvest-look');
  const looks = new Map<number, Look>();
  const errors: string[] = [];
  let usd = 0;
  let sheets = 0;
  for (let start = 0; start < items.length; start += TILES_PER_SHEET) {
    if (usd >= ctx.capUsd) {
      errors.push(`looks stopped at $${usd.toFixed(4)} (cap $${ctx.capUsd.toFixed(2)}); ${items.length - start} items not looked at`);
      break;
    }
    const batch = items.slice(start, start + TILES_PER_SHEET);
    let sheet: Buffer;
    try {
      sheet = await contactSheet(batch.map((b) => b.file));
    } catch (error) {
      errors.push(`contact sheet ${sheets + 1}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let message: Anthropic.Message | null = null;
    for (let attempt = 1; attempt <= 2 && !message; attempt += 1) {
      try {
        message = await deps.create({
          model: deps.model,
          max_tokens: 4000,
          tools: LOOK_TOOLS,
          tool_choice: { type: 'auto' },
          system: cachedSystemText(system),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: lookUserText(ctx, batch) },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: sheet.toString('base64') } },
              ],
            },
          ],
        });
      } catch (error) {
        errors.push(`look ${sheets + 1}${attempt > 1 ? ' (retry)' : ''}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!message) continue;
    sheets += 1;
    const usages = [message as unknown as MessageUsageLike];
    const cost = messagesUsd(usages, message.model || deps.model);
    usd += cost;
    await recordCost(deps.db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'harvest_look', ...usageTotals(usages), usd: cost });
    deps.log?.({ event: 'look', sheet: sheets, tiles: batch.length, usd: cost, content: message.content });
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_LOOKS_TOOL.name);
    if (!call) {
      errors.push(`look ${sheets}: no submit_looks call (${message.stop_reason})`);
      continue;
    }
    for (const [i, look] of parseLooks(call.input, batch.length)) looks.set(start + i, look);
  }
  return { looks, usd, sheets, errors };
}
