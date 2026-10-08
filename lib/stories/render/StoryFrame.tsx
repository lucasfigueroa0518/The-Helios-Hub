import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight, CircleCheck } from 'lucide-react';

import { CLOSER, FVP, GTN, OPENER, SERIES_LABEL } from './copy';
import { fadeMask, fadeStops } from './fades';
import { framePhoto, type AnswerData, type Backdrop, type Frame, type FreeData, type IntroData, type OpenerData, type PaidData, type Photo, type QuestionData, type SourceTag, type StoryData } from './types';

/**
 * One Instagram Story frame, 1080×1920 (S-32). Layout rules, every template:
 *
 *   1. Safe zones: text, the logo, cues and credits sit between y=250 and
 *      y=1580 (`data-safe`); only photos and backdrop finishes may run into
 *      Instagram's top bar and reply bar. The renderer fails a frame otherwise.
 *   2. Text fit: every text block is a region with a minimum size
 *      (`data-fit-min`, the copied text-fit.ts); it shrinks, never clips.
 *   3. Photos are always a bleed fade (S-44), never a card: they hang from
 *      the top edge and fade down into the backdrop, or fade in and out as a
 *      window between two text blocks. Text sits only where the photo has
 *      faded below 30% (renderer check); a masthead over a photo has a shade.
 *   4. The Helios logo is the whole sun mark, never cropped or covered, with
 *      clear space; on orange and green it carries a white ring (S-37).
 *   5. Every placed photo carries its credit just above the reply bar (S-23).
 *   6. The next-frame cue is type and an arrow on the right, where people tap
 *      to go forward; never a button or pill (S-47).
 *
 * Backdrops (S-18): black, white, orange, green. Text on orange is off-black,
 * on green white (S-36).
 */
export function StoryFrame({ frame, logoSrc }: { frame: Frame; logoSrc: string }) {
  const { data } = frame;
  if (data.role === 'intro' && frame.series === 'morning_download') throw new Error('Morning Download has no intro frame (its opener is the intro)');
  const photo = framePhoto(data);
  const variant = data.role === 'question' || data.role === 'answer' ? (data.photo ? data.family : 'type') : data.role === 'story' || data.role === 'opener' ? (data.photo ? 'photo' : 'type') : 'base';
  return (
    <div className={`st-frame st-bd-${frame.backdrop} st-role-${data.role} st-v-${variant}`} data-role={data.role} data-backdrop={frame.backdrop} data-variant={variant}>
      <div className="st-bg" data-decor="true" aria-hidden="true" />
      {data.role === 'opener' && <Opener frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'story' && <Story frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'closer' && <Closer logoSrc={logoSrc} />}
      {data.role === 'intro' && frame.series === 'guess_the_number' && <GtnIntro frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'intro' && frame.series === 'free_vs_paid' && <FvpIntro frame={frame} logoSrc={logoSrc} />}
      {data.role === 'question' && <Question frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'answer' && <Answer frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'paid' && <Paid frame={frame} data={data} logoSrc={logoSrc} />}
      {data.role === 'free' && <Free frame={frame} data={data} logoSrc={logoSrc} />}
      {photo && <Credit text={photo.credit} />}
    </div>
  );
}

/* ── Building blocks ──────────────────────────────────────────────── */

/** Minimum font sizes (px) per text role: the floor for rule 2. */
const MIN = { kicker: 60, headline: 38, body: 30, number: 120, tool: 48, price: 96, question: 40, title: 64 } as const;

function Fit({ as: Tag = 'div', className, min, children }: { as?: 'div' | 'h1' | 'h2' | 'p'; className: string; min: number; children: ReactNode }) {
  return (
    <Tag className={className} data-fit-min={min} data-safe="true">
      {children}
    </Tag>
  );
}

function Logo({ src, size, className = '' }: { src: string; size: number; className?: string }) {
  return (
    <div className={`st-logo ${className}`} style={{ width: size, height: size }} data-safe="true">
      <img className="st-logo__img" src={src} alt="Helios" />
    </div>
  );
}

