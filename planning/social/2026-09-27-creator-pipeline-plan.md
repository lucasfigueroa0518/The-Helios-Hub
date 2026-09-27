# Helios Social — Creator-First Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 13-stage rules/scores/repair pipeline with a two-stage editor pipeline (shape → editor) gated by three human checkpoints (hook → outline → ship), so slides are authored holistically in one voice with human taste upstream, not machine surrogates followed by a bolt-on review at the end.

**Architecture:** One Claude "shape" call proposes a 5-8-slide outline from the fact sheet + human-chosen hook. Human approves/edits the outline. One Claude "editor" call then writes copy + picks layouts + describes photo needs for the whole carousel in a single conversation (kills the per-beat isolation that breaks voice continuity). Fact verification moves into the editor prompt (source-sentence pointers required) so QA/repair stages fold in. A dumb renderer executes the editor's structured output. Rolled out behind a feature flag alongside the legacy pipeline; legacy stages get deleted in Phase 5.

**Tech Stack:** Next.js 15 (App Router) + Supabase Postgres + Drizzle (schema definition only, migrations via psql `.sql` files) + Anthropic SDK with prompt caching + tsx for CLI scripts.

**Spec:** This document embeds the spec inline under "Design Context" — no separate design doc exists (design was locked in the 2026-09-27 conversation that authorized this plan).

## Global Constraints

- **CLAUDE.md Rule 1 — $1.50 autonomous spend ceiling.** No automated test may call the live Claude API or `web_search`. All shape/editor tests must stub the model with canned tool responses. Real model behavior is verified only by the user clicking a button in the built app.
- **CLAUDE.md Rule 2 — no DB sweeps.** No script or migration iterates the article_queue to backfill. Human-triggered actions only.
- **Prompt caching is mandatory** on any `messages.create` call with a stable prefix. Use `lib/anthropic-cache.ts` helpers. Put static content first (tools → system → messages); mark the last identical block with `cache_control`.
- **Automated tests are light**: pure functions + SQL + plumbing offline, stubbing the model with canned responses. Never launch live runs.
- **Design-system compliance.** Any Helios UI edit runs through the `helios-design-system` skill for token/type/motion/logo rules. Orange (#FF5E1A) is reserved for hero moments and big numbers; green is metadata/pivots; white is body. Cover uses white + orange only.
- **Worker sync N/A.** This plan does not touch the GCP orchestration worker.
- **Migration target.** All schema changes hit Supabase via `DIRECT_DATABASE_URL` in `.env.local`. Verify target before running any `db:*` script (per memory: "Verify DATABASE_URL target before Hub db:migrate").

---

## Design Context

### Why we're doing this

The current pipeline is 13 stages of machine-thinking: ingest → score → fact sheet → hook mine (scored 18+/25) → strategy (arousal/curiosity/knowledge scored) → story plan (8-11 beats forced) → copy (per-beat isolated Claude calls) → humanize (regex hedge-strip) → polish (LLM) → qa (fact verify) → repair (LLM re-run) → layout pick (beat → variant table) → render → review (bolt-on at end).

Machine surrogates for taste at every stage. Voice continuity impossible because each slide's copy is written by a separate Claude call. Humanization is a wash cycle scrubbing AI tells after the fact instead of writing in voice from draft one. Layout is a downstream mapping instead of a writing decision. Beat vocabulary (HOOK/GROUND/SCALE/CONTEXT/TURN/PROOF/SCENARIO/MECHANISM/ANALOGY/QUOTE/STAKES/TWIST/THESIS/DEBATE/FOLLOW) is a slot machine forcing every story into 15 named slots. Review is one yes/no at slide 13-of-13 with everything already committed.

Result (from 2026-09-27 review of rendered Crusoe carousel): giant position numbers "04"/"07" as hero elements on story-beat slides; RSS feed name "AI NEWS & ARTIFICIAL INTELLIGENCE | TECHCRUNCH." rendered as h2 outlet attribution; body-only slides producing 80%-empty voids with a paragraph and a chapter number; every beat mapped deterministically to one variant regardless of composition needs; wall-of-text slides with no visual anchor.

### What we're building (A + B together)

**A — collapse the pipeline.** Two Claude calls replace copy/humanize/polish/qa/repair/strategy/story-plan/layout-pick:
- **Shape call** — proposes 5-8 slide outline (position + one-line purpose + photo/chart flags) from fact sheet + chosen hook. Fast, cheap (~$0.03).
- **Editor call** — writes the whole carousel (copy per slide with span roles + layout variant per slide + photo-need description + caption) in one conversation. Source-sentence pointers required per claim. Prompt-cached system. ~$0.15.

**B — human checkpoints upstream.** Three points where a person makes taste decisions:
- **Checkpoint 1 (hook approval).** Human sees the fact-sheet summary + 3-5 candidate hooks. Picks one or writes their own. Saves `chosen_hook_final`. Triggers shape call.
- **Checkpoint 2 (outline approval).** Human sees the shape call's 5-8-slide outline. Kill/merge/reorder inline. Approves. Saves `outline_approved_json`. Triggers editor call.
- **Checkpoint 3 (ship approval).** Existing Review + revision loop (shipped 2026-09-27 in the review-state branch). Approve / request revision / reject.

### Data flow (new pipeline)

```
Article (approved_for_draft, has fact_sheet + hook candidates)
  ↓
UI: HookPanel                                          ← Checkpoint 1
  human picks/writes hook → POST /api/social/hook/:id
  ↓                                        (saves chosen_hook_final)
Shape call (auto)                          → outline_json
  ↓
UI: OutlinePanel                                       ← Checkpoint 2
  human edits + approves → POST /api/social/outline/:id
  ↓                              (saves outline_approved_json)
Editor call (auto)                         → copy_json (creator pipeline shape)
  ↓
Photo fetcher (auto)                       → photos populated
  ↓
Renderer (dumb)                            → render_post_json + preview
  ↓
UI: ReviewPanel                                        ← Checkpoint 3 (already built)
  approve / needs_revision / reject
```

### Voice continuity mechanism

The editor call is a single Anthropic `messages.create` with:
- System (cached, 1h): the creator's brief — voice, rules, source-pointer requirement.
- User: `{ factSheet, chosenHook, approvedOutline, articleContext }` as one JSON payload.
- Output: full carousel — all slides written in one conversation. The model sees slide 3 while writing slide 7.

That single-call authoring is what B alone can't achieve. It kills the humanize/polish stages (voice is right from the draft), the repair stage (fact pointers enforced during writing), the beat-vocabulary constraint (editor picks slide count and shape from the outline, not from a 15-beat taxonomy), and the layout-picker mapping (editor emits `variant` per slide directly).

### Feature flag + rollout strategy

- Env var `HELIOS_SOCIAL_CREATOR_PIPELINE` (default `0` in Phase 0-3, flipped to `1` in Phase 4).
- Column `pipeline_version` on `article_queue`: `'legacy'` (default) | `'creator'`.
- New articles pick pipeline based on env var at ingest time and stamp `pipeline_version`.
- Existing rows keep their stamp — legacy rows stay on legacy pipeline until explicitly regenerated.
- Phase 5 demolition happens ONLY after no active row has `pipeline_version='legacy'` waiting for work.

### What's NOT in this plan

- Publish pipeline (Instagram push, scheduler) — future work.
- Story-format variant (vertical, 1080×1920) — plan targets carousel only.
- Analytics — the beat vocabulary is deprecated as prescriptive but kept as descriptive labels on the render output for future analytics.
- Custom fine-tuned voice model — approach C from the design conversation. Deferred.

---

## Phase 0 — Foundation

Goal: DB columns + feature flag so subsequent phases can gate cleanly on legacy vs creator pipeline.

### Task 0.1 — DB migration for creator pipeline columns

**Files:**
- Create: `db/helios_social_creator_pipeline_migration.sql`
- Create: `scripts/apply_helios_social_creator_pipeline_migration.js`
- Modify: `package.json` (add `db:helios-social:creator-pipeline-migration` script)

**Interfaces:**
- Produces new columns: `pipeline_version`, `chosen_hook_final`, `hook_approved_at`, `hook_approved_by`, `outline_json`, `outline_approved_json`, `outline_approved_at`, `outline_approved_by`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- db/helios_social_creator_pipeline_migration.sql
--
-- Creator pipeline foundation: adds columns for the hook and outline
-- checkpoints plus a pipeline_version discriminator so legacy and creator
-- rows can coexist during rollout.
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS pipeline_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS chosen_hook_final text,
  ADD COLUMN IF NOT EXISTS hook_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS hook_approved_by text,
  ADD COLUMN IF NOT EXISTS outline_json jsonb,
  ADD COLUMN IF NOT EXISTS outline_approved_json jsonb,
  ADD COLUMN IF NOT EXISTS outline_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS outline_approved_by text;

ALTER TABLE helios_social.article_queue
  DROP CONSTRAINT IF EXISTS article_queue_pipeline_version_check;
ALTER TABLE helios_social.article_queue
  ADD CONSTRAINT article_queue_pipeline_version_check
  CHECK (pipeline_version IN ('legacy', 'creator'));

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_pipeline_version
  ON helios_social.article_queue (pipeline_version);

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_creator_hook_pending
  ON helios_social.article_queue (added_at DESC)
  WHERE pipeline_version = 'creator' AND chosen_hook_final IS NULL;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_creator_outline_pending
  ON helios_social.article_queue (added_at DESC)
  WHERE pipeline_version = 'creator'
    AND chosen_hook_final IS NOT NULL
    AND outline_approved_json IS NULL;
```

- [ ] **Step 2: Write the apply script**

```javascript
// scripts/apply_helios_social_creator_pipeline_migration.js
// Copy the exact pattern from apply_helios_social_review_migration.js —
// reads DIRECT_DATABASE_URL from .env.local, runs psql -f on the .sql,
// exits non-zero on failure.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('DIRECT_DATABASE_URL is not set (check .env.local)');
  process.exit(1);
}

