import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { CALIBRATION_ITEMS, CALIBRATION_STORIES, NEAR_MISSES } from '@/lib/reel-ai-drama/development/calibration-data';
import { calibrationReport, runCalibration, seedCalibrationPitches } from '@/lib/reel-ai-drama/development/calibration';
import { eventKey, findDuplicate, similarity } from '@/lib/reel-ai-drama/development/dedupe';
import { allCells, cellFromRow, markSearched, newsTouching, pickCells, seedCells } from '@/lib/reel-ai-drama/development/ledger';
import { nextForProduction, rankScore, tendPool } from '@/lib/reel-ai-drama/development/pool';
import { producePitches, selectPitches, validatePitch, type CreateMessage } from '@/lib/reel-ai-drama/development/producer';
import { capWithoutPlayer, combineDrama, combineMaterial, DRAMA_SET, MATERIAL_SET } from '@/lib/reel-ai-drama/development/scores';
import { runDevelopmentSession } from '@/lib/reel-ai-drama/development/session';
import { checkVisuals, gradeCard, type ImageHit, type VisualsCheckDeps } from '@/lib/reel-ai-drama/development/visuals-check';
import { RecordingDramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Pitch, PitchRow } from '@/lib/reel-ai-drama/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

async function freshDb(): Promise<Queryable> {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

const DAY = 86_400_000;
const TODAY = '2026-10-28';

function pitch(over: Partial<Pitch> = {}): Pitch {
  return {
    title: 'The founder who bet the company',
    logline: 'A founder risks everything on one chip.',
    pitch: 'A founder with weeks of cash left flies to a partner and asks for money he expects to lose.',
    story_type: 'big_bet',
    era: 'origins',
    event_date: '1996-03-01',
    date_precision: 'month',
    cast: [
      { name: 'Jensen Huang', role: 'founder', kind: 'person', player_id: 'jensen-huang', want: 'to save his company' },
      { name: 'Nvidia', role: 'the company', kind: 'company', player_id: 'nvidia', want: 'to survive' },
    ],
    central_figure: 'Jensen Huang',
    scene: 'A meeting room in Tokyo.',
    turn: 'The partner says yes.',
    implication: 'The company that powers AI nearly died.',
    why_now: null,
    engine: 'countdown',
    expected_visuals: [
      { kind: 'person_photo', what: 'the founder', hint: 'Jensen Huang 1996' },
      { kind: 'event_photo', what: 'the meeting', hint: 'Jensen Huang Tokyo meeting' },
      { kind: 'place_photo', what: 'Tokyo', hint: 'Tokyo' },
    ],
    sources: [
      { url: 'https://example.com/story', title: 'The story', publisher: 'Example News', date: null },
      { url: 'https://x.com/someone/status/1', title: 'A post', publisher: 'X', date: null },
      { url: 'https://www.sec.gov/filing.htm', title: 'A filing', publisher: 'SEC', date: null },
    ],
    ...over,
  };
}

// ── Stubs ───────────────────────────────────────────────────────────────────

type Answer = number;
/** A Jev transport answering every question from `fn(state, key)`; score questions get 0–4, nouls 0–1. */
function stubJev(fn: (state: Record<string, unknown>, key: string) => Answer): JevTransport & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async systemOne(state, questions) {
      const keys = Object.keys(questions);
      calls.push(keys);
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        const a = fn(state as Record<string, unknown>, key);
        answers[key] = questions[key].type === 'noul' ? { type: 'noul', noul: a } : { type: 'score', score: a, confidence: 1, legend: {}, probabilities: {} };
      }
      return { model: 'jev-stub', answers, usage: { input_tokens: 1000, output_tokens: 5 } } as never;
    },
  };
}

