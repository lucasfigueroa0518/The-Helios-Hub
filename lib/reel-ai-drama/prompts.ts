import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reel AI Drama prompt and craft files (CONTRACT.md § B3). Code never inlines prompt prose: it loads
 * `explainers/reel-ai-drama/prompts/<name>.md` and `explainers/reel-ai-drama/craft/<name>.md` here.
 */
export const PROMPT_NAMES = [
  'producer',
  'reporting',
  'writer',
  'writer-revise',
  'story-editor',
  'director',
  'build-workflow',
  'frame-worker',
  'first-viewer',
  'fix',
  'post-text',
  'integrity',
  'visuals-look',
  'harvest-look',
  'sound-designer',
  'design-review',
  'creative-pass',
] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

/**
 * `principles` is the writing side's one craft file (MD-101, MD-104); `story-timing` keeps only the picture-side
 * timing the director needs (MD-106).
 */
export const CRAFT_NAMES = ['principles', 'director-craft', 'story-timing'] as const;
export type CraftName = (typeof CRAFT_NAMES)[number];

export const PROMPTS_DIR = path.join('explainers', 'reel-ai-drama', 'prompts');
export const CRAFT_DIR = path.join('explainers', 'reel-ai-drama', 'craft');

const cache = new Map<string, string>();

function load(file: string, root: string): string {
  const full = path.join(root, file);
  const hit = cache.get(full);
  if (hit !== undefined) return hit;
  const text = readFileSync(full, 'utf8').trim();
  if (!text) throw new Error(`empty prompt file: ${file}`);
  cache.set(full, text);
  return text;
}

/** The prompt text for `name`. Read once per process: a stable cached prefix needs stable bytes. */
export function loadPrompt(name: PromptName, root: string = process.cwd()): string {
  if (!(PROMPT_NAMES as readonly string[]).includes(name)) throw new Error(`unknown prompt: ${name}`);
  return load(path.join(PROMPTS_DIR, `${name}.md`), root);
}

export function loadCraft(name: CraftName, root: string = process.cwd()): string {
  if (!(CRAFT_NAMES as readonly string[]).includes(name)) throw new Error(`unknown craft file: ${name}`);
  return load(path.join(CRAFT_DIR, `${name}.md`), root);
}

/** The writer's system prompt (MD-101): the role prompt, then the writing principles. */
export function writerSystem(prompt: 'writer' | 'writer-revise' = 'writer', root?: string): string {
  return [loadPrompt(prompt, root), loadCraft('principles', root)].join('\n\n---\n\n');
}

/** The blind story editor's system prompt (MD-102): the role prompt, then the writing principles it judges by. */
export function storyEditorSystem(root?: string): string {
  return [loadPrompt('story-editor', root), loadCraft('principles', root)].join('\n\n---\n\n');
}

/**
 * The director's system prompt: role prompt, director craft, the story's structure and timing (story-timing,
 * not the whole writer craft: S6), then the kit guide (FRAME.md). All stable across stories, so all cached.
 */
export function directorSystem(kitGuide: string, root?: string): string {
  return [
    loadPrompt('director', root),
    loadCraft('director-craft', root),
    loadCraft('story-timing', root),
    `# Reference: the kit guide\n\n${kitGuide.trim()}`,
  ].join('\n\n---\n\n');
}

/** The design reviewer's two item sets (MD-133): `fast` on the vision model, `judge` on the design judge model. */
export type DesignItemSet = 'fast' | 'judge';
const SET_MARK = /^<!-- set: (\w+) -->\s*$/m;

/**
 * One design-review call's system prompt: the shared intro of `design-review.md`, then only that call's item
 * set (the parts after `<!-- set: fast -->` and `<!-- set: judge -->`). Stable bytes per set, so each is a
 * cached prefix of its own.
 */
export function designReviewSystem(set: DesignItemSet, root?: string): string {
  const parts = loadPrompt('design-review', root).split(SET_MARK);
  const intro = parts[0]!.trim();
  const sets = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) sets.set(parts[i]!, parts[i + 1]!.trim());
  const items = sets.get(set);
  if (!items) throw new Error(`design-review.md has no item set "${set}"`);
  return `${intro}\n\n${items}`;
}
