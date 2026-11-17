# Central intake replay, 2026-10-29 to 2026-11-04

Generated 2026-11-10 00:02 UTC. A dry run: the new central intake was fed the stories the old pipelines saw on these nights, in a throwaway in-memory copy. Nothing was written to the real database and nothing was posted.

## How to read this

- **Legacy** is what each content type read on that night from the old pipelines. **Intake** is what it would read from the central intake.
- A legacy story counts as **matched** when its article sits inside a story the intake hands to the same content type. The ship target is **80% or more** per content type per night.
- **Outside the replay** means the legacy story's article came from a night before the replay started (or after that night), so the intake could not have it. Those are left out of the percentage.
- **Intake only** splits into: new because the carousel is off (feed stories the old path no longer reads), builder leads (stories that clear the builder bar), and other.
- The carousel has been switched off since 2 November, so legacy carousel lists are mostly empty; feed stories the intake adds there are expected.
- The news feeds are not stored, so they were fetched once today and added only to the newest night (2026-11-04). Older nights have no feed stories on either side.

## Coverage by night

### 2026-10-29

Stored 97 reels items, 4 web-search finds and 0 feed articles; 1 links seen on an earlier night were not stored again. Grouping made 92 stories, joined 9 items to existing ones and merged 0 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 24 | 3 | 21 of 21 | 100% | met | 0 | 0 | 4 |
| Morning Download, carousel side | 69 | 69 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Guess the Number (shortlist + The Number) | 131 | 114 | 17 of 17 | 100% | met | 0 | 0 | 3 |
| Free vs. Paid leads | 30 | 8 | 19 of 22 | 86% | met | 0 | 0 | 3 |
| Last Few Days, reels lane | 231 | 153 | 78 of 78 | 100% | met | 0 | 0 | 14 |
| Last Few Days, carousel lane | 20 | 20 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | not available (feeds not stored for this night) | | | | | | | |

Legacy stories the intake did not hand over:

- Free vs. Paid leads: "The first wired XR glasses powered by Android XR"; "Akai is embracing vibe-coded mods with an open-source MPC"; "Zooming without Zooming v2: From Seeing Details to Connecting Evidence for Gene…"

Intake-only stories marked "other":

- Morning Download, reels side: "Woman Dies After ChatGPT Coached Her to Decrease Dose of Medication Prescribed …"; "Voters in Texas agree: They hate data centers"; "Google expands AI Search ads globally as core ad growth slows"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "Google expands AI Search ads globally as core ad growth slows"; "Show HN: I 3D scanned the interior of the Great Pyramid at Giza"
- Free vs. Paid leads: "Apple's git still trusts the compromised eMudhra certificates"; "Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Last Few Days, reels lane: "Woman Dies After ChatGPT Coached Her to Decrease Dose of Medication Prescribed …"; "Anthropic Raises Concerns"; "Google expands AI Search ads globally as core ad growth slows"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "AI execs may be too out of touch to build for the general public"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "Show HN: I got laid off from Meta and created a minor hit on Steam"; "pbakaus/impeccable: The design vocabulary for your coding agent. Steer with pol…"; and 6 more

### 2026-11-03

Stored 90 reels items, 5 web-search finds and 0 feed articles; 9 links seen on an earlier night were not stored again. Grouping made 90 stories, joined 5 items to existing ones and merged 0 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 20 | 0 | 19 of 20 | 95% | met | 0 | 0 | 2 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Guess the Number (shortlist + The Number) | 45 | 26 | 19 of 19 | 100% | met | 0 | 0 | 1 |
| Free vs. Paid leads | 30 | 5 | 25 of 25 | 100% | met | 0 | 1 | 4 |
| Last Few Days, reels lane | 193 | 108 | 85 of 85 | 100% | met | 0 | 0 | 5 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | not available (feeds not stored for this night) | | | | | | | |

Legacy stories the intake did not hand over:

- Morning Download, reels side: "New AI Data Center Is So Huge That It’ll Generate the Heat of 23 Atomic Bombs E…"

Intake-only stories marked "other":

