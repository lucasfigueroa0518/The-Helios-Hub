/**
 * The consumer switch for the three Stories series (Phase 1, round 4): each
 * series reads either the central intake or today's sources, per
 * `intake.settings` key 'consumers' (readConsumerMode). 'intake' with no
 * successful main run in 26 h comes back 'stale-fallback' and reads today's
 * sources, and an intake read that fails reads today's sources for that series
 * ('error-fallback'), so an intake failure never blocks a set. The pool refresh
 * records which source each series read.
 *
 *   Morning Download  order 'md'   morning()
 *   Guess the Number  order 'gtn'  numbers()
 *   Free vs. Paid     order 'fvp'  leads()
 */
import { intakePoolReads, type CarouselPhotos, type IntakePoolDeps } from '@/lib/intake/pool-stories';
import { readConsumerMode as liveReadConsumerMode } from '@/lib/intake/read';
import type { IntakeQuery, OrderId } from '@/lib/intake/types';
import type { Queryable } from '@/lib/stories/db';
import { livePoolReads, type PoolModes, type PoolReads, type SeriesSource } from '@/lib/stories/pool';
import { postPhoto } from '@/lib/stories/sources/carousel';
import { storyKey } from '@/lib/stories/sources/reels';

export const ALL_LEGACY: PoolModes = { md: 'legacy', gtn: 'legacy', fvp: 'legacy' };

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
  const [md, gtn, fvp] = await Promise.all([one('md'), one('gtn'), one('fvp')]);
  return { md, gtn, fvp };
}

export const anyIntake = (m: PoolModes) => m.md === 'intake' || m.gtn === 'intake' || m.fvp === 'intake';

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
    numbers: () => read('gtn', (r) => r.numbers()),
    leads: () => read('fvp', (r) => r.leads()),
    carouselRunAt: async () => {
      const m = await modes();
      // Legacy Morning Download and Guess the Number read the carousel run; a series on the intake reads its runs.
      const marks = await Promise.all([
        m.md !== 'intake' || m.gtn !== 'intake' ? legacy.carouselRunAt?.().catch(() => null) : null,
        anyIntake(m) ? intake.carouselRunAt?.().catch(() => null) : null,
      ]);
      const at = marks.filter((x): x is string => Boolean(x)).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      return at ?? null;
    },
  };
}
