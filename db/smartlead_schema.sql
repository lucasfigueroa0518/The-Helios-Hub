-- Outreach Hub v2 — Smartlead delivery schema.
-- Idempotent: safe to re-run. Apply after db/drafting_schema.sql,
-- db/reply_schema.sql, db/reply_multiturn_schema.sql, db/cost_ledger_schema.sql.
--
--   node scripts/apply_smartlead_schema.js
--
-- States and columns on existing tables are preferred over new tables. The two
-- new tables earn their place: campaign_lanes needs a unique key the webhook can
-- hit, and inbox_health_daily is a time series.

-- ── campaign_lanes — the Smartlead campaign ↔ (hub campaign × identity) join ──
--
-- One Smartlead campaign per hub campaign per sending identity, with only that
-- identity's mailboxes attached. Relational rather than a jsonb map on
-- campaigns so the webhook can resolve payload.campaign_id by unique index and
-- lane status transitions are plain row updates with no jsonb_set races.

CREATE TABLE IF NOT EXISTS outreach.campaign_lanes (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id            uuid NOT NULL REFERENCES outreach.campaigns (id) ON DELETE CASCADE,
    identity_slug          text NOT NULL,
    smartlead_campaign_id  bigint UNIQUE,
    status                 text NOT NULL DEFAULT 'creating',
    sequence_version       int NOT NULL DEFAULT 0,
    attached_account_ids   bigint[] NOT NULL DEFAULT '{}'::bigint[],
    error                  text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, identity_slug)
);

