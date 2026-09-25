import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { dbQuery } from '@/lib/db';
import {
  MONTHLY_WATCH_USD,
  VISUAL_IMAGE_MODEL,
  VISUAL_RECENT_SCENES,
  VISUAL_SCENE_MODEL,
  VISUAL_STALE_MINUTES,
} from '@/lib/reels/config';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { monthToDateUsd, recordCost } from '@/lib/reels/repository';
import type { BucketId } from '@/lib/reels/scoring/decide';
import type { ColorProfile } from '@/lib/reels/visual/color';
import { routeColor } from '@/lib/reels/visual/color-route';
import { checkBackgroundPng, renderTextPng, type BackgroundQa } from '@/lib/reels/visual/engine';
import { generateBackground } from '@/lib/reels/visual/image';
import { produceFrame, type ProduceFrameResult } from '@/lib/reels/visual/produce';
import {
  buildStory,
  primarySourceBucket,
  visualCategory,
  type VisualMember,
} from '@/lib/reels/visual/scene';
import { writeScene, type SceneClient } from '@/lib/reels/visual/scene-writer';
import { downloadFrameObject, uploadFrameObject } from '@/lib/reels/visual/storage';
import type { Bucket, MemberRole } from '@/lib/reels/types';

export type VisualStatus = 'requested' | 'running' | 'ok' | 'failed' | 'rejected_background' | 'copy_does_not_fit';

export type StoredFrame = {
  id: string;
  postIdeaId: string;
  slateId: string | null;
  status: VisualStatus;
  scene: string | null;
  error: string | null;
  warnings: string[];
  lines: string[];
  hasFrame: boolean;
  hasBackground: boolean;
  usd: number;
  requestedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  post_idea_id: string;
  slate_id: string | null;
  status: VisualStatus;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export async function requestVisualJob(postIdeaId: string, slateId: string): Promise<JobRow | null> {
  const { rows } = await dbQuery<JobRow>(
    `INSERT INTO reels.visual_jobs (post_idea_id, slate_id, status)
     VALUES ($1, $2, 'requested')
     ON CONFLICT (post_idea_id) WHERE status IN ('requested', 'running') DO NOTHING
     RETURNING id, post_idea_id, slate_id, status`,
    [postIdeaId, slateId],
  );
  return rows[0] ?? null;
}

export async function queueVisualFrame(
  postIdeaId: string,
  slateId: string,
): Promise<{ queued: true; id: string } | { queued: false; status: number; note: string }> {
  // The spend watch is a warning on the job, not a gate (fail open).
  const ready = await loadTarget(slateId, postIdeaId);
  if (!ready) {
    return {
      queued: false,
      status: 400,
      note: 'This post idea has no on-screen copy to put on a frame.',
    };
  }
  const job = await requestVisualJob(postIdeaId, slateId);
  if (!job) {
    return { queued: false, status: 200, note: 'A frame is already queued for this post idea.' };
  }
  return { queued: true, id: job.id };
}

export async function visualInFlight(): Promise<boolean> {
  const { rows } = await dbQuery<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reels.visual_jobs WHERE status IN ('requested', 'running')
     ) AS found`,
  );
  return rows[0]?.found === true;
}

export async function loadFramesForIdeas(postIdeaIds: string[]): Promise<Record<string, StoredFrame>> {
  if (postIdeaIds.length === 0) return {};
  const { rows } = await dbQuery<{
    id: string;
    post_idea_id: string;
    slate_id: string | null;
    status: VisualStatus;
    scene: string | null;
    error: string | null;
    warnings: string[] | null;
    render: { lines?: string[] } | null;
    has_frame: boolean;
    has_background: boolean;
    usd: string;
    requested_at: string;
    finished_at: string | null;
  }>(
    `SELECT DISTINCT ON (post_idea_id)
            id, post_idea_id, slate_id, status, scene, error, warnings, render,
            frame_storage_path IS NOT NULL AS has_frame,
            background_storage_path IS NOT NULL AS has_background,
            usd::text AS usd, requested_at, finished_at
       FROM reels.visual_jobs
      WHERE post_idea_id = ANY($1::uuid[])
      ORDER BY post_idea_id, requested_at DESC`,
    [postIdeaIds],
  );
  const out: Record<string, StoredFrame> = {};
  for (const row of rows) {
    out[row.post_idea_id] = {
      id: row.id,
      postIdeaId: row.post_idea_id,
      slateId: row.slate_id,
      status: row.status,
      scene: row.scene,
      error: row.error,
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
      lines: Array.isArray(row.render?.lines) ? row.render.lines : [],
      hasFrame: row.has_frame,
      hasBackground: row.has_background,
      usd: Number(row.usd),
      requestedAt: row.requested_at,
      finishedAt: row.finished_at,
    };
  }
  return out;
}

export async function loadFrameObject(
  id: string,
  variant: 'frame' | 'background',
): Promise<string | null> {
  const column = variant === 'frame' ? 'frame_storage_path' : 'background_storage_path';
  const { rows } = await dbQuery<{ path: string | null }>(
    `SELECT ${column} AS path FROM reels.visual_jobs WHERE id = $1`,
    [id],
  );
  return rows[0]?.path ?? null;
}

async function claimVisualJob(): Promise<string | null> {
  await dbQuery(
    `UPDATE reels.visual_jobs
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this frame was running.'
      WHERE status = 'running'
        AND started_at < now() - ($1::int * interval '1 minute')`,
    [VISUAL_STALE_MINUTES],
  );
  try {
    const { rows } = await dbQuery<{ id: string }>(
      `UPDATE reels.visual_jobs
          SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM reels.visual_jobs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM reels.visual_jobs v WHERE v.status = 'running')
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

