/**
 * Saved article HTML for offline page-reader tests. Shapes copied from real
 * outlet markup patterns (credit in its own element; agency credit inline
 * in the caption; company "courtesy" credit; no caption at all). Text is
 * invented filler.
 */

const paragraphs = (lead: string) =>
  [
    lead,
    'The announcement came during a briefing on Thursday afternoon, where officials took questions for nearly an hour.',
    'Several people familiar with the plans said the details had been worked out over the past month.',
    'Critics said the move raised questions that the company had not yet answered, and asked for more detail on timing.',
    'The company said it would publish further information in the coming weeks, according to a spokesperson.',
  ]
    .map((p) => `<p>${p}</p>`)
    .join('\n');

export const LEAD_SENTENCE = 'Northwind Labs said on Thursday that it will open its model weights to outside researchers, a reversal of its earlier policy.';

/** Credit in its own element inside the figcaption; srcset; og:image; published time. */
export const PAGE_CREDIT_ELEMENT = `<!doctype html><html><head>
<title>Northwind Labs opens its model | Example Tech</title>
<meta property="og:image" content="https://cdn.example.com/og/northwind-share.jpg">
<meta property="article:published_time" content="2026-10-03T14:00:00Z">
</head><body><main><article>
<h1>Northwind Labs opens its model</h1>
<p class="byline">By Ana Reyes</p>
${paragraphs(LEAD_SENTENCE)}
<figure>
  <img src="/img/ceo-small.jpg" srcset="/img/ceo-600.jpg 600w, /img/ceo-1600.jpg 1600w" alt="Dana Whitlock on stage">
  <figcaption>Northwind Labs CEO Dana Whitlock at the company's developer event in Seattle. <span class="credit">Photo: Lee Park for Example Tech</span></figcaption>
</figure>
${paragraphs('A second section adds more detail about the license and who can apply for access to the weights.')}
</article></main></body></html>`;

/** Agency credit written at the end of the caption text (the ABC/AFP case in spec §5.1). */
export const PAGE_AGENCY_INLINE = `<!doctype html><html><head><title>Task force announced</title></head><body><article>
<h1>Task force announced</h1>
${paragraphs('The White House announced a new task force on artificial intelligence on Friday, naming two officials to lead it.')}
<figure>
  <img src="https://images.example.com/wh.jpg" alt="">
  <figcaption>Vice President JD Vance speaks at the White House. Kent Nishimura/AFP via Getty Images</figcaption>
</figure>
<figure>
  <img src="https://images.example.com/capitol.jpg" alt="The Capitol">
  <figcaption>The Capitol on Thursday. J. Scott Applewhite/AP</figcaption>
</figure>
</article></body></html>`;

/** Company "courtesy" credit; labelled credit after a caption that says "image"; a figure with no caption. */
export const PAGE_COMPANY_PHOTOS = `<!doctype html><html><head><title>The new chip</title></head><body><article>
<h1>The new chip</h1>
${paragraphs('Northwind Labs showed its first custom chip on Wednesday, saying it would ship to data centers next year.')}
<figure>
  <img data-src="https://press.example.com/chip.jpg" alt="The chip">
  <figcaption>The Northwind N1 chip on display at the launch. Courtesy of Northwind Labs</figcaption>
</figure>
<figure>
  <img src="https://press.example.com/arm.jpg" alt="Robot arm">
  <figcaption>An image of the robot arm used in the lab demo. Photo: Google</figcaption>
</figure>
<figure>
  <img src="https://press.example.com/plain.jpg" alt="">
</figure>
</article></body></html>`;

/**
 * TechCrunch shape (2026-10-04): no <article>; the hero figure sits outside
 * <main>; its figcaption is a credit only ("Image Credits: …"). A figure in
 * the nav must be ignored.
 */
export const PAGE_HERO_OUTSIDE_MAIN = `<!doctype html><html><head><title>Hero outside main</title></head><body>
<meta property="og:image" content="https://cdn.example.com/hero.jpg?w=1200">
<nav><figure><img src="https://cdn.example.com/logo.png" alt="logo"><figcaption>Logo</figcaption></figure></nav>
<header class="article-hero">
  <figure><img src="https://cdn.example.com/site-lockup.svg" alt=""></figure>
  <figure class="wp-block-post-featured-image">
    <img src="https://cdn.example.com/hero.jpg" alt="President speaking">
    <figcaption class="wp-block-post-featured-image__caption">Image Credits: Kevin Dietsch / Staff / Getty Images</figcaption>
  </figure>
</header>
<main>
${paragraphs('The president announced the formation of a new task force on Sunday, naming its leader in a short statement.')}
</main></body></html>`;
