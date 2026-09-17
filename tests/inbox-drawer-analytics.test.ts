/**
 * Inbox drawer analytics helpers — campaign rates, warmup window, connection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignRates,
  connectionFromAccount,
  warmupWindowFromStats,
} from '@/lib/inboxes/drawer-analytics';

test('campaign rates are null when nothing was sent', () => {
  const empty = campaignRates({
    sent: 0, bounced: 0, opened: 0, clicked: 0, replied: 0, complained: 0,
  });
  assert.equal(empty.bounce_rate, null);
  assert.equal(empty.open_rate, null);
  assert.equal(empty.sent, 0);
});

test('campaign rates divide by sent, never by a fake zero window', () => {
  const rates = campaignRates({
    sent: 10, bounced: 1, opened: 4, clicked: 2, replied: 1, complained: 0,
  });
  assert.equal(rates.bounce_rate, 0.1);
  assert.equal(rates.open_rate, 0.4);
  assert.equal(rates.complaint_rate, 0);
});

test('warmup window derives inbox from sent minus save-from-spam', () => {
  const window = warmupWindowFromStats([
    { sent_count: 2, reply_count: 1, save_from_spam_count: 0 },
    { sent_count: 3, reply_count: 0, save_from_spam_count: 1 },
  ]);
  assert.equal(window.sent, 5);
  assert.equal(window.spam, 1);
  assert.equal(window.inbox, 4);
  assert.equal(window.replies, 1);
  assert.equal(window.inbox_rate, 0.8);
});

test('warmup window with no sends has null rates', () => {
  const window = warmupWindowFromStats([{ sent_count: 0, reply_count: 0, save_from_spam_count: 0 }]);
  assert.equal(window.inbox_rate, null);
  assert.equal(window.spam_rate, null);
});

test('connection is unhealthy when SMTP or IMAP failed or the account is suspended', () => {
  assert.equal(connectionFromAccount({ is_smtp_success: true, is_imap_success: true }, 'ok').healthy, true);
  assert.equal(connectionFromAccount({ is_smtp_success: false, smtp_failure_error: 'auth' }, 'ok').healthy, false);
  assert.equal(connectionFromAccount({ is_suspended: true }, 'ok').healthy, false);
});