function message(content: unknown[], stop: string, usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  return {
    id: `msg_${Math.random()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 }, ...usage },
  } as unknown as Anthropic.Message;
}

const candidate = (p: Pitch, typicality: number) => ({ ...p, typicality });

function stubCreate(candidates: unknown[], opts: { pauseFirst?: boolean } = {}): CreateMessage & { params: Anthropic.MessageCreateParamsNonStreaming[] } {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const fn = (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    params.push(p);
    if (opts.pauseFirst && params.length === 1) {
      return message([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'first query' } }], 'pause_turn');
    }
    return message(
      [
        { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'second query' } },
        { type: 'tool_use', id: 't1', name: 'submit_pitches', input: { candidates } },
      ],
      'tool_use',
    );
  }) as CreateMessage & { params: Anthropic.MessageCreateParamsNonStreaming[] };
  fn.params = params;
  return fn;
}

const hit = (i: number): ImageHit => ({ url: `https://news.example.com/${i}.jpg`, thumbnail: `https://t.example.com/${i}.jpg`, width: 1600, height: 1000, domain: 'news.example.com', title: `Jensen Huang photo ${i}`, page: null });

function visualsDeps(over: Partial<VisualsCheckDeps> = {}): VisualsCheckDeps {
  return {
    commonsDepth: async () => 40,
    wikidataQid: async () => 'Q1',
    geocode: async () => ({ lat: 35.68, lon: 139.69 }),
    imageSearch: async () => ({ hits: [hit(1), hit(2), hit(3), hit(4)], usd: 0.001 }),
    look: async ({ hits }) => ({
      tiles: hits.map((_, index) => ({ index, usable: true, watermark: index === 3, ai_art: false, relevant: true, kind: 'event_photo' as const, note: 'a photo' })),
      cost: { vendor: 'anthropic' as const, usd: 0.0005, inputTokens: 3000, outputTokens: 200 },
    }),
    banked: () => null,
    hasLogo: (id) => id === 'nvidia',
    ...over,
  };
}

// ── Ledger ──────────────────────────────────────────────────────────────────

test('seedCells inserts the whole grid once, skipping eras before a company existed', async () => {
  const db = await freshDb();
  const n = await seedCells(db);
  assert.equal(n, allCells().length);
  assert.ok(!allCells().some((c) => c.player_id === 'anthropic' && c.era === 'early_labs'));
  assert.ok(allCells().some((c) => c.player_id === 'anthropic' && c.era === 'scale_up'));
  assert.equal(await seedCells(db), 0);
});

async function insertCell(db: Queryable, c: { player: string; type: string; era: string; searchedDaysAgo?: number; dueInDays?: number }, now: Date) {
  const searched = c.searchedDaysAgo === undefined ? null : new Date(now.getTime() - c.searchedDaysAgo * DAY).toISOString();
  const due = c.dueInDays === undefined ? null : new Date(now.getTime() + c.dueInDays * DAY).toISOString();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.cells (player_id, story_type, era, last_searched_at, due_at, searches) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [c.player, c.type, c.era, searched, due, searched ? 1 : 0],
  );
  return rows[0].id;
}

test('pickCells: new before due, spread across players and types, reopened by news last', async () => {
  const db = await freshDb();
  const now = new Date('2026-10-28T12:00:00Z');
  const a1 = await insertCell(db, { player: 'sam-altman', type: 'rivalry', era: 'now' }, now);
  const a2 = await insertCell(db, { player: 'sam-altman', type: 'deal', era: 'now' }, now);
  const b1 = await insertCell(db, { player: 'elon-musk', type: 'courtroom', era: 'race', searchedDaysAgo: 200, dueInDays: -80 }, now);
  const c1 = await insertCell(db, { player: 'dario-amodei', type: 'launch', era: 'now', searchedDaysAgo: 10, dueInDays: 110 }, now);
  const settings = { cells_per_session: 3 };
  const random = () => 0.5;

  const one = await pickCells(db, settings, now, { count: 1, random });
  assert.ok([a1, a2].includes(one[0].id), 'a never-searched cell comes first');

  const three = await pickCells(db, settings, now, { random });
  assert.deepEqual(new Set(three.map((c) => c.id)).has(c1), false, 'a cell not due and not reopened is never picked');
  assert.equal(three.filter((c) => c.player_id === 'sam-altman').length, 2, 'a repeated player only fills a slot nothing else can');
  assert.equal(three[1].id, b1, 'the due cell beats a second cell of the same player');

  // News older than the last search does not reopen; newer news does.
  await pickCells(db, settings, now, { random, reopen: [{ playerId: 'dario-amodei', reason: 'old news', since: new Date(now.getTime() - 20 * DAY).toISOString() }] });
  const { rows: [still] } = await db.query<Record<string, unknown>>('SELECT * FROM reel_ai_drama.cells WHERE id = $1', [c1]);
  assert.equal(cellFromRow(still).reopen_reason, null);
  const reopened = await pickCells(db, settings, now, { random, reopen: [{ playerId: 'dario-amodei', reason: 'news: a launch', since: new Date(now.getTime() - DAY).toISOString() }] });
  assert.ok(reopened.some((c) => c.id === b1) && reopened.some((c) => c.id === a1 || c.id === a2));
  assert.ok(reopened.some((c) => c.id === c1 && c.reopen_reason === 'news: a launch'));
  assert.equal(new Set(reopened.map((c) => c.player_id)).size, 3, 'three players, one cell each');

  await markSearched(db, c1, { pitchesMade: 2, now, dueDays: 120 });
  const { rows: [after] } = await db.query<Record<string, unknown>>('SELECT * FROM reel_ai_drama.cells WHERE id = $1', [c1]);
  const cell = cellFromRow(after);
  assert.equal(cell.searches, 2);
  assert.equal(cell.pitches_made, 2);
  assert.equal(cell.reopen_reason, null);
  assert.equal(new Date(cell.due_at!).getTime(), now.getTime() + 120 * DAY);
});

test('newsTouching filters the news pool by player tokens and window', async () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const read = async () => [
    { headline: 'Altman and Musk trade barbs again', url: 'https://a.example/1', publishedAt: new Date(now.getTime() - 2 * DAY).toISOString() },
    { headline: 'Nvidia posts record quarter', url: 'https://a.example/2', publishedAt: new Date(now.getTime() - 30 * DAY).toISOString() },
    { headline: 'A quiet day in markets', url: 'https://a.example/3', publishedAt: now.toISOString() },
    { headline: 'appleseed farming tips', url: 'https://a.example/4', publishedAt: now.toISOString() },
  ];
  const items = await newsTouching({} as Queryable, now, 7, read);
  assert.deepEqual(items.map((i) => i.playerId).sort(), ['elon-musk', 'sam-altman']);
});

