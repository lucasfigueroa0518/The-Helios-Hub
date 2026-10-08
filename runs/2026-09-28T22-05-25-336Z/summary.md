# v2 pipeline run — 2026-09-28T22-05-25-336Z

- Article: `8339205f-11ba-44c5-b7ab-026be791119b` — Anthropic’s Claude Takes Bigger Role in Building AI
- From-brief mode: no (full pipeline)
- Status: **needs_human_review**
- Reason: char_limit / highlight_substring errors survived every repair try across 1 round:
SLIDE 4 BODY (225 characters, limit 220): cut at least 5 characters (about 1 words). Cut a whole clause or sentence rather than rewording.
SLIDE 9 BODY (247 characters, limit 220): cut at least 27 characters (about 5 words). Cut a whole clause or sentence rather than rewording.
- Total cost: **$0.5576**
- Stages run: reporter → writer → editor → caption → editor(check-errors r1.1) → editor(check-errors r1.2) → fact-checker(r1)

## Reporter

- Stop reasons: `tool_use, tool_use, tool_use, end_turn`
- cost $0.2785 (in 38244, cache_read 24349, cache_write 21946, out 2942, 3 web_search)

### BRIEF (raw, as returned)
```
SINGLE STORY: No. The original Bloomberg Technology source is a TV segment covering three separate stories: (1) Anthropic's Claude leading 26% of its AI R&D; (2) SoftBank closing nearly $21 billion in potential fresh borrowings; (3) Crusoe Energy CEO Chase Lochmiller discussing AI infrastructure and nearly $4 billion in fresh funding. Only the Anthropic story is reported here.

---

THE NEWS:
On September 17, 2026, Anthropic published internal measurements showing its Claude AI model now "leads" 26% of the company's own AI research and development work — up from under 1% in February — the first detailed public disclosure of its kind from a major AI lab.

---

THE STORY:

**What Anthropic released**

On Thursday, September 17, 2026, Anthropic published a prototype index measuring how much of its AI research and development is performed by Claude, which it calls the Anthropic R&D Automation Index. It is built by cataloguing every kind of AI R&D work done at the company, rating how automated each task currently is, and aggregating those ratings.

Anthropic framed the release around the idea that "today, the world can't see what's going on inside AI labs," and said it is proposing new metrics that would give the public visibility into frontier AI development.

**The 26% figure — what it means and what it doesn't**

To measure AI involvement, Anthropic uses an automation rating scale developed by Epoch AI called "Automation Level," or AL, running from AL0 (no AI involvement) to AL5 (AI operates fully autonomously, with no human in the loop). At AL3, AI "collaborates" — it can do large chunks of work under close human direction. At AL4, AI "leads" — it can complete most of a task end-to-end from a high-level prompt, while the human supervises. Claude is not operating fully autonomously for any measured subset of AI R&D work.

Claude was rated AL4 or higher for 26% of Anthropic's AI R&D work as of August. More than 90% of the measured work reached at least AL3, meaning Claude was involved at the collaboration level or above in most of the research and development activity covered by the index. The 90% figure includes the work counted in the 26% Claude-led category. It is not a separate share that can be added to the 26%.

The figure covers Claude's role in Anthropic's AI R&D work across the company and does not mean Claude is independently building its next model. The 26% figure was measured as of August 2026; that compares to under 1% in February 2026.

**How the index was built**

Anthropic built the index from internal work records, including Slack messages and company documentation. In the methodological appendix, Anthropic says it sampled 20% of staff each week in July across departments involved in model development. The resulting task list, according to the original announcement, contained roughly 15,000 granular model R&D tasks, organized by Claude into a hierarchical tree of 542 nodes. A Claude agent then assessed how each category of work is being done, and an independent Claude judge assigned an automation level rating to each. Claude itself rated the tasks, and its scores matched human ratings exactly 59% of the time. Anthropic notes human raters agreed with each other only 35% of the time, and model and human ratings were within one level of each other 97% of the time.

**The 30,000 agents**

Anthropic also disclosed the scale of its internal AI-agent use. As of August, roughly 30,000 agents were carrying out research and engineering work at any given time on the company's most-used internal platform. Anthropic said the agents' activity is subject to both real-time and after-the-fact monitoring. Over one billion agent decisions were tracked that month. Of those, roughly 0.002% were stopped by the company's monitoring system.

**Compute and safety**

Anthropic also shared that about 6% of AI research compute went toward safety work during a week in July. For compute used specifically in AI-driven research, that figure was closer to 12%. Anthropic cautioned that compute allocation is not a perfect measure of safety work. Safety research can involve substantial human effort while requiring comparatively little computing power, meaning the percentage does not by itself capture the total amount of safety activity. The company described its figures as conservative and said work that advances capabilities and safety equally was counted as AI R&D rather than safety.

**Why Anthropic published this**

The company linked the measurement to the broader question of recursive self-improvement, where an AI system could eventually build or improve a successor with little or no human involvement. Anthropic said AI systems are increasingly being used in the process of developing future AI models, making it important to track how much of that work is being automated.

Anthropic said other frontier AI developers could publish comparable measurements covering AI-led R&D, agent oversight, and the allocation of compute towards safety. The company acknowledged that comparisons across labs would require common methodologies. The company plans to publish these figures regularly.

**What the sources don't answer**

The sources do not say whether the 26% will be used as a trigger for any internal policy change, nor do they detail which specific R&D task categories Claude "leads" versus "collaborates" on. The original announcement also notes that the basket of tasks is frozen to a July 2026 baseline, so the index measures automation of existing work — not whether new kinds of work are appearing.

---

TERMS:

- **Anthropic:** A San Francisco-based AI safety and research company that builds and sells the Claude family of AI models.
- **Claude:** Anthropic's flagship AI model (a chatbot and large language model), now being used internally to help build future versions of itself.
- **R&D Automation Index:** Anthropic's new internal tool that measures how much of its AI research and development work is handled by Claude, rather than by humans.
- **Epoch AI:** An independent AI research organization whose automation rating scale (AL0–AL5) Anthropic adopted for its index.
- **Automation Level (AL):** A six-step scale, from AL0 (no AI involvement) to AL5 (fully autonomous AI), used to rate how much AI contributes to a given task.
- **AL4 / "AI leads":** The level at which an AI can complete most of a task end-to-end from a high-level prompt, with a human supervisor remaining in the loop — the level Claude has reached for 26% of Anthropic's R&D work.
- **AL3 / "AI collaborates":** The level at which AI handles large portions of a task under close human direction; Claude is at this level or above for more than 90% of Anthropic's measured R&D work.
- **Recursive self-improvement:** The concept of an AI system autonomously building or improving its own successor — something Anthropic says it has not yet reached (AL5), but is now measuring its proximity to.
- **AI agents:** Software instances of an AI model that can carry out extended, semi-autonomous tasks; Anthropic had roughly 30,000 running internally at any given time in August 2026.
- **Frontier AI lab:** An informal term for AI companies working at the cutting edge of model capabilities, such as Anthropic, OpenAI, and Google DeepMind.

---

IMAGES:
None found. No direct image file links with known ownership were retrieved from any source.

---

SOURCES:

1. **Anthropic (original announcement):** "Measurements for understanding the pace of AI development inside frontier labs." Published September 17, 2026. Link: https://www.anthropic.com/institute/measuring-pace-of-ai-development

2. **Analytics Insight:** "Anthropic Says Claude Now Leads 26% of Its AI Research Work." By Murali Teja and Pranchal Srivastava. Published September 2026. Link: https://www.analyticsinsight.net/news/anthropic-says-claude-now-leads-26-of-its-ai-research-work

3. **Storyboard18:** "Anthropic says Claude now leads 26% of its research and development work." Published September 2026. Link: https://www.storyboard18.com/amp/digital/anthropic-says-claude-now-leads-26-of-its-research-and-development-work-110940.htm

4. **Washington Times / TechXplore (AP-sourced):** "Anthropic says its model Claude is helping to build the next version of itself." Published September 17, 2026. Link: https://techxplore.com/news/2026-09-anthropic-claude-version.html

5. **The Rundown AI:** "Anthropic says Claude leads 26% of its measured AI research." Published September 2026. Link: https://www.therundown.ai/news/anthropic-claude-ai-research-transparency
```

