/**
 * One GPT Image 2.6 image through the Higgsfield MCP tools (lab-confirmed shapes, 2026-11-23):
 * media_upload → PUT each file (If-None-Match: *) → media_confirm → generate_image → jobs_wait until done.
 * Every client is injected (`callTool` is HiggsfieldClient.callTool live; `fetch` does the PUTs).
 */

/** Lab quote for one gpt_image_2_6 image at 4:3, medium quality, 2k. */
export const HIGGSFIELD_IMAGE_CREDITS = 1.75;
/** USD per Higgsfield credit. PLACEHOLDER: Lucas must confirm the real rate on his plan. */
export const HIGGSFIELD_USD_PER_CREDIT = 0.04;
export const HIGGSFIELD_IMAGE_USD = HIGGSFIELD_IMAGE_CREDITS * HIGGSFIELD_USD_PER_CREDIT;

export type HiggsfieldTools = { callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ReferenceFile = { filename: string; bytes: Buffer; contentType: string };

const WAIT_DEADLINE_MS = 4 * 60_000;
const WAIT_SECONDS = 15;

/**
 * An MCP tool result as plain JSON: `structuredContent` when present, else the first `content` text block that
 * parses as JSON, else the value itself.
 */
export function toolJson(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const r = result as { structuredContent?: unknown; content?: unknown; isError?: unknown };
  if (r.isError === true) {
    const text = Array.isArray(r.content) ? r.content.map((c) => (c as { text?: unknown })?.text).filter((t) => typeof t === 'string').join(' ') : '';
    throw new Error(`Higgsfield tool error: ${text.slice(0, 300) || 'no detail'}`);
  }
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      const text = (block as { type?: unknown; text?: unknown })?.text;
      if (typeof text !== 'string') continue;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      } catch {
        // not JSON: try the next block
      }
    }
  }
  return result as Record<string, unknown>;
}

const listOf = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Upload the reference files and confirm them; returns their media ids, in order. */
export async function uploadReferences(tools: HiggsfieldTools, fetchImpl: FetchLike, files: ReferenceFile[]): Promise<string[]> {
  const res = toolJson(await tools.callTool('media_upload', { files: files.map((f) => ({ filename: f.filename })) }));
  const uploads = listOf(res.uploads);
  if (uploads.length !== files.length) throw new Error(`media_upload returned ${uploads.length} upload slots for ${files.length} files`);
  const ids: string[] = [];
  for (const [i, u] of uploads.entries()) {
    const url = str(u.upload_url);
    const id = str(u.media_id);
    if (!url || !id) throw new Error('media_upload returned a slot without upload_url or media_id');
    const put = await fetchImpl(url, {
      method: str(u.method) ?? 'PUT',
      headers: { 'Content-Type': str(u.content_type) ?? files[i]!.contentType, 'If-None-Match': '*' },
      body: new Uint8Array(files[i]!.bytes),
    });
    if (!put.ok) throw new Error(`reference upload PUT failed (${put.status})`);
    ids.push(id);
  }
  const confirmed = listOf(toolJson(await tools.callTool('media_confirm', { type: 'image', media_ids: ids })).results);
  const bad = ids.filter((id) => !confirmed.some((c) => c.media_id === id && c.status === 'uploaded'));
  if (bad.length) throw new Error(`media_confirm did not confirm ${bad.join(', ')}`);
  return ids;
}

/** Start the image job; returns its job id. */
export async function startImage(tools: HiggsfieldTools, prompt: string, mediaIds: string[]): Promise<string> {
  const res = toolJson(await tools.callTool('generate_image', {
    params: {
      model: 'gpt_image_2_6',
      aspect_ratio: '4:3',
      quality: 'medium',
      resolution: '2k',
      prompt,
      medias: mediaIds.map((value) => ({ value, role: 'image_references' })),
    },
  }));
  const job = listOf(res.results)[0];
  const id = str(job?.id) ?? str(job?.job_id);
  if (!id) throw new Error('generate_image returned no job id');
  if (job?.status === 'failed') throw new Error(`generate_image failed: ${str(job.error) ?? 'no detail'}`);
  return id;
}

/** Wait for the job (repeated jobs_wait calls) until it completes with a result_url, fails, or the deadline passes. */
export async function waitForImage(
  tools: HiggsfieldTools,
  jobId: string,
  o: { now?: () => number; deadlineMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const now = o.now ?? Date.now;
  // jobs_wait blocks up to WAIT_SECONDS server-side; a short pause keeps an early return from spinning.
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = now() + (o.deadlineMs ?? WAIT_DEADLINE_MS);
  while (now() < until) {
    const res = toolJson(await tools.callTool('jobs_wait', { jobs: [{ index: 0, job_id: jobId }], timeout_seconds: WAIT_SECONDS }));
    const job = [...listOf(res.results), ...listOf(res.jobs)].find((j) => j.job_id === jobId || j.id === jobId || j.index === 0) ?? (res.status ? res : undefined);
    const status = str(job?.status);
    if (status === 'completed') {
      const url = str(job?.result_url) ?? str((job?.result as Record<string, unknown> | undefined)?.url);
      if (!url) throw new Error('the image job completed without a result_url');
      return url;
    }
    if (status === 'failed' || status === 'nsfw' || status === 'canceled' || status === 'cancelled') {
      throw new Error(`the image job ${status}: ${str(job?.error) ?? 'no detail'}`);
    }
    await sleep(2_000);
  }
  throw new Error(`the image job did not finish within ${Math.round((o.deadlineMs ?? WAIT_DEADLINE_MS) / 1000)} s`);
}