// ── Producer ────────────────────────────────────────────────────────────────

test('validatePitch is strict on structure and resolves player ids from the blue-chip list', () => {
  const ok = validatePitch({ ...pitch(), typicality: 0.3 }, { today: TODAY });
  assert.ok(ok.ok);
  const resolved = validatePitch(
    { ...pitch({ cast: [{ name: 'Sam Altman', role: 'CEO', kind: 'person', player_id: 'altman-sam', want: 'control' }], central_figure: 'sam altman' }) },
    { today: TODAY },
  );
  assert.ok(resolved.ok && resolved.pitch.cast[0].player_id === 'sam-altman' && resolved.pitch.central_figure === 'Sam Altman');
  const unknown = validatePitch({ ...pitch({ cast: [{ name: 'Jane Doe', role: 'engineer', kind: 'person', player_id: 'jane', want: 'x' }], central_figure: 'Jane Doe' }) }, { today: TODAY });
  assert.ok(unknown.ok && unknown.pitch.cast[0].player_id === null);

  const bad: [Partial<Pitch> | Record<string, unknown>, RegExp][] = [
    [{ story_type: 'heist' }, /story_type/],
    [{ era: 'future' }, /era/],
    [{ central_figure: 'Someone Else' }, /not in the cast/],
    [{ event_date: null }, /no event_date/],
    [{ event_date: '2027-01-01' }, /future/],
    [{ event_date: '2024-02-30' }, /bad event_date/],
    [{ expected_visuals: [{ kind: 'hologram', what: 'x', hint: '' }] }, /visual kind/],
    [{ sources: [] }, /no sources/],
    [{ sources: [{ url: 'not a url', title: 't', publisher: 'p', date: null }] }, /source url/],
  ];
  for (const [over, why] of bad) {
    const v = validatePitch({ ...pitch(), ...over }, { today: TODAY });
    assert.ok(!v.ok && why.test(v.why), `expected ${why} for ${JSON.stringify(over)}`);
  }
});

test('selectPitches keeps the least typical candidates that pass', () => {
  const { pitches, dropped } = selectPitches(
    [candidate(pitch({ title: 'Typical' }), 0.9), candidate(pitch({ title: 'Rare' }), 0.1), { title: 'Broken' }, candidate(pitch({ title: 'Middling' }), 0.4)],
    2,
    TODAY,
  );
  assert.deepEqual(pitches.map((p) => p.title), ['Rare', 'Middling']);
  assert.deepEqual(dropped.map((d) => d.title).sort(), ['Broken', 'Typical']);
});

test('producePitches: one cell, cached prefix, nearest pitches only, resumes pause_turn, records cost', async () => {
  const db = await freshDb();
  const create = stubCreate([candidate(pitch({ title: 'Kept' }), 0.2), candidate(pitch({ title: 'Too typical' }), 0.95)], { pauseFirst: true });
  const nearest = Array.from({ length: 20 }, (_, i) => pitch({ title: `Old ${i}` }));
  const cell = { id: 'c', player_id: 'jensen-huang', story_type: 'big_bet', era: 'origins', searches: 0, pitches_made: 0, last_searched_at: null, due_at: null, reopen_reason: null, created_at: '' } as const;
  const result = await producePitches(
    { db, create, loadPrompt: () => 'STUB PRODUCER PROMPT', model: 'claude-sonnet-5-5', pitchesPerCell: 1, sessionId: null },
    cell,
    { nearest, news: [], today: TODAY },
  );
  assert.deepEqual(result.pitches.map((p) => p.title), ['Kept']);
  assert.deepEqual(result.queries, ['first query', 'second query']);
  assert.equal(create.params.length, 2);
  const params = create.params[0];
  const system = params.system as Anthropic.TextBlockParam[];
  assert.equal(system[0].text, 'STUB PRODUCER PROMPT');
  assert.ok(system[system.length - 1].cache_control, 'the last system block carries the cache breakpoint');
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  const user = JSON.parse(String((params.messages[0] as { content: string }).content));
  assert.equal(user.already_pitched.length, 12);
  assert.equal(user.candidates_wanted, 2);
  assert.equal(user.cell.player.name, 'Jensen Huang');
  const { rows } = await db.query<{ component: string; vendor: string; web_searches: number; usd: unknown }>('SELECT * FROM reel_ai_drama.cost_events');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].component, 'producer');
  assert.equal(rows[0].vendor, 'anthropic');
  assert.equal(Number(rows[0].web_searches), 4);
  assert.ok(Number(rows[0].usd) > 0 && Math.abs(Number(rows[0].usd) - result.usd) < 1e-6);
});

