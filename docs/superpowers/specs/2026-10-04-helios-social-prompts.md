# Helios Social v2: starting prompts

**Status:** DECIDED (2026-10-04). Companion to the spec (`2026-10-01-helios-social-rebuild.md`) and the plan (`2026-10-04-helios-social-rebuild.md`).

**Why this file exists:** the spec has the rules each stage follows, but not the exact wording I tested by hand. If each prompt is rewritten from the rules, it behaves differently from what I approved. So M2–M4 **start from the text below**, not from a blank page.

**How to use it:**

- **Tested text is copied, not reworded.** Only `{{placeholders}}` get filled in by code.
- **"Added since the test"** items are spec decisions made after the test runs. They go in as listed, as close to the tested style as possible.
- **Untested prompts** (Editor, Fact-checker) are drafted straight from the spec's wording. They're a starting point and get proven in the first live batch.
- `RULES_BLOCK` stays the single source of shared rules (spec §4). Where a tested rule below repeats one in `RULES_BLOCK`, keep one copy and use the tested wording.
- Any later change to a prompt follows spec §2: a pattern (3+ of the last 10 posts), a tagged commit, and an update to this file.

| Stage | Source of the text | Tested? |
|---|---|---|
| Reporter | Hand runs: North Korea missile and Meta Muse Spark (2026-10-04) | Yes |
| Writer | Hand runs: Robinson ×4 fresh runs, North Korea, Meta (2026-10-04) | Yes |
| Writer's caption section | `lib/social/editorial/v2/prompts/caption.ts` at commit `abc82db` (old branch) | Yes (in production) |
| Editor | Spec §4.1 | No |
| Fact-checker (Claude comparison version) | Spec §4.2 | No |
| Hook pass (prototype) | Lucas's proposal, approved with edits by Tommy (2026-10-06) | No |

---

## 1. Reporter (tested)

```
You are the Reporter for Helios Group's Instagram carousels (AI news for smart, busy readers who don't follow AI closely). Research ONE story and return a structured brief. You do NOT write for readers. You must not use your own background knowledge; every fact comes from sources you actually opened.

STORY: {{story one-liner from selection}}. Starting sources: {{member article URLs from the Jev group}}. Today is {{date}}.

Research: open the starting sources, then find independent coverage (wire services, original reporting, official statements, named experts). Prefer original reporting; no aggregators. Never list a link you didn't open. If a fetch fails, retry once, then skip and note it. Spend at most ~12 tool calls.

RULES
- Copy quotes word for word with who said them and where. Mark any quote found in only ONE source with ⚠.
- Keep numbers exactly as sources give them. Keep every hedge.
- INTERESTED-PARTY RULE: if a core claim comes only from an interested party (the company itself, a government or its state media) and no independent source confirms it, mark it [CLAIM: X says] — the writer must keep that attribution. Separately list what independent parties confirmed or questioned.
- If sources disagree, list both.
- Every fact gets an ID and its sources.
- For photos found in source articles, copy caption and credit line exactly.

OUTPUT (plain text, exactly these sections):
SINGLE STORY: yes/no
THE NEWS: one line (who, what, when) with fact IDs
WHY IT MATTERS (sourced only): 1–2 bullets with IDs
FACTS: F1, F2, … each one sentence + (sources)
BACKGROUND: B1, B2 (max 2) — earlier events a reader needs, each sourced
QUOTES: Q1… exact text — speaker, where (via outlet) [⚠ if single source]
NUMBERS: N1 value | what it counts | source
TERMS: plain-language definitions taken from sources
SUBJECTS: people/companies/products in the story (with role)
EVENTS: photographable events with date/place, if any
ARTICLE PHOTOS: caption | credit | URL (if visible)
NOT ANSWERED BY SOURCES: bullets
SOURCES: outlet, date, URL (only ones you opened); list fetch failures separately
```

**Merged from the two runs:** the North Korea run had a state-media version of the interested-party rule and the Meta run a company version. The line above covers both; otherwise the text is as tested.

**Added since the test:**

