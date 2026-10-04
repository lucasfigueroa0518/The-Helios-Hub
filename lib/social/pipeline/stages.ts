/**
 * Stage contract for the orchestrator. Every stage is injected, so tests
 * and the dry run use stubs and nothing here can reach a model.
 */
import type { IngestArticle } from '@/lib/social/ingest/select/types';

import type { Brief, Draft, PostObject, ScoredCandidate, StageResult } from './types';

export type PipelineStages = {
  /**
   * Story selection (spec §5A #1, §5B): groups the day's articles, Jev
   * scores and ranks them; returns winners then backups, in run order.
   */
  score(articles: IngestArticle[], now: Date): Promise<StageResult<ScoredCandidate[]>>;
  /** Research the pick into a brief (spec §4). */
  report(story: ScoredCandidate): Promise<StageResult<Brief>>;
  /** Slides + caption + slide-type plan, one pass (spec §4, §4.3). */
  write(brief: Brief): Promise<StageResult<Draft>>;
  /** Line editor: cut and sharpen only (spec §4.1). */
  edit(draft: Draft, brief: Brief): Promise<StageResult<Draft>>;
  /** One pass, no loop (spec §4.2). */
  factCheck(draft: Draft, brief: Brief): Promise<StageResult<Draft>>;
  /** Images, cover, layout, render (spec §5). */
  design(draft: Draft, story: ScoredCandidate): Promise<StageResult<PostObject>>;
  /** Plain-code guarantees (spec §6). */
  mechanical(post: PostObject): Promise<StageResult<PostObject>>;
};
