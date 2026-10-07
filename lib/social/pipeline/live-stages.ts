/**
 * The real pipeline stages for runDay, wired once so the daily runner and
 * its offline test use the same assembly (checkpoint run, Tommy
 * 2026-10-06):
 *
 *   selection (Jev) → Reporter → Writer → Editor → Fact-checker →
 *   mechanical (text fixes + checks, M7) → design (basic photos with the
 *   stock vision check, photo credit check, render-fit and dropped-text checks)
 *
 * Every client is injected (Claude `create`, Jev, page reader, HTTP, the
 * fit check), so tests pass fakes and nothing here reaches a live service
 * by itself.
 *
 * Hard total cap: one RunBudget covers Claude (tokens + web search fees)
 * and Jev. No Claude call starts unless the spend so far plus
 * CALL_RESERVE_USD (a call's worst case) stays under the cap, so the run
 * can't pass it. The orchestrator's meter uses the full cap between
 * stages (a stage with no Claude call, like design, still runs); only this
 * guard keeps the per-call reserve (Tommy, 2026-10-06: the checkpoint
 * stopped one cheap design stage early at cap − reserve).
 */
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { JevAsk } from '@/lib/social/jev/client';
import type { BankEntry } from '@/lib/social/photos/bank';
import type { PhotoDeps } from '@/lib/social/photos/find';
import type { UsedPhotoLog } from '@/lib/social/photos/used-photos';
import { createVisionCheck } from '@/lib/social/photos/vision';
import { runFactCheck } from '@/lib/social/factcheck/factcheck';
import type { FitCheck } from '@/lib/social/render/fit-check';
import type { PageRead } from '@/lib/social/reporter/read-page';
import { runReporter, type MessagesCreate, type ReporterResult } from '@/lib/social/reporter/reporter';
import type { EditorResult } from '@/lib/social/editor/editor';
import type { HookResult } from '@/lib/social/hook/hook';
import type { HasPhoto, IsWellKnown, WriterResult } from '@/lib/social/writer/writer';
import { runWriter } from '@/lib/social/writer/writer';
import { runEditor } from '@/lib/social/editor/editor';

import { createDesignStage } from './design-stage';
import { createFactCheckStage } from './factcheck-stage';
import { createHookStage } from './hook-stage';
import { createMechanicalStage } from './mechanical-stage';
import { readableDate } from './reporter-stage';
import type { PipelineStages } from './stages';
import type { PostObject, StageResult } from './types';

/** A single Claude call's worst case for the guard (≈ max_tokens of output plus a large cached prompt). */
export const CALL_RESERVE_USD = 0.2;

export class BudgetExhausted extends Error {}

export type RunBudget = {
  readonly capUsd: number;
  /** Claude + Jev spend so far. */
  spent(): number;
  claudeUsd(): number;
  /** True once the guard refused a call. */
  exhausted(): boolean;
  /** Wrap a Claude client: refuse a call that could pass the cap; price every response. */
  guard(create: MessagesCreate): MessagesCreate;
};

export function createRunBudget(opts: { capUsd: number; otherSpendUsd: () => number; reserveUsd?: number }): RunBudget {
  const reserve = opts.reserveUsd ?? CALL_RESERVE_USD;
  let claude = 0;
  let refused = false;
  const spent = () => claude + opts.otherSpendUsd();
  return {
    capUsd: opts.capUsd,
    spent,
    claudeUsd: () => claude,
    exhausted: () => refused,
    guard: (create) => async (params) => {
      if (spent() + reserve > opts.capUsd) {
        refused = true;
        throw new BudgetExhausted(`run cap $${opts.capUsd}: $${spent().toFixed(4)} spent, a call could pass it`);
      }
      const res = await create(params);
      claude += Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: params.model }).costUsd);
      return res;
    },
  };
}

/** Everything a run records per story, for the report. */
export type StoryLog = {
  reporter?: ReporterResult & { reads: Array<{ url: string; ok: boolean; chars?: number; error?: string }> };
  writer: WriterResult[];
  editor: EditorResult[];
  factCheck: Array<Awaited<ReturnType<typeof runFactCheck>>>;
  /** Hook pass results, when the run switched it on (with the measured budgets). */
  hook?: Array<HookResult & { budgets: number[] }>;
  design?: PostObject;
  designFailure?: string;
};

