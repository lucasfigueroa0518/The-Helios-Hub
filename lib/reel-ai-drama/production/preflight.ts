import fs from 'node:fs';

import { HYPERFRAMES_BIN } from '@/lib/explainers/render/workspace';
import { spawnRunner, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { GSAP_FILE } from '@/lib/reel-ai-drama/render/video';
import { errorReason, waitForNetwork, type NetworkWatch } from '@/lib/reel-ai-drama/retry';

/**
 * The free check before a job spends anything (ITERATION-12 §1): voice wallet, keys, binaries, disk, network. Two jobs spent about $5
 * each before finding the HeyGen wallet at $0. No call here costs anything: no model runs and no voice is made. A check that can't
 * read its answer warns and never blocks; only a clear no fails the job. A network that's down is waited for.
 */

const HEYGEN_ME = 'https://api.heygen.com/v3/users/me';
const ANTHROPIC_MODELS = 'https://api.anthropic.com/v1/models?limit=1';
/** A reel's working files, renders included. */
export const MIN_FREE_BYTES = 3 * 1024 ** 3;
/** Above empty, but a reel's voice may run it out: said on delivery. */
export const LOW_WALLET = 2;

export type PreflightResult = { ok: boolean; problems: string[]; warnings: string[] };

export type PreflightInput = {
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  jobsRoot: string;
  run?: Runner;
  fetcher?: typeof fetch;
  network?: Partial<NetworkWatch>;
  hyperframesBin?: string;
  gsapFile?: string;
  freeBytes?: (dir: string) => number;
};

/** The wallet in HeyGen's /v3/users/me reply; null when this account's reply carries none (a subscription, a changed shape). */
export function heygenWallet(body: unknown): { balance: number; currency: string } | null {
  const root = body as { data?: unknown } | null;
  const wallet = ((root?.data ?? root) as { wallet?: { remaining_balance?: unknown; currency?: unknown } } | null)?.wallet;
  return typeof wallet?.remaining_balance === 'number' ? { balance: wallet.remaining_balance, currency: String(wallet.currency ?? 'usd') } : null;
}

async function checkHeygen(key: string, send: typeof fetch, out: PreflightResult): Promise<void> {
  try {
    const res = await send(HEYGEN_ME, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) {
      out.problems.push(`HeyGen refused the key (HTTP ${res.status}).`);
      return;
    }
    if (!res.ok) {
      out.warnings.push(`The HeyGen wallet could not be read (HTTP ${res.status}); the voice may fail.`);
      return;
    }
    const wallet = heygenWallet(await res.json());
    if (!wallet) out.warnings.push('The HeyGen reply shows no wallet balance, so it could not be checked.');
    else if (wallet.balance <= 0) out.problems.push(`The HeyGen wallet is empty (${wallet.balance} ${wallet.currency}). Top it up, then run this again; nothing was spent.`);
    else if (wallet.balance < LOW_WALLET) out.warnings.push(`The HeyGen wallet is low (${wallet.balance} ${wallet.currency}).`);
  } catch (error) {
    out.warnings.push(`The HeyGen wallet could not be read (${errorReason(error)}).`);
  }
}

async function checkAnthropic(key: string, send: typeof fetch, out: PreflightResult): Promise<void> {
  try {
    const res = await send(ANTHROPIC_MODELS, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) out.problems.push(`Anthropic refused the key (HTTP ${res.status}).`);
  } catch (error) {
    out.warnings.push(`The Anthropic key could not be checked (${errorReason(error)}).`);
  }
}

export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  const out: PreflightResult = { ok: true, problems: [], warnings: [] };
  const run = input.run ?? spawnRunner;
  const send = input.fetcher ?? fetch;

  for (const bin of ['ffmpeg', 'ffprobe']) {
    const res = run(bin, ['-version'], { cwd: process.cwd(), timeoutMs: 30_000 });
    if (res.status !== 0) out.problems.push(`${bin} isn't working (${res.error ?? `exit ${res.status}`}).`);
  }
  const hyperframes = input.hyperframesBin ?? HYPERFRAMES_BIN;
  if (!fs.existsSync(hyperframes)) out.problems.push(`The HyperFrames CLI is missing (${hyperframes}).`);
  const gsap = input.gsapFile ?? GSAP_FILE;
  if (!fs.existsSync(gsap)) out.problems.push(`The kit's gsap is missing (${gsap}).`);

  try {
    fs.mkdirSync(input.jobsRoot, { recursive: true });
    fs.accessSync(input.jobsRoot, fs.constants.W_OK);
    const free = input.freeBytes ? input.freeBytes(input.jobsRoot) : (() => {
      const s = fs.statfsSync(input.jobsRoot);
      return Number(s.bavail) * Number(s.bsize);
    })();
    if (free < MIN_FREE_BYTES) out.problems.push(`Only ${(free / 1024 ** 3).toFixed(1)} GB free on the jobs disk; a reel needs ${MIN_FREE_BYTES / 1024 ** 3} GB.`);
  } catch (error) {
    out.problems.push(`The jobs folder can't be used (${errorReason(error)}).`);
  }

  if (!input.secrets.anthropicApiKey.trim()) out.problems.push('ANTHROPIC_API_KEY is not set.');
  if (!input.secrets.heygenApiKey.trim()) out.problems.push('HEYGEN_API_KEY is not set.');

  const { online } = await waitForNetwork(input.network);
  if (!online) out.problems.push('The network has been down for hours.');
  else {
    if (input.secrets.anthropicApiKey.trim()) await checkAnthropic(input.secrets.anthropicApiKey, send, out);
    if (input.secrets.heygenApiKey.trim()) await checkHeygen(input.secrets.heygenApiKey, send, out);
  }
  out.ok = out.problems.length === 0;
  return out;
}
