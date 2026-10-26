/**
 * Turns: the story side of the mapping (ME-101, planning/Memes/TURN_TYPES.md).
 * A turn is the reversal, contradiction or backfire a joke rests on. The
 * writer names a story's turns first, as typed objects with beats that cite
 * the brief's facts; code checks them here and keeps the best before any
 * meme is written. The types are approved data: a change needs Lucas.
 */
import { bluePlayer, type BluePlayer } from '@/lib/social-hub/blue-chip-players';

import { HEDGE, NARRATION } from './lint';
import { factIndex, playersInStory, type MemeStory } from './story';

export const TURN_TYPE_IDS = [
  'backfire', 'says-vs-does', 'double-standard', 'unlikely-agreement', 'wandering-eye', 'the-fall', 'scale-gap',
  'fancy-name', 'obvious-consequence', 'again', 'backwards-result', 'vested-interest', 'dilemma',
  'self-congratulation', 'fine-print', 'outrage-vs-shrug', 'viewers-day',
] as const;
export type TurnTypeId = (typeof TURN_TYPE_IDS)[number];

export type TurnTypeDef = {
  id: TurnTypeId;
  name: string;
  /** What the turn is, in one sentence. */
  what: string;
  /** The beat roles, in reading order. The last role is the payoff. */
  roles: readonly string[];
  /** Roles a turn may leave out. */
  optional?: readonly string[];
  /** A graded example (2026-10-14 batch). */
  example: string;
};

export const TURN_TYPES: readonly TurnTypeDef[] = [
  { id: 'backfire', name: 'Backfire', what: "A party's own move causes its own problem.", roles: ['actor', 'move', 'next-move', 'consequence'], optional: ['actor', 'next-move'], example: 'Hire from Apple, build an iPhone rival, a judge hands Apple your interview files.' },
  { id: 'says-vs-does', name: 'Says vs does', what: 'A party says one thing and does, or keeps doing, another.', roles: ['says', 'does'], example: 'Maia will be the main system; Nvidia and AMD still do the training.' },
  { id: 'double-standard', name: 'Double standard', what: 'A party holds others to a standard it does not meet, or fears for itself what it does to others.', roles: ['standard', 'own-case'], example: 'Police say being tracked would be scary.' },
  { id: 'unlikely-agreement', name: 'Unlikely agreement', what: 'Two parties usually apart, or rivals, agree on one thing or make the same move.', roles: ['party-a', 'party-b', 'shared'], example: 'OpenAI and Anthropic both tell lawmakers voluntary pledges are not enough.' },
  { id: 'wandering-eye', name: 'Wandering eye', what: 'A party committed to one thing is drawn to another.', roles: ['who', 'current', 'new'], example: 'Microsoft, with Nvidia, eyeing its own Maia 300.' },
  { id: 'the-fall', name: 'The fall', what: 'Then strong, now weak, each with the figure that shows it.', roles: ['then', 'now'], example: 'Character.AI: valued over $1B with no revenue; Disney bids $20M for some assets.' },
  { id: 'scale-gap', name: 'Scale gap', what: 'Two things side by side whose sizes do not match.', roles: ['big', 'small'], example: 'Milk has more safety rules than AI.' },
  { id: 'fancy-name', name: 'Fancy name', what: 'A plain thing and the polished name it goes by.', roles: ['plain', 'polished'], example: '"Rules you can choose to follow" is "a light-touch approach".' },
  { id: 'obvious-consequence', name: 'Obvious consequence', what: 'A move and the result anyone could have predicted.', roles: ['move', 'result'], example: 'Everyone mass-applies with AI; 12,000 applications show up.' },
  { id: 'again', name: 'Again', what: 'The same thing happens again.', roles: ['before', 'event'], optional: ['before'], example: 'Claude acting on a real site it should not, again.' },
  { id: 'backwards-result', name: 'Backwards result', what: 'Help that was added made the outcome worse.', roles: ['help', 'more-help', 'outcome'], optional: ['more-help'], example: 'Reward the robot for reaching the part, and for lining it up: success goes down.' },
  { id: 'vested-interest', name: 'Vested interest', what: 'Someone takes a position that happens to pay them.', roles: ['speaker', 'stance', 'stake'], optional: ['speaker'], example: 'A chip CEO wants less AI doom talk: vested interest.' },
  { id: 'dilemma', name: 'Dilemma', what: 'Someone is stuck choosing between two real options, and the sweat is out of proportion: the right one is obvious and they still won\'t take it, the two are the same thing, or both are bad. Never a fair, calmly weighed trade-off.', roles: ['option-a', 'option-b', 'chooser'], example: 'Claude Opus 5.5 Max or Muse Wonder Full: me, deciding which to use this week.' },
  { id: 'self-congratulation', name: 'Self-congratulation', what: 'A party credits itself, or its own product, with something outside its job.', roles: ['party', 'brag'], example: "OpenAI says its own models traced its own spy: something of a detective." },
  { id: 'fine-print', name: 'Fine print', what: 'A big promise and the catch under it.', roles: ['promise', 'catch'], example: '$250M of compute for UK researchers; providers and terms still to be agreed.' },
  { id: 'outrage-vs-shrug', name: 'Outrage vs shrug', what: 'An angry accusation and an unbothered answer.', roles: ['accuser', 'accusation', 'reply'], optional: ['accuser'], example: 'Police: two months is unacceptable. Anthropic: minimal impact.' },
  { id: 'viewers-day', name: "The viewer's day", what: "How the news lands in the viewer's own day with AI products.", roles: ['news', 'viewer'], example: 'A new top model: me, deciding which one to use this week.' },
];

