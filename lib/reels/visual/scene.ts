import { PRIMARY_EXCERPT_WORDS, SUPPORTING_EXCERPT_WORDS } from '@/lib/reels/config';
import { excerptWords } from '@/lib/reels/scoring/state';
import type { BucketId } from '@/lib/reels/scoring/decide';
import type { Bucket, MemberRole } from '@/lib/reels/types';

export type VisualCategory = 'education' | 'storytelling';

export type VisualMember = {
  role: MemberRole;
  sourceName: string;
  headline: string;
  body: string;
  sourceBucket: Bucket;
};

const STORYTELLING_BUCKETS = new Set<BucketId>(['the_saga', 'personal_profile']);

/**
 * The visual plan's category is education or storytelling.
 * Saga and personal profile are the storytelling reels. The other content
 * buckets are education. With no chosen bucket, the primary source's
 * phase-1 bucket is used: A education, B storytelling.
 */
export function visualCategory(bucket: BucketId | null, sourceBucket: Bucket | null): VisualCategory {
  if (bucket) return STORYTELLING_BUCKETS.has(bucket) ? 'storytelling' : 'education';
  return sourceBucket === 'B' ? 'storytelling' : 'education';
}

/** Caption is the reel script. Source excerpts keep the scene on this story. */
export function buildStory(caption: string | null, members: VisualMember[]): string {
  const parts: string[] = [];
  const script = caption?.trim();
  if (script) parts.push(script);
  for (const member of members) {
    const words =
      member.role === 'primary'
        ? PRIMARY_EXCERPT_WORDS
        : member.role === 'supporting'
          ? SUPPORTING_EXCERPT_WORDS
          : 0;
    const body = words > 0 ? excerptWords(member.body, words) : '';
    const block = [member.headline.trim(), body].filter(Boolean).join('\n');
    if (block) parts.push(block);
  }
  return parts.join('\n\n');
}

export function primarySourceBucket(members: VisualMember[]): Bucket | null {
  return members.find((member) => member.role === 'primary')?.sourceBucket ?? members[0]?.sourceBucket ?? null;
}

/** The four inputs the scene-writer prompt says it will receive. */
export function buildSceneUser(input: {
  story: string;
  category: VisualCategory;
  onScreenText: string;
  recentScenes: string[];
}): string {
  const recent =
    input.recentScenes.length > 0
      ? input.recentScenes.map((scene, index) => `${index + 1}. ${scene.trim()}`).join('\n\n')
      : '(none)';
  return ['STORY:', input.story.trim(), '', 'CATEGORY:', input.category, '', 'ON_SCREEN_TEXT:', input.onScreenText.trim(), '', 'RECENT_SCENES:', recent].join(
    '\n',
  );
}

/** The prompt asks for plain prose. Drop a fence or a leading [SCENE] label if one comes back. */
export function parseScene(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^\[SCENE[^\]]*\]\s*/i, '').trim();
  if (!text) throw new Error('Scene writer returned an empty scene.');
  return text;
}
