/**
 * The tail of a live story run for the dev scripts (social-captions final
 * fixes, 2026-10-19; standing rule: local runs act like live runs):
 *
 *   captioner → Fact-checker → mechanical join
 *
 * with the orchestrator's fresh-caption rule (a caption the Fact-checker cut
 * reruns only captioner → Fact-checker, MAX_FRESH_CAPTIONS times, then asks
 * for a fresh draft). The stages are the live ones (createScriptCaptionStages);
 * the scripts keep their own Writer → Editor and fresh-draft loops.
 */
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import { memoryClosings } from '@/lib/social/captions/closings-store';
import type { FactCheckResult } from '@/lib/social/factcheck/factcheck';
import type { JevAsk } from '@/lib/social/jev/client';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import { createCaptionerStage, type CaptionerRun } from './captioner-stage';
import { createFactCheckStage } from './factcheck-stage';
import { createMechanicalStage } from './mechanical-stage';
import { MAX_FRESH_CAPTIONS } from './orchestrator';
import type { PipelineStages } from './stages';
import type { Brief, Draft, ReasonCode } from './types';

export type CaptionCheckStages = Pick<PipelineStages, 'caption' | 'factCheck' | 'mechanical'>;

export type CaptionCheckOutcome =
  /** `final` is the mechanical stage's output: the caption as posted, Source line included. */
  | { kind: 'ok'; final: Draft; freshCaptions: number; costUsd: number }
  | { kind: 'fresh-draft'; why: string; freshCaptions: number; costUsd: number }
  | { kind: 'stopped'; stage: 'captioner' | 'fact-checker' | 'mechanical'; reasonCode: ReasonCode; detail: string; freshCaptions: number; costUsd: number };

export async function captionAndCheck(stages: CaptionCheckStages, edited: Draft, brief: Brief): Promise<CaptionCheckOutcome> {
  let costUsd = 0;
  for (let attempt = 0; ; attempt++) {
    const freshCaptions = attempt;
    const captioned = await stages.caption(edited, brief);
    costUsd += captioned.costUsd;
    if (!captioned.ok) return { kind: 'stopped', stage: 'captioner', reasonCode: captioned.reasonCode, detail: captioned.detail, freshCaptions, costUsd };
    const checked = await stages.factCheck(captioned.value, brief);
    costUsd += checked.costUsd;
    if (checked.ok) {
      const fixed = await stages.mechanical(checked.value, brief);
      if (!fixed.ok) return { kind: 'stopped', stage: 'mechanical', reasonCode: fixed.reasonCode, detail: fixed.detail, freshCaptions, costUsd };
      return { kind: 'ok', final: fixed.value, freshCaptions, costUsd };
    }
    if (checked.reasonCode === 'needs-fresh-draft') return { kind: 'fresh-draft', why: checked.detail, freshCaptions, costUsd };
    if (checked.reasonCode !== 'needs-fresh-caption') return { kind: 'stopped', stage: 'fact-checker', reasonCode: checked.reasonCode, detail: checked.detail, freshCaptions, costUsd };
    if (attempt >= MAX_FRESH_CAPTIONS) return { kind: 'fresh-draft', why: `fresh caption limit (${MAX_FRESH_CAPTIONS}) used; last: ${checked.detail}`, freshCaptions, costUsd };
  }
}

/**
 * The live captioner, Fact-checker and mechanical stages for a script, with
 * every captioner and Fact-checker result kept for the script's report. The
 * closings log defaults to one in memory, so a dev run never writes the shared
 * log or moves the live build-line ceiling.
 */
export function createScriptCaptionStages(deps: { create: MessagesCreate; jev: JevAsk; closings?: ClosingsLog }): {
  stages: CaptionCheckStages;
  captioner: CaptionerRun[];
  factCheck: FactCheckResult[];
} {
  const captioner: CaptionerRun[] = [];
  const factCheck: FactCheckResult[] = [];
  return {
    captioner,
    factCheck,
    stages: {
      caption: createCaptionerStage({ create: deps.create, jev: deps.jev, closings: deps.closings ?? memoryClosings(), onResult: (_id, r) => captioner.push(r) }),
      factCheck: createFactCheckStage({ create: deps.create, onResult: (_id, r) => factCheck.push(r) }),
      mechanical: createMechanicalStage(),
    },
  };
}

/** A Brief for the stage contract from a parsed brief a script loaded from disk. */
export function scriptBrief(storyId: string, parsed: Brief['parsed']): Brief {
  return { storyId, parsed, raw: '', pages: [] };
}
