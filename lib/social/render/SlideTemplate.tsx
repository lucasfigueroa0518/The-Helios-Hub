'use client';

import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';
import { CATEGORY_LABELS } from '@/lib/social/render/types';

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
 * Each of the six archetypes from the helios-social-design spec is its own
 * sub-component. Publication chrome (category label + HELIOS wordmark) is
 * inline — two absolutely-positioned marks are not a component worth its
 * own file.
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

  const lightMod = slide.lightCanvas ? ' helios-slide--light' : '';
  const category = CATEGORY_LABELS[post.storyType] ?? 'TECH';
  const showCategory = slide.layoutVariant !== 'cover' && slide.layoutVariant !== 'follow';
  const showWordmark = slide.layoutVariant !== 'follow';

  return (
    <div
      className={
        `helios-slide helios-slide--${post.format}`
        + ` helios-slide--${slide.layoutVariant}${lightMod}`
      }
      data-slide-ready="true"
      role="img"
      aria-label={slide.altText}
    >
      {showCategory && (
        <div className="helios-chrome__category" aria-hidden="true">{category}</div>
      )}
      {showWordmark && (
        <div className="helios-chrome__mark" aria-hidden="true">HELIOS</div>
      )}
      <div className="helios-slide__well">
        {slide.layoutVariant === 'cover' && <CoverSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'story_beat' && <StoryBeatSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'source' && <SourceSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'follow' && <FollowSlide post={post} slide={slide} />}
      </div>
    </div>
  );
}

/* ── Span rendering ───────────────────────────────────────────────────── */

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

/* ── Cover (archetype 1) ──────────────────────────────────────────────── */

function CoverSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  const category = CATEGORY_LABELS[post.storyType] ?? 'TECH';
  const photoBleed = Boolean(slide.photoUrl);
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
        </>
      )}
      <div className="helios-cover__foreground">
        <div className="helios-cover__pill">{category}</div>
        <h1 className="helios-cover__headline">
          <SpanRunView run={slide.headline} />
        </h1>
        <div className="helios-cover__arrow" aria-hidden="true">→</div>
      </div>
    </div>
  );
}

/* ── Story-beat (archetype 2) ─────────────────────────────────────────── */

function StoryBeatSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-beat">
      {slide.title && (
        <h2 className="helios-beat__title">
          <SpanRunView run={slide.title} />
        </h2>
      )}
      {slide.body && (
        <p className="helios-beat__body helios-beat__body--top">
          <SpanRunView run={slide.body} />
        </p>
      )}
      {slide.photoUrl && (
        <figure className="helios-beat__figure">
          <img
            className="helios-beat__photo"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          {slide.photoCaption && (
            <figcaption className="helios-beat__caption">
              {slide.photoCaption}
            </figcaption>
          )}
        </figure>
      )}
      {slide.bodyBottom && (
        <p className="helios-beat__body helios-beat__body--bottom">
          <SpanRunView run={slide.bodyBottom} />
        </p>
      )}
      <div className="helios-beat__arrow" aria-hidden="true">→</div>
    </div>
  );
}

/* ── Source (archetype 5) ─────────────────────────────────────────────── */

function SourceSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-source">
      <div className="helios-source__label">THE SOURCE</div>
      <h2 className="helios-source__outlet">{post.source}.</h2>
      {slide.body && (
        <p className="helios-source__teaser">
          <SpanRunView run={slide.body} />
        </p>
      )}
      <div className="helios-source__cta">
        FULL STORY IN BIO <span aria-hidden="true">→</span>
      </div>
      {slide.photoUrl && (
        <img
          className="helios-source__photo"
          src={slide.photoUrl}
          alt=""
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/* ── Follow (archetype 6) ─────────────────────────────────────────────── */

function FollowSlide(_props: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-slide__stack helios-slide__stack--follow">
      <div className="helios-slide__follow-lockup">
        <span className="helios-slide__follow-rule" aria-hidden="true" />
        <span className="helios-slide__follow-wordmark">HELIOS</span>
        <span className="helios-slide__follow-rule" aria-hidden="true" />
      </div>
      <div className="helios-slide__follow-handle">
        <span className="helios-slide__follow-plus" aria-hidden="true">+</span>
        <span className="helios-slide__follow-handle-text">@heliosgroup.ai</span>
      </div>
      <div className="helios-slide__follow-tagline">AI NEWS · DECODED · DAILY</div>
    </div>
  );
}
