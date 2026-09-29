'use client';

import type { ReactNode } from 'react';

import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';

export type SlideTemplateProps = {
  post: Post;
  position: number;
};

/**
 * Renders one slide of a Post per docs/DESIGN-V1-HANDOFF.md.
 *
 * Design v1 slide types (field-driven by the adapter):
 *   cover        — unchanged CoverSlide
 *   text         — HEADLINE (top, uppercase Pragmatica) + BODY (44px fixed)
 *   landing      — HEADLINE only, centered, giant Pragmatica; optional NOTE
 *   stat         — HEADLINE top, BIG NUMBER + NUMBER NOTE bottom, optional photo
 *   split_stat   — HEADLINE top, two numbers side-by-side above hairline
 *   quote        — orange opening mark + quote + attribution, optional round photo
 *   image        — cover-style full-bleed photo, headline + body bottom-anchored
 *   follow       — unchanged FollowSlide
 *
 * Legacy aliases (renderer routes them to the closest v1 component so
 * pre-v1 fixtures + the legacy pipeline still render):
 *   story_beat   → TextSlide
 *   data_block   → StatSlide
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

  const isFollow = slide.layoutVariant === 'follow';
  const isCover = slide.layoutVariant === 'cover';
  // Full-bleed image slides share the cover's chrome-suppression rule (the
  // photo bleeds to the edges; wordmark would collide with it).
  const isImageBleed = slide.layoutVariant === 'image' && Boolean(slide.photoUrl);
  const showTopWordmark = !isCover && !isFollow && !isImageBleed;

  // Route legacy aliases to design-v1 components.
  const kind = slide.layoutVariant === 'story_beat' ? 'text'
    : slide.layoutVariant === 'data_block' ? 'stat'
    : slide.layoutVariant;

  return (
    <div
      className={
        `helios-slide helios-slide--${post.format}`
        + ` helios-slide--${kind}`
      }
      data-slide-ready="true"
      data-variant={slide.variant ?? undefined}
      role="img"
      aria-label={slide.altText}
    >
      {showTopWordmark && (
        <div className="helios-masthead helios-masthead--minimal" aria-hidden="true">
          <div className="helios-masthead__wordmark">HELIOS</div>
        </div>
      )}
      <div className="helios-slide__well">
        {kind === 'cover' && <CoverSlide post={post} slide={slide} />}
        {kind === 'text' && <TextSlide slide={slide} />}
        {kind === 'landing' && <LandingSlide slide={slide} />}
        {kind === 'stat' && <StatSlide slide={slide} />}
        {kind === 'split_stat' && <SplitStatSlide slide={slide} />}
        {kind === 'quote' && <QuoteSlide slide={slide} />}
        {kind === 'image' && <ImageSlide slide={slide} />}
        {kind === 'follow' && <FollowSlide slide={slide} />}
      </div>
    </div>
  );
}

/* ── Spans ────────────────────────────────────────────────────────── */

function SpanRunView({ run }: { run: SpanRun | undefined }) {
  if (!run) return null;
  return (
    <>
      {run.map((span, i) => (
        <span key={i} className={`helios-span helios-span--${span.role}`}>
          {span.text}
        </span>
      ))}
    </>
  );
}

/* ── Cover (unchanged from prior render) ──────────────────────────── */

function CoverSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  void post;
  const photoBleed = Boolean(slide.photoUrl);
  const chars = (slide.headline ?? []).reduce((n, s) => n + s.text.length, 0);
  const lengthBucket = chars <= 40 ? 'xs'
    : chars <= 70 ? 'sm'
    : chars <= 100 ? 'md'
    : chars <= 140 ? 'lg'
    : 'xl';
  return (
    <div className={`helios-cover${photoBleed ? ' helios-cover--bleed' : ''}`}>
      {photoBleed && (
        <>
          <img
            className="helios-cover__bg"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          <div className="helios-cover__scrim" aria-hidden="true" />
          <div className="helios-cover__scrim--bottom" aria-hidden="true" />
        </>
      )}
      <div className="helios-cover__foreground">
        <h1
          className="helios-cover__headline"
          data-length={lengthBucket}
        >
          <SpanRunView run={slide.headline} />
        </h1>
        <div className="helios-cover__chevron" aria-hidden="true">→</div>
      </div>
    </div>
  );
}

