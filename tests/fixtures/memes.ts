/**
 * Meme lab test fixtures: a story (a test fixture, not reporting) and canned
 * Claude answers. Shared by the writer and run tests.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { goldenCard } from '@/lib/memes/golden-card';
import type { MemeStory } from '@/lib/memes/story';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { Brief } from '@/lib/social/reporter/brief';

const fact = (id: string, text: string) => ({ id, text, sources: ['Fixture'], claim_by: null, notes: [] });

export const FIXTURE_BRIEF = {
  single_story: { yes: true, note: null },
  the_news: { text: 'Perplexity adds a daily limit to its free plan.', ids: ['F1'] },
  why_it_matters: [{ text: 'Free users now hit a cap.', ids: ['F2'] }],
  plot: [{ beat: 'TRIGGER', text: 'The limit starts Monday.', ids: ['F3'] }],
  tensions: [{ text: 'Users want more free searches; the company wants paid plans.', ids: ['F2'] }],
  facts: [fact('F1', 'Perplexity added a daily limit to its free plan.'), fact('F2', 'Free users get 5 deep searches a day.'), fact('F3', 'The limit starts Monday.')],
  background: [],
  quotes: [],
  numbers: [{ id: 'N1', value: '5 deep searches a day', type: 'count', counts: 'free-plan deep searches', sources: ['Fixture'], notes: [] }],
  terms: [],
  subjects: [{ id: 'S1', name: 'Perplexity', role: null, type: 'organization' }],
  events: [],
  article_photos: [],
  not_answered: [],
  sources: [{ outlet: 'Fixture', date: null, url: 'https://example.com', kind: 'original' }],
  fetch_failures: [],
} as unknown as Brief;

export const FIXTURE_STORY: MemeStory = { postId: 'post-1', title: 'Perplexity limits its free plan', status: 'review', createdAt: '2026-10-13T12:00:00Z', brief: FIXTURE_BRIEF };
export const FREE = TEMPLATE_CATALOG.map((t) => t.id);

export const t = (slot: string, text: string, ids = ['F2']) => ({ slot, kind: 'text', player_id: null, text, fact_ids: ids, situation_id: null, why: `${slot} is ${text} (${ids.join(', ')})` });
export const v = (slot: string, text: string, sid: string) => ({ slot, kind: 'viewer', player_id: null, text, fact_ids: [], situation_id: sid, why: `the viewer, ${sid}` });
export const e = (slot: string, id: string) => ({ slot, kind: 'entity', player_id: id, text: null, fact_ids: [], situation_id: null, why: `${id} plays ${slot} (F1)` });

const beat = (role: string, text: string, ids: string[], player: string | null = null) => ({ role, text, fact_ids: ids, player_id: player });

/** Step 1 (meme-writer@3): three turns of different types; T1 touches the viewer. */
export const GOOD_TURNS = {
  turns: [
    { id: 'T1', type: 'viewers-day', summary: 'Free users now hit a cap.', beats: [beat('news', 'Free plan: 5 deep searches a day', ['F2'], 'perplexity'), beat('viewer', 'Me, hitting the limit by lunch', [])], butt: 'viewer', touches_viewer: true, strength: 3 },
    { id: 'T2', type: 'the-fall', summary: 'Free deep searches became five a day.', beats: [beat('then', 'Free deep searches', ['F1']), beat('now', '5 deep searches a day', ['N1'])], butt: 'perplexity', touches_viewer: false, strength: 2 },
    { id: 'T3', type: 'fine-print', summary: 'A free plan with a catch.', beats: [beat('promise', 'A free plan', ['F1'], 'perplexity'), beat('catch', '5 deep searches a day, from Monday', ['F2', 'F3'])], butt: 'perplexity', touches_viewer: false, strength: 2 },
  ],
};

/** Step 2: two memes per kept turn, each on a template from that turn's short list. */
/**
 * A submitted meme names its golden card's pattern (G4). Fixtures take the
 * card's first pattern, so they stay valid when the cards are regenerated.
 */
export const withPattern = <T extends { template_id: string }>(m: T): T & { pattern: string; pattern_fit: string } =>
  ({ pattern: goldenCard(m.template_id)?.patterns[0]?.id ?? '', pattern_fit: 'The lines fill the pattern as its form says.', ...m });

