import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import {
  DEPLOY_HOOK_MIN_INTERVAL_MS,
  deployHookDecision,
  fireDeployHook,
  hookStatusText,
  hookedHash,
} from '@/lib/networking/deploy-hook';
import {
  EVENTS_FEED_OBJECT,
  PUBLIC_FEED_CACHE_CONTROL,
  publicFeedUploadRequest,
  publicFeedUrl,
  uploadPublicFeed,
} from '@/lib/networking/public-feed-storage';
import {
  EVENTS_FEED_STATE_ID,
  SUMMARY_MAX_CHARS,
  buildPublicFeed,
  chooseWeek,
  feedContentHash,
  loadPoolPicks,
  plainSummary,
  publicAccess,
  publicEventId,
  publicTags,
  publishSnapshot,
  snapshotWeeks,
  type PoolPick,
} from '@/lib/networking/public-snapshot';
import type { NetworkingQuery } from '@/lib/networking/repository';
import type { StoredNetworkingEvent } from '@/lib/networking/types';

// Offline: pure mappers, a stubbed fetch for Storage and the deploy hook, and PGlite loaded with
// the real db/networking_schema.sql. No network, no model.

const NOW = new Date('2026-10-21T16:00:00Z'); // Wednesday; current week 2026-W43, coming 2026-W44
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS).toISOString();

let seq = 0;
function stored(overrides: Partial<StoredNetworkingEvent> = {}): StoredNetworkingEvent {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    fingerprint: `fp-${seq}`,
    title: `Event ${seq}`,
    description: '',
    canonicalUrl: `https://lu.ma/evt-${seq}`,
    listingUrls: [],
    startAt: inDays(2),
    endAt: null,
    timezone: 'America/New_York',
    venueName: 'Venue',
    address: '1 Main St',
    city: 'Boston',
    metro: 'boston',
    lat: null,
    lng: null,
    attendance: 'in_person',
    access: 'open',
    accessEvidence: null,
    bucket: 'tech',
    industries: [],
    hostName: null,
    status: 'scheduled',
    listings: [{ source: 'luma', sourceEventId: `evt-${seq}`, url: `https://lu.ma/evt-${seq}` }],
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    organizerName: null,
    organizerKind: null,
    organizerUrl: null,
    hosts: [],
    guestCount: null,
    capacity: null,
    spotsRemaining: null,
    isSoldOut: null,
    waitlistActive: null,
    requiresApproval: null,
    isFree: null,
    priceMinCents: null,
    priceMaxCents: null,
    priceCurrency: null,
    organizerEventCount: null,
    organizerMemberCount: null,
    organizerRating: null,
    organizerRatingCount: null,
    seriesKey: null,
    sourceTags: [],
    rsvpOffsite: null,
    signals: {},
    descriptionSource: null,
    detailsFetchedAt: null,
    ...overrides,
  };
}

const EVENT_KEYS = [
  'access', 'address', 'city', 'demand', 'end', 'hosts', 'id', 'metro', 'organizer', 'pick', 'price',
  'rsvpUrl', 'start', 'summary', 'tags', 'timezone', 'title', 'venue',
].sort();

// ---------- Mapper and scrubbing ----------

test('the public event carries only contract fields: no bios, LinkedIn, evidence, raw or ids', () => {
  const row = stored({
    title: 'AI Builders Night',
    accessEvidence: 'invite/approval language',
    organizerName: 'AI Tinkerers Boston',
    hosts: [
      { name: 'Jane Doe', bioShort: 'SECRET-BIO partner at a fund', linkedin: '/in/jane-doe-secret', isVerified: true },
      { name: 'jane doe' },
      { name: 'MassTLC' },
    ],
    signals: { lumaCalendarApiId: 'cal-SECRET', meetupGroupUrlname: 'urlname-secret' },
    seriesKey: 'luma:cal-SECRET',
    guestCount: 120,
    isSoldOut: true,
    waitlistActive: true,
    isFree: true,
    sourceTags: ['discover:boston', 'luma_calendar:aitinkerers', 'category:ai', 'calendar_tag:demo-night', 'topic:machine-learning'],
  });
  const feed = buildPublicFeed([row], [], NOW);
  assert.equal(feed.events.length, 1);
  const ev = feed.events[0];
  assert.deepEqual(Object.keys(ev).sort(), EVENT_KEYS);
  assert.deepEqual(ev.hosts, ['Jane Doe', 'MassTLC']);
  assert.equal(ev.organizer, 'AI Tinkerers Boston');
  assert.deepEqual(ev.demand, { soldOut: true, waitlist: true, going: 120 });
  assert.deepEqual(ev.tags, ['ai', 'demo night', 'machine learning']);
  assert.equal(ev.id, publicEventId(row.fingerprint));
  assert.match(ev.id, /^[0-9a-f]{16}$/);

  const json = JSON.stringify(feed);
  for (const secret of ['SECRET', 'linkedin', 'bioShort', 'invite/approval', row.id, row.fingerprint, 'accessEvidence', 'luma_calendar', 'discover:']) {
    assert.ok(!json.includes(secret), `feed leaks ${secret}`);
  }
});

