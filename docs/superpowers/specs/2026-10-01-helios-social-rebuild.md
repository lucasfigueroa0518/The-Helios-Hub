# Helios Social v2 rebuild: design spec


**Owner:** Tommy Pozo
**Status:** DRAFT. No code until this spec is approved.
**Branch:** a fresh branch, not yet created. The reference for what exists today is `feature/helios-social-pipeline-v2` at tag `helios-social-v2/2026-10-02-root-cause-fixes`.

Each item has one of these labels:

- **DECIDED:** final.
- **PROPOSED:** the current direction, not yet locked.
- **OPEN:** not settled.

---

## 1. Goal

The pipeline produces **publishable** carousel posts. Review is one click, approve or reject, with no editing. The end state is fully autonomous, with no human in the editorial loop.

**Why rebuild:** the current pipeline has 20+ stages. Each one was added in reaction to a specific failure instead of fixing the stage that caused it. That's patches piling up, not quality control.

- The **editorial** side is over-built for what it delivers. The output is already good; the Google CC post and the Suleyman post prove it.
- The **visual** side (images, slide variety, character limits, cover rendering) is under-built. That's where the real gap is.

---

## 2. Rules every change must follow

### 2.1 Always fix the cause (DECIDED)

When something goes wrong, fix the stage that produced it. Never add something downstream to catch it.

### 2.2 Classify every change (DECIDED)

Every proposed change opens with a one-line tag:

> `cause or symptom · type · new stages: N · new AI calls: N`

Types, from most to least preferred:

| # | Type | What it means |
|---|---|---|
| 1 | Source fix (prompt) | Change the instructions or output format of the stage that caused the problem. |
| 2 | Source fix (code) | Change how an existing stage gets its inputs or how its output is parsed. |
| 3 | Mechanical guarantee | Plain code with no judgment that can't change meaning (§6). A backstop only, after the cause is fixed. |
| 4 | Bounded retry | The stage that owns the failure tries once more (§7, Q2). |
| 5 | Set aside | The story is logged with the reason and skipped. |
| 🔴 6 | New gate | A new check that can block output. |
| 🔴 7 | New phase | A new step that transforms output. |
| 🔴 8 | New AI call | A gate or phase backed by a model. |

Types 6–8 are off the table unless there's a deliberate, written exception in this spec.

### 2.3 No patch on a single failure (DECIDED; threshold in §10)

AI output varies from run to run, so one bad result can be a fluke. A failure only becomes a candidate for a fix when it **repeats**: 3 or more of the last 10 posts (§10). One-off failures are absorbed and logged.

Testing changes accordingly:

- **Before:** test, patch, test.
- **After:** run a batch, read the set-aside log, fix only what keeps coming back.

### 2.4 Every story should make it through (DECIDED)

The pipeline is neither a repair line nor a filter. Stories get through because each stage does its job the first time.

- **Selection is careful and happens up front** (Jev scoring, §5A, plus the Reporter). Only stories with solid sourcing, enough substance and a clear angle are picked. Judging whether a story is worth running happens once.
- **Target pass rate: close to 100%** of picked stories.
- **A story that doesn't make it is set aside.** The log records the stage and the reason. A set-aside story is a bug report against the stage that caused it.
- **Set-aside stories expire with the day.** News is timely, and the goal is only 1–2 posts a day. A story that doesn't make it today isn't worth keeping. The pipeline moves on to the next-ranked story to fill the day.
- **No set-aside screen, no rerun button.** The log exists only to diagnose patterns (§2.3). Only finished posts reach the review queue.
- **Two kinds of set-aside:**
  - **Pipeline fault** (malformed output, over the character limit, render failure): the target is zero, reached by fixing the source.
  - **The story shouldn't run** (a false or unverifiable key claim): not publishing is the correct outcome. If it happens repeatedly, selection gets fixed.

---

## 3. Pipeline shape

```
AI news feed
  → Jev scoring       (Jev)   scores and ranks every article; top picks move on
  → Reporter          (AI)    researches the pick; brief includes numbers, quotes, named subjects
  → Writer            (AI)    slides + caption + slide-type plan, one pass
  → Editor            (AI)    line editor: reads as the reader, cuts and sharpens, one pass
  → Fact-checker      (AI)    verifies claims, one pass, no loop; checks the Editor's edits too
  → Design            (code + existing image check)  images, cover, layout, render
  → Mechanical guarantees (code)
  → Review            approve / reject, no editing
  → Published

Any stage ──failure──→ Set-aside log (reason + stage) ──repeats──→ fix that stage's prompt or code
```

That's about 6 stages from start to finish, down from 20+.

**Removed (DECIDED):**

- Fact-check loop
- Writer rewrite path
- Soft-repair / field-repair
- Editor CUT phase
- Final-gate bail check
- Planner (already removed 2026-09-30)
- Separate Caption stage

