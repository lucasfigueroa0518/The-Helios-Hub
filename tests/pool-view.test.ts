import assert from 'node:assert/strict';
import test from 'node:test';

import { typeHubModel } from '@/lib/content-type/model';
import { makesText, poolBoard, poolIdeas, poolMade, poolRunway, poolSlotsPerDay, type BoardDay } from '@/lib/content-type/pool-view';
import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

// Sunday Nov 15 2026, 12:00 PM in New York (EST). Explainers' default windows: 1:00 PM and 3:30 PM every day; lead 2.
const NOW = new Date('2026-11-15T17:00:00Z');
const TODAY = '2026-11-15';

const idea = (id: string, score: number, over: Partial<HubIdea> = {}): HubIdea => ({
  id, vertical: 'explainers', title: `Topic ${id}`, score, scoreLabel: 'score', state: 'idea_only', hasContent: false, versionCount: 0,
  generatedAt: null, createdAt: '2026-11-12T15:00:00Z', detail: null, ...over,
});

const post = (id: string, over: Partial<HubPost> = {}): HubPost => ({
  id, vertical: 'explainers', format: 'reel', name: `Post ${id}`, description: null, status: 'ready', statusNote: null,
  postedAt: null, publishAt: null, nyDate: null, slot: null, permalink: null, pipelineHref: '/explainers', media: { kind: 'video', src: '/v.mp4' },
  costMicros: null, costNote: null, metrics: {}, history: [], native: [], factorValues: {},
  approval: { required: false, approvedAt: '2026-11-01T00:00:00Z', note: null },
  idea: null, generatedAt: '2026-11-14T17:00:00Z', versions: [], sources: [], costItemKey: null, refs: {}, ...over,
});

const IDEAS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'].map((id, i) => idea(id, 0.9 - i * 0.1, i === 0 ? { yours: true } : {}));

function build(opts: { ideas?: HubIdea[]; posts?: HubPost[]; adjustments?: IdeaAdjustment[]; vertical?: Vertical; now?: Date } = {}) {
  const base = previewDataset();
  const dataset: HubDataset = {
    ...base,
    ideas: opts.ideas ?? IDEAS,
    posts: opts.posts ?? [],
    adjustments: opts.adjustments ?? [],
    dayQuotas: null,
  };
  const now = opts.now ?? NOW;
  const model = typeHubModel(dataset, opts.vertical ?? 'explainers', now);
  const source = { posts: dataset.posts, dayQuotas: null, adjustments: dataset.adjustments };
  return { model, source, now };
}

const slotAt = (days: BoardDay[], date: string, time: string) => days.find((d) => d.date === date)!.slots.find((s) => s.time === time)!;

test('Ideas: open ideas in the model\'s queue order, with source, age, score to 2 decimals', () => {
  const { model, source, now } = build();
  const rows = poolIdeas(model, now, source);
  assert.deepEqual(rows.map((r) => r.idea.id), model.bench.map((b) => b.idea.id));
  assert.deepEqual(rows.map((r) => r.position), rows.map((_, i) => i + 1));
  assert.equal(rows[0]!.number, '0.90');
  assert.equal(rows[0]!.source, 'Seeded by you');
  assert.equal(rows[1]!.source, 'Written by the night');
  assert.equal(rows[0]!.addedDaysAgo, 3);
  assert.ok(rows[0]!.meta.includes('added 3 d ago'));
  assert.deepEqual(rows.map((r) => r.upNext), rows.map((_, i) => i < 3));
  for (const r of rows) assert.equal(r.stateWord, 'Idea');
});

test('a pin moves an idea to the top, and the list follows the queue', () => {
  const pin: IdeaAdjustment = { id: 'a1', vertical: 'explainers', ideaId: 'e5', nyDate: TODAY, kind: 'pin', createdAt: '2026-11-15T10:00:00Z' };
  const { model, source, now } = build({ adjustments: [pin] });
  const rows = poolIdeas(model, now, source);
  assert.equal(rows[0]!.idea.id, 'e5');
  assert.equal(rows[0]!.pinned, true);
  assert.equal(rows[0]!.slot?.label, 'Today 1:00 PM');
});

test('archived ideas never appear', () => {
  const archive: IdeaAdjustment = { id: 'a2', vertical: 'explainers', ideaId: 'e2', nyDate: TODAY, kind: 'archive', createdAt: '2026-11-15T10:00:00Z' };
  const { model, source, now } = build({ adjustments: [archive] });
  const rows = poolIdeas(model, now, source);
  assert.ok(!rows.some((r) => r.idea.id === 'e2'));
  assert.equal(rows.length, IDEAS.length - 1);
});

