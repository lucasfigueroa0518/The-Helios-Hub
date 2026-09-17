/**
 * One glanceable health reading for a sending mailbox.
 *
 * Built from the same 7-day warmup / bounce / Postmaster signals the
 * lifecycle machine already uses. Missing data is omitted, never scored as
 * zero — Postmaster silence at this volume is expected, not a failing grade.
 */

export type InboxHealthInput = {
  warmupInboxRate: number | null;
  warmupSpamRate: number | null;
  bounceRate: number | null;
  postmasterReputation: string | null;
  connectionHealthy: boolean;
  warmupReputation: number | null;
};

export type InboxHealthTone = 'good' | 'watch' | 'poor' | 'unknown';

export type InboxHealth = {
  score: number | null;
  tone: InboxHealthTone;
  label: string;
  /** Hover text: the few signals behind the score. */
  detail: string;
};

const LABELS: Record<InboxHealthTone, string> = {
  good: 'Healthy',
  watch: 'Watch',
  poor: 'At risk',
  unknown: 'No data',
};

export function scoreInboxHealth(input: InboxHealthInput): InboxHealth {
  const parts: number[] = [];
  const inboxScore = scoreHigherBetter(input.warmupInboxRate, 0.6, 0.96);
  const spamScore = scoreLowerBetter(input.warmupSpamRate, 0.01, 0.05);
  const bounceScore = scoreLowerBetter(input.bounceRate, 0.005, 0.03);
  const postmasterScore = scorePostmaster(input.postmasterReputation);
  const reputationScore = scoreReputation(input.warmupReputation);

  if (inboxScore !== null) parts.push(inboxScore);
  if (spamScore !== null) parts.push(spamScore);
  if (bounceScore !== null) parts.push(bounceScore);
  if (postmasterScore !== null) parts.push(postmasterScore);
  if (reputationScore !== null) parts.push(reputationScore);

  const floored = floorTone(input);
  if (parts.length === 0) {
    return {
      score: null,
      tone: floored === 'poor' ? 'poor' : 'unknown',
      label: floored === 'poor' ? LABELS.poor : LABELS.unknown,
      detail: detailLine(input),
    };
  }

  let score = Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length);
  if (floored === 'poor') score = Math.min(score, 40);
  const tone: InboxHealthTone = floored === 'poor'
    ? 'poor'
    : score >= 80
      ? 'good'
      : score >= 55
        ? 'watch'
        : 'poor';

  return { score, tone, label: LABELS[tone], detail: detailLine(input) };
}

function scoreHigherBetter(value: number | null, bad: number, good: number): number | null {
  if (value === null) return null;
  return lerp(value, bad, good);
}

function scoreLowerBetter(value: number | null, good: number, bad: number): number | null {
  if (value === null) return null;
  return lerp(value, bad, good);
}

function lerp(value: number, zeroAt: number, hundredAt: number): number {
  if (zeroAt === hundredAt) return 100;
  const t = (value - zeroAt) / (hundredAt - zeroAt);
  return Math.max(0, Math.min(100, Math.round(t * 100)));
}

function scorePostmaster(reputation: string | null): number | null {
  if (!reputation) return null;
  switch (reputation.trim().toUpperCase()) {
    case 'HIGH':
      return 100;
    case 'MEDIUM':
      return 70;
    case 'LOW':
      return 30;
    case 'BAD':
      return 0;
    default:
      return null;
  }
}

function scoreReputation(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function floorTone(input: InboxHealthInput): InboxHealthTone | null {
  if (!input.connectionHealthy) return 'poor';
  if (input.bounceRate !== null && input.bounceRate >= 0.03) return 'poor';
  if (input.warmupSpamRate !== null && input.warmupSpamRate >= 0.05) return 'poor';
  const grade = input.postmasterReputation?.trim().toUpperCase();
  if (grade === 'LOW' || grade === 'BAD') return 'poor';
  return null;
}

function detailLine(input: InboxHealthInput): string {
  const bits: string[] = [];
  bits.push(
    input.warmupInboxRate === null
      ? 'Warmup: no data'
      : `Warmup inbox ${Math.round(input.warmupInboxRate * 100)}%`,
  );
  if (input.warmupSpamRate !== null) {
    bits.push(`spam ${Math.round(input.warmupSpamRate * 1000) / 10}%`);
  }
  bits.push(
    input.bounceRate === null
      ? 'Bounce: no data'
      : `Bounce ${Math.round(input.bounceRate * 1000) / 10}%`,
  );
  bits.push(
    input.postmasterReputation
      ? `Postmaster ${input.postmasterReputation}`
      : 'Postmaster quiet',
  );
  if (input.warmupReputation !== null) bits.push(`Smartlead ${Math.round(input.warmupReputation)}`);
  if (!input.connectionHealthy) bits.push('connection error');
  return bits.join(' · ');
}
