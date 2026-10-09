import assert from 'node:assert/strict';
import test from 'node:test';

import { actionsFor, needsApproval } from '@/lib/social-hub/house';
import type { HubPost } from '@/lib/social-hub/types';
import { actionMenu, flagOf } from '@/lib/social-hub/views/actions';
import { contentModel, needsGroups, publishingCandidates } from '@/lib/social-hub/views/today';
import { displayName, relative, when } from '@/lib/social-hub/views/format';
import { offerer, slotChoices } from '@/lib/social-hub/views/offer';
import { poolSummaries } from '@/lib/social-hub/views/pools';
import { needsPerson, postState, type StateId } from '@/lib/social-hub/views/state';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const d = previewDataset();
const now = FIXTURE_NOW;
const ALL_ON = { approveCarousel: true, approveTrialReel: true, approveContent: true, hardPublish: true, hardRegenerate: true, reject: true, reschedule: true, refreshOnVisit: true } as const;
const ALL_OFF = { approveCarousel: false, approveTrialReel: false, approveContent: false, hardPublish: false, hardRegenerate: false, reject: false, reschedule: false, refreshOnVisit: false } as const;
const STATES: ReadonlySet<StateId> = new Set(['in_production', 'ready', 'needs_you', 'approval_off', 'slot_booked', 'approved', 'scheduled', 'late', 'posting', 'published', 'failed', 'rejected', 'not_approved', 'cancelled', 'skipped']);

test('every post maps to one state from the matrix; only Needs you, Late and Failed carry color (MATRICES.md §1)', () => {
  for (const post of d.posts) {
    const s = postState(post, now);
    assert.ok(STATES.has(s.id), `${post.id} → ${s.id}`);
    assert.equal(s.tone !== 'quiet', s.id === 'needs_you' || s.id === 'failed' || s.id === 'late', `${s.id} tone ${s.tone}`);
  }
  assert.ok(d.posts.some((p) => postState(p, now).id === 'published'));
  assert.ok(d.posts.some((p) => postState(p, now).id === 'needs_you'));
});

test('"needs you" agrees with the Content House rule, so counts match everywhere', () => {
  const ours = new Set(d.posts.filter((p) => needsPerson(p, now)).map((p) => p.id));
  const theirs = new Set(needsApproval(d.posts, now).map((p) => p.id));
  assert.deepEqual([...ours].sort(), [...theirs].sort());
  const groups = needsGroups(d.posts, now);
  assert.equal(groups.reduce((n, g) => n + g.posts.length, 0), ours.size);
});

test('a failed last try is said on the post', () => {
  const tried = d.posts.find((p) => p.status === 'ready' && p.tries?.length);
  if (tried) assert.match(postState(tried, now).line ?? '', /Last try/);
});

test('at most one primary action, and turned-off actions are never offered as buttons (MATRICES.md §2)', () => {
  for (const post of d.posts) {
    const state = postState(post, now);
    const plans = actionsFor(post, { quota: null, typicalCostLabel: '$1.00' });
    const on = actionMenu(post, state, plans, ALL_ON);
    const all = [on.primary, ...on.secondary, ...on.more].filter(Boolean);
    assert.ok(new Set(all.map((a) => a!.key)).size === all.length, 'no action offered twice');
    if (state.id === 'published' || state.id === 'posting' || state.id === 'skipped') assert.equal(on.primary, null, `${state.id} has no primary`);
    if (state.id === 'needs_you' && (post.vertical === 'carousels' || post.vertical === 'reels') && post.status === 'scheduled') assert.match(on.primary?.label ?? '', /Approve/);
    const off = actionMenu(post, state, plans, ALL_OFF);
    assert.equal(off.primary, null);
    assert.deepEqual([...off.secondary, ...off.more], []);
  }
});

test('place and move share the reschedule flag; every plan names a flag that exists', () => {
  assert.equal(flagOf('place'), 'reschedule');
  assert.equal(flagOf('reschedule'), 'reschedule');
  assert.equal(flagOf('reject'), 'reject');
});

test('slot choices cover the coming week and mark what is taken', () => {
  const ready = d.posts.find((p) => p.vertical === 'carousels' && p.status === 'ready')!;
  const slots = slotChoices(d, ready, now);
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.slot === 'morning' || s.slot === 'afternoon'));
  assert.ok(slots.some((s) => s.state === 'taken'), 'the fixture has carousels booked this week');
  const o = offerer(d, now);
  const offer = o.offer(ready);
  const place = [offer.menu.primary, ...offer.menu.secondary, ...offer.menu.more].find((a) => a?.key === 'place');
  if (place) assert.ok(place.slots?.length, 'place offers the picker');
});

test('today’s strip is only post ideas holding a slot; failed and never-made ideas are out', () => {
  const post = (over: Partial<HubPost>): HubPost => ({ nyDate: '2026-10-08', idea: { id: 'i', label: 'Idea' }, generatedAt: '2026-10-08T08:00:00Z', status: 'scheduled', vertical: 'stories', publishAt: '2026-10-08T13:00:00Z', id: 'p', ...over }) as HubPost;
  const ids = publishingCandidates([
    post({ id: 'guess-failed', status: 'failed', idea: { id: 'guess', label: 'Guess' } }),
    post({ id: 'free-skipped', status: 'skipped', generatedAt: null, idea: { id: 'free', label: 'Free' } }),
    post({ id: 'no-idea', idea: null, status: 'scheduled' }),
    post({ id: 'making', status: 'generating', generatedAt: null, idea: { id: 'download', label: 'Download' }, publishAt: null }),
    post({ id: 'made', status: 'scheduled', idea: { id: 'guess2', label: 'Guess 2' } }),
  ], '2026-10-08').map((p) => p.id);
  assert.deepEqual(ids, ['made', 'making']);
});

test('the Content model leads with what needs a person and orders today by time', () => {
  const m = contentModel(d, now);
  assert.ok(m.plan.slots > 0 && m.plan.filled <= m.plan.slots);
  const flat = m.lineup.flatMap((b) => b.entries.map((e) => e.post.postedAt ?? e.post.publishAt ?? ''));
  assert.deepEqual(flat, [...flat].sort());
  assert.ok(m.lineup.every((b) => b.entries.every((e) => e.post.nyDate === m.today)));
});

test('pools come in the fixed type order and rank within a type only', () => {
  const pools = poolSummaries(d.ideas);
  assert.deepEqual(pools.map((p) => p.vertical), ['reels', 'explainers', 'carousels', 'stories']);
  for (const p of pools) {
    const scores = p.next.map((i) => i.score ?? -Infinity);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  }
});

test('person-facing text: capitals tamed, dates in words', () => {
  assert.equal(displayName({ name: 'META OPEN-SOURCES A 400B PARAMETER MODEL', description: 'Meta open-sources a 400B parameter model' }), 'Meta open-sources a 400B parameter model');
  assert.equal(displayName({ name: "THE EU'S AI ACT STARTS", description: null }), "The EU's AI act starts");
  assert.equal(displayName({ name: 'What is a webhook?', description: null } as Pick<HubPost, 'name'>), 'What is a webhook?');
  assert.match(when('2026-10-08T13:23:00Z', now), /^Today 9:23\sAM$/);
  assert.match(when('2026-10-09T13:23:00Z', now), /^Tomorrow 9:23\sAM$/);
  assert.equal(relative('2026-10-08T21:00:00Z', now), 'in 2 h');
  assert.equal(relative('2026-10-08T16:00:00Z', now), '3 h ago');
});
