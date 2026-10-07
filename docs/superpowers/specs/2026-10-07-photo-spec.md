# Helios Social: photo spec (search and placement)

**Owner:** Tommy Pozo
**Status:** DRAFT. No code until Tommy approves this spec line by line.
**Written:** 2026-10-07, from Tommy's decisions in chat, topic by topic.

Labels: **DECIDED** (final) · **OPEN** (decided later, from mock-ups Tommy approves) · **PARKED** (a later idea, its own decision when it comes up) · **OUT** (not part of the photo system).

This spec replaces every earlier description of the photo chain, including "Photo chain v1" (2026-10-07) in the
rebuild spec §5.1, §5.1a, §5.3a, the plan's M8 section, STATUS and the handoff. Those places should point here.
The rules of the rebuild spec §2 apply unchanged: fix the cause, classify every change, no patch from a single failure.

---

## 1. Goal (DECIDED)

- **Every slide gets a visual.** A real photo when a fitting one exists; otherwise an icon background. Never a bare text slide.
- **Never misleading.** Zero wrong-person photos, zero photos that imply something the story doesn't say.
- **Fully automatic.** No human picks photos. Nobody approves per-company terms.
- **No rights risk beyond what Tommy accepted** (§2).

## 2. Allowed sources (DECIDED)

| Source | Rule |
|---|---|
| **Headshots** | The Wikidata main photo (P18) of an identity-verified person, openly licensed. |
| **Logos** | The Wikidata logo (P154) of an identity-verified organization, if its Commons licence is open or public domain. Company brand-guideline preferences don't block it (Tommy: "If there are free, open-to-use logos that are just preferred not to be used by the companies, we can definitely use them."). |
| **Company photos** | The Wikidata main photo (P18) of an identity-verified organization, often its headquarters (Tommy, 2026-10-07: "I like when buildings are used, like their headquarters"). Openly licensed, the same size rule as a headshot, and the face detector finds no face in it. Only on story slides tagged with that company; the cover of a company story stays its logo card. |
| **Article photos** | From the story's own source articles, when the credit is: government, Wikimedia Commons, an open licence (CC0, CC BY, CC BY-SA, public domain), or the company itself when that company is a subject of the story ("Courtesy of OpenAI"). |
| **Official announcement images** | Images on a story company's own announcement page that the Reporter already opened. A plain list says which domains belong to which company (e.g. anthropic.com is Anthropic's; 9to5google.com is not Google's). No approval column, no per-company terms. Credit: "Image: <Company>". |
| **Stock** | Openverse, openly licensed, through the frozen stock link (pre-screen v4 + vision check). |
| **Icons** | A Helios icon set, open-source or made for Helios. |
| **Photo bank** | Grows automatically from photos posts have used, tagged so reuse stays correct (same verified person or company only; scenes by tag). No hand-seeding. |

**Not allowed:** article photos with no credit or an unrecognised credit; wire and stock agencies (Getty, AP, Reuters, AFP…) and the outlet's own staff photos; AI-generated imagery.

## 3. Identity and fit (DECIDED)

