import type Anthropic from '@anthropic-ai/sdk';
import { noul } from '@typesafe-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { structuredJson, type StructuredParams } from '@/lib/explainers/ideas/generator';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import { frameBlocks, parseScript, parseShots } from '../../../explainers/lint/lint-storyboard.mjs';

/**
 * The understanding test (Explainers 4.2; design: .explainers-local/4.2-plan/research/UNDERSTANDING.md,
 * contract: CONTRACT-4.2 § Answer key and the understanding test). Does the script, as a viewer meets
 * it, teach the term correctly, as one story?
 *
 *   1. The director writes the answer key (ANSWER_KEY_FILE) at the end of the plan, before any test.
 *   2. Code builds what a viewer meets (reelTestMarkdown): per beat, what is on screen, the voice, the
 *      words on screen. Nothing else can leak in.
 *   3. Two readers (READER_INSTRUCTIONS, reader_model) read it in parallel: a newcomer who meets an
 *      invented word in place of the term everywhere, so it can only know what the reel taught, and a
 *      technically curious reader with the real term. Every answer cites its beats and quotes.
 *   4. Jev answers a yes/no checklist built from the answer key, per reader (UNDERSTANDING_CHECKLIST).
 *      Serious or minor by the failure table; a finding is serious only with a quoted line from the
 *      reel test behind it (the evidence rule); either reader can raise one.
 *   5. Only when something is serious: one diagnosis call names the first beat that went wrong and
 *      the cause; the findings go to FINDINGS_FILE and the director's one fix session (FIX_PROMPT).
 *   6. One re-test of the whole reel; the version with fewer serious findings goes ahead (a tie keeps
 *      the fix). What remains becomes warnings on the reel.
 *
 * Severity never means stop (Lucas, 2026-10-27: "I want it to fail open and then carry the warning or
 * signal with it"). Every model call here is a direct Messages API call with the stable instructions
 * cached (CLAUDE.md), stubbed in tests through UnderstandingModel.
 */

// ── Files and prompts the worker and the director share ───────────────────────────────────

/** Written by the director at the end of PHASE: plan (and updated by PHASE: fix when a fix needs it). */
export const ANSWER_KEY_FILE = '.hyperframes/answer-key.json';
/** The whole reel as the curious reader meets it (real term). */
export const REEL_TEST_FILE = '.hyperframes/reel-test.md';
/** The whole reel as the newcomer meets it (the term replaced by an invented word everywhere). */
export const REEL_TEST_NEWCOMER_FILE = '.hyperframes/reel-test-newcomer.md';
/** What the worker hands the fix session (CONTRACT-4.2 schema). */
export const FINDINGS_FILE = '.hyperframes/understanding-findings.json';

export const FIX_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: fix. .hyperframes/understanding-findings.json lists what a first-time viewer misunderstood. Fix it, then stop.';

/** The director's fix pass when the analogy failed its checks (`analogy:no_pass`): the same PHASE: fix, on mapping findings. */
export const ANALOGY_FIX_PROMPT =
  "Use the helios-explainer-director skill to run this reel. PHASE: fix. .hyperframes/understanding-findings.json lists where the analogy's mapping failed the analogy checks. Fix it, then stop.";

// ── The answer key ─────────────────────────────────────────────────────────────────────────

export type AnswerKey = {
  term_is: string;
  story_part: string;
  mechanism_steps: { step: string; core: boolean }[];
  mapping: { story: string; real: string }[];
  /** Optional in 4.3: the reel needs no "where it breaks" beat; wrong beliefs are caught here. */
  boundary: string | null;
  false_beliefs_to_avoid: string[];
  example_answer: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * The answer key as the director wrote it, normalised, or null when there is none or it is not an
 * object with at least `term_is`. Missing parts are empty, so a partial key still judges what it has.
 */
export function parseAnswerKey(raw: unknown): AnswerKey | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const k = raw as Record<string, unknown>;
  const termIs = str(k.term_is);
  if (!termIs) return null;
  const steps = Array.isArray(k.mechanism_steps)
    ? k.mechanism_steps
        .map((s) => (typeof s === 'string' ? { step: s.trim(), core: true } : { step: str((s as { step?: unknown })?.step), core: (s as { core?: unknown })?.core !== false }))
        .filter((s) => s.step)
    : [];
  const mapping = Array.isArray(k.mapping)
    ? k.mapping.map((r) => ({ story: str((r as { story?: unknown })?.story), real: str((r as { real?: unknown })?.real) })).filter((r) => r.story && r.real)
    : [];
  return {
    term_is: termIs,
    story_part: str(k.story_part),
    mechanism_steps: steps,
    mapping,
    boundary: str(k.boundary) || null,
    false_beliefs_to_avoid: strList(k.false_beliefs_to_avoid),
    example_answer: str(k.example_answer),
  };
}

// ── Step 2: what the reader meets, built by code ──────────────────────────────────────────

