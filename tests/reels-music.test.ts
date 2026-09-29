import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cosine,
  planEviction,
  planIngest,
  rankByTrend,
  reelMatchText,
  audioIdsBlockedForAssignment,
  audioIdsHeldByOtherIdeas,
  claimsForAssignment,
  excludeUsedToday,
  songHeldByIdea,
  shortlistSongs,
  type AudioType,
  type TrendingSound,
} from '@/lib/reels/music/pool';
import { GENRES, INSTRUMENTS, selectRelative, songTagText, tagsFromScores, VIBES } from '@/lib/reels/music/vocab';
import { songPickSet, songPickState } from '@/lib/reels/jev/questions/song-pick';
import { createLiveClapClient } from '@/lib/reels/music/clap';
import { createLiveMetaClient } from '@/lib/reels/music/meta';
import { buildShortlist } from '@/lib/reels/music/pick';
import { assertClapDiscriminates } from '@/lib/reels/music/tag';
import { nextRunAt } from '@/lib/reels/schedule';

function list(kind: AudioType, count: number, opts: { noPreview?: number[]; ids?: Record<number, string> } = {}): TrendingSound[] {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    return {
      audioId: opts.ids?.[rank] ?? `${kind}-${rank}`,
      list: kind,
      rank,
      hasPreview: !opts.noPreview?.includes(rank),
    };
  });
}

describe('song ingest plan', () => {
  it('fills day one with exactly 10 music and 20 original sounds', () => {
    const plan = planIngest({
      lists: { music: list('music', 25), original_sound: list('original_sound', 25) },
      poolIds: new Set(),
      dayOne: true,
    });
    assert.equal(plan.accept.filter((sound) => sound.list === 'music').length, 10);
    assert.equal(plan.accept.filter((sound) => sound.list === 'original_sound').length, 20);
    assert.deepEqual(plan.shortfall, { music: 0, original_sound: 0 });
  });

  it('replaces a day-one skip with the next sound from the same list', () => {
    const plan = planIngest({
      lists: { music: list('music', 25, { noPreview: [3] }), original_sound: list('original_sound', 25) },
      poolIds: new Set(),
      dayOne: true,
    });
    const music = plan.accept.filter((sound) => sound.list === 'music').map((sound) => sound.rank);
    assert.deepEqual(music, [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(plan.skipped, [{ audioId: 'music-3', list: 'music', rank: 3, reason: 'no_preview' }]);
  });

  it('merges a sound on both lists and replaces it from the second list', () => {
    const plan = planIngest({
      lists: {
        music: list('music', 25, { ids: { 2: 'shared' } }),
        original_sound: list('original_sound', 25, { ids: { 1: 'shared' } }),
      },
      poolIds: new Set(),
      dayOne: true,
    });
    assert.equal(plan.accept.filter((sound) => sound.audioId === 'shared').length, 1);
    assert.equal(plan.accept.length, 30);
    assert.ok(plan.skipped.some((skip) => skip.audioId === 'shared' && skip.reason === 'merged'));
  });

  it('borrows from the other list when one runs dry on day one', () => {
    const plan = planIngest({
      lists: { music: list('music', 8), original_sound: list('original_sound', 40) },
      poolIds: new Set(),
      dayOne: true,
    });
    assert.equal(plan.accept.length, 30);
    assert.deepEqual(plan.shortfall, { music: 0, original_sound: 0 });
    assert.deepEqual(
      plan.accept.filter((sound) => sound.list === 'original_sound').map((sound) => sound.rank).slice(-2),
      [21, 22],
    );
  });

  it('borrows music when the original list runs dry, and reports what both lists could not fill', () => {
    const plan = planIngest({
      lists: { music: list('music', 13), original_sound: list('original_sound', 15) },
      poolIds: new Set(),
      dayOne: true,
    });
    assert.equal(plan.accept.length, 28);
    assert.deepEqual(plan.shortfall, { music: 0, original_sound: 2 });
  });

  it('a retried day one counts songs already stored toward the 30', () => {
    const plan = planIngest({
      lists: { music: list('music', 25), original_sound: list('original_sound', 25) },
      poolIds: new Set(['music-1', 'music-2', 'original_sound-1']),
      dayOne: true,
    });
    assert.equal(plan.accept.length, 27);
    assert.ok(!plan.accept.some((sound) => sound.audioId === 'music-1'));
  });

  it('after day one takes only new entrants inside the top N, with no replacement', () => {
    const plan = planIngest({
      lists: { music: list('music', 25, { noPreview: [4] }), original_sound: list('original_sound', 25) },
      poolIds: new Set(['music-1', 'music-2', ...list('original_sound', 20).map((sound) => sound.audioId)]),
      dayOne: false,
    });
    assert.deepEqual(
      plan.accept.map((sound) => sound.audioId),
      ['music-3', 'music-5', 'music-6', 'music-7', 'music-8', 'music-9', 'music-10'],
    );
    assert.ok(plan.skipped.some((skip) => skip.audioId === 'music-4' && skip.reason === 'no_preview'));
  });
});

describe('song pool eviction', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));
  const pool = (count: number, attached: number[] = []) =>
    Array.from({ length: count }, (_, index) => ({
      audioId: `s${index + 1}`,
      firstIngestedAt: day(index + 1),
      attached: attached.includes(index + 1),
    }));

  it('evicts nothing under the cap', () => {
    assert.deepEqual(planEviction(pool(45), 5, 50), { evict: [], overCap: 0 });
  });

  it('evicts the oldest first when a new song would make a 51st', () => {
    assert.deepEqual(planEviction(pool(50), 2, 50), { evict: ['s1', 's2'], overCap: 0 });
  });

  it('skips songs attached to an unpublished reel', () => {
    assert.deepEqual(planEviction(pool(50, [1]), 2, 50), { evict: ['s2', 's3'], overCap: 0 });
  });

  it('reports how far over the cap it stays when everything is attached', () => {
    assert.deepEqual(planEviction(pool(3, [1, 2, 3]), 1, 3), { evict: [], overCap: 1 });
  });
});

