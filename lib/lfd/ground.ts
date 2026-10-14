/** Fact check (spec §4.4): Morning Download's md-grounding@1, bar 0.6, over the whole slide's words. */
import { GROUNDING_BAR } from '@/lib/stories/build/morning-download';
import { MD_GROUNDING } from '@/lib/stories/questions';
import type { JevAsk } from '@/lib/social/jev/client';

import type { StoryCopy } from './types';

const SOURCE_CHARS = 9000;

export const REWRITE_NOTE = 'The fact check found a claim in your copy for this story that the source text does not support. Rewrite it so every name, number, date and cause is stated in the source. Keep the same limits.';

export function slideText(copy: StoryCopy): string {
  return [copy.setup, `${copy.headline}.`, copy.body].filter(Boolean).join(' ');
}

export async function grounded(jev: JevAsk, copy: StoryCopy, source: string): Promise<boolean> {
  const res = await jev(
    { state: { headline: slideText(copy), source: { untrusted_content: source.slice(0, SOURCE_CHARS) } }, questions: MD_GROUNDING.questions },
    { version: MD_GROUNDING.version, subjectId: copy.key },
  );
  return (res.answers.supported?.noul ?? 0) >= GROUNDING_BAR;
}