/** The spoken words of SCRIPT.md's line for frame `n` (the four-space block under its heading), or null. */
export function scriptLine(script: string, n: number): string | null {
  const lines = script.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+Line\\s+\\d+.*\\(Frame\\s+${n}\\)\\s*$`, 'i').test(l));
  if (start < 0) return null;
  const words: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (/^ {4}\S/.test(line)) words.push(line.trim());
  }
  return words.join(' ').trim() || null;
}

/** A `- key: value` field of a frame block, unquoted, or null. */
function blockField(block: string, key: string): string | null {
  const m = new RegExp(`^\\s*-\\s*${key}:[ \\t]*(.+?)\\s*$`, 'im').exec(block);
  return m ? m[1].replace(/^["“]|["”]$/g, '').trim() || null : null;
}

/** The storyboard front matter's `term:`, or null. */
export function storyboardTerm(storyboard: string): string | null {
  const front = /^---\n([\s\S]*?)\n---/.exec(storyboard)?.[1] ?? '';
  const m = /^term:\s*(.+?)\s*$/m.exec(front);
  return m ? m[1].replace(/^["']|["']$/g, '').trim() || null : null;
}

/**
 * A scene line as a viewer sees it (UNDERSTANDING.md Step 2): what is drawn, never what it means.
 * Parenthesised asides and anything after an "=" are what the director meant, not what a viewer
 * sees: they are cut, and `leaked` says so (the job records it as a warning).
 */
export function viewerSceneLine(scene: string): { text: string; leaked: boolean } {
  let text = scene;
  let leaked = false;
  if (/[()]/.test(text)) {
    text = text.replace(/\s*\([^)]*\)/g, '').replace(/[()]/g, '');
    leaked = true;
  }
  if (text.includes('=')) {
    text = text.split('=')[0];
    leaked = true;
  }
  return { text: text.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim(), leaked };
}

/** One entity of the anchor scene: its id, what it is (as a viewer would see it), what it stands for. */
export type AnchorEntity = { id: string; what: string; standsFor: string };

/**
 * The anchor scene's entities (`<id> — <what it is> — stands for <real part> — <how it is built> —
 * beats …`, CONTRACT-4.2 § Storyboard), for turning ids into what a viewer sees.
 */
export function anchorEntities(storyboard: string): AnchorEntity[] {
  const m = /^##\s+Anchor scene\s*$/im.exec(storyboard);
  if (!m) return [];
  const rest = storyboard.slice(m.index + m[0].length);
  const body = rest.slice(0, /^##\s+/m.exec(rest)?.index ?? rest.length);
  const out: AnchorEntity[] = [];
  for (const line of body.split('\n')) {
    if (!/^\s+-\s+\S/.test(line) || !/stands for/i.test(line)) continue;
    const parts = line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/).map((x) => x.trim());
    // id first, then what it is, then "stands for …": a line that breaks that order is no entity
    const at = parts.findIndex((x) => /^stands for\b/i.test(x));
    if (at < 2 || /^stands for\b/i.test(parts[0]) || /^stands for\b/i.test(parts[1])) continue;
    out.push({ id: parts[0], what: parts[1], standsFor: parts[at].replace(/^stands for\s*/i, '') });
  }
  return out;
}

const ARTICLE_RE = /^(?:the|a|an|its|your|their|our|his|her)\s+/i;
const bare = (v: string) => v.toLowerCase().replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(ARTICLE_RE, '');
/** An id written as code, not words (`mailbox_flag`, `cacheBox`, `step-2`): never shown to a viewer. */
const ID_TOKEN_RE = /\b[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+\b|\b[a-z]+[A-Z][\p{L}\p{N}]*\b/gu;

/**
 * A shot subject or scene text in viewer-facing nouns (reader leak, review round 2): a subject that is
 * an entity's id, or names what an entity stands for, becomes what that entity is; an id written as
 * code inside a phrase becomes its entity's "what it is", or plain words.
 */
export function viewerNouns(text: string, entities: readonly AnchorEntity[], { whole = false }: { whole?: boolean } = {}): string {
  if (whole) {
    const b = bare(text);
    const hit = entities.find((e) => bare(e.id) === b || (e.standsFor && bare(e.standsFor) === b));
    if (hit) return hit.what;
  }
  return text.replace(ID_TOKEN_RE, (token: string, offset: number, all: string) => {
    const hit = entities.find((e) => e.id.toLowerCase() === token.toLowerCase());
    // keep the entity's own article unless the phrase already has one
    if (hit) return /\b(?:the|a|an|its|your|their|our|his|her)\s+$/i.test(all.slice(0, offset)) ? hit.what.replace(ARTICLE_RE, '') : hit.what;
    // camelCase that is not an entity's id is left alone (a product name); separators become spaces
    return /[-_]/.test(token) ? token.replace(/[-_]+/g, ' ') : token;
  });
}

/** Invented words for the newcomer's term (UNDERSTANDING.md Step 3); each starts with a consonant. */
export const STAND_IN_WORDS = ['velk', 'dorrin', 'plimsy', 'quarn', 'tessik', 'brovel', 'mundle', 'skeff'] as const;

/** The first invented word that appears nowhere in `text` (so it can only mean the term). */
export function standInWord(text: string): string {
  const lower = text.toLowerCase();
  return STAND_IN_WORDS.find((w) => !new RegExp(`\\b${w}`).test(lower)) ?? `${STAND_IN_WORDS[0]}${STAND_IN_WORDS.length}`;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every mention of `term` (any case, plural, possessive) replaced by `standIn`, keeping
 * the case of the first letter and turning "an <term>" into "a <stand-in>". A paired term ("X vs Y")
 * is replaced whole and side by side.
 */
export function replaceTerm(text: string, term: string, standIn: string): string {
  const t = term.trim();
  if (!t) return text;
  const sides = t.split(/\s+(?:vs\.?|versus|and)\s+|\s*\/\s*/i).map((x) => x.trim()).filter(Boolean);
  const terms = [...new Set([t, ...(sides.length > 1 ? sides : [])])].sort((a, b) => b.length - a.length);
  let out = text;
  terms.forEach((one, i) => {
    const word = sides.length > 1 && one !== t ? `${standIn}-${i}` : standIn;
    const re = new RegExp(`\\b(an?\\s+)?(${escapeRe(one).replace(/\\? /g, '[\\s-]+')})(es|s)?\\b`, 'gi');
    out = out.replace(re, (_m, article: string | undefined, found: string, plural: string | undefined) => {
      const cased = /^[A-Z]/.test(found) && !(article && /^[a-z]/.test(article)) ? word[0].toUpperCase() + word.slice(1) : word;
      const art = article ? `${/^A/.test(article) ? 'A' : 'a'} ` : '';
      return `${art}${cased}${plural ? 's' : ''}`;
    });
  });
  return out;
}

export type ReelTest = {
  /** The file a reader meets. */
  text: string;
  /** Frames whose scene line carried meaning (parentheses or "="), cut before the reader saw them. */
  leakedScenes: number[];
};

/**
 * The whole reel as a viewer meets it (UNDERSTANDING.md Step 2), built from STORYBOARD.md and SCRIPT.md:
 * per beat, the `scene:` line (what a viewer sees), each shot's subject in plain nouns (an entity id
 * becomes what the entity is, from the anchor scene), the voice (SCRIPT.md's line,
 * else the storyboard's `voiceover:`) and the words on screen (4.3: the opener's wordmark, frame 3's
 * hand-off card, the dictionary card on the frame with `definition:`); frame 8 ends on the logo.
 * Never the shots' `why`, a cast list, the anchor scene's "stands for" or the mapping. With
 * `standIn`, the term is that word everywhere.
 */
export function reelTestMarkdown(input: { storyboard: string; script: string; term: string; standIn?: string | null }): ReelTest {
  const blocks = frameBlocks(input.storyboard) as Map<number, string>;
  const spoken = parseScript(input.script) as Map<number, string>;
  const entities = anchorEntities(input.storyboard);
  const term = input.term.trim();
  const say = (text: string) => (input.standIn ? replaceTerm(text, term, input.standIn) : text);
  const shown = input.standIn ? replaceTerm(term, term, input.standIn) : term;
  const leakedScenes: number[] = [];
  const out = ['# The video, as a viewer meets it', ''];
  for (let n = 1; n <= 8; n += 1) {
    out.push(`## Beat ${n}`, '');
    if (n === 8) {
      out.push('The video ends on the Helios logo.', '');
      continue;
    }
    const block = blocks.get(n) ?? '';
    const scene = blockField(block, 'scene');
    if (scene) {
      const seen = viewerSceneLine(scene);
      if (seen.leaked) leakedScenes.push(n);
      if (seen.text) out.push(`On screen: ${say(viewerNouns(seen.text, entities))}`);
    }
    const shotsLine = /^-[ \t]*shots:[ \t]*(.*)$/im.exec(block);
    if (shotsLine) {
      // the line itself, then its sub-bullets up to the next top-level line
      const list: string[] = [shotsLine[1]];
      for (const l of block.slice(shotsLine.index + shotsLine[0].length).split('\n').slice(1)) {
        if (/^\s+-\s+\S/.test(l)) list.push(l.replace(/^\s+-\s+/, ''));
        else if (l.trim()) break;
      }
      const subjects = (parseShots(list.join('\n')) as { subject: string }[]).map((s) => viewerNouns(viewerSceneLine(s.subject).text, entities, { whole: true })).filter(Boolean);
      if (subjects.length) out.push(`Shots: ${subjects.map(say).join('; ')}`);
    }
    if (n === 1) out.push('Words on screen: "AI BRAIN BREAK".');
    if (n === 3) out.push(`Words on screen: a card that reads "today's AI Brain Break: ${shown}".`);
    const definition = blockField(block, 'definition');
    if (definition) {
      const pos = blockField(block, 'part_of_speech');
      out.push(`Words on screen: a dictionary card: "${shown}"${pos ? ` (${pos})` : ''}: ${say(definition)}`);
    }
    const voice = spoken.get(n) ?? blockField(block, 'voiceover');
    out.push(voice ? `Voice: ${say(voice)}` : 'Voice: (none)');
    out.push('');
  }
  return { text: out.join('\n'), leakedScenes };
}

