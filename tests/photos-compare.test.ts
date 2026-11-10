/**
 * The Phase 3 comparison (PHASE3-CONTRACT.md, Owner D): the read-only query guard, the plan builders over stored
 * rows (fixtures, no DB), the run loop with a stub finder (no model, Serper or HTTP call), and the HTML escaping.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isReadOnlySql, readOnlyQuery, type ReadClient, type ReadPool } from '@/lib/photos/compare/db';
import { esc, renderHtml, webUrl } from '@/lib/photos/compare/html';
import { carouselPlan, lfdPlan, requestFromStep, storySetPlan, subjectsFromQuery, type ComparePost } from '@/lib/photos/compare/plan';
import { planLines, runComparison, type FindFn } from '@/lib/photos/compare/run';
import type { Photo } from '@/lib/stories/render/types';

// ── readOnlyQuery ─────────────────────────────────────────────────────────

function fakePool(rows: unknown[] = [{ n: 1 }], failOn?: string) {
  const calls: string[] = [];
  let connects = 0;
  let released: unknown = 'not released';
  const client: ReadClient = {
    async query(text: string) {
      calls.push(text);
      if (failOn && text === failOn) throw new Error(`boom: ${text}`);
      return { rows };
    },
    release(err) {
      released = err;
    },
  };
  const pool: ReadPool = {
    async connect() {
      connects++;
      return client;
    },
  };
  return { pool, calls, connects: () => connects, released: () => released };
}

test('isReadOnlySql accepts SELECT and WITH, after comments and whitespace', () => {
  assert.equal(isReadOnlySql('SELECT 1'), true);
  assert.equal(isReadOnlySql('  \n-- why\n/* block */ select * from lfd.posts;'), true);
  assert.equal(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(isReadOnlySql("SELECT 'delete from x; update y set z' AS s"), true, 'a string literal is not SQL');
});

test('isReadOnlySql refuses writes, SETs, multiple statements and data-modifying CTEs', () => {
  for (const sql of [
    'INSERT INTO lfd.posts VALUES (1)',
    'UPDATE social.runs SET status = 1',
    'DELETE FROM social.used_photos',
    'set default_transaction_read_only = on',
    'SET SESSION characteristics AS TRANSACTION READ ONLY',
    '-- harmless\nTRUNCATE stories.sets',
    'SELECT 1; DELETE FROM lfd.posts',
    'WITH gone AS (DELETE FROM lfd.posts RETURNING id) SELECT * FROM gone',
    'WITH x AS (UPDATE stories.sets SET status = $1 RETURNING id) SELECT 1',
    'SELECT * INTO TEMP t FROM lfd.posts',
    'BEGIN',
    '',
  ]) assert.equal(isReadOnlySql(sql), false, sql);
});

test('readOnlyQuery refuses a write before touching the pool', async () => {
  const f = fakePool();
  await assert.rejects(readOnlyQuery(f.pool, 'DELETE FROM lfd.posts'), /refuses/);
  await assert.rejects(readOnlyQuery(f.pool, 'set default_transaction_read_only=on'), /refuses/);
  assert.equal(f.connects(), 0);
  assert.deepEqual(f.calls, []);
});

test('readOnlyQuery runs BEGIN READ ONLY, the query, ROLLBACK on one client, then releases it', async () => {
  const f = fakePool([{ id: 'a' }]);
  const res = await readOnlyQuery<{ id: string }>(f.pool, 'SELECT id FROM lfd.posts WHERE id = $1', ['a']);
  assert.deepEqual(res.rows, [{ id: 'a' }]);
  assert.deepEqual(f.calls, ['BEGIN READ ONLY', 'SELECT id FROM lfd.posts WHERE id = $1', 'ROLLBACK']);
  assert.equal(f.connects(), 1);
  assert.equal(f.released(), undefined, 'a healthy client goes back to the pool');
  assert.ok(!f.calls.some((c) => /^\s*set\b/i.test(c)), 'never a session-level SET');
});

