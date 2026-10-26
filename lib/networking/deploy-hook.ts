/**
 * Vercel deploy hook for heliosgroup.ai (AI Events plan M3). The calendar page reads the feed
 * in the browser, so the hook only refreshes the prerendered HTML search engines see. It fires
 * when VERCEL_DEPLOY_HOOK_URL is set, the feed content changed since the last successful fire,
 * and the last fire was at least an hour ago. One retry. Every skip is logged with its reason.
 *
 * Bookkeeping lives on the `networking.publish_state` row of the feed. `last_hook_status`
 * records the outcome and, on success, the content hash the site was rebuilt with
 * ("ok 201 hash=<hex>"), so a change skipped by the throttle still fires on the next publish.
 */

import type { NetworkingQuery } from '@/lib/networking/repository';

export const DEPLOY_HOOK_ENV = 'VERCEL_DEPLOY_HOOK_URL';
export const DEPLOY_HOOK_MIN_INTERVAL_MS = 60 * 60 * 1000;
const HOOK_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

export type HookSkipReason = 'no_hook_url' | 'unchanged' | 'throttled';

export type HookDecision = { fire: true } | { fire: false; reason: HookSkipReason; retryAfterMs?: number };

/** The content hash of the last successful fire, read back from `last_hook_status`. */
export function hookedHash(status: string | null | undefined): string | null {
  const match = /^ok\b.*\bhash=([0-9a-f]+)/.exec(status ?? '');
  return match ? match[1] : null;
}

/** Pure: should this publish fire the deploy hook? */
export function deployHookDecision(input: {
  hookUrl: string | null | undefined;
  contentHash: string;
  lastHookAt: Date | null;
  lastHookStatus: string | null;
  now: Date;
}): HookDecision {
  if (!input.hookUrl?.trim()) return { fire: false, reason: 'no_hook_url' };
  if (hookedHash(input.lastHookStatus) === input.contentHash) return { fire: false, reason: 'unchanged' };
  if (input.lastHookAt) {
    const since = input.now.getTime() - input.lastHookAt.getTime();
    if (since < DEPLOY_HOOK_MIN_INTERVAL_MS) {
      return { fire: false, reason: 'throttled', retryAfterMs: DEPLOY_HOOK_MIN_INTERVAL_MS - since };
    }
  }
  return { fire: true };
}

export type HookFireResult = { ok: boolean; status: number | null; error?: string; attempts: number };

/** POSTs the hook, retrying once on any failure. Never throws. */
export async function fireDeployHook(
  hookUrl: string,
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<HookFireResult> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: HookFireResult = { ok: false, status: null, attempts: 0 };
  // The hook URL is a secret: keep it out of any text that gets stored or logged.
  const scrub = (text: string) => (hookUrl ? text.split(hookUrl).join('[deploy hook]') : text);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await doFetch(hookUrl, { method: 'POST', signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      last = { ok: false, status: res.status, error: scrub(await res.text()).slice(0, 200), attempts: attempt };
    } catch (err) {
      last = { ok: false, status: null, error: scrub(err instanceof Error ? err.message : String(err)), attempts: attempt };
    }
    if (attempt < 2) await sleep(RETRY_DELAY_MS);
  }
  return last;
}

/** The `last_hook_status` text for a fire: the hash only on success. */
export function hookStatusText(result: HookFireResult, contentHash: string): string {
  if (result.ok) return `ok ${result.status} hash=${contentHash}`;
  return `failed ${result.status ?? 'network'}: ${(result.error ?? '').replace(/\s+/g, ' ').slice(0, 160)}`;
}

export type DeployHookOutcome =
  | { fired: true; ok: boolean; status: number | null; error?: string }
  | { fired: false; reason: HookSkipReason; retryAfterMs?: number };

/**
 * Decides and, when due, fires the hook for the feed `stateId`, recording `last_hook_at` and
 * `last_hook_status` (a failed fire counts for the throttle too, so a broken hook is not hit on
 * every publish).
 */
export async function maybeFireDeployHook(input: {
  q: NetworkingQuery;
  stateId: string;
  contentHash: string;
  now: Date;
  hookUrl?: string | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DeployHookOutcome> {
  const hookUrl = input.hookUrl === undefined ? process.env[DEPLOY_HOOK_ENV] : input.hookUrl;
  const { rows } = await input.q<{ last_hook_at: Date | string | null; last_hook_status: string | null }>(
    `SELECT last_hook_at, last_hook_status FROM networking.publish_state WHERE id = $1`,
    [input.stateId],
  );
  const lastHookAt = rows[0]?.last_hook_at ? new Date(rows[0].last_hook_at) : null;
  const decision = deployHookDecision({
    hookUrl,
    contentHash: input.contentHash,
    lastHookAt,
    lastHookStatus: rows[0]?.last_hook_status ?? null,
    now: input.now,
  });
  if (!decision.fire) return { fired: false, reason: decision.reason, retryAfterMs: decision.retryAfterMs };

  const result = await fireDeployHook(hookUrl!.trim(), { fetch: input.fetch, sleep: input.sleep });
  await input.q(
    `INSERT INTO networking.publish_state (id, last_hook_at, last_hook_status)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET last_hook_at = EXCLUDED.last_hook_at,
           last_hook_status = EXCLUDED.last_hook_status`,
    [input.stateId, input.now, hookStatusText(result, input.contentHash)],
  );
  return { fired: true, ok: result.ok, status: result.status, error: result.error };
}
