/**
 * The comment bot, as the lab runs it. Nothing posts and nothing is stored. Every model call starts from a person's click in
 * the lab (CLAUDE.md Rule 1), and tests hand it a stubbed `create`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import {
  CORRECTION_TOOL, REPLY_CAPS, REPLY_RULES, REPLY_TOOL, ROUTER_MODEL, ROUTER_SYSTEM, ROUTER_TOOL, SEARCH_ROUTES, SILENT_ROUTES, WEB_SEARCH_TOOL, WRITER_MODEL,
  type Depth, type Energy, type Route,
} from './prompts';
import { LAB_POSTS, type LabPost } from './posts';

export type Create = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
export type Decision = { route: Route; energy: Energy; depth: Depth; reason: string; forced: boolean };
export type Source = { url: string; title: string };
export type CommentResult = { decision: Decision; fields: Record<string, string> | null; flags: string[]; searches?: string[]; sources?: Source[]; rewrites?: number; error?: string; usd: number };

/** Read on every call so the voice can be edited and re-tried with no rebuild. */
export function readSoul(): string {
  return readFileSync(path.join(process.cwd(), 'lib/personality/helios.soul.md'), 'utf8');
}

const toolInput = (message: Anthropic.Message, tool: string): Record<string, unknown> | null => {
  const block = message.content.find((b) => b.type === 'tool_use' && b.name === tool);
  return block?.type === 'tool_use' ? (block.input as Record<string, unknown>) : null;
};

const usdOf = (message: Anthropic.Message, modelId: string) => Number(priceAnthropicMessages([message], { modelId }).costUsd);

const MAX_WRITER_TURNS = 6;
const MAX_REWRITES = 2;

/** What the writer searched and found, so the lab can show where an answer came from. */
function collectSearch(message: Anthropic.Message, searches: string[], sources: Source[]) {
  for (const block of message.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const query = (block.input as { query?: unknown } | undefined)?.query;
      if (typeof query === 'string') searches.push(query);
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const hit of block.content as Array<{ url?: unknown; title?: unknown }>) {
        if (typeof hit.url === 'string' && !sources.some((s) => s.url === hit.url)) sources.push({ url: hit.url, title: String(hit.title ?? hit.url) });
      }
    }
  }
}

/** All the bot knows about a post: its finished copy or script, and its caption. */
const contextBlock = (post: LabPost, comment: string) =>
  `<post>${JSON.stringify({ copy: post.copy, caption: post.caption })}</post>\n\n<comment>${JSON.stringify(comment)}</comment>`;

/** Graphemes that are emoji, and whether the text holds nothing else. */
function emojiCount(text: string): { emoji: number; only: boolean } {
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.replace(/\s+/g, ''))].map((s) => s.segment);
  const emoji = parts.filter((p) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(p)).length;
  return { emoji, only: parts.length > 0 && emoji === parts.length };
}

/** A joke only ever gets a laugh, so no model writes it: 1 to 3 laughing emoji by the commenter's energy. */
const LAUGH: Record<Energy, string> = { low: '😂', medium: '😂😂', high: '😂😂😂' };

/**
 * How long this reply may be, in characters. Most routes scale to the comment, so a short comment gets a short reply however
 * much there is to say. A long question and a correction need their room, and nice and agree are always tiny.
 */
export function replyBudget(decision: Pick<Decision, 'route' | 'depth'>, comment: string): number {
  const { route, depth } = decision;
  if (route === 'question' && depth === 'long') return REPLY_CAPS.question_long;
  if (route === 'correction' || route === 'nice' || route === 'agree') return REPLY_CAPS[route];
  const cap = route === 'opinion' ? REPLY_CAPS.opinion : route === 'helios_question' ? REPLY_CAPS.helios_question : REPLY_CAPS.question_short;
  return comment ? Math.min(cap, Math.max(60, Math.round(comment.length * 1.5))) : cap;
}

/** Soft checks shown next to the reply. They never block anything. */
export function flagsFor(decision: Pick<Decision, 'route' | 'depth'>, fields: Record<string, string>, comment = '', searched = true): string[] {
  const out: string[] = [];
  const budget = replyBudget(decision, comment);
  const length = (fields.reply ?? '').length;
  if (length > budget) out.push(`reply is ${length} chars, budget ${budget}`);
  if (Object.values(fields).some((v) => v.includes('—'))) out.push('has an em dash');
  if (decision.route === 'correction' && !searched && fields.verdict !== 'unverified') out.push('reached a verdict without searching');
  if (decision.route === 'opinion' && !(fields.reply ?? '').includes('?')) out.push('opinion reply asks no question');
  if (decision.route === 'agree') {
    if (/\b(thanks|thank you|thx|appreciate)\b/i.test(fields.reply ?? '')) out.push('thanks them for something that was not about us');
    if ((fields.reply ?? '').includes('?')) out.push('agreement should not ask a question');
  }
  if (emojiCount(comment).only && fields.reply !== undefined) {
    const reply = emojiCount(fields.reply);
    if (!reply.only || reply.emoji !== 1) out.push('an emoji-only comment should get one emoji back');
  }
  return out;
}

