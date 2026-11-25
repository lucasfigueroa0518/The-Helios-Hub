# Field Notes contract v4 (2026-11-06): audience/content foundation + plain design and copy
Replaces CONTRACT-v3.md entirely. CONTRACT-v2.md stays in force where v4 says nothing. Every decision here is in PLAN.md, sections dated 2026-11-06 ("Pivot" through "new process approved"), with Tommy's words quoted. One build covers both halves.

## 0. Rules for every owner
- No commits, no git branch or worktree actions, no live Claude/`web_search`/Jev calls, no DB writes outside PGlite tests, no worker deploys. Free plain HTTP fetches are allowed only for owner E's source verification.
- Prompt-review lens on every prompt change: altitude (class of behavior, not named tools or topics), **no example copy and no example tool names in any prompt**, no contradictions, single ownership, strength matches intent.
- Prompt caching stays as built (`lib/anthropic-cache.ts`): stable prefix first, breakpoint on the last stable block, never on the per-request tips payload.
- Rename nothing in section 1 without asking the lead. One owner per file (section 6). Report: files changed, exact exported API, tests run and results, anything unverified.

## 1. Shared names (lead writes these in `lib/field-notes/types.ts` and `lib/field-notes/write/types.ts` before builders start)

```ts
// The content tree (PLAN "content tree approved"). Rule: what the viewer is pointed at.
export const CONTENT_LEAVES = [
  'repo_free_alternative', // free alternative to a paid service
  'repo_data',             // datasets, scrapers, curated data
  'repo_mcp',              // open-source MCP servers and connectors
  'repo_agent_runtime',    // agent frameworks, local models and runners
  'repo_automation',       // automation and workflow tools
  'repo_memory',           // memory and knowledge tools
  'skill',                 // agent skills
  'coding_agent_feature',  // features of paid coding agents
  'llm_app_feature',       // features of paid chat apps
  'technique',             // tool-agnostic prompting and workflow practice, cited sources only
] as const;
export type ContentLeaf = (typeof CONTENT_LEAVES)[number];

// The wants tree. Rule: the benefit the viewer gets. One primary want per tip.
export const WANTS = ['faster', 'better', 'newly_possible', 'stay_current', 'cheaper'] as const;
export type Want = (typeof WANTS)[number];
/** Starting weights (Tommy: Stay current at half); performance data replaces them later (not built now). */
export const WANT_WEIGHTS: Record<Want, number> = { faster: 1, better: 1, newly_possible: 1, cheaper: 1, stay_current: 0.5 };

// The who tree. Lower third is never a tag: it is scored out (soft score, section 3).
export const KNOW_HOW_TIERS = ['middle', 'higher'] as const;
export type KnowHowTier = (typeof KNOW_HOW_TIERS)[number];
export const PURPOSES = ['professional', 'hobbyist', 'personal', 'builder'] as const;
export type Purpose = (typeof PURPOSES)[number];
```

`Tip` changes: remove `branch` and `levels`; add `leaf: ContentLeaf | null`, `want: Want | null`, `tier: KnowHowTier | null`, `purposes: Purpose[]`, `fresh: boolean`. Null means not yet tagged. `AUDIENCE_LEVELS`, `AudienceLevel`, `TIP_BRANCHES`, `TipBranch` are deleted.

Slide changes: `MARK_KINDS`, `MarkKind`, `Mark` and `Slide.marks` are deleted. `BLOCK_ROLES = ['headline', 'body', 'hand']` (`hand` = Hershey Sans, cover and Follow only; replaces `eyebrow`). `TextFill` stays (`white` default). `Block.darken` stays (the per-photo overlay strength).

`DraftSlide` = `{ kind: 'tip'; headline; solves; how; tipId }` (the `emphasis` field is deleted). The Writer's input tip carries `want`.

## 2. Schema (owner D, `db/field_notes_schema.sql`, idempotent, applied to PGlite in tests only)
- `ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS` `leaf text`, `want text`, `tier text`, `purposes text[] NOT NULL DEFAULT '{}'`, `fresh boolean NOT NULL DEFAULT false`, each text column with a named CHECK listing exactly the section 1 values (or NULL), added inside the same `DO $$ ... pg_constraint` guard pattern the file already uses.
- `branch` becomes nullable (`ALTER COLUMN branch DROP NOT NULL`); nothing writes it any more. `levels` is left in place, unread. No data backfill (Rule 2: nothing sweeps existing rows).
- Applying this to the real DB is the lead's job and needs Tommy's go-ahead at the time.

