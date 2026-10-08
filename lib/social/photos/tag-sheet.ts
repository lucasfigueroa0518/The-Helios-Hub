/**
 * The sheet tagging call (photo spec §4 step 4; Tommy, 2026-10-07): one
 * Haiku look at a contact sheet of candidate photos. For each numbered tile
 * it gives a few words saying what the photo shows, and flags anything the
 * stock rules forbid (a person as the main subject, a landmark, a logo, a
 * named place, a text banner), as JSON in tile order. Flagged tiles get the
 * close-up check (vision.ts) before they can be used.
 *
 *   classification: new AI call (Tommy's sixth round) · 0 stages (inside
 *   design) · 1 call per 16 candidates · about $0.003–0.005 per sheet
 *
 * It never says who a person is: identity comes only from Wikidata
 * (photo spec §3).
 *
 * Caching: tool → system (static, marked); the sheet is the per-post suffix.
 * (The static prefix may be under Haiku's minimum cacheable length.)
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { PHOTO_VISION_MODEL } from '@/lib/social/pipeline/models';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

export const TAG_SYSTEM = `You tag candidate photos for a news carousel on Instagram. You get one contact sheet: photos in numbered tiles, left to right, top to bottom, starting at 1. Judge only what is visible.

For every tile, in order, give:
- tags: 2 to 4 short words or phrases naming what the photo shows (the main thing first). Plain and literal: "server racks", "blue corridor", "smartphone on desk". Never name a person, even if you think you know them.
- person: is a person the main subject, or is any face recognizable?
- landmark: does it show a famous landmark, capitol, monument or famous skyline?
- logo: is a company logo or brand name prominent?
- named_place: does it show identifiable signage or a specific named building or institution?
- text_banner: is it mostly text, a chart or a graphic banner rather than a photo?

A blank tile: tags ["blank"] and every flag false.

Call submit_tags once, with exactly one entry per tile, tiles in order.`;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const SUBMIT_TAGS_TOOL = {
  name: 'submit_tags',
  description: 'Submit the tags for every tile. Call it once.',
  input_schema: obj({
    tiles: {
      type: 'array',
      items: obj({
        tile: { type: 'integer', description: 'The tile number, 1 = top left.' },
        tags: { type: 'array', items: { type: 'string' }, description: '2 to 4 short literal words or phrases.' },
        person: { type: 'boolean' },
        landmark: { type: 'boolean' },
        logo: { type: 'boolean' },
        named_place: { type: 'boolean' },
        text_banner: { type: 'boolean' },
      }),
    },
  }),
} as unknown as Anthropic.Tool;

export type TileTag = { tile: number; tags: string[]; person: boolean; landmark: boolean; logo: boolean; named_place: boolean; text_banner: boolean };

/** Any flag the stock rules care about (photo spec §3): the tile needs the close-up check. */
export const flagged = (t: TileTag) => t.person || t.landmark || t.logo || t.named_place || t.text_banner;

export type TagSheetResult = { ok: true; tiles: TileTag[]; costUsd: number } | { ok: false; error: string; costUsd: number };

export type TagSheet = (sheetPng: Buffer, tileCount: number) => Promise<TagSheetResult>;

/**
 * The tiles in order, exactly one per tile 1…count; anything else is an error
 * (the tags would be routed to the wrong photos).
 */
export function checkTiles(raw: unknown, count: number): TileTag[] | string {
  const tiles = (raw as { tiles?: unknown })?.tiles;
  if (!Array.isArray(tiles)) return 'no tiles array';
  const byTile = new Map<number, TileTag>();
  for (const t of tiles as TileTag[]) {
    if (!Number.isInteger(t?.tile) || t.tile < 1 || t.tile > count) return `tile number out of range: ${String(t?.tile)}`;
    if (byTile.has(t.tile)) return `tile ${t.tile} tagged twice`;
    if (!Array.isArray(t.tags) || typeof t.person !== 'boolean') return `tile ${t.tile} malformed`;
    byTile.set(t.tile, { tile: t.tile, tags: t.tags.map(String).slice(0, 4), person: t.person, landmark: !!t.landmark, logo: !!t.logo, named_place: !!t.named_place, text_banner: !!t.text_banner });
  }
  if (byTile.size !== count) return `${byTile.size} tiles tagged, ${count} on the sheet`;
  return Array.from({ length: count }, (_, i) => byTile.get(i + 1)!);
}

export function createTagSheet(deps: { create: MessagesCreate; model?: string }): TagSheet {
  const model = deps.model ?? PHOTO_VISION_MODEL.model;
  const tools = [withToolCache(SUBMIT_TAGS_TOOL)];
  return async (png, count) => {
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model,
        max_tokens: 200 + 90 * count,
        system: cachedSystemText(TAG_SYSTEM),
        tools,
        tool_choice: { type: 'tool', name: SUBMIT_TAGS_TOOL.name },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `THE SHEET: ${count} tiles.` },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
          ],
        }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { ok: false, error: `tag call failed: ${err instanceof Error ? err.message : String(err)}`, costUsd: 0 };
    }
    const costUsd = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: model }).costUsd);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_TAGS_TOOL.name);
    const tiles = checkTiles(block?.input, count);
    return typeof tiles === 'string' ? { ok: false, error: tiles, costUsd } : { ok: true, tiles, costUsd };
  };
}