test('feed envelope: schemaVersion 1, metros in site order with labels and zones', () => {
  const feed = buildPublicFeed([], [], NOW);
  assert.equal(feed.schemaVersion, 1);
  assert.equal(feed.generatedAt, NOW.toISOString());
  assert.deepEqual(feed.metros, [
    { id: 'miami', label: 'Miami', shortLabel: 'Miami', timezone: 'America/New_York' },
    { id: 'boston', label: 'Boston', shortLabel: 'Boston', timezone: 'America/New_York' },
    { id: 'nyc', label: 'New York', shortLabel: 'NYC', timezone: 'America/New_York' },
    { id: 'sf', label: 'SF Bay Area', shortLabel: 'SF', timezone: 'America/Los_Angeles' },
  ]);
  assert.deepEqual(feed.week, { key: '2026-W44', start: '2026-10-26', end: '2026-11-01', picksPublished: false });
});

test('filters: scheduled, now to +60 days, tech or both, all four metros; sorted by start', () => {
  const keep = [
    stored({ metro: 'sf', startAt: inDays(5), timezone: null, title: 'SF keep' }),
    stored({ metro: 'nyc', startAt: inDays(1), bucket: 'both', title: 'NYC keep' }),
    stored({ metro: 'miami', startAt: inDays(59), title: 'Miami keep' }),
    stored({ metro: 'boston', startAt: inDays(3), title: 'Boston keep' }),
  ];
  const drop = [
    stored({ bucket: 'vertical', title: 'vertical' }),
    stored({ startAt: inDays(-0.1), title: 'past' }),
    stored({ startAt: inDays(61), title: 'too far' }),
    stored({ status: 'cancelled', title: 'cancelled' }),
    stored({ canonicalUrl: 'javascript:alert(1)', listings: [], title: 'no link' }),
  ];
  const feed = buildPublicFeed([...drop, ...keep], [], NOW);
  assert.deepEqual(feed.events.map((e) => e.title), ['NYC keep', 'Boston keep', 'SF keep', 'Miami keep']);
  assert.equal(feed.events.find((e) => e.metro === 'sf')?.timezone, 'America/Los_Angeles', 'metro zone when the row has none');
});

test('rsvpUrl is http(s) only and falls back to a listing URL', () => {
  const ev = buildPublicFeed([stored({ canonicalUrl: 'ftp://x', listings: [{ source: 'meetup', sourceEventId: '1', url: 'https://www.meetup.com/g/events/1/' }] })], [], NOW).events[0];
  assert.equal(ev.rsvpUrl, 'https://www.meetup.com/g/events/1/');
});

test('titles are cleaned with the AI Events title cleaner', () => {
  const ev = buildPublicFeed([stored({ title: '🚀 AI Builders Night | Boston | Oct 28!' })], [], NOW).events[0];
  assert.equal(ev.title, 'AI Builders Night');
});

test('price: free, ranges and currency as stored; paid rows are not free', () => {
  const [a, b, c] = buildPublicFeed(
    [
      stored({ startAt: inDays(1), isFree: true }),
      stored({ startAt: inDays(2), access: 'paid', priceMinCents: 2500, priceMaxCents: 5000, priceCurrency: 'USD' }),
      stored({ startAt: inDays(3) }),
    ],
    [],
    NOW,
  ).events;
  assert.deepEqual(a.price, { free: true, minCents: null, maxCents: null, currency: null });
  assert.deepEqual(b.price, { free: false, minCents: 2500, maxCents: 5000, currency: 'USD' });
  assert.deepEqual(c.price, { free: null, minCents: null, maxCents: null, currency: null });
});

// ---------- Summary ----------

