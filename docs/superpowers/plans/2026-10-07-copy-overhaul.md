# Helios Social copy overhaul: plan (current → after)

**Status:** PLAN for Tommy's review. Nothing changed yet.
**Restore point:** `git checkout social-copy-checkpoint-2026-10-07` (commit `7ed91f4`).

## Goals (Tommy, 2026-10-07)

1. Fix every contradiction in the copy instructions; skew the voice toward social media writing.
2. **Cut word count in half**, per slide and per post, with the same punch.
3. Bring hook, tension and engagement into the **Writer** (not bolted on), so slides bridge seamlessly.
4. Give the brief a **plot, tension and chronology**, so the Writer knows how the facts relate.
5. **Never touch the journalistic truth rules** unless one directly contradicts something; then align it. Those rules:
   - facts from the brief only;
   - hedges and attribution kept;
   - quotes and numbers by ID;
   - disagreements shown or left out;
   - claim tags;
   - no invented suspense.

## Baseline (last run, `runs/daily-2026-10-07T19-44-42-798Z`)

| | Haiku post | Teens post | Target (half) |
|---|---|---|---|
| Slide words (headline + body) | 267 over 7 slides | 242 over 8 slides | about 120–130 per post |
| Average body | 187 chars (cap 220) | 186 chars | about 80–95 chars |
| Average headline | 46 chars (cap 60) | 48 chars | about 30–40 chars |
| "says/said" in slide copy | 3 | 9 | once per claim chain |

---

## A. The brief gets a story (Reporter)

**Files:** `lib/social/reporter/prompt.ts`, `lib/social/reporter/brief.ts` (type, schema, code checks), prompts file §1.

### A1. New sections in the Reporter's output

**Current** (output list, excerpt):
```
THE NEWS: one line (who, what, when) with fact IDs
WHY IT MATTERS (sourced only): 1–2 bullets with IDs
FACTS: F1, F2, … each one sentence + (sources)
BACKGROUND: B1, B2 (max 2) — earlier events a reader needs, each sourced
…
EVENTS: photographable events with date/place, if any
…
NOT ANSWERED BY SOURCES: bullets
```

**After** (three sections added after WHY IT MATTERS; nothing removed):
```
TIMELINE: the story's events in the order they happened, oldest first: date (as precise as the sources give it, or "undated") | what happened | fact IDs. Include earlier events from BACKGROUND that set the story up. Only events your sources date or clearly order.
PLOT: 4–6 beats that tell this story in order, each one line with fact IDs, labelled:
  SETUP (the situation before the news) · TRIGGER (what happened) · CONFLICT (who pushes back, what's at stake, what doesn't add up) · RESPONSE (how the other side answered) · OPEN (what's still unknown or comes next, from NOT ANSWERED).
  Skip a label when the sources don't support it; never invent one to fill the shape.
TENSIONS: each real disagreement or open question in the sources: side A (who, claim, IDs) vs side B (who, claim, IDs), or the open question (from NOT ANSWERED). None if the sources show none.
```

**New Reporter rule (truth-aligned):**
```
- TIMELINE, PLOT and TENSIONS only arrange facts you already listed: every line cites fact IDs, and adds no fact, cause or motive of its own. "After" is order, never "because."
```

### A2. Code checks (`brief.ts`)
- Every TIMELINE, PLOT and TENSIONS line cites existing fact IDs.
- PLOT labels come from the fixed list and appear in that order.
- The TIMELINE is in date order where dated.

A failing brief gets the Reporter's usual one retry.

### A3. Cost
About 150–300 more output tokens per brief, roughly **$0.003–0.005 per story**.

---

## B. The Writer: contradictions fixed, social voice, half the words, bridges inside

**Files:** `lib/social/writer/prompt.ts`, `lib/social/prompts/rules-block.ts`, `lib/social/prompts/voice-block.ts`, `lib/social/mechanical/checks.ts` (length caps), the prompts file.