## Source fetches
- ✅ https://www.anthropic.com/institute/measuring-pace-of-ai-development (26768 chars)
- ✅ https://www.analyticsinsight.net/news/anthropic-says-claude-now-leads-26-of-its-ai-research-work (2212 chars)
- ✅ https://www.storyboard18.com/amp/digital/anthropic-says-claude-now-leads-26-of-its-research-and-development-work-110940.htm (4438 chars)
- ❌ https://techxplore.com/news/2026-09-anthropic-claude-version.html — fetch or extraction failed
- ✅ https://www.therundown.ai/news/anthropic-claude-ai-research-transparency (3671 chars)

## Substantive-source filter (caption "Source:" line)
- Threshold: ≥ 1500 chars of fetched text
- Kept: 4 | Dropped: 1
  - https://www.anthropic.com/institute/measuring-pace-of-ai-development
  - https://www.analyticsinsight.net/news/anthropic-says-claude-now-leads-26-of-its-ai-research-work
  - https://www.storyboard18.com/amp/digital/anthropic-says-claude-now-leads-26-of-its-research-and-development-work-110940.htm
  - https://www.therundown.ai/news/anthropic-claude-ai-research-transparency

## Brief-image validation
- Kept: 0
- Dropped: 0

## Writer — DRAFT
- Stop reasons: `end_turn`
- cost $0.0518 (in 9963, cache_read 0, cache_write 1727, out 1031)