- **People and companies:** used only after the identity check agrees (Wikidata type: human / organization, plus Jev's description match against the brief). Only the main photo (P18) or logo (P154) of that verified entry. Never "depicts" (P180) photos on their own; the only exception is the second-photo rule, where all three checks must agree (Tommy, 2026-10-07). Never matched by name alone. Identity never comes from an AI looking at a face.
- **A second photo of a verified person** (Tommy, 2026-10-07), e.g. the cover used their main photo and their quote slide needs another: a Wikimedia Commons file, openly licensed, only when **all three** hold: (1) it is tagged on Commons as depicting that exact person (by Wikidata ID, never by name); (2) the file title contains the person's name; (3) the face detector (code, the renderer's MediaPipe) finds exactly one face. Group and stage shots fail (3).
- **Stock:** never a person as the main subject, a recognizable landmark, an outside company's logo or a named institution (the frozen stock link).
- **Article photos and official images:**
  1. Only photos from the article itself: the lead image and photos in the body. Never related-story thumbnails, ads or sidebar images.
     **What counts as the lead image** (Tommy, 2026-10-07): "only photos inside the article body as the page reader extracts it; og:image counts only if it's the same photo as one in the body."
  2. No caption, no use (official announcement images: see 4).
  3. The caption must name a subject the slide is about (a person, company or product from SUBJECTS). A person's photo only on a slide about that person; a company's or product's only on a slide about it. The cover follows the same rule with the cover's subject.
     **How a slide's subject is known** (Tommy, 2026-10-07): "the Writer tags each slide with subject IDs (like quote and number IDs); code checks the subject is named on the slide."
     **Naming rule** (Tommy, 2026-10-07): people match by full name or last name only, never first name. Organizations match by full name, or the first word only if no other subject in the story shares it; if two share it (Google, Google DeepMind), only the full name counts. A subject's type comes from the identity check, else from the Reporter, which marks each SUBJECT as a person or an organization (Tommy, 2026-10-07). Tags are re-checked by code right after the Editor; a failing tag is removed and logged (Tommy, 2026-10-07).
  4. **Official announcement images: the page counts as the caption** (Tommy, 2026-10-07). An image from a company's own announcement page may go on the cover or on a slide about that company's announcement, and nowhere else. Images that are mostly text (title cards, banners) are rejected, by the existing vision call's "mostly text or banner" question (Tommy, 2026-10-07).

## 4. Each slide type (DECIDED)

The order tried, left to right. The last step always succeeds.

| Slide | Order |
|---|---|
| **Cover** | article or official image → the person's headshot (person story) → the company's logo card (company story) → stock → cover icon background |
| **Story slide** | article or official image → the subject the slide is about: a person's headshot, or a company's main photo (often its headquarters), then its logo → stock → icon background |
| **Quote slide** | the speaker's verified headshot → a second verified photo of them (§3) → an article photo whose caption names the speaker → otherwise a type-led quote slide (quote mark, quote, speaker's name and role) on the icon background. Quote slides are allowed whether or not the speaker has a photo (Tommy, 2026-10-07: unknown former employees may have the best quote). Never another person's photo or the company's logo in the speaker's spot. |
| **Stat slide** | icon background, always. Tommy, 2026-10-07: "Stat slides keep IMAGE none; the icon background will be automatic." |
| **Spread** (two slides, one wide photo across the seam) | kept (rebuild spec §5.4). One wide literal photo; if none is wide enough, both render as normal slides. |

- **Everyone quoted is a SUBJECT** (Tommy, 2026-10-07). A change to the frozen Reporter: one rule in its prompt, plus a code check that every quote's speaker is in SUBJECTS. `cause · prompt + code check · 0 new stages · 0 new AI calls`. If a speaker still has no verified photo, the quote gets the type-led quote slide.
- **People may be full-bleed if properly framed** (Tommy, 2026-10-07: "can we do full bleed and properly frame them?"). Code uses the face detector's face box to crop so the face sits in the upper part of the slide and fully clear of the text area and the HELIOS mark. If the photo can't be framed that way (face too low, too tight, cut off), the slide uses the split or framed-inset layout instead. The render review (§5b) checks faces under text or cut off. This replaces the renderer's freeze rule "person photos use split layouts only".
- **Company photos:** a company's main photo at most once per post (the no-repeat rule), on story slides only.
- **Logos:** on the cover, and on at most one story slide per post. Exempt from the 7-day rule across posts; never twice in one post besides that.
- **No repeats:** no photo twice in a post or within 7 days, every source except logos.
- **The Writer asks only for what the finder can deliver:** its IMAGE request and "has a photo" flag use the same checks as the finder.

## 5. Icon backgrounds

- **DECIDED, look (story and stat slides):** the mock-ups in `docs/superpowers/m8-drafts/icon-mockups/`. One large outline icon, faint Helios orange, running off the bottom-right edge, faint orange glow; the text and layout unchanged.
- **DECIDED, cover:** its own format: the icon raised (clear of the headline at the bottom) and slightly brighter. **OPEN:** exact look, from a mock-up.
- **DECIDED:** each icon must relate to the story and the slide (a clock for a deadline, a person for users, a heartbeat for health, a shield for security). **OPEN:** the set, and how the right icon is chosen.

