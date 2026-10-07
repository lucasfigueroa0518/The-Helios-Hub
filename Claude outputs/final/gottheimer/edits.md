# Human review edits — Gottheimer AI bills carousel

Run: `2026-09-29T19-50-15-796Z` (from-brief; brief cached from
`2026-09-29T18-49-26-356Z/brief.json`).

Story (single, main only): On Friday, September 18, 2026, Rep. Josh
Gottheimer (D-NJ-5) introduced two bipartisan AI security bills at
Fairleigh Dickinson University in Teaneck — the American AI Security Act
(mandatory NSA review of frontier AI models before release) and the China
FIREWALL Act (bans Chinese-developed open-weight models from federal
devices and software).

Slide-kind sequence (cover + 7 story slides + follow):
`text → landing → quote → stat → text → landing → text`
No two consecutive share a kind. 4 distinct story-slide kinds
(text, landing, quote, stat), which clears the ≥3 rule for a 6+ story-slide
post.

---

## COVER

- **Before (FINAL post):** "A Democrat and a Republican introduced a bill
  to make the NSA review AI before it ships."
- **After:** "Rep. Josh Gottheimer wants the NSA to test AI models before
  release."
- **Why:** Fixes hard rule "cover names the pictured person" — the image
  step attaches Gottheimer's photo (Wikidata Q6288908) to the cover, so
  the cover text must contain "Gottheimer" (or "Josh Gottheimer"). The
  final post's cover named neither party. Rewrite keeps who/what/why
  clear.
- Length: 68 / 90.
- Highlight: "test AI models before release" — exact substring of the
  cover text.
- Longest single word: "Gottheimer" (10 chars). No word ≥ 12; safe on the
  cover template.
