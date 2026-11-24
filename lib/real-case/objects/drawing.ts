import fs from 'node:fs';

import { priceImageUsage, type ImageUsage } from '@/lib/reels/visual/image';

/**
 * Whiteboard marker drawings (RC-48), drawn by gpt-image-2 and traced to strokes (trace.ts). One simple
 * style for every drawing, so a reel's whiteboard reads as one person's hand: a few confident single-weight
 * lines, no shading, no fill, no text, plain white ground. A person is drawn from their banked cutout
 * (the image is the reference; the person must stay recognisable); an object from its name alone.
 */

export const DRAWING_MODEL = 'gpt-image-2';
export const DRAWING_SIZE = '1024x1024';
export const DRAWING_QUALITY = 'medium';

const STYLE = [
  'A simple line drawing in black dry-erase marker on a plain white background, the way a good teacher sketches on a whiteboard.',
  'Hard constraints:',
  '- Single-weight black lines only, about 8 px thick. No shading, no hatching, no fills, no grey, no color.',
  '- Few confident strokes: 10 to 40 lines in total. Every line is an open stroke a hand could draw in one motion.',
  '- No text, letters, numbers, logos or labels anywhere.',
  '- The subject is centered, whole, and fills about 80% of the square; nothing else is drawn (no ground line, no background, no frame).',
].join('\n');

export function objectPrompt(name: string): string {
  return `${STYLE}\n\nSubject: ${name.trim()}, drawn plainly and recognisably, as one clean whole object.`;
}

export function personPrompt(): string {
  return `${STYLE}\n\nSubject: the person in the reference photo, head and shoulders, front view. Keep the features that make them recognisable (face shape, hairline, glasses if any) in the same few lines. Draw only the person, never the photo's background.`;
}

/**
 * An object photo for the board and newspaper when stock has no clean one: a plain studio shot the
 * background remover can lift cleanly. Generic objects only (never a person, never a brand).
 */
export function photoPrompt(name: string): string {
  return [
    `A realistic documentary-style photograph of ${name.trim()}, an ordinary everyday example of it.`,
    'Hard constraints:',
    '- Exactly one object, whole and fully inside the frame with a margin on every side, filling about 70% of the square.',
    '- Plain seamless light grey studio background, soft even light, a faint shadow under the object only.',
    '- No people, no hands, no text, letters, numbers, logos or brand marks anywhere on the object or background.',
    '- Natural, slightly worn real-world materials; no illustration, no 3D render look.',
  ].join('\n');
}

export type GenerateImage = (req: { prompt: string; reference?: string }) => Promise<{ png: Buffer; usage: ImageUsage }>;

type ImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
  error?: { message?: string };
};

/** The live generator: images/generations for an object, images/edits with the reference for a person. */
export const generateDrawingImage: GenerateImage = async ({ prompt, reference }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  let response: Response;
  if (reference) {
    const form = new FormData();
    form.append('model', DRAWING_MODEL);
    form.append('prompt', prompt);
    form.append('size', DRAWING_SIZE);
    form.append('quality', DRAWING_QUALITY);
    form.append('n', '1');
    form.append('image', new Blob([fs.readFileSync(reference)], { type: 'image/png' }), 'reference.png');
    response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal: AbortSignal.timeout(240_000), headers: { authorization: `Bearer ${apiKey}` }, body: form });
  } else {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: AbortSignal.timeout(240_000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: DRAWING_MODEL, prompt, size: DRAWING_SIZE, quality: DRAWING_QUALITY, output_format: 'png', n: 1 }),
    });
  }
  const body = (await response.json().catch(() => null)) as ImagesResponse | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Drawing failed (${response.status}).`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Drawing returned no image.');
  const u = body?.usage ?? {};
  const textInputTokens = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
  const imageInputTokens = u.input_tokens_details?.image_tokens ?? 0;
  const imageOutputTokens = u.output_tokens ?? 0;
  return { png: Buffer.from(b64, 'base64'), usage: { textInputTokens, imageInputTokens, imageOutputTokens, usd: priceImageUsage({ textInputTokens, imageInputTokens, imageOutputTokens }) } };
};