test('summary: plain text, at most 280 characters, cut at a word boundary', () => {
  const long = `<p><strong>Join us</strong> for an evening of demos 🚀 and talks. See [the agenda](https://example.com/agenda) &amp; more at https://lu.ma/x.</p> ${'Builders share what they shipped this month. '.repeat(12)}`;
  const s = plainSummary(long)!;
  assert.ok(s.length <= SUMMARY_MAX_CHARS, `length ${s.length}`);
  assert.ok(s.startsWith('Join us for an evening of demos and talks. See the agenda & more at'), s);
  assert.ok(s.endsWith('…'));
  assert.ok(!/[<>*]|https?:|🚀/.test(s), s);
  const body = s.slice(0, -1);
  assert.ok(long.replace(/<[^>]+>/g, ' ').includes(body.split(' ').pop()!), 'the last word is whole');

  assert.equal(plainSummary('Short and sweet.'), 'Short and sweet.');
  assert.equal(plainSummary(''), null);
  assert.equal(plainSummary('  🎉  '), null);
  assert.equal(plainSummary('# Heading\n- one\n- two'), 'Heading one two');
  assert.equal(plainSummary('x'.repeat(400))!.length, SUMMARY_MAX_CHARS);
});

// ---------- Access ----------

test('access: apply for invite or application, approval for host approval, else open', () => {
  const base = { title: 'Mixer', description: '', requiresApproval: null } as const;
  assert.equal(publicAccess({ ...base, access: 'open' }), 'open');
  assert.equal(publicAccess({ ...base, access: 'paid' }), 'open');
  assert.equal(publicAccess({ ...base, access: 'invite_only' }), 'apply');
  assert.equal(publicAccess({ ...base, access: 'open', requiresApproval: true }), 'approval');
  assert.equal(publicAccess({ ...base, access: 'open', description: 'Application required. Apply to attend.' }), 'apply');
  assert.equal(publicAccess({ ...base, access: 'open', title: 'Founders Dinner (Invite-Only)' }), 'apply');
  assert.equal(publicAccess({ ...base, access: 'invite_only', description: 'Approval required to join.' }), 'approval');
  assert.equal(publicAccess({ ...base, access: 'invite_only', requiresApproval: true }), 'approval');
  assert.equal(publicAccess({ ...base, access: 'invite_only', requiresApproval: true, description: 'Members only.' }), 'apply');
});

test('tags come from source categories and topics only', () => {
  assert.deepEqual(publicTags(['discover:sf', 'category:ai', 'topic:ai', 'luma_calendar:x', 'conference:dev']), ['ai']);
  assert.deepEqual(publicTags(Array.from({ length: 10 }, (_, i) => `topic:t${i}`)).length, 6);
});

// ---------- Weeks and picks ----------

test('weeks: the coming Mon-Sun and the week in progress, in New York time', () => {
  assert.deepEqual(snapshotWeeks(NOW), {
    coming: { key: '2026-W44', start: '2026-10-26', end: '2026-11-01' },
    current: { key: '2026-W43', start: '2026-10-19', end: '2026-10-25' },
  });
  // Sunday 11 PM ET is still Sunday: the coming week starts tomorrow.
  assert.equal(snapshotWeeks(new Date('2026-10-26T03:00:00Z')).coming.key, '2026-W44');
  // Monday 1 AM ET: that week is now in progress.
  assert.equal(snapshotWeeks(new Date('2026-10-26T05:00:00Z')).current.key, '2026-W44');
});

