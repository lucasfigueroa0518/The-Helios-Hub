import { spawnSync } from 'node:child_process';

/** One subprocess run. Every render step goes through a Runner so tests stub it. */
export type RunResult = { status: number | null; stdout: string; stderr: string; error?: string };
export type Runner = (cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => RunResult;

export const spawnRunner: Runner = (cmd, args, { cwd, env, timeoutMs }) => {
  const res = spawnSync(cmd, args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', ...(res.error ? { error: res.error.message } : {}) };
};

/** The last part of a run's output, for an error message a person can act on. */
export const tail = (r: RunResult, n = 400): string => (r.error ?? `${r.stderr || r.stdout}`).trim().slice(-n);

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
