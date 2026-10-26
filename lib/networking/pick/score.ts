/**
 * event-pick@1 gates and score v2 (plan M2 steps 3-4, AE-30). Pure: no model, no database, no
 * network, so the Social Hub adapter can import the labels and formula.
 *
 * Gates (failing one excludes the event; every failed gate is stored as the reason):
 *   in_person_networking >= .5, vendor_pitch < .6, get_rich < .4, ai_relevant >= .5,
 *   plantedInstruction < .7 (planted-v1, PLANTED_INSTRUCTION_BAR).
 *
 * Score v2, 0 to 10: Jev's answers are worth 4, the code terms (terms.ts) 6.
 *   max(notable_speakers, ecosystem_moment) + .75·established_host + .75·quality_crowd
 *   + .5·substantive_program + would_want_to_go
 *   + attendance + demand + track_record + roster + satellite − .5·vendor_pitch
 */
import type { ScoreBreakdown, ScorePart } from '@/lib/social-hub/types';

import { CODE_MAX, type CodeTerms, type DemandReason, type ImputedTerm } from './terms';

export const EVENT_PICK_VERSION = 'event-pick@1';

export const GATE_IDS = ['in_person_networking', 'vendor_pitch', 'get_rich', 'ai_relevant'] as const;
export const VALUE_IDS = ['notable_speakers', 'quality_crowd', 'established_host', 'ecosystem_moment', 'substantive_program', 'would_want_to_go'] as const;
export const PLANTED_ID = 'plantedInstruction';

type GateRule = { min?: number; below?: number; label: string };

/** `min`: the answer must reach it. `below`: the answer must stay under it. */
export const GATES: Record<(typeof GATE_IDS)[number] | typeof PLANTED_ID, GateRule> = {
  in_person_networking: { min: 0.5, label: 'In-person networking' },
  vendor_pitch: { below: 0.6, label: 'Vendor pitch' },
  get_rich: { below: 0.4, label: 'Get-rich scheme' },
  ai_relevant: { min: 0.5, label: 'AI relevant' },
  [PLANTED_ID]: { below: 0.7, label: 'Planted instruction' },
};

/** Score v2 (AE-30): Jev's judgment is worth 4 points, the code terms 6 (terms.ts). */
export const SCORE_VERSION = 'v2';

export const WEIGHTS = {
  headline: 1,
  established_host: 0.75,
  quality_crowd: 0.75,
  substantive_program: 0.5,
  would_want_to_go: 1,
  vendor_pitch: 0.5,
} as const;

export const SCORE_MAX = WEIGHTS.headline + WEIGHTS.established_host + WEIGHTS.quality_crowd + WEIGHTS.substantive_program + WEIGHTS.would_want_to_go + CODE_MAX;

export const SCORE_FORMULA =
  'max(speakers, moment) + 0.75 × host + 0.75 × crowd + 0.5 × program + would go + 2 × attendance + 1.5 × demand + 1.5 × track record + 0.5 × roster + 0.5 × satellite − 0.5 × vendor pitch. Missing attendance, demand or track record takes the city median.';

export const VALUE_LABELS: Record<(typeof VALUE_IDS)[number], string> = {
  notable_speakers: 'Notable speakers',
  quality_crowd: 'Quality crowd',
  established_host: 'Established host',
  ecosystem_moment: 'Ecosystem moment',
  substantive_program: 'Substantive program',
  would_want_to_go: 'Would want to go',
};

const DEMAND_LABELS: Record<DemandReason, string> = {
  soldOut: 'Sold out',
  waitlist: 'Waitlist',
  nearCapacity: 'Near capacity',
  requiresApproval: 'Requires approval',
};

export type EventAnswers = Record<string, number>;

/** Jev answers as probabilities of yes; anything that is not a noul answer reads as 0. */
export function answerProbabilities(answers: Record<string, unknown>): EventAnswers {
  const out: EventAnswers = {};
  for (const [id, answer] of Object.entries(answers)) {
    const p = typeof answer === 'number' ? answer : (answer as { noul?: unknown } | null)?.noul;
    out[id] = typeof p === 'number' && Number.isFinite(p) ? p : 0;
  }
  return out;
}

const fmt = (p: number) => p.toFixed(2);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The failed gates, in GATES order, or null when the event passes. A missing answer fails a `min` gate. */
export function failedGates(answers: EventAnswers): string[] | null {
  const failed = Object.entries(GATES)
    .filter(([id, rule]) => {
      const p = answers[id] ?? 0;
      return (rule.min != null && p < rule.min) || (rule.below != null && p >= rule.below);
    })
    .map(([id]) => id);
  return failed.length ? failed : null;
}

