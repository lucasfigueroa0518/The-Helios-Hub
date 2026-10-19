import { BLUE_CHIP_SPREAD_KEYS } from '@/lib/social-hub/blue-chip-players';

/**
 * Which company a story is mainly about, from its headline, for the pool's
 * spread rule (rank.ts `spreadByCompany`): a few products map to their maker
 * (Claude → Anthropic, Gemini → Google) and an executive to their company
 * (Dario Amodei → Anthropic). The patterns come from the shared blue-chip list
 * (lib/social-hub/blue-chip-players.ts). The first name in the headline wins.
 * Plain code, no model call; a story naming none of these has no key and is
 * never held back.
 */
export function companyKey(headline: string): string | null {
  let best: { key: string; at: number } | null = null;
  for (const [key, pattern] of BLUE_CHIP_SPREAD_KEYS) {
    const m = pattern.exec(headline);
    if (m && (best === null || m.index < best.at)) best = { key, at: m.index };
  }
  return best?.key ?? null;
}
