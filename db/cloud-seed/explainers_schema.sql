--
-- PostgreSQL database dump
--

\restrict 7xuOp7pmTMPwWrecogeu1Kfjy5eMUMKwD0BzWd6jibniwfSiuMCFTqXda3dvM9X

-- Dumped from database version 17.10
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: explainers; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA explainers;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artifacts; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    job_id uuid NOT NULL,
    kind text NOT NULL,
    storage_path text,
    content text,
    bytes bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_location text DEFAULT 'local'::text NOT NULL,
    CONSTRAINT artifacts_check CHECK (((storage_path IS NOT NULL) OR (content IS NOT NULL))),
    CONSTRAINT artifacts_kind_check CHECK ((kind = ANY (ARRAY['brief'::text, 'source'::text, 'storyboard'::text, 'script'::text, 'audio_meta'::text, 'lint_report'::text, 'contact_sheet'::text, 'video'::text, 'captions'::text, 'transcript_log'::text, 'post_caption'::text]))),
    CONSTRAINT explainers_artifacts_location_check CHECK ((storage_location = ANY (ARRAY['local'::text, 'bucket'::text])))
);


--
-- Name: artifacts_seq_seq; Type: SEQUENCE; Schema: explainers; Owner: -
--

ALTER TABLE explainers.artifacts ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME explainers.artifacts_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cost_events; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.cost_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    idea_cycle_id uuid,
    mode text NOT NULL,
    vendor text NOT NULL,
    component text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cache_read_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    usd numeric(12,6) DEFAULT 0 NOT NULL,
    usd_known boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cost_events_mode_check CHECK ((mode = ANY (ARRAY['development'::text, 'production'::text]))),
    CONSTRAINT cost_events_vendor_check CHECK ((vendor = ANY (ARRAY['anthropic'::text, 'heygen'::text, 'jev'::text])))
);


--
-- Name: feedback; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.feedback (
    job_id uuid NOT NULL,
    verdict text NOT NULL,
    tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    note text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_tags_check CHECK ((tags <@ ARRAY['hook'::text, 'analogy'::text, 'accuracy'::text, 'pacing'::text, 'visuals'::text, 'voice'::text, 'captions'::text, 'brand'::text])),
    CONSTRAINT feedback_verdict_check CHECK ((verdict = ANY (ARRAY['approved'::text, 'rejected'::text])))
);


--
-- Name: idea_cycles; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.idea_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text NOT NULL,
    mode text NOT NULL,
    ny_date date NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    ideas_generated integer DEFAULT 0 NOT NULL,
    ideas_surviving_dedupe integer DEFAULT 0 NOT NULL,
    ideas_entering_pool integer DEFAULT 0 NOT NULL,
    promoted_topic_id uuid,
    generator_cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    scoring_cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    duplicate_check_cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    error text,
    CONSTRAINT idea_cycles_mode_check CHECK ((mode = ANY (ARRAY['development'::text, 'production'::text]))),
    CONSTRAINT idea_cycles_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ok'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: jev_logs; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.jev_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idea_cycle_id uuid,
    topic_id uuid,
    component text NOT NULL,
    question_set_id text NOT NULL,
    question_set_version text NOT NULL,
    resolved_model text NOT NULL,
    state jsonb,
    answers jsonb NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    topic_id uuid NOT NULL,
    status text NOT NULL,
    stage text,
    trigger text NOT NULL,
    mode text NOT NULL,
    spend_usd numeric(12,6) DEFAULT 0 NOT NULL,
    spend_cap_usd numeric(12,6) NOT NULL,
    capped boolean DEFAULT false NOT NULL,
    error text,
    orchestrator_model text NOT NULL,
    frame_worker_model text NOT NULL,
    session_a_id text,
    session_b_id text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    opener text,
    handoff text,
    CONSTRAINT jobs_mode_check CHECK ((mode = ANY (ARRAY['development'::text, 'production'::text]))),
    CONSTRAINT jobs_spend_cap_usd_check CHECK ((spend_cap_usd > (0)::numeric)),
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'running'::text, 'ok'::text, 'failed'::text]))),
    CONSTRAINT jobs_trigger_check CHECK ((trigger = ANY (ARRAY['click'::text, 'auto'::text])))
);


