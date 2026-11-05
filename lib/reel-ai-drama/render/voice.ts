import fs from 'node:fs';
import path from 'node:path';

import { hostAudio, keepHostAudio } from '@/explainers/hyperframes-skills/faceless-explainer/scripts/lib/host-audio.mjs';
import { PACE_FILE, parseSilences } from '@/explainers/reel-ai-drama/kit/pace.mjs';
import { prepareTts } from '@/explainers/reel-ai-drama/kit/pronounce.mjs';
import { EXPLAINERS_DIR, HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';

/** The faceless-explainer scripts: the project's pinned copy, else the repo's. */
export function scriptsDir(projectDir: string): string {
  const local = path.join(projectDir, '.claude', 'skills', 'faceless-explainer', 'scripts');
  return fs.existsSync(path.join(local, 'audio.mjs')) ? local : path.join(EXPLAINERS_DIR, 'hyperframes-skills', 'faceless-explainer', 'scripts');
}

/** The shared HeyGen TTS CLI (media-use), beside the faceless-explainer scripts the same way audio.mjs finds its engine. */
export function heygenTtsScript(projectDir: string): string {
  return path.join(scriptsDir(projectDir), '..', '..', 'media-use', 'audio', 'scripts', 'heygen-tts.mjs');
}

export type VoiceInput = {
  voiceId: string;
  heygenApiKey: string;
  pronounce?: { word: string; say: string }[];
  /** `voice_tempo` (MD-93): ffmpeg `atempo` on the recorded take; HeyGen ignores its own `speed` for this voice. */
  tempo?: number;
  /** `silent_beat_max` (MD-91), handed to pace.mjs through PACE_FILE. */
  silentBeatMax?: number;
};

/** How the voice was made: one continuous take per script (or per group of frames), else per-frame clips. */
export type VoiceResult = { take: 'one' | 'per_frame'; takes: number; notes: string[] };

/** Where the takes, their text and their word timestamps are kept (re-split by hand if needed). */
export const TAKE_DIR = path.join('assets', 'voice', 'take');
/** The longest text sent as one take; a longer script is voiced in takes split at frame boundaries. */
export const TAKE_MAX_CHARS = 4_500;
/** Silence used to place a cut between two frames: quieter than this for at least this long. */
const CUT_SILENCE = { db: -40, min: 0.03 };
/** A cut may sit this far outside the gap the word timestamps give (they run ~0.1s off). */
const CUT_REACH = 0.15;

export type ScriptFrame = { frame: number; text: string };
export type TakeWord = { id?: string; text: string; start: number; end: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** SCRIPT.md → the spoken text of each frame, in order (the same reading as audio.mjs: `## … (Frame N)`, indented text). */
export function scriptFrames(md: string): ScriptFrame[] {
  const out: ScriptFrame[] = [];
  let cur: ScriptFrame | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) out.push({ frame: cur.frame, text: cur.text.trim() });
    cur = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{2,3}\s+.*?\(frame\s+(\d+)\)/i.exec(line);
    if (h) {
      flush();
      cur = { frame: Number(h[1]), text: '' };
      continue;
    }
    if (!cur || /^\s*\*\*/.test(line)) continue;
    const m = /^(?: {4,}|\t)(.+)$/.exec(line);
    if (m) cur.text += (cur.text ? ' ' : '') + m[1].trim();
  }
  flush();
  return out;
}

/** Frames grouped into takes of at most `maxChars` (a frame is never split; usually one group). */
export function takeGroups(frames: ScriptFrame[], maxChars = TAKE_MAX_CHARS): ScriptFrame[][] {
  const groups: ScriptFrame[][] = [];
  let size = 0;
  for (const f of frames) {
    const last = groups[groups.length - 1];
    if (last && size + 1 + f.text.length <= maxChars) {
      last.push(f);
      size += 1 + f.text.length;
    } else {
      groups.push([f]);
      size = f.text.length;
    }
  }
  return groups;
}

/** A word as compared: lower case, letters and digits only ("Google's," → "googles"). */
const norm = (w: string) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The index of each frame's first word in the take (`words`), by aligning the script's words with the
 * spoken ones (edit distance, so a word the TTS split, joined or spelled differently costs one step and
 * the rest still line up). Null when some frame can't be placed (no word of it matched, or it would start
 * before the frame ahead of it ends): the caller then voices frame by frame.
 */
