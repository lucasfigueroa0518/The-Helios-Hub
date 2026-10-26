/**
 * The regime: a fingerprint of everything that shapes what the meme lab
 * generates and how it ranks it. The predictor (lib/memes/predict.ts) learns
 * only from runs made under one regime and predicts only for that regime: a
 * change to a prompt, a card, a judge question, a weight, a model or a lint
 * makes a new regime, and the old data no longer applies (Lucas, 2026-10-17:
 * "once system prompts are changed and the system is upgraded, they cannot
 * be used anymore").
 *
 * The fingerprint hashes the data itself: the writer's system prompt and
 * tools, every card as the writer reads it, the turn types, the geometry, the
 * judge questions and weights, the models, the lints and the brief prompt's
 * version. Code logic that no data captures (how step 2 is phrased, how the
 * slate is chosen) is covered by REGIME_EPOCH: bump it with any such change.
 * Pure; no model calls.
 */
import crypto from 'node:crypto';

import { CARD_V2 } from './cards-v2';
import { TEMPLATE_CATALOG } from './catalog';
import { BRIEF_PROMPT_VERSION } from './brief-from-body';
import { MEME_MODELS, MEME_SPEND_CAP_USD } from './cost';
import { TEMPLATE_GEOMETRY } from './geometry';
import { CALIBRATED_GATES, JUDGE_BARS, MEME_JUDGES, RANK_WEIGHTS, SLATE_SIZE } from './judges';
import { HEDGE, HOUSEHOLD_NAMES, NARRATION } from './lint';
import { SHORTLIST_SIZE } from './match';
import { MAX_TURNS, TURN_TYPES } from './turns';
import { cardText, DRAFTS_PER_TURN, MORE_DRAFTS, SUBMIT_MEMES, SUBMIT_TURNS, WRITER_PROMPT_VERSION, WRITER_SYSTEM } from './writer';

/** Bump when code logic changes what is generated or ranked without changing any hashed data. */
export const REGIME_EPOCH = 1;

const hash = (v: unknown) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12);

/** Each part's own hash, so a report can say what changed between two regimes. */
export function regimeParts(): Record<string, string> {
  return {
    epoch: String(REGIME_EPOCH),
    writer: hash({ WRITER_PROMPT_VERSION, WRITER_SYSTEM, SUBMIT_TURNS, SUBMIT_MEMES, DRAFTS_PER_TURN, MORE_DRAFTS }),
    cards: hash(TEMPLATE_CATALOG.map((t) => [t.id, cardText(t), t.slots, t.situations, CARD_V2[t.id]])),
    turns: hash({ TURN_TYPES, MAX_TURNS, SHORTLIST_SIZE }),
    geometry: hash(TEMPLATE_GEOMETRY),
    judges: hash({ version: MEME_JUDGES.version, questions: MEME_JUDGES.questions, JUDGE_BARS, CALIBRATED_GATES, RANK_WEIGHTS, SLATE_SIZE }),
    models: hash({ MEME_MODELS, MEME_SPEND_CAP_USD }),
    lints: hash({ hedge: HEDGE.source, narration: NARRATION.source, HOUSEHOLD_NAMES }),
    brief: BRIEF_PROMPT_VERSION,
  };
}

/** The regime's id: one hash over all its parts. */
export function regimeId(parts: Record<string, string> = regimeParts()): string {
  return hash(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Runs made before the fingerprint was recorded on each run, assigned to their
 * regime by evidence. The v4 batch ran 2026-10-17 15:21–15:30 UTC; every file
 * that feeds the fingerprint was last changed before 15:21 UTC (only comments
 * in judges.ts changed at 15:20), so those runs share the regime computed from
 * that code. Its id is recorded here as it was then and never recomputed.
 */
export const BACKFILLED_REGIMES: ReadonlyArray<{ pipeline: string; from: string; to: string; regime: string; note: string }> = [
  {
    pipeline: 'v4',
    from: '2026-10-17T15:21:00Z',
    to: '2026-10-17T15:31:00Z',
    regime: 'd4d7e9370674',
    note: 'Golden-set v4 batch (33 stories), before the fingerprint was saved on runs.',
  },
];

/** A run's regime: the fingerprint saved on it, or a backfill by pipeline and time; null when unknown. */
export function runRegime(run: { pipeline: string; requestedAt: string; shape: Record<string, unknown> | null }): string | null {
  const saved = run.shape?.regime;
  if (typeof saved === 'string') return saved;
  const at = Date.parse(run.requestedAt.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  const hit = BACKFILLED_REGIMES.find((b) => b.pipeline === run.pipeline && at >= Date.parse(b.from) && at < Date.parse(b.to));
  return hit?.regime ?? null;
}

/**
 * Regimes whose graded runs count as the same evidence for the gate (odds-store.ts), with why. Only for changes
 * that move nothing the writer, the judges or the story pick see: here, where two templates' boxes sit on the image.
 * Each entry is a decision (planning/Memes/DECISIONS.md); removing it restores the strict one-regime rule.
 */
export const EQUIVALENT_REGIMES: ReadonlyArray<{ regime: string; sameAs: string; note: string }> = [
  {
    regime: 'b434c119a1e0',
    sameAs: 'fd22b427977c',
    note: 'The shared voice block lost its caption-only line ("In the caption, three short sentences in a row is too many"), which the meme writer prompt carries; nothing else moved (Lucas, 2026-10-21; ME-142).',
  },
  {
    regime: 'fd22b427977c',
    sameAs: '3af2b639964f',
    note: 'v5 with the Monkey Puppet and Evil Kermit boxes moved (Lucas, 2026-10-19); writing, judging and picking unchanged (ME-138).',
  },
];

/** Every regime whose runs count as evidence for `regime`: itself and its declared equivalents, both ways, transitively. */
export function evidenceRegimes(regime: string): string[] {
  const out = new Set([regime]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of EQUIVALENT_REGIMES) {
      if (out.has(e.regime) !== out.has(e.sameAs)) {
        out.add(e.regime);
        out.add(e.sameAs);
        grew = true;
      }
    }
  }
  return [...out];
}
