import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { EXPLAINERS_DIR, LINT_DIR, prepareWorkspace, type MusicHistory, type Workspace } from '@/lib/explainers/render/workspace';
import { bankingFor, loadCutouts } from '@/lib/real-case/bank';
import type { TopicRow } from '@/lib/explainers/types';
import { realCaseBriefMarkdown } from '@/lib/real-case/render/brief';
import type { StoryRow } from '@/lib/real-case/types';

/**
 * A Real Case render's workspace (RC-01): the Explainer Reels workspace, built by its own
 * `prepareWorkspace` (init, the world kit, the sound library, the pinned skills, the preset), with
 * this format's files laid over it. Nothing on the Explainer side is edited: the overlay writes only
 * inside the job's project.
 *
 * What the overlay replaces, and why:
 *   BRIEF.md, capture/extracted/visible-text.txt   the story and its checked facts
 *   CLAUDE.md, AGENTS.md                            point at the Real Case director
 *   .claude/skills/helios-real-case-director/       the director (its SKILL.md)
 *   .claude/skills/helios-explainer-director/       removed: this format has no scene builder (its agent
 *                                                    is dropped in agents.ts)
 *   faceless-explainer SKILL.md, story-design.md,   the workflow, the beats, the shot method and the
 *   visual-design.md, sub-agents/frame-worker.md,   frame workers' role, for the eight Real Case beats
 *   hyperframes/references/frame-worker-core.md
 *   the recipe's storyboard-skeleton.md             the eight acts (RC-31)
 *   frame.md, .hyperframes/caption-skin.html        built from this format's `ai-news` preset (D4)
 *   .helios-lint/real-case/lint/                    the Real Case lint, beside the Explainer one it reuses
 *
 * The render engine (N4c-2, RC-47): assets/kit is this format's news kit (explainers/real-case/kit),
 * never the world kit. The Explainer opener bank, opener.json, opener sounds and assets/world go;
 * the dry-erase font, the Helios mark, and the story's banked logos and approved cutouts
 * (assets/bank/, with credits.json) come in; music-avoid.json is this format's own rotation.
 */

export const REAL_CASE_DIR = path.join(EXPLAINERS_DIR, 'real-case');

export const REAL_CASE_PROJECT_INSTRUCTIONS = [
  '# Helios Real Case Reel job',
  '',
  'This project is one Helios Real Case Reel. Follow the `helios-real-case-director` skill and the Helios `faceless-explainer` workflow it runs; nothing else applies here.',
  '',
].join('\n');

/** Overlay files: [source under explainers/real-case, destination under the project]. */
export const OVERLAY_FILES: [string, string][] = [
  ['director/SKILL.md', '.claude/skills/helios-real-case-director/SKILL.md'],
  ['workflow.md', '.claude/skills/faceless-explainer/SKILL.md'],
  ['story-design.md', '.claude/skills/faceless-explainer/references/story-design.md'],
  ['visual-design.md', '.claude/skills/faceless-explainer/references/visual-design.md'],
  ['frame-worker.md', '.claude/skills/faceless-explainer/sub-agents/frame-worker.md'],
  ['frame-worker-core.md', '.claude/skills/hyperframes/references/frame-worker-core.md'],
  ['storyboard-skeleton.md', '.media/recipes/helios-explainer/storyboard-skeleton.md'],
];

// ── The overlay ─────────────────────────────────────────────────────────────

function copyDir(from: string, to: string, filter: (src: string) => boolean = () => true): void {
  fs.cpSync(from, to, { recursive: true, filter });
}

/** Lay the Real Case files over a prepared Explainer workspace (deterministic, no model). */
export function applyRealCaseOverlay(
  projectDir: string,
  story: StoryRow,
  dir: string = REAL_CASE_DIR,
  { buildFrame = runBuildFrame, musicHistory = null }: { buildFrame?: (projectDir: string, presetDir: string) => void; musicHistory?: MusicHistory | null } = {},
): void {
  const write = (rel: string, content: string) => {
    const file = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('BRIEF.md', realCaseBriefMarkdown(story));
  write(path.join('capture', 'extracted', 'visible-text.txt'), `Story: ${story.title}\nTerm: ${story.term}\n\n${story.summary}\n`);
  for (const file of ['CLAUDE.md', 'AGENTS.md']) write(file, REAL_CASE_PROJECT_INSTRUCTIONS);

  fs.rmSync(path.join(projectDir, '.claude', 'skills', 'helios-explainer-director'), { recursive: true, force: true });
  for (const [from, to] of OVERLAY_FILES) write(to, fs.readFileSync(path.join(dir, from), 'utf8'));

  copyDir(path.join(dir, 'lint'), path.join(projectDir, LINT_DIR, 'real-case', 'lint'), (src) => !src.includes(`${path.sep}fixtures`));

  applyNewsKit(projectDir, story, { dir, buildFrame, musicHistory });
}

/** Files of the news kit a job never gets (the gallery and the texture baker are repo tools). */
const KIT_EXCLUDE = /(^|[\\/])(gallery\.(html|mjs)|bake-textures\.mjs)$/;
/** The Explainer opener sounds prepareWorkspace copies into assets/sfx. */
const EXPLAINER_OPENER_SOUNDS = ['riser.mp3', 'impact-bass-1.mp3'];

/** This format's music rotation, beside the jobs folder's Explainer one but never shared with it. */
export function realCaseMusicHistoryPath(jobsRoot: string): string {
  return path.join(path.dirname(path.resolve(jobsRoot)), 'real-case-music-history.json');
}

export function readRealCaseMusicHistory(jobsRoot: string): MusicHistory {
  try {
    const parsed = JSON.parse(fs.readFileSync(realCaseMusicHistoryPath(jobsRoot), 'utf8')) as Partial<MusicHistory>;
    return { used: Number(parsed.used) || 0, recent: Array.isArray(parsed.recent) ? parsed.recent.map(String).slice(-10) : [] };
  } catch {
    return { used: 0, recent: [] };
  }
}

/** After a reel is made: count its bed (assets/bgm/choice.json) in this format's rotation. */
export function recordRealCaseMusicChoice(jobsRoot: string, projectDir: string): string | null {
  let id: string | undefined;
  try {
    id = (JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'bgm', 'choice.json'), 'utf8')) as { id?: string }).id;
  } catch {
    return null;
  }
  if (!id) return null;
  const history = readRealCaseMusicHistory(jobsRoot);
  fs.writeFileSync(realCaseMusicHistoryPath(jobsRoot), `${JSON.stringify({ used: history.used + 1, recent: [...history.recent, id].slice(-10) }, null, 1)}\n`);
  return id;
}

