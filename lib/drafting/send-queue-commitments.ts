/**
 * Standing capacity a live campaign will use on a future day, before any
 * individual email has a handoff date.
 *
 * `emails_per_day` is a snapshot of today's share and drops to 0 on a weekend,
 * so this uses the day's inbox pool instead.
 */
import type { IdentitySlug } from '@/lib/delivery-states';
import {
  allocateCapacityShares,
  forecastForLane,
  type LaneDemand,
} from '@/lib/inboxes/capacity';

export type CapacityClaim = {
  campaignId: string;
  name: string;
  identitySlug: IdentitySlug;
  /** 1–100. Null means the campaign wants the pool, then shares it with siblings. */
  capacityPct: number | null;
  /** Absolute daily cap. Ignored when capacityPct is set. */
  maxNewLeadsPerDay: number | null;
  queueColor: string | null;
  laneStatus: string | null;
};

/**
 * Each claim's share of its identity's pool for one day.
 * Shares that sum past the pool are scaled so two 100% campaigns split it.
 */
export function commitmentsByCampaign(input: {
  claims: CapacityClaim[];
  poolByIdentity: ReadonlyMap<string, number>;
}): Map<string, number> {
  const out = new Map<string, number>();
  const byIdentity = new Map<string, CapacityClaim[]>();
  for (const claim of input.claims) {
    const list = byIdentity.get(claim.identitySlug) ?? [];
    list.push(claim);
    byIdentity.set(claim.identitySlug, list);
  }

  for (const [identity, claims] of byIdentity) {
    const pool = input.poolByIdentity.get(identity) ?? 0;
    const lanes: LaneDemand[] = claims.map((claim) => ({
      laneId: claim.campaignId,
      campaignId: claim.campaignId,
      identitySlug: claim.identitySlug,
      demand: pool,
      maxNewLeadsPerDay: claim.capacityPct != null ? null : claim.maxNewLeadsPerDay,
      emailsPerDay: null,
      capacityPct: claim.capacityPct,
      laneReady: true,
    }));
    const allocated = allocateCapacityShares(lanes, pool);
    for (const claim of claims) {
      const seats = allocated.get(claim.campaignId) ?? 0;
      if (seats > 0) out.set(claim.campaignId, seats);
    }
  }
  return out;
}

/** Seats a campaign will still take after the emails already on that day. */
export function unfilledCommitment(commitment: number, slotted: number): number {
  return Math.max(0, commitment - Math.max(0, slotted));
}

/**
 * Planned is the larger of emails already on the day and the campaign's share.
 * Forecast is the larger of the queued-demand model and that same share.
 */
export function campaignDayPlan(input: {
  commitment: number;
  identityPool: number;
  itemCount: number;
  unsent: number;
  sent: number;
  isToday: boolean;
}): { planned: number; forecast: number } {
  const fromItems = forecastForLane({
    laneCapacityToday: input.identityPool,
    demand: input.unsent,
    actualToday: input.sent,
    isToday: input.isToday,
  });
  const fromShare = forecastForLane({
    laneCapacityToday: input.commitment,
    demand: Math.max(input.commitment, input.unsent),
    actualToday: input.sent,
    isToday: input.isToday,
  });
  return {
    planned: Math.max(input.itemCount, input.commitment),
    forecast: Math.max(fromItems, fromShare),
  };
}
