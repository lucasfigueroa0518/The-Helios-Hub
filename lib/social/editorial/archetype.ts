import type { FactSheet } from '@/lib/social/editorial/fact-sheet';

/**
 * Story-shape archetypes. Per Lucas's feedback: two–three focused
 * archetypes with a router between them outperform one universal beat
 * sequence that has to fit every story shape. A story that reads as forced
 * inside the universal flow is the signal to build (or route to) a new
 * archetype for its shape.
 *
 * Router is heuristic-first (pure function over fact_sheet signals). No LLM
 * call at the routing step. If confidence is unclear, we route to GENERIC
 * and fall back to the pre-archetype flow — backwards-compatible.
 */

export const ARCHETYPES = ['DEADLINE', 'FIGHT', 'NUMBER', 'GENERIC'] as const;
export type Archetype = typeof ARCHETYPES[number];

export type ArchetypeSignals = {
  has_named_deadline: boolean;
  has_rival_actors: boolean;
  has_headline_number: boolean;
  when_text: string;
  matched_deadline_phrase: string | null;
  rival_player_names: string[];
  headline_number_repr: string | null;
};

export type ArchetypeDecision = {
  archetype: Archetype;
  reason: string;
  signals: ArchetypeSignals;
};

/**
 * Per-archetype narrative rules that get injected into the story-plan
 * Sonnet prompt. `required_beats` are must-include; `forbidden_beats` are
 * must-exclude for this shape (e.g. FIGHT has no MECHANISM — a stance
 * doesn't have a "how it works").
 */
export type ArchetypeSpec = {
  headline: string;
  order_hint: string;
  required_beats: string[];
  forbidden_beats: string[];
  rules: string[];
};

export const ARCHETYPE_SPECS: Record<Exclude<Archetype, 'GENERIC'>, ArchetypeSpec> = {
  DEADLINE: {
    headline: 'DEADLINE story — a mandate, law, or rule just landed with a clock',
    order_hint:
      'HOOK → GROUND → SCALE (the clock) → MECHANISM (what compliance means) → CONTEXT → SCENARIO (under the clock) → THESIS → DEBATE → FOLLOW',
    required_beats: ['HOOK', 'GROUND', 'SCALE', 'MECHANISM', 'THESIS', 'DEBATE', 'FOLLOW'],
    forbidden_beats: [],
    rules: [
      'HOOK names the actor and the clock in one sentence.',
      'SCALE visualizes the deadline itself as the big number (e.g. "2 MONTHS.").',
      'MECHANISM explains what compliance actually means — the "how" the reader needs.',
      'SCENARIO puts the reader under the clock (e.g. "Imagine you run an AI lab in ${city}. It\'s ${month}...").',
    ],
  },
  FIGHT: {
    headline: 'FIGHT story — two named actors publicly disagree',
    order_hint:
      'HOOK (both actors) → GROUND (backstory) → TURN (the split) → QUOTE → STAKES → THESIS → DEBATE → FOLLOW',
    required_beats: ['HOOK', 'GROUND', 'TURN', 'QUOTE', 'STAKES', 'THESIS', 'DEBATE', 'FOLLOW'],
    // A stance is not a mechanism. Trying to render "how the fight works"
    // produces the awkward MECHANISM slide that forced-flow FIGHT posts
    // land on today. Skip it — the FIGHT shape is argument, not process.
    forbidden_beats: ['MECHANISM'],
    rules: [
      'HOOK names both actors and states their disagreement in a single sentence — do not save the second name for later.',
      'GROUND gives one sentence of backstory that sets up why the disagreement matters.',
      'TURN is the moment the private disagreement became public.',
      'QUOTE carries at least one real voice from one of the two sides.',
      'STAKES answers "what changes if X wins" vs "what changes if Y wins", concretely.',
    ],
  },
  NUMBER: {
    headline: 'NUMBER story — a striking datapoint that changes how you read the field',
    order_hint:
      'HOOK (state the number) → SCALE (visualize) → MECHANISM (how it happened) → CONTEXT → PROOF → THESIS → DEBATE → FOLLOW',
    required_beats: ['HOOK', 'SCALE', 'MECHANISM', 'PROOF', 'THESIS', 'DEBATE', 'FOLLOW'],
    forbidden_beats: [],
    rules: [
      'HOOK states the number + the actor + why it matters in one sentence — the number is the point of the cover, not a follow-up reveal.',
      'SCALE is the big-number treatment (D1) with a comparison anchor from the fact sheet.',
      'MECHANISM explains HOW the number came to be (the process, the loop, the driver).',
      'PROOF cites the outlet or paper that first reported the number — anchor the datapoint to a source.',
    ],
  },
};

const DEADLINE_PHRASES = [
  /\b(?:requires|must|shall|mandat(?:e|ed|es|ing))\b/i,
  /\bwithin\s+\w+\s+(?:month|months|day|days|week|weeks|year|years)\b/i,
  /\b(?:by|before)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Q[1-4]|\d{4})\b/i,
  /\b(?:deadline|effective\s+(?:date|on)|takes?\s+effect|goes?\s+into\s+effect|due\s+by)\b/i,
  /\b\d+[-\s]?(?:month|months|day|days|week|weeks|year|years)\s+(?:clock|window|period|deadline)\b/i,
  /\bexecutive\s+order\b/i,
];

