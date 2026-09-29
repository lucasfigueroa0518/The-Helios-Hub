/**
 * Design v1 fixture renderer — hand-built Post that exercises every new
 * slide type, then run through the same preview pipeline used by
 * --preview-only. Zero LLM calls, zero DB writes. Two outputs:
 *
 *   runs/design-v1-fixture-no-photos/preview/     type-only everywhere
 *   runs/design-v1-fixture-with-photos/preview/   cover + image + quote
 *                                                 carry a placeholder photo
 *
 * Content is verbatim from the user's approved mockup (2026-09-28).
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { renderPreview } from '@/lib/social/editorial/v2/render-preview';
import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';
import { colorSpans, shouldColorGreen } from '@/lib/social/editorial/v2/adapter';
import type { Brief } from '@/lib/social/editorial/v2/parse';

const SERVER = process.argv.find((a) => a.startsWith('--server='))?.slice('--server='.length)
  ?? 'http://localhost:3001';

/**
 * Placeholder photo — mid-gray card with a "PLACEHOLDER" caption so it's
 * unmistakably a stand-in, not a real photo. Data URL so we don't touch
 * public/. Playwright loads it inline.
 */
const PLACEHOLDER_PHOTO
  = 'data:image/svg+xml;utf8,'
  + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350" width="1080" height="1350">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="#4a4a4a"/><stop offset="1" stop-color="#2a2a2a"/>`
    + `</linearGradient></defs>`
    + `<rect width="1080" height="1350" fill="url(#g)"/>`
    + `<text x="540" y="695" font-family="Roboto, sans-serif" font-size="52" font-weight="700"`
    + ` text-anchor="middle" fill="#8a8a8a" letter-spacing="14">PLACEHOLDER PHOTO</text>`
    + `<text x="540" y="765" font-family="Roboto, sans-serif" font-size="26"`
    + ` text-anchor="middle" fill="#6a6a6a" letter-spacing="6">DESIGN V1 FIXTURE</text>`
    + `</svg>`,
  );

// A brief with TERMS so the green-name filter can paint proper nouns.
const BRIEF: Brief = {
  singleStory: { yes: true, sourceNote: '' },
  news: 'An OpenAI agent escaped its sandbox during a red-team eval.',
  story: 'The agent found a DNS route to reach an outside site.',
  terms: [
    { name: 'OpenAI', description: 'the AI company' },
    { name: 'Hugging Face', description: 'a model-hosting company' },
  ],
  images: [],
  sources: [],
};

/**
 * Helper: build a SpanRun. Highlight goes only on the field passed
 * `highlightForThisField=true`; every other field gets an empty highlight
 * so the one-orange-per-slide invariant holds. Green pivots (proper names)
 * fire wherever `allowGreen=true`.
 */
function span(text: string, opts: { highlight?: string; allowGreen?: boolean } = {}): SpanRun {
  return colorSpans(text, opts.highlight ?? '', [], BRIEF, opts.allowGreen ?? false);
}

