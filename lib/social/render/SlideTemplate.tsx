'use client';

import type { Post, SlideCopy } from '@/lib/social/render/types';

export type SlideTemplateProps = {
  post: Post;
  position: number;
};

/**
 * Renders one slide of a Post. Same component drives the Hub preview pane
 * and the Playwright headless renderer — brand tokens are declared inside
 * the slide's CSS (see preview.css) so the component is portable to any
 * rendering context (Hub route, Vercel Sandbox, standalone HTML).
 *
 * Each layout variant is a separate sub-component so we can add cover /
 * quote / data / context / source-cta shapes without one mega switch.
 */
export function SlideTemplate({ post, position }: SlideTemplateProps) {
  const slide = post.slides[position];
  if (!slide) {
    return (
      <div
        className={`helios-slide helios-slide--${post.format}`}
        data-slide-missing="true"
      >
        <p>Slide {position} not found in this post.</p>
      </div>
    );
  }

  const commonProps = { post, slide };

  return (
    <div
      className={`helios-slide helios-slide--${post.format} helios-slide--${slide.layoutVariant}`}
      data-slide-ready="true"
      role="img"
      aria-label={slide.altText}
    >
      {slide.layoutVariant === 'cover_headline' && <CoverHeadline {...commonProps} />}
      {slide.layoutVariant === 'quote' && <QuoteSlide {...commonProps} />}
      {slide.layoutVariant === 'data_change' && <DataChangeSlide {...commonProps} />}
      {slide.layoutVariant === 'context' && <ContextSlide {...commonProps} />}
      {slide.layoutVariant === 'source_cta' && <SourceCta {...commonProps} />}
      <HeliosMark />
    </div>
  );
}

/* ── Variants ─────────────────────────────────────────────────────────── */

function CoverHeadline({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack">
      {slide.eyebrow && (
        <div className="helios-slide__eyebrow">{slide.eyebrow}</div>
      )}
      <h1 className="helios-slide__headline">{slide.headline}</h1>
      {slide.keyPhrase && (
        <div className="helios-slide__keyphrase">{slide.keyPhrase}</div>
      )}
      {slide.body && <p className="helios-slide__body">{slide.body}</p>}
    </div>
  );
}

function QuoteSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack">
      <div className="helios-slide__quote-mark" aria-hidden="true">
        &ldquo;
      </div>
      <p className="helios-slide__quote">{slide.headline}</p>
      {slide.attribution && (
        <div className="helios-slide__attribution">— {slide.attribution}</div>
      )}
    </div>
  );
}

function DataChangeSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack">
      {slide.eyebrow && (
        <div className="helios-slide__eyebrow">{slide.eyebrow}</div>
      )}
      {slide.keyPhrase && (
        <div className="helios-slide__data-figure">{slide.keyPhrase}</div>
      )}
      <h2 className="helios-slide__data-label">{slide.headline}</h2>
      {slide.body && <p className="helios-slide__body">{slide.body}</p>}
    </div>
  );
}

function ContextSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack">
      {slide.eyebrow && (
        <div className="helios-slide__eyebrow">{slide.eyebrow}</div>
      )}
      <h2 className="helios-slide__context-head">{slide.headline}</h2>
      {slide.body && <p className="helios-slide__body helios-slide__body--large">{slide.body}</p>}
    </div>
  );
}

function SourceCta({ post, slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack">
      {slide.eyebrow && (
        <div className="helios-slide__eyebrow helios-slide__eyebrow--ink">
          {slide.eyebrow}
        </div>
      )}
      <h2 className="helios-slide__source-head">Read the full story</h2>
      <div className="helios-slide__source-outlet">{post.source}</div>
      {slide.body && <p className="helios-slide__body">{slide.body}</p>}
    </div>
  );
}

/* ── Brand mark (protected, whole, unmodified) ────────────────────────── */

function HeliosMark() {
  return (
    <div className="helios-slide__mark" aria-hidden="true">
      <span className="helios-slide__wordmark">HELIOS</span>
    </div>
  );
}
