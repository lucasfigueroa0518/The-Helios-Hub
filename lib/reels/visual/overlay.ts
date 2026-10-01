import { spawn } from 'node:child_process';

import { hookFilter, type ClipShape, type Hook, type HookTiming } from '@/lib/reels/visual/hook';

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`${bin} is not installed. The worker needs ffmpeg to lay the text plate on the clip.`));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

export async function probeVideo(videoPath: string): Promise<ClipShape> {
  const result = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate',
    '-of',
    'csv=p=0:s=x',
    videoPath,
  ]);
  const match = result.stdout.trim().match(/^(\d+)x(\d+)x(\d+)(?:\/(\d+))?$/);
  if (result.code !== 0 || !match?.[1] || !match[2] || !match[3]) {
    throw new Error(result.stderr.trim() || 'Could not read the clip size and frame rate.');
  }
  const fps = Number(match[3]) / Number(match[4] ?? 1);
  if (!(fps > 0)) throw new Error(`Clip frame rate is unreadable: ${result.stdout.trim()}`);
  return { width: Number(match[1]), height: Number(match[2]), fps };
}

/**
 * Stamp the hook on the silent clip, then lay the transparent plate on top.
 * The video model never received these words or the hook.
 */
export async function overlayPlate(
  videoPath: string,
  platePath: string,
  outPath: string,
  hook: { hook: Hook; clip: ClipShape; timing: HookTiming },
): Promise<void> {
  const result = await run('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-i',
    platePath,
    '-filter_complex',
    `${hookFilter(hook.hook, hook.clip, hook.timing)};[1:v][bg]scale2ref[plate][base];[base][plate]overlay=0:0:format=auto`,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    // The index goes at the front so the page can start playing while it loads.
    '-movflags',
    '+faststart',
    outPath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim().slice(-400) || `ffmpeg overlay failed (${result.code}).`);
  }
}

/** Lay a transparent plate on a finished reel and keep its audio. */
export async function overlayStillPlate(videoPath: string, platePath: string, outPath: string): Promise<void> {
  const audio = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    videoPath,
  ]);
  const hasAudio = audio.code === 0 && audio.stdout.trim().length > 0;
  const result = await run('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-i',
    platePath,
    '-filter_complex',
    '[1:v][0:v]scale2ref[plate][base];[base][plate]overlay=0:0:format=auto[v]',
    '-map',
    '[v]',
    ...(hasAudio ? ['-map', '0:a:0', '-c:a', 'copy'] : ['-an']),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outPath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim().slice(-400) || `ffmpeg cue overlay failed (${result.code}).`);
  }
}

/**
 * Add the hook SFX to a finished, silent reel (D-121). The picture is copied,
 * not re-encoded, and the audio is padded with silence to the clip's length.
 * A separate pass, so an audio failure never costs the reel its hook.
 */
export async function muxHookSfx(videoPath: string, sfxPath: string, outPath: string): Promise<void> {
  const result = await run('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-i',
    sfxPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-af',
    'apad',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim().slice(-400) || `ffmpeg audio mux failed (${result.code}).`);
  }
}