- Morning Download, reels side: "ChatGPT Is Giving Voters Ludicrous Misinformation Right as the Midterms Hit"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "ChatGPT Is Giving Voters Ludicrous Misinformation Right as the Midterms Hit"
- Free vs. Paid leads: "expo/skills: A collection of AI agent skills for working with Expo projects and…"; "pbakaus/impeccable: The design vocabulary for your coding agent. Steer with pol…"; "macro-inc/macro: Macro is a unified workspace for teams: email, chat, docs, tas…"; "obra/superpowers: An agentic skills framework & software development methodolog…"
- Last Few Days, reels lane: "Ubuntu still has not released patch for Linux 0day RCE in almost 3 weeks"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "thedotmack/claude-mem: Persistent Context Across Sessions for Every Agent – Ca…"; "pingdotgg/t3code"; "2 days till TechCrunch Founder Summit: Boston founders don’t need a Silicon Val…"

### 2026-11-04

Stored 97 reels items, 5 web-search finds and 0 feed articles (of 0 fetched; 0 published after that night's intake were left out, the rest filtered by the intake's window and code filters); 10 links seen on an earlier night were not stored again. Grouping made 90 stories, joined 12 items to existing ones and merged 3 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 19 | 1 | 16 of 18 | 89% | met | 0 | 0 | 3 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Guess the Number (shortlist + The Number) | 20 | 0 | 18 of 20 | 90% | met | 0 | 0 | 2 |
| Free vs. Paid leads | 30 | 1 | 29 of 29 | 100% | met | 0 | 1 | 3 |
| Last Few Days, reels lane | 224 | 53 | 171 of 171 | 100% | met | 0 | 0 | 6 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |

Legacy stories the intake did not hand over:

- Morning Download, reels side: "Data centers are turning to old jet engines as the wait for power grows"; "Those Jeff Bezos hair transplant photos are very fake"
- Guess the Number (shortlist + The Number): "Palantir AI tech unused or little used by 29 NHS trusts said to be benefiting f…"; "Midterm elections 2026: all the news"

Intake-only stories marked "other":

- Morning Download, reels side: "Datacentres are deeply unpopular – so the geniuses at OpenAI are rebranding the…"; "OpenAI Wants to Change the Name of Data Centers to the Stupidest Thing You’ve E…"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "Datacentres are deeply unpopular – so the geniuses at OpenAI are rebranding the…"; "Chip Maker Marvell Agrees to Buy Lumentum in $80 Billion Deal"
- Free vs. Paid leads: "Introducing Zero Wire, a hub for investigating critical Internet vulnerabilities"; "expo/skills: A collection of AI agent skills for working with Expo projects and…"; "pbakaus/impeccable: The design vocabulary for your coding agent. Steer with pol…"
- Last Few Days, reels lane: "Datacentres are deeply unpopular – so the geniuses at OpenAI are rebranding the…"; "OpenAI Wants to Change the Name of Data Centers to the Stupidest Thing You’ve E…"; "Ubuntu still has not released patch for Linux 0day RCE in almost 3 weeks"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "thedotmack/claude-mem: Persistent Context Across Sessions for Every Agent – Ca…"; "pingdotgg/t3code"

## Builder bar calibration

The builder score (story-builder@2) rates stories about people making or finding something that pushes limits. Today's bar is 0.6. 269 replayed stories carry a builder score. The 30 highest:

| # | Headline | Builder | Major news | Event date | Source |
|---|---|---|---|---|---|
| 1 | An AI Tool Scanned the Biomedical Literature and Found an Off-the-Shelf Drug for a Baby's… | 0.90 | 0.34 | 2026-11-04 | Claude web search (search) |
| 2 | Writing seen in PHerc. 306B, for the first time in 2000 years | 0.87 | 0.38 | 2026-11-02 | Hacker News (reels) |
| 3 | Blind Egyptian Student's Self-Taught AI App Now Helps Thousands of Blind Users 'See' the … | 0.85 | 0.35 | 2026-11-03 | Claude web search (search) |
| 4 | A Fake Kidnapping Call Powered by AI Voice Cloning Fooled Her Grandfather, So She Built a… | 0.82 | 0.44 | 2026-10-29 | Claude web search (search) |
| 5 | Man Whose Mother Vanished in 2007 Builds AI Tool Now Used to Reopen Cold Cases, Including… | 0.80 | 0.24 | 2026-11-04 | Claude web search (search) |
| 6 | Show HN: Subvocal – Talk to your computer without making noise | 0.78 | 0.49 | 2026-11-02 | Hacker News (reels) |
| 7 | Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations | 0.77 | 0.24 | 2026-09-15 | Hacker News (reels) |
| 8 | The Grid, a factory-scale robot in Massachusetts that builds PCBs on demand | 0.76 | 0.60 | 2026-10-26 | Hacker News (reels) |
| 9 | 42AI comes out of stealth with $62.5M and a world model that can ‘predict human behavior’ | 0.75 | 0.60 | 2026-11-02 | TechCrunch (reels) |
| 10 | Qwenputer: A functioning, deterministic RISC-V CPU inside Qwen3.5 | 0.70 | 0.58 | 2026-10-29 | Hacker News (reels) |
| 11 | Arizona Court Orders New Sentencing After AI Video of Dead Man Swayed the Judge | 0.68 | 0.68 | 2026-11-03 | Claude web search (search) |
| 12 | PhotoGuider: Composition-Aware Cropping and 360^{circ} View Framing with Explainable Phot… | 0.68 | 0.49 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 13 | MoviEdit: Long-form Multi-Shot Video Editing Made Easy | 0.67 | 0.55 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 14 | OmniShowcase: Omnidirectional Subject-Consistent Video Generation from Multi-View Images | 0.67 | 0.52 | 2026-10-26 | Hugging Face Daily Papers (reels) |
| 15 | Trajectory raises $45M to make AI model training accessible to nontechnical experts | 0.66 | 0.61 | 2026-11-02 | TechCrunch (reels) |
| 16 | ruvnet/RuView: π RuView turns commodity WiFi signals into real-time spatial intelligence,… | 0.66 | 0.40 | 2026-10-29 | GitHub Trending (reels) |
| 17 | JustVugg/colibri: Run frontier MoE models on hardware you already own — pure C, zero deps… | 0.66 | 0.40 | 2026-11-02 | GitHub Trending (reels) |
| 18 | Words Caught in the Heart: Simulating Person-Specific Expression for Self-Opaque Clients … | 0.65 | 0.44 | 2026-10-31 | Hugging Face Daily Papers (reels) |
| 19 | Efficient Streaming Audio-Visual Target Speaker Extraction for Real-World Acoustic Scenes | 0.64 | 0.56 | 2026-10-23 | Hugging Face Daily Papers (reels) |
| 20 | VibeVideoBench: Evaluating Multimodal Agents on Code-Driven Video Generation | 0.63 | 0.58 | 2026-10-27 | Hugging Face Daily Papers (reels) |
| 21 | Robots strut their stuff, race up sacred China mountain | 0.63 | 0.53 | 2026-11-02 | CBS News (reels) |
| 22 | karpathy/nanochat: The best ChatGPT that $100 can buy. | 0.62 | 0.51 | 2026-09-07 | GitHub Trending (reels) |
| 23 | RoboColosseum: Evaluating Physical Intelligence at Scale In-The-Wild | 0.62 | 0.57 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 24 | SpecPilot: Autonomous Algorithm Discovery and Systems Optimization for Speculative Decodi… | 0.62 | 0.54 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 25 | Binance says fake job interviews used as part of $6.3bn crypto hack | 0.62 | 0.52 | 2026-11-03 | BBC News (reels) |
| 26 | Can Discrete Tokens Serve as Semantically Lossless Representations of Visual Signals? | 0.61 | 0.51 | 2026-10-27 | Hugging Face Daily Papers (reels) |
| 27 | Y Combinator’s Garry Tan uses AI agents so much, he spends up to $200K a year on tokens | 0.61 | 0.16 | 2026-11-03 | TechCrunch (reels) |
| 28 | Venus-DefakerOne2: A Vision-Forensics Foundation Model with Broader Coverage | 0.61 | 0.53 | 2026-10-27 | Hugging Face Daily Papers (reels) |
| 29 | OSWAM: An Effective World Action Model with One-Step Action Generation | 0.60 | 0.52 | 2026-10-26 | Hugging Face Daily Papers (reels) |
| 30 | GLOW-FM: Efficient Generative Low-Light Image Enhancement with One-Step Latent Flow Match… | 0.60 | 0.48 | 2026-10-22 | Hugging Face Daily Papers (reels) |

### Last Few Days lineups, nights after 2026-11-01 through 2026-11-04

