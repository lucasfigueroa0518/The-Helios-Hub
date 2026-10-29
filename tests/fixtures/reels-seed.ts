/**
 * Shared setup for the Text on Screen seeding tests: PGlite with the real reels and hub schemas, one scored slate, and a stubbed
 * Jev transport (no live calls).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { EntryType, Questions } from '@typesafe-ai/sdk';

import { RecordingJevRunner, type JevTransport } from '@/lib/reels/jev/runner';

import { openHubTestDb } from './social-hub/pglite';

export const RUN = 'a0000000-0000-4000-8000-000000000001';
export const OLD_SLATE = 'a0000000-0000-4000-8000-000000000003';
export const NEW_SLATE = 'a0000000-0000-4000-8000-000000000004';
export const NORMAL = 'a0000000-0000-4000-8000-000000000011';
export const PAGE = 'A long page about a new model and what it changes for everyone building with it. '.repeat(6);

/** A stub transport: every score question answers 3 of 4 at 0.9 confidence, every yes/no 0.1. Counts the calls. */
export function stub(opts: { fail?: boolean } = {}) {
  const calls = { n: 0 };
  const transport: JevTransport = {
    async systemOne<const Q extends Questions>(_state: EntryType, questions: Q) {
      calls.n += 1;
      if (opts.fail) throw new Error('stub: model unavailable');
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, ['frontierDrop', 'blueChipCompany', 'blueChipPerson'].includes(k) ? { noul: 0.1 } : { score: 3, confidence: 0.9 }]));
      return { answers, usage: { input_tokens: 1000, output_tokens: 0 }, model: 'stub' } as never;
    },
  };
  return { calls, jev: new RecordingJevRunner(transport) };
}

export async function reelsDb(opts: { withSlate?: boolean } = {}): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  const query = (text: string, params?: unknown[]) => pg.query<any>(text, params as unknown[]);
  // dbTransaction needs a connect(); a PGlite session is one connection, so BEGIN/COMMIT on it is the transaction.
  // lib/db.ts sizes its query gate from pool.options.max (perf(hub) #21), so the stand-in pool must carry it.
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { options: { max: 4 }, query, connect: async () => ({ query, release: () => undefined }) };
  if (opts.withSlate !== false) {
    await pg.exec(`
      INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
      INSERT INTO reels.post_ideas (id, timely) VALUES ('${NORMAL}', false);
      INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
        ('${NEW_SLATE}', '${RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2');
      INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components) VALUES
        ('${NEW_SLATE}', '${NORMAL}', 'timely', 1.5, 1, true, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{}'::jsonb);`);
  }
  return pg;
}


