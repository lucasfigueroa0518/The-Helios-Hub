# Memes: product decisions

The register for the meme layer of the social hub. Nothing is built yet; this
records what Lucas has decided while the product is designed. Each row says who
decided and when. "Default" means Lucas had no preference and the recommended
option stands until he changes it.

## What a meme is

| ID | Decision | Source |
|---|---|---|
| ME-01 | A meme is a **mapping**, not a caption: the news situation's shape is matched to a template's logic, and the slots are filled from that match. | Lucas, 2026-10-13 |
| ME-02 | **The news triggers the joke; the joke is the feeling.** A managed library of recurring audience situations supplies relatability. | Lucas, 2026-10-13 |
| ME-03 | **No running characters for companies.** Company personalities go stale fast in this space; a company's state comes only from current news. | Lucas, 2026-10-13 |
| ME-04 | The **"stack up"**: Jev compares events (how one move relates to another) and the result is a shape that templates can match. | Lucas, 2026-10-13 |
| ME-05 | Four judges: **funny, relevant, accurate, clear**. | Lucas, 2026-10-13 |
| ME-06 | **Humans pick** from a slate, and the pick is the reinforcement signal. | Lucas, 2026-10-13 |
| ME-07 | The voice block, the humanizer and the skip-list categories all apply. | Lucas, 2026-10-13 |

## Names and logos

| ID | Decision | Source |
|---|---|---|
| ME-10 | **Exact names only.** People and companies come from `BLUE_CHIP_PLAYERS` (`lib/social-hub/blue-chip-players.ts`); a person's company comes from their `companyIds`. The model returns ids and code renders names and logos. | Lucas, 2026-10-13 |
| ME-11 | Logos are overlaid on templates from the reviewed logo bank (`lib/social-hub/logo-bank.ts`): every blue-chip company plus the metadata-only companies attached to people. SSI has no official logo and Eureka Labs' was not approved, so both are name-only. | Lucas, 2026-10-13 |
| ME-12 | **Real people appear as labels and logos only.** Template figures are never edited and no face is swapped. | Lucas, 2026-10-13 |
| ME-13 | **No on-slide credit for logos** in the meme format. When the same logo appears on another carousel slide (likely), that slide carries the credit. Note: 21 of the 23 Commons logos are public domain; only Nvidia (Apache 2.0) and DeepSeek (MIT) carry licence terms that ask for a notice. | Lucas, 2026-10-13 |

## Format

| ID | Decision | Source |
|---|---|---|
| ME-20 | The meme is **inserted in front of the story carousel's cover**, as the very first slide. It is not one of the cover options. | Lucas, 2026-10-13 |
| ME-21 | **Every carousel** gets a meme attempt, eventually. **First, test it in isolation:** nothing is wired into carousels or any other content type until Lucas decides it is ready (no fixed bar; his call). | Lucas, 2026-10-13 |
| ME-22 | The test bed is a **meme lab page in the hub**: pick an existing carousel story, click Generate (a human-led run), get a slate, pick. Nothing publishes. | Lucas, 2026-10-13 |
| ME-23 | Meme text uses **Inter Medium** (`helios_text_engine/fonts/Inter-Medium.ttf`), Trial Reels' and IG Stories' stand-in for Instagram's Classic font. | Lucas, 2026-10-13 |
| ME-24 | **No Helios branding** on the meme: it should read as a real meme; the cover right behind it carries the brand. | Lucas, 2026-10-13 |

## Safety

| ID | Decision | Source |
|---|---|---|
| ME-30 | The skip list applies to **template imagery**, not only the story: no violence or weapons, nothing really sexual. | Lucas, 2026-10-13 |
| ME-31 | Politics is fine only when it is directly the meme's subject, and never with partisan sentiment. | Lucas, 2026-10-13 |
| ME-32 | **Facts strict, framing may exaggerate.** Every claim traces to the brief's facts; tone and framing may exaggerate only when the relation underneath is true. No invented quotes or numbers. | Lucas, 2026-10-13 |

## The 90-day template rule

