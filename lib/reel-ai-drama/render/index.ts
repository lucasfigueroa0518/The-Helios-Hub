import fs from 'node:fs';
import path from 'node:path';

import { readCompiled } from '@/lib/reel-ai-drama/render/compile';
import { pickMoments, sceneChanges } from '@/lib/reel-ai-drama/render/moments';
import type { Runner } from '@/lib/reel-ai-drama/render/runner';
import { makeSheets, viewerSheets, type Sheet } from '@/lib/reel-ai-drama/render/sheets';
import { frameSpans } from '@/lib/reel-ai-drama/render/video';
import { KIT_DIR } from '@/lib/reel-ai-drama/render/workspace';

/**
 * Reel AI Drama's render plumbing (CONTRACT.md § B4): the workspace, the voice, assembly with the
 * breakage checks, the render and the contact sheet. Every subprocess goes through an injectable Runner.
 */
export { prepareWorkspace, applyOverlay, readMusicHistory, musicHistoryPath, KIT_DIR, PRESET_DIR, REEL_AI_DRAMA_DIR } from '@/lib/reel-ai-drama/render/workspace';
export { runVoice, repace, sameVoices, frameVoices } from '@/lib/reel-ai-drama/render/voice';
export { assembleProject } from '@/lib/reel-ai-drama/render/assemble';
export { renderVideo, contactSheet, captionPages, captionTranscript, frameSpans } from '@/lib/reel-ai-drama/render/video';
export { fullStill } from '@/lib/reel-ai-drama/render/sheets';
export { spawnRunner, type Runner, type RunResult } from '@/lib/reel-ai-drama/render/runner';
/** writeProjectFiles(projectDir, { draft, plan, inventory, mediaRoot? }) → { frames, media, missing, problems } (kit/project-files.mjs). */
export { writeProjectFiles } from '@/explainers/reel-ai-drama/kit/project-files.mjs';

/** The kit guide (kit/FRAME.md): every treatment and option, motion and sound, the frame contract. For the director and the frame workers. */
export const KIT_GUIDE: string = fs.readFileSync(path.join(KIT_DIR, 'FRAME.md'), 'utf8');

/**
 * Iteration 11 §2–§3: the rendered reel's moments (`pickMoments`: edges, the timeline, measured findings, scene changes) cut
 * into labelled sheets for the reviewers and the solver (`frames`: only these frames; null: all), and with `viewer`, unlabelled
 * sheets of the whole reel for the first viewer. Review and viewer sheets go to their own folders. Throws when a still fails.
 */
export async function reelSheets(
  projectDir: string,
  videoPath: string,
  input: { findings: string[]; dir: string; frames: number[] | null; viewer: boolean },
  deps: { run?: Runner } = {},
): Promise<{ review: Sheet[]; viewer: Sheet[] }> {
  const spans = frameSpans(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'));
  const read = readCompiled(projectDir, deps.run ? { run: deps.run } : {});
  const moments = pickMoments({ spans, records: read.ok ? read.frames : {}, findings: input.findings, changes: sceneChanges(videoPath, deps) });
  const mine = input.frames ? moments.filter((m) => input.frames!.includes(m.frame)) : moments;
  const review = await makeSheets(videoPath, mine, path.join(input.dir, 'review'), deps);
  const viewer = input.viewer ? await viewerSheets(videoPath, moments, path.join(input.dir, 'viewer'), deps) : [];
  return { review, viewer };
}
