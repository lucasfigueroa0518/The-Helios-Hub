# AI Mini Docs — living plan (Bald-Eagle-Iteration, started 2026-10-28)

Successor to Real Case / AI News Explained. Decisions are recorded in Lucas's words. Nothing is built
until the build plan is approved.

## Direction (Lucas, 2026-10-28)

- The LiteLLM reel "sucked"; the system moves "in a completely new direction".
- "sixty second mini documentaries about recent AI news … no longer … the core purpose is to be
  educational. The core purpose … is for it to be entertaining and informative, and of course engaging.
  I want the viewer craving more. I want them to want to find out what happened next."
- Built "on journalistic and documentarian principles" (Lucas has directed and produced five
  award-winning documentaries).
- "We want these to be dramatic … keeping us on the edge of our seat."
- **Craft brain:** deep research into how the best documentarians think, industry fundamentals and
  accepted rules; then short-form principles (engagement, social media psychology, editing and
  directing); then how Netflix documentaries think and feel. **Self-contained**: "Don't let the
  explainer reels crafts.md file pollute this."
- **Real visuals:** "at its core, this story needs to be driven by real photos that are used with
  journalistic integrity": people, things that actually happened, company logos, maps of real
  places, websites to screenshot and manipulate (cutout paper, Ken Burns, full screen, markups).
- **No image-generation models.** "I don't want to AI generate visuals with image generation models."
  Drawing (whiteboard or another medium) and code-built assets (newspapers, pins, markers…) are fine,
  and can be scaled up.
- **Media pre-scout before an idea enters the pool:** cheaply ("definitely under thirty five cents")
  confirm there's enough findable visual media to make the documentary; an exhaustive view of which
  kinds of visuals are valuable, and "all the tools at our disposal" (a scaled-up photo finder, open
  source repos, APIs, scraping websites).
- **Then amass everything:** "I don't want the documentary to then be filtered around the photos we
  have … I just want it to have all of the images possible at its disposal."
- The idea pool works like the Hub's other idea pools.
- Music, sound effects, narration and the way the voice speaks are important.
- **Structure freedom:** "buckets of beats that are of a higher level"; bleeding through beat edges;
  "teaching the director to be a really, really, really good 60-second documentary director, and then
  trusting him to make artistic choices … giving him all the tools … enforcing it with checks."
- **The director knows what he has:** "if an asset isn't there, he knows it's not there, and he can
  make a decision that plays on what is there."
- **MagnatesMedia notes:** light inspiration only, weighed alongside everything else (stored below).

## Map of parts (the order the work flows)

1. **Discover**: find candidate AI news stories (recent).
2. **Media pre-scout**: a cheap check (< $0.35) that enough real visuals exist; the gate into the pool.
3. **Idea pool**: like the Hub's other pools.
4. **Media harvest**: gather every usable visual for the picked story, with source and rights.
5. **Reporting**: the verified fact sheet (journalism: sources, quotes, timeline, players).
6. **Director**: the story (craft brain) → narration + shot plan, built from what the harvest holds.
7. **Voice**: the narrator and how it speaks.
8. **Builders**: frames from real media + the code-built kit (Ken Burns, cutouts, markups, scenes).
9. **Music and sound.**
10. **Checks**: facts, image integrity and credit, breakage, the first-viewer test (fail open).
11. **Finish**: render, deliver, flags.

## Discovery — working sketch (2026-10-28, for Lucas to react to)

Four jobs:
1. **Cast a wide net (free or nearly):** many sources, many angles; candidates are cheap to hold.
2. **Judge drama cheaply:** a triage that asks "is there a documentary here?" before anything costs.
3. **Prove the material exists:** the visuals check (< $0.35, research says about $0.003).
4. **Tend the pool:** stories grow, merge, go stale, gain photos, get made; the pool is maintained, not refilled.

Open design questions: the unit of the pool (a single event vs a saga), what "the right level of drama"
means concretely, which sources to watch, and how a story moves from candidate to greenlit.

## Story structure — second pass (2026-10-28, for Lucas to react to)

First draft (six chronological stages: open, world and want, complication, turn, bigger picture, open
thread) was second-guessed at Lucas's request. Its problems, against the research:
- A "world and want" stage at 3–15s is backstory before payoff: the classic retention dip (W-102, D-88).
- One turn near the end leaves a sagging middle; the research wants a new reveal every ~10–15s (S-23, W-81).
- "Bigger picture" as its own stage invites lesson creep and a sag just before the end (D-6 is woven).
- A separate open-thread stage after the payoff delays the end (W-83: end right after the payoff).
- One arc for every story ignores that a feud, an origin, a coup and a missed chance pull differently.

Proposed instead: **four buckets plus an engine.**
1. **Hook (0–1.5s):** the charged image and the on-screen line that opens the story's question (MD-34).
2. **The ladder:** each rung answers part of the question and opens a sharper one, joined by "but" or
   "therefore"; a new reveal or raised stake about every 8–12s; backstory only where a rung needs it; a
   surprising detail or number mid-way (gold coin).
3. **The turn:** the reversal that changes what the story is about, in the back half.
4. **The landing:** the payoff and the kicker together (the implication for the AI world, or the thread still
   unfolding), then cut; the question over the brand close.

**Engines** (the shape the ladder takes; the pitch proposes one, the writer may change it):
- **End first:** open on the outcome; the question becomes how or why (origins, bets, missed chances).
- **In the middle:** open at the peak moment, then rewind (coups, courtrooms).
- **Bomb under the table:** the viewer knows what the people in the story don't (founding moments, missed
  chances, predictions).
- **Collision:** two figures' moves alternate and escalate to the clash (feuds, talent wars).
- **Countdown:** a real clock runs (days of cash, hours to a verdict, minutes between announcements).
- **Mystery artifact:** open on a document, message or object and unpack it (memos, leaks, papers).

## Inventory — proposed (2026-10-28, for Lucas to confirm)

**Keep (carry over, adapt where noted):**
- Person cutout bank (18 approved) and its tools (`scripts/real_case_cutout_bank.ts`, `cutout.swift`); the
  shared logo bank (`lib/social-hub/logo-bank.ts`); the central blue-chip list.
- The photo finder (`lib/social/photos/`), the photo bank (`lib/media-library/`) and used-photo tracking
  (cooldown becomes 20 days, MD-45).
- Object prep (`lib/real-case/objects/`): stock cutouts, rembg, Haiku pick, image-model fallback and marker
  drawings (allowed, MD-14), the object bank.
- The news kit (`explainers/real-case/kit/`): the DOM `render(t)` frame contract, board / whiteboard /
  newspaper components, measured marks, cords, pins, magnets, baked textures, the cover and bounds checks,
  the engine forks (pace, mount, frames, try, sound, music; music gains act changes), the brand close (now
  with the spoken question), the smoke-render harness.
- Fonts (Helios: Pragmatica Extended, Roboto; kit: Gochi Hand, Courier Prime, Playfair, Tinos) and the
  imported CC0 sounds (magnet, cord taut, whiteboard squeak).
- Plumbing patterns: the cost ledger, the Jev client, the scout's live-run fixes (RC-58: tool versions,
  streaming, response logs), the same-event Jev set, prompt caching, the agent-override seam, HyperFrames,
  the HeyGen voice.

**Discard (the writing and story logic, MD-04):**
- The eight acts, `story-design.md`, the director `SKILL.md`, the storyboard skeleton, the act and
  word-band lint, the frame-worker prompts and `FRAME.md` (rewritten for the new look).
- The news scout prompt, the story scoring and gate sets, the fact-check prompt, the understanding test,
  `brief.ts`, the nightly news-search cycle.
- The `real_case` schema and lab (start fresh, MD-10), the AI NEWS EXPLAINED sting.

**New:**
- Development: the search ledger (player × story type × era), the development producer, Jev drama and
  material scores, the visuals check, same-event dedupe, the pool and its ranking and spread rule, the
  3-a-week schedule.
- Reporting (verified facts; can kill a story).
- The media harvest: the photo finder scaled up (image search API, news-article images, newsroom and press
  photos, video frames, page and post screenshots, printed-style maps, satellite, documents and papers),
  watermark and AI-image rejection, perceptual-hash dedupe, identity and recency checks, credits; under 15
  usable visuals kills the story.
