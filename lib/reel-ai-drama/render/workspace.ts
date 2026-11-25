import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalHistory } from '@/explainers/reel-ai-drama/kit/music.mjs';
import { EXPLAINERS_DIR, prepareWorkspace as prepareExplainerWorkspace, workspacePaths, type MusicHistory, type Workspace } from '@/lib/explainers/render/workspace';
import type { TopicRow } from '@/lib/explainers/types';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';

/**
 * A Reel AI Drama render's workspace (pattern: lib/real-case/render/workspace.ts): the Explainer Reels
 * workspace, built by its own `prepareWorkspace` (init, the pinned HyperFrames CLI, Helios fonts, the
 * sound library), with this format's files laid over it. Nothing on the Explainer or Real Case side is
 * edited: the overlay writes only inside the job's project.
 *
 * Where it lives: `<jobsRoot>/<jobId>/render/` (project, home). The Explainer prepare wipes its job
 * folder, so it gets its own one level down; the harvest's media in `<jobsRoot>/<jobId>/media/` stay.
 *
 * What the overlay replaces, and why:
 *   CLAUDE.md, AGENTS.md, BRIEF.md       point at the kit guide (assets/kit/FRAME.md) and the locked inputs
 *   .claude/skills/helios-explainer-director/   removed: this format has no scene builder
 *   faceless-explainer/references/       removed: the Explainer's story design (its 8 beats) is another format's spec
 *   assets/kit                           this format's kit (explainers/reel-ai-drama/kit), never the world kit;
 *                                        the gallery and the harvest-time map renderer stay out
 *   assets/world, opener.json, opener sounds   removed (no opening sting, MD-13)
 *   assets/fonts, assets/Helios-mark.png       the kit's faces and the mark the close sets down
 *   frame.md, .hyperframes/caption-skin.html   from the `reel-ai-drama` preset (Helios captions, MD-42)
 *   music-avoid.json                     this format's own music rotation
 */

export const REEL_AI_DRAMA_DIR = path.join(EXPLAINERS_DIR, 'reel-ai-drama');
export const KIT_DIR = path.join(REEL_AI_DRAMA_DIR, 'kit');
export const PRESET_DIR = path.join(REEL_AI_DRAMA_DIR, 'presets');
export const PRESET = 'reel-ai-drama';

export const PROJECT_INSTRUCTIONS = [
  '# Helios Reel AI Drama job',
  '',
  'This project is one Reel AI Drama reel. SCRIPT.md, STORYBOARD.md and assets/inventory.json are locked inputs.',
  'Code compiles every frame from assets/plan.json (lib/reel-ai-drama/render/compile.ts) with the kit described in',
  'assets/kit/FRAME.md: assets/frames/ is generated, never edited. Nothing else applies here.',
  '',
].join('\n');

/** Files of the kit a job never gets: repo tools (the gallery, the harvest-time map renderer) and the fonts folder (copied to assets/fonts). */
const KIT_EXCLUDE = /(^|[\\/])(gallery\.(html|mjs)|maps|fonts)([\\/]|$)/;
/** The Explainer opener sounds the Explainer prepare copies into assets/sfx. */
const EXPLAINER_OPENER_SOUNDS = ['riser.mp3', 'impact-bass-1.mp3'];
/** This format's music rotation, beside the jobs folder, never shared with the Explainer or Real Case one. */
export function musicHistoryPath(jobsRoot: string): string {
  return path.join(path.dirname(path.resolve(jobsRoot)), 'reel-ai-drama-music-history.json');
}

/** The rotation's history: one entry per reel, oldest first; music.mjs writes it the moment a reel chooses (MD-144). */
export type ReelMusicHistory = MusicHistory & { reels?: { job: string | null; ids: string[] }[] };

