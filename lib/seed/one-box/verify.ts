import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { isPrivateHost } from '@/lib/net/private-host';
import { recordCost as recordReelsCost } from '@/lib/reels/repository';
import { MIN_BODY_CHARS, readPageText } from '@/lib/reels/seed-search';

import { Ledger, ONE_BOX_VERIFY_MODEL, VERIFY_MAX_OUTPUT_TOKENS, verifyWorstCaseUsd } from './budget';
import { VERDICT_TOOL, VERIFY_SYSTEM, buildVerifyUserTurn } from './prompts';
import type { Client, CostRecorder } from './search';
import type { Finding, OneBoxInput, ReportedArticle, Verified, VerifiedArticle } from './types';

export const defaultVerifyCost: CostRecorder = (usd, inputTokens, outputTokens) =>
  recordReelsCost({ runId: null, vendor: 'anthropic', component: 'one-box-verify', inputTokens, outputTokens, usd });

const LIMIT_REASON = 'Stopped at the 35-cent limit.';

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
    system: cachedSystemText(VERIFY_SYSTEM),
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
 * Design section 4: each reported page is read by the plain reader, then judged by an independent Haiku call that sees the
 * page itself (not the search model's claim). Best first; the first clear yes is the primary source, later yeses are supporting.
 * Number: the figure must be on a verified page. Tool: the tool's own page is the candidate and must mention its name.
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
  const tool = i.input.series === 'free_vs_paid' ? i.finding.tool : undefined;
  const candidates: ReportedArticle[] = tool ? [{ url: tool.url, headline: tool.name, outlet: new URL(tool.url).hostname.replace(/^www\./, '') }] : i.finding.articles.slice(0, 3);
  if (candidates.length === 0) return { ok: false, reason: 'The search found no page to use as a source.' };

  const passed: VerifiedArticle[] = [];
  let firstTried: { candidate: ReportedArticle; reason: string } | null = null;
  let stoppedAtLimit = false;
  for (const candidate of candidates) {
    const text = await readable(candidate.url, readPage);
    if (!text) continue;
    if (!i.ledger.canAfford(verifyWorstCaseUsd())) {
      stoppedAtLimit = true;
      break;
    }
    const verdict = await judge({ client: i.client, ledger: i.ledger, input: i.input, pageText: text, recordCost });
    if (verdict.matches) passed.push({ ...candidate, text });
    else if (!firstTried) firstTried = { candidate, reason: verdict.reason };
  }
  if (passed.length === 0) {
    if (stoppedAtLimit) return { ok: false, reason: LIMIT_REASON };
    if (firstTried) return { ok: false, reason: `The closest source I found was “${firstTried.candidate.headline}” (${firstTried.candidate.outlet}), but it isn’t the same idea: ${firstTried.reason}` };
    return { ok: false, reason: 'None of the pages the search found could be opened and read.' };
  }

  const verified: Verified = { articles: passed };
  if (i.finding.conceptTitle) verified.conceptTitle = i.finding.conceptTitle;
  if (i.input.series === 'guess_the_number') {
    const n = i.finding.number;
    if (!n) return { ok: false, reason: 'No number was found for that idea.' };
    if (!passed.some((p) => p.text.includes(n.value))) return { ok: false, reason: `The number “${n.value}” isn’t on the page I found, so I can’t vouch for it.` };
    verified.number = n;
  }
  if (tool) {
    if (!passed[0]!.text.toLowerCase().includes(tool.name.toLowerCase())) return { ok: false, reason: `The page at ${tool.url} doesn’t mention “${tool.name}”.` };
    verified.tool = tool;
  }
  return { ok: true, verified };
}
