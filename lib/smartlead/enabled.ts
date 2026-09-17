/**
 * Kill switch for Smartlead *sending* (campaigns, handoff, webhooks, daily
 * lifecycle). Account listing and warmup can run with an API key while the
 * flag is off, so the Inboxes tab can still see mailboxes that already exist
 * in Smartlead.
 *
 * The orchestration worker is shared with enrichment and drafting. A bad
 * Smartlead deploy must never take those lanes down, so every `smartlead.*`
 * send handler short-circuits on this flag and the webhook route answers 503
 * so Smartlead retries later.
 */

export const SMARTLEAD_DISABLED_RESULT = { skipped: 'smartlead_disabled' as const };

export function isSmartleadEnabled(): boolean {
  return process.env.SMARTLEAD_ENABLED?.trim().toLowerCase() === 'true';
}

export function hasSmartleadApiKey(): boolean {
  return Boolean(process.env.SMARTLEAD_API_KEY?.trim());
}

/** True when the flag is on *and* a key exists — the precondition for sending. */
export function isSmartleadConfigured(): boolean {
  return isSmartleadEnabled() && hasSmartleadApiKey();
}

export class SmartleadDisabledError extends Error {
  readonly code = 'smartlead_disabled';

  constructor(operation?: string) {
    super(
      operation
        ? `Smartlead is disabled (SMARTLEAD_ENABLED is not "true"); refusing ${operation}`
        : 'Smartlead is disabled (SMARTLEAD_ENABLED is not "true")',
    );
    this.name = 'SmartleadDisabledError';
  }
}

export class SmartleadUnconfiguredError extends Error {
  readonly code = 'smartlead_unconfigured';

  constructor(operation?: string) {
    super(
      operation
        ? `Smartlead API key is missing; refusing ${operation}`
        : 'Smartlead API key is missing',
    );
    this.name = 'SmartleadUnconfiguredError';
  }
}

export function assertSmartleadEnabled(operation?: string): void {
  if (!isSmartleadEnabled()) throw new SmartleadDisabledError(operation);
}

/** Inbox control-plane calls (list accounts, warmup) need a key, not the send flag. */
export function assertSmartleadApiKey(operation?: string): void {
  if (!hasSmartleadApiKey()) throw new SmartleadUnconfiguredError(operation);
}
