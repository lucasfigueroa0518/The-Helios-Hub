/**
 * Inbox drawer analytics helpers — campaign rates, warmup window, connection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignRates,
  connectionFromAccount,
  warmupPerformance,
  warmupWindowFromStats,
} from '@/lib/inboxes/drawer-analytics';
import { ingestedFromStats } from '@/lib/inboxes/warmup-sync';
import type { SmartleadWarmupStats } from '@/lib/smartlead/types';

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
    { date: '2026-09-20', sent_count: 2, reply_count: 1, save_from_spam_count: 0 },
    { date: '2026-09-21', sent_count: 3, reply_count: 0, save_from_spam_count: 1 },
  ], { until: '2026-09-21' });
  assert.equal(window.sent, 5);
  assert.equal(window.spam, 1);
  assert.equal(window.inbox, 4);
  assert.equal(window.replies, 1);
  assert.equal(window.inbox_rate, 0.8);
  assert.equal(window.by_date.length, 2);
});

test('warmup window with no sends has null rates', () => {
  const window = warmupWindowFromStats([
    { date: '2026-09-21', sent_count: 0, reply_count: 0, save_from_spam_count: 0 },
  ], { until: '2026-09-21' });
  assert.equal(window.inbox_rate, null);
  assert.equal(window.spam_rate, null);
});

test('warmup window keeps the last 7 calendar days and coerces string counts', () => {
  const rows = [
    { date: '2026-09-14', sent_count: '3', reply_count: '1', save_from_spam_count: '0' },
    { date: '2026-09-15T00:00:00.000Z', sent_count: 10, reply_count: 2, save_from_spam_count: 0 },
    { date: '2026-09-21', sent_count: '20', reply_count: '5', save_from_spam_count: '1' },
  ];
  const window = warmupWindowFromStats(rows, { until: '2026-09-21', days: 7, received: 24 });
  assert.equal(window.sent, 30);
  assert.equal(window.replies, 7);
  assert.equal(window.spam, 1);
  assert.equal(window.inbox, 29);
  assert.equal(window.received, 24);
  assert.deepEqual(window.by_date.map((row) => row.date), ['2026-09-15', '2026-09-21']);
});

test('warmup performance Super is 98%+ inbox placement', () => {
  assert.equal(warmupPerformance(1, 97).label, 'Super');
  assert.equal(warmupPerformance(0.93, 97).label, 'Strong');
  assert.equal(warmupPerformance(0.85, 97).label, 'Watch');
  assert.equal(warmupPerformance(0.5, 97).label, 'Needs work');
  assert.equal(warmupPerformance(null, 0).tone, 'unknown');
});

test('ingested stats map lifetime received onto the 7-day window', () => {
  const stats: SmartleadWarmupStats = {
    id: 1,
    sent_count: '100',
    spam_count: '0',
    warmup_email_received_count: '30',
    inbox_count: '100',
    stats_by_date: [
      { id: 1, date: '2026-09-20', sent_count: 25, reply_count: 8, save_from_spam_count: 0 },
      { id: 2, date: '2026-09-21', sent_count: 23, reply_count: 5, save_from_spam_count: 0 },
    ],
  };
  const ingested = ingestedFromStats(stats, '2026-09-21');
  assert.equal(ingested.lifetime.received, 30);
  assert.equal(ingested.window.sent, 48);
  assert.equal(ingested.window.received, 30);
  assert.equal(ingested.byDate['2026-09-21'], 23);
});

test('connection is unhealthy when SMTP or IMAP failed or the account is suspended', () => {
  assert.equal(connectionFromAccount({ is_smtp_success: true, is_imap_success: true }, 'ok').healthy, true);
  assert.equal(connectionFromAccount({ is_smtp_success: false, smtp_failure_error: 'auth' }, 'ok').healthy, false);
  assert.equal(connectionFromAccount({ is_suspended: true }, 'ok').healthy, false);
});
