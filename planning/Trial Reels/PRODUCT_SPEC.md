# Trial reel engine: product spec

Lucas's product plan, verbatim. Markdown structure added for readability; the wording is unchanged. Edit only on Lucas's instruction. Build sequencing, open questions, and decisions live in `BUILD_PLAN.md`.

---

## PHASE 1: SCRAPING

a. Every day at 1 AM, ingest new material from each source destination and store it.

b. Store 3 weeks trailing of material for all 12 sources. Everything older than 3 weeks gets deleted.

c. There are 12 types of sources we are pulling from. It is your responsibility to set up the connections to all the sources and manage ingestion in a normalized manner. We need to pull the full sources (articles, posts, etc.). Body material, author and source, headline, byline, etc.

d. The 12 types of sources are separated into 2 buckets because there are two types of value we can provide to our audience: education or entertainment.

### Bucket A — Education (20)

1. GitHub Trending + REST/GraphQL API — star velocity, new releases, repo README quality. The single best "tool tip" feedstock. Open: Y | Diff: 1
2. Hacker News (Algolia Search API + Firebase API) — Show HN launches, points-per-hour, comment depth. Native engagement signal, zero friction. Open: Y | Diff: 1
3. Hugging Face Hub API — model/dataset download counts and trending, plus HF Daily Papers with community upvotes. Open: Y | Diff: 1
   - a. HF daily papers will be the main thing we use.
4. Awesome-lists and curated registries (awesome-llm, awesome-mcp-servers, awesome-selfhosted) — tool discovery with implicit human curation. Open: Y | Diff: https://github.com/brandonhimpfen/awesome-lists#artificial-intelligence-ai
5. Vendor changelogs and release notes — OpenAI, Anthropic, Google, Meta, Mistral, plus Cursor/Vercel/Supabase. First-party, fast-moving, credible. Open: Y | Diff: 2
6. Curated dev newsletters (TLDR, Bytes, Console.dev, Pointer, JavaScript Weekly) — human editors have already filtered for you. Web archives are scrapeable. Open: Y | Diff: 2

### Bucket B — Storytelling / Reporting (20)

