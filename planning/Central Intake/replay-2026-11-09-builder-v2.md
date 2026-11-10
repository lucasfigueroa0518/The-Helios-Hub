# Central intake replay, 2026-11-07 to 2026-11-09

Generated 2026-11-10 00:00 UTC. A dry run: the new central intake was fed the stories the old pipelines saw on these nights, in a throwaway in-memory copy. Nothing was written to the real database and nothing was posted.

## How to read this

- **Legacy** is what each content type read on that night from the old pipelines. **Intake** is what it would read from the central intake.
- A legacy story counts as **matched** when its article sits inside a story the intake hands to the same content type. The ship target is **80% or more** per content type per night.
- **Outside the replay** means the legacy story's article came from a night before the replay started (or after that night), so the intake could not have it. Those are left out of the percentage.
- **Intake only** splits into: new because the carousel is off (feed stories the old path no longer reads), builder leads (stories that clear the builder bar), and other.
- The carousel has been switched off since 2 November, so legacy carousel lists are mostly empty; feed stories the intake adds there are expected.
- The news feeds are not stored, so they were fetched once today and added only to the newest night (2026-11-09). Older nights have no feed stories on either side.

## Coverage by night

### 2026-11-07

Stored 111 reels items, 2 web-search finds and 0 feed articles; 1 links seen on an earlier night were not stored again. Grouping made 96 stories, joined 17 items to existing ones and merged 2 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 17 | 4 | 13 of 13 | 100% | met | 0 | 0 | 4 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Guess the Number (shortlist + The Number) | 18 | 3 | 14 of 15 | 93% | met | 0 | 0 | 3 |
| Free vs. Paid leads | 30 | 1 | 27 of 29 | 93% | met | 0 | 0 | 3 |
| Last Few Days, reels lane | 248 | 167 | 81 of 81 | 100% | met | 0 | 0 | 13 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | not available (feeds not stored for this night) | | | | | | | |

Legacy stories the intake did not hand over:

- Guess the Number (shortlist + The Number): "Free Chinese AI Models Are Getting Scary Good at Hacking"
- Free vs. Paid leads: "A Jev that can ask Opus for help gives Opus accuracy at 4x lower cost"; "Behind the Blog: Dam's Bursting"

Intake-only stories marked "other":

- Morning Download, reels side: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "I toured Unitree's factory. I'm more bullish on the West"; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "Show HN: I made an open-source laptop from scratch"; "GitHub's new Git storage architecture"; "Show HN: I 3D scanned the interior of the Great Pyramid at Giza"
- Free vs. Paid leads: "Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "Towards Foundation Decision Models: Drex"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "AI stocks climb after trillions wiped from market values"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; "Meet *sshole, the vulnerability that lets hackers SSH into Linux devices"; and 5 more

### 2026-11-08

Stored 63 reels items, 2 web-search finds and 0 feed articles; 10 links seen on an earlier night were not stored again. Grouping made 60 stories, joined 5 items to existing ones and merged 0 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 14 | 1 | 13 of 13 | 100% | met | 0 | 0 | 3 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Guess the Number (shortlist + The Number) | 17 | 2 | 14 of 15 | 93% | met | 0 | 0 | 6 |
| Free vs. Paid leads | 30 | 1 | 29 of 29 | 100% | met | 0 | 0 | 4 |
| Last Few Days, reels lane | 234 | 95 | 139 of 139 | 100% | met | 0 | 0 | 15 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | not available (feeds not stored for this night) | | | | | | | |

Legacy stories the intake did not hand over:

- Guess the Number (shortlist + The Number): "FAA announces first US digital air traffic control towers in Florida and Alaska"

Intake-only stories marked "other":

