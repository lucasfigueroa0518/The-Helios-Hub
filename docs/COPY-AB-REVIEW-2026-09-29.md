# Copy A/B review: fact-first Writer + Editor (2026-09-29)

Hand-scored by reading each slide against its brief. Source files: `Claude outputs/copy-ab/<slug>/summary.txt`. Fact-checker was not run, so accuracy notes below are my reading only.

Legend: **New** = tells the reader something the cover and earlier slides didn't · **Repeat** = restates the cover or an earlier slide · **Off-story** = about a different event, beyond the context policy.

## Headline result

| Post | Old version: repeats | New version: repeats | New facts gained |
|---|---|---|---|
| Gottheimer | 2 of 7 slides (+1 logistics) | **0 of 7** | Voluntary review becomes law; the banking/food/medicine comparison; both co-sponsors; the DeepSeek ban it extends |
| Google CC | ~0.5 of 10 | 1 partial of 7 | Tighter post: same facts in 7 slides instead of 10 |
| Suleyman | n/a (different brief) | 1 of 8 (+1 off-story) | Code requirements, the feedback period |
| Newsom | n/a | 1 of 7 (+2 off-story by the policy's letter) | Four proposals, federal obstacle |

**The fact-first outline fixes the problem Lucas named.** Gottheimer went from the headline repeated across 3 slides to 7 slides that each add something, including the single most important fact the old version lost (the bill turns a voluntary process into law).

## Gottheimer

| # | Kind | New information | Verdict |
|---|---|---|---|
| Cover | | Two bipartisan AI security bills | News |
| 2 | text | Bill 1: mandatory NSA review, 30 days + extension, co-led with Lawler | New |
| 3 | quote | Why: the banking / food / medicine comparison, bioweapons, power grid | New. **319 chars (limit 140)** |
| 4 | text | Current review is voluntary (June 2026 order); this makes it law | **New, and the key fact.** Headline tripped the "X, not Y" regex, but the contrast is in the source |
| 5 | text | Bill 2: ban on Chinese open-weight models, co-led with LaLota | New. "Code is publicly available" drifts from TERMS ("parameters") |
| 6 | quote | Kimi K3 and Qwen named | New. **Not word for word:** the source says "other Chinese open-weight models, like Moonshot's Kimi K3 and Alibaba's Qwen, are still walking..." |
| 7 | text | Extends the existing DeepSeek ban | New. **"In 2025" is not in the sources** (they say the fiscal-2026 defense bill) |
| 8 | text | Leadership refused a vote; call to reconvene | New |

## Google CC

| # | Kind | New information | Verdict |
|---|---|---|---|
| Cover | | Personal assistant → whole household | News |
| 2 | text | Why: top user request (Tom Shane quote) | New |
| 3 | stat | 6 members; U.S. adults with personal Gmail | New |
| 4 | text | Three ways to share | New |
| 5 | text | Daily "Your Day Ahead" brief, shared calendar | New |
| 6 | text | Actions: forms, lists, meal plans, drive times | New |
| 7 | text | Kids and school accounts locked out | **Partial repeat of S3's note.** The repetition check caught it; drop the eligibility note from S3 |
| 8 | text | How to get it | New |

Dropped from the old version: privacy guardrails, how it works (Gemini, Antigravity), competitors. The privacy point is the only real loss. Five text slides run in a row (see decision 2).

## Suleyman (brief covers several stories, from before the Reporter narrowing fix)

| # | Kind | New information | Verdict |
|---|---|---|---|
| Cover | | Rulebook + Anthropic called a safety threat | News (still two announcements) |
| 2 | text | Dates; framed as one intervention | **Repeat of cover** (check caught it) |
| 3 | text | What the Code requires | New |
| 4 | quote | The charge against Anthropic | New |
| 5 | text | The circular loop | New |
| 6 | quote | "May well be impossible" to control | New. 142 chars (limit 140) |
| 7 | text | Hugging Face incident, 1,200 agents | **Off-story:** a whole slide on another company's event. Breaks the new context policy |
| 8 | text | Anthropic hasn't replied | New. The check wrongly flagged it as a repeat of S2 |
| 9 | text | Six-week feedback, final version by year end | New |

The remaining problems come from the brief, which combined several stories. A narrowed brief would give a clean essay-only post.

## Newsom

| # | Kind | New information | Verdict |
|---|---|---|---|
| Cover | | Kill-switch order; 2-month deadline | News |
| 2 | text | July incident that triggered it | New, but **a whole slide on an earlier event** |
| 3 | text | The four proposals | New |
| 4 | landing | A kill switch isn't a button; it's lab protocols | New. **Note 94 chars (limit 60)** |
| 5 | stat | 2 months | **Repeat of the cover.** The check missed it (reworded) |
| 6 | quote | Newsom: federal "abject failure" | New |
| 7 | text | Trump's December 2025 order blocking states | New, but **a whole slide on an earlier event** by another party |
| 8 | text | California rules could become the standard | New. "Both San Francisco AI companies" isn't in the sources |

Unused: SB 813 and AB 1405, the two state laws this order builds on. They're more on-story than slides 2 and 7.

## What still needs fixing

1. **Lengths don't converge.** Six fields are still over their limit after repair, including quotes (319, 142) and a note (94). One Haiku repair round isn't enough, and the Haiku pass *restored* the 319-character quote. → Put length repairs on Sonnet and make them field-scoped (audit recs 3 and 7). Also re-check that quote and note lengths are validated at the outline stage, since these got through.
2. **Accuracy slips** (the fact-checker would catch most of them): a spliced quote (Gottheimer S6), an unsourced year (S7), an unsourced "San Francisco" (Newsom S8).
3. **The repetition check is useful but not enough.** It caught 2 real repeats, flagged 1 slide wrongly and missed 1 (Newsom S5). Keep it soft, and rely on the new fact-checker line for the semantic judgment.
4. **The unused-facts list is unreliable.** Google CC marks Q1 unused (it's the cover) and misses the privacy question. Match on slide assignment from the outline, not text.

## Decisions for Tommy

1. **Where's the line on context?** Newsom S2 (the triggering incident) and S7 (Trump's order), and Suleyman S7 (Hugging Face), each spend a whole slide on another event. The policy as written allows one clause. Options: keep it strict (one clause only), or allow **one** "why now" or "what stands in the way" slide per post, sourced.
2. **Rhythm.** With rhythm soft, posts run 3–5 text slides in a row. Every slide now has a point, but visually it's more uniform. Options: keep it soft and get variety from design (concept images on text slides, alternating layouts) rather than from filler kinds; or make it hard again and accept some filler.
