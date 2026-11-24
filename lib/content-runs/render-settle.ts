/**
 * A HyperFrames render that ends when its video is done (2026-11-24). On the VM an explainer render wrote a complete
 * 58 s MP4 (video and audio) at 15:50 and its process stayed alive until a restart killed it at 16:33: spawnSync waits
 * for the process and every pipe its Chrome children hold, so a finished render could sit for the 12 h backstop.
 *
 * This runs the command in its own process group and returns at whichever comes first:
 * - the process exits (its own status, as before);
 * - the output is finished: readable to ffprobe with a video and an audio stream, and its size unchanged for
 *   `settleMs`. The lingering group is then stopped and the run counts as a success (`settled: true`).
 * The 12 h backstop stays a hang guard, never a length limit (hang-guard.ts).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

import { RUN_HANG_BACKSTOP_MS } from '@/lib/content-runs/hang-guard';

export type SettledRun = { status: number | null; stdout: string; stderr: string; error?: string; signal?: string | null; settled?: boolean };

/** Output kept per stream (the tail is what explains a failure). */
const KEEP_CHARS = 256 * 1024;
/** A finished MP4 must sit unchanged this long before the lingering process is stopped. */
export const SETTLE_MS = 120_000;
const POLL_MS = 15_000;

/** True when ffprobe reads the file and finds a video and an audio stream (a half-written MP4 has no index yet). */
export function mp4Finished(file: string): boolean {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 30_000 });
    const kinds = out.split('\n').map((l) => l.trim());
    return kinds.includes('video') && kinds.includes('audio');
  } catch {
    return false;
  }
}

export function runSettled(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; output: string; timeoutMs?: number; settleMs?: number; pollMs?: number; finished?: (file: string) => boolean; log?: (event: string, fields?: Record<string, unknown>) => void },
): Promise<SettledRun> {
  const finished = opts.finished ?? mp4Finished;
  const settleMs = opts.settleMs ?? SETTLE_MS;
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (prev: string, chunk: Buffer) => (prev + chunk.toString('utf8')).slice(-KEEP_CHARS);
    child.stdout?.on('data', (c: Buffer) => { stdout = keep(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = keep(stderr, c); });
    const killGroup = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ } };
    let lastSize = -1, stableSince = 0;
    const poll = setInterval(() => {
      if (done) return;
      let size = -1;
      try { size = fs.statSync(opts.output).size; } catch { /* not written yet */ }
      if (size <= 0 || size !== lastSize) { lastSize = size; stableSince = Date.now(); return; }
      if (Date.now() - stableSince < settleMs || !finished(opts.output)) return;
      opts.log?.('render_settled', { output: opts.output, bytes: size, note: 'the video was finished and unchanged; the lingering render process was stopped' });
      finish({ status: 0, stdout, stderr, settled: true });
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 10_000).unref();
    }, opts.pollMs ?? POLL_MS);
    const backstop = setTimeout(() => { killGroup('SIGKILL'); finish({ status: null, stdout, stderr, signal: 'SIGKILL', error: 'hang backstop reached' }); }, opts.timeoutMs ?? RUN_HANG_BACKSTOP_MS);
    function finish(r: SettledRun) {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(backstop);
      resolve(r);
    }
    child.on('error', (e) => finish({ status: null, stdout, stderr, error: e.message }));
    // 'exit', not 'close': a Chrome child still holding the pipes must not keep a finished render waiting.
    child.on('exit', (code, signal) => {
      // Give the pipes a moment to flush what the process printed last.
      setTimeout(() => finish({ status: code, stdout, stderr, ...(signal ? { signal } : {}) }), 200);
      killGroup('SIGTERM');
    });
  });
}