// ── Step 3: the readers ─────────────────────────────────────────────────────────────────────

export type ReaderPersona = 'newcomer' | 'curious';
export const READER_PERSONAS: readonly ReaderPersona[] = ['newcomer', 'curious'];

/**
 * The audience each reader writes for (UNDERSTANDING.md Step 3). Goes in the user message, after the
 * cached prefix. A reading level, never a person to play (live runs 42–43: persona and first-person
 * viewer framing were stopped by the safety classifier on every model).
 */
export const PERSONA_LINES: Record<ReaderPersona, string> = {
  newcomer: 'Write the answers in plain words, at the level of a general audience with no technical background.',
  curious:
    'Write the answers at the level of a technically informed reader. When something the video says seems wrong, or contradicts something it said earlier, note it for that beat, with the quote.',
};

/**
 * The reader's opening lines: a plain comprehension task. The newcomer's copy names the topic by a
 * placeholder word, and the lead says so openly. `plain` is the retry after a refusal: no audience line.
 */
export function readerLead(request: Pick<ReaderRequest, 'persona' | 'term' | 'plain'>): string {
  const termLine =
    request.persona === 'newcomer'
      ? `In this copy of the script the topic's name is replaced by the placeholder word "${request.term}", so the answers show what the video itself conveys; wherever the questions say [TERM], it means that word.`
      : `The video's topic is "${request.term}"; wherever the questions say [TERM], it means that.`;
  return [...(request.plain ? ['Answer only from what the video says.'] : [PERSONA_LINES[request.persona]]), termLine].join('\n');
}

/**
 * The readers' shared instructions: a comprehension check of the reel's script (per-beat notes and
 * eleven questions, UNDERSTANDING.md Step 3; [TERM] is named in the user message). Third person
 * about the video, never a role to play. The cached prefix both readers share.
 */
export const READER_INSTRUCTIONS = [
  'Task: a comprehension check of a short educational video, done from its script. The file lists the video beat by beat: what is on screen and what the voice says, in order (the voice is heard, not read). Read it once, in order, then summarize what the video teaches and answer the questions below using only what the video gives. Where an answer needs knowledge the video does not give, write "not from the video". For every answer, give the beat number(s) it came from and quote the words it rests on. Report anything unclear plainly: an unclear passage is a useful finding.',
  '',
  'Per beat notes, in the field named in brackets:',
  '- What is on screen and what is said. [see_and_hear]',
  '- What the video seems to be explaining so far. [think_it_explains]',
  '- What this beat teaches. [learned]',
  '- What the next beat is likely to cover. [expect_next]',
  '- Anything hard to follow by ear, or too fast, quoted. [could_not_follow: each with the quote and why]',
  '',
  'After the last beat, the questions, in the field named in brackets:',
  '1. What it is [what_it_is]: "In one sentence, what is a [TERM], according to the video? Say what kind of thing it is."',
  '2. Which one [which_one]: "In the story part of the video, which thing stands for the [TERM]? Name one thing only."',
  '3. Two stories [two_stories]: "Does the video ever seem to use \'[TERM]\' for two different things? If so, quote both places." (two: true or false)',
  '4. How it works [how_it_works]: "Summarize, step by step in plain words, how the video says it works."',
  '5. The map [the_map]: "For each thing in the story, what does it stand for in the real world?" (rows: story, real)',
  '6. New case [new_case]: "Give one new example of a [TERM] from everyday life or work, not one from the video, and say why it counts."',
  '7. What the comparison implies [what_youd_assume]: "From the comparison alone, what two things would a viewer expect to be true about a [TERM]?" (beliefs: the two things)',
  '8. Where it stops [where_it_stops]: "Where does the comparison stop working, if the video says so?"',
  '9. The example [the_example]: "What answer does the real example reach? Could a reasonable person reach a different one? Which?" (other_answer: the different answer, or empty)',
  '10. What it means in real terms [the_takeaway]: "What does the video say this means for the viewer, in real terms?"',
  '11. Where it gets unclear [where_lost]: "Where does the video first become unclear or hard to follow? Give the beat number, or \'nowhere\'." (lost_beat: the beat, or 0 for nowhere)',
  '',
  'Each answer is marked `sure` when the video states it or `guessing` when it is inferred [sure], gives its beats [beats] and the exact words it rests on [quotes], and says where it came from [source: "video" or "not from the video"].',
  'Reply with one JSON object only, no other text, shaped like this (every probe has answer, beats, quotes, sure, source, plus its own extra field when it has one):',
  '{"beats": [{"beat": 1, "see_and_hear": "", "think_it_explains": "", "learned": "", "expect_next": "", "could_not_follow": [{"quote": "", "why": ""}]}], "probes": {"what_it_is": {"answer": "", "beats": [3], "quotes": [""], "sure": "sure", "source": "video"}, "which_one": {…}, "two_stories": {…, "two": false}, "how_it_works": {…}, "the_map": {…, "rows": [{"story": "", "real": ""}]}, "new_case": {…}, "what_youd_assume": {…, "beliefs": [""]}, "where_it_stops": {…}, "the_example": {…, "other_answer": ""}, "the_takeaway": {…}, "where_lost": {…, "lost_beat": 0}}}',
].join('\n');

