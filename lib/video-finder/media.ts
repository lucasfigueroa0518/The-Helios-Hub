/**
 * Video finder media steps (lab, 2026-11-23): download a short section, probe it, sample frames,
 * and trim the chosen window. yt-dlp + ffmpeg (yt-dlp needs Deno for YouTube). Code only, no AI.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Seconds downloaded per candidate: enough to judge it and cut a clip from, cheap to fetch. */
export const SECTION_SEC = 75;

export type Probe = { duration: number; width: number; height: number; audio: boolean };

export type Fetched = { ok: boolean; error?: string; tries: number; ms: number };

/**
 * Downloads share the machine's link across every shard. Unbounded, they starved each other: in the v5 run 192 of
 * 204 YouTube downloads hit the timeout, though each one alone takes seconds (2026-11-23). Every download takes one
 * of VF_DL_SLOTS cross-process slots (a directory), so the timeout measures the download, not the queue.
 */
const SLOT_DIR = process.env.VF_DL_SLOT_DIR ?? path.join(os.tmpdir(), 'video-finder-dl-slots');
const SLOTS = Number(process.env.VF_DL_SLOTS ?? 8);
const STALE_SLOT_MS = 6 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  for (;;) {
    for (let k = 0; k < SLOTS; k++) {
      const slot = path.join(SLOT_DIR, `slot-${k}`);
      try { fs.mkdirSync(slot); } catch {
        try { if (Date.now() - fs.statSync(slot).mtimeMs > STALE_SLOT_MS) fs.rmdirSync(slot); } catch { /* raced */ }
        continue;
      }
      try { return await fn(); } finally { try { fs.rmdirSync(slot); } catch { /* already gone */ } }
    }
    await sleep(300 + Math.random() * 400);
  }
}

/**
 * YouTube rate-limits bulk traffic from one IP with "Sign in to confirm you're not a bot" (v7, 2026-11-23: 123 of
 * 371 candidates). We respect it: every YouTube request is paced across processes (VF_YT_GAP_MS apart), and after
 * the first such answer YouTube is left alone for YT_BACKOFF_MS while the other sources carry on.
 */
const YT_GAP_MS = Number(process.env.VF_YT_GAP_MS ?? 2500);
const YT_BACKOFF_MS = 30 * 60_000;
const YT_STATE = path.join(SLOT_DIR, '..', 'video-finder-youtube');
export const isYouTube = (url: string) => /(?:youtube\.com|youtu\.be|ytsearch\d*:)/.test(url);
const BOT_WALL = /confirm you.re not a bot/i;

/** Waits for this request's turn; throws while YouTube is backing off. */
async function paceYouTube(): Promise<void> {
  fs.mkdirSync(YT_STATE, { recursive: true });
  const wall = path.join(YT_STATE, 'wall-until');
  const lock = path.join(YT_STATE, 'lock');
  const last = path.join(YT_STATE, 'last');
  for (;;) {
    const until = fs.existsSync(wall) ? Number(fs.readFileSync(wall, 'utf8')) : 0;
    if (Date.now() < until) throw new Error(`youtube backing off after a bot check until ${new Date(until).toISOString()}`);
    try { fs.mkdirSync(lock); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.rmdirSync(lock); } catch { /* raced */ }
      await sleep(200); continue;
    }
    try {
      const wait = (fs.existsSync(last) ? Number(fs.readFileSync(last, 'utf8')) : 0) + YT_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      fs.writeFileSync(last, String(Date.now()));
      return;
    } finally { fs.rmdirSync(lock); }
  }
}

/** Records a bot-check answer so every process backs off from YouTube. */
export function noteYouTubeError(error: string): void {
  if (!BOT_WALL.test(error)) return;
  fs.mkdirSync(YT_STATE, { recursive: true });
  fs.writeFileSync(path.join(YT_STATE, 'wall-until'), String(Date.now() + YT_BACKOFF_MS));
}

/** Runs a yt-dlp call for `url`, paced when it goes to YouTube. */
export async function ytdlp(url: string, args: string[], timeout: number): Promise<{ stdout: string }> {
  if (isYouTube(url)) await paceYouTube();
  try { return await run('yt-dlp', args, { timeout, maxBuffer: 8 * 1024 * 1024 }); } catch (e) {
    if (isYouTube(url)) noteYouTubeError(lastError(e));
    throw e;
  }
}

