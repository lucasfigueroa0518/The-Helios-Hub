'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

import { fitText } from '@/lib/social/render/text-fit';
import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';

export type SlideTemplateProps = {
  post: Post;
  position: number;
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
 *      (split cover, split text/landing slide, the speaker's round spot).
 *      Full-bleed photos under text are scene or mood photos only.
 *
 * Every text field of the draft is drawn (M7 C7 fails the render otherwise).
 *
 * Layouts:
 *   cover        no photo · scene full-bleed + scrim · subject split (photo top, headline below)
 *   text         headline + body; a photo takes its own region below or on top (split)
 *   landing      headline + body; photo region below
 *   stat         headline + body + big number; a scene photo is a darkened background
 *   split_stat   two numbers; same background rule
 *   quote        headline, the speaker's verified photo in the round spot (else a
 *                darkened background), quote, speaker, body
 *   image        full-bleed scene + scrim (a subject photo renders as a split text slide)
 *   spread       one wide scene photo across two slides (panoramaSide), text on a scrim
 *   follow       closing slide
 */
export function SlideTemplate({ post, position }: SlideTemplateProps) {
  const ref = useRef<HTMLDivElement>(null);
  const slide = post.slides[position];

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
      <div className={`helios-slide helios-slide--${post.format}`} data-slide-missing="true">
        <p>Slide {position} not found in this post.</p>
      </div>
    );
  }

  // Legacy aliases → design-v1 components.
  let kind: string = slide.layoutVariant === 'story_beat' ? 'text' : slide.layoutVariant === 'data_block' ? 'stat' : slide.layoutVariant;
  const scenePhoto = Boolean(slide.photoUrl) && slide.photoKind !== 'subject';
  // Rule 3: full bleed under text only for a scene photo; a spread needs one too.
  if (slide.panoramaSide && scenePhoto && (kind === 'text' || kind === 'image' || kind === 'landing')) kind = 'spread';
  const textFromImage = kind === 'image' && !scenePhoto;
  if (textFromImage) kind = 'text';
  const fullBleed = kind === 'image' || kind === 'spread' || (kind === 'cover' && scenePhoto);
  const showWordmark = kind !== 'cover' && kind !== 'follow' && !fullBleed;
  const textSlide = textFromImage ? { ...slide, photoPlacement: 'top' as const } : slide;

  return (
    <div
      ref={ref}
      className={`helios-slide helios-slide--${post.format} helios-slide--${kind}`}
      data-slide-ready="true"
      data-variant={slide.variant ?? undefined}
      role="img"
      aria-label={slide.altText}
    >
      {showWordmark && (
        <div className="helios-masthead helios-masthead--minimal" aria-hidden="true">
          <div className="helios-masthead__wordmark">HELIOS</div>
        </div>
      )}
      <div className="helios-slide__well">
        {kind === 'cover' && <CoverSlide slide={slide} />}
        {kind === 'text' && <TextSlide slide={textSlide} />}
        {kind === 'landing' && <LandingSlide slide={slide} />}
        {kind === 'stat' && <StatSlide slide={slide} />}
        {kind === 'split_stat' && <SplitStatSlide slide={slide} />}
        {kind === 'quote' && <QuoteSlide slide={slide} />}
        {kind === 'image' && <ImageSlide slide={slide} />}
        {kind === 'spread' && <ImageSlide slide={slide} spread={slide.panoramaSide} />}
        {kind === 'follow' && <FollowSlide slide={slide} />}
      </div>
      {slide.photoUrl && kind !== 'follow' && <PhotoCredit credit={slide.photoCredit} />}
    </div>
  );
}

/* ── Building blocks ──────────────────────────────────────────────── */

/** Minimum font sizes (px) per text role: the floor for rule 1. */
const MIN = { headline: 44, cover: 48, body: 28, number: 52, splitNumber: 40, note: 22, quote: 36, by: 18, landing: 52 } as const;

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

/** A text region (rule 1). */
function Fit({ as: Tag = 'div', className, min, children }: { as?: 'div' | 'h1' | 'h2' | 'p' | 'blockquote'; className: string; min: number; children: ReactNode }) {
  return (
    <Tag className={className} data-fit-min={min}>
      {children}
    </Tag>
  );
}

/** Crop centred on the detected face (M8b), else the centre. */
function focusStyle(slide: SlideCopy): CSSProperties | undefined {
  const f = slide.photoFocus;
  if (!f) return undefined;
  const pos: CSSProperties = { objectPosition: `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%` };
  // A narrowed window (face-size zoom limit): a smaller photo, centred, never bands.
  return f.windowW ? { ...pos, width: `${f.windowW}px`, flex: 'none', alignSelf: 'center' } : pos;
}