const PROBE_KEYS = ['what_it_is', 'which_one', 'two_stories', 'how_it_works', 'the_map', 'new_case', 'what_youd_assume', 'where_it_stops', 'the_example', 'the_takeaway', 'where_lost'] as const;
export type ProbeKey = (typeof PROBE_KEYS)[number];

export type ProbeAnswer = {
  answer: string;
  beats: number[];
  quotes: string[];
  sure: 'sure' | 'guessing';
  source: 'video' | 'not from the video';
  two?: boolean;
  rows?: { story: string; real: string }[];
  beliefs?: string[];
  other_answer?: string;
  lost_beat?: number;
};
export type ReaderBeat = {
  beat: number;
  see_and_hear: string;
  think_it_explains: string;
  learned: string;
  expect_next: string;
  could_not_follow: { quote: string; why: string }[];
};
export type ReaderAnswers = { beats: ReaderBeat[]; probes: Record<ProbeKey, ProbeAnswer> };

const PROBE_BASE = {
  answer: { type: 'string' },
  beats: { type: 'array', items: { type: 'integer' } },
  quotes: { type: 'array', items: { type: 'string' } },
  sure: { type: 'string', enum: ['sure', 'guessing'] },
  source: { type: 'string', enum: ['video', 'not from the video'] },
} as const;
const PROBE_EXTRA: Partial<Record<ProbeKey, Record<string, unknown>>> = {
  two_stories: { two: { type: 'boolean' } },
  the_map: { rows: { type: 'array', items: { type: 'object', properties: { story: { type: 'string' }, real: { type: 'string' } }, required: ['story', 'real'], additionalProperties: false } } },
  what_youd_assume: { beliefs: { type: 'array', items: { type: 'string' } } },
  the_example: { other_answer: { type: 'string' } },
  the_takeaway: {},
  where_lost: { lost_beat: { type: 'integer' } },
};
const probeSchema = (key: ProbeKey) => {
  const properties = { ...PROBE_BASE, ...(PROBE_EXTRA[key] ?? {}) };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
};

export const READER_SCHEMA = {
  type: 'object',
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beat: { type: 'integer' },
          see_and_hear: { type: 'string' },
          think_it_explains: { type: 'string' },
          learned: { type: 'string' },
          expect_next: { type: 'string' },
          could_not_follow: {
            type: 'array',
            items: { type: 'object', properties: { quote: { type: 'string' }, why: { type: 'string' } }, required: ['quote', 'why'], additionalProperties: false },
          },
        },
        required: ['beat', 'see_and_hear', 'think_it_explains', 'learned', 'expect_next', 'could_not_follow'],
        additionalProperties: false,
      },
    },
    probes: {
      type: 'object',
      properties: Object.fromEntries(PROBE_KEYS.map((k) => [k, probeSchema(k)])),
      required: [...PROBE_KEYS],
      additionalProperties: false,
    },
  },
  required: ['beats', 'probes'],
  additionalProperties: false,
} as const;

const ints = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n)) : []);

/** A reader's reply, normalised: anything missing is empty, so a thin reply judges as thin. */
export function parseReaderAnswers(input: unknown): ReaderAnswers {
  const raw = (input ?? {}) as { beats?: unknown; probes?: Record<string, unknown> };
  if (!raw || typeof raw !== 'object' || !raw.probes || typeof raw.probes !== 'object') throw new Error('reader: the reply has no probes');
  const beats: ReaderBeat[] = (Array.isArray(raw.beats) ? raw.beats : []).map((b) => {
    const x = (b ?? {}) as Record<string, unknown>;
    return {
      beat: Number(x.beat) || 0,
      see_and_hear: str(x.see_and_hear),
      think_it_explains: str(x.think_it_explains),
      learned: str(x.learned),
      expect_next: str(x.expect_next),
      could_not_follow: (Array.isArray(x.could_not_follow) ? x.could_not_follow : [])
        .map((c) => (typeof c === 'string' ? { quote: c.trim(), why: '' } : { quote: str((c as { quote?: unknown })?.quote), why: str((c as { why?: unknown })?.why) }))
        .filter((c) => c.quote || c.why),
    };
  });
  const probes = {} as Record<ProbeKey, ProbeAnswer>;
  for (const key of PROBE_KEYS) {
    const p = (raw.probes[key] ?? {}) as Record<string, unknown>;
    const answer: ProbeAnswer = {
      answer: str(p.answer),
      beats: ints(p.beats),
      quotes: strList(p.quotes),
      sure: p.sure === 'guessing' ? 'guessing' : 'sure',
      source: /not from the video/i.test(String(p.source ?? '')) || /not from the video/i.test(str(p.answer)) ? 'not from the video' : 'video',
    };
    if (key === 'two_stories') answer.two = p.two === true;
    if (key === 'the_map') answer.rows = (Array.isArray(p.rows) ? p.rows : []).map((r) => ({ story: str((r as { story?: unknown })?.story), real: str((r as { real?: unknown })?.real) })).filter((r) => r.story || r.real);
    if (key === 'what_youd_assume') answer.beliefs = strList(p.beliefs);
    if (key === 'the_example') answer.other_answer = str(p.other_answer);
    if (key === 'where_lost') answer.lost_beat = Number.isInteger(Number(p.lost_beat)) ? Number(p.lost_beat) : 0;
    probes[key] = answer;
  }
  return { beats, probes };
}

// ── Diagnosis (only when something is serious) ───────────────────────────────────────────

export const CAUSES = ['definition', 'mapping', 'missing_beat', 'wording', 'order', 'boundary'] as const;
export type Cause = (typeof CAUSES)[number];