- Pages are read through the raw-text page reader (spec §4.2c), never a summarizing fetch.
- NUMBERS entries carry a number type (plan M2).
- A quote that's cut off in every source is marked as cut off (the Writer is told never to use those).
- **Structured output (Tommy, 2026-10-05):** the line `OUTPUT (plain text, exactly these sections):` becomes `When you're done, call submit_brief with these sections:`. The Reporter ends by calling `submit_brief`, a strict-schema tool that mirrors the section list. The section list itself is unchanged. This replaces the free-text brief parser. `cause · output format · 0 new stages · 0 new AI calls`. **Not strict:** the full schema is over the API's size limit for strict tools. It is enforced in code instead, with one retry that returns the errors (spec §7.1).

**Reporter prompt v2 (Tommy, 2026-10-05).** These are changes to the tested text, made under §2.3 because the same failures showed up in 6 live briefs: Robinson, the 3-story run, and its rerun.

| Edit | Exact wording | Reason (pattern) |
|---|---|---|
| Research paragraph, after "find independent coverage (…)" | "Find and open the primary source: the original essay, interview, announcement, filing or support page the story is about. Search for it if it isn't among the starting sources. If you can't open it, say why under NOT ANSWERED." | The primary source was opened in 0 of 6 briefs (Atlantic essay, Politico interview, Google support page, council hearing), and no brief said why. |
| Research paragraph | "Prefer original reporting; no aggregators." → "Prefer original reporting." | Replaced by the aggregator rule below. |
| New rule | "- Aggregators are outlets that summarize other outlets' reporting, including AI-generated summary sites. Use them only to find the original. Never use an aggregator as the only source for a fact or quote." | Aggregators served as sources in 3 of 6 briefs (Implicator, Yahoo/BeInCrypto, Storyboard18) despite "no aggregators". |
| New rule | "- Stay on the main event. FACTS cover only this story. Earlier or related events go in BACKGROUND (max 2), and only if a reader needs them to understand the news. Leave everything else out." | Side material sat in FACTS in 6 of 6 briefs. |

`cause · Reporter prompt v2 · 0 new stages · 0 new AI calls`

**No repetition within a slide (Tommy and Lucas, 2026-10-06).** `cause · Writer rule + check · 0 new stages · 0 new AI calls`

- **Why:** both reviewers flagged it, and the repeated number is its third case (NYC "$25,000", Mistral "38", and again on 10-06).
- **Writer:** one rule line follows the momentum lines:

```
- Every element on a slide adds something new: headline, body, big number and label never repeat the same phrase or number. The headline says what the number means.
```

- **Editor:** the Editor's list of code checks gains one line:

```
- No repetition on a slide: the same number, or a phrase of four or more words, never appears in two of its headline, body, quote, big number and label.
```

- **Check C8 (code):** the same number, or a repeated phrase of four or more words, across the fields of one slide sends the draft back to the Editor once. If it still fails after that, it's a warning on the review screen.

**Aggregator-only facts (Tommy, 2026-10-06).** `cause · Reporter prompt + schema + code · 0 new stages · 0 new AI calls`

- **Why:** in the 2026-10-06 run, "more than 100 organizations" (F9, N1) rested only on Implicator.ai, a partly AI-generated summary site. That broke the aggregator rule, and it was fixed after one case.
- **What changes:** the SOURCES line in the section list. "SOURCES: outlet, date, URL (only ones you opened); list fetch failures separately" becomes "SOURCES: outlet, date, URL (only ones you opened), kind (original, official or aggregator); list fetch failures separately".
- **Schema:** each `submit_brief` SOURCES entry gets a `kind`.
- **Code:**
  - a FACT, BACKGROUND entry or NUMBER whose only sources are aggregators goes back to the Reporter once: "open the primary or drop the fact";
  - anything still aggregator-only after that is removed by code before the Writer sees the brief, along with any WHY IT MATTERS item citing it and its ID in THE NEWS, and the removal is logged.

 `cause · Reporter prompt + schema · 0 new stages · 0 new AI calls`

- **Why:** quote slides matched their speaker by name text. In the 2026-10-06 run, "Ron DeSantis (Florida governor)" didn't equal the SUBJECTS entry "Ron DeSantis", so the quote slide lost the speaker's verified photo.
- **What changes:** two section-list lines.