test('picks attach to the coming week first, with ranks 1..3 per city', () => {
  const rows = [
    stored({ metro: 'boston', startAt: inDays(6) }),
    stored({ metro: 'boston', startAt: inDays(7) }),
    stored({ metro: 'nyc', startAt: inDays(8) }),
    stored({ metro: 'boston', startAt: inDays(9) }),
    stored({ metro: 'boston', startAt: inDays(10) }),
    stored({ metro: 'boston', startAt: inDays(1) }),
  ];
  const picks: PoolPick[] = [
    { weekKey: '2026-W44', eventId: rows[0].id, metro: 'boston', rank: 7 },
    { weekKey: '2026-W44', eventId: rows[1].id, metro: 'boston', rank: 2 },
    { weekKey: '2026-W44', eventId: rows[2].id, metro: 'nyc', rank: 4 },
    { weekKey: '2026-W44', eventId: rows[3].id, metro: 'boston', rank: 9 },
    { weekKey: '2026-W44', eventId: rows[4].id, metro: 'boston', rank: 12 },
    { weekKey: '2026-W43', eventId: rows[5].id, metro: 'boston', rank: 1 },
  ];
  const feed = buildPublicFeed(rows, picks, NOW);
  assert.deepEqual(feed.week, { key: '2026-W44', start: '2026-10-26', end: '2026-11-01', picksPublished: true });
  const pickOf = (i: number) => feed.events.find((e) => e.id === publicEventId(rows[i].fingerprint))!.pick;
  assert.deepEqual(pickOf(1), { rank: 1, week: '2026-W44' });
  assert.deepEqual(pickOf(0), { rank: 2, week: '2026-W44' });
  assert.deepEqual(pickOf(3), { rank: 3, week: '2026-W44' });
  assert.equal(pickOf(4), null, 'a fourth Boston pick is not shown');
  assert.deepEqual(pickOf(2), { rank: 1, week: '2026-W44' });
  assert.equal(pickOf(5), null, 'last week\'s picks give way to the coming week');
});

test('pick ranks follow the carousel pick order (pins first), not the pool score order', () => {
  const rows = [stored({ startAt: inDays(6) }), stored({ startAt: inDays(7) }), stored({ startAt: inDays(8) })];
  const picks: PoolPick[] = [
    { weekKey: '2026-W44', eventId: rows[0].id, metro: 'boston', rank: 1, pickRank: 2 },
    { weekKey: '2026-W44', eventId: rows[1].id, metro: 'boston', rank: 2, pickRank: 3 },
    // A pinned event that scored last is the first pick.
    { weekKey: '2026-W44', eventId: rows[2].id, metro: 'boston', rank: 9, pickRank: 1 },
  ];
  const feed = buildPublicFeed(rows, picks, NOW);
  const rankOf = (i: number) => feed.events.find((e) => e.id === publicEventId(rows[i].fingerprint))!.pick?.rank;
  assert.deepEqual([rankOf(2), rankOf(0), rankOf(1)], [1, 2, 3]);
});

test('picks of the week in progress stay until the coming week has its own', () => {
  const row = stored({ startAt: inDays(2) });
  const picks: PoolPick[] = [{ weekKey: '2026-W43', eventId: row.id, metro: 'boston', rank: 1 }];
  assert.deepEqual(chooseWeek(picks, NOW), { key: '2026-W43', start: '2026-10-19', end: '2026-10-25', picksPublished: true });
  assert.deepEqual(buildPublicFeed([row], picks, NOW).events[0].pick, { rank: 1, week: '2026-W43' });
  assert.equal(chooseWeek([{ ...picks[0], weekKey: '2026-W40' }], NOW).picksPublished, false);
});

// ---------- Hash ----------

test('the content hash ignores generatedAt and follows the content', () => {
  const rows = [stored({ startAt: inDays(3) })];
  const a = buildPublicFeed(rows, [], NOW);
  const b = buildPublicFeed(rows, [], new Date(NOW.getTime() + 60_000));
  assert.notEqual(a.generatedAt, b.generatedAt);
  assert.equal(feedContentHash(a), feedContentHash(b));
  const c = buildPublicFeed([{ ...rows[0], title: 'Renamed' }], [], NOW);
  assert.notEqual(feedContentHash(a), feedContentHash(c));
});

// ---------- Deploy hook ----------

test('deploy hook decisions: env, change since the last fire, one hour throttle', () => {
  const now = new Date('2026-10-25T17:00:00Z');
  const base = { hookUrl: 'https://api.vercel.com/v1/integrations/deploy/x', contentHash: 'abc123', lastHookAt: null, lastHookStatus: null, now };
  assert.deepEqual(deployHookDecision({ ...base, hookUrl: undefined }), { fire: false, reason: 'no_hook_url' });
  assert.deepEqual(deployHookDecision({ ...base, hookUrl: '  ' }), { fire: false, reason: 'no_hook_url' });
  assert.deepEqual(deployHookDecision(base), { fire: true });
  assert.deepEqual(deployHookDecision({ ...base, lastHookAt: new Date(now.getTime() - DEPLOY_HOOK_MIN_INTERVAL_MS), lastHookStatus: 'ok 201 hash=old999' }), { fire: true });
  assert.deepEqual(deployHookDecision({ ...base, lastHookAt: new Date(now.getTime() - 20 * 60_000), lastHookStatus: 'ok 201 hash=old999' }), {
    fire: false,
    reason: 'throttled',
    retryAfterMs: 40 * 60_000,
  });
  assert.deepEqual(deployHookDecision({ ...base, lastHookAt: new Date(now.getTime() - 5 * 60 * 60_000), lastHookStatus: 'ok 201 hash=abc123' }), {
    fire: false,
    reason: 'unchanged',
  });
  // A failed fire never marks the content as deployed.
  assert.deepEqual(deployHookDecision({ ...base, lastHookAt: new Date(now.getTime() - 2 * 60 * 60_000), lastHookStatus: 'failed 500: boom' }), { fire: true });
});

