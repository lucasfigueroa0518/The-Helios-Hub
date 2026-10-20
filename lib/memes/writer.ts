/**
 * The meme writer, meme-writer@3 (planning/Memes/UPGRADE_PLAN.md U4): one
 * conversation, two steps.
 *
 *   1. submit_turns: Claude names the story's turns (ME-101). Code checks
 *      them (lib/memes/turns.ts), keeps up to three, and matches each to a
 *      short list of free templates that carry it (lib/memes/match.ts).
 *   2. submit_memes: Claude maps each kept turn onto templates from its own
 *      short list. Code checks every fill: the slot's MUST, the format line,
 *      the card's length cap, the voice, and the lints that predicted
 *      Lucas's ratings (hedges, narrated speech, names a follower would not
 *      know). A claim is shown by casting the claimer, never with "says"
 *      (ME-93). A viewer line only for a turn that touches the viewer (ME-105).
 *
 * Kept from @2: there is always an angle (ME-90); broken memes are dropped,
 * and one more call asks for new drafts only when fewer than two survive the
 * judges (ME-95); every call is checked against the spend cap (ME-62).
 *
 * Prompt caching: tools (both submit tools, stable across the calls) →
 * system (rules, voice, humanizer, turn types, situations, players: all
 * static) → the conversation (story, turns, short lists), cached on its last
 * block so each later call reads it.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { AUDIENCE_RULE } from '@/lib/reels/jev/questions/scoring-shared';
import { voiceHits } from '@/lib/social/mechanical/voice-lists';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { BLUE_CHIP_PLAYERS, bluePlayer, companiesOf } from '@/lib/social-hub/blue-chip-players';
import { HUMANIZER_TEXT } from '@/lib/stories/copy/humanizer.generated';

import { cardV2 } from './cards-v2';
import { templateCard, writableSlots } from './catalog';
import { goldenCard } from './golden-card';
import { CostMeter, JUDGE_RESERVE_USD, MEME_MODELS, worstCaseCallUsd, type MemeModelConfig } from './cost';
import { resolveMeme, type MemeFill, type SlotFill } from './fill';
import { HEDGE, INCIDENT, NARRATION, nameContext, obscureNames } from './lint';
import { shortlists, type Shortlist } from './match';
import { AUDIENCE_SITUATIONS, SITUATION_RULES, situation } from './situations';
import { factIndex, playerInStory, playersInStory, storyForPrompt, type MemeStory } from './story';
import { checkTurns, TURN_TYPE_IDS, turnTypesBlock, type Coverage, type Turn, type TurnCheck } from './turns';
import type { TemplateCard } from './types';

export const WRITER_PROMPT_VERSION = 'meme-writer@3';
/** Drafts per kept turn on the memes call, and on the one follow-up call when needed. */
export const DRAFTS_PER_TURN = 2;
export const MORE_DRAFTS = 4;
export const MAX_PATTERN_CHARS = 40;
/** The follow-up asks for fewer drafts, so it can stop sooner (and cost less). */
const MORE_MAX_TOKENS = 7_000;

// ── The prompt ──────────────────────────────────────────────────────────────

const situationsBlock = AUDIENCE_SITUATIONS.map(
  (x) => `- ${x.id} ${x.name} (${x.audience}): "${x.feeling}"\n  Brought up by: ${x.broughtUpBy}\n  Viewer line: ${x.viewerLine}\n  Keep clear of: ${x.keepClearOf}`,
).join('\n');

const playersBlock = BLUE_CHIP_PLAYERS.map((p) => {
  const cos = companiesOf(p).map((c) => c.name);
  return `- ${p.id}: ${p.name} (${p.kind}${cos.length ? `, ${cos.join(', ')}` : ''})`;
}).join('\n');

