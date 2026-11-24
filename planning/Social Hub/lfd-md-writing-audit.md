# LFD and Morning Download writing audit

2026-11-04. Report only: no code, prompts or data were changed. No model calls, no spend. DB reads only.

## Bottom line

Our copy is more accurate and better sourced than the reference. It reads like a wire service because the prompts ask for that.

- **LFD slides:** the headline is about 50% longer than the reference, the body usually repeats the headline, and sentence two is a required "hard detail" that often adds nothing the reader cares about. LFD has no voice instruction at all.
- **Morning Download (MD):** the prompt asks for "why it matters", but the same line lets the writer skip it. About 1 frame in 5 clearly says why it matters.
- **Voice:** MD's voice line says "casual", while the humanizer it loads says factual text "stays neutral and plain". Plain wins.

The reference is a floor for clarity, not a voice to copy. Lucas's own read is that it has little personality.

## What was sampled, and what it can't tell us

| Set | Size | Read by hand | Metrics over |
|---|---|---|---|
| LFD | 14 posts, 73 stories, 2026-10-13 to 11-03 | 32 most recent stories, plus 2 captions | all 73 |
| MD | 31 sets with stories, 127 story frames (1 further set was skipped) | 24 most recent, 6 published | all 127 |
| Reference | 10 covers, 4 captions, 4 teaser slides | all | teaser slides only |

**Too small or missing to conclude:**

- **No performance data was used.** No LFD post has ever been published (7 rejected, 7 in review). Only 19 MD frames were published. Nothing here shows what earns engagement.
- **Rejections can't be explained.** All 6 MD rejections have no written reason (one note just says "regenerated"), and I found no reason field for LFD. Rejected and in-review LFD copy measure almost the same: headline 60 vs 62 characters, body 175 vs 176.
- **The numeric reference targets are weak.** They rest on 4 teaser slides, all product or demo stories. Most of our stories are finance, legal and policy. Some of the gap is story mix, not writing, and I can't say a lawsuit fits in 40 characters. Story selection (`lib/lfd/pick.ts`) was not audited.
- **Hand tags are my judgment.** That covers "repeats the headline" and "says why it matters". Treat them as directional. Copy was not fact-checked against source articles.
- **Why a line fails the fact check is unknown.** Jev's reasoning isn't stored. See the correction under #3.

## 1. What each side does that the other doesn't

**Reference does, we don't**

| Move | Reference | Ours |
|---|---|---|
| One idea in the headline | 38 to 44 characters (slides): "Glasses that turn silent speech into text" | LFD averages 60 to 62, max 70 |
| Body adds to the headline | 4 of 4 slides say how it works or who made it | LFD: about 26 of 32 first sentences restate the headline |
| Describes what the thing does | "turns IKEA manuals into interactive 3D assembly guides" | Reports the corporate event around it: raised, sued, filed, booked |
| Assumes no trade knowledge | "as you mouth words" | "62.7% on ARC-AGI-3 in the shared harness" |
| Light human reaction (captions) | "and the setup looks pretty cool", "Now we know why" | Almost none |
| Sets the stakes (captions) | "The challenge wasn't just building better models", then what it took | MD: 13 of 24 frames carry no stakes |

Lengths are closer than they look. Reference slide bodies are one sentence of 136 to 159 characters, ours are two sentences averaging 176. The bigger gap is what the words do, not how many there are.

**We do, reference doesn't**

- Named attribution on contested claims ("Anthropic says", "the Wall Street Journal reports").
- Both sides of a dispute: "Anthropic Says Claude Found a New Enzyme and a Scientist Disputes It".
- Hard numbers, and a fact check on every slide and frame.
- Self-contained MD frames with a source credit.
- No bait. The reference leans on tragedy ("passes away 21 days before its release"), a mental-health episode, "JUST IN", a closing engagement question and speculation ("could make her one of the most important people").

## 2. Weak examples from real outputs

**LFD**