- Morning Download, reels side: "OpenAI Hears Voters’ Overwhelming Rebuke To Data Centers, Vows to Build More of…"; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "Lanarkshire AI datacentre to fully rely on National Grid despite renewables cla…"; "I toured Unitree's factory. I'm more bullish on the West"; "Ramp data shows AI spending stalling just as Anthropic nears its IPO"; "All the latest updates on AI data centers"; "Data centers are unpopular — and a key motor of economic growth"; "OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO"
- Free vs. Paid leads: "Show HN: Tmux-restore saves tmux windows and agent sessions across reboots"; "Voice Chat with Agents"; "prometheus/prometheus: The Prometheus monitoring system and time series databas…"; "symfony/symfony: The Symfony PHP framework"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "OpenAI Hears Voters’ Overwhelming Rebuke To Data Centers, Vows to Build More of…"; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "AI stocks climb after trillions wiped from market values"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; and 7 more

### 2026-11-09

Stored 53 reels items, 4 web-search finds and 55 feed articles (of 376 fetched; 315 published after that night's intake were left out, the rest filtered by the intake's window and code filters); 6 links seen on an earlier night were not stored again. Grouping made 88 stories, joined 24 items to existing ones and merged 6 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 13 | 0 | 13 of 13 | 100% | met | 0 | 0 | 1 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 8 | 0 | 1 |
| Guess the Number (shortlist + The Number) | 18 | 2 | 12 of 16 | 75% | **missed** | 8 | 1 | 7 |
| Free vs. Paid leads | 30 | 0 | 28 of 30 | 93% | met | 0 | 1 | 4 |
| Last Few Days, reels lane | 186 | 0 | 186 of 186 | 100% | met | 0 | 0 | 15 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | 20 | 0 | 20 of 20 | 100% | met | 1 | 0 | 0 |

Legacy stories the intake did not hand over:

- Guess the Number (shortlist + The Number): "The Last Mile to the Real World: Agent-Native Primitives as Reusable Building B…"; "NPCBench: A Clinical Apprenticeship Benchmark for Multimodal Care-Pathway Reaso…"; "Multi-layer Indexer: Overlapping Selection and Attention in DeepSeek Sparse Att…"; "FAA announces first US digital air traffic control towers in Florida and Alaska"
- Free vs. Paid leads: "Ask HN: How do you manage your AI agents' context across clients and projects?"; "SAE Interprets MoE: Sparse AutoEncoders Reveal That MoE Experts Exhibit Human-I…"

Intake-only stories marked "other":

- Morning Download, reels side: "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Morning Download, carousel side: "OpenAI CEO Sam Altman lands $1.25 trillion price as Anthropic IPO buyers eye $1…"
- Guess the Number (shortlist + The Number): "OpenAI CEO Sam Altman lands $1.25 trillion price as Anthropic IPO buyers eye $1…"; "Beneath the Surface: What We Overlook When We Talk About Agent Evolution"; "The Qlobe: Rotating Quine (2010)"; "Lanarkshire AI datacentre to fully rely on National Grid despite renewables cla…"; "StepX-OPD: Rethinking Multi-Teacher On-Policy Distillation in Diffusion Models"; "Muir: Linear Attention with Sensitivity-Allocated Gating and Matched-Filter Rea…"; "Future Representation Distillation for Imagination-free World Action Models"
- Free vs. Paid leads: "Multi-layer Indexer: Overlapping Selection and Attention in DeepSeek Sparse Att…"; "The Last Mile to the Real World: Agent-Native Primitives as Reusable Building B…"; "prometheus/prometheus: The Prometheus monitoring system and time series databas…"; "symfony/symfony: The Symfony PHP framework"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "OpenAI Hears Voters’ Overwhelming Rebuke To Data Centers, Vows to Build More of…"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "google/skills: Agent Skills for Google products and technologies"; "AI stocks climb after trillions wiped from market values"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; and 7 more

## Builder bar calibration

The builder score (story-builder@2) rates stories about people making or finding something that pushes limits. Today's bar is 0.6. 236 replayed stories carry a builder score. The 30 highest:

| # | Headline | Builder | Major news | Event date | Source |
|---|---|---|---|---|---|
| 1 | Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations | 0.76 | 0.27 | 2026-09-15 | Hacker News (reels) |
| 2 | Underdog shows off a 32MB speech model in new demo | 0.69 | 0.54 | 2026-11-06 | TechCrunch (reels) |
| 3 | Towards Real-Time Full-Waveform LiDAR Transformers via Intensity-Guided Token Reduction a… | 0.65 | 0.53 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 4 | TaoMate-HD: Progressive-Resolution Autoregressive Audio-Video Generation | 0.64 | 0.52 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 5 | PyRUA-REAL: Robot Exploration and Adaptive Learning through RSI in the Real World | 0.63 | 0.52 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 6 | LiveFoley: Dynamic Real-Time Video-to-Audio Generation for Immersive Interactive Worlds | 0.63 | 0.50 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 7 | SwarmEvolve: Latent Agent Swarms for Evolutionary Discovery and Optimization | 0.62 | 0.53 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 8 | FAA announces first US digital air traffic control towers in Florida and Alaska | 0.62 | 0.67 | 2026-11-07 | The Guardian (reels) |
| 9 | AgentBaton: Efficient Model Collaboration in Agentic Tasks | 0.62 | 0.47 | 2026-10-25 | Hugging Face Daily Papers (reels) |
| 10 | Tools Need Not Speak in Text: Latent Context Compression for Agents | 0.61 | 0.49 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 11 | EvoWorld: Towards Out-of-Sight World Evolution in Generative Video Models | 0.61 | 0.48 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 12 | SAE Interprets MoE: Sparse AutoEncoders Reveal That MoE Experts Exhibit Human-Interpretab… | 0.60 | 0.54 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 13 | Video-Coder: Reinforcing Agentic Coding for Video Generation | 0.60 | 0.51 | 2026-11-06 | Hugging Face Daily Papers (reels) |
| 14 | NPCBench: A Clinical Apprenticeship Benchmark for Multimodal Care-Pathway Reasoning in Na… | 0.60 | 0.55 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 15 | LLMs Don't Know What They Know: Benchmarking Temporal Self-Knowledge for Financial Backte… | 0.59 | 0.51 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 16 | Can AI really save you money on your heating bill? I spent two years testing to find out | 0.59 | 0.24 | 2026-11-07 | The Guardian (reels) |
| 17 | The SIMPLE Law for Energy Cost of LLM Inference | 0.59 | 0.48 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 18 | HeLM: Hierarchical Explicit Language Memory for Non-Markovian Manipulation | 0.59 | 0.51 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 19 | The Last Mile to the Real World: Agent-Native Primitives as Reusable Building Blocks for … | 0.59 | 0.51 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 20 | South Korea's SeAH Besteel Builds AI Safety Solution on 6 Million Steel-Site Data Points,… | 0.59 | 0.54 | 2026-11-09 | BigGo Finance (feeds) |
| 21 | Terminal-style Mathematical Modeling Bench: The First Agentic and Verifiable Benchmark fo… | 0.58 | 0.56 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 22 | Towards Foundation Decision Models: Drex | 0.58 | 0.57 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 23 | Physicl raises $10M to make the digital world real enough for robots | 0.58 | 0.61 | 2026-11-06 | TechCrunch (reels) |
| 24 | Future Representation Distillation for Imagination-free World Action Models | 0.58 | 0.49 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 25 | Open-HumanScale: An Open Recipe for Scaling Human and Robot Experience for Embodied Found… | 0.58 | 0.59 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 26 | EvoMemState: Evolving Memory State for Personal Agents | 0.58 | 0.46 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 27 | Frontier3DBench: Benchmarking Coding Agents for 3D Creation across Objects, Scenes, and I… | 0.58 | 0.57 | 2026-11-06 | Hugging Face Daily Papers (reels) |
| 28 | Muir: Linear Attention with Sensitivity-Allocated Gating and Matched-Filter Readout | 0.58 | 0.54 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 29 | VFlash: Fast, Accurate Visual Planning via Flash Primitive Decoding | 0.57 | 0.51 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 30 | NitroFusion2: Bringing Adversarial Loss to the Text Stream of Multimodal Diffusion Transf… | 0.57 | 0.50 | 2026-11-03 | Hugging Face Daily Papers (reels) |

