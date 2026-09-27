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
};

export type ReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'needs_revision'
  | 'rejected'
  | 'published';