// ── Dedupe ──────────────────────────────────────────────────────────────────

async function insertPast(db: Queryable, p: Pitch, status = 'pooled') {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, event_date, status) VALUES ($1, $2::jsonb, $3, $4::date, $5) RETURNING id`,
    [p.title, JSON.stringify(p), eventKey(p), p.event_date, status],
  );
  return rows[0].id;
}

test('eventKey ignores wording; findDuplicate runs fingerprint, similarity, then Jev on borderline only', async () => {
  const base = pitch();
  assert.equal(eventKey(base), eventKey(pitch({ title: 'Completely different words', logline: 'Other', event_date: '1996-03-20' })));
  assert.notEqual(eventKey(base), eventKey(pitch({ event_date: '1997-03-01' })));

  const db = await freshDb();
  const transport = stubJev((_s, key) => (key === 'pair_0' ? 0.9 : 0.1));
  const jev = new RecordingDramaJevRunner(transport, db, { mode: 'development' });

  const original = await insertPast(db, base);
  const exact = await findDuplicate(db, jev, pitch({ title: 'Reworded' }));
  assert.equal(exact?.duplicateOf, original);
  assert.match(exact!.why, /fingerprint/);
  assert.equal(transport.calls.length, 0);

  // Same cast and month but a different story type: not the same key, very similar → Jev decides.
  const borderline = pitch({ title: 'A dinner in Tokyo', story_type: 'deal', scene: 'A dinner.' });
  const s = similarity(borderline, base);
  assert.ok(s >= 0.45 && s < 0.85, `borderline similarity, got ${s}`);
  const viaJev = await findDuplicate(db, jev, borderline);
  assert.equal(viaJev?.duplicateOf, original);
  assert.match(viaJev!.why, /Jev/);
  assert.equal(transport.calls.length, 1);
  const { rows: logs } = await db.query<{ question_set_id: string }>('SELECT question_set_id FROM reel_ai_drama.jev_logs');
  assert.equal(logs[0].question_set_id, 'reel-ai-drama-same-event-v1');

  const unrelated = pitch({
    title: 'A lab founder walks out',
    cast: [{ name: 'Dario Amodei', role: 'founder', kind: 'person', player_id: 'dario-amodei', want: 'safety' }],
    central_figure: 'Dario Amodei',
    event_date: '2021-01-01',
    story_type: 'founding_moment',
    era: 'scale_up',
  });
  assert.equal(await findDuplicate(db, jev, unrelated), null);
  assert.equal(transport.calls.length, 1, 'no Jev call for a clearly different event');

  const noJev = stubJev(() => 0.1);
  assert.equal(await findDuplicate(db, new RecordingDramaJevRunner(noJev, db, { mode: 'development' }), borderline), null);
});

// ── Scores ──────────────────────────────────────────────────────────────────

test('score combination: drama weights MD-29 most and caps without a central want; material weights', () => {
  const all = (v: number) => ({ central_want: { score: v }, stakes: { score: v }, scene: { score: v }, turn: { score: v }, implication: { score: v }, mostly_spectacle: { noul: 0 } });
  assert.equal(combineDrama(all(4)).score, 1);
  assert.equal(combineDrama(all(2)).score, 0.5);
  const noWant = combineDrama({ ...all(4), central_want: { score: 1 } });
  assert.equal(noWant.score, 0.45);
  assert.match(noWant.notes.cap, /MD-29/);
  const spectacle = combineDrama({ ...all(4), mostly_spectacle: { noul: 0.8 } });
  assert.equal(spectacle.score, 0.5);
  const wantHeavy = combineDrama({ ...all(0), central_want: { score: 4 } }).score;
  const sceneHeavy = combineDrama({ ...all(0), scene: { score: 4 } }).score;
  assert.ok(wantHeavy > sceneHeavy * 2);
  assert.throws(() => combineDrama({ stakes: { score: 2 } }), /central_want/);

  const m = combineMaterial({ famous_faces: { score: 4 }, photographed_events: { score: 4 }, published_artifacts: { score: 0 }, variety: { score: 0 }, named_place: { score: 0 }, era_photos: { score: 0 } });
  assert.equal(m.score, 0.45);
  assert.equal(DRAMA_SET.id, 'reel-ai-drama-drama-v4');
  assert.equal(MATERIAL_SET.id, 'reel-ai-drama-material-v1');
});

test('question wording never names a calibration story or its people', () => {
  const words = JSON.stringify([DRAMA_SET.questions, MATERIAL_SET.questions]).toLowerCase();
  const names = new Set<string>();
  for (const item of CALIBRATION_ITEMS) for (const c of item.pitch.cast) names.add(c.name.toLowerCase());
  for (const n of [...names, 'chatgpt', 'nobel', 'denny', 'rosewood', 'alphafold', 'stargate', 'deepseek']) assert.ok(!words.includes(n), `question wording mentions ${n}`);
});

// ── Visuals check ───────────────────────────────────────────────────────────

test('visuals card grading: gates and graceful skips', async () => {
  assert.equal(gradeCard({ faces: true, specific: true, kinds: true }), 'green');
  assert.equal(gradeCard({ faces: false, specific: true, kinds: true }), 'amber');
  assert.equal(gradeCard({ faces: true, specific: true, kinds: false }), 'amber');
  assert.equal(gradeCard({ faces: false, specific: true, kinds: false }), 'red');
  assert.equal(gradeCard({ faces: true, specific: false, kinds: true }), 'red');

  const lines: number[] = [];
  const green = await checkVisuals(visualsDeps({ record: async (l) => void lines.push(l.usd) }), pitch(), 0.35);
  assert.equal(green.grade, 'green');
  assert.equal(green.faces[0].found, true);
  assert.ok(green.kinds.includes('person_photo') && green.kinds.includes('logo') && green.kinds.includes('map'));
  assert.equal(green.counts.event_photo, 3, 'the watermarked tile is not counted');
  assert.ok(green.usd < 0.35 && lines.length === 3);

  const noSerper = await checkVisuals(visualsDeps({ imageSearch: null }), pitch({ sources: [{ url: 'https://example.com/a', title: 'a', publisher: '', date: null }] }), 0.35);
  assert.ok(noSerper.gaps.some((g) => /SERPER_API_KEY/.test(g)));
  assert.equal(noSerper.grade, 'red', 'too few story-specific visuals');

  const capped = await checkVisuals(visualsDeps(), pitch(), 0.0015);
  assert.ok(capped.gaps.some((g) => /cost cap/.test(g)));
  assert.ok(capped.usd <= 0.0015);

  const faceless = await checkVisuals(visualsDeps({ commonsDepth: async () => 0, wikidataQid: async () => null }), pitch(), 0.35);
  assert.equal(faceless.grade, 'amber');
  assert.ok(faceless.gaps.some((g) => /central figure/.test(g)));
});

// ── Pool ────────────────────────────────────────────────────────────────────

function row(over: Partial<PitchRow> & { pitch?: Pitch } = {}): PitchRow {
  const p = over.pitch ?? pitch();
  return {
    id: 'r', session_id: null, cell_id: null, origin: 'producer', title: p.title, pitch: p, event_key: eventKey(p), event_date: p.event_date,
    central_player_id: 'jensen-huang', status: 'pooled', duplicate_of: null, reject_reason: null, revive_when: null, drama: null, drama_score: 0.8,
    material: null, material_score: 0.7, visuals_card: null, visuals_grade: 'green', rank_score: null, created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z', made_at: null, ...over,
  };
}

test('rankScore: drama dominates, fresh news with a why-now gets a bonus, stale news fades, history never does', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const s = DEFAULT_SETTINGS;
  assert.ok(rankScore(row({ drama_score: 0.9, material_score: 0.6 }), s, now) > rankScore(row({ drama_score: 0.8, material_score: 1 }), s, now));
  assert.equal(rankScore(row({ drama_score: 0.5 }), s, now), 0, 'under the drama bar');
  assert.equal(rankScore(row({ material_score: 0.4 }), s, now), 0, 'under the material bar');

  const freshNews = pitch({ event_date: '2026-10-10', why_now: 'it just happened' });
  const fresh = rankScore(row({ pitch: freshNews, event_date: '2026-10-10' }), s, now);
  const plain = rankScore(row({ pitch: { ...freshNews, why_now: null }, event_date: '2026-10-10' }), s, now);
  assert.ok(Math.abs(fresh - plain - 0.05) < 1e-9);

  const oldNews = pitch({ event_date: '2026-05-01' });
  const stale = row({ pitch: oldNews, event_date: '2026-05-01', created_at: '2026-05-10T00:00:00Z' });
  assert.ok(Math.abs(rankScore(stale, s, now) - rankScore(row(), s, now) / 2) < 1e-4, 'news past its window fades');
  assert.equal(rankScore(row(), s, now), rankScore(row(), s, new Date('2030-01-01')), 'history keeps its rank');
  assert.ok(rankScore(row({ visuals_grade: 'amber' }), s, now) < rankScore(row(), s, now));
});

async function insertPooled(db: Queryable, p: Pitch, over: { drama: number; player: string | null; status?: string; createdAt?: string; madeAt?: string | null }) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, event_date, central_player_id, status, drama_score, material_score, visuals_grade, created_at, made_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4::date, $5, $6, $7, 0.7, 'green', $8, $9, $8) RETURNING id`,
    [p.title, JSON.stringify(p), eventKey(p), p.event_date, over.player, over.status ?? 'pooled', over.drama, over.createdAt ?? '2026-10-01T00:00:00Z', over.madeAt ?? null],
  );
  return rows[0].id;
}