test('readOnlyQuery rolls back and releases when the query fails; a failed ROLLBACK destroys the client', async () => {
  const q = 'SELECT broken';
  const f = fakePool([], q);
  await assert.rejects(readOnlyQuery(f.pool, q), /boom/);
  assert.deepEqual(f.calls, ['BEGIN READ ONLY', q, 'ROLLBACK']);
  assert.equal(f.released(), undefined);
  const g = fakePool([], 'ROLLBACK');
  await readOnlyQuery(g.pool, 'SELECT 1');
  assert.ok(g.released() instanceof Error, 'a client whose ROLLBACK failed is not reused');
});

// ── Plan builders ─────────────────────────────────────────────────────────

test('requestFromStep and subjectsFromQuery read the design stage trace and names only', () => {
  assert.deepEqual(requestFromStep('company: "Goldman Sachs"'), { kind: 'company', query: 'Goldman Sachs' });
  assert.equal(requestFromStep("kept the carousel post's photo (S-29)"), null);
  assert.equal(requestFromStep('bank: no verified organization "X"'), null);
  assert.deepEqual(subjectsFromQuery('person', 'Jensen Huang'), [{ name: 'Jensen Huang', type: 'person' }]);
  assert.deepEqual(subjectsFromQuery('logo', 'OpenAI logo'), [{ name: 'OpenAI', type: 'organization' }]);
  assert.deepEqual(subjectsFromQuery('company', 'Meta headquarters Menlo Park'), []);
  assert.deepEqual(subjectsFromQuery('thematic', 'Server Racks'), []);
});

const lfdRow = {
  id: 'lfd-1',
  ny_date: '2026-11-09',
  created_at: new Date('2026-11-10T01:04:08Z'),
  status: 'review',
  stories: [
    {
      key: 'k1', lane: 'major', origin: 'reels', url: 'https://www.theverge.com/a', outlet: 'The Verge', major: 0.8, net: 1, setup: '', headline: 'Nvidia probes its CEO.', highlight: 'CEO', names: ['Nvidia'], body: 'The board opened an inquiry',
      photoAsk: { kind: 'person', query: 'Jensen Huang', subjects: [{ name: 'Jensen Huang', type: 'person' }], alts: [] },
      photo: { src: 'https://i.guim.co.uk/x.jpg', credit: 'Guardian', kind: 'person' }, photoSource: 'lead',
    },
    { key: 'k2', lane: 'rundown', origin: 'feed', url: 'https://x.test/b', outlet: 'X', headline: 'Old post', body: '', photo: { src: 'storage:lfd/m.png', credit: 'meme', kind: 'scene' } },
  ],
};

test('lfdPlan rebuilds each slide from its stored request, with the shipped photo as old', () => {
  const p = lfdPlan(lfdRow) as ComparePost;
  assert.ok(!('reason' in p));
  assert.equal(p.type, 'lfd');
  assert.equal(p.date, '2026-11-09');
  assert.equal(p.frames.length, 1, 'a story without photoAsk is left out');
  const f = p.frames[0]!;
  assert.equal(f.need.kind, 'person');
  assert.equal(f.need.query, 'Jensen Huang');
  assert.equal(f.need.specificity, 'subject');
  assert.deepEqual(f.need.storyUrls, ['https://www.theverge.com/a']);
  assert.equal(f.need.sourceName, 'The Verge');
  assert.deepEqual(f.old, { src: 'https://i.guim.co.uk/x.jpg', credit: 'Guardian', kind: 'person', source: 'lead' });
  assert.ok(p.notes.some((n) => /without a stored photo request/.test(n)));
  assert.match((lfdPlan({ ...lfdRow, stories: [] }) as { reason: string }).reason, /no stories/);
});

const frame = (seq: number, role: string, photo: unknown = null, copy: unknown = {}) => ({ seq, role, copy, photo });

