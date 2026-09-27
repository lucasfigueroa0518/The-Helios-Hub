import type Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { dbQuery } from '@/lib/db';

// Editorial pipeline (stages 2-7).
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import { buildFactSheet } from '@/lib/social/editorial/fact-sheet';
import { mineHooks } from '@/lib/social/editorial/hook-mine';
import { chooseStrategy } from '@/lib/social/editorial/strategy';
import { buildStoryPlan } from '@/lib/social/editorial/story-plan';
import { writeCopy } from '@/lib/social/editorial/copy';
import { humanizePost } from '@/lib/social/copy/humanize';
import { polishPost } from '@/lib/social/editorial/polish';
import { runEditorialQa } from '@/lib/social/editorial/qa';
import { repairPost } from '@/lib/social/editorial/repair';

// Render pipeline (layout picker + photo assigner + save).
import { pickLayouts } from '@/lib/social/render/layout-picker';
import { assignPhotos } from '@/lib/social/render/photo-assigner';

export type GenerateResult = {
  ok: true;
  slug: string;
  cost_usd: number;
  stages_run: string[];
  preview_url: string;
};

export type GenerateFailure = {
  ok: false;
  code: 'not_found' | 'body_too_thin' | 'hook_gate_failed';
  message: string;
  detail?: string;
};

/**
 * Runs the full editorial + render pipeline for one article. Resume by
 * default (skips cached stages populated on the article_queue row);
 * `force=true` regenerates every stage from scratch.
 *
 * Writes the final render Post JSON to
 * `exports/social/generated/{slug}.json`, from which the preview route
 * and the Playwright PNG export both read.
 *
 * Shared by:
 *   - `POST /api/social/generate/[id]` — manual button in the /social UI
 *   - `GET /api/social/generate/next` — cron auto-trigger
 */