describe('song shortlist', () => {
  const song = (id: string, vector: number[] | null) => ({ audioId: id, tagTextEmbedding: vector });

  it('ranks by cosine similarity and takes exactly the shortlist size', () => {
    const songs = [song('far', [0, 1]), song('near', [1, 0.1]), song('mid', [1, 1]), song('untagged', null)];
    const result = shortlistSongs([1, 0], songs, 2);
    assert.ok(result.ok);
    assert.deepEqual(result.songs.map((item) => item.audioId), ['near', 'mid']);
  });

  it('waits when fewer songs are tagged than the shortlist needs', () => {
    assert.deepEqual(shortlistSongs([1, 0], [song('a', [1, 0]), song('b', null)], 2), { ok: false, tagged: 1 });
  });

  it('keeps the song already claimed by this post idea and blocks other ideas', () => {
    const picks = [
      { postIdeaId: 'idea-a', audioId: 'song-a', finishedAt: '2026-09-28T16:00:00.000Z' },
      { postIdeaId: 'idea-a', audioId: 'song-b', finishedAt: '2026-09-28T18:00:00.000Z' },
      { postIdeaId: 'idea-b', audioId: 'song-c', finishedAt: '2026-09-28T17:00:00.000Z' },
    ];
    assert.equal(songHeldByIdea(picks, 'idea-a')?.audioId, 'song-a');
    assert.equal(songHeldByIdea(picks, 'idea-c'), null);
    assert.deepEqual([...audioIdsHeldByOtherIdeas(picks, 'idea-a')], ['song-c']);
  });

  it('leaves out songs already used today and keeps the rest in order', () => {
    const songs = [song('used', [1, 0]), song('open', [1, 0]), song('also', [0, 1])];
    assert.deepEqual(
      excludeUsedToday(songs, new Set(['used'])).map((item) => item.audioId),
      ['open', 'also'],
    );
    assert.deepEqual(
      excludeUsedToday(songs, new Set()).map((item) => item.audioId),
      ['used', 'open', 'also'],
    );
  });

  it('locks a song to the reel assignment, not the day the reel was generated', () => {
    const picks = [
      {
        postIdeaId: 'idea-a',
        audioId: 'song-a',
        finishedAt: '2026-09-29T15:00:00.000Z',
        assignmentDate: '2026-09-28',
      },
      {
        postIdeaId: 'idea-b',
        audioId: 'song-b',
        finishedAt: '2026-09-28T18:00:00.000Z',
        assignmentDate: '2026-09-29',
      },
    ];
    const monday = claimsForAssignment(picks, '2026-09-28');
    const tuesday = claimsForAssignment(picks, '2026-09-29');
    assert.equal(songHeldByIdea(monday, 'idea-a')?.audioId, 'song-a');
    assert.equal(songHeldByIdea(tuesday, 'idea-a'), null);
    assert.deepEqual([...audioIdsHeldByOtherIdeas(tuesday, 'idea-a')], ['song-b']);
    assert.deepEqual([...audioIdsHeldByOtherIdeas(monday, 'idea-b')], ['song-a']);
    assert.deepEqual([...audioIdsBlockedForAssignment(picks, '2026-09-29', 'idea-c')].sort(), ['song-a', 'song-b']);
    assert.deepEqual([...audioIdsBlockedForAssignment(picks, '2026-09-28', 'idea-b')], ['song-a']);
  });

  it('refuses embeddings of different sizes', () => {
    assert.throws(() => cosine([1, 0], [1, 0, 0]));
  });

  it('embeds the on-screen copy and caption body only', () => {
    assert.equal(reelMatchText('  Copy on screen ', ' Caption body. '), 'Copy on screen\n\nCaption body.');
  });
});

