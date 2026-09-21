import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Offline tests for the og:image parser. We can't easily call
 * `extractArticleImage` here because it does live HTTP; instead we test the
 * regex/entity-decode logic against inline HTML fixtures via a lightweight
 * copy of the same patterns.
 *
 * If the parser in extract-image.ts changes, mirror the change here.
 */

function findMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

test('finds og:image with property/content order', () => {
  const html = '<meta property="og:image" content="https://cdn.example.com/hero.jpg">';
  assert.equal(findMetaContent(html, 'og:image'), 'https://cdn.example.com/hero.jpg');
});

test('finds og:image with content/property order (reversed attributes)', () => {
  const html = '<meta content="https://cdn.example.com/hero.jpg" property="og:image">';
  assert.equal(findMetaContent(html, 'og:image'), 'https://cdn.example.com/hero.jpg');
});

test('handles single-quoted attribute values', () => {
  const html = "<meta property='og:image' content='https://cdn.example.com/hero.jpg'>";
  assert.equal(findMetaContent(html, 'og:image'), 'https://cdn.example.com/hero.jpg');
});

test('decodes HTML entities in URL (query params with &amp;)', () => {
  const html = '<meta property="og:image" content="https://cdn.example.com/hero.jpg?w=1200&amp;h=630">';
  assert.equal(
    findMetaContent(html, 'og:image'),
    'https://cdn.example.com/hero.jpg?w=1200&h=630',
  );
});

test('finds twitter:image as fallback when og:image is absent', () => {
  const html = '<head><meta name="twitter:image" content="https://cdn.example.com/twcard.jpg"></head>';
  assert.equal(findMetaContent(html, 'og:image'), null);
  assert.equal(findMetaContent(html, 'twitter:image'), 'https://cdn.example.com/twcard.jpg');
});

test('returns null when no meta tag matches', () => {
  const html = '<html><head><title>No meta</title></head><body>Just content</body></html>';
  assert.equal(findMetaContent(html, 'og:image'), null);
});

test('picks first og:image when multiple are present (real publishers do this)', () => {
  const html = [
    '<meta property="og:image" content="https://cdn.example.com/main.jpg">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image" content="https://cdn.example.com/alt.jpg">',
  ].join('\n');
  assert.equal(findMetaContent(html, 'og:image'), 'https://cdn.example.com/main.jpg');
});

test('scope-anchored: does not match og:image inside a JSON string or non-meta tag', () => {
  const html = '<script type="application/ld+json">{"og:image":"https://fake.example.com/x.jpg"}</script>';
  assert.equal(findMetaContent(html, 'og:image'), null);
});
