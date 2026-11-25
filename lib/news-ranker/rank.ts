/**
 * News Ranker steps 3–5 (CONTRACT.md): gate → score → mix → optional final
 * order. Jev and Claude calls are injected (deps), so the lab swaps variants
 * and tests run on stubs. Memory (step 2) runs before this: pass only the
 * stories repeatVerdict allows.
 *
 * CURRENT_VARIANT + currentDeps reproduce today's Morning Download order:
 * major-news@3 (stored, else asked) + story-builder@2 (stored), ordered by
 * leadOf margin, then md-final-rank@1 over the top FINAL_RANK_MAX leads.
 */
import { jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { FINAL_RANK_MAX } from '@/lib/stories/md-final-rank';

import { askMajorNews } from './major';
import { NEWS_GATE } from './questions';
import { GATE_BAR, leadOf } from './scores';
import type { GateResult, RankedStory, RankerStory, RankerVariant, StoryScores } from './types';

export type FinalOrderFn = (stories: readonly RankedStory[], variant: RankerVariant) => Promise<{ order: string[]; reasons?: Record<string, string> }>;

export type RankDeps = {
  now: Date;
  /** Step 3: one story's scores (gate included). */
  score: (story: RankerStory) => Promise<StoryScores>;
  /** Step 4 override; default mixScore. Higher first. */
  mixed?: (story: RankerStory, scores: StoryScores, variant: RankerVariant, now: Date) => number;
  /** Step 5; required when the variant has a finalOrder. Returns storyIds. A failure keeps the mixed order. */
  finalOrder?: FinalOrderFn;
  /** Logged when the final order fails. */
  onFinalOrderError?: (err: unknown) => void;
};

/** D9: mixed = w·cool + (1 − w)·needToKnow; a missing score counts 0. */
export function mixScore(scores: Pick<StoryScores, 'cool' | 'needToKnow'>, w: number): number {
  return w * (scores.cool ?? 0) + (1 - w) * (scores.needToKnow ?? 0);
}

/** news-gate@1 answer → GateResult (D10: fails only when Jev is fairly sure it is not news). A missing answer passes. */
export function parseGate(answers: Record<string, unknown> | undefined, bar: number = GATE_BAR): GateResult {
  const p = (answers?.is_news as { noul?: number } | undefined)?.noul;
  if (typeof p !== 'number' || !Number.isFinite(p)) return { pass: true, reason: 'no gate answer; passed' };
  return p >= bar ? { pass: true, reason: `news (${p.toFixed(2)})` } : { pass: false, reason: `clearly not news (${p.toFixed(2)})` };
}

/** Ask news-gate@1 for one story. */
export async function askGate(jev: JevAsk, s: RankerStory): Promise<{ gate: GateResult; costUsd: number; answers: Record<string, unknown> }> {
  const res = await jev({ state: { headline: s.headline, story: { untrusted_content: s.text } }, questions: NEWS_GATE.questions }, { version: NEWS_GATE.version, subjectId: s.storyId });
  return { gate: parseGate(res.answers), costUsd: jevCostUsd(res.usage), answers: res.answers };
}

export async function rank(stories: readonly RankerStory[], variant: RankerVariant, deps: RankDeps): Promise<RankedStory[]> {
  const mixed = deps.mixed ?? ((_s, sc, v) => mixScore(sc, v.mix.cool));
  const scored: RankedStory[] = [];
  for (const s of stories) {
    const scores = await deps.score(s);
    if (!scores.gate.pass) continue;
    scored.push({ ...s, scores, mixed: mixed(s, scores, variant, deps.now), position: 0 });
  }
  scored.sort((a, b) => b.mixed - a.mixed || a.storyId.localeCompare(b.storyId));
  let ordered = scored;
  if (variant.finalOrder && deps.finalOrder && scored.length > 1) {
    const top = scored.slice(0, variant.finalOrder.max);
    try {
      const { order, reasons } = await deps.finalOrder(top, variant);
      const byId = new Map(top.map((s) => [s.storyId, s]));
      const seen = new Set<string>();
      const head = order.filter((id) => byId.has(id) && !seen.has(id) && (seen.add(id), true)).map((id) => ({ ...byId.get(id)!, ...(reasons?.[id] ? { finalReason: reasons[id] } : {}) }));
      ordered = [...head, ...top.filter((s) => !seen.has(s.storyId)), ...scored.slice(variant.finalOrder.max)];
    } catch (err) {
      deps.onFinalOrderError?.(err);
    }
  }
  return ordered.map((s, i) => ({ ...s, position: i + 1 }));
}

/* ── today's behavior ─────────────────────────────────────────────────── */

export const CURRENT_VARIANT: RankerVariant = {
  id: 'current',
  label: 'Today: major-news@3 + story-builder@2, leadOf margin, md-final-rank@1',
  mix: { cool: 0.5 },
  finalOrder: { promptId: 'md-final-rank@1', max: FINAL_RANK_MAX },
};

/**
 * Today's scores: needToKnow = major-news (stored, else asked), cool = story-builder (stored only, as MD/LFD do
 * today). No gate today: every story passes.
 */
export function currentScore(jev: JevAsk | null): RankDeps['score'] {
  return async (s) => {
    let major = s.stored.major;
    let costUsd = 0;
    let detail: Record<string, unknown> = { major: 'stored' };
    if (major === null && jev) {
      const res = await askMajorNews(jev, { key: s.key, headline: s.headline, text: s.text, outlets: s.outlets, published: s.eventDate?.toISOString() ?? null });
      major = res.major;
      costUsd = res.costUsd;
      detail = { major: 'asked', answers: res.answers };
    }
    return { cool: s.stored.builder, needToKnow: major, gate: { pass: true, reason: 'no gate (current)' }, detail, costUsd };
  };
}

/**
 * Today's order key: a lead's leadOf margin (≥ 0); a non-lead sorts after every lead by its major score
 * (major − 2), which is how MD fills to its minimum of 2.
 */
export function currentMixed(s: RankerStory, scores: StoryScores, _v: RankerVariant, now: Date): number {
  const lead = leadOf({ major: scores.needToKnow, builder: scores.cool, eventDate: s.eventDate }, now);
  return lead ? lead.margin : (scores.needToKnow ?? 0) - 2;
}

/** Deps that make `rank(stories, CURRENT_VARIANT, …)` today's behavior; finalOrder wraps md-final-rank@1 (injected). */
export function currentDeps(o: { now: Date; jev: JevAsk | null; finalOrder?: FinalOrderFn; onFinalOrderError?: (err: unknown) => void }): RankDeps {
  return { now: o.now, score: currentScore(o.jev), mixed: currentMixed, finalOrder: o.finalOrder, onFinalOrderError: o.onFinalOrderError };
}
