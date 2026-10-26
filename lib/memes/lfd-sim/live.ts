/**
 * The LFD lab's live wiring (LFD lab plan §5): the lab database, Jev, the
 * runner a Run click wakes, and the two stages that run in a child Node
 * process (child.ts): Tommy's engine and the final render. Only a person's
 * click in the lab queues a simulation (CLAUDE.md Rule 1).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';

import { kickRunner, labDb } from '../live';
import { loadSeedTags, storyTagsSeedPath } from '../odds-store';
import { TAGGER_VERSION } from '../story-tags';
import { MEME_PIPELINE } from '../run';
import { regimeId } from '../regime';

import { ensureLfdSchema, ensureMemesSchema } from './router';
import type { Progress } from './report';
import { claimSim, runSim, type Engine, type EngineResult, type SimDeps } from './run';

type SimGlobals = { schema?: Promise<void>; schemaStamp?: number; seeded?: boolean; seedStamp?: number; running?: Promise<void> | null; lanes?: number };
const g = globalThis as unknown as { __memesLfdSim?: SimGlobals };
const sim = (g.__memesLfdSim ??= {});

const schemaStamp = () => fs.statSync(path.join(process.cwd(), 'db', 'memes_schema.sql')).mtimeMs + fs.statSync(path.join(process.cwd(), 'db', 'lfd_schema.sql')).mtimeMs;

/**
 * The lab database with the lfd schema in it (simulated runs and posts live there) and the seed tags loaded. The
 * schemas are re-applied (idempotent) whenever their files change, so a running dev server picks up new tables.
 */
export async function simDb() {
  const db = await labDb();
  const stamp = schemaStamp();
  if (!sim.schema || sim.schemaStamp !== stamp) {
    sim.schemaStamp = stamp;
    sim.schema = ensureMemesSchema(db).then(() => ensureLfdSchema(db));
  }
  await sim.schema;
  if (!sim.seeded) {
    sim.seeded = true;
    // Only a fresh server process can have orphaned a run: never touch one this process is running.
    if (!sim.lanes) {
      await db.query(`UPDATE memes.lfd_sims SET status = 'failed', finished_at = now(), stage = NULL, error = 'the server restarted mid-run' WHERE status = 'running'`);
    }
  }
  // The tagger's seed (scripts/memes_story_tags.ts): the graded stories' tags, so the odds have evidence from day one.
  // Re-applied whenever the seed file changes; the seed's tags win over any later tagging of the same story.
  const seedFile = storyTagsSeedPath(TAGGER_VERSION);
  const seedStamp = fs.existsSync(seedFile) ? fs.statSync(seedFile).mtimeMs : 0;
  if (sim.seedStamp !== seedStamp) {
    sim.seedStamp = seedStamp;
    await loadSeedTags(db);
  }
  return db;
}

const CHILD = path.join(process.cwd(), 'lib', 'memes', 'lfd-sim', 'child.ts');
const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

const PROGRESS = '@@lfd-progress ';

/**
 * Run child.ts in its own Node process (the slide renderer can't run inside the Next.js server). Progress lines
 * on its stdout go to `onProgress` as they arrive.
 */
function inChild<T>(mode: 'engine' | 'render', job: Record<string, unknown>, timeoutMs: number, onProgress?: (p: Progress) => void): Promise<T> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-sim-'));
  const jobFile = path.join(tmp, 'job.json');
  const out = path.join(tmp, 'out.json');
  fs.writeFileSync(jobFile, JSON.stringify({ ...job, out }));
  return new Promise<T>((resolve, reject) => {
    const child = spawn(TSX, [CHILD, mode, jobFile], { cwd: process.cwd(), env: process.env });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    let buf = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.startsWith(PROGRESS) && onProgress) {
          try {
            onProgress(JSON.parse(line.slice(PROGRESS.length)) as Progress);
          } catch {
            /* a malformed progress line is skipped */
          }
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) return reject(new Error(`${mode} process failed: ${stderr.trim().split('\n').slice(-4).join(' | ') || `exit ${code}`}`));
        resolve(JSON.parse(fs.readFileSync(out, 'utf8')) as T);
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}

const childEngine: Engine = (o) => inChild<EngineResult>('engine', { asOf: o.asOf.toISOString(), replay: o.replay, dir: o.dir }, 35 * 60_000, o.onProgress);
const childFitCheck: FitCheck = (post, opts) => inChild<FitResult>('render', { post, dir: opts?.screenshotDir ?? os.tmpdir() }, 10 * 60_000);

/** Simulations worked on at once (one lane each). Their meme runs still go through the one meme runner, oldest first. */
export const SIM_PARALLEL = 3;

export function kickSimRunner(): void {
  // One more lane per kick while fewer than SIM_PARALLEL are busy: a simulation queued while others run starts at once.
  const busy = sim.lanes ?? 0;
  if (busy >= SIM_PARALLEL) return;
  sim.lanes = busy + 1;
  const done = (async () => {
    const db = await simDb();
    const { newAnthropic } = await import('@/lib/anthropic-client');
    const { createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
    const { generateBriefs } = await import('../brief-from-body');
    const client = newAnthropic();
    for (;;) {
      const row = await claimSim(db);
      if (!row) return;
      const tally = createJevTally();
      const deps: SimDeps = {
        db,
        engine: childEngine,
        jev: tallied(createJevAsk(), tally),
        briefs: async (ids) => (await generateBriefs(db, ids, 'from-body', (p) => client.messages.create(p))).spent,
        kickMemes: kickRunner,
        fitCheck: childFitCheck,
        regime: regimeId(),
        now: () => new Date(),
      };
      await runSim(deps, row);
      await db.query(`UPDATE memes.lfd_sims SET cost_usd = cost_usd + $2, record = record || jsonb_build_object('jevUsd', $2::float8, 'pipeline', $3::text) WHERE id = $1`, [row.id, tally.costUsd, MEME_PIPELINE]);
    }
  })()
    .catch((err) => console.error('[memes] LFD simulation lane stopped:', err))
    .finally(() => {
      sim.lanes = Math.max(0, (sim.lanes ?? 1) - 1);
    });
  sim.running = done;
}