--
-- Name: jobs_seq_seq; Type: SEQUENCE; Schema: explainers; Owner: -
--

ALTER TABLE explainers.jobs ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME explainers.jobs_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lint_violations; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.lint_violations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    job_id uuid NOT NULL,
    source text NOT NULL,
    rule text NOT NULL,
    frame integer,
    severity text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lint_violations_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text]))),
    CONSTRAINT lint_violations_source_check CHECK ((source = ANY (ARRAY['storyboard'::text, 'hyperframes'::text])))
);


--
-- Name: lint_violations_seq_seq; Type: SEQUENCE; Schema: explainers; Owner: -
--

ALTER TABLE explainers.lint_violations ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME explainers.lint_violations_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: media_insights; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.media_insights (
    media_id text NOT NULL,
    ny_date date NOT NULL,
    publish_attempt_id uuid,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    views double precision,
    reach double precision,
    likes double precision,
    comments double precision,
    saved double precision,
    shares double precision,
    total_interactions double precision,
    avg_watch_time_ms double precision,
    total_watch_time_ms double precision,
    skip_rate double precision,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: posting_schedule; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.posting_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    ny_date date NOT NULL,
    slot text NOT NULL,
    publish_at timestamp with time zone NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    publish_attempt_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT posting_schedule_slot_check CHECK ((slot = ANY (ARRAY['afternoon'::text, 'late'::text]))),
    CONSTRAINT posting_schedule_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'user'::text]))),
    CONSTRAINT posting_schedule_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'publishing'::text, 'published'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: publish_attempts; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.publish_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    trigger text NOT NULL,
    status text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    caption text NOT NULL,
    video_object text NOT NULL,
    share_to_feed boolean DEFAULT true NOT NULL,
    container_id text,
    media_id text,
    permalink text,
    status_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    insights_checked_at timestamp with time zone,
    insights_settled_at timestamp with time zone,
    CONSTRAINT publish_attempts_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'creating'::text, 'processing'::text, 'publishing'::text, 'published'::text, 'failed'::text]))),
    CONSTRAINT publish_attempts_trigger_check CHECK ((trigger = ANY (ARRAY['approve'::text, 'auto'::text, 'force'::text])))
);


--
-- Name: settings; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: theme_briefs; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.theme_briefs (
    version text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topics; Type: TABLE; Schema: explainers; Owner: -
--

CREATE TABLE explainers.topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    scope text,
    source_url text,
    source_text text,
    origin text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    audience_fit numeric(5,3),
    teachability_45s numeric(5,3),
    analogy_potential numeric(5,3),
    visual_potential numeric(5,3),
    accuracy_under_simplification numeric(5,3),
    hook_strength numeric(5,3),
    weighted_score numeric(7,3),
    reject_reason text,
    duplicate_of uuid,
    jev_notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    idea_cycle_id uuid,
    scored_at timestamp with time zone,
    rendered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    term text,
    CONSTRAINT topics_accuracy_under_simplification_check CHECK (((accuracy_under_simplification >= (0)::numeric) AND (accuracy_under_simplification <= (4)::numeric))),
    CONSTRAINT topics_analogy_potential_check CHECK (((analogy_potential >= (0)::numeric) AND (analogy_potential <= (4)::numeric))),
    CONSTRAINT topics_audience_fit_check CHECK (((audience_fit >= (0)::numeric) AND (audience_fit <= (4)::numeric))),
    CONSTRAINT topics_hook_strength_check CHECK (((hook_strength >= (0)::numeric) AND (hook_strength <= (4)::numeric))),
    CONSTRAINT topics_origin_check CHECK ((origin = ANY (ARRAY['seeded'::text, 'generated'::text, 'manual'::text]))),
    CONSTRAINT topics_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'pool'::text, 'rejected'::text, 'displaced'::text, 'promoted'::text, 'queued'::text, 'rendered'::text, 'archived'::text]))),
    CONSTRAINT topics_teachability_45s_check CHECK (((teachability_45s >= (0)::numeric) AND (teachability_45s <= (4)::numeric))),
    CONSTRAINT topics_title_check CHECK ((length(btrim(title)) > 0)),
    CONSTRAINT topics_visual_potential_check CHECK (((visual_potential >= (0)::numeric) AND (visual_potential <= (4)::numeric))),
    CONSTRAINT topics_weighted_score_check CHECK (((weighted_score >= (0)::numeric) AND (weighted_score <= (100)::numeric)))
);