| Quote | Why it's weak |
|---|---|
| "The Guardian found 29 trusts NHS England lists as benefiting from Palantir's £330m platform say it is not live or unused" (11-03) | Compressed until it stops parsing |
| "Meta Removes Facebook Pages Futurism Reported Over AI Coach Videos" (11-03) | A stack of nouns. The reader must already know who Futurism is |
| "OpenAI's Swarm Is Now Replaced by the Agents SDK" (11-01) | "Is Now" forced into the sentence, insiders only, no reason to care. The body adds "production-ready evolution", which is vendor language |
| "It has 128k max output tokens and runs on Bedrock, Google Cloud and Foundry" (10-31) | The "hard detail" as a spec sheet, with no meaning for the reader |
| "Microsoft Just Booked $10 Billion..." then "Its stake in OpenAI slipped from about 25% to 24%" (10-29) | A true number that doesn't connect to the point |
| "The Conversation calls the evidence inconclusive, as Astra hit 62.7% on ARC-AGI-3 in the shared harness" (10-29) | Benchmark jargon with no explanation |
| "Anthropic Says Watermarking Won't Hurt Claude's Text Quality", body: "A blog post argues watermarking cuts variety" (11-01) | The headline gives the claim the story disputes, so the real news is hidden |
| "xAI Wants to Buy 418 Homes if Owners Skip Data Center Lawsuit", body: "reportedly... A realtor reportedly said" (10-29) | "Wants to" states as fact what the body hedges twice. This one is a truth risk, not a style issue |
| "The start date moved from October 30 to November 20" (10-29) | The reader isn't told what started |

**MD**

| Quote | Why it's weak |
|---|---|
| "ChatGPT's Chat and Work modes are also going to merge" (11-04) | Bolted on after a user-growth story, unrelated to it |
| "House Democrats... asked Trump to preserve his Grok prompts and responses... after reports he used Grok to plan the Venezuela attack" (10-31) | The most striking fact comes last, in a subordinate clause |
| "It covers model evaluation, safety research and incident response" (10-15, published) | Reads like the press release. No why |
| "Uday Ruddarraju will take over the compute organization" (10-15, published) | Staffing logistics. No reason to care |
| "It's $50 million a year, delivered through UK-based cloud partners" (10-14, published) | Arithmetic used as the second sentence |
| "It says the model matches GLM-5.3 on cyber work with 47 percent fewer tokens per task" (10-30) | Unreadable outside the trade |
| "via Time News, The Scientist and Phys.org" (11-01) | A credit line that lists a crowd of outlets |
| "per the Wall Street Journal on Monday" with "via Futurism" (11-03) | Two credits. 6 of 80 recent frames say "per" in the headline |

**Illustrative rewrites** (same facts as printed on the slide, moved around; they would still need grounding against the source, and they must not go into a prompt):

- "29 NHS Trusts Say They Aren't Using Palantir" / "NHS England lists them as benefiting from the £330m platform, but The Guardian found it isn't live or in use. NHS England says nearly 140 trusts have reported benefits"
- "Microsoft Made $10 Billion From OpenAI Last Quarter" / "That is nearly 11% of its $92.3 billion total for the September quarter, even as its stake slipped from about 25% to 24%"
- "Two House Democrats want a briefing by November 11 on Trump's use of AI for executive decisions, after reports he used Grok to plan the Venezuela attack. They also asked him to preserve his Grok prompts and responses."

## 3. Which rule causes each pattern

