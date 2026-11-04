/** Shared types for one-box seeding (design 2026-11-04-one-box-seeding-design). */

export type SeedVerticalKey = 'reels' | 'carousels' | 'last_few_days' | 'stories' | 'explainers';
export type StorySeries = 'morning_download' | 'guess_the_number' | 'free_vs_paid';
export type Stage = 'queued' | 'searching' | 'reading' | 'checking' | 'filing';

export type OneBoxInput = {
  vertical: SeedVerticalKey;
  series?: StorySeries;
  blurb: string;
  link?: string;
};

export type ReportedArticle = { url: string; headline: string; outlet: string };

/** What the search call reports (design section 3). */
export type Finding = {
  found: boolean;
  reason?: string;
  duplicateOf?: string;
  articles: ReportedArticle[];
  mainPoint?: string;
  conceptTitle?: string;
  number?: { value: string; fact: string; storyHeadline?: string };
  tool?: { name: string; url: string; description: string };
};

export type VerifiedArticle = ReportedArticle & { text: string };

export type Verified = {
  articles: VerifiedArticle[];
  conceptTitle?: string;
  number?: { value: string; fact: string; storyHeadline?: string };
  tool?: { name: string; url: string; description: string };
};