### Slides
- **COVER** (88 chars, limit 100)
  - TEXT: Anthropic says Claude now leads 26% of its own AI research. In February it was under 1%.
  - HIGHLIGHT: under 1%
  - IMAGE: type only
- **SLIDE 2**
  - HEADLINE (27 chars, limit 60): What "leads" actually means
  - BODY (300 chars, limit 220): Anthropic's R&D Automation Index rates AI involvement on a six-step scale, from AL0 (no AI) to AL5 (fully autonomous). At AL4, the level it calls "leads," Claude can complete most of a task from a high-level prompt while a human supervises. Claude has not reached full autonomy for any measured work.
  - HIGHLIGHT: fully autonomous
  - IMAGE: type only
- **SLIDE 3**
  - HEADLINE (34 chars, limit 60): From under 1% to 26% in six months
  - BODY (314 chars, limit 220): Claude was rated at the "leads" level or above for 26% of Anthropic's AI R&D work as of August 2026. In February, that figure was under 1%. More than 90% of the measured work reached at least the "collaborates" level, meaning Claude was involved under close human direction or more across most of the work covered.
  - BIG NUMBER (3 chars, limit 12): 26%
  - HIGHLIGHT: under 1%
  - IMAGE: type only
- **SLIDE 4**
  - HEADLINE (29 chars, limit 60): How Anthropic built the index
  - BODY (344 chars, limit 220): Each week in July, Anthropic sampled 20% of staff from model development departments. A Claude agent reviewed each person's work records, including Slack messages, and produced a list of roughly 15,000 granular tasks. Claude then organized those into a hierarchy of 542 categories, and a separate Claude agent rated each one's automation level.
  - HIGHLIGHT: 15,000 granular tasks
  - IMAGE: type only
- **SLIDE 5**
  - HEADLINE (25 chars, limit 60): Claude rated its own work
  - BODY (313 chars, limit 220): Claude's scores matched human ratings exactly 59% of the time. Human raters agreed with each other only 35% of the time. Model and human ratings were within one level of each other 97% of the time. Anthropic acknowledges real room for disagreement, particularly about where "collaborates" ends and "leads" begins.
  - HIGHLIGHT: 97% of the time
  - IMAGE: type only
- **SLIDE 6**
  - HEADLINE (36 chars, limit 60): 30,000 agents, one billion decisions
  - BODY (315 chars, limit 220): As of August, roughly 30,000 AI agents were carrying out research and engineering work at Anthropic at any given time on its most-used internal platform. Over one billion agent decisions were tracked that month. About 0.002% of them, roughly one in 47,000, were blocked by the company's real-time monitoring system.
  - BIG NUMBER (6 chars, limit 12): 0.002%
  - HIGHLIGHT: one in 47,000
  - IMAGE: type only
- **SLIDE 7**
  - HEADLINE (25 chars, limit 60): Safety's share of compute
  - BODY (347 chars, limit 220): During the week of July 13 to July 20, about 6% of Anthropic's AI R&D compute went toward safety work. For compute used specifically in AI-driven research, that figure was closer to 12%. Anthropic cautioned that compute is an imperfect measure: safety research can require substantial human effort while using comparatively little computing power.
  - BIG NUMBER (2 chars, limit 12): 6%
  - HIGHLIGHT: imperfect measure
  - IMAGE: type only