test('row states: Making and Failed rows stay in Ideas, and a raw error never reaches row text', () => {
  const error = 'Error: --dangerously-skip-permissions exited 1 (Worker restarted)';
  const ideas = IDEAS.map((i) => (i.id === 'e2' ? { ...i, run: { state: 'failed' as const, stage: 'render', error, requestedAt: '2026-11-15T08:00:00Z', startedAt: null } }
    : i.id === 'e3' ? { ...i, run: { state: 'running' as const, stage: 'render', error: null, requestedAt: '2026-11-15T08:00:00Z', startedAt: '2026-11-15T08:01:00Z' } } : i));
  const { model, source, now } = build({ ideas });
  const rows = poolIdeas(model, now, source);
  const failed = rows.find((r) => r.idea.id === 'e2')!;
  const making = rows.find((r) => r.idea.id === 'e3')!;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.stateWord, 'Failed, try again');
  assert.equal(making.state, 'making');
  assert.equal(making.slot?.makes, 'making now');
  for (const r of rows) {
    const { idea: _idea, ...text } = r;
    assert.ok(!JSON.stringify(text).includes('dangerously'), `${r.idea.id}: row text carries the raw error`);
  }
  for (const day of poolBoard(model, TODAY, 3, { ...source, now })) {
    for (const s of day.slots) {
      const { idea: _i, post: _p, ...text } = s;
      assert.ok(!JSON.stringify(text).includes('dangerously'), 'board slot text carries the raw error');
    }
  }
});

test('made and booked ideas leave the Ideas tab', () => {
  const ideas = [...IDEAS.slice(1), idea('e1', 0.95, { state: 'content_ready', hasContent: true })];
  const { model, source, now } = build({ ideas, posts: [post('p1', { idea: { id: 'e1', label: 'x' } })] });
  const rows = poolIdeas(model, now, source);
  assert.ok(!rows.some((r) => r.idea.id === 'e1'));
  assert.ok(!rows.some((r) => r.state === 'ready'));
});

test('an idea still marked idea_only leaves Ideas once its post is booked or needs approval', () => {
  const booked = post('p2', { idea: { id: 'e2', label: 'x' }, status: 'scheduled', publishAt: '2026-11-19T18:00:00Z', nyDate: '2026-11-19' });
  const waiting = post('p3', { idea: { id: 'e3', label: 'x' }, status: 'ready', approval: { required: true, approvedAt: null, note: null } });
  const failed = post('p4', { idea: { id: 'e4', label: 'x' }, status: 'failed' });
  const { model, source, now } = build({ posts: [booked, waiting, failed] });
  const ids = poolIdeas(model, now, source).map((r) => r.idea.id);
  assert.ok(!ids.includes('e2'), 'a booked idea stays in Ideas');
  assert.ok(!ids.includes('e3'), 'an idea waiting for approval stays in Ideas');
  assert.ok(ids.includes('e4'), 'a failed post does not make its idea made');
});

test('board: a made post wins its slot; queued ideas fill the earliest open slots ahead; Up next agrees with the board', () => {
  // A booked post holds today's 1:00 PM; e1 takes 3:30 PM; e2, e3 take Monday.
  const booked = post('p0', { status: 'scheduled', publishAt: '2026-11-15T18:00:00Z', nyDate: TODAY, idea: { id: 'e0', label: 'x' } });
  const ideas = [...IDEAS, idea('e0', 0.99, { state: 'on_deck', hasContent: true })];
  const { model, source, now } = build({ ideas, posts: [booked] });
  const board = poolBoard(model, TODAY, 3, { ...source, now });
  assert.deepEqual(board.map((d) => d.date), ['2026-11-15', '2026-11-16', '2026-11-17']);
  assert.deepEqual(board.map((d) => [d.weekday, d.dayLabel, d.isToday]), [['Sun', 'Nov 15', true], ['Mon', 'Nov 16', false], ['Tue', 'Nov 17', false]]);
  const held = slotAt(board, TODAY, '1:00 PM');
  assert.equal(held.kind, 'post');
  assert.equal(held.post?.id, 'p0');
  assert.equal(held.stateWord, 'Scheduled');
  assert.equal(slotAt(board, TODAY, '3:30 PM').idea?.id, 'e1');
  assert.deepEqual(board[1]!.slots.map((s) => s.idea?.id), ['e2', 'e3']);
  assert.deepEqual(board[2]!.slots.map((s) => s.idea?.id), ['e4', 'e5']);

  const rows = poolIdeas(model, now, source);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.slot?.label), ['Today 3:30 PM', 'Mon 1:00 PM', 'Mon 3:30 PM']);
  assert.equal(rows[0]!.meta[0], 'Today 3:30 PM · not made yet');
  for (const r of rows.slice(0, 3)) {
    const slot = poolBoard(model, r.slot!.date, 3, { ...source, now })[0]!.slots.find((s) => s.id === r.slot!.slotId)!;
    assert.equal(slot.idea?.id, r.idea.id, `${r.idea.id}: the list and the board agree`);
    assert.equal(slot.makes, r.slot!.makes);
    assert.equal(slot.position, r.position);
  }
  assert.ok(rows.slice(3).every((r) => r.slot == null && !r.upNext));
});

