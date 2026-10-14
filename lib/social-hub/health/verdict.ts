import type { Check, NightReport, NightVerdict, Tone, TypeVerdict } from '@/lib/social-hub/health/types';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';

const RANK: Record<Tone, number> = { none: 0, worked: 1, short: 2, failed: 3 };

export function worst(tones: readonly Tone[]): Tone {
  return tones.reduce<Tone>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none');
}

export function checksFor(r: NightReport, publisher: Tone): Check[] {
  if (r.reportError) {
    return [
      { id: 'made', tone: 'none', note: 'Unknown' },
      { id: 'ready', tone: 'none', note: 'Unknown' },
      { id: 'posted', tone: 'none', note: 'Unknown' },
      { id: 'plumbing', tone: 'short', note: "Couldn't read this type's data" },
    ];
  }
  const made: Check = !r.due
    ? { id: 'made', tone: 'none', note: "Didn't run" }
    : !r.ran
      ? { id: 'made', tone: 'failed', note: 'Did not run' }
      : { id: 'made', tone: r.made < r.target ? 'failed' : 'worked', note: `${r.made} of ${r.target} made` };
  const ready: Check = r.needed === 0
    ? { id: 'ready', tone: r.due ? 'worked' : 'none', note: 'Nothing needed' }
    : { id: 'ready', tone: r.ready === 0 ? 'failed' : r.ready < r.needed ? 'short' : 'worked', note: `${Math.min(r.ready, r.needed)} of ${r.needed} slots covered` };
  const posted: Check = r.scheduledYesterday === 0
    ? { id: 'posted', tone: r.due ? 'worked' : 'none', note: 'Nothing scheduled' }
    : {
        id: 'posted',
        tone: r.postedYesterday < r.scheduledYesterday ? 'failed' : r.retriedOk > 0 ? 'short' : 'worked',
        note: `${r.postedYesterday} of ${r.scheduledYesterday} posted${r.retriedOk ? `, ${r.retriedOk} after a retry` : ''}`,
      };
  const plumbing: Check = publisher === 'failed'
    ? { id: 'plumbing', tone: 'failed', note: 'Publisher stopped' }
    : r.feedsStale.length
      ? { id: 'plumbing', tone: 'short', note: `${r.feedsStale[0]} stale` }
      : r.nearCap
        ? { id: 'plumbing', tone: 'short', note: 'Spend near the cap' }
        : { id: 'plumbing', tone: 'worked', note: 'All fresh' };
  return [made, ready, posted, plumbing];
}

export function typeVerdict(r: NightReport, publisher: Tone): TypeVerdict {
  const checks = checksFor(r, publisher);
  const tone = !r.due && !r.reportError ? 'none' : worst(checks.map((c) => c.tone));
  const lead = r.failures.find((f) => f.severity === 'failed') ?? r.failures.find((f) => f.severity !== 'healed');
  const cause = lead
    ? `${stageLabel(lead.stage)}: ${REASON_LABEL[lead.reason] ?? lead.reason}`
    : checks.find((c) => c.tone === 'failed' || c.tone === 'short')?.note ?? null;
  return { vertical: r.vertical, tone, checks, cause: tone === 'worked' || tone === 'none' ? null : cause };
}

export function nightVerdict(night: string, reports: readonly NightReport[], publisher: Tone): NightVerdict {
  const types = reports.map((r) => typeVerdict(r, publisher));
  const counted = types.filter((t) => t.tone !== 'none');
  return { night, types, total: counted.length, worked: counted.filter((t) => t.tone !== 'failed').length, publisher };
}
