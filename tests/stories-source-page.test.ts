/** Stories source-page reader: Readability first, plain body text for docs pages. Offline (stub fetch). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { gateExcerpt, readSourcePage } from '@/lib/stories/source-page';

const PARA = 'Embedding models turn text into vectors and this paragraph says so at some length. '.repeat(6);

test('readSourcePage: an article page reads through Readability (via article)', async () => {
  const html = `<html><head><title>T</title></head><body><article><h1>Headline</h1><p>${PARA}</p><p>${PARA}</p></article></body></html>`;
  const r = await readSourcePage('https://example.com/a', async () => html);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.via, 'article');
    assert.ok(r.text.includes('Embedding models turn text into vectors'));
  }
});

test('readSourcePage: a docs page with no article falls back to plain body text (via plain)', async () => {
  const html = `<html><body><nav>Docs Home</nav><script>var secret=1;</script><style>.x{color:red}</style>
    <table><tr><td>text-embedding-3-large</td><td>3072 dimensions</td></tr><tr><td>text-embedding-3-small</td><td>1536 dimensions</td></tr></table>
    <table><tr><td>text-embedding-ada-002</td><td>1536 dimensions</td></tr><tr><td>Model</td><td>Output dimensions</td></tr><tr><td>Max input</td><td>8191 tokens</td></tr><tr><td>Pricing</td><td>$0.13 per million input tokens for the large model, $0.02 for the small one</td></tr></table></body></html>`;
  const r = await readSourcePage('https://example.com/docs', async () => html);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.via, 'plain');
    assert.ok(r.text.includes('3072'));
    assert.ok(!r.text.includes('secret'));
    assert.ok(!r.text.includes('color:red'));
  }
});

test('readSourcePage: a failed fetch or a page under MIN_TEXT_CHARS is not ok', async () => {
  const a = await readSourcePage('https://example.com/x', async () => null);
  assert.deepEqual(a, { ok: false, url: 'https://example.com/x', error: 'fetch failed' });
  const b = await readSourcePage('https://example.com/y', async () => `<html><body>${'x'.repeat(50)}</body></html>`);
  assert.equal(b.ok, false);
});

test('gateExcerpt: centres on the figure however it is written', () => {
  const filler = (n: number) => 'lorem ipsum '.repeat(Math.ceil(n / 12)).slice(0, n);
  const text = filler(40_000) + '200 dollars a month' + filler(20_000);
  const ex = gateExcerpt(text, '$200/mo');
  assert.ok(ex.includes('200 dollars'));
  assert.ok(ex.length <= 24_000);

  const t2 = filler(40_000) + 'it has 3072 dimensions' + filler(20_000);
  assert.ok(gateExcerpt(t2, '3,072').includes('3072'));

  const t3 = filler(40_000) + 'it has 3,072 dimensions' + filler(20_000);
  assert.ok(gateExcerpt(t3, '3072').includes('3,072'));

  assert.equal(gateExcerpt('short text 5', '5'), 'short text 5');
  const t4 = filler(60_000);
  assert.equal(gateExcerpt(t4, 'no digits here'), t4.slice(0, 24_000));
  assert.equal(gateExcerpt(t4, '777'), t4.slice(0, 24_000));
});
