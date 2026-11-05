import { HUB_TIMING_HEADER } from '@/lib/social-hub/server-timing-path';

export { HUB_TIMING_HEADER };

export const HUB_SPANS = ['dataset', 'extras', 'sign', 'week'] as const;
export type HubSpan = (typeof HUB_SPANS)[number];

type Slot = {
  pending: number;
  spans: Map<string, number>;
  /** Null until every entered render has left. Empty string means no spans. */
  sealed: string | null;
  waiters: Array<() => void>;
};

type Bag = Map<string, Slot>;

const KEY = '__heliosHubTiming';

function bag(): Bag {
  const g = globalThis as typeof globalThis & { [KEY]?: Bag };
  return (g[KEY] ??= new Map());
}

function ensure(id: string): Slot {
  const existing = bag().get(id);
  if (existing) return existing;
  const slot: Slot = { pending: 0, spans: new Map(), sealed: null, waiters: [] };
  bag().set(id, slot);
  const timer = setTimeout(() => {
    const current = bag().get(id);
    if (current === slot && current.sealed === null) bag().delete(id);
  }, 30_000);
  timer.unref?.();
  return slot;
}

function headerFor(slot: Slot): string {
  return HUB_SPANS
    .filter((name) => slot.spans.has(name))
    .map((name) => `${name};dur=${slot.spans.get(name)!.toFixed(1)}`)
    .join(', ');
}

/** One render on this request started. False once the response is already sealed. */
export function enterHubTiming(id: string): boolean {
  const slot = ensure(id);
  if (slot.sealed !== null) return false;
  slot.pending += 1;
  return true;
}

/** Record one span. Later spans with the same name add to it. */
export function addHubSpan(id: string, name: HubSpan, dur: number): void {
  const slot = bag().get(id);
  if (!slot || slot.sealed !== null || !Number.isFinite(dur)) return;
  slot.spans.set(name, (slot.spans.get(name) ?? 0) + dur);
}

/** One render finished. The header seals when the last one does. */
export function leaveHubTiming(id: string): void {
  const slot = bag().get(id);
  if (!slot || slot.sealed !== null) return;
  slot.pending -= 1;
  if (slot.pending > 0) return;
  slot.sealed = headerFor(slot);
  const waiters = slot.waiters.splice(0);
  for (const waiter of waiters) waiter();
  const timer = setTimeout(() => bag().delete(id), 30_000);
  timer.unref?.();
}

/** The sealed header, or undefined if this request has not sealed. */
export function hubTimingValue(id: string): string | undefined {
  const slot = bag().get(id);
  if (!slot || slot.sealed === null) return undefined;
  return slot.sealed;
}

/** Fire immediately if the request is already sealed. */
export function onHubTimingSealed(id: string, cb: () => void): void {
  const slot = ensure(id);
  if (slot.sealed !== null) {
    cb();
    return;
  }
  slot.waiters.push(cb);
}