/** The small sun mark, an optional series label, and the frame's position. */
function Masthead({ frame, logoSrc, onPhoto, label, position }: { frame: Frame; logoSrc: string; onPhoto?: boolean; label?: string | null; position?: string }) {
  return (
    <div className={`st-masthead${onPhoto ? ' st-masthead--on-photo' : ''}`} data-safe="true">
      <Logo src={logoSrc} size={60} className="st-logo--small" />
      {label !== null && <div className="st-masthead__label">{label ?? SERIES_LABEL[frame.series]}</div>}
      <div className="st-masthead__pos">{position ?? `${pad(frame.index)} / ${pad(frame.total)}`}</div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`st-eyebrow ${className}`} data-safe="true">
      {children}
    </div>
  );
}

/** Next-frame cue: type and an arrow, right-aligned, on the side people tap (S-47). */
function Cue({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`st-cue ${className}`} data-safe="true">
      <span className="st-cue__text">{text}</span>
      <ArrowRight className="st-cue__icon" width={50} height={50} strokeWidth={2.25} aria-hidden="true" />
    </div>
  );
}

function Source({ tag }: { tag: SourceTag }) {
  return (
    <div className="st-source" data-safe="true">
      <span className="st-dot" aria-hidden="true" />
      <span className="st-source__verb">{tag.verb}</span> <span className="st-source__name">{tag.name}</span>
    </div>
  );
}

function Credit({ text }: { text: string }) {
  return (
    <div className="st-credit" data-safe="true" data-fit-min={16}>
      {text}
    </div>
  );
}

function objectPosition(photo: Photo): CSSProperties {
  return photo.focus ? { objectPosition: `${Math.round(photo.focus.x * 100)}% ${Math.round(photo.focus.y * 100)}%` } : {};
}

/** A bleed photo (S-44). Position and height come from the layout's CSS class. */
function Bleed({ photo, mode, backdrop, className }: { photo: Photo; mode: 'top' | 'window'; backdrop: Backdrop; className: string }) {
  const stops = fadeStops(mode, backdrop);
  const mask = fadeMask(stops);
  return (
    <div className={`st-bleed st-bleed--${mode} ${className}`} data-decor="true" data-fade={JSON.stringify(stops)}>
      <img className="st-photo" src={photo.src} alt="" style={{ ...objectPosition(photo), maskImage: mask, WebkitMaskImage: mask }} data-photo-kind={photo.kind} />
      {mode === 'top' && <div className="st-bleed__shade" />}
    </div>
  );
}

/** Words whose trailing period never ends a sentence ("Gov. Newsom", "Sept. 18"). */
const ABBREVIATIONS = new Set(
  'mr mrs ms dr prof gov sen rep pres gen lt col sgt st jr sr inc corp co ltd vs etc no jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '),
);

/** First sentence carries the weight; the rest reads lighter. */
export function splitLead(text: string): [string, string] {
  const t = text.trim();
  const re = /[.!?]["”’]?\s+(?=["“A-Z0-9$])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t.slice(0, m.index);
    const word = /([A-Za-z.]+)$/.exec(before)?.[1] ?? '';
    // An abbreviation, or an initial / dotted acronym (U.S., J.), is not a sentence end.
    if (t[m.index] === '.' && (ABBREVIATIONS.has(word.toLowerCase()) || /^([A-Za-z]\.)*[A-Za-z]$/.test(word))) continue;
    const cut = m.index + m[0].trimEnd().length;
    return [t.slice(0, cut), t.slice(cut).trim()];
  }
  return [t, ''];
}

function Dots() {
  return (
    <div className="st-dots" aria-hidden="true" data-decor="true">
      <span className="st-dot" />
      <span className="st-dot" />
      <span className="st-dot" />
    </div>
  );
}

/* ── Morning Download ─────────────────────────────────────────────── */