test('hook status text keeps the hash only on success', () => {
  assert.equal(hookStatusText({ ok: true, status: 201, attempts: 1 }, 'abc'), 'ok 201 hash=abc');
  assert.equal(hookedHash('ok 201 hash=abc'), 'abc');
  assert.equal(hookedHash(hookStatusText({ ok: false, status: 500, error: 'x', attempts: 2 }, 'abc')), null);
  assert.equal(hookedHash(null), null);
});

test('the deploy hook is POSTed with one retry', async () => {
  const calls: string[] = [];
  const statuses = [500, 201];
  const result = await fireDeployHook('https://hook.example/deploy', {
    fetch: (async (url: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      return new Response('{}', { status: statuses.shift()! });
    }) as typeof fetch,
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: true, status: 201, attempts: 2 });
  assert.deepEqual(calls, ['POST https://hook.example/deploy', 'POST https://hook.example/deploy']);

  const failed = await fireDeployHook('https://hook.example/deploy', {
    fetch: (async () => {
      throw new Error('offline');
    }) as typeof fetch,
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 2);
});

// ---------- Upload ----------

const STORAGE = { baseUrl: 'https://proj.supabase.co', serviceRole: 'sb_secret_test' };

test('upload request: public-feeds path, JSON, five-minute cache, upsert, service key', () => {
  const { url, init } = publicFeedUploadRequest(STORAGE, EVENTS_FEED_OBJECT, '{}');
  assert.equal(url.toString(), 'https://proj.supabase.co/storage/v1/object/public-feeds/networking/events.v1.json');
  assert.equal(init.method, 'POST');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['cache-control'], 'max-age=300');
  assert.equal(PUBLIC_FEED_CACHE_CONTROL, 'max-age=300');
  assert.equal(headers['x-upsert'], 'true');
  assert.equal(headers.apikey, 'sb_secret_test');
  assert.equal(headers.authorization, undefined, 'a new-style secret key is never sent as a Bearer token');
  assert.equal(publicFeedUrl(STORAGE.baseUrl), 'https://proj.supabase.co/storage/v1/object/public/public-feeds/networking/events.v1.json');
});

test('upload retries gateway errors and stops on a missing bucket', async () => {
  let calls = 0;
  const statuses = [503, 502, 200];
  await uploadPublicFeed(EVENTS_FEED_OBJECT, '{}', {
    ...STORAGE,
    fetch: (async () => {
      calls += 1;
      return new Response('{}', { status: statuses.shift()! });
    }) as typeof fetch,
    sleep: async () => {},
  });
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    uploadPublicFeed(EVENTS_FEED_OBJECT, '{}', {
      ...STORAGE,
      fetch: (async () => {
        calls += 1;
        return new Response('{"error":"Bucket not found"}', { status: 404 });
      }) as typeof fetch,
      sleep: async () => {},
    }),
    /bucket does not exist/,
  );
  assert.equal(calls, 1);
});

// ---------- Load and publish (PGlite) ----------