export function frameStarts(frames: ScriptFrame[], words: TakeWord[]): number[] | null {
  const script: { tok: string; frame: number }[] = [];
  frames.forEach((f, k) => {
    for (const w of f.text.split(/\s+/)) if (norm(w)) script.push({ tok: norm(w), frame: k });
  });
  const spoken = words.map((w, i) => ({ tok: norm(String(w.text ?? '')), i })).filter((w) => w.tok);
  const n = script.length;
  const m = spoken.length;
  if (!n || !m) return null;
  // cost[i][j]: aligning the first i script words with the first j spoken ones.
  const cost: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) cost[i]![0] = i;
  for (let j = 0; j <= m; j++) cost[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[i - 1]![j - 1]! + (script[i - 1]!.tok === spoken[j - 1]!.tok ? 0 : 1);
      cost[i]![j] = Math.min(sub, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  // Walk back: each script word matched (or substituted) to a spoken word.
  const at = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = script[i - 1]!.tok === spoken[j - 1]!.tok ? 0 : 1;
    if (cost[i]![j] === cost[i - 1]![j - 1]! + same) {
      at[i - 1] = spoken[j - 1]!.i;
      i--;
      j--;
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) i--;
    else j--;
  }
  const starts: number[] = [];
  for (let k = 0; k < frames.length; k++) {
    const first = script.findIndex((s, x) => s.frame === k && at[x] >= 0);
    if (first < 0) return null;
    // The first frame owns anything said before its first matched word.
    const start = k === 0 ? 0 : at[first]!;
    if (k > 0 && start <= starts[k - 1]!) return null;
    starts.push(start);
  }
  return starts;
}

/**
 * Where to cut the take between frames: 0, one cut per boundary, then `duration`. Each cut sits in the
 * measured silence at the boundary (the one holding the timestamps' gap, else the longest one within
 * CUT_REACH of it), so no word loses its onset or decay; with no silence there, halfway across the gap
 * (or at the next word's start when the timestamps overlap).
 */
export function cutPoints(words: TakeWord[], starts: number[], silences: [number, number][], duration: number): number[] {
  const cuts = [0];
  for (let k = 1; k < starts.length; k++) {
    const a = words[starts[k]! - 1]!.end;
    const b = words[starts[k]!]!.start;
    const lo = Math.min(a, b) - CUT_REACH;
    const hi = Math.max(a, b) + CUT_REACH;
    const mid = (a + b) / 2;
    const near = silences
      .map(([s, e]) => ({ s: Math.max(s, lo), e: Math.min(e, hi), holds: s <= mid && mid <= e }))
      .filter((x) => x.e > x.s);
    const best = near.find((x) => x.holds) ?? near.sort((x, y) => y.e - y.s - (x.e - x.s))[0];
    let cut = best ? (best.s + best.e) / 2 : b >= a ? mid : b;
    cut = Math.min(Math.max(cut, cuts[k - 1]! + 0.01), duration - 0.01);
    cuts.push(r3(cut));
  }
  cuts.push(r3(duration));
  return cuts;
}

/** Each frame's stretch of the take and its words, on the frame's own clock (ids w0, w1… per frame). */
export function splitTake(words: TakeWord[], starts: number[], cuts: number[]): { start: number; end: number; words: TakeWord[] }[] {
  return starts.map((s, k) => {
    const start = cuts[k]!;
    const end = cuts[k + 1]!;
    const len = end - start;
    const own = words.slice(s, k + 1 < starts.length ? starts[k + 1] : words.length);
    return {
      start,
      end,
      words: own.map((w, i) => ({
        id: `w${i}`,
        text: w.text,
        start: r3(Math.min(len, Math.max(0, w.start - start))),
        end: r3(Math.min(len, Math.max(0, w.end - start))),
      })),
    };
  });
}

/** Word times after `atempo` = `tempo` (the take gets shorter by that factor). */
export function scaleWords(words: TakeWord[], tempo: number): TakeWord[] {
  return words.map((w) => ({ ...w, start: r3(w.start / tempo), end: r3(w.end / tempo) }));
}

type Exec = (label: string, cmd: string, args: string[]) => string;