/** Grading copy: small, video only (frames are graded at 768 px). Final copy: the clip window at up to 720p with sound. */
const FORMATS = {
  grade: 'bv*[height<=360][vcodec^=avc1]/bv*[height<=360]/b[height<=360]/bv*[height<=480]/b',
  final: 'bv*[height<=720]+ba/b[height<=720]/bv*[height<=720]/b',
} as const;

function lastError(e: unknown): string {
  const err = e as { stderr?: string; killed?: boolean; signal?: string; message?: string };
  if (err.killed || err.signal === 'SIGTERM') return 'timed out';
  const lines = (err.stderr ?? err.message ?? String(e)).split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines.reverse().find((l) => /ERROR|error/.test(l)) ?? lines[0] ?? 'unknown').slice(0, 200);
}

/** Errors no retry can fix: the video is gone, private, region-locked, or not a video. */
const PERMANENT = /backing off|confirm you.re not a bot|unavailable|private|removed|not available in your country|does not exist|no video|Unsupported URL|members-only|age-restricted|confirm your age|copyright|HTTP Error 404/i;

/**
 * Download [start, start+len] of a video into `out` (mp4), with up to three tries and backoff; the last try takes
 * any format. `direct` URLs (a file or og:video) go through ffmpeg. Returns why it failed, so failures can be counted.
 */
export async function fetchSection(url: string, out: string, opts: { referer?: string; direct?: boolean; start?: number; len?: number; quality?: 'grade' | 'final' } = {}): Promise<Fetched> {
  const { referer, direct, start = 0, len = SECTION_SEC, quality = 'grade' } = opts;
  const t0 = Date.now();
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt === 1 ? 3000 : 10_000);
    fs.rmSync(out, { force: true });
    try {
      await withDownloadSlot(async () => {
        if (direct) {
          const hdr = referer ? ['-headers', `Referer: ${referer}\r\n`] : [];
          await run('ffmpeg', ['-y', '-loglevel', 'error', ...hdr, '-ss', String(start), '-t', String(len), '-i', url, '-t', String(len),
            ...(quality === 'grade' ? ['-an', '-vf', 'scale=-2:min(360\\,ih)', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28'] : ['-c', 'copy']), out], { timeout: 150_000 });
        } else {
          await ytdlp(url, [
            '-f', attempt === 2 ? 'b/bv*' : FORMATS[quality],
            '--download-sections', `*${start}-${start + len}`, ...(quality === 'final' ? ['--force-keyframes-at-cuts'] : []),
            '--merge-output-format', 'mp4', '--remux-video', 'mp4', '--retries', '3', '--fragment-retries', '3', '--socket-timeout', '20',
            '--no-playlist', '--no-warnings', ...(referer ? ['--referer', referer] : []), '-o', out, url,
          ], 150_000);
        }
      });
      if (fs.existsSync(out) && fs.statSync(out).size > 20_000) return { ok: true, tries: attempt + 1, ms: Date.now() - t0 };
      error = 'empty file';
    } catch (e) {
      error = lastError(e);
      if (PERMANENT.test(error)) return { ok: false, error, tries: attempt + 1, ms: Date.now() - t0 };
    }
  }
  return { ok: false, error, tries: 3, ms: Date.now() - t0 };
}

export type Stream = { ok: true; url: string; duration: number; referer?: string } | { ok: false; error: string };

/**
 * The playable URL of a hosted video plus its length, without downloading it (yt-dlp -g, two tries). Frames can
 * then be read anywhere in the video by seeking (grabStreamFrames), so a long video is judged on its whole length,
 * not only its first SECTION_SEC seconds. Direct files are their own stream.
 */
export async function streamUrl(url: string, opts: { referer?: string; direct?: boolean } = {}): Promise<Stream> {
  const { referer, direct } = opts;
  if (direct) {
    const p = await probe(url, referer);
    return p ? { ok: true, url, duration: p.duration, referer } : { ok: false, error: 'direct file unreadable' };
  }
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(3000);
    try {
      const { stdout } = await withDownloadSlot(() => ytdlp(url, ['-g', '--print', 'duration', '-f', FORMATS.grade, '--no-playlist', '--no-warnings', '--socket-timeout', '20', ...(referer ? ['--referer', referer] : []), url], 60_000));
      const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      const duration = Number(lines[0]);
      const stream = lines.find((l) => /^https?:/.test(l));
      if (stream && duration > 0) return { ok: true, url: stream, duration, referer };
      error = duration > 0 ? 'no stream URL' : 'no duration (live or image post)';
    } catch (e) {
      error = lastError(e);
      if (PERMANENT.test(error)) break;
    }
  }
  return { ok: false, error };
}

/** One JPEG per time read straight from a stream (four at a time, one retry each), aligned to `times`. */
export async function grabStreamFrames(stream: { url: string; referer?: string }, times: number[], prefix: string): Promise<(string | null)[]> {
  const hdr = stream.referer ? ['-headers', `Referer: ${stream.referer}\r\n`] : [];
  const out: (string | null)[] = new Array(times.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < times.length) {
      const i = next++;
      const file = `${prefix}-${String(i).padStart(2, '0')}.jpg`;
      for (let attempt = 0; attempt < 2 && !out[i]; attempt++) {
        try {
          await run('ffmpeg', ['-y', '-loglevel', 'error', ...hdr, '-ss', String(times[i]), '-i', stream.url, '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '3', file], { timeout: 40_000 });
          if (fs.existsSync(file) && fs.statSync(file).size > 2000) out[i] = file;
        } catch { /* retry once */ }
      }
    }
  }));
  return out;
}

