# Central intake replay, 2026-11-07 to 2026-11-09

Generated 2026-11-10 03:51 UTC. A dry run: the new central intake was fed the stories the old pipelines saw on these nights, in a throwaway in-memory copy. Nothing was written to the real database and nothing was posted.

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
| Guess the Number (shortlist + The Number) | 18 | 3 | 15 of 15 | 100% | met | 0 | 0 | 4 |
| Free vs. Paid leads | 30 | 1 | 27 of 29 | 93% | met | 0 | 0 | 3 |
| Last Few Days, reels lane | 248 | 167 | 81 of 81 | 100% | met | 0 | 0 | 13 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | not available (feeds not stored for this night) | | | | | | | |

Legacy stories the intake did not hand over:

- Free vs. Paid leads: "Panthera: Ampere's CPU Performance Model"; "Behind the Blog: Dam's Bursting"

Intake-only stories marked "other":

- Morning Download, reels side: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "China reportedly recruited AI exec to spy on Jensen Huang"; "I toured Unitree's factory. I'm more bullish on the West"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Guess the Number (shortlist + The Number): "Show HN: I made an open-source laptop from scratch"; "AI could transform mathematics, but humans will still need to be in the loop"; "GitHub's new Git storage architecture"; "Show HN: I 3D scanned the interior of the Great Pyramid at Giza"
- Free vs. Paid leads: "Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations"; "Towards Foundation Decision Models: Drex"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "US tech stock rout: is the AI bubble bursting?"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; "Meet *sshole, the vulnerability that lets hackers SSH into Linux devices"; and 5 more

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
- Guess the Number (shortlist + The Number): "Lanarkshire AI datacentre to fully rely on National Grid despite renewables cla…"; "I toured Unitree's factory. I'm more bullish on the West"; "Ramp data shows AI spending stalling just as Anthropic nears its IPO"; "All the latest updates on AI data centers"; "Data centers are unpopular — and a key motor of economic growth"; "Free Chinese AI Models Are Getting Scary Good at Hacking"
- Free vs. Paid leads: "stanford-crfm/helm: Holistic Evaluation of Language Models (HELM) is an open so…"; "Show HN: Tmux-restore saves tmux windows and agent sessions across reboots"; "prometheus/prometheus: The Prometheus monitoring system and time series databas…"; "symfony/symfony: The Symfony PHP framework"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "OpenAI Hears Voters’ Overwhelming Rebuke To Data Centers, Vows to Build More of…"; "China reportedly recruited AI exec to spy on Jensen Huang"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "US tech stock rout: is the AI bubble bursting?"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; and 7 more

### 2026-11-09

Stored 53 reels items, 4 web-search finds and 52 feed articles (of 399 fetched; 342 published after that night's intake were left out, the rest filtered by the intake's window and code filters); 6 links seen on an earlier night were not stored again. Grouping made 87 stories, joined 22 items to existing ones and merged 7 pairs of stories.

| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |
|---|---|---|---|---|---|---|---|---|
| Morning Download, reels side | 13 | 0 | 13 of 13 | 100% | met | 0 | 0 | 1 |
| Morning Download, carousel side | 0 | 0 | 0 of 0 | n/a | n/a | 6 | 0 | 1 |
| Guess the Number (shortlist + The Number) | 18 | 2 | 12 of 16 | 75% | **missed** | 6 | 0 | 8 |
| Free vs. Paid leads | 30 | 0 | 27 of 30 | 90% | met | 0 | 0 | 6 |
| Last Few Days, reels lane | 186 | 0 | 186 of 186 | 100% | met | 0 | 0 | 15 |
| Last Few Days, carousel lane | 0 | 0 | 0 of 0 | n/a | n/a | 0 | 0 | 0 |
| Last Few Days, fresh feed lane | 20 | 0 | 20 of 20 | 100% | met | 5 | 0 | 0 |

Legacy stories the intake did not hand over:

