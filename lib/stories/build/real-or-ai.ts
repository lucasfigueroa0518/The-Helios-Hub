/**
 * Real or AI? (CONTRACT.md §4 buildRealOrAi; R5, R8, RA-9). The daily run
 * (lib/stories/roa/daily.ts) fills the pool; this builder posts from it:
 *
 *   truths      each round's truth drawn 50/50 on its own (R5: no learnable pattern); a truth the pool cannot
 *               fill takes the other one, logged
 *   pick        the hardest open row of that truth; round 2 on a different subject, unless it is round 1's twin
 *   provenance  re-checked (complete, never in a posted set); a failure is archived (reason `provenance`), its pool
 *               row dropped, and the next row tried
 *   frames      [roa_question 1, roa_reveal 1, roa_question 2, roa_reveal 2], payload.roa
 *   layout      RA-28: each image's crop and subject rect (layout.ts), from the screen's subject box or, for rows
 *               screened before it, the pixels; the slide keeps its text off the subject. An image that cannot be
 *               read keeps the plain layout
 *   skip        fewer than 2 usable rows, logged on the set as roaSkip
 *
 * The rows are marked used by the build step (historyKeys, lib/stories/build/index.ts).
 */
import { archiveRoa, openPool } from '@/lib/stories/pool';
import type { Photo } from '@/lib/stories/render/types';
import type { NewCandidate, NewFrame } from '@/lib/stories/repository';
import { createStoriesStorage } from '@/lib/stories/storage';
import { readRoaHistory } from '@/lib/stories/roa/history';
import { ROA_ROUNDS, ROA_SERIES, roaPoolKey, type RoaPoolPayload, type RoaQuestionData, type RoaRevealData, type RoaRound, type RoaSetPayload, type Truth } from '@/lib/stories/roa/types';
import { originOf, receiptOf } from '@/lib/stories/roa/camera';
import { layoutOfImage, type RoaLayout } from '@/lib/stories/roa/layout';
import { candidateProblems, proofOf, promptProblems } from '@/lib/stories/roa/validate';

import type { BuildDeps, BuildResult } from './common';

/** How long the signed photo URL lives: past any re-render before the set posts. */
export const PHOTO_URL_TTL_S = 30 * 86_400;

export type RealOrAiOptions = {
  /** Truth draws (tests pass a seeded one). */
  rand?: () => number;
  /** A URL the renderer can fetch for a stored candidate (default: a signed stories-bucket URL). */
  sign?: (storagePath: string) => Promise<string>;
  /** The stored candidate's bytes, for its layout (default: the stories bucket). */
  download?: (storagePath: string) => Promise<Buffer>;
};

export type RoaSkipRecord = { poolOffered: number; truths: Truth[]; rejected: Array<{ key: string; problems: string[] }> };

export const drawTruth = (rand: () => number): Truth => (rand() < 0.5 ? 'real' : 'ai');

export type RoundChoice = { picks: RoaPoolPayload[]; truths: Truth[]; rejected: Array<{ p: RoaPoolPayload; problems: string[] }>; log: string[] };

/**
 * Choose the rounds (pure): truths drawn first, each on its own; then for each round the hardest row of its truth that
 * passes `check`, on a subject no earlier round used unless it is that round's twin. Rows failing `check` are returned
 * as rejected and never offered again.
 */
export function chooseRounds(pool: readonly RoaPoolPayload[], rand: () => number, check: (p: RoaPoolPayload) => string[], rounds = ROA_ROUNDS): RoundChoice {
  const truths = Array.from({ length: rounds }, () => drawTruth(rand));
  const byDifficulty = [...pool].sort((a, b) => b.screen.difficulty - a.screen.difficulty || a.c.imageKey.localeCompare(b.c.imageKey));
  const failed = new Set<string>();
  const rejected: RoundChoice['rejected'] = [];
  const picks: RoaPoolPayload[] = [];
  const log: string[] = [];
  const fits = (p: RoaPoolPayload, truth: Truth) => {
    if (p.c.truth !== truth || failed.has(p.c.imageKey) || picks.some((q) => q.c.imageKey === p.c.imageKey)) return false;
    const twinOfPick = (q: RoaPoolPayload) => p.c.twinOf === q.c.imageKey || q.c.twinOf === p.c.imageKey;
    return picks.every((q) => q.c.subject !== p.c.subject || twinOfPick(q));
  };
  const take = (truth: Truth): RoaPoolPayload | null => {
    for (const p of byDifficulty) {
      if (!fits(p, truth)) continue;
      const problems = check(p);
      if (problems.length) {
        failed.add(p.c.imageKey);
        rejected.push({ p, problems });
        continue;
      }
      return p;
    }
    return null;
  };
  for (let i = 0; i < truths.length; i++) {
    let p = take(truths[i]!);
    if (!p) {
      const other: Truth = truths[i] === 'real' ? 'ai' : 'real';
      p = take(other);
      if (p) {
        log.push(`round ${i + 1}: no ${truths[i]} row, took ${other}`);
        truths[i] = other;
      }
    }
    if (!p) break;
    picks.push(p);
  }
  return { picks, truths: truths.slice(0, picks.length), rejected, log };
}

async function recordRoaSkip(deps: BuildDeps, rec: RoaSkipRecord): Promise<void> {
  try {
    console.log(`roa-skip ${deps.setId} ${JSON.stringify(rec)}`);
  } catch {
    /* logging is best effort */
  }
  try {
    await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [deps.setId, JSON.stringify({ roaSkip: rec })]);
  } catch {
    /* recording is best effort: a failed write must not turn a skip into a failure */
  }
}

