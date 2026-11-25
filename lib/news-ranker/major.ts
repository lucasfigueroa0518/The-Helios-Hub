/**
 * One story's major-news score from Jev (MAJOR_NEWS, verbatim in ./questions; majorNewsScore in ./scores).
 * Used by the ranker's current scores (rank.ts) and by Last Few Days for a seed with no stored score.
 */
import { jevCostUsd, type JevAnswer, type JevAsk } from '@/lib/social/jev/client';

import { MAJOR_NEWS } from './questions';
import { majorNewsScore } from './scores';

export type MajorNewsStory = { key: string; headline: string; text: string; outlets: string[]; published: string | null };

export async function askMajorNews(jev: JevAsk, s: MajorNewsStory): Promise<{ major: number; costUsd: number; answers: Record<string, JevAnswer> }> {
  const res = await jev(
    { state: { headline: s.headline, outlets: s.outlets, published: s.published, story: { untrusted_content: s.text } }, questions: MAJOR_NEWS.questions },
    { version: MAJOR_NEWS.version, subjectId: s.key },
  );
  return { major: majorNewsScore(res.answers as Record<string, { noul: number }>), costUsd: jevCostUsd(res.usage), answers: res.answers };
}
