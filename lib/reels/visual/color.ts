export const COLOR_PROFILES = ['noir', 'paper', 'orange'] as const;
export type ColorProfile = (typeof COLOR_PROFILES)[number];

export function isColorProfile(value: string): value is ColorProfile {
  return (COLOR_PROFILES as readonly string[]).includes(value);
}

/** Missing or unknown stored values are the original dark grade. */
export function colorProfileOrNoir(value: unknown): ColorProfile {
  return typeof value === 'string' && isColorProfile(value) ? value : 'noir';
}
