import { KLING_CLIP_SECONDS } from '@/lib/reels/config';

/** Kling 3.0 Standard on Fal. Duration is KLING_CLIP_SECONDS. */
export const FAL_KLING_I2V = 'fal-ai/kling-video/v3/standard/image-to-video';

const QUEUE_BASE = 'https://queue.fal.run';
const POLL_MS = 5_000;
const POLL_DEADLINE_MS = 8 * 60_000;

export type KlingClip = {
  bytes: Buffer;
  jobId: string | null;
};

/**
 * Fal's Kling 3 image-to-video call. generate_audio defaults on, which bills
 * more and invents speech, so it is forced off. multi_prompt is omitted so
 * the clip stays one shot.
 */
export function falKlingBody(input: { prompt: string; imageUrl: string }): Record<string, unknown> {
  return {
    prompt: input.prompt,
    start_image_url: input.imageUrl,
    duration: String(KLING_CLIP_SECONDS),
    generate_audio: false,
    cfg_scale: 0.5,
  };
}

type QueueSubmit = {
  status?: string;
  request_id?: string;
  status_url?: string;
  response_url?: string;
  error?: string;
  detail?: string;
};

type QueueStatus = {
  status?: string;
  error?: string;
};

type FalVideo = {
  video?: { url?: string };
  detail?: string;
  error?: string;
};

export function falErrorText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { error?: unknown; detail?: unknown };
  const detail = record.detail ?? record.error;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const row = item as { msg?: unknown; type?: unknown };
        return typeof row.msg === 'string' ? row.msg : typeof row.type === 'string' ? row.type : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message;
  }
  return '';
}

function apiKey(): string {
  const key = process.env.FAL_API_KEY?.trim();
  if (!key) throw new Error('FAL_API_KEY is not set.');
  return key;
}

async function falFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Key ${apiKey()}` };
  if (init?.body) headers['content-type'] = 'application/json';
  return fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
}

/**
 * One Kling 3.0 Standard image-to-video call through Fal. The motion prompt
 * is the only free text. The background PNG URL is the start frame.
 */
export async function generateKlingClip(input: { prompt: string; imageUrl: string }): Promise<KlingClip> {
  const submitted = await falFetch(`${QUEUE_BASE}/${FAL_KLING_I2V}`, {
    method: 'POST',
    body: JSON.stringify(falKlingBody(input)),
  });
  const queued = (await submitted.json().catch(() => null)) as QueueSubmit | null;
  if (!submitted.ok || !queued?.request_id) {
    throw new Error(`Fal rejected the clip (${submitted.status}): ${falErrorText(queued) || 'no request id'}`);
  }
  const statusUrl = queued.status_url ?? `${QUEUE_BASE}/${FAL_KLING_I2V}/requests/${queued.request_id}/status`;
  const responseUrl = queued.response_url ?? `${QUEUE_BASE}/${FAL_KLING_I2V}/requests/${queued.request_id}`;
  const started = Date.now();
  let status = 'IN_QUEUE';
  while (Date.now() - started < POLL_DEADLINE_MS) {
    const polled = await falFetch(statusUrl);
    const body = (await polled.json().catch(() => null)) as QueueStatus | null;
    status = body?.status ?? 'UNKNOWN';
    if (status === 'COMPLETED') break;
    if (status === 'FAILED' || !polled.ok) {
      throw new Error(falErrorText(body) || `Fal video generation failed (${polled.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (status !== 'COMPLETED') throw new Error(`Fal did not finish the clip (${status}).`);

  const resultResponse = await falFetch(responseUrl);
  const result = (await resultResponse.json().catch(() => null)) as FalVideo | null;
  const url = result?.video?.url;
  if (!resultResponse.ok || !url) {
    throw new Error(`Fal returned no video URL (${resultResponse.status}): ${falErrorText(result) || ''}`.trim());
  }
  const video = await fetch(url);
  if (!video.ok) throw new Error(`Fal video download failed (${video.status}).`);
  return { bytes: Buffer.from(await video.arrayBuffer()), jobId: queued.request_id };
}
