/**
 * The live wiring: the only place the real builder modules are imported (CONTRACT.md § B5). Tests never
 * import this file. Each builder's `deps` object is built here from one shared base (db, the streaming
 * Messages call, the prompt loader, the model from settings, the job's Jev runner). Where a builder's
 * deps type differs from this base, the typecheck says so at integration (see notes/B5.md).
 */
import path from 'node:path';

import { anthropic } from '@/lib/anthropic';
import type { Queryable } from '@/lib/explainers/db';
import { loadAgentQuery, runAgentSession } from '@/lib/explainers/render/agent';
import type { ArtifactStore } from '@/lib/explainers/storage';
// B1 development
import { runCalibration } from '@/lib/reel-ai-drama/development/calibration';
import { nextForProduction, tendPool } from '@/lib/reel-ai-drama/development/pool';
import { anthropicCreate } from '@/lib/reel-ai-drama/development/producer';
import { newsTouching } from '@/lib/reel-ai-drama/development/ledger';
import { liveStoriesDb } from '@/lib/stories/db';
import { runDevelopmentSession } from '@/lib/reel-ai-drama/development/session';
import { liveVisualsCheckDeps } from '@/lib/reel-ai-drama/development/visuals-check';
// B2 reporting + harvest
import { harvestVisuals } from '@/lib/reel-ai-drama/harvest/harvest';
import { liveHarvestDeps } from '@/lib/reel-ai-drama/harvest/live';
import { recordUses } from '@/lib/reel-ai-drama/harvest/reuse';
import { reportStory } from '@/lib/reel-ai-drama/reporting/report';
// B3 prompts, writing, checks
import { checkFacts } from '@/lib/reel-ai-drama/checks/facts';
import { checkFirstViewer } from '@/lib/reel-ai-drama/checks/first-viewer';
import { checkIntegrity } from '@/lib/reel-ai-drama/checks/integrity';
import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { directReel } from '@/lib/reel-ai-drama/writing/director';
import { writePost } from '@/lib/reel-ai-drama/writing/post';
import { reviseScript, writeScript } from '@/lib/reel-ai-drama/writing/writer';
// B4 kit + render
import { assembleProject, contactSheet, KIT_GUIDE, prepareWorkspace, renderVideo, runVoice } from '@/lib/reel-ai-drama/render';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { makeAssets } from '@/lib/reel-ai-drama/render/make';
import { designSound } from '@/lib/reel-ai-drama/render/sound-design';
import { RecordingDramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { dramaAgentOverrides, withAgentOverrides } from '@/lib/reel-ai-drama/production/agents';
import type { ProductionDeps, StepCtx } from '@/lib/reel-ai-drama/production/run';
import type { ScheduleDeps } from '@/lib/reel-ai-drama/production/schedule';
import { loadSettings } from '@/lib/reel-ai-drama/settings';
import { liveJevTransport } from '@/lib/reels/jev/client';

export const JOBS_ROOT = process.env.REEL_AI_DRAMA_JOBS_DIR || path.join(process.cwd(), '.explainers-local', 'reel-ai-drama', 'jobs');

/** The kit's project-files writer (B4, an .mjs module), loaded at run time. */
async function writeProjectFiles(projectDir: string, input: Parameters<ProductionDeps['render']['writeProjectFiles']>[1]): Promise<unknown> {
  const kit = (await import(path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit', 'project-files.mjs'))) as {
    writeProjectFiles: (dir: string, i: typeof input) => unknown;
  };
  return kit.writeProjectFiles(projectDir, input);
}

export async function liveProductionDeps(input: {
  db: Queryable;
  store: ArtifactStore;
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  jobsRoot?: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}): Promise<ProductionDeps> {
  const { db } = input;
  const query = withAgentOverrides(await loadAgentQuery(), dramaAgentOverrides(loadPrompt('frame-worker')));
  const jev = (ctx: StepCtx) => new RecordingDramaJevRunner(liveJevTransport, db, { mode: ctx.mode, jobId: ctx.jobId });
  const base = (ctx: StepCtx, component: string, model: string) => ({
    db,
    create: anthropicCreate(anthropic, component),
    loadPrompt,
    model,
    jobId: ctx.jobId,
    mode: ctx.mode,
    settings: ctx.settings,
    jev: jev(ctx),
  });
  return {
    db,
    store: input.store,
    jobsRoot: input.jobsRoot ?? JOBS_ROOT,
    secrets: input.secrets,
    log: input.log,
    prompts: (name) => loadPrompt(name),
    jev,
    pool: { nextForProduction },
    reporting: {
      reportStory: (pitch, ctx) =>
        reportStory({ db, create: anthropicCreate(anthropic, 'reporting'), loadPrompt, model: ctx.settings.reporting_model }, pitch, { jobId: ctx.jobId, mode: ctx.mode }),
    },
    harvest: {
      // A fresh browser and source set per harvest, closed after it (B2 liveHarvestDeps).
      harvestVisuals: async (i) => {
        const live = await liveHarvestDeps(db, { anthropic, loadPrompt });
        if (live.notes.length) input.log?.('harvest_notes', { jobId: i.jobId, notes: live.notes });
        try {
          return await harvestVisuals(live.deps, i);
        } finally {
          await live.close();
        }
      },
      recordUses,
    },
    writing: {
      writeScript: (i, ctx) => writeScript(base(ctx, 'writer', ctx.settings.writer_model), i),
      reviseScript: (i, ctx) => reviseScript(base(ctx, 'writer_revise', ctx.settings.writer_model), i),
      directReel: (i, ctx) => directReel(base(ctx, 'director', ctx.settings.director_model), i),
      writePost: (i, ctx) => writePost(base(ctx, 'post_text', ctx.settings.writer_model), i),
    },
    checks: {
      checkFacts: (runner, i) => checkFacts(runner, i),
      // Asset `file` paths are relative to the harvest dir (run.ts keeps it after copying it into the job).
      checkIntegrity: (i, ctx) =>
        checkIntegrity({ ...base(ctx, 'integrity', ctx.settings.vision_model), jobDir: path.join(input.jobsRoot ?? JOBS_ROOT, '_harvest', ctx.jobId) }, i),
      checkFirstViewer: (i, ctx) => checkFirstViewer(base(ctx, 'first_viewer', ctx.settings.vision_model), i),
    },
    render: {
      kitGuide: KIT_GUIDE,
      prepareWorkspace,
      writeProjectFiles,
      runVoice,
      makeAssets: (i, ctx) =>
        makeAssets(i, { record: (e) => recordCost(db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'openai', component: 'make', usd: e.usd }) }),
      designSound: (i, ctx) =>
        designSound(i, { create: anthropicCreate(anthropic, 'sound_design'), model: ctx.settings.orchestrator_model, loadPrompt: () => loadPrompt('sound-designer'), db, jobId: ctx.jobId, mode: ctx.mode }),
      assembleProject,
      renderVideo,
      contactSheet,
    },
    agent: { runSession: (s) => runAgentSession({ ...s, query }) },
  };
}

/** One development session (B1), live: the producer, Jev, the visuals check and news touching a player. */
export async function runLiveDevelopment(db: Queryable, trigger: 'auto' | 'click'): Promise<unknown> {
  const settings = await loadSettings(db);
  return runDevelopmentSession(
    {
      db,
      settings,
      producer: { create: anthropicCreate(anthropic, 'producer'), loadPrompt },
      jevTransport: liveJevTransport,
      visuals: liveVisualsCheckDeps({ client: anthropic, visionModel: settings.vision_model, lookPrompt: loadPrompt('visuals-look'), serperApiKey: process.env.SERPER_API_KEY ?? null }),
      // The Hub news pool lives on the shared stories database, not the explainers one. A failed read
      // (no shared DB locally) means no news reopens this session, never a failed session.
      news: (now, days) => newsTouching(liveStoriesDb, now, days).catch(() => []),
    },
    { trigger },
  );
}

/** Calibration (B1, MD-52): Jev scores only, logged and priced as development. */
export async function runLiveCalibration(db: Queryable): Promise<unknown> {
  const settings = await loadSettings(db);
  return runCalibration({ jev: new RecordingDramaJevRunner(liveJevTransport, db, { mode: 'development' }), settings });
}

export function liveScheduleDeps(db: Queryable, log?: ScheduleDeps['log']): ScheduleDeps {
  return { db, runDevelopmentSession: ({ trigger }) => runLiveDevelopment(db, trigger), nextForProduction, tendPool, log };
}
