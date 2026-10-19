import type { Queryable } from '@/lib/explainers/db';
import {
  ANALOGY_WRITER_VERSION,
  ideaUsd,
  type IdeaModel,
} from '@/lib/explainers/ideas/generator';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { ANALOGY_SCORING } from '@/lib/explainers/jev/questions/analogy-scoring';
import { recordCost } from '@/lib/explainers/repository';
import {
  ANALOGY_KEYS,
  type AnalogyCandidate,
  type AnalogyKey,
  type AnalogyNote,
  type AnalogyScores,
  type Mode,
  type TopicRow,
} from '@/lib/explainers/types';

/**
 * The idea phase owns the analogy (Explainers 3.0, EX3-30; v2 in 3.1, EX3-66; v3 in 3.2, EX3-85). When a topic
 * makes the pool, the analogy writer proposes three candidates, Jev scores each on seven
 * questions, and code picks one. The pick becomes the reel's anchor scene (BRIEF.md
 * `## Analogy`). A topic with no pick gets the same pass as its render's first stage (EX3-31).
 */

/** Points out of 100: equal weights, 100/7 each (EX3-30, EX3-85). */
export const ANALOGY_POINTS: Record<AnalogyKey, number> = {
  simplicity: 100 / 7,
  reach: 100 / 7,
  mapping_fidelity: 100 / 7,
  visual_strength: 100 / 7,
  visual_payoff: 100 / 7,
  familiarity: 100 / 7,
  hook_clarity: 100 / 7,
};

/** After the total: fidelity first (accuracy), then familiarity, hook clarity, reach, simplicity, payoff, picture. */
export const ANALOGY_TIE_BREAKS: AnalogyKey[] = ['mapping_fidelity', 'familiarity', 'hook_clarity', 'reach', 'simplicity', 'visual_payoff', 'visual_strength'];

export function analogyTotal(scores: AnalogyScores): number {
  let total = 0;
  for (const key of ANALOGY_KEYS) total += (scores[key] / 4) * ANALOGY_POINTS[key];
  return Math.round(total * 1000) / 1000;
}

/**
 * Index of the winning candidate. A candidate with invented rules is picked only when every
 * candidate has some (EX3-85). An exact tie on everything keeps the earlier one.
 */
export function pickAnalogy(scores: readonly AnalogyScores[], candidates?: readonly Pick<AnalogyCandidate, 'invented_rules'>[]): number {
  if (scores.length === 0) throw new Error('no analogy candidates to pick from');
  const finished = scores.map((_, i) => !(candidates?.[i]?.invented_rules?.length));
  const eligible = finished.some(Boolean) ? finished : finished.map(() => true);
  let best = eligible.indexOf(true);
  for (let i = best + 1; i < scores.length; i += 1) {
    if (!eligible[i]) continue;
    const order: number[][] = [
      [analogyTotal(scores[i]), analogyTotal(scores[best])],
      ...ANALOGY_TIE_BREAKS.map((key) => [scores[i][key], scores[best][key]]),
    ];
    for (const [a, b] of order) {
      if (a !== b) {
        if (a > b) best = i;
        break;
      }
    }
  }
  return best;
}

/**
 * The topic's picked analogy, or null when it has none: never picked, the pass failed, or it came
 * from an older analogy writer (EX3-31, 3.1), so the render picks again for this one topic.
 */
export function topicAnalogy(topic: Pick<TopicRow, 'jev_notes'>): AnalogyCandidate | null {
  const note = (topic.jev_notes as { analogy?: AnalogyNote } | null)?.analogy;
  if (!note || !('pick' in note) || note.version !== ANALOGY_WRITER_VERSION) return null;
  return note.candidates[note.pick] ?? null;
}

