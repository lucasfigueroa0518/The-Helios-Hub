import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** One subprocess run. Every render step goes through a Runner so tests stub it. */
export type RunResult = { status: number | null; stdout: string; stderr: string; error?: string; signal?: string | null };
export type Runner = (cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => RunResult;

export const spawnRunner: Runner = (cmd, args, { cwd, env, timeoutMs }) => {
  const res = spawnSync(cmd, args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', ...(res.error ? { error: res.error.message } : {}), ...(res.signal ? { signal: res.signal } : {}) };
};

/** Lines that usually say why, wherever they sit in the output. */
const WHY_LINE = /error|fail|invalid|denied|refus|cannot|not found|no such|exit|killed|unable|HTTP \d{3}|✗/i;

/**
 * Why a run failed, for an error message a person can act on: how it ended, the output's telling lines from anywhere in it, then
 * its end. Keeping only the end hid the real message every time (ITERATION-12 §1): tools print their reason early, then a summary.
 */
export function tail(r: RunResult, n = 2000): string {
  const ended = [r.error, r.signal ? `killed by ${r.signal}` : ''].filter(Boolean).join('; ');
  // Progress bars rewrite one line with \r: only the last state of each line counts.
  const lines = [r.stderr, r.stdout].filter(Boolean).join('\n').split('\n').map((l) => l.split('\r').pop()!.trimEnd()).filter(Boolean);
  const text = lines.join('\n');
  if (text.length <= n) return [ended, text].filter(Boolean).join('\n');
  const why = [...new Set(lines.filter((l) => WHY_LINE.test(l)))].slice(0, 12).join('\n').slice(0, Math.floor(n / 2));
  return [ended, why, why ? '…' : '', text.slice(-(n - why.length))].filter(Boolean).join('\n');
}

/** Where a project keeps every failed or noisy step's whole output. Kept with the job when it ends. */
export const STEP_LOG = path.join('logs', 'steps.log');

/** Append a step's whole output (or a note) to the project's step log. Never throws: a log must not fail the step. */
export function appendStepLog(projectDir: string, label: string, entry: RunResult | string): void {
  try {
    const body = typeof entry === 'string' ? entry : `status ${entry.status ?? 'none'}${entry.signal ? `, ${entry.signal}` : ''}${entry.error ? `, ${entry.error}` : ''}\n--- stderr\n${entry.stderr}\n--- stdout\n${entry.stdout}`;
    const file = path.join(projectDir, STEP_LOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `\n===== ${new Date().toISOString()} ${label}\n${body}\n`);
  } catch {
    // nothing to do
  }
}

/** The step log's last part, or null when nothing was logged. */
export function readStepLog(projectDir: string, maxChars = 200_000): string | null {
  try {
    return fs.readFileSync(path.join(projectDir, STEP_LOG), 'utf8').slice(-maxChars);
  } catch {
    return null;
  }
}

/**
 * Keep a Mac awake while a job runs: `caffeinate` holds idle, disk and system sleep until released or until this process ends. A
 * closed lid on battery still sleeps; the outage waits (retry.ts) carry a job through that. Elsewhere it does nothing. Never throws.
 */
export function holdAwake(deps: { platform?: NodeJS.Platform; spawner?: typeof spawn; pid?: number } = {}): () => void {
  if ((deps.platform ?? process.platform) !== 'darwin') return () => undefined;
  try {
    const child = (deps.spawner ?? spawn)('caffeinate', ['-ims', '-w', String(deps.pid ?? process.pid)], { stdio: 'ignore' });
    child.on('error', () => undefined);
    return () => {
      child.kill();
    };
  } catch {
    return () => undefined;
  }
}

/** A run's stdout as JSON (the kit's CLIs print one JSON object), or null. */
export function jsonOut<T>(r: RunResult): T | null {
  const text = r.stdout.trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as T;
  } catch {
    return null;
  }
}