describe('song ingest schedule', () => {
  it('lands on 12:30 AM Eastern', () => {
    const next = nextRunAt(new Date('2026-09-27T12:00:00Z'), 'America/New_York', 0, 30);
    assert.equal(next.toISOString(), '2026-09-28T04:30:00.000Z');
  });
});

describe('song pick question (P-13 draft)', () => {
  const tags = { genre: 'trap', bpm: 140, instruments: ['808 bass'], vibes: ['dark', 'tense', 'hype', 'gritty', 'confident'] };

  it('offers exactly the 12 shortlisted songs and no escape option', () => {
    const set = songPickSet(Array.from({ length: 12 }, () => tags));
    const labels = Object.keys(set.questions.song.criteria);
    assert.deepEqual(labels, Array.from({ length: 12 }, (_, index) => `song_${index + 1}`));
    assert.ok(set.version.length > 0);
  });

  it('refuses a shortlist that is not exactly 12', () => {
    assert.throws(() => songPickSet([tags]));
  });

  it('sends Jev the copy and caption body only', () => {
    assert.deepEqual(songPickState({ onScreenCopy: ' Copy ', captionBody: ' Body ' }), { on_screen_copy: 'Copy', caption_body: 'Body' });
  });
});

describe('song vocabularies (P-14 draft)', () => {
  it('has no duplicate labels', () => {
    for (const vocab of [GENRES, INSTRUMENTS, VIBES]) assert.equal(new Set(vocab).size, vocab.length);
  });

  it('builds tag text without the BPM', () => {
    const text = songTagText({ genre: 'lo-fi', bpm: 82, instruments: ['piano'], vibes: ['chill', 'warm'] });
    assert.equal(text, 'lo-fi with piano. It sounds chill, warm.');
  });
});

describe('relative tag selection (D-182)', () => {
  const scores = (values: number[]) => Object.fromEntries(values.map((value, index) => [`l${index}`, value]));

  it('keeps every label within the margin of the best', () => {
    assert.deepEqual(selectRelative(scores([0.3, 0.28, 0.26, 0.2]), { min: 1, max: 3 }, 0.05), ['l0', 'l1', 'l2']);
  });

  it('tops up to the minimum by rank when few labels are close', () => {
    assert.deepEqual(selectRelative(scores([0.4, 0.2, 0.19, 0.18, 0.17, 0.1]), { min: 5, max: 10 }, 0.05), ['l0', 'l1', 'l2', 'l3', 'l4']);
  });

  it('cuts to the maximum when many labels are close', () => {
    assert.equal(selectRelative(scores(Array.from({ length: 12 }, () => 0.3)), { min: 5, max: 10 }, 0.05).length, 10);
  });

  it('picks one genre and keeps the measured BPM', () => {
    const tags = tagsFromScores({
      genre: { trap: 0.31, 'lo-fi': 0.2 },
      instrument: { '808 bass': 0.3, piano: 0.1 },
      vibe: scores([0.3, 0.29, 0.28, 0.27, 0.26, 0.1]),
      bpm: 140,
    });
    assert.equal(tags.genre, 'trap');
    assert.equal(tags.bpm, 140);
    assert.deepEqual(tags.instruments, ['808 bass']);
    assert.equal(tags.vibes.length, 5);
  });
});