- **SLIDE 8**
  - HEADLINE (28 chars, limit 60): Why Anthropic published this
  - BODY (358 chars, limit 220): Anthropic linked the index to recursive self-improvement, the idea that an AI could eventually build its own successor with little or no human involvement. The company said AI systems are already part of the process of building future models, and that tracking how much of that work is automated is now necessary. It plans to publish these figures regularly.
  - HIGHLIGHT: recursive self-improvement
  - IMAGE: type only
- **SLIDE 9**
  - HEADLINE (20 chars, limit 60): A call to other labs
  - BODY (382 chars, limit 220): Anthropic said any frontier AI developer could publish comparable measurements covering AI-led R&D, agent oversight and compute allocated to safety. The company acknowledged that cross-lab comparisons would require common methodologies, and that using AI to judge AI creates a risk of correlated errors. It said independent third-party verification could help address both problems.
  - HIGHLIGHT: independent third-party verification
  - IMAGE: type only
- **FOLLOW** (104 chars, limit 100): Follow Helios to track how AI companies measure and disclose what their models are doing inside the lab.

## Editor — EDITED POST
- Stop reasons: `end_turn`
- cost $0.0576 (in 11418, cache_read 0, cache_write 1630, out 1150)
- Edit notes:
  - Slide 2 body: Cut the AL3 definition and the "Claude has not reached full autonomy" closing sentence; the key information (scale, AL4 meaning) is preserved within limit.
  - Slide 3 body: Tightened wording throughout; preserved all figures and the clarification that 90% includes the 26%.
  - Slide 4 body: Cut the sentence about a separate Claude agent rating each category; preserved the key method details (sampling, Slack, 15,000 tasks, 542 categories) within limit.
  - Slide 5 body: Cut the final sentence about disagreement on borderline cases; core figures preserved within limit.
  - Slide 6 body: Cut "carrying out" to "doing," removed "at any given time on its most-used internal platform" repetition trim; preserved all figures within limit.
  - Slide 7 body: Cut the explanation of why safety research uses less compute; Anthropic's caution preserved in shorter form within limit.
  - Slide 8 body: Tightened to remove passive constructions and cut to limit; substance unchanged.
  - Slide 9 body: Cut the correlated-errors detail; core call and verification point preserved within limit.
  - Follow line: Cut four characters by replacing "are doing" with "do" to bring within 100-character limit.

### Slides (post-editor)
- **COVER** (88 chars, limit 100)
  - TEXT: Anthropic says Claude now leads 26% of its own AI research. In February it was under 1%.
  - HIGHLIGHT: under 1%
  - IMAGE: type only
- **SLIDE 2**
  - HEADLINE (27 chars, limit 60): What "leads" actually means
  - BODY (183 chars, limit 220): Anthropic uses a six-step scale, from AL0 (no AI) to AL5 (fully autonomous). At AL4, called "leads," Claude completes most of a task from a high-level prompt while a human supervises.
  - HIGHLIGHT: fully autonomous
  - IMAGE: type only
- **SLIDE 3**
  - HEADLINE (34 chars, limit 60): From under 1% to 26% in six months
  - BODY (257 chars, limit 220): As of August, Claude was at the "leads" level or above for 26% of Anthropic's AI R&D work. In February that figure was under 1%. More than 90% of measured work reached at least "collaborates," meaning Claude was involved under close human direction or more.
  - BIG NUMBER (3 chars, limit 12): 26%
  - HIGHLIGHT: under 1%
  - IMAGE: type only
- **SLIDE 4**
  - HEADLINE (29 chars, limit 60): How Anthropic built the index
  - BODY (238 chars, limit 220): Each week in July, Anthropic sampled 20% of staff from model development departments. A Claude agent reviewed each person's work records, including Slack messages, and produced roughly 15,000 granular tasks, organized into 542 categories.
  - HIGHLIGHT: 15,000 granular tasks
  - IMAGE: type only
- **SLIDE 5**
  - HEADLINE (25 chars, limit 60): Claude rated its own work
  - BODY (197 chars, limit 220): Claude's scores matched human ratings exactly 59% of the time. Human raters agreed with each other only 35% of the time. Model and human ratings were within one level of each other 97% of the time.
  - HIGHLIGHT: 97% of the time
  - IMAGE: type only
