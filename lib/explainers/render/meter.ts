import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';

/**
 * Live spend meter for a render (E-06, E-17). Each assistant message the Agent
 * SDK streams — the orchestrator's and every frame worker's — is priced as it
 * arrives, so the run can be aborted the moment it passes the per-reel cap.
 * The SDK's own result total replaces the estimate when a session ends.
 */
export class SpendMeter {
  /**
   * Each running session's streamed estimate, by its key (begin()). Parallel sessions (the code build
   * runner's frame builders, the picture fix) each settle only their own; DEFAULT is the one-at-a-time key.
   */
  private readonly estimates = new Map<symbol, number>();
  private static readonly DEFAULT = Symbol('session');
  private settled = 0;
  private readonly seen = new Set<string>();

  constructor(
    readonly capUsd: number,
    /** Spend already recorded for this job before this meter started (e.g. a source fetch). */
    private readonly carriedUsd = 0,
  ) {}

  /** Session A's settled cost carried into session B, and so on. */
  get totalUsd(): number {
    let estimated = 0;
    for (const v of this.estimates.values()) estimated += v;
    return this.carriedUsd + this.settled + estimated;
  }

  /** The current session's streamed estimate, not yet settled. */
  get sessionEstimateUsd(): number {
    return this.estimateOf();
  }

  /** A new session's key, for observe() and settleSession() when sessions run in parallel. */
  begin(): symbol {
    const key = Symbol('session');
    this.estimates.set(key, 0);
    return key;
  }

  /** One session's streamed estimate, not yet settled. */
  estimateOf(key: symbol = SpendMeter.DEFAULT): number {
    return this.estimates.get(key) ?? 0;
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.totalUsd);
  }

  get overCap(): boolean {
    return this.totalUsd > this.capUsd;
  }

  /**
   * Price one streamed assistant message. Messages are deduplicated by id, since
   * the SDK may stream the same message in more than one frame.
   */
  observe(message: { id?: string | null; model?: string; usage?: MessageUsageLike['usage'] | null }, key: symbol = SpendMeter.DEFAULT): number {
    if (!message.usage || !message.model) return 0;
    if (message.id) {
      if (this.seen.has(message.id)) return 0;
      this.seen.add(message.id);
    }
    const usd = Number(
      priceAnthropicUsage(usageBucketsFromMessage({ usage: message.usage }, '5m'), { modelId: message.model }).costUsd,
    );
    this.estimates.set(key, this.estimateOf(key) + usd);
    return usd;
  }

  /**
   * A direct Messages API call made outside any session (Explainers 4.2: the understanding test's
   * readers and diagnosis), priced by the caller. Call it between sessions, never during one.
   */
  charge(usd: number): void {
    if (Number.isFinite(usd) && usd > 0) this.settled += usd;
  }

  /** A session ended: swap its running estimate for the SDK's reported total. */
  settleSession(sessionTotalUsd: number, key: symbol = SpendMeter.DEFAULT): void {
    this.settled += sessionTotalUsd;
    this.estimates.delete(key);
    // message ids are unique across sessions, so `seen` is kept (a parallel session's ids stay deduplicated)
  }
}