export const GOOD_MEMES = [
  { turn_id: 'T1', template_id: 'running-away-balloon', situation_id: 'AS-04', relation: 'The free plan stops at five deep searches.', fills: [v('wanter', 'Me', 'AS-04'), t('want', 'Free deep searches', ['F1']), t('holder', '5 a day, from Monday', ['F2', 'F3'])] },
  { turn_id: 'T1', template_id: 'squidward-window', situation_id: 'AS-04', relation: 'Paid users keep searching while free users wait.', fills: [v('watcher', 'Me', 'AS-04'), t('enjoyers', 'Paid plans, still searching')] },
  { turn_id: 'T2', template_id: 'buff-doge-cheems', situation_id: null, relation: 'Free deep searches shrank to five a day.', fills: [t('strong', 'The free plan, before', ['F1']), t('strong-caption', 'Deep searches', ['F1']), t('weak', 'The free plan, Monday', ['F3']), t('weak-caption', '5 deep searches a day', ['N1'])] },
  { turn_id: 'T2', template_id: 'hide-the-pain', situation_id: null, relation: 'Five a day is the new number.', fills: [t('setup', 'Deep searches for everyone', ['F1']), t('pain', '5 a day from Monday', ['N1', 'F3']), e('smiler', 'perplexity')] },
  { turn_id: 'T3', template_id: 'types-of-headaches', situation_id: null, relation: 'The worst part is the cap.', fills: [t('worst', '5 searches a day', ['F2'])] },
  { turn_id: 'T3', template_id: 'trophy', situation_id: null, relation: 'The free plan no longer has unlimited searches.', fills: [t('missing', 'unlimited searches', ['F2']), e('speaker', 'perplexity')] },
].map(withPattern);

/** Every meme in a canned submit_memes answer names its pattern, unless the test set one. */
const withPatterns = (input: unknown): unknown =>
  input && typeof input === 'object' && Array.isArray((input as { memes?: unknown }).memes)
    ? { ...input, memes: ((input as { memes: Array<{ template_id: string }> }).memes).map((m) => (m && typeof m === 'object' && 'template_id' in m ? withPattern(m) : m)) }
    : input;

/** A canned answer; a turns submission goes to submit_turns, anything else to submit_memes. */
export function cannedMessage(input: unknown, usage: Partial<Anthropic.Usage> = {}, tool = input && typeof input === 'object' && 'turns' in input ? 'submit_turns' : 'submit_memes'): Anthropic.Message {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
    content: [{ type: 'tool_use', id: 'toolu_1', name: tool, input: withPatterns(input) }],
    usage: { input_tokens: 4000, output_tokens: 3000, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0, ...usage },
  } as unknown as Anthropic.Message;
}

/**
 * A Claude stub for whole runs: the turns on the conversation's first call,
 * then the memes on every later call.
 */
export function twoStep(turns: unknown = GOOD_TURNS, memes: unknown = { memes: GOOD_MEMES }) {
  return async (p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => cannedMessage(asksForTurns(p) ? turns : memes);
}

/** Does this request's last message ask for submit_turns (the first call, or a retry for more turns)? */
export const asksForTurns = (p: Anthropic.MessageCreateParamsNonStreaming): boolean => /Call submit_turns/.test(JSON.stringify(p.messages.at(-1)));

/**
 * A stub Jev that answers every question it is asked, so the judges' per-slot
 * role questions are answered too. `over` sets answers by question id (or by
 * prefix, ending in '*'), per meme template name when `when` matches.
 */
export function answerAll(base: { noul?: number; offLimits?: number; adCopy?: number } = {}, tweak?: (templateName: string, id: string) => number | undefined): JevAsk {
  return async (req): Promise<JevResult> => {
    const answers: JevResult['answers'] = {};
    const st = req.state as { meme?: { template: string } };
    for (const id of Object.keys(req.questions)) {
      if (id === 'funnier') {
        answers[id] = { choice: 'a', probabilities: { a: 0.5, b: 0.5 } };
        continue;
      }
      const tw = st.meme ? tweak?.(st.meme.template, id) : undefined;
      const dflt = id === 'off_limits' ? base.offLimits ?? 0.03 : id === 'ad_copy' ? base.adCopy ?? 0.05 : base.noul ?? 0.9;
      answers[id] = { noul: tw ?? dflt };
    }
    return { answers, usage: { input_tokens: 1500, output_tokens: 0 }, model: 'stub' };
  };
}
