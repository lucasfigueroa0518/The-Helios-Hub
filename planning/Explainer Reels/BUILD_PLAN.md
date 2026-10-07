# Explainer Reels: build plan

A new Helios Hub product. A worker turns a queued topic into a 45-second animated explainer reel that teaches a computer science or AI concept, and a new **Explainers** tab shows every input and output for review. The renderer is HyperFrames (Apache 2.0). The visuals follow the Helios design system. The story follows a fixed teaching structure.

This file is the spec for the implementing agent (Opus 5.5). It follows the conventions of `planning/Trial Reels/BUILD_PLAN.md`: Lucas decides, no silent defaults, log every decision. Read that file's Section 1 (R1 to R10) and Section 2 (how to interview Lucas) before starting. Read `CLAUDE.md` too. Its hard rules apply here.

## Status

| Field | Value |
|---|---|
| Active build | Explainer Reels, version one |
| Stage | M1–M6 done (M5's VM install deferred by the local-only rule). Everything local: no Supabase schema, no commits, no VM deploy (Lucas, 2026-10-07). |
| Branch | `explainer-reels`, cut from `main` (E-03) |
| Next action | M7 retry: Lucas clicks Generate again. The first three clicks failed at collect (no MP4). Sandbox listen and the worker render fallback are fixed; restart `npm run explainers:worker` so it loads them. |
| Last updated | 2026-10-07 |

## 0. Rules that override everything here

From `CLAUDE.md`, restated because this build is where they get tested.

1. **No live Claude API, `web_search`, HeyGen, or Jev calls in automated tests or agent development runs.** Tests stub every model and vendor call with canned responses. The autonomous spend ceiling is about $1.50 without Lucas's in-the-moment go-ahead. Never start a real end-to-end render yourself. **Lucas's click on Generate (or his running the worker command) is the approval boundary.** Report objective telemetry (cost, duration, memory, violations, errors). Do not grade the quality of a reel. Lucas does that in the tab.
2. **Prompt caching** on every `messages.create` the Hub code makes (the idea generator). Use `lib/anthropic-cache.ts`. The stable prefix goes first and carries the breakpoint. The Agent SDK sessions are a separate path, see E-01 and Section 5.
3. **Worker sync.** Any worker code or env change must be redeployed to the VM in the same session. This build uses its own deploy script (Section 6), not `deploy-worker-code.sh`.
4. **Milestones in order, one at a time, with its Accept criteria met and a report at each boundary.**
5. **Prompts and Jev question sets need Lucas's approval (R6)** before they produce anything he reviews. Draft, show, revise, log in the registry.
6. **Never edit `planning/Trial Reels/PRODUCT_SPEC.md` or touch the Reels or outreach behavior.** This product is additive.

## 1. Decisions already made (interview with Lucas, 2026-10-07)

| ID | Decision |
|---|---|
| E-01 | The worker drives the HyperFrames skills through the **Claude Agent SDK, headless**, on an API key. Not the Claude Code CLI, and not a Messages-API rewrite. |
| E-02 | Renders run as a **new systemd unit on the existing VM** `helios-orch-worker` (e2-standard-2, 8 GB, shared with `helios-worker` and `helios-reels`). One render at a time. |
| E-03 | Branch `explainer-reels` from `main`. Verified: `Trial-Reels` and `main` are the same commit, so the reels code (Jev runner, storage helper, nav pattern) is already on `main`. |
| E-04 | Topics come from a **seeded queue plus an LLM idea generator that keeps the queue full**. **Jev scoring decides which ideas are best** and promotes them to render. No human approval gate on ideas. |
| E-05 | **Click Generate first.** Later, an `auto_render` setting (default **off**) lets the worker render promoted topics up to a daily cap. |
| E-06 | **Hard stop per reel on spend**, low at first. The run is killed and marked failed. The first runs measure real cost, then the permanent cap is set from data. Lucas picks the starting amount at kickoff. |
| E-07 | For the first test run, **lint violations are recorded and the render continues.** Blocking comes after run one. |
| E-08 | Review captures **approve or reject, failure tags, and an optional note** per reel. |
| E-09 | **Accuracy:** each topic may carry an optional source (URL or pasted notes). No web search. When a source exists, claims and visuals must trace to it. An accuracy reviewer comes after run one. |
| E-10 | **Voice, music, and SFX use HeyGen**, through an API key on the worker (not OAuth, which needs a personal browser login). Not Kokoro. |
| E-11 | **After the first run**, Lucas wants three reviewer layers with revision loops: Jev calls, deterministic scripts, and an LLM review. Do not build them in version one, but leave the insertion point (Section 5). |
| E-12 | The story and design choices in Sections 7 and 8 were reviewed and accepted by Lucas, including two deliberate bends of the brand rules (orange and green semantics, caption weight). The "no illustration" resolution is superseded by E-14/A-1. |
| E-13 | Prompt caching on the Agent SDK render sessions is the SDK's responsibility. The Hub's own `messages.create` calls (idea generator) use `lib/anthropic-cache.ts`. Logged so the SDK path is not a silent exemption from the caching rule. |
| E-14 | **Theme brief.** Practical AI, software, and CS literacy for a broad business audience (nontechnical through technically curious). One learning unit per reel. Dedupe on "same core learner takeaway." Brief text in `KICKOFF_DECISIONS.md`. **A-1:** simple HTML/CSS illustrations of real-world objects and scenes are allowed (no photos, stock footage, or complex hand-drawn art). |
| E-15 | **Jev idea scoring.** Six 0–4 questions (audience_fit .20, teachability_45s .20, analogy_potential .125, visual_potential .125, accuracy_under_simplification .20, hook_strength .15) → 0–100. Reject gates: audience_fit 0, teachability ≤1, analogy 0, visual 0, accuracy ≤1. Tie-breaks: teach, accuracy, audience, visual, hook, then a deterministic field. Each candidate carries a one-sentence `topic_scope`. Question text in `KICKOFF_DECISIONS.md`; needs Lucas's R6 sign-off as code before it scores anything. |
| E-16 | **Candidate pool.** Pool of 25. Once a day: one Sonnet 5.5 call generates 3 ideas, Jev scores and dedupes them, winners merge, pool trims to 25. **A-2:** dedupe history = full pool + topics rendered in the last 45 days. **A-3:** Stage 1 is one noul per candidate against the whole history; only on `true`, Stage 2 runs the pool in batches of 5 (one Jev call per batch, 5 pairwise nouls), stopping at the first batch with a match; head-to-head keeps the higher-ranked, exact tie keeps the incumbent; no pool match means a rendered-history duplicate, so reject. The 3 new ideas are deduped pairwise among themselves. **A-5/A-7:** the whole daily cycle (generate, score, dedupe, trim, promote) runs only while `auto_render` is on; with it off, Lucas seeds topics by hand (scored and deduped on add) and clicks Generate on any pool candidate. |
| E-17 | **Caps.** `per_reel_cap_usd = 5.00` (kill switch, always on). `mode = development | production`. Production: `daily_render_cap = 1`, **`daily_spend_cap_usd = 6.00` total (A-4: renders + idea pipeline)**. Development: no daily ceiling. No monthly ceiling. After three legitimate runs, compare the cap to 1.5 × the highest normal run cost and adjust by hand. |
| E-18 | **Models.** Sonnet 5.5 for orchestrator and frame workers. Escalate to Opus 5.5 only at the failing layer, via the staged test in `KICKOFF_DECISIONS.md`. |
| E-19 | **Voice.** HeyGen voice "Lucas Figueroa". Resolve the exact `voice_id` by lookup; verify once with the audition script. Pacing target 70–110 words, 1.56–2.44 words/s. |
| E-20 | **Music and SFX on** from run one (HeyGen; licensing confirmed by Lucas with HeyGen). Never disable them silently; surface any plan/API limitation. |
| E-21 | **Systemd limits** are the agent's call from measurements. **A-6:** provisional values from the M4 fixture render, final `MemoryMax`, `MemoryHigh`, `Nice`, and the dedicated-VM decision after M7. |
| E-22 | **Storage** is the agent's call from facts: inspect the real Supabase project and bucket limit, measure a real MP4, then pick bitrate and, only if needed, a fallback (lower bitrate → resumable upload → GCS). |

"Jev" is the TypeSafe `systemOne` question-call framework in `lib/reels/jev/` (runner, client, question sets, logs).

## 2. What exists in the repo (reuse, don't rebuild)

Verified by reading the repo on 2026-10-07.

| Need | Reuse |
|---|---|
| Job queue pattern | `reels.video_jobs`: `requested`, `running`, `ok`, `failed`. Partial unique indexes allow one running job and one in-flight job per idea. The app inserts a row and the worker claims it. Mirror this. |
| Worker loop | `scripts/reels_worker.ts`: env loader, 15s poll, SIGTERM handling, `--once` mode. Mirror it. |
| Systemd | `scripts/gcp/helios-reels.service` and `deploy-reels-worker.sh` |
| Jev | `lib/reels/jev/{client,runner,question-set}.ts` and `questions/`. `RecordingJevRunner` writes `reels.jev_logs` (`run_id`, `source_id`, `post_idea_id` are nullable). |
| Scoring pattern | `lib/reels/scoring/`, `reels.score_slates`, `reels.idea_scores` |
| Storage | `lib/reels/visual/storage.ts` (Supabase Storage with retry). **Copy, do not import.** Do not copy `rejectUnauthorized: false` without asking Lucas why it is there. |
| Cost | `reels.cost_events` has `vendor` limited to `jev`, `anthropic`, `openai`, and `MONTHLY_WATCH_USD = 100`. Make a separate `explainers.cost_events` and check that explainer Jev calls do not count toward the Reels watch (Section 4). |
| Caching | `lib/anthropic-cache.ts`, `docs/prompt-caching.md` |
| Auth | `getSession()` from `lib/session.ts`, return 401 as `app/api/reels/run/route.ts` does. Mirror how `middleware.ts` treats `/reels` and `/api/reels` for protection. |
| UI | `components/hub-shell/nav.ts` (`HUB_NAV`), `SegmentedNav`, `app/reels/layout.tsx` plus `reels-nav.tsx`, `ui.tsx` (`ReelVideo`, `Drawer`, `Section`) |
| Font | `app/fonts/PragmaticaExtended-Bold.otf` |
| Tests | `tests/reels-*.test.ts`, `tests/reels-pipeline.integration.ts` (DB with Jev and HTTP stubbed) |

No Agent SDK, HyperFrames, HeyGen, or headless Chrome exists in the repo today. These are new.

## 3. Kickoff decisions (resolved 2026-10-07)

All nine items are answered: E-14 to E-22 in Section 1, with the full packet, artifacts (theme brief, Jev question set, voice script, measurement protocols), and Lucas's amendments A-1 to A-9 in `KICKOFF_DECISIONS.md`. Amendments override the packet. Still open by design: HeyGen `voice_id` (lookup), real per-reel cost (M7), systemd values (M4 provisional, M7 final), Supabase limit and target bitrate (inspect + measure).

## 4. Architecture

```
Vercel (Next.js)                          VM helios-orch-worker
─────────────────                         ─────────────────────────────────────────
/explainers (3 tabs)                      helios-explainers.service  (new unit)
  Topics · Reels · Settings                 scripts/explainers_worker.ts
/api/explainers/*  (queue + read only)      loop: top up ideas → score (Jev) → promote
        │                                        claim job → run → upload → mark
        ▼                                   per job, in a scratch workspace:
Supabase Postgres  schema `explainers`        Session A (plan)  →  checkpoint  →  Session B (build + render)
Supabase Storage   bucket `explainers`        Agent SDK, scrubbed env, restricted tools
```

The app never executes a render. It inserts rows and reads rows. A render outlives any serverless request, the same reason the Reels worker exists.

**Data model** (`db/explainers_schema.sql`, `scripts/apply_explainers_schema.js`, `npm run db:explainers`, mirror `db/reels_schema.sql`):

- `topics`: `id`, `title`, `scope` (one-sentence learning objective, E-15), `source_url`, `source_text`, `origin` (`seeded`, `generated`, `manual`), `status` (`proposed`, `pool`, `promoted`, `rejected`, `displaced`, `queued`, `rendered`), the six Jev level scores, `weighted_score`, `reject_reason`, `duplicate_of` (nullable topic id), `jev_notes`, timestamps. `pool` holds at most 25 rows (E-16). `displaced` = lost a head-to-head or fell below rank 25.
- `jobs`: `id`, `topic_id`, `status` (`requested`, `running`, `ok`, `failed`), `stage`, `trigger` (`click`, `auto`), `spend_usd`, `spend_cap_usd`, `error`, `session_a_id`, `session_b_id`, `model`, `started_at`, `finished_at`. Partial unique index: one `running` job. Partial unique index: one in-flight job per topic.
- `artifacts`: `job_id`, `kind` (`brief`, `storyboard`, `script`, `audio_meta`, `lint_report`, `contact_sheet`, `video`, `captions`, `transcript_log`), `storage_path`, `content` (for small text), `created_at`.
- `lint_violations`: `job_id`, `rule`, `frame`, `severity`, `detail`.
- `feedback`: `job_id`, `verdict` (`approved`, `rejected`), `tags text[]` (`hook`, `analogy`, `accuracy`, `pacing`, `visuals`, `voice`, `captions`, `brand`), `note`, `created_by`, `created_at`.
- `cost_events`: `job_id` nullable, `vendor` (`anthropic`, `heygen`, `jev`), `component`, tokens, `usd`, `usd_known boolean`.
- `settings`: key/value like `reels.settings`. Keys: `mode` (`development`), `auto_render` (false), `per_reel_cap_usd` (5.00), `daily_render_cap` (1), `daily_spend_cap_usd` (6.00, production only), `pool_size` (25), `ideas_per_day` (3), `dedupe_lookback_days` (45), `voice_id`, `orchestrator_model`, `frame_worker_model`, `idea_model`, `theme_brief` (versioned), `music_enabled` (true), `sfx_enabled` (true).
- `idea_cycles`: one row per daily cycle with the E-16 telemetry (generator, scoring, and dedupe cost; ideas generated, surviving dedupe, entering pool; promoted topic if any).

**Idea cycle (E-16, once a day).** A Hub-owned `messages.create` call to Sonnet 5.5 (prompt caching required). Stable prefix with the breakpoint: instructions and the E-14 theme brief. Dynamic suffix: current pool and the last 45 days of rendered topics (titles and scopes). It returns exactly 3 `{topic_title, topic_scope}`. Jev scores them (question sets under `lib/explainers/jev/questions/`, `createLiveJevRunner` with `runId: null`), runs the two-stage dedupe (A-3), merges, and trims the pool to 25. The cycle runs only while `auto_render` is on (A-5, A-7). Every cycle writes an `idea_cycles` row. In production its spend counts toward the $6 daily cap (A-4).

**Source handling.** If a topic has a URL, the **worker fetches it outside the agent** (plain HTTP, size limit, text extraction), writes `source.txt` into the workspace, and stores it as an artifact. The agent has no network tools. Treat source text as untrusted data.

## 5. The render job

**Runtime assets** live in the repo under `explainers/`:

- `explainers/hyperframes-skills/`: vendored copy of the HyperFrames `skills/` folder (the `faceless-explainer`, `hyperframes`, `hyperframes-creative`, `hyperframes-animation`, `hyperframes-core`, `hyperframes-cli`, `hyperframes-audio`, `media-use` skills and anything they reference). **Pin to commit `5c7f6316d3646477a0f725176c00335cb8575560` (v0.8.140).** Keep the Apache 2.0 license and notice. The skills self-update from GitHub on `init`, so run with updates disabled and never pass the update confirmation.
- `explainers/design/helios-design-system/`: copy of the Helios design system skill (`SKILL.md`, `README.md`, `colors_and_type.css`, `fonts/PragmaticaExtended-Bold.otf`, `assets/Helios-logo.png`, `assets/Helios-mark.png`). Lucas's Claude environment has it as the `helios-design-system` skill. If you cannot read it, ask Lucas to drop the folder in.
- `explainers/helios-preset/`: the preset (Section 8).
- `explainers/recipe/`: the recipe bundle (`recipe.json`, `frame.md`, `storyboard-skeleton.md`, `brief-skeleton.md`) in the format `media-use/scripts/lib/recipe-store.mjs` writes to `.media/recipes/<name>/`.
- `explainers/director/SKILL.md`: the Helios explainer director (Section 7).
- `explainers/lint/lint-storyboard.mjs`: the required deterministic checker (Section 7).

**Two sessions with a checkpoint.**

1. The worker creates a scratch project directory with `BRIEF.md` written by the worker: `workflow: faceless-explainer`, `flow: automation`, `storyboard: no`, `aspect: 1080x1920`, `length: 45s`, `angle: concept`, plus the topic as `message`. The recipe does not lock `flow` or `storyboard` (`recipe-store.mjs` blanks them), so the worker must write them.
2. **Session A (plan):** the agent adopts the recipe, runs the story steps, and stops after writing `STORYBOARD.md` and `SCRIPT.md`.
3. **Checkpoint (worker code, no LLM):** run `lint-storyboard.mjs`, persist storyboard, script, and violations as artifacts, record spend so far. Per E-07 violations do not stop the run in version one. **This is the insertion point for the reviewer layers in E-11.** Do not build them now. Do not scaffold tables for them.
4. **Session B (build):** audio (HeyGen TTS with word timestamps, BGM and SFX lookup), visual design per frame, frame workers, captions, assembly, `transitions inject|verify`, `lint`, `check`, `snapshot`, then `render`.
5. Worker uploads the MP4, contact sheet, captions, and logs, and marks the job.

Verify that the faceless-explainer skill actually stops after Step 3 when the director instructs it to, and that its autonomous mode does not wait for approval. Report what you find.

**Agent SDK setup.**

- Use the TypeScript Claude Agent SDK. Confirm the current option names against the docs before coding (how skills or a local plugin load, allowed tools, permission handling, `env`, abort).
- **Scrubbed environment.** The worker process holds `DATABASE_URL`, Supabase service role, and the outreach keys. The agent subprocess gets only `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`, `PATH`, and a `HOME` inside the job directory. The explainers unit gets its own env file with only what it needs.
- **Restricted tools.** File tools scoped to the job directory. Shell limited to `node`, `npx hyperframes`, `ffmpeg`, `ffprobe`, and read-only utilities, enforced with a permission callback. No web fetch or search tools. Log every denied call.
- **Spend meter.** Stream the SDK's messages, keep a running total from usage and cost fields, and abort via the SDK's abort mechanism when the total passes `per_reel_cap_usd`. HeyGen cost: record what the API returns. When it is unknown, record `usd_known = false` and show it in the UI. Do not guess a dollar figure.
- **Caching.** Prompt caching on the Agent SDK path is the SDK's responsibility. Log this as a decision (E-13) so it is not a silent exemption from the caching rule.

**Failure handling.** A failed or capped job keeps every artifact it produced. Retry only on Lucas's click.

## 6. VM and deploy

- **New unit** `scripts/gcp/helios-explainers.service` with `WorkingDirectory=/opt/helios-explainers/app`, `EnvironmentFile=/opt/helios-explainers/worker.env`, `Nice`, `MemoryHigh`, and `MemoryMax` provisional from the M4 fixture render, final after M7 (E-21, A-6).
- **New deploy script** `scripts/gcp/deploy-explainers-worker.sh`, modeled on `deploy-reels-worker.sh`. **It must not write to `/opt/helios-worker/app`.** `deploy-worker-code.sh` ships the working tree of whatever branch you run it from to that shared directory, which would replace the outreach and reels worker code with this branch's.
- **Install on the VM:** confirm Node is 22 or newer (HyperFrames requires it), headless Chrome and its system libraries, and fonts. The VM's FFmpeg is 4.4 per `lib/reels/sfx/tolerances.ts`. Confirm HyperFrames renders with it. If not, install a newer FFmpeg for this unit only and say so.
- **Secrets** in the new env file only. Lucas copies them himself. Never view, print, or log a key.
- **Measure** with the E-21 protocol in `KICKOFF_DECISIONS.md`: host memory and both existing units before, then peak memory and wall time of the M4 fixture render (provisional limits) and of the first live render at M7 (final limits, dedicated-VM decision).

## 7. Teaching structure and checks

**Beat sheet** (fixed for version one, expressed as the recipe's `storyboard-skeleton.md`, mapped to the repo's frame `type` and clarity-technique fields):

| # | Time | Beat | Frame `type` | Clarity technique |
|---|---|---|---|---|
| 1 | 0 to 4s | Curiosity-gap hook in outcome language | `hook` | counterintuitive claim or question |
| 2 | 4 to 12s | Everyday analogy. The value claim lands here. | `product_intro` | analogy |
| 3 | 12 to 21s | Map analogy parts onto real components | `feature_showcase` | progressive disclosure |
| 4 | 21 to 29s | One tiny worked example with real numbers | `social_proof` | worked example |
| 5 | 29 to 35s | The technical catch | `benefit_highlight` | common belief vs reality |
| 6 | 35 to 41s | Where you meet it in the real world | `social_proof` | demonstration |
| 7 | 41 to 45s | White screen, only the Helios logo. The spoken line is the thesis and does not say Helios. (Lucas, after the first rendered reel.) | `branding` | callback and distillation |

This sits inside HyperFrames' own story rules (one structure per video, hook in outcome language, value claim by beat 2, storyboard as a proposal, visuals trace to the source). It adds a fixed order and does not contradict them. Voiceover is 6 to 20 words per frame as phrase cues. Use 2 to 3 transition types, with frame 1 a `cut`.

**Director skill** (`explainers/director/SKILL.md`): wraps `/faceless-explainer`. It loads the recipe, states the autonomous mode, carries the beat sheet and checklist, and says to take no questions and wait for no approvals.

**Lint script** (`lint-storyboard.mjs`, required, deterministic, unit-tested with fixture storyboards): it parses `STORYBOARD.md` and `SCRIPT.md` and reports:

- frame count and durations (total 45 seconds, tolerance 3)
- beat order and frame `type` against the sheet
- a clarity technique present on every frame
- voiceover 6 to 20 words per frame
- hook frame carries no subject-internal jargon (flag, don't judge)
- at most 3 transition types, frame 1 is `cut`
- no exclamation marks and no emoji in voiceover or on-screen copy
- no on-screen text that repeats a narration sentence
- every frame has a visual traceable to the topic or source (presence of the field, not truth)

Output: JSON written to `explainers.lint_violations` and a `lint_report` artifact.

## 8. Helios preset

Author `explainers/helios-preset/` modeled on `hyperframes-creative/frame-presets/cartesian/`: `FRAME.md` (frontmatter with `colors`, `typography` in `cqw`, `spacing`, `components`, then the prose sections including Frame Treatments, Approved Entities, Composition Rules, and the Pre-Render Self-Audit), `caption-skin.html`, and `fonts/PragmaticaExtended-Bold.otf`. Load it with `build-frame.mjs --preset helios --preset-dir <path>`, and freeze the result into the recipe. No fork of HyperFrames. Rebase the `cqw` conversion for a 1080 by 1920 canvas (the repo's formula assumes 1920 wide). Confirm the OTF stages through `--preset-dir`. Convert to woff2 if lint or render requires it.

**Accepted rule resolutions:**

| Helios rule | Video resolution |
|---|---|
| No illustration or hand-drawn art | **Revised by E-14/A-1.** Analogies may use simple HTML/CSS illustrations of recognizable real-world objects and scenes, built from geometric primitives (pills, circles, 16px cards), plus about 40 vendored inline Lucide SVG icons listed in Approved Entities. No photos, stock footage, or complex hand-drawn art. Frame workers cannot fetch assets. |
| Orange is for action only, green is for metadata only | Orange marks the single focal element per frame. Green is eyebrows and labels. |
| 600ms reveal, 0.1s stagger | Keep the curve (`expo.out` equals `cubic-bezier(0.16,1,0.3,1)`) and the 20px rise. Use about 400ms and 0.06s stagger. |
| Pragmatica is Bold only | Hierarchy from size, case, and color. Captions use Roboto Medium for phone legibility. |
| Logo protection | Logo only on frame 7, fully on canvas, above the caption band, clear space at least the height of the "H". |
| No exclamation marks or fluff | Applies to voiceover and on-screen copy. The lint script enforces punctuation. |
| White canvas | Beat 5 uses a `#171717` frame for rhythm. The caption pill is white with ink text so it works on both. |
| Four-beat content pattern | Eyebrow (green, doubles as signposting), headline, light line, verb CTA on frame 7 only. |

## 9. UI

New `HUB_NAV` entry: `id: 'explainers'`, `href: '/explainers'`, `label: 'Explainers'`, `badge: 'Beta'`. Add `/explainers` and `/api/explainers` to protection in `middleware.ts` the way `/reels` is handled. Layout with `SegmentedNav`, mirroring `app/reels/layout.tsx`.

- **Topics:** the pool of 25 ranked by weighted score, with the six Jev levels, notes, and origin; plus rejected, displaced, and rendered history. Add topic form (title, scope, optional URL or notes). Paste-a-list seeding, one topic per line. **Generate** on any pool candidate (queues a job, A-5). Reject. Idea-cycle telemetry per day.
- **Reels:** list of jobs. Each opens a drawer with four sections: **Inputs** (topic, source, `BRIEF.md`), **Plan** (storyboard table, script, lint violations), **Outputs** (video player, contact sheet, captions), **Run** (stage timeline, cost by vendor and component, errors). **Review** at the bottom: approve or reject, failure tag chips, optional note.
- **Settings:** `mode`, `auto_render` switch (default off, same pattern as the Reels publishing switch), caps, voice, models, music and SFX switches, theme brief.
- Video playback through a signed-URL route, mirroring `app/api/reels/video/[id]/route.ts`. Hub styling, not the reel's brand styling.

## 10. Milestones

Build in order. Each ends with a report to Lucas.

| M | Scope | Accept |
|---|---|---|
| M0 | Read docs, create branch `explainer-reels` from `main`, interview Lucas on Section 3, log E-14 onward, write the decision log into this file | Every blocking Section 3 item answered and logged. **Done 2026-10-07.** |
| M1 | Schema, apply script, `npm run db:explainers`, repository layer, settings | Schema applies on a scratch database. Repository tests pass offline. **Done 2026-10-07** (see M1 notes) |
| M2 | Nav item, layout, three tabs against the DB. Tiny dev fixture of 1 to 2 rows | Pages render with fixture data. Auth blocks unauthenticated requests |
| M3 | Topic intake, seeding, idea generator (cached prompt), Jev scoring (question set approved by Lucas), promotion rule | Pure and SQL tests pass with stubbed model and Jev. No live call made |
| M4 | Vendored skills at the pinned commit, Helios preset, recipe, director skill, lint script with fixtures | **Zero-cost smoke test:** a hand-authored 2-frame fixture project (no LLM, silent audio) runs `build-frame` with the preset, then `lint`, `check`, `snapshot`, `render` locally. The MP4 shows Pragmatica loaded and Helios colors. Lint script tests pass. **Done 2026-10-07** (see M4 notes) |
| M5 | Worker, workspace management, source fetch, Agent SDK runner (two sessions and checkpoint), scrubbed env, tool restrictions, spend meter, uploads, systemd unit and deploy script | Tests pass with a stubbed SDK emitting canned messages, including a spend-cap abort. Unit installs on the VM and the deploy script leaves `/opt/helios-worker/app` untouched. **Done 2026-10-07, VM install deferred** (see M5 notes) |
| M6 | Review drawer, signed video route, feedback save | Feedback rows persist with tags. A fixture reel plays. **Done 2026-10-07**: drawer (Outputs, Review, Plan, Inputs, Run) on the Reels tab; files served from local storage by an authenticated route with byte ranges (no signed URLs until E-22 picks the bucket); fixture job carries the M4 smoke MP4 |
| M7 | **Lucas runs the first live reel** (Generate click). The agent reports telemetry only | Report: spend by stage and vendor, wall time, peak memory, lint violations, errors, denied tool calls. No quality grading |

**M1 notes (2026-10-07).**
- Scratch database is PGlite (`@electric-sql/pglite`, Postgres 18 in WASM, dev dependency). `tests/explainers-pglite.ts` loads the real `db/explainers_schema.sql`, so `npm test` runs the repository SQL offline with no Supabase connection.
- The repository takes an `ExplainersDb` (`lib/explainers/db.ts`): `liveExplainersDb` wraps the shared pg pool, tests pass PGlite.
- Schema choices not spelled out above: `topics.scope` is nullable (hand-seeded titles get a scope at scoring, M3). `feedback` is one row per job and saving again replaces it. `idea_cycles` allows one running/ok cycle per Eastern day. The theme brief lives in `theme_briefs` (v1 seeded verbatim from E-14, test-enforced), selected by the `theme_brief_version` setting. Production daily caps count jobs and spend by Eastern calendar day. A failed job leaves its topic `queued` so Generate can retry it.
- `cost_events` is `explainers.cost_events`, separate from `reels.cost_events`. Whether `RecordingJevRunner` also writes Reels cost rows is checked in M3.

**Local-only rule (Lucas, 2026-10-07).** Until a run validates the product: the `explainers` schema lives in a local PGlite database (`.explainers-local/pgdata`, gitignored; `lib/explainers/connection.ts`), never Supabase, and nothing is committed. `EXPLAINERS_DB=supabase` exists but stays off. `npm run explainers:fixture` seeds two topics and one finished job (stop the dev server first; one process owns the data directory).

**M2 notes (2026-10-07).** Nav item `Explainers` (Beta), `/explainers` pages and `/api/explainers` protected (pages redirect, API 401; verified with curl). Tabs: Topics, Reels (job list; the review drawer is M6), Settings (validated PATCH; confirmation before auto-render on or production mode). Pages reuse the Trial Reels hub tokens (`reels.css`) plus `explainers.css`.

**M3 notes (2026-10-07).**
- Jev returns an expected score (e.g. 2.7), not a whole level. Everything uses it raw (A-8): weighted score, ranking, and the gates, which reject below the E-15 `*_min` values (`SCORE_MIN` in `lib/explainers/scoring.ts`).
- Each E-15 question gets only its listed state fields. Questions with identical state share a call: three Jev calls per topic. Source text goes under an untrusted key.
- Explainers has its own Jev runner (`lib/explainers/jev/runner.ts`): logs to `explainers.jev_logs`, costs to `explainers.cost_events`. The Reels runner would have written to `reels.jev_logs` and `reels.cost_events` in Supabase and counted toward the Reels watch.
- Dedupe follows A-3. The three new ideas are evaluated one at a time, so a later idea is checked against an earlier one that entered the pool; this covers "dedupe among the 3" without a separate pair call. A noul of 0.5 or more counts as duplicate.
- Hand-added topics are scored on add (A-7). Lucas enters titles only; one Sonnet call per click writes every scope (A-9, `writeScopes`, cached system prefix), then Jev scores each. Paste lists are one title per line, at most 25 per request.
- R6: the idea-generator prompt (`idea-generator-v1`) and the Stage 2 pairwise wording (`explainers-duplicate-pairs-v1`) were approved by Lucas on 2026-10-07. The scope-writer prompt (`scope-writer-v1`) was approved after its first live run. Both calls use structured outputs (`output_config.format`), because Sonnet 5.5 rejects forced `tool_choice` with a 400. The E-15 scoring set and Stage 1 gate are verbatim and test-enforced.
- The daily cycle (`runIdeaCycle`) exists and is tested with stubs; nothing schedules it until the worker (M5), and it does nothing while `auto_render` is off.

**M4 notes (2026-10-07).**
- **Skills:** `explainers/hyperframes-skills/` holds the eight skills from `heygen-com/hyperframes` at commit `5c7f631` (v0.8.140), unchanged, with `LICENSE` (Apache 2.0), `CREDITS.md`, and `VENDORED.md`. Only one upstream test file references a skill outside the eight.
- **CLI:** `hyperframes@0.8.140` is pinned in `explainers/runtime/package.json`, installed only where renders run, never in the Vercel app. Every call sets `HYPERFRAMES_SKIP_SKILLS=1` (init never syncs skills), `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`. Update checks only print notices; they never install. Verified `init` left `~/.claude/skills` and `~/.agents/skills` untouched.
- **Preset location:** `--preset-dir` takes a folder of presets, so the preset is `explainers/frame-presets/helios/` (not `explainers/helios-preset/`).
- **Fonts:** `build-frame.mjs` does not stage fonts from `--preset-dir`, and its remix gives display and body to the first brand font in `tokens.json`, which would collapse Pragmatica + Roboto into one face. So `tokens.json` lists no colors and no fonts (preset kept as authored), the worker copies `explainers/design/fonts/` into `assets/fonts/`, and the preset's FRAME.md carries a fixed `@font-face` block. Roboto 300/400/500/700 woff2 come from `@fontsource/roboto` 5.3.0 (OFL 1.1). Fonts must ship as files: the render machine is a clean headless Chrome.
- **Icons:** 62 Lucide 0.487.0 icons (ISC) in `explainers/frame-presets/helios/icons/`, copied into `assets/icons/`; the plan said about 40. The extras are everyday objects for analogies (receipt, cart, utensils, truck, store) and system parts.
- **Recipe:** `explainers/recipe/` in the `recipe-store.mjs` format (`recipe.json`, `frame.md` = the preset's FRAME.md, `storyboard-skeleton.md` with the seven beats, `brief-skeleton.md`). M5 copies it to the job's `.media/recipes/helios-explainer/` and points `HYPERFRAMES_MEDIA_HOME` at the job directory so `~/.media` is never touched.
- **Upstream gates:** HyperFrames gates every render on a human ("render now, or what changes?"), even in autonomous mode. The director overrides it: Lucas's Generate click is the render approval. The storyboard field the plan calls "clarity technique" is named `persuasion` upstream.
- **Lint:** `explainers/lint/lint-storyboard.mjs` (uses the vendored storyboard parser). At the checkpoint it reads `STORYBOARD.md` + `SCRIPT.md`; after the build, `--frames-dir` adds the on-screen checks (exclamation marks, emoji, narration repeated on screen). Output matches `explainers.lint_violations`.
- **Smoke test:** `node explainers/smoke/run-smoke.mjs` runs init → build-frame → assemble → transitions → lint → check → snapshot → render on a two-frame fixture. On Lucas's Mac (M5 Pro): lint and check pass with 0 warnings, the 6s 1080×1920 H.264 renders in 5.8s, and `/usr/bin/time` reports 983 MB max RSS for the CLI process (not the Chrome children; E-21 needs the cgroup measurement on the VM). The fixture is mostly white and static (0.61 Mbps), so it says nothing about E-22's real file size. Renders accept `--workers` (each a ~256 MB Chrome) and `--video-bitrate`; the director renders with `--workers 1`.
- **Schema:** jobs, artifacts, and lint violations gained a `seq` identity column for stable ordering (timestamps can tie, ids are random), with idempotent `ADD COLUMN IF NOT EXISTS` upgrades so existing local databases keep their rows.
- **Not ours:** `tests/seo-gsc-auth.test.ts` has 5 TypeScript errors on `main` too (hidden by the incremental cache).

**M5 notes (2026-10-07).**
- **Local-only consequences.** The first run happens on Lucas's Mac, not the VM. The unit (`scripts/gcp/helios-explainers.service`) and deploy script (`scripts/gcp/deploy-explainers-worker.sh`) are written and tested statically (never writes `/opt/helios-worker`), but not run. Storage is a local folder (`.explainers-local/storage`, `lib/explainers/storage.ts`) until E-22.
- **Local database.** PGlite allows one process per folder, and its socket server multiplexes connections over one session (unsafe for transactions). So `npm run explainers:db` runs a real Postgres 17 from the `embedded-postgres` npm package (dev dependency, no system install) at `127.0.0.1:54329`, and the app and worker connect through `EXPLAINERS_DATABASE_URL`. First start copies every row from the PGlite folder once (tested on a copy: 27 topics, 78 Jev logs, 81 cost events). Tests keep in-memory PGlite.
- **Agent SDK placement.** `@anthropic-ai/claude-agent-sdk` 0.3.293 needs `@anthropic-ai/sdk` ≥ 0.93 and zod 4; the Hub is on 0.65 and outreach/Reels must not change. It lives in `explainers/runtime/` with its own SDK and is loaded from there at run time (`loadAgentQuery`). Its native Claude Code binary arrives as a platform package at install.
- **Guard rails** (`lib/explainers/render/agent.ts`, `policy.ts`): env replaced entirely (only Anthropic/HeyGen keys, voice id, HOME/TMPDIR in the job, HyperFrames flags); `settingSources: ['project']` so the operator's `~/.claude` never loads; tools without WebFetch/WebSearch/MCP; a PreToolUse hook runs every call (frame workers included) through the policy (file tools inside the project; Bash allowlist, no substitution, pipes, redirects outside, network tools, `node -e`, `npx` other than hyperframes, `hyperframes skills|upgrade|publish`); `permissionPrompts: 'none'`; OS sandbox on with `failIfUnavailable`, writes limited to the project and job HOME, network limited to `*.heygen.com`, `*.heygen.ai`, `heygen-product.s3-accelerate.amazonaws.com` (music and SFX files; seen in run 2), and `cdn.jsdelivr.net`, localhost bind allowed, and `ANTHROPIC_API_KEY` denied to sandboxed commands. HyperFrames leaves the sandbox only on a prefix rule (`npx hyperframes *`, space before `*`). An exact `npx hyperframes` never matched `npx hyperframes check`, so runs 1–3 stayed sandboxed and `listen` on 127.0.0.1 returned EPERM. `SubagentHandback` is allowed so frame workers can report. `source` is not a shell-word ban: that matched `source.txt`.
- **Worker render.** If session B stops with all seven frames and `index.html` but no `renders/video.mp4`, the worker runs the pinned CLI itself (`--quality high --workers 1`). Init's placeholder `index.html` is not enough. No extra model call.
- **Spend.** A live meter prices every streamed assistant message (orchestrator and frame workers, deduplicated by id) and aborts past `spend_cap_usd`; `maxBudgetUsd` is set to what remains as a backstop. Session costs are recorded per model from the SDK's `modelUsage`; an aborted session records its streamed estimate. HeyGen is recorded as one `usd_known = false` event.
- **Frame-worker model.** A `frame-worker` agent definition carries `frame_worker_model`; the approved director now dispatches to it by name (one-phrase change to `director-v1`).
- **Job flow** (`lib/explainers/render/job.ts`): source (worker fetch, 15s, 2 MB, http(s) only, private addresses refused, text only) → workspace (real `hyperframes init` + build-frame + skills + recipe, offline) → session A (plan) → checkpoint lint (recorded) → session B (build + render) → collect (video, contact sheet, captions, audio meta, post-build on-screen lint, `hyperframes lint --json`, transcript). Failures keep every artifact. Orphaned `running` jobs fail at worker start.
- **Before the first run, Lucas:** adds `HEYGEN_API_KEY` and `EXPLAINERS_DATABASE_URL` to `.env.local`; stops the dev server; runs `npm run explainers:db`; restarts the dev server; sets the HeyGen voice id (E-19 lookup); runs `npm run explainers:worker`.

**After M7 (not in this build):** Jev, script, and LLM review and revision loops, designed from the first runs' feedback tags and violations. They plug in at the checkpoint in Section 5.

## 11. Risks

1. **Render load on a shared 8 GB VM.** Chrome plus FFmpeg beside the outreach worker. Measure first. A dedicated VM is the fallback. Lucas delegated that call to the agent, made from measurements after M7 (E-21, A-6).
2. **An LLM with a shell on the VM.** Mitigations are the scrubbed env, tool restrictions, no network tools, and a separate directory. Treat topic source text as untrusted.
3. **Cost per reel is unmeasured.** The hard cap (E-06) is the protection. HeyGen API credits bill separately from any plan.
4. **Output quality is unproven.** No independent HyperFrames explainer on a CS topic was found. M7 is the real test.
5. **Brand bends** (orange and green semantics, Medium captions, simple CSS illustrations per A-1) were accepted by Lucas. Flag any further bend as a decision.
6. **FFmpeg 4.4 and the Supabase file-size limit** are unverified until M4/M5 (E-22).
7. **Skill drift.** The skills auto-update. Pinning is mandatory.
8. **The idea cycle spends money on its own once deployed.** One Sonnet call plus Jev calls a day (Stage 2 dedupe can add up to 5 calls per duplicate candidate). It runs only on the VM unit, only while `auto_render` is on (A-7), never in tests, and counts toward the $6 production cap.
