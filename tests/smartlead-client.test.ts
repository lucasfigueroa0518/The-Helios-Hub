/**
 * S2 acceptance — client, adapter, body sanitizer, kill switch.
 * Offline: `fetch` is stubbed; nothing leaves the process.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import {
  SmartleadError,
  SmartleadRateLimitError,
  SmartleadRequestError,
  SmartleadServerError,
  redactApiKey,
  smartleadPaginate,
  smartleadRequest,
  truncateBody,
} from '@/lib/smartlead/client';
import { SmartleadDisabledError, SmartleadUnconfiguredError, isSmartleadEnabled } from '@/lib/smartlead/enabled';
import {
  CustomFieldTooLongError,
  MAX_CUSTOM_FIELD_CHARS,
  assertCustomFieldLength,
  hasBlockedMarkup,
  textToCustomBodyHtml,
  toCustomBodyHtml,
} from '@/lib/smartlead/body';
import {
  chunk,
  extractLeadIds,
  handoffLeads,
  listEmailAccounts,
  registerWebhook,
  setStatus,
  setWarmup,
} from '@/lib/smartlead/adapter';
import { SMARTLEAD_MAX_LEADS_PER_REQUEST } from '@/lib/smartlead/types';

const TEST_KEY = 'sl-live-abcdef0123456789';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let realFetch: typeof globalThis.fetch;

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  process.env.SMARTLEAD_API_KEY = TEST_KEY;
  process.env.SMARTLEAD_ENABLED = 'true';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SMARTLEAD_ENABLED;
  delete process.env.SMARTLEAD_API_KEY;
});

// ── Secret hygiene ──────────────────────────────────────────────────────────

test('redactApiKey removes the key from a URL and from a bare occurrence', () => {
  assert.equal(
    redactApiKey(`https://server.smartlead.ai/api/v1/campaigns/?api_key=${TEST_KEY}&limit=5`),
    'https://server.smartlead.ai/api/v1/campaigns/?api_key=[redacted]&limit=5',
  );
  assert.equal(redactApiKey(`leaked ${TEST_KEY} inline`), 'leaked [redacted] inline');
  assert.equal(truncateBody('x'.repeat(600)).length, 501);
});

test('no thrown error carries the API key, for any status class', async () => {
  const cases: Array<[ResponseInit, new (...args: never[]) => SmartleadError]> = [
    [{ status: 429, headers: { 'retry-after': '30' } }, SmartleadRateLimitError],
    [{ status: 503 }, SmartleadServerError],
    [{ status: 400 }, SmartleadRequestError],
  ];

  for (const [init, kind] of cases) {
    stubFetch(() => new Response(`boom ${TEST_KEY}`, init));
    const error = await smartleadRequest('/campaigns/').catch((caught: unknown) => caught);
    assert.ok(error instanceof kind, `expected ${kind.name}`);

    const serialized = `${error.message} ${error.url} ${error.body} ${error.stack ?? ''}`;
    assert.ok(!serialized.includes(TEST_KEY), 'error text leaked the API key');
    // The error URL is built before the key is attached, so there is nothing to
    // redact; if that ever changes, it must come through redacted.
    assert.doesNotMatch(error.url, /api_key=(?!\[redacted\])./);
    assert.match(error.body, /\[redacted\]/);
  }
});

test('the key is attached only to the outgoing request, never to the error url', async () => {
  stubFetch(() => new Response('nope', { status: 404 }));
  const error = await smartleadRequest('/campaigns/999').catch((caught: unknown) => caught);
  assert.ok(calls[0].url.includes(`api_key=${TEST_KEY}`), 'the real request must be authenticated');
  assert.ok(error instanceof SmartleadError);
  assert.ok(!error.url.includes(TEST_KEY));
});

// ── Error mapping ───────────────────────────────────────────────────────────

test('429 becomes SmartleadRateLimitError carrying Retry-After in milliseconds', async () => {
  stubFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }));
  const error = await smartleadRequest('/campaigns/').catch((caught: unknown) => caught);
  assert.ok(error instanceof SmartleadRateLimitError);
  assert.equal(error.retryAfterMs, 30_000);
});

test('a 429 with no Retry-After reports 0 so the caller applies its own backoff', async () => {
  stubFetch(() => new Response('slow down', { status: 429 }));
  const error = await smartleadRequest('/campaigns/').catch((caught: unknown) => caught);
  assert.equal((error as SmartleadRateLimitError).retryAfterMs, 0);
});

test('a transport failure maps to SmartleadServerError with a null status', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof globalThis.fetch;
  const error = await smartleadRequest('/campaigns/').catch((caught: unknown) => caught);
  assert.ok(error instanceof SmartleadServerError);
  assert.equal(error.status, null);
});

test('unparseable JSON is a server error, not a crash', async () => {
  stubFetch(() => new Response('<html>maintenance</html>', { status: 200 }));
  const error = await smartleadRequest('/campaigns/').catch((caught: unknown) => caught);
  assert.ok(error instanceof SmartleadServerError);
  assert.match(error.body, /unparseable JSON/);
});

test('an empty 200 body is an empty object, not a parse failure', async () => {
  stubFetch(() => new Response('', { status: 200 }));
  assert.deepEqual(await smartleadRequest('/campaigns/'), {});
});

// ── Pagination ──────────────────────────────────────────────────────────────

test('pagination walks offsets until a short page arrives', async () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
  stubFetch(({ url }) => json(new URL(url).searchParams.get('offset') === '0' ? page(100) : page(7)));

  const all = await smartleadPaginate('/email-accounts/', { limit: 100 });
  assert.equal(all.length, 107);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get('offset'), '100');
});

test('pagination unwraps a {data:[...]} envelope', async () => {
  stubFetch(() => json({ data: [{ id: 1 }, { id: 2 }] }));
  assert.equal((await smartleadPaginate('/campaigns/x/leads', { limit: 100 })).length, 2);
});

test('pagination stops at maxPages so a broken endpoint cannot loop forever', async () => {
  stubFetch(() => json(Array.from({ length: 10 }, (_, i) => ({ id: i }))));
  const all = await smartleadPaginate('/email-accounts/', { limit: 10, maxPages: 3 });
  assert.equal(all.length, 30);
  assert.equal(calls.length, 3);
});

// ── Kill switch ─────────────────────────────────────────────────────────────

test('SMARTLEAD_ENABLED unset blocks campaign sending, not account listing', async () => {
  delete process.env.SMARTLEAD_ENABLED;
  stubFetch(() => json([]));

  assert.equal(isSmartleadEnabled(), false);
  await listEmailAccounts();
  assert.equal(calls.length, 1, 'account listing may run with an API key while sending is off');
  await assert.rejects(setStatus(1, 'START'), SmartleadDisabledError);
  await assert.rejects(handoffLeads(1, [{ email: 'a@b.co' }]), SmartleadDisabledError);
  assert.equal(calls.length, 1, 'a disabled send path must not touch the network');
});

test('account ops refuse when there is no API key', async () => {
  delete process.env.SMARTLEAD_API_KEY;
  stubFetch(() => json([]));
  await assert.rejects(listEmailAccounts(), SmartleadUnconfiguredError);
  assert.equal(calls.length, 0);
});

test('setWarmup raises daily_rampup to Smartlead\'s minimum of 5', async () => {
  stubFetch(() => json({ ok: true }));
  await setWarmup(9, {
    warmup_enabled: true,
    total_warmup_per_day: 30,
    daily_rampup: 2,
    reply_rate_percentage: 32,
  });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.daily_rampup, 5);
  assert.equal(body.is_rampup_enabled, true);
});

test('only the exact string "true" enables Smartlead', () => {
  for (const value of ['false', '1', 'yes', 'TRUE ', '']) {
    process.env.SMARTLEAD_ENABLED = value;
    assert.equal(isSmartleadEnabled(), value.trim().toLowerCase() === 'true', `value ${value}`);
  }
});

// ── Adapter payloads ────────────────────────────────────────────────────────

test('handoffLeads refuses a batch above the 400-lead ceiling', async () => {
  stubFetch(() => json({ ok: true }));
  const leads = Array.from({ length: SMARTLEAD_MAX_LEADS_PER_REQUEST + 1 }, (_, i) => ({
    email: `lead${i}@example.com`,
  }));
  await assert.rejects(handoffLeads(1, leads), /at most 400/);
  assert.equal(calls.length, 0);
});

test('chunk splits exactly at the batch ceiling', () => {
  const items = Array.from({ length: 850 }, (_, i) => i);
  const chunks = chunk(items, SMARTLEAD_MAX_LEADS_PER_REQUEST);
  assert.deepEqual(chunks.map((c) => c.length), [400, 400, 50]);
});

test('handoffLeads sends the suppression-respecting defaults and asks for lead ids', async () => {
  stubFetch(() => json({ ok: true, added_count: 1 }));
  await handoffLeads(77, [{ email: 'lead@example.com', first_name: 'Lee' }]);

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].url, /\/campaigns\/77\/leads/);
  assert.deepEqual(body.settings, {
    ignore_global_block_list: false,
    ignore_unsubscribe_list: false,
    ignore_duplicate_leads_in_other_campaign: false,
    return_lead_ids: true,
  });
});

test('lead ids are read from either echo shape, and their absence is not an error', () => {
  assert.deepEqual([...extractLeadIds({ lead_ids: [{ id: 5, email: 'A@B.co' }] })], [['a@b.co', 5]]);
  assert.deepEqual([...extractLeadIds({ leads: [{ lead_id: 9, email: 'x@y.co' }] })], [['x@y.co', 9]]);
  assert.deepEqual([...extractLeadIds({ added_count: 3 })], []);
});

test('campaign activation sends START, which is what Smartlead accepts', async () => {
  stubFetch(() => json({ ok: true }));
  await setStatus(42, 'START');
  assert.equal(JSON.parse(String(calls[0].init.body)).status, 'START');
  assert.match(calls[0].url, /\/campaigns\/42\/status/);
});

test('webhook registration targets the campaign-scoped endpoint', async () => {
  stubFetch(() => json({ id: 1 }));
  await registerWebhook(42, {
    name: 'hub',
    webhookUrl: 'https://hub.example.com/api/webhooks/smartlead/tok',
    events: ['EMAIL_SENT', 'EMAIL_REPLIED'],
  });
  assert.match(calls[0].url, /\/campaigns\/42\/webhooks/);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.id, null);
  assert.deepEqual(body.event_types, ['EMAIL_SENT', 'EMAIL_REPLIED']);
});

// ── Body sanitizer ──────────────────────────────────────────────────────────

test('the sanitizer strips images, cid: references, styles and scripts', () => {
  const html = toCustomBodyHtml(
    `<p style="color:red" class="x">Hi Dana,</p>` +
      `<img src="cid:headshot123" alt="me">` +
      `<script>alert(1)</script>` +
      `<style>.a{}</style>` +
      `<p>Worth a look?</p>`,
  );
  assert.equal(html, '<p>Hi Dana,</p><p>Worth a look?</p>');
  assert.equal(hasBlockedMarkup(html), false);
});

test('step 1 drops links but keeps their text; follow-ups keep the link', () => {
  const input = '<p>Grab a slot <a href="https://cal.com/helios">here</a>.</p>';
  assert.equal(toCustomBodyHtml(input), '<p>Grab a slot here.</p>');
  assert.equal(
    toCustomBodyHtml(input, { allowLinks: true }),
    '<p>Grab a slot <a href="https://cal.com/helios">here</a>.</p>',
  );
});

test('a link that is not absolute http(s) never survives, even on follow-ups', () => {
  for (const href of ['javascript:alert(1)', 'cid:img', '/relative', 'mailto:a@b.co']) {
    const html = toCustomBodyHtml(`<p><a href="${href}">click</a></p>`, { allowLinks: true });
    assert.equal(html, '<p>click</p>', `href ${href} should have been dropped`);
  }
});

test('an href containing markup cannot smuggle a link or a scheme through', () => {
  // Deliberately malformed: the href value itself contains a tag.
  const html = toCustomBodyHtml('<p><a href="data:text/html,<b>x">click</a></p>', {
    allowLinks: true,
  });
  assert.doesNotMatch(html, /<a\b/, 'no anchor may survive');
  assert.doesNotMatch(html, /data:/, 'no data: URL may survive');
  assert.equal(hasBlockedMarkup(html), false);
});

test('unknown block elements become separate well-formed paragraphs', () => {
  assert.equal(
    toCustomBodyHtml('<div>First thought.</div><div>Second thought.</div>'),
    '<p>First thought.</p><p>Second thought.</p>',
  );
  assert.equal(toCustomBodyHtml('<ul><li>One</li><li>Two</li></ul>'), '<p>One</p><p>Two</p>');
});

test('output is always balanced: every <p> and <a> closes', () => {
  for (const input of [
    '<p>unclosed paragraph',
    '<a href="https://x.co">unclosed link',
    '<div><p>nested</div>',
    'bare text',
  ]) {
    const html = toCustomBodyHtml(input, { allowLinks: true });
    assert.equal(
      (html.match(/<p>/g) ?? []).length,
      (html.match(/<\/p>/g) ?? []).length,
      `unbalanced <p> for input: ${input}`,
    );
    assert.equal(
      (html.match(/<a\b/g) ?? []).length,
      (html.match(/<\/a>/g) ?? []).length,
      `unbalanced <a> for input: ${input}`,
    );
  }
});

test('text drafts convert blank lines to paragraphs and single newlines to breaks', () => {
  assert.equal(
    textToCustomBodyHtml('Hi Dana,\nQuick question.\n\nWorth a look?'),
    '<p>Hi Dana,<br>Quick question.</p><p>Worth a look?</p>',
  );
});

test('HTML in draft text is escaped rather than executed', () => {
  assert.equal(textToCustomBodyHtml('5 < 6 & <b>bold</b>'), '<p>5 &lt; 6 &amp; &lt;b&gt;bold&lt;/b&gt;</p>');
});

test('custom field length is a hard stop, not a silent truncation', () => {
  assert.doesNotThrow(() => assertCustomFieldLength('custom_body', 'x'.repeat(MAX_CUSTOM_FIELD_CHARS)));
  assert.throws(
    () => assertCustomFieldLength('custom_body', 'x'.repeat(MAX_CUSTOM_FIELD_CHARS + 1)),
    CustomFieldTooLongError,
  );
});
