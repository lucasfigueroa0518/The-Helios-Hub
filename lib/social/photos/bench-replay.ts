/**
 * Replay the frozen stock link (spec §5.1 Photo chain v1; the stock link was
 * accepted and frozen 2026-10-07 on the photo-finder bench) with no live
 * calls: the Jev pre-screen answers and vision verdicts are rebuilt from the
 * accepted run's saved traces (fixtures/social/photo-bench/accepted-stock.json),
 * Openverse results come from the frozen cache, and the network is blocked.
 * If the code still picks the same photo for every stock request, the link
 * is unchanged.
 */
import type { JevAsk } from '@/lib/social/jev/client';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';

/** The accepted run's steps were saved under v4; v5 asks the same questions with the story added, so its answers replay. */
const SAVED_PRESCREEN_PREFIX = /^pre-screen stock-prescreen@\d+ /;

import type { PhotoTrace } from './find';
import { passesVision, type VisionCheck, type VisionVerdict } from './vision';

/** One stock request's saved run: its trace steps and what it picked. */
export type AcceptedStock = { id: string; steps: string[]; outcome: string };

/** The pre-screen answers, one map per Jev call, from `pre-screen stock-prescreen@4 "…": "t" fit 0.97 people 0.13 ✓; …` steps. */
export function prescreenAnswers(steps: string[]): Array<Record<string, { noul: number }>> {
  return steps
    .filter((s) => SAVED_PRESCREEN_PREFIX.test(s))
    .map((s) => {
      const answers: Record<string, { noul: number }> = {};
      [...s.matchAll(/ fit ([\d.]+) people ([\d.]+)/g)].forEach((m, k) => {
        answers[Prescreen.fitId(k)] = { noul: Number(m[1]) };
        answers[Prescreen.peopleId(k)] = { noul: Number(m[2]) };
      });
      return answers;
    });
}

const yes = (s: string, label: string) => new RegExp(`${label} yes`).test(s);

/** The vision verdicts, in call order, from `vision "t": shows yes 0.95 · person (main/face) no · … · "what" → PASS` steps. */
export function visionVerdicts(steps: string[]): VisionVerdict[] {
  return steps
    .filter((s) => /^vision "/.test(s) && !/: error \(/.test(s))
    .map((s) => {
      const shows = / shows (yes|no) ([\d.]+)/.exec(s)!;
      const what = /· "([^"]*)" →/.exec(s);
      const logo = / story logo yes \(([^)]*)\)/.exec(s);
      return {
        what_it_shows: what?.[1] ?? '',
        shows_requested: shows[1] === 'yes',
        shows_requested_confidence: Number(shows[2]),
        person_prominent: yes(s, 'person \\(main/face\\)'),
        landmark_visible: yes(s, 'landmark'),
        story_logo: yes(s, 'story logo'),
        logo_seen: logo?.[1] ?? null,
        named_institution: yes(s, 'named institution'),
        mostly_text_banner: yes(s, 'banner'),
      };
    });
}

/** What the stock link decided for a request: the picked stock photo's URL, or "no stock photo". */
export function stockOutcome(trace: Pick<PhotoTrace, 'via' | 'photo'>): string {
  return trace.photo?.source === 'stock' ? trace.photo.url : 'no stock photo';
}

/** Jev and vision answering from the saved traces, in order; anything else (identity checks) is refused. */
export function replayDeps(accepted: AcceptedStock): { jev: JevAsk; vision: VisionCheck } {
  const pre = prescreenAnswers(accepted.steps);
  const vis = visionVerdicts(accepted.steps);
  const jev: JevAsk = async (_req, meta) => {
    if (meta.version !== Prescreen.VERSION) throw new Error(`replay: no saved answers for ${meta.version}`);
    const answers = pre.shift();
    if (!answers) throw new Error('replay: more pre-screen calls than the accepted run made');
    return { answers, usage: { input_tokens: 0, output_tokens: 0 }, model: 'replay' } as never;
  };
  const vision: VisionCheck = async () => {
    const v = vis.shift();
    if (!v) return { ok: false, error: 'replay: more vision calls than the accepted run made', costUsd: 0 };
    return { ok: true, verdict: v, pass: passesVision(v), costUsd: 0 };
  };
  return { jev, vision };
}
