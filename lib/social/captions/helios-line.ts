/**
 * The Helios line: one generic, code-written sentence about who runs the page and what it gives the
 * reader (planning/Caption Voice/PLAN.md decisions 4, 9, 13). No model writes it, so it never makes
 * claims about how Helios relates to a story. A hash of (type, seed) picks one of BASES × VALUES[type],
 * so the same post always gets the same line and a re-render keeps it.
 */
export type HeliosLineType = 'lfd' | 'field_notes' | 'ai_drama' | 'explainers';

/** `{value}` is filled from VALUES. Every value must read well in every base. */
export const HELIOS_LINE_BASES: readonly string[] = [
  'We built this page to help you stay ahead of AI. Follow for more {value}.',
  'AI moves fast. We built this page to help you keep up. Follow for more {value}.',
  "We're Helios, a team of AI engineers. This page is where we share {value}.",
  'We build AI systems for a living, and this page is where we share what we learn. Follow for more {value}.',
  "Glad you're here. We're Helios, and we post {value} to help you stay ahead of AI.",
  'This page is run by Helios, a team that builds AI for businesses. Follow for more {value}.',
  "We work with AI every day, so you don't have to keep up alone. Follow for more {value}.",
  'Staying ahead of AI is our job. Sharing it with you is why this page exists. Follow for more {value}.',
];

export const HELIOS_LINE_VALUES: Readonly<Record<HeliosLineType, readonly string[]>> = {
  lfd: ['AI news worth knowing', 'quick catch-ups on what changed in AI'],
  field_notes: ['AI tips you can try today', 'AI workflows worth stealing'],
  ai_drama: ['real stories from inside AI', 'stories about the people and fights shaping AI'],
  explainers: ['AI explained in plain words', 'AI ideas made simple'],
};

/** FNV-1a: small, stable across runtimes, good enough to spread seeds over a few combos. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Every line a type can get, in a fixed order. */
export function heliosLines(type: HeliosLineType): string[] {
  return HELIOS_LINE_BASES.flatMap((base) => HELIOS_LINE_VALUES[type].map((value) => base.replace('{value}', value)));
}

/** The line for this post. `seed` must be stable for the post (its id, its job id, or its story keys). */
export function heliosLine(type: HeliosLineType, seed: string): string {
  const all = heliosLines(type);
  return all[hash(`${type}:${seed}`) % all.length]!;
}

/** The longest line a type can get: length gates check against it, so any pick fits. */
export function longestHeliosLine(type: HeliosLineType): string {
  return heliosLines(type).reduce((a, b) => (b.length > a.length ? b : a));
}
