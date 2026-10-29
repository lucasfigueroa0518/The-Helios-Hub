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
| MD-64 | 2026-10-29 | **No two adjacent story frames share a staging type** (director HC9) is confirmed as a must. It was builder-added next to Lucas's same-person rule (MD-60); Lucas approved it. Prompts approved for the first Iteration 2 live run (cap $15). | "No two frames in a row use the same kind of shot is a great rule." |
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
