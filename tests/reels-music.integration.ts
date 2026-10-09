/**
 * Song pool, song pick, and publishing against the real `reels` schema.
 *
 * Needs a database, so it is not part of `npm test`:
 *   npm run test:db:music
 *
 * Meta, CLAP, Jev, storage, ffmpeg, and librosa are all stubbed: no paid call
 * and nothing reaches Instagram. Every row it writes is tagged and removed at
 * the end. It refuses to run once a real ingest has happened, because its own
 * ingest rows would otherwise stand in for the real day one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

for (const file of ['.env.local']) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

import { closeDbPool, dbQuery } from '@/lib/db';
import { RecordingJevRunner, type JevTransport } from '@/lib/reels/jev/runner';
import { loadReelsInsights } from '@/lib/reels/insights';
import type { ClapClient } from '@/lib/reels/music/clap';
import { runSongIngest, type SongStorage } from '@/lib/reels/music/ingest';
import type { IgAudio, MetaClient } from '@/lib/reels/music/meta';
import { loadReelSongs } from '@/lib/reels/music/overview';
import { claimAndPickSong, queueSongPick } from '@/lib/reels/music/pick';
import { claimAndPublish, queuePublish } from '@/lib/reels/music/publish';
import { REEL_ATTEMPTS } from '@/lib/reels/spine-tables';
import { listSongs } from '@/lib/reels/music/store';
import { tagUntagged } from '@/lib/reels/music/tag';

const TAG = 'itest-';
const DIM = 8;

/** Deterministic unit vectors, so the ranking is stable from run to run. */
function vector(seed: string): number[] {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const out = Array.from({ length: DIM }, (_, index) => Math.sin(hash * (index + 1)));
  const norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0));
  return out.map((value) => value / norm);
}

const clap: ClapClient = {
  model: 'clap-stub',
  async embedAudio(pcm) {
    return vector(`audio-${pcm[0]}`);
  },
  async embedTexts(texts) {
    return texts.map((text) => vector(text));
  },
};

function sounds(prefix: string, count: number, missing: number[] = []): IgAudio[] {
  return Array.from({ length: count }, (_, index) => ({
    audio_id: `${TAG}${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    display_artist: 'Stub Artist',
    duration_in_ms: 30_000,
    download_url: missing.includes(index + 1) ? null : `https://cdn.example.com/${prefix}-${index + 1}.mp3`,
  }));
}

function metaStub(lists: { music: IgAudio[]; original_sound: IgAudio[] }, calls: string[]): MetaClient {
  const statuses = ['IN_PROGRESS', 'FINISHED'];
  return {
    async trending(type, atLeast) {
      calls.push(`trending:${type}:${atLeast}`);
      return lists[type];
    },
    async downloadPreview(url) {
      return { bytes: Buffer.from(url), contentType: 'audio/mpeg' };
    },
    async publishingLimit() {
      return { quotaUsage: 3, quotaTotal: 100 };
    },
    async createReelContainer(input) {
      calls.push(`create:${input.audioId}:${input.audioVolume}/${input.videoVolume}:${input.graduationStrategy}:${input.shareToFeed}`);
      return 'container-stub';
    },
    async containerStatus() {
      return { statusCode: statuses.shift() ?? 'FINISHED', status: null };
    },
    async publishContainer() {
      calls.push('publish');
      return 'media-stub';
    },
    async permalink() {
      return 'https://www.instagram.com/reel/stub/';
    },
  };
}

function memoryStorage(): SongStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async upload(objectPath, bytes) {
      objects.set(objectPath, bytes);
    },
    async download(objectPath) {
      const found = objects.get(objectPath);
      if (!found) throw new Error(`missing ${objectPath}`);
      return found;
    },
    async remove(objectPaths) {
      for (const objectPath of objectPaths) objects.delete(objectPath);
    },
  };
}

const tagWithStubs: typeof tagUntagged = (deps) =>
  tagUntagged({
    ...deps,
    decode: async (file) => new Float32Array([path.basename(file).length, 0.5]),
    bpm: async () => ({ bpm: 120, library: 'stub', settings: {} }),
  });

const jevTransport: JevTransport = {
  async systemOne(_state, questions) {
    const labels = Object.keys((questions as Record<string, { criteria: Record<string, unknown> }>).song.criteria);
    const probabilities = Object.fromEntries(labels.map((label) => [label, label === 'song_2' ? 0.6 : 0.4 / 11]));
    return {
      answers: { song: { type: 'choice', choice: 'song_2', confidence: 0.6, probabilities } },
      model: 'jev-stub',
      usage: { input_tokens: 400, output_tokens: 0 },
    } as never;
  },
};

type Fixture = { runId: string; slateId: string; postIdeaId: string; videoJobId: string };

