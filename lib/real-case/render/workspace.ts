import fs from 'node:fs';
import path from 'node:path';

import { EXPLAINERS_DIR, LINT_DIR, prepareWorkspace, type Workspace } from '@/lib/explainers/render/workspace';
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
 *   .claude/skills/helios-explainer-director/       the Explainer director's SKILL.md removed; its folder
 *                                                    keeps only scene-builder.md, the Real Case one, at the
 *                                                    path the scene builder's agent prompt names (agent.ts)
 *   faceless-explainer SKILL.md, story-design.md,   the workflow, the beats, the shot method and the
 *   visual-design.md, sub-agents/frame-worker.md,   frame workers' role, for the eight Real Case beats
 *   hyperframes/references/frame-worker-core.md
 *   the recipe's storyboard-skeleton.md             the eight Real Case frames
 *   frame.md                                        the story world, the focal and the frame treatments
 *                                                    (realCaseFrameMd)
 *   .helios-lint/real-case/lint/                    the Real Case lint, beside the Explainer one it reuses
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
  ['director/scene-builder.md', '.claude/skills/helios-explainer-director/scene-builder.md'],
  ['workflow.md', '.claude/skills/faceless-explainer/SKILL.md'],
  ['story-design.md', '.claude/skills/faceless-explainer/references/story-design.md'],
  ['visual-design.md', '.claude/skills/faceless-explainer/references/visual-design.md'],
  ['frame-worker.md', '.claude/skills/faceless-explainer/sub-agents/frame-worker.md'],
  ['frame-worker-core.md', '.claude/skills/hyperframes/references/frame-worker-core.md'],
  ['storyboard-skeleton.md', '.media/recipes/helios-explainer/storyboard-skeleton.md'],
];

// ── frame.md ────────────────────────────────────────────────────────────────

/** Replace a `## ` section (its heading through the line before the next `## `) with `body`. */
export function replaceSection(md: string, heading: string, body: string): string {
  const start = md.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`frame.md has no section "${heading}"`);
  const after = start + heading.length + 2;
  const next = md.indexOf('\n## ', after);
  const end = next < 0 ? md.length : next;
  return `${md.slice(0, start + 1)}${body.trim()}\n${md.slice(end)}`;
}

/** Replace the span from `fromHeading` up to (not including) `toHeading`. */
function replaceSpan(md: string, fromHeading: string, toHeading: string, body: string): string {
  const start = md.indexOf(`\n${fromHeading}\n`);
  const end = md.indexOf(`\n${toHeading}\n`);
  if (start < 0 || end < 0 || end < start) throw new Error(`frame.md has no span "${fromHeading}" … "${toHeading}"`);
  return `${md.slice(0, start + 1)}${body.trim()}\n${md.slice(end)}`;
}

