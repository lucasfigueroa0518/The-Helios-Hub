# Field Notes — living plan

Method: bald-eagle-iteration. Decisions accumulate here; no code until the build stage.
Status: Stage 1 (Align), 2026-11-04.

## Tommy's words (verbatim)
> "a new Ball Knowledge Drop content type. This will feature real pictures taken and uploaded by Lucas and me of us working or scenery photos; the design will see the image and format almost whiteboard-looking text around the images that speak to different tips for AI. I want to make MECE buckets for AI tips ... The idea search and selection, the design generation, and the font selection of the text should fit brand uniformity ... All this is text overlayed on real photos taken from our iPhones."

## Grounding (what exists today)
- "Ball Knowledge Drop" is already a **Text on Screen reel bucket** (`planning/Trial Reels/PRODUCT_SPEC.md` §1): names free tools by what they replace, never the tool's name; fed by GitHub Trending / Awesome-lists / Hugging Face. `chosen_bucket = 'ball_knowledge'` is read by Stories (Free vs. Paid). **Naming collision with this new type.**
- Content types plug into the Social Hub through `lib/content-type/*` (model, idea-queue, idea-rank, caps) and per-type libs (`lib/carousels`, `lib/explainers`, `lib/reels`).
- Seeding is per content type (`docs/superpowers/specs/2026-10-30-seeding-paths-by-content-type.md`): this type's idea path (LLM-authored tips vs. source links) must be mapped up front.
- Brand (helios-design-system): Pragmatica Extended Bold headlines, Roboto 300 body, orange for action, green for structural metadata, off-black `#171717`; **no hand-drawn illustration, texture, or grain; no emoji; Lucide icons only**; logo fully on-canvas with H-height clear space; image overlays only with dark-to-transparent gradient when text needs to read.

## Call notes with Lucas (Tommy, 2026-11-04, verbatim)
> "MECE trees. Open source and not open source. Within open source, you have skills and repos. Not open source is paid tools. Need to map out that whole landscape. Current scope is more educational than he thought it'd be; Lucas wants our content to be MECE across the board."
> "Features of a program, not just commonly known facts—things like the humanizer skill or a lesser-known feature in Claude. The content needs to feature tips that can help someone who uses AI [and] doesn't know. I want to maybe crawl through Reddit to find tips that someone who uses AI properly might not know can help their flow."
> "not only should the buckets here be MECE, but all of our content types should serve in a MECE tree. For example, this might have a lot of overlap with explainers; that is an issue."

## Overlap found in the code/specs (reading only, nothing run)
- **Text on Screen / Ball Knowledge Drop**: tool discovery (free apps/repos from GitHub Trending, Awesome-lists, HF) — overlaps Field Notes' "open source repos" leaf.
- **Stories / Free vs. Paid**: tool pairing — overlaps the "paid tools" leaf.
- **Explainers**: educational, a model writes scope from a topic title — overlaps any concept-style tip.
- **Stories / Guess the Number**: trivia — no overlap expected.

## Parts of the system (one-line responsibilities; CONFIRMED by Tommy 2026-11-04, "Looks right")
1. **Source discovery**: finds candidate tips in the places we name (e.g. Reddit, GitHub, vendor docs and changelogs). Never judges them.
2. **Tip record + verification**: turns a candidate into one tip (what, where to find it, steps, source link, how it was checked) and rejects any tip that cannot be verified. Never writes post copy.
3. **Audience tagging**: sets each tip's target range (new to the top level, doable at the bottom) using the audience tree. Never picks photos.
4. **Selection**: ranks verified tips and keeps the week's mix covering the audience cells. Never touches photos.
5. **Photo intake**: takes iPhone uploads from Lucas and Tommy and reads each photo (subject, open space, safe zone for the logo). Decides nothing about tips.
6. **Pairing**: matches a selected tip to 3-5 photos, one per slide, each fitting its slide's space and scene.
7. **Layout/design**: sees the photo and places layered annotation text around the subject in brand fonts. Owns placement, never the words.
8. **Copy**: writes the headline, steps, "why" and "catch" for the tip's range. Never changes placement.
9. **Checks + human review**: code catches breakage (logo clear space, text overflow, readability); a person approves taste. Nothing posts without approval.

## Method (Tommy, 2026-11-04)
> "The buckets from earlier were the wrong way of thinking and should be discarded. We need to define all the sources we can pull ideas from and then define what our viewers actually want. Then map the two out."

The seven "moment of use" buckets (Decide, Set up, Ask, Feed, Check, Protect, Systemize) are **discarded**, including the variety-tag idea.