export async function generatePostForArticle(
  articleId: string,
  opts: { force?: boolean } = {},
): Promise<GenerateResult | GenerateFailure> {
  const force = Boolean(opts.force);

  type Row = {
    id: string;
    source: string;
    source_url: string;
    headline: string;
    byline: string | null;
    body: string;
    published_at: Date | string | null;
    fact_sheet: unknown;
    chosen_hook: unknown;
    strategy: unknown;
    story_plan: unknown;
    copy_json: unknown;
  };
  const { rows } = await dbQuery<Row>(
    `SELECT id, source, source_url, headline, byline, body,
            published_at, fact_sheet, chosen_hook,
            strategy, story_plan, copy_json
       FROM helios_social.article_queue
      WHERE id = $1`,
    [articleId],
  );
  const row = rows[0];
  if (!row) return { ok: false, code: 'not_found', message: 'article not found' };
  if (!row.body || row.body.length < 200) {
    return { ok: false, code: 'body_too_thin', message: 'article body too thin to generate' };
  }

  const stagesRun: string[] = [];
  let totalCost = 0;
  const publishedIso = toIso(row.published_at);

  // ── Stage 2: fact-sheet ────────────────────────────────────────────────
  let factSheet = row.fact_sheet as ReturnType<typeof asMaybeObj>;
  if (!factSheet || force) {
    const r = await buildFactSheet({
      headline: row.headline,
      source: row.source,
      byline: row.byline,
      body: row.body,
      scaffold: null,
    });
    factSheet = r.factSheet;
    totalCost += r.usage.approxCostUsd;
    stagesRun.push('fact-sheet');
    await dbQuery(
      `UPDATE helios_social.article_queue SET fact_sheet = $1::jsonb WHERE id = $2`,
      [JSON.stringify(factSheet), articleId],
    );
  }

  // ── Stage 2b: hook-mine ────────────────────────────────────────────────
  let chosenHook = row.chosen_hook as ReturnType<typeof asMaybeObj>;
  if (!chosenHook || force) {
    const r = await mineHooks(factSheet as never);
    if (!r.chosen || !r.gate.post) {
      return {
        ok: false,
        code: 'hook_gate_failed',
        message: 'hook gate failed — no hook scored high enough to publish',
        detail: r.gate.reason,
      };
    }
    chosenHook = r.chosen as unknown as Record<string, unknown>;
    totalCost += r.usage.approxCostUsd;
    stagesRun.push('hook-mine');
    await dbQuery(
      `UPDATE helios_social.article_queue
          SET hooks = $1::jsonb, chosen_hook = $2::jsonb,
              hook_gate_pass = TRUE, hook_gate_reason = $3,
              hook_scored_at = now()
        WHERE id = $4`,
      [JSON.stringify(r.hooks), JSON.stringify(chosenHook), r.gate.reason, articleId],
    );
  }

  // ── Stage 3: strategy + archetype ──────────────────────────────────────
  let strategy = row.strategy as ReturnType<typeof asMaybeObj>;
  if (!strategy || force) {
    const r = await chooseStrategy({ factSheet: factSheet as never, chosenHook: chosenHook as never });
    strategy = r.strategy;
    totalCost += r.usage.approxCostUsd;
    stagesRun.push('strategy');
    await dbQuery(
      `UPDATE helios_social.article_queue
          SET strategy = $1::jsonb, bucket = $2, archetype = $3
        WHERE id = $4`,
      [JSON.stringify(strategy), (strategy as { bucket: string }).bucket, (strategy as { archetype: string }).archetype, articleId],
    );
  }

  // ── Stage 4: story-plan ────────────────────────────────────────────────
  let storyPlan = row.story_plan as ReturnType<typeof asMaybeObj>;
  if (!storyPlan || force) {
    const r = await buildStoryPlan({ factSheet: factSheet as never, chosenHook: chosenHook as never, strategy: strategy as never });
    storyPlan = r.storyPlan;
    totalCost += r.usage.approxCostUsd;
    stagesRun.push('story-plan');
    await dbQuery(
      `UPDATE helios_social.article_queue
          SET story_plan = $1::jsonb, plan_generated_at = now()
        WHERE id = $2`,
      [JSON.stringify(storyPlan), articleId],
    );
  }

  // ── Stage 5-7: copy → humanize → polish → QA → repair ─────────────────
  let copyJson = row.copy_json as ReturnType<typeof asMaybeObj>;
  if (!copyJson || force) {
    const copyResult = await writeCopy({
      factSheet: factSheet as never,
      chosenHook: chosenHook as never,
      strategy: strategy as never,
      storyPlan: storyPlan as never,
      articlePublishedAt: publishedIso,
    });
    totalCost += copyResult.usage.approxCostUsd;
    stagesRun.push('copy');

    const adapted = {
      format: 'carousel' as const,
      storyType: 'tech' as const,
      source: row.source,
      sourceUrl: row.source_url,
      publishedAt: publishedIso,
      issueNumber: 0,
      caption: copyResult.post.caption,
      slides: copyResult.post.slides.map((s) => ({
        position: s.position,
        layoutVariant: 'story_beat' as const,
        headline: s.headline ?? undefined,
        body: s.body ?? undefined,
        bodyBottom: s.bodyBottom ?? undefined,
        title: s.title ?? undefined,
        altText: s.altText,
      })),
    };
    const humanized = await humanizePost(adapted);
    totalCost += (humanized.usage.inputTokens * 1
      + humanized.usage.cacheReadTokens * 0.1
      + humanized.usage.cacheWriteTokens * 1.25
      + humanized.usage.outputTokens * 5) / 1_000_000;
    stagesRun.push('humanize');

    const humanizedEditorial = {
      slides: copyResult.post.slides.map((original, idx) => {
        const h = humanized.post.slides[idx];
        return {
          ...original,
          headline: h?.headline ?? original.headline,
          body: h?.body ?? original.body,
          bodyBottom: h?.bodyBottom ?? original.bodyBottom,
          title: h?.title ?? original.title,
        };
      }),
      caption: humanized.post.caption,
    };

    const polished = await polishPost(humanizedEditorial);
    totalCost += polished.usage.approxCostUsd;
    stagesRun.push('polish');

    let qa = await runEditorialQa(polished.post, factSheet as never);
    let finalPost = polished.post;
    totalCost += qa.usage.approxCostUsd;
    stagesRun.push('qa');

    const totalFixable = qa.static_issues.length + qa.llm.voice_issues.length;
    if (!qa.pass && totalFixable > 0 && totalFixable <= 5) {
      const repair = await repairPost({ post: polished.post, qa, factSheet: factSheet as never });
      totalCost += repair.usage.approxCostUsd;
      finalPost = repair.post;
      qa = await runEditorialQa(finalPost, factSheet as never);
      totalCost += qa.usage.approxCostUsd;
      stagesRun.push('repair');
    }

    copyJson = finalPost;
    await dbQuery(
      `UPDATE helios_social.article_queue
          SET copy_json = $1::jsonb, qa_result = $2::jsonb,
              qa_pass = $3, qa_passed_at = CASE WHEN $3 THEN now() ELSE NULL END
        WHERE id = $4`,
      [JSON.stringify(finalPost), JSON.stringify(qa), qa.pass, articleId],
    );
  }

  // ── Render pipeline ────────────────────────────────────────────────────
  const dayStamp = Math.floor(Date.now() / 86_400_000) - 20_000;
  const bareLayout = pickLayouts({
    editorialPost: copyJson as never,
    factSheet: factSheet as never,
    storyPlan: storyPlan as never,
    article: {
      source: row.source,
      sourceUrl: row.source_url,
      publishedAt: publishedIso,
      issueNumber: dayStamp,
    },
  });
  const enriched = await assignPhotos({
    post: bareLayout,
    factSheet: factSheet as never,
    articleUrl: row.source_url,
  });
  stagesRun.push('render');

  const slug = `${slugify(row.source)}-${slugify(row.headline).slice(0, 40)}-${row.id.slice(0, 8)}`;

  // Persist the render Post JSON + slug to the DB — the source of truth
  // on Vercel where the filesystem is ephemeral per invocation. Local
  // dev also gets a filesystem mirror so the Playwright PNG export script
  // can read the JSON directly without a DB round-trip.
  await dbQuery(
    `UPDATE helios_social.article_queue
        SET render_post_json = $1::jsonb, render_slug = $2
      WHERE id = $3`,
    [JSON.stringify(enriched.post), slug, row.id],
  );
  await writeFilesystemMirror(slug, enriched.post);

  return {
    ok: true,
    slug,
    cost_usd: Number(totalCost.toFixed(4)),
    stages_run: stagesRun,
    preview_url: `/social/render/preview?generated=${slug}&all=1`,
  };
}