test('storySetPlan (Morning Download) reads the requests from photo_log and matches story frames in order', () => {
  const row = {
    id: 'md-1', series: 'morning_download', ny_date: '2026-11-09', created_at: '2026-11-09T10:00:00Z', status: 'ready',
    payload: {
      stories: [
        { key: 'a', url: 'https://theverge.com/a', source: 'The Verge', headline: 'Nvidia probes its CEO.' },
        { key: 'b', url: 'https://futurism.com/b', source: 'Futurism', headline: 'Mamdani slams Google.' },
      ],
      photo_log: [
        { frame: 'opener', steps: ['thematic: "stack of newspapers"', 'more'] },
        { frame: 'story 1', steps: ['person: "Jensen Huang"'] },
        { frame: 'story 2', picked: 'https://c/kept.jpg', steps: ["kept the carousel post's photo (S-29)"] },
      ],
    },
    frames: [frame(1, 'opener', { src: 'https://w/news.jpg', credit: 'WM', kind: 'scene' }), frame(2, 'story'), frame(3, 'story', { src: 'https://c/kept.jpg', credit: 'C', kind: 'scene' }), frame(4, 'closer')],
  };
  const p = storySetPlan(row) as ComparePost;
  assert.equal(p.type, 'md');
  assert.deepEqual(p.frames.map((f) => f.id), ['opener', 'story 1', 'story 2']);
  const [opener, s1, s2] = p.frames as [ComparePost['frames'][number], ComparePost['frames'][number], ComparePost['frames'][number]];
  assert.equal(opener.need.cover, true);
  assert.equal(opener.need.query, 'stack of newspapers');
  assert.equal(opener.need.specificity, 'story');
  assert.equal(opener.old?.src, 'https://w/news.jpg');
  assert.equal(s1.need.kind, 'person');
  assert.deepEqual(s1.need.subjects, [{ name: 'Jensen Huang', type: 'person' }]);
  assert.equal(s1.old, null);
  assert.equal(s2.need.kind, 'event', 'a kept carousel photo stored no request');
  assert.equal(s2.need.query, 'Mamdani slams Google.');
  assert.equal(s2.old?.src, 'https://c/kept.jpg');
  assert.match((storySetPlan({ ...row, frames: [frame(1, 'opener')] }) as { reason: string }).reason, /story frame/);
});

test('storySetPlan (GTN) uses the chosen candidate; (FvP) the stored pair', () => {
  const gtn = storySetPlan({
    id: 'g-1', series: 'guess_the_number', ny_date: '2026-11-05', created_at: '2026-11-05T10:00:00Z', status: 'ready', payload: {},
    chosen: { question: 'How many parameters does GPT-3 have?', answer: '175B', label: 'parameters', topic: 'GPT-3 size', meaning: 'Big.', source_url: 'https://arxiv.org/abs/1', source_name: 'arXiv', visual: { kind: 'product', query: 'GPT-3' }, answer_visual: { kind: 'company', query: 'OpenAI' }, subjects: [{ name: 'OpenAI', type: 'organization' }] },
    frames: [frame(1, 'intro'), frame(2, 'question', { src: 'https://q.jpg', credit: 'Q', kind: 'scene' }), frame(3, 'answer')],
  }) as ComparePost;
  assert.deepEqual(gtn.frames.map((f) => [f.id, f.need.kind, f.need.query, f.old?.src ?? null]), [['question', 'product', 'GPT-3', 'https://q.jpg'], ['answer', 'company', 'OpenAI', null]]);
  assert.match((storySetPlan({ id: 'g-2', series: 'guess_the_number', ny_date: '', created_at: '', status: 'ready', payload: {}, frames: [] }) as { reason: string }).reason, /no chosen candidate/);

  const fvp = storySetPlan({
    id: 'f-1', series: 'free_vs_paid', ny_date: '2026-10-31', created_at: '2026-10-31T10:00:00Z', status: 'ready',
    payload: { pair: { paid_tool: 'Microsoft 365', paid_price: '$9.99', price_period: 'a month', paid_price_url: 'https://microsoft.com/p', free_tool: 'LibreOffice', free_url: 'https://libreoffice.org', what_it_does: 'Office suite' } },
    frames: [frame(1, 'intro'), frame(2, 'paid', { src: 'https://ms-logo.png', credit: 'MS', kind: 'logo' }), frame(3, 'free')],
  }) as ComparePost;
  assert.deepEqual(fvp.frames.map((f) => [f.id, f.need.kind, f.need.query, f.need.specificity]), [['paid', 'logo', 'Microsoft 365', 'subject'], ['free', 'logo', 'LibreOffice', 'subject']]);
  assert.equal(fvp.frames[0]!.old?.kind, 'logo');
});