---

## 4. Editorial stages

| Stage | Owns | Notes |
|---|---|---|
| Reporter | Research and the brief for a picked story | The brief also supplies the raw material for different slide types: 1–2 real numbers, a direct quote with the speaker's name, and named people or places (PROPOSED). |
| Writer | Slides, caption, slide types, IMAGE lines | Plans the slide types in the outline before writing. Search terms for scene photos are 2–3 plain nouns (PROPOSED). Writes the caption (§4.3). |
| Editor | The reader's experience of the finished draft | Line editor, before the Fact-checker (DECIDED, §4.1). |
| Fact-checker | Accuracy | One pass, last editorial stage. A false key claim sets the story aside. Other flags are fixed per §4.2. |

`RULES_BLOCK` stays the single source of editorial rules for every prompt. The rulebook design from 2026-09-30 carries over: each stage is told the rules it will be checked against.

### 4.1 The Editor's role (DECIDED)

- **Why it's changing:** the old Editor ran *after* the Fact-checker as a repair stage. Every edit needed another fact-check, which caused the loop (Suleyman replay: 3 rounds, 8 new flags, cost cap tripped). It was cleaning up other stages' problems instead of having a role of its own.
- **New position:** after the Writer, before the Fact-checker. This is the newsroom order: edit, then check. Each stage runs once, and every edit gets fact-checked. There's no loop.
- **Job:** read the draft as the target reader ("smart and busy, curious about AI, doesn't follow AI news") and make sure:
  1. The cover alone says who did what.
  2. Slide 2 makes the reader want to keep swiping.
  3. Every slide makes sense to an outsider, with unfamiliar terms explained where they appear (using the brief's TERMS).
  4. The reader finishes knowing why it matters.
- **Powers: cut and sharpen only.** It tightens wording, reorders, cuts slides or lines, and explains terms using the brief's TERMS. It **never adds facts**. Adding belongs to the Writer, cutting to the Editor, never both.
- **One pass, no repair mode,** and it never sees fact-check flags.
- **The Editor never stops a story.** Whether a story is worth running is decided at selection. The Editor only improves the draft it's given.

`cause · stage order fixed · 0 new stages · replaces the Jev grading gate`

### 4.2 The Fact-checker's job and how flags are fixed (DECIDED)

**Fact-checking and writing quality are two different things.** The Fact-checker checks facts. Writing quality (precision, wording, hooks, clarity) belongs to the Editor.

**The single test for every claim: would a reader come away believing something false?** The test is not "is it worded like the source" or "is it as precise as possible."

**Always flagged** (these change what the reader believes):

1. A hedge turned into certainty: "plans to" → "launched", "may" → "will".
2. The wrong who, what, when or number.
3. Words put in someone's mouth, or a quote altered. Mostly prevented by copy-by-ID (§4.2a).
4. Cause or effect the sources don't claim: "after" → "because of".
5. Events or details that aren't in the sources.

**Never flagged:** broadening or narrowing that doesn't mislead, punchy headlines, different-but-true wording, or omissions. Example from the Clayton test post: "On Sept. 29, AI got a new name" passes. It's a writing choice, not a false fact.

**How a real flag is fixed:**

- **Swap,** when an exact fix from the brief fits (e.g. one word or name). Code applies it.
- **Otherwise cut:** code removes the false sentence or clause. If that empties a slide, the slide is dropped.
- **The story's main claim is false:** the story is set aside, and the next-ranked story takes its place.
- **The Fact-checker never writes new replacement sentences.** Nothing checks its output afterwards, so every fix is a swap from the brief or a deletion. A fix can't introduce a new error.

Fixes still go through the mechanical checks (§6). There's no re-check loop.

**Why this matters:** the old Fact-checker flagged writing as if it were facts. That's where the "8 new SMALL flags per round" in the Suleyman loop came from. On the Clayton test post, the old approach produced 4 flags; this test produces 0.

The real fix for accuracy is upstream: copy-by-ID for quotes and numbers, and the Writer ties every claim to a brief fact. If the same kind of flag keeps showing up, that's a pattern to fix in the Writer prompt.

### 4.1a Cover rule: role before an unknown name (DECIDED)

**When the person isn't widely known, the cover leads with their role and organization, not their name.** The name comes later in the post.

- **Model it on the source's headline.** TechCrunch: "OpenAI safety employee resigns, claiming the company's 'culture is broken'". Role and company first, so the reader knows instantly why it matters.
- **Well-known people** (Altman, Musk, Trump, Newsom) can lead by name.
- **Where it was found:** in 4 fresh runs of the Robinson story, all 4 covers led with "David Robinson." That's accurate but meaningless to the reader. Being 4 of 4, it's a pattern, so it's fixed in the Writer prompt.
- **How the Writer decides:** a person counts as well known when the brief's SUBJECTS entry has a Wikidata match. Otherwise lead with the role. A future refinement could use Jev for this.

**Watch:** 4 of 4 runs also used the maximum of 8 story slides, and 3 of 4 ended on a weak slide ("he hired a PR firm"). If this keeps showing up in real runs, tighten the Writer's "stop when the story is told" rule.

`cause · Writer prompt · 0 new stages`

### 4.2b When flags come up: fix cheaply, then try a fresh draft, then move on (DECIDED)

The system handles failures on its own; nobody steps in. When the Fact-checker flags a good story, the order is:

1. **Free fixes first** (code, no rerun):
   - swap the exact fix from the brief;
   - cut the false sentence;
   - **if the chosen cover fails, use the Writer's next cover option.** The Writer already writes 3, and the Fact-checker checks all of them.
2. **A fresh draft, if the free fixes would damage the post:**
   - **When:** the cuts would leave fewer than 5 story slides, or would remove the key slide, or every cover option fails.
   - **How:** the system **throws the draft away and writes a new one from the same brief.** No "fix this" notes are fed back (that caused the old back-and-forth).
   - **Then:** the new draft runs through the Editor and Fact-checker once, like the first one.
   - **Why it works:** most failures are noise (§2.3), so a fresh attempt usually comes out clean.
3. **Move to the next story:** after the limit on fresh drafts, the system takes the next-ranked story from Jev. It keeps going until the day's 1–2 posts are done.

**Limits (DECIDED):**

- **2 fresh drafts per story.**
- **$5/day cap:** about $0.85 per attempt, so it covers 1–2 posts with room for reruns. If it's hit, the day stops and the log says why.

**Logged:** every fresh draft and why it was needed. If stories regularly need one, that's a pattern to fix at its source, so reruns don't become the new patch.

`bounded retry · 0 new stages`

### 4.2c Page reader fetches raw text (DECIDED)

The page reader must return the article's **raw text** plus its photos, captions and credits. It must never return a summary or paraphrase; in the TechCrunch test run, a summarizing fetch reworded parts of the article. A quote found in only one source is marked ⚠ in the brief.

### 4.2a Copy, don't retype (DECIDED)

The worst past slips (the made-up Suleyman quote, the untraceable "1,200") came from the Writer **retyping** things it should have **copied**.

- **The Reporter's brief lists every quote and number with an ID,** copied exactly from the source. For example: `Q1: "…" (Mustafa Suleyman, The Verge)`, `N1: nearly $21 billion (Reuters)`.
- **The Writer picks by ID** (quote slide: `Q1`, big number: `N1`), and **code fills in the exact text**. The Writer never types a quote or a stand-alone number.
- **Result:** made-up quotes and drifting numbers become structurally impossible.
- What's left for the Fact-checker is ordinary prose: lost hedges, invented framing, broadened claims.

`cause · prompt + code · 0 new stages · 0 AI`

### 4.3 Caption (DECIDED)

- The Writer writes the caption along with the slides. The Editor edits both, and the Fact-checker checks both.
- The current caption prompt works, so its instructions (summary, search-friendly, sourcing rules) are **carried over verbatim** into the Writer prompt, not rewritten.
- The caption's fix-up mode is removed.
- Image credits and the "Source:" line are built by code.
- **Check in the first live batch:** compare the captions against the current ones. If quality drops and it's a pattern, the separate Caption stage comes back.

---

## 5. Design stage (the main investment)

### 5.1 Image sources

**DECIDED:**

- **Stock photos are allowed.**
- **No photo is ever repeated.** Never twice in one post, and ideally never again in any post. Enforced in code with the used-photo log (`used-log.ts`).
  `cause · code · 0 stages · 0 AI`

**Source order (DECIDED):** first the article's own photos, then the backup lookup tools.

**1. The article's own photos, when their credit allows it.**

- **How they're found:** the page reader extracts every photo from the source articles with its caption and credit line. This is code, not AI; today's reader turns pages into text and drops images, so this is a tool change.
- **The Reporter lists them under ARTICLE PHOTOS,** with the caption and credit copied exactly.
- **Code decides from the credit line:**
  - **Allowed:** the company itself ("Courtesy of OpenAI", "Photo: Google"), official government ("Official White House Photo by …", agency photos), Wikimedia Commons, or an open licence (CC0, CC BY, CC BY-SA, public domain).
  - **Rejected:** wire agencies and stock agencies (Getty, AFP, AP, Reuters, Bloomberg, Shutterstock and similar), and the outlet's own staff photographers.
  - **Unknown or missing credit:** not used. No image is better than a wrong one.
- **Example:** both photos in the ABC "Super Intelligence Force" article were "Kent Nishimura/AFP via Getty Images," so both are rejected and the backups take over.

**Every slide gets a photo (DECIDED).** No text-only slides. Stat slides get a symbolic background (§5.3a), quote slides get the speaker or a scene. The old "drop the coverage floor" lean is reversed.

**Use every tool available, and pick the best (DECIDED).** For each slide, query all the sources that fit the request in parallel, collect the candidates, and **rank** them. Don't stop at the first hit.

- **Ranking is code first:**
  - source tier (article photo > official > conference/press > Commons > stock);
  - resolution;
  - fit to the slide shape;
  - date closest to the event;
  - not already used.
- **Then two checks run on the top few only:**
  - the Jev metadata pre-screen (§5A #6);
  - the existing image check, run on the top ~5 candidates to cap its cost.

**Fallback chain for the guarantee:**

1. A specific photo (subject, event or article).
2. A broader scene search ("government building", "Washington D.C.").
3. **The Helios photo bank:** a few hundred pre-cleared generic photos tagged by theme, curated once. It can never come up empty.

Fallbacks are always **scenes, never people.** A slide never shows a person who might be mistaken for the subject.

**Full tool list:**

| Category | Tools |
|---|---|
| People | Wikimedia Commons via Wikidata; official government portraits (agency heads, Congress via the congressional directory); **conference photo accounts on Flickr** (Web Summit, TechCrunch Disrupt, SXSW, Collision, etc., often CC BY); company press kits |
| Events and government | White House gallery; DVIDS (Defense, public domain); NASA image library; Library of Congress; National Archives; agency and embassy Flickr accounts; EU Commission audiovisual service and the UK Open Government Licence (terms per source) |
| Companies and products | Newsrooms and press kits (Nvidia, OpenAI, Google, Microsoft, …; "editorial use" terms checked per company); Commons |
| Scenes and ideas | Openverse (searches many libraries at once), Pexels, Pixabay, Unsplash, StockSnap, Burst, Kaboompics, ISO Republic, Reshot |

**Identity for people:** must come from a trustworthy record: Wikidata, an official or organizer account's caption (a conference's own Flickr), or an allowed article photo's caption. Never a random upload titled with a name.

**Measure before building:** run the existing Wikidata lookup (`image-step/wikidata.ts`, plain code, no AI) against every person and company named in past posts. Report how many have a usable photo, and how many have two or more. This sizes the photo bank.

**2. Backup lookup tools** (all code), by what the slide needs:

| Slide needs | Tools, in order |
|---|---|
| A named person | Official government portrait (officials) → company press kit (executives) → Wikimedia Commons via Wikidata (P18 / P180) |
| An event | Government photo galleries by date (e.g. the White House gallery for the Sept. 29, 2026 AI luncheon: 19 official photos) → the company's own event photos |
| A company or product | Press kit → Wikimedia Commons |
| A general scene | Free libraries: Openverse, Pexels, Pixabay, Unsplash |

**Rules everywhere:**

- Identity always comes from the records (Wikidata, official galleries, the article's caption), never from an AI looking at a face.
- Code rejects agency credits wherever a photo comes from.
- No photo is ever repeated.
- No usable photo means a text-only slide, which is a normal outcome.

**Photos are never edited.** No retouching or compositing. **To verify:** whether the cover's dark overlay behind the headline counts as an edit under the White House photo terms. If it does, use the cover's dark-canvas layout with the photo in its own frame.

**The Reporter's brief:** the IMAGES section becomes three sections:

- **ARTICLE PHOTOS:** the photos found in the source articles, with caption and credit copied exactly.
- **SUBJECTS:** the people, companies and products in the story.
- **EVENTS:** what happened, the date and the place.

The backup tools use SUBJECTS and EVENTS for their lookups.

**OPEN:**

- Read the Pixabay and Unsplash licence and API terms in full. Unsplash's API expects hotlinking and a specific credit format, which may not fit photos rendered into a PNG.
- The photo coverage floor ("cover + every text slide + ≥ half of story slides"). Leaning toward dropping it, because it pushes the pipeline to grab any image. A text-only slide is a normal outcome.
- The cause of the Openverse gap is the Writer's poetic search terms. Fix that in the Writer prompt (§4) before adding more sources.

### 5.2 Cover rendering (DECIDED)

The dark overlay behind the cover headline stays (decided). It's still listed under "to verify" for White House photos.

The template is locked by the design-v1 contract.

- **Fit:** measure that the headline actually fits and clears the orange arrow, instead of relying on the 90-character limit. `cause · code · 0 AI`
- **Face-safe crop:** a plain code library finds where the face is, never who it is, so the 4:5 crop doesn't cut it off. `cause · code · 0 AI`
- **No usable photo:** the dark canvas. That's a normal outcome.

### 5.3 Slide variety (DECIDED)

**Exact excerpts from quotes:** the Writer may use an exact excerpt of a listed quote (with "…"). Code checks that it appears word for word in the original. The same check applies to any text in quotation marks inside a body.

- **No mandatory variety.** A quota produces invented stats and padded slides.
- **The cause is fixed at the Reporter:** the brief supplies the material for different slide types (§4).
- **The Writer gets a soft nudge:** a different slide type on each swipe when the material supports it.
- **The renderer alternates layouts within a type** (photo on top vs. bottom, text left vs. centered). `code · 0 AI`
- **The slide-type mix is logged per post.** Monotone posts again and again are a pattern to fix at the Reporter.

### 5.3a Stat slides get a symbolic background photo (DECIDED)

The old stat slide (a headline and a big number on an empty canvas) is the most skippable slide in a post. New design:

- **The Writer adds a symbolic stock search** to every stat slide, for example `IMAGE: stock: wall clock close-up` for "120 days." This replaces the old rule that stat slides are always `type only`.
- **The photo search finds it** in the free libraries. The no-repeat rule keeps it fresh.
- **The renderer darkens it behind the number,** the same way the cover works. Code adds the photo credit.
- **It sets the mood; it doesn't chart the data.** No charts, no calculated values (e.g. no deadline date worked out from "120 days").
- **The headline stays factual** ("It has a deadline", not "The clock is running"). The picture carries the mood.
- **No AI-generated images.**
- **Fallback:** no photo found means today's plain dark stat slide.

| Stat | Example search |
|---|---|
| 120 days | `stock: wall clock close-up` |
| $5 billion investment | `stock: stacks of cash` |
| 41,000 patients | `stock: hospital waiting room` |
| 40% of jobs | `stock: busy office floor` |
| 1 million users | `stock: crowd of people from above` |

**Later option:** a curated Helios set of about 15 backgrounds, a few per theme, for a more signature look.

`design change · prompt + rule + renderer · 0 new stages · 0 AI`

### 5.4 New slide type: spread (DECIDED that we want it; mechanics PROPOSED)

The reference is two Metaverse slides from the Laszlo pizza post. One wide photo spans the swipe: the right half of slide N and the left half of slide N+1 are one continuous picture.

- **Writer:** may pair two consecutive slides that tell one continuous beat and give them one IMAGE line. Prompt change.
- **Renderer:** lays the landscape photo across the seam. Code.
- **Fallback:** if the photo isn't wide enough, both slides render as normal text slides. Code.
- **Later:**
  - A name label with a hand-drawn arrow, positioned by the face-detection library. The name comes from the image search, never guessed.
  - An inset second photo with a caption, which is just another named-subject photo.
- **Colors:** Helios orange, not the reference's yellow.

`new feature · prompt + code · 0 stages · 0 AI`

---

## 5A. Jev (TypeSafe `systemOne`)

Jev answers yes/no questions with a confidence score. It's very cheap (input only; output is free) and fast. It can't write, and it reads only a small amount of text at a time. **Use it more, for cost and speed (DECIDED).**

**Rule (PROPOSED): Jev replaces an existing decision; it never adds a new one.** Anywhere the pipeline pays Claude to *decide* rather than *write* is a candidate. A new checkpoint built on Jev counts as a 🔴 new gate.

| # | Use | Replaces | Status |
|---|---|---|---|
| 1 | **Story scoring at ingest.** Expand today's single relevance question into a set (below). Code ranks the articles; the Reporter only works on the top picks. If Jev's picks keep getting set aside, Jev's questions get fixed. | The one relevance question (`judge-relevance.ts`) | **DECIDED in direction.** Questions PROPOSED. |
| 2 | **Duplicate stories:** is this the same story as one recently posted, or one already in today's feed? | Nothing yet; part of ingest scoring | PROPOSED |
| 3 | ~~Strategy decisions~~ | — | **Retired** with the old pipeline (§10) |
| 4 | **Fact-checking claim by claim.** The Writer tags each claim with the brief fact it came from. Jev answers "does this source passage support this sentence?" A failed claim gets the brief's own wording swapped in by code (fits §4.2). Only replaces the Claude Fact-checker after matching it on a test set of past posts with known errors. | Claude Fact-checker | **DECIDED: built now**, with a one-batch comparison against Claude (§10) |
| 5 | **Identifying photo subjects:** does this Wikidata entry match the person or company in the brief? | Matching logic | PROPOSED |
| 6 | **Pre-screening stock photos:** do the photo's title and tags fit the requested scene? Runs before the image check. | Fewer image-check calls | PROPOSED |

**Story-scoring questions (#1, PROPOSED):**

- Is it real AI news for our reader?
- Is there enough substance for 5–8 slides?
- Is there a concrete number and/or a quote from a named person?
- Is "why it matters" clear from the article?
- Is it from a primary source, or confirmed by several outlets?
- Is the main subject a named person, company or product, so a photo is likely?

**Not Jev's job:**

- Writing anything (Reporter, Writer, Editor).
- Looking at photos. It's text only as far as the code shows; not confirmed.
- Grading finished posts as a gate.

**Grading finished posts** (the old `JEV-GRADING-PASS.md` design): PROPOSED to drop. Approve/reject decisions already measure finished posts.

**Cleanup:** once Jev's story scoring is calibrated, switch off the Claude-based shadow judge that runs alongside it at ingest (`shadow-haiku-judge.ts`).

---

## 5B. Daily ingest and story selection (DECIDED)

```
RSS feeds (hundreds)
  → freshness filter (24h; 36h on weekends)                    code
  → group duplicates: same story, many outlets = 1 candidate    code
  → drop listicles, promotional posts, non-news, stories already posted   code + Jev duplicate question
  → Jev scores every candidate on the 6 questions (§5A)         Jev
  → rank → shortlist of up to 10                                code
  → 2 winners → pipeline
  → the rest are backups, used in order if a winner is set aside
```

**Scoring:**

- Relevance and substance are required.
- The other four questions (number/quote, why it matters, primary or confirmed source, photographable subject) add to the score.
- **Tie-break:** the number of outlets covering the story.

**Winners must be different stories:** if #1 and #2 are about the same company or topic, the next one moves up.

**Haiku extraction removed:** the per-article Claude extraction call at ingest is dropped. Jev scores the articles, and the Reporter researches only the winners. `−1 AI call per article`

**Rules added after the first end-to-end run (2026-10-04):**

1. **Fewer than 10 can qualify.** Run with what qualifies. **If fewer than 2 qualify, widen the time window to 48h** and score again.
2. **Feed health is logged:** each feed's article count per run. A feed returning 0 (or failing) is flagged in the daily log, so the shortlist never shrinks silently.
*(Two rules first added here were removed as duplicates. A failed article load is covered by the general glitch rule (one retry). Single-party claims are covered by the existing hedge and attribution rules.)*

## 5B-1. Brand safety (DECIDED)

**Skip list.** Stories whose main subject is one of these are never posted:

1. Weapons and war: weapons tests, AI weapons, military operations, armed conflict
2. Deaths and tragedies: deaths, disasters, suicides, including AI-linked cases
3. Crime and violence: shootings, terrorism, violent crime, including AI used in a crime
4. Sexual abuse and deepfake porn: child exploitation, nudify apps, sexual deepfakes, including stories about laws against them

**Allowed:**

- **Partisan political fights** (Tommy: they can make good stories).
- **Defense business and policy news:** contracts, funding, procurement (e.g. "Pentagon signs AI deal with OpenAI"). Only weapons use, tests and combat are skipped.

**How it's checked:** Jev answers one yes/no per category at ingest: "Is the main subject of this article ___?" Any yes above a high threshold means skip. This is part of the same Jev scoring call, not a new stage. It is **not** a keyword match, because a keyword like "Pentagon" would have wrongly skipped the Super Intelligence Force story (Emil Michael is described as the Pentagon's CTO).

**Root cause:** these topics mostly aren't AI stories. The North Korea missile story passed only because AI was mentioned in it. So the relevance question is sharpened from "Is it AI news?" to **"Is AI the main subject of the story, not a side detail?"** That fixes the cause, and the skip list is the backstop.

`code + Jev (existing call) · 0 new stages`

## 5D. First live run: success criteria (Q10, DECIDED)

**Format:** one batch of **10 stories** in a single sitting (about $10–17). It needs **explicit go-ahead from Tommy** before it runs.

**Must hold (any miss means stop and investigate):**

- 0 false facts in a finished post
- 0 wrong-person photos
- 0 slides without a photo
- 0 slides that fail to render

**Measures of how well it works:**

| Measure | Target |
|---|---|
| **Approved as is** (one click, no regenerate) | **≥ 7 of 10** |
| Picked stories that reach the review queue | ≥ 9 of 10 |
| Stories needing a fresh draft | ≤ 3 of 10, none needing more than 2 |
| Average cost per finished post | ≤ $1.20 |
| Slide-type variety | ≥ 3 types per post on average |

**After the batch:**

- **Pass:** switch on the daily schedule (1–2 posts/day, $5/day cap).
- **Miss:** read the log and fix only what shows up in 3 or more of the 10 (§2.3).

## 5C. Watch list: seen once, NOT fixed (§2.3)

These came up once in hand-run tests. They become fixes only if they recur in real runs (3 or more of 10):

| Seen | Possible fix if it recurs |
|---|---|
| Glitches (an over-limit body, a wrong slide-type label) were caught only at the end | Run the structure and length checks right after each writing stage |
| The Writer used a source the Reporter had labelled weak/aggregator | Weak sources inform the brief but never appear on slides |
| The Reporter skipped a "[Meta says]" label on one claim whose sources all trace back to Meta | Tighten the Reporter's attribution instruction |
| Writers used all 8 story slides and ended on a weak slide (4 of 4 hand runs, but hand runs aren't real runs) | Tighten "stop when the story is told" |

**Process note (2026-10-04):** hand-run simulations are for illustrating the design, not for finding fixes. From here on, fixes come only from patterns in real batch logs.

## 6. Mechanical guarantees (Q7, DECIDED)

**Additions agreed after the first draft of this list:**

- **Silent fixes:** quotes and numbers are filled in by ID (§4.2a).
- **Pass/fail checks:**
  - Quoted excerpts, and any quoted words in a body, appear word for word in the brief (§5.3).
  - At most 2 background slides.
  - Agency photo credits (Getty, AFP, AP, Reuters, etc.) are rejected (§5.1).
- **Character limits: DECIDED, (c) as the target and (b) until it's built.**
  - **(c) Target:** replace fixed character counts with a check of whether the text actually fits on the rendered slide.
  - **(b) Until then:** over the limit counts as a glitch, so the stage that wrote the text gets one retry with the exact overage.
  - **Never** trim text automatically.

**Rules:**

- The cause is fixed first, in the stage's prompt.
- No judgment.
- Nothing that could change meaning.
- Every time one fires, it's logged.

**A. Silent fixes:**

1. Dashes swapped for the approved punctuation (`swapBannedPunctuation` exists).
2. Straight and curly quotes made consistent.
3. Whitespace and markdown leftovers removed (`normalizeMarkdown` partly exists).
4. Highlight phrase snapped to the exact matching text on the slide. If there's no match, the highlight is dropped.
5. Image credits and the "Source:" line built by code from the licence and source data.

**B. Pass/fail checks:**

6. Output structure: all required fields are present and parse.
7. Character limits (`LIMITS`: cover 90, headline 60, body 220, quote 140, caption 2,200 …).
8. Image licence allowed and credit data present.
9. Image loads, meets the minimum resolution and crops safely.
10. Every slide renders, with no text overflow or collision.
11. Cost cap.

**Deliberately not here:** rhythm, voice, unexplained terms, tracing numbers to sources. Those need judgment, so they belong in the prompts.

**Character limits (OPEN):**

- (a) Trim only a whole final sentence.
- (b) Never trim; over the limit is a failure and gets one retry.
- (c) Replace fixed limits with the measured render-fit check (#10).

Leaning: (c) as the target, (b) until it's built.

---

## 7. Decisions

| # | Question | Status |
|---|---|---|
| Q-A | The Editor's role | **DECIDED:** line editor, before the Fact-checker (§4.1). The Fact-checker's scope and fixes are DECIDED too (§4.2). |
| Q-B | Jev's role | **DECIDED:** scores and ranks articles; replaces Claude decisions where it can (§5A). Jev fact-checking built now, compared against Claude in the first batch (§10). |
| Q-C | The Caption | **DECIDED:** written by the Writer (§4.3). |
| Q-D | The Planner | **CLOSED:** already removed 2026-09-30. |
| Q1 | What counts as a failure, and what happens to it | OPEN. Draft in §7.1. |
| Q2 | Retry policy | OPEN. Draft in §7.1. |
| Q3 | Image source chain | **DECIDED** (§5.1): article photos first, when their credit allows it; backup lookup tools after. Still to verify: the White House photo terms, and the Pixabay/Unsplash terms. |
| Q4 | Slide variety | §5.3, PROPOSED. |
| Q5 | Handling set-aside stories | **DECIDED:** log only, for diagnosing patterns. No screen, no rerun. Stories expire with the day; the next-ranked story fills the slot (§2.4). |
| Q6 | Economics: cost per post, pass rate, batch size | OPEN. Reference: the Suleyman post cost $0.83. Over-pull stories (e.g. 8–10 for 5 posts). |
| Q7 | Mechanical guarantees | §6, PROPOSED; character limits OPEN. |
| Q8 | Review UI | **DECIDED (2026-10-04):** builds on the existing `/social` review page and `app/api/social/review/[id]`. The page shows each post's slides as they'll appear, the caption, photo credits plus identity proof (subject, Wikidata ID, file link, licence), and sources. **Buttons:** **Publish** (replaces Approve; posts the carousel to Instagram through the Instagram publishing API) · **Regenerate with notes** (one rerun) · **Reject** (discard; the next-ranked backup story runs automatically to fill the slot, within the $5/day cap; an optional reason is logged for pattern-spotting). PROPOSED: a single "Publish to Instagram?" confirm, because a published post can't be pulled back through the API. The Meta/Instagram setup is already in place. Slides go to Instagram as JPEGs at public URLs (from Storage). Earlier notes on this item: | **DECIDED piece:** a **Regenerate button with a notes field**, like the current one. Notes go to the Writer for one human-triggered rerun of that post (the existing reviewer-notes path in `orchestrate.ts`). Each regeneration is logged with its notes. If the same kind of note keeps coming back, that's a pattern to fix in the prompts (§2.3), so notes don't turn into a hand-patching habit. |
| Q9 | What we're intentionally not building | §8, in progress. |
| Q10 | Success criteria for the first live run | OPEN |

### 7.1 Failures and retries (Q1 + Q2, draft)

**Principle: glitches get one retry, judgment problems get none.** A glitch is random and usually works the second time. A judgment problem comes back the same way.

| What goes wrong | Example | What happens |
|---|---|---|
| Network or API hiccup | Timeout, server error | Automatic retry (standard connection handling, not a pipeline decision). |
| Broken output | Missing fields, can't be parsed | One retry by the same stage, then set aside. |
| Over the character limit | A body slide at 260 characters | One retry by the last stage that wrote the text, given the exact overage. Then set aside. Becomes the render-fit check later (§6). |
| Small fact-check flag | A number slightly off from the source | No retry. Code swaps in the source's wording (§4.2). |
| Main claim false or unverifiable | The core fact doesn't hold up | Set aside right away. |
| No usable photo | Nothing passes the image rules | Not a failure. The slide is text-only. |
| A slide won't render | The layout breaks | Set aside. It's a code bug; fix the renderer. |
| Cost cap reached | The batch hits its spending limit | Stop the batch. |

Everything is logged. Any row that keeps showing up gets fixed at its source.

---

## 8. Intentionally NOT building (Q9)

Settled, so they don't get re-argued:

- Soft-repair / field-repair loops
- A fact-check loop, or fact-checker memory of previous rounds
- The Writer rewrite path
- Editor CUT mode, and the Editor as a repair stage after the Fact-checker
- The Jev grading pass as a gate, and 6-draft generation
- The final-gate bail check
- A separate Planner stage
- Any new AI stage added in response to a failure
- Mandatory slide-type quotas
- Patching a failure after a single occurrence

---

## 9. Game plan

**Next:**

1. Lock Q1 + Q2 (§7.1).
2. Confirm §4.2 (fact-check fixes applied by code).
3. Confirm the PROPOSED items in §2.4, §5 and §6: image source order, article photos, coverage floor, character limits.


**After that:**

4. Q6 economics, Q8 review UI, Q10 success criteria.
5. Finish Q9.
6. Read the full Pixabay and Unsplash terms.
7. Final review of the whole spec: every item is DECIDED or explicitly deferred.

**Only after approval:**

- Write the implementation plan (`docs/superpowers/plans/`) in small milestones.
- Each milestone is tested offline with stubbed model calls. No live AI runs without explicit go-ahead and a cost estimate.
- First live run: a small batch, judged against the Q10 criteria. Read the set-aside log for patterns; don't patch one-offs.

---

## 10. Former review items: resolved without outside review (2026-10-04)

Nobody outside is reviewing this spec, and nothing waits on anyone. The four items previously parked for review are settled here:

| Item | Decision |
|---|---|
| **Jev as fact-checker** (§5A #4) | **Yes, built now.** The Writer tags each factual sentence with the brief fact it came from. Code pairs each sentence with its source passage, and Jev answers "Would a reader of this sentence believe anything the passage doesn't support?" Real flags are fixed by code (swap/cut, §4.2). Untagged sentences containing a number, name or quote are flagged by code. **Switch-over:** in the first live batch (§5D) only, the Claude Fact-checker also runs and both results are logged. If Jev catches everything Claude caught, Claude is removed and Jev becomes the only fact-checker. If not, the gaps decide whether to switch. This is a one-batch comparison, written here as an exception to §2.2, not a permanent extra stage. |
| **Jev story-scoring questions** (§5A #1) | **Use the six questions as written,** with "AI is the main subject" as the relevance wording. Relevance and substance are required, the other four add to the score, and ties are broken by outlet count. **Calibration (plan S1): Tommy labels ~20 past articles alone.** |
| **Jev strategy scoring** (§5A #3) | **Retired** with the old pipeline. Not part of the rebuild. |
| **Pattern threshold** (§2.3) | **3 or more of the last 10 posts** (rolling) makes a failure a fix candidate. **Exception:** anything that publishes a false fact or a wrong-person photo is fixed after a single occurrence. |
