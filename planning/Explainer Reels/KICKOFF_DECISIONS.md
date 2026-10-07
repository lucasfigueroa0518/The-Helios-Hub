# Explainer Reels: kickoff decisions (E-14 to E-22)

Lucas's kickoff packet, received 2026-10-07, answering `BUILD_PLAN.md` Section 3. The packet text below is kept verbatim. Lucas answered seven follow-up questions the same day; those answers are the **Amendments** block, and where an amendment and the packet disagree, **the amendment wins**. The summary of the final decisions is in `BUILD_PLAN.md` Section 1.

## Amendments (Lucas, 2026-10-07; override the packet)

| ID | Amends | Final rule |
|---|---|---|
| A-1 | E-12, E-15 Q4, BUILD_PLAN §8 | Simple HTML/CSS illustrations of recognizable real-world objects and scenes are **allowed** (e.g. a waiter, a mailbox, a kitchen). Still no photography, stock footage, or complex hand-drawn illustration. This replaces the "geometric primitives plus Lucide only" rule from E-12. |
| A-2 | E-14 `dedupe_history`, E-16 | The duplicate check compares against **the whole current candidate pool** plus **every topic rendered in the last 45 days** ("published" = rendered; `published_duplicate_lookback_days = 45`). E-14's "all available" means all within that window. |
| A-3 | E-15 duplicate gate, E-16 duplicate behavior | Two-stage dedupe. **Stage 1:** one Jev noul per candidate against the whole history (pool + 45-day rendered list). If `false`, the candidate is not a duplicate. **Stage 2 (only if `true`):** split the pool of 25 into batches of 5. Each batch is **one Jev call holding 5 independent pairwise nouls** (candidate vs. each incumbent; the existing `idea-merge` pairwise pattern). Run batches in order and stop at the first batch with a match. If more than one incumbent in that batch matches, the head-to-head is against the highest-ranked match. If no pool incumbent matches, the Stage 1 hit came from the rendered history, so the candidate is rejected. Duplicates among the 3 new ideas are checked pairwise (3 pairs, one call). |
| A-4 | E-17 | `production_daily_spend_cap_usd = 6.00` is the **total** daily cap: renders (each still killed at `per_reel_cap_usd = 5.00`) plus the idea pipeline (generator, scoring, dedupe). A `mode` setting (`development` / `production`) selects the caps; development keeps the $5 per-reel kill switch and no daily ceiling. |
| A-5 | E-16 promotion, E-05 | **No promotion while `auto_render` is off.** The daily idea cycle still generates, scores, dedupes, and trims the pool to 25. Lucas clicks **Generate** on any pool candidate (shown ranked); that candidate leaves the pool. When `auto_render` is on, the daily cycle promotes the single highest-ranked candidate and renders it, up to `production_daily_render_cap`. |
| A-6 | E-21 | Provisional systemd limits come from the M4 zero-cost fixture render (Chrome + FFmpeg only). Final `MemoryMax`, `MemoryHigh`, `Nice`, and the dedicated-VM decision are set by the engineering agent after Lucas's first live run (M7), when Agent SDK session memory is known. |
| A-7 | E-16, A-5 | **The daily idea cycle runs only while `auto_render` is on.** With it off, nothing is generated, scored, or deduped, and the pool stays as it is; Lucas seeds topics by hand and clicks Generate on any pool candidate. Hand-added topics are still scored and deduped when added (that spend is Lucas's own click). |

---

## Packet (verbatim)

Explainer Reels — Engineering Kickoff Packet
Context for the Engineering Agent
This file captures the product decisions made before implementation of Explainer Reels, a new tab inside the internal Helios Hub.
These decisions were made intentionally as product constraints, not as loose suggestions. Treat cards E-14 through E-20 as the current authoritative product specification unless a technical blocker makes one impossible. If that happens, surface the blocker explicitly rather than silently changing the behavior.
Cards E-21 and E-22 are intentionally delegated to the engineering agent because they depend on measurements from the live VM, Supabase account settings, and actual rendered video files. Do not guess those values. Measure or inspect them, then choose the settings based on the observed facts.
The product goal is to turn a queued topic into a 45-second, 9:16 animated educational reel that teaches one computer-science or AI concept in a simple but accurate way. Rendering uses HyperFrames with HTML/GSAP, headless Chrome, FFmpeg, and Claude agents. The visual system may use typography, geometric shapes, diagrams, Lucide-style icons, UI-like elements, and simple HTML/CSS illustrations of real-world objects or scenes. Voice, music, and sound effects come from HeyGen.
Each reel follows the fixed seven-beat structure:
1. Hook — 0–4s
2. Everyday analogy — 4–12s
3. Map analogy to real components — 12–21s
4. Tiny worked example with real numbers — 21–29s
5. Technical catch — 29–35s
6. Real-world context — 35–41s
7. Thesis + Helios close — 41–45s
The system should prioritize durable technical education over news, hype, or trend content. The page is meant to function like an ongoing curriculum.
The decisions below were finalized in product-design discussion and are organized in engineering-card order.

### E-14 Theme brief for the idea generator
Decision: Explainer Reels will teach practical AI, software, and computer-science literacy to a broad business audience, with each reel limited to one durable and accurately explainable concept.
Values:
- theme_scope = "AI + software + practical computer science literacy"
- audience = "broad business audience, nontechnical through technically curious"
- reel_learning_units = 1
- dedupe_basis = "same core learner takeaway"
- dedupe_history = "all available queued, rendered, and published topics"

Rationale: The page should function like an ongoing curriculum rather than a technology news feed. Breadth is allowed at the curriculum level, while each individual reel must be narrow enough to teach one complete thought accurately in 45 seconds.
Unverified / still to check: none
Artifact:

**Explainer Reels — Idea Generation Theme Brief**

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
10. AI is about to change everything — Hype without a concrete learning objective.

### E-15 Jev idea-scoring question set
Decision: Score candidates with six independent 0–4 Jev questions plus a semantic duplicate gate; expand each candidate with a one-sentence topic_scope, and judge visual potential across the full HTML-animation vocabulary including simple illustrations and the entertainment potential of the analogy.
Values:
- audience_fit_weight = 0.20
- teachability_45s_weight = 0.20
- analogy_potential_weight = 0.125
- visual_potential_weight = 0.125
- accuracy_under_simplification_weight = 0.20
- hook_strength_weight = 0.15
- audience_fit_min = 1
- teachability_45s_min = 2
- analogy_potential_min = 1
- visual_potential_min = 1
- accuracy_under_simplification_min = 2
- duplicate_allowed = false
- candidate_fields = "topic_title, topic_scope, optional_source_text"
- weighted_score_range = 0–100

Rationale: Sixty percent of the score is controlled by curriculum relevance, teachability, and accuracy, while hook strength remains meaningful at 15%. Advanced concepts are not penalized simply for being advanced. Visual quality measures whether HTML animation can actively teach and entertain, not whether the topic fits a narrow icon-and-diagram vocabulary.
Unverified / still to check: none
Artifact:

**Candidate schema**
```
candidate_topic:
  topic_title: string
  topic_scope: string
  optional_source_text: string | null
```
topic_scope should state the exact one-thought learning objective in one sentence.
Example:
topic_title: "What is a webhook?"
topic_scope: "Explain how one system automatically sends another system a message when a specific event occurs."

**Q1 — Audience fit + durable utility**
Key: audience_fit
Question:
How strongly would teaching this topic advance durable practical literacy in AI, software, or computer science for the Explainer Reels audience?
State fields:
- topic_title
- theme_brief

Judge rule:
Judge the educational value of the underlying concept for a broad audience ranging from nontechnical business people to technically curious professionals. Reward durable mental models that help someone understand how modern technology works. Do not reward a topic merely because it is timely, popular, surprising, or related to AI.
Levels:
- 0 — Outside the curriculum. Primarily news, consumer technology, product commentary, speculation, prompt hacks, future-of-work discussion, opinion, or another subject that does not meaningfully teach durable AI/software/computer-science knowledge.
- 1 — Weak fit. Technically related to the curriculum, but mostly trivia, an excessively niche implementation detail, or a concept with little useful mental-model value for this audience.
- 2 — Valid curriculum topic. Teaches a legitimate technical concept with some practical value. A viewer would learn something useful, but the concept is not especially high-leverage or broadly relevant.
- 3 — Strong curriculum topic. A durable concept that people working around modern software or AI are likely to encounter and benefit from understanding. It clearly improves the viewer's technical literacy.
- 4 — Exceptional curriculum topic. A foundational or unusually high-leverage mental model that unlocks understanding of multiple other concepts or meaningfully changes how a nontechnical person understands modern technology. Merely being relevant is not enough.

Gate: audience_fit == 0 → reject

**Q2 — 45-second teachability + scope**
Key: teachability_45s
Question:
Can this topic be taught as one complete and genuinely understandable thought in a 45-second Explainer Reel?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge scope, not underlying technical difficulty. An advanced concept may score highly if one useful thought about it can genuinely be taught to a nontechnical viewer. Assume the reel must support one thesis, one everyday analogy, one tiny worked example, one technical catch, and one real-world context beat. Do not reward a topic that only fits by racing through several subtopics or removing information necessary for understanding.
Levels:
- 0 — Cannot fit. The topic contains several independent lessons, requires substantial prerequisite knowledge, or is so broad that a 45-second explanation would be superficial rather than educational.
- 1 — Fits only through harmful compression. A reel could technically discuss it, but only by hand-waving important mechanics, skipping necessary context, or cramming multiple thoughts together.
- 2 — Teachable with careful narrowing. There is a coherent 45-second lesson inside the topic, although the treatment must be tightly scoped and some surrounding complexity must be deliberately excluded.
- 3 — Naturally teachable. The topic maps cleanly onto one thesis, analogy, worked example, technical insight, and real-world implication with little prerequisite knowledge.
- 4 — Exceptionally clean learning unit. The topic contains one crisp mechanism or distinction that can be fully developed rather than merely summarized within the format. The analogy, example, technical catch, and conclusion all fit comfortably.

Gate: teachability_45s <= 1 → reject

**Q3 — Everyday analogy potential**
Key: analogy_potential
Question:
How naturally can this concept be mapped to one everyday analogy without materially distorting how the concept actually works?
State fields:
- topic_title
- topic_scope

Judge rule:
Reward analogies whose parts map meaningfully onto the technical concept. Do not reward catchy metaphors that break down immediately or teach the wrong mental model.
Levels:
- 0 — No useful analogy. An everyday analogy would substantially misrepresent the concept or provide no meaningful help.
- 1 — Forced or misleading analogy. A metaphor can be invented, but important parts of the mapping fail and could leave the viewer with the wrong understanding.
- 2 — Workable analogy. There is a reasonable everyday comparison that communicates the central idea, although its limits need careful handling.
- 3 — Strong analogy. A familiar situation maps naturally onto the concept's important components and would materially improve comprehension.
- 4 — Exceptional analogy. The everyday system maps unusually cleanly onto the technical system and can carry multiple beats of the reel—including the mapping, example, or technical catch—without becoming inaccurate.

Gate: analogy_potential == 0 → reject

**Q4 — Visual potential**
Key: visual_potential
Question:
How much potential does this topic have for an engaging, visually explanatory 45-second animation, including a highly visual everyday analogy?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge how effectively the intended lesson could be communicated and made entertaining through HTML-based animation. Available visuals include typography, geometric shapes, diagrams, labels, Lucide-style icons, motion, interface-like elements, data visualizations, and simple HTML/CSS illustrations of recognizable real-world objects or scenes. Do not assume photography, stock footage, or complex hand-drawn illustration.
Reward visuals that actively explain the mechanism rather than merely decorate narration. Consider whether processes, relationships, transformations, sequences, comparisons, data flows, or changing states can be animated clearly.
Also give modest additional credit when the concept naturally supports a highly visual everyday analogy. The analogy should be one of the reel's most engaging visual moments: recognizable objects or scenes, clear labels, meaningful motion, and opportunities for synchronized sound effects. Do not make analogy potential the dominant factor here; it has its own separate score.
Levels:
- 0 — Poor visual fit. The lesson is fundamentally difficult to demonstrate visually in the available medium. Even with simple illustration, diagrams, labels, and motion, most of the understanding would have to come from narration.
- 1 — Limited visual potential. Recognizable visuals can accompany the explanation, but they would mostly decorate the narration. The concept offers little useful animation, visual transformation, or engaging analogy material.
- 2 — Solid visual potential. The topic supports at least one useful explanatory animation or illustrated analogy, plus some meaningful use of diagrams, objects, labels, flows, comparisons, or changing state. Visuals improve the lesson but do not carry most of it.
- 3 — Strong visual potential. The reel can repeatedly show rather than tell. The analogy can become an engaging animated scene, and the technical mapping or worked example also supports clear motion, relationships, or visual state changes.
- 4 — Exceptional visual potential. The topic naturally lends itself to a memorable visual story. A compelling real-world analogy can be richly animated using simple illustrated objects, labels, motion, and sound cues; that analogy maps cleanly into equally strong technical visuals; and multiple beats can communicate meaning primarily through animation rather than narration. This level should be difficult to reach.

Gate: visual_potential == 0 → reject

**Q5 — Accuracy under simplification**
Key: accuracy_under_simplification
Question:
Can this concept be simplified enough for the format while remaining materially correct?
State fields:
- topic_title
- topic_scope
- source_text, if present

Judge rule:
Judge the risk created by simplifying the topic for a nontechnical audience. Reward concepts whose essential mechanism remains correct when jargon and secondary details are removed. Penalize topics where crucial exceptions, prerequisites, disputed claims, or interacting mechanisms would need to be omitted. When source text is provided, the proposed lesson must also be supportable from that source because sourced reels may not introduce unsupported claims.
Levels:
- 0 — Cannot be simplified safely. Any 45-second treatment would likely communicate a materially false mental model, omit a defining qualification, or—when a source exists—require claims the source does not support.
- 1 — High distortion risk. The concept can only be made accessible by removing so many essential caveats or mechanics that the explanation risks being misleading.
- 2 — Accurate with careful framing. A correct simplified lesson is possible if the scope is explicitly constrained and at least one important caveat is handled well.
- 3 — Strong simplification resilience. The important mechanism can be expressed plainly while remaining materially correct. Secondary details can be excluded without changing the viewer's core mental model.
- 4 — Exceptionally robust. The concept has a precise central mechanism or distinction that remains fully valid after simplification and lends itself to a concrete, accurate miniature example. There are few material traps.

Gate: accuracy_under_simplification <= 1 → reject

**Q6 — Hook strength**
Key: hook_strength
Question:
How strong is the truthful, non-hype hook potential inherent in this topic?
State fields:
- topic_title
- topic_scope

Judge rule:
Judge whether the lesson naturally creates immediate curiosity, recognition, useful tension, or a knowledge gap for the target audience. The hook must emerge from the concept itself. Do not reward sensationalism, fear, exaggerated claims, artificial controversy, or clickbait wording.
Levels:
- 0 — No credible hook. There is little reason for the intended viewer to care immediately unless the topic is exaggerated or sensationalized.
- 1 — Weak hook. A reasonable introduction can be written, but the concept creates little natural curiosity or relevance.
- 2 — Solid hook. The topic connects to a recognizable question, confusion, system, or problem and can support a credible opening.
- 3 — Strong hook. The concept contains a meaningful curiosity gap, misconception, counterintuitive mechanism, or familiar technology the viewer likely uses without understanding.
- 4 — Exceptional hook. The topic contains an immediate, specific, and truthful tension that naturally makes someone want the explanation. It is surprising or highly recognizable without needing hype.

Gate: none

**Weighted score**
```
weighted_score =
    audience_fit / 4 * 20
  + teachability_45s / 4 * 20
  + analogy_potential / 4 * 12.5
  + visual_potential / 4 * 12.5
  + accuracy_under_simplification / 4 * 20
  + hook_strength / 4 * 15
```
Store as 0–100.

**Duplicate gate**
Implement as a Jev noul judgment, separate from the six weighted scores.
Key: duplicate_of_existing_topic
Question:
Would this proposed topic teach substantially the same core concept and leave the viewer with substantially the same primary takeaway as any existing topic in the provided history?
Judge:
Judge semantic learning overlap, not wording overlap. Different hooks, examples, analogies, titles, or phrasing do not make two ideas distinct. Topics within the same broad domain are allowed when they teach materially different mechanisms, distinctions, or layers of understanding.

**Hard-gate processing order**
1. Run duplicate logic.
2. Run six independent score questions.
3. Reject if:
   audience_fit == 0
   teachability_45s <= 1
   analogy_potential == 0
   visual_potential == 0
   accuracy_under_simplification <= 1
4. Calculate weighted_score.
5. Rank surviving ideas.

**Tie-break order**
1. Higher teachability_45s
2. Higher accuracy_under_simplification
3. Higher audience_fit
4. Higher visual_potential
5. Higher hook_strength
6. If still tied, use a deterministic system field; do not add another model call.

**Six-topic sanity check**

| Candidate | Audience | Teach | Analogy | Visual | Accuracy | Hook | Score | Result |
|---|---|---|---|---|---|---|---|---|
| What actually happens when you call an API? | 4 | 4 | 4 | 4 | 4 | 3 | 96.3 | Promote-quality |
| Authentication vs. authorization: what's the difference? | 4 | 4 | 4 | 3 | 4 | 3 | 93.1 | Promote-quality |
| How does vector search find similar ideas instead of matching words? | 4 | 3 | 3 | 4 | 3 | 4 | 86.9 | Strong |
| What does React actually do? | 3 | 3 | 3 | 3 | 4 | 2 | 76.3 | Good, lower priority |
| Everything you need to know about AI agents | 4 | 0 | 2 | 3 | 1 | 4 | 55.6 | REJECT — scope + accuracy |
| Will AI replace your employees? | 0 | 2 | 1 | 2 | 0 | 4 | 34.4 | REJECT — theme + accuracy |

(Weighted scores re-checked 2026-10-07: 96.25, 93.125, 86.875, 76.25, 55.625, 34.375. Correct.)

### E-16 Promotion rule and queue target depth
Decision: Maintain a competitive pool of 25 eligible ideas; generate three challengers every day in one Sonnet call, merge them through semantic duplicate competition, promote the single highest-ranked candidate each day, and retain only the strongest 25 ideas afterward.
Values:
- candidate_pool_target = 25
- candidate_pool_max = 25
- ideas_generated_per_day = 3
- idea_generation_calls_per_day = 1
- idea_generation_model = "Claude Sonnet 5.5"
- daily_promotion_count = 1
- planned_reels_per_day = 1
- weighted_score_min = none
- published_duplicate_lookback_days = 45
- pool_duplicate_rule = "retain higher-ranked representative"
- exact_tie_rule = "retain incumbent"
- promotion_rule = "highest-ranked eligible candidate"
- generator_context = "E-14 theme brief + current candidate titles/scopes + published titles/scopes from prior 45 days"

Rationale: The pool operates as continuous competitive selection rather than FIFO inventory. Three daily challengers compete against incumbents, the best candidate advances, weak ideas are progressively displaced, and no arbitrary weighted-score threshold is required.
Unverified / still to check: Actual Sonnet generation, Jev scoring, and duplicate-check costs. Log them during live operation and calculate idea_pipeline_cost_per_promotion.
Artifact:

**Daily lifecycle**
```
START: 25 ideas in candidate pool

1. Generate exactly 3 new ideas.
   - one Claude Sonnet 5.5 call
   - all 3 returned in one structured response

2. Score the 3 new ideas using E-15.

3. Run duplicate handling:
   A. against published topics from the previous 45 days
   B. against the current candidate pool
   C. among the 3 newly generated ideas

4. Merge surviving / winning challengers into the pool.

5. Promote the single highest-ranked idea in the combined pool.

6. Remove the promoted idea from the candidate pool.

7. Keep only the strongest 25 remaining ideas.
   - discard anything below rank 25

END: candidate pool target = 25
```
A newly generated challenger may win and be promoted the same day.

(Amended by A-5: steps 5 and 6 run only while `auto_render` is on.)

**Duplicate behavior**
Duplicate of a topic published in the previous 45 days: reject the new candidate.
Duplicate of an idea currently in the candidate pool: head-to-head competition. Keep the higher-ranked representative and discard the weaker one.
If weighted scores tie, apply the E-15 tie-break sequence. If still identical, keep the incumbent.
The same head-to-head rule applies if two of the three newly generated ideas duplicate one another.

**Generator context**
Pass:
- E-14 theme brief
- current candidate pool: topic_title, topic_scope
- topics published in prior 45 days: topic_title, topic_scope

Instruct the generator to produce three mutually distinct ideas that are also distinct from both context lists.
The generator attempts to avoid duplicates; the Jev duplicate layer remains the enforcement mechanism.

**Generator output**
```
ideas:
  - topic_title: string
    topic_scope: string
  - topic_title: string
    topic_scope: string
  - topic_title: string
    topic_scope: string
```
Do not ask the generator to produce hooks, analogies, scripts, self-scores, or long reasoning at this stage.

**Cost telemetry**
Log:
- idea_generator_cost_usd
- idea_scoring_cost_usd
- duplicate_check_cost_usd
- total_idea_pipeline_cost_usd
- ideas_generated
- ideas_surviving_dedupe
- ideas_entering_pool
- idea_pipeline_cost_per_promotion

### E-17 Starting spend caps
Decision: Cap each reel at $5; in production, allow at most one render and $5 of Explainer Reel spend per day; during development, retain the $5 per-reel kill switch but do not impose a daily spend ceiling.
Values:
- per_reel_cap_usd = 5.00
- production_daily_render_cap = 1
- production_daily_spend_cap_usd = 5.00
- development_daily_spend_cap_usd = none
- monthly_spend_ceiling_usd = none

(Amended by A-4: `production_daily_spend_cap_usd = 6.00`, covering renders plus the idea pipeline.)

Rationale: The $5 per-reel cap limits damage from runaway calls or retries. Production cannot spend more than one capped reel per day, while development remains flexible enough for testing multiple runs.
Unverified / still to check: Actual cost per successful reel. After the first three legitimate completed runs, record the highest observed cost and compare the existing $5 cap against 1.5 × highest_normal_run_cost; adjust deliberately rather than automatically if needed. Current Claude and HeyGen pricing is not assumed here.
Artifact:
Log these cost drivers per run:
- orchestrator Claude usage
- roughly seven frame-worker Claude agents
- retries / repair calls
- HeyGen voice
- HeyGen music
- HeyGen sound effects

Exclude clearly buggy runaway runs when establishing the normal operating-cost baseline.

### E-18 Model choice for orchestrator and frame workers
Decision: Start with Claude Sonnet 5.5 for both the orchestrator and all frame workers, and optimize for the cheapest model configuration that consistently passes review.
Values:
- orchestrator_model = "Claude Sonnet 5.5"
- frame_worker_model = "Claude Sonnet 5.5"
- optimization_goal = "lowest-cost configuration that passes review"

Rationale: All-Sonnet gives the cleanest baseline. Opus should only be introduced if observed failure modes show Sonnet is insufficient, and only at the layer responsible for those failures.
Unverified / still to check: Current Sonnet/Opus pricing, wall-time differences, and quality differences. Measure them from actual runs rather than assuming them.
Artifact:
After the first live run, reuse the same representative topic and hold constant:
- topic + topic_scope
- source material, if any
- script / seven-beat structure
- brand system
- voice
- renderer settings
- all prompts except model assignment
- random / seed controls if available

Measure:
- total Claude cost
- wall time
- lint/build violations
- render failures / retries
- human approve/reject verdict
- failure tags: hook, analogy, accuracy, pacing, visuals, voice, captions, brand

Use a staged cheapest-passing test:
1. Sonnet orchestrator + Sonnet frame workers — baseline
2. If failures are orchestration-level, test Opus orchestrator + Sonnet workers
3. If failures are frame-level, test Sonnet orchestrator + Opus workers
4. Test Opus + Opus only if targeted escalation still fails

Pick the lowest-cost configuration that passes review.

### E-19 HeyGen voice
Decision: Use the HeyGen voice named Lucas Figueroa, subject only to confirming its exact API voice ID and verifying the output.
Values:
- heygen_voice_name = "Lucas Figueroa"
- heygen_voice_id = <fill after lookup>
- target_word_count = 70–110
- target_words_per_second = 1.56–2.44
- target_wpm = 93–147

Rationale: The selected voice is Lucas Figueroa. The remaining task is implementation verification: resolve the exact HeyGen identifier and ensure its delivery matches the plain-spoken, authoritative Helios style.
Unverified / still to check:
- exact HeyGen voice_id
- current voice endpoint / engine availability
- pronunciation and pacing of the selected voice on the audition script

Artifact:

**Voice rubric**
The Lucas Figueroa voice should sound:
- plain-spoken
- authoritative
- conversational
- direct
- educational rather than announcer-like

Avoid:
- exaggerated enthusiasm
- sales cadence
- dramatic trailer delivery
- fake gravitas
- overly polished “AI narrator” rhythm

Pacing should keep technical terms and numbers immediately intelligible. Short sentences should be allowed to land. Questions should sound genuinely curious rather than theatrical. Emphasis should come from meaning, not constant changes in energy.

**Audition script**

Imagine a restaurant serving 240 customers with just three waiters. Each waiter takes an order, carries it to the kitchen, and brings the result back. An API works in a similar way. Your app sends a request, the server processes it, and the API returns a response. But what happens when 10,000 requests arrive at once? Systems need three things: capacity, routing, and limits. Engineers call one of those limits rate limiting. It prevents a service from being overwhelmed. Simple idea. Very important infrastructure.

**Verification process**
Use the existing repo helper or the applicable HeyGen voices endpoint to find the voice named Lucas Figueroa and retrieve its exact voice_id.
Generate the audition script once and verify:
- pronunciation
- pacing
- numbers
- the term “rate limiting”
- sentence-ending cadence
- that the result is the intended Lucas voice

This is a verification step, not a comparison audition.

### E-20 HeyGen music and sound effects
Decision: Enable both background music and sound effects from run one.
Values:
- background_music_enabled = true
- sound_effects_enabled = true
- music_start_policy = enabled_immediately
- sfx_start_policy = enabled_immediately
- distribution_targets = Instagram, TikTok, YouTube

Rationale: Music and sound effects are essential product elements, especially for making analogy sections feel engaging and complete. The product owner confirmed directly that the appropriate HeyGen plan and licensing conversation with a HeyGen representative have already occurred.
Unverified / still to check: The engineering agent does not need to re-decide whether music or SFX are enabled. If implementation exposes a plan/API limitation, surface it. Retain any written HeyGen licensing confirmation if available for records.
Artifact:

**Run-one media policy**
- Use background music in every Explainer Reel by default.
- Use sound effects in every Explainer Reel by default.
- Treat both as core production elements, not optional enhancements.
- The everyday analogy should be one of the strongest audiovisual moments in the reel.
- Use sound effects to reinforce motion, transitions, labels, impacts, clicks, notifications, movement, success/failure cues, and other meaningful visual events.
- Do not let music obscure voice intelligibility.
- Do not silently disable music or SFX as a cost-saving shortcut; the product decision is that both are essential.

### E-21 Systemd limits for the new explainers unit
Decision: Final systemd limits are intentionally delegated to the engineering agent and must be based on measurements from the live shared VM, not guessed values.
Values:
- MemoryMax = <measure and choose>
- MemoryHigh = <measure and choose>
- Nice = <measure and choose>
- dedicated_vm_required = <determine from measured headroom>

Rationale: The VM is shared with two existing always-on workers, so safe limits depend on actual idle memory, swap, existing-worker usage, and the peak memory of a real local render.
Unverified / still to check: All final values. (Amended by A-6: provisional values after M4, final values after M7.)
Artifact:

**Known VM context**
Existing VM:
- GCP e2-standard-2
- 2 vCPU
- 8 GB RAM

Existing workers:
- outreach worker with systemd MemoryMax around 7 GB
- Reels worker with systemd MemoryMax around 1.5 GB

Do not treat those configured maxima as current actual usage.

**Required measurement protocol**
Run before choosing limits:
```
free -h
swapon --show
vmstat -s
```
Inspect active memory use and cgroup/systemd data for the existing workers:
```
systemctl status <outreach-unit>
systemctl status <reels-unit>

systemctl show <outreach-unit> \
  -p MemoryCurrent \
  -p MemoryPeak \
  -p MemoryHigh \
  -p MemoryMax

systemctl show <reels-unit> \
  -p MemoryCurrent \
  -p MemoryPeak \
  -p MemoryHigh \
  -p MemoryMax
```
If MemoryPeak is unavailable or not useful, inspect the relevant cgroup memory files or use another reliable measurement method available on the host.

Measure one representative local Explainer Reel render:
```
/usr/bin/time -v <actual-render-command>
```
Capture at minimum:
- maximum resident set size
- elapsed wall-clock time
- exit status
- whether swap activity occurred
- whether Chrome/FFmpeg/agent subprocesses materially change total peak usage

Also inspect host memory while the render is running, because /usr/bin/time -v on a wrapper process may not fully represent all child/cgroup memory depending on how the worker launches subprocesses.

**Builder decision rule**
Choose:
- MemoryHigh below MemoryMax
- MemoryMax with meaningful safety margin above measured normal peak
- Nice so the new renderer does not starve existing always-on workers

If a single render's measured peak plus realistic concurrent usage leaves inadequate RAM headroom on the 8 GB host, the correct result is move Explainer Reels to a dedicated VM, not force an unsafe cgroup limit.

Bring back / record:
- host RAM available before render
- swap total / free
- outreach worker actual current/peak memory
- existing Reels worker actual current/peak memory
- Explainer render peak memory
- Explainer render wall time
- whether swap occurred
- selected MemoryHigh
- selected MemoryMax
- selected Nice
- dedicated-VM decision

### E-22 Supabase file-size limit against rendered video size
Decision: Final storage settings are intentionally delegated to the engineering agent. Inspect the actual Supabase project/bucket limits and compare them against the measured size of real 45-second renders before choosing target bitrate or storage fallback.
Values:
- supabase_bucket = <identify>
- supabase_max_file_size = <inspect actual project/bucket>
- target_video_bitrate_mbps = <choose after comparison>
- storage_fallback = <only if needed>

Rationale: File-size limits depend on the actual Supabase plan and bucket configuration. Rendered size depends on the real encoder settings and output. Both should be checked rather than guessed.
Unverified / still to check: Actual project plan limit, bucket-specific limit, actual rendered MP4 size, target bitrate.
Artifact:

**Required Supabase inspection**
In the actual Supabase project:
1. Open Storage.
2. Identify the bucket intended for Explainer Reel videos.
3. Inspect any bucket-level upload/file-size restriction.
4. Inspect the project/plan-level Storage upload limit in the Supabase dashboard/settings.
5. Record the exact numeric limits shown for this project.

Do not rely on historical Free-plan limits or remembered documentation.

**Theoretical 45-second H.264 video sizes**
Ignoring audio/container overhead for the moment:
```
file_size_MB ≈ bitrate_Mbps × duration_seconds / 8
```
For 45 seconds:
- 4 Mbps: 4 × 45 / 8 = 22.5 MB
- 6 Mbps: 6 × 45 / 8 = 33.75 MB
- 8 Mbps: 8 × 45 / 8 = 45 MB
- 12 Mbps: 12 × 45 / 8 = 67.5 MB

Actual files will also include audio and container overhead, so measure a real render rather than using these as exact final sizes.

**If the output exceeds the confirmed limit**
Options, in preferred order unless implementation facts suggest otherwise:
1. Lower encode bitrate
   - simplest
   - keeps current storage architecture
   - must verify visual quality remains acceptable
2. Use resumable upload if the issue is upload reliability rather than an absolute file-size ceiling
   - helps transfer reliability
   - does not solve a true hard per-file maximum
3. Store rendered videos in Google Cloud Storage
   - worker is already running on GCP
   - separates large video assets from Supabase
   - adds another storage system and access-control path

Record:
- actual bucket name
- exact Supabase max file size
- one or more measured render file sizes
- actual encoder bitrate/settings
- selected target bitrate
- whether Supabase remains the video store or GCS becomes necessary

### Remaining UNVERIFIED / Builder-Owned Items
1. Exact HeyGen voice_id for Lucas Figueroa.
2. Actual per-reel Claude + HeyGen cost after live runs.
3. Relative cost/quality/wall-time of Sonnet vs. Opus if escalation testing becomes necessary.
4. Final systemd MemoryHigh, MemoryMax, Nice, and whether a dedicated VM is required.
5. Actual Supabase project/bucket file-size limits.
6. Actual rendered MP4 size and final target bitrate.
7. Any API-specific limitation that prevents the finalized decision to use both HeyGen music and sound effects from run one.

Everything else in E-14 through E-20 should be treated as a locked product decision unless a concrete technical blocker is found.
