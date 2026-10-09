/**
 * One plain line per factor whose name is pipeline shorthand (critique
 * 2026-10-08, P2-E). Only factors whose meaning is settled in code get one;
 * the rest are self-explanatory or left unglossed rather than guessed.
 */
const GLOSS: Record<string, string> = {
  psychology: 'the psychological angle the script was written to: curiosity, arousal or identity.',
  blockbuster: 'whether the subject scored high enough to count as a blockbuster when it was picked.',
  origin: 'whether the idea was picked fresh that day or carried over from an earlier day.',
  score: 'the score the idea had when it was picked.',
  weighted: 'the weighted score the idea had when it was picked.',
  jevAudience: 'how our idea judge rated its fit for the audience.',
  jevTeach: 'how our idea judge rated how teachable it is.',
  jevAnalogy: 'how our idea judge rated its analogy.',
  jevVisual: 'how our idea judge rated how well it shows on screen.',
  jevAccuracy: 'how our idea judge rated its accuracy once simplified.',
  jevHook: 'how our idea judge rated its hook.',
  slot: 'the posting window it went out in.',
};

/** Hook means different things per type, so its gloss is keyed by type. */
const BY_TYPE: Record<string, Record<string, string>> = {
  carousels: { hook: 'whether the hook pass ran: an extra step that adds one hook line per slide.' },
  explainers: { origin: 'where the topic came from: our seed list, the nightly idea run, or added by hand.' },
};

export function factorGloss(vertical: string, factor: string): string | null {
  return BY_TYPE[vertical]?.[factor] ?? GLOSS[factor] ?? null;
}
