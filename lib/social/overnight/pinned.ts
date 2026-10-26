import type { ScoredGroup } from '@/lib/social/ingest/select/types';
import type { PipelineStages } from '@/lib/social/pipeline/stages';
import { toCandidate } from '@/lib/social/pipeline/selection-stage';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import type { Query } from '@/lib/social/store/pg';

/**
 * A run asked to make particular stories (Run now sends the top of the ranked
 * queue). Those stories are the run's whole selection: nothing is fetched,
 * scored or re-picked, and one that cannot be found fails the run loudly
 * instead of another story taking its place.
 *
 * The hub's idea pool is the shortlist stored in a daily run's record, and
 * every run replaces it, so a promoted story can sit in an older run's
 * shortlist. The newest copy of each story is used.
 */

/** How many runs back a pinned story is looked for. */
const RUNS_BACK = 12;

type StoredGroup = Omit<ScoredGroup, 'publishedAt' | 'members'> & {
  publishedAt: string | Date;
  members: Array<Omit<ScoredGroup['members'][number], 'publishedAt'> & { publishedAt: string | Date }>;
};

const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** A shortlist entry as stored (JSON) back into the group selection made. */
function revive(g: StoredGroup): ScoredGroup {
  return { ...g, publishedAt: asDate(g.publishedAt), members: g.members.map((m) => ({ ...m, publishedAt: asDate(m.publishedAt) })) } as ScoredGroup;
}

/** The candidates for `storyIds`, in the order asked. Throws, naming them, when any is in no recent run's shortlist. */
export async function loadPinnedCandidates(query: Query, storyIds: readonly string[]): Promise<ScoredCandidate[]> {
  if (!storyIds.length) return [];
  const { rows } = await query(
    `SELECT u.c AS group_json
       FROM (SELECT c, r.started_at
               FROM (SELECT record, started_at FROM social.runs
                      WHERE kind = 'daily' AND jsonb_typeof(record->'selection'->'shortlist') = 'array'
                      ORDER BY started_at DESC NULLS LAST LIMIT $2) r,
                    jsonb_array_elements(r.record->'selection'->'shortlist') c
             UNION ALL
             -- A person's seeded stories (lib/social/overnight/seeds.ts): as new as it gets, so a seed wins a tie.
             SELECT c, now() AS started_at
               FROM social.settings s, jsonb_array_elements(s.value) c
              WHERE s.key = 'carousel_seeds' AND jsonb_typeof(s.value) = 'array') u
      WHERE u.c->>'id' = ANY($1::text[])
      ORDER BY u.started_at DESC NULLS LAST`,
    [[...storyIds], RUNS_BACK],
  );
  const newest = new Map<string, StoredGroup>();
  for (const row of rows) {
    const g = (typeof row.group_json === 'string' ? JSON.parse(row.group_json) : row.group_json) as StoredGroup;
    if (!newest.has(g.id)) newest.set(g.id, g);
  }
  const missing = storyIds.filter((id) => !newest.has(id));
  if (missing.length) {
    throw new Error(`Run now asked for ${missing.length === 1 ? 'a story' : 'stories'} that ${missing.length === 1 ? 'is' : 'are'} not in any recent run's shortlist, so nothing was made instead: ${missing.join(', ')}`);
  }
  return storyIds.map((id, i) => toCandidate(revive(newest.get(id)!), storyIds.length - i));
}

/** The run's stages with selection replaced by exactly these stories (no feed read, no Jev spend). */
export function pinnedStages(stages: PipelineStages, candidates: readonly ScoredCandidate[]): PipelineStages {
  return {
    ...stages,
    async score() {
      return { ok: true, value: [...candidates], costUsd: 0 };
    },
  };
}
