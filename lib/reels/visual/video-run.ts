import Anthropic from '@anthropic-ai/sdk';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { dbQuery } from '@/lib/db';
import { MONTHLY_WATCH_USD, MOTION_MODEL, VIDEO_STALE_MINUTES } from '@/lib/reels/config';
import { monthToDateUsd, recordCost } from '@/lib/reels/repository';
import { buildStory, type VisualMember } from '@/lib/reels/visual/scene';
import { colorProfileOrNoir } from '@/lib/reels/visual/color';
import { renderTextPlate } from '@/lib/reels/visual/engine';
import { generateKlingClip } from '@/lib/reels/visual/kling/api';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { pickHookTiming, type ClipShape, type Hook, type HookTiming } from '@/lib/reels/visual/hook';
import { routeHook } from '@/lib/reels/visual/hook-route';
import { motionRecord } from '@/lib/reels/visual/motion-prompt';
import { writeMotion, type MotionClient } from '@/lib/reels/visual/motion-writer';
import { overlayPlate, probeVideo } from '@/lib/reels/visual/overlay';
import { downloadFrameObject, signFrameObject, uploadFrameObject } from '@/lib/reels/visual/storage';
import type { Bucket, MemberRole } from '@/lib/reels/types';

export type VideoStatus = 'requested' | 'running' | 'ok' | 'failed';

export type StoredVideo = {
  id: string;
  postIdeaId: string;
  slateId: string | null;
  status: VideoStatus;
  error: string | null;
  hasVideo: boolean;
  usd: number;
  requestedAt: string;
  finishedAt: string | null;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export async function queueVideoJob(
  postIdeaId: string,
  slateId: string,
): Promise<{ queued: true; id: string } | { queued: false; status: number; note: string }> {
  // The spend watch is a warning on the finished video, not a gate (fail open).
  const frame = await latestBackground(postIdeaId);
  if (!frame) {
    return { queued: false, status: 400, note: 'Generate a frame before sending this idea to video.' };
  }
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.video_jobs (post_idea_id, slate_id, visual_job_id, status)
     VALUES ($1, $2, $3, 'requested')
     ON CONFLICT (post_idea_id) WHERE status IN ('requested', 'running') DO NOTHING
     RETURNING id`,
    [postIdeaId, slateId, frame.id],
  );
  const job = rows[0];
  if (!job) return { queued: false, status: 200, note: 'A video is already queued for this post idea.' };
  return { queued: true, id: job.id };
}

async function latestBackground(postIdeaId: string): Promise<{ id: string } | null> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id FROM reels.visual_jobs
      WHERE post_idea_id = $1 AND status = 'ok' AND background_storage_path IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1`,
    [postIdeaId],
  );
  return rows[0] ?? null;
}