- Image: photo of Josh Gottheimer (Q6288908; already cached, license
  allow-listed, verified via the image step's prior run).

## SLIDE 2 — text

- HEADLINE: "Two bipartisan AI bills unveiled Friday" (39 / 60). Words:
  bipartisan (10), unveiled (8), Friday (6). Safe.
- BODY: "On September 18, Rep. Josh Gottheimer (NJ-5) unveiled two
  bipartisan AI security bills at Fairleigh Dickinson University in
  Teaneck." (132 / 220)
- HIGHLIGHT: "two bipartisan AI security bills" — substring of body.
- IMAGE: type only.
- **Why change vs FINAL post's slide 2:** the FINAL post's slide 2
  ("Two bills, one announcement" + "Rep. Josh Gottheimer (D-NJ), Co-Chair
  of the House AI Commission…") crammed a title and a role. Slide 2 is
  the re-show slide on Instagram, so it needs to state the news itself.
  New headline says what the announcement was; body carries the who,
  when and where. All facts trace to the Gottheimer press release (source
  1) and WRNJ Radio (source 2).

## SLIDE 3 — landing

- HEADLINE: "No mandatory AI safety checks today" (35 / 60).
- HIGHLIGHT: "No mandatory AI safety checks" — substring of headline.
- IMAGE: type only.
- **Why:** Kept as landing (matches approved outline). Removed the FINAL
  post's oversize NOTE ("Gottheimer introduced the American AI Security
  Act and the China FIREWALL Act to fill that gap." — 95 chars, over the
  60-char note limit). A one-line headline is enough to set up the quote
  on the very next slide. Both bills are already named on slide 2.
- Sourced from source 1 (Gottheimer press release: "Right now, there are
  no mandatory requirements for pre-deployment testing of frontier AI
  models.")

## SLIDE 4 — quote

- **Before (FINAL post):** QUOTE was a Frankenstein merge of two
  separately-quoted sentences from the press release ("Right now,
  there are no mandatory requirements… That doesn't work in banking…
  power grid."), 319 chars, over the 140 limit and not word-for-word
  in any single source string.
- **After:** "Right now, there are no mandatory requirements for
  pre-deployment testing of frontier AI models." — 96 / 140. Verbatim
  substring of source 1 (gottheimer.house.gov) and also appears in
  source 2 (WRNJ) and source 3 (Politico via NewsBreak).
- QUOTE BY: "Rep. Josh Gottheimer (NJ-5)" — 27 / 60.
- HIGHLIGHT: "no mandatory requirements for pre-deployment testing of
  frontier AI models" — substring of the quote.
- IMAGE: photo of Josh Gottheimer (speaker photo on a Quote slide is
  allowed per design v1; Gottheimer is a TERMS person).
- Addresses HARD error: `quote_verbatim`.

## SLIDE 5 — stat

- HEADLINE: "The NSA would get 30 days to vet a model" (40 / 60).
- BIG NUMBER: "30 days" (7 / 12).
- NUMBER NOTE: "Plus one 30-day extension if needed" (35 / 60).
- HIGHLIGHT: "30 days".
- IMAGE: type only.
- **Why:** Numbers come from source 1 ("30 days, with a single 30-day
  extension if needed"). NSA-led review is the American AI Security
  Act's core mechanism per source 1. FINAL post's slide 5 also had a
  BODY; removed it — stat layout is stronger without a body wall when
  the number IS the point.

## SLIDE 6 — text

- HEADLINE: "The FIREWALL Act would extend that ban" (38 / 60).
- BODY: "DeepSeek is already blocked from federal devices. Gottheimer
  named Kimi K3 and Qwen as Chinese open-weight models the bill would
  also keep off federal systems." (159 / 220)
- HIGHLIGHT: "Kimi K3 and Qwen" — substring of body.
- IMAGE: type only (org/bill; per rule, no photo — Chinese models and
  bills are not TERMS people).
- **Why:** Facts come from source 1's "other Chinese open-weight
  models, like Moonshot's Kimi K3 and Alibaba's Qwen, are still walking
  right through the front door of our federal agencies" and from the
  brief's TERMS entry on DeepSeek (already blocked under the FY26
  NDAA). Reworded from FINAL post to remove the loose "walking in"
  headline and to state the bill's actual effect. "Open-weight" is
  explained implicitly by context ("models the bill would also keep
  off federal systems") and lands on the same slide it first appears,
  which satisfies the term-explanation rule for a Landing-preceded
  Text slide.

## SLIDE 7 — landing  (was text in FINAL post — HARD error)

- HEADLINE: "He's also pressing the White House" (34 / 60). Longest
  word: "pressing" (8). Safe at Landing's step-down font sizes.
- NOTE: "Letter to Cyber Director on AI cyberattacks" (43 / 60).
- HIGHLIGHT: "pressing the White House" — substring of headline.
- IMAGE: type only (Sean Cairncross has no Commons image at ≥1080px
  short side per the run's image-step log; requesting his photo would
  fail again).
- **Why:**
  1. Restores the approved outline's slide-7 kind (landing), fixing
     HARD errors `outline_kind_mismatch` and the two `rhythm` errors
     (slide 6 text + slide 7 landing + slide 8 text — no adjacents of
     the same kind).
  2. Keeps the story beat: Gottheimer's letter to National Cyber
     Director Sean Cairncross about the AI cybersecurity clearinghouse
     and autonomous cyberattacks (source 1 and source 2).
  3. Moves "cyberattacks" (12-char word) out of the large Landing
     headline and into the small NOTE line (38px), so it can't overflow
     or break mid-word on the headline.

## SLIDE 8 — text

- HEADLINE: "A floor vote isn't scheduled" (28 / 60).
- BODY: "Gottheimer said Republican leadership has refused to directly
  bring the bills to the floor for a vote, and sent Congress home. He
  is urging the Speaker to reconvene." (165 / 220)
- HIGHLIGHT: "refused to directly bring the bills to the floor" —
  substring of body.
- IMAGE: type only.
- **Why:** Restores the word "directly" the FINAL post dropped
  (fact-check SMALL flag). Source 1: "Republican leadership has refused
  to directly bring any of these critical pieces of legislation to
  the floor for a vote." "Sent Congress home" tracks source 1 ("they
  sent us home from Washington without acting"). "Urging the Speaker
  to reconvene" tracks source 1 ("I strongly urge the Speaker to bring
  us back before the election…").
- Also dropped the FINAL post's editorial line "Near-term action is
  unlikely" — that's an outside inference (Internet2, source 3) folded
  into Helios's voice as a conclusion; safer to leave it to the
  caption if at all.

## FOLLOW

- "Follow Helios to keep up with how Congress is moving on AI
  regulation." (70 / 100). Ties to this story. Unchanged from FINAL
  post.

## CAPTION

- Character count: 1112 (well under 2200; the pipeline appends the
  photo credit line automatically).
- Fixes fact-check SMALL flags:
  - "blocked AI safety votes" → "refused to directly bring these
    bills to the floor for a vote" (matches source 1 exactly).
  - "WRFNJ" → "WRNJ Radio" (correct station name, source 2 URL is
    wrnjradio.com).
- First sentence carries the news on its own (who / what / when /
  where). No hedges dropped. No hashtags. No em dashes. No banned
  voice words checked and clean.
- Ending order: summary → question ("Would you want the NSA
  reviewing every powerful AI model before release?") → follow-Helios
  line → Source line.
- Source line names the two substantive first-party outlets from Sep
  18 (Gottheimer's office, WRNJ Radio) and cites the two aggregator/
  analysis sources as "Additional reporting" (Politico via NewsBreak,
  Internet2). Dates per the brief. No links, per spec.
- Photo credit is deliberately NOT included; render pipeline appends
  it after the Source line.
