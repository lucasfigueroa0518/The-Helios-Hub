# Helios Social copy audit (2026-09-29)

Report only. No code, prompt or run changes were made.

Scope: every prompt and code check that shapes carousel copy, traced through the two posts Lucas reviewed.
- **Google CC** (runs/2026-09-29T03-38-05-457Z). Lucas: every slide is valuable and makes its own point.
- **Gottheimer** (runs/2026-09-29T19-50-15-796Z, plus the hand-finished version in `Claude outputs/final/gottheimer/`). Lucas: the headline is dragged out across the slides.

Files read: `prompts/writer.ts`, `prompts/editor.ts`, `prompts/caption.ts`, `prompts/fact-checker.ts`, `prompts/reporter.ts`, `voice-block.ts`, `code-checks.ts`, `enforce-structure.ts`, `orchestrate.ts`, `config.ts`, both run transcripts and summaries, and the hand-finished Gottheimer `post.json`.

---

## 1. Verdict

Lucas is right, and the evidence supports his diagnosis more strongly than expected.

1. **The Gottheimer story was not thin.** The brief held about 12 distinct, usable facts. The post used about 6 of them, and spent 3 of its 7 story slides restating the headline. Several of the dropped facts were the ones that explain *why the bill matters*.
2. **The repetition is produced by the system, not by chance.** The slide-kind rules ask for a "landing" slide ("the one statement the story turns on"), a quote slide and a stat slide, and the cover and slide 2 are *required* to state the news. Put together, that gives the thesis 4 slots before any new fact is allowed in.
3. **Every repair path only subtracts.** Length errors are fixed by "cut a whole clause or sentence." Fact-check flags are fixed by "cut the claim or use the sources' own wording. Don't add new details." Nothing in the loop can ever add a fact back. Each round makes a post thinner, and the gaps get filled by restatement.
4. **The good post came from a simpler system.** Google CC was generated at 03:38, before the outline, kind lock, content-aware outline, hard rhythm check, and most of the incident-driven prompt rules existed. Its Editor pass hit `max_tokens` twice and contributed nothing, so the shipped slides are essentially the Writer's first draft plus two length repairs. The richer story helped, but the post that reads best is also the one that passed through the fewest band-aids.
5. **Nothing in the system defines what makes a slide valuable.** The Writer prompt is about 14,000 characters. Roughly one line says a slide should add something ("Each slide has a purpose... don't repeat a statement you've already made"). Dozens of lines say what a slide must not do. No code check measures new information per slide, while there are hard checks for rhythm, kind drift, lengths, highlights and banned phrases. What gets checked is what gets optimized.

---

## 2. Slide-by-slide copy analysis

For each slide: the one new thing it tells the reader, or whether it's a repeat or filler.

### Google CC (final post, 10 story slides)

| # | Kind | Headline | New information for the reader | Verdict |
|---|---|---|---|---|
| Cover | cover | Google repositions CC... as a shared household tool | What happened | News |
| 2 | text | From personal agent to household assistant | Its origin (Gmail/Calendar/Drive briefings) and the six-member limit | Partly restates the cover, then adds the origin |
| 3 | stat | Room for the whole family | 6 members per CC | New (a real number) |
| 4 | text | Users asked for this | Why: top user request; schedules, bills, meal plans | New |
| 5 | quote | Why it matters | Info spread across accounts makes coordination hard | Partial repeat of S4. The headline is a label, which the prompt bans |
| 6 | text | You control what CC sees | Three ways to share, plus weekly sender suggestions | New |
| 7 | text + stat | What it delivers each morning | Shared calendar, task list, household memory | New. The "1 shared daily brief" stat is filler added to satisfy variety |
| 8 | text | CC can act on the family's behalf | Pre-fills forms, builds lists, checks drive times | New |
| 9 | stat | One big limit | 18+, U.S. only, personal Gmail, no school accounts | New |
| 10 | text | Not the only player in the game | Ollie and Fambot | New, but breaks the main-story rule as written |
| 11 | text | How it all works | Isolated cloud computer, Gemini, Antigravity | New |

About 9 of 10 slides add something. The pattern: **each slide answers a different question a reader would ask.** What is it? How many people? Why now? What do I control? What does it do? What can't it do? Who else is doing this? How does it work?

### Gottheimer (hand-finished version, 7 story slides)