function probeSeconds(exec: Exec, file: string): number {
  const out = exec('ffprobe', 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(out.trim());
  if (!(Number.isFinite(d) && d > 0)) throw new Error(`voice: no duration for ${file}`);
  return d;
}

/** `file` sped up by `tempo` in place (pitch kept), or left as is at 1. */
function speedUp(exec: Exec, src: string, dest: string, tempo: number): void {
  if (tempo === 1) {
    if (src !== dest) fs.copyFileSync(src, dest);
    return;
  }
  const tmp = `${dest}.tempo.wav`;
  exec('tempo', 'ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', `atempo=${tempo}`, tmp]);
  fs.renameSync(tmp, dest);
}

/** audio_meta.json with these voices; the host's own bed and sounds in the previous one are kept. */
function writeMeta(projectDir: string, voices: { frame: number; path: string; duration_s: number; words: TakeWord[] }[]): void {
  const file = path.join(projectDir, 'audio_meta.json');
  let previous: unknown = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no earlier meta (a first voicing) or an unreadable one: nothing of the host's to keep
  }
  const host = hostAudio(previous, (p: string) => fs.existsSync(path.join(projectDir, p)));
  const meta = keepHostAudio({ bgm: null, bgm_pending: false, voices, sfx: [] }, host);
  fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * The one-take voice (MD-93): the whole script read by HeyGen in one continuous take (or a few, at frame
 * boundaries, past TAKE_MAX_CHARS), sped up by `tempo`, then cut into one WAV per frame at the silences
 * between frames, with each frame's words from HeyGen's word timestamps. Writes the frame-keyed
 * audio_meta.json audio.mjs writes, so restore-spelling, sync-durations, pace, captions and assemble read it
 * unchanged. Throws when a take can't be made or split; the caller then voices frame by frame.
 */