describe('Meta client (stubbed fetch)', () => {
  type Call = { url: URL; init?: RequestInit };
  function fakeFetch(responses: Array<Record<string, unknown>>) {
    const calls: Call[] = [];
    const impl = (async (input: URL | string, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      const body = responses.shift() ?? {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { calls, impl };
  }

  function withMetaEnv<T>(run: () => Promise<T>): Promise<T> {
    const saved = { token: process.env.META_USER_ACCESS_TOKEN, ig: process.env.META_IG_BUSINESS_ACCOUNT_ID };
    process.env.META_USER_ACCESS_TOKEN = 'test-token';
    process.env.META_IG_BUSINESS_ACCOUNT_ID = '17800000000000000';
    return run().finally(() => {
      process.env.META_USER_ACCESS_TOKEN = saved.token;
      process.env.META_IG_BUSINESS_ACCOUNT_ID = saved.ig;
      if (saved.token === undefined) delete process.env.META_USER_ACCESS_TOKEN;
      if (saved.ig === undefined) delete process.env.META_IG_BUSINESS_ACCOUNT_ID;
    });
  }

  it('reads trending from `audio` and follows the after cursor until it has enough', () =>
    withMetaEnv(async () => {
      const { calls, impl } = fakeFetch([
        { audio: [{ audio_id: 'a' }, { audio_id: 'b' }], paging: { cursors: { after: 'MjUZD' } } },
        { audio: [{ audio_id: 'b' }, { audio_id: 'c' }], paging: { cursors: { before: 'MjUZD', after: 'NTAZD' } } },
      ]);
      const sounds = await createLiveMetaClient(impl).trending('music', 3);
      assert.deepEqual(sounds.map((sound) => sound.audio_id), ['a', 'b', 'c'], 'an overlapping sound keeps its first position');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url.pathname, '/v26.0/ig_audio');
      assert.equal(calls[0].url.searchParams.get('audio_type'), 'music');
      assert.equal(calls[0].url.searchParams.get('user_id'), '17800000000000000');
      assert.equal(calls[0].url.searchParams.has('after'), false);
      assert.equal(calls[1].url.searchParams.get('after'), 'MjUZD');
    }));

  it('stops when a page comes back empty', () =>
    withMetaEnv(async () => {
      const { calls, impl } = fakeFetch([
        { audio: [{ audio_id: 'a' }], paging: { cursors: { after: 'x' } } },
        { audio: [], paging: { cursors: { after: 'y' } } },
      ]);
      assert.equal((await createLiveMetaClient(impl).trending('music', 30)).length, 1);
      assert.equal(calls.length, 2);
    }));

  it('creates a trial reel container with the song attached and no share_to_feed while OPEN-3 is open', () =>
    withMetaEnv(async () => {
      const { calls, impl } = fakeFetch([{ id: 'container-1' }]);
      const id = await createLiveMetaClient(impl).createReelContainer({
        videoUrl: 'https://example.com/reel.mp4',
        caption: 'Body\n\nCTA\n\n#ai',
        audioId: '123',
        audioVolume: 100,
        videoVolume: 60,
        graduationStrategy: 'SS_PERFORMANCE',
        shareToFeed: null,
      });
      assert.equal(id, 'container-1');
      const form = new URLSearchParams(String(calls[0].init?.body));
      assert.equal(calls[0].url.pathname, '/v26.0/17800000000000000/media');
      assert.equal(form.get('media_type'), 'REELS');
      assert.deepEqual(JSON.parse(form.get('audio_configuration')!), { audio_id: '123', audio_volume: 100, video_volume: 60 });
      assert.deepEqual(JSON.parse(form.get('trial_params')!), { graduation_strategy: 'SS_PERFORMANCE' });
      assert.equal(form.has('share_to_feed'), false);
      assert.equal(form.get('caption'), 'Body\n\nCTA\n\n#ai');
    }));

  it('surfaces a Graph error without the token', () =>
    withMetaEnv(async () => {
      const impl = (async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid parameter', code: 100, fbtrace_id: 't1' } }), { status: 400 })) as unknown as typeof fetch;
      await assert.rejects(createLiveMetaClient(impl).publishContainer('c1'), (error: Error) => {
        assert.match(error.message, /Invalid parameter \(code 100/);
        assert.doesNotMatch(error.message, /test-token/);
        return true;
      });
    }));
});

describe('CLAP client (stubbed fetch)', () => {
  it('waits out a cold endpoint and returns the text embeddings', async () => {
    const saved = { token: process.env.HF_TOKEN, url: process.env.HF_CLAP_ENDPOINT_URL };
    process.env.HF_TOKEN = 'hf-test';
    process.env.HF_CLAP_ENDPOINT_URL = 'https://clap.example.com';
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('loading', { status: 503 })
        : new Response(JSON.stringify({ text_embeddings: [[1, 0], [0, 1]] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      assert.deepEqual(await createLiveClapClient(impl, 0).embedTexts(['a', 'b']), [[1, 0], [0, 1]]);
      assert.equal(calls, 2);
    } finally {
      if (saved.token === undefined) delete process.env.HF_TOKEN;
      else process.env.HF_TOKEN = saved.token;
      if (saved.url === undefined) delete process.env.HF_CLAP_ENDPOINT_URL;
      else process.env.HF_CLAP_ENDPOINT_URL = saved.url;
    }
  });
});

describe('shortlist snapshot', () => {
  it('labels the 12 in similarity order and keeps the audio ranking as evidence', () => {
    const songs = Array.from({ length: 14 }, (_, index) => ({
      audioId: `s${index}`,
      title: `Song ${index}`,
      artist: null,
      genre: 'pop',
      bpm: 100,
      instruments: ['piano'],
      vibes: ['happy'],
      tagTextEmbedding: [1, index / 10],
      audioEmbedding: [index / 10, 1],
    }));
    const result = buildShortlist([1, 0], songs);
    assert.ok(!('tagged' in result));
    assert.equal(result.candidates.length, 12);
    assert.equal(result.candidates[0].audioId, 's0');
    assert.equal(result.candidates[0].label, 'song_1');
    assert.equal(result.audioRanking[0].audioId, 's13');
  });
});

describe('CLAP collapse guard', () => {
  const labels = (a: number[], b: number[]) => ({
    genre: [{ label: 'sound effects', vector: a }],
    instrument: [{ label: 'piano', vector: b }],
    vibe: [],
  });

  it('refuses to tag when unrelated labels embed to the same vector', () => {
    assert.throws(() => assertClapDiscriminates(labels([1, 0.01], [1, 0])), /near-identical/);
  });

  it('lets a working checkpoint through', () => {
    assertClapDiscriminates(labels([1, 0], [0.4, 0.9]));
  });
});

describe('original-sound trending score (D-190)', () => {
  it('ranks tonight\'s sounds by nights on the list, then average position', () => {
    const order = rankByTrend(['a', 'b', 'c', 'd'], [
      { audioId: 'a', nights: 1, avgPosition: 1 },
      { audioId: 'b', nights: 3, avgPosition: 9 },
      { audioId: 'c', nights: 3, avgPosition: 4 },
      { audioId: 'x', nights: 7, avgPosition: 1 },
    ]);
    assert.deepEqual(order, ['c', 'b', 'a', 'd'], 'x is not on tonight\'s list; d has no stats and goes last');
  });

  it('counts a sound once however many samples it appeared in', () => {
    assert.deepEqual(rankByTrend(['a', 'a', 'b'], [{ audioId: 'a', nights: 1, avgPosition: 2 }, { audioId: 'b', nights: 1, avgPosition: 1 }]), ['b', 'a']);
  });
});
