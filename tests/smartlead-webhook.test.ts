/**
 * S5 acceptance — webhook authentication, normalization and dedupe.
 * Offline: pure functions only; `applySmartleadEvent` needs a database and is
 * exercised by the S4/S6 fixture-database tests.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { afterEach, beforeEach } from 'node:test';

import {
  MAX_WEBHOOK_BODY_BYTES,
  alreadyProcessed,
  ipAllowed,
  isDoNotContact,
  isOutOfOfficeCategory,
  nextProcessed,
  normalizeSmartleadEvent,
  verifySmartleadSignature,
  verifyWebhookPathToken,
  webhookIds,
} from '@/lib/smartlead/webhook';
import { autoReplySkipReason } from '@/lib/drafting/reply-inbound';
import { REPLY_AUTO_DELAY_MS } from '@/lib/drafting/reply-constants';
import { SMARTLEAD_EVENT_ALIASES } from '@/lib/smartlead/types';

const TOKEN = 'a'.repeat(64);

beforeEach(() => {
  process.env.SMARTLEAD_WEBHOOK_PATH_TOKEN = TOKEN;
  process.env.SMARTLEAD_WEBHOOK_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.SMARTLEAD_WEBHOOK_PATH_TOKEN;
  delete process.env.SMARTLEAD_WEBHOOK_SECRET;
});

// ── Authentication ──────────────────────────────────────────────────────────

test('the path token must match exactly', () => {
  assert.equal(verifyWebhookPathToken(TOKEN), true);
  assert.equal(verifyWebhookPathToken(`${TOKEN}x`), false);
  assert.equal(verifyWebhookPathToken(TOKEN.slice(0, -1)), false);
  assert.equal(verifyWebhookPathToken('b'.repeat(64)), false);
  assert.equal(verifyWebhookPathToken(''), false);
});

test('with no token configured, nothing authenticates', () => {
  delete process.env.SMARTLEAD_WEBHOOK_PATH_TOKEN;
  assert.equal(verifyWebhookPathToken(TOKEN), false);
  assert.equal(verifyWebhookPathToken(''), false);
});

test('HMAC verification accepts a correct signature and rejects everything else', () => {
  const body = '{"event":"EMAIL_SENT"}';
  const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');

  assert.equal(verifySmartleadSignature(body, signature), true);
  assert.equal(verifySmartleadSignature(body, `sha256=${signature}`), true);
  assert.equal(verifySmartleadSignature(body, signature.replace(/.$/, '0')), false);
  assert.equal(verifySmartleadSignature(`${body} `, signature), false);
  assert.equal(verifySmartleadSignature(body, null), false);
  assert.equal(verifySmartleadSignature(body, 'not-hex'), false);
});

test('an empty allow list permits any source; a populated one does not', () => {
  assert.equal(ipAllowed(null, []), true);
  assert.equal(ipAllowed('1.2.3.4', []), true);
  assert.equal(ipAllowed('1.2.3.4', ['1.2.3.4']), true);
  assert.equal(ipAllowed('1.2.3.5', ['1.2.3.4']), false);
  assert.equal(ipAllowed(null, ['1.2.3.4']), false);
});

test('the body cap is large enough for a real reply and small enough to bound memory', () => {
  assert.equal(MAX_WEBHOOK_BODY_BYTES, 262_144);
});

// ── Normalization ───────────────────────────────────────────────────────────

const base = {
  campaign_id: 3948549,
  lead_id: 789,
  email_account_id: 23268451,
  sequence_number: 1,
  timestamp: '2026-09-16T10:30:00Z',
  lead: { email: 'Dana@Example.com' },
};

test('every documented event spelling maps to one canonical hub event', () => {
  const byCanonical = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(SMARTLEAD_EVENT_ALIASES)) {
    byCanonical.set(canonical, [...(byCanonical.get(canonical) ?? []), alias]);
  }
  // Smartlead's two APIs disagree on these names; both must land in one place.
  for (const [alias, canonical] of [
    ['EMAIL_REPLY', 'EMAIL_REPLIED'],
    ['LEAD_REPLIED', 'EMAIL_REPLIED'],
    ['EMAIL_LINK_CLICK', 'EMAIL_CLICKED'],
    ['LEAD_UNSUBSCRIBED', 'EMAIL_UNSUBSCRIBED'],
    ['EMAIL_BOUNCE', 'EMAIL_BOUNCED'],
    ['EMAIL_OPEN', 'EMAIL_OPENED'],
  ]) {
    assert.equal(normalizeSmartleadEvent({ ...base, event: alias })?.type, canonical, alias);
  }
});

test('either field name carries the event', () => {
  assert.equal(normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT' })?.type, 'EMAIL_SENT');
  assert.equal(normalizeSmartleadEvent({ ...base, event_type: 'EMAIL_SENT' })?.type, 'EMAIL_SENT');
});

test('an unknown event or a missing campaign id normalizes to null, not a throw', () => {
  assert.equal(normalizeSmartleadEvent({ ...base, event: 'SOMETHING_NEW' }), null);
  assert.equal(normalizeSmartleadEvent({ event: 'EMAIL_SENT' }), null);
  assert.equal(normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', campaign_id: 0 }), null);
});

test('lead email is lower-cased and the sequence number defaults to 1', () => {
  const event = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', sequence_number: undefined });
  assert.equal(event?.leadEmail, 'dana@example.com');
  assert.equal(event?.sequenceNumber, 1);
});

test('a string sequence number is coerced, and zero is floored to 1', () => {
  assert.equal(normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', sequence_number: '3' })?.sequenceNumber, 3);
  assert.equal(normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', sequence_number: 0 })?.sequenceNumber, 1);
});

test('the event id is stable per logical event and differs across steps', () => {
  const a = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT' })!;
  const b = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT' })!;
  const step2 = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', sequence_number: 2 })!;
  const opened = normalizeSmartleadEvent({ ...base, event: 'EMAIL_OPEN' })!;

  assert.equal(a.eventId, b.eventId, 'a replayed event must dedupe');
  assert.notEqual(a.eventId, step2.eventId);
  assert.notEqual(a.eventId, opened.eventId);
});

test('an explicit event_id wins over the content hash', () => {
  const event = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', event_id: 'sl-123' });
  assert.equal(event?.eventId, 'sl-123');
});

test('a missing or unparseable timestamp falls back to now rather than NaN', () => {
  for (const timestamp of [undefined, 'not-a-date']) {
    const event = normalizeSmartleadEvent({ ...base, event: 'EMAIL_SENT', timestamp });
    assert.ok(Number.isFinite(Date.parse(event!.eventAt)));
  }
});

test('hub ids planted at handoff survive the round trip', () => {
  const event = normalizeSmartleadEvent({
    ...base,
    event: 'EMAIL_SENT',
    lead: {
      email: 'dana@example.com',
      custom_fields: { hub_queue_id: 'queue-1', hub_item_id: 'item-1' },
    },
  });
  assert.equal(event?.hubQueueId, 'queue-1');
  assert.equal(event?.hubItemId, 'item-1');
});

test('reply payloads carry subject, body and the message id used for threading', () => {
  const reply = {
    subject: 'Re: Quick question',
    body: 'Interested — send times.',
    message_id: 'reply-abc',
    received_at: '2026-09-16T11:00:00Z',
  };
  const event = normalizeSmartleadEvent({ ...base, event: 'EMAIL_REPLY', reply });
  assert.equal(event?.reply?.messageId, 'reply-abc');
  assert.equal(event?.reply?.body, 'Interested — send times.');
  // The envelope timestamp is the event time; received_at only fills a gap.
  assert.equal(event?.eventAt, '2026-09-16T10:30:00.000Z');

  const noEnvelope = normalizeSmartleadEvent({
    ...base,
    event: 'EMAIL_REPLY',
    timestamp: undefined,
    reply,
  });
  assert.equal(noEnvelope?.eventAt, '2026-09-16T11:00:00.000Z');
});

test('lead category arrives as either a string or an object', () => {
  assert.equal(
    normalizeSmartleadEvent({ ...base, event: 'LEAD_CATEGORY_UPDATED', lead_category: 'Interested' })?.leadCategory,
    'Interested',
  );
  assert.equal(
    normalizeSmartleadEvent({
      ...base,
      event: 'LEAD_CATEGORY_UPDATED',
      lead_category: { id: 5, name: 'Do Not Contact' },
    })?.leadCategory,
    'Do Not Contact',
  );
});

test('do-not-contact and out-of-office categories are recognised across spellings', () => {
  for (const value of ['Do Not Contact', 'do not contact', 'DNC', 'Blocked']) {
    assert.equal(isDoNotContact(value), true, value);
  }
  assert.equal(isDoNotContact('Interested'), false);
  assert.equal(isDoNotContact(null), false);

  for (const value of ['Out of Office', 'OOO', 'On vacation']) {
    assert.equal(isOutOfOfficeCategory(value), true, value);
  }
  assert.equal(isOutOfOfficeCategory('Interested'), false);
});

// ── Dedupe ──────────────────────────────────────────────────────────────────

test('processed event ids round-trip and cap at fifty', () => {
  assert.deepEqual(webhookIds(null), []);
  assert.deepEqual(webhookIds(['a', 1, '', 'b']), ['a', 'b']);

  assert.equal(alreadyProcessed(['a'], 'a'), true);
  assert.equal(alreadyProcessed(['a'], 'b'), false);
  assert.equal(alreadyProcessed(['a'], null), false, 'a null id can never be a duplicate');

  assert.deepEqual(JSON.parse(nextProcessed(['a'], 'b')), ['a', 'b']);
  assert.deepEqual(JSON.parse(nextProcessed(['a'], 'a')), ['a'], 'no duplicate entries');

  const many = Array.from({ length: 60 }, (_, i) => `e${i}`);
  const trimmed = JSON.parse(nextProcessed(many, 'new')) as string[];
  assert.equal(trimmed.length, 50);
  assert.equal(trimmed.at(-1), 'new', 'the newest id is always retained');
});

// ── Reply window ────────────────────────────────────────────────────────────

test('the human window is five minutes', () => {
  assert.equal(REPLY_AUTO_DELAY_MS, 300_000);
});

test('out-of-office replies get no fallback', () => {
  const cases = [
    'Out of Office: Re: Quick question',
    'Automatic reply: Re: Quick question',
    'OOO until Monday',
    'Auto-Reply: away from the office',
    'I am on vacation',
  ];
  for (const subject of cases) {
    assert.equal(autoReplySkipReason({ subject }, 'dana@example.com'), 'out_of_office', subject);
  }
  assert.equal(
    autoReplySkipReason({ 'auto-submitted': 'auto-replied' }, 'dana@example.com'),
    'out_of_office',
  );
});

test('a genuine reply still gets one', () => {
  assert.equal(autoReplySkipReason({ subject: 'Re: Quick question' }, 'dana@example.com'), null);
  assert.equal(
    autoReplySkipReason({ subject: 'Interested in a call', 'auto-submitted': 'no' }, 'dana@example.com'),
    null,
  );
});

test('bounces and no-reply senders are still filtered ahead of out-of-office', () => {
  assert.equal(autoReplySkipReason({}, 'MAILER-DAEMON@example.com'), 'mailer_daemon');
  assert.equal(autoReplySkipReason({}, 'no-reply@example.com'), 'mailer_daemon');
  assert.equal(
    autoReplySkipReason({ subject: 'Undeliverable: Quick question' }, 'dana@example.com'),
    'bounce_subject',
  );
});