- Guess the Number (shortlist + The Number): "The Last Mile to the Real World: Agent-Native Primitives as Reusable Building B…"; "NPCBench: A Clinical Apprenticeship Benchmark for Multimodal Care-Pathway Reaso…"; "Multi-layer Indexer: Overlapping Selection and Attention in DeepSeek Sparse Att…"; "FAA announces first US digital air traffic control towers in Florida and Alaska"
- Free vs. Paid leads: "Ask HN: How do you manage your AI agents' context across clients and projects?"; "NYT Cooking’s AI assistant saved my weeknight chicken, but almost ruined my cake"; "SAE Interprets MoE: Sparse AutoEncoders Reveal That MoE Experts Exhibit Human-I…"

Intake-only stories marked "other":

- Morning Download, reels side: "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"
- Morning Download, carousel side: "OpenAI CEO Sam Altman lands $1.25 trillion price as Anthropic IPO buyers eye $1…"
- Guess the Number (shortlist + The Number): "OpenAI CEO Sam Altman lands $1.25 trillion price as Anthropic IPO buyers eye $1…"; "The Qlobe: Rotating Quine (2010)"; "Lanarkshire AI datacentre to fully rely on National Grid despite renewables cla…"; "SwarmEvolve: Latent Agent Swarms for Evolutionary Discovery and Optimization"; "StepX-OPD: Rethinking Multi-Teacher On-Policy Distillation in Diffusion Models"; "Muir: Linear Attention with Sensitivity-Allocated Gating and Matched-Filter Rea…"; "Future Representation Distillation for Imagination-free World Action Models"; "AI Companies Really, Really Want to Buy Your Work Files and Emails"
- Free vs. Paid leads: "Multi-layer Indexer: Overlapping Selection and Attention in DeepSeek Sparse Att…"; "The Last Mile to the Real World: Agent-Native Primitives as Reusable Building B…"; "TaoMate-HD: Progressive-Resolution Autoregressive Audio-Video Generation"; "Tools Need Not Speak in Text: Latent Context Compression for Agents"; "prometheus/prometheus: The Prometheus monitoring system and time series databas…"; "symfony/symfony: The Symfony PHP framework"
- Last Few Days, reels lane: "“Does Meta think we can’t read?” Meta abandons sketchy commercial terms update."; "OpenAI Hears Voters’ Overwhelming Rebuke To Data Centers, Vows to Build More of…"; "Show HN: Gemini Pro 3 imagines the HN front page 10 years from now"; "google/skills: Agent Skills for Google products and technologies"; "US tech stock rout: is the AI bubble bursting?"; "Show HN: I replaced a $120k bowling center system with $1,600 in ESP32s"; "mattpocock/skills: Skills for Real Engineers. Straight from my .agents director…"; "Show HN: I made an open-source laptop from scratch"; and 7 more

## Builder bar calibration

The builder score (story-builder@2) rates stories about people making or finding something that pushes limits. Today's bar is 0.65. 234 replayed stories carry a builder score. The 30 highest:

