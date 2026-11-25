import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { ratesForModel, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { BankedCutout } from '@/lib/real-case/bank';
import { messagesUsd, usageTotals, type CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import { fetchEntityP18 } from '@/lib/social/editorial/v2/image-step/commons';

import { BANK_VERDICTS_FILE, fileSha256, type BankVerdict, type BankVerdicts, type BankVerdictValue } from './bank-verdicts';
import { USER_AGENT } from './fetch';

/**
 * The one-time identity check of the banked cutouts (MD-81), run by `scripts/reel_ai_drama_check_bank.ts`:
 * one cheap vision call per person compares the cutout with a verified Wikidata/Commons portrait of them,
 * preferring a portrait other than the one the cutout was cut from. Verdicts go to BANK_VERDICTS_FILE.
 */

export const BANK_CHECK_MODEL = 'claude-haiku-5-5';
/** Each picture is sent at most this many pixels on its long edge (about 800 image tokens each). */
export const CHECK_IMAGE_PX = 768;
/** Estimate per call: two pictures plus the instructions in, a short verdict out. */
export const EST_INPUT_TOKENS = 2_200;
export const EST_OUTPUT_TOKENS = 200;

export const BANK_CHECK_SYSTEM = `You check one identity question by comparing two pictures.

Picture A is a cutout from our image bank, labelled with a person's name. Picture B is a reference portrait of that person from Wikidata or Wikimedia Commons, which we trust.

Decide whether picture A shows the same person as picture B. Compare the face itself: face shape, eyes, brows, nose, mouth, ears, hairline and build. Allow for age, hairstyle, facial hair, glasses, lighting, angle and image quality.

- "same": the faces match.
- "different": you are confident picture A shows someone else.
- "unsure": a face is too small, hidden or blurred to tell, or the pictures disagree but not clearly.

Call submit_identity exactly once, with one plain sentence saying what decided it.`;

export const SUBMIT_IDENTITY_TOOL: Anthropic.Tool = {
  name: 'submit_identity',
  description: 'Submit whether picture A shows the same person as picture B. Call it exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['same', 'different', 'unsure'] },
      reason: { type: 'string', description: 'One plain sentence: what decided it.' },
    },
    required: ['verdict', 'reason'],
  },
};

export function estimateBankCheck(people: number, model: string = BANK_CHECK_MODEL): number {
  const r = ratesForModel(model);
  return people * ((EST_INPUT_TOKENS * r.inputPerMtokUsd + EST_OUTPUT_TOKENS * r.outputPerMtokUsd) / 1_000_000);
}

const fileName = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/^.*\/(?:File:|File%3A)/i, '').replace(/^File:/i, '')).replace(/_/g, ' ').trim().toLowerCase();
  } catch {
    return s.toLowerCase();
  }
};

