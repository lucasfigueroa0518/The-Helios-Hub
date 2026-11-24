/**
 * The production photo finder for the news chain (MD-LFD D17–D24, wiring contract Owner B, 2026-11-24):
 * Haiku brief → candidates (article, duplicate outlets, one Serper image search, extras) under the ledger and size
 * floor (WC12) → Jev grades → good, then usable, by clarity → Haiku's lenient AI check on the pick (fail → next).
 * fitToBand (band.ts) fits the pick into the Morning Download photo band (WC11: MD only). Clients are injected.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import type { WriterCreate } from '@/lib/stories/writer';

import { PHOTO_HAIKU, writeBrief, type PhotoBrief } from './brief';
import { gatherCandidates, SERPER_USD, type Candidate, type CandidateDeps, type PhotoStory } from './candidates';
import { gradePhoto, type GradedPhoto, type MediaVerdict, type PhotoJev } from './grade';
import { pickOrder, pickPhoto } from './pick';

export * from './brief';
export * from './candidates';
export * from './grade';
export * from './pick';
export * from './band';

export type PhotoResult = {
  id: string;
  tier: MediaVerdict;
  pick: GradedPhoto | null;
  brief: PhotoBrief | null;
  costUsd: number;
  log: string[];
  /**
   * The runner-ups: every other good or usable candidate in pick order, minus any the AI check turned down. The photo
   * bank stores them as `passed` (lib/news-photos/bank-offer.ts). Absent on a result made outside the finder.
   */
  passed?: GradedPhoto[];
};
export type PhotoDeps = CandidateDeps & {
  /** Haiku brief + AI check (claude-haiku-5-5). */
  create: WriterCreate;
  /** TypeSafe client, header TypeSafe-Danger-Zone-Images. */
  jev: PhotoJev;
};

export async function findStoryPhoto(s: PhotoStory, deps: PhotoDeps, o: { extra?: Candidate[] } = {}): Promise<PhotoResult> {
  const msgs: Anthropic.Message[] = [];
  const log: string[] = [];
  let jevUsd = 0, serperUsd = 0;
  const cost = () => (msgs.length ? Number(priceAnthropicMessages(msgs, { modelId: PHOTO_HAIKU }).costUsd) : 0) + jevUsd + serperUsd;
  const done = (tier: MediaVerdict, pick: GradedPhoto | null, brief: PhotoBrief | null, passed: GradedPhoto[] = []): PhotoResult => ({ id: s.id, tier, pick, brief, costUsd: cost(), log, passed });

  let brief: PhotoBrief | null = null;
  try {
    const b = await writeBrief(s.headline, s.text || s.headline, deps.create);
    msgs.push(b.message);
    brief = b.brief;
  } catch (e) {
    log.push(`brief failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!brief) { log.push('no brief → none'); return done('none', null, null); }
  log.push(`brief: ${brief.kind}: ${brief.subject} (good if ${brief.good_if})`);

  const c = await gatherCandidates(s, brief, deps, o.extra ?? []);
  serperUsd += c.serperCalls * SERPER_USD;
  log.push(...c.log);

  const graded = await Promise.all(c.fetched.map((f) => gradePhoto(f, s.headline, brief!, deps.jev)));
  for (const g of graded) {
    jevUsd += g.costUsd;
    log.push(g.answers ? `grade ${g.photo.tier} clarity ${g.photo.clarity.toFixed(1)} ${g.photo.source} ${g.photo.src}` : `grade failed → none ${g.photo.src}`);
  }

  const p = await pickPhoto(graded.map((g) => g.photo), deps.create);
  msgs.push(...p.messages);
  log.push(...p.log);
  const rejected = new Set(p.aiRejected);
  const passed = pickOrder(graded.map((g) => g.photo)).filter((c) => c !== p.pick && !rejected.has(c.src));
  return done(p.pick?.tier ?? 'none', p.pick, brief, passed);
}
