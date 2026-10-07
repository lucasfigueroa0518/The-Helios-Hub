/**
 * Helios-designed graphics (spec §5.1 Photo chain v1): made by Claude Code
 * from the Helios design system, approved once by Tommy. Off in the daily
 * run until he approves them; the sample renders in
 * runs/designed-graphics-2026-10-07/ turn them on for that render only.
 *
 *   statBackgrounds  stat slides use a `stat-background` from the bank
 *                    (bank.ts) instead of plain dark
 *   coverCard        the branded cover card replaces the starter set on a
 *                    cover with no photo, headshot or logo
 */
export const DESIGNED_GRAPHICS = { statBackgrounds: false, coverCard: false } as const;
