/**
 * Offline unit tests for Trial Reels Build 1.
 *
 * Nothing here touches the network, Jev, or Claude: per CLAUDE.md the model
 * behaviour is judged by a human running the built product, and automated tests
 * stay light and free.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTrendingHtml } from '@/lib/reels/adapters/github';
import { extractSection, parseListEntries } from '@/lib/reels/adapters/awesome-lists';
import { parseChangelog, slugifyHeading } from '@/lib/reels/adapters/markdown-changelog';
import {
  asUrlList,
  buildRetryTurns,
  checkGrounding,
  storySlug,
  type StoryReport,
} from '@/lib/reels/adapters/web-search';
import { HIGH_CONFIDENCE } from '@/lib/reels/config';
import { excerpt } from '@/lib/reels/jev/state';
import { mergeSets } from '@/lib/reels/jev/runner';
import { INGEST_FILTER } from '@/lib/reels/jev/questions/ingest-filter';
import { PLANTED_INSTRUCTION } from '@/lib/reels/jev/questions/planted-instruction';
import { parseFeed } from '@/lib/reels/net/feed';
import { decodeEntities, htmlToText, markdownToText, parsePage } from '@/lib/reels/net/html';
import { canonicalizeUrl } from '@/lib/reels/net/http';
import { resolveAction } from '@/lib/reels/pipeline/grouping';
import { monthStart, nextRunAt, zoneOffsetMinutes } from '@/lib/reels/schedule';

// ── Schedule (ING-01 / D-031) ────────────────────────────────────────────────

test('nextRunAt lands on 1 AM Eastern through a DST change', () => {
  // US Eastern springs forward on 2027-03-14. A fixed UTC offset would drift.
  const beforeSpring = new Date('2027-03-13T12:00:00Z');
  const next = nextRunAt(beforeSpring);
  assert.equal(zoneOffsetMinutes(next), -300, 'still EST the night before the change');
  assert.equal(next.toISOString(), '2027-03-14T06:00:00.000Z');

  const afterSpring = nextRunAt(new Date('2027-03-14T12:00:00Z'));
  assert.equal(zoneOffsetMinutes(afterSpring), -240, 'EDT after the change');
  assert.equal(afterSpring.toISOString(), '2027-03-15T05:00:00.000Z');
});

test('nextRunAt is strictly in the future, never the run that just fired', () => {
  const justFired = new Date('2026-09-21T05:00:00Z'); // 1:00 AM EDT
  const next = nextRunAt(justFired);
  assert.ok(next.getTime() > justFired.getTime());
  assert.equal(next.toISOString(), '2026-09-22T05:00:00.000Z');
});

test('monthStart anchors the spend watch to the local month, not UTC', () => {
  // 00:30 UTC on the 1st is still the last day of the previous month in ET.
  const start = monthStart(new Date('2026-10-01T00:30:00Z'));
  assert.equal(start.toISOString(), '2026-09-01T04:00:00.000Z');
});

// ── URL identity (GRP-01 / D-055) ────────────────────────────────────────────

test('canonicalizeUrl collapses tracking noise so the same article auto-merges', () => {
  const fromNewsletter = canonicalizeUrl(
    'http://www.techcrunch.com/2026/09/21/a-story/?utm_source=tldr&utm_medium=email',
  );
  const fromFeed = canonicalizeUrl('https://techcrunch.com/2026/09/21/a-story/');
  assert.equal(fromNewsletter, fromFeed);
});

test('canonicalizeUrl keeps fragments, which are a changelog entry identity', () => {
  const a = canonicalizeUrl('https://example.com/release-notes#september-18-2026');
  const b = canonicalizeUrl('https://example.com/release-notes#september-14-2026');
  assert.notEqual(a, b);
});

test('canonicalizeUrl keeps meaningful query parameters', () => {
  assert.equal(
    canonicalizeUrl('https://news.ycombinator.com/item?id=123&utm_source=x'),
    'https://news.ycombinator.com/item?id=123',
  );
});

// ── HTML and feeds ───────────────────────────────────────────────────────────

test('htmlToText drops chrome and keeps the article prose', () => {
  const text = htmlToText(`
    <nav>Home About</nav>
    <script>console.log('tracker')</script>
    <article><h1>Heading</h1><p>First paragraph.</p><p>Second paragraph.</p></article>
    <footer>Copyright</footer>
  `);
  assert.match(text, /First paragraph\./);
  assert.match(text, /Second paragraph\./);
  assert.doesNotMatch(text, /tracker/);
  assert.doesNotMatch(text, /Copyright/);
});

test('decodeEntities handles named and numeric references', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#8212; &#x2019;s'), 'Tom & Jerry \u2014 \u2019s');
});

test('parsePage flags a paywall teaser so the item is skipped, not stored short', () => {
  const page = parsePage(
    '<article><p>The opening paragraph of the story runs here.</p><p>Subscribe to continue reading.</p></article>',
  );
  assert.equal(page.paywalled, true);
});

test('parsePage pulls title, author, publish time, and the social image', () => {
  const page = parsePage(`
    <html><head>
      <meta property="og:title" content="A real headline">
      <meta name="author" content="Jane Doe">
      <meta property="article:published_time" content="2026-09-20T10:00:00Z">
      <meta property="og:image" content="https://example.com/a.png">
    </head><body><article><p>Body text.</p></article></body></html>
  `);
  assert.equal(page.title, 'A real headline');
  assert.equal(page.author, 'Jane Doe');
  assert.equal(page.publishedAt?.toISOString(), '2026-09-20T10:00:00.000Z');
  assert.deepEqual(page.imageUrls, ['https://example.com/a.png']);
});

test('parseFeed reads RSS items including CDATA and full content', () => {
  const items = parseFeed(`<rss><channel>
    <item>
      <title><![CDATA[A launch & a lawsuit]]></title>
      <link>https://example.com/one</link>
      <pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate>
      <dc:creator>Jane Doe</dc:creator>
      <description>Short blurb.</description>
      <content:encoded><![CDATA[<p>The whole article.</p>]]></content:encoded>
    </item>
  </channel></rss>`);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'A launch & a lawsuit');
  assert.equal(items[0].link, 'https://example.com/one');
  assert.equal(items[0].author, 'Jane Doe');
  assert.equal(items[0].publishedAt?.toISOString(), '2026-09-20T10:00:00.000Z');
  assert.match(items[0].contentHtml ?? '', /The whole article/);
});

test('parseFeed reads Atom entries and prefers the alternate link', () => {
  const items = parseFeed(`<feed>
    <entry>
      <title>Atom story</title>
      <link rel="self" href="https://example.com/self"/>
      <link rel="alternate" href="https://example.com/story"/>
      <published>2026-09-19T08:00:00Z</published>
      <summary>Summary text.</summary>
    </entry>
  </feed>`);

  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/story');
});

// ── Adapter parsers ──────────────────────────────────────────────────────────

test('parseTrendingHtml pulls repo names and stars today', () => {
  const repos = parseTrendingHtml(`
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/openai/whisper">openai / whisper</a></h2>
      <p class="col-9 color-fg-muted my-1 pr-4">Robust speech recognition</p>
      <span class="d-inline-block float-sm-right">1,204 stars today</span>
    </article>
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/vercel/next.js">vercel / next.js</a></h2>
      <p class="col-9 color-fg-muted my-1 pr-4">The React framework</p>
      <span class="d-inline-block float-sm-right">87 stars today</span>
    </article>
  `);

  assert.deepEqual(
    repos.map((repo) => [repo.fullName, repo.starsToday]),
    [['openai/whisper', 1204], ['vercel/next.js', 87]],
  );
});

test('parseTrendingHtml returns nothing rather than throwing when markup changes', () => {
  assert.deepEqual(parseTrendingHtml('<main><p>Nothing here</p></main>'), []);
});

test('parseListEntries reads awesome-list rows and skips code fences', () => {
  const entries = parseListEntries([
    '# Awesome LLM',
    '- [LangChain](https://github.com/langchain-ai/langchain) - Framework for LLM apps',
    '```',
    '- [NotAnEntry](https://example.com/fake) - inside a fence',
    '```',
    '* [Ollama](https://github.com/ollama/ollama) — Run models locally',
  ].join('\n'));

  assert.equal(entries.length, 2);
  assert.equal(entries[0].repoFullName, 'langchain-ai/langchain');
  assert.equal(entries[0].description, 'Framework for LLM apps');
  assert.equal(entries[1].repoFullName, 'ollama/ollama');
});

test('parseListEntries reads bold-wrapped rows with a colon separator', () => {
  // The list-of-lists uses `* **[Name](url):** Description`, which a
  // dash-only reader silently returns nothing for.
  const entries = parseListEntries(
    '* **[Awesome AI Agents](https://github.com/brandonhimpfen/awesome-ai-agents):** Frameworks and tools for building agents.',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Awesome AI Agents');
  assert.equal(entries[0].repoFullName, 'brandonhimpfen/awesome-ai-agents');
  assert.equal(entries[0].description, 'Frameworks and tools for building agents.');
});

test('extractSection returns one heading block and stops at the next', () => {
  const markdown = [
    '## Blogging',
    '- [Blog thing](https://github.com/a/b) - no',
    '## Artificial Intelligence (AI)',
    '* **[Awesome AI](https://github.com/x/awesome-ai):** yes',
    '## Cloud Platforms',
    '- [Cloud thing](https://github.com/c/d) - no',
  ].join('\n');

  const section = extractSection(markdown, /artificial intelligence/i);
  const entries = parseListEntries(section);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].repoFullName, 'x/awesome-ai');
});

test('extractSection returns nothing when the heading is absent', () => {
  assert.equal(extractSection('## Other\n- [a](https://x.com) - b', /nope/i), '');
});

test('parseChangelog splits a release-notes page into dated releases', () => {
  const sections = parseChangelog([
    '# Release notes',
    'Intro paragraph that belongs to no release.',
    '### September 18, 2026',
    '* The Compliance API returns transcripts.',
    '### September 14, 2026',
    '* The Messages API can compact a conversation.',
  ].join('\n'));

  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, 'September 18, 2026');
  assert.equal(sections[0].date.getFullYear(), 2026);
  assert.match(sections[0].body, /Compliance API/);
  assert.doesNotMatch(sections[0].body, /Messages API/);
  assert.equal(slugifyHeading('September 18, 2026'), 'september-18-2026');
});

test('markdownToText strips badges and link syntax but keeps the words', () => {
  const text = markdownToText('## Title\n![badge](https://img.shields.io/x)\nSee [the docs](https://example.com) for more.');
  assert.match(text, /See the docs for more\./);
  assert.doesNotMatch(text, /shields\.io/);
});

// ── Grouping thresholds (GRP-03 / D-057, JEV-05 / D-029) ─────────────────────

test('resolveAction merges and links only above the confidence bar', () => {
  assert.equal(resolveAction(0.97, { choice: 'merge', confidence: 0.95 }), 'merge');
  assert.equal(resolveAction(0.91, { choice: 'link', confidence: 0.88 }), 'link');
});

test('resolveAction leaves the source alone when the event match is weak', () => {
  // Same company, different events: exactly the case D-051 says is not a story.
  assert.equal(resolveAction(0.55, { choice: 'merge', confidence: 0.99 }), 'leave');
});

test('resolveAction leaves the source alone when the relationship is uncertain', () => {
  assert.equal(resolveAction(0.99, { choice: 'merge', confidence: 0.6 }), 'leave');
});

test('resolveAction treats the escape option as leave', () => {
  assert.equal(resolveAction(0.99, { choice: 'unrelated', confidence: 0.99 }), 'leave');
});

test('the confidence bar sits exactly at the configured value', () => {
  assert.equal(resolveAction(HIGH_CONFIDENCE, { choice: 'merge', confidence: HIGH_CONFIDENCE }), 'merge');
  assert.equal(
    resolveAction(HIGH_CONFIDENCE - 0.001, { choice: 'merge', confidence: 1 }),
    'leave',
  );
});

// ── B6 grounding (WEB-04 / D-064) ────────────────────────────────────────────

function report(overrides: Partial<StoryReport> = {}): StoryReport {
  return {
    headline: 'A headline',
    story: 'A story.',
    subject: 'Someone',
    claims: [
      { claim: 'First fact.', source_url: 'https://a.example.com/one' },
      { claim: 'Second fact.', source_url: 'https://b.example.com/two' },
    ],
    citation_urls: ['https://a.example.com/one', 'https://b.example.com/two'],
    ...overrides,
  };
}

test('checkGrounding accepts a story whose claims all trace to two publications', () => {
  assert.deepEqual(checkGrounding(report()), { ok: true });
});

test('checkGrounding rejects a claim citing a URL that was never listed', () => {
  const result = checkGrounding(
    report({ claims: [{ claim: 'Unsupported.', source_url: 'https://c.example.com/x' }] }),
  );
  assert.equal(result.ok, false);
});

test('checkGrounding rejects two pages from one publication as one source', () => {
  const result = checkGrounding(
    report({
      claims: [
        { claim: 'One.', source_url: 'https://a.example.com/one' },
        { claim: 'Two.', source_url: 'https://www.a.example.com/two' },
      ],
      citation_urls: ['https://a.example.com/one', 'https://www.a.example.com/two'],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /independent source/);
});

test('checkGrounding rejects a story with no citations at all', () => {
  const result = checkGrounding(report({ citation_urls: [] }));
  assert.equal(result.ok, false);
});

test('checkGrounding treats a single citation sent as a bare string as a failure, not a crash', () => {
  // The first live night returned citation_urls as a string and the adapter
  // threw mid-run. Tool input is model output: shape is a claim, not a promise.
  const result = checkGrounding(
    report({ citation_urls: 'https://a.example.com/one' as unknown as string[] }),
  );
  assert.equal(result.ok, false);
});

test('checkGrounding survives malformed claims instead of throwing', () => {
  for (const claims of [null, 'nope', [{ claim: 'x' }], [42]]) {
    const result = checkGrounding(report({ claims: claims as never }));
    assert.equal(result.ok, false, `claims=${JSON.stringify(claims)}`);
  }
});

test('a grounding retry answers the tool call instead of talking past it', () => {
  // The API rejects a turn whose tool_use has no matching tool_result, which
  // is how the second live night lost a story after paying for it.
  const turns = buildRetryTurns(
    [
      { type: 'text', text: 'Here it is.' },
      { type: 'tool_use', id: 'toolu_abc', name: 'report_story', input: {} },
    ] as never,
    'Only 1 independent source.',
  );

  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, 'assistant');
  assert.equal(turns[1].role, 'user');

  const followUp = turns[1].content as unknown as Array<Record<string, unknown>>;
  assert.equal(followUp[0].type, 'tool_result', 'the tool_result must come first');
  assert.equal(followUp[0].tool_use_id, 'toolu_abc');
  assert.equal(followUp[0].is_error, true);
  assert.match(String(followUp[0].content), /independent source/);
});

test('a retry with no tool call at all still produces a valid turn', () => {
  const turns = buildRetryTurns(
    [{ type: 'text', text: 'I could not find one.' }] as never,
    'No story was reported.',
  );
  const followUp = turns[1].content as unknown as Array<Record<string, unknown>>;
  assert.equal(followUp.length, 1, 'nothing to answer, so just the instruction');
  assert.equal(followUp[0].type, 'text');
});

test('asUrlList normalizes the shapes a tool call actually returns', () => {
  assert.deepEqual(asUrlList(['https://a.com', ' https://b.com ']), ['https://a.com', 'https://b.com']);
  assert.deepEqual(asUrlList('https://a.com'), ['https://a.com']);
  assert.deepEqual(asUrlList(['', null, 7]), []);
  assert.deepEqual(asUrlList(undefined), []);
});

test('storySlug gives the nightly story a stable, dated identity of its own', () => {
  const slug = storySlug('The board fired Sam Altman on a Friday', new Date('2026-09-21T05:00:00Z'));
  assert.equal(slug, '2026-09-21-the-board-fired-sam-altman-on-a-friday');
});

// ── Jev plumbing ─────────────────────────────────────────────────────────────

test('mergeSets combines the ingest screen and the injection check into one call', () => {
  const merged = mergeSets(INGEST_FILTER, PLANTED_INSTRUCTION);
  assert.deepEqual(Object.keys(merged.questions).sort(), [
    'junk',
    'nonEnglish',
    'offTopic',
    'plantedInstruction',
  ]);
  assert.deepEqual(merged.sets.map((set) => set.version), [
    'ingest-filter-v1',
    'planted-v1',
  ]);
});

test('mergeSets refuses to silently drop a question when keys collide', () => {
  assert.throws(() => mergeSets(INGEST_FILTER, INGEST_FILTER), /appears in both/);
});

test('every question set carries an explicit version for the registry', () => {
  for (const set of [INGEST_FILTER, PLANTED_INSTRUCTION]) {
    assert.ok(set.version.length > 0, `${set.id} has no version`);
    assert.ok(Object.keys(set.questions).length > 0, `${set.id} has no questions`);
  }
});

test('excerpt keeps Jev state inside its budget and prefers a sentence boundary', () => {
  const text = `${'Sentence one. '.repeat(200)}`;
  const trimmed = excerpt(text, 100);
  assert.ok(trimmed.length <= 101, `got ${trimmed.length}`);
  assert.match(trimmed, /\.\u2026$|\. $|\.$|\u2026$/);
});

test('excerpt leaves short text untouched', () => {
  assert.equal(excerpt('Short body.', 100), 'Short body.');
});
