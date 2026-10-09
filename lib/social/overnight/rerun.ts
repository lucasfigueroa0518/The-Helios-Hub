import type { PipelineStages } from '@/lib/social/pipeline/stages';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import type { Brief as ParsedBrief } from '@/lib/social/reporter/brief';
import type { PageRead, PageReadOk } from '@/lib/social/reporter/read-page';
import type { Query } from '@/lib/social/store/pg';

/**
 * A one-story rerun (Social Hub Regenerate, D51): the worker's queued run
 * makes one carousel's news story again, from the brief its post saved, like
 * scripts/social_rewrite_run.ts. The day's own orchestrator (runDay) runs it
 * with two stages swapped: selection is just that story, and the Reporter's
 * work is the saved brief (no spend; the pages it read are read again, free,
 * for the article photos). Writer, Editor, Hook, Fact-checker, mechanical and
 * design run as on any night, under the run's cost cap.
 */

export type RerunStory = { postId: string; storyId: string; title: string; brief: ParsedBrief; publishedAt: Date };

export async function loadRerunStory(query: Query, postId: string): Promise<RerunStory | null> {
  const { rows } = await query(
    `SELECT id::text AS id, story_id, title, brief, render->>'publishedAt' AS published_at, created_at
       FROM social.posts WHERE id = $1`,
    [postId],
  );
  const row = rows[0];
  if (!row?.story_id || !row.brief) return null;
  const published = new Date(row.published_at ?? row.created_at);
  return {
    postId: row.id,
    storyId: row.story_id,
    title: row.title,
    brief: row.brief as ParsedBrief,
    publishedAt: Number.isNaN(published.getTime()) ? new Date(row.created_at) : published,
  };
}

/** The stored story as the one candidate selection hands the run. */
export function rerunCandidate(story: RerunStory): ScoredCandidate {
  const sources = story.brief.sources ?? [];
  const outlets = [...new Set(sources.map((s) => s.outlet).filter(Boolean))];
  return {
    id: story.storyId,
    title: story.title,
    url: sources[0]?.url ?? '',
    members: sources.map((s) => ({ url: s.url, outlet: s.outlet, title: story.title, publishedAt: story.publishedAt, feedSlug: 'rerun' })),
    sources: sources.map((s) => s.url),
    outlets,
    outletCount: outlets.length,
    publishedAt: story.publishedAt,
    body: story.brief.the_news?.text ?? story.title,
    score: 1,
  };
}

/** The brief's pages read again (no model call); a page that fails to load is left out. */
export function rereadPages(story: RerunStory, readPage: (url: string) => Promise<PageRead>): () => Promise<PageReadOk[]> {
  return async () => {
    const reads = await Promise.all((story.brief.sources ?? []).map((s) => readPage(s.url).catch(() => null)));
    return reads.filter((r): r is PageReadOk => Boolean(r?.ok));
  };
}

/** The run's stages for a one-story rerun: selection and the Reporter come from the stored post. */
export function rerunStages(stages: PipelineStages, story: RerunStory, pages: () => Promise<PageReadOk[]> = async () => []): PipelineStages {
  return {
    ...stages,
    async score() {
      return { ok: true, value: [rerunCandidate(story)], costUsd: 0 };
    },
    async report(candidate) {
      return { ok: true, value: { storyId: candidate.id, parsed: story.brief, raw: '', pages: await pages() }, costUsd: 0 };
    },
  };
}
