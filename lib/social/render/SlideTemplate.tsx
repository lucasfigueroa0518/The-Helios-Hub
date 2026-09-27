'use client';

import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';
import { CATEGORY_LABELS } from '@/lib/social/render/types';
import { cleanOutletName } from '@/lib/social/render/outlet-name';

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
 * Each of the six archetypes from the helios-social-skill spec is its own
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

  // F1 follow slide is dark-canvas per the design skill spec — the wordmark
  // IS the follow-invitation, rendered on the same near-black field as the
  // rest of the carousel so the closing beat reads as an anchor, not a
  // marketing card. lightCanvas can still opt individual mid-carousel beats
  // into a light "Helios White" pause per the skill's variant.
  const isFollow = slide.layoutVariant === 'follow';
  const isCover = slide.layoutVariant === 'cover';
  const isLight = Boolean(slide.lightCanvas);
  const lightMod = isLight ? ' helios-slide--light' : '';
  const category = CATEGORY_LABELS[post.storyType] ?? 'TECH';
  // Category label is carried in the masthead ticker on all beats; showing
  // an in-body ▸ POLICY tag was duplicating the same word. Cover handles
  // its own category internally. Kill the redundant outer chrome tag.
  const showCategory = false;
  // Cover has its own byline chrome (outlet · date) + SWIPE → text; the
  // universal HELIOS wordmark would collide with them at bottom-right.
  // Also suppress on beats since the masthead already carries HELIOS at
  // top-left — otherwise we double-mark and the beat has two wordmarks.
  const showWordmark = false;
  // Minimal chrome: single HELIOS wordmark top-left on beats. Killed the
  // volume/issue ticker, category label, and slide index — all read as
  // editorial-magazine LARP on a 6" phone screen. Cover has its own
  // bespoke chrome; Follow is the wordmark lockup itself.
  const showTopWordmark = !isCover && !isFollow;
  void category;

  return (
    <div
      className={
        `helios-slide helios-slide--${post.format}`
        + ` helios-slide--${slide.layoutVariant}${lightMod}`
      }
      data-slide-ready="true"
      data-variant={slide.variant ?? undefined}
      data-beat={slide.beat ?? undefined}
      role="img"
      aria-label={slide.altText}
    >
      {showTopWordmark && (
        <div className="helios-masthead helios-masthead--minimal" aria-hidden="true">
          <div className="helios-masthead__wordmark">HELIOS</div>
        </div>
      )}
      <div className="helios-slide__well">
        {slide.layoutVariant === 'cover' && <CoverSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'story_beat' && <StoryBeatSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'data_block' && <DataBlockSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'quote' && <QuoteSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'source' && <SourceSlide post={post} slide={slide} />}
        {/* New families from the design skill. MVP renderings piggyback on
            the closest existing family so any editorial-produced post
            renders end-to-end; each gets a distinct CSS scope via
            layoutVariant + data-variant for future custom styling. */}
        {slide.layoutVariant === 'proof' && <ProofSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'thesis' && <StoryBeatSlide post={post} slide={slide} />}
        {slide.layoutVariant === 'debate' && <DebateSlide post={post} slide={slide} />}
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
  const photoBleed = Boolean(slide.photoUrl) && !isPlaceholderPhoto(slide.photoUrl);
  // Character-count buckets so long headlines don't wrap into a 12-line
  // pile. CSS scales font-size per bucket (see .helios-cover__headline
  // rules). Buckets, not raw chars, so headline shape stays consistent
  // across posts of similar length instead of jittering per character.
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

/* ── Story-beat (archetype 2) ─────────────────────────────────────────── */

function StoryBeatSlide({ slide }: { post: Post; slide: SlideCopy }) {
  const treatment = slide.photoTreatment ?? 'card';
  const hasRealPhoto = Boolean(slide.photoUrl) && !isPlaceholderPhoto(slide.photoUrl);
  const isBottomFade = treatment === 'bottom-fade' && hasRealPhoto;
  // B5 is a type-only landing composition — only the headline is the copy.
  // Suppress body/bodyBottom/title/photo even if the copy stage emitted them
  // so the CSS's giant-Pragmatica landing treatment doesn't blow up
  // sentence-length body copy across the whole frame.
  const isB5 = slide.variant === 'B5';
  return (
    <div className={`helios-beat${isBottomFade ? ' helios-beat--bottom-fade' : ''}`}>
      {isBottomFade && hasRealPhoto && !isB5 && (
        <div
          className="helios-beat__bottom-fade"
          style={{ backgroundImage: `url(${slide.photoUrl})` }}
          aria-hidden="true"
        />
      )}
      {slide.title && !isB5 && (
        <h2 className="helios-beat__title">
          <SpanRunView run={slide.title} />
        </h2>
      )}
      {isB5 && slide.headline && (
        <h2
          className="helios-beat__landing"
          data-length={bodyLengthBucket(slide.headline)}
        >
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {slide.body && !isB5 && (
        <p
          className="helios-beat__body helios-beat__body--top"
          data-length={bodyLengthBucket(slide.body)}
        >
          <SpanRunView run={slide.body} />
        </p>
      )}
      {!isBottomFade && hasRealPhoto && !isB5 && (
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
          {/* News-style attribution beneath the photo. Small, subtle,
              editorial. Only real credits (with an outlet or photographer)
              — placeholders like "PHOTO · ARTICLE HERO" stay suppressed. */}
          {slide.photoCredit && !isPlaceholderCredit(slide.photoCredit) && (
            <div className="helios-beat__credit">{slide.photoCredit}</div>
          )}
        </figure>
      )}
      {slide.bodyBottom && !isB5 && (
        <p
          className="helios-beat__body helios-beat__body--bottom"
          data-length={bodyLengthBucket(slide.bodyBottom)}
        >
          <SpanRunView run={slide.bodyBottom} />
        </p>
      )}
      {/* On-slide photo credit killed — attribution moves to caption. */}
    </div>
  );
}

/**
 * Character-count bucket for body copy. Same pattern the cover uses to
 * scale hero type. Templates listen to `data-length` and pick a size
 * that keeps the copy inside the frame. Prevents the "text runs off the
 * page" regression that copy-regen can't fix — this is a design
 * guardrail, not a content fix.
 */
function bodyLengthBucket(spans: SpanRun): 'xs' | 'sm' | 'md' | 'lg' | 'xl' {
  const chars = spans.reduce((n, s) => n + s.text.length, 0);
  if (chars <= 90) return 'xs';
  if (chars <= 150) return 'sm';
  if (chars <= 220) return 'md';
  if (chars <= 300) return 'lg';
  return 'xl';
}

/**
 * Photo credits ship as one of two things: a real photographer/outlet
 * credit ("PHOTO: JASON GOODMAN · UNSPLASH") or a placeholder string the
 * photo pipeline emits when nothing better is known ("PHOTO · ARTICLE
 * HERO"). Show real credits, hide placeholders — putting "ARTICLE HERO"
 * in front of a reader is meaningless.
 */
function isPlaceholderCredit(credit: string | undefined | null): boolean {
  if (!credit) return true;
  const t = credit.trim().toUpperCase();
  if (!t) return true;
  if (t.includes('ARTICLE HERO')) return true;
  if (t === 'PHOTO' || t === 'PHOTO ·' || t === 'PHOTO·') return true;
  return false;
}

/**
 * A slide with empty space reads worse than a slide with an imperfect
 * atmosphere photo. Bring Unsplash photos back — the news-style caption
 * beneath the image credits them properly. Only truly empty/null URLs are
 * still suppressed.
 */
function isPlaceholderPhoto(url: string | undefined | null): boolean {
  if (!url) return true;
  return false;
}

/* ── Data-block (archetype 3) ─────────────────────────────────────────── */

/**
 * Number-forward mid-carousel break. `title` carries the giant orange
 * number (e.g. `$2B`), `headline` carries the uppercase Pragmatica label
 * that names what the number measures (e.g. `FIVE-YEAR COMMITMENT.`),
 * and `body` is the one-sentence context that lands underneath.
 *
 * No photo, no photo caption, no photo credit — the number IS the visual.
 * Used to break the rhythm when three photo-forward beats in a row would
 * otherwise read samey.
 */
function DataBlockSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  const hasPhoto = Boolean(slide.photoUrl) && !isPlaceholderPhoto(slide.photoUrl);
  // D3 (MECHANISM archetype) carries a text kicker in `title` (e.g.
  // "Two obligations on the table."), not a number. The giant orange
  // Pragmatica treatment overflows past the content well on any string
  // longer than ~12 chars, so route D3's title to the small green eyebrow
  // and let `headline` carry the big label. D1/D2 keep the number treatment.
  const isD3 = slide.variant === 'D3';
  const titleLen = slide.title?.reduce((n, s) => n + s.text.length, 0) ?? 0;

  // Comparison bar chart — parse title + headline + body for a numeric
  // value and a baseline. When we find both, render a two-bar chart that
  // gives the reader visual scale, not just the number as text. Falls back
  // to the existing text-only layout when no comparison is parseable.
  const titleText = (slide.title ?? []).map((s) => s.text).join(' ');
  const headlineText = (slide.headline ?? []).map((s) => s.text).join(' ');
  const bodyText = (slide.body ?? []).map((s) => s.text).join(' ');
  const chart = !isD3 ? parseScaleChart(titleText, headlineText, bodyText) : null;

  return (
    <div className="helios-data">
      {slide.title && isD3 && (
        <div className="helios-data__eyebrow">
          <SpanRunView run={slide.title} />
        </div>
      )}
      {slide.title && !isD3 && (
        <div
          className="helios-data__number"
          data-length={titleLen}
        >
          <SpanRunView run={slide.title} />
        </div>
      )}
      <div className="helios-data__rule" aria-hidden="true" />
      {slide.headline && (
        <h2
          className="helios-data__label"
          data-length={bodyLengthBucket(slide.headline)}
        >
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {chart?.kind === 'grid' && (
        <div className="helios-data__grid" aria-hidden="true">
          {Array.from({ length: 25 }).map((_, i) => (
            <span
              key={i}
              className={
                i < chart.filledCells
                  ? 'helios-data__grid-cell helios-data__grid-cell--on'
                  : 'helios-data__grid-cell'
              }
            />
          ))}
        </div>
      )}
      {chart?.kind === 'bar' && (
        <div className="helios-data__chart" aria-hidden="true">
          <div className="helios-data__chart-row">
            <div
              className="helios-data__chart-bar helios-data__chart-bar--value"
              style={{ width: `${Math.max(4, chart.valuePct)}%` }}
            />
            <div className="helios-data__chart-label helios-data__chart-label--value">
              {chart.valueLabel}
            </div>
          </div>
          <div className="helios-data__chart-row">
            <div className="helios-data__chart-bar helios-data__chart-bar--baseline" style={{ width: '100%' }} />
            <div className="helios-data__chart-label helios-data__chart-label--baseline">
              {chart.baselineLabel}
            </div>
          </div>
        </div>
      )}
      {slide.body && (
        <p className="helios-data__context">
          <SpanRunView run={slide.body} />
        </p>
      )}
      {slide.bodyBottom && (
        <p className="helios-data__kicker">
          <SpanRunView run={slide.bodyBottom} />
        </p>
      )}
      {hasPhoto && (
        <figure className="helios-data__figure">
          <img
            className="helios-data__photo"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          {slide.photoCaption && (
            <figcaption className="helios-data__caption">
              {slide.photoCaption}
            </figcaption>
          )}
          {/* On-slide photo credit killed — attribution moves to caption. */}
        </figure>
      )}
    </div>
  );
}

/**
 * Parse a SCALE slide's title/headline/body for a numeric value + baseline
 * we can render as a two-bar comparison chart. Returns null when we can't
 * confidently pull both numbers — in which case the slide falls back to
 * the text-only D1 layout.
 *
 * Cases handled:
 *   - Percentage in title ("26%") → baseline auto = 100%
 *   - Time in title ("2 MONTHS") + "X to Y unit" or "up to Y unit" in body
 *   - Currency in title ("$21B") + explicit "$XB" baseline in body
 */
type ScaleChart =
  | { kind: 'grid'; filledCells: number; valueLabel: string; baselineLabel: string }
  | { kind: 'bar'; valuePct: number; valueLabel: string; baselineLabel: string };

function parseScaleChart(title: string, headline: string, body: string): ScaleChart | null {
  const scan = `${headline} ${body}`;

  // ── Percentage → 5×5 pictogram grid ──────────────────────────────────
  // A grid actually shows "1 in 4" as a visual pattern instead of just
  // restating the percentage. 25 cells, filled = round(value / 4).
  const pct = title.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = parseFloat(pct[1]!);
    const filledCells = Math.max(1, Math.min(25, Math.round((v / 100) * 25)));
    return {
      kind: 'grid',
      filledCells,
      valueLabel: `${pct[1]}%`,
      baselineLabel: '100% TOTAL',
    };
  }

  // ── Time (months / weeks / days / years) ─────────────────────────────
  const timeUnits = ['months?', 'weeks?', 'days?', 'years?', 'hours?'];
  for (const unitRe of timeUnits) {
    const t = title.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitRe})`, 'i'));
    if (t) {
      const val = parseFloat(t[1]!);
      const unit = t[2]!.toUpperCase();
      // "6 to 18 months" / "6-18 months" / "6–18 months"
      const range = scan.match(new RegExp(`(\\d+)\\s*(?:to|-|–)\\s*(\\d+)\\s*${unitRe}`, 'i'));
      if (range) {
        const baseline = parseFloat(range[2]!);
        return {
          kind: 'bar',
          valuePct: Math.min(100, (val / baseline) * 100),
          valueLabel: `${val} ${unit}`,
          baselineLabel: `${range[1]}–${range[2]} ${unit} TYPICAL`,
        };
      }
      // "up to N months" or "N months typical"
      const singular = scan.match(new RegExp(`(?:up to\\s+)?(\\d+)\\s*${unitRe}\\s+(?:typical|standard|normal|average)`, 'i'));
      if (singular) {
        const baseline = parseFloat(singular[1]!);
        return {
          kind: 'bar',
          valuePct: Math.min(100, (val / baseline) * 100),
          valueLabel: `${val} ${unit}`,
          baselineLabel: `${singular[1]} ${unit} TYPICAL`,
        };
      }
      return null;
    }
  }

  // ── Currency ($21B, $3.9B) ───────────────────────────────────────────
  const cur = title.match(/\$\s*(\d+(?:\.\d+)?)\s*([BMK])/i);
  if (cur) {
    const val = parseFloat(cur[1]!);
    const unit = cur[2]!.toUpperCase();
    const baseMatch = scan.match(new RegExp(`\\$\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'i'));
    if (baseMatch) {
      const baseline = parseFloat(baseMatch[1]!);
      // Skip if we matched the same number back.
      if (baseline !== val) {
        return {
          kind: 'bar',
          valuePct: Math.min(100, (val / baseline) * 100),
          valueLabel: `$${val}${unit}`,
          baselineLabel: `$${baseline}${unit} REFERENCE`,
        };
      }
    }
  }

  return null;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month} ${day}`;
}

function formatMastheadDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mm}.${dd}.${yy}`;
}

