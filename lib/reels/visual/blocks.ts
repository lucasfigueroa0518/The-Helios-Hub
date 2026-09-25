import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ColorProfile } from '@/lib/reels/visual/color';

/**
 * One master copy of the fixed style blocks. The scene writer's reference
 * and the final image prompt both come from this file, so they cannot diverge.
 * The three-zone version these replaced is in saved/three-zone-v1/.
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));

function readTrimmed(name: string): string {
  return readFileSync(path.join(DIR, name), 'utf8').replace(/\s+$/, '');
}

const styleBlocks = new Map<ColorProfile, string>();
let scenePrompt: string | null = null;

function styleText(profile: ColorProfile = 'noir'): string {
  const cached = styleBlocks.get(profile);
  if (cached) return cached;
  const name = profile === 'noir' ? 'fixed-style-blocks.txt' : `profiles/${profile}.txt`;
  const text = readTrimmed(name);
  styleBlocks.set(profile, text);
  return text;
}

function scenePromptText(): string {
  scenePrompt ??= readTrimmed('scene-writer-prompt.txt');
  return scenePrompt;
}

const SCENE_SECTION = '[SCENE — VARIABLE]\n{insert scene description here}\n\n';

const PULL_NOTE = `[Pulled from the master copy of the fixed style blocks in Section 3:
STYLE, COLOR SYSTEM, DESIGN LANGUAGE, PEOPLE, COMPOSITION, AVOID]`;

/** Style, color, design, people, composition, and avoid. The scene block is omitted. */
export function referenceBlocks(profile: ColorProfile = 'noir'): string {
  const blocks = styleText(profile);
  if (!blocks.includes(SCENE_SECTION)) {
    throw new Error('Fixed style blocks are missing the scene placeholder.');
  }
  return blocks.replace(SCENE_SECTION, '');
}

/** The scene-writer prompt with the master blocks inserted at the pull point. */
export function sceneWriterInstructions(profile: ColorProfile = 'noir'): string {
  const prompt = scenePromptText();
  if (!prompt.includes(PULL_NOTE)) {
    throw new Error('Scene writer prompt is missing the style-block pull point.');
  }
  return prompt.replace(PULL_NOTE, referenceBlocks(profile));
}

/** Final image prompt: the profile's blocks, with the scene writer's text in [SCENE]. */
export function assembleImagePrompt(scene: string, profile: ColorProfile = 'noir'): string {
  const token = '{insert scene description here}';
  const blocks = styleText(profile);
  if (!blocks.includes(token)) {
    throw new Error('Fixed style blocks are missing the scene placeholder.');
  }
  const body = scene.trim();
  if (!body) throw new Error('Scene is empty.');
  return blocks.replace(token, body);
}
