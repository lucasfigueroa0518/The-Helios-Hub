/**
 * One GPT Image 2.6 edit through fal's queue (the pattern in lib/reels/visual/kling/api.ts):
 * POST queue.fal.run/<model> → poll status_url until COMPLETED → GET response_url → images[0].url.
 * The reference photos go in as data URIs, so nothing is uploaded first. `fetch` is injected so tests stub it.
 */

export const FAL_COVER_MODEL = 'openai/gpt-image-2.6/flare/edit';
const QUEUE_BASE = 'https://queue.fal.run';

/**
 * ESTIMATE, not a quote: fal bills GPT Image 2.6 by tokens ($8/M image input, $30/M output). One medium 4:3 image
 * plus up to 6 references lands around this. Lucas: check it against the fal dashboard and adjust.
 */
export const FAL_COVER_IMAGE_USD = 0.1;

/** Up to 6 references, each at most this many pixels on the long side. */
export const FAL_MAX_REFERENCES = 6;
const REFERENCE_LONG_SIDE = 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** fal's API key and the fetch that carries it. Null in the deps means the AI cover is not wired. */
export type FalImage = { apiKey: string; fetch: FetchLike };

export type FalWait = { now?: () => number; sleep?: (ms: number) => Promise<void>; deadlineMs?: number };

const WAIT_DEADLINE_MS = 4 * 60_000;
const POLL_MS = 2_000;

type Queued = { request_id?: string; status_url?: string; response_url?: string };

function falErrorText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as { detail?: unknown; error?: unknown; message?: unknown };
  const detail = b.detail ?? b.error ?? b.message;
  if (typeof detail === 'string') return detail.slice(0, 300);
  return detail ? JSON.stringify(detail).slice(0, 300) : '';
}

function falFetch(fal: FalImage, url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Key ${fal.apiKey}` };
  if (init?.body) headers['content-type'] = 'application/json';
  return fal.fetch(url, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) } });
}

/** A reference photo as a JPEG data URI, at most 1024 px on the long side. */
export async function referenceDataUri(bytes: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp(bytes)
    .rotate()
    .resize({ width: REFERENCE_LONG_SIDE, height: REFERENCE_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

export function falCoverInput(prompt: string, imageUrls: string[]) {
  return {
    prompt,
    image_urls: imageUrls.slice(0, FAL_MAX_REFERENCES),
    image_size: 'landscape_4_3',
    quality: 'medium',
    output_format: 'jpeg',
    num_images: 1,
  };
}

/** Submit the edit to fal's queue; returns where to poll and where to read the result. Accepted = billed. */
export async function submitImage(fal: FalImage, prompt: string, imageUrls: string[]): Promise<{ statusUrl: string; responseUrl: string }> {
  const res = await falFetch(fal, `${QUEUE_BASE}/${FAL_COVER_MODEL}`, { method: 'POST', body: JSON.stringify(falCoverInput(prompt, imageUrls)) });
  const queued = (await res.json().catch(() => null)) as Queued | null;
  if (!res.ok || !queued?.request_id) throw new Error(`fal rejected the image (${res.status}): ${falErrorText(queued) || 'no request id'}`);
  return {
    statusUrl: queued.status_url ?? `${QUEUE_BASE}/${FAL_COVER_MODEL}/requests/${queued.request_id}/status`,
    responseUrl: queued.response_url ?? `${QUEUE_BASE}/${FAL_COVER_MODEL}/requests/${queued.request_id}`,
  };
}

/** Poll until COMPLETED (FAILED or a bad status response throws), then read the result; returns images[0].url. */
export async function waitForImage(fal: FalImage, queued: { statusUrl: string; responseUrl: string }, o: FalWait = {}): Promise<string> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadlineMs = o.deadlineMs ?? WAIT_DEADLINE_MS;
  const until = now() + deadlineMs;
  let status = 'IN_QUEUE';
  while (now() < until) {
    const polled = await falFetch(fal, queued.statusUrl);
    const body = (await polled.json().catch(() => null)) as { status?: string } | null;
    status = body?.status ?? 'UNKNOWN';
    if (status === 'COMPLETED') break;
    if (status === 'FAILED' || !polled.ok) throw new Error(`the image failed (${polled.status}): ${falErrorText(body) || status}`);
    await sleep(POLL_MS);
  }
  if (status !== 'COMPLETED') throw new Error(`the image did not finish within ${Math.round(deadlineMs / 1000)} s (${status})`);

  const res = await falFetch(fal, queued.responseUrl);
  const result = (await res.json().catch(() => null)) as { images?: Array<{ url?: unknown }> } | null;
  const url = result?.images?.[0]?.url;
  if (!res.ok || typeof url !== 'string' || !url) throw new Error(`fal returned no image (${res.status}): ${falErrorText(result)}`.trim());
  return url;
}
