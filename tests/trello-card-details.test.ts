/**
 * Trello card details on demand (perf): the board shows the same badges, Home
 * the same recent boards, Activity and Profile the same rows, whether a card's
 * details have loaded or not. Pure helpers only; no database, no network.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityEntry,
  badgeCounts,
  lastActivityBy,
  localFeedRows,
  mergeFeed,
  weekStats,
  withDetails,
  type FeedRow,
} from '@/lib/trello/card-details';
import type { Card } from '@/lib/trello/types';

const ME = 'me';
const OTHER = 'other';

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    boardId: 'b1',
    listId: 'l1',
    title: 'Card',
    labelIds: [],
    assigneeIds: [ME],
    trackerIds: [],
    fieldValues: {},
    checklists: [],
    attachments: [],
    comments: [],
    activity: [],
    createdById: ME,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

const loaded = card({
  checklists: [{ id: 'cl1', title: 'Steps', items: [{ id: 'i1', text: 'a', done: true }, { id: 'i2', text: 'b', done: false }] }],
  attachments: [{ id: 'at1', name: 'f', mime: 'text/plain', url: 'u', addedAt: '2026-11-02T00:00:00.000Z' }],
  comments: [{ id: 'cm1', authorId: ME, body: 'hi', at: '2026-11-03T00:00:00.000Z' }],
  activity: [{ id: 'a2', authorId: ME, kind: 'checked', detail: 'checked a', at: '2026-11-04T00:00:00.000Z' }, { id: 'a1', authorId: OTHER, kind: 'created', detail: 'created', at: '2026-11-01T00:00:00.000Z' }],
});

describe('trello card details on demand', () => {
  it('badges come from the counts until details load, then from the details', () => {
    const pending = card({ detailsLoaded: false, counts: { checklistItems: 2, checklistDone: 1, comments: 1, attachments: 1 } });
    assert.deepEqual(badgeCounts(pending), badgeCounts(loaded));
    assert.deepEqual(badgeCounts(loaded), { checklistItems: 2, checklistDone: 1, comments: 1, attachments: 1 });
    // Loaded details win over the (stale) counts.
    assert.deepEqual(badgeCounts({ ...loaded, detailsLoaded: true, counts: { checklistItems: 9, checklistDone: 9, comments: 9, attachments: 9 } }), badgeCounts(loaded));
  });

  it("Home's last activity by me: the workspace's value, or a newer one from this session", () => {
    assert.equal(lastActivityBy(loaded, ME), Date.parse('2026-11-04T00:00:00.000Z'));
    assert.equal(lastActivityBy(card({ detailsLoaded: false, myLastActivityAt: '2026-11-04T00:00:00.000Z' }), ME), Date.parse('2026-11-04T00:00:00.000Z'));
    assert.equal(lastActivityBy(card({ myLastActivityAt: '2026-11-04T00:00:00.000Z', activity: [{ id: 'n', authorId: ME, kind: 'moved', detail: '', at: '2026-11-05T00:00:00.000Z' }] }), ME), Date.parse('2026-11-05T00:00:00.000Z'));
    assert.equal(lastActivityBy(card(), ME), null);
  });

  it('loading details keeps writes the read does not have yet', () => {
    const pending = card({
      detailsLoaded: false,
      comments: [{ id: 'local', authorId: ME, body: 'just typed', at: '2026-11-06T00:00:00.000Z' }],
      activity: [{ id: 'a2', authorId: ME, kind: 'checked', detail: 'checked a', at: '2026-11-04T00:00:00.000Z' }],
    });
    const out = withDetails(pending, { checklists: loaded.checklists, attachments: loaded.attachments, comments: loaded.comments, activity: loaded.activity });
    assert.equal(out.detailsLoaded, true);
    assert.deepEqual(out.comments.map((c) => c.id), ['cm1', 'local']);
    assert.deepEqual(out.activity.map((a) => a.id), ['a2', 'a1'], 'no duplicate of the tracked entry');
  });

  it('activity rows map their detail like the workspace load did', () => {
    const base = { id: 'x', user_id: ME, action_type: 'moved', created_at: '2026-11-01T00:00:00.000Z' };
    assert.equal(activityEntry({ ...base, data: { detail: 'moved to Done' } }).detail, 'moved to Done');
    assert.equal(activityEntry({ ...base, data: 'plain' }).detail, 'plain');
    assert.equal(activityEntry({ ...base, data: null }).detail, '');
  });

  it('the feed is newest first, each row once, only for cards still shown, capped', () => {
    const server: FeedRow[] = [
      { id: 'c1:a2', authorId: ME, kind: 'checked', detail: 'checked a', at: '2026-11-04T00:00:00.000Z', cardId: 'c1' },
      { id: 'gone:a9', authorId: ME, kind: 'moved', detail: '', at: '2026-11-09T00:00:00.000Z', cardId: 'gone' },
      { id: 'c1:a1', authorId: OTHER, kind: 'created', detail: 'created', at: '2026-11-01T00:00:00.000Z', cardId: 'c1' },
    ];
    const local = localFeedRows([loaded]);
    const rows = mergeFeed(server, local, new Set(['c1']), 10);
    assert.deepEqual(rows.map((r) => r.id), ['c1:a2', 'c1:cm1', 'c1:a1']);
    assert.deepEqual(mergeFeed(server, local, new Set(['c1']), 2).map((r) => r.id), ['c1:a2', 'c1:cm1']);
    assert.deepEqual(localFeedRows([loaded], ME).map((r) => r.id), ['c1:a2', 'c1:cm1'], 'one author');
  });

  it('week tiles count the same from server rows as from full details', () => {
    const now = new Date('2026-11-06T12:00:00.000Z');
    const done = { ...loaded, complete: true };
    const full = weekStats([done], ME, null, () => true, now);
    const pending = card({ complete: true, detailsLoaded: false });
    const fromServer = weekStats([pending], ME, {
      recentComments: [{ id: 'cm1', cardId: 'c1', at: '2026-11-03T00:00:00.000Z' }],
      firstChecked: [{ id: 'a2', cardId: 'c1', at: '2026-11-04T00:00:00.000Z' }],
    }, () => true, now);
    assert.deepEqual(fromServer, full);
    assert.deepEqual(full, { open: 0, doneThisWeek: 1, commentsThisWeek: 1, overdue: 0 });
    // A comment on a card the search hides does not count.
    assert.equal(weekStats([], ME, { recentComments: [{ id: 'cm1', cardId: 'c1', at: '2026-11-03T00:00:00.000Z' }], firstChecked: [] }, () => true, now).commentsThisWeek, 0);
  });
});