/* ── Text (HEADLINE + BODY, top-anchored) ─────────────────────────── */

function TextSlide({ slide }: { slide: SlideCopy }) {
  const headlineChars = (slide.headline ?? slide.title ?? []).reduce((n, s) => n + s.text.length, 0);
  const headlineBucket = headlineChars <= 30 ? 'xs'
    : headlineChars <= 45 ? 'sm'
    : headlineChars <= 60 ? 'md'
    : 'lg';
  // Prefer `headline`; fall back to legacy `title` so old fixtures render.
  const headlineRun = slide.headline ?? slide.title;
  const bodyRun = slide.body ?? slide.bodyBottom;
  const hasPhoto = Boolean(slide.photoUrl);
  return (
    <div className={`helios-text${hasPhoto ? ' helios-text--with-photo' : ''}`}>
      {headlineRun && (
        <h2 className="helios-text__headline" data-length={headlineBucket}>
          <SpanRunView run={headlineRun} />
        </h2>
      )}
      {bodyRun && (
        <p className="helios-text__body">
          <SpanRunView run={bodyRun} />
        </p>
      )}
      {hasPhoto && (
        <div className="helios-text__photo-frame" aria-hidden="true">
          <img className="helios-text__photo" src={slide.photoUrl} alt="" />
        </div>
      )}
    </div>
  );
}

/* ── Landing (HEADLINE only, centered) ────────────────────────────── */

