import type { Post } from '@/lib/social/render/types';

/**
 * Hardcoded example post for renderer development. Modeled on the real
 * "OpenAI tests Sponsored Ads in ChatGPT" story that came through the
 * ingest — proves the renderer with a realistic packet before Phase 3b
 * (compose pipeline) starts feeding real data.
 */
export const EXAMPLE_POST_OPENAI_SPONSORED_ADS: Post = {
  format: 'carousel',
  storyType: 'platform_change',
  source: 'The Next Web',
  sourceUrl: 'https://thenextweb.com/news/openai-tests-sponsored-ads-chatgpt',
  publishedAt: '2026-09-16T14:32:00Z',
  slides: [
    {
      position: 0,
      layoutVariant: 'cover_headline',
      eyebrow: 'AI + ADVERTISING',
      headline: 'OpenAI is testing Sponsored Ads in ChatGPT.',
      keyPhrase: 'clearly labeled',
      body:
        'A new commerce experiment brings paid placements into ChatGPT '
        + 'conversations — distinct from organic answers, tagged to '
        + 'preserve trust.',
      altText:
        'Cover slide announcing OpenAI Sponsored Ads test in ChatGPT '
        + 'conversations. Green "AI + Advertising" eyebrow above a large '
        + 'headline; orange "clearly labeled" highlight; light body copy.',
    },
  ],
  caption:
    'OpenAI is experimenting with Sponsored Ads inside ChatGPT — the model '
    + 'that displaced ad-supported search now tries the same monetization '
    + 'lever from the other direction.\n\n'
    + 'Their pitch: ads will be clearly labeled and separated from the '
    + 'model’s organic answers, so users can tell the difference at a '
    + 'glance. Whether that trust survives the first ad-load quarter is '
    + 'the actual test.\n\n'
    + 'For marketers: this is a new placement that arrives with an already-'
    + 'engaged audience (~200M weekly). For platforms: another sign that '
    + 'the LLM stack is quietly rebuilding the ad ecosystem in its own image.\n\n'
    + 'via The Next Web',
};

export const FIXTURES: Record<string, Post> = {
  'example-post': EXAMPLE_POST_OPENAI_SPONSORED_ADS,
};