test('board: when it gets made follows lead days, and paging ahead never moves an idea', () => {
  const { model, source, now } = build();
  const later = poolBoard(model, '2026-11-18', 3, { ...source, now }); // Wed, Thu, Fri
  // Wed's slots are made by Monday's run (tonight); Thu's by Tuesday's run (Monday night).
  assert.deepEqual(later[0]!.slots.map((s) => [s.label, s.idea?.id, s.makes]), [['Wed 1:00 PM', 'e7', 'makes tonight'], ['Wed 3:30 PM', 'e8', 'makes tonight']]);
  assert.deepEqual(later[1]!.slots.map((s) => s.kind), ['open', 'open']);
  const first = poolBoard(model, TODAY, 3, { ...source, now });
  assert.deepEqual(first.flatMap((d) => d.slots.map((s) => s.idea?.id)), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.equal(first[2]!.slots[0]!.makes, 'not made yet');
});

test('board: a slot whose time has passed is not filled with an idea', () => {
  const { model, source, now } = build({ now: new Date('2026-11-15T19:00:00Z') }); // 2:00 PM
  const board = poolBoard(model, TODAY, 1, { ...source, now });
  const past = slotAt(board, TODAY, '1:00 PM');
  assert.equal(past.past, true);
  assert.equal(past.kind, 'open');
  assert.equal(slotAt(board, TODAY, '3:30 PM').idea?.id, 'e1');
  assert.equal(poolIdeas(model, now, source)[0]!.slot?.label, 'Today 3:30 PM');
});

test('board: a made-ahead post holds its day, and its idea takes no second slot', () => {
  const ahead = post('p2', { status: 'ready', nyDate: '2026-11-16', idea: { id: 'e1', label: 'x' }, generatedAt: '2026-11-15T07:00:00Z' });
  const { model, source, now } = build({ posts: [ahead] });
  const board = poolBoard(model, TODAY, 2, { ...source, now });
  const ids = board.flatMap((d) => d.slots.map((s) => s.post?.id ?? s.idea?.id));
  assert.equal(ids.filter((x) => x === 'e1').length, 0);
  assert.deepEqual(board[1]!.slots.map((s) => s.kind), ['post', 'idea']);
  assert.equal(board[1]!.slots[0]!.post?.id, 'p2');
});

test('makesText: lead 2 vs lead 0, Stories by series', () => {
  assert.equal(makesText('explainers', '2026-11-17', TODAY), 'not made yet');
  assert.equal(makesText('explainers', '2026-11-18', TODAY), 'makes tonight');
  assert.equal(makesText('explainers', '2026-11-19', TODAY), 'makes Mon night');
  assert.equal(makesText('carousels', TODAY, TODAY), 'not made yet');
  assert.equal(makesText('carousels', '2026-11-16', TODAY), 'makes tonight');
  assert.equal(makesText('carousels', '2026-11-17', TODAY), 'makes Mon night');
  assert.equal(makesText('stories', '2026-11-18', TODAY, 'Guess the Number'), 'makes tonight');
  assert.equal(makesText('stories', '2026-11-18', TODAY, 'Morning Download'), 'makes Tue night');
});

test('Stories: a series slot takes the next idea of its own series', () => {
  const s = (id: string, group: string, score: number) => idea(id, score, { vertical: 'stories', group });
  const ideas = [s('md1', 'Morning Download', 0.9), s('md2', 'Morning Download', 0.8), s('gn1', 'Guess the Number', 0.7)];
  const { model, source, now } = build({ ideas, vertical: 'stories', now: new Date('2026-11-15T12:00:00Z') }); // 7:00 AM
  const board = poolBoard(model, TODAY, 2, { ...source, now });
  // Sunday has Morning Download only; Monday has Morning Download and Guess the Number.
  assert.deepEqual(board[0]!.slots.map((x) => [x.series, x.idea?.id]), [['Morning Download', 'md1']]);
  assert.deepEqual(board[1]!.slots.map((x) => [x.series, x.idea?.id]).sort(), [['Guess the Number', 'gn1'], ['Morning Download', 'md2']]);
});

test('Last Few Days and AI Events: posts are built from the whole list, so no one idea fills a slot', () => {
  const ideas = [idea('l1', -1, { vertical: 'last_few_days' }), idea('l2', -2, { vertical: 'last_few_days' })];
  const { model, source, now } = build({ ideas, vertical: 'last_few_days' });
  const board = poolBoard(model, TODAY, 3, { ...source, now }); // Tue is a Last Few Days day
  assert.ok(board.flatMap((d) => d.slots).length > 0);
  assert.ok(board.flatMap((d) => d.slots).every((x) => x.kind === 'open'));
  const rows = poolIdeas(model, now, source);
  assert.deepEqual(rows.map((r) => r.number), ['1', '2']);
  assert.ok(rows.every((r) => r.slot == null));
});

test('Made: posts made in the last 30 days, newest first, with days left; older ones leave the tab', () => {
  const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const posts = [
    post('m0', { status: 'published', generatedAt: ago(0), postedAt: '2026-11-15T17:00:00Z', nyDate: TODAY }),
    post('m10', { status: 'failed', statusNote: 'Instagram error (#9007): media not ready', generatedAt: ago(10) }),
    post('m29', { status: 'scheduled', generatedAt: ago(29), publishAt: '2026-11-16T00:00:00Z', nyDate: TODAY }),
    post('m30', { status: 'ready', generatedAt: ago(30) }),
    post('m40', { status: 'published', generatedAt: ago(40) }),
    post('never', { status: 'generating', generatedAt: null }),
  ];
  const { model, source, now } = build({ posts });
  const made = poolMade(model, now, source);
  assert.deepEqual(made.map((m) => m.post.id), ['m0', 'm10', 'm29']);
  assert.deepEqual(made.map((m) => [m.madeDaysAgo, m.daysLeft]), [[0, 30], [10, 20], [29, 1]]);
  assert.deepEqual(made.map((m) => m.stateWord), ['Published', 'Failed, try again', 'Scheduled']);
  assert.equal(made[0]!.when, 'Posted today, 12:00 PM');
  assert.equal(made[2]!.when, 'Posts today, 7:00 PM');
  assert.deepEqual(made[0]!.meta, ['Posted today, 12:00 PM', 'made today', 'archives in 30 d']);
  for (const m of made) {
    const { post: _p, ...text } = m;
    assert.ok(!JSON.stringify(text).includes('9007'), 'a post error never reaches the row');
  }
});

test('Made without the dataset still lists the posts the model holds', () => {
  const posts = [post('p1', { status: 'ready', idea: { id: 'e1', label: 'x' }, generatedAt: '2026-11-14T17:00:00Z' })];
  const { model, now } = build({ posts });
  assert.deepEqual(poolMade(model, now).map((m) => m.post.id), ['p1']);
});

test('runway: whole days of posts the pool covers', () => {
  assert.equal(poolRunway(32, 2), 16);
  assert.equal(poolRunway(5, 2), 2);
  assert.equal(poolRunway(0, 2), 0);
  assert.equal(poolRunway(10, 0), 0);
  assert.equal(poolRunway(3, 2 / 7), 10);
  assert.equal(poolRunway(6, 3), 2);
  const { model, source } = build();
  assert.equal(poolSlotsPerDay(model, source), 2);
});

test('calendar mode: the quota cuts today only, so later days keep their calendar slots, and the runway counts the same slots', () => {
  const { model, source, now } = build();
  const win = (id: string, startMinute: number) => ({ id, vertical: 'explainers' as const, label: 'Explainers', startMinute, endMinute: startMinute + 59 });
  const slots = { '2026-11-15': [], '2026-11-16': [win('m1', 13 * 60)], '2026-11-17': [win('t1', 13 * 60)] } as never;
  const quotas = { reels: 0, carousels: 0, explainers: 0, slots };
  const days = poolBoard(model, TODAY, 3, { ...source, dayQuotas: quotas, now });
  assert.equal(days[0]!.slots.length, 0, 'today has no slot');
  assert.equal(days[1]!.slots.length, 1, 'Monday keeps its calendar slot though today’s quota is 0');
  assert.equal(days[2]!.slots.length, 1);
  assert.ok(poolSlotsPerDay(model, { ...source, dayQuotas: quotas }) > 0, 'the runway sees the same slots');
});