const typeById = new Map(TURN_TYPES.map((t) => [t.id, t]));
export const turnType = (id: string): TurnTypeDef | undefined => typeById.get(id as TurnTypeId);

export type TurnBeat = { role: string; text: string; factIds: string[]; playerId: string | null };

export type Turn = {
  id: string;
  type: TurnTypeId;
  /** One plain sentence: the turn as a follower would say it. */
  summary: string;
  beats: TurnBeat[];
  /** Who the joke is on: a player id, 'viewer', or a plain description. */
  butt: string;
  /** The news lands in the viewer's own day: only then may a meme speak as "Me" (ME-105). */
  touchesViewer: boolean;
  /** The writer's own strength call, 1 (weak) to 3 (sharp). */
  strength: 1 | 2 | 3;
};

/** Beats are never printed (the cards cap the printed lines), so this only keeps a turn crisp. */
export const MAX_BEAT_CHARS = 160;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * How many stories a spread or landscape turn must reach, by the story
 * letter on its fact IDs ("A.F1"). Single-story runs pass nothing.
 */
export type Coverage = { letters: readonly string[]; need: 'all' | 'two' };

/** Every problem with one submitted turn, or the turn when there are none. */
export function checkTurn(raw: unknown, story: MemeStory, coverage?: Coverage): { turn?: Turn; errors: string[] } {
  const errors: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = str(o.id) || '?';
  const def = turnType(str(o.type));
  if (!def) return { errors: [`${id}: type "${str(o.type)}" is not a turn type`] };
  const summary = str(o.summary);
  if (!summary) errors.push(`${id}: summary is empty`);
  const facts = factIndex(story.brief);
  const claims = new Map<string, string>();
  for (const f of [...(story.brief.facts ?? []), ...(story.brief.background ?? [])]) if (f.claim_by) claims.set(f.id, f.claim_by);
  const castable = playersInStory(story.brief);
  const inStory = new Set(castable.map((p) => p.id));
  const rawBeats = Array.isArray(o.beats) ? (o.beats as Array<Record<string, unknown>>) : [];
  const beats: TurnBeat[] = [];
  for (const b of rawBeats) {
    const role = str(b.role);
    const text = str(b.text);
    const where = `${id}.${role || '?'}`;
    if (!def.roles.includes(role)) errors.push(`${where}: "${role}" is not a role of ${def.id} (${def.roles.join(', ')})`);
    if (!text) errors.push(`${where}: empty beat`);
    if (text.length > MAX_BEAT_CHARS) errors.push(`${where}: ${text.length} characters (at most ${MAX_BEAT_CHARS})`);
    const factIds = Array.isArray(b.fact_ids) ? (b.fact_ids as unknown[]).map(str).filter(Boolean) : [];
    const viewerBeat = role === 'viewer' || role === 'chooser';
    if (!factIds.length && !viewerBeat) errors.push(`${where}: a beat needs the fact IDs it rests on`);
    for (const f of factIds) if (!facts.has(f)) errors.push(`${where}: fact "${f}" is not in the brief`);
    const playerId = str(b.player_id) || null;
    if (playerId) {
      if (!bluePlayer(playerId)) errors.push(`${where}: "${playerId}" is not a blue-chip player`);
      else if (!inStory.has(playerId)) errors.push(`${where}: ${playerId} is not in this story`);
    }
    // Only a blue-chip company's claim must be cast (ME-93); anyone else's is left to the accuracy judge.
    const claimed = factIds.map((f) => claims.get(f)).filter((c): c is string => Boolean(c) && castable.some((p) => claimerMatches(p, c!)));
    if (claimed.length && !playerId && !claimed.some((c) => text.toLowerCase().includes(c.toLowerCase()))) {
      errors.push(`${where}: rests on ${claimed[0]}'s claim; cast ${claimed[0]} as the beat's player_id or name them`);
    }
    beats.push({ role, text, factIds, playerId });
  }
  const order = def.roles.filter((r) => beats.some((b) => b.role === r));
  if (beats.map((b) => b.role).join('|') !== order.join('|')) errors.push(`${id}: beats must follow the order ${def.roles.join(', ')}, each once`);
  const required = def.roles.filter((r) => !(def.optional ?? []).includes(r));
  for (const r of required) if (!beats.some((b) => b.role === r)) errors.push(`${id}: missing the ${r} beat`);
  const payoff = beats[beats.length - 1];
  if (payoff && HEDGE.test(payoff.text)) errors.push(`${id}: the payoff hedges ("${HEDGE.exec(payoff.text)![0]}"); state what happened`);
  for (const b of beats) if (NARRATION.test(b.text)) errors.push(`${id}.${b.role}: narrates someone speaking; show the move itself`);
  const touchesViewer = o.touches_viewer === true;
  if (def.id === 'viewers-day' && !touchesViewer) errors.push(`${id}: a viewer's-day turn touches the viewer`);
  const strength = o.strength === 1 || o.strength === 2 || o.strength === 3 ? o.strength : 1;
  if (coverage) {
    const letters = new Set(beats.flatMap((b) => b.factIds).map((f) => f.split('.')[0]!).filter((l) => coverage.letters.includes(l)));
    if (coverage.need === 'all' && letters.size < coverage.letters.length) errors.push(`${id}: a spread turn draws on every story (${coverage.letters.join(', ')}); this one uses ${[...letters].join(', ') || 'none'}`);
    if (coverage.need === 'two' && letters.size < 2) errors.push(`${id}: a landscape turn draws on at least two stories`);
  }
  if (errors.length) return { errors };
  return { turn: { id, type: def.id, summary, beats, butt: str(o.butt) || 'none', touchesViewer, strength }, errors };
}

