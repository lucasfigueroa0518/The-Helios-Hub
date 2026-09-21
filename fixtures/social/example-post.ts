import type { Post } from '@/lib/social/render/types';

/**
 * Reference fixture: 5-slide chronological carousel drawn from a real
 * September 18, 2026 Anthropic announcement — the Accenture partnership on
 * embedded evaluation of frontier AI. Formula: Cover → 3 story-beats
 * (announcement / mechanism / marketer angle) → Follow.
 *
 * All facts (dates, dollar amounts, Faculty as Accenture's specialist arm,
 * the "embedded evaluator" concept) come directly from Anthropic's public
 * announcement page. Photos are the real article hero (Sanity CDN, downloaded
 * to public/social/) plus Anthropic's two related opengraph illustrations,
 * fetched via lib/social/ingest/extract-image.ts.
 *
 * Source: https://www.anthropic.com/news/accenture-embedded-evaluation
 */

// Real named-subject portraits (Wikipedia Commons, licensed for editorial use).
// Fetched via lib/social/ingest/extract-image.ts against Wikipedia's og:image.
const PHOTO_DARIO_AMODEI = '/social/dario-amodei.jpg';   // Anthropic CEO
const PHOTO_JULIE_SWEET = '/social/julie-sweet.jpg';      // Accenture CEO
// Anthropic's article hero (Sanity CDN — the wordmark card for the announcement).
const HERO_ANNOUNCEMENT = '/social/accenture-hero.jpg';
// Anthropic's opengraph-illustration API endpoints (procedural brand illustrations).
const PHOTO_MECHANISM = '/social/alignment-security.png';
const PHOTO_ENTERPRISE = '/social/enterprise-safeguards.png';

export const EXAMPLE_POST_ANTHROPIC_ACCENTURE: Post = {
  format: 'carousel',
  storyType: 'safety',
  source: 'Anthropic',
  sourceUrl: 'https://www.anthropic.com/news/accenture-embedded-evaluation',
  publishedAt: '2026-09-18T00:00:00Z',
  issueNumber: 43,
  slides: [
    {
      position: 0,
      layoutVariant: 'cover',
      headline: [
        { text: '$2 billion', role: 'hook' },
        { text: ' to embed auditors in frontier AI.', role: 'narrative' },
      ],
      photoUrl: PHOTO_DARIO_AMODEI,
      altText:
        'Cover slide: green SAFETY category label. Press portrait of Dario '
        + 'Amodei (Anthropic CEO) full-width. Below: uppercase headline '
        + '"Anthropic embeds evaluators inside its own AI." with the orange '
        + 'inline hook on "evaluators."',
    },
    {
      position: 1,
      layoutVariant: 'story_beat',
      title: [
        { text: '$2 billion, five years.', role: 'hook' },
      ],
      body: [
        { text: 'On ', role: 'narrative' },
        { text: 'September 18,', role: 'pivot' },
        { text: ' Anthropic announced a partnership with Accenture on independent evaluation of frontier AI.', role: 'narrative' },
      ],
      bodyBottom: [
        { text: 'Each party will invest at least ', role: 'narrative' },
        { text: '$1 billion', role: 'hook' },
        { text: ' over the next five years. ', role: 'narrative' },
        { text: 'Faculty,', role: 'pivot' },
        { text: ' Accenture\'s specialist AI arm, leads the work.', role: 'narrative' },
      ],
      photoUrl: HERO_ANNOUNCEMENT,
      photoCaption: 'ACCENTURE × ANTHROPIC · SEP 18',
      altText:
        'Story-beat 1 — the announcement. Orange title "$2 billion, five '
        + 'years." Body names September 18 (green pivot) and the $1 billion '
        + 'commitment (orange hook). Faculty named as Accenture\'s AI arm.',
    },
    {
      position: 2,
      layoutVariant: 'story_beat',
      title: [
        { text: 'Inside the training loop.', role: 'hook' },
      ],
      body: [
        { text: 'Embedded evaluators work ', role: 'narrative' },
        { text: 'inside Anthropic', role: 'hook' },
        { text: ' with access comparable to an employee\'s.', role: 'narrative' },
      ],
      bodyBottom: [
        { text: 'The scope: red-teaming models, alignment assessments, and testing safeguards while models are still being trained.', role: 'narrative' },
      ],
      photoUrl: PHOTO_MECHANISM,
      photoCaption: 'EMBEDDED EVALUATION',
      altText:
        'Story-beat 2 — the mechanism. Orange title "Inside the training '
        + 'loop." Body explains embedded evaluators work inside Anthropic '
        + '(orange hook) with employee-level access. Scope covers red-'
        + 'teaming, alignment, and safeguard testing during training.',
    },
    {
      position: 3,
      layoutVariant: 'story_beat',
      title: [
        { text: 'Enterprise, upstream.', role: 'hook' },
      ],
      body: [
        { text: 'Accenture', role: 'pivot' },
        { text: ' deploys AI for businesses and governments in production.', role: 'narrative' },
      ],
      bodyBottom: [
        { text: 'That perspective now shapes safety review at Anthropic ', role: 'narrative' },
        { text: 'before models ship', role: 'hook' },
        { text: '. Enterprise deployment context informs evaluation while models are being trained.', role: 'narrative' },
      ],
      photoUrl: PHOTO_JULIE_SWEET,
      photoCaption: 'JULIE SWEET · CEO ACCENTURE',
      altText:
        'Story-beat 3 — why it matters for marketers. Orange title '
        + '"Enterprise, upstream." Body names Accenture (green pivot) as an '
        + 'enterprise AI deployer whose context now shapes safety review '
        + 'before models ship (orange hook). Julie Sweet press portrait.',
    },
    {
      position: 4,
      layoutVariant: 'follow',
      altText:
        'Follow slide. HELIOS wordmark centered. Handle @heliosgroup.ai in '
        + 'orange mono. Green tagline strip: AI NEWS · DECODED · DAILY.',
    },
  ],
  caption:
    'Anthropic and Accenture announced a partnership on independent '
    + 'evaluation of frontier AI on September 18. Each party is committing '
    + 'at least $1 billion over five years.\n\n'
    + 'The concept is embedded evaluation. Auditors work inside AI '
    + 'companies with access comparable to an employee\'s, rather than '
    + 'external reviewers who only see finished models. Faculty, '
    + 'Accenture\'s specialist AI arm, leads the work — red-teaming '
    + 'models, alignment assessments, and testing safeguards during training.\n\n'
    + 'For marketers: Accenture brings enterprise deployment context into '
    + 'the safety review upstream of model release. How brands actually use '
    + 'frontier AI now shapes how that AI is evaluated while it\'s being built.\n\n'
    + 'via Anthropic · September 18, 2026',
};

export const FIXTURES: Record<string, Post> = {
  'example-post': EXAMPLE_POST_ANTHROPIC_ACCENTURE,
};
