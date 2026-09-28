import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ORIGINAL_SAMPLE_DEPTH,
  ORIGINAL_SAMPLES_PER_NIGHT,
  ORIGINAL_TREND_WINDOW_NIGHTS,
  SONG_TRENDING_TOP,
  SOUND_OBSERVATION_RETENTION_DAYS,
} from '@/lib/reels/config';
import { probeDurationMs } from '@/lib/reels/music/audio';
import { clapConfigured, createLiveClapClient, type ClapClient } from '@/lib/reels/music/clap';
import { createLiveMetaClient, metaConfigured, type IgAudio, type MetaClient } from '@/lib/reels/music/meta';
import { planEviction, planIngest, rankByTrend, type AudioType, type IngestPlan, type TrendingSound } from '@/lib/reels/music/pool';
import {
  deleteSongs,
  finishIngest,
  getSetting,
  hasCompletedIngest,
  insertSong,
  markSeen,
  poolForEviction,
  pruneObservations,
  recordObservations,
  startIngest,
  trendStats,
  type IngestStatus,
  type IngestTrigger,
} from '@/lib/reels/music/store';
import { tagUntagged, type TagOutcome } from '@/lib/reels/music/tag';
import { zoneDateParts } from '@/lib/reels/schedule';
import { deleteFrameObjects, downloadFrameObject, uploadFrameObject } from '@/lib/reels/visual/storage';

/**
 * Stage 2 (D-137 to D-143, D-164 to D-166, D-178, D-179). Fetch the trending
 * lists, cache each new entrant's preview before Meta's link expires, store it
 * untagged, evict the oldest unattached songs past the cap, then tag whatever
 * is untagged. The local pool is only ever touched through these rules.
 */

export type SongStorage = {
  upload: (objectPath: string, bytes: Buffer, contentType: string) => Promise<void>;
  download: (objectPath: string) => Promise<Buffer>;
  remove: (objectPaths: string[]) => Promise<void>;
};

const liveStorage: SongStorage = {
  upload: uploadFrameObject,
  download: downloadFrameObject,
  remove: deleteFrameObjects,
};

export type IngestDeps = {
  meta?: MetaClient;
  /** Omit to use the live endpoint when configured; `null` skips tagging. */
  clap?: ClapClient | null;
  storage?: SongStorage;
  probe?: (filePath: string) => Promise<number | null>;
  tag?: typeof tagUntagged;
};

export type IngestOutcome =
  | { status: 'skipped'; note: string }
  | { status: IngestStatus; id: string; added: string[]; evicted: string[]; tagged: TagOutcome | null; note: string | null };

/** Day one reads past the top N so skips, merges, and a dry list can be replaced (D-140, D-178). */
const DAY_ONE_DEPTH = 3;
/** A failed download is treated like a missing preview and replaced, at most this many rounds. */
const DOWNLOAD_ROUNDS = 3;

/** Meta serves previews as audio-only AAC in an MP4 labeled video/mp4 (spike 2). */
const EXTENSIONS: Record<string, string> = {
  'video/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
};

function extensionFor(contentType: string | null, url: string): string {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (type && EXTENSIONS[type]) return EXTENSIONS[type];
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.[a-z0-9]{2,4}$/.test(fromUrl) ? fromUrl : '.audio';
}

function toTrending(list: AudioType, sounds: IgAudio[]): TrendingSound[] {
  return sounds.map((sound, index) => ({
    audioId: sound.audio_id,
    list,
    rank: index + 1,
    hasPreview: Boolean(sound.download_url),
  }));
}

