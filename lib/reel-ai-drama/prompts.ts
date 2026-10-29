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
] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export const CRAFT_NAMES = ['writer-craft', 'director-craft'] as const;
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

/** The writer's system prompt: the role prompt, then the craft it binds to. */
export function writerSystem(prompt: 'writer' | 'writer-revise' = 'writer', root?: string): string {
  return [loadPrompt(prompt, root), loadCraft('writer-craft', root)].join('\n\n---\n\n');
}

/**
 * The director's system prompt: role prompt, director craft, the writer craft (for the structure and
 * timing, which live only there), then the kit guide. All stable across stories, so all cached.
 */
export function directorSystem(kitGuide: string, root?: string): string {
  return [
    loadPrompt('director', root),
    loadCraft('director-craft', root),
    `# Reference: the writer's craft (structure and timing; the words are locked)\n\n${loadCraft('writer-craft', root)}`,
    `# Reference: the kit guide\n\n${kitGuide.trim()}`,
  ].join('\n\n---\n\n');
}