test('nextForProduction respects the one-player-per-week spread; tendPool retires stale news', async () => {
  const db = await freshDb();
  const now = new Date('2026-10-28T00:00:00Z');
  const top = await insertPooled(db, pitch({ title: 'Top' }), { drama: 0.95, player: 'jensen-huang' });
  const second = await insertPooled(db, pitch({ title: 'Second', central_figure: 'Nvidia' }), { drama: 0.85, player: 'sam-altman' });
  assert.equal((await nextForProduction(db, DEFAULT_SETTINGS, now))?.id, top);

  await insertPooled(db, pitch({ title: 'Made recently' }), { drama: 0.9, player: 'jensen-huang', status: 'made', madeAt: '2026-10-25T00:00:00Z' });
  assert.equal((await nextForProduction(db, DEFAULT_SETTINGS, now))?.id, second, 'Huang was made three days ago');
  assert.equal((await nextForProduction(db, DEFAULT_SETTINGS, new Date('2026-11-05T00:00:00Z')))?.id, top, 'a week later he is free again');

  const stale = await insertPooled(db, pitch({ title: 'Old news', event_date: '2026-03-01' }), { drama: 0.9, player: 'elon-musk', createdAt: '2026-03-05T00:00:00Z' });
  const result = await tendPool(db, DEFAULT_SETTINGS, now);
  assert.equal(result.retired, 1);
  const { rows } = await db.query<{ status: string; revive_when: string }>('SELECT status, revive_when FROM reel_ai_drama.pitches WHERE id = $1', [stale]);
  assert.equal(rows[0].status, 'retired');
  assert.match(rows[0].revive_when, /why-now/);
  assert.equal(result.rechecked, 2);
});

