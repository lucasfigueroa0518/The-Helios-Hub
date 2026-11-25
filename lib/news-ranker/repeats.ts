/**
 * A different article about a story we already ran (spin-offs). Shared by Morning Download and Last Few Days:
 * each product passes its own memory of what it ran. Jev's SAME_EVENT set (verbatim, lib/news-ranker/questions)
 * is asked only for pairs whose headlines share a name, past item first (story_a), candidate second (story_b).
 * The first past item at or over SAME_EVENT_BAR is the candidate's match. Run it on the shortlist's top, before
 * the rerank, so the number of pairs stays bounded (at most candidates × past items).
 */
import { mapPool } from '@/lib/async-pool';
import { jevCostUsd, type JevAsk } from '@/lib/social/jev/client';

import { SAME_EVENT } from './questions';
import { namesIn, SAME_EVENT_BAR } from './scores';

/** A story we already ran. `body` is optional: Morning Download remembers only the headline. */
export type PastItem = { headline: string | null; body?: string | null };
export type SpinOffCandidate = { id: string; headline: string; text: string };

export const SPIN_OFF_BODY_CHARS = 1200;
const SPIN_OFF_CONCURRENCY = 4;

export async function findSpinOffs<P extends PastItem>(
  candidates: readonly SpinOffCandidate[],
  past: readonly P[],
  deps: {
    jev: JevAsk;
    /** Names the caller in the Jev subject ids ("<component>|<candidate id>"). */
    component: string;
    /** A headline's pairing names; default namesIn. */
    names?: (headline: string) => Set<string>;
    bodyChars?: number;
    concurrency?: number;
  },
): Promise<{ hits: Map<string, P>; costUsd: number; asked: number }> {
  const names = deps.names ?? namesIn;
  const chars = deps.bodyChars ?? SPIN_OFF_BODY_CHARS;
  // Only past items that have a headline can be compared.
  const withHeadline = past.filter((p): p is P & { headline: string } => Boolean(p.headline)).map((p) => ({ p, names: names(p.headline) }));
  const hits = new Map<string, P>();
  let costUsd = 0;
  let asked = 0;
  if (!withHeadline.length || !candidates.length) return { hits, costUsd, asked };
  await mapPool(candidates, deps.concurrency ?? SPIN_OFF_CONCURRENCY, async (c) => {
    const mine = names(c.headline);
    for (const { p, names: theirs } of withHeadline) {
      if (![...theirs].some((n) => mine.has(n))) continue;
      asked += 1;
      const res = await deps.jev(
        {
          state: {
            story_a: { headline: p.headline, untrusted_content: (p.body || p.headline).slice(0, chars) },
            story_b: { headline: c.headline, untrusted_content: c.text.slice(0, chars) },
          },
          questions: SAME_EVENT.questions,
        },
        { version: SAME_EVENT.version, subjectId: `${deps.component}|${c.id}` },
      );
      costUsd += jevCostUsd(res.usage);
      if ((res.answers.same_event?.noul ?? 0) < SAME_EVENT_BAR) continue;
      hits.set(c.id, p);
      break;
    }
  });
  return { hits, costUsd, asked };
}
