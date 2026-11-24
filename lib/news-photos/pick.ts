/**
 * The pick (scripts/md-photo-trial.ts): good photos first, then usable; within a tier by rounded clarity, then source
 * (article, other outlet, search, extra). Haiku's lenient blatantly-AI check (D19) runs on each pick in that order; a
 * rejected pick falls through to the next. REAL_CHECK_SYSTEM is imported from lib/video-finder/find.ts (verbatim copy).
 */
import type Anthropic from '@anthropic-ai/sdk';

import type { WriterCreate } from '@/lib/stories/writer';
import { REAL_CHECK_SYSTEM } from '@/lib/video-finder/find';

import { askHaiku } from './brief';
import { SOURCE_RANK } from './candidates';
import type { GradedPhoto, MediaVerdict } from './grade';
import { visionImage } from './vision-bytes';

export { REAL_CHECK_SYSTEM };

export const REAL_TOOL: Anthropic.Tool = { name: 'real_check', description: 'Whether the picture is blatantly AI-made.', input_schema: { type: 'object', properties: { blatantly_ai: { type: 'boolean' } }, required: ['blatantly_ai'] } };

/** Pure: the order the pick tries candidates in. */
export function pickOrder(graded: GradedPhoto[]): GradedPhoto[] {
  const order = (t: MediaVerdict) => graded.filter((c) => c.tier === t).sort((x, y) => Math.round(y.clarity) - Math.round(x.clarity) || SOURCE_RANK[x.source] - SOURCE_RANK[y.source]);
  return [...order('good'), ...order('usable')];
}

export async function blatantlyAi(jpeg: Buffer, create: WriterCreate): Promise<{ ai: boolean; message: Anthropic.Message }> {
  const v = await visionImage(jpeg);
  const { input, message } = await askHaiku<{ blatantly_ai?: boolean }>(create, REAL_CHECK_SYSTEM, REAL_TOOL, [{ type: 'image', source: { type: 'base64', media_type: v.mediaType, data: v.bytes.toString('base64') } }], 1000);
  return { ai: Boolean(input?.blatantly_ai), message };
}

/**
 * The first candidate in pick order that isn't blatantly AI. A failed check keeps the photo (the check is lenient by
 * design: "when in doubt, answer no") and says so in the log.
 */
export async function pickPhoto(graded: GradedPhoto[], create: WriterCreate): Promise<{ pick: GradedPhoto | null; messages: Anthropic.Message[]; log: string[]; aiRejected: string[] }> {
  const messages: Anthropic.Message[] = [];
  const log: string[] = [];
  const aiRejected: string[] = [];
  for (const c of pickOrder(graded)) {
    try {
      const r = await blatantlyAi(c.jpeg, create);
      messages.push(r.message);
      if (r.ai) { aiRejected.push(c.src); log.push(`AI check: blatantly AI → next (${c.src})`); continue; }
    } catch (e) {
      log.push(`AI check failed (${e instanceof Error ? e.message : String(e)}) → kept (${c.src})`);
    }
    log.push(`pick: ${c.tier}, clarity ${c.clarity.toFixed(1)}, ${c.source} ${c.src}`);
    return { pick: c, messages, log, aiRejected };
  }
  log.push('pick: none');
  return { pick: null, messages, log, aiRejected };
}
