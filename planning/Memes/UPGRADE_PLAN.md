# Meme lab: upgrade plan (v3)

**Status:** Approved 2026-10-14: Lucas took every recommendation (D1 to D9,
recorded as ME-101 to ME-109 in [DECISIONS.md](DECISIONS.md)). U0 to U5
built the same day (BUILD_LOG "Upgrade v3"; build calls ME-110 to ME-114 for
Lucas to confirm). U6: all 44 briefed lab stories generated on v3, waiting
for Lucas's blind grades.

**What the build found, against this plan's evidence:** the blind check
held up legibility, hedges and narration, and the picture-vs-text template
split, but not "turn visible" (see the caveat below): Claude's 91% vs 5%
split was shaped by seeing the ratings. Jev's `turn_visible` did not
predict either, so it weighs nothing in the ranking (ME-112). The turn-first
writer stays (ME-101); U6's grades say whether it helps.

**Goal:** good memes as consistently as possible, for any story, across many
templates and many kinds of conflict. The plan is built from Lucas's grading
of 100 memes in the lab (40 runs, 2026-10-13/14) and his two observations:
a good shape makes a better meme, and some templates are understood better
than others. It does not steer the system toward any template or situation.
It fixes how a story becomes a joke and how a joke becomes a template.

## What the graded batch showed (the baseline)

Ratings: 7 Awesome, 52 Yes, 37 No, 4 Horrible. "Good" below means 3 or 4.

| Finding | Evidence |
|---|---|
| Jev's scores do not predict Lucas's ratings | Within a slate, every Jev score agreed with Lucas less often than chance (funny 20/47 pairs, relevant 18/45, accurate 17/45, clear 16/45). Jev's top "funny" pick was good 50% of the time, its third pick 68%. Funny rises with text length (+0.26); Lucas's ratings fall with it. |
| A visible turn decides most of it | A turn is the reversal, contradiction or backfire the joke rests on. Memes whose printed text shows one were good 91% of the time (n=47); memes that only arrange facts, 5% (n=20). |
| Legibility | Memes where every name and term is known to a casual follower: 75% good. Memes with an obscure name or term (Tsuda, xtool v1.22.2, blumify.io, EDF, Stargardt): 6%. |
| The shape the writer works from | Runs whose shape named one sharp turn or a clear tension: 65% good, 6 Awesome. Runs whose shape was a list of catches: 38%, 0 Awesome. Today the shape is written in the same call as the memes, so it does not constrain them. |
| The brief feeds the shape | A brief with a tension led to a clear shape in 19 of 24 runs; without one, 4 of 10. Briefs made from copy have no tensions by construction (`lfd-source.ts`) and rated 45% good vs 56% for briefs built from the article body. |
| Templates: picture vs tone | Templates whose picture itself shows the relation (handshake, distracted boyfriend, buff doge, two buttons, the exit ramp): 80% good, 6 of 7 Awesomes. Templates whose text must supply the tone (mockery, a scream, conspiracy, irony): 39% good, 20 of 24 misused memes. |
| Some cards misread their format | Ancient Aliens' card says "the joke is that it really is the answer", which turns it into a quiz. Imagination SpongeBob shows a company's pitch on a delighted face, so it reads as endorsement. Mocking SpongeBob, Imagination SpongeBob and Laughing Leo went 0 for 8. Jev checks slots against the card, so a misread card passes: it dropped 0 of 15 claim-mocking drafts for misuse, and 4 of 9 Buff Doge drafts. |
| Hedges and narration | Text lines with "says", "may" or "claims": 29% good vs 64%. Lines narrating speech ("Tell dinner…", "Announce…", "So what is…"): 20%. The same fact cast as the company's own brag (OpenAI's logo plus "something of a detective myself") was Awesome; reported with "OpenAI says", No. |
| Beat count | Same Character.AI facts: two-slot Buff Doge was Awesome, four-step Expanding Brain was No. In Gru's Plan, good versions are actions ending in a consequence those actions caused; bad ones are speech acts or end on a caveat. |
| Situations are mostly labels | 8 of 100 shown memes carried a viewer line; 71 had a situation tagged with no viewer content. Memes with no situation were good 75% of the time. AS-07 was the default tag on 44 drafts; AS-06 went 0 for 7. |
| Template gravity | Gru's Plan was drafted in 30 of 40 runs, Ancient Aliens in 19. They fit anything and mostly earn a Yes (Gru: 1 Awesome out of 19 shown). |
| Brevity | Average characters: 71 for a Yes, 76 for an Awesome, 85 for a No, 94 for a Horrible. Memes of 40 characters or fewer were good 82% of the time. |
| Stories | 34 of 40 slates had at least one good meme; 7 had an Awesome. Six had nothing good: four launches or predictions with no turn, one thin copy brief, one ad-copy run. |