function factSheetAllText(factSheet: FactSheet): string {
  const parts: string[] = [];
  parts.push(factSheet.five_ws?.what ?? '');
  parts.push(factSheet.five_ws?.when ?? '');
  parts.push(factSheet.five_ws?.why ?? '');
  parts.push(factSheet.five_ws?.why_reader_cares ?? '');
  parts.push(...(factSheet.key_facts ?? []).map((f) => (typeof f === 'string' ? f : (f as { text?: string })?.text ?? '')));
  return parts.filter(Boolean).join(' \n ');
}

function detectDeadline(factSheet: FactSheet): { hit: boolean; phrase: string | null; whenText: string } {
  const when = (factSheet.five_ws?.when ?? '').trim();
  const scanText = factSheetAllText(factSheet);
  for (const rx of DEADLINE_PHRASES) {
    const m = scanText.match(rx);
    if (m) return { hit: true, phrase: m[0], whenText: when };
  }
  return { hit: false, phrase: null, whenText: when };
}

type PlayerLike = { name?: string; rivalry?: unknown; rival?: unknown };

function detectRivalActors(factSheet: FactSheet): string[] {
  const players = (factSheet.players ?? []) as PlayerLike[];
  const rivals = players.filter((p) => {
    if (typeof p !== 'object' || p === null) return false;
    return Boolean(p.rivalry) || Boolean(p.rival);
  });
  const names = rivals.map((p) => (typeof p.name === 'string' ? p.name : '')).filter(Boolean);
  return names;
}

type NumberLike = { value?: unknown; label?: unknown; comparison?: unknown; can_hold_slide?: unknown };

function detectHeadlineNumber(factSheet: FactSheet): { hit: boolean; repr: string | null } {
  const numbers = (factSheet.numbers ?? []) as NumberLike[];
  const candidate = numbers.find((n) => {
    if (typeof n !== 'object' || n === null) return false;
    const hasComparison = typeof n.comparison === 'string' && n.comparison.trim().length > 0;
    const holdsSlide = n.can_hold_slide === true;
    return hasComparison || holdsSlide;
  });
  if (!candidate) return { hit: false, repr: null };
  const value = typeof candidate.value === 'string' ? candidate.value : String(candidate.value ?? '');
  const label = typeof candidate.label === 'string' ? candidate.label : '';
  const repr = [value, label].filter(Boolean).join(' — ');
  return { hit: true, repr: repr || value || null };
}

/**
 * Route to an archetype from fact-sheet signals. Priority order:
 * DEADLINE > FIGHT > NUMBER > GENERIC. Rationale: a clock is the most
 * narrative-shaping signal (everything downstream reorients around it);
 * FIGHT next because argument structure differs from data structure;
 * NUMBER last because it composes with DEADLINE/FIGHT rather than
 * replacing them.
 */
export function deriveArchetype(factSheet: FactSheet): ArchetypeDecision {
  const deadline = detectDeadline(factSheet);
  const rivals = detectRivalActors(factSheet);
  const number = detectHeadlineNumber(factSheet);

  const signals: ArchetypeSignals = {
    has_named_deadline: deadline.hit,
    has_rival_actors: rivals.length >= 2,
    has_headline_number: number.hit,
    when_text: deadline.whenText,
    matched_deadline_phrase: deadline.phrase,
    rival_player_names: rivals,
    headline_number_repr: number.repr,
  };

  if (signals.has_named_deadline) {
    return {
      archetype: 'DEADLINE',
      reason: `deadline phrase "${deadline.phrase}" + when="${deadline.whenText}"`,
      signals,
    };
  }
  if (signals.has_rival_actors) {
    return {
      archetype: 'FIGHT',
      reason: `${rivals.length} rival actors: ${rivals.join(' vs ')}`,
      signals,
    };
  }
  if (signals.has_headline_number) {
    return {
      archetype: 'NUMBER',
      reason: `headline number: ${number.repr}`,
      signals,
    };
  }
  return {
    archetype: 'GENERIC',
    reason: 'no strong archetype signal — falling back to universal flow',
    signals,
  };
}

/**
 * Render an archetype guidance block that gets appended to the story-plan
 * Sonnet system prompt. Kept small on purpose — a modifier, not a rewrite.
 * GENERIC returns an empty string so the pre-archetype flow is preserved.
 */
export function renderArchetypeGuidance(archetype: Archetype): string {
  if (archetype === 'GENERIC') return '';
  const spec = ARCHETYPE_SPECS[archetype];
  const req = spec.required_beats.join(' → ');
  const forbidden = spec.forbidden_beats.length > 0
    ? `\nForbidden beats: ${spec.forbidden_beats.join(', ')}  (do not include these — the shape does not warrant them).`
    : '';
  const rules = spec.rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n');
  return `\n## Archetype for this story: ${archetype}

${spec.headline}.

Required beat sequence: ${req}${forbidden}

Archetype rules (apply on top of the base rules above):
${rules}

This archetype's spec beats the universal flow when they conflict. If the base rules and the archetype rules disagree, follow the archetype rules.
`;
}