function Opener({ frame, data, logoSrc }: { frame: Frame; data: OpenerData; logoSrc: string }) {
  return (
    <div className={`st-opener${data.photo ? '' : ' st-opener--type'}`}>
      {data.photo && <Bleed photo={data.photo} mode="window" backdrop={frame.backdrop} className="st-opener__photo" />}
      <div className="st-opener__head">
        <Logo src={logoSrc} size={data.photo ? 168 : 232} className="st-opener__logo" />
        <Eyebrow className="st-opener__date">{data.date}</Eyebrow>
        <h1 className="st-opener__title" data-safe="true">
          <span className="st-opener__line">{OPENER.title[0]}</span>
          <span className="st-opener__line st-accent-text">{OPENER.title[1]}</span>
        </h1>
        <Fit as="p" className="st-opener__tagline" min={MIN.body}>
          {OPENER.tagline}
        </Fit>
      </div>
      <Cue text={OPENER.cue(data.storyCount)} className="st-opener__cue" />
    </div>
  );
}

function Story({ frame, data, logoSrc }: { frame: Frame; data: StoryData; logoSrc: string }) {
  const [lead, rest] = splitLead(data.headline);
  // Position among the story frames only (the opener is frame 1, the closer last).
  const position = `${pad(Math.max(1, frame.index - 1))} / ${pad(Math.max(1, frame.total - 2))}`;
  return (
    <div className={`st-story${data.photo ? '' : ' st-story--type'}`}>
      {data.photo && <Bleed photo={data.photo} mode="top" backdrop={frame.backdrop} className="st-story__photo" />}
      <Masthead frame={frame} logoSrc={logoSrc} onPhoto={Boolean(data.photo)} position={position} />
      <div className="st-story__copy">
        <Fit as="h2" className="st-story__headline" min={MIN.headline}>
          <span className="st-story__lead">{lead}</span>
          {rest && <span className="st-story__rest"> {rest}</span>}
        </Fit>
        <Source tag={data.source} />
      </div>
    </div>
  );
}

function Closer({ logoSrc }: { logoSrc: string }) {
  return (
    <div className="st-closer">
      <Eyebrow className="st-closer__eyebrow">{CLOSER.eyebrow}</Eyebrow>
      <Logo src={logoSrc} size={280} className="st-closer__logo" />
      <Fit as="h2" className="st-closer__headline" min={MIN.title - 20}>
        {CLOSER.headline}
      </Fit>
      <Dots />
      <Fit as="p" className="st-closer__body" min={MIN.body}>
        {CLOSER.body}
      </Fit>
      {/* A Story can't link without a sticker, so the address is type, not a button. */}
      <div className="st-closer__url" data-safe="true">
        <span className="st-accent-text">{CLOSER.url}</span>
      </div>
    </div>
  );
}

/* ── Guess the Number: a game show in the copy (S-13, S-45) ───────── */

/** "Can you guess the number?": the line that leads every question frame. */
function Kicker() {
  return (
    <Fit as="h1" className="st-gtn__kicker" min={MIN.kicker}>
      <span>{GTN.kicker[0]}</span> <span className="st-accent-text">{GTN.kicker[1]}</span>
    </Fit>
  );
}

/** Intro (S-49): Today's "Guess the Number", the difficulty and the topic. */
function GtnIntro({ frame, data, logoSrc }: { frame: Frame; data: IntroData; logoSrc: string }) {
  if (!data.difficulty || !data.topic) throw new Error('Guess the Number intro needs a difficulty and a topic');
  return (
    <div className="st-gtn st-gtn--intro">
      <div className="st-glyph" data-decor="true" aria-hidden="true">
        ?
      </div>
      <Masthead frame={frame} logoSrc={logoSrc} label={null} />
      <div className="st-intro">
        <div className="st-intro__today" data-safe="true">
          {GTN.intro.today}
        </div>
        <Fit as="h1" className="st-intro__title" min={MIN.kicker}>
          <span>“Guess the</span> <span className="st-accent-text">Number”</span>
        </Fit>
        <div className="st-intro__rows" data-safe="true">
          <div className="st-intro__row">
            <div className="st-intro__label">{GTN.intro.difficulty}</div>
            <div className="st-intro__value st-intro__value--difficulty">{GTN.intro.levels[data.difficulty]}</div>
          </div>
          <div className="st-intro__row">
            <div className="st-intro__label">{GTN.intro.topic}</div>
            <Fit className="st-intro__value st-intro__value--topic" min={MIN.body + 6}>
              {data.topic}
            </Fit>
          </div>
        </div>
        <Cue text={GTN.intro.cue} className="st-intro__cue" />
      </div>
    </div>
  );
}