Caveat: the turn, legibility and picture-vs-tone codes were made by Claude
with the ratings visible. U0 checks them blind before anything relies on them.

## The new shape of a run

```
brief ──► turns (call 1) ──► code: check, rank, match to cards ──► writer (call 2, same conversation)
      ──► render ──► lints (code) ──► judges (Jev, calibrated) ──► rank ──► slate of 3
```

- **Turns first.** The writer names the story's turns as structured objects
  before any meme is written. Code checks them and keeps the best.
- **Cards matched in code.** Each turn gets a shortlist of cards that carry
  its type and its number of beats. The writer may only use the shortlist.
- **Lints before judges.** Hedges, narration, length and obscure names are
  checked in code, with rules validated on the graded set.
- **Judges that track the ratings.** Jev's questions are replaced with ones
  that predict Lucas's ratings, and none gates until it is shown to.

## Ground rules

- **Spend (CLAUDE.md Rule 1).** Tests never call Claude or Jev live; every
  model step takes an injected client and tests pass canned answers. Live
  runs are Lucas's clicks. Every click stays under **$0.25** (ME-62), enforced
  by the cost meter. Any calibration or validation run that spends is asked
  for first, with its estimate.
- **Prompt caching.** The static prefix (rules, voice, turn taxonomy,
  situations, players) is cached. The tools array (`submit_turns`,
  `submit_memes`) stays identical across both calls. The story, the turns and
  the shortlisted cards are the per-run suffix. Helpers: `lib/anthropic-cache.ts`.
- **Mandatory, not advisory.** Every new writer rule is a required field or a
  HARD CONSTRAINT that code checks. A broken meme is dropped, not hoped away.
- **Core layers.** Fixes go into the cards, the turn types and the writer's
  own rules, not into override paragraphs stacked on top.
- **Approvals.** New Jev wording, turn types, card changes and situation
  changes are DRAFT until Lucas approves them (ME-80 pattern, ME-97).
- **Local.** The lab stays local (ME-86). No Supabase schema, no worker deploy.
- **Order.** Milestones in order, an Accept bar for each, a report at each
  boundary. U1 and U2 are independent and may run in parallel.

