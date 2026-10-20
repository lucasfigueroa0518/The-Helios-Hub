/**
 * The LFD lab's stages that must run outside the Next.js server (live.ts spawns this with tsx): Tommy's engine
 * and the slide render both draw the slide template, which Next treats as browser code inside the server.
 *
 *   tsx lib/memes/lfd-sim/child.ts engine <job.json>   job: { asOf, replay, dir, out }
 *   tsx lib/memes/lfd-sim/child.ts render <job.json>   job: { post, dir, out }
 *
 * The engine writes its lfd.runs and lfd.posts rows to an in-memory database (nothing reaches Supabase: the Hub
 * side is read only) and saves the EngineResult to `out`; render saves the FitResult. Spend is capped as in a
 * real run.
 */
import fs from 'node:fs';

import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

/** Prefix of a progress line on stdout. */
export const PROGRESS = '@@lfd-progress ';

async function main() {
  const [mode, jobFile] = process.argv.slice(2);
  const job = JSON.parse(fs.readFileSync(jobFile!, 'utf8')) as Record<string, unknown>;
  if (mode === 'engine') {
    const { PGlite } = await import('@electric-sql/pglite');
    const { pgliteDb } = await import('../db');
    const { ensureLfdSchema, readOnly } = await import('./router');
    const { inProcessEngine } = await import('./run');
    const { liveHubQuery } = await import('@/lib/social-hub/db');
    const { liveLfdDeps } = await import('@/lib/lfd/live');
    const local = pgliteDb(new PGlite());
    await ensureLfdSchema(local);
    const hub = readOnly(liveHubQuery);
    const engine = inProcessEngine({ local, hub, lfdDeps: (o) => liveLfdDeps(hub, { capUsd: o.capUsd, trigger: 'manual', now: o.now }) });
    // Progress lines on stdout feed the lab's live run report (live.ts reads them as they come).
    const onProgress = (p: { step: string; usd: number }) => process.stdout.write(`${PROGRESS}${JSON.stringify(p)}\n`);
    const result = await engine({ asOf: new Date(String(job.asOf)), replay: Boolean(job.replay), dir: String(job.dir), onProgress });
    fs.writeFileSync(String(job.out), JSON.stringify(result));
  } else if (mode === 'render') {
    const { checkRenderFit } = await import('@/lib/social/render/fit-check');
    const fit = await checkRenderFit(job.post as never, { screenshotDir: String(job.dir), name: 'slide' });
    fs.writeFileSync(String(job.out), JSON.stringify(fit));
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
