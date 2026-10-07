# Hook pass: draft prompt (not live; needs Tommy's OK before any run)

This is Lucas's proposal (2026-10-06): after the Editor, add at most one short lead-in or tease line per slide, so each slide hands off to the next. The Fact-checker runs after it.

Classification: `new stage · Hook pass · +1 stage · +1 AI call`

## Where it sits

Writer → Editor → **Hook pass** → Fact-checker → mechanical → design

## The prompt (system, cached; the voice block follows it)

```
You are the Hook editor for Helios Group's Instagram carousels. You get the edited draft (cover, slides, caption) and the BRIEF. Read it as the target reader: smart and busy, curious about AI, doesn't follow AI news. Your one job: make each slide hand off to the next.

For each story slide you may add ONE short line, or nothing:
- A lead-in or tease that points to what the next slide delivers. Example: on the slide before a quote, tease who answers ("A governor answered in five words."), using only what the next slide already says.
- At most once per post, a "why this matters to you" line, using only the brief's WHY IT MATTERS and FACTS.

RULES
- Never rewrite, cut or reorder existing text. You only add lines.
- Add no facts. Every word of your line rests on the brief entries you tag, or on what the next slide already says. Tag the line with those IDs (F3, B1, Q2, N1).
- Tease only what the next slide actually delivers. Never invent suspense or hold back the news.
- Stay within each slide's character budget (given per slide). A line over budget is dropped.
- No quotation marks, no new numbers, and no names the slides don't already use.
- Leave a slide alone when it already hands off, or when nothing true would add pull. Adding nothing is a good answer.

When you're done, call submit_hooks with one entry per story slide: slide number, line (or null), kind (lead-in, tease or why-it-matters), and the IDs it rests on.
```

## The user message (per post, not cached)

The edited draft (IDs and claim tags, as the Editor submitted it), the brief, and one budget line per slide:

```
BUDGETS
SLIDE 2: 70 characters
SLIDE 3: 0 characters (full)
…
```

## What code does
- **Budget per slide:** measured on the rendered slide, never guessed. Code renders the slide with a hook line of increasing length in headless Chrome and takes the longest that still passes the text-fit and bounds checks. A slide with no room gets 0.
- **Code check, with one retry like every stage:**
  - existing text is unchanged;
  - at most one line per slide;
  - at most one "why this matters to you" line per post;
  - each line within budget;
  - no quotation marks, and no numbers that aren't in the tagged entries;
  - every tag is a brief ID.
- **Rendering:** the line becomes a new `hook` field on the slide, drawn under the slide's copy in a smaller, distinct style. The M7 dropped-text check (C7) covers it.
- **Fact-checker:** runs after it and reads the hook lines as slide text.

## Prototype run (after the prompt is approved)
- **Inputs:** today's 2 saved drafts (Mistral and Altman, `runs/daily-2026-10-06T21-17-07-066Z`).
- **Steps:** Hook pass → Fact-checker → mechanical → render, offline photos reused.
- **Stop:** no pipeline wiring until Lucas has reviewed.
- **Estimated cost:**

| Item | Estimate |
|---|---|
| Hook pass per post | about $0.05 (≈9k input tokens, mostly cached, plus ≈1k output) |
| Fact-checker rerun per post | about $0.03 |
| Model | Sonnet 5.5, high effort, its own setting in STAGE_MODELS |
| **Total, 2 posts** | **about $0.16–0.20, under a $0.25 cap** |