| # | Headline | Builder | Major news | Event date | Source |
|---|---|---|---|---|---|
| 1 | Show HN: An e-ink frame that hears birds and draws them as 1800s illustrations | 0.76 | 0.25 | 2026-09-15 | Hacker News (reels) |
| 2 | Underdog shows off a 32MB speech model in new demo | 0.69 | 0.55 | 2026-11-06 | TechCrunch (reels) |
| 3 | TaoMate-HD: Progressive-Resolution Autoregressive Audio-Video Generation | 0.64 | 0.52 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 4 | Towards Real-Time Full-Waveform LiDAR Transformers via Intensity-Guided Token Reduction a… | 0.64 | 0.53 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 5 | FAA announces first US digital air traffic control towers in Florida and Alaska | 0.62 | 0.67 | 2026-11-07 | The Guardian (reels) |
| 6 | LiveFoley: Dynamic Real-Time Video-to-Audio Generation for Immersive Interactive Worlds | 0.62 | 0.50 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 7 | AgentBaton: Efficient Model Collaboration in Agentic Tasks | 0.62 | 0.47 | 2026-10-25 | Hugging Face Daily Papers (reels) |
| 8 | SwarmEvolve: Latent Agent Swarms for Evolutionary Discovery and Optimization | 0.62 | 0.53 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 9 | PyRUA-REAL: Robot Exploration and Adaptive Learning through RSI in the Real World | 0.61 | 0.51 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 10 | Video-Coder: Reinforcing Agentic Coding for Video Generation | 0.61 | 0.51 | 2026-11-06 | Hugging Face Daily Papers (reels) |
| 11 | NPCBench: A Clinical Apprenticeship Benchmark for Multimodal Care-Pathway Reasoning in Na… | 0.61 | 0.55 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 12 | Tools Need Not Speak in Text: Latent Context Compression for Agents | 0.60 | 0.50 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 13 | Can AI really save you money on your heating bill? I spent two years testing to find out | 0.60 | 0.23 | 2026-11-07 | The Guardian (reels) |
| 14 | SAE Interprets MoE: Sparse AutoEncoders Reveal That MoE Experts Exhibit Human-Interpretab… | 0.60 | 0.53 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 15 | Physicl raises $10M to make the digital world real enough for robots | 0.60 | 0.61 | 2026-11-06 | TechCrunch (reels) |
| 16 | The Last Mile to the Real World: Agent-Native Primitives as Reusable Building Blocks for … | 0.60 | 0.51 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 17 | LLMs Don't Know What They Know: Benchmarking Temporal Self-Knowledge for Financial Backte… | 0.59 | 0.51 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 18 | EvoWorld: Towards Out-of-Sight World Evolution in Generative Video Models | 0.59 | 0.46 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 19 | Terminal-style Mathematical Modeling Bench: The First Agentic and Verifiable Benchmark fo… | 0.59 | 0.55 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 20 | The SIMPLE Law for Energy Cost of LLM Inference | 0.59 | 0.47 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 21 | HeLM: Hierarchical Explicit Language Memory for Non-Markovian Manipulation | 0.59 | 0.50 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 22 | Towards Foundation Decision Models: Drex | 0.59 | 0.57 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 23 | South Korea's SeAH Besteel Builds AI Safety Solution on 6 Million Steel-Site Data Points,… | 0.58 | 0.55 | 2026-11-09 | BigGo Finance (feeds) |
| 24 | Future Representation Distillation for Imagination-free World Action Models | 0.58 | 0.49 | 2026-11-04 | Hugging Face Daily Papers (reels) |
| 25 | EvoMemState: Evolving Memory State for Personal Agents | 0.57 | 0.46 | 2026-11-02 | Hugging Face Daily Papers (reels) |
| 26 | Muir: Linear Attention with Sensitivity-Allocated Gating and Matched-Filter Readout | 0.57 | 0.55 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 27 | StepX-OPD: Rethinking Multi-Teacher On-Policy Distillation in Diffusion Models | 0.57 | 0.48 | 2026-11-03 | Hugging Face Daily Papers (reels) |
| 28 | ranxianglei/billion-context: A context-compression plugin for month-long single sessions … | 0.57 | 0.36 | 2026-11-08 | GitHub Trending (reels) |
| 29 | EDGAR: Efficient Diffusion-Driven Gaussian Avatar Refinement via Synthetic Failure | 0.56 | 0.43 | 2026-11-05 | Hugging Face Daily Papers (reels) |
| 30 | VFlash: Fast, Accurate Visual Planning via Flash Primitive Decoding | 0.56 | 0.50 | 2026-11-05 | Hugging Face Daily Papers (reels) |

### Last Few Days lineups, nights after 2026-11-06 through 2026-11-09

The six slides the picker would choose from the intake at three builder bars (no seeds). Leads come first by how far they clear their bar; major news is capped at 3, builders are not.
Previous posts: the 2 Last Few Days post(s) before 2026-11-09 (newest 2026-11-06), read only from lfd.posts; their stories are skipped and the newest one's are checked for repeats. Archived keys and seeds are not read.