| Pattern | Evidence | Rule |
|---|---|---|
| Body repeats the headline | About 26 of 32 (hand tag) | `lib/lfd/prompt.ts:17` "Sentence one: what happened." The headline has already said what happened |
| Filler second sentence | Section 2 | `lib/lfd/prompt.ts:17` "Sentence two: one hard detail". Nothing asks for meaning |
| Long headlines | Average 60 to 62 | `lib/lfd/prompt.ts:11` target 65, plus line 12 asking for name and number in one headline |
| Formula verbs, some forced | 25 of 73 headlines use the list | `lib/lfd/prompt.ts:13`. The examples act as a menu. From spec §4.2, `docs/superpowers/specs/2026-10-13-last-few-days-design.md:141` |
| Headline drops the source's hedge | xAI, 10-29 | Line 13 pulls toward confident verbs, and line 14 only guards against invented colour |
| No voice in LFD | No voice line, and no humanizer | `lib/lfd/prompt.ts:9` is the whole tone instruction: "punchy and literally true" |
| The setup line never appears | **0 of 73** | `lib/lfd/prompt.ts:21` makes it optional, "only when natural", so the writer takes the safe default. It is the one slot built for a human angle |
| MD's why is often missing | Clear 5, partial 6, none 13, of 24 | `lib/stories/prompts.ts:30` asks "why it matters", then the same line offers "the consequence or the key detail". The detail is the easy option |
| Pressure against inference (writer side) | "State only what the source states" sat next to "why it matters" | `lib/stories/prompts.ts:30` and the rewrite note at `morning-download.ts:144`. The fact check itself is not shown to be the cause: see the correction under #3 |
| MD voice cancels itself | Frames read neutral | `lib/stories/prompts.ts:11` "as casual as it can be" vs the humanizer's Voice section (`lib/stories/copy/humanizer.generated.ts`): "factual text stays neutral and plain" |
| Date in most frames | 47 of 80 recent frames | `lib/stories/prompts.ts:30`, from Lucas's S-15 |
| Double credits | 6 of 80 "per", and "via" on 69 of 80 | `lib/stories/prompts.ts:31` covers the credit line but says nothing about crediting inside the headline, or about one outlet only |
| Length limits disagree | Max seen 258 | Prompt and rewrite note say 240, code allows 260 (`morning-download.ts:126`) |

Jargon has no single rule behind it. Neither prompt says who the reader is. LFD says "plain words" (`lib/lfd/prompt.ts:18`), and MD says a viewer should understand it "with no other context", which the writer reads as needing no other sentence rather than no trade knowledge.

## 4. Proposed prompt changes, ranked

Proposals only. Each still needs Lucas's approval. The wording is a sketch.

**1. LFD: the body adds, never repeats** (`lib/lfd/prompt.ts:16-17`, schema `:51`, spec §4.2)
Sketch: "The body never repeats the headline. It gives what the headline left out: how it works, who it affects, what changes. One or two sentences. It must include the hard detail that makes the story real."
- Contradictions: replaces "exactly two sentences" in the prompt and the schema together. `checkSubmission` doesn't count sentences, so no code changes. Fits line 9.
- Pollution: no examples.
- Level: names the job of the body, not a list of topics.
- Knock-on: the caption call reads this body (`lib/lfd/caption-lines.ts:89`), so captions change too.

**2. MD: a required why** (`lib/stories/prompts.ts:30`, bump to `md-headlines@3`)
Sketch: "One of the two sentences must tell the viewer what this changes and for whom. A detail that doesn't serve that is left out."
- Contradictions: removes "or the key detail". Must be read with the humanizer's §13 ban on inflated significance, so the wording asks for a concrete change, not importance. Stays within S-15, which already asks for why.
- Pollution: no examples.
- Level: applies to any story type.

**3. Grounding: no change** (`lib/stories/questions.ts:101-102`)
**Correction, 2026-11-04.** This report first proposed loosening the fact check for plain consequences, based on 6 of the last 10 misses containing one. Reading all 27 misses doesn't support that:
- Most misses are plain facts with no consequence clause (for example, four HCLTech partnership frames at 0.16 to 0.21).
- Two consequence lines scored 0.10 and below even though their source text backs them (the fast-mode migration and message-threads frames). So those scores don't show the check objecting to the consequence.
- One cause it flagged looks like a fair catch: "spooked" appears nowhere in that frame's source text.
- The question's "true" definition already accepts a claim that "directly follows" from the source, so #2 works without a change here.

Possible false misses on plain facts are a separate question this audit can't answer without Jev's reasoning. If #2 frames get dropped in real runs, look at this again.

**4. LFD: shorter headlines, and verbs that are true** (`lib/lfd/prompt.ts:11-14`)
Sketch: target about 50 characters, hard max stays 70. One idea per headline. Replace the verb list with: "Use the plainest verb that is literally true. If the source hedges (reported, in talks), the headline hedges too."
- Contradictions: line 12 asks for a name and a number, so it becomes "a name, and a number when it is the point".
- Pollution: this removes the current example menu, which is the fix.
- Level: states the class of behaviour.
- Check: 50 is my estimate, not a measurement (4-slide reference). Shorter headlines may leave slides looking empty, so it needs a human look at a real render.
- The hedge clause is worth adding on its own even if the rest is declined, because it's a truth risk.

