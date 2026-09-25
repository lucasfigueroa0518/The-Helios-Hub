import { VISUAL_IMAGE_MODEL, VISUAL_IMAGE_QUALITY, VISUAL_IMAGE_SIZE } from '@/lib/reels/config';

/**
 * gpt-image-2 standard rates. They match the image generation guide's
 * published examples: a low 1024×1024 image is about $0.006 at ~200 output
 * tokens, which is $30 per million image-output tokens. Text input is $5
 * per million. A generation sends no image input.
 */
export const GPT_IMAGE_TEXT_INPUT_USD_PER_MTOK = 5;
export const GPT_IMAGE_IMAGE_INPUT_USD_PER_MTOK = 8;
export const GPT_IMAGE_IMAGE_OUTPUT_USD_PER_MTOK = 30;

export type ImageUsage = {
  textInputTokens: number;
  imageInputTokens: number;
  imageOutputTokens: number;
  usd: number;
};

export function priceImageUsage(usage: {
  textInputTokens?: number;
  imageInputTokens?: number;
  imageOutputTokens?: number;
}): number {
  const text = usage.textInputTokens ?? 0;
  const imageIn = usage.imageInputTokens ?? 0;
  const imageOut = usage.imageOutputTokens ?? 0;
  return (
    (text * GPT_IMAGE_TEXT_INPUT_USD_PER_MTOK +
      imageIn * GPT_IMAGE_IMAGE_INPUT_USD_PER_MTOK +
      imageOut * GPT_IMAGE_IMAGE_OUTPUT_USD_PER_MTOK) /
    1_000_000
  );
}

type ImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
  error?: { message?: string };
};

function readUsage(body: ImagesResponse): ImageUsage {
  const usage = body.usage ?? {};
  const details = usage.input_tokens_details;
  const textInputTokens = details?.text_tokens ?? usage.input_tokens ?? 0;
  const imageInputTokens = details?.image_tokens ?? 0;
  const imageOutputTokens = usage.output_tokens ?? 0;
  return {
    textInputTokens,
    imageInputTokens,
    imageOutputTokens,
    usd: priceImageUsage({ textInputTokens, imageInputTokens, imageOutputTokens }),
  };
}

/** One 9:16 background from gpt-image-2. No retry: a failure is returned to the job. */
export async function generateBackground(
  prompt: string,
  signal?: AbortSignal,
): Promise<{ png: Buffer; usage: ImageUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    signal: signal ?? AbortSignal.timeout(180_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VISUAL_IMAGE_MODEL,
      prompt,
      size: VISUAL_IMAGE_SIZE,
      quality: VISUAL_IMAGE_QUALITY,
      output_format: 'png',
      n: 1,
    }),
  });

  const body = (await response.json().catch(() => null)) as ImagesResponse | null;
  if (!response.ok) {
    const message = body?.error?.message ?? `Image generation failed (${response.status}).`;
    throw new Error(message);
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image generation returned no image.');
  return { png: Buffer.from(b64, 'base64'), usage: readUsage(body ?? {}) };
}