export const DIAGNOSER_INSTRUCTIONS = [
  "You diagnose why first-time viewers misunderstood a short explainer video. You get the video as a viewer meets it, beat by beat; the author's answer key (what the video meant to teach); two viewers' beat-by-beat notes; and the serious findings, each with the viewer's words and the line of the video quoted as evidence.",
  'For each finding, name two things:',
  "(a) the first beat where the viewer's understanding diverged from the answer key. That is often earlier than the beat where the error surfaced: read the beat notes in order and find where the wrong idea first appears.",
  '(b) the root cause, exactly one of:',
  "- definition: beat 2's or beat 5's wording of what the term is;",
  '- mapping: the analogy\'s lines call a part inconsistently;',
  '- missing_beat: a step never shown or said;',
  '- wording: jargon, ear-ambiguity, a pronoun with no clear referent;',
  '- order: a thing used before it is introduced;',
  "- boundary: the analogy's limit is unstated, so a false belief forms.",
  'Add one sentence of why, citing the evidence. Never write a fix or a rewrite.',
  'Reply with JSON only, matching the response schema: one diagnosis per finding, by its number.',
].join('\n');

export const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    diagnoses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'integer' },
          beat: { type: 'integer' },
          cause: { type: 'string', enum: [...CAUSES] },
          why: { type: 'string' },
        },
        required: ['finding', 'beat', 'cause', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['diagnoses'],
  additionalProperties: false,
} as const;

export type Diagnosis = { finding: number; beat: number; cause: Cause; why: string };

export function parseDiagnosis(input: unknown): Diagnosis[] {
  const list = (input as { diagnoses?: unknown })?.diagnoses;
  if (!Array.isArray(list)) throw new Error('diagnoser: the reply has no diagnoses');
  return list
    .map((d) => {
      const x = (d ?? {}) as Record<string, unknown>;
      const cause = (CAUSES as readonly string[]).includes(String(x.cause)) ? (x.cause as Cause) : null;
      return cause ? { finding: Number(x.finding), beat: Number(x.beat), cause, why: str(x.why) } : null;
    })
    .filter((d): d is Diagnosis => d !== null && Number.isInteger(d.finding) && Number.isInteger(d.beat));
}

// ── The model calls (stubbed in tests) ───────────────────────────────────────────────────

export type ReaderRequest = {
  model: string;
  persona: ReaderPersona;
  term: string;
  reelTest: string;
  /** The file the reader reads from disk on the agent path (REEL_TEST_FILE or REEL_TEST_NEWCOMER_FILE). */
  file?: string;
  /** The retry after a refusal: the plainest wording (readerLead). */
  plain?: boolean;
};
export type DiagnoseRequest = {
  model: string;
  /** The reel as the curious reader met it (the real term). */
  reelTest: string;
  key: AnswerKey | null;
  readers: Partial<Record<ReaderPersona, ReaderAnswers>>;
  serious: SeriousFinding[];
  /** The invented word the newcomer met in place of the term, so its notes read right. */
  standIn?: string | null;
  term?: string;
};
/** A reply's usage; `usd` set means the call was already priced and metered (the agent path). */
export type ModelReply<T> = { value: T; usage: MessageUsageLike['usage']; model: string; usd?: number };

/** True when an error is the model declining (a refusal), the one failure worth a plainer retry. */
export function isRefusal(error: unknown): boolean {
  return /declined|refus/i.test(error instanceof Error ? error.message : String(error));
}

export interface UnderstandingModel {
  read(request: ReaderRequest): Promise<ModelReply<ReaderAnswers>>;
  diagnose(request: DiagnoseRequest): Promise<ModelReply<Diagnosis[]>>;
}

/** Sonnet thinks by default and thinking counts toward max_tokens: room for a full beat log and eleven probes. */
const MAX_TOKENS = 16000;

/**
 * One reader: the shared instructions are the cached prefix; who they are, [TERM] and the file follow it.
 * Plain JSON in text, parsed leniently (live run 42: the API refused READER_SCHEMA as structured output,
 * "the compiled grammar is too large"); READER_SCHEMA stays as the shape's documentation.
 */
export function readerParams(request: ReaderRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(READER_INSTRUCTIONS),
    messages: [
      {
        role: 'user',
        content: [readerLead(request), '', 'Here is the file:', '', request.reelTest].join('\n'),
      },
    ],
  };
}

/** The first JSON object in a string (code fences and prose around it are ignored). */
export function jsonInText(text: string, label: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(/\b(can't|cannot|won't|unable to|not able to)\b/i.test(text) ? `${label}: the model declined the request` : `${label}: the reply had no JSON`);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`${label}: the reply was not valid JSON`);
  }
}

/**
 * The readers and the diagnosis as Agent SDK sessions (live runs 42: direct calls were refused; the
 * first-viewer subagent never was). Each runs with the main thread as the `reader` or `diagnoser`
 * agent (agent.ts: its instructions, reader_model, Read only), reads its file from disk, and replies in
 * text JSON. `run` is the job's session runner; its spend is already metered and recorded.
 */
export function agentUnderstandingModel(
  run: (input: { prompt: string; agent: 'reader' | 'diagnoser'; model: string }) => Promise<{ lastText: string; totalCostUsd: number; isError: boolean; errors: string[]; capped: boolean }>,
  writeFile: (rel: string, text: string) => void,
): UnderstandingModel {
  const usage = { input_tokens: 0, output_tokens: 0 };
  return {
    async read(request) {
      const file = request.file ?? (request.persona === 'newcomer' ? REEL_TEST_NEWCOMER_FILE : REEL_TEST_FILE);
      const r = await run({ agent: 'reader', model: request.model, prompt: [readerLead(request), '', `Read ${file} and answer.`].join('\n') });
      if (r.capped) throw new Error(`${request.persona} reader: the spend cap was reached`);
      if (!r.lastText.trim()) throw new Error(`${request.persona} reader: no reply${r.errors.length ? ` (${r.errors.join('; ')})` : ''}`);
      return { value: parseReaderAnswers(jsonInText(r.lastText, `${request.persona} reader`)), usage, model: request.model, usd: r.totalCostUsd };
    },
    async diagnose(request) {
      const file = '.hyperframes/diagnosis-input.md';
      writeFile(file, String(diagnoserParams(request).messages[0].content));
      const r = await run({ agent: 'diagnoser', model: request.model, prompt: `Read ${file} and answer.` });
      if (!r.lastText.trim()) throw new Error(`diagnoser: no reply${r.errors.length ? ` (${r.errors.join('; ')})` : ''}`);
      return { value: parseDiagnosis(jsonInText(r.lastText, 'diagnoser')), usage, model: request.model, usd: r.totalCostUsd };
    },
  };
}

/** The first JSON object in a text reply (code fences and prose around it are ignored). */
export function textJson(message: Pick<Anthropic.Message, 'content' | 'stop_reason'>, label: string): unknown {
  if (message.stop_reason === 'refusal') throw new Error(`${label}: the model declined the request`);
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`${label}: the reply had no JSON`);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`${label}: the reply was not valid JSON`);
  }
}