function voiceOneTake(projectDir: string, script: string, voiceId: string, tempo: number, exec: Exec): VoiceResult {
  const frames = scriptFrames(fs.readFileSync(path.join(projectDir, script), 'utf8'));
  if (!frames.length) throw new Error(`voice: ${script} has no spoken lines`);
  const dir = path.join(projectDir, TAKE_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const groups = takeGroups(frames);
  const voices: { frame: number; path: string; duration_s: number; words: TakeWord[] }[] = [];
  const record: unknown[] = [];
  groups.forEach((group, g) => {
    const base = path.join(TAKE_DIR, `take-${g + 1}`);
    fs.writeFileSync(path.join(projectDir, `${base}.txt`), `${group.map((f) => f.text).join(' ')}\n`);
    exec('take', process.execPath, [heygenTtsScript(projectDir), `${base}.txt`, '-o', `${base}.raw.wav`, '--words', `${base}.words.json`, '--voice', voiceId]);
    let raw: TakeWord[];
    try {
      raw = JSON.parse(fs.readFileSync(path.join(projectDir, `${base}.words.json`), 'utf8')) as TakeWord[];
    } catch {
      throw new Error(`voice: take ${g + 1} came back without word timestamps`);
    }
    const words = scaleWords(raw, tempo);
    speedUp(exec, path.join(projectDir, `${base}.raw.wav`), path.join(projectDir, `${base}.wav`), tempo);
    const duration = probeSeconds(exec, `${base}.wav`);
    const starts = frameStarts(group, words);
    if (!starts) throw new Error(`voice: take ${g + 1}'s words could not be matched to its ${group.length} frames`);
    const log = exec('silences', 'ffmpeg', ['-hide_banner', '-nostats', '-i', `${base}.wav`, '-af', `silencedetect=noise=${CUT_SILENCE.db}dB:d=${CUT_SILENCE.min}`, '-f', 'null', '-']);
    const cuts = cutPoints(words, starts, parseSilences(log, duration) as [number, number][], duration);
    splitTake(words, starts, cuts).forEach((part, k) => {
      const frame = group[k]!.frame;
      const file = path.join('assets', 'voice', `${pad2(frame)}.wav`);
      exec('split', 'ffmpeg', ['-v', 'error', '-y', '-i', `${base}.wav`, '-af', `atrim=start=${part.start.toFixed(4)}:end=${part.end.toFixed(4)},asetpts=PTS-STARTPTS`, file]);
      voices.push({ frame, path: file.split(path.sep).join('/'), duration_s: r3(part.end - part.start), words: part.words });
    });
    record.push({ take: g + 1, frames: group.map((f) => f.frame), seconds: r3(duration), cuts });
  });
  fs.writeFileSync(path.join(dir, 'take.json'), `${JSON.stringify({ tempo, takes: record }, null, 1)}\n`);
  writeMeta(projectDir, voices);
  return { take: 'one', takes: groups.length, notes: [] };
}

/** The fallback: audio.mjs's per-frame clips (read cold, MD-93's reason to prefer one take), each sped up by `tempo`. */
function voicePerFrame(projectDir: string, script: string, voiceId: string, tempo: number, exec: Exec): void {
  const audio = path.join(scriptsDir(projectDir), 'audio.mjs');
  exec('audio', process.execPath, [audio, '--script', script, '--storyboard', './STORYBOARD.md', '--hyperframes', '.', '--out', './audio_meta.json', '--voice', voiceId]);
  if (tempo === 1) return;
  const file = path.join(projectDir, 'audio_meta.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8')) as { voices?: { path?: string; duration_s?: number; words?: TakeWord[] }[] };
  for (const v of meta.voices ?? []) {
    if (!v.path) continue;
    speedUp(exec, path.join(projectDir, v.path), path.join(projectDir, v.path), tempo);
    v.duration_s = r3(probeSeconds(exec, v.path));
    v.words = scaleWords(v.words ?? [], tempo);
  }
  fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * P6 voice (no model): HeyGen TTS in Lucas's voice, one continuous take for the whole script, sped up by
 * `voice_tempo` and split into frames by its word timestamps (MD-93; per-frame clips only when the take
 * fails). The writer's `pronounce` respellings go in a TTS copy and the spelling is restored on the words
 * after; then the real durations into STORYBOARD.md (sync-durations) and the kit's pace (silence tightened,
 * the 0.2s pause cap, silent beats up to `silent_beat_max`, each frame's duration and word timing).
 * Throws with the failing step's output.
 */
export async function runVoice(projectDir: string, input: VoiceInput, deps: { run?: Runner } = {}): Promise<VoiceResult> {
  const run = deps.run ?? spawnRunner;
  const tempo = input.tempo ?? DEFAULT_SETTINGS.voice_tempo;
  // The writer's respellings go to the voice only; restore-spelling puts the written words back for the captions.
  const { script } = prepareTts(projectDir, input.pronounce ?? []);
  const env = { ...process.env, ...HYPERFRAMES_ENV, HEYGEN_API_KEY: input.heygenApiKey, HELIOS_VOICE_ID: input.voiceId };
  const exec: Exec = (label, cmd, args) => {
    const res = run(cmd, args, { cwd: projectDir, env, timeoutMs: 15 * 60 * 1000 });
    if (res.status !== 0) throw new Error(`voice: ${label} failed: ${tail(res)}`);
    return `${res.stdout}\n${res.stderr}`;
  };
  fs.writeFileSync(path.join(projectDir, PACE_FILE), `${JSON.stringify({ silent_beat_max: input.silentBeatMax ?? DEFAULT_SETTINGS.silent_beat_max })}\n`);
  // pace.mjs keeps each frame's untightened voice in assets/voice/orig/ and starts from it when present: a new
  // voice must not be paced from the old one.
  fs.rmSync(path.join(projectDir, 'assets', 'voice', 'orig'), { recursive: true, force: true });

  let result: VoiceResult;
  try {
    result = voiceOneTake(projectDir, script, input.voiceId, tempo, exec);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    try {
      voicePerFrame(projectDir, script, input.voiceId, tempo, exec);
    } catch (fallback) {
      throw new Error(`${why}; the per-frame fallback failed too: ${fallback instanceof Error ? fallback.message : String(fallback)}`);
    }
    result = { take: 'per_frame', takes: 0, notes: [`The one-take voice failed (${why}); the frames were voiced one by one.`] };
  }
  const audio = path.join(scriptsDir(projectDir), 'audio.mjs');
  exec('restore-spelling', process.execPath, ['assets/kit/pronounce.mjs', 'restore']);
  exec('sync-durations', process.execPath, [audio, 'sync-durations', '--audio-meta', './audio_meta.json', '--storyboard', './STORYBOARD.md']);
  exec('pace', process.execPath, ['assets/kit/pace.mjs']);
  return result;
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
