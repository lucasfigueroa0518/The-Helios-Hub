/**
 * AI Trivia music (AT-17, AT-26, AT-27): one fixed calm, slightly groovy mood from HeyGen's music
 * catalog, reached the way the AI Drama kit reaches it (explainers/reel-ai-drama/kit/music.mjs: the
 * hyperframes media-use heygen.mjs under explainers/runtime). The kit's STYLES and BANNED words are
 * tense documentary beds and ban "groove", so this mood keeps its own query and word list.
 *
 * A track used in the last RECENT_SETS sets is not picked while a fresh one exists; when every result
 * is recent, the least recently used one plays (the rotation never fails a set).
 *
 * The window: clip 1 plays the track from `startMs`, clip 2 from `startMs + CLIP_MS`. The sting starts
 * on clip 2's first frame and hits at +HIT_MS, so the music is placed with a beat exactly on
 * `startMs + CLIP_MS + HIT_MS` (the sting is never moved). Code only, no model.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { decodePcm } from '@/lib/reels/music/audio';

import { beatGrid, snapBeat } from './render/beats';
import { CLIP_MS, HIT_MS } from './render/timeline';

export const TRIVIA_MOOD = {
  key: 'trivia-calm-groove',
  query: 'calm light groove, soft drums and warm bass, curious, understated, 90-110 BPM, instrumental',
} as const;
/** Words that rule a track out for this mood: vocals, drama, holidays, kids, sleep, ads. */
export const TRIVIA_BANNED = /\b(vocals?|vocal\w*|lyric\w*|singing|singer|choir|sad|dark|horror|scary|epic|trailer|cinematic|orchestral|aggressive|metal|dubstep|trap|christmas|holiday|children|kids|lullaby|sleep\w*|meditat\w*|corporate|motivational|inspir\w*|tense|suspense\w*)\b/i;
export const RECENT_SETS = 10;
export const CATALOG_LIMIT = 20;
/** A track must run at least this long (the two clips plus room to place the window). */
export const MIN_TRACK_S = 20;
/** How many candidates are fetched and measured before giving up. */
export const MAX_TRIES = 3;
/** The window starts about this far into the track (past most intros), within these bounds. */
export const START_FRACTION = 0.2;
export const START_MIN_MS = 4000;
export const START_MAX_MS = 25000;

export type CatalogTrack = { id?: string; audio_id?: string; name?: string; description?: string; tags?: string[]; audio_url?: string; duration?: number };
export type TriviaMusic = {
  trackId: string;
  url: string;
  bpm: number;
  /** Beats in track time (ms) across both clips' window, rounded to 0.1 ms. */
  beatMs: number[];
  /** Track time (ms) at clip 1's first frame. */
  startMs: number;
};
export type BeatAnalysis = { bpm: number; beatsMs: number[]; durationMs: number; snap?: (ms: number) => number };
export type TriviaMusicDeps = {
  /** Track ids used by the last RECENT_SETS ai_trivia sets, most recent first. */
  recentTrackIds: () => Promise<string[]>;
  /** Catalog search; HeyGen's by default. */
  search?: (query: string) => Promise<CatalogTrack[]>;
  /** Fetch a track to a file; HeyGen's downloader by default. */
  download?: (url: string, dest: string) => Promise<unknown>;
  /** Beat grid of a local file; beats.ts on ffmpeg-decoded PCM by default. */
  analyze?: (file: string) => Promise<BeatAnalysis>;
  /** Where candidates are downloaded (a temp dir by default; removed after). */
  workDir?: string;
  log?: (line: string) => void;
};

export const trackIdOf = (t: CatalogTrack) => String(t.id ?? t.audio_id ?? t.name ?? t.audio_url ?? '');

/** The catalog's acceptable tracks, in its order: a URL, long enough, no banned word. */
export function acceptableTracks(results: CatalogTrack[]): CatalogTrack[] {
  return (results ?? []).filter((t) => {
    const text = `${t.name ?? ''} ${t.description ?? ''} ${Array.isArray(t.tags) ? t.tags.join(' ') : ''}`;
    return Boolean(t.audio_url) && !TRIVIA_BANNED.test(text) && !(typeof t.duration === 'number' && t.duration < MIN_TRACK_S) && trackIdOf(t) !== '';
  });
}

/** Candidates in the order to try: fresh ones in catalog order, then recent ones least recently used first. */
export function rankTracks(results: CatalogTrack[], recent: string[]): CatalogTrack[] {
  const ok = acceptableTracks(results);
  const seen = new Set(recent.slice(0, RECENT_SETS));
  const fresh = ok.filter((t) => !seen.has(trackIdOf(t)));
  const stale = ok.filter((t) => seen.has(trackIdOf(t))).sort((a, b) => recent.indexOf(trackIdOf(b)) - recent.indexOf(trackIdOf(a)));
  return [...fresh, ...stale];
}