export const WRITER_SYSTEM = `You make memes about AI news for Helios's Instagram. You get one story and work in two steps, each one tool call: first the story's turns, then memes built on the turns code keeps. Code renders everything: names, logos, fonts, layout and each format's own line are never yours.

AUDIENCE
${AUDIENCE_RULE}

WHAT THE VIEWER SEES (every step serves this)
The viewer scrolls past with only the story's HEADLINE and the meme. They have not read the article and never will.
HARD CONSTRAINTS
- Build every turn and every meme on the headline's main entities: the companies, people or products the headline names, or the plain thing it is about.
- The relation between them must make sense from common sense. If only a technical reader would see why the two things go together, it is the wrong turn.
- Any other name, term, product or number from the article must explain itself in the meme, or stay out.

STEP 1: THE TURNS (call submit_turns)
A meme lands when it shows a turn: the reversal, contradiction or backfire in the story, the thing a follower would point at. Find the story's turns before you think about any template.
HARD CONSTRAINTS (code checks every one; a turn that breaks one is thrown away)
- Submit 3 to 5 turns, of different types where the story allows, each typed with one of the TURN TYPES below.
- Each beat has a role from its type, in the type's order, each role once; the last beat is the payoff.
- Every beat cites the fact IDs it rests on (a viewer or chooser beat may cite none).
- Beats are plain words a casual follower knows. A person, small company or acronym the story introduces is described, not named ("a voice actor", "a chip CEO", "the UK's AI testing body"). Blue-chip players are named, or cast with player_id.
- The payoff states what happened. No hedges: never "may", "might", "says", "said", "claims", "reportedly".
- No beat narrates someone speaking ("Tell…", "Announce…", "Explain…", "Ask…"). Show the move itself.
- A beat that rests on a [CLAIM: X] fact from a blue-chip company casts X as the beat's player_id, or names X in the beat.
- touches_viewer is true only when the news lands in the viewer's own day with AI products (a price, a limit, a rollout, a choice they now face). A viewer's-day turn always touches the viewer.
- strength: 3 when a follower who reads only the headline gets it at a glance and it stings; 2 when it is clear from the headline; 1 when it needs anything from the article body (a detail, a number, a name the headline lacks). Be honest; code keeps the strongest.
There is always an angle. When a story involves harm, the turn is about the process, the spin, or the gap between what was promised and what happened, never the harm or the people it hurt.

STEP 2: THE MEMES (call submit_memes)
Code answers with the turns it kept and, for each, the short list of templates that carry it, with every card in full. A meme maps one turn onto one of its templates.
HARD CONSTRAINTS (code checks every one; a meme that breaks one is thrown away)
- Every meme names its turn_id and a template_id from that turn's short list.
- The turn's beats fill the slots in reading order, and its payoff lands in the card's PUNCH slot.
- Fill every slot the card lets you fill, except optional ones, with a kind that slot accepts. Never fill a slot marked "do not fill".
- Every fill does what its slot's MUST says, and says so in why: one sentence naming who or what plays the role and the fact IDs that show it.
- A slot with a FORMAT: write only its {x} part, at most ${MAX_PATTERN_CHARS} characters. Code prints the format's line around it.
- text: one short line within the card's MAX CHARACTERS, with fact_ids naming the IDs it rests on (at least one). Every claim in the line is in those facts. Framing may exaggerate only when the relation underneath is true. Never invent a quote, a number, a date, a product or a name. A number appears exactly as the story writes it. Say things in plain words, never with a double negative.
- entity: player_id from BLUE-CHIP PLAYERS IN THIS STORY, nothing else. Code prints the exact name and logo. A person fills an entity slot only for something the story shows that person doing.
- viewer ("Me, …"): only for a turn that touches the viewer. Then situation_id names the situation that carries it (one the card allows) and the line is that situation's viewer line, its bracket filled from the facts. For any other turn, situation_id is null and no slot speaks as the viewer.
- Plain words: no name a casual follower would not know, no hedge word, and no line that narrates someone speaking, except in a slot the card marks SPOKEN, where a question or a remark is the format.
- No em dashes, no double hyphens, no emoji, and no exclamation marks except in a slot whose card says "an exclamation mark is allowed".
- relation: one plain sentence saying what a reader should take away.
- Write two memes per turn, on different templates from its short list. Vary the mapping, not the wording.
- A number only when it is in the headline or THE NEWS line, or when the number itself is the joke. Never a figure, date, count or price lifted from deeper in the article.
- Fill an optional slot only when it adds to the joke. No box restates a fact for completeness: if a box would only carry a detail, leave it out or pick a template with fewer boxes.

CLAIMS ARE CLAIMS
- A fact marked [CLAIM: X says] is only what X says, not an established fact.
- A company's claim about its own product (its value, its savings, its speed, that it is better) is advertising. Never state it as true, and never make it the payoff a meme delivers: a meme that would work as that company's ad is a failure.
- A company's claim may be what the joke is about (its spin, a hypocrisy, the gap between what it said and what happened). Show it as theirs by casting: put the company on the image (its player_id in an entity slot) as the one saying or doing it, or quote the line and name the company in it. Never with "says" or "claims".

CASTING AND TONE
- Companies and products take the clown and villain roles. Never mock a person for who they are, and never punch down at people a story hurts.
- Politics only when it is the story's subject, and never with partisan sentiment.
- The situation rules: ${SITUATION_RULES.join(' ')}
- The shortest line that lands. A meme is read in two seconds; lines of 40 characters or fewer land best.

HOW REAL MEMES ARE WRITTEN (coded from about 10,000 real captioned memes on these templates; planning/Memes/GOLDEN_SET.md)
HARD CONSTRAINTS (code checks the first two; the card's MISREADS and the judges check the rest)
- One idea per box, written as a label: a noun phrase or a gerund phrase ("Reading the terms", "Ex-Apple staff"), not a sentence. Never two sentences in one box. No full stop at the end of a box.
- Every meme follows one of its card's PATTERNS and names it in pattern. The card's WHY IT IS FUNNY is the joke; a meme that fills the slots without that joke fails.
- When two or more boxes compare (two options, before and after, plain and fancy, the same act twice), reuse the same opening words and change only what differs. The change is the joke.
- Give the figure its own voice. When a figure stands for a company and speaks or chooses, write its line as the company's own words in the first person ("We…", "Us…", "Our…") or label it with a name and a colon ("Meta:"), never as a report about it ("Meta announces…"). A news-headline line is the commonest flop.
- Concrete beats abstract: name a thing a person does, sees or pays for ("Scrolling to the bottom and hitting agree"), never a policy noun ("Transparency obligations", "Strategic partnership").
- Set up plain, punch specific: the setup boxes are short and generic, and the punch box carries the one concrete detail from the facts (an exact number, object or act).
- Never explain the joke: no "because", no "but" or "however", no moral, no reason why it is bad. The picture carries the attitude; flat, deadpan delivery lands.
- Small and familiar beats big and new: the follower must already know, or have lived, the thing the joke turns on.

VOICE
${VOICE_BLOCK}

Before you submit, check every line against these writing patterns and rewrite any line that has one:
${HUMANIZER_TEXT}

TURN TYPES
${turnTypesBlock}

AUDIENCE SITUATIONS (only for turns that touch the viewer)
${situationsBlock}

BLUE-CHIP PLAYERS (ids; a story lists the ones it names)
${playersBlock}`;

