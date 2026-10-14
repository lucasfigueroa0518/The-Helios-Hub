'use client';

import { useEffect, useRef } from 'react';

/**
 * Poll `task` every `intervalMs` while the tab is visible. Pass null/0/false to stop.
 *
 * Unlike a bare setInterval:
 * - the next run is scheduled only after the previous one settles, so a slow
 *   server never collects a pile of overlapping requests;
 * - a hidden tab stops polling, and the page catches up once when it is shown again.
 *
 * The task is read from a ref, so passing an inline function does not restart the timer.
 * `immediate` runs the task once as soon as polling starts.
 */
export function usePoll(
  task: () => unknown,
  intervalMs: number | null | false | undefined,
  options: { immediate?: boolean } = {},
): void {
  const taskRef = useRef(task);
  taskRef.current = task;
  const immediate = options.immediate ?? false;

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return undefined;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stopped || document.hidden) return;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), intervalMs);
    };

    const run = async () => {
      if (stopped || running) return;
      if (document.hidden) return;
      running = true;
      try {
        await taskRef.current();
      } catch {
        // A missed poll leaves the last state on screen; the next one retries.
      } finally {
        running = false;
        schedule();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        return;
      }
      void run();
    };

    if (immediate) void run();
    else schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, immediate]);
}