### B1. Lengths: half the words (contradiction: caps only, no target)

**Current:**
```
- 5–8 story slides. Stop when the story is told; never pad to 8. Headline ≤60, body ≤220 chars.
- COVER (≤90 chars): must say who did what on its own. …
```
and code: cover ≤90, headline ≤60, body ≤220, quote ≤140.

**After:**
```
- 5–8 story slides. Stop when the story is told; never pad to 8. Headline ≤45, body ≤110 chars. Aim for a body of one or two short sentences, about 12–18 words; the whole post's slides under about 130 words.
- One idea per slide. If a slide needs a second idea, it's a second slide or it's cut.
- COVER (≤75 chars): must say who did what on its own. …
```
- **Code caps:** cover ≤75, headline ≤45, body ≤110, quote on a quote slide ≤120.
- **Why these numbers:** they halve today's averages while leaving room for one attributed claim ("Common Sense says alerts never fired." is 37 characters).
- **Truth part unchanged:** "must say who did what on its own" stays.

### B2. "Punchy headline, precise body" (contradiction with the bridge rule)

**Current:**
```
- Headlines may be punchy, but never false. Body states the precise version.
```
**After:**
```
- Headlines may be punchy, but never false. The body states the precise claim in the fewest words it takes: the hedge and the attribution stay, the padding goes.
```
Truth kept (precise, hedged, attributed). Only the implied length goes.

### B3. Momentum, rewritten as social writing with the bridge inside the slide

This fixes three contradictions:
- tension vs. the precise body;
- "never hold back the news" vs. teasing;
- the Writer and the hook pass doing the same job.

**Current:**
```
- Plan the post as one story, not a list of facts. Outline the arc before writing: the hook (cover) → what happened → why it matters → the turn (the pushback, the catch, the conflict) → what's still unknown or what comes next.
- Every slide pulls the reader to the next one. End each slide on real tension from the brief (a contradiction, a consequence, a reaction, an open question) that the next slide pays off.
- Tension comes only from the brief: disagreements, critics, stakes, NOT ANSWERED. Never invent suspense, tease facts that aren't there, or hold back the news.
```
**After:**
```
- Build the post from the brief's PLOT and TIMELINE: the slides follow its beats in order (SETUP → TRIGGER → CONFLICT → RESPONSE → OPEN), one beat per slide or two, so each slide grows out of the one before.
- Write for the feed: each slide is a beat a thumb stops on. Lead with the most surprising true thing on the slide.
- The bridge lives inside the slide: its last line hands off to the next slide. A bridge is a fact from the brief that raises the question the next slide answers (a contradiction, a consequence, a reaction, an open question from TENSIONS or NOT ANSWERED). It is part of the copy, not an extra line.
- A fair tease withholds the next slide's detail, never the news: the cover and slide 2 state the news plainly. Never invent suspense or tease a fact the brief doesn't have.
- Not every slide needs a bridge: the last story slide lands the point instead.
```
**Truth kept:** "never invent suspense", "never tease facts that aren't there", "never hold back the news" (narrowed to the news itself, which is what it protects).

### B4. Voice: social-first, and no longer filed under the caption (contradictions 3 and 4)

**Current** (the voice block sits under "## Caption" → "### Voice"):
```
Direct, dry, confident. A sharp editor, not a press release.
…
- Vary sentence length. Three short sentences in a row is too many.
```
**After:**
- The voice block moves to its own section, **`## Voice (slides and caption)`**, before the caption section. The Editor, which shares it, gets the same heading.
- Two lines change:
```
Direct, dry, confident. A sharp editor writing for the feed, not a press release.
…
- Short sentences are the default on slides. Vary the rhythm with the occasional longer one; never three long ones in a row.
```
Every banned word, phrase and construction stays as it is.

### B5. Cover rule vs. "use real names" (contradiction 5)

**Current:** the cover rule says lead with role or country for a person who isn't widely known; the voice rules say "Use real names. 'Norland Labs says,' not 'the company says'".