const brief = {
  single_story: { yes: true, note: null }, the_news: { text: 'Anthropic commits 5% of shares.', ids: [] }, why_it_matters: [], facts: [], background: [], quotes: [], numbers: [], terms: [], events: [],
  subjects: [{ id: 'S1', name: 'Anthropic', role: null, type: 'organization' }, { id: 'S2', name: 'Elon Musk', role: null, type: 'person' }],
  sources: [{ url: 'https://abcnews.com/a', date: '2026-10-19', kind: 'original', outlet: 'ABC News' }],
};
const visual = (kind: string, query: string) => ({ kind, query });
const slide = (h: string, v: ReturnType<typeof visual>, ids: string[]) => ({ type: 'text', headline: { text: h, facts: [] }, body: null, quote_id: null, quote_excerpt: null, number_ids: [], visual: v, fallback_visual: visual('thematic', 'x'), subject_ids: ids });
const draft = {
  cover_options: [{ text: 'Cover one', facts: [], visual: visual('thematic', 'cash'), fallback_visual: visual('thematic', 'x'), subject_ids: ['S1'] }, { text: 'Cover two', facts: [], visual: visual('logo', 'Anthropic'), fallback_visual: visual('thematic', 'x') }],
  chosen_cover: 1, slides: [slide('Anthropic gives', visual('logo', 'Anthropic'), ['S1']), slide('Musk responds', visual('person', 'Elon Musk'), ['S2'])],
  follow: '', caption: { text: '', facts: [] }, edit_notes: [],
};

test('carouselPlan fills the stored draft and matches render slides by slot (cover first)', () => {
  const p = carouselPlan({
    id: 'c-1', title: 'Anthropic fund', status: 'review', created_at: new Date('2026-10-26T12:00:00Z'), brief, draft,
    render: { slides: [{ photoUrl: 'https://cover.jpg', photoCredit: 'SS', layoutVariant: 'cover' }, { photoUrl: 'https://logo.png', layoutVariant: 'text' }, { photoUrl: null, layoutVariant: 'text' }, { photoUrl: null, layoutVariant: 'follow' }] },
  }) as ComparePost;
  assert.equal(p.type, 'carousel');
  assert.equal(p.date, '2026-10-26');
  assert.deepEqual(p.frames.map((f) => f.id), ['cover', 'slide 2', 'slide 3']);
  assert.equal(p.frames[0]!.need.cover, true);
  assert.deepEqual(p.frames.map((f) => f.old?.src ?? null), ['https://cover.jpg', 'https://logo.png', null]);
  assert.deepEqual(p.frames[2]!.need.subjects, [{ name: 'Elon Musk', type: 'person' }]);
  assert.deepEqual(p.notes, []);
  assert.match((carouselPlan({ id: 'c-2', title: 't', status: 'review', created_at: '', brief: null, draft, render: {} }) as { reason: string }).reason, /no brief or draft/);
  const badNumber = { ...draft, slides: [{ ...draft.slides[0]!, number_ids: ['N9'] }] };
  assert.match((carouselPlan({ id: 'c-3', title: 't', status: 'review', created_at: '', brief, draft: badNumber, render: {} }) as { reason: string }).reason, /could not be filled/);
});

// ── Run loop ──────────────────────────────────────────────────────────────

const postOf = (id: string, frames = 2): ComparePost => {
  const p = lfdPlan({ ...lfdRow, id }) as ComparePost;
  return { ...p, frames: Array.from({ length: frames }, (_, i) => ({ ...p.frames[0]!, id: `story ${i + 1}`, label: `story ${i + 1}` })) };
};
const noExclude = async () => ({ urls: new Set<string>(['https://used.jpg']), note: null });

