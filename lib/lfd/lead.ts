/**
 * Slide order (spec §4.2): Jev judges each written story with lfd-lead@1 and
 * the post opens with the highest score, whatever lane picked the story. Lanes
 * decide only which stories get in. If any judgment fails, the order the run
 * already had stands and the run record says so.
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';

import { LFD_LEAD, LFD_LEAD_WEIGHTS } from './questions';
import type { Ready } from './types';

const SOURCE_CHARS = 3000;
const LEAD_CONCURRENCY = 6;

export function leadScore(answers: Record<string, { noul: number } | undefined>): number {
  return Object.entries(LFD_LEAD_WEIGHTS).reduce((s, [k, w]) => s + w * (answers[k]?.noul ?? 0), 0);
}

export type LeadOrder = { order: Ready[]; by: 'jev' | 'fallback'; scores: Map<string, number>; error?: string };

/**
 * `known` holds scores already judged this run (keyed by story key) and is
 * filled in as stories are judged, so a re-order after a replacement round
 * asks Jev only about the new stories.
 */
export async function leadOrder(list: Ready[], jev: JevAsk, known: Map<string, number>): Promise<LeadOrder> {
  const errors: string[] = [];
  await mapPool(list, LEAD_CONCURRENCY, async (r) => {
    if (known.has(r.pick.key)) return;
    try {
      const res = await jev(
        {
          state: {
            headline: r.copy.headline,
            blurb: r.copy.body,
            outlets: [...new Set([r.pick.sourceName, ...r.pick.alsoFrom].filter(Boolean))],
            story: { untrusted_content: r.pick.body.slice(0, SOURCE_CHARS) },
          },
          questions: LFD_LEAD.questions,
        },
        { version: LFD_LEAD.version, subjectId: r.pick.key },
      );
      known.set(r.pick.key, leadScore(res.answers as Record<string, { noul: number }>));
    } catch (err) {
      errors.push(`${r.pick.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const scores = new Map(list.flatMap((r) => (known.has(r.pick.key) ? [[r.pick.key, known.get(r.pick.key)!] as const] : [])));
  if (errors.length) return { order: [...list], by: 'fallback', scores, error: errors.join('; ') };
  const order = list.map((r, i) => ({ r, i })).sort((a, b) => scores.get(b.r.pick.key)! - scores.get(a.r.pick.key)! || a.i - b.i).map((x) => x.r);
  return { order, by: 'jev', scores };
}