/** The diagnosis: the instructions are the cached prefix; the reel, the key, the notes and the findings follow. */
export function diagnoserParams(request: DiagnoseRequest): StructuredParams {
  const notes = Object.entries(request.readers).map(([who, a]) => `### The ${who} reader's beat notes\n${JSON.stringify(a?.beats ?? [], null, 1)}`);
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(DIAGNOSER_INSTRUCTIONS),
    messages: [
      {
        role: 'user',
        content: [
          '## The video, as a viewer meets it',
          request.reelTest,
          '## The answer key',
          request.key ? JSON.stringify(request.key, null, 1) : '(none)',
          '## The viewers',
          ...(request.standIn ? [`The newcomer met the invented word "${request.standIn}" everywhere in place of the term${request.term ? ` "${request.term}"` : ''}.`] : []),
          ...notes,
          '## The serious findings',
          ...request.serious.map((f, i) => `${i + 1}. ${f.type} (${f.reader} reader, beat ${f.beat ?? '?'}): the viewer said "${f.reader_quote}"; the video said "${f.script_quote}". ${f.why}`),
        ].join('\n\n'),
      },
    ],
    output_config: { format: { type: 'json_schema', schema: DIAGNOSIS_SCHEMA as unknown as Record<string, unknown> } },
  };
}

export function anthropicUnderstandingModel(client: Anthropic): UnderstandingModel {
  return {
    async read(request) {
      const message = await client.messages.create(readerParams(request));
      return { value: parseReaderAnswers(textJson(message, `${request.persona} reader`)), usage: message.usage, model: message.model };
    },
    async diagnose(request) {
      const message = await client.messages.create(diagnoserParams(request));
      return { value: parseDiagnosis(structuredJson(message, 'diagnoser')), usage: message.usage, model: message.model };
    },
  };
}

/** A direct call's price, 1-hour cache writes (cachedSystemText's default). */
export function understandingUsd(reply: Pick<ModelReply<unknown>, 'usage' | 'model'>): number {
  return Number(priceAnthropicUsage(usageBucketsFromMessage({ usage: reply.usage }, '1h'), { modelId: reply.model }).costUsd);
}

// ── Step 4: Jev's checklist ─────────────────────────────────────────────────────────────────

/**
 * Small yes/no questions built from the answer key, asked per reader (UNDERSTANDING.md Step 4).
 * The wording waits for the register (planning/Explainer Reels/DECISIONS.md, "Understanding test
 * v2"; NOTES-E.md has it): tests/explainers-questions.test.ts compares them once it is there.
 */
export const UNDERSTANDING_CHECKLIST = defineQuestionSet({
  id: 'explainers-understanding',
  version: 'explainers-understanding-v2',
  questions: {
    same_kind: noul({
      question: 'Does the viewer say the term is the same kind of thing the reel meant?',
      judge:
        "Read term_is, what the reel meant the term to name, and viewer_answer, a first-time viewer's one-sentence answer to what the term is. Answer yes when the viewer names the same kind of thing, even in plain or partial words; answer no when they name a different kind of thing, a part of it, a byproduct of it, or something broader or narrower.",
    }),
    same_story_part: noul({
      question: 'Did the viewer pick the story part the reel meant as the term?',
      judge:
        "Read story_part, the one thing in the reel's story that stands for the term, and viewer_answer, the thing a first-time viewer named. Answer yes when they name that same thing, however worded; answer no when they name another part of the story, more than one thing, or nothing.",
    }),
    step_present: noul({
      question: "Is this step of the mechanism in the viewer's explanation?",
      judge:
        "Read step, one step of how the term works, and viewer_explanation, a first-time viewer's step-by-step explanation in their own words. Answer yes when the explanation contains that step, even in plain words or merged with another; answer no when it is missing.",
    }),
    step_wrong: noul({
      question: "Does the viewer's explanation state any step wrongly?",
      judge:
        "Read mechanism_steps, how the term really works, and viewer_explanation, a first-time viewer's step-by-step explanation. Answer yes when the explanation states something that contradicts a step, puts steps in an order that changes what happens, or adds a step that is false; answer no when everything it states is right, even if steps are missing.",
    }),
    map_row: noul({
      question: "Does the viewer's map give this story part its real-world part?",
      judge:
        "Read story and real, one row of the reel's analogy (a thing in the story and what it is in the real world), and viewer_map, a first-time viewer's map from story things to real things. Answer yes when the viewer maps that story thing to the same real thing, however worded; answer no when they map it to something else or leave it out.",
    }),
    new_example: noul({
      question: 'Is the viewer\'s new example a genuine instance of the term?',
      judge:
        'Read term_is, what the term names, and viewer_example, a new example a first-time viewer gave from everyday life or work, with why it counts. Answer yes when it is a genuine instance of the term; answer no when it is a different thing, only resembles it, or is one of the reel\'s own examples retold.',
    }),
    belief_contradicts: noul({
      question: 'Does anything the viewer now expects contradict what the term is or how it works?',
      judge:
        "Read term_is, core_steps (how the term works) and viewer_expectations, what a first-time viewer now expects to be true about the term because of the reel's comparison. Answer yes when an expectation contradicts term_is or a core step; answer no when every expectation is true, harmless, or only incomplete.",
    }),
    belief_listed: noul({
      question: 'Does anything the viewer now expects match a false belief the reel meant to avoid?',
      judge:
        "Read false_beliefs, wrong ideas the reel's comparison could plant, and viewer_expectations, what a first-time viewer now expects to be true. Answer yes when an expectation says, in any words, one of those false beliefs; answer no otherwise.",
    }),
    example_matches: noul({
      question: "Is the viewer's example answer the one the reel meant?",
      judge:
        "Read example_answer, the answer the reel's real example reaches, and viewer_answer, the answer a first-time viewer says it reached. Answer yes when they reach the same answer, even worded differently; answer no when the answers differ or the viewer gave none.",
    }),
    // 4.3: never asked (the reel raises no question; the answer key has none). Kept so the checklist
    // stays the register's v2 verbatim (EX4-181).
    question_answered: noul({
      question: "Did the viewer get the reel's question and its answer?",
      judge:
        "Read question and answer, the question the reel raises near its start and the answer it gives, and viewer_question and viewer_answer, what a first-time viewer says the question was and its answer. Answer yes when the viewer names the same question, in any words, and an answer that matches; answer no when they missed the question, say it was not answered, or give a different answer.",
    }),
  },
});

