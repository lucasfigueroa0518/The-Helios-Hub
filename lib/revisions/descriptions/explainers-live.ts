/**
 * Live deps for the Explainers revision description (explainers.ts). Every service import is lazy,
 * so importing the registry opens no database, loads no Agent SDK and touches no disk.
 *
 * Where it runs: the revisions step of the social worker (helios-social on helios-social-worker),
 * which shares worker.env with helios-explainers: the same EXPLAINERS_JOBS_DIR (the job folders
 * live on that VM), the same Explainers database (EXPLAINERS_DB=supabase: the main database the
 * revisions log is in) and the same artifact store (EXPLAINERS_STORAGE=bucket).
 *
 * The session is the only billable call of a scene redo (the voice and music are kept; the caption
 * is not rewritten). Its spend is charged to the revision's meter message by message through a
 * ChargedSpendMeter that also keeps the job's own per-reel cap (spend_cap_usd, carrying spend_usd),
 * and the session aborts the moment either is passed.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { ExplainersDeps } from './explainers';

/** EXPLAINERS_JOBS_DIR as scripts/explainers_worker.ts reads it. */
export function liveJobsRoot(): string {
  return process.env.EXPLAINERS_JOBS_DIR || path.join(process.cwd(), '.explainers-local', 'jobs');
}

export const liveExplainersDeps: ExplainersDeps = {
  explainersDb: async () => (await import('@/lib/explainers/connection')).explainersDb(),
  jobsRoot: liveJobsRoot,
  folderExists: async (jobId) => {
    const project = path.join(liveJobsRoot(), jobId, 'project');
    return fs.existsSync(path.join(project, 'STORYBOARD.md')) && fs.existsSync(path.join(project, 'SCRIPT.md'));
  },
  redoScene: async (input, m) => {
    if (m.stopped()) m.halt();
    const [{ explainersDb }, { rebuildScene }, { ChargedSpendMeter }, { loadAgentQuery }, { loadSettings }] = await Promise.all([
      import('@/lib/explainers/connection'),
      import('@/lib/explainers/render/job'),
      import('@/lib/explainers/render/meter'),
      import('@/lib/explainers/render/agent'),
      import('@/lib/explainers/settings'),
    ]);
    const db = await explainersDb();
    const settings = await loadSettings(db);
    if (!settings.voice_id) throw new Error('no HeyGen voice id is set (Settings → HeyGen voice ID)');
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const heygenApiKey = process.env.HEYGEN_API_KEY?.trim();
    if (!anthropicApiKey || !heygenApiKey) throw new Error('the worker has no ANTHROPIC_API_KEY or HEYGEN_API_KEY');
    const meter = new ChargedSpendMeter(input.job.spend_cap_usd, input.job.spend_usd, (usd) => m.spend(usd));
    return rebuildScene(
      { db, query: await loadAgentQuery(), jobsRoot: liveJobsRoot(), secrets: { anthropicApiKey, heygenApiKey }, voiceId: settings.voice_id, meter },
      input.job,
      { frameId: input.frameId, frameNumber: input.frameNumber, note: input.note },
    );
  },
  store: async (key, localPath) => {
    const { artifactStoreFromEnv } = await import('@/lib/explainers/storage');
    const out = await artifactStoreFromEnv().put(key, localPath);
    return { storagePath: out.storagePath, bytes: out.bytes, location: out.location ?? 'local' };
  },
  unscheduleJob: async (db, jobId) => (await import('@/lib/explainers/publish/schedule')).unscheduleJob(db, jobId),
};
