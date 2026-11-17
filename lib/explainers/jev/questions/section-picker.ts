import { createHash } from 'node:crypto';

import { noul } from '@typesafe-ai/sdk';

import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { defineQuestionSet, type QuestionSet } from '@/lib/reels/jev/question-set';

/**
 * The section picker (INJECTION-PLAN.md § 2; Lucas 2026-11-16: Jev picks every section). One yes/no
 * question per candidate, read as a probability; code applies the threshold, never the model. The
 * set is built from the candidates (the section index or the prop catalog), so its version is a hash
 * of their ids and summaries: a changed index is a new version, and old logs keep their meaning.
 */

/** A section (or catalog entry) is injected at this likelihood or more (0.35 → 0.6, Lucas 2026-11-17: 0.35 kept ~34 of 41 sections). */
export const PICK_MIN = 0.6;
/** Questions per Jev call. */
export const PICK_BATCH = 25;

export type Candidate = { id: string; label: string; summary: string };

const keyOf = (id: string) => `q_${id.replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 60);

export function pickerSet(kind: 'sections' | 'catalog', candidates: readonly Candidate[]): { set: QuestionSet; keys: Map<string, string> } {
  const keys = new Map<string, string>();
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const c of candidates) {
    let key = keyOf(c.id);
    for (let n = 2; key in questions; n++) key = `${keyOf(c.id).slice(0, 56)}_${n}`;
    keys.set(key, c.id);
    questions[key] =
      kind === 'sections'
        ? noul({
            question: `Will this builder need the instructions "${c.label}" (${c.summary}) to do the work described?`,
            judge:
              'The state names a builder role, the look of its frame and its task (packet). Answer yes when the work as described draws, places, moves or times something these instructions govern, or when doing it well without them is unlikely; answer no when the work never touches what they cover.',
          })
        : noul({
            question: `Could the plan for this reel use the prop "${c.label}" (${c.summary})?`,
            judge:
              "The state gives the reel's topic, its analogy and its brief. Answer yes when this exact thing could plausibly appear in the analogy's world or in the real mechanism's scenes; answer no when it clearly belongs to another setting.",
          });
  }
  const hash = createHash('sha1')
    .update(candidates.map((c) => `${c.id}|${c.summary}`).join('\n'))
    .digest('hex')
    .slice(0, 10);
  return { set: defineQuestionSet({ id: `explainers-${kind}-picker`, version: `explainers-${kind}-picker-${hash}`, questions }), keys };
}

/**
 * Ask Jev about every candidate (batches of PICK_BATCH, in parallel) and return the picked ids with
 * every probability. A batch that fails picks all of its candidates (fail open: the old full stack).
 */
export async function jevPick(
  jev: ExplainersJevRunner,
  kind: 'sections' | 'catalog',
  candidates: readonly Candidate[],
  state: Record<string, string>,
  opts: { component: string; topicId?: string | null; min?: number } = { component: `injection:${kind}` },
): Promise<{ picked: string[]; scores: Record<string, number>; failed: number }> {
  const { set, keys } = pickerSet(kind, candidates);
  const all = [...keys.keys()];
  const batches: string[][] = [];
  for (let i = 0; i < all.length; i += PICK_BATCH) batches.push(all.slice(i, i + PICK_BATCH));
  const scores: Record<string, number> = {};
  let failed = 0;
  await Promise.all(
    batches.map(async (batch) => {
      const questions = Object.fromEntries(batch.map((k) => [k, set.questions[k]]));
      try {
        const r = await jev.ask({ component: opts.component, state, set, questions, topicId: opts.topicId ?? null });
        for (const k of batch) {
          const v = (r.answers as Record<string, { noul?: number }>)[k]?.noul;
          scores[keys.get(k)!] = typeof v === 'number' && Number.isFinite(v) ? v : 1;
        }
      } catch {
        failed++;
        for (const k of batch) scores[keys.get(k)!] = 1;
      }
    }),
  );
  const min = opts.min ?? PICK_MIN;
  return { picked: candidates.map((c) => c.id).filter((id) => (scores[id] ?? 1) >= min), scores, failed };
}