| # | Kind | Headline | New information for the reader | Verdict |
|---|---|---|---|---|
| Cover | cover | Rep. Josh Gottheimer wants the NSA to test AI models before release | What he wants | News |
| 2 | text | Two bipartisan AI bills unveiled Friday | Date, venue, that there are two bills | Mostly logistics; restates the cover's "bill" |
| 3 | landing | No mandatory pre-deployment AI testing | The gap | **Repeat.** The cover already implies it |
| 4 | quote | "Right now, there are no mandatory requirements for pre-deployment testing of frontier AI models." | Nothing | **Repeat of S3, nearly word for word** |
| 5 | stat | The NSA would get 30 days to vet a model | 30 days, plus one extension | New, but no longer says *what* the NSA checks for |
| 6 | text | The FIREWALL Act would extend that ban | Second bill; Kimi K3 and Qwen | New. "That ban" points at a ban no earlier slide introduced |
| 7 | text | He's also pressing the Cyber Director | Letter to Cairncross | New, but a side thread |
| 8 | landing | Leadership refused a floor vote | No vote scheduled | New |

Cover, S2, S3 and S4 all say "no testing now, the NSA should review AI." That is Lucas's "headline dragged out", and it's measurable: 2 of 7 story slides are pure repeats and 1 more is mostly logistics.

**Facts in the brief that never reached the post:**

