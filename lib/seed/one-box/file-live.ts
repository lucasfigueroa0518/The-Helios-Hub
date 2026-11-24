import { anthropic } from '@/lib/anthropic';
import { dbQuery } from '@/lib/db';
import { explainersDb } from '@/lib/explainers/connection';
import { addAndEvaluateTopics } from '@/lib/explainers/ideas/cycle';
import { anthropicIdeaModel } from '@/lib/explainers/ideas/generator';
import { addLfdSeed, readOpenSeeds as readOpenLfdSeeds } from '@/lib/lfd/seeds';
import { liveJevTransport, createLiveJevRunner } from '@/lib/reels/jev/client';
import { addReelSeed, findQueueDuplicate, readOpenSeeds as readOpenReelSeeds } from '@/lib/reels/seeds';
import { canonicalizeUrl } from '@/lib/reels/net/http';
import { fetchBodyLive } from '@/lib/social/ingest/select/enrich';
import { createJevAsk } from '@/lib/social/jev/client';
import { addCarouselSeed, readOpenSeeds as readOpenCarouselSeeds } from '@/lib/social/overnight/seeds';
import { seedIdea } from '@/lib/stories/seed';
import { liveStoriesDb } from '@/lib/stories/db';

import { guessSubject, normalizeSourceUrl } from '@/app/api/field-notes/seed/handler';
import { saveSeededLink } from '@/lib/field-notes/store';
import { canonicalSourceUrl } from '@/lib/field-notes/sources/candidate';

import type { FileDeps } from './file';

/**
 * The real add functions and read-only pool lookups behind `FileDeps` (design sections 3, 6, 7). Each lookup reads one pool for
 * one seed and never writes (CLAUDE.md Rule 2). The headline lists are the pool's open seeds plus its most recent queued or
 * made items, at most 40: a bounded lookup for the agent's duplicate check, not the hub's full view. The per-type duplicate
 * check on the found URL and the add functions' own refusals are the backstop.
 */

const MAX_HEADLINES = 40;
const query = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;
const rows = async (text: string, params?: unknown[]): Promise<string[]> => {
  try {
    const out = await dbQuery<{ h: string }>(text, params as never);
    return out.rows.map((r) => r.h).filter(Boolean);
  } catch {
    return [];
  }
};
const uniq = (xs: string[]) => [...new Set(xs)].slice(0, MAX_HEADLINES);

export function liveFileDeps(): FileDeps {
  return {
    reel: (a) => addReelSeed({ headline: a.headline, url: a.url, text: a.text }, { jev: createLiveJevRunner() }),
    carousel: (a) => addCarouselSeed(query as never, a, { fetchBody: fetchBodyLive, jev: createJevAsk() }),
    lfd: (a) => addLfdSeed(query as never, a, { fetchBody: fetchBodyLive }),
    story: (body) => seedIdea(liveStoriesDb, body),
    explainer: async (t) => {
      const db = await explainersDb();
      const [r] = await addAndEvaluateTopics({ db, jevTransport: liveJevTransport, ideaModel: anthropicIdeaModel(anthropic), moves: query as never }, [t]);
      return { topicId: r!.topicId, title: r!.title };
    },
    fieldNote: async (a) => {
      const link = normalizeSourceUrl(a.sourceUrl);
      if ('error' in link) throw new Error(link.error);
      const { subject, label } = guessSubject(canonicalSourceUrl(link.url));
      // seededBy 'one-box': the request table stores no user id (v1 design). The person's words are the note.
      const out = await saveSeededLink(query as never, { sourceUrl: link.url, sourceLabel: label, subject, leaf: a.leaf, want: a.want, useWithResult: a.note, seededBy: 'one-box' });
      return out.kind === 'duplicate' ? { duplicate: out.subject || out.sourceUrl } : { id: out.tipId, title: out.subject };
    },
    headlines: async (vertical) => {
      switch (vertical) {
        case 'reels': {
          const open = (await readOpenReelSeeds().catch(() => [])).map((s) => s.headline);
          const slate = await rows(
            `SELECT s.headline AS h FROM reels.idea_scores sc
               JOIN reels.post_idea_members m ON m.post_idea_id = sc.post_idea_id AND m.role = 'primary'
               JOIN reels.sources s ON s.id = m.source_id
              WHERE sc.slate_id = (SELECT id FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1)
              ORDER BY sc.rank NULLS LAST LIMIT ${MAX_HEADLINES}`,
          );
          return uniq([...open, ...slate]);
        }
        case 'carousels': {
          const open = (await readOpenCarouselSeeds(query as never).catch(() => [])).map((s) => s.representative.headline);
          return uniq([...open, ...(await rows(`SELECT title AS h FROM social.posts WHERE origin = 'pipeline' ORDER BY created_at DESC LIMIT 30`))]);
        }
        case 'last_few_days': {
          const open = (await readOpenLfdSeeds(query as never, new Date()).catch(() => [])).map((s) => s.headline);
          return uniq(open);
        }
        case 'stories':
          return uniq(await rows(`SELECT title AS h FROM stories.pool WHERE series = $1 AND used_at IS NULL ORDER BY score DESC NULLS LAST LIMIT ${MAX_HEADLINES}`, ['morning_download']));
        case 'explainers':
          return uniq(await rows(`SELECT title AS h FROM explainers.topics WHERE status = 'pool' ORDER BY created_at DESC LIMIT ${MAX_HEADLINES}`));
        case 'field_notes':
          return uniq(await rows(`SELECT subject AS h FROM field_notes.tips WHERE status = 'candidate' ORDER BY created_at DESC LIMIT ${MAX_HEADLINES}`));
        default:
          return []; // The the worker-run types read their own pools in later tasks
      }
    },
    existing: async (vertical, url, headline) => {
      if (vertical !== 'reels') return null; // carousels and Last Few Days refuse inside their add functions; Stories and Explainers have no URL check
      const dup = await findQueueDuplicate(canonicalizeUrl(url), headline);
      return dup ? dup.existing.headline : null;
    },
  };
}