function schemaSql(): string {
  return readFileSync(path.join(process.cwd(), 'db', 'networking_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

async function openDb(): Promise<{ pg: PGlite; query: NetworkingQuery }> {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const query: NetworkingQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, query };
}

async function insertEvent(query: NetworkingQuery, input: { metro?: string; startAt: string; bucket?: string; title?: string }): Promise<string> {
  seq += 1;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO networking.events (fingerprint, title, description, canonical_url, start_at, metro, attendance, access, access_evidence, bucket, hosts)
     VALUES ($1, $2, 'A talk and demos.', $3, $4, $5, 'in_person', 'open', 'public rsvp url', $6, $7::jsonb)
     RETURNING id`,
    [
      `fp-db-${seq}`,
      input.title ?? `Event ${seq}`,
      `https://lu.ma/db-${seq}`,
      input.startAt,
      input.metro ?? 'boston',
      input.bucket ?? 'tech',
      JSON.stringify([{ name: 'Host Org', bioShort: 'private bio', linkedin: '/in/someone' }]),
    ],
  );
  await query(`INSERT INTO networking.event_listings (event_id, source, source_event_id, url) VALUES ($1, 'luma', $2, $3)`, [
    rows[0].id,
    `db-${seq}`,
    `https://lu.ma/db-${seq}`,
  ]);
  return rows[0].id;
}

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string | null };

function recordingFetch(recorded: Recorded[], status = 200): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    recorded.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response('{}', { status });
  }) as typeof fetch;
}

test('pool picks: absent table means no picks; excluded rows never count', async () => {
  const { pg, query } = await openDb();
  try {
    assert.deepEqual(await loadPoolPicks(query, ['2026-W44']), []);

    const a = await insertEvent(query, { startAt: inDays(6) });
    const b = await insertEvent(query, { startAt: inDays(7) });
    await pg.exec(`
      CREATE SCHEMA ai_events;
      CREATE TABLE ai_events.pool (
        week_key text NOT NULL, event_id uuid NOT NULL, metro text NOT NULL, rank int, score numeric, gate text,
        picked boolean NOT NULL DEFAULT false, pinned_by text, pinned_at timestamptz, excluded_by text, excluded_at timestamptz
      );`);
    await query(
      `INSERT INTO ai_events.pool (week_key, event_id, metro, rank, picked, excluded_at)
       VALUES ('2026-W44', $1, 'boston', 1, true, NULL), ('2026-W44', $2, 'boston', 2, true, now())`,
      [a, b],
    );
    assert.deepEqual(await loadPoolPicks(query, ['2026-W44']), [{ weekKey: '2026-W44', eventId: a, metro: 'boston', rank: 1, pickRank: null }]);
  } finally {
    await pg.close();
  }
});

test('publishSnapshot uploads the feed, records the hash, and throttles the deploy hook', async () => {
  const { pg, query } = await openDb();
  try {
    const picked = await insertEvent(query, { metro: 'nyc', startAt: inDays(6), title: 'Data Driven NYC | Oct 27' });
    await insertEvent(query, { metro: 'sf', startAt: inDays(2) });
    await insertEvent(query, { metro: 'miami', startAt: inDays(3), bucket: 'vertical' });
    await pg.exec(`CREATE SCHEMA ai_events; CREATE TABLE ai_events.pool (week_key text, event_id uuid, metro text, rank int, picked boolean);`);
    await query(`INSERT INTO ai_events.pool VALUES ('2026-W44', $1, 'nyc', 1, true)`, [picked]);

    const recorded: Recorded[] = [];
    const logs: string[] = [];
    const deps = {
      q: query,
      storage: STORAGE,
      hookUrl: 'https://hook.example/deploy',
      fetch: recordingFetch(recorded, 201),
      sleep: async () => {},
      log: (_level: string, message: string) => void logs.push(message),
    };

    const first = await publishSnapshot({ ...deps, now: NOW, reason: 'test' });
    assert.equal(first.events, 2);
    assert.equal(first.picks, 1);
    assert.equal(first.weekKey, '2026-W44');
    assert.equal(first.changed, true);
    assert.deepEqual(first.hook, { fired: true, ok: true, status: 201, error: undefined });
    assert.equal(recorded.length, 2);
    const [upload, hook] = recorded;
    assert.equal(upload.url, 'https://proj.supabase.co/storage/v1/object/public-feeds/networking/events.v1.json');
    assert.equal(upload.headers['cache-control'], 'max-age=300');
    assert.equal(hook.url, 'https://hook.example/deploy');
    assert.equal(hook.method, 'POST');

    const feed = JSON.parse(upload.body!);
    assert.equal(feed.schemaVersion, 1);
    assert.deepEqual(feed.events.map((e: { metro: string }) => e.metro), ['sf', 'nyc']);
    assert.equal(feed.events[1].title, 'Data Driven NYC');
    assert.deepEqual(feed.events[1].pick, { rank: 1, week: '2026-W44' });
    assert.deepEqual(feed.events[1].hosts, ['Host Org']);
    assert.ok(!upload.body!.includes('private bio') && !upload.body!.includes('/in/someone') && !upload.body!.includes('public rsvp url'));

    const state = await query<{ last_hash: string; last_published_at: Date; last_hook_status: string }>(
      `SELECT last_hash, last_published_at, last_hook_status FROM networking.publish_state WHERE id = $1`,
      [EVENTS_FEED_STATE_ID],
    );
    assert.equal(state.rows[0].last_hash, first.contentHash);
    assert.equal(state.rows[0].last_hook_status, `ok 201 hash=${first.contentHash}`);

    // Same content ten minutes later: uploaded again (fresh generatedAt), hook not fired.
    recorded.length = 0;
    const second = await publishSnapshot({ ...deps, now: new Date(NOW.getTime() + 10 * 60_000), reason: 'test' });
    assert.equal(second.changed, false);
    assert.deepEqual(second.hook, { fired: false, reason: 'unchanged', retryAfterMs: undefined });
    assert.equal(recorded.length, 1);

    // New content inside the hour: throttled. After the hour: fires.
    await insertEvent(query, { metro: 'boston', startAt: inDays(4) });
    recorded.length = 0;
    const third = await publishSnapshot({ ...deps, now: new Date(NOW.getTime() + 30 * 60_000), reason: 'test' });
    assert.equal(third.changed, true);
    assert.equal(third.hook.fired, false);
    assert.equal(!third.hook.fired && third.hook.reason, 'throttled');
    const fourth = await publishSnapshot({ ...deps, now: new Date(NOW.getTime() + 61 * 60_000), reason: 'test' });
    assert.equal(fourth.changed, false, 'the content was already uploaded by the throttled publish');
    assert.equal(fourth.hook.fired, true, 'but the site was never rebuilt with it');
    assert.ok(logs.includes('deploy hook skipped: throttled'));

    // No hook URL: skipped and logged, upload still happens.
    const fifth = await publishSnapshot({ ...deps, hookUrl: null, now: new Date(NOW.getTime() + 3 * 60 * 60_000), reason: 'test' });
    assert.deepEqual(fifth.hook, { fired: false, reason: 'no_hook_url', retryAfterMs: undefined });
  } finally {
    await pg.close();
  }
});

