import { PRIMARY_EXCERPT_WORDS, SUPPORTING_EXCERPT_WORDS } from '@/lib/reels/config';
import { BUCKETS, FRAMEWORKS } from '@/lib/reels/jev/questions/scoring-shared';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';
import type { MemberRole } from '@/lib/reels/types';

const BUCKET_KEY: Record<BucketId, keyof typeof BUCKETS> = {
  ball_knowledge: 'ballKnowledge',
  the_number: 'theNumber',
  the_saga: 'theSaga',
  personal_profile: 'personalProfile',
  the_warning: 'theWarning',
  the_callout: 'theCallout',
};

export type ScoringMember = {
  role: MemberRole;
  sourceName: string;
  headline: string;
  body: string;
};

type MemberState = {
  role: MemberRole;
  source_name: string;
  headline: string;
  untrusted_content?: string;
};

/** First `words` of `text`, ending on a sentence when one falls in the last half. */
export function excerptWords(text: string, words: number): string {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= words) return tokens.join(' ');
  const window = tokens.slice(0, words).join(' ');
  const lastStop = window.lastIndexOf('. ');
  if (lastStop > window.length * 0.5) return window.slice(0, lastStop + 1);
  return `${window}…`;
}

function memberState(member: ScoringMember, wordLimit: number | null): MemberState {
  const state: MemberState = {
    role: member.role,
    source_name: member.sourceName,
    headline: member.headline,
  };
  if (wordLimit != null) {
    state.untrusted_content = excerptWords(member.body, wordLimit);
  }
  return state;
}

/**
 * D-084. One primary gets the long excerpt. Further primaries, if a grouping
 * glitch ever leaves two, get the supporting length. Merged duplicates send
 * the headline and source name only.
 */
export function buildPass1State(members: readonly ScoringMember[]): {
  post_idea: { members: MemberState[] };
} {
  const order: Record<MemberRole, number> = {
    primary: 0,
    supporting: 1,
    merged_duplicate: 2,
  };
  const sorted = [...members].sort((a, b) => order[a.role] - order[b.role]);
  let primaryUsed = false;

  return {
    post_idea: {
      members: sorted.map((member) => {
        if (member.role === 'merged_duplicate') return memberState(member, null);
        if (member.role === 'primary' && !primaryUsed) {
          primaryUsed = true;
          return memberState(member, PRIMARY_EXCERPT_WORDS);
        }
        return memberState(member, SUPPORTING_EXCERPT_WORDS);
      }),
    },
  };
}

export function buildPass2State(
  members: readonly ScoringMember[],
  framework: FrameworkId,
  bucket: BucketId,
): ReturnType<typeof buildPass1State> & {
  winning_framework: { name: string; meaning: string };
  winning_bucket: { name: string; meaning: string };
} {
  const frameworkCopy = FRAMEWORKS[framework];
  const bucketCopy = BUCKETS[BUCKET_KEY[bucket]];
  return {
    ...buildPass1State(members),
    winning_framework: { name: frameworkCopy.name, meaning: frameworkCopy.meaning },
    winning_bucket: { name: bucketCopy.name, meaning: bucketCopy.meaning },
  };
}
