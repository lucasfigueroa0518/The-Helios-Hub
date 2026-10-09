/**
 * Photo search and matching settings (Lucas, 2026-10-08: "photo search and
 * matching need to become more persistent"). One object, so an experiment
 * (scripts/social_photo_experiment.ts) can run arms with different settings
 * on the same saved drafts, and the winning settings become the defaults.
 *
 *   keep          candidates kept per request after ranking
 *   ladder        'short': the request, then (stock lanes only) its last two
 *                 words. 'deep': for scene kinds, when a request finds
 *                 nothing, the search is retried with its last two words,
 *                 then its head noun (story context in the screens guards
 *                 against homonyms)
 *   iconScenes    when both requests leave a slide without a photo, one more
 *                 search for a plain scene of the slide's icon (ICON_SCENES)
 *   slideFitMin   photo-slide fit below this: the photo doesn't belong
 *   repeatMax     photo-slide repeat at or above this: a repeat
 *   spreadMin     spread-fit at or above this: the spread may run
 *   vision        'strict': the stock close-up fails any person or face.
 *                 'faces': it fails only a person as the main subject or a
 *                 recognizable face (hands on a keyboard pass)
 */
export type PhotoTuning = {
  keep: number;
  ladder: 'short' | 'deep';
  iconScenes: boolean;
  slideFitMin: number;
  repeatMax: number;
  spreadMin: number;
  vision: 'strict' | 'faces';
};

/**
 * Defaults from the photo experiment (2026-10-08, runs/photo-experiment-2026-10-08; 4 saved posts, 33 slides):
 * A (old search, spread 0.65) 36% of slides got a photo; B (deep ladder + icon scenes + keep 4) 70%;
 * C (B + 'faces' vision + looser Jev gates 0.35/0.65) 73%. The looser gates added one photo and let weaker
 * ones through (a banquet hall for "rivals"), so the Jev gates stay at 0.5; 'faces' vision kept.
 */
export const DEFAULT_TUNING: PhotoTuning = { keep: 4, ladder: 'deep', iconScenes: true, slideFitMin: 0.5, repeatMax: 0.5, spreadMin: 0.65, vision: 'faces' };

let current: PhotoTuning = { ...DEFAULT_TUNING };

export const tuning = (): PhotoTuning => current;

/** Set some settings (an experiment arm); `reset` returns to the defaults first. */
export function setTuning(patch: Partial<PhotoTuning>, reset = false): PhotoTuning {
  current = { ...(reset ? DEFAULT_TUNING : current), ...patch };
  return current;
}

/** A plain, photographable scene for each icon (no people, no names): the last search before the icon. */
export const ICON_SCENES: Record<string, string> = {
  clock: 'wall clock',
  calendar: 'desk calendar',
  shield: 'padlock on a door',
  lock: 'padlock',
  'heart-pulse': 'hospital corridor',
  cpu: 'computer chip',
  server: 'server racks',
  code: 'code on a monitor',
  smartphone: 'smartphone on a desk',
  user: 'empty office chair',
  users: 'empty meeting room',
  'building-2': 'office building',
  landmark: 'government building columns',
  scale: 'courthouse columns',
  gavel: 'judge gavel',
  banknote: 'banknotes',
  briefcase: 'briefcase on a desk',
  globe: 'world globe',
  rocket: 'rocket launch',
  zap: 'power lines',
  'file-text': 'stack of documents',
  'message-square-quote': 'microphone on a stage',
  'graduation-cap': 'university lecture hall',
  factory: 'factory floor',
  search: 'magnifying glass',
  eye: 'security camera',
  bot: 'robot',
  newspaper: 'stack of newspapers',
  handshake: 'signed contract',
  'triangle-alert': 'warning sign',
};

/**
 * A two-word retry that starts with and/or/of is not a noun phrase
 * ("slides and documents" → "and documents"). Drop that filler so the
 * retry is the head noun, which the next step searches anyway.
 */
const LEADING_FILLER = /^(and|or|of)\s+/i;

export function lastTwoWords(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return '';
  return words.slice(-2).join(' ').replace(LEADING_FILLER, '');
}

/** The deep ladder's retries for a scene request: its last two words, then its head noun. */
export function ladderQueries(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const full = words.join(' ');
  const head = words.at(-1) ?? '';
  return [...new Set([lastTwoWords(full), head])].filter((q) => q && q !== full);
}