const beatSchema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    text: { type: 'string', description: 'The beat in plain words a casual follower knows.' },
    fact_ids: { type: 'array', items: { type: 'string' } },
    player_id: { type: ['string', 'null'], description: 'The blue-chip player this beat casts, if any.' },
  },
  required: ['role', 'text', 'fact_ids', 'player_id'],
};

export const SUBMIT_TURNS: Anthropic.Tool = {
  name: 'submit_turns',
  description: "Submit the story's turns (step 1).",
  input_schema: {
    type: 'object',
    properties: {
      turns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'T1, T2, …' },
            type: { type: 'string', enum: [...TURN_TYPE_IDS] },
            summary: { type: 'string', description: 'One plain sentence: the turn as a follower would say it.' },
            beats: { type: 'array', items: beatSchema },
            butt: { type: 'string', description: "Who the joke is on: a player id, 'viewer', or a plain description." },
            touches_viewer: { type: 'boolean' },
            strength: { type: 'integer', enum: [1, 2, 3] },
          },
          required: ['id', 'type', 'summary', 'beats', 'butt', 'touches_viewer', 'strength'],
        },
      },
    },
    required: ['turns'],
  },
};

export const SUBMIT_MEMES: Anthropic.Tool = {
  name: 'submit_memes',
  description: 'Submit memes built on the kept turns (step 2).',
  input_schema: {
    type: 'object',
    properties: {
      memes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            turn_id: { type: 'string' },
            template_id: { type: 'string' },
            situation_id: { type: ['string', 'null'], description: 'Only for a turn that touches the viewer.' },
            relation: { type: 'string', description: 'One plain sentence: what a reader should take away.' },
            pattern: { type: 'string', description: "The id of the card's PATTERN this meme follows." },
            pattern_fit: { type: 'string', description: "One sentence: how this meme's lines fill that pattern's form and why it is funny the way the card's WHY IT IS FUNNY says." },
            fills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slot: { type: 'string' },
                  kind: { type: 'string', enum: ['entity', 'text', 'viewer'] },
                  player_id: { type: ['string', 'null'] },
                  text: { type: ['string', 'null'], description: 'For a slot with a FORMAT, only the {x} part.' },
                  fact_ids: { type: 'array', items: { type: 'string' } },
                  situation_id: { type: ['string', 'null'] },
                  why: { type: 'string', description: "One sentence: who or what plays this slot's role and how it meets the slot's MUST, with fact IDs." },
                },
                required: ['slot', 'kind', 'player_id', 'text', 'fact_ids', 'situation_id', 'why'],
              },
            },
          },
          required: ['turn_id', 'template_id', 'pattern', 'pattern_fit', 'situation_id', 'relation', 'fills'],
        },
      },
    },
    required: ['memes'],
  },
};

const TOOLS: Anthropic.Tool[] = [SUBMIT_TURNS, withToolCache(SUBMIT_MEMES)];

/**
 * The most characters one written line in this slot may hold. On a golden
 * card it is the real top posts' 90th percentile for that slot plus a tenth
 * (G3), between 18 and 80: some formats run short ("ME"), some long (a
 * shower thought). Without one, the card's own cap.
 */
export const SLOT_CAP_RANGE = [18, 80] as const;
export function slotCap(t: TemplateCard, slot: string): number {
  const v2 = cardV2(t.id)!;
  const target = goldenCard(t.id)?.slotTargets[slot];
  const base = target ? Math.max(SLOT_CAP_RANGE[0], Math.min(SLOT_CAP_RANGE[1], Math.round(target.p90 * 1.1))) : v2.maxChars;
  return t.slots.find((x) => x.id === slot)?.pattern ? Math.min(MAX_PATTERN_CHARS, base) : base;
}

/** How much of a golden card the writer reads: the most common patterns, the examples on them, the commonest misreads. */
const CARD_PATTERNS = 4;
const CARD_EXAMPLES = 3;
const CARD_MISREADS = 4;

