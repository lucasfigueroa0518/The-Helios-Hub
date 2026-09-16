/**
 * S1 acceptance — the migration is idempotent, keeps legacy provider rows
 * intact, and its CHECK vocabularies still match the TypeScript unions.
 *
 * Offline: parses db/smartlead_schema.sql as text. No database connection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  CONTACT_STATUSES,
  COST_PHASES,
  EMAIL_SEND_QUEUE_STATUSES,
  HEALTH_SCOPES,
  HEALTH_SOURCES,
  HEALTH_STATUSES,
  IDENTITY_SLUGS,
  LANE_STATUSES,
  LIFECYCLE_STAGES,
  LIVE_QUEUE_STATUSES,
  REPLY_SEND_KINDS,
  REPLY_SEND_STATUSES,
} from '@/lib/delivery-states';

const SQL = fs.readFileSync('db/smartlead_schema.sql', 'utf8');

/** Pulls the quoted literals out of the named CHECK constraint. */
function checkValues(constraintName: string): string[] {
  const at = SQL.indexOf(`ADD CONSTRAINT ${constraintName}`);
  assert.notEqual(at, -1, `db/smartlead_schema.sql has no constraint ${constraintName}`);
  const body = SQL.slice(at, SQL.indexOf(';', at));
  const inList = body.match(/IN\s*\(([\s\S]*?)\)/);
  assert.ok(inList, `${constraintName} has no IN (...) list`);
  return [...inList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('CHECK vocabularies match the TypeScript unions exactly', () => {
  const pairs: Array<[string, readonly string[]]> = [
    ['email_send_queue_status_check', EMAIL_SEND_QUEUE_STATUSES],
    ['campaign_lanes_status_check', LANE_STATUSES],
    ['campaign_lanes_identity_slug_check', IDENTITY_SLUGS],
    ['sender_inboxes_lifecycle_stage_check', LIFECYCLE_STAGES],
    ['leads_contact_status_check', CONTACT_STATUSES],
    ['reply_sends_status_check', REPLY_SEND_STATUSES],
    ['reply_sends_kind_check', REPLY_SEND_KINDS],
    ['lead_cost_events_phase_check', COST_PHASES],
    ['inbox_health_daily_scope_check', HEALTH_SCOPES],
    ['inbox_health_daily_source_check', HEALTH_SOURCES],
    ['inbox_health_daily_status_check', HEALTH_STATUSES],
  ];
  for (const [constraint, union] of pairs) {
    assert.deepEqual(
      checkValues(constraint).slice().sort(),
      union.slice().sort(),
      `${constraint} drifted from its TypeScript union`,
    );
  }
});

test('the live-row partial unique index covers exactly the live statuses', () => {
  const index = SQL.slice(
    SQL.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_queue_item_active'),
  ).split(';')[0];
  const values = [...index.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(values.slice().sort(), LIVE_QUEUE_STATUSES.slice().sort());
});

test('every statement is idempotent — no bare CREATE/ALTER that fails on re-run', () => {
  // DO $$ blocks guard their own ALTERs, so exclude them before scanning.
  const withoutDoBlocks = SQL.replace(/DO \$\$[\s\S]*?END \$\$;/g, '');

  for (const match of withoutDoBlocks.matchAll(/^CREATE (TABLE|INDEX|UNIQUE INDEX) (.+)$/gm)) {
    assert.match(match[0], /IF NOT EXISTS/, `not idempotent: ${match[0].trim()}`);
  }
  for (const match of withoutDoBlocks.matchAll(/^DROP INDEX (.+)$/gm)) {
    assert.match(match[0], /IF EXISTS/, `not idempotent: ${match[0].trim()}`);
  }
  for (const match of withoutDoBlocks.matchAll(/ADD COLUMN (?!IF NOT EXISTS)(.+)/g)) {
    assert.fail(`ADD COLUMN without IF NOT EXISTS: ${match[0].trim()}`);
  }
  for (const match of withoutDoBlocks.matchAll(/^INSERT INTO ([\s\S]*?);$/gm)) {
    assert.match(
      match[0],
      /ON CONFLICT|WHERE NOT EXISTS/,
      `INSERT with no re-run guard: ${match[0].slice(0, 80)}`,
    );
  }
});

test('the inbox seed never inserts a mailbox that already exists', () => {
  const insert = SQL.slice(SQL.indexOf('INSERT INTO outreach.sender_inboxes'));
  const statement = insert.slice(0, insert.indexOf(';'));
  assert.match(statement, /WHERE NOT EXISTS/);
  assert.match(statement, /lower\(existing\.email\) = lower\(seed\.email\)/);
});

test('the legacy rest migration only touches .email / .online rows still in provisioning', () => {
  const update = SQL.slice(SQL.indexOf("SET lifecycle_stage = 'resting'"));
  const statement = update.slice(0, update.indexOf(';'));
  assert.match(statement, /heliosgroup\.email/);
  assert.match(statement, /heliosgroup\.online/);
  assert.match(statement, /lifecycle_stage = 'provisioning'/);
});

test('historical provider rows are never rewritten', () => {
  // The whole point of keeping agentmail/resend history is analytics. A DEFAULT
  // change is fine; an UPDATE of the provider column is not.
  assert.doesNotMatch(SQL, /UPDATE outreach\.email_sends[\s\S]*?SET[\s\S]*?provider/);
  assert.match(SQL, /ALTER COLUMN provider SET DEFAULT 'smartlead'/);
});

test('subscription cost rows are addressable without a lead', () => {
  assert.match(SQL, /ALTER TABLE outreach\.lead_cost_events ALTER COLUMN lead_id DROP NOT NULL/);
  // A NULL lead_id would slip past a plain unique index, so it is coalesced.
  assert.match(SQL, /coalesce\(lead_id, '00000000-0000-0000-0000-000000000000'::uuid\)/);
});

test('campaign_lanes enforces both the webhook lookup key and one lane per identity', () => {
  const table = SQL.slice(
    SQL.indexOf('CREATE TABLE IF NOT EXISTS outreach.campaign_lanes'),
  ).split(');')[0];
  assert.match(table, /smartlead_campaign_id\s+bigint UNIQUE/);
  assert.match(table, /UNIQUE \(campaign_id, identity_slug\)/);
});

test('Smartlead owns send timing — both legacy date columns are nullable', () => {
  assert.match(SQL, /email_send_queue ALTER COLUMN scheduled_for DROP NOT NULL/);
  assert.match(SQL, /email_send_queue ALTER COLUMN schedule_date DROP NOT NULL/);
});
