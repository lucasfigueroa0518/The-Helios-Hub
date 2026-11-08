import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { messagesUsd, usageTotals, type CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import type { Mode } from '@/lib/reel-ai-drama/types';

import type { Look } from './filters';
import { placeNamed } from './places';

/**
 * The cheap Haiku look (research 04 §4.1 layer 6, §6.4): 16 thumbnails per numbered contact sheet, one
 * call per sheet, the `harvest-look` prompt (B3) as the cached system block and the sheet as the
 * per-request suffix. Per tile it answers watermark, TV channel logo (MD-16), AI-made, faces, what the
 * image shows, whether it belongs to this story, whether it shows the key moment and whether it is a clean
 * portrait (anchor material, MD-60), whether the file is garbled, whether it fits what it was meant to
 * show (the wish search keeps only those, MD-68), and whether the caption or picture shows a namesake (a
 * different person with a cast member's name; iteration 4, the Denver "Thomas Wolf"), and whether it is a
 * failed page or picture (MD-141; our own captures are looked at for this alone). Face boxes come from the
 * local detector (faces.ts), not from here.
 *
 * Room (iteration 4): the look model thinks by default, and thinking shares `max_tokens` with the 16-tile
 * answer. At 4000 a long-thinking sheet ran out mid-call and the tool call came back as `{}`, silently: 16 of
 * 69 sheets lost every tile that way (Rosewood's wishes W2–W6). LOOK_MAX_TOKENS leaves room for both, and a
 * sheet that still answers short is re-asked once for its missing tiles only.
 */

export const TILES_PER_SHEET = 16;
export const TILE_PX = 256;
/** Thinking plus 16 tiles of answer (about 2–3k tokens); the 4000 it was lost a quarter of the sheets. */
export const LOOK_MAX_TOKENS = 16_000;
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
        garbled: { type: 'boolean' },
        fits: { type: 'boolean' },
        namesake: { type: 'boolean' },
        broken: { type: 'boolean' },
        expression: { type: 'string', description: 'The main person\'s expression in a few plain words (e.g. "tired, looking away"); an empty string when no face shows.' },
        place: { type: 'string', description: 'The named place your `shows` states, in as few words as still name it; an empty string when it names none.' },
      }),
    },
  }),
} as const;

const LOOK_TOOLS = [withToolCache(SUBMIT_LOOKS_TOOL as unknown as Anthropic.Tool)];

/** A look with what it says of the main person's expression (iteration 10: asked on the same sheet, no new call). */
export type SeenLook = Look & { expression?: string | null; place?: string | null };
/** Short plain words for a look's expression, or null. */
export const expressionOf = (look: Look | null | undefined): string | null => (look as SeenLook | null | undefined)?.expression?.trim().slice(0, 80) || null;

/** The place a look's `shows` states, or null (iteration 12: the only thing a photo's place label may say). */
export const placeOf = (look: Look | null | undefined): string | null => placeNamed((look as SeenLook | null | undefined)?.place);

export type LookItem = { file: string; claim: string; caption: string; source: string };
export type LookContext = {
  title: string;
  keyMoment: string;
  cast: string[];
  /** Who each cast member is (their role in this story), so the look can tell a namesake. */
  roles?: Readonly<Record<string, string>>;
};

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
    `Cast: ${ctx.cast.map((name) => (ctx.roles?.[name]?.trim() ? `${name} (${ctx.roles[name].trim()})` : name)).join(', ')}`,
    '',
    'Tiles:',
    ...items.map((it, i) => `${i + 1}. from ${it.source}; meant to show: ${it.claim}; caption: ${it.caption.slice(0, 200) || '(none)'}`),
  ].join('\n');
}

export function parseLooks(input: unknown, n: number): Map<number, SeenLook> {
  const out = new Map<number, SeenLook>();
  const tiles = (input as { tiles?: unknown[] })?.tiles;
  if (!Array.isArray(tiles)) return out;
  for (const t of tiles as Partial<SeenLook & { tile: number }>[]) {
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
      garbled: t.garbled === true,
      fits: t.fits !== false,
      namesake: t.namesake === true,
      broken: t.broken === true,
      ...(String(t.expression ?? '').trim() ? { expression: String(t.expression).trim() } : {}),
      ...(placeNamed(t.place) ? { place: placeNamed(t.place) } : {}),
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

/** One look call over `batch` (a numbered sheet), with one retry on a thrown error; null when both fail. */
async function lookSheet(deps: LookDeps, system: string, ctx: LookContext, batch: readonly LookItem[], errors: string[], label: string): Promise<Anthropic.Message | null> {
  let sheet: Buffer;
  try {
    sheet = await contactSheet(batch.map((b) => b.file));
  } catch (error) {
    errors.push(`contact sheet ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await deps.create({
        model: deps.model,
        max_tokens: LOOK_MAX_TOKENS,
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
      errors.push(`look ${label}${attempt > 1 ? ' (retry)' : ''}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}

/**
 * Looks at every item in sheets of 16 while spend stays under `capUsd`. A sheet whose call fails is sent
 * once more; a sheet answered short (cut off at max_tokens, or tiles left out) is re-asked once for the
 * missing tiles only, on a sheet of their own. Items still unanswered, or on a sheet never sent, have no
 * look (the harvest decides what that means) and are reported in `errors`.
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

  /** Sends `idx` (item indices) as one sheet; returns the indices it left unanswered. */
  const send = async (idx: readonly number[], label: string): Promise<{ missing: number[]; stop: string | null }> => {
    const batch = idx.map((i) => items[i]);
    const message = await lookSheet(deps, system, ctx, batch, errors, label);
    if (!message) return { missing: [...idx], stop: null };
    sheets += 1;
    const usages = [message as unknown as MessageUsageLike];
    const cost = messagesUsd(usages, message.model || deps.model);
    usd += cost;
    await recordCost(deps.db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'harvest_look', ...usageTotals(usages), usd: cost });
    deps.log?.({ event: 'look', sheet: sheets, tiles: batch.length, stop_reason: message.stop_reason, usd: cost, content: message.content });
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_LOOKS_TOOL.name);
    const got = call ? parseLooks(call.input, batch.length) : new Map<number, Look>();
    for (const [i, look] of got) looks.set(idx[i], look);
    return { missing: idx.filter((_, i) => !got.has(i)), stop: message.stop_reason };
  };

  for (let start = 0; start < items.length; start += TILES_PER_SHEET) {
    if (usd >= ctx.capUsd) {
      errors.push(`looks stopped at $${usd.toFixed(4)} (cap $${ctx.capUsd.toFixed(2)}); ${items.length - start} items not looked at`);
      break;
    }
    const idx = Array.from({ length: Math.min(TILES_PER_SHEET, items.length - start) }, (_, i) => start + i);
    const label = `${sheets + 1}`;
    const first = await send(idx, label);
    if (!first.missing.length || first.stop === null) {
      if (first.missing.length) errors.push(`look ${label}: ${first.missing.length} tile(s) not looked at (the call failed)`);
      continue;
    }
    if (usd >= ctx.capUsd) {
      errors.push(`look ${label}: ${first.missing.length} tile(s) unanswered (${first.stop}); not re-asked, cap reached`);
      continue;
    }
    const again = await send(first.missing, `${label} (missing tiles)`);
    if (again.missing.length) errors.push(`look ${label}: ${again.missing.length} tile(s) still unanswered after a second ask (${first.stop}, then ${again.stop ?? 'failed'})`);
  }
  return { looks, usd, sheets, errors };
}
