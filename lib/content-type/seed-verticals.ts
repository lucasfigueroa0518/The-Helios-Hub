import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

/** The one button every idea pool shows. Same words everywhere; only the form inside the drawer differs by type. */
export const SEED_BUTTON = { label: 'Seed an idea', title: 'Seed an idea' } as const;

/** Idea pools with a seed path. AI Events has none yet (decided 2026-11-02: not built); AI Drama pitches come from development sessions. */
export type SeedVertical = Exclude<Vertical, 'ai_events' | 'reel_ai_drama'>;

export const isSeedable = (vertical: Vertical): vertical is SeedVertical => vertical !== 'ai_events' && vertical !== 'reel_ai_drama';

export const seedableVerticals = (): SeedVertical[] => VERTICAL_IDS.filter(isSeedable);
