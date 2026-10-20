'use client';

import { useEffect, useRef } from 'react';

import { markRuns } from '@/lib/lfd/marks';
import { LFD_HOOK_LINES, LFD_KICKER } from '@/lib/lfd/post';
import { fitText } from '@/lib/social/render/text-fit';
import type { Post, SlideCanvas, SlideCopy } from '@/lib/social/render/types';

import { Fit, IconBackground, PhotoCredit, focusStyle } from './drafts/blocks';
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
  const lfd = kind === 'lfd_cover' || kind === 'lfd_story';
  const showWordmark = kind !== 'cover' && kind !== 'follow' && !fullBleed && !lfd;
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
      {!slide.photoUrl && kind !== 'cover' && kind !== 'follow' && !lfd && <IconBackground slide={slide} />}
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
        {kind === 'lfd_cover' && <LfdCoverSlide slide={slide} />}
        {kind === 'lfd_story' && <LfdStorySlide slide={slide} />}
      </div>
      {slide.photoUrl && kind !== 'follow' && !lfd && <PhotoCredit credit={slide.photoCredit} />}
    </div>
  );
}

/* ── Last Few Days (spec §6; template: Claude outputs/last-few-days-template/) ── */

const LFD_MIN = { setup: 34, headline: 42, body: 31 } as const;

function LfdArrow() {
  return (
    <svg className="lfd-swipe" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function LfdMarked({ text, highlight, names }: { text: string; highlight: string; names: string[] }) {
  return (
    <>
      {markRuns(text, highlight, names).map((r, i) => (r.mark ? <span key={i} className={r.mark === 'hl' ? 'lfd-hl' : 'lfd-name'}>{r.text}</span> : <span key={i}>{r.text}</span>))}
    </>
  );
}

/** A logo, whole, on a light plate (mirrors RegionPhoto's logo treatment): never cropped like a photo. */
function LfdLogo({ src }: { src: string }) {
  return (
    <div className="lfd-logo-plate">
      <img className="lfd-logo" src={src} alt="" data-photo-kind="logo" />
    </div>
  );
}

function LfdCoverSlide({ slide }: { slide: SlideCopy }) {
  const meme = slide.lfdCover?.meme;
  if (meme) {
    return (
      <div className="lfd-cover lfd-cover--meme">
        <div className="lfd-cover-meme"><img className="lfd-meme" src={meme.url} alt="" data-photo-kind="meme" /></div>
        <div className="lfd-brand-rule"><span>HELIOS</span></div>
        <div className="lfd-cover-copy">
          <h1 className="lfd-hook">{LFD_HOOK_LINES.map((line) => <span key={line}>{line}</span>)}</h1>
          <p className="lfd-kicker">{LFD_KICKER}</p>
        </div>
        <LfdArrow />
      </div>
    );
  }
  const photos = (slide.lfdCover?.photos ?? []).slice(0, 6);
  return (
    <div className="lfd-cover">
      <div className="lfd-mosaic" data-count={photos.length}>
        {photos.map((p, i) => (
          <div className="lfd-tile" key={i}>
            {p.kind === 'logo' ? <LfdLogo src={p.url} /> : <img className="lfd-img" src={p.url} alt="" style={p.focus ? { objectPosition: `${Math.round(p.focus.x * 100)}% ${Math.round(p.focus.y * 100)}%` } : undefined} />}
          </div>
        ))}
      </div>
      <div className="lfd-brand-rule"><span>HELIOS</span></div>
      <div className="lfd-cover-copy">
        <h1 className="lfd-hook">{LFD_HOOK_LINES.map((line) => <span key={line}>{line}</span>)}</h1>
        <p className="lfd-kicker">{LFD_KICKER}</p>
      </div>
      <LfdArrow />
    </div>
  );
}

function LfdStorySlide({ slide }: { slide: SlideCopy }) {
  const s = slide.lfdStory;
  if (!s) return null;
  return (
    <div className="lfd-story">
      <div className="lfd-chip"><img src="/social/helios-mark.png" alt="" /><span>Helios</span></div>
      <div className="lfd-story-body">
        <div className="lfd-text">
          {s.setup && <Fit as="p" className="lfd-setup" min={LFD_MIN.setup}><LfdMarked text={s.setup} highlight="" names={s.names} /></Fit>}
          <Fit as="h2" className="lfd-headline" min={LFD_MIN.headline}><span className="lfd-clip">– <LfdMarked text={s.headline} highlight={s.highlight} names={s.names} /></span></Fit>
          <Fit as="p" className="lfd-body" min={LFD_MIN.body}><LfdMarked text={s.body} highlight="" names={s.names} /></Fit>
        </div>
        <div className="lfd-media">
          {slide.photoUrl &&
            (slide.photoKind === 'logo' ? (
              <LfdLogo src={slide.photoUrl} />
            ) : slide.photoKind === 'meme' ? (
              <div className="lfd-meme-plate"><img className="lfd-meme" src={slide.photoUrl} alt="" data-photo-kind="meme" /></div>
            ) : (
              <img className="lfd-img" src={slide.photoUrl} alt="" style={focusStyle(slide)} />
            ))}
        </div>
      </div>
      <LfdArrow />
    </div>
  );
}