// ── Session ─────────────────────────────────────────────────────────────────

/** Drama and material by title: titles containing "Dull" score low on drama. */
const titleJev = () =>
  stubJev((state, key) => {
    const title = String(state.title ?? '');
    if (key.startsWith('pair_')) return 0;
    if (key === 'mostly_spectacle') return title.includes('Dull') ? 0.9 : 0.05;
    if (key === 'announced_plan') return 0.05;
    if (key === 'about_ai') return 0.95;
    return title.includes('Dull') ? 1 : 3.6;
  });

test('a stubbed development session fills the pool and writes sessions, searches, cells and pitches', async () => {
  const db = await freshDb();
  let n = 0;
  const create = (async (params: { messages: { content: unknown }[] }) => {
    n += 1;
    // Each pitch stays in its cell (validatePitch checks the player, story type and era).
    const { cell } = JSON.parse(String(params.messages[0]!.content)) as { cell: { player: { player_id: string; name: string }; story_type: { key: Pitch['story_type'] }; era: { key: Pitch['era'] } } };
    const lead = { name: cell.player.name, role: 'founder', kind: 'person' as const, player_id: cell.player.player_id, want: 'x' };
    const keys = { story_type: cell.story_type.key, era: cell.era.key, central_figure: cell.player.name };
    const strong = pitch({ ...keys, title: `Strong story ${n}`, event_date: `199${n % 10}-0${(n % 9) + 1}-01`, cast: [lead, { name: `Partner ${n}`, role: 'partner', kind: 'person', player_id: null, want: 'y' }] });
    const dull = pitch({ ...keys, title: `Dull story ${n}`, event_date: `201${n}-01-01`, cast: [lead] });
    return message([{ type: 'tool_use', id: 't', name: 'submit_pitches', input: { candidates: [candidate(strong, 0.2), candidate(dull, 0.3)] } }], 'tool_use', { input_tokens: 1000, output_tokens: 500, server_tool_use: { web_search_requests: 1 } });
  }) as unknown as CreateMessage;
  const summary = await runDevelopmentSession(
    {
      db,
      producer: { create, loadPrompt: () => 'stub' },
      jevTransport: titleJev(),
      visuals: visualsDeps(),
      settings: { ...DEFAULT_SETTINGS, cells_per_session: 3, pitches_per_cell: 2 },
      random: () => 0.5,
      news: async () => [],
    },
    { trigger: 'click' },
  );
  assert.equal(summary.status, 'ok', summary.errors.join('\n'));
  assert.equal(summary.cellsSearched, 3);
  assert.equal(summary.pitchesMade, 6);
  assert.equal(summary.pitchesPooled, 3);
  assert.equal(summary.rejected, 3);
  assert.ok(summary.usd > 0);

  const { rows: pitches } = await db.query<{ status: string; reject_reason: string | null; revive_when: string | null; rank_score: unknown; search_id: string | null }>('SELECT status, reject_reason, revive_when, rank_score, search_id FROM reel_ai_drama.pitches');
  assert.ok(pitches.every((p) => p.search_id));
  assert.ok(pitches.filter((p) => p.status === 'rejected').every((p) => /drama/.test(p.reject_reason ?? '') && p.revive_when));
  assert.ok(pitches.filter((p) => p.status === 'pooled').every((p) => Number(p.rank_score) > 0));
  const { rows: [s] } = await db.query<{ status: string; cells_searched: number; pitches_pooled: number }>('SELECT * FROM reel_ai_drama.sessions');
  assert.equal(s.status, 'ok');
  assert.equal(Number(s.pitches_pooled), 3);
  const { rows: searched } = await db.query<{ n: unknown }>('SELECT count(*) AS n FROM reel_ai_drama.cells WHERE searches = 1');
  assert.equal(Number(searched[0].n), 3);
  const { rows: searches } = await db.query<{ pitches_made: number }>('SELECT pitches_made FROM reel_ai_drama.searches');
  assert.deepEqual(searches.map((r) => Number(r.pitches_made)), [2, 2, 2]);
  assert.ok((await nextForProduction(db, DEFAULT_SETTINGS, new Date())) !== null);
});