/**
 * Best-effort filesystem mirror of the render JSON — used only by the
 * Playwright PNG export script for local dev. On Vercel this write will
 * either fail (read-only fs) or land in an ephemeral scratch dir, and
 * that's fine: the API routes serve the JSON from the DB.
 */
async function writeFilesystemMirror(slug: string, post: unknown): Promise<void> {
  try {
    const outDir = path.join(process.cwd(), 'exports', 'social', 'generated');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(post, null, 2), 'utf8');
  } catch {
    // Ignore — production has no writable exports/ directory.
  }
}

/**
 * Adjust an already-generated post based on user feedback. Reads the
 * existing copy_json + user critique, runs a Sonnet call that produces
 * adjusted copy (facts intact, style/composition changed per critique),
 * then re-runs humanize + polish + QA + repair + render.
 *
 * Costs ~$0.08 vs ~$0.25 for a full regenerate — we skip fact-sheet,
 * hook-mine, strategy, and plan since those don't change based on
 * "make the cover shorter."
 */
export async function adjustPostFromCritique(
  articleId: string,
  critique: string,
): Promise<GenerateResult | GenerateFailure> {
  type Row = {
    id: string;
    source: string;
    source_url: string;
    headline: string;
    published_at: Date | string | null;
    fact_sheet: unknown;
    chosen_hook: unknown;
    strategy: unknown;
    story_plan: unknown;
    copy_json: unknown;
  };
  const { rows } = await dbQuery<Row>(
    `SELECT id, source, source_url, headline, published_at,
            fact_sheet, chosen_hook, strategy, story_plan, copy_json
       FROM helios_social.article_queue
      WHERE id = $1`,
    [articleId],
  );
  const row = rows[0];
  if (!row) return { ok: false, code: 'not_found', message: 'article not found' };
  if (!row.copy_json || !row.fact_sheet || !row.story_plan) {
    return {
      ok: false,
      code: 'not_found',
      message: 'no prior generation to adjust — run Generate first',
    };
  }
  const trimmed = critique.trim();
  if (!trimmed) {
    return { ok: false, code: 'not_found', message: 'critique required for adjust' };
  }

  const stagesRun: string[] = [];
  let totalCost = 0;
  const publishedIso = toIso(row.published_at);

  // ── Adjust copy via Sonnet with critique context ──────────────────────
  const adjustPrompt = `You are adjusting an already-produced Helios Social editorial carousel based on user feedback. You receive:
- FACT SHEET (JSON) — verified facts. Never change these.
- CURRENT COPY (JSON) — the existing carousel copy.
- USER FEEDBACK — plain-language critique of the current copy.

Produce a new EditorialPost JSON with the same shape as CURRENT COPY, adjusted per the feedback. Keep every fact traceable to the fact sheet. Slide count and beat identifiers should stay the same unless the feedback specifically calls for restructuring. Copy the span-role structure (narrative / hook / pivot). Do not add or remove slides unless the feedback requires it.

Output STRICT JSON matching the CURRENT COPY shape. No prose, no code fences, no explanation. Just the JSON.`;

  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(row.fact_sheet, null, 2)}\n\n`
    + `CURRENT COPY (JSON):\n${JSON.stringify(row.copy_json, null, 2)}\n\n`
    + `USER FEEDBACK:\n${trimmed}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 8000,
    system: cachedSystemText(adjustPrompt, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) {
    return { ok: false, code: 'not_found', message: 'adjust: model returned no text block' };
  }

  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  totalCost += sonnetCostUsd({
    inputTokens: cache.inputTokens,
    outputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
  });
  stagesRun.push('adjust');

  let adjustedCopy: unknown;
  try {
    const trimmedText = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    adjustedCopy = JSON.parse(trimmedText);
  } catch (err) {
    return {
      ok: false,
      code: 'not_found',
      message: 'adjust: model returned unparseable JSON',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── humanize → polish → QA → repair on adjusted copy ─────────────────
  const adjustedPost = adjustedCopy as { slides: unknown[]; caption: string };
  const adapted = {
    format: 'carousel' as const,
    storyType: 'tech' as const,
    source: row.source,
    sourceUrl: row.source_url,
    publishedAt: publishedIso,
    issueNumber: 0,
    caption: adjustedPost.caption,
    slides: (adjustedPost.slides as Array<Record<string, unknown>>).map((s) => ({
      position: (s.position as number) ?? 0,
      layoutVariant: 'story_beat' as const,
      headline: s.headline as never,
      body: s.body as never,
      bodyBottom: s.bodyBottom as never,
      title: s.title as never,
      altText: (s.altText as string) ?? '',
    })),
  };
  const humanized = await humanizePost(adapted);
  totalCost += (humanized.usage.inputTokens * 1
    + humanized.usage.cacheReadTokens * 0.1
    + humanized.usage.cacheWriteTokens * 1.25
    + humanized.usage.outputTokens * 5) / 1_000_000;
  stagesRun.push('humanize');

  const humanizedEditorial = {
    slides: (adjustedPost.slides as Array<Record<string, unknown>>).map((original, idx) => {
      const h = humanized.post.slides[idx];
      return {
        ...original,
        headline: h?.headline ?? original.headline,
        body: h?.body ?? original.body,
        bodyBottom: h?.bodyBottom ?? original.bodyBottom,
        title: h?.title ?? original.title,
      };
    }),
    caption: humanized.post.caption,
  };

  const polished = await polishPost(humanizedEditorial as never);
  totalCost += polished.usage.approxCostUsd;
  stagesRun.push('polish');

  let qa = await runEditorialQa(polished.post, row.fact_sheet as never);
  let finalPost = polished.post;
  totalCost += qa.usage.approxCostUsd;
  stagesRun.push('qa');

  const totalFixable = qa.static_issues.length + qa.llm.voice_issues.length;
  if (!qa.pass && totalFixable > 0 && totalFixable <= 5) {
    const repair = await repairPost({ post: polished.post, qa, factSheet: row.fact_sheet as never });
    totalCost += repair.usage.approxCostUsd;
    finalPost = repair.post;
    qa = await runEditorialQa(finalPost, row.fact_sheet as never);
    totalCost += qa.usage.approxCostUsd;
    stagesRun.push('repair');
  }

  await dbQuery(
    `UPDATE helios_social.article_queue
        SET copy_json = $1::jsonb, qa_result = $2::jsonb,
            qa_pass = $3, qa_passed_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id = $4`,
    [JSON.stringify(finalPost), JSON.stringify(qa), qa.pass, articleId],
  );

  // ── Render pipeline ────────────────────────────────────────────────────
  const dayStamp = Math.floor(Date.now() / 86_400_000) - 20_000;
  const { pickLayouts: _pl } = await import('@/lib/social/render/layout-picker');
  const { assignPhotos: _ap } = await import('@/lib/social/render/photo-assigner');
  const bareLayout = _pl({
    editorialPost: finalPost as never,
    factSheet: row.fact_sheet as never,
    storyPlan: row.story_plan as never,
    article: {
      source: row.source,
      sourceUrl: row.source_url,
      publishedAt: publishedIso,
      issueNumber: dayStamp,
    },
  });
  const enriched = await _ap({
    post: bareLayout,
    factSheet: row.fact_sheet as never,
    articleUrl: row.source_url,
  });
  stagesRun.push('render');

  const slug = `${slugify(row.source)}-${slugify(row.headline).slice(0, 40)}-${row.id.slice(0, 8)}`;

  // Persist the render Post JSON + slug to the DB — the source of truth
  // on Vercel where the filesystem is ephemeral per invocation. Local
  // dev also gets a filesystem mirror so the Playwright PNG export script
  // can read the JSON directly without a DB round-trip.
  await dbQuery(
    `UPDATE helios_social.article_queue
        SET render_post_json = $1::jsonb, render_slug = $2
      WHERE id = $3`,
    [JSON.stringify(enriched.post), slug, row.id],
  );
  await writeFilesystemMirror(slug, enriched.post);

  return {
    ok: true,
    slug,
    cost_usd: Number(totalCost.toFixed(4)),
    stages_run: stagesRun,
    preview_url: `/social/render/preview?generated=${slug}&all=1`,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toIso(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

function asMaybeObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
