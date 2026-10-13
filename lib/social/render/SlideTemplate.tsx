'use client';

import { useEffect, useRef } from 'react';

import { fitText } from '@/lib/social/render/text-fit';
import type { Post, SlideCanvas } from '@/lib/social/render/types';

import { IconBackground, PhotoCredit } from './drafts/blocks';
import { CoverSlidePremium } from './drafts/cover';
import { FollowSlidePremium } from './drafts/follow';
import { ImageSlidePremium } from './drafts/image';
import { LandingSlidePremium } from './drafts/landing';
import { QuoteSlidePremium } from './drafts/quote';
import { SplitStatSlidePremium } from './drafts/split-stat';
import { StatSlidePremium } from './drafts/stat';
import { TextSlidePremium } from './drafts/text';

export { SLIDE_CANVASES, type SlideCanvas } from '@/lib/social/render/types';

export type SlideTemplateProps = {
  post: Post;
  position: number;
  /** Overrides the slide's own canvas (the canvases preview page). Absent: the slide's `canvas`, else black. */
  canvas?: SlideCanvas;
};

/**
 * Renders one slide of a Post. Layout-system rules (Tommy, 2026-10-06; M8a),
 * the same on every layout:
 *
 *   1. Text fit: every text block is a region with a minimum font size
 *      (`data-fit-min`; its height is the CSS max-height). It shrinks until
 *      its longest word fits on one line and the block fits; no mid-word
 *      breaks. Still too big at the minimum → the render fails (fit-check).
 *   2. Contrast: text over a photo always sits on a dark scrim, either a
 *      gradient under the text block (`data-scrim="gradient"`) or the
 *      darkened background shade (`data-scrim="shade"`).
 *   3. Faces stay clear: a subject photo (a person or organization, or an
 *      article photo that may show people) only goes in its own region
 *      (split cover, text/landing photo band, the speaker's column).
 *      Full-bleed photos under text are scene or mood photos only.
 *
 * Every text field of the draft is drawn (M7 C7 fails the render otherwise).
 *
 * The slide designs (approved 2026-10-12, review studio at
 * /social/render/templates-review) live in ./drafts, one file per family:
 *   cover        cover-bleed · cover-split · cover-logo · cover-icon (cover.tsx picks the mode)
 *   text         headline + body; a photo band below or on top, or type only (top or low)
 *   landing      one punch line; optional photo strip, body and note
 *   stat         one big number; a scene photo is a darkened backdrop
 *   split_stat   two numbers in tension, the second is the hook colour
 *   quote        speaker column · photo backdrop · type only
 *   image        full-bleed scene, type as caption; spread = half of a panorama across two slides
 *   follow       closing slide
 * Every slide without a photo draws its icon background (photo spec §5), except cover and follow,
 * which place it themselves.
 */
export function SlideTemplate({ post, position, canvas: canvasProp }: SlideTemplateProps) {
  const ref = useRef<HTMLDivElement>(null);
  const slide = post.slides[position];
  const canvas: SlideCanvas = canvasProp ?? slide?.canvas ?? 'black';

  // Rule 1 in the browser preview: fit once fonts are in. The render-fit
  // check runs the same fitText headlessly and fails the render on misses.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) fitText(el);
    });
    return () => {
      cancelled = true;
    };
  }, [post, position]);

  if (!slide) {
    return (
      <div className={`helios-slide helios-slide--${post.format} helios-v2-slide`} data-slide-missing="true">
        <p>Slide {position} not found in this post.</p>
      </div>
    );
  }

  // Legacy aliases → design-v1 components.
  let kind: string = slide.layoutVariant === 'story_beat' ? 'text' : slide.layoutVariant === 'data_block' ? 'stat' : slide.layoutVariant;
  // A person photo framed for full bleed (photo spec §4) may sit under text like a scene photo.
  const scenePhoto = Boolean(slide.photoUrl) && (slide.photoKind !== 'subject' || slide.photoBleed === true);
  // Rule 3: full bleed under text only for a scene photo; a spread needs one too.
  if (slide.panoramaSide && scenePhoto && (kind === 'text' || kind === 'image' || kind === 'landing')) kind = 'spread';
  const textFromImage = kind === 'image' && !scenePhoto;
  if (textFromImage) kind = 'text';
  const fullBleed = kind === 'image' || kind === 'spread' || (kind === 'cover' && scenePhoto);
  const showWordmark = kind !== 'cover' && kind !== 'follow' && !fullBleed;
  // A subject photo that cannot go full bleed becomes a text slide with the photo on top; the legacy `title` is the headline when there is none.
  const textSlide = { ...slide, headline: slide.headline ?? slide.title, ...(textFromImage ? { photoPlacement: 'top' as const } : {}) };

  return (
    <div
      ref={ref}
      className={`helios-slide helios-slide--${post.format} helios-slide--${kind} helios-v2-slide`}
      data-slide-ready="true"
      data-canvas={canvas === 'black' ? undefined : canvas}
      data-variant={slide.variant ?? undefined}
      role="img"
      aria-label={slide.altText}
    >
      {!slide.photoUrl && kind !== 'cover' && kind !== 'follow' && <IconBackground slide={slide} />}
      {showWordmark && (
        <div className="helios-masthead helios-masthead--minimal" aria-hidden="true">
          <div className="helios-masthead__wordmark">HELIOS</div>
        </div>
      )}
      <div className="helios-slide__well">
        {kind === 'cover' && <CoverSlidePremium slide={slide} />}
        {kind === 'text' && <TextSlidePremium slide={textSlide} />}
        {kind === 'landing' && <LandingSlidePremium slide={slide} />}
        {kind === 'stat' && <StatSlidePremium slide={slide} />}
        {kind === 'split_stat' && <SplitStatSlidePremium slide={slide} />}
        {kind === 'quote' && <QuoteSlidePremium slide={slide} />}
        {kind === 'image' && <ImageSlidePremium slide={slide} />}
        {kind === 'spread' && <ImageSlidePremium slide={slide} spread={slide.panoramaSide} />}
        {kind === 'follow' && <FollowSlidePremium slide={slide} />}
      </div>
      {slide.photoUrl && kind !== 'follow' && <PhotoCredit credit={slide.photoCredit} />}
    </div>
  );
}