export const UNDERSTANDING_CHECKLIST_FIELDS = {
  same_kind: ['term_is', 'viewer_answer'],
  same_story_part: ['story_part', 'viewer_answer'],
  step_present: ['step', 'viewer_explanation'],
  step_wrong: ['mechanism_steps', 'viewer_explanation'],
  map_row: ['story', 'real', 'viewer_map'],
  new_example: ['term_is', 'viewer_example'],
  belief_contradicts: ['term_is', 'core_steps', 'viewer_expectations'],
  belief_listed: ['false_beliefs', 'viewer_expectations'],
  example_matches: ['example_answer', 'viewer_answer'],
  question_answered: ['question', 'answer', 'viewer_question', 'viewer_answer'],
} as const;

type ChecklistKey = keyof typeof UNDERSTANDING_CHECKLIST.questions;

/** Jev's p(yes) at or above this reads as yes. */
export const UNDERSTANDING_MIN = 0.5;

// ── Findings ──────────────────────────────────────────────────────────────────────────────

/** The failure types that trigger the fix (UNDERSTANDING.md Step 4's table, "blocking" read as serious). */
export const SERIOUS_TYPES = [
  'wrong_referent',
  'two_stories',
  'wrong_step',
  'missing_step',
  'over_extension',
  'example_wrong',
  'example_ambiguous',
  'question_unanswered',
] as const;
export type SeriousType = (typeof SERIOUS_TYPES)[number];

/** CONTRACT-4.2's findings entry. `cause` and `why` come from the diagnosis (a default before it). */
export type SeriousFinding = {
  type: SeriousType;
  reader: ReaderPersona;
  reader_quote: string;
  script_quote: string;
  beat: number | null;
  cause: Cause;
  why: string;
};
/** A minor note, kept with its reader and beat for the warnings (the file's `minor` is the text). */
export type MinorNote = { text: string; beat: number | null };
export type UnderstandingFindings = { serious: SeriousFinding[]; minor: MinorNote[] };

/** The cause to assume when no diagnosis is available (the diagnosis call failed): fail open. */
const DEFAULT_CAUSE: Record<SeriousType, Cause> = {
  wrong_referent: 'definition',
  two_stories: 'mapping',
  wrong_step: 'wording',
  missing_step: 'missing_beat',
  over_extension: 'boundary',
  example_wrong: 'missing_beat',
  example_ambiguous: 'wording',
  question_unanswered: 'missing_beat',
};

/** A quote reduced to its words, for matching against the reel test. */
const words = (v: string) =>
  v
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The beat a quote comes from in `reelTest` (the `## Beat N` section holding it), or null when the
 * quote is not in the file: the evidence rule's test. A quote counts when its longest piece (split
 * on ellipses) has at least two words and appears word for word.
 */