export async function videoInFlight(): Promise<boolean> {
  const { rows } = await dbQuery<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reels.video_jobs WHERE status IN ('requested', 'running')
     ) AS found`,
  );
  return rows[0]?.found === true;
}

export async function loadVideosForIdeas(postIdeaIds: string[]): Promise<Record<string, StoredVideo>> {
  if (postIdeaIds.length === 0) return {};
  const { rows } = await dbQuery<{
    id: string;
    post_idea_id: string;
    slate_id: string | null;
    status: VideoStatus;
    error: string | null;
    has_video: boolean;
    usd: string;
    requested_at: string;
    finished_at: string | null;
  }>(
    `SELECT DISTINCT ON (post_idea_id)
            id, post_idea_id, slate_id, status, error,
            video_storage_path IS NOT NULL AS has_video,
            usd::text, requested_at::text, finished_at::text
       FROM reels.video_jobs
      WHERE post_idea_id = ANY($1::uuid[])
      ORDER BY post_idea_id, requested_at DESC`,
    [postIdeaIds],
  );
  const out: Record<string, StoredVideo> = {};
  for (const row of rows) {
    out[row.post_idea_id] = {
      id: row.id,
      postIdeaId: row.post_idea_id,
      slateId: row.slate_id,
      status: row.status,
      error: row.error,
      hasVideo: row.has_video,
      usd: Number(row.usd),
      requestedAt: row.requested_at,
      finishedAt: row.finished_at,
    };
  }
  return out;
}

export async function loadVideoObject(jobId: string): Promise<string | null> {
  const { rows } = await dbQuery<{ video_storage_path: string | null }>(
    `SELECT video_storage_path FROM reels.video_jobs WHERE id = $1 AND status = 'ok'`,
    [jobId],
  );
  return rows[0]?.video_storage_path ?? null;
}

async function claimVideoJob(): Promise<string | null> {
  await dbQuery(
    `UPDATE reels.video_jobs
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this video was running.'
      WHERE status = 'running'
        AND started_at < now() - ($1::int * interval '1 minute')`,
    [VIDEO_STALE_MINUTES],
  );
  try {
    const { rows } = await dbQuery<{ id: string }>(
      `UPDATE reels.video_jobs
          SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM reels.video_jobs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM reels.video_jobs v WHERE v.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id`,
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

type VideoTarget = {
  postIdeaId: string;
  scene: string;
  backgroundPath: string;
  onScreenCopy: string;
  story: string;
  colorProfile: ReturnType<typeof colorProfileOrNoir>;
};

async function loadVideoTarget(jobId: string): Promise<VideoTarget | null> {
  const { rows } = await dbQuery<{
    post_idea_id: string;
    scene: string | null;
    background_storage_path: string | null;
    on_screen_copy: string | null;
    render: { colorProfile?: string } | null;
    caption: string | null;
    role: MemberRole;
    headline: string;
    body: string;
    source_bucket: Bucket;
  }>(
    `SELECT j.post_idea_id, v.scene, v.background_storage_path, v.render,
            c.on_screen_copy, c.caption,
            m.role, src.headline, src.body, src.bucket AS source_bucket
       FROM reels.video_jobs j
       JOIN reels.visual_jobs v ON v.id = j.visual_job_id
       JOIN reels.idea_copy c ON c.post_idea_id = j.post_idea_id AND c.slate_id = j.slate_id
       JOIN reels.post_idea_members m ON m.post_idea_id = j.post_idea_id
       JOIN reels.sources src ON src.id = m.source_id
      WHERE j.id = $1
      ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at`,
    [jobId],
  );
  const first = rows[0];
  if (!first?.scene?.trim() || !first.background_storage_path || !first.on_screen_copy?.trim()) return null;
  const members: VisualMember[] = rows.map((row) => ({
    role: row.role,
    sourceName: '',
    headline: row.headline,
    body: row.body,
    sourceBucket: row.source_bucket,
  }));
  return {
    postIdeaId: first.post_idea_id,
    scene: first.scene,
    backgroundPath: first.background_storage_path,
    onScreenCopy: first.on_screen_copy,
    story: buildStory(first.caption, members),
    colorProfile: colorProfileOrNoir(first.render?.colorProfile),
  };
}

function motionCost(message: Anthropic.Message | null): { input: number; output: number; usd: number } {
  if (!message) return { input: 0, output: 0, usd: 0 };
  const priced = priceAnthropicMessages([message], { modelId: MOTION_MODEL, fallbackCacheTtl: '5m' });
  const input =
    priced.uncached_input_tokens +
    priced.cache_read_input_tokens +
    priced['cache_creation.ephemeral_5m_input_tokens'] +
    priced['cache_creation.ephemeral_1h_input_tokens'];
  return { input, output: priced.output_tokens, usd: Number(priced.costUsd) };
}

async function finish(
  jobId: string,
  status: VideoStatus,
  fields: { error?: string | null; prompt?: string | null; videoPath?: string | null; higgsfieldJobId?: string | null; usd?: number },
): Promise<void> {
  await dbQuery(
    `UPDATE reels.video_jobs
        SET status = $2, finished_at = now(), error = $3, motion_prompt = COALESCE($4, motion_prompt),
            video_storage_path = COALESCE($5, video_storage_path),
            higgsfield_job_id = COALESCE($6, higgsfield_job_id),
            usd = COALESCE($7, usd)
      WHERE id = $1`,
    [
      jobId,
      status,
      fields.error ?? null,
      fields.prompt ?? null,
      fields.videoPath ?? null,
      fields.higgsfieldJobId ?? null,
      fields.usd ?? null,
    ],
  );
}

/** Used when the Jev hook route errors. Every hook is a valid opener. */
const FALLBACK_HOOK: Hook = 'glitch';
const KLING_ATTEMPTS = 2;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function klingWithRetry(input: { prompt: string; imageUrl: string }, notices: string[]) {
  let last: unknown;
  for (let attempt = 1; attempt <= KLING_ATTEMPTS; attempt += 1) {
    try {
      return await generateKlingClip(input);
    } catch (error) {
      last = error;
      if (attempt < KLING_ATTEMPTS) notices.push(`Kling attempt ${attempt} failed and was retried: ${describe(error)}`);
    }
  }
  throw last;
}

/**
 * Hook, then text plate, over the raw clip. Fails open: if the plate or the
 * hook cannot be laid, the reel ships with what did work and a warning.
 */
async function compose(
  rawPath: string,
  platePath: string,
  outPath: string,
  target: VideoTarget,
  hook: Hook,
  timing: HookTiming,
  notices: string[],
): Promise<string> {
  let shape: ClipShape;
  try {
    shape = await probeVideo(rawPath);
  } catch (error) {
    notices.push(`Could not read the clip, so it ships without the hook and text: ${describe(error)}`);
    return rawPath;
  }
  try {
    const plate = await renderTextPlate(target.onScreenCopy, shape.width, shape.height, target.colorProfile);
    await writeFile(platePath, plate.png);
    notices.push(...plate.warnings);
  } catch (error) {
    notices.push(`Text plate failed, so the clip ships without on-screen text: ${describe(error)}`);
    return rawPath;
  }
  try {
    await overlayPlate(rawPath, platePath, outPath, { hook, clip: shape, timing });
    return outPath;
  } catch (error) {
    notices.push(`Overlay with the ${hook} hook failed: ${describe(error)}`);
  }
  try {
    await overlayPlate(rawPath, platePath, outPath, { hook: 'invert', clip: shape, timing });
    notices.push('Used the invert hook instead.');
    return outPath;
  } catch (error) {
    notices.push(`Overlay failed again, so the clip ships without the hook and text: ${describe(error)}`);
    return rawPath;
  }
}

/** Claim one queued video. The page never calls Claude, Jev, or Higgsfield. */
export async function claimAndRenderVideo(deps?: {
  motion?: MotionClient;
  jev?: JevRunner;
}): Promise<{ id: string; status: VideoStatus } | null> {
  const id = await claimVideoJob();
  if (!id) return null;
  const motionClient = deps?.motion ?? new Anthropic();
  let usd = 0;
  try {
    const target = await loadVideoTarget(id);
    if (!target) {
      await finish(id, 'failed', { error: 'This idea has no background still or on-screen copy.' });
      return { id, status: 'failed' };
    }
    const notices: string[] = [];
    const spent = await monthToDateUsd();
    if (spent >= MONTHLY_WATCH_USD) {
      notices.push(`Month-to-date spend is $${spent.toFixed(2)}, at or over the $${MONTHLY_WATCH_USD} watch.`);
    }
    let route: { hook: Hook; usd: number } = { hook: FALLBACK_HOOK, usd: 0 };
    try {
      route = await routeHook(deps?.jev ?? createLiveJevRunner(), {
        onScreenCopy: target.onScreenCopy,
        postIdeaId: target.postIdeaId,
      });
    } catch (error) {
      notices.push(`Hook route failed, so the reel opens on ${FALLBACK_HOOK}: ${describe(error)}`);
    }
    usd += route.usd;
    const png = await downloadFrameObject(target.backgroundPath);
    const written = await writeMotion(motionClient, {
      png,
      scene: target.scene,
      story: target.story,
      onScreenCopy: target.onScreenCopy,
      profile: target.colorProfile,
    });
    const cost = motionCost(written.message);
    usd += cost.usd;
    if (cost.usd > 0) {
      await recordCost({
        runId: null,
        vendor: 'anthropic',
        component: 'reel-motion',
        inputTokens: cost.input,
        outputTokens: cost.output,
        usd: cost.usd,
      });
    }
    if (!written.prompt) {
      await finish(id, 'failed', { error: written.error, usd });
      return { id, status: 'failed' };
    }
    const imageUrl = await signFrameObject(target.backgroundPath);
    const clip = await klingWithRetry({ prompt: written.prompt.text, imageUrl }, notices);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-reel-'));
    try {
      const rawPath = path.join(dir, 'raw.mp4');
      const platePath = path.join(dir, 'plate.png');
      const outPath = path.join(dir, 'reel.mp4');
      await writeFile(rawPath, clip.bytes);
      const timing = pickHookTiming();
      const finalPath = await compose(rawPath, platePath, outPath, target, route.hook, timing, notices);
      const videoPath = `${id}/reel.mp4`;
      await uploadFrameObject(videoPath, await readFile(finalPath), 'video/mp4');
      const warnings = [...notices, ...written.prompt.warnings];
      await finish(id, 'ok', {
        // Fail open: the clip ships and the warnings ride along as labels.
        error: warnings.length ? `Warning: ${warnings.join(' | ')}` : null,
        prompt: motionRecord(route.hook, { ...written.prompt, warnings }, timing),
        videoPath,
        higgsfieldJobId: clip.jobId,
        usd,
      });
      return { id, status: 'ok' };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish(id, 'failed', { error: message, usd }).catch(() => undefined);
    return { id, status: 'failed' };
  }
}
