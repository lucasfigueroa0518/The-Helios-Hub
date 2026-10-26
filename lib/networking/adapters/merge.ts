import { definedOnly, mergeSourceTags } from '@/lib/networking/signals';
import type { CandidateEvent } from '@/lib/networking/types';

/**
 * Fold a second copy of the same source event into the first. The first copy keeps its
 * values; the copy fills anything missing (host name, city, signals) and a trusted copy makes
 * the merged event trusted. Source tags are unioned, so an event found by both the `boston` and
 * the `ai` discover feeds carries both. Used for Luma calendar copies and Meetup group-page
 * copies, which arrive after the discover/find copy and carry the host.
 */
export function mergeCandidateCopy(target: CandidateEvent, copy: CandidateEvent): CandidateEvent {
  const filled = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(copy)) {
    if (value == null || value === '') continue;
    if (key === 'sourceTags' || key === 'signals' || key === 'raw') continue;
    const current = filled[key];
    if (current == null || current === '' || (Array.isArray(current) && current.length === 0)) filled[key] = value;
  }
  target.sourceTags = mergeSourceTags(target.sourceTags, copy.sourceTags);
  if (copy.signals) target.signals = { ...copy.signals, ...definedOnly(target.signals) };
  if (!target.raw && copy.raw) target.raw = copy.raw;
  target.trusted = target.trusted || copy.trusted;
  return target;
}

/** Add a batch keyed by source event id, merging repeats instead of dropping them. Map order is arrival order. */
export function addCandidateBatch(byId: Map<string, CandidateEvent>, batch: CandidateEvent[]): void {
  for (const event of batch) {
    const existing = byId.get(event.sourceEventId);
    if (existing) mergeCandidateCopy(existing, event);
    else byId.set(event.sourceEventId, event);
  }
}
