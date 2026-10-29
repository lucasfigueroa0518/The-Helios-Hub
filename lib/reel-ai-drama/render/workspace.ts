import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EXPLAINERS_DIR, prepareWorkspace as prepareExplainerWorkspace, type MusicHistory, type Workspace } from '@/lib/explainers/render/workspace';
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
 *   faceless-explainer SKILL.md, sub-agents/frame-worker.md   B3's build-workflow and frame-worker
 *                                        prompts, when they exist (the session also gets them from loadPrompt)
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
  'This project is one Reel AI Drama reel. SCRIPT.md, STORYBOARD.md and assets/inventory.json are locked inputs:',
  'build each storyboard frame as assets/frames/<id>.js plus its events file, with the kit described in',
  'assets/kit/FRAME.md. Nothing else applies here.',
  '',
].join('\n');

/** Files of the kit a job never gets: repo tools (the gallery, the harvest-time map renderer) and the fonts folder (copied to assets/fonts). */
const KIT_EXCLUDE = /(^|[\\/])(gallery\.(html|mjs)|maps|fonts)([\\/]|$)/;
/** The Explainer opener sounds the Explainer prepare copies into assets/sfx. */
const EXPLAINER_OPENER_SOUNDS = ['riser.mp3', 'impact-bass-1.mp3'];
/** B3's prompts laid over the faceless-explainer workflow files when they exist. */
export const PROMPT_OVERLAYS: [string, string][] = [
  ['build-workflow.md', '.claude/skills/faceless-explainer/SKILL.md'],
  ['frame-worker.md', '.claude/skills/faceless-explainer/sub-agents/frame-worker.md'],
];

/** This format's music rotation, beside the jobs folder, never shared with the Explainer or Real Case one. */
export function musicHistoryPath(jobsRoot: string): string {
  return path.join(path.dirname(path.resolve(jobsRoot)), 'reel-ai-drama-music-history.json');
}

export function readMusicHistory(jobsRoot: string): MusicHistory {
  try {
    const parsed = JSON.parse(fs.readFileSync(musicHistoryPath(jobsRoot), 'utf8')) as Partial<MusicHistory>;
    return { used: Number(parsed.used) || 0, recent: Array.isArray(parsed.recent) ? parsed.recent.map(String).slice(-10) : [] };
  } catch {
    return { used: 0, recent: [] };
  }
}

/** After a reel is made: count its tracks (assets/bgm/choice.json) in this format's rotation. */
export function recordMusicChoice(jobsRoot: string, projectDir: string): string[] {
  let ids: string[] = [];
  try {
    const choice = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'bgm', 'choice.json'), 'utf8')) as { id?: string; ids?: string[] };
    ids = (choice.ids ?? (choice.id ? [choice.id] : [])).map(String);
  } catch {
    return [];
  }
  if (!ids.length) return [];
  const history = readMusicHistory(jobsRoot);
  fs.writeFileSync(musicHistoryPath(jobsRoot), `${JSON.stringify({ used: history.used + 1, recent: [...history.recent, ...ids].slice(-10) }, null, 1)}\n`);
  return ids;
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
  { buildFrame, musicHistory = null, kitDir = KIT_DIR, promptsDir = path.join(REEL_AI_DRAMA_DIR, 'prompts') }: {
    buildFrame: (projectDir: string, presetDir: string) => void;
    musicHistory?: MusicHistory | null;
    kitDir?: string;
    promptsDir?: string;
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
  for (const [from, to] of PROMPT_OVERLAYS) {
    const src = path.join(promptsDir, from);
    if (fs.existsSync(src)) write(to, fs.readFileSync(src, 'utf8'));
  }

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
  promptsDir?: string;
};

/** The job's workspace: the Explainer prepare one level down in the job folder, then the overlay. */
export async function prepareWorkspace({ jobsRoot, jobId }: { jobsRoot: string; jobId: string }, deps: PrepareDeps = {}): Promise<Workspace> {
  const base = deps.base ?? prepareExplainerWorkspace;
  const jobDir = path.join(path.resolve(jobsRoot), jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const ws = base({ jobsRoot: jobDir, jobId: 'render', topic: workspaceTopic(jobId), sourceText: null, analogy: null, gap: null });
  applyOverlay(ws.projectDir, {
    buildFrame: deps.buildFrame ?? buildFrameWith(deps.run ?? spawnRunner),
    musicHistory: readMusicHistory(jobsRoot),
    ...(deps.kitDir ? { kitDir: deps.kitDir } : {}),
    ...(deps.promptsDir ? { promptsDir: deps.promptsDir } : {}),
  });
  // A short temp dir per job (the agent sandbox's socket-path limit); the base's would be shared.
  const tmpDir = path.join(os.tmpdir(), `hx-${jobId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return { jobDir, projectDir: ws.projectDir, homeDir: ws.homeDir, tmpDir };
}
