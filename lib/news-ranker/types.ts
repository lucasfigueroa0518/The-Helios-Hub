/**
 * News Ranker shared types (planning/MD-LFD Revisions/CONTRACT.md). The one
 * ranker Morning Download and Last Few Days both depend on. Change only
 * through the integrator.
 */

export type NewsFormat = 'md' | 'lfd';

/** One central-intake story as the ranker sees it. */
export type RankerStory = {
  storyId: string;
  /** storyKey of the representative member (legacy key scheme). */
  key: string;
  memberKeys: string[];
  headline: string;
  summary: string;
  /** Best available body text, trimmed for scoring. */
  text: string;
  eventDate: Date | null;
  firstSeen: Date;
  /** Big direct-feed outlets carrying it (lib/intake/outlets.ts). */
  outlets: string[];
  /** Scores the intake already stored (null when absent). */
  stored: { major: number | null; builder: number | null };
};

/** Gate result: loosened (D10) — fails only what is clearly not news at all. */
export type GateResult = { pass: boolean; reason: string };

export type StoryScores = {
  /** 0–1. */
  cool: number | null;
  /** 0–1. */
  needToKnow: number | null;
  gate: GateResult;
  /** Per-question answers, for the lab's "where the points came from". */
  detail: Record<string, unknown>;
  costUsd: number;
};

/** needToKnow weight is 1 − cool. */
export type MixWeights = { cool: number };

export type RankerVariant = {
  id: string;
  label: string;
  /** Mix applied after scoring. */
  mix: MixWeights;
  /** Side-by-side final order; null = mixed-score order only. */
  finalOrder: { promptId: string; max: number } | null;
};

export type RankedStory = RankerStory & {
  scores: StoryScores;
  mixed: number;
  /** 1-based position after the final order (or mixed order). */
  position: number;
  finalReason?: string;
};

/** What a format already said about a story (one shared memory, D1). */
export type SaidRecord = {
  format: NewsFormat;
  storyId: string | null;
  key: string;
  headline: string;
  postedAt: Date;
};

/** D2/D11: a story this format already ran returns only for a massive development. */
export type RepeatVerdict = {
  allowed: boolean;
  /** NEWS_MASSIVE_DEVELOPMENT score, 0–1; null when not judged. */
  massive: number | null;
  reason: string;
};

/** Lab ground truth (D7, revised 2026-11-22): two independent 0–10 ratings; 0 = not cool / not valuable at all. */
export type LabTag = {
  storyId: string;
  cool: number;
  needToKnow: number;
  note?: string;
  taggedAt: Date;
};

export type VariantMetrics = {
  variantId: string;
  mixCool: number;
  /** Mean of Lucas's 0–10 ratings over the variant's top 5 / top 10 rated stories. */
  meanCool: { at5: number; at10: number };
  meanNeed: { at5: number; at10: number };
  /** Lucas's blend at the variant's own weight: w·cool + (1−w)·need. */
  meanBlend: { at5: number; at10: number };
  /** Spearman rank correlation of the variant's order with Lucas's ratings (−1…1), over rated stories. */
  rankCorr: { cool: number; need: number; blend: number };
  /** Share of the top 5 Lucas rated ≤ 2 on both scales. */
  noShareTop5: number;
};