--
-- Name: artifacts artifacts_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.artifacts
    ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);


--
-- Name: cost_events cost_events_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.cost_events
    ADD CONSTRAINT cost_events_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (job_id);


--
-- Name: idea_cycles idea_cycles_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.idea_cycles
    ADD CONSTRAINT idea_cycles_pkey PRIMARY KEY (id);


--
-- Name: jev_logs jev_logs_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.jev_logs
    ADD CONSTRAINT jev_logs_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: lint_violations lint_violations_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.lint_violations
    ADD CONSTRAINT lint_violations_pkey PRIMARY KEY (id);


--
-- Name: media_insights media_insights_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.media_insights
    ADD CONSTRAINT media_insights_pkey PRIMARY KEY (media_id, ny_date);


--
-- Name: posting_schedule posting_schedule_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.posting_schedule
    ADD CONSTRAINT posting_schedule_pkey PRIMARY KEY (id);


--
-- Name: publish_attempts publish_attempts_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.publish_attempts
    ADD CONSTRAINT publish_attempts_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: theme_briefs theme_briefs_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.theme_briefs
    ADD CONSTRAINT theme_briefs_pkey PRIMARY KEY (version);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: idx_explainers_artifacts_job; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_artifacts_job ON explainers.artifacts USING btree (job_id, kind);


--
-- Name: idx_explainers_cost_created; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_cost_created ON explainers.cost_events USING btree (created_at DESC);


--
-- Name: idx_explainers_cost_job; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_cost_job ON explainers.cost_events USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_explainers_idea_cycles_day; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_idea_cycles_day ON explainers.idea_cycles USING btree (ny_date) WHERE (status = ANY (ARRAY['running'::text, 'ok'::text]));


--
-- Name: idx_explainers_jev_logs_topic; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_jev_logs_topic ON explainers.jev_logs USING btree (topic_id, created_at DESC);


--
-- Name: idx_explainers_jobs_inflight_topic; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_jobs_inflight_topic ON explainers.jobs USING btree (topic_id) WHERE (status = ANY (ARRAY['requested'::text, 'running'::text]));


--
-- Name: idx_explainers_jobs_requested; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_jobs_requested ON explainers.jobs USING btree (requested_at DESC);


--
-- Name: idx_explainers_jobs_single_running; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_jobs_single_running ON explainers.jobs USING btree (status) WHERE (status = 'running'::text);


--
-- Name: idx_explainers_lint_job; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_lint_job ON explainers.lint_violations USING btree (job_id);


--
-- Name: idx_explainers_media_insights_attempt; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_media_insights_attempt ON explainers.media_insights USING btree (publish_attempt_id, ny_date DESC);


--
-- Name: idx_explainers_posting_schedule_due; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_posting_schedule_due ON explainers.posting_schedule USING btree (publish_at) WHERE (status = 'scheduled'::text);


--
-- Name: idx_explainers_posting_schedule_job; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_posting_schedule_job ON explainers.posting_schedule USING btree (job_id) WHERE (status = ANY (ARRAY['scheduled'::text, 'publishing'::text]));


--
-- Name: idx_explainers_posting_schedule_slot; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_posting_schedule_slot ON explainers.posting_schedule USING btree (ny_date, slot) WHERE (status = ANY (ARRAY['scheduled'::text, 'publishing'::text, 'published'::text]));


--
-- Name: idx_explainers_publish_inflight_job; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_publish_inflight_job ON explainers.publish_attempts USING btree (job_id) WHERE (status = ANY (ARRAY['requested'::text, 'creating'::text, 'processing'::text, 'publishing'::text]));


