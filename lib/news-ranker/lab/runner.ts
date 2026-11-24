/**
 * Runs one lab variant over a frozen set: Jev per story, optional Sonnet side
 * by side, scores stored locally. Every live call goes through `deps`, so
 * tests pass the Jev stub and a stubbed `create`. The $1 cap is checked
 * before the run (stored spend + estimate) and before every call.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Questions } from '@typesafe-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { jevCostUsd, type JevAnswer, type JevAsk } from '@/lib/social/jev/client';
import { priceCall } from '@/lib/stories/cost';
import { MD_FINAL_RANK } from '@/lib/stories/md-final-rank';
import { material } from '@/lib/stories/prompts';
import type { WriterCreate } from '@/lib/stories/writer';
import type { QuestionSet } from '@/lib/reels/jev/question-set';

import { BUILDER, MAJOR_NEWS, jevState, leadOf } from './adapters';
import { CapError, LAB_CAP_USD, SONNET_MODEL, assertWithinCap, budget, jevEstimateUsd, sonnetEstimateUsd } from './cost';
import { getSet, latestRun, saveScore, scoresOf, spentUsd, type LabDb, type ScoreRecord, type SetStory } from './db';
import { ownOrder, type ScoreRow } from './metrics';
import { FINAL_INTERESTING, VARIANTS, parseOrder, type LabVariant, type LabVariantId, type Scored } from './variants';

export type RunDeps = { jev: JevAsk; create: WriterCreate; newId?: () => string; concurrency?: number };

export type RunPlan = { variantId: LabVariantId; setId: string; jevCalls: number; sonnetCalls: number; estimateUsd: number; spentUsd: number; capOk: boolean; note?: string };

const request = (set: QuestionSet<Questions>, s: SetStory) => ({ state: jevState(s), questions: set.questions });

type Prompt = { id: string; system: string; tool: { name: string; description: string; input_schema: Record<string, unknown> } };

/** The final-order prompt and its material for the top stories. */
function finalMaterial(v: LabVariant, top: readonly { story: SetStory; row: ScoreRow; detail: Record<string, unknown> }[]): { prompt: Prompt; user: string } {
  if (v.finalOrder?.promptId === MD_FINAL_RANK.id) {
    return {
      prompt: MD_FINAL_RANK,
      user: material(top.map(({ story, row, detail }, i) => ({
        id: `s${i + 1}`, headline: story.headline, excerpt: story.summary.slice(0, 600), major: row.needToKnow, builder: row.cool,
        lane: String(detail.lane ?? 'none'), big_outlets: story.outlets, big_outlet_count: story.outlets.length,
      }))),
    };
  }
  return {
    prompt: FINAL_INTERESTING,
    user: material(top.map(({ story, row }, i) => ({ id: `s${i + 1}`, headline: story.headline, excerpt: story.summary.slice(0, 600), cool: row.cool, need: row.needToKnow, big_outlets: story.outlets }))),
  };
}

/** Estimate a run without calling anything. */
export async function planRun(db: LabDb, setId: string, variantId: LabVariantId): Promise<RunPlan> {
  const set = await getSet(db, setId);
  if (!set) throw new Error(`no lab set ${setId}`);
  const v = VARIANTS[variantId];
  const spent = await spentUsd(db);
  let note: string | undefined;
  if (v.reuses && !(await latestRun(db, setId, v.reuses))) note = `needs a finished ${v.reuses} run on this set first`;
  const chars = v.sets.flatMap((qs) => set.stories.map((s) => JSON.stringify(request(qs, s)).length));
  let estimate = jevEstimateUsd(chars);
  if (v.finalOrder) {
    const sample = set.stories.slice(0, v.finalOrder.max).map((story) => ({ story, row: { storyId: story.storyId, cool: 0.5, needToKnow: 0.5, mixed: 0, gatePass: true, finalPosition: null }, detail: {} }));
    const { prompt, user } = finalMaterial(v, sample);
    estimate += sonnetEstimateUsd(prompt.system.length + JSON.stringify(prompt.tool).length + user.length);
  }
  estimate = Math.round(estimate * 1e5) / 1e5;
  return { variantId, setId, jevCalls: chars.length, sonnetCalls: v.finalOrder ? 1 : 0, estimateUsd: estimate, spentUsd: spent, capOk: spent + estimate <= LAB_CAP_USD && !note, note };
}

async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

/** One structured Sonnet call with the stable prefix cached (tools → system); the stories are the uncached turn. */
export async function orderOnce(create: WriterCreate, prompt: Prompt, user: string, keys: readonly string[]): Promise<{ order: string[]; usd: number }> {
  const res: Anthropic.Message = await create({
    model: SONNET_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'medium' },
    system: cachedSystemText(prompt.system),
    tools: [withToolCache({ ...prompt.tool, strict: true } as unknown as Anthropic.Tool)],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  });
  const usd = priceCall(res.model || SONNET_MODEL, res.usage).usd;
  if (res.stop_reason === 'refusal') throw Object.assign(new Error(`${prompt.id}: refused`), { usd });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === prompt.tool.name);
  if (!block) throw Object.assign(new Error(`${prompt.id}: no ${prompt.tool.name} call`), { usd });
  return { order: parseOrder(block.input, keys), usd };
}

const rowOf = (r: Pick<ScoreRecord, 'storyId' | 'cool' | 'needToKnow' | 'mixed' | 'finalPosition' | 'detail'>): ScoreRow => ({
  storyId: r.storyId, cool: r.cool, needToKnow: r.needToKnow, mixed: r.mixed, finalPosition: r.finalPosition, gatePass: r.detail.gatePass !== false,
});