/** The stored gate reason: failed ids joined by ", ", or null. */
export function gateReason(answers: EventAnswers): string | null {
  return failedGates(answers)?.join(', ') ?? null;
}

function gateParts(answers: EventAnswers): ScorePart[] {
  return Object.entries(GATES).map(([id, rule]) => {
    const p = answers[id] ?? 0;
    const pass = !((rule.min != null && p < rule.min) || (rule.below != null && p >= rule.below));
    const bar = rule.min != null ? `needs ${fmt(rule.min)} or more` : `must stay under ${fmt(rule.below!)}`;
    return { label: `Gate: ${rule.label}`, points: null, detail: `${fmt(p)} yes, ${bar}${pass ? '' : ' (failed)'}` };
  });
}

export type EventScore = {
  /** Failed gate ids joined by ", "; null when every gate passed. */
  gate: string | null;
  /** Null when a gate failed (the event is excluded). */
  score: number | null;
  breakdown: ScoreBreakdown;
};

/** Gates, then the v2 score with one part per term. */
export function scoreEvent(answers: EventAnswers, terms: CodeTerms): EventScore {
  const p = (id: string) => answers[id] ?? 0;
  const gate = gateReason(answers);
  if (gate) {
    const labels = gate.split(', ').map((id) => GATES[id as keyof typeof GATES]?.label ?? id);
    return {
      gate,
      score: null,
      breakdown: { formula: SCORE_FORMULA, parts: gateParts(answers), note: `Excluded by gate: ${labels.join(', ')}.` },
    };
  }

  const imputed = (t: ImputedTerm) =>
    terms.imputed?.includes(t) ? 'imputed (city median)' : terms.missing?.includes(t) ? 'no data' : null;
  const speakers = p('notable_speakers');
  const moment = p('ecosystem_moment');
  const speakersLead = speakers >= moment;
  const value = (id: (typeof VALUE_IDS)[number], weight: number): ScorePart => ({
    label: VALUE_LABELS[id],
    points: round(weight * p(id)),
    detail: `${fmt(p(id))} yes`,
  });

  const parts: ScorePart[] = [
    {
      label: VALUE_LABELS.notable_speakers,
      points: speakersLead ? round(WEIGHTS.headline * speakers) : 0,
      detail: speakersLead ? `${fmt(speakers)} yes` : `${fmt(speakers)} yes; moment is stronger and counts instead`,
    },
    {
      label: VALUE_LABELS.ecosystem_moment,
      points: speakersLead ? 0 : round(WEIGHTS.headline * moment),
      detail: speakersLead ? `${fmt(moment)} yes; speakers is stronger and counts instead` : `${fmt(moment)} yes`,
    },
    value('established_host', WEIGHTS.established_host),
    value('quality_crowd', WEIGHTS.quality_crowd),
    value('substantive_program', WEIGHTS.substantive_program),
    value('would_want_to_go', WEIGHTS.would_want_to_go),
    {
      label: 'Attendance',
      points: round(terms.attendance),
      detail: imputed('attendance') ?? `${terms.going} ${terms.goingFromCapacity ? 'taken (capacity minus spots left)' : 'going'}`,
    },
    { label: 'Demand', points: round(terms.demand), detail: imputed('demand') ?? (terms.demandReason ? DEMAND_LABELS[terms.demandReason] : 'none') },
    { label: 'Track record', points: round(terms.trackRecord), detail: imputed('trackRecord') ?? terms.trackRecordDetail ?? 'not established' },
    { label: 'Anchor roster', points: round(terms.roster), detail: terms.rosterMatch ?? 'not on the roster' },
    { label: 'Satellite', points: round(terms.satellite), detail: terms.anchor ? terms.anchor.name : 'no anchor nearby' },
    { label: 'Vendor pitch', points: round(-WEIGHTS.vendor_pitch * p('vendor_pitch')), detail: `${fmt(p('vendor_pitch'))} yes` },
    ...gateParts(answers),
  ];

  const score =
    WEIGHTS.headline * Math.max(speakers, moment) +
    WEIGHTS.established_host * p('established_host') +
    WEIGHTS.quality_crowd * p('quality_crowd') +
    WEIGHTS.substantive_program * p('substantive_program') +
    WEIGHTS.would_want_to_go * p('would_want_to_go') +
    terms.attendance +
    terms.demand +
    terms.roster +
    terms.satellite +
    terms.trackRecord -
    WEIGHTS.vendor_pitch * p('vendor_pitch');

  return { gate: null, score: round(score), breakdown: { formula: SCORE_FORMULA, parts } };
}
