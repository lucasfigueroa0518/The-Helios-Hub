# Ranking prompt audit (2026-11-22) — example pollution + contradictions

Scope: the prompts that pick and order stories for MD and LFD. Writing/photo prompts are round 2 (D3).
Severity: **H** = steers or blocks what the ranker picks; **M** = biases it; **L** = style.

## Example pollution
| # | Prompt | Problem | Sev |
|---|---|---|---|
| P1 | major-news@3 `blockbuster_entity` (lib/stories/questions.ts) | A named roster of companies and people earns points. Incumbent names win whatever the story is about, and the roster is in-domain by definition. | H |
| P2 | major-news@3 `news_kind` | A whitelist of six kinds of news (model release, big-company announcement, government, tech advance, business move, product update). Anything else (science, culture, strange consumer uses, people stories) fails, so many "cool" stories score low. | H |
| P3 | lfd-lead@1 `human_drama` | Lists "an arrest, a firing, a lawsuit, a government demand, a leak, a public fight". This steers the lead slide toward scandal. | H |
| P4 | md-development@1 `new_event` | Lists "action, decision, disclosure, ruling, result or change of role". It steers toward corporate/legal turns, and any one of them passes. | M |
| P5 | major-news@3 `happened` | Lists 11 event kinds (release, announcement, launch, deal, filing, ruling, vote…). It is also the gate D10 loosens. | M |
| P6 | lfd-lead@1 `routine` | Lists "hiring numbers, an office or lab opening, earnings guidance…". | L |

## Contradictions
| # | Between | Conflict | Sev |
|---|---|---|---|
| C1 | major-news `blockbuster_entity` ↔ story-builder `routine_launch` | One rewards a story about a big company and the other penalizes a big company's launch. The same story gains in one lane and loses in the other, and `leadOf` then merges both lanes into one queue. | H |
| C2 | lfd-lead `human_drama` (leak, lawsuit, arrest score) ↔ story-builder `made_or_found` ("a failure, breach, leak, misuse or harm does not count") | LFD rewards harm and scandal for the lead slide that MD's builder lane excludes. | H |
| C3 | md-final-rank@1 ↔ Lucas's ranking goal | It orders by "most annoyed to have missed", which is loss-averse, not "most interesting / worth knowing". | H |
| C4 | md-final-rank@1 audience ("an informed follower of AI news") ↔ D8 (broad general public) | The audience is narrower than ours. | M |
| C5 | md-final-rank@1 `we_already_said` ("rank on what is new since then") ↔ D11 | Repeats should be decided upstream by the massive-development gate. The ranker shouldn't re-weigh them. | M |
| C6 | major-news `speculative` (subtracts points) + `happened` gate ↔ D10 | These block forecasts, demos and claims that Lucas now wants allowed. | H |
| C7 | lfd-lead `talked_about` + final-rank `big_outlets` ↔ "interesting" goal | Both reward what is already widely covered (consensus), not what is interesting. Keep it as a signal; it shouldn't drive the order. | M |
| C8 | md-final-rank@1 framing ("the day's major AI news") ↔ cool + need-to-know | "Major" pulls toward importance and away from interest. | M |

## Nits
- N1: Every Jev question repeats the UNTRUSTED sentence (single ownership). It's harmless, but it belongs in the state or a shared preface.

## Disposition
The lab's variants (`cool-valuable@1`, `scalar@1`, `final-interesting@1`) are written to avoid P1–P6 and C1–C8. Fixes to the production prompts wait for the lab result (D12): the winning variant replaces these, so we don't patch them twice.
