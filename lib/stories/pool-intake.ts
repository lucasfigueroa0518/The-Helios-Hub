/**
 * The consumer switch for the Stories series that read ideas (Phase 1, round 4): each
 * series reads either the central intake or today's sources, per
 * `intake.settings` key 'consumers' (readConsumerMode). 'intake' with no
 * successful main run in 26 h comes back 'stale-fallback' and reads today's
 * sources, and an intake read that fails reads today's sources for that series
 * ('error-fallback'), so an intake failure never blocks a set. The pool refresh
 * records which source each series read.
 *
 *   Morning Download  order 'md'   morning()
 *
 * Free vs. Paid is retired (SS-31): its order 'fvp' is gone, so `leads()` always reads today's path and its mode
 * stays 'legacy' (PoolModes keeps the key until lib/stories/pool.ts drops it). AI Trivia reads nothing here: its
 * daily writer reads its own order 'trivia' (lib/stories/trivia/research.ts).
 */
import { intakePoolReads, type CarouselPhotos, type IntakePoolDeps } from '@/lib/intake/pool-stories';
import { readConsumerMode as liveReadConsumerMode } from '@/lib/intake/read';
import type { IntakeQuery, OrderId } from '@/lib/intake/types';
import type { Queryable } from '@/lib/stories/db';
import { livePoolReads, type PoolModes, type PoolReads, type SeriesSource } from '@/lib/stories/pool';
import { postPhoto } from '@/lib/stories/sources/carousel';
import { storyKey } from '@/lib/stories/sources/reels';

export const ALL_LEGACY: PoolModes = { md: 'legacy', fvp: 'legacy' };

export type ReadConsumerMode = (q: IntakeQuery, order: OrderId, now: Date) => Promise<SeriesSource>;

export type StoriesPoolOptions = {
  readMode?: ReadConsumerMode;
  /** The intake reads' dependencies (the posted check's Jev above all). */
  intake?: IntakePoolDeps;
  /** Tests swap either side. */
  legacyReads?: (sourceDb: Queryable, now: Date) => PoolReads;
  intakeReads?: (q: IntakeQuery, now: Date, deps: IntakePoolDeps) => PoolReads;
};

/** Each series' source now. A mode that cannot be read is legacy (today's path). */
export async function readPoolModes(q: IntakeQuery, now: Date, readMode: ReadConsumerMode = liveReadConsumerMode): Promise<PoolModes> {
  const one = (order: OrderId) => readMode(q, order, now).catch((): SeriesSource => 'legacy');
  return { ...ALL_LEGACY, md: await one('md') };
}

export const anyIntake = (m: PoolModes) => m.md === 'intake';

/**
 * The photo each pipeline carousel post of the last 30 hours placed (S-29), by storyKey of its story id: what
 * morningDownloadCarousel attaches. Another type's output, read when there (read-only, never waited on).
 */
export async function carouselPostPhotos(sourceDb: Queryable, now: Date): Promise<CarouselPhotos> {
  const { rows } = await sourceDb.query<{ story_id: string | null; render: Record<string, unknown> }>(
    `SELECT story_id, render FROM social.posts WHERE origin = 'pipeline' AND story_id IS NOT NULL AND created_at > $1::timestamptz - interval '30 hours'`,
    [now.toISOString()],
  );
  const out: CarouselPhotos = new Map();
  for (const r of rows) {
    const photo = postPhoto(r.render);
    if (r.story_id && photo) out.set(storyKey(r.story_id), { ...photo, storyId: r.story_id });
  }
  return out;
}

/**
 * The pool's reads, per series: the intake's for a series in 'intake' mode, today's otherwise. Modes are read once,
 * lazily (the worker builds this every pass; only a due refresh reads it).
 */
export function storiesPoolReads(sourceDb: Queryable, now: Date, opts: StoriesPoolOptions = {}): PoolReads & { modes: () => Promise<PoolModes> } {
  let memo: Promise<PoolModes> | null = null;
  const modes = () => (memo ??= readPoolModes(sourceDb, now, opts.readMode));
  const legacy = (opts.legacyReads ?? livePoolReads)(sourceDb, now);
  const intake = (opts.intakeReads ?? intakePoolReads)(sourceDb, now, { carouselPhotos: () => carouselPostPhotos(sourceDb, now), ...opts.intake });
  // A series in intake mode whose intake read throws reads today's sources instead, and its mode records
  // 'error-fallback' (fix 7): one series' intake trouble never blocks it or the others.
  const read = async <T>(series: keyof PoolModes, call: (reads: PoolReads) => Promise<T>): Promise<T> => {
    const m = await modes();
    if (m[series] !== 'intake') return call(legacy);
    try {
      return await call(intake);
    } catch {
      m[series] = 'error-fallback';
      return call(legacy);
    }
  };
  return {
    modes,
    morning: () => read('md', (r) => r.morning()),
    leads: () => legacy.leads(), // SS-31: Free vs. Paid is retired; no intake read
    carouselRunAt: async () => {
      const m = await modes();
      // Legacy Morning Download reads the carousel run; a series on the intake reads its runs.
      const marks = await Promise.all([
        m.md !== 'intake' ? legacy.carouselRunAt?.().catch(() => null) : null,
        anyIntake(m) ? intake.carouselRunAt?.().catch(() => null) : null,
      ]);
      const at = marks.filter((x): x is string => Boolean(x)).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      return at ?? null;
    },
  };
}