export type LiveStagesDeps = {
  score: PipelineStages['score'];
  create: MessagesCreate;
  jev: JevAsk;
  budget: RunBudget;
  readPage: (url: string) => Promise<PageRead>;
  isWellKnown: IsWellKnown;
  /** photo_available marking for the Writer (handoff). */
  hasPhoto?: HasPhoto;
  fitCheck: FitCheck;
  http?: PhotoDeps['http'];
  /** 7-day rule and the photo bank (M8c). */
  usedLog?: UsedPhotoLog;
  bank?: BankEntry[];
  now: Date;
  /** Per-story Reporter cap (the Reporter's own rule: stop before a turn at cap − $0.10). */
  reporterCapUsd: number;
  /** Safety stop on how many stories the Reporter may start. */
  maxReporterRuns: number;
  /** Hook pass, for this run only (prototype; Tommy 2026-10-06). Absent: the daily default (no Hook pass). Its own fit check (no screenshots). */
  hook?: { fitCheck: FitCheck };
};

/** A guard refusal surfaces inside a stage as a service error; report it as the cost cap it is. */
function capAware<T>(budget: RunBudget, r: StageResult<T>): StageResult<T> {
  return !r.ok && budget.exhausted() ? { ...r, reasonCode: 'cost-cap', detail: `${r.detail} (run cap $${budget.capUsd})` } : r;
}

export function createLiveStages(deps: LiveStagesDeps): { stages: PipelineStages; logs: Map<string, StoryLog> } {
  const logs = new Map<string, StoryLog>();
  const log = (id: string) => {
    let l = logs.get(id);
    if (!l) logs.set(id, (l = { writer: [], editor: [], factCheck: [] }));
    return l;
  };
  const create = deps.budget.guard(deps.create);
  let reporterRuns = 0;

  const factCheck = createFactCheckStage({ create, onResult: (id, r) => log(id).factCheck.push(r) });
  // The photo vision check on top stock candidates (Tommy, 2026-10-06), under the same budget guard.
  const vision = createVisionCheck({ create, http: deps.http });
  const design = createDesignStage({ jev: deps.jev, http: deps.http, vision, fitCheck: deps.fitCheck, usedLog: deps.usedLog, bank: deps.bank, now: () => deps.now });

  const stages: PipelineStages = {
    score: deps.score,
    async report(story) {
      if (reporterRuns >= deps.maxReporterRuns) {
        return { ok: false, reasonCode: 'cost-cap', detail: `Reporter run limit (${deps.maxReporterRuns}) reached`, costUsd: 0 };
      }
      reporterRuns++;
      const reads: NonNullable<StoryLog['reporter']>['reads'] = [];
      const r = await runReporter(
        { story: story.title, startingSources: story.sources, today: readableDate(deps.now) },
        {
          create,
          costCapUsd: deps.reporterCapUsd,
          readPage: async (url) => {
            const page = await deps.readPage(url);
            reads.push(page.ok ? { url, ok: true, chars: page.text.length } : { url, ok: false, error: page.error });
            return page;
          },
        },
      );
      log(story.id).reporter = { ...r, reads };
      if (!r.ok) return capAware(deps.budget, { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd });
      return { ok: true, value: { storyId: story.id, parsed: r.brief, raw: r.raw, pages: r.pages }, costUsd: r.costUsd };
    },
    async write(brief) {
      const r = await runWriter(brief.parsed, { create, isWellKnown: deps.isWellKnown, hasPhoto: deps.hasPhoto });
      log(brief.storyId).writer.push(r);
      if (!r.ok) return capAware(deps.budget, { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd });
      return { ok: true, value: { storyId: brief.storyId, submission: r.draft, filled: r.filled }, costUsd: r.costUsd };
    },
    async edit(draft, brief) {
      const r = await runEditor(brief.parsed, draft.submission, { create });
      log(draft.storyId).editor.push(r);
      if (!r.ok) return capAware(deps.budget, { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd });
      return { ok: true, value: { storyId: draft.storyId, submission: r.draft, filled: r.filled }, costUsd: r.costUsd };
    },
    async factCheck(draft, brief) {
      return capAware(deps.budget, await factCheck(draft, brief));
    },
    async design(draft, brief, story) {
      const r = await design(draft, brief, story);
      if (r.ok) log(draft.storyId).design = r.value;
      else log(draft.storyId).designFailure = r.detail;
      return r;
    },
    mechanical: createMechanicalStage(),
  };
  if (deps.hook) {
    const hook = createHookStage({ create, fitCheck: deps.hook.fitCheck, onResult: (id, r) => (log(id).hook ??= []).push(r) });
    stages.hook = async (draft, brief) => capAware(deps.budget, await hook(draft, brief));
  }
  return { stages, logs };
}