/** Exact edits to frame.md's lines that name the analogy's beats; each must match exactly once. */
const FRAME_EDITS: [RegExp, string][] = [
  [/except the hero critter, which keeps its orange wherever it appears: frames 1, 4, 5 and a frame-7 callback; frames 2, 3 and 6 never show it \(EX3-107, EX3-132\)\./,
    'except the key item, an object, which keeps its orange wherever it appears; no critter is ever orange.'],
  [/A critter does whatever someone does in the analogy:/, 'A critter does whatever someone does in the event:'],
  [/the hero is the one orange critter, shown only in frames 1, 4, 5 and a frame-7 callback \(EX3-132\), and no critter is ever redrawn in another color\./,
    'no critter is ever orange (the key item, an object, carries the orange), and no critter is ever redrawn in another color.'],
  [/^(\s*description: )"Frame 6 only\..*"$/m,
    '$1"Frame 4 only. A numbered path or timeline drawn in the style along one edge of the safe area (a hand-drawn ink line with paper tabs or circles). Its stops are the story world\'s steps (world.js STEPS, the `technical` names), 4 words or fewer each, Roboto 700 or Pragmatica label size. Stops light (the current one in green, done ones ink, upcoming ones at 25%) on their voice cue while the step plays on the event\'s own thing."'],
  [/every reel's analogy is its(\s+)own world/, "every reel's story is its$1own world"],
  [/Never pick an analogy because a piece already exists\./, 'Never stage a story around a piece because it already exists.'],
  [/real brands or logos other than Helios,/,
    "logos, brand marks, brand colors or copies of a real product's screens (an organization's name appears only as a plain label in the reel's lettering, as the voice says it),"],
  [/The anchor scene returns in beats 1, 4 and 5 \(and frame 7's callback\), so the picture must change:/,
    "The story world returns in beats 1, 2, 4, 5 and 6 (and frame 7's callback), so the picture must change:"],
  [/Beats 1, 4 and 5 each use at least one shot kind the others don't\./, "Beats 2, 4, 5 and 6 each use at least one shot kind the beat before it doesn't."],
  [/or the real job of\s+the part frame 4 is naming\)/, 'or the step frame 4 is naming)'],
  [/Lead with the hero, then its context;/, 'Lead with the focal, then its context;'],
  [/supporting elements move less, slower and later than the hero\./, 'supporting elements move less, slower and later than the focal.'],
  [/\(frame 4: as each part's real job is named\)/, '(frame 4: as each step is named)'],
  [/and the step tracker's stops \(frame 6\)\./, "and the step tracker's stops (frame 4)."],
  [/compositions\/frames\/04-analogy\.html → 04-analogy/, 'compositions/frames/04-walk.html → 04-walk'],
  [/the\s+hook keeps its contract \(`hero`, `hideHero`, `heroPose`, no text\)\./, 'the hook keeps its contract (no `hero` export in an object-led reel, no text).'],
  [/- \*\*Example:\*\* the step tracker shows the anchor steps' technical names, each lit with an insert of the example step's real thing; no hero\./,
    "- **Walk:** frame 4's step tracker shows the story world's steps, each lit as the step plays on the event's own thing."],
  [/- \*\*Hero:\*\* only in frames 1, 4, 5 and a frame-7 callback; never in frames 2, 3 or 6\./,
    '- **Key item:** the one object that keeps its orange wherever it appears; no critter is orange.'],
];

/**
 * The job's frame.md for this format: the story world, the focal rule and the eight frame treatments
 * replace the analogy's, and the lines that name the analogy's beats are rewritten. Throws when the
 * preset no longer has a section or a line this expects, so a change on the Explainer side is caught
 * by the tests instead of shipping a frame.md that contradicts itself.
 */
export function realCaseFrameMd(frameMd: string, dir: string = REAL_CASE_DIR): string {
  const part = (name: string) => fs.readFileSync(path.join(dir, 'frame', name), 'utf8');
  let md = frameMd;
  md = replaceSection(md, '## The anchor scene (V-1)', part('story-world.md'));
  md = replaceSection(md, '## Focal (V-5) · HARD CONSTRAINT', part('focal.md'));
  md = replaceSpan(md, '## Frame Treatments', '## Writing a frame (the frame-module contract)', part('frame-treatments.md'));
  for (const [find, replacement] of FRAME_EDITS) {
    const count = (md.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : `${find.flags}g`)) ?? []).length;
    if (count !== 1) throw new Error(`frame.md: expected one match for ${find}, found ${count}`);
    md = md.replace(find, replacement);
  }
  return md;
}

// ── The overlay ─────────────────────────────────────────────────────────────

function copyDir(from: string, to: string, filter: (src: string) => boolean = () => true): void {
  fs.cpSync(from, to, { recursive: true, filter });
}

/** Lay the Real Case files over a prepared Explainer workspace (deterministic, no model). */
export function applyRealCaseOverlay(projectDir: string, story: StoryRow, dir: string = REAL_CASE_DIR): void {
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

  const frameFile = path.join(projectDir, 'frame.md');
  write('frame.md', realCaseFrameMd(fs.readFileSync(frameFile, 'utf8'), dir));

  copyDir(path.join(dir, 'lint'), path.join(projectDir, LINT_DIR, 'real-case', 'lint'), (src) => !src.includes(`${path.sep}fixtures`));
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
  applyRealCaseOverlay(ws.projectDir, story);
  return ws;
};