function nyDateOf(at: Date): string {
  const { year, month, day } = zoneDateParts(at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-songs', message, ...fields }));
}

export async function runSongIngest(trigger: IngestTrigger, deps: IngestDeps = {}): Promise<IngestOutcome> {
  if (!deps.meta && !metaConfigured()) {
    return { status: 'skipped', note: 'Song ingest is waiting on Meta credentials (META_USER_ACCESS_TOKEN).' };
  }
  // Held while the original-sound source is being redecided (2026-09-28), so
  // day one never fills under a rule Lucas has replaced.
  if (!deps.meta && (await getSetting<boolean>('song_ingest_paused')) === true) {
    return { status: 'skipped', note: 'Song ingest is paused (reels.settings song_ingest_paused).' };
  }
  const id = await startIngest(trigger);
  if (!id) return { status: 'skipped', note: 'A song ingest is already running.' };

  const meta = deps.meta ?? createLiveMetaClient();
  const storage = deps.storage ?? liveStorage;
  const probe = deps.probe ?? probeDurationMs;
  const clap = deps.clap === undefined ? (clapConfigured() ? createLiveClapClient() : null) : deps.clap;

  let fetched: Array<{ audioId: string; list: AudioType; rank: number; hasPreview: boolean }> = [];
  let plan: IngestPlan | null = null;
  const added: string[] = [];
  const failures: Array<{ audioId: string; list: AudioType; rank: number; reason: string }> = [];
  const notes: string[] = [];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-ingest-'));
  try {
    const dayOne = !(await hasCompletedIngest());
    const byId = new Map<string, IgAudio>();
    const remember = (sounds: IgAudio[]) => {
      for (const sound of sounds) if (!byId.has(sound.audio_id)) byId.set(sound.audio_id, sound);
    };
    const lists = {} as Record<AudioType, TrendingSound[]>;

    // Music: the first N of Meta's list, as returned (D-188).
    const music = await meta.trending('music', SONG_TRENDING_TOP.music * (dayOne ? DAY_ONE_DEPTH : 1));
    remember(music);
    lists.music = toTrending('music', music);

    // Original sounds: our trending score (D-190). Sample the list several
    // times, record every position, then rank tonight's sounds by nights on
    // the list within the window, then average position.
    const nyDate = nyDateOf(new Date());
    const samples: IgAudio[][] = [];
    for (let sample = 1; sample <= ORIGINAL_SAMPLES_PER_NIGHT; sample += 1) {
      samples.push(await meta.trending('original_sound', ORIGINAL_SAMPLE_DEPTH));
    }
    samples.forEach(remember);
    await recordObservations({ ingestId: id, nyDate, audioType: 'original_sound', samples });
    const stats = await trendStats('original_sound', nyDate, ORIGINAL_TREND_WINDOW_NIGHTS);
    const ranked = rankByTrend(samples.flat().map((sound) => sound.audio_id), stats);
    lists.original_sound = toTrending('original_sound', ranked.map((audioId) => byId.get(audioId)!));
    await pruneObservations(SOUND_OBSERVATION_RETENTION_DAYS);

    fetched = [...lists.music, ...lists.original_sound];

    const pool = await poolForEviction();
    const poolIds = new Set(pool.map((song) => song.audioId));
    await markSeen(fetched.filter((sound) => poolIds.has(sound.audioId)).map((sound) => sound.audioId));

    const unusable = new Set<string>();
    for (let round = 1; round <= DOWNLOAD_ROUNDS; round += 1) {
      const current = {
        music: lists.music.map((sound) => (unusable.has(sound.audioId) ? { ...sound, hasPreview: false } : sound)),
        original_sound: lists.original_sound.map((sound) => (unusable.has(sound.audioId) ? { ...sound, hasPreview: false } : sound)),
      };
      plan = planIngest({ lists: current, poolIds, dayOne });
      const pending = plan.accept.filter((sound) => !added.includes(sound.audioId));
      if (pending.length === 0) break;
      for (const sound of pending) {
        const info = byId.get(sound.audioId)!;
        try {
          const preview = await meta.downloadPreview(info.download_url!);
          const ext = extensionFor(preview.contentType, info.download_url!);
          const objectPath = `songs/${sound.audioId}${ext}`;
          await storage.upload(objectPath, preview.bytes, ext === '.m4a' ? 'audio/mp4' : preview.contentType ?? 'application/octet-stream');
          const file = path.join(dir, `${sound.audioId}${ext}`);
          await writeFile(file, preview.bytes);
          await insertSong({ sound, meta: info, previewStoragePath: objectPath, previewDurationMs: await probe(file) });
          added.push(sound.audioId);
        } catch (error) {
          unusable.add(sound.audioId);
          failures.push({ audioId: sound.audioId, list: sound.list, rank: sound.rank, reason: `download_failed: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      // After day one there is no replacement, so one round is the whole job.
      if (!dayOne) break;
    }
    if (plan && (plan.shortfall.music > 0 || plan.shortfall.original_sound > 0)) {
      notes.push(`Day one came up ${plan.shortfall.music + plan.shortfall.original_sound} short: both lists ran dry.`);
    }

    const eviction = planEviction(pool, added.length);
    const removed = await deleteSongs(eviction.evict);
    await storage.remove(removed.map((song) => song.previewStoragePath)).catch((error) => {
      notes.push(`Evicted rows are gone but ${removed.length} preview file(s) were not deleted: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (eviction.overCap > 0) notes.push(`The pool is ${eviction.overCap} over the cap: every older song is on an unpublished reel (D-179).`);

    let tagged: TagOutcome | null = null;
    if (clap) {
      tagged = await (deps.tag ?? tagUntagged)({ clap, downloadPreview: storage.download }).catch((error) => {
        // A broken endpoint must not fail the ingest: the previews are cached and wait for tags.
        notes.push(error instanceof Error ? error.message : String(error));
        return { tagged: [], failed: [{ audioId: '*', error: 'tagging skipped' }] };
      });
      if (tagged.failed.length > 0) notes.push(`Tagging failed for ${tagged.failed.length} song(s): ${tagged.failed.map((item) => `${item.audioId}: ${item.error}`).join('; ')}`);
    } else {
      notes.push('Songs are stored untagged: CLAP is waiting on HF_TOKEN and HF_CLAP_ENDPOINT_URL.');
    }

    const status: IngestStatus = failures.length > 0 || (tagged?.failed.length ?? 0) > 0 ? 'partial' : 'ok';
    if (failures.length > 0) notes.unshift(`${failures.length} preview download(s) failed.`);
    const note = notes.join(' ') || null;
    await finishIngest(id, status, {
      fetched,
      added,
      skipped: [...(plan?.skipped ?? []), ...failures],
      evicted: removed.map(({ audioId, title, artist }) => ({ audioId, title, artist })),
      note,
    });
    log('ingest_done', { id, status, added: added.length, evicted: removed.length, dayOne });
    return { status, id, added, evicted: removed.map((song) => song.audioId), tagged, note };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await finishIngest(id, 'failed', { fetched, added, skipped: [...(plan?.skipped ?? []), ...failures], evicted: [], note });
    log('ingest_failed', { id, error: note });
    return { status: 'failed', id, added, evicted: [], tagged: null, note };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
