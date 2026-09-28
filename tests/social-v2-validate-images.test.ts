import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  rewriteBriefSources,
  rewriteBriefWithValidatedImages,
  validateBriefImages,
} from '@/lib/social/editorial/v2/validate-images';
import { parseBrief } from '@/lib/social/editorial/v2/parse';

/**
 * The credit-name heuristic runs synchronously — no network. Tests it
 * against the failure modes the second live Bloomberg run surfaced
 * (credit strings that were really instructions to the reporter).
 *
 * Image-link HEAD requests are mocked by monkey-patching global fetch;
 * only one test exercises the network path.
 */

function briefWithOneImage(desc: string, credit: string, link: string) {
  return parseBrief(`SINGLE STORY: yes
THE NEWS: n
THE STORY: s
TERMS:
IMAGES:
IMAGE 1: ${desc}. Credit: ${credit}. Link: ${link}
SOURCES:
- Outlet, 2026-01-01, https://x.example.com`);
}

describe('validateBriefImages — credit heuristic (no network)', () => {
  test('drops "check the source" as instruction-like', async () => {
    const brief = briefWithOneImage('A picture', 'check the source', 'https://x.example.com/pic.jpg');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      assert.equal(r.valid.length, 0);
      assert.equal(r.dropped.length, 1);
      assert.match(r.dropped[0]!.reason, /instruction/);
    } finally { globalThis.fetch = savedFetch; }
  });

  test('drops "[TBD]" bracketed placeholder', async () => {
    const brief = briefWithOneImage('A picture', '[TBD]', 'https://x.example.com/pic.jpg');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      assert.equal(r.valid.length, 0);
      assert.match(r.dropped[0]!.reason, /bracketed placeholder|placeholder marker/);
    } finally { globalThis.fetch = savedFetch; }
  });

  test('drops empty / very short credit', async () => {
    const brief = briefWithOneImage('A picture', 'AP', 'https://x.example.com/pic.jpg');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      // "AP" is 2 chars → too short → dropped.
      assert.equal(r.valid.length, 0);
      assert.match(r.dropped[0]!.reason, /too short/);
    } finally { globalThis.fetch = savedFetch; }
  });

  test('keeps a legitimate press credit', async () => {
    const brief = briefWithOneImage('A picture', 'AP Photo', 'https://x.example.com/pic.jpg');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      assert.equal(r.valid.length, 1);
      assert.equal(r.dropped.length, 0);
    } finally { globalThis.fetch = savedFetch; }
  });
});

describe('validateBriefImages — content-type check (mocked fetch)', () => {
  test('drops link whose HEAD returns text/html', async () => {
    const brief = briefWithOneImage('A picture', 'AP Photo', 'https://x.example.com/not-an-image.html');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      assert.equal(r.valid.length, 0);
      assert.equal(r.dropped.length, 1);
      assert.match(r.dropped[0]!.reason, /content-type/);
    } finally { globalThis.fetch = savedFetch; }
  });

  test('drops link whose HEAD returns non-2xx', async () => {
    const brief = briefWithOneImage('A picture', 'AP Photo', 'https://x.example.com/404.jpg');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, {
      status: 404,
      headers: {},
    })) as typeof fetch;
    try {
      const r = await validateBriefImages(brief);
      assert.equal(r.valid.length, 0);
      assert.match(r.dropped[0]!.reason, /404/);
    } finally { globalThis.fetch = savedFetch; }
  });
});

describe('rewriteBriefWithValidatedImages', () => {
  const briefRaw = `SINGLE STORY: yes
THE NEWS: n
THE STORY: s
TERMS:
IMAGES:
IMAGE 1: A. Credit: AP Photo. Link: https://x.example.com/a.jpg
IMAGE 2: B. Credit: [TBD]. Link: https://x.example.com/b.jpg
SOURCES:
- Outlet, 2026-01-01, https://x.example.com`;

  test('replaces IMAGES section with only valid images, preserving numbers', () => {
    const validOnly = parseBrief(briefRaw).images.filter((i) => i.number === 1);
    const rewritten = rewriteBriefWithValidatedImages(briefRaw, validOnly);
    assert.match(rewritten, /IMAGE 1: A/);
    assert.doesNotMatch(rewritten, /IMAGE 2: B/);
    assert.doesNotMatch(rewritten, /\[TBD\]/);
    // SOURCES section must still be present untouched.
    assert.match(rewritten, /SOURCES:\n- Outlet/);
  });

  test('replaces IMAGES section with "None found" when nothing survives', () => {
    const rewritten = rewriteBriefWithValidatedImages(briefRaw, []);
    assert.match(rewritten, /IMAGES:\nNone found/);
    assert.doesNotMatch(rewritten, /IMAGE 1/);
  });
});

describe('rewriteBriefSources', () => {
  const briefRaw = `SINGLE STORY: yes
THE NEWS: n
THE STORY: s
TERMS:
IMAGES: None found
SOURCES:
1. Bloomberg, 2026-09-17, https://bloomberg.example.com/x
2. Betanews, 2026-09-18, https://betanews.example.com/y
3. Shattered.io, 2026-09-18, https://shattered.example.com/z`;

  test('replaces SOURCES section with only the kept outlets', () => {
    const kept = [
      { outlet: 'Bloomberg', publishedAt: '2026-09-17', url: 'https://bloomberg.example.com/x' },
      { outlet: 'Shattered.io', publishedAt: '2026-09-18', url: 'https://shattered.example.com/z' },
    ];
    const rewritten = rewriteBriefSources(briefRaw, kept);
    assert.match(rewritten, /SOURCES:\n1\. Bloomberg, 2026-09-17, https:\/\/bloomberg\.example\.com\/x\n2\. Shattered\.io, 2026-09-18, https:\/\/shattered\.example\.com\/z/);
    // Betanews was filtered out — must not appear.
    assert.doesNotMatch(rewritten, /Betanews/);
    // Sections above SOURCES stay untouched.
    assert.match(rewritten, /SINGLE STORY: yes/);
    assert.match(rewritten, /IMAGES: None found/);
  });

  test('renders a placeholder line when NOTHING is substantive', () => {
    const rewritten = rewriteBriefSources(briefRaw, []);
    assert.match(rewritten, /SOURCES:\n\(none — every source fetched was a preview under the threshold\)/);
    assert.doesNotMatch(rewritten, /Bloomberg/);
    assert.doesNotMatch(rewritten, /Betanews/);
    assert.doesNotMatch(rewritten, /Shattered/);
  });

  test('preserves outlet order from the kept array (renumbers)', () => {
    const kept = [
      { outlet: 'Shattered.io', publishedAt: '2026-09-18', url: 'https://shattered.example.com/z' },
      { outlet: 'Bloomberg', publishedAt: '2026-09-17', url: 'https://bloomberg.example.com/x' },
    ];
    const rewritten = rewriteBriefSources(briefRaw, kept);
    // Shattered.io comes first (index 1), Bloomberg second (index 2).
    const shatteredIdx = rewritten.indexOf('1. Shattered.io');
    const bloombergIdx = rewritten.indexOf('2. Bloomberg');
    assert.ok(shatteredIdx > 0 && bloombergIdx > shatteredIdx);
  });
});
