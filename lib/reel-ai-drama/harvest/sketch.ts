import sharp from 'sharp';

import { priceImageUsage } from '@/lib/reels/visual/image';

import type { GenerateSketch } from './types';

/**
 * The last resort for a cast person with no clean photo anywhere (MD-14, MD-60): a line sketch traced
 * from any reference photo of them (a watermarked, too-small or unconfirmed one is fine as a reference,
 * because only the person's features carry over, never the picture). Always a drawing, never photoreal.
 * Pattern copied from the Real Case whiteboard drawings (`lib/real-case/objects/drawing.ts`), so the two
 * products stay independent.
 */

export const SKETCH_MODEL = 'gpt-image-2';
export const SKETCH_SIZE = '1024x1024';
export const SKETCH_QUALITY = 'medium';
/** Budget check before a call (gpt-image-2 medium edit with a reference, rounded up). */
export const SKETCH_USD_ESTIMATE = 0.07;
/** At most this many sketches per harvest (main characters first). */
export const MAX_SKETCHES = 4;

const STYLE = [
  'A simple line drawing in black marker on a plain white background, the way a good illustrator sketches a portrait from life.',
  'Hard constraints:',
  '- Single-weight black lines only. No shading, no hatching, no fills, no grey, no color.',
  '- Confident open strokes, about 20 to 60 lines in total; clearly a hand drawing, never a photograph or a photoreal render.',
  '- No text, letters, numbers, logos or labels anywhere.',
  '- Nothing but the person: no background, no ground line, no frame.',
].join('\n');

export function sketchPrompt(): string {
  return `${STYLE}\n\nSubject: the person in the reference photo, head and shoulders, facing the viewer, the head in the upper half of the square. Keep the features that make them recognisable (face shape, hairline, glasses or beard if any) in a few sure lines. Draw only the person, never the photo's background, text or marks.`;
}

type ImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
  error?: { message?: string };
};

/** The live generator: OpenAI images/edits with the reference photo (sent as a 1024 px PNG). */
export function openAiSketch(apiKey: string, http: typeof fetch = fetch): GenerateSketch {
  return async ({ prompt, reference }) => {
    const png = await sharp(reference).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const form = new FormData();
    form.append('model', SKETCH_MODEL);
    form.append('prompt', prompt);
    form.append('size', SKETCH_SIZE);
    form.append('quality', SKETCH_QUALITY);
    form.append('n', '1');
    form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'reference.png');
    const response = await http('https://api.openai.com/v1/images/edits', { method: 'POST', signal: AbortSignal.timeout(240_000), headers: { authorization: `Bearer ${apiKey}` }, body: form });
    const body = (await response.json().catch(() => null)) as ImagesResponse | null;
    if (!response.ok) throw new Error(body?.error?.message ?? `Sketch failed (${response.status}).`);
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new Error('Sketch returned no image.');
    const u = body?.usage ?? {};
    const textInputTokens = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
    const imageInputTokens = u.input_tokens_details?.image_tokens ?? 0;
    const imageOutputTokens = u.output_tokens ?? 0;
    return { png: Buffer.from(b64, 'base64'), usd: priceImageUsage({ textInputTokens, imageInputTokens, imageOutputTokens }) };
  };
}
