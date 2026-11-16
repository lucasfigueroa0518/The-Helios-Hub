/**
 * "Are you smarter than AI?" sound (CONTRACT-2 §1): one fixed 15.0 s master, show-master.flac (made once by
 * scripts/trivia_show_sound.cjs; never regenerated here). Clip 1 gets 0–10 s (the countdown), clip 2 gets
 * 10–15 s (drumroll, the hit at +0.5 s, applause). No music picking, no per-post audio. Each clip carries its
 * slice as AAC 192k, 48 kHz, and every delivered file is probed before it is handed back.
 */
import path from 'node:path';

import type { SlideRole } from './layout';
import { CLIP_S, FPS, MASTER_AT, MASTER_S } from './timeline';

export const MASTER_FILE = path.join(process.cwd(), 'lib', 'stories', 'trivia', 'render', 'assets', 'show-master.flac');

/** ffmpeg args muxing the clip's slice of the master under its silent video: AAC 192k, 48 kHz stereo. */
export function muxArgs(input: { video: string; master: string; role: SlideRole; out: string }): string[] {
  const dur = String(CLIP_S[input.role]);
  return [
    '-y', '-v', 'error',
    '-i', input.video,
    '-ss', String(MASTER_AT[input.role]), '-t', dur, '-i', input.master,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', dur, '-movflags', '+faststart', input.out,
  ];
}

/** ffmpeg args for a clip's poster: the frame at `at` seconds, as a JPEG. */
export function posterArgs(input: { video: string; at: number; out: string }): string[] {
  return ['-y', '-v', 'error', '-ss', String(input.at), '-i', input.video, '-frames:v', '1', '-q:v', '2', input.out];
}

/** ffprobe args for the delivery checks. */
export function probeArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file];
}

export type Probe = { duration: number; width: number; height: number; fps: number; audio: boolean };

/** ffprobe's JSON as the few numbers the delivery checks need. */
export function parseProbe(json: string): Probe {
  const p = JSON.parse(json) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }>; format?: { duration?: string } };
  const v = p.streams?.find((s) => s.codec_type === 'video');
  const [a, b] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return { duration: Number(p.format?.duration ?? 0), width: v?.width ?? 0, height: v?.height ?? 0, fps: b ? a! / b : 0, audio: Boolean(p.streams?.some((s) => s.codec_type === 'audio')) };
}

/** What is wrong with the master (empty when it is the 15.0 s sound the clips are cut from). */
export function masterProblems(p: Probe): string[] {
  const out: string[] = [];
  if (!p.audio) out.push('show master has no audio stream');
  if (Math.abs(p.duration - MASTER_S) > 0.01) out.push(`show master is ${p.duration.toFixed(3)} s, not ${MASTER_S} s`);
  return out;
}

/** What is wrong with a delivered clip (empty when it meets the contract: 10.0 / 5.0 s ±0.05, 1080×1920, 30 fps, audio). */
export function deliveryProblems(p: Probe, role: SlideRole): string[] {
  const out: string[] = [];
  const want = CLIP_S[role];
  if (Math.abs(p.duration - want) > 0.05) out.push(`duration ${p.duration.toFixed(3)} s, not ${want} s ±0.05`);
  if (p.width !== 1080 || p.height !== 1920) out.push(`size ${p.width}×${p.height}, not 1080×1920`);
  if (Math.abs(p.fps - FPS) > 0.01) out.push(`${p.fps} fps, not ${FPS}`);
  if (!p.audio) out.push('no audio stream');
  return out;
}