async function fixture(): Promise<Fixture> {
  const run = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at, finished_at, note)
     VALUES ('manual', 'ok', now(), now(), 'reels-music-itest') RETURNING id`,
  );
  // A date in 2000 keeps this slate out of the hub's current day while the test runs.
  const slate = await dbQuery<{ id: string }>(
    `INSERT INTO reels.score_slates (run_id, ny_date, scored_at, pass1_version, pass2_version)
     VALUES ($1, '2000-01-01', '2000-01-01', 'itest', 'itest') RETURNING id`,
    [run.rows[0].id],
  );
  const idea = await dbQuery<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id`);
  await dbQuery(
    `INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status,
                                  on_screen_copy, caption, call_to_action, hashtags)
     VALUES ($1, $2, 'itest', 'itest', 'the_number', 'curiosity', 'ok',
             'A model read 40,000 pages in one second.', 'The caption body.', 'Save this.', ARRAY['#ai', '#tech'])`,
    [slate.rows[0].id, idea.rows[0].id],
  );
  const video = await dbQuery<{ id: string }>(
    `INSERT INTO reels.video_jobs (post_idea_id, slate_id, status, finished_at, video_storage_path)
     VALUES ($1, $2, 'ok', now(), 'itest/reel.mp4') RETURNING id`,
    [idea.rows[0].id, slate.rows[0].id],
  );
  return { runId: run.rows[0].id, slateId: slate.rows[0].id, postIdeaId: idea.rows[0].id, videoJobId: video.rows[0].id };
}

async function cleanup(started: Date, fx: Fixture | null, ingestIds: string[]): Promise<void> {
  if (fx) {
    // Trial Reels' attempts live on the spine (D39); the media_insights rows go with them (ON DELETE CASCADE).
    await dbQuery(`DELETE FROM social_hub.publish_attempts WHERE vertical = 'reels' AND payload->>'post_idea_id' = $1`, [fx.postIdeaId]);
    await dbQuery(`DELETE FROM reels.song_picks WHERE post_idea_id = $1`, [fx.postIdeaId]);
    await dbQuery(`DELETE FROM reels.jev_logs WHERE post_idea_id = $1`, [fx.postIdeaId]);
    await dbQuery(`DELETE FROM reels.published_status WHERE post_idea_id = $1`, [fx.postIdeaId]);
    await dbQuery(`DELETE FROM reels.post_ideas WHERE id = $1`, [fx.postIdeaId]);
    await dbQuery(`DELETE FROM reels.runs WHERE id = $1`, [fx.runId]);
  }
  await dbQuery(`DELETE FROM reels.sound_observations WHERE audio_id LIKE $1`, [`${TAG}%`]);
  await dbQuery(`DELETE FROM reels.songs WHERE audio_id LIKE $1`, [`${TAG}%`]);
  if (ingestIds.length > 0) await dbQuery(`DELETE FROM reels.song_ingests WHERE id = ANY($1::uuid[])`, [ingestIds]);
  await dbQuery(
    `DELETE FROM reels.cost_events WHERE component IN ('song-tag', 'song-narrow', 'song-pick') AND created_at >= $1`,
    [started],
  );
}

