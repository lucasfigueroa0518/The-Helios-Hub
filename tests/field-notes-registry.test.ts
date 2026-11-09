/**
 * Field Notes source registry, thin-candidate enrichment and guide splitting. Every fetch is a stub:
 * nothing here reaches the network or a model (CLAUDE.md Rule 1).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Adapter, AdapterItem } from '@/lib/reels/types';
import { githubRepoOf, UNTRUSTED_MAX_CHARS } from '@/lib/field-notes/sources/candidate';
import { fetchDocsItems, parseDocsPage } from '@/lib/field-notes/sources/docs-adapter';
import { enrichItem, README_NAMES, readmeUrl, type FetchPage } from '@/lib/field-notes/sources/enrich';
import { fetchPageFollowingRedirects, fetchText as httpFetchText, HttpError } from '@/lib/reels/net/http';
import { createdWithinQuery } from '@/lib/field-notes/sources/github-search';
import {
  SOURCE_REGISTRY,
  collectCandidates,
  collectThinCandidates,
  fetchEntryItems,
  type CollectDeps,
  type SourceEntry,
} from '@/lib/field-notes/sources/registry';

const byId = (id: string) => {
  const e = SOURCE_REGISTRY.find((x) => x.id === id);
  assert.ok(e, `${id} is in the registry`);
  return e!;
};
const urlOf = (e: SourceEntry): string => {
  if (e.type === 'docs') return e.fetchUrl ?? e.pageUrl;
  if (e.type === 'github-search') return typeof e.query === 'string' ? e.query : e.query(new Date('2026-11-06T00:00:00Z'));
  return (e.adapter as unknown as { feedUrl?: string }).feedUrl ?? JSON.stringify(e.adapter.id);
};
const prose = (word: string, n = 80) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
const noPage: FetchPage = async () => {
  throw new Error('fetchPage must not be called here');
};
const deps = (over: Partial<CollectDeps> = {}): CollectDeps => ({
  fetchText: async () => {
    throw new Error('no fetchText stub');
  },
  fetchJson: (async () => {
    throw new Error('no fetchJson stub');
  }) as never,
  fetchPage: noPage,
  now: new Date('2026-11-06T12:00:00Z'),
  since: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

// ── Registry contents ──

test('registry: the dropped sources are gone', () => {
  const ids = new Set(SOURCE_REGISTRY.map((e) => e.id));
  for (const id of ['hacker-news', 'github-trending', 'openai-codex-readme', 'console-dev', 'openalternative', 'gh-open-data-topic', 'openai-news', 'cursor-agent-docs']) {
    assert.equal(ids.has(id), false, `${id} dropped`);
  }
  const text = JSON.stringify(SOURCE_REGISTRY.map((e) => ({ ...e, adapter: undefined, query: urlOf(e) })));
  for (const gone of ['openalternative.co', 'console.dev', 'openai.com/news', 'github.com/trending', 'topic:open-data', 'openai/codex/main/README']) {
    assert.equal(text.includes(gone), false, `${gone} not referenced`);
  }
});

test('registry: the added sources are present at the audited URLs', () => {
  const docs = (id: string) => byId(id) as Extract<SourceEntry, { type: 'docs' }>;
  assert.equal(docs('claude-api-release-notes').fetchUrl, 'https://platform.claude.com/docs/en/release-notes/overview.md');
  for (const id of ['copilot-changelog', 'workspace-gemini-updates', 'show-hn']) assert.equal(byId(id).type, 'adapter');
  assert.equal(byId('show-hn').enrich, 'linked-page');
  const queries = SOURCE_REGISTRY.filter((e) => e.type === 'github-search').map(urlOf);
  for (const q of ['topic:ai-memory', 'topic:local-llm', 'topic:self-hosted topic:ai']) assert.ok(queries.some((x) => x.startsWith(q)), q);
  for (const id of ['claude-prompting-guide', 'openai-prompting-guide', 'gemini-prompting-guide']) assert.equal(docs(id).split, 'sections', `${id} splits by section`);
});

test('registry: the bundled vendor changelogs split one item per entry, through fetchEntryItems; the per-source cap is unchanged', async () => {
  const docs = (id: string) => byId(id) as Extract<SourceEntry, { type: 'docs' }>;
  for (const id of ['claude-code-changelog', 'codex-changelog']) assert.equal(docs(id).split, 'entries', `${id} splits by entry`);
  // Cursor's feed already has one feature per item: it stays an RSS adapter.
  assert.equal(byId('cursor-changelog').type, 'adapter');
  const page = [
    '# Changelog', '', '**3.0.0**', '', 'November 5, 2026', '', '**Added**', '', '* Added a planner that drafts a task list first', '* Added `--dry` to preview edits',
    '', '**2 bug fixes**', '', '* Fixed a crash on start', '* Fixed a typo', '',
  ].join('\n');
  const items = await fetchEntryItems({ ...docs('claude-code-changelog'), fetchUrl: 'https://x.test/c.md' }, deps({ fetchText: async () => page }));
  assert.deepEqual(items.map((i) => i.headline), [
    'Claude Code 3.0.0 (November 5, 2026): Added a planner that drafts a task list first',
    'Claude Code 3.0.0 (November 5, 2026): Added --dry to preview edits',
  ]);
  assert.ok(items.every((i) => i.canonicalUrl.startsWith('https://code.claude.com/docs/en/changelog#3-0-0-november-5-2026-')));
});

test('registry: every entry was verified 2026-11-06 with a note, names leaves, and no vendor is over a third', () => {
  for (const e of SOURCE_REGISTRY) {
    assert.equal(e.verifiedOn, '2026-11-06', e.id);
    assert.ok(e.note && e.note.length > 10, `${e.id} has a fetch note`);
    assert.ok(e.leaves && e.leaves.length > 0, `${e.id} has leaves`);
  }
  const counts = new Map<string, number>();
  for (const e of SOURCE_REGISTRY) if (e.vendor !== 'any') counts.set(e.vendor!, (counts.get(e.vendor!) ?? 0) + 1);
  for (const [v, n] of counts) assert.ok(n <= SOURCE_REGISTRY.length / 3, `${v}: ${n} of ${SOURCE_REGISTRY.length}`);
});

// ── New-repo searches: the window comes from the run's date ──

test('new mcp-server and agent-skills searches build a 30-day created window from the injected date, most stars first', async () => {
  for (const [id, topic] of [['gh-new-mcp-servers', 'mcp-server'], ['gh-new-agent-skills', 'agent-skills']] as const) {
    const entry = byId(id);
    for (const [now, since] of [['2026-11-06T12:00:00Z', '2026-10-07'], ['2027-03-01T00:00:00Z', '2027-01-30']]) {
      const urls: string[] = [];
      await fetchEntryItems(entry, deps({ now: new Date(now), fetchJson: (async (u: string) => (urls.push(u), { items: [] })) as never }));
      assert.equal(urls.length, 1);
      const q = new URL(urls[0]).searchParams;
      assert.equal(q.get('q'), `topic:${topic} created:>${since} stars:>50`);
      assert.equal(q.get('sort'), 'stars');
      assert.equal(q.get('order'), 'desc');
    }
  }
  assert.equal(createdWithinQuery('x', 7, 1)(new Date('2026-01-03T00:00:00Z')), 'topic:x created:>2025-12-27 stars:>1');
});

// ── README enrichment for GitHub search results ──

const repo = (name: string, description: string) => ({ full_name: name, html_url: `https://github.com/${name}`, description, stargazers_count: 900, pushed_at: '2026-11-05T00:00:00Z', topics: ['mcp'] });

test('github search results get their README from raw.githubusercontent.com; a failed README keeps the description', async () => {
  const entry: SourceEntry = { type: 'github-search', id: 'gh', label: 'GH', kind: 'github', query: 'topic:mcp-server', why: 't' };
  const jsonCalls: string[] = [];
  const textCalls: string[] = [];
  const out = await collectCandidates([entry], deps({
    fetchJson: (async (u: string) => (jsonCalls.push(u), { items: [repo('acme/good', 'An MCP server.'), repo('acme/broken', 'Thin description only.'), repo('acme/huge', 'Big one.')] })) as never,
    fetchText: async (u) => {
      textCalls.push(u);
      if (u.includes('/broken/')) throw new Error('404');
      if (u.includes('/huge/')) return `# Huge\n\n${'long readme text '.repeat(2000)}`;
      return `# Good\n\n![badge](https://img.shields.io/x)\n\n## Install\n\n${prose('install')}\n\nRun it with \`npx good\`.`;
    },
  }));
  assert.equal(jsonCalls.length, 1, 'one search request, no per-repo API calls');
  assert.deepEqual(textCalls.sort(), ['acme/broken', 'acme/good', 'acme/huge'].map((r) => readmeUrl(...(r.split('/') as [string, string]))).sort());
  assert.ok(textCalls.every((u) => u.startsWith('https://raw.githubusercontent.com/') && u.endsWith('/HEAD/README.md')));
  const c = (name: string) => out.candidates.find((x) => x.sourceUrl === `https://github.com/${name}`)!;
  assert.match(c('acme/good').untrustedContent, /An MCP server\./);
  assert.match(c('acme/good').untrustedContent, /install79/);
  assert.equal(c('acme/good').item.textIsComplete, true);
  assert.doesNotMatch(c('acme/good').untrustedContent, /shields\.io/);
  assert.match(c('acme/broken').untrustedContent, /Thin description only\./);
  assert.equal(c('acme/broken').item.textIsComplete, false);
  assert.ok(c('acme/huge').untrustedContent.length <= UNTRUSTED_MAX_CHARS);
  assert.deepEqual(out.failures, []);
});

// ── Linked-page enrichment for Show HN ──

const hnItem = (title: string, link: string): AdapterItem => ({
  canonicalUrl: link,
  headline: title,
  body: `Article URL: ${link} Points: 120`,
  publishTime: new Date('2026-11-05T00:00:00Z'),
  textIsComplete: false,
  destinationUrl: link,
});

test('Show HN items read the linked page through the guarded fetch, or the README for a GitHub link; failures keep the title', async () => {
  const adapter = {
    id: 'hn', name: 'HN', type: 'A6', bucket: 'A', kind: 'dated',
    fetchItems: async () => [
      hnItem('Show HN: Pagey', 'https://pagey.example.com/'),
      hnItem('Show HN: Repoy', 'https://github.com/Owner/Repoy'),
      hnItem('Show HN: Downy', 'https://down.example.com/'),
      hnItem('Show HN: Texty', 'https://news.ycombinator.com/item?id=1'),
    ],
  } as unknown as Adapter;
  const entry: SourceEntry = { type: 'adapter', id: 'show-hn', label: 'Show HN', kind: 'hn', enrich: 'linked-page', adapter, why: 't' };
  const pages: string[] = [];
  const texts: string[] = [];
  const out = await collectCandidates([entry], deps({
    fetchPage: async (u) => {
      pages.push(u);
      if (u.includes('down.')) throw new Error('blocked or down');
      return { html: `<html><head><title>Pagey</title></head><body><main><p>${prose('pagey')}</p></main></body></html>`, finalUrl: u };
    },
    fetchText: async (u) => (texts.push(u), `# Repoy\n\n${prose('repoy')}`),
  }));
  assert.deepEqual(pages.sort(), ['https://down.example.com/', 'https://pagey.example.com/']);
  assert.deepEqual(texts, ['https://raw.githubusercontent.com/Owner/Repoy/HEAD/README.md']);
  const c = (title: string) => out.candidates.find((x) => x.untrustedContent.startsWith(title))!;
  assert.match(c('Show HN: Pagey').untrustedContent, /pagey79/);
  assert.doesNotMatch(c('Show HN: Pagey').untrustedContent, /Points: 120/);
  assert.match(c('Show HN: Repoy').untrustedContent, /repoy79/);
  assert.match(c('Show HN: Downy').untrustedContent, /Points: 120/);
  assert.equal(c('Show HN: Downy').item.textIsComplete, false);
  assert.match(c('Show HN: Texty').untrustedContent, /Points: 120/);
  assert.equal(out.candidates.length, 4);
});

test('enrichItem never throws and leaves a too-short fetch alone; githubRepoOf skips non-repo pages', async () => {
  const item = hnItem('T', 'https://x.example.com/');
  assert.equal(await enrichItem(item, 'linked-page', { fetchText: async () => '', fetchPage: async () => ({ html: '<p>tiny</p>', finalUrl: '' }) }), item);
  const bad = { ...item, destinationUrl: 'not a url', canonicalUrl: 'not a url' };
  assert.equal(await enrichItem(bad, 'linked-page', { fetchText: async () => '', fetchPage: noPage }), bad);
  assert.equal(await enrichItem(item, 'readme', { fetchText: noPage as never, fetchPage: noPage }), item, 'readme mode on a non-GitHub URL is a no-op');
  assert.deepEqual(githubRepoOf('https://www.github.com/a-b/c.d.git'), { owner: 'a-b', repo: 'c.d', slug: 'a-b/c.d' });
  assert.deepEqual(githubRepoOf('https://github.com/A/B/tree/main/src'), { owner: 'A', repo: 'B', slug: 'a/b' }, 'case kept for raw URLs, slug lowercase');
  for (const u of ['https://github.com/topics/mcp', 'https://github.com/a', 'https://gitlab.com/a/b', 'nope']) assert.equal(githubRepoOf(u), null, u);
});

// ── Single-page guides split by section ──

const GUIDE_MD = [
  '# Prompting guide',
  'Intro line.',
  '## Be clear and direct',
  prose('clear'),
  '```markdown',
  '## Not a heading inside code',
  '```',
  '## Use examples  {% id="few-shot" %}',
  prose('examples'),
  '## Tiny stub',
  'Too short to be a tip.',
  '## Long agentic section',
  'Short intro.',
  '### Parallel tools',
  prose('parallel', 500),
  '### State tracking',
  prose('state', 500),
  '## Next steps',
  prose('links'),
].join('\n\n');

test('an undated guide yields one item per ## section at page#slug; long sections split per ###; nav and stubs dropped', () => {
  const items = parseDocsPage(GUIDE_MD, { name: 'Guide', pageUrl: 'https://docs.example.com/guide', format: 'markdown', split: 'sections' });
  assert.deepEqual(items.map((i) => i.canonicalUrl), [
    'https://docs.example.com/guide#be-clear-and-direct',
    'https://docs.example.com/guide#few-shot',
    'https://docs.example.com/guide#parallel-tools',
    'https://docs.example.com/guide#state-tracking',
  ]);
  assert.equal(new Set(items.map((i) => i.canonicalUrl)).size, items.length);
  assert.ok(items.every((i) => i.publishTime === null && i.textIsComplete));
  assert.equal(items[0].headline, 'Guide: Be clear and direct');
  assert.equal(items[2].headline, 'Guide: Long agentic section / Parallel tools');
  assert.doesNotMatch(items[0].body, /Not a heading/);
  // Same page, same URLs: stable across runs.
  assert.deepEqual(parseDocsPage(GUIDE_MD, { name: 'Guide', pageUrl: 'https://docs.example.com/guide', format: 'markdown', split: 'sections' }).map((i) => i.canonicalUrl), items.map((i) => i.canonicalUrl));
  // Without split the page is still one item.
  assert.equal(parseDocsPage(GUIDE_MD, { name: 'Guide', pageUrl: 'https://docs.example.com/guide', format: 'markdown' }).length, 1);
});

test('an HTML guide splits on <h2 id> inside <main>', async () => {
  const html = `<html><body><nav><h2 id="nav">Search</h2></nav><main>
    <h2 id="few-shot-learning">Few-shot learning</h2><p>${prose('few')}</p>
    <h2 id="message-formatting">Message formatting</h2><p>${prose('fmt')}</p>
    <h2 id="next-steps">Next steps</h2><p>${prose('next')}</p></main></body></html>`;
  const items = await fetchDocsItems({ id: 'g', name: 'OpenAI guide', pageUrl: 'https://dev.example.com/guide', format: 'html', split: 'sections', fetchText: async () => html });
  assert.deepEqual(items.map((i) => i.canonicalUrl), ['https://dev.example.com/guide#few-shot-learning', 'https://dev.example.com/guide#message-formatting']);
});

test('a registry guide becomes several candidates with distinct URLs (fragments survive dedupe)', async () => {
  const entry = byId('claude-prompting-guide') as Extract<SourceEntry, { type: 'docs' }>;
  const out = await collectCandidates([entry], deps({ fetchText: async (u) => (assert.equal(u, entry.fetchUrl), GUIDE_MD) }));
  assert.equal(out.candidates.length, 4);
  assert.ok(out.candidates.every((c) => c.sourceUrl.startsWith(`${entry.pageUrl}#`)));
  assert.equal(new Set(out.candidates.map((c) => c.sourceUrl)).size, 4);
});

// ── README file names ──

test('README: tries README.md, readme.md, README.MD, Readme.md, README.rst, README in turn; stops at the first that answers', async () => {
  assert.deepEqual([...README_NAMES], ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README.rst', 'README']);
  const item: AdapterItem = { canonicalUrl: 'https://github.com/acme/lower', headline: 'acme/lower', body: 'Thin.', publishTime: null, textIsComplete: false };
  const asked: string[] = [];
  const out = await enrichItem(item, 'readme', {
    fetchPage: noPage,
    fetchText: async (u) => {
      asked.push(u);
      if (!u.endsWith('/Readme.md')) throw new HttpError(404, u);
      return `# Lower\n\n${prose('lower')}`;
    },
  });
  assert.deepEqual(asked, ['README.md', 'readme.md', 'README.MD', 'Readme.md'].map((n) => readmeUrl('acme', 'lower', n)));
  assert.ok(asked.every((u) => u.startsWith('https://raw.githubusercontent.com/')), 'no API calls');
  assert.match(out.body, /lower79/);
  // Not under any name: every name tried once, the item kept thin.
  const none: string[] = [];
  const thin = await enrichItem(item, 'readme', { fetchPage: noPage, fetchText: async (u) => (none.push(u), Promise.reject(new HttpError(404, u))) });
  assert.equal(thin, item);
  assert.equal(none.length, README_NAMES.length);
  // A timeout or 5xx is not "missing": the hunt stops at once.
  const once: string[] = [];
  assert.equal(await enrichItem(item, 'readme', { fetchPage: noPage, fetchText: async (u) => (once.push(u), Promise.reject(new Error('timeout'))) }), item);
  assert.equal(once.length, 1);
});

// ── Thin collection: enrichment only for what the caller passes ──

test('collectThinCandidates fetches no README or page; enrich(subset) fetches only for that subset and keeps link, source and order', async () => {
  const entry: SourceEntry = { type: 'github-search', id: 'gh', label: 'GH', kind: 'github', query: 'topic:mcp-server', why: 't' };
  const textCalls: string[] = [];
  const thin = await collectThinCandidates([entry], deps({
    fetchJson: (async () => ({ items: [repo('acme/one', 'One.'), repo('acme/two', 'Two.'), repo('acme/three', 'Three.')] })) as never,
    fetchText: async (u) => (textCalls.push(u), `# R\n\n${prose('readme')}`),
  }));
  assert.equal(thin.candidates.length, 3);
  assert.deepEqual(textCalls, [], 'collecting fetches nothing per item');
  assert.ok(thin.candidates.every((c) => c.item.textIsComplete === false));
  const picked = [thin.candidates[2]!, thin.candidates[0]!];
  const out = await thin.enrich(picked);
  assert.deepEqual(textCalls.sort(), [readmeUrl('acme', 'one'), readmeUrl('acme', 'three')].sort(), 'only the subset is fetched for');
  assert.deepEqual(out.map((c) => c.sourceUrl), picked.map((c) => c.sourceUrl), 'order and links kept');
  assert.ok(out.every((c) => c.sourceLabel === 'GH' && c.item.textIsComplete === true && /readme79/.test(c.untrustedContent)));
  // A candidate the collector never saw (a stored tip, say) comes back untouched, with no fetch.
  const stranger = { ...picked[0]!, sourceUrl: 'https://github.com/other/repo' };
  textCalls.length = 0;
  assert.deepEqual(await thin.enrich([stranger]), [stranger]);
  assert.deepEqual(textCalls, []);
});

// ── The shared http helper: an optional byte cap while streaming ──

test('http maxBytes: a huge body is read only up to the cap (the stream is cancelled) and the truncated text returned; no cap reads it all', async () => {
  const realFetch = globalThis.fetch;
  let pulled = 0;
  let cancelled = false;
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
  const huge = () =>
    new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 10_000) return controller.close(); // ~640 MB if nothing stops it
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    globalThis.fetch = (async () => huge()) as typeof fetch;
    const text = await httpFetchText('https://big.example.com/', { retries: 0, maxBytes: 200_000 });
    assert.equal(text.length, 200_000);
    assert.ok(cancelled, 'the rest of the stream is cancelled');
    assert.ok(pulled < 10, `stopped early (${pulled} chunks pulled)`);
    pulled = 0;
    cancelled = false;
    // The guarded page fetch (a public address from an injected lookup, so no DNS) honours the same cap.
    const page = await fetchPageFollowingRedirects('https://big.example.com/', { retries: 0, maxBytes: 100_000, blockPrivate: true, lookup: async () => ['93.184.216.34'] });
    assert.equal(page.html.length, 100_000);
    assert.ok(cancelled);
    // Without maxBytes the helper behaves as before (whole body).
    globalThis.fetch = (async () => new Response('small body', { status: 200 })) as typeof fetch;
    assert.equal(await httpFetchText('https://small.example.com/', { retries: 0 }), 'small body');
  } finally {
    globalThis.fetch = realFetch;
  }
});