## 3. Score and tag (owner D: `sources/questions.ts`, `score.ts`, `config.ts`, `candidate.ts`, `select.ts`)
- Question set `field-notes-score`, version `field-notes-score@1-draft`. Wording is a draft: Tommy approves it on Lucas's behalf before `questionsApproved` turns true. Keep `questionsApproved: false`.
- Scored (`noul`): `lesser_known`, `concrete_result`, `single_subject` (wording kept), and new `past_basics`: is it useful to someone past the basics of AI tools, rather than only to a beginner (the soft lower-third test).
- Tags (`choice`, one call with the scored questions): `leaf` (the 10 leaves, each option described by the leaf's rule, no example tools), `want` (the 5 wants, each described by its value-line shape in section 4), `tier` (`middle` | `higher`).
- Tags (`noul`, threshold 0.5): one per purpose: `for_professional`, `for_hobbyist`, `for_personal`, `for_builder`.
- `new_enough` stays as a `noul` but sets `fresh` (>= 0.5) and **does not count toward the score**.
- Score = mean of the four scored answers x `WANT_WEIGHTS[want]`. `ScoredCandidate` gains `leaf`, `want`, `tier`, `purposes`, `fresh`.
- Selection (`selectTips`): as now (distinct subjects, highest score, newest tie-break), plus: at most 2 tips with the same want on one post; when scores tie within 0.05, prefer the want used least in the last 7 posts (`recentWants` input). Expiry counts from `firstSeenAt` (when we found it), never from the source's publish date, so evergreen tips are not expired for being old.
- Seeded tips (paste-a-link) carry the seeder's `leaf` and `want` (section 5); scoring may still tag `tier`, `purposes`, `fresh` when it runs.

## 4. Writer and Editor (owner B: `lib/field-notes/write/**` except `types.ts`)
- Remove everything about emphasis (prompt, parse, `cleanEmphasis`, Editor's emphasis handling, caps).
- Each tip slide: `headline` = the thing's real name; `solves` = what it is and why it matters, written in the shape of the tip's primary want; `how` = exact usage as the source states it. About 35 words per slide (TIP_SLIDE_CAPS unchanged). Render shows them as one block, so they must read as one paragraph: headline line, then solves and how as continuous sentences.
- Value-line shapes, stated as classes in the prompt (no examples): Faster names the task and the effort it removes; Better names the weak output and what improves; Newly possible names what the reader could not do and now can; Stay current names what changed and what to do differently now; Cheaper names the paid thing it replaces and what it costs instead. A tip with `want: null` gets a plain problem-it-solves line.
- Reader: strangers past the basics of AI tools; no assumption that they know Helios; never explain what an AI model or chat app is.
- Caption: same rule set as now, minus anything about emphasis; no Helios assumptions.
- Unchanged: one call for 3-4 tips, skipped tips never padded, Editor cut-only (code enforced), gates (fact check, repeat, overrun > 50% hard), soft notes to review.

## 5. Sources, seed and review UI (owner E)
- `sources/registry.ts`: replace each source's `branch` with `leaves: ContentLeaf[]` (what it mainly feeds; informational only, the tip is still tagged by scoring). Add verified sources for the thin leaves: open-source MCP servers, technique (vendor prompting guides), free alternatives to paid services, data repos. **Add a source only after a real fetch shows the page exists, is official or primary, and carries usable dated or listed entries;** record `verifiedOn` and what was seen. Unverifiable candidates go in the report, not the registry.
- `store.ts` mapping for the old kind-to-branch defaults is deleted (owner D owns `store.ts`; E tells D the shape it needs).
- Seed API (`app/api/field-notes/seed/**`) and seed form: replace the branch input with two required selects, leaf and want (labels in plain words, from section 1).
- Review panel (`components/field-notes/**`): each tip slide shows its leaf, want and tier as small plain labels; the Follow handle and photo UI unchanged.

## 6. Render (owner C: `lib/field-notes/render/**`, `lib/field-notes/post.ts`)
- **Delete** arrows, circles, underlines, emphasis rendering, multi-region packing and calm-region hunting as the primary placement (`pack.ts`, `marks.ts`, and any of `regions.ts` nothing else needs).
- **Fonts:** Pragmatica Extended Bold (headline), Roboto (body, light or regular per the brand rules), bundled locally as now. Kalam, Caveat and Patrick Hand files are removed from `render/assets/fonts`.
- **Hershey Sans** for `hand` blocks: port the glyph data from `explainers/world-kit/hershey-sans.js` into `render/` with its attribution header intact (public-domain glyphs, MIT conversion), plus a static version of `handwrite()` from `explainers/world-kit/draw.js` (round-capped even pen line, the kit's wobble frozen at a fixed seed). Draw as inline SVG. Do not import from `explainers/` at runtime (the social worker may not ship it).
- **Tip slide:** one block, left-aligned text, headline on top then one body paragraph, placed prominently in the middle of the slide. It may shift vertically into clearly calmer space nearby (within about 15% of the canvas height) only when the center is clearly busier; nothing else creative. Text is large and prominent; minimum type sizes as now.
- **Contrast:** white text by default; darken the photo gently behind and around the block (feathered, not a box), raising `darken` in steps until the block passes the readability check against the darkened background, plus a faint text shadow. If it cannot pass at `darkenCap`, the slide fails with the existing photo-swap reason so the run's swap loop retries (rename the reason only if C updates every reader and the tests).
- **Cover:** `hand` line "field notes" (fixed, code-written) above the Pragmatica cover headline (`N AI tips to try`, unchanged); the block moves above or below the detected faces, never over them; `cover_no_face` unchanged.
- **Follow:** one `hand` line (fixed code-written placeholder, clearly marked, Tommy picks the wording at samples) plus the follow handle, centered, same contrast treatment.
- `draftToSlideInputs` maps the new `DraftSlide` (no emphasis).
- Re-render the sample sheet in the scratchpad (`fn2/out/sheet-v4.jpg`) from existing local photos and fixed placeholder copy, clearly marked; report the path. No model calls.

## 7. Ownership
| Owner | Files |
|---|---|
| Lead | `lib/field-notes/types.ts`, `lib/field-notes/write/types.ts`, `lib/field-notes/EXPORTS.md`, PLAN/contract docs |
| B Writer | `lib/field-notes/write/**` (not `types.ts`), `tests/field-notes-write.test.ts`, `tests/fixtures/field-notes/write/**`, and any fixture that builds a `DraftSlide` |
| C Render | `lib/field-notes/render/**`, `lib/field-notes/post.ts`, `tests/field-notes-render.test.ts`, `tests/fixtures/field-notes/render/**` |
| D Pipeline | `lib/field-notes/sources/**` except `registry.ts` and `docs-adapter.ts`; `lib/field-notes/{run,store,live,worker,settings}.ts`; `db/field_notes_schema.sql`; `tests/field-notes-{sources,run,worker-wiring}.test.ts`, `tests/fixtures/field-notes/run/**` |
| E Sources + UI | `lib/field-notes/sources/{registry,docs-adapter}.ts`, `app/api/field-notes/seed/**`, `app/api/field-notes/settings/**`, `components/field-notes/**`, `tests/field-notes-ui.test.ts` |

## 8. Acceptance (pass/fail, per owner)
- All: `npx tsc --noEmit` clean for files you own; `npx tsx --test tests/field-notes-*.test.ts` passes for your tests; no reference left to a deleted name in your files.
- B: prompt contains the five value-line shapes as classes, no example copy or tool names, no emphasis; parse rejects/ignores an `emphasis` field; a test per want shows the want reaches the prompt payload; caching breakpoint unchanged.
- C: no arrows, marks or packing in output; tip block is left-aligned and centered by default; a test with a bright busy photo shows `darken` rising until the check passes; a cover test shows the block not overlapping any face box; Hershey renders for `hand`; sample sheet path reported.
- D: schema applies twice on PGlite without error; CHECKs reject an unknown leaf/want/tier; score test: `stay_current` scores half of an identical `faster` tip; `new_enough` changes `fresh` but not the score; selection test: never 3 of one want on a post, expiry ignores publish date; seeded tip keeps the seeder's leaf and want.
- E: every new registry entry has `verifiedOn` and a one-line note of what the fetch showed; seed API rejects a missing or unknown leaf/want; review panel test shows the three labels.