**Bar 0.5**: 3 of 6 slides are builder stories (50%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.35 | 0.91 | reels |
| 2 | major | Nvidia Board to Probe Spying Case After CEO Jensen Huang Admits Infidelity | 0.44 | 0.78 | feed |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.42 | 0.76 | reels |
| 4 | builder | Can AI really save you money on your heating bill? I spent two years testing to find out | 0.60 | 0.23 | reels |
| 5 | builder | South Korea's SeAH Besteel Builds AI Safety Solution on 6 Million Steel-Site Data Points,… | 0.58 | 0.55 | feed |
| 6 | builder | Apple’s grey list: Words and phrases your iPhone won’t help you spell | 0.55 | – | reels |

**Bar 0.6**: 0 of 6 slides are builder stories (0%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.35 | 0.91 | reels |
| 2 | major | Nvidia Board to Probe Spying Case After CEO Jensen Huang Admits Infidelity | 0.44 | 0.78 | feed |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.42 | 0.76 | reels |
| 4 | rundown | Mamdani Blasts Google for Using Monopoly to Bully Schools That Ban AI | 0.14 | 0.69 | reels |
| 5 | rundown | AI is dramatically accelerating AI research | 0.28 | 0.27 | reels |
| 6 | rundown | OpenAI's robots got into a closed link shortener, surfed the web with Google Docs and Tra… | 0.52 | 0.59 | reels |

**Bar 0.7**: 0 of 6 slides are builder stories (0%).

| Slot | Lane | Headline | Builder | Major news | From |
|---|---|---|---|---|---|
| 1 | major | OpenAI valued at $1.25 trillion, as rival Anthropic nears its IPO | 0.35 | 0.91 | reels |
| 2 | major | Nvidia Board to Probe Spying Case After CEO Jensen Huang Admits Infidelity | 0.44 | 0.78 | feed |
| 3 | major | The US let Nvidia sell chips to an empty office in China | 0.42 | 0.76 | reels |
| 4 | rundown | Mamdani Blasts Google for Using Monopoly to Bully Schools That Ban AI | 0.14 | 0.69 | reels |
| 5 | rundown | AI is dramatically accelerating AI research | 0.28 | 0.27 | reels |
| 6 | rundown | OpenAI's robots got into a closed link shortener, surfed the web with Google Docs and Tra… | 0.52 | 0.59 | reels |

### Morning Download: builder stories taken per night

Morning Download takes up to 5 leads, at most 2 of them builders. Each cell: builders taken / leads chosen (pool size).

| Night | Bar 0.5 | Bar 0.6 | Bar 0.7 |
|---|---|---|---|
| 2026-11-07 | 0 / 5 (17) | 0 / 5 (17) | 0 / 5 (17) |
| 2026-11-08 | 0 / 5 (16) | 0 / 5 (16) | 0 / 5 (16) |
| 2026-11-09 | 1 / 5 (21) | 0 / 5 (21) | 0 / 5 (21) |

## Cost and runtime

Jev spend $0.2540 over 2703 calls (cap $1.00). Runtime 1.7 minutes.

| Step | Calls | USD |
|---|---|---|
| reels-score (pass 1) | 207 | $0.0658 |
| story-scoring | 233 | $0.0259 |
| major-news | 241 | $0.0231 |
| story-builder | 241 | $0.0221 |
| reels-score (pass 2) | 142 | $0.0212 |
| Grouping: same-event pair checks | 362 | $0.0188 |
| LFD lineup: same-event checks | 91 | $0.0029 |
| Grouping: story merge checks | 27 | $0.0012 |

Cache hits: 1 scores reused (reels-score: 207 scored, 1 reused; story-scoring: 233 scored, 0 reused; major-news: 241 scored, 0 reused; story-builder: 241 scored, 0 reused), 305 grouping decisions reused.


## Phase 2 comparisons

### Phase 2: Reels

| run | legacy in scope | matched | overlap | ≥ 80% | legacy only (first 5) |
|---|---|---|---|---|---|
| 2026-11-07 | 10 | 7 | 70% | FAIL | ‘Total repudiation’: The blue wave is about to hit AI; Stocks plunge as election outcome and AI worries crush tech shares; Data centers lost the midterms |
| 2026-11-08 | 10 | 7 | 70% | FAIL | Standing in the way of slop bowls: the woman blocking food delivery robots; AI Godfather Says to Get Ready for a Chernobyl-Style “Blackout” Caused by AI; Data centers lost the midterms |
| 2026-11-09 | 11 | 6 | 55% | FAIL | LLMs Don't Know What They Know: Benchmarking Temporal Self-Knowledge for Financial Backtesting; RIP, Harvest; Goldman Sachs is pulling Claude Code from its bankers and traders; Unlocking any car from X brand in most of the world; ‘AI clog’: UK public bodies battle onslaught of chatbot-generated complaints |

2026-11-07 misses:
- ‘Total repudiation’: The blue wave is about to hit AI (legacy net 3.24): intake rank 12 of 94, net 3.13
- Stocks plunge as election outcome and AI worries crush tech shares (legacy net 3.23): intake rank 12 of 94, net 3.13
- Data centers lost the midterms (legacy net 3.22): intake rank 12 of 94, net 3.13

2026-11-08 misses:
- Standing in the way of slop bowls: the woman blocking food delivery robots (legacy net 3.32): intake rank 11 of 154, net 3.30
- AI Godfather Says to Get Ready for a Chernobyl-Style “Blackout” Caused by AI (legacy net 3.24): intake rank 14 of 154, net 3.24

2026-11-09 misses:
- LLMs Don't Know What They Know: Benchmarking Temporal Self-Knowledge for Financial Backtesting (legacy net 2.53, selected): intake rank 54 of 111, net 2.28
- RIP, Harvest (legacy net 3.25): intake rank 16 of 111, net 3.25
- Goldman Sachs is pulling Claude Code from its bankers and traders (legacy net 3.24): intake rank 17 of 111, net 3.24
- Unlocking any car from X brand in most of the world (legacy net 3.18): intake rank 19 of 111, net 3.19
- ‘AI clog’: UK public bodies battle onslaught of chatbot-generated complaints (legacy net 3.18): intake rank 20 of 111, net 3.14

### Phase 2: Carousel

| run | legacy in scope | matched | overlap | ≥ 80% | legacy only (first 5) |
|---|---|---|---|---|---|
| 2026-10-26 carousel 4484a96d | 24 | 21 | 88% | pass | Hunting for AI gains outside Magnificent 7 - Semafor; OpenAI resumes training AI, but without Internet - Taipei Times; Anthropic is pitching Congress its own AI safety bill, report says - Mashable |
| 2026-10-28 carousel 96e59afc | 25 | 22 | 88% | pass | American AI billionaire Dario Amodei and fellow Anthropic founders each worth $13 billion - Billionaires.Africa; Anthropic says energy difficulties could slow down the AI buildout - Semafor; Anthropic Appears to Be the First Company to Go Public by Warning That It May Destroy Humankind |

### Phase 2: Field Notes

| run | legacy in scope | matched | overlap | ≥ 80% | legacy only (first 5) |
|---|---|---|---|---|---|
| 2026-11-08 Field Notes 5f5e1721 (0 left for a later run) | 10 | 10 | 100% | pass |  |
| 2026-11-08 Field Notes 507583fd (21 left for a later run) | 10 | 9 | 90% | pass | cathrynlavery/diagram-design |
| 2026-11-08 Field Notes 95693f1a (0 left for a later run) | 10 | 9 | 90% | pass | Claude Code 2.1.318 (November 4, 2026): [Cloud sessions] Added the usual Chrome names to cloud sessions, so tools other  |