/** Rebuild per-set answers from a reused run's stored detail (current → current-reweighted). */
function answersFromDetail(detail: Record<string, unknown>): Record<string, Record<string, JevAnswer>> {
  const a = (detail.answers ?? {}) as { major?: Record<string, number>; builder?: Record<string, number> };
  const toNoul = (o: Record<string, number> = {}) => Object.fromEntries(Object.entries(o).map(([k, p]) => [k, { noul: Number(p) }]));
  return { [MAJOR_NEWS.version]: toNoul(a.major), [BUILDER.version]: toNoul(a.builder) };
}

export type RunResult = { runId: string; costUsd: number; stories: number; status: 'ok' | 'error'; error?: string };

export async function runVariant(db: LabDb, deps: RunDeps, setId: string, variantId: LabVariantId): Promise<RunResult> {
  const plan = await planRun(db, setId, variantId);
  if (plan.note) throw new Error(plan.note);
  assertWithinCap(plan.spentUsd, plan.estimateUsd);
  const set = (await getSet(db, setId))!;
  const v = VARIANTS[variantId];
  const runId = deps.newId?.() ?? `${variantId}-${Date.now().toString(36)}`;
  const spend = budget(plan.spentUsd);
  await db.query(`INSERT INTO lab_runs (id, set_id, variant_id, status, estimate_usd) VALUES ($1, $2, $3, 'running', $4)`, [runId, setId, variantId, plan.estimateUsd]);

  const finish = async (status: 'ok' | 'error', error?: string): Promise<RunResult> => {
    await db.query(`UPDATE lab_runs SET status = $2, cost_usd = $3, error = $4, finished_at = now() WHERE id = $1`, [runId, status, spend.used, error ?? null]);
    return { runId, costUsd: spend.used, stories: set.stories.length, status, error };
  };

  try {
    const byId = new Map(set.stories.map((s) => [s.storyId, s]));
    let records: ScoreRecord[];

    if (v.reuses) {
      const base = await scoresOf(db, (await latestRun(db, setId, v.reuses))!.id);
      records = base.map((b) => {
        const scored = v.id === 'current-reweighted' ? v.score(answersFromDetail(b.detail)) : null;
        return scored ? record(v, runId, byId.get(b.storyId)!, scored, 0, set.windowTo, { runId: b.runId }) : { ...b, runId, variantId: v.id, finalPosition: null, costUsd: 0, mixed: mixOf(v, b.cool, b.needToKnow, b.detail.gatePass !== false), detail: { ...b.detail, reusedFrom: b.runId } };
      });
    } else {
      records = await pool(set.stories, deps.concurrency ?? 4, async (story) => {
        const answers: Record<string, Record<string, JevAnswer>> = {};
        let usd = 0;
        for (const qs of v.sets) {
          spend.check();
          const res = await deps.jev(request(qs, story), { version: qs.version, subjectId: story.storyId });
          const c = jevCostUsd(res.usage);
          spend.add(c);
          usd += c;
          answers[qs.version] = res.answers;
        }
        return record(v, runId, story, v.score(answers), usd, set.windowTo);
      });
    }

    if (v.finalOrder) {
      const passing = records.map(rowOf).filter((r) => r.gatePass);
      const order = ownOrder(passing).slice(0, v.finalOrder.max);
      const recById = new Map(records.map((r) => [r.storyId, r]));
      const top = order.map((id) => ({ story: byId.get(id)!, row: rowOf(recById.get(id)!), detail: recById.get(id)!.detail }));
      const { prompt, user } = finalMaterial(v, top);
      spend.check(sonnetEstimateUsd(prompt.system.length + user.length));
      try {
        const out = await orderOnce(deps.create, prompt, user, order);
        spend.add(out.usd);
        out.order.forEach((id, i) => (recById.get(id)!.finalPosition = i + 1));
      } catch (err) {
        spend.add(Number((err as { usd?: number }).usd ?? 0));
        throw err;
      }
    }

    for (const r of records) await saveScore(db, r);
    return finish('ok');
  } catch (err) {
    const res = await finish('error', err instanceof Error ? err.message : String(err));
    if (err instanceof CapError) throw err;
    return res;
  }
}

function mixOf(v: LabVariant, cool: number | null, need: number | null, gatePass: boolean): number {
  if (!gatePass) return -1;
  return v.mix.cool * (cool ?? 0) + (1 - v.mix.cool) * (need ?? 0);
}

function record(v: LabVariant, runId: string, story: SetStory, s: Scored, usd: number, now: Date, prior: Record<string, unknown> = {}): ScoreRecord {
  let mixed = mixOf(v, s.cool, s.needToKnow, s.gate.pass);
  const detail: Record<string, unknown> = { ...s.detail, gatePass: s.gate.pass, gateReason: s.gate.reason };
  if (v.leadOrder) {
    const lead = leadOf({ major: s.needToKnow, builder: s.cool, eventDate: story.eventDate }, now);
    detail.lane = lead?.lane ?? 'none';
    detail.margin = lead?.margin ?? null;
    // No lane: below every lead, still ordered by its better score.
    mixed = lead ? lead.margin : Math.max(s.cool ?? 0, s.needToKnow ?? 0) - 1;
  }
  if (prior.runId) detail.reusedFrom = prior.runId;
  return { runId, storyId: story.storyId, variantId: v.id, cool: s.cool, needToKnow: s.needToKnow, mixed: Math.round(mixed * 1e4) / 1e4, finalPosition: null, detail, costUsd: usd };
}