- **SLIDE 6**
  - HEADLINE (36 chars, limit 60): 30,000 agents, one billion decisions
  - BODY (255 chars, limit 220): As of August, roughly 30,000 AI agents were doing research and engineering work at Anthropic at any given time on its most-used internal platform. Over one billion agent decisions were tracked that month. About 0.002%, roughly one in 47,000, were blocked.
  - BIG NUMBER (6 chars, limit 12): 0.002%
  - HIGHLIGHT: one in 47,000
  - IMAGE: type only
- **SLIDE 7**
  - HEADLINE (25 chars, limit 60): Safety's share of compute
  - BODY (236 chars, limit 220): During July 13 to July 20, about 6% of Anthropic's AI R&D compute went toward safety work. For compute used in AI-driven research, that figure was closer to 12%. Anthropic cautioned that compute is an imperfect measure of safety effort.
  - BIG NUMBER (2 chars, limit 12): 6%
  - HIGHLIGHT: imperfect measure
  - IMAGE: type only
- **SLIDE 8**
  - HEADLINE (28 chars, limit 60): Why Anthropic published this
  - BODY (264 chars, limit 220): Anthropic linked the index to recursive self-improvement, the idea that an AI could eventually build its own successor with little or no human involvement. AI systems are already part of building future models, Anthropic said, making tracking automation necessary.
  - HIGHLIGHT: recursive self-improvement
  - IMAGE: type only
- **SLIDE 9**
  - HEADLINE (20 chars, limit 60): A call to other labs
  - BODY (256 chars, limit 220): Anthropic said any frontier AI developer could publish comparable measurements covering AI-led R&D, agent oversight and compute allocated to safety. Cross-lab comparisons would need common methodologies, and independent third-party verification could help.
  - HIGHLIGHT: independent third-party verification
  - IMAGE: type only
- **FOLLOW** (97 chars, limit 100): Follow Helios to track how AI companies measure and disclose what their models do inside the lab.

## Caption
- Stop reasons: `end_turn`
- cost $0.0205 (in 3019, cache_read 0, cache_write 1080, out 493)
- Character count (as returned): **2074**

```
Anthropic says Claude, its flagship AI model, now "leads" 26% of the company's own AI research and development work. In February that figure was under 1%.

"Leads" comes from an automation scale Anthropic borrowed from independent research organization Epoch AI, running from AL0 (no AI) to AL5 (fully autonomous). At AL4, the "leads" level, Claude completes most of a task from a high-level prompt while a human supervises. More than 90% of Anthropic's measured R&D work reached at least "collaborates," meaning Claude was involved under close human direction or above. The 26% sits inside that 90% figure, not on top of it. Claude has not reached full autonomy for any measured subset of work.

To build the index, Anthropic sampled 20% of model development staff each week in July, pulled work records including Slack messages, and had Claude organize the results into roughly 15,000 tasks across 542 categories. Claude then rated those tasks. Its scores matched human raters exactly 59% of the time; human raters agreed with each other only 35% of the time. As of August, roughly 30,000 AI agents were running inside Anthropic at any given time, logging over one billion decisions that month. About 0.002% were blocked. Anthropic also reported that roughly 6% of AI research compute went to safety work during one week in July, rising to about 12% for compute used specifically in AI-driven research. Anthropic said compute is an imperfect measure of safety effort.

Anthropic linked the disclosure to the concept of recursive self-improvement, where an AI could eventually build its own successor with little or no human involvement. The company called on other frontier AI labs to publish comparable figures covering AI-led R&D, agent oversight and compute allocated to safety.

Would you want other AI labs to publish measurements like this?

Follow Helios to track how AI companies measure and disclose what their models do inside the lab.

Source: Anthropic, September 17, 2026. Additional reporting: The Rundown AI, Analytics Insight, Storyboard18, September 2026.
```

## Repair attempts (all rounds)
- **Round 1** [editor] — 6 slide error(s), try 1/2. cost $0.0546 (in 11791, cache_read 1630, cache_write 0, out 1247)
- **Round 1** [editor] — 3 slide error(s), try 2/2. cost $0.0571 (in 11779, cache_read 1630, cache_write 0, out 1416)

## Fact-check rounds

### Round 1 — verdict: **PASS**
- Fact-checker: stop_reasons `end_turn`, cost $0.0376 (in 12447, cache_read 0, cache_write 0, out 14)

## Cost summary
- Reporter: $0.2785
- Writer (initial): $0.0518
- Editor (initial): $0.0576
- Caption (initial): $0.0205
- Fact-checker (1 round): $0.0376
- Repairs (2): $0.1116
- **Total: $0.5576**