| ID | Decision | Source |
|---|---|---|
| ME-40 | **Once a template is published to our social, it is not generated or published again for 90 days.** A hard gate in code before generation, not prompt guidance. | Lucas, 2026-10-13 ("extremely important") |
| ME-41 | An approved or scheduled meme **reserves** its template, so no second meme is generated on it. The 90 days run **from publish**. A meme cancelled before publishing releases its template. | Lucas, 2026-10-13 |
| ME-42 | "The same template" is the **format family**: variants of one meme (Drake 2-panel and 4-panel, recrops of one image) share a cooldown. | Default (Lucas: no preference), 2026-10-13 |
| ME-43 | ~~When no off-cooldown template fits a story, the carousel ships without a meme slide.~~ **Superseded by ME-90.** | Default, 2026-10-13; superseded the same day |
| ME-44 | The 90-day ledger is **its own table in a new `memes` schema**: one row per use, with the template family and when it was reserved, published or released. The gate is one query, run before generation and again at publish. It works in the lab before anything touches the carousel tables; wiring in adds the publish stamp. | Lucas, 2026-10-13 |
| ME-45 | A template's family key is its **Know Your Meme entry** (KYM groups variants of one meme); classic templates are mapped to their entry at intake. **Image similarity is the safety net:** a new template that near-duplicates one on cooldown is blocked too. | Default (recommended alongside ME-44; Lucas did not object), 2026-10-13 |

## Templates

