import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';

/**
 * Live spend meter for a render (E-06, E-17). Each assistant message the Agent
 * SDK streams — the orchestrator's and every frame worker's — is priced as it
 * arrives, so the run can be aborted the moment it passes the per-reel cap.
 * The SDK's own result total replaces the estimate when a session ends.
 */
export class SpendMeter {
  private estimated = 0;
  private settled = 0;
  private readonly seen = new Set<string>();

  constructor(
    readonly capUsd: number,
    /** Spend already recorded for this job before this meter started (e.g. a source fetch). */
    private readonly carriedUsd = 0,
  ) {}

  /** Session A's settled cost carried into session B, and so on. */
  get totalUsd(): number {
    return this.carriedUsd + this.settled + this.estimated;
  }

  /** The current session's streamed estimate, not yet settled. */
  get sessionEstimateUsd(): number {
    return this.estimated;
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
  observe(message: { id?: string | null; model?: string; usage?: MessageUsageLike['usage'] | null }): number {
    if (!message.usage || !message.model) return 0;
    if (message.id) {
      if (this.seen.has(message.id)) return 0;
      this.seen.add(message.id);
    }
    const usd = Number(
      priceAnthropicUsage(usageBucketsFromMessage({ usage: message.usage }, '5m'), { modelId: message.model }).costUsd,
    );
    this.estimated += usd;
    return usd;
  }

  /** A session ended: swap its running estimate for the SDK's reported total. */
  settleSession(sessionTotalUsd: number): void {
    this.settled += sessionTotalUsd;
    this.estimated = 0;
    this.seen.clear();
  }
}

/**
 * A render meter that also charges another meter as spend accrues (Targeted Revisions: a scene
 * redo's session is charged to the revision's ceiling message by message, while the job's own
 * per-reel cap still applies through the base class). Once `charge` throws, the error is kept,
 * nothing more is charged, and `overCap` turns true, so runAgentSession aborts the session at
 * once (it swallows errors from its stream loop, which is why the error is kept, not thrown).
 */
export class ChargedSpendMeter extends SpendMeter {
  private stopped: unknown = null;

  constructor(capUsd: number, carriedUsd: number, private readonly charge: (usd: number) => void) {
    super(capUsd, carriedUsd);
  }

  /** What `charge` threw (e.g. CeilingReached), or null. */
  get stopError(): unknown {
    return this.stopped;
  }

  private bill(usd: number): void {
    if (this.stopped !== null || !(usd > 0)) return;
    try {
      this.charge(usd);
    } catch (error) {
      this.stopped = error;
    }
  }

  override observe(message: Parameters<SpendMeter['observe']>[0]): number {
    const usd = super.observe(message);
    this.bill(usd);
    return usd;
  }

  /** The SDK's total can exceed the streamed estimate: the difference is charged too. */
  override settleSession(sessionTotalUsd: number): void {
    const streamed = this.sessionEstimateUsd;
    super.settleSession(sessionTotalUsd);
    this.bill(sessionTotalUsd - streamed);
  }

  override get overCap(): boolean {
    return super.overCap || this.stopped !== null;
  }
}