### Last Few Days lineups, nights after 2026-11-06 through 2026-11-09

The six slides the picker would choose from the intake at three builder bars (no seeds). Leads come first by how far they clear their bar; major news is capped at 3, builders are not.
Previous posts: the 2 Last Few Days post(s) before 2026-11-09 (newest 2026-11-06), read only from lfd.posts; their stories are skipped and the newest one's are checked for repeats. Archived keys and seeds are not read.

**Bar 0.5**: 3 of 6 slides are builder stories (50%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.34 | 0.91 | reels |
| 2 | major | Anthropic’s IPO Is Cratering | 0.36 | 0.74 | reels |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.41 | 0.74 | reels |
| 4 | builder | Can AI really save you money on your heating bill? I spent two years testing to find out | 0.59 | – | reels |
| 5 | builder | South Korea's SeAH Besteel Builds AI Safety Solution on 6 Million Steel-Site Data Points,… | 0.59 | 0.54 | feed |
| 6 | builder | Apple’s grey list: Words and phrases your iPhone won’t help you spell | 0.56 | – | reels |

**Bar 0.6**: 0 of 6 slides are builder stories (0%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.34 | 0.91 | reels |
| 2 | major | Anthropic’s IPO Is Cratering | 0.36 | 0.74 | reels |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.41 | 0.74 | reels |
| 4 | rundown | China reportedly recruited AI exec to spy on Jensen Huang | 0.38 | 0.56 | reels |
| 5 | rundown | Mamdani Blasts Google for Using Monopoly to Bully Schools That Ban AI | 0.14 | 0.68 | reels |
| 6 | rundown | AI is dramatically accelerating AI research | 0.27 | 0.25 | reels |

**Bar 0.7**: 0 of 6 slides are builder stories (0%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.34 | 0.91 | reels |
| 2 | major | Anthropic’s IPO Is Cratering | 0.36 | 0.74 | reels |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.41 | 0.74 | reels |
| 4 | rundown | China reportedly recruited AI exec to spy on Jensen Huang | 0.38 | 0.56 | reels |
| 5 | rundown | Mamdani Blasts Google for Using Monopoly to Bully Schools That Ban AI | 0.14 | 0.68 | reels |
| 6 | rundown | AI is dramatically accelerating AI research | 0.27 | 0.25 | reels |

### Morning Download: builder stories taken per night

Morning Download takes up to 5 leads, at most 2 of them builders. Each cell: builders taken / leads chosen (pool size).

| Night | Bar 0.5 | Bar 0.6 | Bar 0.7 |
|---|---|---|---|
| 2026-11-07 | 0 / 5 (17) | 0 / 5 (17) | 0 / 5 (17) |
| 2026-11-08 | 0 / 5 (16) | 0 / 5 (16) | 0 / 5 (16) |
| 2026-11-09 | 0 / 5 (23) | 0 / 5 (23) | 0 / 5 (23) |

## Cost and runtime

Jev spend $0.1588 over 1362 calls (cap $0.30). Runtime 1.5 minutes.

| Step | Calls | USD |
|---|---|---|
| reels-score (pass 1) | 207 | $0.0657 |
| major-news | 243 | $0.0232 |
| story-builder | 243 | $0.0222 |
| reels-score (pass 2) | 139 | $0.0207 |
| Grouping: same-event pair checks | 357 | $0.0186 |
| story-scoring | 40 | $0.0039 |
| LFD lineup: same-event checks | 98 | $0.0030 |
| Grouping: story merge checks | 35 | $0.0015 |

Cache hits: 1 scores reused (reels-score: 207 scored, 1 reused; story-scoring: 40 scored, 0 reused; major-news: 243 scored, 0 reused; story-builder: 243 scored, 0 reused), 300 grouping decisions reused.
