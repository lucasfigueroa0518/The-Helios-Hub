/**
 * The LFD AI cover (PLAN.md C1–C7, COVER-PROMPT-WRITER.md): the rotating hook, a direction picked by Jev,
 * one cached prompt-writer call, and one Higgsfield GPT Image 2.6 image made from the referenced story
 * photos, stored in the slide bucket. The hook is always returned. Any failure, or a spend the run's
 * remaining cap cannot cover, returns no image and a `fallback` reason: the post keeps today's cover.
 * Never throws.
 */
import { jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import { nextLfdCoverHook } from '../post';

import { HIGGSFIELD_IMAGE_USD, startImage, uploadReferences, waitForImage, type HiggsfieldTools, type ReferenceFile } from './higgsfield-image';
import { LFD_COVER_DIRECTION, LFD_COVER_STANDOFF_BAR, type LfdCoverDirection } from './prompts';
import { CoverWriterError, writeCoverPrompt, type CoverReference, type CoverStory } from './writer';

export { HIGGSFIELD_IMAGE_USD, HIGGSFIELD_USD_PER_CREDIT } from './higgsfield-image';
export type { LfdCoverDirection } from './prompts';

/** A generous ceiling for one writer call (Opus, ~3k tokens in, ~1k out), checked before anything is spent. */
export const LFD_COVER_WRITER_ESTIMATE_USD = 0.06;
const COVER_WIDTH = 1080;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LfdAiCoverDeps = {
  jev: JevAsk;
  /** The run's budget-guarded Messages create. */
  create: MessagesCreate;
  /** Higgsfield MCP tools (HiggsfieldClient live). Null: the AI cover is off and nothing is called. */
  higgsfield: HiggsfieldTools | null;
  /** Reads story photos and the result image, and PUTs the reference uploads. */
  fetch: FetchLike;
  /** The slide bucket's upload (run.ts `upload`). */
  upload: (path: string, body: Buffer, contentType?: string) => Promise<void>;
  /** What the run may still spend (USD). */
  remainingUsd: () => number;
  /** Test hooks for the job wait. */
  wait?: { now?: () => number; sleep?: (ms: number) => Promise<void>; deadlineMs?: number };
};

export type LfdAiCoverInput = {
  stories: CoverStory[];
  /** The story photos that may serve as references, in story order (`headline` is the story's). */
  photos: Array<{ url: string; headline: string; kind?: string }>;
  prevHook: string | null | undefined;
  storyCount: number;
  /** Bucket object for the stored image, e.g. `lfd/<slug>/cover-ai.jpg`. */
  objectPath: string;
};

export type LfdAiCoverResult = {
  hook: { text: string; accent: string };
  /** `url` is a data URL for the render; the post row keeps `storage:<object>`. */
  image?: { url: string; object: string };
  direction?: LfdCoverDirection;
  prompt?: string;
  references?: number[];
  /** Everything this cover spent: Jev, the writer and the image. */
  costUsd: number;
  /** The Higgsfield part only (outside the run budget's tally). */
  imageUsd: number;
  /** Why the post keeps today's cover. */
  fallback?: string;
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Jev picks the direction: yes → Standoff; no, or any failure → Unaware. */
export async function pickCoverDirection(jev: JevAsk, stories: CoverStory[], subjectId: string): Promise<{ direction: LfdCoverDirection; costUsd: number; error?: string }> {
  try {
    const res = await jev(
      {
        state: { stories: stories.map((s) => ({ headline: s.headline, untrusted_content: s.body.slice(0, 600) })) },
        questions: LFD_COVER_DIRECTION.questions,
      },
      { version: LFD_COVER_DIRECTION.version, subjectId: `lfd-cover-direction|${subjectId}` },
    );
    const costUsd = jevCostUsd(res.usage);
    return { direction: (res.answers.two_sides?.noul ?? 0) >= LFD_COVER_STANDOFF_BAR ? 'Standoff' : 'Unaware', costUsd };
  } catch (err) {
    return { direction: 'Unaware', costUsd: 0, error: errText(err) };
  }
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** A story photo's bytes: a data URL is decoded, an http(s) URL fetched. */
async function readPhoto(fetchImpl: FetchLike, url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const data = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (data) return { bytes: data[2] ? Buffer.from(data[3]!, 'base64') : Buffer.from(decodeURIComponent(data[3]!)), contentType: data[1]! };
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`reference photo fetch failed (${res.status}): ${url.slice(0, 120)}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim() };
}

const readable = (url: string) => /^(https?:|data:image\/)/.test(url);

export async function makeLfdAiCover(deps: LfdAiCoverDeps, input: LfdAiCoverInput): Promise<LfdAiCoverResult> {
  const hook = nextLfdCoverHook(input.prevHook, input.storyCount);
  const out: LfdAiCoverResult = { hook, costUsd: 0, imageUsd: 0 };
  const fail = (reason: string): LfdAiCoverResult => ({ ...out, fallback: reason });
  if (!deps.higgsfield) return fail('the AI cover is not wired (no Higgsfield client)');
  const refs: Array<CoverReference & { url: string }> = input.photos.filter((p) => readable(p.url)).slice(0, 6).map((p, i) => ({ n: i + 1, headline: p.headline, kind: p.kind ?? 'photo', url: p.url }));
  if (!refs.length) return fail('no story photo can serve as a reference');
  const need = LFD_COVER_WRITER_ESTIMATE_USD + HIGGSFIELD_IMAGE_USD;
  if (deps.remainingUsd() < need) return fail(`the run cap leaves $${deps.remainingUsd().toFixed(2)}, under the $${need.toFixed(2)} a cover needs`);

  try {
    const picked = await pickCoverDirection(deps.jev, input.stories, input.objectPath);
    out.direction = picked.direction;
    out.costUsd += picked.costUsd;

    let written: Awaited<ReturnType<typeof writeCoverPrompt>>;
    try {
      written = await writeCoverPrompt(deps.create, picked.direction, input.stories, refs);
    } catch (err) {
      if (err instanceof CoverWriterError) out.costUsd += err.costUsd;
      return fail(`prompt writer: ${errText(err)}`);
    }
    out.costUsd += written.costUsd;
    out.prompt = written.prompt;
    out.references = written.references;

    if (deps.remainingUsd() < HIGGSFIELD_IMAGE_USD) return fail(`the run cap leaves $${deps.remainingUsd().toFixed(2)}, under the $${HIGGSFIELD_IMAGE_USD.toFixed(2)} image`);

    // Only the photos the prompt names go up, in the order it numbered them.
    const used = refs.filter((r) => written.references.includes(r.n));
    let files: ReferenceFile[];
    try {
      files = await Promise.all(used.map(async (r) => {
        const { bytes, contentType } = await readPhoto(deps.fetch, r.url);
        return { filename: `lfd-ref-${r.n}.${EXT[contentType] ?? 'jpg'}`, bytes, contentType };
      }));
    } catch (err) {
      return fail(`reference photos: ${errText(err)}`);
    }

    let resultUrl: string;
    try {
      const mediaIds = await uploadReferences(deps.higgsfield, deps.fetch, files);
      const jobId = await startImage(deps.higgsfield, written.prompt, mediaIds);
      // The job is started: Higgsfield charges for it whatever happens next.
      out.imageUsd = HIGGSFIELD_IMAGE_USD;
      out.costUsd += HIGGSFIELD_IMAGE_USD;
      resultUrl = await waitForImage(deps.higgsfield, jobId, deps.wait);
    } catch (err) {
      return fail(`Higgsfield: ${errText(err)}`);
    }

    try {
      const res = await deps.fetch(resultUrl);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const sharp = (await import('sharp')).default;
      const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: COVER_WIDTH, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      await deps.upload(input.objectPath, jpeg, 'image/jpeg');
      out.image = { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, object: input.objectPath };
    } catch (err) {
      return fail(`storing the image: ${errText(err)}`);
    }
    return out;
  } catch (err) {
    return fail(errText(err));
  }
}