## 5a. Target look for placement (DECIDED)

- **Reference:** the Oct 4 hand-made walkthrough, `docs/superpowers/m8-drafts/reference-carousel-daily-run-2026-10-04.html` (Tommy: its photo placements are "ideal for what we're looking for"). Its photos are placeholders; the placements and the variety are the target.
- What we keep from it: a visual on every slide; layouts rotating (full photo, photo on top, text on top, stat, quote, spread, follow); most slides with text at the bottom over one consistent dark fade, so any real photo blends the way the placeholders do.
- Where it differs from this spec: its symbolic stock photos (wall clock, stacks of reports, cooling towers) are replaced by icon backgrounds; its quote slide without a speaker photo becomes a type-led quote slide on the icon background, not a regular story slide (§4; Tommy, 2026-10-07).
- **Icon slides join the layout rotation** as their own layout, so a run of icon slides doesn't look identical.
- Text length per slide stays as it is (Tommy, 2026-10-07).

## 5b. Render review: vision + feedback loop (DECIDED design; switched on only after calibration)

**Split of jobs.** Before a photo reaches a slide, the finder has verified it (§3): right person, right company, caption matches the slide, stock screened. The render review never decides who is in a photo or whether it fits the story. It only judges how the finished post **looks**.

- **Model:** Haiku 4.5 (the existing photo-vision model setting). One call per post on the post's contact sheet (all slides in one image), with the reference look (§5a) in the cached prefix. Estimated about half a cent per call.
- **How it fixes things (Tommy, 2026-10-07: option B).** The model looks at the rendered **screenshot**, answers fixed questions per slide, and changes the slide's **settings** from a fixed menu. The renderer then rebuilds the HTML from those settings. The model never edits HTML, CSS or text directly. Code checks after every fix that no text changed; a fix that changes text is thrown away and logged.

| Setting it may change | What it controls |
|---|---|
| Crop position and zoom | Where the photo is centred: move a face up, stop cutting off a head |
| Fade strength | How dark the gradient under the text is (within brand limits) |
| Text position | Text at the top or the bottom of the slide |
| Layout | Full photo, photo on top, split, framed inset |
| Photo | The next-best photo the finder already verified, or the icon background |

- **Fixed questions** (per slide; each "yes" points to a setting, with a one-line reason that goes in the log):
  1. Is any face covered by text, or cut off at the edge? → crop position, or layout
  2. Is the photo too busy or bright behind the text to read easily? → fade strength, text position, or layout
  3. Is the photo zoomed in so far it looks blurry or odd? → zoom, or layout
  4. Does the text crowd the HELIOS mark or the arrow? → text position, or layout
  5. Does the photo look awkward or out of place on the slide? → the next-best verified photo, else the icon background
  6. Do two neighbouring slides look nearly the same? → layout
  7. Does any slide look broken or bare? → log it (a render bug, not a setting)
- The renderer keeps its own rules over any setting the model picks (faces clear of text, contrast, text fit, the arrow zone); a setting that breaks one is rejected by the render check.
- **One round:** review → apply the actions → re-render (code, free) → review once more → anything still flagged drops to its icon background. At most 2 calls per post.
- **Limits:** text never changes (it has passed the Editor and Fact-checker); no new photo searches; only runner-up photos that passed every §3 check. Logos and headshots are never swapped for another subject.
- **Everything is logged** (each flag and action). A problem that repeats in 3+ of 10 posts is fixed at its cause (finder, crop code, layout), per the rebuild spec §2.3.
- **Code checks first** (free, already partly in the render check): text fit, contrast, faces under text or cut off, over-zoomed crops, near-identical images, bare slides. The vision review covers what code can't judge.

**Calibration before the loop is switched on.** Run the review report-only on saved posts Tommy has already judged, and compare its flags with his. The loop is switched on only when Haiku agrees with Tommy on most flags; this is the written exception the rebuild spec §2.2 requires for a new AI step. Calibration also reports the real cost per post (estimate: one Haiku call per post on the contact sheet, ~$0.006 per call, 2 calls per post; per-slide calls or Sonnet would cost several times more and are not the design).