test('dry mode never calls the finder', async () => {
  let calls = 0;
  const find: FindFn = async () => {
    calls++;
    throw new Error('no');
  };
  const r = await runComparison([postOf('a'), postOf('b')], [{ type: 'md', postId: 'm', reason: 'why' }], { mode: 'dry', capUsd: 2.8, find, exclude: noExclude });
  assert.equal(calls, 0);
  assert.equal(r.spentUsd, 0);
  assert.deepEqual(r.posts.map((p) => p.outcome), ['planned', 'planned']);
  assert.equal(r.posts[0]!.excludeCount, 1);
  const lines = planLines(r).join('\n');
  assert.match(lines, /2 post\(s\), 4 need\(s\), 1 skipped\. Dry: no model or Serper calls\./);
  assert.match(lines, /SKIPPED md m: why/);
});

test('go mode: one fresh budget per post, the post exclude passed, and the global cap checked before each post', async () => {
  const seen: Array<{ budget: number; exclude: number; needs: number }> = [];
  const find: FindFn = async (needs, profile, _deps, opts) => {
    seen.push({ budget: opts.budget.usd, exclude: opts.exclude.size, needs: needs.length });
    assert.equal(opts.budget.capUsd, profile.capUsd);
    opts.budget.usd += 0.25;
    const photo: Photo = { src: 'https://new.jpg', credit: 'Reuters', kind: 'scene' };
    return { photos: needs.map((_, i) => (i === 0 ? photo : null)), traces: needs.map(() => ['shared: step']) };
  };
  // $0.30 per post: a 0.70 cap fits two posts (0 + 0.30, 0.25 + 0.30), not a third (0.50 + 0.30 > 0.70).
  const r = await runComparison([postOf('a'), postOf('b'), postOf('c')], [], { mode: 'go', capUsd: 0.7, find, deps: { harvest: {} as never, now: () => new Date() }, exclude: noExclude });
  assert.deepEqual(seen, [{ budget: 0, exclude: 1, needs: 2 }, { budget: 0, exclude: 1, needs: 2 }]);
  assert.deepEqual(r.posts.map((p) => p.outcome), ['ran', 'ran', 'cap']);
  assert.equal(r.spentUsd, 0.5);
  assert.equal(r.posts[0]!.frames[0]!.new?.src, 'https://new.jpg');
  assert.equal(r.posts[0]!.frames[1]!.new, null);
  assert.deepEqual(r.posts[0]!.frames[0]!.trace, ['shared: step']);
  assert.ok(r.posts[2]!.notes.some((n) => /global cap/.test(n)));
  await assert.rejects(runComparison([postOf('a')], [], { mode: 'go', capUsd: 1, exclude: noExclude }), /needs find and deps/);
});

// ── HTML ──────────────────────────────────────────────────────────────────

test('renderHtml escapes every stored string and hotlinks only http(s) images, with no scripts', async () => {
  const evil = '<script>alert(1)</script>"\'&';
  const p = postOf('x', 1);
  const post: ComparePost = { ...p, title: evil, notes: [evil], frames: [{ ...p.frames[0]!, copy: evil, old: { src: 'javascript:alert(1)', credit: evil, kind: 'scene', source: null }, need: { ...p.frames[0]!.need, query: evil } }] };
  const find: FindFn = async (needs) => ({ photos: [{ src: 'https://ok.test/a.jpg?x=1&y="2"', credit: evil, kind: 'scene' }], traces: needs.map(() => [evil]) });
  const r = await runComparison([post], [{ type: 'md', postId: evil, reason: evil }], { mode: 'go', capUsd: 1, find, deps: { harvest: {} as never, now: () => new Date() }, exclude: noExclude });
  const html = renderHtml(r);
  assert.ok(!html.includes('<script'), 'no script tag, stored or otherwise');
  assert.ok(!html.includes(evil));
  assert.ok(html.includes(esc(evil)));
  assert.ok(!/src="javascript:/i.test(html) && !/href="javascript:/i.test(html), 'a non-web URL is never hotlinked');
  assert.match(html, /not a web URL: javascript:alert\(1\)/);
  assert.ok(html.includes('src="https://ok.test/a.jpg?x=1&amp;y=%222%22"'));
  assert.ok(!/<link[^>]+href=|cdn/i.test(html), 'self-contained: no external stylesheet or CDN');
  assert.equal(webUrl('storage:lfd/a.png'), null);
  assert.equal(esc('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
});