type Target = {
  onScreenCopy: string;
  caption: string | null;
  bucket: BucketId;
  members: VisualMember[];
};

async function loadTarget(slateId: string, postIdeaId: string): Promise<Target | null> {
  const { rows } = await dbQuery<{
    on_screen_copy: string | null;
    caption: string | null;
    bucket: BucketId;
    copy_status: string;
    role: MemberRole;
    source_name: string;
    headline: string;
    body: string;
    source_bucket: Bucket;
  }>(
    `SELECT c.on_screen_copy, c.caption, c.bucket, c.status AS copy_status,
            m.role, src.source_name, src.headline, src.body, src.bucket AS source_bucket
       FROM reels.idea_copy c
       JOIN reels.post_idea_members m ON m.post_idea_id = c.post_idea_id
       JOIN reels.sources src ON src.id = m.source_id
      WHERE c.slate_id = $1 AND c.post_idea_id = $2
      ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at`,
    [slateId, postIdeaId],
  );
  if (rows.length === 0 || rows[0].copy_status !== 'ok' || !rows[0].on_screen_copy?.trim()) return null;
  return {
    onScreenCopy: rows[0].on_screen_copy,
    caption: rows[0].caption,
    bucket: rows[0].bucket,
    members: rows.map((row) => ({
      role: row.role,
      sourceName: row.source_name,
      headline: row.headline,
      body: row.body,
      sourceBucket: row.source_bucket,
    })),
  };
}

async function recentScenes(exceptId: string): Promise<string[]> {
  const { rows } = await dbQuery<{ scene: string }>(
    `SELECT scene FROM reels.visual_jobs
      WHERE status = 'ok' AND scene IS NOT NULL AND id <> $1
      ORDER BY finished_at DESC NULLS LAST
      LIMIT $2`,
    [exceptId, VISUAL_RECENT_SCENES],
  );
  return rows.map((row) => row.scene);
}

function tokenTotals(message: Message | null): { input: number; output: number; usd: number } {
  if (!message) return { input: 0, output: 0, usd: 0 };
  const priced = priceAnthropicMessages([message], {
    modelId: VISUAL_SCENE_MODEL,
    fallbackCacheTtl: '1h',
  });
  const input =
    priced.uncached_input_tokens +
    priced.cache_read_input_tokens +
    priced['cache_creation.ephemeral_5m_input_tokens'] +
    priced['cache_creation.ephemeral_1h_input_tokens'];
  return { input, output: priced.output_tokens, usd: Number(priced.costUsd) };
}