export type TurnCheck = { kept: Turn[]; all: Array<{ id: string; type: string; summary: string; strength: number; errors: string[] }> };

export const MAX_TURNS = 3;

/** Does this blue-chip player stand for the party a [CLAIM: X] names? */
export function claimerMatches(p: BluePlayer, claimBy: string): boolean {
  const c = claimBy.toLowerCase();
  return [p.name, ...(p.aka ?? []), ...p.tokens].some((n) => c.includes(n.toLowerCase()) || n.toLowerCase().includes(c));
}

/**
 * Check every submitted turn and keep up to MAX_TURNS: the strongest first,
 * one per type while other types remain, so the slate can offer different
 * ideas (ME-61).
 */
export function checkTurns(input: unknown, story: MemeStory, coverage?: Coverage): TurnCheck {
  const list = Array.isArray((input as { turns?: unknown })?.turns) ? ((input as { turns: unknown[] }).turns) : [];
  const all: TurnCheck['all'] = [];
  const valid: Turn[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const r = checkTurn(raw, story, coverage);
    const o = (raw ?? {}) as Record<string, unknown>;
    let id = str(o.id) || `T${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    all.push({ id, type: str(o.type), summary: str(o.summary), strength: Number(o.strength) || 0, errors: r.errors });
    if (r.turn) valid.push({ ...r.turn, id });
  });
  const ranked = [...valid].sort((a, b) => b.strength - a.strength || valid.indexOf(a) - valid.indexOf(b));
  const kept: Turn[] = [];
  for (const t of ranked) if (kept.length < MAX_TURNS && !kept.some((k) => k.type === t.type)) kept.push(t);
  for (const t of ranked) if (kept.length < MAX_TURNS && !kept.includes(t)) kept.push(t);
  return { kept, all };
}

/** The turn types as the writer's system prompt lists them. */
export const turnTypesBlock = TURN_TYPES.map((t) => {
  const roles = t.roles.map((r) => ((t.optional ?? []).includes(r) ? `${r} (optional)` : r)).join(' → ');
  return `- ${t.id}: ${t.what}\n  Beats, in order (the last is the payoff): ${roles}\n  Example: ${t.example}`;
}).join('\n');