test('the session respects the weekly development cap', async () => {
  const db = await freshDb();
  await recordCost(db, { mode: 'development', vendor: 'anthropic', component: 'producer', usd: 3.2 });
  let called = 0;
  const create = (async () => {
    called += 1;
    throw new Error('should not be called');
  }) as CreateMessage;
  const summary = await runDevelopmentSession(
    { db, producer: { create, loadPrompt: () => 'stub' }, jevTransport: titleJev(), visuals: visualsDeps(), settings: DEFAULT_SETTINGS },
    { trigger: 'auto' },
  );
  assert.equal(summary.status, 'capped');
  assert.equal(called, 0);
  assert.equal(summary.cellsSearched, 0);

  // Under the cap at the start, over it after the first cell: the session stops starting new cells.
  const db2 = await freshDb();
  const pricey = (async () => {
    called += 1;
    return message([{ type: 'tool_use', id: 't', name: 'submit_pitches', input: { candidates: [] } }], 'tool_use', { input_tokens: 5_000_000, output_tokens: 100_000 });
  }) as CreateMessage;
  const capped = await runDevelopmentSession(
    { db: db2, producer: { create: pricey, loadPrompt: () => 'stub' }, jevTransport: titleJev(), visuals: visualsDeps(), settings: { ...DEFAULT_SETTINGS, cells_per_session: 4 }, random: () => 0.5 },
    { trigger: 'click' },
  );
  assert.equal(capped.status, 'capped');
  assert.equal(capped.cellsSearched, 1);
});

// ── Calibration ─────────────────────────────────────────────────────────────

test('calibration data: 12 makes, 10 near misses with only "Her voice" a make, all unverified', () => {
  assert.equal(CALIBRATION_STORIES.length, 12);
  assert.equal(NEAR_MISSES.length, 10);
  assert.ok(CALIBRATION_STORIES.every((i) => i.verdict === 'make'));
  assert.deepEqual(NEAR_MISSES.filter((i) => i.verdict === 'make').map((i) => i.pitch.title), ['Her voice']);
  for (const item of CALIBRATION_ITEMS) {
    assert.equal(item.unverified, true);
    const v = validatePitch({ ...item.pitch, sources: [{ url: 'https://example.com', title: 't', publisher: 'p', date: null }] }, { today: TODAY });
    assert.ok(v.ok, `${item.id}: ${v.ok ? '' : v.why}`);
  }
});