/** A photo in its own region (rule 3: the only place a subject photo goes). */
function RegionPhoto({ slide, className }: { slide: SlideCopy; className: string }) {
  const style = focusStyle(slide);
  // The cover photo is absolutely positioned: centre a narrowed window by its left edge.
  const cover = className === 'helios-cover__photo' && slide.photoFocus?.windowW ? { left: `${Math.round((1080 - slide.photoFocus.windowW) / 2)}px` } : undefined;
  return <img className={`helios-photo ${className}`} src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={slide.photoKind ?? 'scene'} style={{ ...style, ...cover }} />;
}

/** A full-bleed scene photo under a gradient-scrimmed text block (rules 2 + 3). */
function BleedPhoto({ slide, spread }: { slide: SlideCopy; spread?: 'left' | 'right' }) {
  const cls = spread ? `helios-bleed__photo helios-bleed__photo--spread-${spread}` : 'helios-bleed__photo';
  return <img className={`helios-photo ${cls}`} src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={slide.photoKind ?? 'scene'} style={spread ? undefined : focusStyle(slide)} />;
}

/** Darkened full-bleed background behind a slide's content (spec §5.3a; rule 2 via the shade). */
function Backdrop({ slide }: { slide: SlideCopy }) {
  return (
    <>
      <img className="helios-photo helios-backdrop__img" src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={slide.photoKind ?? 'scene'} style={focusStyle(slide)} />
      <div className="helios-backdrop__shade" aria-hidden="true" />
    </>
  );
}

/** Photo credit: one position on every layout, bottom-right, white on a dark pill. */
function PhotoCredit({ credit }: { credit: string | undefined }) {
  if (!credit) return null;
  return <div className="helios-photo-credit">{credit}</div>;
}

/* ── Cover ────────────────────────────────────────────────────────── */

function CoverSlide({ slide }: { slide: SlideCopy }) {
  const mode = !slide.photoUrl ? 'plain' : slide.photoKind === 'subject' ? 'split' : 'bleed';
  return (
    <div className={`helios-cover helios-cover--${mode}`}>
      {mode === 'bleed' && <BleedPhoto slide={slide} />}
      {mode === 'split' && <RegionPhoto slide={slide} className="helios-cover__photo" />}
      <div className="helios-cover__text" data-scrim={mode === 'bleed' ? 'gradient' : undefined}>
        <Fit as="h1" className="helios-cover__headline" min={MIN.cover}>
          <SpanRunView run={slide.headline} />
        </Fit>
      </div>
      <div className={`helios-cover__chevron${mode === 'plain' ? '' : ' helios-cover__chevron--on-photo'}`} aria-hidden="true">→</div>
    </div>
  );
}

/* ── Text (headline + body; photo in its own region) ──────────────── */

function TextSlide({ slide }: { slide: SlideCopy }) {
  const headline = slide.headline ?? slide.title;
  const body = slide.body ?? slide.bodyBottom;
  const placement = !slide.photoUrl ? 'none' : slide.photoPlacement === 'top' ? 'top' : 'below';
  return (
    <div className={`helios-text helios-text--photo-${placement}${placement === 'none' && slide.textAnchor === 'bottom' ? ' helios-text--low' : ''}`}>
      {placement === 'top' && <RegionPhoto slide={slide} className="helios-split__photo" />}
      <div className="helios-text__copy">
        {headline && (
          <Fit as="h2" className="helios-text__headline" min={MIN.headline}>
            <SpanRunView run={headline} />
          </Fit>
        )}
        {body && (
          <Fit as="p" className="helios-text__body" min={MIN.body}>
            <SpanRunView run={body} />
          </Fit>
        )}
      </div>
      {placement === 'below' && <RegionPhoto slide={slide} className="helios-split__photo" />}
    </div>
  );
}

/* ── Landing (headline, optional body; photo region below) ────────── */

function LandingSlide({ slide }: { slide: SlideCopy }) {
  return (
    <div className={`helios-landing${slide.photoUrl ? ' helios-landing--photo' : ''}`}>
      <div className="helios-landing__copy">
        {slide.headline && (
          <Fit as="h2" className="helios-landing__line" min={MIN.landing}>
            <SpanRunView run={slide.headline} />
          </Fit>
        )}
        {slide.body && (
          <Fit as="p" className="helios-landing__body" min={MIN.body}>
            <SpanRunView run={slide.body} />
          </Fit>
        )}
        {slide.note && <Fit className="helios-landing__note" min={MIN.body}>{slide.note}</Fit>}
      </div>
      {slide.photoUrl && <RegionPhoto slide={slide} className="helios-split__photo" />}
    </div>
  );
}

/* ── Stat (headline + body top, big number bottom; photo = darkened background) ── */