| ID | Decision | Source |
|---|---|---|
| ME-50 | Templates come from the **classic catalog** (Imgflip's top templates) and **trending** formats (Know Your Meme). No original generated scenes. | Lucas, 2026-10-13 |
| ME-51 | A trending template is **added automatically when its checks pass**: a drafted usage card (meaning, box roles) and the imagery checks (ME-30, ME-31). | Lucas, 2026-10-13 |
| ME-52 | Trending intake runs **daily** in the overnight window. The scan is plain web fetching (no model). The paid step (usage card and imagery check) runs only for new formats that pass a popularity bar, **at most about 3 a night**. Before building: read Know Your Meme's terms on scraping. The lab starts on the classic catalog and adds trending intake once the lab loop works. | Lucas, 2026-10-13 |
| ME-53 | **The classic catalog's first 25 template cards are approved**, with the 9 exclusions (`TEMPLATE_CARDS.md`). | Lucas, 2026-10-13 |

## The slate and the pick

| ID | Decision | Source |
|---|---|---|
| ME-60 | **Every meme is a human pick**, even when the carousel itself auto-publishes. | Lucas, 2026-10-13 |
| ME-61 | A slate is **3 memes on 3 different templates**: a choice between ideas, not wordings. | Lucas, 2026-10-13 |
| ME-62 | Live spend per Generate click (one story → one slate) stays **under $0.25**, with prompt caching. | Lucas, 2026-10-13 |
| ME-63 | The audience-situation library: **Claude drafts 15–20, Lucas edits and approves each** before the system uses it. **Done:** all 20 situations in `AUDIENCE_SITUATIONS.md` (AS-01 to AS-20) approved as written. | Lucas, 2026-10-13 |
| ME-64 | A rejected meme takes **reason tags** (not funny, wrong template, inaccurate, unclear, off-brand, too political) **plus an optional note**. | Lucas, 2026-10-13 |
| ME-65 | An audience situation used in a published meme **rests for 3 days**. | Lucas, 2026-10-13 |

## Landscape memes (the stack-up across stories)

| ID | Decision | Source |
|---|---|---|
| ME-70 | The lab makes **single-story and landscape memes from day one**. A landscape meme relates several blue-chip players across several stories. | Lucas, 2026-10-13 |
| ME-71 | **Jev decides** which stories a landscape meme covers and the relation between them. | Lucas, 2026-10-13 |
| ME-72 | A landscape meme reaches back **7 days**. | Lucas, 2026-10-13 |
| ME-73 | Once wired in, a landscape meme goes **in front of the carousel of the newest story it covers**. | Lucas, 2026-10-13 |
| ME-74 | Landscape memes use a **lighter fact check**: every claim the meme makes must be supported by the source text of the story it comes from (headline and scored body; one source is enough), checked by one grounding question modeled on `md-grounding@1`. Single-story memes keep the stricter rule: claims cite the Reporter brief's fact IDs (ME-32). | Lucas, 2026-10-13 |

## Made during the build: Lucas to confirm (2026-10-13)

Lucas asked for a high degree of autonomy on the build. These are the calls it
made that he hasn't seen; each is easy to change.

| ID | Decision | Why |
|---|---|---|
| ME-80 | The judges' and stack-up's Jev wording is **DRAFT**, wired in: `meme-judges@1` (relevant, accurate, clear, off-limits), `meme-funny@1` (pairwise, both orders), `meme-stackup@1` (lib/memes/judges.ts, landscape.ts). | The repo's rule: Jev wording waits for Lucas's approval. |
| ME-81 | Judge bars: relevant ≥ 0.5, accurate ≥ 0.6, clear ≥ 0.5, off-limits < 0.3. | Accuracy is held higher (ME-32). To be calibrated against Lucas's picks. |
| ME-82 | The meme sits whole on the 1080×1350 canvas on a **white letterbox**. | Instagram crops every slide to the first one's ratio; white reads as a reposted meme. |
| ME-83 | Labels: a company's **wordmark logo stands alone** (it spells the name); a symbol-only logo (Mistral, Apple, Tesla, SpaceXAI, Higgsfield) carries the name; a person shows their name plus their company's logo, dropping the logo if it can't fit. | Wordmarks already say the name; doubling it wasted space and failed fit. |
| ME-84 | The writer is Claude Sonnet 5.5 at high effort with 10K max output (`MEME_MODELS`), one retry. $0.02 of each click is held back for the judges; when a retry can't be afforded, the first pass's valid memes are kept. | Keeps every click under the $0.25 cap (ME-62). |
| ME-85 | Landscape memes draw on carousel stories that have a Reporter brief, so their lines cite lettered fact IDs (A.F1). That is stricter than ME-74's lighter check, which is unused for now. A landscape meme must draw on at least two stories. | The briefs were available for the whole 7-day pool (14 posts on 2026-10-13). |
| ME-86 | The lab runs **locally, inside the Next dev server**: its database is local PGlite (`.memes-local/`) and a Generate wakes an in-process runner. It needs no Supabase schema and no worker deploy. | Lucas said not to redeploy the social worker yet, and nothing reaches Supabase until he says so. |

## After the first live runs (Lucas, 2026-10-13)

| ID | Decision | Source |
|---|---|---|
| ME-90 | **There are no "no meme" cases.** There is always an appropriate angle: when a story involves harm, the joke is aimed at the process, the spin, or the gap between claims and events, never at the harm or the people hurt. Landscape memes always pair the best two stories, looking back 14 days when the week has no two companies. | Lucas |
| ME-91 | **Misusing a template must never happen.** Every fillable slot has a MUST (what its content must do). The writer says `why` each fill does that job. Jev checks every slot against its MUST in the same single call, and any slot below 0.6 drops the meme. | Lucas |
| ME-92 | **A format's own line is never dropped.** It is printed by code ("You guys are getting {x}?", "Is this {x}?", "{x}, right?" repeated in Anakin's last panel); the writer fills only {x}. | Lucas |
| ME-93 | **A company's sales claim is never delivered as fact or as an ad.** Claims marked [CLAIM] are claims. A company's position may be what the joke is about (spin, hypocrisy, a gap with what happened). Jev's `ad_copy` question drops a meme that would work as the company's ad, and `accurate` now sees the [CLAIM] marks. | Lucas |
| ME-94 | **Funniness ranks; it never removes a meme.** Lucas's pick decides what is funny enough. A lone survivor is paired against the best of the rest, so every shown meme has a funny score. | Lucas |
| ME-95 | **Always at least two to look at, as cheaply as possible.** Broken drafts are dropped, not retried. Only when fewer than two memes clear the bars, one more call on the same conversation asks for 4 new drafts (story not re-sent at full price; 7K output cap). If still short, memes that missed only on clarity are shown, marked as below the bar. | Lucas |
| ME-96 | The clarity bar is **0.55**. | Lucas |