--
-- Name: idx_explainers_publish_insights_open; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_publish_insights_open ON explainers.publish_attempts USING btree (finished_at DESC) WHERE ((status = 'published'::text) AND (insights_settled_at IS NULL) AND (media_id IS NOT NULL));


--
-- Name: idx_explainers_publish_once; Type: INDEX; Schema: explainers; Owner: -
--

CREATE UNIQUE INDEX idx_explainers_publish_once ON explainers.publish_attempts USING btree (job_id) WHERE (status = 'published'::text);


--
-- Name: idx_explainers_publish_recent; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_publish_recent ON explainers.publish_attempts USING btree (requested_at DESC);


--
-- Name: idx_explainers_topics_rendered; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_topics_rendered ON explainers.topics USING btree (rendered_at DESC) WHERE (rendered_at IS NOT NULL);


--
-- Name: idx_explainers_topics_status; Type: INDEX; Schema: explainers; Owner: -
--

CREATE INDEX idx_explainers_topics_status ON explainers.topics USING btree (status, created_at DESC);


--
-- Name: jobs explainers2_claim_guard; Type: TRIGGER; Schema: explainers; Owner: -
--

CREATE TRIGGER explainers2_claim_guard BEFORE INSERT ON explainers.jobs FOR EACH ROW EXECUTE FUNCTION explainers2.skip_v1_job_while_2_0_active();


--
-- Name: artifacts artifacts_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.artifacts
    ADD CONSTRAINT artifacts_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id) ON DELETE CASCADE;


--
-- Name: cost_events cost_events_idea_cycle_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.cost_events
    ADD CONSTRAINT cost_events_idea_cycle_id_fkey FOREIGN KEY (idea_cycle_id) REFERENCES explainers.idea_cycles(id) ON DELETE SET NULL;


--
-- Name: cost_events cost_events_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.cost_events
    ADD CONSTRAINT cost_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.feedback
    ADD CONSTRAINT feedback_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id) ON DELETE CASCADE;


--
-- Name: idea_cycles idea_cycles_promoted_topic_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.idea_cycles
    ADD CONSTRAINT idea_cycles_promoted_topic_id_fkey FOREIGN KEY (promoted_topic_id) REFERENCES explainers.topics(id) ON DELETE SET NULL;


--
-- Name: jev_logs jev_logs_idea_cycle_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.jev_logs
    ADD CONSTRAINT jev_logs_idea_cycle_id_fkey FOREIGN KEY (idea_cycle_id) REFERENCES explainers.idea_cycles(id) ON DELETE SET NULL;


--
-- Name: jev_logs jev_logs_topic_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.jev_logs
    ADD CONSTRAINT jev_logs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES explainers.topics(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_topic_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.jobs
    ADD CONSTRAINT jobs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES explainers.topics(id) ON DELETE CASCADE;


--
-- Name: lint_violations lint_violations_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.lint_violations
    ADD CONSTRAINT lint_violations_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id) ON DELETE CASCADE;


--
-- Name: media_insights media_insights_publish_attempt_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.media_insights
    ADD CONSTRAINT media_insights_publish_attempt_id_fkey FOREIGN KEY (publish_attempt_id) REFERENCES explainers.publish_attempts(id) ON DELETE CASCADE;


--
-- Name: posting_schedule posting_schedule_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.posting_schedule
    ADD CONSTRAINT posting_schedule_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id);


--
-- Name: publish_attempts publish_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.publish_attempts
    ADD CONSTRAINT publish_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES explainers.jobs(id);


--
-- Name: topics topics_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.topics
    ADD CONSTRAINT topics_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES explainers.topics(id) ON DELETE SET NULL;


--
-- Name: topics topics_idea_cycle_fk; Type: FK CONSTRAINT; Schema: explainers; Owner: -
--

ALTER TABLE ONLY explainers.topics
    ADD CONSTRAINT topics_idea_cycle_fk FOREIGN KEY (idea_cycle_id) REFERENCES explainers.idea_cycles(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 7xuOp7pmTMPwWrecogeu1Kfjy5eMUMKwD0BzWd6jibniwfSiuMCFTqXda3dvM9X

