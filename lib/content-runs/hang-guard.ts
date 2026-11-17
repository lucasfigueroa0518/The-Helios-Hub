/**
 * Content runs are long-running processes. Lucas, 2026-11-10: "timeouts shouldn't be a reason why things fail.
 * These are long running processes." No content run (any vertical) is failed or killed for taking long.
 *
 * What stays is a hang guard: a run whose process has shown no sign of life for RUN_QUIET_LIMIT_MS is treated as hung,
 * and RUN_HANG_BACKSTOP_MS is a last-resort backstop for subprocesses (spawnSync cannot watch progress) and for
 * reapers of runs whose worker died. Neither is a run length limit: long runs are normal.
 * Per-request network timeouts (fetch/HTTP/API calls) are separate hang guards and stay where they are.
 */

/** Hang guard only; long runs are normal. 12 hours. */
export const RUN_HANG_BACKSTOP_MS = 12 * 60 * 60_000;
/** RUN_HANG_BACKSTOP_MS in minutes, for SQL reapers. */
export const RUN_HANG_BACKSTOP_MINUTES = RUN_HANG_BACKSTOP_MS / 60_000;
/** RUN_HANG_BACKSTOP_MS as a Postgres interval literal. */
export const RUN_HANG_BACKSTOP_INTERVAL = '12 hours';

/** In-process runs: hung only after this long with no observable progress (no log line or other output). */
export const RUN_QUIET_LIMIT_MS = 45 * 60_000;

let lastProgressAt = Date.now();
let tapped = false;

/** Mark that the process did something observable just now. */
export function noteRunProgress(at: number = Date.now()): void {
  lastProgressAt = at;
}

/** When the process last showed progress (ms since epoch). */
export function lastRunProgressAt(): number {
  return lastProgressAt;
}

/** Count every stdout/stderr write as progress (the workers log each stage and spend). Installed once. */
export function tapProcessOutput(): void {
  if (tapped) return;
  tapped = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    (stream as unknown as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]) => {
      lastProgressAt = Date.now();
      return write(...args);
    };
  }
}

export type HangGuardOptions<T> = {
  /** Silence that counts as hung (default RUN_QUIET_LIMIT_MS). */
  quietMs?: number;
  /** Absolute backstop (default RUN_HANG_BACKSTOP_MS). */
  backstopMs?: number;
  /** How often to check (default 60 s). */
  checkEveryMs?: number;
  /** Last progress time (default the process-wide one). */
  lastProgress?: () => number;
  now?: () => number;
  /** Called once when the run is judged hung; its answer replaces the run's. reason says why. */
  onHang: (reason: string) => Promise<T> | T;
};

/**
 * Resolve with `work`, or with `onHang()` once the process has been silent for quietMs (or the backstop passes).
 * A run that keeps making progress is never cut off, however long it takes. The hung promise is not cancelled.
 */
export function withHangGuard<T>(work: Promise<T>, o: HangGuardOptions<T>): Promise<T> {
  const quietMs = o.quietMs ?? RUN_QUIET_LIMIT_MS;
  const backstopMs = o.backstopMs ?? RUN_HANG_BACKSTOP_MS;
  const now = o.now ?? Date.now;
  const last = o.lastProgress ?? lastRunProgressAt;
  const startedAt = now();
  noteRunProgress(startedAt);
  let timer: ReturnType<typeof setInterval> | undefined;
  const hung = new Promise<T>((resolve, reject) => {
    timer = setInterval(() => {
      const t = now();
      const reason = t - Math.max(last(), startedAt) >= quietMs
        ? `no progress for ${Math.round(quietMs / 60_000)} minutes (hung)`
        : t - startedAt >= backstopMs
          ? `still running after the ${Math.round(backstopMs / 3_600_000)} h hang backstop`
          : null;
      if (!reason) return;
      clearInterval(timer);
      Promise.resolve().then(() => o.onHang(reason)).then(resolve, reject);
    }, o.checkEveryMs ?? 60_000);
    timer.unref?.();
  });
  return Promise.race([work, hung]).finally(() => clearInterval(timer));
}