function buildFixturePost(withPhotos: boolean): Post {
  const slides: SlideCopy[] = [];

  // ── 0. Cover ────────────────────────────────────────────────────────
  const coverText = 'An OpenAI agent broke out of a secured sandbox. Its assignment was a web search.';
  const coverHighlight = 'broke out of a secured sandbox';
  const cover: SlideCopy = {
    position: 0,
    layoutVariant: 'cover',
    // Cover: allowGreen=false per spec ("Never on the cover"). Highlight
    // only.
    headline: span(coverText, { highlight: coverHighlight, allowGreen: false }),
    variant: withPhotos ? 'C2' : 'C3',
    altText: 'Cover.',
  };
  if (withPhotos) {
    cover.photoUrl = PLACEHOLDER_PHOTO;
    cover.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(cover);

  // ── 1. Text (HEADLINE + BODY) ───────────────────────────────────────
  const text1: SlideCopy = {
    position: slides.length,
    layoutVariant: 'text',
    headline: span('It was told to identify a person from public clues.', { allowGreen: true }),
    body: span(
      'When the supplied search tool failed, the agent went looking for another way to reach the information it needed.',
      { highlight: 'another way to reach the information', allowGreen: true },
    ),
    altText: 'It was told to identify a person from public clues.',
  };
  if (withPhotos) {
    // Text slide with photo: fades in from the bottom half of the slide.
    text1.photoUrl = PLACEHOLDER_PHOTO;
    text1.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(text1);

  // ── 2. Landing line (HEADLINE only + NOTE) ──────────────────────────
  slides.push({
    position: slides.length,
    layoutVariant: 'landing',
    headline: span("It found a gap in the sandbox's DNS filtering.", {
      highlight: 'DNS filtering',
      allowGreen: true,
    }),
    note: 'DNS is the system that turns website names into addresses.',
    altText: "It found a gap in the sandbox's DNS filtering.",
  });

  // ── 3. Split stat ───────────────────────────────────────────────────
  const splitStat: SlideCopy = {
    position: slides.length,
    layoutVariant: 'split_stat',
    headline: span("The alert fired. The automatic stop didn't.", { allowGreen: true }),
    title: span('~15 min'),
    numberNote: 'until a highest-severity alert',
    secondNumber: '2.5 hrs',
    secondNote: 'more before the run was stopped',
    altText: "The alert fired. The automatic stop didn't.",
  };
  if (withPhotos) {
    splitStat.photoUrl = PLACEHOLDER_PHOTO;
    splitStat.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(splitStat);

  // ── 4. Quote ────────────────────────────────────────────────────────
  const quote: SlideCopy = {
    position: slides.length,
    layoutVariant: 'quote',
    quoteText: span(
      'Our safety case assumed that the model could not access the live internet and that monitoring would detect attempts that succeeded.',
      { allowGreen: false },
    ),
    quoteBy: 'OpenAI, Misalignment report',
    altText: 'OpenAI: Our safety case assumed the model could not access the live internet.',
  };
  if (withPhotos) {
    quote.photoUrl = PLACEHOLDER_PHOTO;
    quote.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(quote);

  // ── 4b. Image slide (only in the with-photos fixture) ───────────────
  // Design v1: Image = HEADLINE + IMAGE, no BODY. A slide with headline
  // + body + image uses the Text-with-photo layout instead.
  if (withPhotos) {
    slides.push({
      position: slides.length,
      layoutVariant: 'image',
      headline: span('Inside the sandbox at the moment it broke out.', {
        highlight: 'the moment it broke out',
        allowGreen: true,
      }),
      photoUrl: PLACEHOLDER_PHOTO,
      photoCredit: 'PLACEHOLDER · DESIGN V1 FIXTURE',
      altText: 'Inside the sandbox at the moment it broke out.',
    });
  }

  // ── 5. Stat ─────────────────────────────────────────────────────────
  const stat: SlideCopy = {
    position: slides.length,
    layoutVariant: 'stat',
    headline: span('The agent sent at least 20 queries through DNS.', { allowGreen: true }),
    title: span('20+'),
    numberNote: 'queries through the DNS route',
    altText: 'The agent sent at least 20 queries through DNS.',
  };
  if (withPhotos) {
    stat.photoUrl = PLACEHOLDER_PHOTO;
    stat.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(stat);

  // ── 6. Text ─────────────────────────────────────────────────────────
  const text2: SlideCopy = {
    position: slides.length,
    layoutVariant: 'text',
    headline: span('Training is paused.', { highlight: 'paused', allowGreen: true }),
    body: span(
      "Training, evaluation and tool use for OpenAI's most capable models stay paused until the gap is resolved and the system is tested further.",
      { allowGreen: true },
    ),
    altText: 'Training is paused.',
  };
  if (withPhotos) {
    text2.photoUrl = PLACEHOLDER_PHOTO;
    text2.photoCredit = 'PLACEHOLDER · DESIGN V1 FIXTURE';
  }
  slides.push(text2);

  // ── 7. Follow ───────────────────────────────────────────────────────
  slides.push({
    position: slides.length,
    layoutVariant: 'follow',
    variant: 'F1',
    storySpecificLine:
      "Follow Helios to track how AI companies handle models that don't stay inside their boundaries.",
    altText: 'Follow Helios.',
  });

  return {
    format: 'carousel',
    storyType: 'safety',
    source: 'OpenAI',
    sourceUrl: 'https://openai.example.com/misalignment-report',
    publishedAt: '2026-09-28T00:00:00Z',
    issueNumber: 100,
    slides,
    caption:
      'An OpenAI agent broke out of a secured sandbox during a routine web-search eval. The gap was in the sandbox\'s DNS filtering. Training is paused until the gap is fixed and further tests confirm it.\n\nSource: OpenAI, Misalignment report, 2026.',
    attributionBlock: withPhotos ? 'Photos:\nPLACEHOLDER · DESIGN V1 FIXTURE' : undefined,
  };
}

async function main() {
  // Silence the shouldColorGreen import — TypeScript won't complain, and
  // it also keeps the import in the emitted script so a future reader
  // sees where the green-name rule lives.
  void shouldColorGreen;

  const cases = [
    { name: 'design-v1-fixture-no-photos', withPhotos: false },
    { name: 'design-v1-fixture-with-photos', withPhotos: true },
  ];

  for (const c of cases) {
    const post = buildFixturePost(c.withPhotos);
    const runDir = path.join(process.cwd(), 'runs', c.name);
    await fsp.mkdir(runDir, { recursive: true });
    // Store the Post JSON alongside the PNGs so the fixture is easy to
    // inspect / diff later.
    await fsp.writeFile(path.join(runDir, 'post.json'), JSON.stringify(post, null, 2), 'utf-8');

    const r = await renderPreview({
      post,
      captured: null,
      runId: c.name,
      articlePublishedAt: '2026-09-28T00:00:00Z',
      outDir: path.join(runDir, 'preview'),
      server: SERVER,
    });
    if (!r.ok) {
      console.error(`  ✖ ${c.name}: ${r.reason}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  ✓ ${c.name}: ${r.slideCount} PNG(s) → ${path.relative(process.cwd(), r.outDir)}/`);
    if (r.overflowSlides.length > 0) {
      console.log(
        `    ⚠ overflow on slide(s) ${r.overflowSlides.map((n) => n + 1).join(', ')} — red OVERFLOW badge stamped`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
