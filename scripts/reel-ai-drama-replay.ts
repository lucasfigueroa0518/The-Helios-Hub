/**
 * Replays a saved reel from hand-written or converted blueprints, free and local (ITERATION-10-CONTRACT §7):
 *   npx tsx scripts/reel-ai-drama-replay.ts <projectDir> <blueprintsJson> [--out <dir>] [--no-render] [--in-place]
 * Remeasures the pictures, writes the blueprints into the plan and storyboard, compiles those frames, assembles and renders with
 * the project's existing voice, music and pictures, and saves video.mp4, a contact sheet and a still of each compiled frame.
 * `--no-render` stops after compile and measure, with the stills. `<blueprintsJson>` is `{ "<frame>": <blueprint> }`, optionally
 * under `blueprints`.
 *
 * No paid call can fire. Every path this takes: applyOverlay (file copies and the local build-frame), remeasure (local pixels and
 * Tesseract), compile (its OCR is local), the kit's assemble with --no-music (pace, mount, measure, sound placement from the local
 * library, captions, index, transitions), try, bounds, screen, compiled-read (local browser), `hyperframes render` with telemetry
 * off, and ffmpeg. The only vendor call on that path is music.mjs's HeyGen search, which --no-music skips and which needs a key
 * this process no longer has: every secret is removed from the environment below, so a child can't reach a vendor either.
 */
import fs from 'node:fs';
import path from 'node:path';

import { blueprintAssets, type Blueprint, type DirectorPlan, type StoryboardFrame } from '@/lib/reel-ai-drama/types';
import { parseFrames } from '@/explainers/reel-ai-drama/kit/frames.mjs';
import { withBlueprints } from '@/explainers/reel-ai-drama/kit/project-files.mjs';

const SECRET = /(API_?KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)/i;

/** Every secret out of the environment, for this process and what it spawns. */
export function dropSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const gone = Object.keys(env).filter((k) => SECRET.test(k));
  for (const k of gone) delete env[k];
  return gone;
}

/** A job's own folder is never replayed in place: it would overwrite what shipped. */
export function originalsProblem(projectDir: string): string | null {
  return /[\\/]reel-ai-drama[\\/]jobs[\\/]/.test(path.resolve(projectDir)) ? `${projectDir} is a job's own project; copy it first (or pass --in-place)` : null;
}

/** The plan a saved project's storyboard describes. Blueprints come from the replay's file. Pure. */
export function storyboardPlan(storyboard: string): DirectorPlan {
  const ids = (v: unknown) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const frames = (parseFrames(storyboard) as { number: number; name: string; fields: Record<string, string> }[]).map((f): StoryboardFrame => ({
    n: f.number,
    name: f.name,
    line_ids: ids(f.fields.lines),
    treatment: f.fields.treatment ?? 'photo',
    asset_ids: ids(f.fields.assets),
    purpose: f.fields.purpose ?? '',
    music: (f.fields.music as StoryboardFrame['music']) ?? 'hold',
    on_screen: f.fields.on_screen && f.fields.on_screen !== 'none' ? f.fields.on_screen : null,
  }));
  return { frames, lines_back: [] } as DirectorPlan;
}

/** The file's blueprints by frame number. Throws on a file that isn't one. Pure. */
export function blueprintsIn(raw: unknown): Map<number, Blueprint> {
  const r = raw as { blueprints?: unknown } | null;
  const map = (r?.blueprints ?? r) as Record<string, Blueprint> | null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('blueprints: expected { "<frame number>": <blueprint> }');
  return new Map(Object.entries(map).map(([n, b]) => {
    if (!Number.isInteger(Number(n)) || !b || typeof b !== 'object') throw new Error(`blueprints: "${n}" is not a frame number with a blueprint`);
    return [Number(n), b];
  }));
}

/** The plan with these blueprints, each frame's `asset_ids` holding what its blueprint shows. Pure. */
export function planWith(plan: DirectorPlan, blueprints: ReadonlyMap<number, Blueprint>): DirectorPlan {
  return {
    ...plan,
    frames: plan.frames.map((f) => {
      const blueprint = blueprints.get(f.n);
      return blueprint ? { ...f, blueprint, asset_ids: [...new Set(blueprintAssets(blueprint))] } : f;
    }),
  };
}

export type ReplayOptions = { out?: string; render?: boolean };

