import fs from 'node:fs';
import path from 'node:path';

import { prepareTts } from '@/explainers/reel-ai-drama/kit/pronounce.mjs';
import { EXPLAINERS_DIR, HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';

/** The faceless-explainer scripts: the project's pinned copy, else the repo's. */
export function scriptsDir(projectDir: string): string {
  const local = path.join(projectDir, '.claude', 'skills', 'faceless-explainer', 'scripts');
  return fs.existsSync(path.join(local, 'audio.mjs')) ? local : path.join(EXPLAINERS_DIR, 'hyperframes-skills', 'faceless-explainer', 'scripts');
}

/**
 * P6 voice (no model): HeyGen TTS in Lucas's voice for every voiced frame of SCRIPT.md (audio.mjs; the
 * writer's `pronounce` respellings in a TTS copy, the spelling restored on the words after), the
 * real durations into STORYBOARD.md (sync-durations), then the kit's pace (silence tightened, the 0.2s
 * pause cap, each frame's duration and word timing). Throws with the failing step's output.
 */
export async function runVoice(
  projectDir: string,
  { voiceId, heygenApiKey, pronounce = [] }: { voiceId: string; heygenApiKey: string; pronounce?: { word: string; say: string }[] },
  deps: { run?: Runner } = {},
): Promise<void> {
  const run = deps.run ?? spawnRunner;
  // The writer's respellings go to the voice only; restore-spelling puts the written words back for the captions.
  const { script } = prepareTts(projectDir, pronounce);
  const env = { ...process.env, ...HYPERFRAMES_ENV, HEYGEN_API_KEY: heygenApiKey, HELIOS_VOICE_ID: voiceId };
  const audio = path.join(scriptsDir(projectDir), 'audio.mjs');
  const steps: [string, string[]][] = [
    ['audio', [audio, '--script', script, '--storyboard', './STORYBOARD.md', '--hyperframes', '.', '--out', './audio_meta.json', '--voice', voiceId]],
    ['restore-spelling', ['assets/kit/pronounce.mjs', 'restore']],
    ['sync-durations', [audio, 'sync-durations', '--audio-meta', './audio_meta.json', '--storyboard', './STORYBOARD.md']],
    ['pace', ['assets/kit/pace.mjs']],
  ];
  for (const [label, args] of steps) {
    const res = run(process.execPath, args, { cwd: projectDir, env, timeoutMs: 15 * 60 * 1000 });
    if (res.status !== 0) throw new Error(`voice: ${label} failed: ${tail(res)}`);
  }
}

/**
 * Pace again after the project files were rewritten (the integrity fix): durations and word timing come
 * back from the voice already made, no model and no HeyGen. Valid only while every frame keeps its
 * number and its lines; when the frames' lines change, run runVoice again instead.
 */
export async function repace(projectDir: string, deps: { run?: Runner } = {}): Promise<void> {
  const res = (deps.run ?? spawnRunner)(process.execPath, ['assets/kit/pace.mjs'], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs: 5 * 60 * 1000 });
  if (res.status !== 0) throw new Error(`voice: pace failed: ${tail(res)}`);
}

/** The words each frame speaks, by frame number, from a STORYBOARD.md: compare before and after a rewrite. */
export function frameVoices(storyboard: string): Map<number, string> {
  const out = new Map<number, string>();
  const heads = [...storyboard.matchAll(/^##\s+Frame\s+(\d+)/gm)];
  heads.forEach((m, i) => {
    const body = storyboard.slice(m.index! + m[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined);
    out.set(Number(m[1]), (/^-\s+voiceover:\s*(.*)$/m.exec(body)?.[1] ?? '').trim());
  });
  return out;
}

/** True when a rewritten storyboard speaks exactly what the voiced one did (so repace is enough). */
export function sameVoices(before: string, after: string): boolean {
  const a = frameVoices(before);
  const b = frameVoices(after);
  return a.size === b.size && [...a].every(([n, v]) => b.get(n) === v);
}