async function main(): Promise<void> {
  const history = await dbQuery<{ n: number }>(
    `SELECT (SELECT count(*) FROM reels.song_ingests)::int + (SELECT count(*) FROM reels.songs WHERE audio_id NOT LIKE $1)::int AS n`,
    [`${TAG}%`],
  );
  if (history.rows[0].n > 0) {
    console.log('Skipped: real song ingests exist, and this test must not stand in for day one.');
    return;
  }
  const started = new Date();
  const ingestIds: string[] = [];
  let fx: Fixture | null = null;
  const savedApproval = process.env.REELS_SONG_PICK_APPROVED;
  try {
    const storage = memoryStorage();
    const calls: string[] = [];

    // Day one: music has 12 with #3 missing a preview; originals have 25.
    const dayOne = await runSongIngest('manual', {
      meta: metaStub({ music: sounds('m', 12, [3]), original_sound: sounds('o', 25) }, calls),
      clap,
      storage,
      probe: async () => 7_000,
      tag: tagWithStubs,
    });
    assert.equal(dayOne.status, 'ok', 'note' in dayOne ? dayOne.note ?? '' : '');
    if ('id' in dayOne) ingestIds.push(dayOne.id);
    assert.ok('added' in dayOne);
    assert.equal(dayOne.added.length, 30, 'day one fills exactly 30');
    assert.ok(!dayOne.added.includes(`${TAG}m-3`), 'no preview, no entry');
    assert.ok(dayOne.added.includes(`${TAG}m-11`), 'replaced from the same list');
    assert.ok(calls.includes('trending:music:30'), 'day one reads deeper than the top 10');
    assert.equal(calls.filter((call) => call === 'trending:original_sound:50').length, 5, 'original sounds are sampled five times');
    const observed = await dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM reels.sound_observations WHERE audio_id LIKE $1`, [`${TAG}%`]);
    assert.equal(observed.rows[0].n, 5 * 25, 'every position of every sample is recorded');
    let songs = await listSongs();
    assert.equal(songs.length, 30);
    assert.ok(songs.every((song) => song.taggedAt && song.genre && (song.vibes?.length ?? 0) >= 5));
    assert.equal(storage.objects.size, 30);

    // Day two: one new entrant inside the music top 10, and m-3 is back with a
    // preview file, so it enters now (D-142). Nothing already pooled is re-ingested.
    const dayTwo = await runSongIngest('manual', {
      meta: metaStub({ music: [...sounds('new', 1), ...sounds('m', 9)], original_sound: sounds('o', 20) }, calls),
      clap,
      storage,
      probe: async () => 7_000,
      tag: tagWithStubs,
    });
    if ('id' in dayTwo) ingestIds.push(dayTwo.id);
    assert.ok('added' in dayTwo);
    assert.deepEqual([...dayTwo.added].sort(), [`${TAG}m-3`, `${TAG}new-1`]);

    // Song pick: queued, gated, then picked by the stub Jev.
    fx = await fixture();
    assert.deepEqual(await queueSongPick(fx.videoJobId), { queued: true });
    delete process.env.REELS_SONG_PICK_APPROVED;
    assert.equal(await claimAndPickSong({ clap, onPicked: async () => undefined }), null, 'gated until P-13 is approved');
    process.env.REELS_SONG_PICK_APPROVED = 'true';
    const jev = new RecordingJevRunner(jevTransport);
    const picked = await claimAndPickSong({ clap, jev, onPicked: async () => undefined });
    assert.equal(picked?.status, 'ok');
    const reelSongs = await loadReelSongs([fx.videoJobId]);
    const song = reelSongs[fx.videoJobId].song!;
    assert.equal(song.shortlist.length, 12);
    assert.equal(song.audioId, song.shortlist[1].audioId, 'song_2 is the second most similar');
    assert.equal(song.shortlist[1].probability, 0.6);
    assert.equal(song.audioRanking.length, 12);
    songs = await listSongs();
    assert.equal(songs.find((item) => item.audioId === song.audioId)?.attached, true, 'attached while unpublished');

    // Approve: blocked until the mix is set, then published through the stub.
    const blocked = await queuePublish(fx.videoJobId, 'approve');
    assert.equal(blocked.queued, false);
    const queued = await queuePublish(fx.videoJobId, 'approve', { audioVolume: 100, videoVolume: 60 });
    assert.equal(queued.queued, true);
    const published = await claimAndPublish({
      meta: metaStub({ music: [], original_sound: [] }, calls),
      signVideo: async () => 'https://storage.example.com/reel.mp4',
      sleep: async () => undefined,
    });
    assert.equal(published?.status, 'published');
    assert.ok(calls.includes(`create:${song.audioId}:100/60:SS_PERFORMANCE:null`));
    const attempt = await dbQuery<{ caption: string; permalink: string; audio_id: string; song_title: string }>(
      `SELECT caption, permalink, audio_id, song_title FROM ${REEL_ATTEMPTS} a WHERE post_idea_id = $1`,
      [fx.postIdeaId],
    );
    assert.equal(attempt.rows[0].caption, 'The caption body.\n\nSave this.\n\n#ai #tech', 'posts the full caption');
    assert.equal(attempt.rows[0].audio_id, song.audioId);
    const status = await dbQuery<{ published: boolean }>(`SELECT published FROM reels.published_status WHERE post_idea_id = $1`, [fx.postIdeaId]);
    assert.equal(status.rows[0]?.published, true);
    songs = await listSongs();
    assert.equal(songs.find((item) => item.audioId === song.audioId)?.attached, false, 'free to evict once posted');
    const again = await queuePublish(fx.videoJobId, 'approve', { audioVolume: 100, videoVolume: 60 });
    assert.equal(again.queued, false, 'a reel posts once');
    assert.equal((await loadReelSongs([fx.videoJobId]))[fx.videoJobId].publish?.status, 'published');

    // The error list reads the new tables without a SQL error.
    await loadReelsInsights();
    console.log('reels music integration: ok');
  } finally {
    if (savedApproval === undefined) delete process.env.REELS_SONG_PICK_APPROVED;
    else process.env.REELS_SONG_PICK_APPROVED = savedApproval;
    await cleanup(started, fx, ingestIds);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool());
