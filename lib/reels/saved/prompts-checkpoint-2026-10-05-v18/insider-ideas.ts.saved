/**
 * D-212. The kinds of insider ideas the on-screen copy cannot turn on. The
 * writer (P-10) and the plain-read judge (P-15) read this same text, so a
 * change here is a new COPY_PROMPT_VERSION and a new copy-pick version.
 *
 * The list names kinds, not words, so it does not have to grow with the news.
 */

export const INSIDER_IDEA_DEFINITION =
  'An insider idea is anything a person who uses AI, but never reads tech news, would have to look up. It fails the copy whether it is one word or a whole clause.';

export const INSIDER_IDEA_KINDS = [
  'How AI works inside: tokens, parameters, context windows, training runs, fine-tuning, reasoning or effort settings.',
  'How AI is measured: benchmark names and their scores, evals, leaderboards, test rules, a percentage on a named test.',
  'How software works underneath: APIs, requests, filters, proxies, encoding, servers, repos, database settings and permissions.',
  'Safety and security terms of art: alignment, sandbox escapes, prompt injection, jailbreaks, red teams.',
  'Chips and computing power: chip names, data-center capacity, compute deals.',
  'Names only insiders track: model version numbers, codenames, developer tools and platforms the viewer never opens, researchers known only in the field.',
  'Mechanism chains: a step-by-step account of how software did something, even in plain words.',
] as const;

export const INSIDER_IDEA_TEST =
  'The test for every noun and every clause: would the viewer need to know how a system works to follow the line?';

export function insiderIdeaList(): string {
  return INSIDER_IDEA_KINDS.map((kind, index) => `${index + 1}. ${kind}`).join('\n');
}
