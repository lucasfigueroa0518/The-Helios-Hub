// lib/social-hub/slots/choose.ts
import { chooseFromWindows, uniformIndex, type PostingWindow, type WindowChoice } from '@/lib/instagram/window';

/**
 * A reel type's next slot (weekly slot calendar): Trial slots ignore feed
 * spacing (D33), Main slots keep ≥ 30 minutes from every feed post (SH-47).
 * Two searches, one per mode, then the earlier. Keys are `slotTakenKey`
 * (`date|slot`). Pure.
 */
export function chooseByFeedMode(
  windows: readonly PostingWindow[],
  now: Date,
  taken: ReadonlySet<string>,
  modes: { trial: ReadonlySet<string>; main: ReadonlySet<string> },
  busy: readonly Date[],
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): WindowChoice | null {
  const plus = (extra: ReadonlySet<string>) => new Set([...taken, ...extra]);
  const trial = chooseFromWindows(windows, now, plus(modes.main), [], rng, throughDate);
  const main = chooseFromWindows(windows, now, plus(modes.trial), busy, rng, throughDate);
  if (!trial) return main;
  if (!main) return trial;
  return trial.publishAt.getTime() <= main.publishAt.getTime() ? trial : main;
}