/** Back-compatible wrapper: the first SECTION_SEC seconds, grading quality. */
export async function downloadSection(url: string, out: string, opts: { referer?: string; direct?: boolean } = {}): Promise<boolean> {
  return (await fetchSection(url, out, opts)).ok;
}

export type YtHit = { url: string; title: string; channel: string; duration: number };

/** Free YouTube search through yt-dlp (no API key, no Serper spend). */
export async function ytSearch(q: string, n = 5): Promise<YtHit[]> {
  try {
    const { stdout } = await ytdlp(`ytsearch${n}:`, ['--flat-playlist', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(channel)s\t%(duration)s', `ytsearch${n}:${q}`], 60_000);
    return stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [id = '', title = '', channel = '', dur = ''] = l.split('\t');
      return { url: `https://www.youtube.com/watch?v=${id}`, title, channel, duration: Number(dur) || 0 };
    }).filter((h) => /^[\w-]{11}$/.test(h.url.slice(-11)));
  } catch {
    return [];
  }
}

export async function probe(file: string, referer?: string): Promise<Probe | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', ...(referer ? ['-headers', `Referer: ${referer}\r\n`] : []), '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { timeout: 30_000 });
    const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    const duration = Number(j.format?.duration ?? 0);
    if (!v || !duration) return null;
    return { duration, width: v.width ?? 0, height: v.height ?? 0, audio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')) };
  } catch {
    return null;
  }
}

/** Times of `n` frames spread evenly over [from, to], skipping the very edges. */
export function frameTimes(from: number, to: number, n: number): number[] {
  const span = Math.max(0, to - from);
  return Array.from({ length: n }, (_, i) => Math.round((from + ((i + 0.5) * span) / n) * 10) / 10);
}

/** One JPEG per time, 768 px wide. Returns the files that were written, aligned to `times`. */
export async function grabFrames(file: string, times: number[], prefix: string): Promise<(string | null)[]> {
  return Promise.all(times.map(async (t, i) => {
    const out = `${prefix}-${String(i).padStart(2, '0')}.jpg`;
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '3', out], { timeout: 30_000 });
      return fs.existsSync(out) ? out : null;
    } catch {
      return null;
    }
  }));
}

/** Cut [start, start+len] to a web-friendly H.264 mp4 (max 720p, audio lowered, or dropped when `mute`) plus a poster. */
export async function trimClip(file: string, start: number, len: number, out: string, poster: string, mute = false): Promise<boolean> {
  try {
    await run('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', String(start), '-i', file, '-t', String(len),
      '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p',
      ...(mute ? ['-an'] : ['-af', 'volume=0.5', '-c:a', 'aac', '-b:a', '96k']), '-movflags', '+faststart', out,
    ], { timeout: 120_000 });
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(1, len / 2)), '-i', out, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster], { timeout: 30_000 });
    return fs.existsSync(out);
  } catch {
    return false;
  }
}