/** The pick as BRIEF.md's `## Analogy` body. */
export function analogyMarkdown(candidate: AnalogyCandidate): string {
  return [
    `Scene: ${candidate.scene}`,
    '',
    'Elements:',
    ...candidate.elements.map((e) => `- ${e.name} — stands for ${e.stands_for}`),
    '',
    `Process: ${candidate.process}`,
    '',
    `Payoff: ${candidate.payoff}`,
    '',
    `Picture: ${candidate.visual}`,
    ...(candidate.rung ? ['', `Rung: ${candidate.rung} (${['', 'one object or physical effect', 'one everyday action by a critter', 'a familiar everyday situation'][candidate.rung]})`] : []),
    ...(candidate.actor ? ['', `Actor: ${candidate.actor === 'none' ? 'no one acts' : `a critter: ${candidate.actor}`}`] : []),
    ...(candidate.hook ? ['', `Hook (the opener's moment, clear on its own): ${candidate.hook}`] : []),
    ...(candidate.steps?.length
      ? ['', 'Steps (what happens in the scene — the real step):', ...candidate.steps.map((st, i) => `${i + 1}. ${st.analogy} — ${st.technical}`)]
      : []),
  ].join('\n');
}

export type AnalogyDeps = {
  db: Queryable;
  jev: ExplainersJevRunner;
  ideaModel: IdeaModel;
  model: string;
  mode: Mode;
  themeBrief: string;
  /** The idea cycle the pass belongs to, when the daily cycle runs it. */
  ideaCycleId?: string | null;
  /** The render it belongs to, when a Generate click runs it (EX3-31). */
  jobId?: string | null;
  now?: Date;
};

async function saveNote(db: Queryable, topicId: string, note: AnalogyNote): Promise<void> {
  await db.query(
    `UPDATE explainers.topics
        SET jev_notes = COALESCE(jev_notes, '{}'::jsonb) || jsonb_build_object('analogy', $2::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [topicId, JSON.stringify(note)],
  );
}

/** Write three candidates, score each with Jev, pick one, and store all of it on the topic. */
export async function chooseAnalogy(
  deps: AnalogyDeps,
  topic: Pick<TopicRow, 'id' | 'title' | 'scope'>,
): Promise<AnalogyNote & { pick: number }> {
  const scope = topic.scope ?? topic.title;
  const response = await deps.ideaModel.writeAnalogies({
    model: deps.model,
    themeBrief: deps.themeBrief,
    title: topic.title,
    scope,
  });
  await recordCost(deps.db, {
    jobId: deps.jobId ?? null,
    ideaCycleId: deps.ideaCycleId ?? null,
    mode: deps.mode,
    vendor: 'anthropic',
    component: 'analogy_writer',
    inputTokens: Number(response.usage.input_tokens ?? 0),
    outputTokens: Number(response.usage.output_tokens ?? 0),
    cacheReadTokens: Number(response.usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(response.usage.cache_creation_input_tokens ?? 0),
    usd: ideaUsd(response),
  });

  const scores: AnalogyScores[] = [];
  for (const candidate of response.candidates) {
    const result = await deps.jev.ask({
      component: 'analogy_scoring',
      state: { topic_title: topic.title, topic_scope: scope, candidate },
      set: ANALOGY_SCORING,
      questions: ANALOGY_SCORING.questions,
      topicId: topic.id,
    });
    const answers = result.answers as Record<string, { score: number }>;
    const row = {} as AnalogyScores;
    for (const key of ANALOGY_KEYS) {
      const value = answers[key]?.score;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Jev returned no ${key} score for an analogy`);
      row[key] = Math.min(4, Math.max(0, value));
    }
    scores.push(row);
  }

  const note = {
    version: ANALOGY_WRITER_VERSION,
    candidates: response.candidates,
    scores,
    totals: scores.map(analogyTotal),
    pick: pickAnalogy(scores, response.candidates),
    picked_at: (deps.now ?? new Date()).toISOString(),
  };
  await saveNote(deps.db, topic.id, note);
  return note;
}

/**
 * The idea cycle's version: a failure is recorded on the topic and never stops the cycle
 * (EX3-30); the render runs the pass again.
 */
export async function chooseAnalogySafely(
  deps: AnalogyDeps,
  topic: Pick<TopicRow, 'id' | 'title' | 'scope'>,
): Promise<AnalogyNote> {
  try {
    return await chooseAnalogy(deps, topic);
  } catch (error) {
    const note: AnalogyNote = {
      version: ANALOGY_WRITER_VERSION,
      error: error instanceof Error ? error.message : String(error),
      failed_at: (deps.now ?? new Date()).toISOString(),
    };
    await saveNote(deps.db, topic.id, note);
    return note;
  }
}