function Question({ frame, data, logoSrc }: { frame: Frame; data: QuestionData; logoSrc: string }) {
  const family = data.photo ? data.family : 'type';
  const challenge = (
    <>
      <Fit as="h2" className="st-gtn__question" min={MIN.question}>
        {data.question}
      </Fit>
      <Cue text={GTN.cue} className="st-gtn__cue" />
    </>
  );
  return (
    <div className={`st-gtn st-gtn--${family} st-gtn--question`}>
      {family === 'photo' && <Bleed photo={data.photo!} mode="top" backdrop={frame.backdrop} className="st-gtn__photo" />}
      {family === 'marquee' && <Bleed photo={data.photo!} mode="window" backdrop={frame.backdrop} className="st-gtn__photo" />}
      {family === 'type' && (
        <div className="st-glyph" data-decor="true" aria-hidden="true">
          ?
        </div>
      )}
      <Masthead frame={frame} logoSrc={logoSrc} onPhoto={family === 'photo'} label={null} />
      {family === 'marquee' ? (
        <>
          <div className="st-gtn__top">
            <Kicker />
          </div>
          <div className="st-gtn__copy">{challenge}</div>
        </>
      ) : (
        <div className="st-gtn__copy">
          <Kicker />
          {challenge}
        </div>
      )}
    </div>
  );
}

function Answer({ frame, data, logoSrc }: { frame: Frame; data: AnswerData; logoSrc: string }) {
  const family = data.photo ? data.family : 'type';
  const reveal = (
    <>
      <div className="st-gtn__reveal" data-safe="true">
        {GTN.reveal}
      </div>
      <Fit className="st-gtn__number st-accent-text" min={MIN.number}>
        {data.number}
      </Fit>
    </>
  );
  const rest = (
    <>
      <Fit as="p" className="st-gtn__label" min={MIN.body + 4}>
        {data.label}
      </Fit>
      <Fit as="p" className="st-gtn__meaning" min={MIN.body}>
        {data.meaning}
      </Fit>
      <Fit as="p" className="st-gtn__close" min={MIN.body}>
        {GTN.close}
      </Fit>
      <Source tag={data.source} />
    </>
  );
  return (
    <div className={`st-gtn st-gtn--${family} st-gtn--answer`}>
      {family === 'photo' && <Bleed photo={data.photo!} mode="top" backdrop={frame.backdrop} className="st-gtn__photo" />}
      {family === 'marquee' && <Bleed photo={data.photo!} mode="window" backdrop={frame.backdrop} className="st-gtn__photo" />}
      <Masthead frame={frame} logoSrc={logoSrc} onPhoto={family === 'photo'} label={null} />
      {family === 'marquee' ? (
        <>
          <div className="st-gtn__top">{reveal}</div>
          <div className="st-gtn__copy">{rest}</div>
        </>
      ) : (
        <div className="st-gtn__copy">
          {reveal}
          {rest}
        </div>
      )}
    </div>
  );
}

/* ── Free vs. Paid: the series title leads (S-07, S-08, S-46) ─────── */