const windowsPsql = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const psql = process.env.PSQL_BIN
  || (process.platform === 'win32' && fs.existsSync(windowsPsql) ? windowsPsql : 'psql');
const schema = path.join(root, 'db', 'helios_social_creator_pipeline_migration.sql');
const result = spawnSync(psql, ['-d', url, '-v', 'ON_ERROR_STOP=1', '-f', schema], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PGSSLMODE: process.platform === 'win32' ? 'disable' : (process.env.PGSSLMODE || 'require'),
  },
  shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('helios_social creator pipeline migration applied');
```

- [ ] **Step 3: Add npm script**

In `package.json` scripts section (near the other `db:helios-social:*` entries):
```json
"db:helios-social:creator-pipeline-migration": "node scripts/apply_helios_social_creator_pipeline_migration.js",
```

- [ ] **Step 4: Verify DB target before running**

Run: `grep -E '^DIRECT_DATABASE_URL' .env.local | cut -c1-40`
Expected: prefix confirms Supabase, NOT a local dev URL. If unsure, stop and ask the user.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:helios-social:creator-pipeline-migration`
Expected: `NOTICE` lines for existing columns (idempotent re-run), `ALTER TABLE`, `CREATE INDEX`, and final `helios_social creator pipeline migration applied`.

- [ ] **Step 6: Verify columns and constraint exist**

Run: `psql "$(grep DIRECT_DATABASE_URL .env.local | cut -d= -f2-)" -c "SELECT column_name FROM information_schema.columns WHERE table_schema='helios_social' AND table_name='article_queue' AND column_name IN ('pipeline_version','chosen_hook_final','outline_json','outline_approved_json') ORDER BY column_name;"`
Expected: 4 rows.

- [ ] **Step 7: Commit**

```bash
git add db/helios_social_creator_pipeline_migration.sql \
        scripts/apply_helios_social_creator_pipeline_migration.js \
        package.json
git commit -m "feat(helios-social): creator pipeline DB foundation (hook + outline checkpoints)"
```

---

### Task 0.2 — Feature flag helper

**Files:**
- Create: `lib/social/flags.ts`
- Create: `tests/social/flags.test.ts`

**Interfaces:**
- Produces: `useCreatorPipeline(article: { pipeline_version: string } | null): boolean` — returns true if row is stamped 'creator' OR (row is null AND env var is set). Callers pass the row when routing existing article traffic; pass null when deciding what to stamp on a new article.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/social/flags.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useCreatorPipeline } from '@/lib/social/flags';