test('calibration report: passes only when every make outranks every skip and skips fall under the bar', async () => {
  const s = (score: number) => ({ score, notes: {} });
  const scored = CALIBRATION_ITEMS.map((item) => ({ item, drama: s(item.verdict === 'make' ? 0.8 : 0.4), material: s(0.7) }));
  const ok = calibrationReport(scored, 0.7);
  assert.equal(ok.pass, true);
  assert.equal(ok.items.length, 22);
  assert.ok(ok.items.slice(0, 13).every((x) => x.verdict === 'make'));

  const leaky = calibrationReport(scored.map((x) => (x.item.id === 'near-08' ? { ...x, drama: s(0.85) } : x)), 0.7);
  assert.equal(leaky.pass, false);
  assert.deepEqual(leaky.skipsAboveAMake, ['near-08']);
  assert.deepEqual(leaky.skipsOverBar, ['near-08']);

  const underBar = calibrationReport(scored.map((x) => (x.item.verdict === 'skip' ? { ...x, drama: s(0.75) } : x)), 0.7);
  assert.equal(underBar.pass, false, 'ordered right but skips over the bar');
  assert.equal(underBar.skipsAboveAMake.length, 0);

  // runCalibration with a stub Jev keyed on the verdict.
  const makes = new Set(CALIBRATION_ITEMS.filter((i) => i.verdict === 'make').map((i) => i.pitch.title));
  const db = await freshDb();
  const transport = stubJev((state, key) => (key === 'mostly_spectacle' || key === 'announced_plan' ? 0 : key === 'about_ai' ? 1 : makes.has(String(state.title)) ? 3.5 : 1));
  const report = await runCalibration({ jev: new RecordingDramaJevRunner(transport, db, { mode: 'development' }), settings: { drama_bar: 0.7 } });
  assert.equal(report.pass, true);
  assert.equal(transport.calls.length, 44);
});

test('seedCalibrationPitches inserts the 12 as new seed pitches, once', async () => {
  const db = await freshDb();
  assert.equal(await seedCalibrationPitches(db), 12);
  assert.equal(await seedCalibrationPitches(db), 0);
  const { rows } = await db.query<{ origin: string; status: string; central_player_id: string | null }>('SELECT origin, status, central_player_id FROM reel_ai_drama.pitches');
  assert.ok(rows.every((r) => r.origin === 'seed' && r.status === 'new'));
  assert.ok(rows.some((r) => r.central_player_id === 'jensen-huang'));

  // A calibration-trigger session runs the seeds through the normal checks and searches no cells.
  const summary = await runDevelopmentSession(
    { db, producer: { create: (async () => { throw new Error('no producer'); }) as CreateMessage, loadPrompt: () => 'stub' }, jevTransport: titleJev(), visuals: visualsDeps(), settings: DEFAULT_SETTINGS },
    { trigger: 'calibration' },
  );
  assert.equal(summary.cellsSearched, 0);
  assert.equal(summary.pitchesPooled + summary.rejected + summary.duplicates, 12, summary.errors.join('\n'));
  const { rows: left } = await db.query<{ n: unknown }>(`SELECT count(*) AS n FROM reel_ai_drama.pitches WHERE status = 'new'`);
  assert.equal(Number(left[0].n), 0);
});

test('drama v2 caps an announced plan and a story with no AI-world player at the center', () => {
  const all = { central_want: { score: 4 }, stakes: { score: 4 }, scene: { score: 4 }, turn: { score: 4 }, implication: { score: 4 }, mostly_spectacle: { noul: 0 } };
  assert.equal(combineDrama({ ...all, announced_plan: { noul: 0.1 } }).score, 1);
  const announced = combineDrama({ ...all, announced_plan: { noul: 0.8 } });
  assert.equal(announced.score, 0.5);
  assert.match(announced.notes.cap ?? '', /announced plan/);
  const strong = combineDrama({ ...all, announced_plan: { noul: 0 } });
  const cast = (player_id: string | null) => ({ name: 'A', role: 'r', kind: 'person' as const, player_id, want: 'w' });
  const pitchWith = (ids: (string | null)[]) => ({ cast: ids.map(cast) }) as unknown as Parameters<typeof capWithoutPlayer>[1];
  assert.equal(capWithoutPlayer(strong, pitchWith([null, null])).score, 0.45);
  assert.equal(capWithoutPlayer(strong, pitchWith([null, 'openai'])).score, 1);
});

test('drama v3 caps a story that is not about AI', () => {
  const all = { central_want: { score: 4 }, stakes: { score: 4 }, scene: { score: 4 }, turn: { score: 4 }, implication: { score: 4 }, mostly_spectacle: { noul: 0 }, announced_plan: { noul: 0 } };
  assert.equal(combineDrama({ ...all, about_ai: { noul: 0.9 } }).score, 1);
  const off = combineDrama({ ...all, about_ai: { noul: 0.1 } });
  assert.equal(off.score, 0.45);
  assert.equal(off.notes.cap, 'not an AI story');
});