1. **Supply**: every source we can pull ideas from, as a MECE tree. Two layers: *what the tip is about* (draft: open source → skills, repos; not open source → paid tools' features) and *where we discover it* (e.g. Reddit, GitHub, vendor docs/changelogs).
2. **Demand**: what our viewers actually want from a tip. To be defined, ideally grounded in our own post performance.
3. **Map** supply to demand. The content buckets come out of the map, not before it.

## Demand evidence: our own post performance (read-only, 2026-11-04)
One read-only transaction on `social_hub.media_insights` / `reels.media_insights`, latest snapshot per post. No model calls, no cost. **Samples are tiny: directional only.**

| Type | Posts | Median views | Avg save rate (of reach) | Avg share rate |
|---|---|---|---|---|
| Reels | 32 | 147 | 0.48% | 0.29% |
| Stories | 27 | 80 | n/a | n/a |
| Explainers | 3 | 52 | 2.70% | 2.94% |
| Carousels | 1 | 151 | 2.33% | n/a |

Reels by bucket (Text on Screen): The Saga 11 posts, median 176 views, ~0 saves/shares; The Number 7 posts, median 122; Ball Knowledge 2 posts, median 91, 0 saves/shares.
Reading: the account is small (about 150 views a post). Saves and shares are near zero on reels but around 2–3% on the few static/educational posts. Weak hint that saveable, educational statics earn saves; three posts cannot confirm it.

## Demand: the audience (Tommy, 2026-11-04, verbatim)
> "Some of our target audience: AI Builders / AI-curious people who want to know more. / People trying to get better at using AI at work. / Deep AI lovers."

## Supply: draft tree (hypothesis, to confirm)
Rule for layer 1: can anyone read and copy the code?
- **Open source**
  - Skills (agent skills such as the humanizer)
  - Repos (GitHub projects, tools you install)
  - (candidate leaves, not yet in: open-weight models, MCP servers/plugins; decide whether they fold into Repos)
- **Not open source**
  - Paid/closed tools: lesser-known features of products like Claude, ChatGPT, Cursor
Layer 2 (where we discover): Reddit, GitHub, vendor docs and changelogs, plus others to name.

## Audience tree by expertise (Tommy, 2026-11-04, verbatim; "pump the brakes", audience before supply/map)
> AI Builders: novice (just started using Claude code) · intermediate (understanding more building concepts) · professional (knows how everything works when they are recommended something)
> AI Curious: recently heard of AI for the first time and trying to understand it · played around with some chatbots · wants to or is using AI at work to be more productive

Tommy, later: "lets add in the other 2, sorry those initial 2 were just break downs" (Builders and Curious were breakdowns of the first two groups; the other two groups get their own breakdowns).

Draft breakdowns for the other two (mine, to correct):
- **Work improvers**: tries AI occasionally at work · uses it daily and has habits · has built workflows or teaches coworkers.
- **Deep AI lovers**: follows every release and tries each new tool · power user who customizes deeply (system prompts, skills, MCP) · understands internals and evaluates models.
Overlap to settle: Curious level 3 ("wants to or is using AI at work") duplicates Work improvers. Draft fix: Curious ends at "played around with chatbots"; Work improvers start where work use begins.

(Superseded question) Open: where "deep AI lovers" and "people trying to get better at using AI at work" sit (Curious level 3 reads like the work group). Each level needs one shared test; draft test = what the viewer needs when handed a tip (explained step by step / the concept behind it / only the pointer).

## Finding: one account, one audience
All types publish through a single `IG_BUSINESS_ACCOUNT_ID`, so one follower base sees every content type. The audience tree is therefore the shared **demand axis for all content types**, not a Field Notes–only list. Each post targets one audience cell; the week's mix should cover the cells. Tommy: "We should go in depth on these 4 more; realistically, they will all see each content type."

## Cross-type tree (draft, 2026-11-04)
Correction (Tommy): Memes are not a content type; they are used as photos inside Last Few Days. Not on the tree.
Source of the type list: the spine's verticals (`carousels, explainers, reels, stories, last_few_days, ai_events`) plus Stories' three series and Text on Screen's six buckets. Read from specs, nothing run.

Draft rule for the top split: does the content expire? (what is happening now vs. what stays true)
```
Everything we post
├── Time-bound (expires)
│   ├── News ........ Carousels (deep dive) · Last Few Days (Tue/Fri recap) · Stories: Morning Download · Text on Screen: The Saga, The Number
│   └── Events ...... AI Events This Week
└── Evergreen (stays true)
    ├── Concepts .... Explainers (what X is, 45s, illustrated)
    ├── Tools ....... Text on Screen: Ball Knowledge Drop (tool exists) · Stories: Free vs. Paid (two tools compared)
    ├── Use ......... Field Notes (a lesser-known way to use something you have)   <- new
    ├── Trivia ...... Stories: Guess the Number
    └── People ...... Text on Screen: Personal Profile
Unplaced: Text on Screen's The Warning ("stop doing X, do Y") and The Callout (not read yet).
```
Overlap risks for Field Notes: **The Warning** (stop X, do Y reads like a tip), Ball Knowledge/Free vs. Paid (tool discovery), Explainers (concept). Format is a separate axis (reel / story / carousel / static) and is not in this tree.

## Post targeting (DECIDED by Tommy 2026-11-04: "Yes, layered default")
Tommy leans: "a tip that is achievable for both, like a feature in Claude, that a builder might not know about."
Lucas (2026-11-04): "It's up to you. You could either have a mix of them in each post or each post is targeted to someone new. I lean towards mix of each so there's something for everybody in each post, but it's up to you. Maybe a post that's fully towards a builder evokes a more extreme reaction from the builder and that converts to actual engagement."
Decision: default = **layered range** (new to the top of its range, doable at the bottom; headline for anyone, steps for the lowest level, a "why" and a "catch" for higher ones). Allow **targeted** posts on purpose, labelled with their cell. Every post stores its target range so analytics can compare layered vs. targeted later (samples are small today).

## Tentative: first audience (set before the audience was fully built; revisit)
- **Work improvers lead** (Tommy: "Get better at work"): people trying to get better at using AI at work.

## First map (premature, parked until the audience is built out)
Demand, in outcomes they want: save time on something recurring · better output · fewer mistakes · know what exists.
| Supply leaf | Fit for work improvers | Why |
|---|---|---|
| Paid-tool features | Strong | Already installed or paid for; zero setup; hits all four outcomes |
| Skills | Strong | One install, clear before/after (e.g. humanizer = better output) |
| Repos | Weak for this audience | Needs install and technical comfort; mostly serves builders (later) |
Proposed first batch: paid-tool features + skills. Repos wait for the builders audience.

## Supply x audience map (draft, 2026-11-04; hypotheses)
Open tension: the boundary test pushes Repos toward Ball Knowledge (a tool exists). Skills/repos count for Field Notes only when the post teaches a lesser-known *use* with a result, not that the thing exists.
| Supply leaf | Curious | Work improvers | Builders | Deep AI lovers |
|---|---|---|---|---|
| Paid-tool features | Strong: one visible setting to try | Strong: saves recurring time | Medium: only features that change how they build | Medium: only if truly obscure |
| Skills (use with a result) | Weak: install friction | Strong: one install, clear before/after | Strong | Strong |
| Repos (use of a known repo) | None | Weak | Strong | Medium |

## Inventory (Stage 4; two read-only code surveys, 2026-11-04; nothing run)
**Reuse as-is:** Chromium fit-check render pipeline (`lib/social/render/fit-check.ts`), `storeSlideJpegs`, JPEG upload and signed URLs; `createCarousel` (Meta) and the account gate; approvals, `publish_attempts`, publisher and 30-min feed spacing; `helios-social` worker process and `deploy-social-worker.sh`; brand CSS and fonts; Reels adapters (rss-feed, markdown-changelog, tldr, hacker-news, github, github-trending, awesome-lists) imported read-only; Jev runner, `defineQuestionSet`, `jevUsd`; `lib/anthropic-cache.ts`, pricing.
**Reuse with change:** `SlideTemplate` dispatch (new slide kinds); `follow.tsx` closing slide (photo version); vertical registration (~60 files; copy the `ai_events` pattern; schema CHECKs are re-declared in several blocks of `db/social_hub_schema.sql`); idea-queue/idea-rank/seed button/caps (closed `Vertical` union); photo bank + `image-preprocess` (HEIC rejected today; `licence` CHECK has no "own"); no-repeat log (7-day, local JSON today); captioner + humanizer + 2,200 check; web-search `checkGrounding` pattern (the search itself costs money).
**New:** `db/field_notes_schema.sql` + apply script; `lib/field-notes` engine, route, hub page, driver, adapter, health reporter; docs/help-center reader; Field Notes Jev question set (verifiability, audience-range fit, lesser-known-ness; wording needs Lucas's approval) and cost table; photo upload box + API; HEIC to JPEG and location strip; vision read (subject, open space, logo safe zone); annotation overlay layout; logo clear-space check; audience tagging, selection, pairing, copy.
**Surprises to resolve:** (1) `fit-check` fails any text over a detected face and `SlideTemplate` says full-bleed photos are scene/mood only; Field Notes puts text on photos of the team, so the layout must keep text off faces or the rule changes deliberately. (2) `follow.tsx` hard-codes `@heliosgroup.ai` and a text "HELIOS" wordmark; the design system lists `@heliosmarketingg` and a real logo asset; the CTA handle and logo need a decision. (3) No-repeat should count posts, not 7 days. (4) Build touches Tommy-owned `lib/social/`; branch choice is Tommy's (no branch created). (5) Apply DB schema before the worker redeploy; deploy refuses a dirty tree or in-flight run.

## Open decisions
- Supply tree: things vs. places, and its leaves.
- Demand: who the viewer is and what they want.
- Boundary lines between Field Notes and Explainers / Text on Screen / Free vs. Paid; a cross-type MECE map as its own doc.
- Reddit as a seed source: subreddits, cost rules, tiny stubbed fixtures only.
- Photo intake path (where uploads land, how many on hand).

## Decisions made
- **Name: Field Notes** (Tommy, 2026-11-04: "Call it Field Notes"). "Ball Knowledge Drop" stays the Text on Screen reel bucket; this type never uses `ball_knowledge` identifiers.
- **Look: brand-true whiteboard** (Tommy: "Yes, both"). Pragmatica Extended Bold + Roboto Light; the whiteboard feel comes from annotation structure (orange/green underlines, brackets, boxed callouts, Lucide arrows). No handwriting font, marker texture, or grain.
- ~~Format: one 4:5 static image per post~~ **Superseded 2026-11-04** (see next entry).
- **Seven moment buckets discarded** (Tommy: "wrong way of thinking"). Buckets come from mapping supply to demand.
- **One subject** (Tommy, 2026-11-04: "One subject"): Field Notes carries only lesser-known ways to use something (the Use branch). First-hand experience stays out for now and can be added later; the photo/annotation engine is reusable.
- **Audience tree settled** (Tommy: "Yes, split there"): Curious ends at "played around with chatbots"; Work improvers start where work use begins. Four groups, three levels each:
  - AI Builders: novice · intermediate · professional
  - AI Curious: just heard of AI · played around with chatbots (two levels; the old third level moved to Work improvers)
  - Work improvers (draft levels): tries AI occasionally at work · uses it daily with habits · has built workflows or teaches coworkers
  - Deep AI lovers (draft levels): follows every release and tries each tool · power user who customizes deeply · understands internals and evaluates models
  Tommy confirmed all four groups' levels ("Looks right", 2026-11-04). Audience side is done.
- **Boundaries decided** (Tommy: "Yes, these lines", 2026-11-04). Test: "Is this about using something the viewer already has, to get more out of it?" Yes = Field Notes. Concept = Explainers; a tool exists = Ball Knowledge Drop; two tools compared = Free vs. Paid; a risk or mistake = The Warning. "Stop X, do Y" is Field Notes only when the point is the gain.
- **Tolerated overlap** (Tommy, 2026-11-04, read as Ball Knowledge Drop; "Bonanz drops" was voice-to-text): overlap between Ball Knowledge Drop and Free vs. Paid is fine, "they're only around for a little bit." This relaxes that one boundary only; Field Notes' lines stay as decided. (Stories' Free vs. Paid already reads Ball Knowledge ideas as a pool, `planning/Stories/BUILD_PLAN.md`.)
- **Skills and repos count only as a use with a result** (Tommy: "Yes, use with result", 2026-11-04). "It exists" posts are Ball Knowledge Drop's.
- **Format: a carousel of 3-5 real photos, the last one a CTA on an actual photo** (Tommy, 2026-11-04: "This is a multi-slide post, a carousel of photos, 3-5, with the last one being a CTA on an actual photo."). Replaces the one-static-image decision. Consequences: layering becomes sequential across slides (draft: slide 1 headline for anyone, middle slides steps then why/catch, last slide CTA); pairing is per post (3-5 photos); the CTA photo is a real photo too, so logo clear space and readability rules apply there.
- **CTA: Follow Helios** (Tommy, 2026-11-04: "Follow Helios"). Last slide, on a real photo. No pitch (D-211).
- **Slide count: 3-5 content slides plus the CTA slide** (Tommy, 2026-11-04: "No, plus CTA"), so a post is 4-6 slides total. Each tip decides its length.
- **Photos in one post can be mixed** (Tommy, 2026-11-04: "Mixed is fine"). Same-shoot is preferred, not required.
- **Photo intake** (Tommy, 2026-11-04): "about 25" photos now. "There'll be a place for Lucas and me to upload photos, and then we'll look at the metadata of those photos to make sure there are no duplicates or anything like that. That should be an easily accessible upload box within that content type's window."
  Grounding (read-only): the repo already has a photo bank, `media_library.photos` (`db/media_library_schema.sql`): unique `sha256` per image, `dhash` (perceptual), vision tags (`subjects`, `scenes`, `tags`), EXIF-oriented size; and `social.used_photos` for the 7-day no-repeat rule. Candidate to reuse; its licence field is built for finder-sourced images, so own photos need an "own" licence value or their own table.
  Notes for build: iPhone files are often HEIC; EXIF carries GPS location, so published slides must be stripped of location metadata (originals stay private); metadata alone misses re-exported or AirDropped copies (metadata stripped), so dedupe should use sha256 + dhash with metadata as a hint; reading each photo with vision is a live model call, so it needs a cost estimate and Tommy's go-ahead before it runs.
- **Photo reuse: after a gap** (Tommy, 2026-11-04: "Yes, after a gap"). Never twice in one post; the gap length is set in the build (the bank's existing no-repeat rule is 7 days); the upload box shows "photos left".
- **Reddit candidates** (web search, 2026-11-04; counts from third-party trackers, approximate): r/ClaudeAI (~1.2M), r/ClaudeCode, r/ChatGPTPro (~620K), r/PromptEngineering (~426K), r/ChatGPTCoding, r/AI_Agents, r/LocalLLaMA (~760K), r/ChatGPT (largest, general). **Access caveat (secondary sources, verify against Reddit's own terms):** commercial API use reportedly needs a paid or negotiated agreement, scraping is prohibited by Reddit's terms, and unauthenticated .json / RSS access is reportedly being shut off. Safer design: a person reads Reddit and pastes a thread link as a seed (same pattern as the other types' seeding), no crawler. Not decided.
- **Reddit Data API access (web search, 2026-11-04; secondary sources only, Reddit's own pages blocked for our tools):** access runs through a request/ticket under Reddit's Responsible Builder Policy, not just creating an app; commercial use reportedly needs explicit written approval; denials with no stated reason are reported; a launch-thread admin aimed for ~7 days. Unverified: a blog claims new public requests closed 2026-10-31 (today is 2026-11-04). Decision: do not depend on it; paste-a-link seeding stays the working path; Tommy may file a request later (a person files it, not us).
- **Source places beyond Reddit** (Tommy, 2026-11-04: "I don't want to have to paste a link every time"). Existing adapters in `lib/reels/adapters/` (read-only look): `markdown-changelog`, `rss-feed`, `tldr`, `hacker-news`, `github`, `github-trending`, `awesome-lists`, `hf-papers`, `web-search`. Candidate Field Notes sources: vendor release notes + docs/help centers (paid-tool features), public agent-skill repos and awesome lists on GitHub (skills), Hacker News, practitioner blogs and newsletters via RSS, YouTube transcripts, Bluesky. Caveat: changelogs surface *new* features; "lesser-known" needs the older docs/help-center back catalog too. Not decided.
- **First-version source places: vendor release notes + docs/help centers, GitHub (skill repos + awesome lists), Hacker News, practitioner blogs/newsletters via RSS** (Tommy: "Docs, GitHub, HN, RSS", 2026-11-04). YouTube, Bluesky, Reddit later or optional. Reuse existing adapters where they exist; docs/help-center reader is new. Fetching is free; model extraction needs a cost estimate and Tommy's go-ahead before any live run.
- **Text avoids faces** (Tommy, 2026-11-04: "Yes, text avoids faces"). The existing fit-check face rule stays; annotations are laid out around the people. The "full-bleed photos are scene/mood only" layout rule still needs a deliberate carve-out for Field Notes photos; to settle in the contract.
- **Follow handle: @heliosgroup.ai** (Tommy, 2026-11-04). Matches the existing `follow.tsx`. The design system's README lists @heliosmarketingg; not changed here.
- **Photo rests 4 posts before it can return** (Tommy, 2026-11-04: "4 posts"). Counted in posts, kept in the database. Math flag: at 4-6 photos a post, ~25 photos leave only a handful available after a few posts, so the upload box must show "photos left" and warn before the pool runs short.

## The process (Stage 5, APPROVED by Tommy 2026-11-04: "Approve the flow")
```
Docs / GitHub / HN / RSS            Upload box (Tommy, Lucas)
        |                                   |
 1 Source discovery                  5 Photo intake
        |                              dedupe, HEIC->JPEG, strip location,
 2 Tip record + verification           vision read (subject, open space, logo zone)
        |                                   |
 3 Audience tagging                         |
        |                                   |
 4 Selection (ranked bench) ----+----- 6 Pairing (3-5 photos, rested 4 posts)
                                |
                  7 Layout + 8 Copy (layered, around faces)
                                |
                       Render + checks (faces, logo, overflow)
                                |
                       9 Human review -> approve -> publisher
```
- **Cadence: 1-2 posts a week** (Tommy, 2026-11-04: "Maybe 1-2 a week"). Photos are uploaded weekly.
- **Photo rest: 4 posts "might not be long enough"** (Tommy, 2026-11-04). With 1-2 posts a week and weekly uploads a longer rest is affordable. Length to be set (proposal: 8 posts, newest photos first). Supersedes the 4-post entry once set.
- **Contrast-aware text, always** (Tommy, 2026-11-04): "white fill on dark photos, black fill on really bright photos; if it's in between, then lower the exposure on the photo and put the white text." Recorded in DESIGN_SPEC.md. Brand note: the "black" is the system's off-black `#171717`, never pure black.
- **Design spec started**: `planning/Field Notes/DESIGN_SPEC.md` (draft; taste calls marked for Tommy).
- **Photo rests 8 posts before it can return** (Tommy, 2026-11-04: "8 posts"). Supersedes the 4-post entry. Newest photos first when pairing. Kept in the database; upload box shows "photos left".
- **Generation starts manual; auto-run switch ships OFF** (Tommy, 2026-11-04: "yeah we can start with it off"). Built so it can run automatically later (per-run spend cap, drafts wait for approval). Publishing stays approval-gated and `publishing_live` ships off, like the other types.

## Decision 2026-11-04: annotation style
Tommy: "Style 1: underline + arrow". Default look is the orange underline plus Lucide arrow, max 2 marks per slide; no box or bracket for now. Mock: `mock/mock-sheet-1.jpg` (three styles on his example photos). Mock findings folded into DESIGN_SPEC section 5: calm-region placement (edge density), head margin, no prominent third-party logos, manual reject in upload box (last item awaiting Tommy's confirmation). Branch `field-notes` fast-forwarded to origin/main; CONTRACT.md drafted, open items listed there.

## Feedback 2026-11-04 after the first example posts (Tommy's words quoted)
Examples seen: `mock/examples/example-post-a.jpg`, `example-post-b.jpg` (hand-written copy, real pipeline, real photos).

**Photo selection.** "in that first example, we use only laptop photos. We need diversity, and that first slide needs to be a better photo. A more lively one."
**Copy.** "More in-depth; right now it's far too simple, far too obvious. A tip is not 'ask it to interview you.' We'd lose all credibility if that is what we are suddenly recommending AI users do. It should be about skills like '/goal' and explaining what said skill or tool is and how to use it properly."
**Design.** "Far too formal. This needs to feel authentic, like Lucas or I designed it ourselves. Not another almost corporate-feeling post. Text with whiteboard-drawn-looking annotations, even referencing the photo behind it. Almost like a notebook. Instead of making a dark box behind text, understand text placement and how to make it contrast almost naturally."

Conflicts with earlier decisions, to be resolved with Tommy: DESIGN_SPEC section 4 and the helios-design-system skill ban hand-drawn strokes, marker fonts and texture ("brand-true whiteboard look", decided earlier). The new direction reverses that for these posts. The soft darkening patch (DESIGN_SPEC section 3, built) is what Tommy calls the dark box.
My own faults to own: the example copy was mine and shallow; the Writer prompt and caps also push simple (hook headline cap 60 characters, "anyone gets it"); photo picking is newest-first with no variety rule.

## Feedback 2026-11-05 on the notebook render (Tommy's words quoted)
"The see this makes no sense. Any tip should only be on one slide. Any post should start with a photo of our faces. Now that I'm looking at it, the photos of the car and golf don't work. Too far-removed from tech. I don't like the titles of each slide. It's classic slip. 'Set a goal it can check'? As a viewer I'm confused. As me I can tell you've scoped it too hard to desktop app Claude tips. 'Stop re-explaining yourself. Save it once with memory.' Like huhhhh. What, when, why, how."

Reading, pending Tommy's confirmation:
- Margin notes and arrows aimed at a saliency blob ("see this", "look at this", circle on a lamp) read as nonsense: nothing knows what the photo shows. Drop photo-pointing marks; annotate the text itself.
- A tip lives on ONE slide and answers What, When, Why, How. This likely changes the post shape (earlier: one subject per post across hook/steps/why slides).
- Slide 1 of every post is a photo with our faces (face detection can verify it).
- Photos must stay close to tech: car/golf out. Scenery as a kind is in question.
- Slide titles: plain and literal (the thing's real name and what it does), no promise-style or clever lines.
- Scope: not just Claude desktop-app tips; any AI tool, skill or repo (the original MECE tree: open source skills, open source repos, paid tool features).
Own faults: the builder's sample copy and the Writer prompt's "hook = payoff" rule produced the vague titles; the saliency arrows were my call and I called them a weakness; sources in the registry lean Anthropic and Claude Code.

## Decision 2026-11-05: Tommy and Lucas (Fig) talked it through; answers to the post-shape question
Pasted chat. Lucas: "Bro yes. Damn we were not on the same page." / "No that doesn't deserve its own post. With good writing you can do that in one slide, in like 20 words max." Tommy: "That'll keep engagement up I think."
- **Post shape settled: one tip per slide.** A post is a carousel of several tips, not one tip spread over hook/steps/why slides. Replaces "one subject per post". Each tip slide is about 20 words max.
- **Each tip slide names the problem it solves for the viewer.** Lucas's illustration of the register (his wording, an example of style only, not verified copy and not to be put in any prompt): a skill "makes sure your Claude keeps working through checks/pauses until it finishes exactly what you want. Step away, and come back to your task finished." Replaces the "What, when, why, how" four-part reading with: what it is, the problem it solves, how to use it, in about 20 words.
- **Photo policy:** Tommy: "be aware and be ok with everything we upload being posted potentially". Upload box gets a plain notice; the manual-reject for readable screens/strangers stays as a courtesy, not a gate.
- **Upload:** Lucas: batch select / bulk upload, "works every time and it's instant". Tommy has an HEIC-to-JPEG converter and may add an "upload from photos" feature for mobile uploads; he is unsure bulk works because the converter and metadata read may need one file at a time. Open: our server upload has a 4 MB per-file cap (Vercel body limit), which HEIC from newer iPhones can exceed.
Still open from the earlier round: slide-1 faces rule, scenery kind, tool scope and sources, plain titles.

## Decision 2026-11-05: scenery stays; upload goes direct to storage; source search run
- **Scenery stays as a photo kind** (Tommy: "I don't hate scenery, though, for example, that photo of the church I uploaded"). Slide 1 is still a faces photo. Off-topic photos (car, golf) are handled by a manual reject/retire in the pool grid, not by dropping the kind.
- **Direct-to-storage upload approved** (Tommy: "we can switch to storage"). Browser sends each file straight to the private `photo-bank` Supabase Storage bucket (`PHOTO_BANK_BUCKET`, `lib/media-library/types.ts`); the server then fetches, converts HEIC, reads EXIF, dedupes. Removes the 4 MB Vercel body cap. Not built yet.
- **Source search (Tommy: "You search for them")**: 6 standard web searches, no model spend in the app. Results were mostly third-party guides; official pages named but NOT opened or verified: Claude Code docs (docs.claude.com/en/docs/claude-code), Codex (developers.openai.com/codex, github.com/openai/codex), OpenAI Help Center projects article, Cursor (cursor.com/docs, cursor.com/changelog), Gemini CLI (geminicli.com/docs), VoltAgent/awesome-agent-skills. Each needs a real fetch before it enters the registry.

## Feedback 2026-11-05 on the v2 sample sheet (Tommy's words quoted)
"The text boxes can be a bit more free-flowing; they do not need to be one single text box; they can be multiple on one side with arrows connecting them. Also, the placement of the text is important. The Google building one is a prime example of u needing to be better at filling in the space properly. Imagine two text boxes that uniquely fit the border of the building in that one."
Reading, pending confirmation:
- A tip slide may be several short text pieces, not one block, joined by hand-drawn arrows that run text to text (name -> what it solves -> how to use). This reopens "no arrows": the arrows removed on 2026-11-05 were the ones aimed at the photo; text-to-text arrows are wanted.
- Placement fills the free space: find the calm areas (sky beside a building, a wall, a table), put one piece in each, shaped to the edge of the subject instead of one rectangle.
- This also answers the open strictness question: small calm areas become usable, so a busy photo no longer needs to fail.
Open: Writer output must become a few labelled pieces (about 20 words in total); the layout planner must place several regions per slide and route arrows between them.

## Decision 2026-11-05: copy gets context; layout becomes one reading cluster; samples from verified tips
Tommy on the two real-length sample slides: "The copy is poor and lacks context and explanation. The design is confusing and a bit all over the place. I agree with your 4 fixes" (snug command circle; text off lights and screens; short orange arrows; place by surroundings). Then "Take your picks":
- **Copy target about 35 words per tip slide** (was 20): the name, then what it is and why it matters in plain words (`solves`, about 25 words), then how to use it (`how`, exact usage, about 10-12 words). Lucas's "about 20 words" stays as the tightness goal; context outranks the count.
- **Layout: one reading cluster.** The three pieces stack in order (name, explanation, how-to) on one side of the photo; one short orange arrow joins name to how-to. Free multi-region placement is kept only as a fallback for hard photos, and only where the pieces still read in order.
- **Samples come from official pages, fetched free 2026-11-05** (no model spend): code.claude.com/docs/en/common-workflows. Verified there: `claude --worktree feature-auth` gives each session its own checkout on its own branch so parallel edits do not collide (the short flag `-w` is NOT on that page; earlier sample copy used it and was wrong); plan mode (`claude --permission-mode plan`, or `Shift+Tab` mid-session) reads files and proposes a plan with no edits until approved, status bar shows `plan mode on`. The Cursor `/Generate Cursor Rules` claim was NOT found on cursor.com/changelog page 1; unverified, do not use.

## Align 2026-11-06: rewire design and copy (bald-eagle-iteration, Stage 1)
Tommy: "we need to take some steps back in terms of copy and design. I have been over complicating it and trying to over stylize it. This should be simple text set over images working through contrasting issues of the text on the background. lets use /bald-eagle-iteration to rewire the design and copy systems."
Reading, pending confirmation: plain text on real photos; the hard part to solve is legibility (contrast) of that text on each photo; the notebook styling (hand-drawn marks, arrows, circles, underlines, handwriting font) and multi-region packing were over-stylizing. Candidates to remove: arrows, circle/underline marks, emphasis field, multi-region packing (`render/pack.ts`), handwriting font. Candidates to keep: faces cover, photo pool/variety/upload, sources, Writer/Editor/gates/fact check, contrast measurement. Nothing built this turn.
My faults to own: I added each style layer in response to a taste note without asking whether the layer was wanted; the Writer's pieces were shaped for the layout, not for a reader.

## Pivot 2026-11-06: audience and content trees become the source of truth (bald-eagle-iteration, Stage 1)
Tommy: "I'm making a pivot. I have written up two MECE trees that will act as a new foundation for this content system. This will be the source of truth for who our audience is and what they want." / "My end goal is to build frameworks that accurately define who our audiences are, what they want, and how our content brings value to them. I do not want to target the lower-third AI know-how class, nor do I want to target Helios followers." / "In terms of ingestion and pool management for content ideas, we want to build our system in a way that can bring the most value and the ideas that people actually want."

His trees (verbatim structure):
- Audience, tier by AI know-how: LOWER THIRD (Curious, Comfortable). MIDDLE THIRD (new Skills; Features on LLM apps such as /goal; Prompting tips). HIGHER THIRD (Newest updates: tools, best practices, workflows, "already or should be using"; Repos, new API keys, new MCP connectors).
- Audience, purpose: PROFESSIONAL (automate repetitive tasks; new perspectives on prompting; learn skills for things they do manually). HOBBYIST (push AI to its limit; new perspectives on prompting). PERSONAL USE (grocery list; simple everyday tasks like a calendar entry).
- Audience, relation to Helios: FOLLOWER / NON-FOLLOWER.
- Content: Open Source (Repos: data repos, repos that mimic paid services, "expand this list"; Skills; "suggest any more"). Paid Tools (Coding agent hacks, features, functionality; new product launches).

Decided by Tommy: lower third is out; Helios followers are out (target is strangers who do not know Helios). Everything else on the trees is a draft he asked me to expand.

Reading, pending confirmation (my findings on the trees, not yet his decisions):
1. The audience tree mixes three things: who they are (tiers, purposes), what they want (listed under tiers and purposes), and what we publish (skills, repos, launches). Wants and supply need their own trees, with a map between them.
2. Content has no leaf for tool-agnostic practice (prompting, workflows, best practices) although the audience tree asks for it three times. "New product launches" and "newest updates" are about recency, not type, so they cross-cut the type tree.
3. PERSONAL USE as written (grocery list, calendar entry) sits in the excluded lower third.
4. Missing audience: people who build products or agents with AI (the earlier plan's "AI Builders"); also creators and students.
5. Scoring (`sources/questions.ts`) asks only lesser_known, concrete_result, single_subject, new_enough: nothing asks who wants it. That is where "ideas people actually want" would enter. Wording is placeholder and needs Lucas's approval (Tommy approves for him).
Nothing built this turn. No code, schema or prompt edits.

## Decision 2026-11-06: Tommy's corrections to the pivot read
Tommy: "Someone who's a personal user might act like a lower-third behavior or lower-third know-how tier, but might not be in that tier. For example, someone who just uses it daily might have a high level of knowledge of AI, so we can keep targeting someone who uses it daily rather than excluding them because you assume they're in the lower tier."
- **Know-how tier and purpose are independent axes.** Personal use stays as a purpose. The lower-third exclusion applies to tier only; my earlier finding that Personal use contradicts it is withdrawn (it assumed purpose implies tier).
- **Content: skills only for now** (Tommy: "Let's just stick to skills for now") on the skill side. Subagent, slash command, hook and config-file leaves are NOT added. Before cutting, Tommy asked for plain-language examples of what such posts would look like (given in chat 2026-11-06, illustrations only, unverified against docs).
- **Audience purposes:** Builder added. Creator and Student not added "for now".

## Decision 2026-11-06: subagent, slash command, hook and config-file content cut
Tommy, shown example slides for each: "Cut them". They are not a leaf and not folded under coding-agent features. Skills stays the only open-source skill leaf. Coding-agent features stays as Tommy wrote it ("hacks, features, functionalities"); these four types do not feed it.
Still open: Personal use wants list; next step (wants tree vs design/copy rewire).

## Decision 2026-11-06: Personal use wants kept; wants tree walk begins
Tommy: "keep, and walk the wants treee". Personal use wants kept as drafted: smarter everyday routines (calendar, email, notes), better prompts for everyday tasks, a personal setup that remembers them, tools that remove a daily annoyance.

Draft wants tree (my proposal, pending Tommy). Rule: the benefit the viewer gets from using the tip.
- Faster: do the same thing with less effort (automate repetitive tasks; skills for manual work; everyday routines; remove a daily annoyance).
- Better: get better output from the same thing (new perspectives on prompting; everyday prompts).
- Newly possible: do something they could not before (push AI to its limit; repos, MCP connectors, API keys; a setup that remembers them).
- Stay current: not be behind (newest updates; "already or should be using").
- Cheaper (my addition, not in Tommy's tree): spend less (free alternatives to paid services, which his Repos leaf already holds).
Held out as candidates, not in: avoid mistakes (security, privacy, hallucination); choose between tools (comparisons).
Proposed wiring: each tip carries one primary want; the slide's "solves" line serves it; scoring asks who wants it; want weights start equal and are later learned from post performance.

## Decision 2026-11-06: wants tree confirmed
Tommy: "Yep, I like these five wants. Let's keep it to one want primarily per tip. For sure, performance data should teach the weight later."
- **Five wants confirmed:** Faster, Better, Newly possible, Stay current, Cheaper. Avoid mistakes and Choose between tools stay out.
- **One primary want per tip.**
- **Performance data teaches the want weights later.** Weights start equal. Pulling Instagram insight data needs Tommy's go-ahead at the time; nothing pulled now.

Settled foundation so far: Who = know-how tier (middle, higher; lower out) x purpose (Professional, Hobbyist, Personal use, Builder; Creator and Student not now); Helios followers excluded. Wants = the five. Content = open source (repos incl. data repos and paid-service clones, skills) and paid tools (coding-agent features, launches); subagent/command/hook/config content cut.
Not yet settled: the repo-type list ("expand this list"), the value line per want, the content-to-want map, and where tool-agnostic practice (prompting) sits in Content.

## Content tree walk 2026-11-06 (draft, pending Tommy)
Tommy chose to finish the Content tree next. Rule: what the viewer is pointed at.
- Open source / Repos (rule: what the repo does for the user): free alternatives to paid services (Cheaper); data repos (Newly possible); MCP servers and connectors (Newly possible); agent runtimes and local models (Newly possible, Cheaper); automation tools (Faster); memory and knowledge tools (Newly possible).
- Open source / Skills (Faster, Better).
- Paid tools: coding-agent features (Faster, Newly possible); LLM-app features such as ChatGPT and Claude apps, since the middle third names them (Faster, Better).
- Technique (proposed third branch, tool-agnostic prompting and workflow practice, Better): only from vendor prompting guides and named practitioners, so every tip stays verifiable.
- Launches and updates are a freshness tag on any leaf, not a leaf (Stay current).
Held out: security and guardrail repos (Avoid mistakes is out), media-generation repos (Creator is out), learning repos, eval repos, model/plan/pricing changes (candidate for Cheaper).
Coverage check: without Technique, Better is served only by skills and app features.

## Decision 2026-11-06: content tree approved
Tommy: "Approve all three". Approved: the six repo types (free alternatives, data, MCP servers and connectors, agent runtimes and local models, automation tools, memory and knowledge tools); the held-out list; LLM-app features as a paid-tools leaf beside coding-agent features; Technique as a third branch limited to cited sources; launches and updates as a freshness tag. The content-to-want map in the draft above stands.
Open: value line per want; operational test for the lower-third exclusion; what "not targeting Helios followers" means for the Follow slide and copy.

## Decision 2026-11-06: value lines, lower-third test, Follow slide
Tommy: "Approve" (value-line shapes) / "Yeah those are all valid, but one note: Stay current is worse than all the others in terms of which content people want." / "Soft score" / "Yes" (Follow slide kept, written for strangers).
- **Value-line shapes approved:** Faster names the task and the effort removed; Better names the weak output and what improves; Newly possible names what they could not do and now can; Stay current names what changed and what to do differently; Cheaper names the paid thing replaced and what it costs instead. Writer rule: the solves line serves the tip's primary want in that shape. No example copy in the prompt.
- **Stay current is the least wanted.** This changes "weights start equal": Stay current starts below the other four (amount pending), until performance data teaches the weights.
- **Lower-third exclusion is a soft score:** scoring asks whether the tip is useful past the basics; beginner-only tips score near zero and are not picked. No hard reject.
- **Follow slide stays,** written for strangers; no Helios assumptions anywhere in the copy.
Foundation (who, wants, content, value) is now settled except the Stay current starting weight. Next: inventory (Stage 4).

## Decision 2026-11-06: Stay current starting weight
Tommy: "Yes, half". Starting want weights: Faster 1, Better 1, Newly possible 1, Cheaper 1, Stay current 0.5, until performance data teaches them. Foundation fully settled.
Open: drop "new enough" as a scoring requirement (keep freshness as a tag)? One combined build with the design/copy rewire? Anything in the inventory's "Goes" to keep?

## Decision 2026-11-06: "new enough" becomes a freshness tag
Tommy: "Yes, make it a tag". The `new_enough` scoring question no longer counts toward the score; recency is recorded as a freshness tag on the tip (feeds Stay current), so evergreen tips are not penalized for age.
Open: one combined build with the design/copy rewire? Anything in "Goes" to keep?

## Decision 2026-11-06: design and copy rewire answers; one build
Tommy: "Use brand fonts (Pragmatica for headers, Roboto for body copy, and you can borrow one handdrawnish font from other content types being made in social hub, like explainers, for decorative use for the first and last slide." / "stop trying to put all the text in creative ways on the slide. Text should be left-paragraph-aligned. You can put it in negative space but don't try anything super creative. It should generally be anchored towards the middle of the screen. In most cases, the text should just default to being smack dab in the middle of the screen, prominently. The text is doing the work here, the photos are just the background." / "Yes on #3" / "And yeah, one build."
- **Type:** Pragmatica Extended Bold headlines, Roboto body. One hand-drawn font for decoration on the cover and Follow slide only. Finding: no other Social Hub type (explainers included) uses a hand-drawn font; explainers ship Pragmatica and Roboto only. The only hand fonts in the repo are Field Notes' own Kalam, Caveat, Patrick Hand. Which one: pending.
- **Layout:** one left-aligned paragraph block, placed prominently in the middle of the slide by default; may shift into nearby negative space; nothing creative. Text does the work; the photo is background. Removes: arrows, circles, underlines, emphasis, multi-region packing, calm-region hunting as the primary placement.
- **Copy:** one plain block per tip slide (name, what and why, how), 35-word ceiling.
- **One build** covers the audience/content pivot and this rewire, under one contract.
Proposed, pending: contrast comes from treating the photo (darken under the text, faint shadow) since placement is fixed near center; on the cover, the block moves off detected faces.

## Decision 2026-11-06: decorative font, contrast, cover faces
Tommy: "Use the hand-drawn font that is used on the closing scene card for AI Brain Break." / "Yes, that treatment for the photo is good, and yes, on the cover, the text should move off the faces."
- **Decorative font: Hershey Sans** (single-stroke print handwriting, Lucas's pick for explainers, EX3-81). The Brain Break close card writes "AI BRAIN BREAK" in it (`explainers/frame-presets/helios/FRAME.md` line 89, kit `close.js`). It is not a font file: glyph strokes in `explainers/world-kit/hershey-sans.js` (public domain glyphs, MIT conversion) drawn as SVG pen lines by `handwrite()` in `explainers/world-kit/draw.js`. Field Notes draws the same strokes as static SVG on the cover and Follow slide only. Kalam, Caveat, Patrick Hand are no longer used.
- **Contrast:** white text by default; the photo is darkened gently behind and around the block, with a faint text shadow; the darkening is adjusted per photo until the block passes a readability check.
- **Cover:** the text block moves off detected faces (above or below). Every other slide stays centered.
Next: Stage 5, the new process (diagram + table), then the contract.

## Decision 2026-11-06: new process approved (Stage 5 done)
Tommy: "Approve flow". The Sources -> Candidates -> Score & tag -> Tip pool -> Select -> Writer -> Editor -> Gates -> Photo picker -> Render -> Review flow and its table stand.
Not answered, taken as defaults to confirm at the first samples (reversible, no build cost): Hershey drawn with the kit's wobble frozen; Hershey text is fixed code-written wording ("field notes" on the cover; Follow line picked by Tommy at samples).
Next: Stage 6 contract (CONTRACT-v4.md).

## Build 2026-11-06: CONTRACT-v4 built and verified (Stage 6-7)
Four builders (Writer, Render, Pipeline, Sources+UI), then a fresh read-only review (2 must-fix, 6 should-fix, 4 nits) and two fixers. Final: `npx tsc --noEmit` 0 errors; `tests/field-notes-*.test.ts` 186/186 pass. No commits, no live calls, schema not applied to the real DB, worker not redeployed.
- Fixed from review: reseeded links expired at once; seeds skipped the 2-per-want and distinct-subject rules; seeding an already-found link dropped the seeder's tags; seed URLs not canonical; `fresh` judged without a publish date (new `published_at` column); scoring touched unscored rows from earlier runs (now only this run's finds, Rule 2); three seed-save paths reduced to `saveSeededLink`; technique missing from two scoring questions; prompt word targets moved to caps; placeholder use-text no longer shown to the model as ground truth; dead cover/follow constants removed.
- Not changed, on purpose: TIP_SLIDE_CAPS stay at the 35-word level (Tommy 2026-11-05); darkening may continue past the minimum readable point up to darkenCap on busy photos.
- New sources (fetch-verified 2026-11-06): GitHub mcp-server topic, OpenAlternative RSS, GitHub open-data topic, Claude/OpenAI/Gemini prompting guides. Rejected: official MCP Registry (needs a browser), others thin or oversized.
- Samples: scratchpad `fn2/out/sheet-v4.jpg`, `sheet-v4-alt.jpg` (placeholder copy).
Open for Tommy: approve scoring wording (`field-notes-score@1-draft`); Follow logo keep/drop; Follow hand line wording; photo lettering showing through text; seeds from the same docs site share a subject (host) so they never share a post.

## Decision 2026-11-06: scoring weights and a value question; Follow logo dropped; seed subjects by page
Tommy: "lesser-known should be weighed a little less. Pass the basics should also be weighed a little less. I like the concrete result bucket, but I don't think that covers enough. I want to add a bucket that just says "value", and that's going to grade how much value a user gets from that in the best-case-scenario application of that tip." / Follow logo: "drop it." / lettering: "keep darkening at 0.45" / seed subject by page: "ok valid do that". On the Follow hand line: "Idk what that is" (explained in chat; wording still open).
- Scored questions and weights (`FIELD_NOTES_SCORE_WEIGHTS`): value 1 (new: best-case value applied as well as it can be), concrete_result 1, single_subject 1, lesser_known 0.75, past_basics 0.75. Score = weighted mean x WANT_WEIGHTS[want]. Question set now `field-notes-score@2-draft`; "a little less" = 0.75 is my reading, adjustable. Scoring still off (`questionsApproved` false) until Tommy approves the wording.
- Follow slide has no logo. darkenCap stays 0.45; lettering in photos is accepted as is.
- Seeded pages take host + path as subject (no fetch), so two pages on one docs site can share a post.
Tests 188/188, tsc 0 errors.

## Decision 2026-11-06: scoring wording approved (Tommy, on Lucas's behalf)
Tommy: "Approve wording". `field-notes-score@2` (value, concrete_result, single_subject at 1; lesser_known, past_basics at 0.75; leaf, want, tier, purposes, new_enough tags) is approved and `questionsApproved` is now true. Recorded as Tommy's approval for Lucas. Any wording change bumps the version and turns approval off again.
Effect: a human-started run now collects candidates and scores only the ones that run found (one Jev call each), then selects. Nothing runs by itself: autoRun is false and the social worker is not redeployed. Tests 188/188, tsc 0 errors. Still open: Follow hand-line wording; commit; schema on the real DB; worker redeploy; first live run.

## Decision 2026-11-06: test locally first; no commit; no worker redeploy
Tommy: "any" (Follow line) / "don't commit yet" / "I don't want to redeploy the social worker yet. Let's test this all locally first. I want to do some test runs locally to see what the system would look like. Also, please make sure that our system for how we're actually ingesting ideas and doing deduplication over long periods of time is cheap, ironclad, logical, and is pulling ideas from all the best possible places that we can pull from."
- Follow hand line: "follow for more field notes" (lead's pick; no posting cadence promised).
- Finding (read-only check of the real DB, BEGIN READ ONLY): the `field_notes` schema does not exist in Supabase yet; `media_library` (1,281 photos) and `social_hub` exist. A local test run against the app therefore needs three additive DB changes: create the `field_notes` schema; allow licence 'own' on `media_library.photos`; allow vertical 'field_notes' (slot afternoon) in the `social_hub.content_items` checks. Pending Tommy's go-ahead.
- Local run design (proposed): a one-command local runner that creates and claims its own run in-process on this Mac, so the VM worker never picks it up; live Writer/fact check/Jev under the per-run cap ($0.50); Tommy starts it himself; the post appears in the local Hub review screen.
- Ingestion/dedup audit: read-only audit running (cost, long-term dedup, logic, best sources).

## Audit 2026-11-06: ingestion and dedup (read-only; full report in scratchpad ingest-audit.md)
Cost is fine: per run ~100 fetches, <=25 Jev calls (~$0.004), 3 Sonnet calls (~$0.06-0.12, $0.50 cap); ~$1/month at the Tue/Fri schedule. Rule 2 holds. Rows are never deleted and the unique URL index holds, so a page is never re-added.
Must-fix: (1) candidates past the 25-scored cap are saved unscored and lost forever, and the newest-first order starves the vendor changelogs; (2) the same feature from two sources can reach two posts (subject = source label; posted subjects never reach selection) or sink a post via the repeat gate; (3) thin candidates (HN titles, GitHub descriptions) are scored blind, and Writer-skipped or insufficient tips are re-picked and re-paid every run.
Should-fix: GitHub URL variants; single-page sources yield one tip ever (split guides by section, exempt from expiry); per-source flood cap; one tip per source per post; want-cap starvation below 3 tips.
Sources: weak/off-audience: HN front page, GitHub Trending (all languages, rate-limited without token), openai/codex README, Cursor agent page, Console.dev, OpenAlternative, open-data search, OpenAI news. Verified additions: GitHub Copilot changelog feed, Google Workspace Updates feed, Claude API release notes, hnrss Show HN >=50 points, GitHub topics ai-memory, local-llm, self-hosted+ai, new mcp-server and agent-skills repos (30-day window). Gap: ChatGPT release notes (blocks plain fetch).
Pending Tommy: build these fixes; DB changes for local runs; local runner.

## Build 2026-11-06: ingestion fixes, DB applied, local runner (Tommy: "Yes, all three")
- Pipeline (F1): only scored candidates are saved (the rest are found again later); scoring slots round-robin across sources, max 5 per source; posted names and GitHub repos block repeats across posts and within a post; Writer-skipped tips rejected; failed tips stop at 2 attempts (new `attempts`, `reject_reason` columns); GitHub URL variants collapse; relaxed want cap reaches 3 tips; technique tips never expire.
- Sources (F2): 26 verified sources. Dropped: HN front page, GitHub Trending, openai/codex README, Console.dev, OpenAlternative, open-data search, OpenAI news, Cursor agent page. Added: Claude API release notes, Workspace Gemini updates, Copilot changelog, Show HN (>=50 points), GitHub ai-memory, local-llm, self-hosted+ai, new agent-skills and new mcp-server repos (30-day window). GitHub results get their README and Show HN items their linked page before scoring; prompting guides split into section tips. Gap: no source feeds `repo_data`.
- Tests 209/209, tsc 0 errors.
- DB (real Supabase, applied 2026-11-06): one transaction adding 'own' to media_library.photos licence and 'field_notes' to social_hub content_items / schedule / publish_attempts checks, built from the LIVE definitions (db/social_hub_schema.sql differs from production and must not be re-run wholesale); then `npm run db:field-notes`. Settings as shipped: auto_run false, publishing_live false, run_cap_usd 0.5.
- Local runner: `npm run field-notes:local` (`--dry` checks only; `--seed <id>`). Inserts its own run already running, so the server worker never claims it. Dry run passed; photo pool empty.
- Review round fixed (2026-11-06): repeat-feature check now blocks any candidate whose title/opening names a posted multi-word headline, command/slug token or repo; failed paid writes count attempts instead of rejecting tips; enrichment runs only on candidates that get a scoring slot (after the stored filter); README name fallbacks; 2 MB page byte cap (16 MB for feeds/docs); local runner fails its own run on Ctrl-C/crash/timeout; dead score setters removed. 276/276 tests (Field Notes + shared http), tsc 0 errors, dry run passes. Open: DNS-rebinding hardening (TODO in fetchGuarded); no `repo_data` source.

## Local runs 2026-11-06 (Tommy: "upload the photos I've already given you" / auto face tool / "set a post to be generated ... and serve it to me here")
- Pool: 21 of Tommy's photos ingested via ingestPhoto (golf 6454 and truck 6420 left out as off-topic); 4 Faces, 2 starred (6176, 6780). 6782/6783 near-identical both stored.
- Run 1 failed: Sonnet 5.5 refuses a forced tool_choice. Fixed in write/prompts.ts + write/client.ts (no forced tool, 20,000-token ceiling like lib/social/writer/structured-call.ts, one follow-up turn if the tool is not called). Attempts the bug added to 4 tips were reset. $0.004.
- Run 2: fact check blocked the draft (two overstatements). $0.14. The blocked draft is not stored in the run record.
- Run 3: ok, post 7038f1ca (cover + Firenook, Stroq, kicad-happy + Follow), $0.10. Total spend $0.24.
- Read of the post (lead, for Tommy): Firenook is not an AI tool (Show HN leak); commands render as plain prose (backticks dropped); Stroq says "which commands" though run 2's fact check called that an overstatement; all tips were small Show HN/GitHub repos, no vendor features.
- Face tagging built (photos/faces.ts): BlazeFace in headless Chromium, whole photo + tiles, score >=0.85 (>=0.9 small faces), size >=6%, landmark geometry, two-pass crop agreement. Eval on the 23 photos: TP 3, FP 0, FN 1 (precision 100%, recall 75%); ~0.3-0.8 s/photo. Upload kinds now working/scenery/event; Faces auto; one-click "Not faces". Likely does NOT run on Vercel (no Chromium); fails safe (tags nothing). Decision pending on where it runs.
- Tests 225/225, tsc 0.

## Decision 2026-11-06: fix the post's problems; faces on the worker; copy rewritten for the general public
Tommy: "Yes, please fix all the problems you identified. Face tagging can run on the worker." / "When I read these slides right now, they read very much as just technical jargon." / "I believe that the header for each slide should not be the name of the tool, repo, or thing that we're providing them. Instead, it should be the exact value that they're going to get from it. If it's a repo like our Bald Eagle iteration scale that we have internally, then the headline would probably be something like "Build multi-prompt flows faster and with more control."" / "people don't care about what the actual thing is. They just care about what they're going to get from it. That needs to be the headline for each post, and then the body copy should explain what it is in layman's terms." / "the way we communicate it needs to be for the general public. Everything should be catered towards the average viewer on social media ... the copy itself should be written towards an audience that doesn't understand what we're recommending."
- Approved fixes: scoring asks whether the tip is about AI tools (non-AI tips score out); the post mix favours vendor features over small repos; commands render in a code style; the Stroq-style overstatement is re-checked; face tagging runs on the worker.
- Copy shift (supersedes the 2026-11-05 "headline = the thing's real name" rule and the Writer's "never explain what an AI model is" reader rule): headline = the exact value the reader gets, in the tip's want shape; body = what it is, in layman's terms; written for the average social-media viewer. Finding (who we serve, the trees, scoring) stays informed by the middle/higher audience; only the copy changes register. Tommy's example is an illustration of register only, never prompt text.
- Open: where the exact command and the tool's name go; headline length; whether the "how" stays on the slide.

## Decision 2026-11-06: copy shape for the general public (Tommy: "go with your recommendations")
- Slide: value headline (about 8 words at most, large type, in the tip's want shape, supported by the source) + a plain-English body that says what it is and names the tool once. No commands on the slide.
- The exact command or prompt, with the tool's name, goes in the caption ("how to try" lines, written verbatim from the source).
- A tip the Writer cannot explain to a general viewer without overstating is skipped (like a tip with no clear usage); fewer tips beats jargon.
- The fact check also holds scope and quantity words (which/how many, any/all, always) to the source.

## Build 2026-11-08: fixes, faces on worker, general-public copy (all built; live run blocked by API key)
- Scoring @3: `about_ai` multiplier (non-AI tips score 0); tips record `score_version`, only the current version is selectable (older tips are filtered, never re-scored). Mix: <=2 repo tips per post, >=1 coding_agent_feature/llm_app_feature/technique tip when eligible.
- Changelogs (Claude Code, Codex) split into one item per feature bullet with stable URLs; fix/chore bullets dropped; Codex CLI releases now read. Open: "Changed"/"improvements" bullets kept (Claude Code newest block = 56 items).
- Copy: DraftSlide {headline (value, <=8 words), body (plain, names the tool once), name, tryIt}; slide shows headline+body; caption gets verbatim "How to try" lines; tips that cannot be said plainly are skipped; fact check holds scope/quantity words. Render: headline 84px stepping down to 46px within 3 lines; code in body renders monospace.
- Faces: worker step tags new uploads (faces_result 'pending' -> faces/none/unavailable, lease + 2 tries); `npm run field-notes:faces` for local; existing pool rows untouched (Rule 2). VM not redeployed.
- Only a paid Claude call counts an attempt against a tip (a bad key or outage no longer does).
- DB columns applied (pool faces_*, tips score_version). Tests 266/266, tsc 0.
- Live run 4 (2026-11-08) failed: Anthropic 401 "invalid x-api-key" on the key in .env.local (unchanged since Nov 4; also 401 on a free models list). Tommy must replace the key. Attempts that run added were undone. Spend $0.004.

## Local runs 2026-11-08 (new key; Tommy: "keep going")
- Run 5 ($0.06): Writer honestly skipped 2 of 4 (too technical to say plainly; no install command) -> insufficient. Fix: one refill round from stored tips (no re-fetch, no re-score); selection now excludes tips already on the post (it was re-picking them and filling the want cap).
- Run 6 ($0.14): Writer filed a correct Cursor slide under another tip's uuid -> fact check failed. Fix: models see short labels (tip-1...), code maps back; stray real ids are mapped to labels too.
- Run 7 ($0.14): fact check failed the whole post over one scope word ("each tool's official logo"). Fix in progress: the Writer gets the scope/quantity rule; fact-check claims carry their slide; a slide with an unsupported claim is dropped when >=3 clean slides remain (caption claims and <3 clean slides stay hard failures).
- Spend across all local runs to date: about $0.59.
- Run 8 ($0.16): Writer skipped 1 of 4, then one of the 3 failed the fact check (same "each logo" overstatement) -> 2 clean < 3 -> hard fail. Fix: refill whenever a tip is skipped and the post has room. The two repeat-offender tips retired at 2 attempts.
- Run 9 ($0.23, refilled): 2 skips (no install command; "Claude Tag" not explainable plainly) left 3 slides; a headline claimed "faster" with no comparison in the source -> hard fail.
- Pattern: the Writer honestly skips ~1 in 3 tips, and the want shapes (faster/better/cheaper) tempt comparative claims the strict fact check rejects, so posts rarely reach the check with spare clean slides. Spend to date about $0.98; retries paused to stay under the $1.50 autonomous ceiling.
- Also 2026-11-08: review panel and Social Hub idea list no longer show the placeholder use text; Social Hub list shows content-leaf labels; PLACEHOLDER_USE moved to types.ts (keeps the hub's network-scope test clean). Tests 275/275.

## Decision 2026-11-08: more flair; fact check only blocks false facts; no skip for a missing install command
Tommy: "The fact check rejecting comparisons is too harsh. This post needs to have flair it's way too buttoned up right now. The same goes for the writer skipping a source that has no install command. A viewer can figure out how to use the tool if they really want to. All that matters is that we frame the tool's value the right way to get them to feel like our recommendation really has value."
- Voice: confident, vivid, punchy; value framing and reasonable comparisons welcome; no emoji; at most one exclamation mark per post (lead's reading).
- Credibility narrows to hard facts: names, numbers, prices, commands, features that exist, "free". The scope/quantity-word rule (2026-11-06) is withdrawn.
- Writer skips only when it cannot honestly say what the thing is and does (or it is not AI). tryIt is optional; when empty, the caption's how-to-try line gives the source link.
- Supersedes: the 2026-11-06 "skip a tip that cannot be said plainly / lacks exact usage" and "comparisons must be stated by the source" readings.
- Run 10 (2026-11-08, $0.15): ok, post c878b282 (Kanzo task board, Digital Marketing Pro, Copilot in JetBrains Air; a Gemini Notebook slide was dropped by the fact check's evidence-quote check). Value headlines + plain bodies + new voice. Caption said "Four" after a drop -> Writer caption now never states a tip count. Slide 3 flagged low contrast (white body on bright sky, 4.3 vs 4.5; darkenCap stays 0.45 per Tommy). Spend to date about $1.13.

## 2026-11-08: more tips per post; idea-pool review requested
Tommy: "These slides are GREAT! but I want more tips per post." / "I'm worried about how we're managing the idea pool. I have two major concerns: deduplication and how deep our wealth of great recommendations runs."
- TIP_SLIDES_MAX 4 -> 6 (min stays 3). Builder adapting caps, selection, photos, caption; also planner/render contrast agreement and plainer bodies.
- Pool snapshot (read-only, 2026-11-08): 137 usable candidates (current score version, AI, unused); by leaf: coding_agent_feature 41, llm_app_feature 27, technique 19, repo_agent_runtime 18, repo_automation 12, repo_memory 8, repo_data 5, repo_mcp 3, repo_free_alternative 3, skill 1. Each run collects ~240-330 items, scores 25; "left for later" fell 230 -> 85 over 10 runs (backlog draining). Weak yield: Show HN 3/16 usable, One Useful Thing 0/2, Gemini CLI 0/3, anthropics/skills 0/1; strong: GitHub topic searches, Workspace Gemini, Copilot, Codex changelog.
- Known dedup gap: a feature reworded by a second source (different link, paraphrased title) is only caught if its title contains the posted name or repo slug.
- Decision 2026-11-08 (Tommy: "1. ok, yes"): changelog "Changed" and "improvements" groups and bullets are dropped (docs-adapter FIX_GROUP/FIX_LEAD); only new features stay (newest Claude Code block: 56 items -> 6). Tommy will upload more photos (photo_rest_posts stays 8).
- Decision 2026-11-08 (Tommy: "Yes, add it", twice; wording approved for Lucas): reworded-duplicate check `field-notes-dupe@1` (lib/field-notes/sources/dupe-check.ts): before selection, the top <=12 candidates each get one Jev noul "same tool/feature/product/technique as any posted name (up to 80)?"; >=0.5 takes the candidate out for good; failed calls never block; ~$0.002/run; only this run's top picks (Rule 2). Wiring into run.ts after the 6-tip builder finishes.
- Build 2026-11-08: up to 6 tips per post (want cap ceil(N/2), repo cap floor(N/2), both min 2); planner now requires every text line to pass contrast (agrees with the rendered check; fails to photo swap if not readable at 0.45); body rule: makes sense to someone who never used a developer tool. Duplicate check wired into selection (top <=12, record.dupeCheck). A 6-tip post needs 8 photos; back-to-back 6-tip posts with rest 8 need ~72 live photos (9 Faces); POOL_TARGET (25) still unchanged. Tests 289/289.
- Run 11 (2026-11-08, $0.20): ok, 5 tips (Gmail Live dropped by the fact check's evidence-quote check). Problems: cover shipped with fit problem cover_no_face (IMG_6166, a person posing, hand-tagged Faces by the lead; the renderer's detector finds no face; only 2 Faces photos rested-available); Follow slide over a laptop screen with big lettering; bodies still carry hardware/model jargon (Apple Silicon, NVIDIA graphics, Opus 5.5 Max). Spend to date about $1.33 (near the $1.50 autonomous ceiling).

## Decision 2026-11-08: rotating cover hooks; one-time parallel test
Tommy: "we don't want the '5 AI tips to try' to be the same line every time. Another one we like is: '5 AI hacks we've seen this week'" / picked 1, 3, 6, 9 from ten options / "In a real production environment, a hook can't be repeated unless it's 4 posts apart."
- COVER_HOOKS (write/caps.ts): "{n} AI hacks we've seen this week", "{n} AI tricks worth stealing", "{n} AI finds worth saving", "{n} AI moves to make today", "{n} AI finds from this week's feed"; pickCoverHeadline never reuses a hook used on the last 3 posts (4 apart). Run records coverHeadline.
- Tips are now claimed ('selected') when a run picks them and released in a finally block if they do not reach a post, so overlapping runs never pick the same tips.
- Tommy: "For the sake of this test run, run them in parallel and use the same photos. This is a one-time exception." Temporarily: photo_rest_posts 0, max_pending_drafts 10, the single-running-run index dropped, FIELD_NOTES_ALLOW_PARALLEL=1 for the local runner. All three must be restored after the test (rest 8, pending 3, `npm run db:field-notes` recreates the index).
- Parallel test 2026-11-08 done: post A c90ce134 ($0.17; "6 AI hacks we've seen this week"; 6 tips incl. Gemini customize hub) and post B 6373fb42 (B started 75 s later; "6 AI tricks worth stealing"; 6 tips incl. three prompting techniques from Claude, Gemini and OpenAI guides). No tip shared between the posts; no tip left 'selected'. Restored: photo_rest_posts 8, max_pending_drafts 3, single-running-run index recreated (FIELD_NOTES_ALLOW_PARALLEL stays an opt-in env var, off by default). Total local spend to date $1.64.
- Still open: Follow slide can land on a laptop screen with big lettering (post B); bodies still carry some product jargon; cover photos should be face-confirmed by the tagger; mix can stack three techniques in a row.
