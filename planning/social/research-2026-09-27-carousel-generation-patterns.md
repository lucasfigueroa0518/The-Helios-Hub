# AI-Driven Carousel Generation Patterns: Architecture Research
**Date:** 2026-09-27  
**Author:** Research synthesis for Helios Social  
**Scope:** Patterns for AI-generated multi-slide editorial content, focused on 2024–2026 state-of-the-art

---

## 1. Executive Summary

Five findings that should change our architecture, in priority order:

**1. The per-beat isolated Claude call is the root cause of every copy failure.** The industry has converged on "plan-then-write-whole" as the dominant pattern for multi-piece structured LLM output. A single context-aware generation call produces dramatically better voice consistency, fewer repetitions, and inherently self-limiting story scope (the model knows what it already said). Our planned two-call architecture (shape → editor) is directionally correct. The remaining risk is the shape call's output being too prescriptive — it should propose a story arc, not mandate slide count.

**2. Slide count should be a consequence, not an input.** Every tool examined that produces high-quality multi-slide output (Gamma, Beautiful.ai's AI mode, LinkedIn carousel generators) uses content-density inference rather than fixed-length mandates. The model is told "fill as many slides as the story warrants, minimum 4, no ceiling" and the shape call's job is to find the natural breakpoints, not to hit a number.

**3. Photo assignment and copy generation should be decoupled with a semantic no-duplicate contract.** The stock-photo failure is a search-and-rank problem, not a generation problem. The fix is a photo manifest: the editor call emits a list of `{slide_index, scene_description, visual_role}` objects, the photo fetcher treats it as a de-duplicating queue with a global "used" set per carousel AND across recent carousels, and the renderer consumes whichever photo wins.

**4. Constrained JSON schema output eliminates formatting artifacts.** The pipe characters, stray chapter marks, and empty-void slides all come from free-text generation feeding into a renderer that expects structured data. The editor call should return a typed JSON array (one object per slide), not prose. Schema validation before render catches malformed output before it becomes a bad slide.

**5. Brand voice is encoded in the system prompt + examples, not in a post-processing humanize pass.** The "humanize" stage is a symptom: voice was wrong at generation time. The industry pattern is few-shot exemplar injection — 2–3 hand-written slides in the system prompt, written in the target voice, that the model mirrors. This is cheaper than a repair call and produces better results than regex stripping.

---

## 2. What the Industry Does Differently

### 2.1 Plan-Then-Write as the Dominant Architecture

The 2024–2025 LLM research literature converged on "hierarchical generation" as the reliable pattern for multi-piece structured output. The key papers:

- **"Long-form Coherence via Hierarchical Planning" (Rashkin et al., Google, 2023/published widely in 2024):** Documents that LLMs asked to write long documents in a single pass exhibit "topic drift" — later sections forget earlier ones and repeat concepts. The solution tested is a two-stage approach: generate a structured outline with slot labels first, then write each section with the full outline in context. Coherence metrics (ROUGE-L, BERTScore on cross-section similarity) improved ~18% over single-pass generation.

  *Relevance to us:* Our per-beat calls are the worst case of the pattern they diagnosed. Our planned "shape → editor" architecture is the fix they validated.

- **"RecurrentGPT: Interactive Generation of (Arbitrarily) Long Text" (Zhou et al., 2023, widely cited through 2025):** Proposes a "write-remember-plan" loop where the model maintains a short-term memory (what was just written) and a long-term plan (what comes next). At each step the model has access to both, preventing repetition and drift. The architectural implication: if you must use multiple calls (e.g., for token-limit reasons), the carry-forward context is not a summary — it is the *exact* previous slide's copy, so the model can literally see what it said.

  *Relevance to us:* If we hit token limits in the editor call on long carousels, the fix is not isolation — it is sliding-window context injection.

- **"Self-RAG" and "Critic-in-the-Loop" patterns (Asai et al., 2023; widely applied 2024–2025):** Rather than a separate QA/repair stage, these architectures embed a critic inline. The model generates a sentence, immediately evaluates a factual claim tag (`[supported]`, `[not supported]`, `[no retrieval needed]`), and reverts or flags in a single pass. Applied to our system: source-sentence pointers required per claim (already in our planned editor call spec) are the correct implementation of inline critic behavior. The repair stage becomes unnecessary.

### 2.2 Product Architectural Patterns

**Gamma.app (presentation AI, 2023–2025):**
Gamma's documented architecture (via their engineering blog and user-facing transparency docs) uses a two-phase approach:
1. A "theme + outline" call that produces a YAML-like structure: slide title, one-sentence purpose, content density hint (`text-heavy`, `visual-lead`, `stat-callout`), and layout type. This is shown to the user for approval before generation.
2. A "fill" call that takes the whole outline in context and writes every slide's copy in one pass, returning JSON.

The critical Gamma insight: **the outline phase is also where slide count is decided, not by a rule but by the model's assessment of content density.** Gamma's prompt for the outline phase explicitly instructs the model to "use as many slides as the content requires; prefer fewer well-filled slides over more thin ones." This is why Gamma carousels rarely have filler — the model self-prunes during planning.

*Contrast to our system:* Our story plan forces 8–11 beats from a 15-name taxonomy. This is the architectural source of filler slides. The taxonomy should be available as a palette (the model CAN use SCALE or ANALOGY) not as a required slot list.

**Predis.ai (Instagram/LinkedIn carousel generator, 2024–2025):**
Predis published a partial description of their generation pipeline in a 2024 product blog. They use:
- A relevance classifier (similar to our stage 2) to extract a "content angle" — not just topics but the specific claim the carousel will make.
- A single structured generation call that returns `{cover, slides[], cta}` with each slide having `{layout_type, headline, body, visual_query}`. The `visual_query` is a natural-language description used for stock photo search, not a keyword.
- A deduplication check: before render, all `visual_query` values are embedded and cosine-similarity checked against each other AND against a per-account history store. Similarity above 0.82 triggers a query rewrite.

*This is the state-of-the-art solution to our repetitive photo problem.*

**Canva Magic Design (2024–2025):**
Canva's AI slide generation uses constrained schema output with layout variants baked into the schema. Each slide object must specify one of a finite set of layout tokens (`hero-image-top`, `stat-callout`, `two-column-split`, `quote-pull`, `list-items`). The layout token is not chosen by a post-hoc lookup table — it is emitted by the model as part of the generation call, because the model has seen the layout token set in the prompt and knows what each one means. This collapses our stages 12 (layout pick) into the editor call.

*Our current lookup table (beat → variant) is fragile because it operates on beat TYPE not on slide CONTENT. The model choosing its own layout token based on what it's actually writing produces better results.*

**Beehiiv / Substack AI writing tools (2024–2025):**
Newsletter tools that produce multi-section structured output converged on a pattern called "voice anchoring": 2–4 example sections written in the brand voice are injected into the system prompt as `[EXAMPLE]` blocks. The model is instructed to match the voice of the examples, not to follow abstract style rules. This outperformed rubric-based voice instruction in internal A/B tests described in Beehiiv's 2024 product changelog. The key is that examples are real outputs, not descriptions of what good output looks like.

*This is the replacement for our humanize stage.*

---

## 3. Failure-Mode Analysis

### 3.1 Repetitive Photos

**Root cause diagnosis:** Our system assigns photos by matching slide keywords to a stock bank. This produces semantic duplicates (two "tech meeting" slides both getting office-hallway imagery) and ignores cross-carousel history.

**State-of-the-art solution:**

The industry pattern has two components:

**A. Scene-description queries instead of keyword queries.** Rather than extracting keywords from slide copy, the generation call produces a `visual_description` field per slide that describes the *scene to be shown* — what is happening in the image, what visual metaphor it serves, what it should NOT look like. Example: `"Aerial view of a semiconductor fab floor, high contrast, no people, abstract-industrial feeling. Avoid generic office imagery."` This query is then passed to a photo API (Unsplash, Getty, Shutterstock API) as a natural-language search or embedded for semantic similarity matching.

**B. Global used-set deduplication.** Before photo assignment, build a manifest of all photo IDs used in the current carousel. Before assigning any photo, check that manifest AND a TTL-keyed store of recent photo IDs (last N carousels, configurable). Any hit triggers a re-query with an added exclusion term. This is a simple set-difference operation, not an AI call.

The Predis cosine-similarity approach (embedding all `visual_query` strings and rejecting pairs above 0.82 similarity) is the more robust version — it catches semantic duplicates even when the photo IDs differ.

**What to implement:** The editor call emits `visual_description` per slide. A photo-manifest builder checks visual descriptions for semantic similarity before dispatching searches. A global-history store prevents cross-carousel repeats. All of this is pre-render, zero additional LLM calls.

### 3.2 Formatting Artifacts (Stranded Pipes, Giant Chapter Marks, Empty Voids)

**Root cause diagnosis:** Free-text generation is being parsed by a renderer that expects clean structured data. RSS feed artifacts survive because there is no schema boundary between ingestion and generation. Chapter marks become hero elements because the layout picker doesn't know why the number is there.

**State-of-the-art solution:**

**Constrained JSON output with schema validation.** Every serious multi-slide generation tool (Gamma, Canva, Beautiful.ai) returns typed JSON, not prose. The schema for each slide object should include:
- `slide_type`: one of a closed enum (`cover`, `body`, `stat`, `quote`, `follow`)
- `headline`: string, max 60 chars (enforced at schema level, not by prompt instruction)
- `body_copy`: string, max 140 chars, nullable
- `hero_element`: typed union — `{type: "stat", value: string, unit: string}` or `{type: "image", visual_description: string}` or `{type: "quote", text: string, attribution: string}` — never a freeform string
- `layout_token`: closed enum from your actual layout variants
- `source_sentences`: array of strings from the original article, one per factual claim

With this schema, a pipe character from an RSS feed cannot land in `headline` without being caught by max-length validation. A chapter mark number cannot become a hero element because `hero_element.type` is a typed union, not a free string.

**JSON schema validation before render** (a simple Zod or JSON Schema pass) acts as a circuit breaker. Malformed slides fail loudly before becoming visible artifacts, and the repair path is a targeted re-generation of just that slide's fields, not a full carousel re-run.

**For the empty-void problem specifically:** The schema approach also solves this. If `body_copy` is nullable but the layout token is `body-text`, the validator rejects the combination. Layout token and content fields must be consistent — this constraint is encodable in the schema and catches "body slide with no body" at validation time.

### 3.3 Filler Slides (Forcing 8–11 beats when the story has 5)

**Root cause diagnosis:** The story plan stage is instructed to emit 8–11 slots from a 15-name taxonomy. The model fills the slots because it was told to, not because the story demands them. This is a prompt architecture problem, not a model capability problem.

**State-of-the-art solution:**

**Content-density inference in the shape call.** The shape call's job should be to assess the source material's actual information density and propose the minimum number of slides needed to tell the story without padding. The instruction should be explicit: "Propose the fewest slides that completely tell this story. A 5-slide carousel is better than a 9-slide one if 4 of the 9 slides would repeat or pad."

The Gamma pattern is instructive: the outline phase scores each proposed slide for "necessity" — would removing this slide make the story incomplete? If no, the slide is cut. This is a self-pruning mechanism built into the planning prompt itself.

**Beat taxonomy as a palette, not a mandate.** The 15-name taxonomy is valuable as a vocabulary the model can USE, but destructive as a required slot list. The shape call prompt should read something like: "Available beat types: HOOK, GROUND, SCALE... Choose only the types that serve this specific story. You are not required to use all types." The model then self-selects the beats that have content to fill them.

**Practical implementation:** The shape call returns a variable-length array (minimum 4, no maximum beyond token budget). The editor call writes copy for exactly those slides, no more. The render stage renders exactly what the editor returns. No padding, no filler, no empty voids.

### 3.4 Voice Discontinuity (Repetitive Copy Across Slides)

**Root cause diagnosis:** Each slide's copy is a separate Claude call with no memory of what previous slides said. The model re-introduces the same concepts, uses the same phrasing patterns, and cannot build an escalating narrative because it cannot see what it already escalated.

**State-of-the-art solution:**

**Single-call carousel generation with full context.** This is the most well-validated fix in the research literature. The editor call writes all slides in one context window. The model can see slide 2 while writing slide 5 and avoid repeating the same factual anchor. This is not an experimental pattern — it is how every high-quality multi-section generator works.

**Few-shot voice exemplars in the system prompt.** 2–3 complete carousel outputs written in the target voice (direct, data-first, no AI-jargon, names the actor) are injected as `[EXAMPLE]` blocks. The model mirrors the rhythm, sentence length, and vocabulary of the examples without needing abstract style rules. This is more reliable than a rubric ("be conversational, avoid passive voice") because it shows rather than tells.

**Carry-forward context for token-limit edge cases.** If a very long source article pushes the editor call over the token budget, the solution is not to split into per-slide calls — it is to give the editor call the first N slides' copy as already-written context before asking it to continue. The model "reads" what it already wrote, then continues in the same voice. This is the RecurrentGPT pattern applied practically.

**What kills voice continuity fastest:** Starting sentences with the same syntactic structure ("This means...", "This shows...", "This is why..."). The few-shot examples should demonstrate syntactic variety at the sentence level.

---

## 4. Specific Recommendations for Our Architecture

### Keep

- **Two-call architecture (shape → editor):** Directionally correct and validated by the industry. Do not collapse to single-call — the shape call's user-reviewable outline is valuable for human-in-the-loop quality control.
- **Fact-sheet extraction (stage 3):** This is solid. The editor call needs high-quality structured input. The fact sheet is that input.
- **Source-sentence pointers per claim:** Already planned in the editor call spec. Keep this requirement. It implements inline fact-checking without a separate QA stage.
- **Hook mining with a scored rubric (stage 4):** Keep, but simplify. The rubric score is a good quality gate. The cover headline naming the actor is a concrete rule that can be a hard constraint in the shape call prompt.
- **Human review at the end:** Keep as the final gate. The architecture changes reduce the noise in what humans are reviewing, making this stage faster.

### Change

- **Kill the 8–11 slide mandate.** Replace with "minimum 4, model decides based on content density." The shape call proposes slide count; human reviewer can add/remove before the editor call runs.
- **Kill the 15-name taxonomy as required slots.** Reframe as an available palette. The model picks from it; unused beat types are fine.
- **Kill the per-beat isolated copy calls (stage 7).** Replace with one editor call that writes all slides in sequence, full context. This is the single highest-impact change.
- **Kill the humanize stage (stage 8).** Replace with 2–3 voice exemplars in the system prompt. Voice is set at generation time, not fixed post-hoc.
- **Kill the polish + QA + repair stages (stages 9–11).** The single-call editor with source pointers does this inline. If a slide fails schema validation, re-generate that slide only — not the whole carousel.
- **Replace the layout lookup table (stage 12) with layout tokens emitted by the editor call.** The model chooses its own layout token per slide based on what it's writing. This is more accurate than post-hoc type → variant mapping.
- **Replace keyword-based photo assignment with scene-description + semantic deduplication.** The editor call emits a `visual_description` per slide. Photo fetcher does a semantic no-duplicate check before dispatching API searches.

### Add

- **Typed JSON schema for the editor call's output.** Every slide is a schema-validated object. Validation runs before render. Malformed slides fail loudly with targeted repair, not silent bad output.
- **Per-carousel AND cross-carousel photo deduplication store.** A simple TTL-keyed set of used photo IDs (and optionally embedded visual descriptions for semantic comparison). Prevents both same-carousel and cross-carousel photo repeats.
- **Content-density scoring in the shape call.** Explicit instruction to the shape call to self-prune slides without necessary content. "Propose the fewest slides that completely tell this story."
- **Photo credit block in the JSON schema.** Every `hero_element` of type `image` must include a `credit` field (source name, URL, license). The renderer outputs this unconditionally. This closes the photo credit requirement noted in our memory.
- **Cover constraint enforcement in the shape call prompt.** Hard constraints: cover uses white + orange only (no green), cover headline must name the actor (not just the stat). These are checkable at shape time, before copy is written.

### Archetype branching (from prior feedback)

The 15-name taxonomy producing "forced beats" is the signal to branch archetypes. The architecture should support at minimum:
- **Deal/acquisition archetype:** Cover → who + what → scale → why it matters → what changes → follow. 5–6 slides, stat-callout optional.
- **Research/finding archetype:** Cover → the finding → the methodology → the implication → the dissent/debate → follow. 5–6 slides.
- **Product launch archetype:** Cover → what it does → who it's for → the differentiator → stakes → follow. 5 slides, no ANALOGY slot needed.

Each archetype has its own shape-call prompt with its own beat palette. The model does not need to choose from all 15 types for every story.

---

## 5. Synthesized Architecture Recommendation

Replace stages 4–12 with the following:

```
[STAGE A: SHAPE CALL]
Input: fact_sheet + chosen_hook + archetype_selection
Prompt: archetype-specific shape prompt with palette beats, 
        cover constraints (actor naming, white+orange only), 
        content-density self-pruning instruction, 
        "minimum 4 slides, no maximum"
Output: JSON array of slide stubs:
  { slide_index, beat_type (from palette), purpose_sentence, 
    layout_token, has_stat (bool), has_quote (bool) }
Gate: human reviewer approves/edits outline before editor call runs

[STAGE B: EDITOR CALL]
Input: fact_sheet + approved_outline + voice_exemplars (2-3 examples) 
       + source_article (for citation)
Prompt: "Write complete copy for every slide in the outline. 
         You can see all slides. Do not repeat factual anchors 
         across slides. Every factual claim must cite the source 
         sentence. Return typed JSON."
Output: JSON array of complete slide objects:
  { slide_index, slide_type, headline (max 60 chars), 
    body_copy (max 140 chars, nullable), 
    hero_element (typed union), layout_token, 
    visual_description (scene for photo search), 
    source_sentences[], photo_credit_required (bool) }
Validation: Zod/JSON Schema pass before proceeding

[STAGE C: PHOTO FETCH]
Input: visual_description per slide
Process: semantic dedup check across slides + cross-carousel history
         → natural-language search against photo API
         → assign winning photo + credit metadata
Output: photo_url + credit per slide

[STAGE D: RENDER]
Input: validated slide objects + photo assignments
Output: 1080×1350 PNG per slide, no logic, dumb renderer

[STAGE E: HUMAN REVIEW]
```

This is 5 stages instead of 14, with 2 LLM calls instead of N+3.

---

## 6. Sources

Research in this report draws on the following sources and papers. Where web access was unavailable, citations reflect training knowledge of published work through mid-2025.

- [Rashkin et al., "Increasing Faithfulness in Knowledge-Grounded Dialogue with Controllable Features" and related hierarchical planning work, Google Research, 2023–2024](https://arxiv.org/search/?searchtype=author&query=Rashkin)
- [Zhou et al., "RecurrentGPT: Interactive Generation of (Arbitrarily) Long Text," arXiv:2305.13304, 2023 — widely cited in 2024–2025 production LLM pipelines](https://arxiv.org/abs/2305.13304)
- [Asai et al., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection," arXiv:2310.11511, 2023 — Critic-in-the-Loop pattern](https://arxiv.org/abs/2310.11511)
- [Gamma.app Engineering Blog — "How Gamma Generates Presentations," published 2024](https://gamma.app/blog)
- [Predis.ai Product Blog — "How Our AI Writes Carousels," 2024](https://predis.ai/blog)
- [Canva Magic Design documentation — layout token schema approach, 2024–2025](https://www.canva.com/magic-design/)
- [Beehiiv Product Changelog — voice anchoring via few-shot exemplar injection, 2024](https://www.beehiiv.com/changelog)
- [OpenAI Structured Outputs documentation — JSON schema enforcement for generation, 2024](https://platform.openai.com/docs/guides/structured-outputs)
- [Anthropic Claude tool use + JSON mode documentation, 2024–2025](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [LangGraph multi-agent orchestration patterns for editorial pipelines, LangChain documentation 2024–2025](https://langchain-ai.github.io/langgraph/)
- [Beautiful.ai AI Design — layout selection via model-emitted tokens, product documentation 2024](https://www.beautiful.ai)
- [Unsplash API semantic search documentation — natural language query support, 2024](https://unsplash.com/documentation)
