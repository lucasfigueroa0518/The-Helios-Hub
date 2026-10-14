import type { Vertical } from '@/lib/social-hub/types';

/** Health colors: worked = green, short = yellow, failed = red, none = grey (didn't run / unknown). */
export type Tone = 'worked' | 'short' | 'failed' | 'none';
export type Severity = 'failed' | 'healed' | 'warning';

export type FailureEvent = {
  vertical: Vertical;
  night: string;
  at: string;
  stage: string;
  reason: string;
  severity: Severity;
  item?: { kind: string; id: string; label: string; href?: string };
  rawError?: string;
  spentUsd?: number;
  runId?: string;
};

export type FunnelStep = { stage: string; in: number; out: number };

export type NightReport = {
  vertical: Vertical;
  night: string;
  /** The type was live and had a quota that night. false → grey "Didn't run". */
  due: boolean;
  ran: boolean;
  target: number;
  made: number;
  /** Slots the day needs (the quota). */
  needed: number;
  /** Filled slots plus fresh drafts waiting for them. */
  ready: number;
  scheduledYesterday: number;
  postedYesterday: number;
  retriedOk: number;
  funnel: FunnelStep[];
  failures: FailureEvent[];
  spendUsd: number;
  /** Production calls whose cost is unknown (HeyGen). */
  unknownCostCalls: number;
  feedsStale: string[];
  nearCap: boolean;
  /** Set when this type's reporter threw; its checks go grey and Plumbing goes yellow. */
  reportError: string | null;
};

export type CheckId = 'made' | 'ready' | 'posted' | 'plumbing';
export type Check = { id: CheckId; tone: Tone; note: string };
export type TypeVerdict = { vertical: Vertical; tone: Tone; checks: Check[]; cause: string | null };
export type NightVerdict = { night: string; types: TypeVerdict[]; worked: number; total: number; publisher: Tone };
export type StoredReport = { night: string; builtAt: string; verdict: NightVerdict; reports: NightReport[]; failures: FailureEvent[] };