function LandingSlide({ slide }: { slide: SlideCopy }) {
  const chars = (slide.headline ?? []).reduce((n, s) => n + s.text.length, 0);
  const bucket = chars <= 30 ? 'xs'
    : chars <= 50 ? 'sm'
    : 'md';
  return (
    <div className="helios-landing">
      {slide.headline && (
        <h2 className="helios-landing__line" data-length={bucket}>
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {slide.note && (
        <div className="helios-landing__note">{slide.note}</div>
      )}
    </div>
  );
}

/* ── Stat (headline top, big number + note bottom) ────────────────── */

function StatSlide({ slide }: { slide: SlideCopy }) {
  const number = slide.title;
  const numberLen = number?.reduce((n, s) => n + s.text.length, 0) ?? 0;
  const hasPhoto = Boolean(slide.photoUrl);
  return (
    <div className="helios-stat">
      {slide.headline && (
        <h2 className="helios-stat__headline">
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {slide.body && (
        <p className="helios-stat__body">
          <SpanRunView run={slide.body} />
        </p>
      )}
      {hasPhoto && (
        <img className="helios-stat__photo" src={slide.photoUrl} alt="" aria-hidden="true" />
      )}
      <div className="helios-stat__number-block">
        {number && (
          <div className="helios-stat__number" data-length={numberLen}>
            <SpanRunView run={number} />
          </div>
        )}
        {slide.numberNote && (
          <div className="helios-stat__number-note">{slide.numberNote}</div>
        )}
      </div>
    </div>
  );
}

/* ── Split stat (two numbers side-by-side above hairline) ─────────── */

function SplitStatSlide({ slide }: { slide: SlideCopy }) {
  const leftNumber = slide.title;
  const leftLen = leftNumber?.reduce((n, s) => n + s.text.length, 0) ?? 0;
  const rightLen = (slide.secondNumber ?? '').length;
  const hasPhoto = Boolean(slide.photoUrl);
  const headlineChars = (slide.headline ?? []).reduce((n, s) => n + s.text.length, 0);
  const headlineBucket = headlineChars <= 30 ? 'xs'
    : headlineChars <= 45 ? 'sm'
    : headlineChars <= 60 ? 'md'
    : 'lg';
  return (
    <div className="helios-split-stat">
      {slide.headline && (
        <h2 className="helios-split-stat__headline" data-length={headlineBucket}>
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {hasPhoto && (
        <img className="helios-split-stat__photo" src={slide.photoUrl} alt="" aria-hidden="true" />
      )}
      <div className="helios-split-stat__pair">
        <div className="helios-split-stat__col">
          {leftNumber && (
            <div className="helios-split-stat__number helios-split-stat__number--left" data-length={leftLen}>
              <SpanRunView run={leftNumber} />
            </div>
          )}
          {slide.numberNote && (
            <div className="helios-split-stat__note">{slide.numberNote}</div>
          )}
        </div>
        <div className="helios-split-stat__rule" aria-hidden="true" />
        <div className="helios-split-stat__col">
          {slide.secondNumber && (
            <div className="helios-split-stat__number helios-split-stat__number--right" data-length={rightLen}>
              {slide.secondNumber}
            </div>
          )}
          {slide.secondNote && (
            <div className="helios-split-stat__note">{slide.secondNote}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Quote (orange opening mark + quote + attribution) ────────────── */

function QuoteSlide({ slide }: { slide: SlideCopy }) {
  const quoteRun = slide.quoteText ?? slide.body;
  const showSpeakerPhoto = Boolean(slide.photoUrl);
  return (
    <div className="helios-quote">
      {showSpeakerPhoto && (
        <img className="helios-quote__speaker" src={slide.photoUrl} alt="" aria-hidden="true" />
      )}
      <div className="helios-quote__glyph" aria-hidden="true">&ldquo;</div>
      {quoteRun && (
        <blockquote className="helios-quote__text">
          <SpanRunView run={quoteRun} />
        </blockquote>
      )}
      {slide.quoteBy && (
        <div className="helios-quote__attribution">
          <span aria-hidden="true">— </span>
          {slide.quoteBy}
        </div>
      )}
    </div>
  );
}

/* ── Image (cover-style full-bleed mid-carousel) ──────────────────── */

/**
 * Reuses the cover's full-bleed photo treatment: photo fills the slide,
 * darkened by the scrim, headline anchored bottom. Shares the CSS
 * `.helios-cover__bg / __scrim / __scrim--bottom` classes so the
 * treatment stays visually consistent with the cover. Optional body
 * sits under the headline. Cover's own component/output are untouched.
 */
function ImageSlide({ slide }: { slide: SlideCopy }) {
  const hasPhoto = Boolean(slide.photoUrl);
  return (
    <div className={`helios-image${hasPhoto ? ' helios-image--bleed' : ''}`}>
      {hasPhoto && (
        <>
          <img
            className="helios-cover__bg"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          <div className="helios-cover__scrim" aria-hidden="true" />
          <div className="helios-cover__scrim--bottom" aria-hidden="true" />
        </>
      )}
      <div className="helios-image__foreground">
        {slide.headline && (
          <h2 className="helios-image__headline">
            <SpanRunView run={slide.headline} />
          </h2>
        )}
        {slide.body && (
          <p className="helios-image__body">
            <SpanRunView run={slide.body} />
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Follow (redesigned) ──────────────────────────────────────────── */

/**
 * Follow slide layout (design v1.1):
 *   - Helios sun-mark logo centered in the upper half, ~420px across,
 *     with clear space at least the height of its "H" on every side.
 *   - Story-tied line in Pragmatica Extended Bold uppercase, ~64px,
 *     white — with "Follow Helios" in orange.
 *   - @heliosgroup.ai in Roboto, ~40px, white 70%.
 */
function FollowSlide({ slide }: { slide: SlideCopy }) {
  const storyLine = slide.storySpecificLine?.trim() ?? '';
  return (
    <div className="helios-follow">
      <img
        className="helios-follow__mark"
        src="/social/helios-mark.png"
        alt="Helios"
      />
      {storyLine && (
        <div className="helios-follow__story-line">
          {renderFollowLine(storyLine)}
        </div>
      )}
      <div className="helios-follow__handle">@heliosgroup.ai</div>
    </div>
  );
}

/**
 * Split a follow line so any "Follow Helios" substring renders orange.
 * Case-insensitive match. Falls back to plain text if the phrase isn't
 * in the string (older story lines).
 */
function renderFollowLine(line: string): ReactNode {
  const idx = line.toLowerCase().indexOf('follow helios');
  if (idx < 0) return line;
  const before = line.slice(0, idx);
  const match = line.slice(idx, idx + 'follow helios'.length);
  const after = line.slice(idx + 'follow helios'.length);
  return (
    <>
      {before}
      <span className="helios-follow__cta">{match}</span>
      {after}
    </>
  );
}
