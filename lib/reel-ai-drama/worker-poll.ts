/**
 * One pass of the drama worker's poll (scripts/reel_ai_drama_worker.ts), in order. Each step is caught on its own, so a
 * step that throws is reported and the next still runs: a one-box seed never blocks the night, and the night never blocks
 * a seed (one-box seeding v2, Review Focus 1). The worker supplies each step's body; the conditions (the night hour, the
 * insights clock) live inside them.
 */
export type PollStep = readonly [name: string, run: () => Promise<void>];

export type DramaPollHandlers = {
  /** A person's queued Develop / Calibrate click. */
  requests: () => Promise<void>;
  /** A queued one-box AI Drama seed (lib/seed/one-box/workers), claimed and run at once. */
  seeds: () => Promise<void>;
  tendPool: () => Promise<void>;
  night: () => Promise<void>;
  refill: () => Promise<void>;
  publish: () => Promise<void>;
  insights: () => Promise<void>;
};

/** The step order: the seeds step right after the requests step. */
export function dramaPollSteps(h: DramaPollHandlers): PollStep[] {
  return [
    ['requests', h.requests],
    ['seeds', h.seeds],
    ['tend_pool', h.tendPool],
    ['night', h.night],
    ['refill', h.refill],
    ['publish', h.publish],
    ['insights', h.insights],
  ];
}

export async function runPollPass(steps: readonly PollStep[], onError: (step: string, error: unknown) => void): Promise<void> {
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      onError(name, error);
    }
  }
}