/**
 * The render engine half of the overlay: the news kit in place of the world kit, the opener bank and
 * its files gone, frame.md from the `ai-news` preset, fonts, the Helios mark, the story's banked art.
 */
export function applyNewsKit(
  projectDir: string,
  story: StoryRow,
  { dir = REAL_CASE_DIR, buildFrame = runBuildFrame, musicHistory = null }: { dir?: string; buildFrame?: (projectDir: string, presetDir: string) => void; musicHistory?: MusicHistory | null } = {},
): void {
  const assets = path.join(projectDir, 'assets');
  fs.rmSync(path.join(assets, 'kit'), { recursive: true, force: true });
  fs.rmSync(path.join(assets, 'world'), { recursive: true, force: true });
  fs.rmSync(path.join(assets, 'opener.json'), { force: true });
  for (const f of EXPLAINER_OPENER_SOUNDS) fs.rmSync(path.join(assets, 'sfx', f), { force: true });
  copyDir(path.join(dir, 'kit'), path.join(assets, 'kit'), (src) => !KIT_EXCLUDE.test(src));
  fs.mkdirSync(path.join(assets, 'frames'), { recursive: true });

  fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(dir, 'design', 'fonts'))) {
    if (/\.(ttf|otf|woff2?)$/.test(f)) fs.copyFileSync(path.join(dir, 'design', 'fonts', f), path.join(assets, 'fonts', f));
  }
  fs.copyFileSync(path.join(EXPLAINERS_DIR, 'design', 'helios-design-system', 'assets', 'Helios-mark.png'), path.join(assets, 'Helios-mark.png'));

  // The story's banked art (RC-33, RC-34): logos and approved cutouts, each with its credit.
  const bank = path.join(assets, 'bank');
  fs.rmSync(bank, { recursive: true, force: true });
  fs.mkdirSync(path.join(bank, 'logos'), { recursive: true });
  fs.mkdirSync(path.join(bank, 'cutouts'), { recursive: true });
  const credits: { player: string; kind: 'logo' | 'cutout'; file: string; credit: string }[] = [];
  const repo = path.resolve(EXPLAINERS_DIR, '..');
  const cutouts = loadCutouts(repo);
  for (const member of story.story?.cast ?? []) {
    const b = bankingFor(member, cutouts);
    for (const [kind, art] of [['logo', b.logo], ['cutout', b.cutout]] as const) {
      if (!art) continue;
      const rel = path.join(kind === 'logo' ? 'logos' : 'cutouts', `${art.id}.png`);
      fs.copyFileSync(path.join(repo, art.file), path.join(bank, rel));
      credits.push({ player: member.name, kind, file: `assets/bank/${rel.split(path.sep).join('/')}`, credit: art.credit });
    }
  }
  fs.writeFileSync(path.join(bank, 'credits.json'), `${JSON.stringify(credits, null, 1)}\n`);

  if (musicHistory) fs.writeFileSync(path.join(projectDir, 'music-avoid.json'), `${JSON.stringify(musicHistory)}\n`);
  buildFrame(projectDir, path.join(dir, 'presets'));
}

/** frame.md and the caption skin from the `ai-news` preset, with the faceless skill's build-frame. */
function runBuildFrame(projectDir: string, presetDir: string): void {
  const script = path.join(EXPLAINERS_DIR, 'hyperframes-skills', 'faceless-explainer', 'scripts', 'build-frame.mjs');
  const res = spawnSync('node', [script, '--preset', 'ai-news', '--preset-dir', presetDir, '--hyperframes', '.'], { cwd: projectDir, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`build-frame (ai-news) failed: ${(res.stderr || res.stdout).slice(-600)}`);
}

/** The topic shape `prepareWorkspace` needs, from a story (its BRIEF.md is replaced by the overlay). */
export function workspaceTopic(story: StoryRow): TopicRow {
  return {
    id: story.id,
    title: story.title,
    scope: story.summary,
    term: story.term,
    source_url: null,
    source_text: null,
    jev_notes: {},
  } as unknown as TopicRow;
}

export type PrepareRealCase = (input: { jobsRoot: string; jobId: string; story: StoryRow }) => Workspace;

/** The real one: the Explainer workspace, then the overlay. */
export const prepareRealCaseWorkspace: PrepareRealCase = ({ jobsRoot, jobId, story }) => {
  const ws = prepareWorkspace({ jobsRoot, jobId, topic: workspaceTopic(story), sourceText: null, analogy: null, gap: null });
  applyRealCaseOverlay(ws.projectDir, story, REAL_CASE_DIR, { musicHistory: readRealCaseMusicHistory(jobsRoot) });
  return ws;
};