1. What the NSA would test for: whether a model could launch a cyberattack or help build chemical, biological or radiological weapons. It appeared in the Writer's draft and was cut by a length repair.
2. The bill would turn an existing *voluntary* White House review process (from a June 2026 executive order) into law. This is the single best "why it matters" fact. It was likely avoided under the main-story rule, since it mentions an earlier event.
3. Appeals would go through a fast track modeled on existing national-security courts.
4. Gottheimer's banking / food safety / medicine comparison. It's in the full quote the Writer tried to use, and was cut for length.
5. The co-sponsors: Lawler on one bill, LaLota on the other. Lawler's quote was swapped out during repair.
6. Agencies can buy software with Chinese models "baked in without anyone even knowing it." This was cut by the Editor to hit 220 characters (the Editor's notes show it).
7. Gottheimer's question of whether the AI supply chain should be treated as critical infrastructure.

**My own miss:** I reviewed and approved the hand-finished Gottheimer post for layout and rule compliance, and didn't flag that S3 and S4 say the same thing. I was checking the rules, not asking whether each slide earned its place. That is the same blind spot the system has.

---

## 3. Where the Gottheimer repetition entered (trace)

| Stage | What happened | Effect |
|---|---|---|
| Reporter brief | THE NEWS names both bills and the NSA review. THE STORY holds about 12 distinct facts, including the voluntary executive order, what gets tested, the appeals process and all quotes. | Good raw material. |
| Writer outline | Planned by *kind first*: `text, landing, quote, stat, text, landing, text`. S3 landing = "No mandatory AI safety checks exist today" (the thesis). S4 quote = Lawler restating the thesis. | **Repetition enters here.** Two of the four "statement" slots are filled with the thesis because the kinds were chosen before the facts. |
| Writer cover | Picked the "frame shift" option: "A Democrat and a Republican just introduced a bill to make the NSA review AI before it ships." | Cover states the thesis. |
| Writer S2 | Required by the prompt to "name who it's about and give one real fact" so it stands alone. | Restates the cover. |
| Editor, first pass | S5 body cut from 265 to 174 characters by removing the NSA gloss. S6 body cut from 461 characters: the Editor's notes show about 10 attempts, dropping the "buy software without knowing it" detail and the open-weight gloss. | Substance removed to hit 220. |
| Editor repairs (×2) | S4's Lawler quote replaced with Gottheimer's full 319-character quote (over the 140 limit, and not verbatim); S7 landing turned into a text slide. | The new quote restates S3; kind drift triggers rhythm and kind-lock errors. |
| Fact-check | Only 3 small wording flags. It has no instruction to flag repetition. | Repetition passes. |
| Hand-finish | S4 quote trimmed to its first sentence, which is the S3 headline almost word for word. The cover was rewritten to name Gottheimer. | Repetition locked in. |

**Google CC trace for contrast.** The Writer had no outline step and no kind quotas. It walked the brief's sections in order (origin, why, sharing, what it does, actions, limits, market, how it works). The Editor contributed nothing (`max_tokens` twice). Two length repairs trimmed bodies. The fact-checker passed. The structure came from *the brief's structure*, one slide per section, which happened to be a list of distinct facts.

---

## 4. Root causes (ranked): what in the system actively produces bad copy

**1. Slide kinds are chosen before facts, and three kinds are "statement" kinds that attract the thesis.**
- Writer prompt: "Landing line: HEADLINE only, for the one statement the story turns on."
- Outline spec: kinds are declared per slide first, then content is fitted to them.
- Code: `validateOutline` requires no repeated kinds and at least 3 kinds in 6+ slides. It is a hard gate, and the Writer is re-called until the *kind pattern* passes. Nothing checks whether the *content* pattern has new facts.

A story's strongest statement is its thesis, so the landing slide restates the cover. A quote slide with a 140-character limit picks the shortest quotable soundbite, which is usually the thesis too.

**2. Cover and slide 2 are both required to state the news.**
- Cover: "Someone who sees only the cover knows what happened."
- Slide 2: "Slide 2 has to make sense on its own... Name who it's about and give one real fact."
- Also in the Writer prompt: "don't repeat a statement you've already made."

These conflict. The model resolves it by restating the cover in S2, every time. Google CC's S2 does it too; it just recovers faster because the brief keeps supplying new sections.

**3. Every repair instruction subtracts; none adds.**
- Char-limit message: "cut at least N characters... **Cut a whole clause or sentence rather than rewording.**"
- Writer, Editor and Caption repair rules: "Fix a flag by **cutting the claim** or using the sources' own wording. **Don't add new details, even small ones.**"
- Editor: "Fix exactly what you were given... change nothing else."

Over two rounds, facts leave and nothing replaces them. The Gottheimer Editor notes show it deleting a specific fact ("the most expendable detail") to hit 220 characters, while the thesis slides, which are short, survive untouched. **Length pressure selects for vague sentences over specific ones**, because specific facts are longer.

**4. "Explain every term" and the 220-character limit fight inside the same slide.**
- Writer: "Explain any term or name they wouldn't know the first time it comes up, using its description under TERMS."
- Code: `term_unexplained` fires if a term's gloss isn't on that slide or the next.
- Code: body is capped at 220 characters, with the "cut a whole clause" message.

Gottheimer S6 shows the loop: the gloss pushed the body over 220 characters, the Editor cut facts, then cut the gloss, then re-added it, then cut it again (about 10 attempts in its own notes). Each gloss costs 40–70 characters of a 220-character slide.

**5. The main-story rule is written so broadly that it removes the context that makes the news matter.**
- Reporter: "Anything else is a separate story... earlier statements, later announcements, other companies' news. Leave those out."
- Writer: "No other companies, no other people, no other events, even in a subordinate clause... Earlier statements by the same subject are ALSO a different story."
- Code: `past_statement_reference` hard check.

This rule was built to stop the Suleyman post from drifting into other news. But for Gottheimer it plausibly blocked the most important sentence in the brief: the bill *codifies an existing voluntary review process*. That's not a separate story; it's what the bill changes. With context removed, the post has less to say, and the kind quotas fill the gap with restatement. The same rule, applied literally, would also have cut Google CC's best-read slide (Ollie and Fambot), which shows it isn't being applied consistently either.

**6. The prompts are an incident log, not a style guide.**

The Writer and Editor prompts now contain run-specific incident notes:
- "A live run on 2026-09-29 wrote 'There is no evidence AI is conscious today'..."
- "That's what broke rhythm on the Gottheimer run: three landings had NOTEs of 97, 119, 97 chars..."
- Suleyman, Progressive Robot, "hall of mirrors" and "alignment" examples inside a general-purpose prompt.
- "A live run on 2026-09-29 hit max_tokens..."

Each was added to patch one failure. Together they tilt the prompt heavily toward avoidance: roughly 25 "never / don't / cut" rules against about 2 lines on what good looks like. A model reading this prompt learns that the safest slide is a short, vague, unattributable restatement of the headline, which breaks no rule.

**7. Repairs are routed to the smallest model.**
- `REPAIR_EDITOR_MODEL` = Haiku 4.5 for length repairs; Writer, Editor and Fact-checker run on Sonnet 4.6.
- Length repair is where the choice of *which fact to cut* happens. That is an editorial judgment, and it is currently made by the cheapest model with the least context about story value.

---

## 5. Contradictions and pressure points

| # | Rule A | Rule B | What happens | Hypothesis status |
|---|---|---|---|---|
| 1 | Cover states what happened | S2 must stand alone with who + one fact | S2 restates the cover | **Confirmed** (both posts) |
| 2 | "Don't repeat a statement you've already made" | Landing = "the one statement the story turns on"; variety quota needs non-text kinds | Landing and quote restate the thesis | **Confirmed** (Gottheimer S3, S4) |
| 3 | "Explain every term" + `term_unexplained` check | 220-character body + "cut a whole clause" | Glosses crowd out facts, or get cut and re-trigger the check | **Confirmed** (Gottheimer S5, S6) |
| 4 | "Let the amount of real information decide the length" | 5-slide minimum + at least 3 kinds + no repeats | Filler kinds and numbers ("1 shared daily brief") | **Partly confirmed.** CC S7 has a filler stat; Gottheimer had enough facts but spent them badly |
| 5 | "Quality over targets" (your rule) | Hard numeric gates on kinds, rhythm, lengths; rhythm promoted to HARD | The system optimizes the gates, not the reading | **Confirmed** by what gets checked vs not |
| 6 | "Give each point its context" | Main-story rule bans earlier events and other parties even in a clause | Context removed; posts say less | **Plausible** (Gottheimer's voluntary-EO fact); worth confirming in the next run |
| 7 | "No framing / no invented comparisons" | Cover hook frameworks ("frame shift", "rivalry", "provocative question") | Mild; covers drift toward framing that fact-check then trims | **Minor** |
| 8 | Fact-check repairs: "cut the claim... don't add details" | Nothing ever adds a fact back | Monotonic thinning across rounds | **Confirmed** |
| 9 | Quote ≤ 140 characters, verbatim, chosen at outline time | Best quotes are long (Gottheimer's full quote is 319 characters) | The shortest soundbite wins, and it's usually the thesis | **Confirmed** |

The hypothesis that "a 5-slide minimum forces filler on a thin story" is **not the main cause here**. Gottheimer's brief was not thin. The problem was how the facts were spent, not how many there were.

---

## 6. Band-aid inventory

| Band-aid | Where | What it was patching | Keep, fold in or delete (once foundations change) |
|---|---|---|---|
| Hard rhythm check (promoted from soft) | `partitionErrors` | Editor left consecutive text slides | Make soft, or move to layout code |
| Content-aware outline + kind lock (hard) | `validateOutline`, `checkOutlineMatch` | Editor demoting landings to text | Replace with fact-first outline (rec. 1) |
| `enforceStructure` merges | `enforce-structure.ts` | Slide count and rhythm | Delete once the outline is fact-first; merging bodies blindly can create run-on slides |
| `past_statement_reference` regexes | `code-checks.ts` | Suleyman "earlier writing" | Replace with a context policy (rec. 4) |
| `sequence_incomplete` | `code-checks.ts` | Suleyman "Objection one/three" | Keep (cheap, correct) |
| Contrast regexes ("Unlike X", "not X but Y", "X, not Y") | `voice-block.ts` | Google CC invented contrast | Keep one line in voice; delete the regex zoo |
| Attribution / paraphrase / hedge / gloss / truncated-quote paragraphs with incident narratives | Writer + Editor prompts | Suleyman fact-check flags | Fold into one "accuracy" section without run stories |
| "Begin with OUTLINE/COVER, no scratchpad" + incident note | Writer, Editor | `max_tokens` blow-ups | Keep the instruction, drop the story |
| Cover-names-person rule | Writer, Editor, code | Unrecognizable Gottheimer photo | Keep (your decision); code already enforces it |
| `term_unexplained` hard-ish check | `code-checks.ts` | Undefined jargon | Relax (rec. 5) |
| Char-limit message "cut a whole clause" | `makeCharLimitMessage` | Editor rewording instead of cutting | Rewrite (rec. 3) |
| Haiku repair editor | `config.ts` | Cost | Revisit (rec. 7) |

---

## 7. What the system lacks

1. **A definition of a valuable slide.** For example: "Each slide answers a different question a reader would ask next, and tells them something no earlier slide or the cover told them." There is nothing like this today.
2. **A fact inventory.** The Writer gets prose (THE STORY). Nothing lists the distinct facts, so nothing can count which were used, which were repeated and which were dropped.
3. **A "why it matters" slot.** Readers who don't follow AI need to know what changes. Google CC got this from the brief's "Why the pivot" section by luck. Gottheimer's equivalent (voluntary becomes law) was lost.
4. **Any check for repetition.** Not in code, not in the Editor's checklist as a gate, not in the fact-checker.
5. **Any repair move that adds.** When a fact is cut for length, nothing offers the model a replacement fact from the brief.

---

## 8. Recommendations (ranked by impact)

**Foundational (do first):**

1. **Fact-first outline, not kind-first.** The Writer first lists 5–10 distinct reader questions the brief answers, each with the specific fact(s) that answer it (quoted or cited from the brief). Only then does it pick a kind per slide, based on the content: a number → stat, a strong verbatim quote *that adds a new point* → quote, everything else → text. Code checks: no two slides share the same fact, and the cover's claim appears on at most one story slide. Kind variety becomes a soft preference, not a gate.
2. **Redefine landing and quote slides.** Landing: "a turn in the story (a twist, a consequence, a number in words), never a restatement of the cover." Quote: "the quote must add something the slides don't already say: a reason, a reaction or a specific." Slide 2: "the first new fact after the cover, not the cover restated. Instagram's re-show is served by naming who, not by repeating what."
3. **Make repairs substitute instead of subtract.** Change the char-limit message to: "cut words, not facts: remove filler, glosses already explained, and restated context first. If a fact must go, say which one in EDIT NOTES." Change the fact-check repair rule to allow replacing a cut claim with a supported fact from the brief. Then show the fact inventory with "unused" facts, so the Editor can pull one in when it cuts something.
4. **Replace the main-story rule's wording with a context policy.** "Stay on this one event. Earlier events may appear only when they explain what this event changes (e.g. 'the bill would make a voluntary process mandatory'), in one clause, with a source." Keep the fact-checker's BIG flag for true drift into another story.
5. **Relax glossing.** A term needs a gloss only if the slide doesn't make sense without it. Put glosses in the caption or on a dedicated slide when they'd eat more than about a fifth of a body. Make `term_unexplained` advisory.

**Then prune:**

6. **Rewrite the Writer and Editor prompts** as short style guides: one section each for accuracy, context, what a good slide is, voice and format. Move every incident narrative (Suleyman, Gottheimer, `max_tokens` stories) into the handoff doc's changelog, out of the model's context. Aim for less than half the current length, with the positive instructions first.
7. **Put length repairs back on Sonnet** (or whatever model writes the post), since choosing what to cut is an editorial call. Keep Haiku for the caption only.
8. **Once 1–5 are in, delete or soften:** the hard rhythm gate, the kind lock, `enforceStructure` merges, the `past_statement` regexes and most of the contrast-regex list (each listed in §6).

**New check to add (the only one):**

9. **A repetition check.** Code compares each slide's content words against the cover and every earlier slide, and flags a slide whose main claim overlaps too much with something already said. Add one line to the fact-checker: "flag any slide that tells the reader nothing the cover or an earlier slide didn't."

**How to validate cheaply:** run recommendations 1–3 offline against the two saved briefs (Writer + Editor only, no Reporter), then score both outputs with the slide-by-slide table in §2. Success means: no repeat slides, Gottheimer includes the what-gets-tested and voluntary-becomes-law facts, and Google CC stays at 9+ new-information slides.

---

## 9. Model test estimate (not run)

**Models today** (`lib/social/editorial/config.ts`):

| Stage | Model |
|---|---|
| Reporter | Sonnet 4.6 (`EDITORIAL_MODEL`) |
| Writer | Sonnet 4.6 |
| Editor, first pass | Sonnet 4.6 |
| Editor, length / CHECK ERRORS repairs | Haiku 4.5 (`REPAIR_EDITOR_MODEL`) |
| Caption | Haiku 4.5 (`CAPTION_MODEL`) |
| Fact-checker | Sonnet 4.6 |

**Current cost of Writer + Editor stages on these runs:**
- Gottheimer 19-50-15: Writer $0.031 (plus the outline retry), Editor $0.036, two repairs about $0.070. About **$0.14**.
- Google CC 03-38-05: Writer $0.041, Editor $0.335 (hit `max_tokens` twice at 20,000 output tokens), repairs $0.037. About $0.41, but most of that is the runaway Editor, which the "no scratchpad" fix now prevents. A normal run would be about $0.10–0.15.

**Opus 5.5 estimate for Writer + Editor (+ repairs), both posts, from saved briefs:**
Token use per post is roughly 15–30K input (most of it cached) and 4–7K output. Cost scales with Opus 5.5's per-token price relative to Sonnet 4.6 ($3 in / $15 out). I couldn't confirm Opus 5.5's current price from the repo. At a 1.7× price ratio, the pair would cost about **$0.45–0.55**; at 5×, about **$1.30–1.50**. Check the current Opus 5.5 rate on Anthropic's pricing page before approving. Either way, the test fits in the remaining testing budget.

**Recommendation on the model test:** run it *after* recommendations 1–3, not before. With the current prompt, a stronger model will likely follow the same contradictory rules more faithfully and produce the same repetition, more fluently. The comparison is more informative as "old prompt vs new prompt on Sonnet", then "new prompt on Sonnet vs Opus".