## Last Few Days lab (Lucas, 2026-10-14)

| ID | Decision | Source |
|---|---|---|
| ME-97 | Grow the catalog to **60** on **Imgflip's ranked list only**. Each new card needs Lucas's approval before it enters `TEMPLATE_CATALOG`. The 35 drafts were approved 2026-10-14 and are now in the catalog. | Lucas, 2026-10-14 |
| ME-98 | The lab reads Last Few Days stories, not carousel posts. Snapshot of Tommy's data layer: `origin/unify-social-hub@a16d9c81961056d2c3e55e3f5a7bede972fdfd06` (`db/lfd_schema.sql`, `lib/lfd/types.ts`, `lib/lfd/sources.ts`, `lib/lfd/window.ts`). Do not merge his hub/worker/publish PR. Do not write `lfd.posts`. | Lucas, 2026-10-14 |
| ME-99 | Finished LFD posts get a Brief from their writer copy for free. Candidates get a **structure-from-body** brief on a human click, in parallel, capped at **$0.50** per batch, no `web_search`. A thin body (< 500 characters) can take the full Reporter as a second, one-at-a-time click. Never brief the unchosen pool. | Lucas, 2026-10-14 |
| ME-100 | A **spread** meme covers every story in one LFD set. If it is strong enough to pick, it is the cover. Otherwise the cover mosaic uses the **original** story photos, never the meme images on those slides. Attachments live in `memes.lfd_attachments` (lab only) so a later port into Tommy's finished system has a contract. | Lucas, 2026-10-14 |

## Upgrade v3 (Lucas, 2026-10-14)

From the grading of 100 lab memes. The plan is [UPGRADE_PLAN.md](UPGRADE_PLAN.md);
Lucas took every recommendation (D1 to D9) and started U0.