/** Commons files that state they depict `qid` (P180), newest first. */
async function depictsFiles(http: typeof fetch, qid: string, limit = 5): Promise<string[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', list: 'search', srsearch: `haswbstatement:P180=${qid}`, srnamespace: '6', srlimit: String(limit), srsort: 'create_timestamp_desc', format: 'json', origin: '*' })) url.searchParams.set(k, v);
  const res = await http(url.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = (await res.json()) as { query?: { search?: { title: string }[] } };
  return (body.query?.search ?? []).map((s) => s.title.replace(/^File:/, ''));
}

/** The verified portrait to compare with: the item's main image unless the cutout was cut from it, then a depicts file. */
export async function referenceFor(http: typeof fetch, cutout: Pick<BankedCutout, 'qid' | 'provenance'>): Promise<{ file: string; note: string } | null> {
  const from = fileName(cutout.provenance ?? '');
  const p18 = await fetchEntityP18(cutout.qid, { http }).catch(() => null);
  if (p18 && fileName(p18) !== from) return { file: p18, note: 'main image (P18)' };
  const other = (await depictsFiles(http, cutout.qid).catch(() => [])).find((f) => fileName(f) !== from && /\.(jpe?g|png|webp)$/i.test(f));
  if (other) return { file: other, note: 'a Commons file that depicts them (P180)' };
  return p18 ? { file: p18, note: 'main image (P18), the same file the cutout was cut from' } : null;
}

async function jpegForCheck(input: Buffer): Promise<string> {
  const out = await sharp(input)
    .rotate()
    .resize(CHECK_IMAGE_PX, CHECK_IMAGE_PX, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#808080' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString('base64');
}

export type BankCheckDeps = {
  create: CreateMessage;
  http: typeof fetch;
  model?: string;
  root?: string;
  now?: () => Date;
  /** Records each call's spend (the script writes it to the cost ledger). */
  record?: (line: { usd: number; totals: ReturnType<typeof usageTotals> }) => Promise<void>;
};

/** One vision call for one banked cutout. Fails open: any error is an `unsure` verdict saying why. */
export async function checkBankCutout(deps: BankCheckDeps, cutout: BankedCutout): Promise<{ verdict: BankVerdict; usd: number }> {
  const root = deps.root ?? process.cwd();
  const model = deps.model ?? BANK_CHECK_MODEL;
  const file = path.resolve(root, cutout.file);
  const base = { id: cutout.id, name: cutout.name, qid: cutout.qid, sha256: fileSha256(file), model, checked_at: (deps.now?.() ?? new Date()).toISOString() };
  const unsure = (reason: string, reference: string | null = null) => ({ verdict: { ...base, verdict: 'unsure' as const, reason, reference }, usd: 0 });
  const ref = await referenceFor(deps.http, cutout).catch(() => null);
  if (!ref) return unsure('No verified portrait on Wikidata or Commons to compare with.');
  const res = await deps.http(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(ref.file)}?width=${CHECK_IMAGE_PX}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return unsure(`The reference portrait could not be downloaded (HTTP ${res.status}).`, ref.file);
  const [a, b] = await Promise.all([jpegForCheck(fs.readFileSync(file)), jpegForCheck(Buffer.from(await res.arrayBuffer()))]);
  const message = await deps.create({
    model,
    // The model thinks by default and thinking shares this room; at 1500 (and 400 before) calls stopped at max_tokens with no verdict.
    max_tokens: 6000,
    tools: [withToolCache(SUBMIT_IDENTITY_TOOL)],
    tool_choice: { type: 'auto' },
    system: cachedSystemText(BANK_CHECK_SYSTEM),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `The person: ${cutout.name} (Wikidata ${cutout.qid}). Picture A, the bank cutout:` },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a } },
          { type: 'text', text: `Picture B, the reference portrait (${ref.note}):` },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b } },
        ],
      },
    ],
  });
  const usages = [message as unknown as MessageUsageLike];
  const usd = messagesUsd(usages, message.model || model);
  await deps.record?.({ usd, totals: usageTotals(usages) });
  const call = message.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use' && x.name === SUBMIT_IDENTITY_TOOL.name);
  const input = (call?.input ?? {}) as { verdict?: string; reason?: string };
  const verdict = (['same', 'different', 'unsure'] as const).includes(input.verdict as BankVerdictValue) ? (input.verdict as BankVerdictValue) : null;
  if (!verdict) return { verdict: { ...base, verdict: 'unsure', reason: `No usable verdict (${message.stop_reason}).`, reference: ref.file }, usd };
  return { verdict: { ...base, verdict, reason: String(input.reason ?? '').trim() || '(no reason given)', reference: ref.file }, usd };
}

/** Checks every banked cutout in turn and writes the verdicts file (merged over earlier verdicts by id). */
export async function runBankCheck(deps: BankCheckDeps, cutouts: readonly BankedCutout[], previous: BankVerdicts): Promise<{ verdicts: BankVerdicts; usd: number; errors: string[] }> {
  const root = deps.root ?? process.cwd();
  const byId = new Map(previous.verdicts.map((v) => [v.id, v]));
  const errors: string[] = [];
  let usd = 0;
  for (const c of cutouts) {
    try {
      const r = await checkBankCutout(deps, c);
      byId.set(c.id, r.verdict);
      usd += r.usd;
    } catch (error) {
      errors.push(`${c.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const verdicts: BankVerdicts = { verdicts: [...byId.values()].sort((x, y) => x.id.localeCompare(y.id)) };
  const out = path.join(root, BANK_VERDICTS_FILE);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(verdicts, null, 2)}\n`);
  return { verdicts, usd, errors };
}
