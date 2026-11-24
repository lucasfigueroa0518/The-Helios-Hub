import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { isPrivateHost } from '@/lib/net/private-host';
import { recordCost as recordReelsCost } from '@/lib/reels/repository';
import { MIN_BODY_CHARS, readPageText } from '@/lib/reels/seed-search';

import { Ledger, ONE_BOX_VERIFY_MODEL, VERIFY_MAX_OUTPUT_TOKENS, limitReason, verifyWorstCaseUsd } from './budget';
import { VERDICT_TOOL, buildVerifyUserTurn, verifySystemFor } from './prompts';
import type { Client, CostRecorder } from './search';
import { entryTitle, entryUrl, missingFields, shapeKey, shapeOf } from './shape';
import type { Entry, Finding, OneBoxInput, PassedEntry, Verified } from './types';

export const defaultVerifyCost: CostRecorder = (usd, inputTokens, outputTokens) =>
  recordReelsCost({ runId: null, vendor: 'anthropic', component: 'one-box-verify', inputTokens, outputTokens, usd });

async function readable(url: string, readPage: (u: string) => Promise<string | null>): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) return null;
    const text = (await readPage(url))?.trim() ?? '';
    return text.length >= MIN_BODY_CHARS ? text : null;
  } catch {
    return null;
  }
}

/** One independent judgment: does this page's main point match the person's idea? Cost is added to the ledger. */
async function judge(i: { client: Client; ledger: Ledger; input: OneBoxInput; pageText: string; recordCost: CostRecorder }): Promise<{ matches: boolean; reason: string }> {
  const message = await i.client.messages.create({
    model: ONE_BOX_VERIFY_MODEL,
    max_tokens: VERIFY_MAX_OUTPUT_TOKENS,
    system: cachedSystemText(verifySystemFor(shapeKey(i.input))),
    tools: [withToolCache(VERDICT_TOOL as Anthropic.Tool)],
    tool_choice: { type: 'tool', name: VERDICT_TOOL.name },
    messages: [{ role: 'user', content: buildVerifyUserTurn({ vertical: i.input.vertical, blurb: i.input.blurb, pageText: i.pageText }) }],
  });
  const priced = priceAnthropicMessages([message], { modelId: ONE_BOX_VERIFY_MODEL, fallbackCacheTtl: '1h' });
  const usd = Number(priced.costUsd);
  i.ledger.add(usd);
  const inputTokens = priced.uncached_input_tokens + priced.cache_read_input_tokens + priced['cache_creation.ephemeral_5m_input_tokens'] + priced['cache_creation.ephemeral_1h_input_tokens'];
  await i.recordCost(usd, inputTokens, priced.output_tokens).catch(() => undefined);
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === VERDICT_TOOL.name);
  const v = (block?.input ?? {}) as { matches?: unknown; reason?: unknown };
  return { matches: v.matches === true, reason: typeof v.reason === 'string' && v.reason ? v.reason : 'no reason given' };
}

/**
 * Design section 4: each candidate entry (the pool's own fields) must be complete; its page is read by the plain reader, then
 * judged by an independent Haiku call that sees the page itself (not the search model's claim). Best first; the first clear yes
 * is the primary source. Guess the Number: the figure must be on the page. Free vs. Paid: the tool's page must mention its name.
 * Explainers keeps every page that passes as source material.
 */
export async function verifyFinding(i: {
  client: Client;
  ledger: Ledger;
  input: OneBoxInput;
  finding: Finding;
  readPage?: (url: string) => Promise<string | null>;
  recordCost?: CostRecorder;
}): Promise<{ ok: true; verified: Verified } | { ok: false; reason: string }> {
  const readPage = i.readPage ?? readPageText;
  const recordCost = i.recordCost ?? defaultVerifyCost;
  const shape = shapeOf(i.input);
  const complete = i.finding.entries.filter((e) => missingFields(shape, e).length === 0).slice(0, 3);
  if (complete.length === 0) {
    const first = i.finding.entries[0];
    return { ok: false, reason: first ? `The search didn’t come back with everything ${shape.label} needs (missing ${missingFields(shape, first).join(', ')}).` : `The search found nothing ${shape.label} could use.` };
  }

  const passed: PassedEntry[] = [];
  let firstTried: { entry: Entry; reason: string } | null = null;
  let stoppedAtLimit = false;
  for (const entry of complete) {
    const url = entryUrl(shape, entry);
    const text = await readable(url, readPage);
    if (!text) continue;
    if (!i.ledger.canAfford(verifyWorstCaseUsd())) {
      stoppedAtLimit = true;
      break;
    }
    const verdict = await judge({ client: i.client, ledger: i.ledger, input: i.input, pageText: text, recordCost });
    let reason = verdict.reason;
    let ok = verdict.matches;
    if (ok && entry.value && !text.includes(entry.value)) {
      ok = false;
      reason = `the number “${entry.value}” isn’t on that page`;
    }
    if (ok && entry.toolName && !text.toLowerCase().includes(entry.toolName.toLowerCase())) {
      ok = false;
      reason = `that page doesn’t mention “${entry.toolName}”`;
    }
    if (ok) passed.push({ entry, url, text });
    else if (!firstTried) firstTried = { entry, reason };
    if (ok && i.input.vertical !== 'explainers') break;
  }
  if (passed.length === 0) {
    if (stoppedAtLimit) return { ok: false, reason: limitReason(i.input.vertical) };
    if (firstTried) return { ok: false, reason: `The closest source I found was “${entryTitle(firstTried.entry)}”, but it isn’t the same idea: ${firstTried.reason}` };
    return { ok: false, reason: 'None of the pages the search found could be opened and read.' };
  }
  return { ok: true, verified: { passed } };
}
