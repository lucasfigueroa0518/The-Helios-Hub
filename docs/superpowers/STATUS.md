# Helios Social rebuild: STATUS

**Updated:** 2026-10-07, after image strategy (a) and (b) were built and benched.
Claude keeps this page current after every step.

- **Authorities:** the spec (`specs/2026-10-01-helios-social-rebuild.md`), the plan (`plans/2026-10-04-helios-social-rebuild.md`, M8 link map and exit criteria) and the prompts file (`specs/2026-10-04-helios-social-prompts.md`).
- **Tests:** 214 social tests pass. The full suite's only failure is the known reels-visual venv test.

## Link map (M8)

| Link | Status |
|---|---|
| Reporter → Editor → Fact-checker | **Accepted, frozen** |
| Renderer mechanics (text fit, bounds, contrast, faces clear, framing with no bands, rotation) | **Accepted, frozen**. New since: the logo-card cover layout, which passes the render check. |
| **(A) Writer IMAGE requests** | Built, checked by offline tests only. |
| **(B) Photo finder: stock** | Bench passes the bar except **R23**: an abstract fractal for "abstract neural network". Tommy to decide whether it's a finder miss or a request problem (link A). Not yet marked accepted. |
| **(B) Photo finder: official images (a)** | **Built; off until Tommy approves allow-list rows** (all 8 TBD). |
| **(B) Photo finder: logo cards (b)** | **Built and on.** |
| **(C) Renderer visuals** | Waiting for Tommy and Lucas to review fixed posts, especially text-only slides and the new logo card. |
| Hook pass (separate track) | Built and tested on saved drafts and one PREVIEW run. On only with `--hook`; not wired into the daily default. |

**(A) in detail:** the default is a photo; SUBJECTS carry `photo_available`; failing article photos are hidden from the Writer; a stock request must name a physical thing on the slide; quote slides take the speaker or none; article photos go only on text, landing and image slides; words never change to fit a photo; every check runs on every attempt, and a request still failing on the final attempt becomes `none` (logged as `image-request-dropped`).

**(B) stock chain:** Openverse → Jev pre-screen v4 (fit and people) → a Haiku vision check on the top 3 candidates.
- **The vision check rejects:** anything that doesn't show the thing, a main-subject person or recognizable face, a landmark, a prominent outside logo, and a named institution.
- **Official images only:** banners are rejected too.
- **Starter fallback:** covers only, AI-compute photos only.
- **No repeats:** no photo repeats within a run.

**Hook pass prompt:** no example line, keeps hedges word for word, why-it-matters rests on FACTS only.

**No end-to-end runs until A, B and C each pass**, then the M8 acceptance batch (2 fresh runs, 4 posts).

## Decisions since the checkpoint (2026-10-06 → 07)
- **Design is tested one link at a time on fixed inputs.**
  - The photo-finder bench: 44 requests (`fixtures/social/photo-bench`), frozen Openverse results, Jev and vision only.
  - Pass bar: 0 misleading photos and every miss explained; the hit rate is tracked, not required.
- **Photo finder:**
  - Face crops fill the frame (the face takes at most about 40% of the window height), never bands.
  - The stock pre-screen went v3 → v4 (fit and people only).
  - The vision check was added (Haiku 4.5, its own model setting), with a named-institution question and, for official images, a banner question.
  - The cover fallback uses AI-compute starter photos only.
  - No repeat photos within a run.
- **Writer and the checks:**
  - The Writer handoff rules above.
  - C8 counts only NUMBERS values.
  - Aggregator-only facts are removed and logged.
  - `fillDraft` no longer gives an unattributed quote to the first subject.
- **Image strategy (spec §5.1, agreed direction):** stock becomes the last fallback. The order is (a) official images, (b) logo cover cards, (c) Commons category photos, (d) charts from NUMBERS, (e) social-post screenshots. No AI imagery that looks real.
  - Cover order: official image → subject P18 → logo card → stock → starter.
  - A person's own cover request keeps their photo first.
- **Hook pass:** the prompt edits above; the Fact-checker checks hook lines first for types 1 and 4–5; it runs only via `--hook`.
- **PREVIEW runs:** labelled in `run.json`, and they don't write the used-photo log.

## Open items
- **Tommy:**
  - Approve allow-list rows: domains and editorial-use terms. The table is below.
  - Decide the R23 question.
  - Decide the logo aspect limit: Anthropic's wordmark (800×90) is past the 6:1 limit, so Anthropic covers get no logo card.
  - Seed the photo bank.
- **Lucas:** review text-only slides, the logo card, and the Hook pass content and look (PREVIEW run, `runs/daily-2026-10-07T03-45-32-722Z`).
- **Not built yet:** image strategy (c), (d) and (e).
- **After A, B and C pass:** the M8 acceptance batch.

### Official-images allow-list (`lib/social/photos/official.ts`): every row TBD

| Company | Proposed domains | Editorial use | Approved |
|---|---|---|---|
| Anthropic | anthropic.com, claude.com | TBD | no |
| OpenAI | openai.com | TBD | no |
| Google | google.com, blog.google, deepmind.google, googleblog.com, abc.xyz | TBD | no |
| Meta | meta.com, about.fb.com, ai.meta.com | TBD | no |
| Microsoft | microsoft.com, blogs.microsoft.com, news.microsoft.com | TBD | no |
| Nvidia | nvidia.com, nvidianews.nvidia.com, blogs.nvidia.com | TBD | no |
| Mistral AI | mistral.ai | TBD | no |
| xAI | x.ai | TBD | no |

Subdomains count (e.g. support.google.com, workspace.google.com).
