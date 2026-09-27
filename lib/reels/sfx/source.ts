import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { analyzeSource, type SourceAnalysis } from '@/lib/reels/sfx/analyze';
import { buildDraft, draftLength, DRAFT_SETTINGS, pickOffset, type Draft, type DraftSettings } from '@/lib/reels/sfx/draft';
import { frameMap, SFX_FPS, SFX_SAMPLE_RATE } from '@/lib/reels/sfx/frame-map';
import { readWav, type Wav } from '@/lib/reels/sfx/wav';
import type { HookTiming } from '@/lib/reels/visual/hook';

/**
 * Source prep shared by the Stage 2 drafts and the Stage 3 finished files, so
 * a finished file is built exactly the way its draft was. Needs local ffmpeg
 * (scripts only; the render path never calls this).
 */
export const SOURCE_DIR = path.join('planning', 'Trial Reels', 'SFX candidates');
/** atempo slows audio to at most half speed. */
const MIN_TEMPO = 0.5;

export function sourceSlug(file: string): string {
  return file.replace(/\.wav$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Source at 48 kHz float, optionally slowed with atempo (time-stretch, SFX-04). Cached per tempo. */
export function loadSource(file: string, tempo: number, workDir: string): { wav: Wav; analysis: SourceAnalysis } {
  const out = path.join(workDir, 'src', `${sourceSlug(file)}@${tempo.toFixed(4)}.wav`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const filters = [`aresample=${SFX_SAMPLE_RATE}:filter_size=64`];
    if (tempo < 1) filters.push(`atempo=${tempo.toFixed(4)}`);
    execFileSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', path.join(SOURCE_DIR, file), '-af', filters.join(','), '-c:a', 'pcm_f32le', out],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  }
  const wav = readWav(fs.readFileSync(out));
  return { wav, analysis: analyzeSource(file, wav) };
}

export type PreparedDraft = { draft: Draft; tempo: number; offsetMs: number };

/**
 * Stretch only when the source's audible span cannot reach the end of the
 * cushion, pick the trim that keeps every flicker out of the source's gaps,
 * then gate and set the gain.
 */
export function draftSource(
  file: string,
  timing: HookTiming,
  workDir: string,
  settings: DraftSettings = DRAFT_SETTINGS,
): PreparedDraft {
  const map = frameMap(timing, SFX_FPS);
  const need = draftLength(map, SFX_SAMPLE_RATE);
  const original = loadSource(file, 1, workDir);
  const audible = original.analysis.audible;
  if (!audible) throw new Error(`${file} is silent.`);
  const audibleSamples = ((audible.endMs - audible.startMs) / 1000) * SFX_SAMPLE_RATE;
  const tempo = audibleSamples >= need ? 1 : Math.max(MIN_TEMPO, Math.floor((audibleSamples / need) * 1000) / 1000);
  const source = tempo === 1 ? original : loadSource(file, tempo, workDir);
  const span = source.analysis.audible ?? audible;
  const fromSample = Math.round((span.startMs / 1000) * SFX_SAMPLE_RATE);
  const toSample = Math.round((span.endMs / 1000) * SFX_SAMPLE_RATE) - need;
  const offset = pickOffset(source.wav.channels, map, SFX_SAMPLE_RATE, { fromSample, toSample }, settings.offsetStepMs);
  return {
    draft: buildDraft(source.wav.channels, map, SFX_SAMPLE_RATE, offset, settings),
    tempo,
    offsetMs: Math.round((offset / SFX_SAMPLE_RATE) * 10000) / 10,
  };
}
