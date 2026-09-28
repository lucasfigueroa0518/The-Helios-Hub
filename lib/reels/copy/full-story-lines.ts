import type { BucketId } from '@/lib/reels/scoring/decide';

/**
 * Eight cue lines per content bucket (D-198). Jev picks one for the reel.
 * The downward hand is not part of the line. The text engine draws it after
 * whichever line wins.
 */
export const FULL_STORY_LINES: Record<BucketId, readonly [string, string, string, string, string, string, string, string]> = {
  ball_knowledge: [
    'The names are below',
    'The short list',
    'What to use instead',
    'The repos are below',
    'See what replaced them',
    'What they unlock',
    'The tools, named',
    'What to switch to',
  ],
  the_number: [
    'Where that number comes from',
    'The source is below',
    'How they counted',
    'The breakdown',
    'What the number misses',
    'Why the number looks like that',
    'What it costs you',
    'The rest of the figure',
  ],
  the_saga: [
    'What happened next',
    'How it ended',
    'Then it got worse',
    'The rest of the week',
    'What they did next',
    'The turn is below',
    'Keep going',
    'The full week',
  ],
  personal_profile: [
    'How both are true',
    'The years in between',
    'How he got there',
    'The missing years',
    'What happened to him',
    'The turn',
    'What changed',
    'The part that explains it',
  ],
  the_warning: [
    'What to do instead',
    'The fix is below',
    'The replacement',
    'Do this instead',
    'How to stop it',
    'The way out',
    'What to switch to',
    'Why it costs that',
  ],
  the_callout: [
    'The argument is below',
    'Why this holds',
    'The objection, answered',
    'The case',
    'Why the line is there',
    'The other side',
    'What this leaves standing',
    'Read the reasoning',
  ],
};

export const FULL_STORY_LINE_COUNT = 8;

export function fullStoryLines(bucket: BucketId): readonly string[] {
  return FULL_STORY_LINES[bucket];
}