| ID | Decision | Source |
|---|---|---|
| ME-101 | **Turns come first.** The writer names the story's turns (typed, with beats and fact IDs) before any meme is written; code checks and ranks them. The turn types in UPGRADE_PLAN.md are approved as drafted, as managed data like the situations (D1). | Lucas, 2026-10-14 |
| ME-102 | **Template cards v2:** every card gains `carries`, `beats`, `carriedBy`, `stance`, `usage`, `punch`, `maxChars`. The 13 rewritten cards are reviewed by Lucas in full before they enter the catalog; the other 47 get the new fields only (D2). | Lucas, 2026-10-14 |
| ME-103 | **Mocking SpongeBob, Imagination SpongeBob and Laughing Leo are benched** (0 of 8 in the graded batch) until their rewritten cards prove out in the U6 validation round (D3). | Lucas, 2026-10-14 |
| ME-104 | **A card may loosen one voice rule for one slot** when its format needs it (the Inhaling Seagull's scream may use an exclamation mark or caps), declared on the card. Everything else keeps the voice block (ME-07) (D4). | Lucas, 2026-10-14 |
| ME-105 | **Situations are optional:** a viewer line and a situation only when the turn touches the viewer's own experience. Feelings about the companies (a backfire, hypocrisy, "again?") live in the turn types, not in new situations (D5). Amends ME-02. | Lucas, 2026-10-14 |
| ME-106 | **Jev's pairwise "funny" no longer ranks the slate** until a ranker beats chance against Lucas's ratings (D6). Amends ME-94. | Lucas, 2026-10-14 |
| ME-107 | **Meme runs use the body brief** for finished posts whose body is 500 characters or more, instead of the free copy brief (about $0.03 each). Copy briefs have no tensions and no claim marks (D7). Amends ME-99 for meme runs only. | Lucas, 2026-10-14 |
| ME-108 | **The graded set stays local** (`.memes-local/eval/`, gitignored) (D8). | Lucas, 2026-10-14 |
| ME-109 | **The U6 validation budget** (about $1.50 to $2.00 of Lucas's clicks, 15 stories, graded blind to version) is decided when U5 is done (D9). | Lucas, 2026-10-14 |

## Made during the upgrade build: Lucas to confirm (2026-10-14)

Lucas asked for the plan to be built and run end to end while he was away.
These calls came from the build's evidence; each is easy to change.

| ID | Decision | Why |
|---|---|---|
| ME-110 | **The accuracy bar is 0.4** (amends ME-81's 0.6). | Calibrated on the graded set: meme-judges@3's accuracy question would drop 16 of Lucas's 47 good memes at 0.6, 2 of 47 at 0.4 (and 7 of 39 bad). |
| ME-111 | **No new Jev question gates.** The slate is ranked by legible + format_true + brevity (longest line) + picture-carried. | No question removed 70% of bad memes while keeping 90% of good. The ranking agrees with Lucas within a slate 65% of the time (the @2 judges: 36% to 43%). |
| ME-112 | **"Turn visible" weighs nothing** in the ranking; it is still asked, for the record. | It did not predict Lucas's ratings blind (blind coder) or from Jev (AUC 0.54). The turn-first writer stays (ME-101, Lucas's observation 1); whether turns help is measured on the U6 grades. |
| ME-113 | **Cards' `carriedBy` uses the blind coder's sort**, not Claude's. | It predicted ratings without seeing them (picture 73% good, text 44%). |
| ME-114 | **The slate takes the best meme of each kept turn first** (up to three), then fills by score. | ME-61: a choice between ideas. The first smoke slate had two memes from one turn and none from the backfire. |

### Golden set (2026-10-15; planning/Memes/GOLDEN_SET.md). Drafts for Lucas's review

| ID | Decision | Why |
|---|---|---|
| ME-115 | **Templates are learned from real memes, not described from memory.** Each active card gets a golden card: the mechanism, the patterns, the real line lengths, our own examples, the misreads and a test, all coded from about 70 top Imgflip uses, the flops and the tech memes. | Lucas, 2026-10-15: "the meme templates are not being understood well enough". Coded against the dossiers, 43% of our 215 memes misuse their template; Lucas rated 2 of the 51 misuses good. |
| ME-116 | **A meme names the pattern it follows**, and code rejects a missing or unknown one. | It makes the writer commit to a real use of the format before filling the slots (prompt rules are mandatory). |
| ME-117 | **"How real memes are written" rules in the writer system:** labels, not sentences; parallel wording; the figure's own voice; concrete; plain setup with a specific punch; never explain; small and familiar. Code enforces one idea per box and no trailing full stop. | G2 measured the gaps: first person 26% of real boxes vs 1% of ours, the same first word 19% vs 1%. The G3 coders found the same rules template by template. |
| ME-118 | **Slots follow the real format.** 22 cards were restructured (new, renamed or moved boxes, kept clear of faces) and 27 got rewritten MUSTs and accepted kinds through a generated overlay. New `fallback`: an optional slot prints the format's own line when empty (CINEMA, If I had one!, *INHALES*). | The dossiers showed our slots forcing misreads: Disaster Girl as a bystander, Bike Fall as blame, Bad Luck Brian in one line, Hide the Pain with the pain over the calm face. |
| ME-119 | **Line caps come from the golden p90 per slot plus a tenth, clamped to 18–80 characters.** | Real formats differ: "ME" is 2 characters, a shower thought is 54. One cap per card cut real-length lines or let short slots run long. |
| ME-120 | **meme-judges@4:** `format_true` answers the golden card's test; `real_meme` is asked but weighs 0. | Calibrated on the golden labels (2026-10-17, 204 posts, 15 templates): real_meme AUC 0.67 and format_true 0.60, against 0.56 for length. Both are below the 0.7 bar, so neither gets new weight or gates (ME-111). |
| ME-121 | **`dilemma` no longer asks for a fair, hard trade-off.** Six cards' `carries` were retuned to their real mechanism. | The fair trade-off is the Two Buttons flop shape (6/33 flops); winners are lopsided, fake or double-bad choices. |

### Upgrade v5: headline-visible (2026-10-18; planning/Memes/UPGRADE_V5_PLAN.md)

| ID | Decision | Why |
|---|---|---|
| ME-122 | **Memes are built on what the viewer sees: the headline and the meme.** Main entities only, a relation common sense explains, and no other name, term or number unless it explains itself. | Lucas's observation; in the v4 grades, headline-anchored memes 86% vs 64% good, and two or more outside names 59% vs 77% |
| ME-123 | **Numbers only from the headline or the news line, or when the number is the joke.** It is a writer rule, not a gate. | Lines with digits 47% vs 75%. The gate and a ranking penalty were replayed on v4 and rejected; each cost good memes. |
| ME-124 | **Turn strength means "gets it from the headline alone".** | The old self-rating ran backwards (rated 3: 56% good; rated 2: 73%) |
| ME-125 | **Fill only what carries the joke;** an optional box stays empty otherwise. | 4-text-box memes 1/3; the new boxes were filled with fact logs |
| ME-126 | **Incident stories (harm, crime, courts; code-detected) get a step-1 note:** aim at the company's process, spin or absurd detail, never the harm. | Incident stories 42–46%; the judges dropped 9 of 10 drafts on one; the absurd incident gave 3 Awesomes |
| ME-127 | **`real_meme` ranks with weight 1;** `gets_it` (a headline-only reader that never sees the facts) is asked with weight 0 until calibrated. | Replay on v4: within-slate 76% to 79%, #1 good 25 to 26 of 30, no measure worse |
| ME-128 | **Predictor regime discipline:** each run saves its regime fingerprint and its pre-generation features. The predictor trains and predicts within one regime only, and refuses to predict until it has 60 runs and beats the base rate out of sample. | Lucas, 2026-10-17: insights only apply within the same set of variables (planning/Memes/PREDICTOR.md) |
| ME-129 | **The v5 test set:** the same 44 briefed stories, plus 35 new ones picked by Hub score (reels net, carousel rank), skipping the skip-list categories and near-duplicates. | Lucas, 2026-10-18: "use high scoring stories ... likely to be published" |
| ME-130 | **The gate:** a story gets memes only when its odds of a slate with at least one good meme reach a lab setting (start 92%), and its own cell has at least 5 graded stories. Every kind of story is meant to reach 5 through grading, so none stays out for lack of examples (Lucas, 2026-10-19). At most the top 3 by odds get slates; stories that fail get none, and no exploration slates are made. | Lucas, 2026-10-19 |
| ME-131 | **The odds:** 8 cells (irony or launch × number story × headline ≤ 70), each shrunk toward its parent (K = 4), recounted from the grades on every read. Only one generation regime and one tagger version count. | Lucas, 2026-10-19: "progressively updated as I grade" |
| ME-132 | **Story tags come from Jev only** (`meme-story-tags@3`), shown read-only in the lab. Calibrated against Claude's deep-read codes, never against grades: irony 71%, launch 94%, number 96% agreement. | Lucas, 2026-10-19 |
| ME-133 | **The fault scorer** (`meme-faults@1`) counts each slate meme's bad qualities, from the 131 memes rated 1 or 2 (FAULTS.md). "Confuses a first-time viewer" is one of them. | Lucas, 2026-10-19 |
| ME-134 | **No picker: a story's meme is always its slate's #1.** On the 72 graded v5 slates, choosing by fault count never beat "always #1" (75%), and every drop limit threw out more good #1s than bad ones. No drop rule either. Jev's fault counts are still saved and shown on lab memes, for reference only. | Lucas, 2026-10-19: "leave out the picker and just go with #1 every time" |
| ME-135 | **Placement:** meme stories in original LFD order, at most 3. #1 in the original top 3 becomes the cover (meme with the hook banner below), and its story moves to slide 1 with its photo. #1 outside the top 3 moves to slide 2 with its meme in the photo box. #2 and #3 stay in place with their memes in the photo box. The mosaic keeps the original photos. | Lucas, 2026-10-19 |
| ME-136 | **The LFD lab** (`/memes/lfd-lab`) runs Tommy's unchanged engine as of now or a replayed day. All writes go to the lab's PGlite and the Hub side refuses non-reads. Nothing publishes. Lucas grades memes (which feed the odds) and whole posts. Production LFD is untouched until simulations are reviewed. | Lucas, 2026-10-19 |
| ME-137 | **Short cells are filled by hand.** LFD simulations only make memes for stories that pass, so a cell under 5 graded stories is filled with Hub stories Lucas approves, through `POST /api/memes/lfd-sims/fill`: Jev tags, a body brief, and one unchanged v5 meme run each. First fill: 14 number stories (about $2.30), enough to bring all four number-story cells to 5 once graded. | Lucas, 2026-10-19: "route #1. Now. Go." |
| ME-138 | **Template layout fixes:** Monkey Puppet's logo sits on the puppet's head (right panel), not above the picture; Evil Kermit's two lines sit on their own Kermits, not in top and bottom bands. Geometry is part of the regime fingerprint, so the new code is regime `fd22b427977c`. It is declared equivalent to `3af2b639964f` for the gate's evidence (`EQUIVALENT_REGIMES`), because writing, judging and the story pick did not change. Removing the entry restores the strict one-regime rule. | Lucas's grade notes, 2026-10-19; equivalence is Claude's call, reversible |
| ME-139 | **Sleeping Shaq is banned:** the image itself prints "real shit?". It is blocked in the template-availability check (`BANNED_TEMPLATES`, lib/memes/gate.ts), so the writer never sees it and it can't be reserved. The card stays in the catalog, so the regime fingerprint and old memes are unaffected. | Lucas, 2026-10-19: "BAN THIS TEMPLATE. It's vulgar." |
| ME-140 | **LFD ships with memes.** After the engine saves a post, the worker adds memes (lib/memes/lfd-post.ts): Jev tags, the gate from a frozen evidence snapshot (lib/memes/gate-evidence.generated.json, 128 graded stories at 92%), a brief and one v5 meme run per gated story in an in-memory meme database, each slate's #1, the placement rules, a re-render and re-upload of the slides, and the post row updated before it is placed. It never fails a run: errors or a 12-minute meme timeout leave the post as the engine made it. On by default (`lfd.settings.memes`, false switches it off), with its own $1 cap (`memes_cap_usd`). The 90-day template rule reads recent posts' memes. Production grades nothing; the snapshot is refreshed from the lab with scripts/memes_gate_snapshot.ts. | Lucas, 2026-10-19: "LFD is APPROVED TO SHIP" |
| ME-141 | **Meme slides take the meme's shape; no white bands.** The renderer gets each meme's width / height. Cover: a meme wide enough to leave the hook 330px runs full bleed at its own height, and the hook's type is sized to the room left; a squarer or taller one sits whole as a rounded card (lib/social/render/lfd-meme-box.ts). Story slides: the photo box is the meme's shape, shrunk whole when it would not fit, and the text and meme centre together. The placed meme also loses a clean off-white frame from its template image, and a side where white-ground text touches the edge gets a little white back (trimLetterbox). | Lucas, 2026-10-20: "no white borders", composition "adaptive to the aspect ratio of the meme" |

## Open questions

- None right now.

## Settled

- **xAI is printed as SpaceXAI** (Lucas, 2026-10-13). Its old names (xAI, SpaceXSI) still match. Roster 1 and 2's Jev wording keeps "xAI (Grok counts as xAI)" because it is shipped.
- **Landscape facts:** a lighter check (ME-74).
- **The 90-day ledger:** its own `memes` table (ME-44), keyed by Know Your Meme entry (ME-45).
- **Trending intake:** daily, capped (ME-52).
- **LFD lab:** snapshot @a16d9c8, briefs from copy or structure-from-body,
  spread-as-cover, original photos on the mosaic (ME-98 to ME-100).
- **60 templates:** Imgflip only, approval before catalog (ME-97). The 35 drafts are approved and live.
