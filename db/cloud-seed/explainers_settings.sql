--
-- PostgreSQL database dump
--

\restrict 6NNxma0R5JZLZnHqfzNDYqd0eIDG5VTaAOA6IJkiESwV4QIqu0UVaaPiyOFlD48

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
-- Data for Name: settings; Type: TABLE DATA; Schema: explainers; Owner: -
--

COPY explainers.settings (key, value, updated_at) FROM stdin;
mode	"development"	2026-10-07 13:41:13.772-04
auto_render	false	2026-10-07 13:41:13.772-04
pool_size	25	2026-10-07 13:41:13.772-04
ideas_per_day	3	2026-10-07 13:41:13.772-04
dedupe_lookback_days	45	2026-10-07 13:41:13.772-04
voice_name	"Lucas Figueroa"	2026-10-07 13:41:13.772-04
orchestrator_model	"claude-sonnet-5-5"	2026-10-07 13:41:13.772-04
frame_worker_model	"claude-sonnet-5-5"	2026-10-07 13:41:13.772-04
idea_model	"claude-sonnet-5-5"	2026-10-07 13:41:13.772-04
music_enabled	true	2026-10-07 13:41:13.772-04
sfx_enabled	true	2026-10-07 13:41:13.772-04
voice_id	"0c5d4cff5cfc429586c33c9ae8a112e7"	2026-10-07 14:56:59.650657-04
publishing_live	false	2026-10-12 22:33:55.091086-04
require_approval	true	2026-10-12 22:33:55.091086-04
posts_per_day	2	2026-10-12 22:33:55.091086-04
daily_render_cap	2	2026-10-12 22:33:55.091086-04
daily_spend_cap_usd	10	2026-10-12 22:33:55.091086-04
analogy_model	"claude-opus-5-5"	2026-10-26 11:53:49.745213-04
theme_brief_version	"v4"	2026-10-26 11:53:56.373419-04
per_reel_cap_usd	25	2026-10-27 18:48:24.721441-04
\.


--
-- PostgreSQL database dump complete
--

\unrestrict 6NNxma0R5JZLZnHqfzNDYqd0eIDG5VTaAOA6IJkiESwV4QIqu0UVaaPiyOFlD48

