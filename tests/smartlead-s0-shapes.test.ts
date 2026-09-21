/**
 * S0 acceptance — the hand-written types in lib/smartlead/types.ts must still
 * describe what the live account returned. If Smartlead changes a field, these
 * fail here rather than at 3am inside a webhook handler.
 *
 * Offline: reads tests/fixtures/smartlead/*.json only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  SMARTLEAD_MAX_LEADS_PER_REQUEST,
  normalizeWarmupDetails,
  toNumber,
  toReputationPercent,
  type SmartleadCampaign,
  type SmartleadCampaignAnalyticsByDate,
  type SmartleadCampaignLeadsPage,
  type SmartleadCampaignStatistics,
  type SmartleadEmailAccount,
  type SmartleadEmailAccountListItem,
  type SmartleadWarmupStats,
} from '@/lib/smartlead/types';

const FIXTURES = path.join('tests', 'fixtures', 'smartlead');

type Probe<T> = { name: string; status: number | string; ok: boolean; body: T };

function fixture<T>(name: string): Probe<T> {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Probe<T>;
}

function assertKeys(actual: object, required: string[], label: string) {
  for (const key of required) {
    assert.ok(key in actual, `${label} is missing verified-S0 field "${key}"`);
  }
}

test('email-accounts list carries every field the roster sync reads', () => {
  const probe = fixture<SmartleadEmailAccountListItem[]>('email-accounts');
  assert.equal(probe.status, 200);
  assert.ok(Array.isArray(probe.body) && probe.body.length > 0, 'expected at least one account');

  for (const account of probe.body) {
    assertKeys(
      account,
      [
        'id',
        'from_email',
        'from_name',
        'type',
        'message_per_day',
        'daily_sent_count',
        'is_smtp_success',
        'is_imap_success',
        'signature',
        'warmup_details',
      ],
      'email account',
    );
    assert.equal(typeof account.id, 'number');
    assert.equal(typeof account.from_email, 'string');
    assert.equal(typeof account.message_per_day, 'number');
  }
});

test('all Helios mailboxes are Microsoft OAuth accounts with no stored password', () => {
  const probe = fixture<SmartleadEmailAccountListItem[]>('email-accounts');
  for (const account of probe.body) {
    assert.equal(account.type, 'OUTLOOK', `${account.from_email} is not an OUTLOOK account`);
    assert.equal(account.password, null, `${account.from_email} unexpectedly has an SMTP password`);
  }
});

test('warmup_details is null before warmup starts and normalizes from either spelling', () => {
  const list = fixture<SmartleadEmailAccountListItem[]>('email-accounts').body;
  const detail = fixture<SmartleadEmailAccount>('email-account-detail').body;

  assert.ok(
    list.some((account) => account.warmup_details === null),
    'expected at least one account with warmup not yet started',
  );
  assert.equal(normalizeWarmupDetails(null), null);

  // The list reports "100%" and the detail reports 100 for the same account.
  const listed = list.find((account) => account.id === detail.id);
  assert.ok(listed?.warmup_details && detail.warmup_details);
  const fromList = normalizeWarmupDetails(listed!.warmup_details);
  const fromDetail = normalizeWarmupDetails(detail.warmup_details);
  assert.equal(fromList!.reputationPct, fromDetail!.reputationPct);
  assert.equal(fromList!.createdAt, fromDetail!.createdAt);
  assert.equal(fromList!.maxEmailPerDay, fromDetail!.maxEmailPerDay);
});

test('warmup-stats totals are strings and per-day rows are numbers', () => {
  const stats = fixture<SmartleadWarmupStats>('warmup-stats').body;
  assertKeys(
    stats,
    ['id', 'sent_count', 'spam_count', 'warmup_email_received_count', 'inbox_count', 'stats_by_date'],
    'warmup stats',
  );
  assert.equal(typeof stats.sent_count, 'string', 'top-level counters arrive as strings');
  assert.ok(Array.isArray(stats.stats_by_date));
  for (const row of stats.stats_by_date) {
    assertKeys(row, ['date', 'sent_count', 'reply_count', 'save_from_spam_count'], 'warmup day');
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof row.sent_count, 'number');
  }
  assert.equal(toNumber(stats.sent_count), 2);
});

test('campaign shape covers every key ensureCampaignLane writes', () => {
  const campaign = fixture<SmartleadCampaign[]>('campaigns').body[0];
  assertKeys(
    campaign,
    [
      'id',
      'status',
      'name',
      'track_settings',
      'scheduler_cron_value',
      'min_time_btwn_emails',
      'max_leads_per_day',
      'stop_lead_settings',
      'enable_ai_esp_matching',
      'send_as_plain_text',
      'unsubscribe_text',
    ],
    'campaign',
  );
  assert.ok(Array.isArray(campaign.track_settings));
  assert.equal(typeof campaign.max_leads_per_day, 'number');
});

test('analytics-by-date reports every counter as a string, including non_ooo_reply_count', () => {
  const analytics = fixture<SmartleadCampaignAnalyticsByDate>('campaign-analytics-by-date').body;
  for (const key of [
    'sent_count',
    'open_count',
    'reply_count',
    'bounce_count',
    'unsubscribed_count',
    'non_ooo_reply_count',
  ] as const) {
    assert.ok(key in analytics, `analytics is missing ${key}`);
    assert.equal(typeof analytics[key], 'string', `${key} should be a string counter`);
  }
  assert.equal(toNumber(analytics.sent_count), 0);
});

test('statistics and leads pages are offset/limit envelopes', () => {
  const stats = fixture<SmartleadCampaignStatistics>('campaign-statistics').body;
  assertKeys(stats, ['total_stats', 'data', 'offset', 'limit'], 'statistics page');
  assert.ok(Array.isArray(stats.data));

  const leads = fixture<SmartleadCampaignLeadsPage>('campaign-leads').body;
  assertKeys(leads, ['total_leads', 'data', 'offset', 'limit'], 'leads page');
  assert.ok(Array.isArray(leads.data));
  assert.ok(leads.limit <= SMARTLEAD_MAX_LEADS_PER_REQUEST);
});

test('webhooks are campaign-scoped: /campaigns/{id}/webhooks exists, /webhooks does not', () => {
  const perCampaign = fixture<unknown[]>('campaign-webhooks');
  assert.equal(perCampaign.status, 200);
  assert.ok(Array.isArray(perCampaign.body));

  const userLevel = fixture<unknown>('webhooks-user-level');
  assert.equal(userLevel.status, 404, 'a user-level webhook endpoint would change lane setup');
});

test('lead-by-email lookup answers 200 with an empty object for an unknown address', () => {
  const probe = fixture<Record<string, unknown>>('lead-by-email');
  assert.equal(probe.status, 200);
  assert.deepEqual(probe.body, {}, 'handoff id-resolution relies on {} meaning "not found"');
});

test('no fixture leaks the API key', () => {
  for (const file of fs.readdirSync(FIXTURES)) {
    const raw = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
    assert.doesNotMatch(raw, /api_key=(?!\[redacted\])[\w-]{8,}/, `${file} leaks an API key`);
  }
});

test('numeric coercion handles Smartlead string counters and percent strings', () => {
  assert.equal(toNumber('2'), 2);
  assert.equal(toNumber('1,024'), 1024);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber('abc', -1), -1);
  assert.equal(toReputationPercent('100%'), 100);
  assert.equal(toReputationPercent(100), 100);
  assert.equal(toReputationPercent(null), null);
});