/** Each past job's tracks from its assets/bgm/choice.json, oldest first (for a history file that doesn't exist yet). */
function reelsOnDisk(jobsRoot: string): { job: string; ids: string[] }[] {
  let jobs: string[] = [];
  try {
    jobs = fs.readdirSync(jobsRoot);
  } catch {
    return [];
  }
  return jobs
    .flatMap((job) => {
      const file = path.join(jobsRoot, job, 'render', 'project', 'assets', 'bgm', 'choice.json');
      try {
        const choice = JSON.parse(fs.readFileSync(file, 'utf8')) as { id?: string; ids?: string[] };
        const ids = (choice.ids ?? (choice.id ? [choice.id] : [])).map(String);
        return ids.length ? [{ job, ids, at: fs.statSync(file).mtimeMs }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at - b.at)
    .map(({ job, ids }) => ({ job, ids }));
}

export function readMusicHistory(jobsRoot: string): ReelMusicHistory {
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(musicHistoryPath(jobsRoot), 'utf8'));
  } catch {
    const reels = reelsOnDisk(jobsRoot);
    raw = reels.length ? { used: reels.length, recent: reels.flatMap((r) => r.ids), reels } : null;
  }
  const history = normalHistory(raw) as Required<ReelMusicHistory>;
  return Array.isArray((raw as { reels?: unknown } | null)?.reels) ? history : { used: history.used, recent: history.recent } as ReelMusicHistory;
}

/** The topic shape the Explainer prepare needs (its BRIEF.md is replaced by the overlay). */
export function workspaceTopic(jobId: string): TopicRow {
  return { id: jobId, title: 'Reel AI Drama', scope: null, term: null, source_url: null, source_text: null, jev_notes: {} } as unknown as TopicRow;
}

/** frame.md and the caption skin from the `reel-ai-drama` preset, with the faceless skill's build-frame. */
export function buildFrameWith(run: Runner) {
  return (projectDir: string, presetDir: string): void => {
    const script = path.join(EXPLAINERS_DIR, 'hyperframes-skills', 'faceless-explainer', 'scripts', 'build-frame.mjs');
    const res = run(process.execPath, [script, '--preset', PRESET, '--preset-dir', presetDir, '--hyperframes', '.'], { cwd: projectDir });
    if (res.status !== 0) throw new Error(`build-frame (${PRESET}) failed: ${tail(res, 600)}`);
  };
}

/** Lay the Reel AI Drama files over a prepared Explainer workspace's project (deterministic, no model). */
export function applyOverlay(
  projectDir: string,
  { buildFrame, musicHistory = null, kitDir = KIT_DIR }: {
    buildFrame: (projectDir: string, presetDir: string) => void;
    musicHistory?: (ReelMusicHistory & { ledger?: string; job?: string }) | null;
    kitDir?: string;
  },
): void {
  const write = (rel: string, content: string) => {
    const file = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  for (const file of ['CLAUDE.md', 'AGENTS.md']) write(file, PROJECT_INSTRUCTIONS);
  write('BRIEF.md', '# Reel AI Drama\n\nThe story is in SCRIPT.md (the narration) and STORYBOARD.md (the director\'s frames); the pictures are in assets/inventory.json and assets/media/. The kit guide is assets/kit/FRAME.md.\n');
  fs.rmSync(path.join(projectDir, '.claude', 'skills', 'helios-explainer-director'), { recursive: true, force: true });
  fs.rmSync(path.join(projectDir, '.claude', 'skills', 'faceless-explainer', 'references'), { recursive: true, force: true });

  const assets = path.join(projectDir, 'assets');
  fs.rmSync(path.join(assets, 'kit'), { recursive: true, force: true });
  fs.rmSync(path.join(assets, 'world'), { recursive: true, force: true });
  fs.rmSync(path.join(assets, 'opener.json'), { force: true });
  for (const f of EXPLAINER_OPENER_SOUNDS) fs.rmSync(path.join(assets, 'sfx', f), { force: true });
  fs.cpSync(kitDir, path.join(assets, 'kit'), { recursive: true, filter: (src) => !KIT_EXCLUDE.test(path.relative(kitDir, src)) });
  for (const dir of ['frames', 'media', 'fonts']) fs.mkdirSync(path.join(assets, dir), { recursive: true });
  const fonts = path.join(kitDir, 'fonts');
  if (fs.existsSync(fonts)) for (const f of fs.readdirSync(fonts)) if (/\.(ttf|otf|woff2?)$/.test(f)) fs.copyFileSync(path.join(fonts, f), path.join(assets, 'fonts', f));
  const mark = path.join(EXPLAINERS_DIR, 'design', 'helios-design-system', 'assets', 'Helios-mark.png');
  if (fs.existsSync(mark)) fs.copyFileSync(mark, path.join(assets, 'Helios-mark.png'));
  if (musicHistory) fs.writeFileSync(path.join(projectDir, 'music-avoid.json'), `${JSON.stringify(musicHistory)}\n`);
  buildFrame(projectDir, PRESET_DIR);
}

export type PrepareDeps = {
  /** The Explainer workspace prepare (stubbed in tests: it runs `hyperframes init`). */
  base?: typeof prepareExplainerWorkspace;
  run?: Runner;
  buildFrame?: (projectDir: string, presetDir: string) => void;
  kitDir?: string;
};

/**
 * A resumed job's workspace as its last run left it (voice, compiled frames, render), nothing wiped; null when no project
 * was built there. The caller decides which of its steps are still current.
 */
export function reuseWorkspace({ jobsRoot, jobId }: { jobsRoot: string; jobId: string }): Workspace | null {
  const jobDir = path.join(path.resolve(jobsRoot), jobId);
  const ws = workspacePaths(jobDir, 'render');
  if (!fs.existsSync(path.join(ws.projectDir, 'STORYBOARD.md'))) return null;
  const tmpDir = path.join(os.tmpdir(), `hx-${jobId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return { jobDir, projectDir: ws.projectDir, homeDir: ws.homeDir, tmpDir };
}

/** The job's workspace: the Explainer prepare one level down in the job folder, then the overlay. */
export async function prepareWorkspace({ jobsRoot, jobId }: { jobsRoot: string; jobId: string }, deps: PrepareDeps = {}): Promise<Workspace> {
  const base = deps.base ?? prepareExplainerWorkspace;
  const jobDir = path.join(path.resolve(jobsRoot), jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const ws = base({ jobsRoot: jobDir, jobId: 'render', topic: workspaceTopic(jobId), sourceText: null, analogy: null, gap: null });
  applyOverlay(ws.projectDir, {
    buildFrame: deps.buildFrame ?? buildFrameWith(deps.run ?? spawnRunner),
    // `ledger`: music.mjs re-reads and writes the history at pick time, so jobs see each other's choices.
    musicHistory: { ...readMusicHistory(jobsRoot), ledger: musicHistoryPath(jobsRoot), job: jobId },
    ...(deps.kitDir ? { kitDir: deps.kitDir } : {}),
  });
  // A short temp dir per job; the base's would be shared.
  const tmpDir = path.join(os.tmpdir(), `hx-${jobId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return { jobDir, projectDir: ws.projectDir, homeDir: ws.homeDir, tmpDir };
}