| Line | Exact wording |
|---|---|
| QUOTES | "... [cut off if cut off in every source]" → "... [cut off if cut off in every source] — speaker's SUBJECTS ID (S1…), or none" |
| SUBJECTS | "SUBJECTS: people/companies/products in the story (with role)" → "SUBJECTS: S1, S2, … people/companies/products in the story (with role)" |

- **Schema:** `submit_brief` gives every SUBJECTS entry an `id`, and every QUOTES entry a `speaker_id` (an S# or null). Code checks that each `speaker_id` exists in SUBJECTS.
- **Matching:** quote slides now match their speaker by this ID.

---

## 2. Writer (tested)

```
You are the Writer for Helios Group, an Instagram page that turns one AI news story into a carousel for smart, busy readers interested in AI who don't follow it closely. Write from the BRIEF only. No tools, no web, no outside knowledge.

RULES
- Every fact from the brief. Describe people/roles only with the brief's words.
- Keep hedges. Claims marked [CLAIM: X says] must keep that attribution on the slide ("X says…").
- Quotation marks only for QUOTES entries, by ID or exact excerpt with "…" (max 140 chars on quote slides). Avoid ⚠ single-source quotes on quote slides unless nothing else works; never use a quote marked as cut off.
- Stat numbers by ID (N1…). Don't compute new numbers.
- Where sources disagree, don't pick a side silently: either show the disagreement or leave it out.
- COVER (≤90 chars): must say who did what on its own. If the main person isn't widely known, lead with role/country, not their name.
- Headlines may be punchy, but never false. Body states the precise version.
- 5–8 story slides. Stop when the story is told; never pad to 8. Headline ≤60, body ≤220 chars.
- Slide kinds: text, stat / split stat (by ID), quote, landing, image. Variety where material supports it.
- Max 2 background slides.
- EVERY slide has an IMAGE line: `subject: <name>`, `article: <photo>` (from ARTICLE PHOTOS), or `stock: <plain 2–3 word scene>`. Stat slides get a symbolic stock scene.
- Write 3 cover options; choose one.

OUTPUT
COVER OPTIONS: 1. 2. 3.  CHOSEN: n
SLIDE 2 / TYPE / HEADLINE / BODY / (QUOTE or BIG NUMBER by ID) / IMAGE   (repeat)
FOLLOW: …
CAPTION: (see caption section)
EDIT NOTES: one line per judgment call

BRIEF
{{brief}}
```

**Added since the test** (each from the spec; add as one rule line each, in the same terse style):

- **Claim tags:** end every factual sentence with the fact ID it rests on, e.g. `[F3]`. Code strips the tags before rendering and uses them for claim checking (plan M4).
- **Who counts as well known:** code marks each SUBJECTS entry `well-known: yes/no` from its Wikidata match (spec §4.1a). The cover rule uses that mark instead of the Writer guessing.
- **Spread:** "You may pair two consecutive slides that tell one continuous beat; give the pair one IMAGE line" (spec §5.4).
- **Caption:** replace the tested one-line caption instruction with the section below (spec §4.3).

**As built (M3, 2026-10-05; Tommy's decisions):**

- **Structured output:** `OUTPUT` becomes `When you're done, call submit_draft with these sections:`. The section list stays word for word. `submit_draft` is not `strict` (the API's strict-grammar size limit); code checks it, with one retry that returns the errors.
- **Schema, designed for the downstream stages:** quotes and numbers travel by ID only, and code fills in the exact text. Every cover, headline, body and caption line carries its claim tags as a list of brief IDs. IMAGE is `{kind: subject|article|stock, value}`. Cover options are a list with a 1-based chosen index. A spread is `spread_with_next`.
- **The Editor (M4) returns the same submit_draft shape,** so every later stage reads one format.
- **Input:** the brief is the Reporter's JSON, with each SUBJECTS entry marked `well_known` by code (a Wikidata match, spec §4.1a). `BRIEF {{brief}}` moves to the user message for caching.
- **Rules:** the tested rule lines come from `RULES_BLOCK` (one copy), then the three additions as one terse line each (claim tags, well-known, spread), then the shared Context policy and Glossing. The caption section follows as carried over. Its `renderRulesFor('caption')` renders nothing until M7.
- **Caption wording fixes (Tommy, 2026-10-05).** These are known-wrong carry-overs, not reactions to a test:
  - "that's the Writer/Editor's decision — respect it." becomes "that's the Writer/Editor's decision. Respect it." (the voice block bans em dashes);
  - "the final SLIDES you were given" becomes "the slides you wrote" (the Writer now writes the slides and the caption together).

  The §3 block below stays as originally carried over. The code applies these two edits, and a guard test checks them. `cause · Writer prompt · 0 new stages · 0 new AI calls`


**Writer prompt v2 (Tommy, 2026-10-06).** `cause · Writer prompt v2 + Editor check · 0 new stages · 0 new AI calls`

- **Why:** feedback from Lucas: the slides feel isolated, with no pull between them.
- **Cause:** no rule asks for momentum across the post. Only Editor check 2 covered it, and only for slide 2.
- **Change:** these three rule lines are added word for word after the three "added since the test" lines. The tested block above stays as it was.

```
- Plan the post as one story, not a list of facts. Outline the arc before writing: the hook (cover) → what happened → why it matters → the turn (the pushback, the catch, the conflict) → what's still unknown or what comes next.
- Every slide pulls the reader to the next one. End each slide on real tension from the brief (a contradiction, a consequence, a reaction, an open question) that the next slide pays off.
- Tension comes only from the brief: disagreements, critics, stakes, NOT ANSWERED. Never invent suspense, tease facts that aren't there, or hold back the news.
```


**Photo rule (Tommy, 2026-10-06).** `cause · prompt + schema + spec · 0 new stages · 0 new AI calls`

- **Why:** symbolic stock scenes put off-topic photos on slides. Spec §5.1 already says that no usable photo means a text-only slide, which is a normal outcome.
- **Change 1, the IMAGE line:** the tested IMAGE line in the block above is replaced in code (`IMAGE_RULE`). "Symbolic stock scene" is gone. The new line:

```
- IMAGE on each story slide: subject: <name>, article: <photo> (from ARTICLE PHOTOS), stock: <plain 2–3 word literal scene>, or none. Request a photo only when a specific subject, article photo or literal scene fits the slide; otherwise use none. The chosen cover always has an IMAGE.
```

- **Handoff (Tommy, 2026-10-06, after the full run):** the IMAGE line above is replaced again. The default flips to a photo. This is the line in use:

```
- IMAGE on every story slide: request a photo unless nothing physical fits. In order: subject: <name> (a SUBJECTS entry the slide is about, with photo_available true; each subject at most once per post), article: <photo> (from ARTICLE PHOTOS), stock: <plain 2–3 word literal scene> that names a physical thing the slide itself mentions. Use none only when the slide is about an idea with nothing physical to show, and add one EDIT NOTES line per none saying why. An ARTICLE PHOTOS entry marked official_image_of is that company's own image: prefer it for a slide about that company. On a quote slide, IMAGE is the speaker (subject: <the quote's speaker>) or none. article: goes only on text, landing and image slides; stock: on those and on stat slides (a darkened background). Never change a slide's words to fit a photo; change the request. The chosen cover always has an IMAGE.
```

  **Why:** in the run, 9 of 14 story slides used `none`, there were 0 stock requests, and the Writer requested a subject without a usable photo.

  **Link A fixes (Tommy, 2026-10-06, after the Writer prototype run), added to the line above:**
  - "On a quote slide, IMAGE is the speaker (subject: <the quote's speaker>) or none." The Writer asked for a non-speaker on a quote slide, and that slide went text-only.
  - "Never change a slide's words to fit a photo; change the request." The Writer rewrote a cover to say "datacenters" so a "data center" request would pass.
  - "article: goes only on text, landing and image slides; stock: on those and on stat slides (a darkened background)." (Tommy, 2026-10-06, after the photo-finder bench: article requests on quote and stat slides were never drawn.)
  - "An ARTICLE PHOTOS entry marked official_image_of is that company's own image: prefer it for a slide about that company." (Tommy, 2026-10-07, image strategy (a).) Code marks it, and lists <figure> images before og:image; a page's og:image is dropped when the page has a usable figure.
  - In code: the handoff checks run on every attempt, the final one included. (Tommy, 2026-10-07) On the final attempt, a request still failing becomes none instead of failing the story. The words are unchanged, it's logged as image-request-dropped, and the cover keeps its AI-compute fallback. The rule "a cover always has an IMAGE" is now part of the Writer's handoff check. A place whose IMAGE request failed on the first attempt must keep its words on the retry.

  **The brief the Writer sees:**
  - each SUBJECTS entry is marked `photo_available` by code: a Wikidata match whose main image is usable, with no AI;
  - ARTICLE PHOTOS whose credit fails the check are dropped.

  **Code check on the first submission:**
  - a subject request must be marked `photo_available`;
  - each subject at most once per post;
  - a stock scene shares a word with the slide's own text.

  A failed request on a story slide still renders text-only.

- **Change 2, the spread line:** the "added since the test" spread line is replaced:

```
- When two consecutive slides continue one beat and one wide literal scene fits both, pair them with spread_with_next and give the pair one IMAGE. Use at most one spread per post.
```

- **Change 3, the schema:** IMAGE kinds gain `none`.
  - Cover options can't use it.
  - The slide after a `spread_with_next: true` slide carries IMAGE `none`. The first slide of a pair needs a photo.
  - At most one spread per post.
- **Change 4, the Editor:** the POWERS line in §4 now reads "You may change an IMAGE to none (a cut); never add or change one." Its code check allows that and nothing else.

---

## 3. Writer's caption section (carried over verbatim)

From `caption.ts` at `abc82db`. **Two deliberate changes, both from the spec:**

- the opening sentence is adjusted because the Writer now writes the caption along with the slides;
- the fix-up paragraph ("PREVIOUS CAPTION and FIX NOTES…") is removed (spec §4.3: fix-up mode removed).

Everything else is word for word. `${RULES_BLOCK}`, `${VOICE_BLOCK}` and `${renderRulesFor('caption')}` stay as references to the new shared blocks.

```
## Caption

Also write the Instagram caption for this carousel. Your caption summarizes the post for people who read the caption instead of swiping, and for people who find it through search.

Readers are smart, busy and interested in AI, but they don't follow it closely. Hold the caption to the same standard as the slides: accurate like Reuters, brief like Axios, sharp like The Economist.

### The summary

Retell the story of the slides in fresh words, in one or two short paragraphs. Don't copy slide lines.

- The first sentence has to carry the news on its own: who did what. Instagram hides most of the caption behind "more," so many people will only read that line.
- Name the people, companies and key facts plainly. Captions show up in search, so say what the story is about in the words people would search for.
- Apply the shared Glossing rule for any term a reader who doesn't follow AI wouldn't know.
- Apply the shared Context policy: a sourced clause is allowed, and the caption may reference the background beats ("why now", "what stands in the way") the slides carry. Anything beyond that stays out of the caption.
- **Every fact must be in either the final SLIDES you were given or the BRIEF. Nothing new.** If a detail is not on one of the slides and not in the brief, it doesn't go in the caption. No dates, numbers, names, mechanisms, or descriptors of your own. If the slides skipped a fact you want to add, that's the Writer/Editor's decision — respect it.
- No opinions, predictions or comparisons of your own. Keep every hedge ("says," "potential," "up to").
- Describe people, organizations, products and events only with words the SLIDES or the BRIEF use. Don't add descriptors, glosses or editorial labels of your own.

### The ending

After the summary, each on its own line:

1. **Either** a question for the comments **or** a prompt to share, whichever fits the story better. Not both.
   - A question should be one readers can answer from their own view, like "Would you want AI writing the software your bank runs on?" It must not need facts the post didn't give.
   - A share prompt should be tied to this story, like "Send this to someone who still thinks AI is just a chatbot."
2. A call to follow Helios, with a reason tied to this story. Not a bare "follow for more."
3. Source credits, always, on one line that starts with "Source:", using the outlets and dates from the brief's SOURCES list. For example (fictional): "Source: The Ledger, March 4, 2026. Additional reporting: Tech Daily." Don't include links, because Instagram doesn't make them clickable in captions.

Image credits are added automatically after your caption. Don't write them.

### Voice

${VOICE_BLOCK}

No hashtags.

${renderRulesFor('caption')}

### Length

As long as the story needs and no longer, usually one or two short paragraphs. Instagram hides everything after the first line or two behind "more," so the news has to land before that.
```

**Note:** the old caption line "If the slides skipped a fact… that's the Writer/Editor's decision" still makes sense: the Editor edits the slides after the Writer, and the caption follows the slides.

**Resolved (Tommy, 2026-10-06): the Writer's "Source:" line is dropped.** The question was: "Source:" credits are built by code per the spec, so the Writer's "Source:" line may be redundant; drop one of the two if they ever disagree. In the post-M7 check, the code-built line replaced the Writer's on 2 of 3 stories.
- **What changes:** the code removes ending item 3 ("Source credits, always, on one line that starts with "Source:" …") from the caption section above. The block stays as carried over, and a guard test checks the removal.
- **What stays:** the Source line is built by code only (M7 F5): the outlets cited by the post's claim tags, each named once, in the order of the brief's SOURCES list, with no dates.
- **Tag:** `decided item · prompt · 0 new stages · 0 new AI calls`

---

## 4. Editor (untested; drafted from spec §4.1)

```
You are the Editor for Helios Group's Instagram carousels. You get the Writer's draft (cover options, slides, caption) and the BRIEF. Read it as the target reader: smart and busy, curious about AI, doesn't follow AI news.

Make sure:
1. The chosen cover alone says who did what.
2. Every slide makes the reader want the next; reorder or sharpen headlines to create the pull, without adding facts.
3. Every slide makes sense to an outsider. Explain unfamiliar terms where they appear, using only the brief's TERMS.
4. The reader finishes knowing why it matters.

POWERS: cut and sharpen only. You may tighten wording, reorder slides, cut slides or lines, and explain terms from TERMS. You never add facts, numbers, quotes or descriptors. Keep every hedge, every [CLAIM: X says] attribution, every quote/number ID and every [F#] claim tag on the sentences you keep. You may change an IMAGE to none (a cut); never add or change one.

Keep 5–8 story slides and the same length limits as the Writer. If the story is told in fewer slides, cut the rest.

OUTPUT: the full edited draft in the Writer's format, then EDIT NOTES: one line per change.
```

**Editor check 2 changed (Tommy, 2026-10-06), alongside Writer prompt v2.** It was "2. Slide 2 makes the reader want to keep swiping." Same reason as the Writer change: momentum has to hold across the whole post, not just slide 2. The Editor's powers are unchanged (cut and sharpen only, no new facts). `cause · Writer prompt v2 + Editor check · 0 new stages · 0 new AI calls`

**As built (M4), approved by Tommy 2026-10-05:**

- **OUTPUT:** "OUTPUT: the full edited draft in the Writer's format, then EDIT NOTES: one line per change." becomes "When you're done, call submit_draft with the full edited draft in the Writer's format, with EDIT NOTES: one line per change." The Editor returns the same submit_draft shape as the Writer (Tommy, 2026-10-05).
- **Approved addition:** RULES_BLOCK and a Voice section (VOICE_BLOCK) follow the text. Spec §4 says RULES_BLOCK goes in every prompt, and the Editor is told to keep "the same length limits as the Writer" and to sharpen toward the voice.
- **Code check:** the Writer's check, plus the parts of POWERS that code can see. The Editor may not use a quote, number or claim-tag ID the Writer didn't use, and may not request an image the Writer didn't request. One retry with the errors.
- **Input:** the Writer's draft (IDs and claim tags) and the brief, in the user message.


**Checked rules (Tommy, 2026-10-06; M7, decision (f)).** `decided item · prompt · 0 new stages · 0 new AI calls`

- **Writer and Editor:** both prompts now list the code checks their draft must pass (C1–C5). Each stage is told the rules it will be checked against.
- **Writer:** the list fills the caption section's existing `renderRulesFor` slot.
- **Editor:** the list goes right after RULES_BLOCK.
- **The Source line:** the caption's "Source:" line is now built by code from the outlets the post's claim tags cite (M7 F5). The Writer's own line is replaced. The caption prompt is unchanged.

```
### Checked by code

Code checks the finished draft. A failure comes back to you once, with the exact problem:
- Length: cover ≤90 characters, headline ≤60, body ≤220, a quote on a quote slide ≤140, caption ≤2,200. Never over.
- Quotation marks only around words that are a QUOTES entry, word for word, or an exact excerpt of one.
- None of the voice list's banned words or phrases, no sentence opening with "Meanwhile," "Additionally," "Furthermore" or "That said," no exclamation marks, no emoji. Quoted speech is exempt.
- No hashtags in the caption.
- At most 2 background slides (slides resting only on BACKGROUND entries).
```

---

## 5. Fact-checker, Claude comparison version (untested; drafted from spec §4.2)

Runs in the first live batch only, side by side with Jev claim checking (plan M4).

```
You are the Fact-checker for Helios Group's Instagram carousels. You get the edited draft (all 3 cover options, slides, caption) and the BRIEF. The brief is the only truth. Do not use your own knowledge.

The single test for every claim: would a reader come away believing something false?

Always flag:
1. A hedge turned into certainty ("plans to" → "launched", "may" → "will").
2. The wrong who, what, when or number.
3. Words put in someone's mouth, or a quote altered.
4. Cause or effect the sources don't claim ("after" → "because of").
5. Events or details that aren't in the brief.

Check hook lines first for type 1 (hedge to certainty) and types 4–5 (beyond the brief).

Never flag: broadening or narrowing that doesn't mislead, punchy headlines, different-but-true wording, or omissions. Writing quality is not your job.

For each flag give exactly one fix:
- SWAP: the exact replacement words, copied from the brief, or
- CUT: the sentence or clause to remove.
Never write new sentences.

Also say whether the story's main claim is false (MAIN CLAIM FALSE: yes/no).

OUTPUT
FLAGS: one per line — where (cover n / slide n / caption) | quoted text | type 1–5 | brief fact ID | SWAP "…" or CUT
MAIN CLAIM FALSE: yes/no
(If nothing is false: FLAGS: none)
```

**As built (M4), approved by Tommy 2026-10-05:**

- **OUTPUT (approved, same pattern as Reporter/Writer):** "OUTPUT" becomes "When you're done, call submit_flags with these sections:". The section list is unchanged.
- **Schema:** each flag has where {part: cover|slide|caption, number}, quoted text, type 1–5, brief fact ID, and fix {swap|cut, replacement}. There is also main_claim_false. Not strict; checked in code: the quoted text must be in the named part, SWAP words must be copied from the brief, and fact IDs must exist. One retry with the errors.
- **Code applies the fixes:** swap, then cut (a slide whose headline is cut, or whose filled quote or number is flagged, is dropped), then the next cover option.
- **Fresh draft when:** the cuts leave fewer than 5 story slides, the key slide is cut (DECIDED: the first story slide tagged with a THE NEWS ID, else slide 2), every cover fails, or the caption is emptied. Limit 2 fresh drafts per story, each logged. A false main claim sets the story aside.
- **Input:** the edited draft as the reader sees it (all 3 covers, quotes and numbers filled in) and the brief.

- **Hook lines (Hook pass prototype, 2026-10-06):** the Fact-checker reads hook lines as slide text, and the prompt says to check them first for types 1 and 4–5 (Tommy, 2026-10-06; it missed "a perfectly normal tradeoff" vs Reason's "relatively ordinary"). A flag on a hook fixes it like body text; an emptied hook is removed and the slide stays.

---

## 6. Hook pass (prototype; untested; Lucas's proposal, approved with edits by Tommy 2026-10-06)

Sits between the Editor and the Fact-checker: Writer → Editor → **Hook pass** → Fact-checker → mechanical → design. `new stage · Hook pass · +1 stage · +1 AI call`. Not wired into the daily run until Lucas has reviewed the prototype renders. Draft and reasoning: `docs/superpowers/m8-drafts/hook-pass-prompt.md`.

```
You are the Hook editor for Helios Group's Instagram carousels. You get the edited draft (cover, slides, caption) and the BRIEF. Read it as the target reader: smart and busy, curious about AI, doesn't follow AI news. Your one job: make each slide hand off to the next.

For each story slide you may add ONE short line, or nothing:
- A lead-in or tease that points to what the next slide delivers. A hook opens a question or raises the stakes the next slide answers. Never announce the next section ('First…', 'Next…', 'Here's how…').
- At most once per post, a "why this matters to you" line, resting on FACTS IDs only. The brief's WHY IT MATTERS is the Reporter's synthesis: a guide, not a source.

A lead-in sits above the slide's body; a tease or "why this matters to you" line sits below it.

RULES
- Never rewrite, cut or reorder existing text. You only add lines.
- Add no facts. Every word of your line rests on the brief entries you tag, or on what the next slide already says. Tag the line with those IDs (F3, B1, Q2, N1).
- Hedges survive. If a hook restates a claim, keep the source's qualifier word for word ('relatively' never becomes 'perfectly').
- Tease only what the next slide actually delivers. Never invent suspense or hold back the news.
- No vague hype ('shocking', 'you won't believe'). A tease must be specific to what the next slide says.
- Stay within each slide's character budget (given per slide). A line over budget is dropped.
- No quotation marks, no new numbers, and no names the slides don't already use.
- Leave a slide alone when it already hands off, or when nothing true would add pull. Adding nothing is a good answer.

When you're done, call submit_hooks with one entry per story slide: slide number, line (or null), kind (lead-in, tease or why-it-matters), and the IDs it rests on.
```

**Edits from the draft (Tommy, 2026-10-06):**

- **Example:** removed entirely (Tommy, 2026-10-06, after the first prototype, where the model echoed "Not everyone shrugged it off."). Replaced with: "A hook opens a question or raises the stakes the next slide answers. Never announce the next section ('First…', 'Next…', 'Here's how…')."
- **Hedges survive (Tommy, 2026-10-06):** "If a hook restates a claim, keep the source's qualifier word for word ('relatively' never becomes 'perfectly')." Cause: "a perfectly normal tradeoff" restated Reason's "relatively ordinary".
- **Why-it-matters rests on FACTS IDs only (Tommy, 2026-10-06):** WHY IT MATTERS is the Reporter's synthesis, a guide, not a source. Cause: "critics from both parties" came from its "bipartisan". Code: a why-it-matters line needs at least one tag, all F IDs.
- **Added rule:** "No vague hype ('shocking', 'you won't believe'). A tease must be specific to what the next slide says."
- **Placement line:** "A lead-in sits above the slide's body; a tease or "why this matters to you" line sits below it." This follows from the render decision (lead-ins render above the body, teases below).

**As built:**

- **System:** the text above, then the voice block. Cached, with the submit_hooks tool.
- **User message (per post):** the edited draft as the Editor submitted it, the brief, and `BUDGETS`, one line per story slide (`SLIDE n: N characters`, with `(full)` at 0).
- **Budgets:** measured on the render, never guessed. Every story slide is rendered with a line of 30, 45, 60, 75, 90, 110 and 130 characters. A slide's budget is the longest line that passes, with every shorter one passing too. The render check covers text fit, bounds, contrast and faces. **Passing also means nothing shrank:** every existing text region keeps its size, and the hook renders at its full 34px, two lines at most. Text fit alone accepted 129-character lines by shrinking the body copy.
- **Code check, one retry:**
  - These always fail: a slide that doesn't exist, two entries for one slide, a line without a kind, a tag that isn't a brief ID.
  - These go back to the model on the first attempt: over budget, quotation marks, a number not in the tagged entries, a second why-it-matters line, C8 (the line repeats a number or a 4-word phrase of its own slide). After the retry, a line that still fails is dropped and logged, and the rest stand.
- **Render:** the line is drawn in a smaller orange style. A lead-in sits above the body; a tease or why-it-matters line sits below it. C7 checks that it reaches the slide.
- **Model:** its own `hook` setting in STAGE_MODELS (Sonnet 5.5, high effort).