export async function replay(projectDir: string, blueprintsFile: string, { out = path.join(projectDir, 'replay'), render = true }: ReplayOptions = {}) {
  // Imported here so the secrets are gone before anything reads them at load.
  const [{ applyOverlay, buildFrameWith }, { spawnRunner }, { remeasure }, { compileReel, readCompiled }, { assembleProject }, { checkPlanCarried, planMissText }, { contactSheet, renderVideo }] = await Promise.all([
    import('@/lib/reel-ai-drama/render/workspace'),
    import('@/lib/reel-ai-drama/render/runner'),
    import('@/scripts/reel-ai-drama-remeasure'),
    import('@/lib/reel-ai-drama/render/compile'),
    import('@/lib/reel-ai-drama/render/assemble'),
    import('@/lib/reel-ai-drama/render/plan-carried'),
    import('@/lib/reel-ai-drama/render/video'),
  ]);
  const blueprints = blueprintsIn(JSON.parse(fs.readFileSync(blueprintsFile, 'utf8')));
  fs.mkdirSync(out, { recursive: true });

  // This checkout's kit over the saved project. The rotation's real history stays out of a replay.
  applyOverlay(projectDir, { buildFrame: buildFrameWith(spawnRunner) });
  const avoid = path.join(projectDir, 'music-avoid.json');
  if (fs.existsSync(avoid)) {
    const { ledger: _ledger, job: _job, ...rest } = JSON.parse(fs.readFileSync(avoid, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(avoid, `${JSON.stringify(rest)}\n`);
  }

  const { inventory, notes } = await remeasure(projectDir);
  const planFile = path.join(projectDir, 'assets', 'plan.json');
  const storyboardFile = path.join(projectDir, 'STORYBOARD.md');
  const storyboard = fs.readFileSync(storyboardFile, 'utf8');
  const saved = fs.existsSync(planFile) ? (JSON.parse(fs.readFileSync(planFile, 'utf8')) as DirectorPlan) : storyboardPlan(storyboard);
  const plan = planWith(saved, blueprints);
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 1)}\n`);
  fs.writeFileSync(storyboardFile, withBlueprints(storyboard, plan.frames));

  const only = [...blueprints.keys()];
  const compiled = await compileReel({ plan, inventory, projectDir, only });
  const assembled = await assembleProject(projectDir, { heygenApiKey: '', music: false });
  const stillsDir = path.join(out, 'stills');
  const read = readCompiled(projectDir, { stills: stillsDir, only: compiled.frames.filter((f) => only.includes(f.n)).map((f) => f.id) });
  const planned = { ...plan, frames: plan.frames.filter((f) => only.includes(f.n)) };
  const misses = read.ok ? checkPlanCarried(planned, read.frames).map(planMissText) : [`The plan check could not run: ${read.skipped ?? 'no reading'}`];

  let video: string | null = null;
  let sheet: string | null = null;
  if (render) {
    const made = await renderVideo(projectDir);
    video = path.join(out, 'video.mp4');
    fs.copyFileSync(made, video);
    const madeSheet = await contactSheet(projectDir, made);
    sheet = path.join(out, path.basename(madeSheet));
    fs.copyFileSync(madeSheet, sheet);
  }
  const report = { frames: compiled.frames.filter((f) => only.includes(f.n)), compile_problems: compiled.problems, assemble_problems: assembled.problems, warnings: assembled.warnings, plan_misses: misses, reports: Object.fromEntries(Object.entries(read.frames).map(([n, f]) => [n, f.reports ?? []])), remeasure_notes: notes, stills: read.stills.map((s) => s.file), video, sheet };
  fs.writeFileSync(path.join(out, 'replay.json'), `${JSON.stringify(report, null, 1)}\n`);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    args.splice(i, 1);
    return true;
  };
  const valueOf = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const [, value] = args.splice(i, 2);
    return value ?? null;
  };
  const noRender = flag('--no-render');
  const inPlace = flag('--in-place');
  const out = valueOf('--out');
  const [projectDir, blueprintsFile] = args;
  if (!projectDir || !blueprintsFile) {
    process.stderr.write('usage: reel-ai-drama-replay <projectDir> <blueprintsJson> [--out <dir>] [--no-render] [--in-place]\n');
    process.exit(2);
  }
  const problem = inPlace ? null : originalsProblem(projectDir);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    process.exit(2);
  }
  dropSecrets();
  const report = await replay(path.resolve(projectDir), path.resolve(blueprintsFile), { render: !noRender, ...(out ? { out: path.resolve(out) } : {}) });
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
}

if (process.argv[1]?.endsWith('reel-ai-drama-replay.ts')) void main();
