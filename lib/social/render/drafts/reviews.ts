export type ReviewChoice = 'old' | 'new' | 'revise';

export type RevisionWork = 'idle' | 'queued' | 'working' | 'ready' | 'error';

export type TemplateReview = {
  id: string;
  choice: ReviewChoice;
  notes: string;
  updatedAt: string;
  work?: RevisionWork;
  step?: string;
  generation?: number;
};

export type ReviewStore = {
  reviews: Record<string, TemplateReview>;
};

export const DRAFT_FILES: Record<string, { tsx: string; css: string; rationale: string }> = {
  'cover-bleed': { tsx: 'cover-bleed.tsx', css: 'cover-bleed.css', rationale: 'cover-bleed.rationale.md' },
  'cover-split': { tsx: 'cover-split.tsx', css: 'cover-split.css', rationale: 'cover-split.rationale.md' },
  'cover-logo': { tsx: 'cover-logo.tsx', css: 'cover-logo.css', rationale: 'cover-logo.rationale.md' },
  'cover-icon': { tsx: 'cover-icon.tsx', css: 'cover-icon.css', rationale: 'cover-icon.rationale.md' },
  text: { tsx: 'text.tsx', css: 'text.css', rationale: 'text.rationale.md' },
  landing: { tsx: 'landing.tsx', css: 'landing.css', rationale: 'landing.rationale.md' },
  stat: { tsx: 'stat.tsx', css: 'stat.css', rationale: 'stat.rationale.md' },
  'split-stat': { tsx: 'split-stat.tsx', css: 'split-stat.css', rationale: 'split-stat.rationale.md' },
  quote: { tsx: 'quote.tsx', css: 'quote.css', rationale: 'quote.rationale.md' },
  image: { tsx: 'image.tsx', css: 'image.css', rationale: 'image.rationale.md' },
  follow: { tsx: 'follow.tsx', css: 'follow.css', rationale: 'follow.rationale.md' },
};

export function isBusy(work: RevisionWork | undefined): boolean {
  return work === 'queued' || work === 'working';
}