/**
 * Where clip 1 starts in the track: the beat nearest to (target + CLIP_MS + HIT_MS) becomes the hit,
 * with the target about START_FRACTION in. The whole window (2 × CLIP_MS) must fit in the track.
 */
export function placeWindow(beatsMs: number[], durationMs: number): { startMs: number; hitMs: number } {
  const span = 2 * CLIP_MS;
  const lead = CLIP_MS + HIT_MS;
  const target = Math.min(START_MAX_MS, Math.max(START_MIN_MS, durationMs * START_FRACTION));
  const fits = beatsMs.filter((b) => b - lead >= 0 && b - lead + span <= durationMs - 250);
  if (!fits.length) throw new Error(`no beat leaves room for the ${span / 1000} s window (track ${Math.round(durationMs / 100) / 10} s)`);
  const hitMs = fits.reduce((best, b) => (Math.abs(b - (target + lead)) < Math.abs(best - (target + lead)) ? b : best));
  return { startMs: Math.round((hitMs - lead) * 10) / 10, hitMs };
}

async function heygenLib(): Promise<{ heygenAuthHeaders: () => Record<string, string>; searchSounds: (q: string, type: string, h: Record<string, string>, o: { limit: number }) => Promise<CatalogTrack[]>; downloadTo: (url: string, dest: string) => Promise<number> }> {
  // The same library the AI Drama kit imports (kit/music.mjs heygen()), from the pinned runtime.
  const lib = path.join(process.cwd(), 'explainers', 'runtime', 'node_modules', 'hyperframes', 'dist', 'skills', 'media-use', 'audio', 'scripts', 'lib', 'heygen.mjs');
  return import(pathToFileURL(lib).href);
}

/** beats.ts on the decoded track (48 kHz mono), with the hit snapped to its onset peak. */
export async function analyzeFile(file: string): Promise<BeatAnalysis> {
  const pcm = await decodePcm(file);
  const grid = beatGrid(pcm, 48_000);
  return { ...grid, snap: (ms) => snapBeat(pcm, 48_000, ms) };
}

/** Pick this set's track and place the two clips' window on its beat grid. */
export async function pickTriviaMusic(deps: TriviaMusicDeps): Promise<TriviaMusic> {
  const log = deps.log ?? (() => undefined);
  let { search, download } = deps;
  if (!search || !download) {
    const h = await heygenLib();
    const headers = h.heygenAuthHeaders();
    search ??= (q) => h.searchSounds(q, 'music', headers, { limit: CATALOG_LIMIT });
    download ??= (url, dest) => h.downloadTo(url, dest);
  }
  const analyze = deps.analyze ?? analyzeFile;
  const recent = await deps.recentTrackIds();
  const ranked = rankTracks(await search(TRIVIA_MOOD.query), recent);
  if (!ranked.length) throw new Error(`the catalog had no acceptable track for "${TRIVIA_MOOD.key}"`);
  const own = !deps.workDir;
  const dir = deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-music-'));
  const errors: string[] = [];
  try {
    for (const [i, t] of ranked.slice(0, MAX_TRIES).entries()) {
      const id = trackIdOf(t);
      try {
        const file = path.join(dir, `candidate-${i}.mp3`);
        await download(t.audio_url!, file);
        const a = await analyze(file);
        const placed = placeWindow(a.beatsMs, a.durationMs);
        const hit = a.snap ? a.snap(placed.hitMs) : placed.hitMs;
        const startMs = Math.round((hit - CLIP_MS - HIT_MS) * 10) / 10;
        const beatMs = a.beatsMs.filter((b) => b >= startMs - 1000 && b <= startMs + 2 * CLIP_MS + 1000).map((b) => (Math.abs(b - placed.hitMs) < 0.05 ? hit : b));
        log(`music: ${id} (${t.name ?? 'untitled'}), ${a.bpm} BPM, clip 1 from ${startMs} ms, hit at ${hit} ms${recent.includes(id) ? ' (recent: no fresh track worked)' : ''}`);
        return { trackId: id, url: t.audio_url!, bpm: a.bpm, beatMs, startMs };
      } catch (err) {
        errors.push(`${id}: ${(err as Error).message}`);
      }
    }
    throw new Error(`no catalog track could be placed: ${errors.join('; ')}`);
  } finally {
    if (own) fs.rmSync(dir, { recursive: true, force: true });
  }
}
