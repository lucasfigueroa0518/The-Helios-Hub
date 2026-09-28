/**
 * P-14, approved 2026-09-27 (D-180 to D-183). The three fixed vocabularies CLAP
 * picks from, the sentence each label is scored as, and the rule that turns
 * CLAP's scores into tags (MUS-V1).
 *
 * Bump `version` whenever a label, template, or setting changes. Stored songs
 * record the version they were tagged with.
 */

export const SONG_VOCAB_VERSION = 'song-vocab-v1';

/**
 * One genre per song. Coarse on purpose: the pool also holds speech, meme, and
 * voiceover sounds (D-143), so non-music "genres" sit beside the music ones.
 */
export const GENRES = [
  'pop', 'dance pop', 'k-pop', 'hip hop', 'trap', 'drill', 'phonk', 'R&B', 'soul', 'funk', 'disco',
  'house', 'techno', 'EDM', 'drum and bass', 'dubstep', 'lo-fi', 'ambient', 'synthwave', 'rock',
  'indie', 'metal', 'punk', 'country', 'folk', 'acoustic', 'jazz', 'blues', 'classical',
  'cinematic orchestral', 'latin', 'reggaeton', 'afrobeats', 'amapiano', 'reggae', 'gospel',
  'spoken word', 'comedy sound', 'sound effects',
] as const;

/** One to three per song. */
export const INSTRUMENTS = [
  'male vocals', 'female vocals', 'rap vocals', 'choir', 'spoken voice', 'whistling',
  'acoustic guitar', 'electric guitar', 'bass guitar', 'synth bass', '808 bass',
  'piano', 'electric piano', 'organ', 'synthesizer', 'strings', 'violin', 'cello', 'harp',
  'brass', 'saxophone', 'trumpet', 'flute', 'bells',
  'drum kit', 'drum machine', 'hand percussion', 'claps and snaps', 'sound effects',
] as const;

/** Five to ten per song. */
export const VIBES = [
  'energetic', 'hype', 'bouncy', 'groovy', 'driving', 'urgent', 'chaotic', 'aggressive',
  'confident', 'triumphant', 'epic', 'dramatic', 'cinematic', 'tense', 'suspenseful', 'ominous',
  'dark', 'eerie', 'mysterious', 'hypnotic', 'futuristic', 'glitchy', 'cold', 'gritty',
  'polished', 'luxurious', 'minimal', 'calm', 'chill', 'relaxed', 'peaceful', 'dreamy', 'warm',
  'uplifting', 'inspirational', 'happy', 'playful', 'quirky', 'whimsical', 'funny', 'romantic',
  'sensual', 'sad', 'melancholic', 'bittersweet', 'nostalgic', 'emotional', 'contemplative',
  'serious', 'rebellious',
] as const;

export type Genre = (typeof GENRES)[number];
export type Instrument = (typeof INSTRUMENTS)[number];
export type Vibe = (typeof VIBES)[number];

/** Non-music genres read wrong as "{label} music", so they get their own sentence. */
const NON_MUSIC_GENRES: ReadonlySet<string> = new Set(['spoken word', 'comedy sound', 'sound effects']);

/** The sentence CLAP's text encoder embeds for each label. Part of the approval. */
export function labelSentence(kind: 'genre' | 'instrument' | 'vibe', label: string): string {
  if (kind === 'genre') return NON_MUSIC_GENRES.has(label) ? `This is ${label}.` : `This is ${label} music.`;
  if (kind === 'instrument') return `This audio features ${label}.`;
  return `This audio sounds ${label}.`;
}

/**
 * MUS-V1 / D-182: the relative rule. Every label whose CLAP score (cosine
 * similarity between the song's audio embedding and the label sentence's text
 * embedding) is within `margin` of that vocabulary's best score, clamped to
 * MUS-09's ranges by rank. Genre is always the single best label.
 */
export const TAG_MARGIN = 0.05;

export const INSTRUMENT_RANGE = { min: 1, max: 3 } as const;
export const VIBE_RANGE = { min: 5, max: 10 } as const;

export type SongTags = { genre: string; bpm: number | null; instruments: string[]; vibes: string[] };

export type LabelScores = Record<string, number>;

/** Labels best first; ties break alphabetically so a rerun tags identically. */
function ranked(scores: LabelScores): Array<[string, number]> {
  return Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Within `margin` of the best, then at least `min` and at most `max` by rank. */
export function selectRelative(
  scores: LabelScores,
  range: { min: number; max: number },
  margin: number = TAG_MARGIN,
): string[] {
  const order = ranked(scores);
  if (order.length === 0) return [];
  const best = order[0][1];
  const within = order.filter(([, score]) => best - score <= margin).length;
  const count = Math.min(range.max, Math.max(range.min, within), order.length);
  return order.slice(0, count).map(([label]) => label);
}

/** CLAP scores for all three vocabularies, plus the measured BPM, to MUS-09 tags. */
export function tagsFromScores(input: {
  genre: LabelScores;
  instrument: LabelScores;
  vibe: LabelScores;
  bpm: number | null;
}): SongTags {
  const genre = ranked(input.genre)[0]?.[0];
  if (!genre) throw new Error('No genre scores.');
  return {
    genre,
    bpm: input.bpm,
    instruments: selectRelative(input.instrument, INSTRUMENT_RANGE),
    vibes: selectRelative(input.vibe, VIBE_RANGE),
  };
}

/**
 * The song's side of the narrowing (D-147): the text CLAP embeds and compares
 * with the reel's copy. BPM is left out because a text encoder reads a number
 * poorly; Jev still sees it (D-150). Part of the approval.
 */
export function songTagText(tags: SongTags): string {
  return `${tags.genre} with ${tags.instruments.join(', ')}. It sounds ${tags.vibes.join(', ')}.`;
}