export function quoteBeat(reelTest: string, quote: string): number | null {
  const piece = quote
    .split(/\.\.\.|…/)
    .map(words)
    .sort((a, b) => b.length - a.length)[0];
  if (!piece || piece.split(' ').length < 2) return null;
  for (const m of reelTest.matchAll(/^## Beat (\d+)\n([\s\S]*?)(?=^## Beat |(?![\s\S]))/gm)) {
    if (words(m[2]).includes(piece)) return Number(m[1]);
  }
  return null;
}

/** The first of a probe's quotes found in the reel test, with its beat, or null (no evidence). */
function evidence(reelTest: string, ...probes: (ProbeAnswer | undefined)[]): { quote: string; beat: number } | null {
  for (const p of probes) {
    for (const q of p?.quotes ?? []) {
      const beat = quoteBeat(reelTest, q);
      if (beat !== null) return { quote: q, beat };
    }
  }
  return null;
}

type JudgeInput = {
  jev: ExplainersJevRunner | null;
  topicId: string;
  key: AnswerKey | null;
  reader: ReaderPersona;
  answers: ReaderAnswers;
  /** The file this reader met (for the evidence rule). */
  reelTest: string;
};

/**
 * One reader's findings: Jev's checklist against the answer key (when both exist) plus what code can
 * read from the answers itself (two stories, an ambiguous example, an unanswered question, what the
 * reader could not follow, where they got lost). A serious-type failure without a quoted line from the
 * reel test is minor (reader noise); an answer marked "not from the video" is never a pass.
 */
export async function judgeReader(input: JudgeInput): Promise<UnderstandingFindings> {
  const { jev, key, reader, answers, reelTest } = input;
  const p = answers.probes;
  const out: UnderstandingFindings = { serious: [], minor: [] };
  const who = reader === 'newcomer' ? 'The newcomer' : 'The curious viewer';
  const fail = (type: SeriousType, probe: ProbeAnswer | ProbeAnswer[], why: string) => {
    const probes = Array.isArray(probe) ? probe : [probe];
    const ev = evidence(reelTest, ...probes);
    const said = probes.map((x) => x.answer).filter(Boolean).join(' / ');
    // The evidence rule: serious only when the reader traced it to a line the reel really says.
    if (ev && probes.some((x) => x.source === 'video')) {
      out.serious.push({ type, reader, reader_quote: said, script_quote: ev.quote, beat: ev.beat, cause: DEFAULT_CAUSE[type], why });
    } else {
      const reason = probes.some((x) => x.source !== 'video') ? 'answered from outside the video' : 'no quoted line from the video behind it';
      out.minor.push({ text: `${who}: ${why} (${reason}: recorded, not fixed).`, beat: probes[0]?.beats[0] ?? null });
    }
  };
  const fragile = (what: string, probe: ProbeAnswer) => {
    if (probe.sure === 'guessing') out.minor.push({ text: `${who} got ${what} right but was guessing (fragile).`, beat: probe.beats[0] ?? null });
  };

  // Code's own reads of the answers.
  if (p.two_stories.two) fail('two_stories', p.two_stories, `${who} heard the term used for two different things: "${p.two_stories.answer}".`);
  if (p.the_example.other_answer) fail('example_ambiguous', p.the_example, `${who} could read the example another way: "${p.the_example.other_answer}".`);
  for (const b of answers.beats) {
    for (const c of b.could_not_follow) out.minor.push({ text: `Beat ${b.beat}, ${reader}: could not follow "${c.quote}"${c.why ? ` (${c.why})` : ''}.`, beat: b.beat || null });
  }
  if (p.where_lost.lost_beat && p.where_lost.lost_beat > 0) out.minor.push({ text: `${who} first got lost at beat ${p.where_lost.lost_beat}: ${p.where_lost.answer}`, beat: p.where_lost.lost_beat });

  if (!key || !jev) return out;

  const ask = async (q: ChecklistKey, state: Record<string, string>): Promise<number> => {
    const asked = await jev.ask({ component: 'understanding', state, set: UNDERSTANDING_CHECKLIST, questions: { [q]: UNDERSTANDING_CHECKLIST.questions[q] }, topicId: input.topicId });
    const v = (asked.answers as Record<string, { noul?: number }>)[q]?.noul;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Jev returned no ${q} answer`);
    return v;
  };
  const yes = (v: number) => v >= UNDERSTANDING_MIN;
  const fromVideo = (x: ProbeAnswer) => x.source === 'video';
  const core = key.mechanism_steps.filter((s) => s.core).map((s) => s.step);
  const steps = key.mechanism_steps.map((s) => `${s.step}${s.core ? '' : ' (nice to have)'}`).join('\n');
  const beliefs = [p.what_youd_assume.answer, ...(p.what_youd_assume.beliefs ?? [])].filter(Boolean).join('\n');
  const map = (p.the_map.rows ?? []).map((r) => `${r.story} = ${r.real}`).join('\n') || p.the_map.answer;

  const checks: Promise<void>[] = [];
  const check = (run: () => Promise<void>) => checks.push(run());

  check(async () => {
    const ok = fromVideo(p.what_it_is) && yes(await ask('same_kind', { term_is: key.term_is, viewer_answer: p.what_it_is.answer }));
    if (!ok) fail('wrong_referent', p.what_it_is, `${who} says the term is "${p.what_it_is.answer}", not what the reel meant (${key.term_is}).`);
    else fragile('what the term is', p.what_it_is);
  });
  if (key.story_part) {
    check(async () => {
      const ok = fromVideo(p.which_one) && yes(await ask('same_story_part', { story_part: key.story_part, viewer_answer: p.which_one.answer }));
      if (!ok) fail('wrong_referent', p.which_one, `${who} picked "${p.which_one.answer}" as the term in the story, not ${key.story_part}.`);
      else fragile('which story part is the term', p.which_one);
    });
  }
  if (key.mechanism_steps.length) {
    check(async () => {
      if (yes(await ask('step_wrong', { mechanism_steps: steps, viewer_explanation: p.how_it_works.answer }))) {
        fail('wrong_step', p.how_it_works, `${who} explains a step wrongly: "${p.how_it_works.answer}".`);
      }
    });
    for (const s of key.mechanism_steps) {
      check(async () => {
        const ok = fromVideo(p.how_it_works) && yes(await ask('step_present', { step: s.step, viewer_explanation: p.how_it_works.answer }));
        if (ok) return;
        if (s.core) fail('missing_step', p.how_it_works, `${who}'s explanation leaves out a core step: ${s.step}.`);
        else out.minor.push({ text: `${who}'s explanation leaves out a nice-to-have step: ${s.step}.`, beat: null });
      });
    }
  }
  for (const row of key.mapping) {
    check(async () => {
      if (!yes(await ask('map_row', { story: row.story, real: row.real, viewer_map: map }))) {
        out.minor.push({ text: `${who} did not map ${row.story} to ${row.real}.`, beat: p.the_map.beats[0] ?? null });
      }
    });
  }
  // The new example is the reader's own by design: "not from the video" is expected here.
  check(async () => {
    const ok = Boolean(p.new_case.answer) && yes(await ask('new_example', { term_is: key.term_is, viewer_example: p.new_case.answer }));
    if (!ok) out.minor.push({ text: `${who}'s own new example is weak: "${p.new_case.answer || 'none'}".`, beat: null });
  });
  if (beliefs) {
    check(async () => {
      if (yes(await ask('belief_contradicts', { term_is: key.term_is, core_steps: core.join('\n'), viewer_expectations: beliefs }))) {
        fail('over_extension', p.what_youd_assume, `Because of the comparison, ${who.toLowerCase()} now expects something false about the term: "${beliefs.replace(/\n/g, '; ')}".`);
      } else if (key.false_beliefs_to_avoid.length && yes(await ask('belief_listed', { false_beliefs: key.false_beliefs_to_avoid.join('\n'), viewer_expectations: beliefs }))) {
        out.minor.push({ text: `${who} picked up a false belief the comparison invites: "${beliefs.replace(/\n/g, '; ')}".`, beat: p.what_youd_assume.beats[0] ?? null });
      }
    });
  }
  if (key.example_answer) {
    check(async () => {
      const ok = fromVideo(p.the_example) && yes(await ask('example_matches', { example_answer: key.example_answer, viewer_answer: p.the_example.answer }));
      if (!ok) fail('example_wrong', p.the_example, `${who} reached "${p.the_example.answer}" in the real example, not ${key.example_answer}.`);
      else fragile("the example's answer", p.the_example);
    });
  }
  await Promise.all(checks);
  return out;
}

/** Both readers' findings in one list (either reader can raise a serious one), minor notes deduplicated. */
export function mergeFindings(parts: UnderstandingFindings[]): UnderstandingFindings {
  const seen = new Set<string>();
  const minor: MinorNote[] = [];
  for (const m of parts.flatMap((x) => x.minor)) {
    if (seen.has(m.text)) continue;
    seen.add(m.text);
    minor.push(m);
  }
  return { serious: parts.flatMap((x) => x.serious), minor };
}

/** The diagnosis folded into the findings: the first beat that went wrong, the cause, why. */
export function applyDiagnosis(serious: SeriousFinding[], diagnoses: Diagnosis[]): SeriousFinding[] {
  return serious.map((f, i) => {
    const d = diagnoses.find((x) => x.finding === i + 1);
    return d ? { ...f, beat: d.beat >= 1 && d.beat <= 8 ? d.beat : f.beat, cause: d.cause, why: d.why || f.why } : f;
  });
}

/**
 * The newcomer's findings with the term back in place of the invented word, so the director can find
 * the quoted line in its own script and the warnings read as the reel does.
 */
export function unStandIn(findings: UnderstandingFindings, standIn: string, term: string): UnderstandingFindings {
  const re = new RegExp(`\\b${escapeRe(standIn)}(s?)\\b`, 'gi');
  const back = (v: string) => v.replace(re, (_m, plural: string) => `${term}${plural}`);
  return {
    serious: findings.serious.map((f) => ({ ...f, reader_quote: back(f.reader_quote), script_quote: back(f.script_quote), why: back(f.why) })),
    minor: findings.minor.map((m) => ({ ...m, text: back(m.text) })),
  };
}

/** The findings file as CONTRACT-4.2 shapes it. */
export function findingsJson(findings: UnderstandingFindings): { serious: SeriousFinding[]; minor: string[] } {
  return { serious: findings.serious, minor: findings.minor.map((m) => m.text) };
}