-- Webhook registration is campaign-scoped in Smartlead (GET /webhooks is 404;
-- GET /campaigns/{id}/webhooks is 200), so each lane owns its own hook.
ALTER TABLE outreach.campaign_lanes
    ADD COLUMN IF NOT EXISTS smartlead_webhook_id bigint,
    ADD COLUMN IF NOT EXISTS webhook_registered_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'campaign_lanes_identity_slug_check'
        AND conrelid = 'outreach.campaign_lanes'::regclass
    ) THEN
      ALTER TABLE outreach.campaign_lanes
        ADD CONSTRAINT campaign_lanes_identity_slug_check
        CHECK (identity_slug IN ('lucas', 'tommy'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'campaign_lanes_status_check'
        AND conrelid = 'outreach.campaign_lanes'::regclass
    ) THEN
      ALTER TABLE outreach.campaign_lanes
        ADD CONSTRAINT campaign_lanes_status_check
        CHECK (status IN ('creating', 'ready', 'paused', 'error'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_lanes_campaign
    ON outreach.campaign_lanes (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_lanes_status
    ON outreach.campaign_lanes (status)
    WHERE status IN ('creating', 'error');

-- ── campaigns.delivery_settings ─────────────────────────────────────────────
--
-- { tracking, stop_on_reply, unsubscribe_text,
--   schedule: { tz, days, start, end, min_gap_min },
--   max_new_leads_per_day, follow_ups: [{ step, delay_days, body_template }],
--   reply_fallback: 'claude' | 'human_only',
--   require_approval, require_approval_until }
-- follow_up_enabled stays the switch. No Smartlead campaign ids live here.

ALTER TABLE outreach.campaigns
    ADD COLUMN IF NOT EXISTS delivery_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── email_send_queue — handoff, not minute-level scheduling ─────────────────

ALTER TABLE outreach.email_send_queue
    ADD COLUMN IF NOT EXISTS handoff_date date,
    ADD COLUMN IF NOT EXISTS handed_off_at timestamptz,
    ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES outreach.campaign_lanes (id),
    ADD COLUMN IF NOT EXISTS smartlead_lead_id bigint,
    ADD COLUMN IF NOT EXISTS handoff_attempts int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS waiting_reason text;

-- Smartlead owns send timing. Historical rows keep their values; nothing new
-- is written to either column.
ALTER TABLE outreach.email_send_queue ALTER COLUMN scheduled_for DROP NOT NULL;
ALTER TABLE outreach.email_send_queue ALTER COLUMN schedule_date DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE outreach.email_send_queue DROP CONSTRAINT IF EXISTS email_send_queue_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- 'sending' is the retired AgentMail state, kept in the list so historical rows
-- stay valid; the cutover migration moves any live row back to 'queued'.
ALTER TABLE outreach.email_send_queue
    ADD CONSTRAINT email_send_queue_status_check
    CHECK (status IN (
      'queued', 'handing_off', 'handed_off', 'sending', 'sent', 'cancelled', 'failed'
    )) NOT VALID;

DROP INDEX IF EXISTS outreach.idx_email_send_queue_item_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_queue_item_active
    ON outreach.email_send_queue (drafting_item_id)
    WHERE status IN ('queued', 'handing_off', 'handed_off');

CREATE INDEX IF NOT EXISTS idx_email_send_queue_handoff_due
    ON outreach.email_send_queue (status, handoff_date)
    WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_email_send_queue_owner_handoff_date
    ON outreach.email_send_queue (owner_id, handoff_date);
CREATE INDEX IF NOT EXISTS idx_email_send_queue_lane
    ON outreach.email_send_queue (lane_id)
    WHERE lane_id IS NOT NULL;
-- Reconcile reclaims rows stuck mid-handoff by this predicate.
CREATE INDEX IF NOT EXISTS idx_email_send_queue_handing_off
    ON outreach.email_send_queue (updated_at)
    WHERE status = 'handing_off';
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_queue_lane_lead
    ON outreach.email_send_queue (lane_id, smartlead_lead_id)
    WHERE smartlead_lead_id IS NOT NULL;

-- ── email_sends — one row per sequence step ─────────────────────────────────

ALTER TABLE outreach.email_sends
    ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES outreach.campaign_lanes (id),
    ADD COLUMN IF NOT EXISTS smartlead_lead_id bigint,
    ADD COLUMN IF NOT EXISTS smartlead_email_account_id bigint,
    ADD COLUMN IF NOT EXISTS sequence_number int NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

ALTER TABLE outreach.email_sends ALTER COLUMN provider SET DEFAULT 'smartlead';

-- Conversations thread on drafting_item_id, so an item now legitimately has
-- several sent rows — one per step. Uniqueness moves to (item, step).
DROP INDEX IF EXISTS outreach.idx_email_sends_item_sent;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_item_step_sent
    ON outreach.email_sends (drafting_item_id, sequence_number)
    WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_email_sends_smartlead_lead
    ON outreach.email_sends (smartlead_lead_id)
    WHERE smartlead_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sends_account_sent
    ON outreach.email_sends (smartlead_email_account_id, sent_at DESC)
    WHERE status = 'sent';
-- Read-time cost amortization counts step-1 sends per billing cycle.
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_step1_sent
    ON outreach.email_sends (provider, sent_at)
    WHERE status = 'sent' AND sequence_number = 1;

-- ── inbound_emails — Smartlead lead categories ──────────────────────────────

ALTER TABLE outreach.inbound_emails
    ADD COLUMN IF NOT EXISTS lead_category text,
    ADD COLUMN IF NOT EXISTS lead_category_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS sequence_number int;

-- ── reply_sends — the 5-minute human window ─────────────────────────────────

ALTER TABLE outreach.reply_sends
    ADD COLUMN IF NOT EXISTS human_user_id uuid REFERENCES outreach.users (id);

DO $$
BEGIN
  ALTER TABLE outreach.reply_sends DROP CONSTRAINT IF EXISTS reply_sends_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE outreach.reply_sends
    ADD CONSTRAINT reply_sends_status_check
    CHECK (status IN (
      'queued', 'awaiting_human', 'drafting', 'sent', 'failed', 'skipped', 'scheduled', 'cancelled'
    )) NOT VALID;

DO $$
BEGIN
  ALTER TABLE outreach.reply_sends DROP CONSTRAINT IF EXISTS reply_sends_kind_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE outreach.reply_sends
    ADD CONSTRAINT reply_sends_kind_check
    CHECK (kind IN ('immediate', 'followup', 'human')) NOT VALID;

-- The worker claims by this predicate; the human reply route cancels by it.
CREATE INDEX IF NOT EXISTS idx_reply_sends_awaiting_human
    ON outreach.reply_sends (drafting_item_id, scheduled_for)
    WHERE status = 'awaiting_human';

-- ── sender_inboxes — lifecycle + Smartlead mirror ───────────────────────────

ALTER TABLE outreach.sender_inboxes
    ADD COLUMN IF NOT EXISTS smartlead_email_account_id bigint,
    ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'provisioning',
    ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS stage_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS rest_reason text,
    ADD COLUMN IF NOT EXISTS rest_cycles int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS from_name text,
    ADD COLUMN IF NOT EXISTS signature_html text,
    ADD COLUMN IF NOT EXISTS provisioning_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS sl_status text,
    ADD COLUMN IF NOT EXISTS sl_max_email_per_day int,
    ADD COLUMN IF NOT EXISTS sl_warmup_enabled boolean,
    ADD COLUMN IF NOT EXISTS sl_warmup_total_per_day int,
    ADD COLUMN IF NOT EXISTS sl_warmup_reply_rate int,
    ADD COLUMN IF NOT EXISTS sl_warmup_reputation int,
    ADD COLUMN IF NOT EXISTS sl_synced_at timestamptz,
    ADD COLUMN IF NOT EXISTS sl_raw jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Reputation rests at the domain, not the mailbox, so the rest clock keys on this.
ALTER TABLE outreach.sender_inboxes
    ADD COLUMN IF NOT EXISTS domain text
      GENERATED ALWAYS AS (split_part(lower(email), '@', 2)) STORED;

DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'sender_inboxes_lifecycle_stage_check'
        AND conrelid = 'outreach.sender_inboxes'::regclass
    ) THEN
      ALTER TABLE outreach.sender_inboxes
        ADD CONSTRAINT sender_inboxes_lifecycle_stage_check
        CHECK (lifecycle_stage IN (
          'provisioning', 'warming', 'ramping', 'production', 'resting', 'retired'
        ));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_inboxes_smartlead_account
    ON outreach.sender_inboxes (smartlead_email_account_id)
    WHERE smartlead_email_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sender_inboxes_stage
    ON outreach.sender_inboxes (lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_sender_inboxes_domain
    ON outreach.sender_inboxes (domain);

-- ── leads.contact_status — bounce / unsubscribe / complaint suppression ─────

ALTER TABLE outreach.leads
    ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS contact_status_at timestamptz,
    ADD COLUMN IF NOT EXISTS contact_status_source text;

DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'leads_contact_status_check'
        AND conrelid = 'outreach.leads'::regclass
    ) THEN
      ALTER TABLE outreach.leads
        ADD CONSTRAINT leads_contact_status_check
        CHECK (contact_status IN (
          'active', 'bounced', 'unsubscribed', 'complained', 'blocked'
        )) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_contact_status_suppressed
    ON outreach.leads (contact_status)
    WHERE contact_status <> 'active';

-- ── lead_cost_events — fixed monthly fees alongside per-lead costs ──────────
--
-- Subscription rows carry no lead_id: the Smartlead fee and each M365 seat are
-- recorded once per billing cycle and divided at read time by that cycle's
-- actual step-1 sends. Writing a per-send row would count the same fee twice.

ALTER TABLE outreach.lead_cost_events ALTER COLUMN lead_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE outreach.lead_cost_events DROP CONSTRAINT IF EXISTS lead_cost_events_phase_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE outreach.lead_cost_events
    ADD CONSTRAINT lead_cost_events_phase_check
    CHECK (phase IN ('enrichment', 'drafting', 'delivery', 'subscription')) NOT VALID;

-- The original unique index silently allows duplicates once lead_id is NULL.
DROP INDEX IF EXISTS outreach.lead_cost_events_source_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS lead_cost_events_source_uidx
    ON outreach.lead_cost_events (
      phase, source_kind, source_id,
      coalesce(lead_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

-- ── inbox_health_daily — deliverability time series ─────────────────────────
--
-- Column meaning is fixed per source: 'smartlead_warmup' and 'postmaster' fill
-- the metric columns; 'forecast' leaves them NULL and puts
-- {planned, actual, followups, cap, variance_flag} in detail, so sent/inbox
-- never change meaning between sources.

CREATE TABLE IF NOT EXISTS outreach.inbox_health_daily (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day          date NOT NULL,
    scope        text NOT NULL,
    scope_key    text NOT NULL,
    source       text NOT NULL,
    sent         int,
    inbox        int,
    spam         int,
    replied      int,
    bounced      int,
    inbox_rate   numeric(6, 4),
    spam_rate    numeric(6, 4),
    bounce_rate  numeric(6, 4),
    reputation   text,
    spf_ratio    numeric(6, 4),
    dkim_ratio   numeric(6, 4),
    dmarc_ratio  numeric(6, 4),
    status       text NOT NULL DEFAULT 'ok',
    detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (day, scope, scope_key, source)
);

DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'inbox_health_daily_scope_check'
        AND conrelid = 'outreach.inbox_health_daily'::regclass
    ) THEN
      ALTER TABLE outreach.inbox_health_daily
        ADD CONSTRAINT inbox_health_daily_scope_check
        CHECK (scope IN ('inbox', 'domain'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'inbox_health_daily_source_check'
        AND conrelid = 'outreach.inbox_health_daily'::regclass
    ) THEN
      ALTER TABLE outreach.inbox_health_daily
        ADD CONSTRAINT inbox_health_daily_source_check
        CHECK (source IN ('smartlead_warmup', 'postmaster', 'forecast'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'inbox_health_daily_status_check'
        AND conrelid = 'outreach.inbox_health_daily'::regclass
    ) THEN
      ALTER TABLE outreach.inbox_health_daily
        ADD CONSTRAINT inbox_health_daily_status_check
        CHECK (status IN ('ok', 'no_data', 'error'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inbox_health_daily_scope_source_day
    ON outreach.inbox_health_daily (scope_key, source, day DESC);

-- ── org_settings seeds ──────────────────────────────────────────────────────
--
-- Seeded only when absent, so re-running never clobbers a tuned value.

-- Smartlead Pro bills on the 16th; the Microsoft 365 seats bill on the 15th.
-- Each fee is recorded against its own cycle, so the one-day offset lands each
-- vendor's charge in the cycle it actually belongs to.
INSERT INTO outreach.org_settings (key, value) VALUES
  ('smartlead.plan_limits', '{"emails_per_month": 90000, "active_leads": 30000}'::jsonb),
  ('smartlead.billing_day', '16'::jsonb),
  ('smartlead.pricing', '{"subscription_usd_per_month": 94}'::jsonb),
  ('m365.pricing', '{"seat_usd_per_month": 4.8, "billing_day": 15}'::jsonb),
  ('verifier.pricing', '{"usd_per_check": 0}'::jsonb),
  ('smartlead.webhook', '{"mode": "path_token"}'::jsonb),
  ('smartlead.usage_cache', '{}'::jsonb),
  ('smartlead.accounts_cache', '{}'::jsonb),
  ('postmaster.domains', '["heliosgroup.me", "heliosgroup.store"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Lifecycle defaults (§3.5). Per-inbox sender_inboxes.stage_plan deep-merges over this.
INSERT INTO outreach.org_settings (key, value) VALUES (
  'stage_plan.default',
  '{
     "warming":     {"days": 14, "warmup_start": 5, "warmup_rampup": 5, "warmup_target": 30,
                     "reply_rate_pct": 32, "exit": {"inbox_rate_min": 0.92, "window_days": 7}},
     "ramping":     {"days": 14, "cap_start": 3, "cap_step": 1, "weekdays_only": true,
                     "warmup_hold": 30, "exit": {"bounce_rate_max": 0.02}},
     "production":  {"cap": 12, "warmup_per_day": 20},
     "resting":     {"days": 10, "legacy_days": 60},
     "limits":      {"max_daily_total": 40, "max_growth_ratio": 2},
     "auto_derate": {"bounce_rate_rest": 0.03, "warmup_spam_rate_rest": 0.05,
                     "postmaster_rest": ["LOW", "BAD"]}
   }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ── Inbox roster migration ──────────────────────────────────────────────────
--
-- The seven .email / .online mailboxes rest; the six Microsoft 365 mailboxes on
-- .me / .store enter at provisioning and are matched to their Smartlead account
-- by the first reconcile (never hard-coded here — detection is the tested path).

UPDATE outreach.sender_inboxes
   SET lifecycle_stage = 'resting',
       rest_reason = 'legacy_burn',
       stage_entered_at = COALESCE(stage_entered_at, now()),
       updated_at = now()
 WHERE domain IN ('heliosgroup.email', 'heliosgroup.online')
   AND lifecycle_stage = 'provisioning';

INSERT INTO outreach.sender_inboxes (identity_id, email, sort_order, is_primary, enabled,
                                     lifecycle_stage, from_name)
SELECT sid.id, seed.email, seed.sort_order, false, true, 'provisioning', sid.display_name
  FROM (VALUES
          ('lucas', 'lucas@heliosgroup.me',        11),
          ('lucas', 'lucasfigueroa@heliosgroup.me', 12),
          ('lucas', 'lucas@heliosgroup.store',     13),
          ('tommy', 'tommy@heliosgroup.me',        11),
          ('tommy', 'thomas@heliosgroup.me',       12),
          ('tommy', 'thomas@heliosgroup.store',    13)
       ) AS seed (slug, email, sort_order)
  JOIN outreach.sender_identities sid ON sid.slug = seed.slug
 WHERE NOT EXISTS (
         SELECT 1 FROM outreach.sender_inboxes existing
          WHERE lower(existing.email) = lower(seed.email)
       );

-- ── Domain rest clock ───────────────────────────────────────────────────────
--
-- A domain enters rest when its last mailbox leaves production/ramping.
-- Lifecycle refuses "→ warming" while rested_since + min_rest_days is in the
-- future. The legacy domains are seeded from the real AgentMail shutdown — the
-- last send we actually made through them — with a 60-day floor.

INSERT INTO outreach.org_settings (key, value)
SELECT 'domains', jsonb_build_object(
    'heliosgroup.email', jsonb_build_object(
      'rested_since', to_char(shutdown.at, 'YYYY-MM-DD'),
      'min_rest_days', 60,
      'notes', 'AgentMail burn; re-enter only through provisioning'
    ),
    'heliosgroup.online', jsonb_build_object(
      'rested_since', to_char(shutdown.at, 'YYYY-MM-DD'),
      'min_rest_days', 60,
      'notes', 'AgentMail burn; re-enter only through provisioning'
    ),
    'heliosgroup.me', jsonb_build_object('rested_since', NULL, 'min_rest_days', 10, 'notes', 'M365'),
    'heliosgroup.store', jsonb_build_object('rested_since', NULL, 'min_rest_days', 10, 'notes', 'M365')
  )
  FROM (
    SELECT COALESCE(max(sent_at), now()) AS at
      FROM outreach.email_sends
     WHERE provider = 'agentmail' AND status = 'sent'
  ) AS shutdown
ON CONFLICT (key) DO NOTHING;

GRANT USAGE ON SCHEMA outreach TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA outreach TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA outreach TO postgres, service_role;
