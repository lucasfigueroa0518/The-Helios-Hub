# Social captions redesign — design

Date: 2026-10-19 · Owner: Tommy (task from Lucas) · Status: draft for approval

## Why

Lucas: one of the main ways you can tell a post is AI-made is a caption that is
random or stale. He also wants every post to point back at Helios and what we do.

Diagnosis (2026-10-19):

1. **Carousels all share one skeleton.** In 109 exported captions
   (`exports/social/generated/*.json`, avg ~1,130 chars), every caption runs: news lede,
   then a background paragraph, then a source-skeptic paragraph ("The figures are
   Anthropic's own, and SiliconANGLE restates them"), then a "Would you…?" question, then
   "Follow Helios Group for plain-English AI news…", then Source and Photos lines.
   Seen across a grid, that sameness is the tell.
2. **The voice is a wire report.** `WRITER_CAPTION_SECTION`
   (`lib/social/writer/prompt.ts`) asks for "accurate like Reuters, brief like Axios,
   sharp like The Economist", "No opinions, predictions or comparisons of your own", and
   no fact outside the slides or BRIEF. The result is a hedged summary with no person
   behind it.
3. **The caption is an afterthought.** For carousels it is the last field of the
   slide-writing `submit_draft` call, and the Editor then tightens it.
4. **Nothing points back at Helios, and some rules forbid it:**
   - Reels ban any "offer of Helios services" and the words we/our/us
     (`lib/reels/copy/skill.ts`).
   - Explainers ban "sign off with Helios", and `parseCaption` throws "caption speaks as
     Helios" on we/our/us/I (`lib/explainers/caption-format.ts`).
   - Carousels know Helios only as "an Instagram page".
5. **Explainer gates force padding.** The caption needs at least 400 body characters and
   at least 4 paragraphs.

Comparable accounts checked live on 2026-10-19 were @metav3rse, @therundownai and
@evolving.ai. What they share:

- The first line is a hook with a point of view, not "who did what".
- Captions are 4–6 short paragraphs.
- The closing line gives the account's own so-what ("pretty interesting to see…").
- Endings vary: sometimes a question, often just the take.
- Where a sign-off exists (Rundown's "Follow us…"), it is short boilerplate and reads
  human.

## Goals

- Captions read like a sharp person who builds with AI wrote them: a hook first, short,
  with a view.
- **Every caption ties back to Helios.** That is a hard requirement from Lucas.
- No visible template across a run of posts: openings, shapes and endings vary.
- One shared foundation, with rules set per content type.

## Non-goals

- On-slide or on-screen copy, hooks inside video, and slide design.
- Stories, which have no caption.
- Hashtag strategy, beyond keeping each type's current rules.
- New downstream checkers or bandits. Fix the prompts and the gates that cause the
  problem.

## Anti-goals (a failure even if it technically works)

- **Salesy.** No "DM us", no list of services, no "book a call", no claimed client
  results or numbers. A follower should not feel pitched.
- **Made-up Helios facts.** "We're already wiring this into client CRMs" is forbidden
  unless it is literally in the context block.
- **A new template.** A Helios line in the same slot with the same wording every time
  just swaps one AI tell for another.
- **Weaker news accuracy.** The news part keeps today's sourcing discipline. Only the
  closing take is opinion.

## Decided

### The Helios context block (shared)

This is one static block, injected into every caption prompt, built from Lucas's "Who is
Helios" text. **Upskilling and team training are excluded.** Drop "train your team to run
them", and the technical-lead priority becomes "systems integration, stack
modernization, custom agents".

Content:

- **Who:** forward-deployed AI engineers who build and ship, not advise from the
  sidelines. We integrate systems and build proprietary tools when off-the-shelf
  doesn't cut it.
- **Focus:** agentic marketing and sales. That means automating repetitive work while
  improving conversion, connecting the stack, and surfacing the intelligence buried in
  the client's data.
- **Readers and what each cares about:**
  - Founder/CEO: removing the growth bottleneck without hiring a team.
  - Marketing/growth: scaling without more headcount or agency fees.
  - Operator/COO: replacing manual busywork with systems.
  - Technical lead: integration, stack modernization, custom agents.
- **Differentiators:**
  - Builders, not advisors. We do both the strategy and the engineering, and we have been
    building AI content systems at scale since October 2025, with several full-stack
    products shipped to production.
  - Full-stack visual AI (image, video, generative HTML-first design) run in production,
    so we know where it breaks.
- **Industries:** the full list from Lucas's text. It is used to pick a concrete example
  business when the story fits; it is never listed in a caption.
- **Outcomes, as direction only, never as numeric claims:**
  - Cut labor and software spend with owned systems.
  - An integrated AI-forward stack.
  - Outreach and content at scale without more headcount.
  - Fewer operational bottlenecks.

The block lives in one source file that all three caption writers import, so editing it
in one place updates every type.

### Shared caption rules (all types)

1. **Hook first.** The first ~125 characters stand alone, with tension, a stake or a
   surprising fact. It is not "X announced Y".
2. **Short, human paragraphs.** Usually 4–6 short lines with a blank line between them.
3. **The news stays factual and third-person,** with today's sourcing discipline. Drop
   the source-skeptic meta paragraph. Keep a hedge only where it changes what the reader
   should believe.
4. **The builder's read closes every caption.** It says what this news changes for
   someone running marketing, sales or ops at a business like the ones Helios serves,
   naming a business type when it fits. This is the only place opinion and "we" are
   allowed.
5. **Helios is named once in every caption, lightly.** It is either woven into the
   builder's read or given as a short closing line, worded differently each time.
6. **Some captions add a "here's what we build" statement, chosen by context plus a
   ceiling, not a fixed quota.** It may use only facts in the context block.
   (Tommy, 2026-10-19: fit is a Jev question.)
   - **Fit, judged by Jev:** a versioned question set in the existing Jev pattern
     (`lib/reels/jev/`: `defineQuestionSet`, `RecordingJevRunner`, logged, and stubbed in
     tests). It receives the story (BRIEF, script or article) plus the context block and
     returns a probability for this question: does this story touch what Helios builds
     (agentic marketing and sales automation, stack integration, data intelligence,
     production visual AI)? Policy, safety and culture stories should score low.
   - **Ceiling, set by code:** about 1 in 3 over that type's recent captions, using the
     same "recent" window as rule 8.
   - **Combining them:** code sets the named input `include_build_line: true` only when
     the fit score clears a threshold and the post is under the ceiling. The writer never
     judges fit or self-rations.
   - **Rate:** some weeks may have none, which is expected. The threshold and ceiling are
     constants, tuned once Tommy and Lucas have seen real output.
   - **Every caption still gets** the builder's read and a light Helios mention (rule 5).
7. **Endings vary.** A question, a share prompt or just the take are all valid, chosen to
   fit the story. "Would you…?" is no longer the default.
8. **The prompt gets the last N closing paragraphs for that type** and is told not to
   reuse their shape or wording. This is guidance only, not a gate. (Claude's call
   during design, 2026-10-19; Tommy to confirm.) "Recent" covers:
   - published posts;
   - posts in review;
   - posts already captioned earlier in the same run, so siblings in one overnight batch
     don't match.
   Use the caption as generated, not as a reviewer edited it.
9. **Banned:** "DM us", service lists, client-result claims, invented Helios
   anecdotes, engagement bait, and the existing voice-block bans (em dashes, emoji where
   already banned, stock AI words).

### Per type

**Carousels** (biggest change):

- **Give the caption its own step.** A new caption stage runs after the Editor. Drop the
  `CAPTION:` field from the Writer's `submit_draft`, and stop the Editor touching the
  caption, so one stage owns caption authorship.
- **Inputs:** final slides, the BRIEF, the context block, the recent closings, and
  `include_build_line`.
- **Retire the old framing.** The caption is the take on top of the slides, not the
  "Reuters/Axios/Economist" summary.
- **Length** is about 4–6 short paragraphs.
- **Facts:** news facts still come only from the slides or the BRIEF. The builder's read
  may interpret, but it may not add facts.
- **Kept:** the code-built `Source:` line and the `Photos:` attribution, the no-hashtags
  rule, and the 2,200-character limit.
- **Stage order** becomes `write → edit → caption → factCheck → mechanical → design`.
  (Claude's call during design, 2026-10-19; Tommy to confirm.) The fact-check stays a hard safety gate on the caption,
  with these changes:
  - The caption stage returns the news part and the builder's read as separate fields,
    joined by code.
  - The fact-checker holds the news part to "the brief is the only truth", as it does
    today.
  - The builder's read is judged differently. Opinion is allowed, but any factual claim
    about the story must still match the brief. Any claim about Helios must match the
    context block, which the fact-checker receives for this purpose.
  - If the fact-checker empties or rejects the caption, only the caption stage re-runs,
    not the whole draft.
  - The news part keeps emitting `caption.facts` claim tags so the mechanical checks
    still work.

**Reels** (`lib/reels/copy`):

- The caption still supports the video, and the framework and bucket CTAs (save, send,
  follow) stay.
- The builder's read with the Helios mention goes before the CTA.
- Lift "no offer of Helios services / no we" only for that read. "No pitch" stays.
- Where the arousal framework's follow-Helios CTA already names Helios, the read must not
  name it a second time.
- Bump the skill version.

**Explainers** (`lib/explainers/caption.ts`, AI Brain Break):

- The builder's read shows where the episode's concept shows up in a real business, using
  one of the context-block business types.
- In `parseCaption`:
  - Remove the "speaks as Helios" throw.
  - Lower or remove `CAPTION_MIN_BODY_CHARS` (400) and `CAPTION_MIN_PARAGRAPHS` (4) so the
    model stops padding.
  - Keep: the 2,200-character limit, no URLs, no emoji, 3–5 hashtags at the end, the
    hook-preview limit, and the episode stamp.
- Update the matching `.cursor/skills/explainer-caption/SKILL.md`. The code says it
  tracks that file.

**Last Few Days** (`lib/lfd/post.ts`, currently fully code-built):

- Replace the fixed emoji opener and the fixed `FOLLOW_LINE` in the caption with one
  cheap model call that writes a fresh opener and one Helios builder's-read line about
  the week. That costs about a cent per weekly post.
- The headline bullets, Sources and Photos lines stay code-built.
- On failure, fall back to the current template so the post still ships.

### Standing constraints

- **Prompt caching:**
  - The context block and caption rules are static, so they belong in the cached system
    prefix.
  - Recent closings, `include_build_line` and the post payload go after the breakpoint.
  - Use `lib/anthropic-cache.ts`.
- **Tests** are offline only, with the model stubbed. They cover:
  - the gate changes in `parseCaption`;
  - Writer and Editor no longer emitting or editing the caption;
  - the `include_build_line` decision (stubbed Jev fit × ceiling);
  - recent-closings retrieval;
  - the LFD fallback;
  - the prompt-pin tests updated (`tests/social-writer.test.ts` and others).
- **Live verification:**
  - Re-caption at most 2 saved posts per type, under $0.05 total (pre-approved).
  - Anything beyond that, ask first.
  - Tommy and Lucas judge quality, not the agent.
- **Worker sync:** caption generation runs on the social worker, so redeploy with
  `./scripts/gcp/deploy-social-worker.sh` in the same session.
- **Approval:** nothing posts without human approval. That is unchanged.
- **Existing review queue:** posts generated before this change keep their old captions
  and are not re-captioned (Tommy, 2026-10-19). No backfill job.

## Left to the builder

- The exact prompt wording, as long as it meets the rules above.
- The model and effort for the new carousel caption stage. Sonnet 5.5 at medium or high
  matches what runs today.
- The Jev fit threshold and the exact ceiling window. Start around a 1-in-3 ceiling;
  tune after review.
- Whether the Jev fit call is skipped (no build line) when the ceiling is already hit,
  to save the call.
- N for recent closings (suggested 5–8) and where they are read from
  (`social.posts.caption`, `reels.idea_copy`, `explainers.artifacts`).
- Whether Reels and Explainers keep their current call structure (they already have
  dedicated or framework-driven captions) or get small refactors.
- Rollout order, as long as all four types land under this design.