**5. Name the reader, in both prompts** (`lib/lfd/prompt.ts:18`, `lib/stories/prompts.ts:30`)
Sketch: "The reader follows AI on Instagram but doesn't read the trade press. Explain or drop internal terms, benchmarks, framework names and outlets they wouldn't know, and describe what a thing does before what it's called."
- Contradictions: none. It may conflict with lead-with-a-name only for unknown names, where "describe" wins.
- Pollution: names term classes, not specific products.
- Level: correct, about the reader rather than a word list.

**6. Voice, after the personality work lands** (`lib/lfd/prompt.ts:9`, `lib/stories/prompts.ts:11`)
LFD needs a voice line, and MD's needs to survive the humanizer. Add to MD's VOICE that this is social writing, not reference text, so the humanizer's neutral rule doesn't apply. Leave the humanizer itself alone (frozen, S-17).
- **Hold the wording until the personality rebuild in the other session is settled**, so there is one voice source rather than a third one. This audit didn't read or touch `lib/personality`.
- Lucas's words to carry: professional, warm, unpretentious, confident, curious, knowledgeable. Avoid a list of sample phrases, since the writer would copy them.
- Optional: give LFD the humanizer too. It's a cached prefix of about 7k tokens (rough estimate from 28.8 KB), so a small cost. Spec §4.2 already expects these rules, but the prompt only carries a fragment at line 18.

**7. MD: one credit** (`lib/stories/prompts.ts:31`)
Sketch: "Name one outlet. Credit it only on the source line; inside the headline, attribute only a claim that's disputed, exclusive or a company's own."
- "A company's own" was added when applying this, so a company's self-reported number isn't stated as plain fact.
- Contradiction: LFD's credit rule is a separate prompt, so no conflict.
- Housekeeping: the code limit is now 240, matching the prompt (`morning-download.ts:126`). 4 of 127 past frames ran over 240.

**Lucas's calls, no recommendation to change yet**

- **The setup line (0 of 73).** Give it a real job once voice is settled, or remove it (`lib/lfd/prompt.ts:21`, `write.ts:20`). Don't force a quota: a mandatory personal aside on news slides is how copy starts to sound weird.
- **Dates in MD (47 of 80).** S-15 asks for "when", so I'm not reopening it. If frames feel cluttered, "only when the date changes the meaning" is the small version.
- **Title case vs sentence case.** The reference slides use sentence case, but the sample can't show which is better, and the highlight design depends on the headline.

## What should not change

- Fact discipline: "literally true", colour only from the source, and the grounding gate for names, numbers and dates.
- Untrusted-source handling, one story per frame, and one story never split.
- The anti-hype list, no em dashes, no rhetorical questions on slides.
- Lead with a name or number where it is the point, and attribution of contested claims.
- Two-sided stories, plus the slides that already work:
  - "Google's Satellite Just Ran Gemma 4 in Orbit and Wrote a Haiku"
  - "Alphabet Stock Just Had Its Worst Day Ever, Losing $500 Billion"
  - "Sam Altman Says RAM Belongs in Data Centers, Not on Your Desk"
  - "Meta Quietly Launches Style Sketch, an AI Outfit Planner" (the closest to the reference)
  - MD's "Google's own AI Mode search feature is part of the reason, an executive said" and "That's enough for air conditioners in about 700,000 homes"
- MD's self-contained one or two sentences and its source tag (S-15).
- Don't borrow from the reference: tragedy or health bait, "JUST IN", closing engagement questions, cliffhangers, speculation about importance, or any of its stories as prompt examples.

## Checks across the set, if all were adopted

- **Contradictions:** with #1, #2 and #4 applied, nothing still asks for a filler detail. #2 ships without a fact-check change (see #3). #6 removes the casual vs neutral conflict.
- **Example pollution:** net fewer examples. The verb menu goes. Nothing from the reference or from real outputs enters a prompt.
- **Level:** every proposal states a job or a class of behaviour.
- **Shipping:** a real test needs a human-triggered run (Rule 1). Prompt changes on these types also need the social worker redeployed.
