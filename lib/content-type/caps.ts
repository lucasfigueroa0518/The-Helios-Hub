import { DEFAULT_MAX_CAP, configFor } from '@/lib/content-type/config';

/**
 * The daily limit's bounds (week board spec §Safety cap), in a module with no
 * server imports so the type page's control (components/content-type/
 * TypeControls.tsx) and the write check (posting.ts) share one value.
 * slots/write.ts writeCaps takes 0–10; Last Few Days runs once a day; AI Events at most twice (Miami and Boston, AE-29).
 */
export const MAX_CAP = DEFAULT_MAX_CAP;

/** A type's own limit comes from its config entry (lib/content-type/config.ts); an unknown id gets the default. */
export const maxCapFor = (type: string): number => configFor(type)?.maxCap ?? MAX_CAP;
