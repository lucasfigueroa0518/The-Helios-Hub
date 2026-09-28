/**
 * Domain types for Helios Social. Shapes mirror helios_social.article_queue
 * columns with camelCase field names for the UI.
 */

export type IngestStatus =
  | 'pending_score'
  | 'rejected'
  | 'approved_for_draft'
  | 'drafted';

export type Article = {
  id: string;
  source: string;
  sourceUrl: string;
  headline: string;
  byline: string | null;
  body: string;
  feedSlug: string | null;
  publishedAt: string | null;
  addedAt: string;
  ingestStatus: IngestStatus;

  // LLM verdict
  relevanceScore: number | null;
  relevanceReason: string | null;
  rejectedReason: string | null;

  // Extraction packet — the data the slide generator hydrates
  people: string[];
  companies: string[];
  products: string[];
  topics: string[];
  notableNumber: string | null;
  bullets: string[];

  // Generation + review state
  hasGeneratedPost: boolean;
  renderSlug: string | null;
  reviewStatus: ReviewStatus | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;

  // Pipeline routing + v2 telemetry (surface-only fields for the review UI).
  pipelineVersion: PipelineVersion;
  composeStatus: ComposeStatus | null;
  /** When composeStatus is 'needs_human_review', the pipeline's short reason. */
  needsHumanReviewReason: string | null;
  /** When composeStatus is 'needs_human_review', the last fact-check round's flags as plain text. */
  needsHumanReviewFlags: PipelineFlagSummary[];
};

export type PipelineVersion = 'legacy' | 'creator';

export type ComposeStatus =
  | 'pending_compose'
  | 'composing'
  | 'composed'
  | 'compose_failed'
  | 'needs_human_review';

export type PipelineFlagSummary = {
  where: string;
  text: string;
  problem: string;
  size: 'SMALL' | 'BIG';
};

export type ReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'needs_revision'
  | 'rejected'
  | 'published';