The six slides the picker would choose from the intake at three builder bars (no seeds). Leads come first by how far they clear their bar; major news is capped at 3, builders are not.
Previous posts: the 2 Last Few Days post(s) before 2026-11-04 (newest 2026-11-03), read only from lfd.posts; their stories are skipped and the newest one's are checked for repeats. Archived keys and seeds are not read.

**Bar 0.5**: 5 of 6 slides are builder stories (83%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | builder | An AI Tool Scanned the Biomedical Literature and Found an Off-the-Shelf Drug for a Baby's… | 0.90 | 0.34 | reels |
| 2 | builder | Writing seen in PHerc. 306B, for the first time in 2000 years | 0.87 | – | reels |
| 3 | builder | Blind Egyptian Student's Self-Taught AI App Now Helps Thousands of Blind Users 'See' the … | 0.85 | 0.35 | reels |
| 4 | builder | Man Whose Mother Vanished in 2007 Builds AI Tool Now Used to Reopen Cold Cases, Including… | 0.80 | 0.24 | reels |
| 5 | major | Google is entirely disabling Search in schools that don’t want AI | 0.22 | 0.84 | reels |
| 6 | builder | Show HN: Subvocal – Talk to your computer without making noise | 0.78 | – | reels |

**Bar 0.6**: 3 of 6 slides are builder stories (50%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | builder | An AI Tool Scanned the Biomedical Literature and Found an Off-the-Shelf Drug for a Baby's… | 0.90 | 0.34 | reels |
| 2 | major | Google is entirely disabling Search in schools that don’t want AI | 0.22 | 0.84 | reels |
| 3 | builder | Writing seen in PHerc. 306B, for the first time in 2000 years | 0.87 | – | reels |
| 4 | builder | Blind Egyptian Student's Self-Taught AI App Now Helps Thousands of Blind Users 'See' the … | 0.85 | 0.35 | reels |
| 5 | major | Hiding inside Palantir’s skyrocketing quarter is a foreboding signal | 0.58 | 0.79 | reels |
| 6 | major | Anthropic is working on a system to prove AI models’ identity | 0.51 | 0.78 | reels |

**Bar 0.7**: 3 of 6 slides are builder stories (50%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | Google is entirely disabling Search in schools that don’t want AI | 0.22 | 0.84 | reels |
| 2 | major | Hiding inside Palantir’s skyrocketing quarter is a foreboding signal | 0.58 | 0.79 | reels |
| 3 | major | Anthropic is working on a system to prove AI models’ identity | 0.51 | 0.78 | reels |
| 4 | builder | An AI Tool Scanned the Biomedical Literature and Found an Off-the-Shelf Drug for a Baby's… | 0.90 | 0.34 | reels |
| 5 | builder | Writing seen in PHerc. 306B, for the first time in 2000 years | 0.87 | – | reels |
| 6 | builder | Blind Egyptian Student's Self-Taught AI App Now Helps Thousands of Blind Users 'See' the … | 0.85 | 0.35 | reels |

### Morning Download: builder stories taken per night

Morning Download takes up to 5 leads, at most 2 of them builders. Each cell: builders taken / leads chosen (pool size).

| Night | Bar 0.5 | Bar 0.6 | Bar 0.7 |
|---|---|---|---|
| 2026-10-29 | 1 / 5 (25) | 0 / 5 (25) | 0 / 5 (25) |
| 2026-11-03 | 2 / 5 (21) | 1 / 5 (21) | 0 / 5 (21) |
| 2026-11-04 | 2 / 5 (19) | 2 / 5 (19) | 1 / 5 (19) |

## Cost and runtime

Jev spend $0.1838 over 1333 calls (cap $0.25). Runtime 0.8 minutes.

| Step | Calls | USD |
|---|---|---|
| reels-score (pass 1) | 271 | $0.0854 |
| reels-score (pass 2) | 207 | $0.0305 |
| major-news | 271 | $0.0263 |
| story-builder | 271 | $0.0252 |
| Grouping: same-event pair checks | 246 | $0.0137 |
| LFD lineup: same-event checks | 48 | $0.0019 |
| Grouping: story merge checks | 19 | $0.0008 |

Cache hits: 0 scores reused (reels-score: 271 scored, 0 reused; major-news: 271 scored, 0 reused; story-builder: 271 scored, 0 reused), 227 grouping decisions reused.