function StatSlide({ slide }: { slide: SlideCopy }) {
  const backdrop = Boolean(slide.photoUrl);
  return (
    <div className={`helios-stat${backdrop ? ' helios-stat--backdrop' : ''}`} data-scrim={backdrop ? 'shade' : undefined}>
      {backdrop && <Backdrop slide={slide} />}
      <div className="helios-stat__copy">
        {slide.headline && (
          <Fit as="h2" className="helios-stat__headline" min={MIN.headline}>
            <SpanRunView run={slide.headline} />
          </Fit>
        )}
        {slide.body && (
          <Fit as="p" className="helios-stat__body" min={MIN.body}>
            <SpanRunView run={slide.body} />
          </Fit>
        )}
      </div>
      <div className="helios-stat__number-block">
        {slide.title && (
          <Fit className="helios-stat__number" min={MIN.number}>
            <SpanRunView run={slide.title} />
          </Fit>
        )}
        {slide.numberNote && <Fit className="helios-stat__number-note" min={MIN.note}>{slide.numberNote}</Fit>}
      </div>
    </div>
  );
}

function SplitStatSlide({ slide }: { slide: SlideCopy }) {
  const backdrop = Boolean(slide.photoUrl);
  return (
    <div className={`helios-split-stat${backdrop ? ' helios-split-stat--backdrop' : ''}`} data-scrim={backdrop ? 'shade' : undefined}>
      {backdrop && <Backdrop slide={slide} />}
      <div className="helios-split-stat__copy">
        {slide.headline && (
          <Fit as="h2" className="helios-split-stat__headline" min={MIN.headline}>
            <SpanRunView run={slide.headline} />
          </Fit>
        )}
        {slide.body && (
          <Fit as="p" className="helios-split-stat__body" min={MIN.body}>
            <SpanRunView run={slide.body} />
          </Fit>
        )}
      </div>
      <div className="helios-split-stat__pair">
        <div className="helios-split-stat__col">
          {slide.title && (
            <Fit className="helios-split-stat__number" min={MIN.splitNumber}>
              <SpanRunView run={slide.title} />
            </Fit>
          )}
          {slide.numberNote && <Fit className="helios-split-stat__note" min={MIN.note}>{slide.numberNote}</Fit>}
        </div>
        <div className="helios-split-stat__rule" aria-hidden="true" />
        <div className="helios-split-stat__col">
          {slide.secondNumber && (
            <Fit className="helios-split-stat__number helios-split-stat__number--right" min={MIN.splitNumber}>
              {slide.secondNumber}
            </Fit>
          )}
          {slide.secondNote && <Fit className="helios-split-stat__note" min={MIN.note}>{slide.secondNote}</Fit>}
        </div>
      </div>
    </div>
  );
}

/* ── Quote (headline, speaker spot or background, quote, speaker, body) ── */

function QuoteSlide({ slide }: { slide: SlideCopy }) {
  // The round spot is only for a verified photo of the speaker; any other photo is a darkened background.
  const speaker = Boolean(slide.photoUrl) && slide.photoIsSpeaker === true;
  const backdrop = Boolean(slide.photoUrl) && !speaker;
  const quote = slide.quoteText;
  return (
    <div className={`helios-quote${speaker ? ' helios-quote--speaker' : ''}${backdrop ? ' helios-quote--backdrop' : ''}`} data-scrim={backdrop ? 'shade' : undefined}>
      {backdrop && <Backdrop slide={slide} />}
      {speaker && <RegionPhoto slide={slide} className="helios-quote__speaker" />}
      {slide.headline && (
        <Fit as="h2" className="helios-quote__headline" min={MIN.headline}>
          <SpanRunView run={slide.headline} />
        </Fit>
      )}
      <div className="helios-quote__glyph" aria-hidden="true">&ldquo;</div>
      {quote && (
        <Fit as="blockquote" className="helios-quote__text" min={MIN.quote}>
          <SpanRunView run={quote} />
        </Fit>
      )}
      {slide.quoteBy && (
        <Fit className="helios-quote__attribution" min={MIN.by}>
          <span aria-hidden="true">— </span>
          {slide.quoteBy}
        </Fit>
      )}
      {slide.body && (
        <Fit as="p" className="helios-quote__body" min={MIN.body}>
          <SpanRunView run={slide.body} />
        </Fit>
      )}
    </div>
  );
}

/* ── Image / spread (full-bleed scene, text bottom on a scrim) ────── */

function ImageSlide({ slide, spread }: { slide: SlideCopy; spread?: 'left' | 'right' }) {
  return (
    <div className={`helios-image${spread ? ` helios-image--spread-${spread}` : ''}`}>
      <BleedPhoto slide={slide} spread={spread} />
      <div className="helios-image__copy" data-scrim="gradient">
        {slide.headline && (
          <Fit as="h2" className="helios-image__headline" min={MIN.headline}>
            <SpanRunView run={slide.headline} />
          </Fit>
        )}
        {slide.body && (
          <Fit as="p" className="helios-image__body" min={MIN.body}>
            <SpanRunView run={slide.body} />
          </Fit>
        )}
      </div>
    </div>
  );
}

/* ── Follow (unchanged) ───────────────────────────────────────────── */

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
