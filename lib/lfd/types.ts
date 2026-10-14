/** Last Few Days shared types (spec docs/superpowers/specs/2026-10-13-last-few-days-design.md). */
import type { Photo } from '@/lib/stories/render/types';

/** NY dates: slates with after < ny_date <= through (spec §3.1). */
export type LfdWindow = { after: string; through: string };

export type Origin = 'reels' | 'carousel' | 'feed';
export type Lane = 'major' | 'rundown';

export type LfdCandidate = {
  /** storyKey(url): one key per article. */
  key: string;
  /** Every source id behind the story (reels post_idea ids, carousel story ids, feed URLs); merged stories carry all. */
  refs: string[];
  origin: Origin;
  headline: string;
  sourceName: string;
  url: string;
  body: string;
  publishedAt: string | null;
  /** Reels best net across every night scored (timely and carryover); null outside reels. */
  net: number | null;
  blockbuster: number;
  /** Reels: the NY date of the idea's first timely slate. */
  firstSeen: string | null;
  alsoFrom: string[];
  /** major-news@2 score once judged; null when not judged. */
  major: number | null;
};

export type Pick = LfdCandidate & { lane: Lane };

export type StoryPhotoRequest = {
  kind: string;
  query: string;
  subjects: Array<{ name: string; type: 'person' | 'organization' }>;
  alts: Array<{ kind: string; query: string }>;
};

/** One story's written copy (spec §4.1). `headline` has no leading dash; code adds "– " at render. */
export type StoryCopy = {
  key: string;
  setup: string;
  headline: string;
  highlight: string;
  names: string[];
  body: string;
  photo: StoryPhotoRequest;
};

/**
 * A story with its photo. `photoSource`: the article's own lead image, or the
 * Stories finder. `photoTrace`: how that photo was chosen (finder steps, or the
 * lead-image note), saved on the post for the review screen.
 */
export type Ready = { pick: Pick; copy: StoryCopy; photo: Photo; photoSource?: 'lead' | 'finder'; photoTrace?: string[] };

/** A story that left the post, and why (the run record, spec §7.1). `unfinished`: still pending when the rounds ran out. */
export type Drop = {
  key: string;
  lane: Lane;
  headline: string;
  reason: 'thin-text' | 'not-grounded' | 'no-photo' | 'write-failed' | 'image-failed' | 'vision-rejected' | 'unfinished';
  /** Why, when there is more to say (the vision check's reason, a refused fallback photo). */
  detail?: string;
};
