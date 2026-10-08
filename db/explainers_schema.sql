-- db/explainers_schema.sql — Explainer Reels version one (idempotent).
-- Schema `explainers` inside the existing Helios Supabase Postgres. Additive:
-- nothing here reads or writes the `reels` schema
-- (planning/Explainer Reels/BUILD_PLAN.md §4).
--
-- Apply:
--   npm run db:explainers
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS explainers;

-- ── Topics (E-14, E-15, E-16) ───────────────────────────────────────────────
-- One row per idea, whether seeded by hand, added from the form, or written by
-- the idea generator. `pool` rows are the ranked candidate pool (at most
-- `pool_size`, trimmed by code). `displaced` lost a duplicate head-to-head or
-- fell below the pool cut. `rejected` failed a Jev gate or duplicated a topic
-- rendered inside the lookback window.

CREATE TABLE IF NOT EXISTS explainers.topics (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text NOT NULL CHECK (length(btrim(title)) > 0),
    -- One-sentence learning objective (E-15 topic_scope).
    scope           text,
    source_url      text,
    source_text     text,
    origin          text NOT NULL CHECK (origin IN ('seeded', 'generated', 'manual')),
    status          text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'pool', 'rejected', 'displaced',
                                        'promoted', 'queued', 'rendered')),
    -- E-15 Jev scores, 0 to 4. Jev returns an expected score, which may fall
    -- between levels; it is stored and used raw, never rounded (A-8). NULL
    -- until scored.
    audience_fit                    numeric(5, 3) CHECK (audience_fit BETWEEN 0 AND 4),
    teachability_45s                numeric(5, 3) CHECK (teachability_45s BETWEEN 0 AND 4),
    analogy_potential               numeric(5, 3) CHECK (analogy_potential BETWEEN 0 AND 4),
    visual_potential                numeric(5, 3) CHECK (visual_potential BETWEEN 0 AND 4),
    accuracy_under_simplification   numeric(5, 3) CHECK (accuracy_under_simplification BETWEEN 0 AND 4),
    hook_strength                   numeric(5, 3) CHECK (hook_strength BETWEEN 0 AND 4),
    weighted_score  numeric(7, 3) CHECK (weighted_score BETWEEN 0 AND 100),
    reject_reason   text,
    duplicate_of    uuid REFERENCES explainers.topics (id) ON DELETE SET NULL,
    jev_notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
    idea_cycle_id   uuid,
    scored_at       timestamptz,
    rendered_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_topics_status
    ON explainers.topics (status, created_at DESC);
-- The 45-day duplicate history (A-2).
CREATE INDEX IF NOT EXISTS idx_explainers_topics_rendered
    ON explainers.topics (rendered_at DESC) WHERE rendered_at IS NOT NULL;

-- ── Daily idea cycle (E-16, A-7) ────────────────────────────────────────────
-- Runs only while auto_render is on. One row per cycle carries the E-16 cost
-- telemetry so idea_pipeline_cost_per_promotion can be computed.

CREATE TABLE IF NOT EXISTS explainers.idea_cycles (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status                  text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
    mode                    text NOT NULL CHECK (mode IN ('development', 'production')),
    ny_date                 date NOT NULL,
    started_at              timestamptz NOT NULL DEFAULT now(),
    finished_at             timestamptz,
    ideas_generated         integer NOT NULL DEFAULT 0,
    ideas_surviving_dedupe  integer NOT NULL DEFAULT 0,
    ideas_entering_pool     integer NOT NULL DEFAULT 0,
    promoted_topic_id       uuid REFERENCES explainers.topics (id) ON DELETE SET NULL,
    generator_cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
    scoring_cost_usd        numeric(12, 6) NOT NULL DEFAULT 0,
    duplicate_check_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
    error                   text
);