**After** (one clause added to the voice line):
```
- Use real names. "Norland Labs says," not "the company says" when you can name it. On the cover, the cover rule wins: a person who isn't widely known is introduced by role or country first.
```

### B6. Attribution in the fewest words (the hedge repetition; truth rule unchanged)

**Current:** the truth rule says claims marked `[CLAIM: X says]` must keep that attribution on the slide. Nothing about how short it can be.

**After** (style line added; the truth rule is untouched):
```
- Attribute in the fewest words that keep the claim honest: "Common Sense says" or "per Common Sense", once per slide. Never stack two attributions on one slide.
```

### B7. Extra numbers (density push)

**Current:**
```
- At most 2 stat slides per post. Keep the strongest numbers as stat slides; put the others in a text slide's body.
```
**After:**
```
- At most 2 stat slides per post. Keep the strongest numbers as stat slides; use another number in a body only when the slide's point needs it, else leave it for the caption.
```
Omissions are never a fact-check flag, so this is truth-safe.

### B8. Glossing (contradiction 7: a gloss could add a slide)

**Current:**
```
If a gloss would eat more than about a fifth of a slide's body, move the definition to the caption or a dedicated slide instead of shrinking the fact.
```
**After:**
```
If a gloss would eat more than about a fifth of a slide's body, move the definition to the caption instead of shrinking the fact.
```
"Glosses always come from the TERMS list; never invent a definition" stays.

### B9. Photo rules move out of the copy rules (contradiction 8: weight)

- **Current:** the VISUAL rule and the 30-icon list sit in the middle of the copy rules, about a third of the prompt.
- **After:** the same text, unchanged in substance, moves to its own **`## Photos and icons`** section after the copy rules and before the output list. Copy rules lead the prompt.

### B10. Editor alignment (`lib/social/editor/prompt.ts`)

**Current:**
```
2. Every slide makes the reader want the next; reorder or sharpen headlines to create the pull, without adding facts.
3. Every slide makes sense to an outsider. Explain unfamiliar terms where they appear, using only the brief's TERMS.
```
**After:**
```
2. Every slide makes the reader want the next: each slide's last line hands off to the next (B3). Reorder, sharpen or cut to create the pull, without adding facts.
3. Every slide makes sense to an outsider. Explain a term only where the slide fails without it, using only the brief's TERMS; otherwise leave it for the caption.
5. Hold the word budget: one idea per slide, bodies of one or two short sentences. Cut before you add.
```
POWERS (cut and sharpen only, never add facts, keep hedges and IDs) is unchanged.

### B11. Caption

**No change** beyond the voice heading move (B4). Tommy's halving targets the slides. Say so if the caption should shrink too.

---

## C. What stays exactly as it is

- **Every truth rule:** brief-only facts, hedges, `[CLAIM]` attribution, quotes and numbers by ID, disagreements, claim tags, the Context policy, the Fact-checker.
- **The hook pass.** It stays on, untouched, as Tommy asked. Its own prompt already says "leave a slide alone when it already hands off", so once the Writer bridges inside the slide, it should add fewer lines. Its next step (folding it into the Writer) is a later decision.
- The photo request rules (moved, not changed) and the code checks other than the new length caps.

## D. Order of work, once approved

1. **Reporter:** the TIMELINE, PLOT and TENSIONS sections, schema and code checks; prompts file entry; tests.
2. **Writer:** B1–B9, in the prompts file first (the guard tests compare against it), then the code.
3. **Editor:** B10. Then the mechanical length caps (C1 in `checks.ts`) and their tests.
4. **Offline tests:** the prompts match the prompts file word for word; the new brief sections are checked; the length caps are enforced.
5. **One live preview run, started by Tommy,** with every live stage including the hook pass (standing rule).
   - About $1.50 for 2 posts.
   - Report: words per slide and post against the baseline above, how many slides end on a bridge, and how many hook lines the hook pass still adds.
