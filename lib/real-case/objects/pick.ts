import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText } from '@/lib/anthropic-cache';

/**
 * The auto-pick (RC-41): stock results are noisy (a boxing match for "box", keys for "padlock"), so the
 * candidate cutouts go on one numbered contact sheet and one cheap vision call picks the one that is a
 * clean, whole example of the object, or none. On none the frame drops the object; a wrong object never
 * reaches a reel.
 */

export const PICK_MODEL = 'claude-haiku-5-5';
const TILE = 360;

export const PICK_SYSTEM = [
  'You check photo cutouts for a news explainer video. Each tile on the sheet is numbered in its top-left corner.',
  'Pick the one tile that shows the requested object as one clean, whole example of it:',
  '- the object itself, not a scene that contains it, a person using it, or a different object that shares the word;',
  '- whole (not cropped mid-object) and recognisable at phone size;',
  '- no people or body parts, no readable text, no logos or brand marks.',
  'If no tile meets every rule, answer NONE. Never pick a tile that breaks a rule because it is the best of a bad set.',
  'Answer with exactly one line: PICK <number> or NONE.',
].join('\n');

/** One numbered sheet of the candidates on a checkerboard (so transparency reads), in a row. */
export async function contactSheet(pngs: Buffer[]): Promise<Buffer> {
  const tiles = await Promise.all(
    pngs.map(async (png, i) => {
      const fitted = await sharp(png).resize(TILE - 24, TILE - 24, { fit: 'inside' }).png().toBuffer();
      const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect x="6" y="6" width="54" height="54" rx="8" fill="#111"/><text x="33" y="46" font-family="Arial" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
      return sharp({ create: { width: TILE, height: TILE, channels: 4, background: '#e9e9e9' } })
        .composite([{ input: fitted, gravity: 'center' }, { input: label, left: 0, top: 0 }])
        .png()
        .toBuffer();
    }),
  );
  return sharp({ create: { width: TILE * tiles.length, height: TILE, channels: 4, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: i * TILE, top: 0 })))
    .png()
    .toBuffer();
}

export type CreateMessage = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** The request for one object's sheet: the rules are the cached prefix, the sheet and object the suffix. */
export function pickRequest(object: string, sheet: Buffer, count: number): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: PICK_MODEL,
    max_tokens: 16,
    system: cachedSystemText(PICK_SYSTEM),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: sheet.toString('base64') } },
          { type: 'text', text: `Requested object: ${object.trim()}. Tiles: 1 to ${count}.` },
        ],
      },
    ],
  };
}

/** The picked tile index (0-based) or null for NONE, unreadable or out-of-range answers. */
export function parsePick(text: string, count: number): number | null {
  const m = /^\s*PICK\s+(\d+)\s*$/im.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n - 1 : null;
}

export async function pickCandidate(object: string, pngs: Buffer[], create: CreateMessage): Promise<{ index: number | null; message: Anthropic.Message | null }> {
  if (!pngs.length) return { index: null, message: null };
  const message = await create(pickRequest(object, await contactSheet(pngs), pngs.length));
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  return { index: parsePick(text, pngs.length), message };
}
