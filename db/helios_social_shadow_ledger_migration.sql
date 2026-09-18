-- db/helios_social_shadow_ledger_migration.sql — Shadow judgment ledger.
-- Records A/B comparisons of Haiku vs. the production Jev judge. Never
-- touches article_queue.relevance_score or ingest_status — production
-- decisions are unaffected by anything in this table. Kill switch:
-- HELIOS_SOCIAL_SHADOW_HAIKU_JUDGE=0 in .env.local (default off).
--
-- Apply:
--   npm run db:helios-social:shadow-migration
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS helios_social.judge_shadow_ledger (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id             uuid NOT NULL REFERENCES helios_social.article_queue (id) ON DELETE CASCADE,
    -- Which shadow model produced this judgment. 'haiku' for now; leaves
    -- room to compare against Sonnet, Opus, or other providers later.
    shadow_model           text NOT NULL,
    -- 0.0-1.0 relevance score — directly comparable to production_score.
    shadow_score           numeric NOT NULL,
    shadow_reason          text,
    -- Whether the shadow would have approved (shadow_score >= 0.6 threshold).
    shadow_would_approve   boolean NOT NULL,
    -- Snapshot of Jev's production verdict at the moment shadow ran, so
    -- future prompt/threshold tuning does not muddy the comparison.
    production_score       numeric NOT NULL,
    production_approved    boolean NOT NULL,
    -- Pre-computed agreement flag (indexable). Equals
    -- (shadow_would_approve = production_approved).
    agrees_with_production boolean NOT NULL,
    -- Cost + token usage of the shadow call, for cost-delta reporting.
    shadow_cost_usd        numeric NOT NULL,
    shadow_input_tokens    integer,
    shadow_output_tokens   integer,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helios_social_shadow_ledger_article
    ON helios_social.judge_shadow_ledger (article_id);

CREATE INDEX IF NOT EXISTS idx_helios_social_shadow_ledger_created
    ON helios_social.judge_shadow_ledger (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_helios_social_shadow_ledger_agreement
    ON helios_social.judge_shadow_ledger (agrees_with_production);
