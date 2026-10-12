/**
 * Delete (soft): a post that hasn't gone live leaves the hub, its slot opens,
 * its idea returns to the pool, and nothing is removed from the database.
 * Offline: the real schema files on in-memory PGlite, no Claude, no Meta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { carouselActions } from '@/lib/publishing/actions/carousels';
import type { ActionFlag } from '@/lib/social-hub/flags';
import { actionsFor } from '@/lib/social-hub/house';
import { readDeleted, withoutDeleted } from '@/lib/social-hub/deleted';
import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubQuery } from '@/lib/social-hub/db';
import { bookSlot, deleteItem } from '@/lib/social-hub/spine';
import { actionMenu } from '@/lib/social-hub/views/actions';
import { postState } from '@/lib/social-hub/views/state';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { carouselItemId } from '@/lib/social/overnight/items';
import { storedPostFor, type Query } from '@/lib/social/store/pg';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function scratchDb(): Promise<{ query: Query; hubQuery: HubQuery }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  return { query, hubQuery: query as unknown as HubQuery };
}

async function insertPost(query: Query, slug: string, storyId: string): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, origin)
     VALUES ($1, $2, 't', 'review', '{"caption":"c","attributionBlock":"p","slides":[]}'::jsonb, 'pipeline') RETURNING id`,
    [slug, storyId],
  );
  return rows[0].id as string;
}

const slotOf = (query: Query, itemId: string, nyDate = '2026-10-13') => bookSlot(query, { vertical: 'carousels', itemId, nyDate, slot: 'morning', publishAt: new Date(`${nyDate}T13:00:00Z`), source: 'auto' });

// ── The spine write ─────────────────────────────────────────────────────────

test('delete: the item is marked, rejected so it can never post, and its waiting slot is cancelled', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, 'p1', 'story-1');
  const itemId = (await carouselItemId(query, postId))!;
  const slot = await slotOf(query, itemId);

  assert.equal(await deleteItem(query, itemId, 'tommy@heliosgroup.ai'), true);

  const item = (await query(`SELECT deleted_at, deleted_by FROM social_hub.content_items WHERE id = $1`, [itemId])).rows[0];
  assert.ok(item.deleted_at, 'marked deleted');
  assert.equal(item.deleted_by, 'tommy@heliosgroup.ai');
  assert.equal((await query(`SELECT decision FROM social_hub.approvals WHERE content_item_id = $1`, [itemId])).rows[0].decision, 'rejected');
  const sched = (await query(`SELECT status, error FROM social_hub.schedule WHERE id = $1`, [slot.id])).rows[0];
  assert.equal(sched.status, 'cancelled');
  assert.match(sched.error, /Deleted/);
  assert.equal((await query(`SELECT count(*)::int AS n FROM social.posts WHERE id = $1`, [postId])).rows[0].n, 1, 'the post row is kept');
});

test('delete: running it twice is harmless and keeps the first deletion time', async () => {
  const { query } = await scratchDb();
  const itemId = (await carouselItemId(query, await insertPost(query, 'p1', 'story-1')))!;
  assert.equal(await deleteItem(query, itemId, 'a'), true);
  const first = (await query(`SELECT deleted_at::text AS t, deleted_by FROM social_hub.content_items WHERE id = $1`, [itemId])).rows[0];
  assert.equal(await deleteItem(query, itemId, 'b'), true);
  const second = (await query(`SELECT deleted_at::text AS t, deleted_by FROM social_hub.content_items WHERE id = $1`, [itemId])).rows[0];
  assert.deepEqual(second, first);
});

test('delete: content that is posting or has posted is refused and left untouched', async () => {
  const { query } = await scratchDb();
  for (const [i, status] of (['publishing', 'published'] as const).entries()) {
    const itemId = (await carouselItemId(query, await insertPost(query, `p-${status}`, `story-${status}`)))!;
    const slot = await slotOf(query, itemId, `2026-10-${13 + i}`);
    await query(`UPDATE social_hub.schedule SET status = $2 WHERE id = $1`, [slot.id, status]);
    assert.equal(await deleteItem(query, itemId, 'tommy'), false, status);
    assert.equal((await query(`SELECT deleted_at FROM social_hub.content_items WHERE id = $1`, [itemId])).rows[0].deleted_at, null, `${status} stays`);
    assert.equal((await query(`SELECT status FROM social_hub.schedule WHERE id = $1`, [slot.id])).rows[0].status, status);
  }
});

test('delete: an unknown item is refused', async () => {
  const { query } = await scratchDb();
  assert.equal(await deleteItem(query, '00000000-0000-4000-8000-000000000000', 'tommy'), false);
});

test('delete: the worker no longer reuses the deleted post for its story, so a rerun makes a new one', async () => {
  const { query } = await scratchDb();
  const { rows } = await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, origin, slide_objects)
     VALUES ('p1', 'story-1', 't', 'review', '{"caption":"c","attributionBlock":"p","slides":[]}'::jsonb, 'pipeline', '["a.jpg"]'::jsonb) RETURNING id`,
  );
  const postId = rows[0].id as string;
  const itemId = (await carouselItemId(query, postId))!;
  assert.equal(await storedPostFor(query, 'story-1'), postId, 'before: the finished post would be reused');
  await deleteItem(query, itemId, 'tommy');
  assert.equal(await storedPostFor(query, 'story-1'), null, 'after: the story is made again');
});

// ── The verb, end to end ────────────────────────────────────────────────────

const stubs = (query: Query) => carouselActions({
  query: async () => query,
  approveSchedule: async () => true,
  approvePost: async () => ({ scheduled: false, note: '' }),
  rejectPost: async () => true,
  hardPublishPost: async () => ({ queued: false }),
  itemId: carouselItemId,
  placeItem: async () => ({ ok: true, note: '' }) as never,
  rescheduleItem: async () => ({ ok: true, note: '' }) as never,
  unschedulePost: async () => ({ ok: true, note: '' }),
  requestRerun: async () => ({ queued: false, note: '' }),
});

test('the carousel delete verb deletes, and the hub then reads it as deleted', async () => {
  const { query, hubQuery } = await scratchDb();
  const postId = await insertPost(query, 'p1', 'story-1');
  const out = await stubs(query).delete!({ postId }, 'tommy@heliosgroup.ai');
  assert.equal(out.ok, true);
  const gone = await readDeleted(hubQuery);
  assert.equal(gone.length, 1);
  assert.deepEqual(gone[0], { vertical: 'carousels', nativeRef: postId, ideaRef: 'story-1' });
});

test('the delete verb says so when the post is gone, and when it is already live', async () => {
  const { query } = await scratchDb();
  assert.equal((await stubs(query).delete!({ postId: '00000000-0000-4000-8000-000000000000' }, 'tommy')).ok, false);

  const postId = await insertPost(query, 'p1', 'story-1');
  const itemId = (await carouselItemId(query, postId))!;
  const slot = await slotOf(query, itemId);
  await query(`UPDATE social_hub.schedule SET status = 'published' WHERE id = $1`, [slot.id]);
  const out = await stubs(query).delete!({ postId }, 'tommy');
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
});

// ── What the hub shows ──────────────────────────────────────────────────────

const carouselPost = (d: HubDataset) => d.posts.find((p) => p.vertical === 'carousels' && p.refs.postId)!;

test('withoutDeleted: only the deleted post leaves; nothing else changes', () => {
  const d = previewDataset();
  const target = carouselPost(d);
  const next = withoutDeleted(d, [{ vertical: 'carousels', nativeRef: target.refs.postId!, ideaRef: null }]);
  assert.equal(next.posts.length, d.posts.length - 1);
  assert.equal(next.posts.some((p) => p.id === target.id), false);
  assert.equal(withoutDeleted(d, []), d, 'nothing deleted returns the same dataset');
});

test('withoutDeleted: a type is matched on its own ref, so another type with the same ref is kept', () => {
  const d = previewDataset();
  const target = carouselPost(d);
  const next = withoutDeleted(d, [{ vertical: 'reels', nativeRef: target.refs.postId!, ideaRef: null }]);
  assert.equal(next.posts.length, d.posts.length);
});

test('withoutDeleted: an idea whose only content was deleted is open again; one with other versions keeps them', () => {
  const d = previewDataset();
  const target = carouselPost(d);
  const idea = (id: string, versionCount: number): HubIdea => ({
    id, vertical: 'carousels', title: id, score: 1, scoreLabel: 's', state: 'content_ready', hasContent: true, versionCount, generatedAt: null, createdAt: null, detail: null,
  });
  const only = idea('carousels:story:only', 1);
  const two = idea('carousels:story:two', 2);
  const next = withoutDeleted({ ...d, ideas: [only, two] }, [
    { vertical: 'carousels', nativeRef: target.refs.postId!, ideaRef: 'only' },
    { vertical: 'carousels', nativeRef: 'other', ideaRef: 'two' },
  ]);
  const byId = Object.fromEntries(next.ideas.map((i) => [i.id, i]));
  assert.equal(byId['carousels:story:only']!.state, 'idea_only');
  assert.equal(byId['carousels:story:only']!.hasContent, false);
  assert.equal(byId['carousels:story:only']!.versionCount, 0);
  assert.equal(byId['carousels:story:two']!.state, 'content_ready');
  assert.equal(byId['carousels:story:two']!.versionCount, 1);
});

test('withoutDeleted: a published or scheduled idea is not reopened', () => {
  const d = previewDataset();
  const target = carouselPost(d);
  const published: HubIdea = { id: 'carousels:story:live', vertical: 'carousels', title: 't', score: 1, scoreLabel: 's', state: 'published', hasContent: true, versionCount: 1, generatedAt: null, createdAt: null, detail: null };
  const next = withoutDeleted({ ...d, ideas: [published] }, [{ vertical: 'carousels', nativeRef: target.refs.postId!, ideaRef: 'live' }]);
  assert.equal(next.ideas[0]!.state, 'published');
});

// ── Where the action is offered ─────────────────────────────────────────────

const ALL_ON: Record<ActionFlag, boolean> = { approveCarousel: true, approveTrialReel: true, approveContent: true, hardPublish: true, hardRegenerate: true, reject: true, reschedule: true, unschedule: true, delete: true, refreshOnVisit: true };
const menuOf = (post: HubPost, on = ALL_ON) => actionMenu(post, postState(post, FIXTURE_NOW), actionsFor(post, { quota: null, typicalCostLabel: '$1.00' }), on);
const keys = (post: HubPost, on = ALL_ON) => {
  const m = menuOf(post, on);
  return [m.primary, ...m.secondary, ...m.more].filter(Boolean).map((a) => a!.key);
};

test('Delete is a visible button (not under More), a danger action with a confirm, on content that has not gone live', () => {
  const d = previewDataset();
  const live = d.posts.filter((p) => ['ready', 'scheduled', 'failed', 'cancelled'].includes(p.status));
  assert.ok(live.length > 0, 'fixture has posts to check');
  for (const post of live) {
    const state = postState(post, FIXTURE_NOW);
    const m = menuOf(post);
    const del = m.secondary.find((a) => a.key === 'delete');
    const ref = post.vertical === 'carousels' ? post.refs.postId : post.vertical === 'explainers' ? post.refs.jobId : post.vertical === 'reels' ? post.refs.videoJobId : post.refs.setId;
    if (!ref) continue;
    assert.ok(del, `${post.vertical} ${state.id} offers Delete as a visible button`);
    assert.equal(m.more.some((a) => a.key === 'delete'), false, 'not hidden under More');
    assert.equal(del!.danger, true);
    assert.equal(del!.confirmTitle, 'Delete this post?');
    assert.equal(m.primary?.key === 'delete', false, 'never the primary action');
  }
});

test('Delete is not offered on posting or posted content, and turns off with its flag', () => {
  const d = previewDataset();
  for (const post of d.posts.filter((p) => p.status === 'published' || p.status === 'publishing')) assert.equal(keys(post).includes('delete'), false, post.id);
  const ready = d.posts.find((p) => p.status === 'ready' && p.refs.postId)!;
  assert.equal(keys(ready).includes('delete'), true);
  assert.equal(keys(ready, { ...ALL_ON, delete: false }).includes('delete'), false);
});