- The writer and the director (two craft files distilled from the research and Lucas's calls), the handoff.
- The full-screen media kit: grade, grain, Ken Burns, parallax with gap fill, cutout lift, collision, page
  markups measured to their words, printed maps, lower thirds, Helios captions; image-reuse rules (MD-41,
  MD-45, MD-46).
- Sound: ambience and foley for stills, music changes at act turns, the question over the close.
- Checks: facts (loose Jev), image integrity, first-time viewer, breakage.
- The Reel AI Drama lab: pool, ranking, visuals cards, ledger, costs.

## Keep / discard — first cut (superseded by the inventory above)

Likely keep (visual):
- Person cutout bank (18 approved), logo bank.
- The news kit: board, whiteboard and newspaper scenes, measured marker marks, cords, pins, magnets,
  baked textures, fonts (Playfair/Tinos/Courier Prime, Gochi Hand), the DOM `render(t)` frame contract.
- The engine forks (pace, mount, frames, try, bounds, sound, music) and the imported CC0 sounds.
- Stock object finder + rembg cutouts; the Commons/Wikidata photo lookups.
- Plumbing: `real_case` pool tables, cost ledger, lab page shell, fact check and source check *as
  mechanisms*.

Likely discard (writing and story):
- The eight-act structure, story-design, director SKILL, storyboard skeleton, lint act/word-band rules.
- The news scout prompt and its scoring set (stakes/turn/scene/reveal…), the "concept reveal" framing,
  the term card.

**Flagged contradiction:** RC-48/RC-52 use an image model (gpt-image-2) for whiteboard drawings, people
sketches and fallback object photos. Lucas now rules out image-generation models. To settle when we
reach the builders.

## Decisions log

| # | Date | Decision | Lucas's words |
|---|---|---|---|
| MD-01 | 2026-10-28 | **A writer and a director, as separate roles.** The writer owns the narration and on-screen words; the director owns the visual telling. Writing is researched as its own track. | "WRITING is extremely important, so there should be a writer and a director … Our writing is what will keep people engaged/entertained." |
| MD-02 | 2026-10-28 | **Rights rule: any photo we can ingest without a watermark is usable.** A watermark means reject. Every item still records its source and credit (journalistic integrity: a photo must really show what we say it shows). | "Any photos that we can ingest with out a watermark are fair game." |
| MD-03 | 2026-10-28 | **The visual base is full-screen real media** (Ken Burns, parallax, layering, grade). The board, whiteboard and newspaper are tools the director picks for a moment, not the stage. | Answer "A" to "full-screen real media as the base vs the three scenes as the stage" |
| MD-05 | 2026-10-28 | **Each documentary stands alone.** It resolves its main question and ends on the thread that is still unfolding in the real world; no Part 1 / Part 2 splits. | "1 a" |
| MD-06 | 2026-10-28 | **The narrator is Lucas's cloned voice**, directed toward a documentary delivery (the research sets how). | "2 mine" |
| MD-07 | 2026-10-28 | **Budget: $8 cap per documentary** (harvest + writing + build + render); the pre-pool media scout stays under $0.35 per idea. | "3 $8"; earlier "definitely under thirty five cents" |
| MD-08 | 2026-10-28 | **The format is called "Reel AI Drama".** | "Reel AI Drama" |
| MD-09 | 2026-10-28 | **Recency is not a hard gate.** Two kinds of story: (1) **news**: 90 days old or less, with the most relevant usually within 60 days; (2) **history**: a historically significant story about a blue-chip AI entity, from any date (Lucas's example: a dinner Elon Musk hosted that brought Dario Amodei and Sam Altman together; details to be verified by reporting). Recency weighs in selection, not as a cutoff. | "I actually don't want the date range to be a hard gate … a lot of the more relevant stories are also more recent stories, which we should qualify as probably within 60 days, not within 90 days." |
| MD-10 | 2026-10-28 | **Start fresh**: a new pool, tables and lab for Reel AI Drama; Real Case is kept only as a source of assets and code to carry over (inventory before the build). | "Start fresh" |
| MD-11 | 2026-10-28 | **History stories must center on a player from the Hub's central blue-chip list** (`lib/social-hub/blue-chip-players.ts`). | "Yeah. Use the central list." |
| MD-12 | 2026-10-28 | **One pool, no quota.** News and history compete on the same drama/engagement score; a history story needs a "why now" to beat a fresh one. | "Agreed" |
| MD-13 | 2026-10-28 | **No opening sting; the cold open is the first frame.** A short "Reel AI Drama" + Helios logo close ends every doc. | "Yes" |
| MD-14 | 2026-10-28 | **Image generation is allowed in three cases:** whiteboard marker drawings of objects, line sketches of banked people (drawn from their approved photo), and a fallback object photo when stock has nothing clean. **Whiteboard drawings use (c):** tracing real photos into strokes plus Claude-written vector drawings for simple symbols, alongside the image-model drawings. | "All three of those image generation cases are fine. C to your question" |
| MD-15 | 2026-10-28 | **Write for the muted viewer.** Treat most viewers as watching with the sound off: the story must read from captions, on-screen words and picture. (A research add-on verifies the figure per platform.) | "in a social media setting, 80% of viewers watch it with the audio turned off" |
| MD-16 | 2026-10-28 | **A TV channel logo on a frame is a watermark (reject). AI upscaling is allowed, sparingly, only where an image really needs it.** | "Yes, a TV channel logo on a video frame counts as a watermark. Yes, you can use upscaling, but only do it in situations that really need it. Use it sparingly." |
| MD-17 | 2026-10-28 | **Research review is by exception:** Lucas reviews only the questionable principles (46 of 340, with my recommendations); everything else is kept as written. | "I don't want to review that many principles. Please just identify the principles that may be questionable" |
| MD-18 | 2026-10-28 | **The sign-off is the question spoken (and captioned) over the brand close**; no extra fixed line. | "Let's go with the recommendations for 2 and 3." |
| MD-19 | 2026-10-28 | **Cadence: 3 documentaries a week to start** (about $24/week at the $8 cap). | same |
| MD-20 | 2026-10-28 | **Discovery is the most important part of the system** and gets its own design: going out to find stories with a lot of material and the right level of drama, and maintaining the pool well. Neither "reuse the Hub news pool + weekly history call" nor "a Real-Case-style web scout" is enough on its own. | "where the stories come from is going to be the absolute most important thing here … That's going to be a process of going out and finding the right ones, as well as maintaining the pool in the right way." |
| MD-21 | 2026-10-28 | **An LLM development producer generates the story ideas** and decides what to look into next. Ideas are then tested for how much material can be found. | "have an LLM that makes the calls on what we're going to look into next … coming up with story ideas. Those are then served and tested for how much content we can get for them." |
| MD-22 | 2026-10-28 | **Material likelihood is a multi-question Jev score from the idea alone**, before any money is spent on finding photos; only ideas that score well get the paid/actual media search. | "how much content we can get for them should be a multi-question score by Jev. Just from the story idea alone … a preliminary guess … to determine whether or not we should start putting some money towards finding the photos" |
| MD-23 | 2026-10-28 | **Lucas's 12-story list calibrates what a good story is** (`CALIBRATION.md`); the system and methodology are built from it to scale. | "use this list to calibrate what good stories are for docs … build a system or a methodology that will scale" |
| MD-24 | 2026-10-28 | **Search criteria are three:** AI-world people with wants in situations that matter (across many story types about how the AI world was built, not just conflict and underdogs); a vivid detail or moment that makes a scene; an implication for the AI world. The number, the kicker and small-act-big-consequence are qualities of the telling, not search criteria. | See `CALIBRATION.md` "Lucas's corrections" |
| MD-25 | 2026-10-28 | **No living map of the AI world, and discovery isn't driven by new news.** The core problem is the right criteria for good stories plus **not searching for the same stories over and over** (deduplicating what we look for). | "Creating a real deal living map of the AI world … is a tall order … I don't want to just do stories with new news … making sure that we're not looking for the same stories over and over again" |
| MD-26 | 2026-10-28 | **Story types (draft accepted):** founding moments; big bets and near-death; boardroom power struggles; rivalries and feuds; talent wars and exoduses; deals made and refused; breakthroughs and their people; launches that changed everything; missed chances; principles kept and broken; courtrooms, hearings and regulators; flops, crises and failures; comebacks; predictions right or wrong. | "Boom, that's great. Yes to all." |
| MD-27 | 2026-10-28 | **A search ledger, not a map.** The producer explores the grid player (central blue-chip list) × story type × era, choosing unexplored or long-untouched cells; the ledger records cells, queries and pitches. Dedupe twice: a cell isn't re-searched until due (or reopened by news), and every pitch is checked against all past pitches for the same event (carry over Real Case's same-event Jev set). | same |
| MD-28 | 2026-10-28 | **Development budget about $3/week** (pitch sessions, both Jev scores, visuals checks); Claude drafts 10 near-miss stories for Lucas to mark; one research pass on story development (`research/05-story-development.md`). | same |
| MD-29 | 2026-10-28 | **A central figure's want must drive the events.** A product flop or market shock without a central AI figure at its center is a skip (the pin, DeepSeek). The drama score weighs this heavily. | "1. Yeah exactly." |
| MD-30 | 2026-10-28 | **No human greenlight.** The lab ranks the pool and the top stories are made automatically; the ranking must be good enough on its own. | "I don't want to pick which ones get made. The lab needs to be able to rank the pool well enough." |
| MD-31 | 2026-10-28 | **Reporting and the media harvest can kill a story** before production spend: core facts that don't hold up, or too few photos and visual assets. The next story in the pool takes its slot. | "Yes, it can. Additionally, a lack of photos or potential visual assets can also kill the story." |
| MD-32 | 2026-10-28 | **Ranking:** a story must clear both the drama and the material score; passing stories rank mainly on drama, material adds a little, news under 60 days with a why-now gets a small bonus; spread rule: at most one documentary per player per week. | "1. Yes" |
| MD-33 | 2026-10-28 | **A harvest under 15 usable visuals kills the story** (or no image for the key moment). Made visuals (code-built, drawn) count toward what the director has. | "Lower the bar a little bit … we can also MAKE visuals. The bar should be 15 usable visuals." |
| MD-34 | 2026-10-28 | **The hook is on screen within 1.5 seconds, usually from the first frame.** | "The hook on screen needs to be within 1.5 seconds, and it usually should be from the first frame." |
| MD-35 | 2026-10-28 | **Structure = four buckets (hook, ladder, turn, landing) plus an engine.** Something new happens at least every 8 seconds, often every 6; never 10–12s without anything happening. | "10 to 12 seconds without anything happening is way too long. I think 8 seconds is fine in some cases. Sometimes 6 seconds needs to be the target. I think everything here is great." |
| MD-36 | 2026-10-28 | **The six engines are examples the writer can go beyond**, not a fixed menu. | "The engines should be examples the writer can go beyond." |
| MD-37 | 2026-10-28 | **Flipping the cold open at the landing is a strong option, not a requirement.** | "I like the idea of making that a strong option rather than a requirement." |
| MD-38 | 2026-10-28 | **Writer → director handoff:** the writer writes to the verified facts, the harvested-visuals inventory and the engine (narration, on-screen words, each rung's intent); the director plans picture from it and may send lines back **once**; then the script locks. | "1. Yes" |
| MD-39 | 2026-10-28 | **Checks:** (1) facts — **loose and semantic, a Jev judgment**, never a sensitive literal matcher; (2) integrity — each photo shows what the narration says and has a source; (3) ~~mute pass~~ dropped as redundant with (4) a first-time viewer (hook within 1.5s, story understood, which covers mute reading); (5) breakage (bounds, faces covered, overlap). Each failure gets one fix, then ships with a visible warning; a claim still unsupported after its fix is cut, never shipped. | "this one should be loose and semantic (Jev). I really hate when these are sensitive and constantly being set off … Redundant alongside a first-time viewer check" |
| MD-40 | 2026-10-28 | **Look calibration before the build:** a sheet of 4–6 stills of the full-screen real-media look for Lucas to pick from (local, no API spend). | "3. Yeah" |
| MD-41 | 2026-10-28 | **One image, one job.** A person's banked "character" image represents them and may move through the story; any other use (a full-screen photo, a background, a hero image) must be a different photo of them. No image serves several purposes, and the same photos must not be overused across reels. | "If we're using a Sam Altman character image to represent him in the story, then that can move through the story. If we're using it for a different purpose, like a full-screen image, then it needs to be a different photo" |
| MD-42 | 2026-10-28 | **Helios visual system in the words and colors.** Captions mirror the Explainer caption skin (big lowercase Pragmatica Extended Bold, top band under the Reels header, no plate); overlaid text uses Helios type (Pragmatica Extended + Roboto) and Helios colors (orange accent). | "this visual direction really ignores Helios's visual system … the captions should mirror the captions from the Explainer reel system … The captions and some of the text that is being overlaid are probably the main things where you could introduce the Helios design system." |
| MD-43 | 2026-10-28 | **Treatments 1–4 and 6 approved** (hook on a full-screen photo, cutout lift, collision, real page marked up, board). **Maps look printed**, not mostly white. **Marker marks are measured onto the exact words** they mark. | "The treatments of the frames feel right, except for the map … It should look like a printed map … the screenshot marker doesn't actually circle the correct text. That needs to be calibrated correctly" |
| MD-44 | 2026-10-28 | **Helios balance confirmed:** Helios carries the words, type and accent color; pictures keep the documentary grade and grain. | "1. Yes" |
| MD-45 | 2026-10-28 | **Reuse across reels: a photo can appear again in another reel after 20 days** (a person's banked character image is exempt when they are a character). | "Photos can be used across different reels within 5 days." then "Actually, change 5 days to 20 days." |
| MD-46 | 2026-10-28 | **Visual diversity within a reel follows purpose.** The same image may repeat whenever it communicates the same thing (repetition builds the viewer's connection to it, D-38); different parts of the reel that serve different purposes or messages use different images. | "if an image is being used to communicate the same thing throughout the reel, then it can absolutely be used over and over again … for different parts of the reel, different images should be used when they are serving different purposes" |
| MD-47 | 2026-10-28 | **Inventory confirmed** (keep / discard / new, below). | "Both confirmed." |
| MD-48 | 2026-10-28 | **Old Real Case code and tables stay dormant** until Lucas approves the first Reel AI Drama reel, then are removed in a separate cleanup. | "Both confirmed." |
| MD-49 | 2026-10-28 | **Models:** writer and director Opus 5.5 (`claude-opus-5-5`); development producer, reporting and frame builders Sonnet 5.5 (`claude-sonnet-5-5`); Jev scores run on Jev (its own configured model); image looks use Haiku 5.5 (`claude-haiku-5-5`). | "Jev scores use jev, image looks use Haiku. Opus and sonnet as recommended are approved." |
| MD-50 | 2026-10-28 | **The system writes the post text** (caption, photo credits, the comment question); posting stays manual. | "2. Yes." |
| MD-51 | 2026-10-28 | **The process in `PROCESS.md` is approved.** | "3. Yes." |
| MD-52 | 2026-10-28 | **Build plan approved; the whole build runs here** (parallel builders + reviewer); **calibration is the first live step.** | "Approved. Build the whole thing here. Yes on calibration first." |
| MD-53 | 2026-10-28 | **Prompts approved** (`prompts-for-review.md`, with the baked-in calls listed in chat); **calibration run approved**; **fill the gaps**: yt-dlp, an upscaler, CC0 ambience recordings, and a Serper key (Lucas adds the key). | "1. Approved 2. Run 3. Fill the gaps" |
| MD-54 | 2026-10-28 | **Calibration approved; recommendations applied.** A want can be a fight, a pursuit, a bet or a decision (amends MD-29, because Lucas's own makes have quiet wants); the story must center on a blue-chip player (MD-11); announced plans are capped; the story must be part of how the AI world was built (AI at its heart, or the origin of someone or something that shaped AI; added after the first live session pitched a famous player's non-AI stories). Drama bar 0.55, material bar 0.45 (fitted to calibration); 4 cells a session (the producer costs about $0.58 a cell). Calibration: 12 of 13 makes above every skip; the miss is a fixture with a company, not a person, as its central figure. | "Calibration is approved. Serper API key is set up. Keep going." |
| MD-55 | 2026-10-28 | **First production run: The Rosewood dinner** (cap $8). **Seeded calibration stories that failed their checks are left for the producer to rediscover and enrich**: dedupe and the producer's context ignore failed seeds, so a rediscovered version is never marked a duplicate. | "Yes, run the first render and use the rosewood dinner. Yes, absolutely let the producer rediscover them and enrich them." |
| MD-56 | 2026-10-28 | **Only too few visuals kills a story.** "No image of the key moment" is a warning on the job, not a kill: a private moment (a 2015 dinner) was never photographed, and the director tells it with what exists. Amends Claude's wording of MD-33 back to Lucas's bar. | Lucas: "The bar should be 15 usable visuals"; "we can also MAKE visuals" (first live run had 65 usable visuals and was killed by the key-moment rule) |
| MD-57 | 2026-10-28 | **Per-reel budget raised to $15 for the test runs** (setting row, not the code default), and **no intervention**: the system runs exactly as designed so Lucas can judge it; bug fixes wait for his notes. | "Give it more budget and let it do its fixes … Don't intervene though! I just want to see the strength of the system as it was meant to play out." |
| MD-58 | 2026-10-29 | **Measured breakage gets rebuilt, then fails open.** Code measures every frame for objective errors (voice longer than its frame, an empty or unloaded frame, anything off the edge, unreadable text, a cutout visible before its entrance). A broken frame is rebuilt up to twice; whatever is still broken ships with a visible warning. Taste checks are unchanged (one fix, then warn). | "yes measure, yes rebuilt up to twice, but still fails open and delivers." |
| MD-59 | 2026-10-29 | **Seeded settings, sketches and collage layers are inspiration, used only on an exact match.** A few stageable settings (e.g. a dinner table), expression sketches and collage layers are seeded as cheap tools. When none matches the moment exactly, the system makes its own asset to fit that moment precisely. Generated assets stay inside MD-14's media (drawn, traced or code-built), never photoreal fakes of real events. | "these settings should be INSPIRATION, not a fixed pool … use cheaply in cases where it's an EXACT MATCH. Otherwise, the system should be fully capable of generating its own assets that fit that moment precisely. Whiteboard sketches … the same way. Collage layers the same way." |
| MD-60 | 2026-10-29 | **Variety with an anchor.** The same person can't be shown the same way more than twice in a row. Each main character has one anchor image that recurs through the reel, so viewers bond with them. Every main character has an image, cutout or drawing whenever they're shown. | "The same person can't be shown the same way more than twice in a row. However, characters should still have an anchor image that persists throughout the reel so that viewers can connect at a deeper level with them." |
| MD-61 | 2026-10-29 | **A sound designer step**, after timing is locked: cold-open tension, music drops and swells on reveals, a change at the turn, stingers on key lines. | "Yes, sound designer step." |
| MD-62 | 2026-10-29 | **Iteration 2 approved to build.** | "Go ahead" |
| MD-63 | 2026-10-29 | **Works on mute stays a rule; the "80% muted" premise is dropped.** Every reel must read from picture, captions and on-screen words alone (MD-15 stands as a rule), but most viewers hear the sound, so sound and music are designed as a full layer of the experience, not a bonus. Amends MD-15's rationale. | "Works on mute should be a rule. But yes, you're right, the 80% number is false and the reality is most people watch with the sound on." |
| MD-64 | 2026-10-30 | **Iteration 2 approved for a live test:** the staging rule stays a HARD CONSTRAINT (no two adjacent frames share a staging type), the revised prompts are approved, and the Rosewood dinner is re-run under the $15 cap for a side-by-side with the first version. | "Yes, run a render here" (answering: keep the staging rule, approve the prompts, re-run Rosewood) |
| MD-65 | 2026-10-30 | **Nothing fails a reel by rule; everything fails open with a warning.** Reporting doubts (`facts_dont_hold`) and thin visuals (`too_few_visuals`) no longer kill a job in production: they ship as flags, the writer attributes what isn't confirmed. The per-reel cap is a warning; only a runaway (2× the cap) stops a job. A re-queued job resumes from its kept fact sheet and harvest. Amends MD-31, MD-33, MD-56, MD-58's "kills" and MD-07's cap. Development gates (what enters the pool) are unchanged. | "That shouldn't be a hard rule that can make a real fail. In all honesty, there shouldn't be any hard rules that can make the real fail. Everything should fail open with a warning. Please resume that render and make sure it finishes all the way." |
| MD-66 | 2026-11-02 | **One bounded episode per reel.** Each pitch states one story question and where the story ends; the reel answers that question. Later events get one closing line at most. Amends the pitch's "turn"/"implication" when they span years. | "1 yes" (answering: one bounded episode, later events a one-line closer at most). Context: "This story was supposed to be about the dinner … yet it ended up being about Musk and Altman's lawsuit." |
| MD-67 | 2026-11-02 | **A story editor step before the voice.** Reads the script cold: one-sentence story, every person introduced before they act (face, name, role, want), named-people cap, each beat caused by or reversing the last, close question follows the landing. One rewrite round, then fail open with flags (MD-65). | "2 yes". Context: "Our writer needs to understand how to actually write a plot." |
| MD-68 | 2026-11-02 | **The director shoots first, then a targeted search.** The director plans the ideal shots; a second harvest pass finds and verifies the specific media those shots need; the director adjusts only where nothing is found. The first harvest aims for 6+ verified photos per main character. | "3 yes". Context: "We don't want the director's choices to be driven by what is at his disposal … If the assets aren't there then he can make an adjustment." |
| MD-69 | 2026-11-02 | **One medium per frame for people.** People in a frame are all photos/cutouts or all drawn on the same surface; never a cutout beside another person's drawing, never a drawing card over a photo. Variety comes from more real photos. | "We shouldn't be seeing this mixed media approach in that way because it just looks wrong." "I really love second 48, when we see Ilya Sutskever and then Altman both on the same whiteboard." |
| MD-70 | 2026-11-02 | **Plot research before the build** (`research/08-plot.md`): plot fundamentals (exposition, conflict, rising action, climax, resolution), arcs, subplots, scope, character introduction, suspense; checked for contradictions against the existing research and craft. | "Yes, plot research first … I also wanted you to look at even more fundamental things, like exposition, conflict, and resolution. Just giving it real plot arc knowledge and how to do subplots and stuff like that … you need to also think about what contradicts each other." |
| MD-71 | 2026-11-02 | **The spine is the most important craft in the reel.** The spine writer is built from all the research (01–08) to produce a dramatic, edge-of-the-seat plot, not just a causal list. | "I'm worried about the spine because this now becomes the most important thing to craft … I want this spine to be really well informed in terms of how we can make this an engaging story, something with drama that has the viewer on the edge of their seat the whole time … leverage the research that we've done." |
| MD-72 | 2026-11-02 | **The story editor knows what matters and repairs well**: it diagnoses by importance and has repair moves for each fault, not only a checklist. | "The story editor should also be really smart in this way. The story editor should be able to know what is important, and it should also know how to repair it well." |
| MD-73 | 2026-11-02 | **Build plan approved. Test: Rosewood re-run (kept fact sheet, fresh harvest) plus one held-out pitch, in parallel, $15 cap per reel (about $20–24 total; Lucas picks the held-out pitch from a shortlist).** | "After this is all built, I want you to use Rosewood as a test run, and then I also want you to set another one into motion, something that has been held out, in parallel." |
| MD-74 | 2026-11-02 | **Plot research (`research/08-plot.md`) approved with its contradiction fixes:** the turn flips the expected answer to the same story question (rewords MD-35's "changes what the story is about"); the landing's kicker is one consequence of this climax, larger AI forces enter early as stakes (D-6 as Lucas wrote it); rung purposes name the spine sentence and the value it turns, devices are techniques inside a rung; "something new" = a value turn or visual change, not a new fact (MD-35 pace kept); attribution once per source, on screen, spoken only for allegations/disputes; a rewind is signposted in words; the close question first follows from the last line, then splits viewers. Edits: the timing windows (P-16, P-15) are guidance, not rules; the Adams skeleton is internal scaffolding only; P-58 cut. | "Sure" (answering: approve research + fixes with those edits) |
| MD-75 | 2026-11-02 | **No named-people cap. Naming ≠ centring.** Name people as the real story needs; only a few are central to the plot (want, arc, subplot), judged by how much is going on. A named but peripheral person gets their one line and no side plot. **Every named person is shown when named.** Amends research P-39 and its "overcast" repair (now: demote to peripheral, don't un-name). | "I don't want to have a named-people cap. There's a difference between naming people and making someone central to the plot … we absolutely need to note Amodei was there, but we don't have to dive into amodei's side of things. By the way, people who are named should still also be SHOWN." |
| MD-76 | 2026-11-02 | **The spine is its own step** (Opus, its own prompt and the plot craft plus the writer craft), handing a spine to the line writer; the story editor judges spine and lines separately. | "Sure" |
| MD-77 | 2026-11-02 | **Spine-only test first (amends MD-73).** Three runs stop after the spine step: Rosewood (kept fact sheet), Best on Paper, and a second held-out pitch (Thirty-Two GPUs Against Sora, the runner-up). Lucas reviews the spines; full generations follow only after he approves them. Budget about $3 for the three, approved ("yes"). | "Modify the plan so that we set three test runs (for two held out topics + rosewood hotel) JUST until the spine step. I want to see what the spine step currently outputs. Once I approve the spine outputs, then we'll move forward to full generations. Go ahead and use best on paper." |
| MD-78 | 2026-11-02 | **An episode is the decisive stretch:** days to weeks, a few months at most; longer only when no shorter stretch holds the whole conflict. | "Ok these are approved." (answering: episode length) |
| MD-79 | 2026-11-02 | **Tight endings:** the resolution states the new balance the climax created, in one short sentence at the end point; aftermath is at most one event, never a list; the close question comes from the climax's answer, never from the aftermath. | "Ok these are approved." |
| MD-80 | 2026-11-02 | **One-breath spine sentences:** about 25 words at most, as a HARD CONSTRAINT. | "Ok these are approved." |
| MD-81 | 2026-11-02 | **Close the visual gaps before full runs:** cutouts made after the spine for every spine-cast person and for wished person photos used in cutout treatments (rembg, local); a one-time identity check of the bank cutouts; a loud flag when a step silently does nothing (zero sound cues, no wishes searched, editor skipped). | "1 yes" (pre-mortem question 1) |
| MD-82 | 2026-11-02 | **Pitch gate:** the producer's story test and the drama score require an opposition with agency and a bounded episode; the three pooled pitches are re-screened. | "2 yes" |
| MD-83 | 2026-11-02 | **Scripts before videos:** after the re-run spines are approved, run the writer and story editor only (≈ $1 per reel) and review the three scripts before any render. | "3 yes" |
| MD-84 | 2026-11-02 | **Spines v2 approved** (Rosewood, Best on Paper), with "a person is always called by name, never a title alone" added to the spine writer's HARD CONSTRAINTS. | "1. yes" |
| MD-85 | 2026-11-02 | **No second held-out pitch for now:** no development session; the test goes ahead with Rosewood and Best on Paper (Thirty-Two GPUs was rejected by the MD-82 gate). | "2. no" |
| MD-86 | 2026-11-02 | **Scripts next (MD-83):** writer + story editor on the two approved spines, ≈ $1 per reel, for Lucas to read before any render. | "3. yes" |
| MD-87 | 2026-11-02 | **The story editor keeps one repair round.** Round 1 re-reads; what it finds ships as warnings. | "No second repair round." |
| MD-88 | 2026-11-02 | **But/therefore name the logic, not the words.** Joins are said with varied connectives (however, yet, instead, still; so, which is why, as a result…) or none; the same word on every beat is a fault. Defined once in plot-craft Core 3. | "There should be synonyms of but and therefore available to be used, so it isn't just those two words. (\"however\", \"so\", etc.)" |
| MD-89 | 2026-11-02 | **Full renders on hold** until Lucas says go. | "Don't start the full renders yet" |
| MD-90 | 2026-11-02 | **Hook: give away or tease, per reel.** Every reel opens on a hook with the time frame; whether it states the outcome or teases it is chosen per story, by which drives more engagement. | "It can be either given away or teased based on the reel and which would drive more engagement." |
| MD-91 | 2026-11-02 | **Pace: keep the length cap; pauses ≤ ~0.2s, faster delivery;** freed seconds go to scene-setting exposition. | "Yes." (to: keep cap, tighten pauses, spend the time on exposition) |
| MD-92 | 2026-11-02 | **Voice samples approved:** one line rendered in 3–4 delivery settings (pennies, HeyGen) for Lucas to pick by ear; the writing side (spoken sentence shapes, less dramatic punctuation) goes into the build regardless. | "Yes." |
| MD-93 | 2026-11-02 | **Voice = sample D:** storyteller wording (past tense, connected sentences, no colons/fragments), voiced as one take, sped up ~1.12× after recording (HeyGen ignores `speed`). | "D for voice" |
| MD-94 | 2026-11-02 | **Style is per scene, not per reel** (amends MD-60's "each time a different treatment" and MD-69): no rule forces one look per person across the reel, and no rule forces a different one; within any one scene every face is in the same style. | "Don't enforce one style per person for the reel. Just make sure in any given scene it's the same style for all the faces in that scene." |
| MD-95 | 2026-11-02 | **Setup block + earned joins** (amends MD-88). The opening is a short setup: the hook with the time frame, then who is where, who is present, what each wants and why; setup lines are exempt from "every line turns a value", which applies after it. Varied connectives stay, but a join may claim cause only when the line before states that cause. | "Agreed" |
| MD-96 | 2026-11-02 | **No source whitelist.** The harvest keeps ingesting from any source (reposts, aggregators included); limiting to original publishers/archives would starve it. Integrity still judges whether an image IS the real artifact it is used as. | "limiting source ingestion to original archives or publishers could harm our ability to find source media. Don't do that." |
| MD-97 | 2026-11-02 | **The blind read lives in the story editor**, not a new role: the editor's re-read is done on the narration alone (no spine, no facts), and its always-checked list (when, who is present, motive before act, joins) is never dropped by the three-fault cap. | "Sure but shouldn't editor already be doing that?" |
| MD-98 | 2026-11-02 | **Build shape as iteration 3:** I write the prompts; builders A (voice/pace/close), B (harvest: wish-search + wrong-anchor diagnosis and fix, transparent makes, lift prep), C (kit + checks) in parallel. | "Sure" ; "Please find out why targeted photo search returned nothing and why main pictures went to the wrong person. And then fix it." |
| MD-99 | 2026-11-02 | **Go-ahead: render Rosewood and Best on Paper once built** (fresh spine and writer; ~$8–9 each). | "Go ahead and render both once built (rosewood, best on paper)" |
| MD-100 | 2026-11-03 | **The writer owns the whole story; the spine writer goes.** The producer picks stories and hands a short prose brief (who, what, when, the main tension), no engine types; the writer reads the brief, the facts as a dated plain-language timeline (code renders it, no extra call) and the visual inventory. Facts stay the truth source for the facts check. | "The writer should be able to own the whole story and put together a great script using great principles." / Q1 "Yes" |
| MD-101 | 2026-11-03 | **Principles over engines.** plot-craft, writer-craft and story-timing collapse into one short list of one-line principles Lucas keeps or cuts; the flags.json rule (approved research rewrites verbatim in the craft) is retired for the writing side. | "Pick principles over engines." / Q2 "Yes" |
| MD-102 | 2026-11-03 | **Blind story editor.** It reads only the script that goes to the video (no pitch, spine or facts) and sends notes; the writer does one rewrite; anything left ships as a flag. The editor never edits lines. | "It should just see the script that's being sent to the final video." / Q3 "Yes" |
| MD-103 | 2026-11-03 | **Length and pause:** about 60s, up to 80s when the story needs it; at most one pause of about 0.15s (supersedes MD-91's 75s and 0.2s). | "About 60s, 80s if the story needs it. At most one pause, of about 0.15s" |
| MD-104 | 2026-11-03 | **Principles kept** (ITERATION-5.md): the five musts and fifteen principles, with 2 and 13 reworded by Lucas. | "2: … Anything much later gets briefly mentioned only if it is important to situate the story against present-day reality." / "13: a stranger with little AI background can follow every line." |
| MD-105 | 2026-11-03 | **Producer:** story types stay as a search lens only (never reach the writer); "a central figure's want drives the events" is relaxed to the MD-24 criteria: real people, a real tension, a vivid moment, why it mattered. | "Producer's story types can stay as a search lens." / "Go with your recommendation for the producer's rule." |
| MD-106 | 2026-11-03 | **story-timing.md keeps only its picture-side rules** (hook visible from frame one within 1.5s, something new on screen every 8s) for the director; its writing rules go. No other director change. | "1 yes" |
| MD-107 | 2026-11-03 | **Re-brief Rosewood and Best on Paper** with one small Sonnet call each (cents) so the test runs the new system end to end on the same stories. | "2 yes" |
| MD-108 | 2026-11-03 | **Build go:** I write the prompts; one code agent does the plumbing; no live calls. | "3 go" |
| MD-109 | 2026-11-03 | **The producer still looks for a central figure's want, an opposition with agency and a turn**, and names them in the brief when the record holds them; the story test doesn't require them. | "The producer should still be looking for opposition with agency, central figure's want, and turns. It's ok for the test to not include them though." |
| MD-110 | 2026-11-03 | **Pitch scoring:** the four shape questions are rewritten: want → real people at the center making the choices; turn + push-back → one tension question (want, opposition and a turn raise it); single story question → one episode in a short span. Old pool scores are not recomputed. | "Answer to your 1 question: yes" |
| MD-111 | 2026-11-03 | **Principles grow from the iteration-4 crafts:** A–R of the scan kept and merged (place parts relative to each other, who they were then, withhold outcomes not orientation, setup as a scene, care before worry, pay setups, know the last line, context just in time, centre the few, larger forces as stakes (D-6), end on an act, a split close question, steady past-tense voice, names that sound like words, few numbers on one base, one name per person, don't narrate the picture, the hook's promise). S (fairness) and T (no bait) cut. 26 principles. | "Keep them all except S and T" |
| MD-112 | 2026-11-03 | **No live render this round:** one producer round finds 6 stories; the best 2 are written to the final script (reporting, harvest, writer, blind editor, rewrite, facts check), no director or render; report the cost and whether it went down. One-off override of the weekly development cap for this round (+$4 at most), not saved. | "I don't want to do a live render. I want you to run a round of FINDING stories (producer) and writing the stories (all the way to final script). Find 6 and write the best 2 and show them to me. Let me know how much that all costs and if costs went down." |
| MD-113 | 2026-11-03 | **The writer has no web search, for now.** Reporting stays as the fact source. The iteration-5 round stays the no-search baseline. | "Ok, keep web search off for now for the writer. Yes reporting stays. Keep no-search for the current run obviously." |
| MD-114 | 2026-11-03 | **Story origination returns to the iteration-4 logic** (producer.md and pitch scoring as of 2026-11-02): what to look for, and what passes. The iteration-5 briefs read weak. | "The previous system's logic for what stories it was looking for and evaluating as passable was good, we should go back to that (the story idea origination logic we had yesterday)." |
| MD-115 | 2026-11-03 | **Hooks must grab hard.** The viewer should care a lot the moment they see, hear or read the hook. Think like a social media psychologist, a marketing genius and a pro Netflix writer, and draw on the hook research already in the repo. Journalistic caution matters less in the hook than in the rest of the script. | "These hooks are BORING and don't make me engaged AT ALL... Our hooks should be EXTREMELY ENGAGING... For the hook, journalistic integrity is not as important... We want our audience to want to watch." |
| MD-116 | 2026-11-03 | **The producer keeps the prose brief as its output.** Iteration-4 search, story test, gates and scoring are restored verbatim. The want, opposition and turn fields (which fed the removed spine) are not restored. | "Yes" |
| MD-117 | 2026-11-03 | **The hook may dramatize but not invent.** It can tease, provoke, use present-day stakes or ask a loaded question. Every factual claim in it stays true. The facts check judges the hook's claims, never its framing. | "Yes" |
| MD-118 | 2026-11-03 | **The time frame leaves the hook's opening words.** The year goes on the on-screen date label or in the second line, so the first words can grab. Amends MD-90 and the first must. | "Yes" |
| MD-119 | 2026-11-03 | **The fact sheet places everyone in a larger context.** For each person: their background, their role at the time, and what they did after or do now. For each company: what it was and what it is beyond its part in the story. All of it is sourced, so the writer can tie the parts to each other. Places and relations are shown to the writer too. | "the fact sheet should also place things in their larger context ... people's backgrounds and current day positions (past and future/present) and companies should be contextualized past their place in the script." |
| MD-120 | 2026-11-03 | **The writer's fact sheet is cleaned:** one line per fact, so a quote or artifact restating a fact is merged, not repeated. Reporting's working notes (corrections to the pitch, source chains) stay out of the facts. | "yes, you should clean up the fact sheet's duplicates and working notes before the writer reads it." |
| MD-121 | 2026-11-03 | **Twelve hook principles, from the repo's hook research, are kept in full** in `craft/principles.md` (§The hook). A hook may be a question, but a statement that makes the viewer ask it comes first. | "1 yes 2 yes" |
| MD-122 | 2026-11-03 | **Scroll test.** The blind story editor first reads only L1 and its on-screen words, cold: if they would swipe away satisfied or indifferent, the hook gets a note. The first viewer rates the hook's pull from 1 to 5 (a warning below 3). | (approved with the principles) |
| MD-123 | 2026-11-03 | **The writer drafts at least three hooks** from different angles, in its one call, and keeps the strongest. | "3 yes" |
| MD-124 | 2026-11-03 | **Reporting's budget is raised to 25 searches and 30 fetches**, so the background context doesn't crowd out the checking. | "raise the caps to 25 and 30." |
| MD-125 | 2026-11-03 | **Cheaper story finding:** the producer and reporting move to `web_search_20260209` / `web_fetch_20260209`, which filter results before they enter the context. A round runs 4 cells × 5 pitches (was 6 × 3; default `pitches_per_cell` 4 → 5). Drafting from memory is held. | "Implement 1 and 2, hold off on 3. Then set it to run and serve me the scripts." |
| MD-126 | 2026-11-03 | **On-screen labels are narrowed.** A label only names a person the viewer is meeting (with their role then), marks a jump in time or place, or shows a figure that's hard to catch by ear. Most lines have none. Sources, credits, hedges and extra facts never go on screen: credits are spoken once, only for disputed or one-source facts. The director's "show the source label" rule is removed. The director may drop a label that fights its frame (`drop_labels`) but never writes or changes one. | "Yes / Yes / Yes" |
| MD-127 | 2026-11-03 | **One medium per frame.** A frame is all real (photos and cutouts of real photos) or all made (drawings, code-built graphics), never mixed. A reconstructed scene is a visible cutout collage of real photos of the real kinds of things (people, table, plates, lamp), never blended into something that passes for a photograph. The director picks the best real images for it. Wishes can ask for objects and places, and what they find can be cut out and treated like any asset. Drawn frames are only for what no photo can show. | "1. yes" (to the medium rule) + iteration 7 notes |
| MD-128 | 2026-11-03 | **People stay; other elements share the stage.** The director still shows the people. But places, logos, objects, emotion and animation are part of the visual story, and a person need not be front and centre or the largest thing on screen. | "The director still needs to show the people. It's just that it also needs to show other elements, and sometimes the person shouldn't be front and center and the largest thing on screen." |
| MD-129 | 2026-11-03 | **A separate design reviewer** looks at every frame for design and composition quality, style and medium consistency, and Lucas's past visual rules. It runs alongside the first viewer and feeds the same single picture fix. | "3. Okay, sure." |
| MD-130 | 2026-11-03 | **Date labels are flagged as dates** by the writer and styled more prominently than other labels by the kit. | "Date labels should be flagged as dates (they need to be visually more noticable than other labels)." |
| MD-131 | 2026-11-03 | **Each frame names its focus** (person, place, object, logo, document, number, animation). A code check lets person-focused frames be at most 65% of the story frames and any other single kind at most 50%; past that, the plan goes back once. | "For the code check, people focus should be allowed to go up to 65% of the frames." |
| MD-132 | 2026-11-03 | **The design reviewer checklist** (11 items: one medium per frame, nothing off the edge, readable text, good crops, clean cutouts and drawings, marks on target, deliberate layout, no redundancy, composed not lazy, nothing missing, a clear focal point) is approved. | "2. Approved" |
| MD-133 | 2026-11-03 | **The design reviewer splits its checklist evenly between models:** Haiku takes the easier, mechanical items and Sonnet the judgment items. | "Sonnet for more complex judging, Haiku for easier judging. Try to split the jobs evenly (50/50 split)." |
| MD-134 | 2026-11-03 | **A hook leads with the real consequence a stranger cares about,** carried by a person or a company the viewer knows. Replaces "a person at the centre". | "The hook should have been: 'Two weeks before the launch of ChatGPT, Amazon missed out on the AI race.' that is the actual consequence" |
| MD-135 | 2026-11-03 | **Products are players** alongside people and companies. Every central player appears on screen when first named; a code check flags any that doesn't. | "products should be entities as well" |
| MD-136 | 2026-11-03 | **Each frame has a shot map tied to spoken words.** Every first-named player, every number and every new claim gets its own picture beat; no beat holds past about 12 spoken words. | "it was literally just one article, and yet three different things were mentioned" |
| MD-137 | 2026-11-03 | **A picture may never imply what the line doesn't say.** The integrity check tests the pairing. | "it leads the viewer to believe that it was sold for 24 million" |
| MD-138 | 2026-11-03 | **New moves:** article flash with shutter, phone, cursor click revealing a notification; image burst behind a number; speech text beside a person (paraphrase styling, no quote marks); a logo drawn in marker on a whiteboard. Face rings limited; thought clouds a last resort. The board and newspaper get clear roles and are never required. | "there should be more that the director can do with it" |
| MD-139 | 2026-11-03 | **No new stock source.** Wishes carry their own Google Images query through Serper, and may ask for several pictures. The fireplace failed because its query was "brick stone residential". | "all of the systems that we have put in place previously for finding images should work easily" |
| MD-140 | 2026-11-03 | **Errors are stopped at build time by free code checks:** a fully composed first frame, marks tracking moving targets, labels off faces, grounds past the frame edge, subjects in the middle of the screen, ink that can be seen. The reviewer also sees the first instant. Design findings keep triggering a fix. | "yes they should. we just need to upgrade the system so they happen less." |
| MD-141 | 2026-11-03 | **Broken captures are rejected** (error states, broken players, broken images, ads). | "If it's a broken screenshot then we shouldn't be using it." |
| MD-142 | 2026-11-03 | **Music drives the emotion from the first second.** No drone as a lead, a louder bed, silence only as a rare deliberate event, a sound on every moving graphic, ambience for places the script names. | "we absolutely need to use music as a driving force for emotion" |
| MD-143 | 2026-11-03 | **The close is the AI Brain Break close** (white, logo in, handwritten wordmark) with "Reel AI Drama", the question spoken over it, and a clean transition from the story. Replaces the dark close of MD-13. | "I want to use the same close that AI Brain Break uses" |
| MD-144 | 2026-11-03 | **The bed sits at 0.31, and the music logic accounts for the track.** Code levels each track on the part actually used, prefers tracks that sit well behind speech and can be heard on a phone, and rotates songs across the last 4 reels: a reel of 1 or 2 songs repeats none, a reel of 3 or more may repeat one, its strongest. | "some songs are loud, and some songs are quiet. Some songs have a hard time complementing dialogue well... we don't want to use the same songs in every single reel" |
| MD-145 | 2026-11-03 | **The moves stay optional.** A reel that doesn't use them is fine, and reels may differ for it. | "I don't think they have to be absolutely used in every reel" |
| MD-146 | 2026-11-03 | **One image is worked with, never re-animated.** Avoid reusing an asset; when one image carries several beats, the camera travels across it and names or points at what each beat says, or it opens wide and then goes to a true close-up of one detail. A name shows only while that person is the subject. | "It should have just worked with the image"; "if we're going to reuse the same asset, it needs to be done in a creative manner" |
| MD-147 | 2026-11-03 | **The director searches for what the words name** (places and objects the inventory lacks). | "Yes that'd be good" |
| MD-148 | 2026-11-03 | **Silence under the voice must read as deliberate:** a real build that peaks on it, kept short, or no silence at all. | "there needed to be some kind of ramp-up before the silence" |
| MD-149 | 2026-11-03 | **Reusing a picture is the director's creative call, not a fixed recipe** (refines MD-146). A continuous camera and wide-to-close-up are two valid ways; a picture may serve two frames when each use shows something new, keeps the reel varied and carries the story. | "the director needs to understand how to use an asset creatively if it needs to use it for two frames" |
| MD-150 | 2026-11-03 | **Safe cost cuts, none touching quality:** frame workers get only their own image records (the full inventory stays searchable); the fix prompt states the shell rules; build and fix sessions lose only Skill, WebSearch and WebFetch (zero uses in ten reels); the director's shared input is cached for its fix rounds. | "Please make sure that whatever you remove is something that the agent truly will not have a use for 99% of the time." |
| MD-151 | 2026-11-04 | **Composition is computed, not guessed (ITERATION-9).** The model states what the shot is; code places everything from measured pictures. The director steers away from one picture carrying several beats. | "This is something our system should be able to naturally nail, every time." "in general, the director should try to steer AWAY FROM THIS" |
| MD-152 | 2026-11-04 | **More moves for the sound designer:** a swell of any length, muffle and open, `spot` sounds of real things, and named moves (long build, ramp and switch, entrance, held breath, smash). A cut-off or empty plan is retried, then flagged, never shipped silently. | "the sound designer needs more tools in its toolbox" |
| MD-153 | 2026-11-04 | **Frames are compiled, then a creative pass adds to them (ITERATION-10, decision 1).** A review of the last five reels found workers made a noticeable choice of their own in 14 of 54 frames, and about 60 storyboard items were dropped or changed along the way. Code now builds every frame from structured plan fields. One pass per reel watches the compiled reel and may add at most three simple touches and two custom pieces, none required, and can't change what code built. A touch that breaks a check is removed and flagged. |
| MD-154 | 2026-11-04 | **Bodies run off the bottom of the frame instead of fading out, and pieces hold their final spots while the camera reveals them, with one limited slide available (ITERATION-10, decisions 2 and 3).** |
| MD-155 | 2026-11-04 | **A missing key picture (ITERATION-10, decision 4).** A stand-in must show what the shot says. The director first rebuilds the message from real pictures; only if the frame can't communicate its message with real images does it become drawn or code-built, and anything recreated reads clearly as made. |
| MD-04 | 2026-10-28 | **The LiteLLM reel's storytelling, writing and logic are not carried forward;** its visuals weren't great either. Nothing from the old writing path is kept by default. | "storytelling, writing, logic really sucked. The visuals also weren't great. Many parts of it sucked in general." |

## Research (approved 2026-10-28; four tracks, in `research/`)

1. `01-documentary-and-journalism.md`: the director's brain (documentary craft, Netflix docs, still-based
   visual grammar, journalism and photo ethics, compressing to 60s).
2. `02-writing.md`: the writer's brain (documentary narration, narrative nonfiction, broadcast writing,
   suspense mechanics, short-form scripting, the writer–director handoff).
3. `03-short-form-edit-sound.md`: platforms, attention psychology, the edit, music and sound, delivery.
4. `04-media-sourcing.md`: a taxonomy of visual types, a source/API catalogue, watermark detection,
   recency and identity, and the pre-scout and harvest designs.

Added: §13 of `02-writing.md`, writing for the muted viewer (sound-on is actually the majority on Reels,
over 75% per Meta 2024; the craft still has to work on mute, MD-15).

### Review calls (Lucas, 2026-10-28; review page: https://claude.ai/artifact/ESMjQtjqgWwnBY3krpaDHc)

All 340 principles are kept as written except the 46 flagged ones. For those, my recommendation stands
(`scratchpad flags.mjs`, mirrored here when the craft files are written) except:

| Id | Call | Lucas's note |
|---|---|---|
| W-31, W-34, D-4, W-3, W-2, W-90 | **Cut** (neither original nor rewrite) | |
| W-111, D-51, D-47, S-74, S-34, S-8 | **Keep original** | |
| D-6 | **Rewrite, Lucas's version** | "I want these stories to be cognizant of the greater themes that are going on in the AI world. We don't necessarily need to end on a lesson or moral, but the story will probably be intertwined with a greater context." |
| S-10 | **Rewrite, adjusted** | "Aim for about 60 seconds; run up to about 75 only when the story needs it." |
| S-33 | **Keep original + detail** | "The question should be spoken over the brand close, with captions as well … I don't want the question at the end to actually make the Reel longer." |

Consequences to carry into the build:
- **Length:** about 60s, up to about 75s when the story needs it (amends nothing earlier; MD-07's $8 cap holds).
- **The close (amends MD-13):** the brand close stays a fixed length; a spoken comment question plays over it, captioned.
  The narrator keeps one voice, persona and sign-off across the series (S-34).
- **Sound (D-47 kept):** stills get a full sound world (ambience, foley, period detail); NPPA's line holds — no
  sound that implies an event the record doesn't show (D-48).
- **Music (S-74 kept):** change, stop or restart the music to mark acts (the old one-bed music tool needs work).
- **Stills (D-51 kept):** key images may hold; the director chooses between a hold and a move.
- **On-screen text (S-8 kept):** never cover most of the frame with overlay text.

## Inspiration (light weight): MagnatesMedia notes, Lucas 2026-10-28

1. Stories with inherent dramatic potential (personalities, rivalries, ambition, betrayal, controversy,
   reversals).
2. Business stories as human dramas (motives, conflicts, decisions).
3. Fascinating angles and contradictions; public perception vs reality.
4. A strong desire to discover what happens next (escalating stakes, timed revelations, turns).
5. Real-world material made cinematic (photos, documents, maps, archival; layering, camera, light,
   texture, transitions).
6. Narration, music, sound and silence shaping emotion.
7. The feeling of witnessing something consequential.

Takeaway: the combination of story selection, cinematic storytelling and emotional engagement, not
its aesthetic, structure or formula.

## Iteration 2: Lucas's notes on the first two reels (2026-10-29)

Lucas: "These were ok first drafts. However, they're riddled with genuine ERRORS. There's flashes of great
taste and strong storytelling though." On TensorFlow: "writing and flow of the story is great but overall
the reel is poor visually and can be better at every level."

### Notes sorted onto the map (his words in quotes)
**A. Breakage (objective; code must catch it, never ship it)**
- Scenes cut mid-word: Rosewood 00:23 "Ilya Suts-", 00:35 "not obviously-", 00:38 "billion dollars-";
  "several CUT OFF scenes" in TensorFlow. "a CLEAR SIGN of bad editing."
  **Root cause found:** after the integrity fix, run.ts rewrites STORYBOARD.md from the director's
  estimates (`writeProject()`, run.ts:379) and never re-paces from the recorded voice (`repace` exists, is
  never called). 9 of 18 Rosewood frames and 6 of 15 TensorFlow frames are shorter than their voice.
- Empty frames / images not loading: Rosewood 00:24, 00:28 (Hassabis), 00:41, 00:45, 00:48, 00:54, 1:01.
  "the most important thing… is that we have a wealth of visual assets. Part of that is verifying the way
  we implement them works."
- Cutouts visible before their entrance (00:50).
- Off-frame: "missed his chance" headline past the left edge (1:11); Transformers headline running off
  both edges (00:50); Hugging Face logo mostly off the right edge (00:59); first "I" of the caption cut (00:00).
- Unreadable text: overlay text placed over article body text (0:01 ×2, 00:20, 00:49, 1:11); white text
  on the white whiteboard (0:10); captions clashing with a scaled-in logo (0:11).
- Bad crop: face too high, "the shot is basically of his shirt" (00:25); low resolution not upscaled.

**B. Visual assets (harvest)**
- Every main character must have an image, cutout or drawing whenever shown. Greg Brockman had none:
  "UNACCEPTABLE… we should absolutely be able to find visuals of prominent figures like Brockman."
  The photo tools, Serper image search and our bank "all need to be operating at a high mark."
- Too uniform before the whiteboard: "the same photos… There needs to be more visual assets in those scenes."

**C. Direction (craft/taste, prompts)**
- Lazy: photo + Ken Burns + tag (00:16); photo+label of Brockman straight to photo+label of Hassabis
  (00:28); black ground + the same Sutskever photo "SO TIRED OUT" (00:45); 00:30 and 1:04 newspaper boring;
  00:40 "another opportunity to make the visuals a little more creative."
- "all that's being used is photos of people and places. They should be composed creatively, with other
  assets… not once do we see the cutouts of the guys all sitting at a dinner table. Or a whiteboard drawing
  of them worrying about something or arguing about something. The director's creative juices need to be flowing."
- Framing: the "15" tally should be the subject, centered, not at the bottom (1:07).
- Redundancy: on-screen text that repeats the article text in the same shot.
- Loved: the screenshot of the post (00:32).

**D. Writing**
- "It turned on one weekend." makes no sense to a first-time viewer (00:07).
- Closing question "Can Nvidia keep Hugging Face open?" is "dumb": Nvidia is a juggernaut, Hugging Face
  "a home run." (The question must be one a viewer would actually argue about.)

**E. Sound and voice**
- Cold open: "music and sound effects should be creating audio hook tension here but they're not."
- "music and sound design wasn't used enough to incur emotional responses."
- Pause before "Elon Musk" too long (00:07).
- "Delangue" should be pronounced the French way.

## Iteration 3: Lucas's notes on Rosewood v2 (2026-11-02)

**Headline (his words):** "Overall what's really really really really really really wrong with this reel is the
writing and storytelling." "This isn't good storytelling. This is just a random regurgitation of facts or plot
points." "The scope is wrong." "Our writer needs to understand how to actually write a plot." Visuals: "a little
bit more creative and diverse", with red flags.

### Notes sorted onto the map
- **Pitch / scope:** "This story was supposed to be about the dinner and how this dinner took place and yet it
  ended up being about Musk and Altman's lawsuit."
- **Writer:**
  - First 30s introduce things "with zero context"; Hassabis questioned before he's introduced; "goes back to the
    dinner without even mentioning the dinner."
  - Lawsuit with no reason: "you haven't even told the viewer why Musk is upset."
  - Close question doesn't follow the line before it (Amodei/Anthropic → a Musk–Altman question).
  - "The opening of the reel should identify the characters. Instead we're just looking at a photo of a hotel."
- **Harvest:** "extravagantly successful in their pursuit of media … returning and then verifying several images"
  per person.
- **Director:** "We don't want the director's choices to be driven by what is at his disposal. We want him to make
  the best choices and then try to use the assets. If the assets aren't there then he can make an adjustment."
  No mixed media on one person-pair: a cutout beside another person's marker drawing "looks wrong" (00:11,
  00:18, 00:33). A drawing card over a photo makes "zero sense". Loved: 00:48, Sutskever and Altman both drawn on
  the same whiteboard.
- **Kit / assets:** Altman "completely broken up into different pieces" (several times); Brockman with no cutout
  in the lawsuit frame; 00:24 orange ring around blank paper.
- **Captions:** first letter of the first caption missing again ("S" of Summer).
- **Sound:** the designer step failed (forced tool_choice 400), so default sound shipped.

### Diagnosis (measured on job aa2a4201, 2026-11-02)
- **The writer wrote it this way; nothing downstream broke it.** The writer's draft and the delivered script match
  line for line except L13 (the facts check reworded it). The first-viewer and fix steps can only change pictures.
- **The pitch set a 10-year scope.** Pitch: central figure Musk; turn "The table becomes enemies: a lawsuit, a
  firing, a rival lab." Five people and three aftermaths in 60s. The writer followed it.
- **Rungs are devices, not causes.** Rung purposes read "Plant the bomb", "Gold coin", "Plant the empty chair":
  a checklist of storytelling devices, each carrying one fact. Only one join in 13 lines is causal ("Then").
  v1 had "So Altman set up a private dinner", "But in 2023…".
- **The fundamentals are in the craft, never checked.** writer-craft.md has "one central figure whose want drives
  the events" and "join beats with but/therefore". No step reads the script as a story before the voice is
  recorded; the first viewer sees it only after render, when the words are locked.
- **Attribution eats the story.** "later testified" ×2, "one report says": the confidence rule (attribute every
  single_source fact in the line) adds clauses with no story.
- **HC8 backfired once:** "the head of Google DeepMind" replaced a name with an unexplained title.
- **Broken Altman:** the anchor cutout file V21 itself is tiled garbage (black ground, shuffled tiles). Probably
  the new Real-ESRGAN step run on a transparent cutout; the image check flagged it "corrupted", and fail-open
  shipped it everywhere it's the anchor.
- **Mixed media:** the director met MD-60's variety rule by making marker sketches of the second person and
  pairing them with the first person's photo cutout.
- **Blank circled paper (00:24):** the ring is placed at a spot where the director expected a label; nothing ties
  a mark to an element, and the screen check can't see a ring around nothing.

## Iteration 4: Lucas's notes on the iteration-3 renders (2026-11-02)

**Headline (his words):** "The reels have taken a small step forward in storytelling but are still weak overall."
Visual errors: "there are a LOTTTT". Most important for the build: "make sure our system prompts contain no
contradictory instructions and that they still don't after our upgrades"; "consider the level of hierarchical
thought that all instructions are made at"; "stay away from example pollution."

### Notes sorted onto the map
- **Writer / spine (opening):** "The reel should open on a hook. Always. Grabbing the viewer's attention is extremely
  important." "The reel should also open by establishing the time frame … (Altman currently leads OpenAI, so it's
  weird to hear that Altman wants to start a lab. Unless you see/hear it's 2015…)". His example of a good Rosewood
  hook (a quality to take: date + a consequence the viewer already knows; NOT prompt text): "In 2015 Elon Musk hosted
  a dinner that led to the founding of OpenAI."
- **Writer (positioning):** "Different parts of the story need to be positioned relative to each other." e.g.
  "Across the valley from Musk… Altman also wants to start an AI lab".
- **Writer / spine (exposition):** "When the story is setting the scene, the exposition needs to be exhaustive so the
  viewer understands the context" — e.g. Amodei should have been at the dinner table. Best on Paper: "Hugging face
  is currently a place for models to be distributed. Viewers will be confused by hugging face having a chatbot."
- **Writer (motive before action):** "Musk's first words to Brockman seem out of place if the viewer doesn't
  understand Musk's motive" — e.g. "In an attempt to lure Ilya away from Google, Musk asked him to consider whether
  or not Demis Hassabis at Google DeepMind was evil…"
- **Writer (joins must follow):** "As a result, Musk becomes central to winning him, for a lab meant to counter
  Google's dominance" is "really out of place and I don't fully understand what it means as a viewer." (That join
  was my hand edit for MD-88; the original "So" made the same unearned link.)
  "He walks away from Google" should have followed the line before: "Ilya wants to work with Musk, so he opts in
  and ditches Google." — "Because the story was just talking about the musk side of ilya's offer, not the Google
  side. That's good writing."
- **Writer review:** "review the writing as if you were blind to this whole system and you were a first time viewer."
- **Pace / timing:** "The reel overall is too slow. Pauses are too long and cadence is too long."
- **Voice:** "I really don't like how my voice is talking. It's kinda performative. Make it more of a natural
  storyteller."
- **Director (creative use of sources):** "the $6M/year graphic is REALLY lazy. That could have been something
  animated and visually engaging with its own sound effects." 00:38 Amodei photo laid on an article that already has
  his photo: "It would be great to see that article manipulated and leveraged visually (amodei is cut out and animated
  in a newsroom/scrapbook style with sound effects and markups). These are things the director should be thinking
  about." Photos of Amodei and Musk laid on the article: "just a bad look overall."
- **Director (whiteboard as the place for context):** BoP: "It would've been great to see 'Convai2, 2018' written on
  the whiteboard." 00:24 Lost in Conversation drawn "with out any labels or contextualization. That's poor/lazy."
  00:28 "$20,000" heading on a separate graphic "that could've easily been drawn on the whiteboard"; drawings "don't
  make much sense".
- **Composition / kit:** marks: Amodei circle "super misaligned (this tends to happen a lot with the markups)"; BoP
  00:38 circle "doesn't make sense"; 00:52 "lost in conversation is meant to be circled but the whole excerpt is
  circled". Whiteboard: Sutskever's drawing "overlayed with a white background. That's horrible, it should look like
  a genuine whiteboard on the drawing (background removed)"; "the alignment of the whiteboard's border and the
  captions … aren't visually optimal"; Musk + cash + question mark placement "HORRIBLE". BoP 00:28: arrows "aren't
  lined up and all the illustrations are lost at the bottom of the screen (viewers are looking at the center)".
- **Style consistency:** 00:58 "altman's visual style is different than musk's and ilya's."
- **Process ask:** "look through each frame to find every VISUAL error" (audits running 2026-11-02, outputs in
  `test-runs/iter3-renders/`; prompt audit in `notes/prompt-audit-iter4.md`).

### Audit findings (2026-11-02; full reports linked)
- **Visual:** Rosewood 49 errors (18 high), Best on Paper 58 (11 high): `test-runs/iter3-renders/*-visual-audit.md`.
  Systemic causes, both reels:
  1. marks placed by box arithmetic or eye, never on the real target (ring = whole layer);
  2. labels/text at fixed spots with no keep-out (over faces, over article text, under captions);
  3. caption colour by frame type, not by what is under it (white on white articles);
  4. hand-tuned camera/layout with no centre or in-frame check (subjects low, off-edge);
  5. boxes and scenes appear before their content (blank starts);
  6. marker drawings keep white paper (blend fails when grouped/scaled);
  7. people shown in mixed styles (halftone/sketch/colour), mandated by "each time a different treatment";
  8. sources not vetted (Rosewood "OpenAI launch post" is from r/Pretend2015Internet; wrong evidence in BoP 6/7);
  9. director choices: static $ cards, text repeating narration, no labels on drawn people, photo stacked on an article that already shows the person.
  The screen check flagged some of this and fail-open shipped it; it has no check for caption contrast, mark alignment,
  text over faces, duplicate people, white boxes. BoP early caption "cut-offs" were a false positive (letter-by-letter
  typing); the real cut is the close: the question voice (2.91s) overruns the fixed 2.5s close.
- **Prompts:** 12 must-fix / 19 should-fix / 9 nits: `notes/prompt-audit-iter4.md`. The prompts actively block the new
  asks: scene-setting is a fault ("a fact that changes nothing is not a beat", "backstory one line"); dates go to labels
  not sentences; "as a result" is a listed connective; voice craft asks for calm but also fragments and full-stop beats;
  "each time a different treatment" for people; marks "placed by eye" vs "never at coordinates" in FRAME.md;
  script-level first-viewer confusion goes to a picture-only fixer.
- **Blind writing review:** `test-runs/iter3-renders/blind-writing-review.md`. Shared: no year and no tie to what viewers
  know today; connectives claim links not earned; closing questions lopsided. Rosewood: stakes arrive at line 10,
  ambiguous "him", whose story is unclear. BoP: twist telegraphed twice, team name doesn't parse by ear, 107-vs-12 not
  on one base.
- **Voice:** HeyGen ignores `speed` for Lucas's voice (1.1 and 1.2 came back identical in length); the pipeline's speed
  setting has never worked. Each frame's line is voiced separately, so every line ends like an announcement.
  Samples in `test-runs/iter4-voice/` (A current, B one take, C storyteller words, D/E = C at 1.12×/1.2× via atempo).

### Build status (2026-11-02/03)
Built per `ITERATION-4.md` (builders A–D + kit fixes + a final fresh prompt review, `notes/prompt-review-iter4-final.md`;
must-fixes and should-fixes applied except the spine/source id collision `S1…`, which needs code). 256/256 tests.
Calls I made during the build, for Lucas to confirm or reverse:
- **Silent beats capped at ~0.2s** (`silent_beat_max` 0.2) per MD-91 — no 1-second dramatic beat. One setting to loosen.
- **Per-frame face style = all cutouts, all photos, or all drawn, in one grade and print** (a cutout beside a framed
  photo counts as mixed). Reading of MD-94's "the same style for all the faces in that scene".
- **flags.json:** W-36 "let it land", W-86 "140–170 words", D-40 "restrained graphics" marked superseded by MD-91 /
  the $6M note; the other approved rewrites restored verbatim (photo-ethics now lives in FRAME.md § Forbidden).
- The story editor's blind re-read runs on every script (MD-97), adding one Opus read per reel.
- Live: jobs a28dd891 (Rosewood) and 2035f2fd (Best on Paper) queued fresh (reporting → harvest → spine → writer),
  cap $15 each (MD-99).

## Iteration 5: the writing is over-engineered (Lucas, 2026-11-03)

Scope: **the writing and storytelling logic only** (producer pitch, spine, writer, story editor, their craft and
inputs). The director is out of scope this round. Results of iteration 4: Rosewood $13.74, Best on Paper $12.77;
both still "poor in terms of storytelling".

### Lucas's notes (verbatim)

> The outputs that just came out were still poor in terms of storytelling.
>
> I reviewed the producer prompt, the spine prompt, the writer prompt, and the story editor prompt and came to the
> conclusion that, overall, this system has been over-engineered. […] The scope of this Bald Eagle iteration round is
> going to be limited to the writing logic and the storytelling logic for these reels. […] I think, overall, we want
> to be able to force the right principles and arrive at good outputs while not over-engineering the logic (because I
> believe that the LLM is fully capable of writing a good story without needing us to give it so many instructions).
> I believe we're actually giving it so many instructions right now that it is doing more harm than good. It's
> getting confused and it's making decisions that don't make sense. What I want to do is refine this system in order
> to arrive at good outputs cheaply. Pick principles over engines.
>
> **Spine writer notes:** "Someone wants something: someone or something pushes back: it costs them: it turns; it is
> decided" pigeon holes the system's plot structure. Spine writer is being heavily influenced by the pitch. "Find the
> episode" is starting by looking at story questions to be answered. It should be looking at the main tension. Which
> doesn't necessarily mean a "turn". "Find the conflict" is looking for who pushes back. That's good but not great. AI
> understands what conflict is, you don't need to define it narrowly, it's just being pigeonholed and leading the
> system astray. Constraints: one story questions is a bad constraint I feel. It's a weird way to limit a story.
>
> Overall, there's too much structure being baked into the story. The way that everything is being outputted as
> fields is very rigid. Stories can't be so formulaic. Our writer needs to be able to see the story naturally (prose)
> and then have the creative freedom to leverage its creative expertise to write a good story. It may even be worth it
> to bypass the spine writer all together, and go straight from the story's pitch to the writer. HOWEVER, […] the
> producer's logic carries a lot of the same flaws that I identified in the spine writer. […] I think the spine writer
> is just slop on top of slop (producer), and that the producer call can easily prepare what the writer needs. It's
> about using the producer's inputs to build the RIGHT output. Something that gives the writer creative freedom while
> also giving it ideas about who, what, when to focus on.
>
> **Writer:** The writers inputs are poor. It's a bunch of information forced into poorly designed structures (pitch,
> spine, fact sheet) (fact sheet is ok in the sense that it verifies what's true, but it's also so rigid and doesn't
> read like a story. Visual inventory is great.
>
> **Producer pitch:** I don't like how it's forcing the story into engine types. This can be a big cause of
> conflicting instructions. I believe that there can either be engine types/story archetypes or principles briefs but
> when you combine, both is when you start to pigeonhole the system […] we need to think about what the best way to
> leverage the principles is while still using techniques for plot management that keep the viewer on the edge of
> their seat. […] potentially injecting engines or principles dynamically based on the situation however, I'm not
> sure this is the right way to go. I think that's too complicated when in reality by feeding principles about plot
> management and good writing we can still create good moments.
>
> Overall, the stories trying to build itself like building blocks, with different stages making different decisions
> (producer, spine, writer). The writer should be able to own the whole story and put together a great script using
> great principles. Main takeaway: The script writing is super over-engineered.
>
> The story editor shouldn't have access to the spine or pitch. It should just see the script that's being sent to
> the final video. Everything else should be held out.
>
> NO NOTES ON DIRECTOR YET.

### Today's writing system (map, in flow order)

| Step | Model | System prompt today | Hands on |
|---|---|---|---|
| Producer | Sonnet + search | producer.md (156 lines) | Pitch: fields incl. `engine` |
| Reporting | Sonnet + search/fetch | reporting.md | FactSheet (fields, fact ids) |
| Spine writer | Opus | spine-writer (117) + plot (327) + writer craft (222) + timing (61) | Spine: setup, wants, acts, story question, cast |
| Writer | Opus | writer (116) + same three crafts | Lines |
| Story editor | Opus | story-editor (88) + same three crafts; sees pitch, spine, facts | R0 repairs, R1 blind read |
| Writer revise | Opus | writer-revise (42) + same three crafts | Replacement lines |

About 730 lines of system prompt reach the writer today, plus a pitch, a spine and a fact sheet as structured fields.

### Direction (playback, to confirm)

- **The writer owns the whole story.** No stage before it makes story decisions.
- **Spine writer: removed.** Its one piece of plumbing (who is central, which drives cutouts) moves to the writer's output.
- **Producer: no engine types.** It still finds and picks stories; its pitch becomes a short prose brief: who, what,
  when, the main tension, what to focus on. Ideas, not structure.
- **Facts stay as the truth source** (the facts check needs them), not as the story.
- **Principles over engines.** The three craft files collapse into one short set of principles. No archetypes, no
  required plot shape, no "one story question". No dynamic engine injection (Lucas leaned against it).
- **Story editor: blind.** Sees only the script going to the video; no pitch, spine or facts.
- **Not touched:** the director, its craft, the kit, the build.

### Earlier decisions this changes (flagged)

- MD-71/MD-76 (spine writer, the spine belongs to the writer) → retired if the spine goes.
- MD-95 (setup block after the hook) and MD-90 (hook) → would live on as principles, not as fields or blocks.
- MD-67/MD-72/MD-97 (story editor round 0 repairs spine and lines; round 1 blind read) → replaced by the blind editor.
- The flags.json rule (Lucas's approved research rewrites appear verbatim in the craft) → conflicts with a short
  principles file; needs Lucas's call.

### Decisions (2026-11-03): Lucas answered "Yes / Yes / Yes" → MD-100, MD-101, MD-102.
### Decisions (2026-11-03, second round) → MD-103 (80s, 0.15s pause), MD-104 (principles kept, 2 and 13 reworded), MD-105 (story types as lens; want rule relaxed).

### Integration (2026-11-03)
- Fresh review: 1 must-fix (a revision couldn't update the hook's words, purposes or close question after an L1
  rewrite → `submit_revision` gains optional `hook_on_screen`, `close_question`, `purposes`), 6 should-fix and 7 nits;
  all applied except: the validator still accepts pauses up to 1s (the render clamps to `silent_beat_max`), and the
  voice bans stay a principle (MD-93 was a HARD in the old writer craft; Lucas approved them as principle 23).
- Pitch scoring v6 (MD-110). Tests 259/259; typecheck clean in reel-ai-drama.

## Iteration 7: the director's visuals (Lucas, 2026-11-03)

### Lucas's notes (verbatim)

> the rosewood one opened on a real photo that was alongside html drawings. That is not ok. In situations where we're
> using real photos, only use real photos! That dinner table should have used cutouts of photos of a REAL dinner table,
> REAL plates, and a REAL overhead lead. And the director should be in charge of making sure that the best images were
> used for scenes like that. The director should also be using real images of things in creative ways and cutting them
> out. A wish should also be able to lead to cutouts and treatments and all the other actions that happen within
> composing a frame.

> The first viewer check should also be looking at each image with a visual eye to make sure that the design and
> composition are of a high quality. It should be judging if things line up well in terms of their style and the
> medium, and more (I've made notes on past reels about rules for good visual practices).

> The director has a lot of rules about showing the person on screen for the scripts. However, these reels need more
> than that. At the moment, it's showing in the outputs that the director really just prioritizes showing people, and I
> believe that that part of this system has been over-engineered. There are multiple things that point towards showing
> people on screen, but the reality of the situation is that this leads to lessened visual diversity and also isn't the
> only thing that matters. Things like company logos or pictures of places and things, or the absolute importance of
> driving emotion with visuals and using animation when it's the right time, place, frame, and/or scene to use.
> Animation as the main thing is suffering under all the instructions of "show the person who is named." Obviously, I
> want this all to still be grounded in good principles, and I think a lot of what the director is doing is really,
> really good recently ... I also want this to stay relatively cheap and efficient, but I think that we need to come up
> with a good way to enforce this principle ... places, company logos, objects, and emotion can't just be an
> afterthought. They need to be part of the core story, visually.

> Note on the labels: Date labels should be flagged as dates (they need to be visually more noticable than other labels).

### Sorted onto the map (flow order)

1. **Harvest / wishes.** A wish can ask for real objects and places (a table, plates, a lamp), not only people, and what
   it finds can be cut out, lifted and treated like any inventory asset.
2. **Director: the medium.** A frame that uses real photos uses only real photos. A reconstructed scene is built from
   cutouts of real photos of the real kinds of things. The director owns picking the best real images for it.
   Conflicts with: director.md "a staged scene is drawn and reads as illustration", and the "reconstructed scene →
   seeded tool or make" route in How to work step 3.
3. **Director: what carries a beat.** Showing named people stops dominating. Places, logos, objects, emotion and
   animation are core story visuals. Rules that push people today: director-craft §3 "When the narration names a
   person, show them in that beat"; director.md HARD 8 "Every person a frame's lines name … is in that frame's
   `shows`"; the anchor-recurs rule; the variety check's per-person repetition limit (which only counts people).
4. **Labels.** Date labels are flagged as dates and look more prominent than other labels.
5. **Checks.** A visual design eye on every frame: design and composition quality, style and medium consistency, and
   Lucas's past visual rules (iterations 2–4 notes in this file).