1. Tech press RSS (TechCrunch, Ars Technica, The Verge, Wired, 404 Media) — the raw event stream that story reels react to. Open: Y | Diff: 1
2. Wikipedia + Pageviews API — canonical timelines plus a spike detector showing what the public is suddenly curious about. Open: Y | Diff: 1
3. Company blogs, incident post-mortems, and model cards — OpenAI/Anthropic/DeepMind announcements, Cloudflare outage write-ups, safety cards. First-party narrative material. Open: Y | Diff: 2
4. GH Archive (BigQuery) + GitHub issue/PR archaeology — license changes, the commit that broke a company, maintainer blowups. Fully queryable history. Open: Y | Diff: 2
5. Oral history and archive collections — Computer History Museum interviews, Stanford AI archives, AAAI archives. The backbone for "history of AI" reels. Open: Y | Diff: 2
6. Claude Web Search (runs daily and returns ONE story idea in the same data format as the other scrapes. It should skew towards storytelling content for saga and personal profile. It should always be grounded in truth, it should use the humanizer skill, and it should be weighted fairly against all other story ideas. Don't give the llm writing this story an upper hand by letting it know the criteria it's being graded against.

---

## PHASE 2: SOURCE POOL MANAGEMENT AND POST IDEA CREATION

a. Pulls everything from the last ingestion run onwards

b. Clean the sources, deduplicate/merge/link them to each other when they are about the same thing (use jev for this. We need a Jev-driven system that can identify when posts are linked or talking about the same exact thing. Jev should then make a decision about wether to group them or not. Grouping needs to be about the same STORIES, not about the same people/companies. There are many people, companies, products, and events that will be talked about recurredly. This deduplication needs to be intelligent and should be able to not only merge, but also link when two sources can work together to paint a fuller picture of the story. In that case they turn into a "post idea". A post idea can be one source or multiple sources together. There needs to be jev architecture to decide the management of what becomes a grouped post idea and what stays alone.

c. Additionally, once a specific story has been PUBLISHED (sent to meta and posted about) about a certain story then jev needs to know to let that story cool down (score penalty). The distinction here between a specific concept/story and the people/companies/products/events in AI is once again important. Just because we posted about Elon Musk's new Grok product 4 days ago doesn't mean we can't post about Elon Musk's SpaceX update today.

---

## PHASE 3: SCORE THE POSTS

Scoring post ideas is what decides which post ideas should actually be turned into a post. The net score of a post idea is going to be a combination of 4 different scores, each calculated individually by Jev.

### First, pyschology score

First, pyschology score: if we were to make a post out of this, how well could we use it to trigger one of the 3 pyschological frameworks that can drive engagement? Judge each psychological framework individually and assign 3 different scores. Once those scores are decided, they will inform the content bucket score process. After the content bucket score process runs then we will know which psychological score is being used for sure, and only that one will be used as part of the net score.

Below are the Key Psychological Frameworks for Attention & Virality

1. The Curiosity Gap & Information Foraging Theory
   - Core Theory: Loewenstein’s Information Gap Theory posits that curiosity arises when there is a mismatch between what we know and what we want to know. This gap creates a state of cognitive deprivation (an "itch") that the brain feels compelled to resolve.
   - Mechanism: Combined with Information Foraging Theory (Pirolli & Card), users scroll like animals foraging for food. Your hook serves as a "strong scent"—promising a high-reward answer for minimal cognitive effort.
   - Codified Hook Formulas:
     - The Hidden Mechanism: "There’s a reason [X common outcome] happens, and it’s not what you think."
     - The Counter-Intuitive Truth: "Why 90% of people fail at [Goal] (and the 1 tweak that fixes it)."
2. High-Arousal Emotional Contagion
   - Core Theory: Research by Jonah Berger and Katherine Milkman (What Makes Online Content Viral?) demonstrates that content transmission is driven by physiological arousal rather than emotional positivity or negativity alone.
   - Mechanism: High-arousal emotions (anger, awe, anxiety, amusement) activate the sympathetic nervous system, increasing the urge to take action (watch, comment, share). Low-arousal emotions (sadness, contentment) decrease viral transmission.
   - Codified Hook Formulas:
     - Awe / High Value: "I spent 100 hours analyzing [X complex dataset] so you don't have to."
     - Anxiety / Loss Aversion (Tversky & Kahneman): "If you do [Common Habit], stop immediately. Here's why."
3. Social Identity & Self-Signaling
   - Core Theory: Social Identity Theory (Tajfel & Turner) and Status-Signaling Frameworks. People share content to project a specific identity, signal expertise, or defend an in-group boundary.
   - Mechanism: If your hook explicitly names a specific identity, it activates self-relevance processing in the brain's Medial Prefrontal Cortex.
   - Codified Hook Formulas:
     - In-Group Callout: "If you're a designer who still uses [Tool], we need to talk."
     - Contrarian Stance: "Unpopular opinion: [Commonly accepted practice] is actually ruining your results."

### Second, content bucket score

Second, content bucket score: how well would this fit into one of our content buckets? This score must be calculated AFTER the psychological score because we need to know which Buckets are in contention. Any psychological score that came back over 0.6 should be treated as a viable option and the psychology buckets map to specific content buckets (as you can see below) so only the content buckets that are deemed as viable options AFTER the pyschology score is decided for the buckets. Additionally, if there is a 0.25 difference or greater between two of the psychology scores that came back over 0.6, only use the higher one (and the content buckets that belong to it). The content bucket that scores the highest will be used and that is the score that will be used as part of the sum for the net score.

### THE SIX BUCKETS

#### 1. Ball Knowledge Drop

- Frameworks: 1 (primary), 3 (secondary)
- Why it works: The copy names a high-reward payoff and withholds the specifics, creating the information gap. The scent is strong and the cognitive cost of resolving it is one tap to the caption. Framework 3 loads on top when the copy names the identity that should care ("if you're still paying for X").
- Live hook formulas: Counter-Intuitive Truth, In-Group Callout.
- Resolution: Deferred. The caption carries the payload.
- Copy: Names an outcome, a cost, or an identity. Never the tools. 8–14 words.
- Caption: 3–7 items. Name, one line on what it replaces or unlocks, link. Close on a line that establishes Helios as the finder.
- Feeds from: GitHub Trending, Awesome-lists, Hugging face
- Example copy: "The four repos that killed our $2,400/mo tooling bill."

#### 2. The Number

- Frameworks: 2 (primary), 1 (secondary)
- Why it works: A hard figure that contradicts expectation produces arousal through anxiety or awe, which is the transmission driver Berger and Milkman isolated. Loss aversion does the rest when the stat implies the viewer is currently losing something.
- Live hook formulas: Anxiety / Loss Aversion, Counter-Intuitive Truth.
- Resolution: Self-contained. The stat is the payload.
- Copy: One statistic, one implication. Under 15 words. No preamble.
- Caption: Source, methodology caveat, business translation. Can be told like a story with a plot.
- Feeds from: All
- Example copy: "95% of enterprise AI pilots never reach production. The failure is almost never the model."

#### 3. The Saga

- Frameworks: 1 (primary), 2 (secondary)
- Why it works: A cold open on the highest-tension moment opens the gap immediately, and chronology is the lowest-effort possible path to closing it, which is exactly the scent-to-cost ratio foraging theory predicts people follow. Arousal comes from anxiety and awe as the stakes escalate.
- Live hook formulas: Hidden Mechanism, Awe / High Value.
- Resolution: Deferred. The caption carries the payload.
- Copy: Cold open at peak tension, then chronology. 40–70 words across the runtime, materially longer than the other three.
- Caption: Tell the story in an extremely captivating way. Humanizer skill used. Short attention span writing, really quick paragraphs. Use second and third hooks to keep the reader's attention. Write semi-informally, like a human.
- Example copy: "In November 2023, the board fired Sam Altman on a Friday. By Monday, 700 of 770 employees had threatened to quit."

#### 4. Personal Profile

- Frameworks: 3 (primary), 1 (secondary)
- Why it works: Naming a person triggers self-relevance processing, and pairing two facts that can't belong to the same life opens an information gap in the same beat. The gap is sized deliberately too large to close on screen, which makes the caption the destination rather than the footnote. Sharing then signals alignment with the values the story celebrates. This is the only bucket where the caption is the product.
- Live hook formulas: Hidden Mechanism, Awe / High Value, In-Group Callout.
- Resolution: Fully deferred. The screen sells the story, the caption is the story.
- Copy: Two facts that shouldn't belong to the same person, with nothing that reconciles them. 10–18 words. No "here's how," no instruction to read the caption, no naming of the mechanism. The gap does the work and labeling it cheapens it.
- Caption: Six parts in fixed order. A fold line that survives being read alone, since platforms truncate near 125 characters and that first line is a second hook. A cold open on one scene in present tense, never a birth date. The gap stated plainly. Three or four escalating beats, one idea per paragraph, blank line between each, because white space is the pacing mechanism and a dense block reads as work. The turn, where the improbable became inevitable. A closing principle in one or two lines that hands the reader something transferable, which is what converts identification into a save and where Helios's read on the story registers as expertise without a pitch. Rhythm rules throughout: vary sentence length hard and let the short ones land, no paragraph past two phone lines, numbers and proper nouns over adjectives, and cut any sentence that explains the one before it.
- Feeds from: Claude web search, oral history archives, podcast transcripts, long-form profiles and books, Wikipedia for the timeline skeleton.
- Example copy: "He cleaned toilets at a reform school in rural Kentucky. He now runs the most valuable company on earth."

#### 5. The Warning

- Frameworks: 2 (primary), 1 (secondary)
- Why it works: Loss aversion addressed in the second person. Tversky and Kahneman's asymmetry means the threat of losing something already held produces more arousal than the promise of gaining something equivalent, and a direct address converts that arousal into the physiological urge to act rather than to keep scrolling. The gap opens on "why," which the caption closes.
- Live hook formulas: Anxiety / Loss Aversion, Hidden Mechanism.
- Resolution: Self-contained on the threat, deferred on the fix. The viewer learns what to stop on screen and what to do instead in the caption.
- Copy: Name the behavior, issue the stop, state the cost. 15–25 words. The cost has to be concrete. "It's inefficient" doesn't arouse; "it's costing you 40% of your token spend" does.
- Caption: The mechanism behind the cost, then the replacement behavior. The replacement is mandatory. A warning without a fix reads as fear-farming and gets punished in comments.
- Feeds from: Vendor changelogs and deprecations, incident post-mortems, security disclosures, benchmark results, SEC filings, regulatory texts.
- Example copy: "If you're still paying per-seat for AI tools, stop. You're funding your vendor's margin on usage you never touch."
- Guardrail: Every claim needs a source in the caption. This bucket makes falsifiable assertions about things people are actively doing, and being wrong here is more damaging than being wrong anywhere else in the system.

#### 6. The Callout

- Frameworks: 3 (primary), 2 (secondary)
- Why it works: Naming a specific identity triggers self-relevance processing, which is the strongest attention mechanism in your framework set because it makes the viewer the subject rather than the audience. Sharing then becomes in-group signaling. The secondary arousal is anger or amusement depending on which side of the line the viewer lands.
- Live hook formulas: In-Group Callout, Contrarian Stance.
- Resolution: Self-contained. The stance has to land fully on screen. A deferred callout reads as cowardice and kills the sharing impulse.
- Copy: Name the group, name the behavior, state the position. 12–22 words. No hedging, and no qualifier that lets everyone off the hook, since the boundary is the entire mechanism.
- Caption: The argument. This is the only bucket where the caption's job is to be defensible under attack, because the comment section will test it. Anticipate the strongest objection and answer it in the caption rather than in replies.
- Feeds from: HN and Reddit contrarian threads, industry surveys, benchmark results, your own delivery experience.
- Example copy: "Unpopular opinion: if your AI strategy starts with choosing a model, you've already lost the project."

Two rules on this one, because it's the highest-variance bucket you have. Aim the boundary at practices and vendors, never at the identity of your buyer. "Designers who still use X" works because the fix is available and the viewer can cross the line by changing a tool. "Executives who don't understand AI" doesn't, because the viewer can't cross it and you've converted a prospect into an opponent. Second, you must be on the side of the group you're addressing. The in-group callout works when it reads as a peer raising the standard, and fails when it reads as an outsider scolding.

### Third: Value score

There are two types of value that we can deliver to the viewer:

- Knowledge
- Entertainment

This score should be calculated AFTER the first two scores. Post ideas will usually be leaning into EITHER the knowledge or entertainment value and the psychological technique + content bucket will usually shape it roughly and we'll be able to see the value that's being communicated. Knowledge and entertainment score will each ascern HOW MUCH THE VIEWER WILL CARE ABOUT THE VALUE BEING COMMUNICATED. Will it teach them something new? Will it save/make them time or money?

### Fourth: Blockbuster score

There are certain big topics in AI that viewers care about. This includes three things: fronteir model drops, blue-chip companies, and blue-chip individuals. Frontier model drops are any time one of the pre-seeded companies releases a new product or model. The individuals and companies will be preseeded. This isn't a score on a scale of 0.00-1.00. This is a fixed, 0.4 score. If a post idea includes any of the blue chip topics then it receives this 0.4 score. If it doesn't it gets a 0.

---

Once all the timely post ideas (everything new that was pulled/grouped + any groups/linkings that were updated by new ingestion) have been scored, the top 3 will be turned into posts. Another important thing to note is that if any post ideas from the PREVIOUS DAY that were outside of the top 3 score higher than any of the top 3 today, they are also eligible to be in the 3 posts made for the day.

The chosen content bucket and psychological strategy will inform how the on-screen-text and caption are written from the source information. For now, all I want to do is produce the on-screen copy and caption for the post ideas. I want to review those two outputs. We will work on the image/video generation separately later on.