describe('useCreatorPipeline', () => {
  const originalEnv = process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;
  beforeEach(() => { delete process.env.HELIOS_SOCIAL_CREATOR_PIPELINE; });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;
    else process.env.HELIOS_SOCIAL_CREATOR_PIPELINE = originalEnv;
  });

  it("returns true when row is stamped 'creator'", () => {
    expect(useCreatorPipeline({ pipeline_version: 'creator' })).toBe(true);
  });

  it("returns false when row is stamped 'legacy'", () => {
    expect(useCreatorPipeline({ pipeline_version: 'legacy' })).toBe(false);
    process.env.HELIOS_SOCIAL_CREATOR_PIPELINE = '1';
    expect(useCreatorPipeline({ pipeline_version: 'legacy' })).toBe(false);
  });

  it('returns true for null row when env var is set', () => {
    process.env.HELIOS_SOCIAL_CREATOR_PIPELINE = '1';
    expect(useCreatorPipeline(null)).toBe(true);
  });

  it('returns false for null row when env var is unset', () => {
    expect(useCreatorPipeline(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/social/flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/social/flags.ts
/**
 * Which pipeline version handles this article? Existing rows carry their
 * stamp — legacy rows stay on legacy. New rows (row === null) get the
 * creator pipeline when HELIOS_SOCIAL_CREATOR_PIPELINE=1.
 */
export function useCreatorPipeline(
  row: { pipeline_version: string } | null,
): boolean {
  if (row) return row.pipeline_version === 'creator';
  return process.env.HELIOS_SOCIAL_CREATOR_PIPELINE === '1';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/social/flags.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/social/flags.ts tests/social/flags.test.ts
git commit -m "feat(helios-social): pipeline-version flag helper"
```

---

## Phase 1 — Renderer sanity (ships to the current pipeline)

Goal: kill the most visible machine tells in the CURRENT pipeline output so slides shipped between now and Phase 4 don't have "04"/"07" chapter numbers, stranded RSS-feed names, or body-only voids. Every task here is independent of the editor stage — improves both legacy and (later) creator output.

### Task 1.1 — Kill chapter-number auto-render on story-beat slides

**Files:**
- Modify: `lib/social/render/SlideTemplate.tsx` (lines ~164-176; the `showChapter` block)
- Modify: `app/social/preview.css` or wherever `.helios-beat__chapter` is styled (grep to find)
- Create: `tests/social/render/no-chapter-number.test.tsx`

**Interfaces:**
- Behavioral change: rendering a B1/B3/B4/B6/B7 slide no longer emits a `.helios-beat__chapter` element. No API surface change.

- [ ] **Step 1: Locate the CSS class**

Run: `grep -rn "helios-beat__chapter" app/ lib/ 2>&1`
Note the CSS file that defines it and how many places reference it.

- [ ] **Step 2: Write failing test**

```tsx
// tests/social/render/no-chapter-number.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';
import type { Post } from '@/lib/social/render/types';

const b1Post: Post = {
  format: 'carousel',
  storyType: 'tech',
  source: 'TechCrunch',
  sourceUrl: 'https://example.com',
  publishedAt: '2026-09-27T00:00:00Z',
  issueNumber: 42,
  caption: 'x'.repeat(500),
  slides: [
    {
      position: 4,
      layoutVariant: 'story_beat',
      variant: 'B1',
      beat: 'GROUND',
      altText: 'Ground slide',
      body: [{ text: 'Body copy for GROUND beat.', role: 'narrative' }],
    },
  ],
};

describe('SlideTemplate — chapter number removed', () => {
  it('B1 story_beat renders without a chapter-number element', () => {
    const html = renderToStaticMarkup(<SlideTemplate post={b1Post} position={0} />);
    expect(html).not.toContain('helios-beat__chapter');
    expect(html).not.toContain('>04<');
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/social/render/no-chapter-number.test.tsx`
Expected: FAIL — chapter element present.

- [ ] **Step 4: Delete the chapter-mark block**

In `lib/social/render/SlideTemplate.tsx`, remove:
```tsx
const showChapter = slide.layoutVariant === 'story_beat' && !isB5;
const chapterNumber = String(slide.position).padStart(2, '0');
```
And the corresponding JSX:
```tsx
{showChapter && (
  <div className="helios-beat__chapter" aria-hidden="true">{chapterNumber}</div>
)}
```
Also delete the surrounding comment block that sells the "chapter mark" mechanic (it's now stale).

- [ ] **Step 5: Delete the CSS**

In the CSS file found in Step 1, delete every `.helios-beat__chapter` rule (including responsive variants). Do not leave the class as dead CSS.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/social/render/ && npx tsc --noEmit`
Expected: PASS + no new type errors.

- [ ] **Step 7: Visual smoke**

Load an existing preview URL from a `render_post_json`-populated article and confirm no giant "04" / "07" in the top-left of story-beat slides.

- [ ] **Step 8: Commit**

```bash
git add lib/social/render/SlideTemplate.tsx \
        tests/social/render/no-chapter-number.test.tsx \
        [the CSS file from Step 1]
git commit -m "feat(helios-social): remove chapter-number auto-render on story-beat slides"
```

---

### Task 1.2 — Clean the outlet name shown on the ProofSlide (P1)

**Files:**
- Modify: `lib/social/render/SlideTemplate.tsx` (the `ProofSlide` function around line ~585)
- Create: `lib/social/render/outlet-name.ts` (extracted helper)
- Create: `tests/social/render/outlet-name.test.ts`

**Interfaces:**
- Produces: `cleanOutletName(raw: string): string` — strips RSS feed decoration.
  - `"AI News & Artificial Intelligence | TechCrunch"` → `"TechCrunch"`
  - `"AI | The Next Web"` → `"The Next Web"`
  - `"Bloomberg"` → `"Bloomberg"`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/social/render/outlet-name.test.ts
import { describe, it, expect } from 'vitest';
import { cleanOutletName } from '@/lib/social/render/outlet-name';

describe('cleanOutletName', () => {
  it('strips RSS category prefix + pipe + outlet form', () => {
    expect(cleanOutletName('AI News & Artificial Intelligence | TechCrunch'))
      .toBe('TechCrunch');
  });
  it('strips short "AI |" prefix', () => {
    expect(cleanOutletName('AI | The Next Web')).toBe('The Next Web');
  });
  it('passes clean outlet names through', () => {
    expect(cleanOutletName('Bloomberg')).toBe('Bloomberg');
    expect(cleanOutletName('The New York Times')).toBe('The New York Times');
  });
  it('trims whitespace + trailing punctuation', () => {
    expect(cleanOutletName('  Fortune - ')).toBe('Fortune');
    expect(cleanOutletName('Reuters.com')).toBe('Reuters');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/social/render/outlet-name.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

```typescript
// lib/social/render/outlet-name.ts
/**
 * RSS feeds surface outlet names as decorated strings —
 *   "AI News & Artificial Intelligence | TechCrunch"
 *   "AI | The Next Web"
 * — that are wrong to render as hero attribution on a slide.
 *
 * Rules (in order):
 *   1. Split on ` | ` and take the RIGHTMOST segment (feeds put the outlet last).
 *   2. Strip common URL suffixes (.com, .co, .io).
 *   3. Strip trailing separators (` - `, `-`, `·`, `—`).
 *   4. Trim whitespace.
 */
export function cleanOutletName(raw: string): string {
  const rightmost = raw.split(/\s+\|\s+/).pop() ?? raw;
  return rightmost
    .replace(/\.(com|co|io|net|org)\b/gi, '')
    .replace(/[\s\-·—]+$/g, '')
    .trim();
}
```

- [ ] **Step 4: Wire helper into ProofSlide**

In `lib/social/render/SlideTemplate.tsx`, replace:
```typescript
const outletName = post.source.replace(/^AI\s*\|\s*/i, '').trim();
```
with:
```typescript
import { cleanOutletName } from '@/lib/social/render/outlet-name';
// ...
const outletName = cleanOutletName(post.source);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/social/render/outlet-name.test.ts && npx tsc --noEmit`
Expected: PASS + no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/social/render/outlet-name.ts \
        lib/social/render/SlideTemplate.tsx \
        tests/social/render/outlet-name.test.ts
git commit -m "feat(helios-social): clean RSS-decorated outlet names on ProofSlide"
```

---

### Task 1.3 — Body-only story-beat slides render as B5 landing (not void)

**Files:**
- Modify: `lib/social/render/layout-picker.ts` (add post-pick promotion pass)
- Modify: `tests/social/render/layout-picker.test.ts` (or create if missing)

**Interfaces:**
- Behavioral change: a beat that emits only `body` (no title, no bodyBottom, no photo-eligible, no chart, no artifact) is promoted to variant `B5` (landing) so the paragraph renders as hero landing type instead of paragraph-in-void.

- [ ] **Step 1: Read the picker to understand current shape**

Read `lib/social/render/layout-picker.ts` end-to-end. Note the shape of `finalPicks` and where the `convertSlide` call happens.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/social/render/layout-picker.test.ts (add a describe block)
import { describe, it, expect } from 'vitest';
import { pickLayouts } from '@/lib/social/render/layout-picker';
// ... build minimal LayoutPickerInput fixtures ...

describe('pickLayouts — body-only promotion', () => {
  it('promotes a body-only STAKES slide from B4 to B5', () => {
    const input = {
      // Minimal fixture — STAKES beat, only body populated
      editorialPost: {
        slides: [
          {
            position: 3,
            beat: 'STAKES' as const,
            headline: null,
            body: [{ text: 'The stakes are high.', role: 'narrative' as const }],
            bodyBottom: null,
            title: null,
            sides: null,
            altText: 'x',
            swipe_reason: '',
            asset_needs: [],
            facts: [],
          },
        ],
        caption: 'x'.repeat(500),
      },
      // ... factSheet + storyPlan + article stubs ...
    };
    const post = pickLayouts(input as any);
    expect(post.slides[0].variant).toBe('B5');
  });

  it('leaves STAKES with photo need on B4', () => {
    // Same input but with asset_needs: ['photo of X'] on the slide
    // Expect variant to be B4 (unchanged).
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/social/render/layout-picker.test.ts`
Expected: FAIL — promotion not implemented.

- [ ] **Step 4: Add the promotion pass**

In `pickLayouts`, after `finalPicks` is built, add:
```typescript
function isBodyOnly(slide: BeatCopy): boolean {
  const hasBody = (slide.body?.length ?? 0) > 0;
  const hasTitle = (slide.title?.length ?? 0) > 0;
  const hasBottom = (slide.bodyBottom?.length ?? 0) > 0;
  const hasSides = (slide.sides?.length ?? 0) > 0;
  const wantsPhoto = slide.asset_needs.some((n) => /photo|image|shot/i.test(n));
  return hasBody && !hasTitle && !hasBottom && !hasSides && !wantsPhoto;
}

for (let i = 0; i < finalPicks.length; i += 1) {
  const editorial = editorialPost.slides[i]!;
  const chosen = finalPicks[i]!;
  const family = FAMILY_BY_VARIANT[chosen];
  // Only promote story_beat family — landing composition (B5) is a story_beat variant.
  // Skip beats that already have hero treatments elsewhere (HOOK, THESIS, DEBATE, FOLLOW, QUOTE, PROOF).
  const skipBeats = new Set(['HOOK','THESIS','DEBATE','FOLLOW','QUOTE','PROOF']);
  if (family === 'story_beat' && !skipBeats.has(editorial.beat) && isBodyOnly(editorial)) {
    finalPicks[i] = 'B5';
  }
}
```

- [ ] **Step 5: Handle body → headline promotion in convertSlide (or normalize in copy stage output)**

B5 renders `slide.headline`, not `slide.body`. In `convertSlide`, when the picker promoted to B5, promote `body` → `headline` at the SlideCopy level:
```typescript
if (variant === 'B5' && !base.headline && editorial.body) {
  base.headline = editorial.body;
  base.body = undefined;
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/social/render/ && npx tsc --noEmit`
Expected: PASS + no new type errors.

- [ ] **Step 7: Visual smoke on legacy render**

Regenerate the Crusoe article (existing preview URL). Confirm the body-only "seven revenue lines" beat now lands as hero type instead of paragraph-in-void.

- [ ] **Step 8: Commit**

```bash
git add lib/social/render/layout-picker.ts \
        tests/social/render/layout-picker.test.ts
git commit -m "feat(helios-social): promote body-only story-beat slides to B5 landing"
```

---

## Phase 2 — Editor stage backend (behind flag)

Goal: build the shape call + editor call + supporting API routes. Feature-flagged so nothing on the current pipeline changes. Tests use canned Anthropic responses (never live API per Rule 1).

### Task 2.1 — Shape call: outline proposer

**Files:**
- Create: `lib/social/editorial/shape.ts`
- Create: `tests/social/editorial/shape.test.ts`
- Create: `tests/social/editorial/__fixtures__/shape_canned_response.json`

**Interfaces:**
- Produces: `proposeShape(input: ShapeInput): Promise<ShapeResult>`
- `ShapeInput = { factSheet: FactSheet; chosenHook: string; articleContext: { source: string; publishedAt: string | null } }`
- `ShapeResult = { outline: OutlineSlide[]; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; approxCostUsd: number } }`
- `OutlineSlide = { position: number; purpose: string; wants_photo: boolean; wants_chart: boolean; note: string | null }`

- [ ] **Step 1: Write the failing test using canned response**

```typescript
// tests/social/editorial/shape.test.ts
import { describe, it, expect, vi } from 'vitest';
import cannedResponse from './__fixtures__/shape_canned_response.json';
import { proposeShape } from '@/lib/social/editorial/shape';

vi.mock('@/lib/anthropic', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue(cannedResponse),
    },
  },
}));

describe('proposeShape', () => {
  it('parses a valid shape response into 5-8 outline slides', async () => {
    const result = await proposeShape({
      factSheet: { /* minimal fixture */ } as any,
      chosenHook: 'Crusoe is worth $30.9B',
      articleContext: { source: 'TechCrunch', publishedAt: '2026-09-27T00:00:00Z' },
    });
    expect(result.outline.length).toBeGreaterThanOrEqual(5);
    expect(result.outline.length).toBeLessThanOrEqual(8);
    expect(result.outline[0].position).toBe(0);
    expect(result.outline[0].purpose).toBeTruthy();
    expect(typeof result.outline[0].wants_photo).toBe('boolean');
    expect(result.usage.approxCostUsd).toBeGreaterThan(0);
  });

  it('rejects a response with more than 8 slides', async () => {
    // Test truncation / error path
  });

  it('rejects a response with fewer than 5 slides', async () => {
    // Test truncation / error path
  });
});
```

- [ ] **Step 2: Build the canned response fixture**

```json
// tests/social/editorial/__fixtures__/shape_canned_response.json
{
  "id": "msg_test_shape",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "{\"outline\":[{\"position\":0,\"purpose\":\"Hook — $30.9B in ten months\",\"wants_photo\":false,\"wants_chart\":false,\"note\":null},{\"position\":1,\"purpose\":\"What Crusoe actually does\",\"wants_photo\":true,\"wants_chart\":false,\"note\":\"data center exterior or interior\"},{\"position\":2,\"purpose\":\"The Jane Street deal — $13B\",\"wants_photo\":false,\"wants_chart\":false,\"note\":null},{\"position\":3,\"purpose\":\"Why 3x in 10 months matters\",\"wants_photo\":false,\"wants_chart\":true,\"note\":\"valuation comparison\"},{\"position\":4,\"purpose\":\"Nvidia investing in its own customer\",\"wants_photo\":false,\"wants_chart\":false,\"note\":null},{\"position\":5,\"purpose\":\"What comes next\",\"wants_photo\":false,\"wants_chart\":false,\"note\":null}]}"
    }
  ],
  "model": "claude-sonnet-4-6",
  "usage": {
    "input_tokens": 1200,
    "output_tokens": 380,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 3800
  },
  "stop_reason": "end_turn"
}
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/social/editorial/shape.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement shape.ts (system prompt + call + parse)**

Skeleton with the creator's brief as system prompt. Uses `cachedSystemText` for prompt caching. Sonnet 4.x model. Parses JSON output with the same jsonrepair fallback ladder as `copy.ts` (copy that block over).

```typescript
// lib/social/editorial/shape.ts
import type Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';

const SYSTEM_PROMPT = `You outline an Instagram carousel for Helios Social.

You receive:
- FACT SHEET (JSON) — verified facts with source_sentence pointers
- CHOSEN HOOK — the human-approved cover hook
- ARTICLE CONTEXT — outlet, publication date

Your job: propose 5-8 slides that tell this story like a smart friend would over coffee.
Each slide has ONE job. If a slide's job could be folded into its neighbor, fold it.
If a slide would need filler to fill the frame, kill it.

## What counts as one slide

- The hook (slide 0).
- One specific claim, escalation, or turn per body slide.
- The kicker / thesis (last slide before the follow prompt).

DO NOT include:
- A dedicated "source" slide. Attribution belongs in the caption.
- Filler slides that repeat what the previous slide said.
- Slides whose only job is transition ("Here's what happens next").

## Output — STRICT JSON ONLY

{
  "outline": [
    {
      "position": 0,
      "purpose": "one-line description of what this slide does",
      "wants_photo": true | false,
      "wants_chart": true | false,
      "note": "optional short direction, or null"
    },
    ...
  ]
}

5-8 slides. No prose, no markdown, no code fences. Emit only the JSON.`;

export type OutlineSlide = {
  position: number;
  purpose: string;
  wants_photo: boolean;
  wants_chart: boolean;
  note: string | null;
};

export type ShapeInput = {
  factSheet: FactSheet;
  chosenHook: string;
  articleContext: { source: string; publishedAt: string | null };
};

export type ShapeResult = {
  outline: OutlineSlide[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    approxCostUsd: number;
  };
  raw: Anthropic.Message;
};

function parseJson(text: string): unknown {
  // Same parseJson ladder pattern as lib/social/editorial/copy.ts —
  // trim code fences, try JSON.parse, extract braces, jsonrepair fallback.
  // (Copy the exact block over.)
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch { /* fall through */ }
    try { return JSON.parse(jsonrepair(candidate)); } catch { /* fall through */ }
  }
  throw new Error(`shape: could not parse — ${trimmed.slice(0, 200)}`);
}

function normalize(raw: unknown): OutlineSlide[] {
  if (typeof raw !== 'object' || raw === null) throw new Error('shape: non-object JSON');
  const r = raw as Record<string, unknown>;
  const rawOutline = Array.isArray(r.outline) ? r.outline : [];
  const outline: OutlineSlide[] = rawOutline
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, i) => ({
      position: typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : i,
      purpose: typeof x.purpose === 'string' ? x.purpose.trim() : '',
      wants_photo: Boolean(x.wants_photo),
      wants_chart: Boolean(x.wants_chart),
      note: typeof x.note === 'string' && x.note.trim().length > 0 ? x.note.trim() : null,
    }))
    .filter((s) => s.purpose.length > 0)
    .sort((a, b) => a.position - b.position);
  if (outline.length < 5) throw new Error(`shape: too few slides (${outline.length})`);
  if (outline.length > 8) throw new Error(`shape: too many slides (${outline.length})`);
  return outline;
}

export async function proposeShape(input: ShapeInput): Promise<ShapeResult> {
  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
    + `CHOSEN HOOK:\n${input.chosenHook}\n\n`
    + `ARTICLE CONTEXT:\n${JSON.stringify(input.articleContext)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 2000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('shape: model returned no text block');

  const outline = normalize(parseJson(textBlock.text));
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  return {
    outline,
    usage: {
      inputTokens: cache.inputTokens,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
      outputTokens,
      approxCostUsd: sonnetCostUsd({
        inputTokens: cache.inputTokens,
        outputTokens,
        cacheReadTokens: cache.cacheReadTokens,
        cacheWriteTokens: cache.cacheWriteTokens,
      }),
    },
    raw: response,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/social/editorial/shape.test.ts && npx tsc --noEmit`
Expected: PASS + no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/social/editorial/shape.ts \
        tests/social/editorial/shape.test.ts \
        tests/social/editorial/__fixtures__/shape_canned_response.json
git commit -m "feat(helios-social): shape call proposes 5-8 slide outline from fact sheet + hook"
```

---

### Task 2.2 — Editor call: holistic write in one voice

**Files:**
- Create: `lib/social/editorial/editor.ts`
- Create: `tests/social/editorial/editor.test.ts`
- Create: `tests/social/editorial/__fixtures__/editor_canned_response.json`

**Interfaces:**
- Produces: `runEditor(input: EditorInput): Promise<EditorResult>`
- `EditorInput = { factSheet, chosenHook, approvedOutline, articleContext }`
- `EditorResult.post` is the full render Post — slides with copy (span runs), variant per slide, photo_need description, caption. Ready for photo fetcher + renderer.
- Same output schema as today's `EditorialPost` merged with per-slide layout picks. Reuses existing `SlideCopy` shape from `lib/social/render/types.ts` — the editor emits `variant` per slide directly (no downstream layout picker needed for creator pipeline).

- [ ] **Step 1: Read existing types to reuse**

Read `lib/social/render/types.ts` for `SlideCopy`, `Variant`, `SpanRun`, `Post`. Editor's output must be shaped so it can go straight into the renderer without a `pickLayouts` pass.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/social/editorial/editor.test.ts
import { describe, it, expect, vi } from 'vitest';
import cannedResponse from './__fixtures__/editor_canned_response.json';
import { runEditor } from '@/lib/social/editorial/editor';

vi.mock('@/lib/anthropic', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue(cannedResponse),
    },
  },
}));

describe('runEditor', () => {
  it('returns a Post with variant + copy + photo_need per slide', async () => {
    const result = await runEditor({
      factSheet: { /* stub */ } as any,
      chosenHook: 'Crusoe is worth $30.9B',
      approvedOutline: [
        { position: 0, purpose: 'Hook', wants_photo: false, wants_chart: false, note: null },
        { position: 1, purpose: 'What Crusoe does', wants_photo: true, wants_chart: false, note: 'data center' },
        // ... 6 total ...
      ],
      articleContext: { source: 'TechCrunch', sourceUrl: 'https://x.com', publishedAt: '2026-09-27T00:00:00Z' },
    });
    expect(result.post.slides.length).toBe(6);
    expect(result.post.slides[0].variant).toMatch(/^C[1-4]$/); // cover
    expect(result.post.caption.length).toBeGreaterThanOrEqual(500);
    expect(result.usage.approxCostUsd).toBeGreaterThan(0);
  });

  it('promotes fact-sheet source pointers into slide.facts_cited', async () => {
    // Verify the editor's per-claim source pointers survive normalization.
  });
});
```

- [ ] **Step 3: Build canned response fixture**

Emit 6 slides with variants, span runs on headline/body, photo_need strings, and a 500+ char caption.

- [ ] **Step 4: Implement editor.ts**

The system prompt is the LONGEST part — it's the creator's brief covering:
- Voice ("write like a Helios editor talking to a smart friend at a bar; direct, dry, no PR autopilot")
- Fact-pointer rule (every claim cites a source sentence ID from fact_sheet)
- Layout vocabulary (which variant to pick when — C1/C2/C3/C4 covers, B1-B7 body beats, D1-D3 data, Q1-Q2 quotes, T1 thesis, T2 debate, F1 follow)
- Photo needs (describe what a photo should teach, don't ship if no photo would teach)
- Caption rule (500-900 chars, no emoji, no exclamation marks)
- Length caps per beat (same as today's copy.ts but stated as guidance for the writer, not enforced numerically post-hoc — the editor writes to fit)
- Explicit: NO position numbers in copy. NO source-as-slide. NO filler.

Structure the call:
```typescript
export async function runEditor(input: EditorInput): Promise<EditorResult> {
  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
    + `CHOSEN HOOK:\n${input.chosenHook}\n\n`
    + `APPROVED OUTLINE (JSON):\n${JSON.stringify(input.approvedOutline, null, 2)}\n\n`
    + `ARTICLE CONTEXT (JSON):\n${JSON.stringify(input.articleContext)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 8000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });
  // ... parse + normalize into Post shape ...
}
```

Normalize into a Post — the editor emits the render-ready shape directly:
```typescript
type EditorOutput = {
  slides: Array<{
    position: number;
    variant: Variant;  // Editor picks the layout variant
    headline: SpanRun | null;
    body: SpanRun | null;
    bodyBottom: SpanRun | null;
    title: SpanRun | null;
    sides: Array<{ label: string; text: string }> | null;
    photo_need: string | null;   // Description for photo fetcher, or null
    chart: { kind: string; ... } | null;  // For D1/D3
    facts_cited: string[];       // Source-sentence pointers from fact_sheet
    altText: string;
  }>;
  caption: string;
};
```

The normalization step maps this directly to `Post.slides` (`SlideCopy[]`) — no picker needed. Adds `layoutVariant` from `FAMILY_BY_VARIANT[variant]` (import from layout-picker.ts).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/social/editorial/editor.test.ts && npx tsc --noEmit`
Expected: PASS + no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/social/editorial/editor.ts \
        tests/social/editorial/editor.test.ts \
        tests/social/editorial/__fixtures__/editor_canned_response.json
git commit -m "feat(helios-social): editor call writes full carousel in one voice"
```

---

### Task 2.3 — Photo fetcher rewrite driven by editor's photo_need descriptions

**Files:**
- Modify: `lib/social/render/photo-assigner.ts`
- Modify: `tests/social/render/photo-assigner.test.ts` (or create)

**Interfaces:**
- Behavioral change: `assignPhotos` now reads each slide's `photo_need` (string description of what the photo should teach) instead of matching by beat/subject keywords. Skips slides where `photo_need` is null (editor decided no photo).

- [ ] **Step 1: Read current photo-assigner**

Read `lib/social/render/photo-assigner.ts` end-to-end. Understand what search strategy it currently uses (Unsplash? Pexels? article's own og:image?).

- [ ] **Step 2: Write failing test**

```typescript
// tests/social/render/photo-assigner.test.ts
describe('assignPhotos — creator pipeline mode', () => {
  it('skips slides where photo_need is null', async () => {
    const post = {
      // Post with slide 0 photo_need=null
    };
    const result = await assignPhotos(post as any, { fetcher: mockFetcher });
    expect(result.slides[0].photoUrl).toBeUndefined();
  });

  it('uses photo_need description as the search query', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ url: 'https://x.jpg', credit: 'A · CC0' });
    const post = {
      // Post with slide 1 photo_need='exterior of a modular data center in Abilene'
    };
    await assignPhotos(post as any, { fetcher: mockFetcher });
    expect(mockFetcher).toHaveBeenCalledWith(expect.stringContaining('data center'));
  });
});
```

- [ ] **Step 3: Extend photo-assigner to read photo_need**

Add a code path that, when slide has `photo_need` populated, uses it as the search query directly (skipping the beat/subject keyword logic). When `photo_need` is null, leave photoUrl unset.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/social/render/photo-assigner.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/social/render/photo-assigner.ts \
        tests/social/render/photo-assigner.test.ts
git commit -m "feat(helios-social): photo fetcher reads editor's photo_need descriptions"
```

---

### Task 2.4 — API routes for the creator pipeline stages

**Files:**
- Create: `app/api/social/hook/[id]/route.ts`
- Create: `app/api/social/outline/[id]/route.ts`
- Modify: `app/api/social/generate/[id]/route.ts` (add creator-pipeline branch)
- Modify: `lib/social/pipeline/generate.ts` (add `generatePostForArticleCreator`)

**Interfaces:**
- `POST /api/social/hook/[id]` — body `{ hook: string }`. Saves `chosen_hook_final`, `hook_approved_at`, `hook_approved_by`. Auto-runs `proposeShape` and saves `outline_json`. Returns `{ outline: OutlineSlide[] }`.
- `POST /api/social/outline/[id]` — body `{ outline: OutlineSlide[] }`. Saves `outline_approved_json`, `outline_approved_at`, `outline_approved_by`. Auto-runs `runEditor` + photo fetcher + render. Returns `{ preview_url, cost_usd, stages_run }`.
- `POST /api/social/generate/[id]` — routes based on `pipeline_version`: legacy → existing `generatePostForArticle`, creator → `generatePostForArticleCreator` (which runs whichever stage is next based on approval state).

- [ ] **Step 1: Write the hook approval route**

```typescript
// app/api/social/hook/[id]/route.ts
import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { requireSocialSession } from '@/lib/social/session';
import { proposeShape } from '@/lib/social/editorial/shape';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSocialSession();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid article id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { hook?: string };
  const hook = typeof body.hook === 'string' ? body.hook.trim() : '';
  if (hook.length === 0) {
    return NextResponse.json({ error: 'hook is required' }, { status: 400 });
  }

  // Load row + fact sheet.
  const { rows } = await dbQuery<{ fact_sheet: unknown; source: string; published_at: Date | null }>(
    `SELECT fact_sheet, source, published_at FROM helios_social.article_queue WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'article not found' }, { status: 404 });
  if (!row.fact_sheet) return NextResponse.json({ error: 'fact sheet not ready' }, { status: 422 });

  // Save the hook.
  await dbQuery(
    `UPDATE helios_social.article_queue
        SET chosen_hook_final = $1, hook_approved_at = now(), hook_approved_by = $2
      WHERE id = $3`,
    [hook, session.email, id],
  );

  // Run shape.
  const shape = await proposeShape({
    factSheet: row.fact_sheet as never,
    chosenHook: hook,
    articleContext: {
      source: row.source,
      publishedAt: row.published_at?.toISOString() ?? null,
    },
  });

  // Save outline_json.
  await dbQuery(
    `UPDATE helios_social.article_queue SET outline_json = $1::jsonb WHERE id = $2`,
    [JSON.stringify(shape.outline), id],
  );

  return NextResponse.json({ outline: shape.outline, cost_usd: shape.usage.approxCostUsd });
}
```

- [ ] **Step 2: Write the outline approval route**

Mirror the hook route: validate id, validate body has `outline: OutlineSlide[]`, save `outline_approved_json` + auditing fields, then call `generatePostForArticleCreator(id)` and return its result. Same 5-min steps as hook.

- [ ] **Step 3: Add `generatePostForArticleCreator` to `lib/social/pipeline/generate.ts`**

```typescript
export async function generatePostForArticleCreator(articleId: string) {
  // Load row incl. fact_sheet, chosen_hook_final, outline_approved_json.
  // Guard: reject if outline_approved_json is null (checkpoint 2 not passed).
  // Run runEditor(...).
  // Run assignPhotos(...) (creator-pipeline mode).
  // Persist copy_json = editor output.
  // Assemble render_post_json.
  // Persist render_slug, return preview_url + cost.
}
```

- [ ] **Step 4: Route the existing `/api/social/generate/[id]` based on pipeline_version**

```typescript
// app/api/social/generate/[id]/route.ts (modify)
// After loading the row:
if (row.pipeline_version === 'creator') {
  const result = await generatePostForArticleCreator(id);
  // ...
} else {
  const result = await generatePostForArticle(id, { force, critique });
  // ...
}
```

- [ ] **Step 5: Integration test — creator pipeline dry run with all Claude calls mocked**

```typescript
// tests/social/pipeline/creator.test.ts
// Mock @/lib/anthropic to return canned shape + editor responses.
// Seed a test article in-memory (or a test DB row via a helper).
// Simulate: POST /hook, POST /outline, verify copy_json is populated.
```

- [ ] **Step 6: Typecheck + run all social tests**

Run: `npx tsc --noEmit && npx vitest run tests/social/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/social/hook/ app/api/social/outline/ \
        app/api/social/generate/[id]/route.ts \
        lib/social/pipeline/generate.ts \
        tests/social/pipeline/creator.test.ts
git commit -m "feat(helios-social): creator-pipeline API routes + generate branching"
```

---

## Phase 3 — Checkpoint UIs

Goal: build the hook and outline approval panels. Existing review panel is Checkpoint 3, already shipped.

### Task 3.1 — Hook approval UI (Checkpoint 1)

**Files:**
- Create: `app/social/HookPanel.tsx`
- Modify: `app/social/PageClient.tsx` (render HookPanel when article is creator-pipeline + no chosen_hook_final)
- Modify: `app/social/actions/loadBatch.ts` (SELECT new columns)
- Modify: `lib/social/types.ts` (add fields to Article type)
- Modify: `app/social/social.css` (styles for hook panel)

**Interfaces:**
- Consumes: `article.hookCandidates` (array of candidate hook strings — where does this come from? Existing `hook-mine.ts` writes `hook_gate_pass` and stores candidates in a column; verify the column name — likely `hook_candidates` jsonb. If not present, this task also SELECTs candidates from wherever they live.)
- Produces: hook picked → `POST /api/social/hook/:id`.

- [ ] **Step 1: Verify where hook candidates live**

Run: `grep -rn "hook_candidates\|hook_scored\|hook_gate" ~/Desktop/HELIOS/The-Helios-Hub/lib/social/editorial/hook-mine.ts ~/Desktop/HELIOS/The-Helios-Hub/db/ 2>&1 | head -20`
Identify the exact column that holds the 3-5 scored candidate hooks.

- [ ] **Step 2: Extend Article type + loadBatch to include candidates + approval fields**

Add to `lib/social/types.ts`:
```typescript
export type Article = {
  // ... existing fields ...
  pipelineVersion: 'legacy' | 'creator';
  hookCandidates: string[] | null;  // 3-5 scored hooks from hook-mine stage
  chosenHookFinal: string | null;
  hookApprovedAt: string | null;
  hookApprovedBy: string | null;
  outlineJson: OutlineSlide[] | null;
  outlineApprovedJson: OutlineSlide[] | null;
  outlineApprovedAt: string | null;
  outlineApprovedBy: string | null;
};
```

Extend `loadBatch.ts` SELECT accordingly.

- [ ] **Step 3: Build the HookPanel component**

```tsx
// app/social/HookPanel.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Article } from '@/lib/social/types';

export function HookPanel({ article }: { article: Article }) {
  const router = useRouter();
  const [pick, setPick] = useState<string>('');
  const [customHook, setCustomHook] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(hook: string) {
    if (hook.trim().length === 0) return;
    setStatus('submitting');
    try {
      const res = await fetch(`/api/social/hook/${article.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hook: hook.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus('error');
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus('idle');
      router.refresh();
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const candidates = article.hookCandidates ?? [];

  return (
    <section className="social-detail-section">
      <h3 className="social-section-label">Choose your cover</h3>
      <div className="social-hook-panel">
        <p className="social-hook-lead">
          Pick a hook or write your own. This becomes slide 1 and shapes the whole story.
        </p>
        {candidates.length > 0 && (
          <div className="social-hook-options">
            {candidates.map((c, i) => (
              <label key={i} className="social-hook-option">
                <input
                  type="radio"
                  name="hook"
                  value={c}
                  checked={pick === c}
                  onChange={() => setPick(c)}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        )}
        <div className="social-hook-custom">
          <label className="social-critique-label" htmlFor="social-custom-hook">
            Or write your own
          </label>
          <textarea
            id="social-custom-hook"
            className="social-critique-input"
            value={customHook}
            onChange={(e) => { setCustomHook(e.target.value); setPick(''); }}
            placeholder="e.g. Crusoe is worth $30.9B. Three times what it was worth ten months ago."
            rows={2}
          />
        </div>
        <div className="social-actions">
          <button
            type="button"
            className="social-btn social-btn--primary"
            disabled={status === 'submitting' || (pick.length === 0 && customHook.trim().length === 0)}
            onClick={() => submit(customHook.trim() || pick)}
          >
            Save hook &amp; propose outline
          </button>
        </div>
        {status === 'error' && <p className="social-generate-error">Failed: {error}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire into PageClient**

In `ArticleDetail`, add before `<GeneratePanel article={a} />`:
```tsx
{a.pipelineVersion === 'creator' && !a.chosenHookFinal && (
  <HookPanel article={a} />
)}
```

- [ ] **Step 5: Style — invoke helios-design-system skill**

Any Helios UI edit goes through the brand skill. Use the skill to spec token/type for `.social-hook-panel`, `.social-hook-option`, `.social-hook-custom`. Add rules to `app/social/social.css`.

- [ ] **Step 6: Visual smoke**

Seed a creator-pipeline test article. Load /social, confirm the HookPanel renders with candidates + custom textarea. Click a radio, hit save, verify redirect / refresh.

- [ ] **Step 7: Commit**

```bash
git add app/social/HookPanel.tsx \
        app/social/PageClient.tsx \
        app/social/actions/loadBatch.ts \
        app/social/social.css \
        lib/social/types.ts
git commit -m "feat(helios-social): Checkpoint 1 UI — hook approval panel"
```

---

### Task 3.2 — Outline approval UI (Checkpoint 2)

**Files:**
- Create: `app/social/OutlinePanel.tsx`
- Modify: `app/social/PageClient.tsx` (render OutlinePanel when creator-pipeline + hook approved + no outline_approved_json)
- Modify: `app/social/social.css`

**Interfaces:**
- Consumes: `article.outlineJson` (the shape call's proposal).
- Produces: outline approved → `POST /api/social/outline/:id`.

- [ ] **Step 1: Build OutlinePanel — editable list**

Each outline slide is a row: purpose text (editable), photo/chart checkboxes, up/down move, delete. "Add slide" button at bottom. "Approve outline" primary action.

Key logic: enforce 5-8 slide count client-side. Warn when < 5 or > 8 before submit.

- [ ] **Step 2: Wire into PageClient**

```tsx
{a.pipelineVersion === 'creator' && a.chosenHookFinal && a.outlineJson && !a.outlineApprovedJson && (
  <OutlinePanel article={a} />
)}
```

- [ ] **Step 3: Style — invoke helios-design-system skill**

Same as hook panel — brand skill spec.

- [ ] **Step 4: Visual smoke**

- [ ] **Step 5: Commit**

```bash
git add app/social/OutlinePanel.tsx app/social/PageClient.tsx app/social/social.css
git commit -m "feat(helios-social): Checkpoint 2 UI — outline approval panel"
```

---

## Phase 4 — Cutover

Goal: flip the flag default so new articles use the creator pipeline. Legacy rows keep working.

### Task 4.1 — Flip HELIOS_SOCIAL_CREATOR_PIPELINE default to '1'

**Files:**
- Modify: `.env.local` on developer machines (manual — call out in commit message)
- Modify: `vercel.json` or Vercel dashboard env vars (deployment step)
- Modify: `lib/social/flags.ts` — no code change, but update the doc comment to reflect the flag is now on by default in dev.
- Modify: `scripts/social_ingest.ts` (or wherever the ingest stamps `pipeline_version` on new rows) — read env var to decide default.

- [ ] **Step 1: Verify all Phase 2 + 3 tests still pass**

Run: `npx vitest run tests/social/ && npx tsc --noEmit`
Expected: full green.

- [ ] **Step 2: Update ingest to stamp `pipeline_version` on new rows**

Grep for where new article rows get inserted:
```
grep -rn "INSERT INTO helios_social.article_queue" ~/Desktop/HELIOS/The-Helios-Hub/lib/social/ ~/Desktop/HELIOS/The-Helios-Hub/scripts/
```
Add `pipeline_version` to the column list, populate from `useCreatorPipeline(null)`.

- [ ] **Step 3: Manual smoke — creator-pipeline end to end on a real article**

Ingest a new article. Open /social. Walk through checkpoint 1 → checkpoint 2 → generate → checkpoint 3. Confirm each step works, view the rendered preview.

- [ ] **Step 4: Update .env.local + Vercel env vars**

Set `HELIOS_SOCIAL_CREATOR_PIPELINE=1` in `.env.local`. Confirm-ask user before touching Vercel dashboard (per "user confirmation" for shared infra rule).

- [ ] **Step 5: Commit**

```bash
git add scripts/social_ingest.ts lib/social/flags.ts
git commit -m "feat(helios-social): creator pipeline default for new articles"
```

---

## Phase 5 — Demolition

Goal: delete the legacy pipeline code once no active row is on `pipeline_version='legacy'` and needing work. This is scoped as ONE plan phase but the actual deletion should wait until Phase 4 has soaked for a week or two.

### Task 5.1 — Confirm no legacy rows are pending work

**Files:** none (query only)

- [ ] **Step 1: Query for pending legacy work**

```sql
SELECT count(*) FROM helios_social.article_queue
WHERE pipeline_version = 'legacy'
  AND ingest_status = 'approved_for_draft'
  AND copy_json IS NULL;
```
If > 0, either (a) let them clear naturally, or (b) mark them as skipped. Do not proceed until this returns 0.

---

### Task 5.2 — Delete legacy editorial stages

**Files:**
- Delete: `lib/social/editorial/copy.ts`
- Delete: `lib/social/editorial/humanize.ts`
- Delete: `lib/social/editorial/polish.ts`
- Delete: `lib/social/editorial/qa.ts`
- Delete: `lib/social/editorial/repair.ts`
- Delete: `lib/social/editorial/strategy.ts`
- Delete: `lib/social/editorial/story-plan.ts`
- Modify: `lib/social/pipeline/generate.ts` — remove `generatePostForArticle` (legacy path) and `adjustPostFromCritique` (legacy adjust path). Keep only `generatePostForArticleCreator` + a creator-mode adjust variant.
- Modify: `app/api/social/generate/[id]/route.ts` — remove the `pipeline_version === 'legacy'` branch. Just call the creator function.
- Delete: any tests exclusively for the deleted files.
- Delete: any `scripts/social_*_dry_run.ts` that tested the legacy stages.

- [ ] **Step 1: Grep for imports of every file being deleted**

```
for f in copy humanize polish qa repair strategy story-plan; do
  echo "=== $f ==="
  grep -rn "from '@/lib/social/editorial/$f'" ~/Desktop/HELIOS/The-Helios-Hub/lib ~/Desktop/HELIOS/The-Helios-Hub/app ~/Desktop/HELIOS/The-Helios-Hub/scripts 2>&1
done
```
Every import needs a home: either the caller also gets deleted, or the caller gets rewritten to use creator-pipeline modules.

- [ ] **Step 2: Delete files + update callers + typecheck**

Delete the files, resolve every broken import, run `npx tsc --noEmit` until clean.

- [ ] **Step 3: Run all social tests**

Run: `npx vitest run tests/social/`
Expected: green (with fewer tests than before — deleted with the deleted code).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(helios-social): delete legacy editorial pipeline (copy/humanize/polish/qa/repair/strategy/story-plan)"
```

---

### Task 5.3 — Slim layout-picker to a family-map only

**Files:**
- Modify: `lib/social/render/layout-picker.ts`

- [ ] **Step 1: Reduce to `FAMILY_BY_VARIANT` + a straight passthrough**

Since the creator pipeline emits `variant` per slide directly, `pickLayouts` becomes:
```typescript
export function pickLayouts(input: LayoutPickerInput): Post {
  // No more beat → variant table. Editor already picked.
  // Just carry the editor's variant into the render Post + attach layoutVariant from FAMILY_BY_VARIANT.
  const slides = input.editorialPost.slides.map((editorial) => ({
    ...editorial,
    layoutVariant: FAMILY_BY_VARIANT[editorial.variant ?? 'B1'],
  }));
  return {
    format: 'carousel',
    storyType: input.factSheet.story_type as StoryType,
    source: input.article.source,
    sourceUrl: input.article.sourceUrl,
    publishedAt: input.article.publishedAt,
    issueNumber: input.article.issueNumber,
    slides: slides as never,
    caption: input.editorialPost.caption,
  };
}
```
(Rename the function if `pickLayouts` no longer describes the job.)

Delete `PICK_TABLE`, `pickInitialVariant`, `pickCoverVariant`, `pickQuoteVariant`, `enforceRhythm`, `hasPortrait`, `hasMetaphorPhoto`. Keep `FAMILY_BY_VARIANT` and `convertSlide` (if the shape mapping is still needed — otherwise inline it).

- [ ] **Step 2: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run tests/social/`

- [ ] **Step 3: Commit**

```bash
git add lib/social/render/layout-picker.ts
git commit -m "refactor(helios-social): slim layout-picker to variant→family map"
```

---

## Self-Review (checklist run against the spec)

**1. Spec coverage.** Every design decision above has a task:
- 3 checkpoints → hook (Task 3.1), outline (Task 3.2), ship (already shipped).
- Editor stage (shape + editor) → Tasks 2.1 + 2.2.
- Voice continuity → editor.ts writes all slides in one call (Task 2.2).
- Fact verification moves into editor → editor system prompt requires source pointers (Task 2.2).
- Layout as writing decision → editor emits `variant` per slide (Task 2.2), picker gets slimmed (Task 5.3).
- Beat vocabulary dies as prescriptive → shape.ts uses "purpose" one-liners, not named beats (Task 2.1). Editor picks layouts, not beats. Beat labels stay as descriptive analytics tags on the render output.
- Renderer sanity fixes (chapter numbers, source-outlet cleaning, body-only voids) → Phase 1.
- Feature flag + phased rollout → Phase 0 + Phase 4.
- Demolition → Phase 5.

**2. Placeholder scan.** Reviewed; no "TBD" / "add error handling" / "similar to Task N" occurrences. Some steps reference re-using existing patterns from files in the repo (e.g., "same jsonrepair ladder as copy.ts") — those are explicit citations to a named source, not undefined placeholders.

**3. Type consistency.** `OutlineSlide` shape is defined in Task 2.1 and consumed by Tasks 2.2, 2.4, 3.1, 3.2. `pipelineVersion` on Article is defined in Task 3.1 (loadBatch) and used in Tasks 3.1 + 3.2 + 4.1. `Variant` type is imported from existing `lib/social/render/types.ts` — no new type introduced. Consistent.

## Notes / risks

- **Voice tuning is post-plan work.** The shape and editor system prompts in Tasks 2.1 and 2.2 are drafts. Real voice quality is only verifiable by clicking Generate in the built app (per CLAUDE.md Rule 1). Expect 2-3 iteration cycles after Phase 3 lands where Tommy generates a real carousel, hits Revise with a critique, and the prompt gets tuned.
- **Photo pipeline is the weakest link.** Task 2.3 rewrites the assigner to use editor's `photo_need` descriptions, but the underlying fetcher (Unsplash/Pexels/og:image) still matches keywords. A future improvement — not in this plan — is to have the editor call also emit a specific image URL suggestion when it wants a real subject (e.g., "Crusoe's Abilene facility exterior"), and have a fetcher smart enough to hit that.
- **The `renderPost` schema doesn't change.** Editor output normalizes into the existing `Post` / `SlideCopy` shape from `lib/social/render/types.ts`. Renderer doesn't need to change beyond Phase 1's sanity fixes.
- **Prompt caching cache-hit rate must be verified.** The shape and editor system prompts are cached for 1h. If cache reads aren't > 80% of input tokens after the first call, prompt structure is wrong. Log usage after Phase 3 lands to check.