**Model choice (Tommy, 2026-10-07): Haiku.** A free open-source model from Hugging Face (Lucas's suggestion) would need Tommy's Mac on during every run or a much bigger worker; parked.

## 6. Out, parked, open

**OUT:** press kits; the per-company approval rows; (c) Commons categories, "depicts" photos and Openverse searches by name; the sunset backgrounds; the Helios-logo cover card; the AI-compute starter photos (replaced by the cover icon); charts; AI-generated imagery; new sources for now (Flickr, Pexels, Unsplash).

**PARKED:**
- A free open-source vision model (Hugging Face) for the render review, instead of Haiku.
- A group of portraits on one slide (e.g. four officials), from the Oct 4 reference.
- **Screenshots of real posts on X for quotes said there.** Top priority to explore after the rework.
- **Government photo galleries** (public domain). First candidate source after the rework. Government-credited article photos already work.
- A paid editorial photo licence, if the account grows.

**OPEN, for Tommy before build:**
1. The cover icon look and the icon set (§5).

## 6a. Clean-up decisions after the Step 0 map (Tommy, 2026-10-07)

Quoted as Tommy gave them:
- "Discard the uncommitted change to lib/social/photos/find.ts only, so the code compiles again."
- "Restore the logo-card grid; its removal was never decided."
- "Stat slides keep IMAGE none; the icon background will be automatic. Fix the stated reason only."
- "Leave commit 32b3234 as is. Add one line to STATUS saying its 'per Tommy' approval claim was wrong."
- Two answers to the map's questions are in §3 (lead image, slide subject). Quote slides: see the corrected §4 row (Tommy, 2026-10-07).
- "Social gets its own new cloud worker (Lucas is setting it up). Never deploy Social to helios-orch-worker." (Plan, M10.)
- Third round (Tommy, 2026-10-07): a speaker still missing after the Reporter's retry: keep the quote, log it, type-led slide; the QUOTES-line edit approved; official images from each company's own news and blog paths only; the naming rule (§3); tags re-checked right after the Editor; the Reporter marks each SUBJECT person or organization; company main photos (headquarters) on story slides, the cover stays the logo card (§2, §4).
- Second round (Tommy, 2026-10-07): §5a matches §4 (type-led quote slide); everyone quoted is a SUBJECT (§4); the official-image text check uses the existing vision call (§3 rule 4); the §3 "depicts" wording; the fixed cases in §7 Step 3.

## 7. How it gets built (DECIDED: the rebuild plan's method)

- **Step 0 — map:** Claude Code describes the current photo code in plain language, read-only, sorted into plumbing (keep), deciding logic (rewrite) and dropped.
- **Step 1 — this spec**, approved by Tommy.
- **Step 2 — pull rule:** keep what fetches, draws or stores (Wikidata/Commons/Openverse/logo fetchers, identity check, credit check, used-photo log, face detector, renderer, the photo bench and its frozen fixtures). Write fresh what decides: the chain (`find.ts`) and the Writer's IMAGE rule, against this spec.
- **Step 3 — links, one at a time, on fixed inputs:** request → identity → search → screening → placement. Each accepted on the bench and frozen before the next. The known failures are fixed test cases: wrong-person "depicts" photos, the soldier and Navy medics, the bar for Anthropic, the 1930s building for Mistral, the hospital, Altman cropped to hands and legs, the same microchip on both covers. Also fixed cases (Tommy, 2026-10-07), where none of those photos may ever appear for those requests:
  - **R10:** the Mistral cover, where subject "Mistral AI" got the brick building (the "1930s building for Mistral");
  - **R03:** the same brick building for the Altman "laptop warning screen" request;
  - **R13:** the San Francisco townhouse for "government building exterior";
  - **the Oct 6 21:17 Le Chonk cover:** a biology lab with a WARNING sign, picked from the word "lab", and its lab-bench inset.
- **Step 4 — checkpoint run** with Tommy's OK and a cost estimate; fix only what repeats in 3+ of 10 posts.