/** Whole sentences from the start of a text, up to about max characters. */
function firstSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** One card as the writer reads it in step 2: the slots and MUSTs, plus how the format really works (the golden card). */
export function cardText(t: TemplateCard): string {
  const v2 = cardV2(t.id)!;
  const g = goldenCard(t.id);
  const slots = t.slots
    .map((x) => {
      if (x.fixed) return `    - ${x.id} (${x.where}): fixed text "${x.fixed}", printed by code; do not fill.`;
      if (x.derived) return `    - ${x.id} (${x.where}): ${x.role}; printed by code from ${x.derived.from}${x.pattern ? ` as "${x.pattern}"` : ''}; do not fill.`;
      const lines = [`    - ${x.id} (${x.where}): ${x.role}. Accepts: ${x.accepts.join(' or ')}.${x.optional ? ' Optional.' : ''}`];
      if (x.must) lines.push(`      MUST: ${x.must}`);
      if (x.pattern) lines.push(`      FORMAT: code prints "${x.pattern}"; write only the {x} part.`);
      const target = g?.slotTargets[x.id];
      if (target) lines.push(`      REAL LINES: ${target.form}; about ${target.p50} characters. HARD CAP: ${slotCap(t, x.id)}.`);
      if (v2.spoken?.includes(x.id)) lines.push('      SPOKEN: a question or a remark is this slot\'s format.');
      if (v2.voice?.[x.id]?.includes('exclamation')) lines.push('      VOICE: an exclamation mark is allowed here.');
      return lines.join('\n');
    })
    .join('\n');
  const tail = [
    `  Situations it allows: ${t.situations.join(', ')}`,
    `  Watch: ${t.watch}${t.burnedIn ? `\n  Printed in the image already: ${t.burnedIn}` : ''}`,
  ];
  if (!g) {
    return [
      `- ${t.id}: ${t.name}`,
      `  Logic: ${t.logic}`,
      `  How it is used: ${v2.usage}`,
      `  Attitude: ${v2.stance}. ${v2.carriedBy === 'picture' ? 'The picture itself shows the relation.' : 'The text must carry the tone; the picture alone does not.'}`,
      `  PUNCH slot: ${v2.punch}. MAX CHARACTERS per line: ${v2.maxChars}.`,
      `  Slots:\n${slots}`,
      ...tail,
    ].join('\n');
  }
  const fill = (v: string) => (/^\[(logo|viewer)/.test(v) ? v : `"${v}"`);
  // The writer reads the parts that steer a draft; the full dossier (counts, the figure, every example) is in GOLDEN_SET.md.
  const patterns = [...g.patterns].sort((a, b) => b.share - a.share).slice(0, CARD_PATTERNS);
  const examples = [...g.examples.filter((e) => patterns.some((p) => p.id === e.pattern))].slice(0, CARD_EXAMPLES);
  return [
    `- ${t.id}: ${t.name}`,
    `  Picture: ${g.picture}`,
    `  WHY IT IS FUNNY: ${g.mechanism}`,
    `  PATTERNS (every meme on this card follows one; name it in pattern):`,
    ...patterns.map((p) => `    - ${p.id}: ${p.form} (${p.device})`),
    `  How real ones are written: ${firstSentences(g.voice, 320)}`,
    `  PUNCH slot: ${v2.punch}.`,
    `  Slots:\n${slots}`,
    `  Examples (ours, in the real register):`,
    ...examples.map((e) => `    - ${e.pattern} | ${e.story} → ${Object.entries(e.fills).map(([k, v]) => `${k}: ${fill(v)}`).join(' / ')}`),
    `  MISREADS (a meme that does one of these fails):`,
    ...g.misreads.slice(0, CARD_MISREADS).map((m) => `    - ${m}`),
    ...tail,
  ].join('\n');
}

/** Step 1's user message: the story, any run note, and the ask. */
/** Step 1's note for a story about harm, crime or the courts (UPGRADE_V5 U5). */
export const INCIDENT_NOTE =
  "THIS STORY INVOLVES HARM, CRIME OR THE COURTS. Aim every turn at a company's process, spin or absurd detail (what it did, said or missed), never at the harm, a victim or an accused person. A turn the off-limits rules would drop is wasted.";

export function writerUser(story: MemeStory, note?: string): string {
  const incident = INCIDENT.test(`${story.title} ${story.brief.the_news?.text ?? ''}`);
  return `${storyForPrompt(story)}${note ? `\n\n${note}` : ''}${incident ? `\n\n${INCIDENT_NOTE}` : ''}\n\nStep 1: name this story's turns. Call submit_turns.`;
}

const turnLine = (t: Turn) =>
  [
    `TURN ${t.id} (${t.type}, strength ${t.strength}${t.touchesViewer ? ', touches the viewer' : ''}): ${t.summary}`,
    ...t.beats.map((b) => `  ${b.role}: "${b.text}" [${b.factIds.join(', ')}]${b.playerId ? ` cast: ${b.playerId}` : ''}`),
  ].join('\n');

/** Step 2's message: the kept turns, each with its short list, and every listed card in full. */
export function step2Message(lists: Shortlist[], check: TurnCheck, unmatched: Turn[], viewerSees?: string): string {
  const dropped = check.all.filter((a) => a.errors.length);
  const cards = [...new Map(lists.flatMap((l) => l.cards).map((c) => [c.id, c])).values()];
  return [
    ...(viewerSees ? [`THE VIEWER SEES ONLY: "${viewerSees}" and the meme. Build on its main entities.`, ''] : []),
    `Code kept ${lists.length} turn${lists.length === 1 ? '' : 's'}. Write ${lists.length * DRAFTS_PER_TURN} memes: ${DRAFTS_PER_TURN} per turn, on different templates from that turn's short list. Call submit_memes.`,
    '',
    ...lists.map((l) => `${turnLine(l.turn)}\n  Templates: ${l.cards.map((c) => c.id).join(', ')}`),
    ...(dropped.length ? ['', 'Turns dropped (for your information; do not use them):', ...dropped.map((d) => `- ${d.id}: ${d.errors.slice(0, 2).join('; ')}`)] : []),
    ...(unmatched.length ? ['', `Turns no free template carries: ${unmatched.map((t) => t.id).join(', ')}`] : []),
    '',
    'TEMPLATE CARDS',
    ...cards.map(cardText),
  ].join('\n');
}

// ── The check ───────────────────────────────────────────────────────────────

export type Mapping = {
  templateId: string;
  situationId: string | null;
  relation: string;
  fill: MemeFill;
  /** The writer's case for each slot: who or what plays the role, and how it meets the MUST. */
  why: Record<string, string>;
  /** The turn it carries (meme-writer@3); absent on memes made before the upgrade. */
  turnId?: string;
  turnType?: string;
  /** The golden card pattern it follows (G4); absent before the golden cards. */
  pattern?: string;
};

export type WriterOutput = {
  turns: TurnCheck;
  lists: Shortlist[];
  unmatched: string[];
  /** No turn passed on the first try; the run went on with the second try's turns. */
  weakTurn: boolean;
  mappings: Mapping[];
  dropped: Array<{ index: number; templateId: string; errors: string[] }>;
};

const BANNED_CHARS = /[—]|--|\p{Extended_Pictographic}/u;
/** A full stop, question or exclamation followed by another sentence in the same box. */
const MULTI_SENTENCE = /[.!?]\s+\p{Lu}/u;
const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|St|vs|U\.S|U\.K|e\.g|i\.e|Inc|Co|Jr|Sr)\./g;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Does this player stand for the party a [CLAIM: X] names? */
export function playerIsClaimer(playerId: string, claimBy: string): boolean {
  const p = bluePlayer(playerId);
  if (!p) return false;
  const c = claimBy.toLowerCase();
  return [p.name, ...(p.aka ?? []), ...p.tokens, ...companiesOf(p).map((x) => x.name)].some((n) => c.includes(n.toLowerCase()) || n.toLowerCase().includes(c));
}