async function storePng(path: string, body: Buffer): Promise<{ path: string | null; error: string | null }> {
  try {
    await uploadFrameObject(path, body);
    return { path, error: null };
  } catch (error) {
    return { path: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function finishJob(
  id: string,
  result: ProduceFrameResult,
  extras: {
    category: string | null;
    story: string | null;
    onScreenCopy: string | null;
    colorProfile?: ColorProfile | null;
    keepBackgroundPath?: string | null;
  },
): Promise<VisualStatus> {
  const sceneCost = tokenTotals(result.message);
  const image = result.imageUsage;
  const inputTokens = sceneCost.input + (image?.textInputTokens ?? 0) + (image?.imageInputTokens ?? 0);
  const outputTokens = sceneCost.output + (image?.imageOutputTokens ?? 0);
  const usd = sceneCost.usd + (image?.usd ?? 0);

  if (result.message) {
    await recordCost({
      runId: null,
      vendor: 'anthropic',
      component: 'reel-scene',
      inputTokens: sceneCost.input,
      outputTokens: sceneCost.output,
      usd: sceneCost.usd,
    });
  }
  if (image) {
    await recordCost({
      runId: null,
      vendor: 'openai',
      component: 'reel-background',
      inputTokens: image.textInputTokens + image.imageInputTokens,
      outputTokens: image.imageOutputTokens,
      usd: image.usd,
    });
  }

  const errors: string[] = [];
  let backgroundPath: string | null = null;
  let framePath: string | null = null;
  if (result.background) {
    const stored = await storePng(`${id}/background.png`, result.background);
    if (stored.error && extras.keepBackgroundPath) {
      backgroundPath = extras.keepBackgroundPath;
    } else {
      backgroundPath = stored.path;
      if (stored.error) errors.push(stored.error);
    }
  }
  if (result.frame) {
    const stored = await storePng(`${id}/frame.png`, result.frame);
    framePath = stored.path;
    if (stored.error) errors.push(stored.error);
  }
  // Only a missing background stops the video. Other upload errors are warnings.
  const blocking = errors.length > 0 && !backgroundPath;
  if (errors.length > 0 && !blocking) result.warnings = [...result.warnings, ...errors];
  const status = blocking ? 'failed' : result.status;
  const error = blocking ? [result.error, ...errors].filter(Boolean).join(' ') : result.error;

  await dbQuery(
    `UPDATE reels.visual_jobs
        SET status = $2,
            finished_at = now(),
            category = $3,
            story = $4,
            on_screen_copy = $5,
            scene = $6,
            image_prompt = $7,
            background_storage_path = $8,
            frame_storage_path = $9,
            background_qa = $10::jsonb,
            render = $11::jsonb,
            warnings = $12::jsonb,
            error = $13,
            input_tokens = $14,
            output_tokens = $15,
            usd = $16
      WHERE id = $1`,
    [
      id,
      status,
      extras.category,
      extras.story,
      extras.onScreenCopy,
      result.scene,
      result.imagePrompt,
      backgroundPath,
      framePath,
      result.qa ? JSON.stringify(result.qa) : null,
      JSON.stringify({
        lines: result.lines,
        details: result.details,
        model: VISUAL_IMAGE_MODEL,
        colorProfile: extras.colorProfile ?? 'noir',
      }),
      JSON.stringify(result.warnings),
      error,
      inputTokens,
      outputTokens,
      usd,
    ],
  );
  return status;
}

async function reuseBackground(
  id: string,
  postIdeaId: string,
  onScreenCopy: string,
  profile: ColorProfile,
): Promise<{
  path: string;
  category: string | null;
  story: string | null;
  result: ProduceFrameResult;
} | null> {
  const { rows } = await dbQuery<{
    background_storage_path: string;
    scene: string | null;
    image_prompt: string | null;
    category: string | null;
    story: string | null;
    background_qa: BackgroundQa | null;
  }>(
    `SELECT background_storage_path, scene, image_prompt, category, story, background_qa
       FROM reels.visual_jobs
      WHERE post_idea_id = $1
        AND id <> $2
        AND on_screen_copy = $3
        AND COALESCE(render->>'colorProfile', 'noir') = $4
        AND background_storage_path IS NOT NULL
        AND background_qa->>'pass' = 'true'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1`,
    [postIdeaId, id, onScreenCopy, profile],
  );
  const prior = rows[0];
  if (!prior) return null;

  try {
    const png = await downloadFrameObject(prior.background_storage_path);
    const rendered = await renderTextPng(png, onScreenCopy, profile);
    const warnings = [
      'Background reused from a passing frame with the same on-screen copy.',
      ...(rendered.ok ? rendered.rendered.warnings : []),
    ];
    return {
      path: prior.background_storage_path,
      category: prior.category,
      story: prior.story,
      result: rendered.ok
        ? {
            status: 'ok',
            scene: prior.scene,
            imagePrompt: prior.image_prompt,
            message: null,
            imageUsage: null,
            background: png,
            frame: rendered.rendered.png,
            qa: prior.background_qa,
            lines: rendered.rendered.lines,
            warnings,
            details: null,
            error: null,
          }
        : {
            status: 'ok',
            scene: prior.scene,
            imagePrompt: prior.image_prompt,
            message: null,
            imageUsage: null,
            background: png,
            frame: png,
            qa: prior.background_qa,
            lines: [],
            warnings: [...warnings, `Copy did not fit the still (${rendered.error}). The video plate sets the text on its own.`],
            details: rendered.details,
            error: null,
          },
    };
  } catch {
    return null;
  }
}

async function renderClaimed(id: string, client?: SceneClient, jev?: JevRunner): Promise<VisualStatus> {
  const { rows } = await dbQuery<{ slate_id: string | null; post_idea_id: string }>(
    `SELECT slate_id, post_idea_id FROM reels.visual_jobs WHERE id = $1`,
    [id],
  );
  const job = rows[0];
  if (!job?.slate_id) {
    await finishJob(
      id,
      emptyFailure('This frame has no slate.'),
      { category: null, story: null, onScreenCopy: null },
    );
    return 'failed';
  }

  const target = await loadTarget(job.slate_id, job.post_idea_id);
  if (!target) {
    await finishJob(
      id,
      emptyFailure('This post idea has no on-screen copy to put on a frame.'),
      { category: null, story: null, onScreenCopy: null },
    );
    return 'failed';
  }

  const notices: string[] = [];
  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    notices.push(`Month-to-date spend is $${spent.toFixed(2)}, at or over the $${MONTHLY_WATCH_USD} watch.`);
  }

  const category = visualCategory(target.bucket, primarySourceBucket(target.members));
  const story = buildStory(target.caption, target.members);
  const recent = await recentScenes(id);
  if (!client && !process.env.ANTHROPIC_API_KEY) {
    await finishJob(id, emptyFailure('ANTHROPIC_API_KEY is not set.'), {
      category,
      story,
      onScreenCopy: target.onScreenCopy,
    });
    return 'failed';
  }
  const sceneClient: SceneClient = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let profile: ColorProfile = 'noir';
  try {
    const routed = await routeColor(jev ?? createLiveJevRunner(), {
      onScreenCopy: target.onScreenCopy,
      postIdeaId: job.post_idea_id,
    });
    profile = routed.profile;
  } catch (error) {
    notices.push(`Color route failed, so the frame uses noir: ${error instanceof Error ? error.message : String(error)}`);
  }

  const reused = await reuseBackground(id, job.post_idea_id, target.onScreenCopy, profile);
  if (reused) {
    reused.result.warnings = [...notices, ...reused.result.warnings];
    return finishJob(id, reused.result, {
      category: reused.category ?? category,
      story: reused.story ?? story,
      onScreenCopy: target.onScreenCopy,
      colorProfile: profile,
      keepBackgroundPath: reused.path,
    });
  }

  const result = await produceFrame(
    { story, category, onScreenText: target.onScreenCopy, recentScenes: recent, profile },
    {
      writeScene: (input) => writeScene(sceneClient, input),
      generateBackground,
      checkBackground: (png) => checkBackgroundPng(png, profile),
      renderText: (png, copy) => renderTextPng(png, copy, profile),
    },
  );
  result.warnings = [...notices, ...result.warnings];
  return finishJob(id, result, { category, story, onScreenCopy: target.onScreenCopy, colorProfile: profile });
}

function emptyFailure(error: string): ProduceFrameResult {
  return {
    status: 'failed',
    scene: null,
    imagePrompt: null,
    message: null,
    imageUsage: null,
    background: null,
    frame: null,
    qa: null,
    lines: [],
    warnings: [],
    details: null,
    error,
  };
}

/** Claim one queued frame and run it. Null when the queue is empty. */
export async function claimAndRenderVisual(deps?: {
  client?: SceneClient;
  jev?: JevRunner;
}): Promise<{ id: string; status: VisualStatus } | null> {
  const id = await claimVisualJob();
  if (!id) return null;
  try {
    const status = await renderClaimed(id, deps?.client, deps?.jev);
    return { id, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dbQuery(
      `UPDATE reels.visual_jobs
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1 AND status = 'running'`,
      [id, message],
    );
    return { id, status: 'failed' };
  }
}
