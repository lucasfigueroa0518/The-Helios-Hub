/**
 * AI Trivia sound (AT-16, AT-20, AT-27, M1, M2): one continuous 10 s master for both clips, then cut
 * in two, so clip 2's music carries on exactly where clip 1's stopped and both share one loudness.
 *
 *   music    the track from `startMs` (clip 1) through `startMs + 10 s` (clip 2); fades in over 0.35 s,
 *            swells gently through clip 1's build (2.2–5 s), dips a little under the sting, and fades
 *            out across clip 2's settled end
 *   sting    reveal-sting.wav (never edited, never moved) from clip 2's first frame; its hit at +0.60 s
 *            sits on a beat because the music window was placed that way (music.ts)
 *   ambient  ambient-air.ogg (AT-32), the sound of the photo drift: a low, airy bed under both clips,
 *            looped with equal-power crossfades (no seams), well under the music, and rising and falling
 *            gently with the drift's speed (the same sine curve, AMBIENT_S)
 *   master   loudnorm to AI Drama's delivery loudness (LOUDNESS: −14 LUFS, −1 dBTP), 48 kHz; each clip
 *            gets its half as AAC 192k
 */
import path from 'node:path';

import { LOUDNESS } from '@/lib/reel-ai-drama/render/video';

import { AMBIENT_S, CLIP_S } from './timeline';

export const STING_FILE = path.join(process.cwd(), 'lib', 'stories', 'trivia', 'render', 'assets', 'reveal-sting.wav');
export const AMBIENT_FILE = path.join(process.cwd(), 'lib', 'stories', 'trivia', 'render', 'assets', 'ambient-air.ogg');
export const MASTER_S = 2 * CLIP_S;
/** The bed's level before loudnorm: about 16 dB under the music on the fixture track (texture, never a voice). */
export const AMBIENT_GAIN = 0.16;
/** The bed's loop crossfade, and its fade at the master's end. */
export const AMBIENT_XFADE_S = 1;
export const AMBIENT_FADE_OUT_S = 0.4;
/** The bed's level under the sting, before loudnorm. */
export const MUSIC_GAIN = 0.6;
export const STING_GAIN = 1.0;
export const FADE_IN_S = 0.35;
export const FADE_OUT_S = 1.4;
/** Clip 1's swell: the bed rises from SWELL_FROM to 1 between these times (M1). */
export const SWELL = { from: 0.8, start: 2.2, end: CLIP_S };
/** The bed dips this much under the sting, from clip 2's start to a little after the hit. */
export const STING_DUCK = 0.3;

const n = (x: number) => Number(x.toFixed(4));

/** The bed's gain over the master's time `t` (an ffmpeg expression). */
export function musicGainExpr(): string {
  const s = SWELL;
  const swell = `if(lt(t,${s.start}),${s.from},if(lt(t,${s.end}),${s.from}+${n(1 - s.from)}*pow((t-${s.start})/${n(s.end - s.start)},2),1))`;
  const duck = `(1-${STING_DUCK}*clip((t-${CLIP_S})/0.12,0,1)*clip((${CLIP_S + 1.9}-t)/0.7,0,1))`;
  return `${MUSIC_GAIN}*${swell}*${duck}`;
}

/** The bed's gain over the master's time `t`: it follows the drift's speed, sin(πt/AMBIENT_S), between 70% and 100%. */
export function ambientGainExpr(): string {
  return `${AMBIENT_GAIN}*(0.7+0.3*sin(PI*t/${AMBIENT_S}))`;
}

/** ffmpeg args for the 10 s master WAV: the music window, the ambient bed, and the sting at clip 2's start, levelled. */
export function masterArgs(input: { track: string; startMs: number; sting?: string; ambient?: string; out: string }): string[] {
  const start = n(input.startMs / 1000);
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const graph = [
    `[0:a]${fmt},asetpts=PTS-STARTPTS,volume='${musicGainExpr()}':eval=frame,afade=t=in:st=0:d=${FADE_IN_S},afade=t=out:st=${n(MASTER_S - FADE_OUT_S)}:d=${FADE_OUT_S}[m]`,
    `[1:a]${fmt},asetpts=PTS-STARTPTS,volume=${STING_GAIN},adelay=${CLIP_S * 1000}:all=1[s]`,
    // Three copies of the 5 s bed, crossfaded into one seamless 13 s run, cut to the master's length.
    `[2:a]${fmt},asetpts=PTS-STARTPTS,highpass=f=60,lowpass=f=9000,asplit=3[b0][b1][b2]`,
    `[b0][b1]acrossfade=d=${AMBIENT_XFADE_S}:c1=qsin:c2=qsin[b01]`,
    `[b01][b2]acrossfade=d=${AMBIENT_XFADE_S}:c1=qsin:c2=qsin,atrim=0:${MASTER_S},asetpts=PTS-STARTPTS,volume='${ambientGainExpr()}':eval=frame,afade=t=in:st=0:d=${FADE_IN_S},afade=t=out:st=${n(MASTER_S - AMBIENT_FADE_OUT_S)}:d=${AMBIENT_FADE_OUT_S}[b]`,
    `[m][s][b]amix=inputs=3:normalize=0:duration=first:dropout_transition=0,loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA},aresample=48000[out]`,
  ].join(';');
  return [
    '-y', '-v', 'error',
    '-stream_loop', '-1', '-ss', String(start), '-t', String(MASTER_S), '-i', input.track,
    '-i', input.sting ?? STING_FILE,
    '-i', input.ambient ?? AMBIENT_FILE,
    '-filter_complex', graph,
    '-map', '[out]', '-t', String(MASTER_S), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', input.out,
  ];
}

/** ffmpeg args muxing clip `clip`'s half of the master under its silent video: AAC 192k, 48 kHz. */
export function muxArgs(input: { video: string; master: string; clip: 0 | 1; out: string }): string[] {
  return [
    '-y', '-v', 'error',
    '-i', input.video,
    '-ss', String(input.clip * CLIP_S), '-t', String(CLIP_S), '-i', input.master,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', String(CLIP_S), '-movflags', '+faststart', input.out,
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

/** What is wrong with a delivered clip (empty when it meets the contract: 5.0 s ±0.05, 1080×1920, 30 fps, audio). */
export function deliveryProblems(p: Probe): string[] {
  const out: string[] = [];
  if (Math.abs(p.duration - CLIP_S) > 0.05) out.push(`duration ${p.duration.toFixed(3)} s, not ${CLIP_S} s ±0.05`);
  if (p.width !== 1080 || p.height !== 1920) out.push(`size ${p.width}×${p.height}, not 1080×1920`);
  if (Math.abs(p.fps - 30) > 0.01) out.push(`${p.fps} fps, not 30`);
  if (!p.audio) out.push('no audio stream');
  return out;
}