-- One cycle per Eastern-time day; a second attempt the same day is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_idea_cycles_day
    ON explainers.idea_cycles (ny_date) WHERE status IN ('running', 'ok');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topics_idea_cycle_fk'
  ) THEN
    ALTER TABLE explainers.topics
      ADD CONSTRAINT topics_idea_cycle_fk
      FOREIGN KEY (idea_cycle_id) REFERENCES explainers.idea_cycles (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Render jobs (E-05, E-06) ────────────────────────────────────────────────
-- The page inserts `requested`; the helios-explainers worker claims it.

CREATE TABLE IF NOT EXISTS explainers.jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Insertion order: timestamps can tie, ids are random.
    seq                 bigint GENERATED ALWAYS AS IDENTITY,
    topic_id            uuid NOT NULL REFERENCES explainers.topics (id) ON DELETE CASCADE,
    status              text NOT NULL CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    stage               text,
    trigger             text NOT NULL CHECK (trigger IN ('click', 'auto')),
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    spend_usd           numeric(12, 6) NOT NULL DEFAULT 0,
    spend_cap_usd       numeric(12, 6) NOT NULL CHECK (spend_cap_usd > 0),
    capped              boolean NOT NULL DEFAULT false,
    error               text,
    orchestrator_model  text NOT NULL,
    frame_worker_model  text NOT NULL,
    session_a_id        text,
    session_b_id        text,
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_explainers_jobs_requested
    ON explainers.jobs (requested_at DESC);
-- One render at a time (E-02), and one in-flight job per topic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_jobs_single_running
    ON explainers.jobs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_jobs_inflight_topic
    ON explainers.jobs (topic_id) WHERE status IN ('requested', 'running');

-- ── Artifacts ───────────────────────────────────────────────────────────────
-- Small text lives in `content`; video, images, and big logs in Storage.

CREATE TABLE IF NOT EXISTS explainers.artifacts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq             bigint GENERATED ALWAYS AS IDENTITY,
    job_id          uuid NOT NULL REFERENCES explainers.jobs (id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('brief', 'source', 'storyboard', 'script',
                                                  'audio_meta', 'lint_report', 'contact_sheet',
                                                  'video', 'captions', 'transcript_log', 'post_caption')),
    storage_path    text,
    content         text,
    bytes           bigint,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (storage_path IS NOT NULL OR content IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_explainers_artifacts_job
    ON explainers.artifacts (job_id, kind);

-- Existing databases keep the old kind list until this constraint is replaced.
ALTER TABLE explainers.artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE explainers.artifacts ADD CONSTRAINT artifacts_kind_check
    CHECK (kind IN ('brief', 'source', 'storyboard', 'script',
                    'audio_meta', 'lint_report', 'contact_sheet',
                    'video', 'captions', 'transcript_log', 'post_caption'));

-- ── Lint violations (E-07: recorded, not blocking in version one) ───────────

CREATE TABLE IF NOT EXISTS explainers.lint_violations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq         bigint GENERATED ALWAYS AS IDENTITY,
    job_id      uuid NOT NULL REFERENCES explainers.jobs (id) ON DELETE CASCADE,
    source      text NOT NULL CHECK (source IN ('storyboard', 'hyperframes')),
    rule        text NOT NULL,
    frame       integer,
    severity    text NOT NULL CHECK (severity IN ('error', 'warning')),
    detail      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_lint_job
    ON explainers.lint_violations (job_id);

-- ── Review (E-08) ───────────────────────────────────────────────────────────
-- One verdict per reel; saving again replaces it.

CREATE TABLE IF NOT EXISTS explainers.feedback (
    job_id      uuid PRIMARY KEY REFERENCES explainers.jobs (id) ON DELETE CASCADE,
    verdict     text NOT NULL CHECK (verdict IN ('approved', 'rejected')),
    tags        text[] NOT NULL DEFAULT ARRAY[]::text[]
                  CHECK (tags <@ ARRAY['hook', 'analogy', 'accuracy', 'pacing',
                                       'visuals', 'voice', 'captions', 'brand']::text[]),
    note        text,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Spend (E-06, E-17) ──────────────────────────────────────────────────────
-- Separate from reels.cost_events so explainer spend never counts toward the
-- Reels monthly watch. `usd_known = false` means the vendor returned no price;
-- the UI shows it as unknown rather than guessing.

CREATE TABLE IF NOT EXISTS explainers.cost_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid REFERENCES explainers.jobs (id) ON DELETE SET NULL,
    idea_cycle_id       uuid REFERENCES explainers.idea_cycles (id) ON DELETE SET NULL,
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    vendor              text NOT NULL CHECK (vendor IN ('anthropic', 'heygen', 'jev')),
    component           text NOT NULL,
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    usd                 numeric(12, 6) NOT NULL DEFAULT 0,
    usd_known           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_cost_created
    ON explainers.cost_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_explainers_cost_job
    ON explainers.cost_events (job_id) WHERE job_id IS NOT NULL;

-- ── Jev call log ────────────────────────────────────────────────────────────
-- One row per question set per call: the state sent, the answers, the set
-- version, and the model the alias resolved to. Separate from reels.jev_logs.

CREATE TABLE IF NOT EXISTS explainers.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_cycle_id           uuid REFERENCES explainers.idea_cycles (id) ON DELETE SET NULL,
    topic_id                uuid REFERENCES explainers.topics (id) ON DELETE SET NULL,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    resolved_model          text NOT NULL,
    state                   jsonb,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_jev_logs_topic
    ON explainers.jev_logs (topic_id, created_at DESC);

-- ── Upgrades for databases created before a column existed ──────────────────
-- Idempotent; existing rows get sequence values in their current order.

ALTER TABLE explainers.jobs            ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE explainers.artifacts       ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE explainers.lint_violations ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;

-- ── Theme brief, versioned (E-14) ───────────────────────────────────────────
-- Never edit a version in place; add a new one and point the setting at it.

CREATE TABLE IF NOT EXISTS explainers.theme_briefs (
    version     text PRIMARY KEY,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Settings the page and the worker share ──────────────────────────────────
-- Defaults are E-16 to E-20 with amendments A-4, A-5, A-7. Validated in
-- lib/explainers/settings.ts.

CREATE TABLE IF NOT EXISTS explainers.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO explainers.settings (key, value) VALUES
    ('mode',                 '"development"'::jsonb),
    ('auto_render',          'false'::jsonb),
    ('per_reel_cap_usd',     '5'::jsonb),
    ('daily_render_cap',     '1'::jsonb),
    ('daily_spend_cap_usd',  '6'::jsonb),
    ('pool_size',            '25'::jsonb),
    ('ideas_per_day',        '3'::jsonb),
    ('dedupe_lookback_days', '45'::jsonb),
    ('voice_name',           '"Lucas Figueroa"'::jsonb),
    ('voice_id',             'null'::jsonb),
    ('orchestrator_model',   '"claude-sonnet-5-5"'::jsonb),
    ('frame_worker_model',   '"claude-sonnet-5-5"'::jsonb),
    ('idea_model',           '"claude-sonnet-5-5"'::jsonb),
    ('music_enabled',        'true'::jsonb),
    ('sfx_enabled',          'true'::jsonb),
    ('theme_brief_version',  '"v1"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- E-14 theme brief v1, copied verbatim from planning/Explainer Reels/KICKOFF_DECISIONS.md.
INSERT INTO explainers.theme_briefs (version, body) VALUES ('v1', $brief$**Explainer Reels — Idea Generation Theme Brief**

Generate educational topics for short, 45-second Explainer Reels that help a broad business audience understand how modern software, computer science, and AI systems work. The audience ranges from nontechnical business owners and operators to technically curious professionals. Assume intelligence, but do not assume technical vocabulary or prior engineering knowledge.

The goal is not to cover technology news. The goal is to build durable technical literacy over time, so that following the page feels like taking a practical curriculum in modern technology.

Topic areas may include: AI and LLM fundamentals; agents and agentic systems; context windows and memory; RAG, embeddings, and vector search; MCP and APIs; databases, SQL, schemas, tables, keys, and relationships; frontend and backend systems; HTTP and web infrastructure; authentication and authorization; Git, GitHub, branches, and repositories; local, preview, and production environments; cloud computing, workers, cron jobs, and deployment; integrations, webhooks, backfills, and secrets; programming languages; frameworks and libraries; runtimes and package managers; state management; UI/UX concepts; software architecture; data flow; orchestration and workflows; model routing; tokenization; and other foundational computer-science concepts that help people understand how technology actually works.

Scope every idea aggressively. One reel should teach one complete thought. A topic is suitable only if it can be explained accurately in 45 seconds using one simple analogy, one small concrete example, one technical insight or caveat, and one real-world application. Broad concepts are allowed only when the objective is to explain what the concept is and how its major pieces fit together. Do not cram several lessons into one reel.

Use a plain-spoken, authoritative tone. Teach the underlying mechanism, not just a definition. Avoid hype, jargon for its own sake, and claims that oversimplify a concept into something inaccurate.

Do not generate: AI news, model-release commentary, “best AI tools” content, product roundups, consumer-tech news, prompt hacks, speculative AGI content, future-of-work predictions, trend commentary, or content whose primary purpose is opinion rather than teaching durable knowledge.

Deduplication: Treat two ideas as duplicates when the viewer would learn essentially the same core concept or leave with the same primary takeaway, even if the title, hook, analogy, or example differs. Compare against all available queued, rendered, and previously published topics. A new topic may revisit the same broad domain only when it teaches a materially different concept or layer of understanding.

10 good example topics
1. What actually happens when you call an API? — One mechanism, easy analogy, clear request/response example.
2. What is a context window? — Foundational AI concept with one clean mental model.
3. Why does a database need a primary key? — Extremely specific and can use one tiny table example.
4. What is a webhook? — Single integration concept with a strong real-world analogy.
5. What does “running locally” actually mean? — Common phrase that nontechnical operators hear constantly.
6. What is a Git branch? — One concept, visual, and directly useful for understanding software teams.
7. How does vector search find similar ideas instead of matching words? — One RAG mechanism with high visual potential.
8. What is authentication vs. authorization? — A narrow comparison that fits naturally into one thought.
9. What does React actually do? — A framework/language-adjacent topic framed around its fundamental role rather than a tutorial.
10. Why do AI agents need tools? — Explains one building block of agentic systems rather than trying to explain all of agents.

10 bad example topics
1. Everything you need to know about AI agents — Far too broad for one thought.
2. APIs, MCPs, webhooks, and integrations explained — Four separate lessons combined.
3. The 10 best AI tools for business owners — Tool roundup, not durable education.
4. What Claude 6 means for the future of work — Model news plus speculation.
5. Will AI replace software engineers? — Future-of-work opinion rather than technical education.
6. 5 prompts that will make you 10× more productive — Prompt-hack content.
7. The new iPhone's AI features explained — Consumer-tech/product news.
8. Learn Python in 45 seconds — Impossible scope and implicitly a tutorial.
9. How to build a full RAG application — Multi-stage implementation tutorial rather than one concept.
10. AI is about to change everything — Hype without a concrete learning objective.$brief$)
ON CONFLICT (version) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Overnight: storage, schedule, publish, insights (docs/social-overnight.md).
-- Same shapes as Trial Reels (db/reels_schema.sql). Only a reel a person
-- approved (explainers.feedback verdict 'approved') is ever scheduled, and
-- only while publishing_live is on.
-- ════════════════════════════════════════════════════════════════════════════

-- Where a stored artifact lives: 'local' (the machine that rendered it) or the
-- private `explainers` Supabase Storage bucket, under the same key.
ALTER TABLE explainers.artifacts ADD COLUMN IF NOT EXISTS storage_location text NOT NULL DEFAULT 'local';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'explainers_artifacts_location_check') THEN
    ALTER TABLE explainers.artifacts ADD CONSTRAINT explainers_artifacts_location_check
      CHECK (storage_location IN ('local', 'bucket'));
  END IF;
END $$;

-- Scheduling and publishing approved reels. Off until a human turns it on.
INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
-- A person approves every reel before it posts (the feedback verdict). On unless set to false.
INSERT INTO explainers.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;

-- One explainer per Eastern-time window per day.
CREATE TABLE IF NOT EXISTS explainers.posting_schedule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid NOT NULL REFERENCES explainers.jobs (id),
    ny_date             date NOT NULL,
    slot                text NOT NULL CHECK (slot IN ('afternoon')),
    publish_at          timestamptz NOT NULL,
    status              text NOT NULL CHECK (status IN ('scheduled', 'publishing', 'published', 'cancelled', 'failed')),
    source              text NOT NULL CHECK (source IN ('auto', 'user')),
    publish_attempt_id  uuid,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_posting_schedule_due
    ON explainers.posting_schedule (publish_at) WHERE status = 'scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_posting_schedule_slot
    ON explainers.posting_schedule (ny_date, slot) WHERE status IN ('scheduled', 'publishing', 'published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_posting_schedule_job
    ON explainers.posting_schedule (job_id) WHERE status IN ('scheduled', 'publishing');

-- requested → creating → processing → publishing → published | failed.
CREATE TABLE IF NOT EXISTS explainers.publish_attempts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid NOT NULL REFERENCES explainers.jobs (id),
    trigger             text NOT NULL CHECK (trigger IN ('approve', 'auto', 'force')),
    status              text NOT NULL CHECK (status IN (
                          'requested', 'creating', 'processing', 'publishing', 'published', 'failed'
                        )),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz,
    caption             text NOT NULL,
    video_object        text NOT NULL,
    share_to_feed       boolean NOT NULL DEFAULT true,
    container_id        text,
    media_id            text,
    permalink           text,
    status_log          jsonb NOT NULL DEFAULT '[]'::jsonb,
    error               text,
    insights_checked_at timestamptz,
    insights_settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_explainers_publish_recent ON explainers.publish_attempts (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_publish_inflight_job
    ON explainers.publish_attempts (job_id) WHERE status IN ('requested', 'creating', 'processing', 'publishing');
-- A reel posts once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_explainers_publish_once
    ON explainers.publish_attempts (job_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_explainers_publish_insights_open
    ON explainers.publish_attempts (finished_at DESC)
    WHERE status = 'published' AND insights_settled_at IS NULL AND media_id IS NOT NULL;

-- Lifetime totals, one row per published reel per New York day asked.
CREATE TABLE IF NOT EXISTS explainers.media_insights (
    media_id             text NOT NULL,
    ny_date              date NOT NULL,
    publish_attempt_id   uuid REFERENCES explainers.publish_attempts (id) ON DELETE CASCADE,
    captured_at          timestamptz NOT NULL DEFAULT now(),
    views                double precision,
    reach                double precision,
    likes                double precision,
    comments             double precision,
    saved                double precision,
    shares               double precision,
    total_interactions   double precision,
    avg_watch_time_ms    double precision,
    total_watch_time_ms  double precision,
    skip_rate            double precision,
    raw                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (media_id, ny_date)
);

CREATE INDEX IF NOT EXISTS idx_explainers_media_insights_attempt
    ON explainers.media_insights (publish_attempt_id, ny_date DESC);