/** The series title, stacked like a fight card; the side this slide is about is lit. */
function FvpTitle({ lit, className = '' }: { lit: 'free' | 'paid' | 'both'; className?: string }) {
  return (
    <h1 className={`st-fvp__title ${className}`} data-safe="true">
      <span className={`st-fvp__word ${lit !== 'paid' ? 'st-accent-text' : 'st-fvp__dim'}`}>{FVP.title.free}</span>
      <span className="st-fvp__vs">
        <span>{FVP.title.vs}</span>
      </span>
      <span className={`st-fvp__word ${lit !== 'free' ? 'st-accent-text' : 'st-fvp__dim'}`}>{FVP.title.paid}</span>
    </h1>
  );
}

/** Intro (S-50): what the series is, in Lucas's words. */
function FvpIntro({ frame, logoSrc }: { frame: Frame; logoSrc: string }) {
  return (
    <div className="st-fvp st-fvp--intro">
      <Masthead frame={frame} logoSrc={logoSrc} label={null} />
      <FvpTitle lit="both" className="st-fvp__title--intro" />
      <div className="st-fvp__copy st-fvp__copy--intro">
        <Fit as="p" className="st-fvp__intro-line" min={MIN.body + 6}>
          {FVP.intro.line}
        </Fit>
        <Cue text={FVP.intro.cue} className="st-fvp__cue" />
      </div>
    </div>
  );
}

function ToolRow({ eyebrow, tool, logo }: { eyebrow: ReactNode; tool: string; logo?: Photo }) {
  return (
    <div className="st-fvp__toolrow">
      {logo && (
        <div className="st-plate" data-safe="true">
          <img className="st-plate__logo" src={logo.src} alt="" data-photo-kind="logo" />
        </div>
      )}
      <div className="st-fvp__toolname">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Fit as="h2" className="st-fvp__tool" min={MIN.tool}>
          {tool}
        </Fit>
      </div>
    </div>
  );
}

function Paid({ frame, data, logoSrc }: { frame: Frame; data: PaidData; logoSrc: string }) {
  return (
    <div className="st-fvp st-fvp--paid">
      <Masthead frame={frame} logoSrc={logoSrc} label={null} />
      <FvpTitle lit="paid" />
      <div className="st-fvp__copy">
        <ToolRow eyebrow={FVP.paidEyebrow} tool={data.tool} logo={data.logo} />
        <div className="st-fvp__price" data-safe="true">
          <Fit className="st-fvp__amount" min={MIN.price}>
            {data.price}
          </Fit>
          <div className="st-fvp__period">{data.period}</div>
        </div>
        <Fit as="p" className="st-fvp__tease" min={MIN.body}>
          {data.tease}
        </Fit>
        <Cue text={FVP.cue} className="st-fvp__cue" />
      </div>
    </div>
  );
}

function Free({ frame, data, logoSrc }: { frame: Frame; data: FreeData; logoSrc: string }) {
  return (
    <div className="st-fvp st-fvp--free">
      <Masthead frame={frame} logoSrc={logoSrc} label={null} />
      <FvpTitle lit="free" />
      <div className="st-fvp__copy">
        <ToolRow
          eyebrow={
            <>
              {FVP.freeEyebrow}
              {data.devTool && <span className="st-chip">{FVP.devTool}</span>}
            </>
          }
          tool={data.tool}
          logo={data.logo}
        />
        <div className="st-fvp__price" data-safe="true">
          <div className="st-fvp__amount st-accent-text">{FVP.free}</div>
          <div className="st-fvp__was">{data.paidPrice}</div>
        </div>
        <Fit as="p" className="st-fvp__what" min={MIN.body}>
          {data.what}
        </Fit>
        <div className="st-howto" data-safe="true">
          <div className="st-howto__row">
            <CircleCheck className="st-howto__icon" width={40} height={40} strokeWidth={2} aria-hidden="true" />
            <span>{data.how}</span>
          </div>
          <div className="st-howto__row">
            <CircleCheck className="st-howto__icon" width={40} height={40} strokeWidth={2} aria-hidden="true" />
            <span>{data.platforms}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