/* ── Quote (archetype 4) ──────────────────────────────────────────────── */

/**
 * Editorial pause — a real speaker's real words. Sentence case, not
 * uppercase (a person spoke, they didn't shout). `body` holds the quote
 * text (SpanRun so we can paint one orange hook inside), `headline` holds
 * the attribution line (rendered as green mono with em-dash prefix).
 */
function QuoteSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-quote">
      <div className="helios-quote__glyph" aria-hidden="true">&ldquo;</div>
      {slide.body && (
        <blockquote className="helios-quote__text">
          <SpanRunView run={slide.body} />
        </blockquote>
      )}
      {slide.headline && (
        <div className="helios-quote__attribution">
          <span aria-hidden="true">— </span>
          <SpanRunView run={slide.headline} />
        </div>
      )}
    </div>
  );
}

/* ── Source (archetype 5) ─────────────────────────────────────────────── */

function SourceSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-source">
      <div className="helios-source__label">REPORTING</div>
      <h2 className="helios-source__outlet">{post.source}.</h2>
      {slide.body && (
        <p className="helios-source__teaser">
          <SpanRunView run={slide.body} />
        </p>
      )}
      {slide.photoUrl && !isPlaceholderPhoto(slide.photoUrl) && (
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

/* ── Follow (F1 — dark canvas, wordmark lockup) ───────────────────────────
 *
 * Per the design skill: kill the shouted 132px "FOLLOW FOR MORE" — the
 * wordmark IS the follow-invitation. Masthead-style HELIOS lockup flanked
 * by hairline rules extending to the outer padding. Story-specific line
 * above, handle + green tagline below. Near-black canvas so the closing
 * beat lands as an anchor, not a marketing card.
 */

function FollowSlide({ slide }: { post: Post; slide: SlideCopy }) {
  const storyLine = slide.storySpecificLine?.trim();
  return (
    <div className="helios-follow">
      <div className="helios-follow__wordmark">HELIOS</div>
      <div className="helios-follow__handle">@heliosgroup.ai</div>
      {storyLine && (
        <div className="helios-follow__story-line">{storyLine}</div>
      )}
    </div>
  );
}

/* ── Proof (P1) — source-card treatment ──────────────────────────────────
 *
 * Per skill spec: ▸ THE SOURCE label + big outlet name (Pragmatica Bold)
 * + article-headline body + hairline + optional photo. Anchors the story
 * to a real publication so the reader knows this isn't rumor.
 */
function ProofSlide({ post, slide }: { post: Post; slide: SlideCopy }) {
  const outletName = cleanOutletName(post.source);
  return (
    <div className="helios-proof">
      <div className="helios-proof__label">▸ THE SOURCE</div>
      <h2 className="helios-proof__outlet">{outletName}.</h2>
      <div className="helios-proof__rule" aria-hidden="true" />
      {slide.body && (
        <p className="helios-proof__body">
          <SpanRunView run={slide.body} />
        </p>
      )}
      {slide.photoUrl && !isPlaceholderPhoto(slide.photoUrl) && (
        <figure className="helios-proof__figure">
          <img
            className="helios-proof__photo"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          {slide.photoCredit && !isPlaceholderCredit(slide.photoCredit) && (
            <div className="helios-proof__credit">{slide.photoCredit}</div>
          )}
        </figure>
      )}
    </div>
  );
}

/* ── Debate (T2) — question + two labeled sides ───────────────────────── */

function DebateSlide({ slide }: { post: Post; slide: SlideCopy }) {
  return (
    <div className="helios-debate">
      {slide.headline && (
        <h2 className="helios-debate__question">
          <SpanRunView run={slide.headline} />
        </h2>
      )}
      {slide.sides && slide.sides.length > 0 ? (
        <ul className="helios-debate__sides">
          {slide.sides.map((side, i) => (
            <li key={i} className="helios-debate__side">
              <span className="helios-debate__side-label">{side.label}</span>
              <span className="helios-debate__side-text">{side.text}</span>
            </li>
          ))}
        </ul>
      ) : slide.body ? (
        <p className="helios-debate__body">
          <SpanRunView run={slide.body} />
        </p>
      ) : null}
      {slide.photoUrl && !isPlaceholderPhoto(slide.photoUrl) && (
        <figure className="helios-debate__figure">
          <img
            className="helios-debate__photo"
            src={slide.photoUrl}
            alt=""
            aria-hidden="true"
          />
          {slide.photoCredit && !isPlaceholderCredit(slide.photoCredit) && (
            <div className="helios-debate__credit">{slide.photoCredit}</div>
          )}
        </figure>
      )}
    </div>
  );
}
