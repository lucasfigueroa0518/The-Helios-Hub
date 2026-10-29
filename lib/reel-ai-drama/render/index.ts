import fs from 'node:fs';
import path from 'node:path';

import { KIT_DIR } from '@/lib/reel-ai-drama/render/workspace';

/**
 * Reel AI Drama's render plumbing (CONTRACT.md § B4): the workspace, the voice, assembly with the
 * breakage checks, the render and the contact sheet. Every subprocess goes through an injectable Runner.
 */
export { prepareWorkspace, applyOverlay, readMusicHistory, recordMusicChoice, musicHistoryPath, KIT_DIR, PRESET_DIR, REEL_AI_DRAMA_DIR } from '@/lib/reel-ai-drama/render/workspace';
export { runVoice, repace, sameVoices, frameVoices } from '@/lib/reel-ai-drama/render/voice';
export { assembleProject } from '@/lib/reel-ai-drama/render/assemble';
export { renderVideo, contactSheet, captionPages, captionTranscript, frameSpans, stillTimes } from '@/lib/reel-ai-drama/render/video';
export { spawnRunner, type Runner, type RunResult } from '@/lib/reel-ai-drama/render/runner';
/** writeProjectFiles(projectDir, { draft, plan, inventory, mediaRoot? }) → { frames, media, missing, problems } (kit/project-files.mjs). */
export { writeProjectFiles } from '@/explainers/reel-ai-drama/kit/project-files.mjs';

/** The kit guide (kit/FRAME.md): every treatment and option, motion and sound, the frame contract. For the director and the frame workers. */
export const KIT_GUIDE: string = fs.readFileSync(path.join(KIT_DIR, 'FRAME.md'), 'utf8');
