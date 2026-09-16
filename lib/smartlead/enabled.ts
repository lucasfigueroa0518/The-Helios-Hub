/**
 * Kill switch for every Smartlead-facing code path.
 *
 * The orchestration worker is shared with enrichment and drafting. A bad
 * Smartlead deploy must never take those lanes down, so every `smartlead.*`,
 * `inbox.*`, and `postmaster.daily` handler short-circuits on this flag and
 * the webhook route answers 503 so Smartlead retries later.
 */

export const SMARTLEAD_DISABLED_RESULT = { skipped: 'smartlead_disabled' as const };

export function isSmartleadEnabled(): boolean {
  return process.env.SMARTLEAD_ENABLED?.trim().toLowerCase() === 'true';
}

/** True when the flag is on *and* a key exists — the precondition for any API call. */
export function isSmartleadConfigured(): boolean {
  return isSmartleadEnabled() && Boolean(process.env.SMARTLEAD_API_KEY?.trim());
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

export function assertSmartleadEnabled(operation?: string): void {
  if (!isSmartleadEnabled()) throw new SmartleadDisabledError(operation);
}