test('publishSnapshot refuses to blank a published feed and leaves state alone on upload failure', async () => {
  const { pg, query } = await openDb();
  try {
    const recorded: Recorded[] = [];
    const deps = { q: query, storage: STORAGE, hookUrl: null, sleep: async () => {}, log: () => {} };

    // First publish ever may be empty.
    const empty = await publishSnapshot({ ...deps, fetch: recordingFetch(recorded), now: NOW, reason: 'test' });
    assert.equal(empty.events, 0);
    await assert.rejects(publishSnapshot({ ...deps, fetch: recordingFetch(recorded), now: NOW, reason: 'test' }), /refusing to publish an empty/);
    const forced = await publishSnapshot({ ...deps, fetch: recordingFetch(recorded), now: NOW, reason: 'test', allowEmpty: true });
    assert.equal(forced.events, 0);

    await insertEvent(query, { startAt: inDays(2) });
    const before = await query(`SELECT last_hash, last_published_at FROM networking.publish_state`);
    await assert.rejects(publishSnapshot({ ...deps, fetch: recordingFetch(recorded, 403), now: new Date(NOW.getTime() + 60_000), reason: 'test' }), /upload failed \(403\)/);
    const after = await query(`SELECT last_hash, last_published_at FROM networking.publish_state`);
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await pg.close();
  }
});

test('a failed deploy hook never stores or returns the secret hook URL', async () => {
  const secret = 'https://api.vercel.com/v1/integrations/deploy/prj_SECRET/abc123';
  const thrown = await fireDeployHook(secret, {
    fetch: (async () => {
      throw new Error(`Failed to parse URL from ${secret}`);
    }) as typeof fetch,
    sleep: async () => {},
  });
  assert.equal(thrown.ok, false);
  assert.ok(!(thrown.error ?? '').includes(secret), thrown.error);
  assert.match(thrown.error ?? '', /\[deploy hook\]/);
  const echoed = await fireDeployHook(secret, {
    fetch: (async () => new Response(`bad hook ${secret}`, { status: 400 })) as typeof fetch,
    sleep: async () => {},
  });
  assert.ok(!(echoed.error ?? '').includes(secret), echoed.error);
});