export async function routeComment(create: Create, comment: string, post: LabPost): Promise<{ decision: Decision; usd: number }> {
  const message = await create({
    model: ROUTER_MODEL,
    max_tokens: 200,
    tools: [ROUTER_TOOL],
    tool_choice: { type: 'tool', name: ROUTER_TOOL.name },
    system: cachedSystemText(ROUTER_SYSTEM),
    messages: [{ role: 'user', content: contextBlock(post, comment) }],
  });
  const input = toolInput(message, ROUTER_TOOL.name);
  if (!input) throw new Error('The router did not call submit_route.');
  return {
    decision: { route: input.route as Route, energy: input.energy as Energy, depth: input.depth as Depth, reason: String(input.reason ?? ''), forced: false },
    usd: usdOf(message, ROUTER_MODEL),
  };
}

/** Route once, then write unless the route stays silent. A forced route skips the router, for testing one path on purpose. */
export async function runComment(
  create: Create,
  input: { comment: string; post: LabPost; force?: { route: Route; energy?: Energy; depth?: Depth }; avoid?: readonly string[] },
): Promise<CommentResult> {
  const { comment, post, force, avoid = [] } = input;
  let usd = 0;
  let decision: Decision;
  if (force) {
    decision = { route: force.route, energy: force.energy ?? 'medium', depth: force.depth ?? 'short', reason: 'Forced from the lab.', forced: true };
  } else {
    const routed = await routeComment(create, comment, post);
    decision = routed.decision;
    usd += routed.usd;
  }
  if (SILENT_ROUTES.includes(decision.route)) return { decision, fields: null, flags: [], usd };
  if (decision.route === 'joke') return { decision, fields: { reply: LAUGH[decision.energy] }, flags: [], usd };

  const tool = decision.route === 'correction' ? CORRECTION_TOOL : REPLY_TOOL;
  const budget = replyBudget(decision, comment);
  const avoidBlock = avoid.length ? `\n\n<avoid>${JSON.stringify(avoid.slice(-6))}</avoid>` : '';
  // Sonnet 5.5 rejects a forced tool choice (400); the prompt and strict schema steer instead.
  const writerTool = withToolCache({ ...tool, strict: true } as unknown as Anthropic.Tool);
  const tools = (SEARCH_ROUTES.includes(decision.route) ? [WEB_SEARCH_TOOL, writerTool] : [writerTool]) as Anthropic.Tool[];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Route: ${decision.route}\nEnergy: ${decision.energy}\nDepth: ${decision.depth}\nCharacter budget: ${budget}\n\n${contextBlock(post, comment)}${avoidBlock}` }];
  let rewrites = 0;
  const searches: string[] = [];
  const sources: Source[] = [];
  try {
    // A search can pause the turn; send it back to continue, as lib/stories/writer.ts does.
    for (let turn = 0; turn < MAX_WRITER_TURNS; turn++) {
      const message = await create({
        model: WRITER_MODEL,
        max_tokens: 1500,
        tools,
        tool_choice: { type: 'auto' },
        system: cachedSystemText(`${readSoul()}\n\n# Operating rules\n\n${REPLY_RULES}`),
        messages,
      });
      usd += usdOf(message, WRITER_MODEL);
      collectSearch(message, searches, sources);
      const written = toolInput(message, tool.name);
      if (written) {
        const fields: Record<string, string> = Object.fromEntries(Object.entries(written).map(([k, v]) => [k, String(v ?? '')]));
        // Nothing settled means nothing is said, whatever the model wrote.
        if (fields.verdict === 'unverified') fields.reply = '';
        // The prompt alone doesn't hold the length, so an over-budget reply goes back to be cut.
        const length = (fields.reply ?? '').length;
        const call = message.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
        if (length > budget && rewrites < MAX_REWRITES && call?.type === 'tool_use') {
          rewrites++;
          messages.push({ role: 'assistant', content: message.content as Anthropic.MessageParam['content'] });
          messages.push({ role: 'user', content: [{
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: `That reply is ${length} characters and the budget is ${budget}. Cut a point instead of compressing it, then call ${tool.name} again.`,
          }] });
          continue;
        }
        return { decision, fields, flags: flagsFor(decision, fields, comment, searches.length > 0), searches, sources, rewrites, usd };
      }
      if (message.stop_reason !== 'pause_turn') {
        return { decision, fields: null, flags: [], searches, sources, error: `The model did not call ${tool.name} (stop: ${message.stop_reason}).`, usd };
      }
      messages.push({ role: 'assistant', content: message.content as Anthropic.MessageParam['content'] });
    }
    return { decision, fields: null, flags: [], searches, sources, error: `Still paused after ${MAX_WRITER_TURNS} turns.`, usd };
  } catch (e) {
    return { decision, fields: null, flags: [], searches, sources, error: e instanceof Error ? e.message : String(e), usd };
  }
}

export const postById = (id: unknown) => LAB_POSTS.find((s) => s.id === id) ?? null;
