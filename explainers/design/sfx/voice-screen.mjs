// The voice screen: no voice but our narrator ever reaches a reel (2026-11-19).
//
// A reel's audio is our narration plus three outside sources: library sound effects, ambience
// beds and a music bed from HeyGen's catalog (AI-generated tracks, which can hide a phantom vocal
// even when described as instrumental). The 2026-11-18 Explainers reel carried a stray voice
// ("This is…") under the narration. So every outside sound is screened for speech and singing
// before it may play, and anything not screened does not play either:
//
//   voice-screen.json   per library file and per catalog track: the highest speech/singing
//                       confidence measured (macOS SoundAnalysis, tools/voice-screen.mjs)
//
// loadLibrary() and loadAmbience() drop every sound at or above VOICE_MAX and every sound the
// screen has not measured; the three music pickers (Explainers, Reel AI Drama, Real Case) take a
// track only when the screen measured it below MUSIC_VOICE_MAX and its catalog text names no
// vocals. A new drop-in or a new catalog track stays out of every reel until a Mac screens it:
//
//   node explainers/design/sfx/tools/voice-screen.mjs            screen new library sounds
//   node explainers/design/sfx/tools/voice-screen.mjs --music    screen the music catalog

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VOICE_SCREEN_FILE = 'voice-screen.json';
/** A sound effect or bed at or above this speech/singing confidence never plays. */
export const VOICE_MAX = 0.35;
/** A music track at or above this never plays (stricter: a phantom vocal hides inside dense music). */
export const MUSIC_VOICE_MAX = 0.3;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Catalog words that mean a track carries a voice ("no vocals" and the like do not count). */
export const VOICE_WORDS = /\b(vocals?|vox|voices?|vocalist|singing|singer|sung|songs?|rap|rapping|rapper|lyrics?|lyrical|spoken|speech|talking|chant\w*|choir|choral|a ?cappella|acapella|humming|whisper\w*|narrat\w*|announcer|shout\w*|scat)\b/i;
const NEGATED = /\b(no|without|zero|free of|minus|non)[\s-]+(?:\w+[\s-]+)?(vocals?|vox|voices?|singing|lyrics?|rap|speech|choir|words)\b/gi;

/** True when catalog text names a voice in the track. */
export function mentionsVoice(text) {
  return VOICE_WORDS.test(String(text ?? '').replace(NEGATED, ' '));
}

/** The screen at `dir` ({ sounds, music }), or null when that folder has none. */
export function loadVoiceScreen(dir = HERE) {
  const file = join(dir, VOICE_SCREEN_FILE);
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return { sounds: v?.sounds ?? {}, music: v?.music ?? {} };
  } catch {
    // a broken screen clears nothing
    return { sounds: {}, music: {} };
  }
}

/** Sound names that mean people talking, whatever the meter says (crowds are made of voices). */
export const VOICE_NAMES = /(^|[^a-z])(crowd\w*|people|kids?|child\w*|chatter\w*|conversation|talk\w*|speech|speak\w*|voices?|vocal\w*|announce\w*|walla|newsroom|cafe|canteen|class(room)?|party|mall|tv-not-working)([^a-z]|$)/i;

/** True when the library sound `file` was screened, carries no voice, and is not named for people talking. */
export function soundVoiceFree(screen, file) {
  const v = screen?.sounds?.[file];
  return typeof v === 'number' && v < VOICE_MAX && !VOICE_NAMES.test(String(file).split('/').pop() ?? '');
}

const trackText = (t) => `${t?.name ?? ''} ${t?.description ?? ''} ${(t?.tags ?? []).join?.(' ') ?? ''}`;
const trackKey = (t) => String(t?.id ?? t?.audio_id ?? t?.name ?? t?.audio_url ?? '');

/**
 * True when a catalog track may play: its text names no voice and the screen measured it below
 * MUSIC_VOICE_MAX. `screen` defaults to the library's own (this folder's voice-screen.json).
 */
export function trackVoiceFree(track, screen = loadVoiceScreen(HERE)) {
  if (mentionsVoice(trackText(track))) return false;
  const v = screen?.music?.[trackKey(track)]?.voice;
  return typeof v === 'number' && v < MUSIC_VOICE_MAX;
}

/** Why a pick found no track, when the screen is the reason: the command that clears new tracks. */
export const MUSIC_SCREEN_HINT = 'unscreened catalog tracks never play: run `node explainers/design/sfx/tools/voice-screen.mjs --music` on a Mac and commit voice-screen.json';