## Decisions for Lucas

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve the turn types (draft below) as managed data, like the situations. | Approve after edits. |
| D2 | Approve the rewritten template cards (U2). | Review the 13 changed cards in full; the other 47 get new fields only. |
| D3 | The three claim-mocking templates (Mocking SpongeBob, Imagination SpongeBob, Laughing Leo, 0 for 8): rewrite and keep, or bench until a rewrite proves out. | Bench until U6 shows the rewrite works. |
| D4 | Let a card loosen one voice rule for one slot where the format needs it (the seagull's scream may use an exclamation mark or caps). Today the voice block bans exclamation marks in code (ME-07). | Allow, per slot, declared on the card. |
| D5 | Situations become optional: a viewer line only when the turn touches the viewer's own experience. Optionally add "watching the companies" feelings (enjoying a backfire, "called it", "again?", spotting hypocrisy). | Optional situations: yes. The new feelings live in the turn types instead of the situation library. |
| D6 | Remove Jev's pairwise "funny" from ranking until a ranker beats chance on the graded set (ME-94 says funny ranks). | Remove. |
| D7 | Finished posts with a body of 500 characters or more get the body brief (about $0.03) instead of the free copy brief, for meme runs only (ME-99). | Yes. |
| D8 | Where the graded set lives for evaluation: `.memes-local/eval/` (local, gitignored) or a repo fixture. | Local. |
| D9 | Validation budget (U6): rerun v3 on 15 graded stories, about $1.50 to $2.00 in Lucas's clicks, graded blind to version. | Approve when U5 is done. |

## Turn types (draft for D1)

Built from the 47 graded memes whose text showed a turn. Each type has the
beats a meme must show and the templates that could carry it. The template
column is illustrative; U2 sets it with Lucas's approval. Every type has
several carriers, so a strong turn never forces one template.

| Type | Beats | Graded example | Could carry it |
|---|---|---|---|
| Backfire | actor, action(s), the consequence the action caused | Hire from Apple, build an iPhone rival, a judge hands Apple your interview files (Awesome) | Gru's Plan, Bike Fall, Surprised Pikachu, Panik Kalm Panik, Bad Luck Brian |
| Says vs does | party, what it says, what it does | Maia as the main system, still Nvidia and AMD for training | Distracted Boyfriend, Clown Makeup, Hide the Pain, Drake |
| Double standard | party, the standard for others, its own case | Police say being tracked is scary | Woman Yelling at Cat, Spider-Man Triple, Scooby Mask, They Don't Know |
| Unlikely agreement | party A, party B, the shared move | OpenAI and Anthropic: voluntary pledges are not enough (Awesome) | Epic Handshake, Same Picture, Spider-Man Triple |
| Wandering eye | who, what they have, what tempts them | Microsoft, Nvidia, Maia 300 (Awesome) | Distracted Boyfriend, Friendship Ended, No - Yes, Left Exit 12 |
| The fall | then (with its figure), now (with its figure) | Character.AI: $1B and no revenue, Disney bids $20M (Awesome) | Buff Doge, Bad Luck Brian, Trophy |
| Scale gap | the big thing, the small thing | Milk has more safety rules than AI | Buff Doge, You Guys, Trade Offer, Pawn Stars, Two Guys on a Bus |
| Fancy name | the plain thing, its polished name | "Rules you can choose to follow" / "A light-touch approach" | Tuxedo Pooh, Is This a Pigeon, Scooby Mask |
| Obvious consequence | the move, its predictable result | Mass-apply with AI, 12,000 applications | Surprised Pikachu, This Is Fine, Disaster Girl, Roll Safe |
| Again | the recurring event | Claude acting on a real site it shouldn't, again | 0 Days Without, X Everywhere, Waiting Skeleton |
| Backwards result | the help added, the opposite outcome | Extra rewards, success goes down | Gru's Plan, Bell Curve, Expanding Brain |
| Vested interest | the speaker, the stance, the stake | A chip CEO wants less doom talk: vested interest | Ancient Aliens (rewritten), Scooby Mask, Evil Kermit |
| Dilemma | who chooses, option A, option B | Claude Opus 5.5 Max or Muse Wonder Full (Awesome) | Two Buttons, UNO Draw 25, Left Exit 12 |
| Self-congratulation | the party, its brag | OpenAI's models caught its own spy (Awesome) | Something of a Scientist, Absolute Cinema, Trophy |
| Fine print | the promise, the catch | $250M of compute, terms still to be agreed | Gru's Plan, Running Away Balloon, Megamind, Flex Tape |
| Outrage vs shrug | the accuser, the accusation, the unbothered reply | Police: "unacceptable"; Anthropic: minimal impact | Woman Yelling at Cat, This Is Fine, Sleeping Shaq |
| The viewer's day | the news, how it lands on the viewer | "Me, deciding which one to use this week" | the AS situations' templates: Drake, Waiting Skeleton, Two Guys on a Bus, Squidward Window |

## Milestones

### U0 · The evaluation harness (no model calls)

- **The graded set.** Export the 100 rated memes, the 164 dropped drafts, the
  40 stories and their briefs to `.memes-local/eval/graded-2026-10-14.json`
  (D8), with a loader for scripts and tests.
- **Lints** (`lib/memes/lint.ts`, pure functions):
  - hedge words in printed text ("says", "said", "claims", "may", "might", "according to");
  - speech-act openers in sequence slots ("Tell", "Say", "Announce", "Add", "Explain", "Ask", "So what");
  - a per-slot and per-meme character budget;
  - unexplained proper nouns: capitalized names that are not a blue-chip
    player (name, aka or token), not on a short list of household names, and
    not one of the turn's plain labels.
- **`scripts/memes_eval.ts`.** Replays the lints over the graded set and
  prints, for each, the good rate with and without it. A lint may later drop
  a meme only if it separates good from bad on this set.
- **Blind check of the post-hoc codes.** A fresh agent, given only the cards
  and the images (no ratings), sorts the 60 templates into "the picture shows
  the relation" or "the text supplies the tone", and codes the 100 memes for
  "turn visible" and "legible". Agreement with the earlier codes is reported.
  No model API spend.
- **Lab instrumentation.**
  - Each slate records its pipeline version (`v2`, `v3`).
  - After a rating, optional one-click reasons aligned with the findings:
    no turn, obscure name, template misused, too long, hedged or flat, wrong
    tone, inaccurate, off-limits. A 3 or 4 can take "what worked" chips. The
    old reject tags were never used once the slider arrived.
  - A blind mode that hides the version during a validation round.
  - The results board adds splits by turn type, by picture-vs-tone and by reason.
- **Accept:** the eval script runs offline and reproduces the baseline numbers
  above; the lint table is printed; the blind agreement is reported; the lab
  saves reasons and versions; tests pass with no live calls.

### U1 · Turns: the story side

- **`planning/Memes/TURN_TYPES.md`** (D1) and `lib/memes/turns.ts`: the
  approved types as data, with each type's beats.
- **A turn** is `{ id, type, beats: [{ role, text, plainLabel, factIds }],
  butt, touchesViewer, strength }`. `plainLabel` is how the beat reads to a
  casual follower ("a chip CEO", not "Feldman"; "the robot", not "AlphaNIST").
- **Call 1 of the writer conversation** returns 3 to 5 turns through
  `submit_turns`. HARD CONSTRAINTS checked in code:
  - every beat cites fact IDs that exist;
  - the beat count matches the type;
  - plain labels pass the legibility lint;
  - the last beat of a backfire or fine print is definite, with no hedge;
  - a [CLAIM] beat names whose claim it is;
  - for a spread, the turn's beats cover every story; for a landscape, at
    least two.
  - When no turn passes, one retry on the same conversation; if still none,
    the viewer's-day turn is used and the run is marked "weak turn" in the
    lab. There are still no "no meme" cases (ME-90).
- **Code ranks the turns** by strength, type spread and legibility, and keeps
  up to 3 that differ in type.
- **The briefs** (`meme-brief-from-body@2`): the body brief explicitly asks for
  tensions written as contradictions, reversals, a party's action causing its
  own problem, and gaps between what a party says and does, each with fact
  IDs. Finished posts with a body of 500 characters or more take the body
  brief for meme runs (D7). The shared Reporter schema is unchanged.
- `story_shape` is retired; the turns replace it.
- **Accept:** `tests/memes-turns.test.ts` with canned turn submissions covers
  every check; the body-brief prompt test passes; caching is asserted
  (stable tools, cached system); no live calls.

### U2 · Template cards v2: the template side

Every card is re-read against how the format is actually used, the way cards
26 to 60 were re-encoded. New fields:

| Field | What it holds |
|---|---|
| `carries` | The turn types the format expresses. |
| `beats` | How many content beats it holds (checked against its writable slots). |
| `carriedBy` | `picture` (the image shows the relation) or `text` (the text must supply the tone). |
| `stance` | The attitude the image projects: smug, delighted, dismayed, betrayed, agreeing, mocking, panicked. |
| `usage` | How the internet uses it, in a sentence or two, and the known misuse to avoid. |
| `punch` | The slot that carries the payoff (read last). |
| `maxChars` | A tighter cap per slot, from the brevity finding. |
| `voice` | An optional per-slot exception to one voice rule (D4). |

Cards rewritten, not just extended (D2), each with the graded memes that
motivated it:

- **Ancient Aliens:** one pet explanation for everything, said with total
  conviction. Not a quiz with a literal answer.
- **Imagination SpongeBob:** genuine delight at something small. Never a
  company's pitch shown straight.
- **Mocking SpongeBob:** mockery of something said at someone, with the
  counter-fact visible. Never a marketing line restated.
- **Laughing Leo:** laughing at a claim only when the gap is on the image.
- **Inhaling Seagull:** an outsized, emotional reaction to a mild prompt.
- **You Guys Are Getting Paid:** both parties identifiable on the image; the
  speaker has the worse deal.
- **Same Picture:** the facts must show the two are the same thing.
- **Gru's Plan:** steps are actions by one actor; the flaw is a consequence
  those actions caused, never a caveat or a statement.
- **Expanding Brain:** an ironic escalation whose last take is the absurd
  real move. Never a chronology.
- **Bell Curve:** the simple take is right and sounds dumb; the middle is
  readable.
- **Thinking About:** two sides of one shared situation; the trivial thought
  is concrete.
- **Monkey Puppet:** the looker is the party the awkward fact is about.
- **One Does Not Simply:** only when the thing truly sounds easy.

Text-carried templates stay in rotation, but match only a turn their card
carries, and rank after picture-carried ones unless the turn is strong. The
claim-mocking three sit out until U6 shows their rewrites work (D3).

- **Accept:**
  - Catalog tests: every card has the new fields; `beats` matches its slots.
  - Every turn type is carried by at least 3 templates, 2 of them picture-carried.
  - Samples re-rendered, 60 of 60.
  - `TEMPLATE_CARDS.md` updated and approved.

### U3 · Matching in code

- `lib/memes/match.ts`: for each kept turn, the candidates are the cards that
  are free (90-day gate, ME-40) and carry the turn's type, with:
  - a matching beat count (optional slots allowed);
  - a viewer slot only when the turn touches the viewer;
  - landscape cards only for landscape and spread runs.
- **Ranking within the shortlist:** picture-carried first; generic cards (those
  that carry many types) after specific ones; a card used in the last few lab
  slates after fresh ones. The shortlist is 3 to 5 cards per turn.
- **Slate composition** (ME-61): 3 memes on 3 templates, from at least 2
  different turns when the story has them, so the slate is a choice between
  ideas.
- **Accept:** `tests/memes-match.test.ts` on fixture turns. An offline replay of
  the 40 graded stories with hand-written turns shows no card in more than a
  quarter of the shortlists. No live calls.

### U4 · Writer v3

`meme-writer@3`, one conversation, two calls. The system prefix holds the
rules, the voice, the turn types, the situations and the players. The cards
are no longer all in the prefix: the shortlisted cards, in full, go in call 2
with the kept turns. HARD CONSTRAINTS, each checked in code:

- every meme names a `turn_id` and a template from that turn's shortlist;
- the turn's beats fill the slots in order, and its payoff lands in the
  card's `punch` slot;
- printed names are blue-chip players (code renders them) or the turn's plain
  labels;
- a [CLAIM] is shown by casting: the claiming company is on the image in the
  speaking slot, or the line is quoted with its logo present. No hedge words
  (ME-93 kept, without "says");
- sequence slots are actions, not speech acts, and the last beat has no hedge;
- every line is within the card's `maxChars`;
- a viewer line and a `situation_id` only when the turn touches the viewer
  (D5); otherwise the situation is null;
- 2 drafts per turn on different templates, 6 in all, as today.

The extra-drafts call (ME-95) stays and becomes rarer. **Accept:**
`tests/memes-writer.test.ts` rewritten with canned submissions for every
check; the caching layout is asserted; the cost estimate below holds in the
meter's worst case.

### U5 · Judges v3 and the ranking (validated before use)

- **Kept as hard gates:** `accurate`, `off_limits`, `ad_copy`.
- **Replaced** (`relevant`, `clear`, `role_<slot>`, pairwise `funny`) by:
  - `turn_visible`: Jev sees only the printed text and labels, not the
    writer's relation or reasons. Does the printed meme alone show the turn?
  - `legible`: would a casual follower of AI news recognize every printed
    name and term?
  - `format_true`: is the template used the way its card's `usage` says?
  - `punch_last`: does the payoff land in the last slot read?
- **Calibration before use.** The new questions run over the 100 graded memes
  (about $0.01 of Jev, asked for first, or a Calibrate button Lucas clicks in
  the lab). A question may gate only if it separates good from bad.
  - Within-slate agreement with Lucas must reach at least 65% (36 to 43% today).
  - Bars are set to remove at least 70% of the 41 No/Horrible memes while
    keeping at least 90% of the Yes/Awesome.
  - A question that doesn't beat chance only ranks, or is dropped.
- **Ranking** (D6): the order in the slate comes from the checks that
  predicted ratings: turn strength, picture-carried, brevity, `turn_visible`.
  The weights are refit on every new graded batch.
- The new Jev wording is DRAFT until Lucas approves it.
- **Accept:** the calibration report shows each question's split on the
  graded set; `tests/memes-run.test.ts` covers gates and ranking with canned
  answers.

### U6 · Validation round

- **Stories:** the 6 that produced nothing good, plus 9 graded stories spread
  across turn types (a backfire, a policy story, a launch, a niche essay, a
  rivalry, a money story), plus new stories as they arrive. Generated with v3.
  The lab hides the version during grading.
- **Cost:** 15 clicks at about $0.10 to $0.14 each, about $1.50 to $2.00 (D9).
- **Targets** (baseline in brackets):

| Measure | Target |
|---|---|
| Good rate | 75% or more (59%) |
| Slates with at least one good meme | 95% or more (85%) |
| Slates with an Awesome | 30% or more (18%) |
| Horrible | 0 (4) |
| The 6 zero-good stories | at least 4 get a good meme (0) |
| Variety | no template in more than a quarter of slates (Gru drafted in 75% of runs); at least 6 turn types across the round |
| Text-carried templates | 60% good or more (39%) |
| Judges | within-slate agreement 65% or more (36 to 43%) |
| Cost | every click under $0.25; mean $0.12 or less ($0.095) |

- **Accept:** Lucas's grades meet the targets, or the gaps are reported with
  the next fix. The new grades are added to the eval set, and U5's weights
  are refit.

## Cost per Generate click (estimate)

Sonnet 5.5 at $2 per million input tokens and $10 per million output.

| Step | Warm | Cold (first click in an hour) |
|---|---|---|
| Cached prefix (rules, voice, turn types, situations, players: about 10K tokens, down from 24K because the cards leave the prefix) | ~$0.002 | ~$0.04 |
| Call 1: story in (~3K), turns out (~2K) | ~$0.03 | ~$0.03 |
| Call 2: turns and shortlisted cards in (~5K), memes out (~5K) | ~$0.06 | ~$0.06 |
| Jev: lints first, then about 6 candidates × 1 call | < $0.01 | < $0.01 |
| **Total** | **~$0.10** | **~$0.14** |

The extra-drafts call adds at most about $0.06. The meter keeps every click
under $0.25.

## What does not change

- The 90-day template rule and its gate (ME-40 to ME-45).
- Exact names and logos from the blue-chip players (ME-10 to ME-13).
- Facts strict, framing may exaggerate (ME-32). No ad copy (ME-93).
- The skip list and politics rules (ME-30, ME-31).
- A slate of 3 on 3 templates, and every meme a human pick (ME-60, ME-61).
- The lab stays local and isolated (ME-86).

## Paperwork

- `DECISIONS.md`: new rows ME-101 onward for D1 to D9 as Lucas decides them.
- `TURN_TYPES.md` (new, approved data) and `TEMPLATE_CARDS.md` (v2).
- `BUILD_LOG.md`: one entry per milestone, with its Accept evidence.