/**
 * The reveal's frame copy (RA-26): the answer, one payoff and the proof. AI shows its prompt; real shows the effort
 * line when the pool row chose it, else the camera card. Rows written before RA-26 have no payoff: AI reads as
 * `prompt` and real as `camera` (their old lines named tells and facts, which the reveal no longer shows).
 */
export function revealCopy(p: RoaPoolPayload, round: 1 | 2, photo: Photo): RoaRevealData {
  const c = p.c;
  const proof = proofOf(c.provenance);
  if (p.payoff === 'effort' && p.reveal.trim()) return { role: 'roa_reveal', round, photo, truth: c.truth, payoff: 'effort', line: p.reveal.trim(), proof };
  if (c.truth === 'ai') {
    // Our prompt when there is one (RA-26), else the origin card (RA-27).
    const prompt = c.provenance.kind === 'generated' && !promptProblems(c.provenance.prompt).length ? c.provenance.prompt : undefined;
    if (prompt && p.payoff !== 'origin') return { role: 'roa_reveal', round, photo, truth: 'ai', payoff: 'prompt', prompt, proof };
    const receipt = originOf(c.provenance);
    return { role: 'roa_reveal', round, photo, truth: 'ai', payoff: 'origin', ...(receipt ? { receipt } : {}), proof };
  }
  const receipt = receiptOf(c.provenance);
  return { role: 'roa_reveal', round, photo, truth: 'real', payoff: 'camera', ...(receipt ? { receipt } : {}), proof };
}

export async function buildRealOrAi(deps: BuildDeps, opts: RealOrAiOptions = {}): Promise<BuildResult> {
  const log: string[] = [];
  const pool = deps.pool?.roa ?? (await openPool(deps.db, ROA_SERIES)).roa ?? [];
  const { usedKeys } = await readRoaHistory(deps.db, { excludeSetId: deps.setId });
  const choice = chooseRounds(pool, opts.rand ?? Math.random, (p) => candidateProblems(p.c, { used: usedKeys }));
  log.push(...choice.log);

  // Provenance failures leave the pool for the archive.
  const candidates: NewCandidate[] = [];
  for (const { p, problems } of choice.rejected) {
    const key = roaPoolKey(p.c.imageKey);
    await archiveRoa(deps.db, key, { ...p, problems }, 'provenance', deps.now);
    await deps.db.query(`DELETE FROM stories.pool WHERE series = $1 AND key = $2 AND used_at IS NULL`, [ROA_SERIES, key]);
    log.push(`${key}: provenance (${problems.join('; ')}), archived`);
    candidates.push({ origin: 'model', ref: key, payload: { c: p.c, screen: p.screen, problems }, score: p.screen.difficulty, chosen: false, reason: 'provenance' });
  }

  if (choice.picks.length < ROA_ROUNDS) {
    const rec: RoaSkipRecord = { poolOffered: pool.length, truths: choice.truths, rejected: choice.rejected.map(({ p, problems }) => ({ key: roaPoolKey(p.c.imageKey), problems })) };
    await recordRoaSkip(deps, rec);
    return { ok: false, skip: `Real or AI? needs ${ROA_ROUNDS} usable pool images, has ${choice.picks.length}`, candidates };
  }

  let storage: ReturnType<typeof createStoriesStorage> | null = null;
  const store = () => (storage ??= createStoriesStorage());
  const sign = opts.sign ?? ((path: string) => store().sign(path, PHOTO_URL_TTL_S));
  const download = opts.download ?? ((path: string) => store().download(path));
  const frames: NewFrame[] = [];
  const rounds: RoaRound[] = [];
  let seq = 1;
  for (const [i, p] of choice.picks.entries()) {
    const round = (i + 1) as 1 | 2;
    // No credit on the photo itself: it would give the answer away; the reveal's proof carries it (R8).
    let layout: RoaLayout | null = null;
    try {
      layout = await layoutOfImage(await download(p.c.storagePath), p.screen.subjectBox);
    } catch (err) {
      log.push(`${roaPoolKey(p.c.imageKey)}: no layout (${(err as Error).message})`);
    }
    const photo: Photo = { src: await sign(p.c.storagePath), credit: '', kind: 'scene', ...(layout ? { focus: layout.focus } : {}) };
    const subject = layout ? { subject: layout.subject } : {};
    const question: RoaQuestionData = { role: 'roa_question', round, photo, ...subject };
    frames.push({ seq: seq++, role: 'roa_question', backdrop: 'black', template: null, copy: question, photo });
    frames.push({ seq: seq++, role: 'roa_reveal', backdrop: 'black', template: null, copy: { ...revealCopy(p, round, photo), ...subject }, photo });
    rounds.push({ key: roaPoolKey(p.c.imageKey), truth: p.c.truth, difficulty: p.screen.difficulty, provenance: p.c.provenance });
    candidates.push({ origin: 'model', ref: roaPoolKey(p.c.imageKey), payload: { c: p.c, screen: p.screen }, score: p.screen.difficulty, chosen: true, reason: null });
  }
  const roa: RoaSetPayload = { rounds };
  return { ok: true, payload: { roa, log }, frames, candidates, historyKeys: rounds.map((r) => r.key) };
}
