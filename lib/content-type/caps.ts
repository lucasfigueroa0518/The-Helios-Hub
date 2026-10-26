/**
 * The daily limit's bounds (week board spec §Safety cap), in a module with no
 * server imports so the type page's control (components/content-type/
 * TypeControls.tsx) and the write check (posting.ts) share one value.
 * slots/write.ts writeCaps takes 0–10; Last Few Days runs once a day; AI Events at most twice (Miami and Boston, AE-29).
 */
export const MAX_CAP = 10;

export const maxCapFor = (type: string): number => (type === 'last_few_days' ? 1 : type === 'ai_events' ? 2 : MAX_CAP);