/** Every problem with one submitted meme, or the mapping when there are none. */
export function checkMeme(raw: unknown, story: MemeStory, lists: readonly Shortlist[]): { mapping?: Mapping; errors: string[] } {
  const errors: string[] = [];
  const m = (raw ?? {}) as Record<string, unknown>;
  const templateId = str(m.template_id);
  const card = templateCard(templateId);
  if (!card) return { errors: [`template "${templateId}" is not in the catalog`] };
  const v2 = cardV2(templateId)!;
  const turnId = str(m.turn_id);
  const list = lists.find((l) => l.turn.id === turnId);
  if (!list) errors.push(`turn "${turnId}" is not a kept turn (${lists.map((l) => l.turn.id).join(', ')})`);
  else if (!list.cards.some((c) => c.id === templateId)) errors.push(`${templateId} is not on turn ${turnId}'s short list (${list.cards.map((c) => c.id).join(', ')})`);
  const touchesViewer = list?.turn.touchesViewer ?? false;
  let situationId = str(m.situation_id) || null;
  if (situationId && !touchesViewer) situationId = null;
  if (situationId && !situation(situationId)) errors.push(`situation "${situationId}" is not an approved situation`);
  if (situationId && !card.situations.includes(situationId)) errors.push(`${templateId} does not allow situation ${situationId}`);
  const relation = str(m.relation);
  if (!relation) errors.push('relation is empty');
  // G4: a meme on a golden card names the real pattern it follows.
  const golden = goldenCard(templateId);
  const pattern = str(m.pattern) || undefined;
  if (golden) {
    if (!pattern) errors.push(`${templateId}: pattern is empty; name one of ${golden.patterns.map((p) => p.id).join(', ')}`);
    else if (!golden.patterns.some((p) => p.id === pattern)) errors.push(`${templateId}: pattern "${pattern}" is not one of ${golden.patterns.map((p) => p.id).join(', ')}`);
    if (!str(m.pattern_fit)) errors.push(`${templateId}: pattern_fit is empty`);
  }
  const facts = factIndex(story.brief);
  const claims = new Map<string, string>();
  for (const f of [...(story.brief.facts ?? []), ...(story.brief.background ?? [])]) if (f.claim_by) claims.set(f.id, f.claim_by);
  const names = nameContext(story.title, story.brief);
  const fills: SlotFill[] = [];
  const why: Record<string, string> = {};
  const rawFills = Array.isArray(m.fills) ? (m.fills as Array<Record<string, unknown>>) : [];
  if (!rawFills.length) errors.push('no fills');
  let usesViewer = false;
  for (const f of rawFills) {
    const slot = str(f.slot);
    const where = `${templateId}.${slot}`;
    const def = card.slots.find((x) => x.id === slot);
    const kind = str(f.kind);
    // Real boxes end without a full stop (94% of 2,568 winners); drop one rather than the meme.
    const text = str(f.text).replace(/(?<![.])\.$/, '');
    const reason = str(f.why);
    if (!reason) errors.push(`${where}: why is empty (say who or what plays the role and how it meets the MUST)`);
    why[slot] = reason;
    if (kind === 'entity') {
      const id = str(f.player_id);
      const p = bluePlayer(id);
      if (!p) errors.push(`${where}: player "${id}" is not a blue-chip player`);
      else if (!playerInStory(p, story.brief)) errors.push(`${where}: ${p.name} is not in this story`);
      fills.push({ slot, kind, playerId: id });
      continue;
    }
    if (kind !== 'text' && kind !== 'viewer') {
      errors.push(`${where}: kind "${kind}" is not entity, text or viewer`);
      continue;
    }
    if (!text) errors.push(`${where}: empty line`);
    if (!v2.spoken?.includes(slot) && MULTI_SENTENCE.test(text.replace(ABBREVIATIONS, ''))) errors.push(`${where}: two sentences in one box; real boxes hold one idea, as a label`);
    const cap = slotCap(card, slot);
    if (def?.pattern) {
      const words = (s: string) => ` ${s.toLowerCase().replace(/[?,.!"]/g, ' ').replace(/\s+/g, ' ').trim()} `;
      const fixedParts = def.pattern.split('{x}').map(words).filter((p) => p.trim());
      if (fixedParts.some((p) => words(text).includes(p))) errors.push(`${where}: write only the {x} part; code prints "${def.pattern}"`);
    }
    if (text.length > cap) errors.push(`${where}: ${text.length} characters (this card's lines are at most ${cap})`);
    if (BANNED_CHARS.test(text)) errors.push(`${where}: an em dash, double hyphen or emoji`);
    if (text.includes('!') && !v2.voice?.[slot]?.includes('exclamation')) errors.push(`${where}: no exclamation marks here`);
    for (const h of voiceHits(text)) if (h.kind !== 'exclamation' && h.kind !== 'emoji') errors.push(`${where}: banned ${h.kind} "${h.match}" (voice block)`);
    const hedge = HEDGE.exec(text);
    if (hedge) errors.push(`${where}: "${hedge[0]}" hedges; state it plainly, and show a claim by casting its company`);
    if (!v2.spoken?.includes(slot) && NARRATION.test(text)) errors.push(`${where}: narrates someone speaking; show the move itself`);
    for (const n of obscureNames(text, names)) errors.push(`${where}: "${n}" is a name a casual follower would not know; describe it in plain words`);
    if (kind === 'text') {
      const ids = Array.isArray(f.fact_ids) ? (f.fact_ids as unknown[]).map(str).filter(Boolean) : [];
      if (!ids.length) errors.push(`${where}: a text line needs the fact_ids it rests on`);
      for (const id of ids) if (!facts.has(id)) errors.push(`${where}: fact "${id}" is not in the brief`);
      fills.push({ slot, kind, text, factIds: ids });
    } else {
      usesViewer = true;
      if (!touchesViewer) errors.push(`${where}: a viewer line needs a turn that touches the viewer; ${turnId} does not`);
      const sid = str(f.situation_id) || situationId || '';
      if (!situation(sid)) errors.push(`${where}: viewer line needs an approved situation_id`);
      else if (!card.situations.includes(sid)) errors.push(`${where}: ${templateId} does not allow situation ${sid}`);
      if (situationId && sid !== situationId) errors.push(`${where}: viewer line uses ${sid}, the meme uses ${situationId}`);
      fills.push({ slot, kind, situationId: sid, text });
    }
  }
  if (usesViewer && !situationId) errors.push(`${templateId}: a meme with a viewer slot needs its situation_id`);
  // ME-93: a blue-chip company's claim is shown as its own, by casting it, or quoted and named.
  // Anyone else's claim (a person, the police, a recruiter) is left to the accuracy judge, which reads the [CLAIM] marks.
  const entities = fills.flatMap((f) => (f.kind === 'entity' ? [f.playerId] : []));
  const castable = playersInStory(story.brief);
  for (const f of fills) {
    if (f.kind !== 'text') continue;
    for (const id of f.factIds) {
      const by = claims.get(id);
      if (!by || !castable.some((p) => playerIsClaimer(p.id, by))) continue;
      const cast = entities.some((p) => playerIsClaimer(p, by));
      const quotedAndNamed = /["“”']/.test(f.text) && f.text.toLowerCase().includes(by.toLowerCase());
      if (!cast && !quotedAndNamed) errors.push(`${templateId}.${f.slot}: rests on ${by}'s claim (${id}); put ${by} on the image in an entity slot, or quote the line and name ${by}`);
    }
  }
  const fill: MemeFill = { templateId, fills };
  try {
    resolveMeme(fill);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const missing = writableSlots(card).filter((x) => !x.optional && !fills.some((f) => f.slot === x.id));
  for (const x of missing) if (!errors.some((e) => e.includes(`${templateId}.${x.id} is empty`))) errors.push(`${templateId}.${x.id} is empty`);
  if (errors.length) return { errors };
  return { mapping: { templateId, situationId, relation, fill, why, turnId, turnType: list!.turn.type, ...(golden && pattern ? { pattern } : {}) }, errors };
}

/** Keep the valid memes, drop the rest with their errors. */
export function checkSubmission(input: unknown, story: MemeStory, lists: readonly Shortlist[]): Pick<WriterOutput, 'mappings' | 'dropped'> {
  const sub = (input ?? {}) as Record<string, unknown>;
  const memes = Array.isArray(sub.memes) ? sub.memes : [];
  const mappings: Mapping[] = [];
  const dropped: WriterOutput['dropped'] = [];
  memes.forEach((raw, index) => {
    const r = checkMeme(raw, story, lists);
    if (r.mapping) mappings.push(r.mapping);
    else dropped.push({ index, templateId: str((raw as Record<string, unknown>)?.template_id), errors: r.errors });
  });
  return { mappings, dropped };
}

// ── The calls ───────────────────────────────────────────────────────────────

/** The conversation so far, kept so later calls reuse the cached prefix and the story already sent. */
export type WriterSession = {
  messages: Anthropic.MessageParam[];
  lastToolUseId: string | null;
  calls: number;
  lists: Shortlist[];
  story: MemeStory;
};

export type WriterResult =
  | { ok: true; output: WriterOutput; costUsd: number; session: WriterSession }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused' | 'spend-cap' | 'no-turns'; detail: string; costUsd: number; session: WriterSession; turns?: TurnCheck };

export type WriterDeps = {
  create: MessagesCreate;
  story: MemeStory;
  freeTemplates: string[];
  meter: CostMeter;
  note?: string;
  kind?: 'single' | 'landscape' | 'spread';
  /** How often each template appeared in recent lab slates (match.ts spreads them). */
  recent?: ReadonlyMap<string, number>;
  /** Spread and landscape turns must draw on several stories. */
  coverage?: Coverage;
  config?: { turns?: MemeModelConfig; memes?: MemeModelConfig };
};

const prefixChars = () => WRITER_SYSTEM.length + JSON.stringify(TOOLS).length;

/** The static prefix is cached for an hour once a live call has written it. */
let prefixCached = false;

/** Worst-case dollars for a whole writer conversation plus the judges, so a caller can hold it back (ME-62, ME-84). */
export function writerBudgetUsd(restChars: number): number {
  const turns = worstCaseCallUsd(MEME_MODELS.turns, { cachedPrefix: prefixChars(), rest: restChars }, prefixCached);
  const memes = worstCaseCallUsd(MEME_MODELS.writer, { cachedPrefix: prefixChars(), rest: restChars + 20_000 }, true);
  return turns + memes + JUDGE_RESERVE_USD;
}

type CallOk = { ok: true; submit: Anthropic.ToolUseBlock; costUsd: number };
type CallFail = Extract<WriterResult, { ok: false }>;

/** One call on the conversation, expecting one tool. */
async function call(deps: WriterDeps, session: WriterSession, config: MemeModelConfig, tool: string, costSoFar: number): Promise<CallOk | CallFail> {
  const fail = (reason: CallFail['reason'], detail: string, costUsd = costSoFar): CallFail => ({ ok: false, reason, detail, costUsd, session });
  try {
    deps.meter.ensure(worstCaseCallUsd(config, { cachedPrefix: prefixChars(), rest: JSON.stringify(session.messages).length }, prefixCached || session.calls > 0) + JUDGE_RESERVE_USD);
  } catch (err) {
    return fail('spend-cap', err instanceof Error ? err.message : String(err));
  }
  let res: Anthropic.Message;
  try {
    res = await deps.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: cachedSystemText(WRITER_SYSTEM),
      tools: TOOLS,
      messages: withConversationCache(session.messages),
      output_config: { effort: config.effort },
    } as Anthropic.MessageCreateParamsNonStreaming);
    prefixCached = true;
  } catch (err) {
    return fail('service-error', `Claude call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  session.calls++;
  const costUsd = costSoFar + Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: config.model }).costUsd);
  deps.meter.add(costUsd - costSoFar);
  if (res.stop_reason === 'refusal') return fail('refused', 'refusal', costUsd);
  if (res.stop_reason === 'max_tokens') return fail('malformed-output', 'output cut off at max_tokens', costUsd);
  session.messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
  const submit = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool);
  session.lastToolUseId = submit?.id ?? res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.id ?? null;
  if (!submit) return fail('malformed-output', `ended without calling ${tool}`, costUsd);
  return { ok: true, submit, costUsd };
}

/** Answer the last tool call (or say something plain when there was none). */
function reply(session: WriterSession, content: string, isError = false) {
  session.messages.push(
    session.lastToolUseId
      ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: session.lastToolUseId, content, ...(isError ? { is_error: true } : {}) }] }
      : { role: 'user', content },
  );
}

/**
 * The first pass: turns, then memes. A turn call with nothing usable gets
 * one retry asking for new turns (one of them the viewer's day); a memes call
 * whose every meme breaks gets the follow-up with the errors (ME-84).
 */
export async function writeMemes(deps: WriterDeps): Promise<WriterResult> {
  const session: WriterSession = { messages: [{ role: 'user', content: writerUser(deps.story, deps.note) }], lastToolUseId: null, calls: 0, lists: [], story: deps.story };
  const turnsCfg = deps.config?.turns ?? MEME_MODELS.turns;
  const memesCfg = deps.config?.memes ?? MEME_MODELS.writer;
  let r = await call(deps, session, turnsCfg, SUBMIT_TURNS.name, 0);
  if (!r.ok) return r;
  let check = checkTurns(r.submit.input, deps.story, deps.coverage);
  const weakTurn = check.kept.length === 0;
  if (check.kept.length < 2) {
    // Fewer than two ideas: one retry for more, so the slate can offer a choice (ME-61).
    const failed = check.all.filter((a) => a.errors.length);
    reply(session, [
      check.kept.length ? `Code kept ${check.kept.map((k) => k.id).join(', ')}.` : 'None of these turns passed the checks.',
      ...(failed.length ? ['These did not:', ...failed.map((a) => `- ${a.id}: ${a.errors.join('; ')}`)] : []),
      '',
      `Submit ${check.kept.length ? '2 to 4 more turns, of other types' : "3 to 5 new turns that follow every rule. Include one viewer's-day turn (how this news lands in the viewer's own day)"}. Use new ids. Call submit_turns.`,
    ].join('\n'), !check.kept.length);
    r = await call(deps, session, turnsCfg, SUBMIT_TURNS.name, r.costUsd);
    if (!r.ok) return r;
    const second = checkTurns(r.submit.input, deps.story, deps.coverage);
    const taken = new Set(check.all.map((a) => a.id));
    const renamed = (id: string) => (taken.has(id) ? `${id}b` : id);
    const fresh = second.kept.map((t) => ({ ...t, id: renamed(t.id) }));
    const kept = [...check.kept, ...fresh.filter((t) => !check.kept.some((k) => k.type === t.type)), ...fresh.filter((t) => check.kept.some((k) => k.type === t.type))].slice(0, 3);
    check = { kept, all: [...check.all, ...second.all.map((a) => ({ ...a, id: renamed(a.id) }))] };
    if (!check.kept.length) return { ok: false, reason: 'no-turns', detail: check.all.map((a) => `${a.id}: ${a.errors.join('; ')}`).join('\n') || 'no turns', costUsd: r.costUsd, session, turns: check };
  }
  const { lists, unmatched } = shortlists(check.kept, { free: new Set(deps.freeTemplates), kind: deps.kind ?? 'single', recent: deps.recent });
  if (!lists.length) return { ok: false, reason: 'no-turns', detail: 'no free template carries any kept turn', costUsd: r.costUsd, session, turns: check };
  session.lists = lists;
  reply(session, step2Message(lists, check, unmatched, (deps.kind ?? 'single') === 'single' ? deps.story.title : undefined));
  const m = await call(deps, session, memesCfg, SUBMIT_MEMES.name, r.costUsd);
  if (!m.ok) return { ...m, turns: check };
  const first = checkSubmission(m.submit.input, deps.story, lists);
  const output: WriterOutput = { turns: check, lists, unmatched: unmatched.map((t) => t.id), weakTurn, ...first };
  if (first.mappings.length) return { ok: true, output, costUsd: m.costUsd, session };
  const more = await writeMoreMemes({ ...deps, session, failed: first.dropped.map((d) => `${d.templateId}: ${d.errors.join('; ')}`) }, m.costUsd);
  if (!more.ok) return { ...more, turns: check };
  return { ok: true, output: { ...output, mappings: more.output.mappings, dropped: [...first.dropped, ...more.output.dropped] }, costUsd: more.costUsd, session };
}

/**
 * The follow-up, only when fewer than two memes survived (ME-95): the same
 * conversation, so the story and the cards are not paid for again at full
 * price; what failed and why; MORE_DRAFTS new drafts for the same turns.
 */
export async function writeMoreMemes(deps: WriterDeps & { session: WriterSession; failed: string[] }, costSoFar = 0): Promise<WriterResult> {
  const { session } = deps;
  reply(session, [
    'These memes did not make it:',
    ...deps.failed.map((f) => `- ${f}`),
    '',
    `Write ${MORE_DRAFTS} new memes for the kept turns: other templates from their short lists, or a different mapping. Same rules. Call ${SUBMIT_MEMES.name} with only the new memes.`,
  ].join('\n'));
  const cfg = { ...(deps.config?.memes ?? MEME_MODELS.writer), maxTokens: MORE_MAX_TOKENS };
  const r = await call(deps, session, cfg, SUBMIT_MEMES.name, costSoFar);
  if (!r.ok) return r;
  const out = checkSubmission(r.submit.input, session.story, session.lists);
  if (!out.mappings.length) return { ok: false, reason: 'malformed-output', detail: out.dropped.map((d) => `${d.templateId}: ${d.errors.join('; ')}`).join('\n') || 'no memes', costUsd: r.costUsd, session };
  return { ok: true, output: { turns: { kept: session.lists.map((l) => l.turn), all: [] }, lists: session.lists, unmatched: [], weakTurn: false, ...out }, costUsd: r.costUsd, session };
}
