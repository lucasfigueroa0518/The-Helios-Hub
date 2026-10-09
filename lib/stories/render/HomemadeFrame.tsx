import type { CSSProperties, ReactNode } from 'react';

import { FVP, HOMEMADE } from './copy';
import { arrowPaths, seedOf, strikePath } from './pen';
import { framePhoto, type AnswerData, type Backdrop, type Frame, type FreeData, type IntroData, type PaidData, type Photo, type QuestionData } from './types';

/**
 * The homemade style (S-53, exploration): Guess the Number and Free vs. Paid
 * as if someone built them in Instagram's own story editor on their phone.
 *
 *   - Instagram's Classic text (Inter Medium, the stand-in Trial Reels uses
 *     for San Francisco), sentence case, emoji.
 *   - The editor's highlight modes: a solid box behind each line (white,
 *     black or a colour), the see-through box, or plain text.
 *   - Photos full screen (posted from the camera roll) or as a rounded photo
 *     sticker; logos as cutout stickers with a white edge.
 *   - Pen-tool arrows and scribbles, a few degrees of tilt, nothing aligned
 *     to a grid. No logo or masthead: the account's own avatar is on top.
 *
 * Kept from the polished rules: the safe zones, text fit, credits (S-23),
 * and contrast: text over a photo always sits in a box (renderer check).
 */
export function HomemadeFrame({ frame }: { frame: Frame }) {
  const { data } = frame;
  const photo = framePhoto(data);
  const fullPhoto = (data.role === 'question' || data.role === 'answer') && data.family === 'photo' && data.photo;
  const t = tones(frame.backdrop, Boolean(fullPhoto));
  return (
    <div className={`hm-frame hm-bd-${frame.backdrop} hm-role-${data.role}`} data-role={data.role} data-backdrop={frame.backdrop} data-style="homemade">
      <div className="hm-fill" data-decor="true" aria-hidden="true" />
      {fullPhoto && <img className="hm-photo-bg" src={fullPhoto.src} alt="" style={objectPosition(fullPhoto)} data-boxed-only="true" data-decor="true" />}
      {fullPhoto && <div className="hm-photo-shade" data-decor="true" aria-hidden="true" />}
      {data.role === 'intro' && frame.series === 'guess_the_number' && <GtnIntro data={data} t={t} />}
      {data.role === 'intro' && frame.series === 'free_vs_paid' && <FvpIntro t={t} backdrop={frame.backdrop} />}
      {data.role === 'question' && <Question data={data} t={t} />}
      {data.role === 'answer' && <Answer data={data} t={t} backdrop={frame.backdrop} />}
      {data.role === 'paid' && <Paid data={data} t={t} backdrop={frame.backdrop} />}
      {data.role === 'free' && <Free data={data} t={t} backdrop={frame.backdrop} />}
      {photo && <Credit text={photo.credit} t={t} />}
    </div>
  );
}

/* ── Tones: which highlight a line gets on this backdrop ──────────── */

type Box = 'white' | 'black' | 'soft' | 'orange' | 'green' | 'red' | 'white-green' | 'plain-light' | 'plain-dark';
type Tones = { emph: Box; plain: Box; soft: Box; pen: string };

/** On a photo every line is boxed; on a flat fill the plain text takes the fill's contrast. */
function tones(backdrop: Backdrop, onPhoto: boolean): Tones {
  if (onPhoto) return { emph: 'white', plain: 'soft', soft: 'soft', pen: '#FFFFFF' };
  const light = backdrop === 'white' || backdrop === 'orange';
  return {
    emph: backdrop === 'white' ? 'black' : 'white',
    plain: light ? 'plain-dark' : 'plain-light',
    soft: light ? 'plain-dark' : 'plain-light',
    pen: light ? '#000000' : '#FFFFFF',
  };
}
const accentBox = (b: Backdrop): Box => (b === 'orange' ? 'black' : 'orange');
const freeBox = (b: Backdrop): Box => (b === 'green' ? 'white-green' : 'green');
const paidBox = (b: Backdrop): Box => (b === 'orange' ? 'black' : 'red');

/* ── Building blocks ──────────────────────────────────────────────── */

/** One line of typed text with its highlight. Tilt in degrees; `size` in px. */
function Line({ box, size, min, tilt = 0, align = 'center', maxH, shift = 0, children }: { box: Box; size: number; min?: number; tilt?: number; align?: 'left' | 'center' | 'right'; maxH?: number; shift?: number; children: ReactNode }) {
  // Size as a variable: text-fit clears inline font sizes before it measures.
  const style = { '--hm-size': `${size}px`, textAlign: align, transform: `translateX(${shift}px) rotate(${tilt}deg)`, ...(maxH ? { maxHeight: maxH } : {}) } as CSSProperties;
  const plain = box.startsWith('plain');
  return (
    <div className={`hm-line hm-line--${align}`} style={style} data-safe="true" data-fit-min={min ?? Math.round(size * 0.6)} data-boxed={plain ? undefined : 'true'}>
      <span className={`hm-hl hm-box--${box}`}>{children}</span>
    </div>
  );
}

/** A pen-tool arrow, drawn to the right: the side people tap to go on. */
function PenArrow({ seed, color, w = 170, h = 90 }: { seed: number; color: string; w?: number; h?: number }) {
  const { shaft, head } = arrowPaths(w, h, seed);
  return (
    <svg className="hm-pen" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={shaft} stroke={color} />
      <path d={head} stroke={color} />
    </svg>
  );
}

/** Next-frame cue: a typed line and a pen arrow, on the right. */
function Cue({ text, t }: { text: string; t: Tones }) {
  return (
    <div className="hm-cue" data-safe="true" data-boxed={t.soft.startsWith('plain') ? undefined : 'true'}>
      <span className={`hm-hl hm-box--${t.soft}`}>{text}</span>
      <PenArrow seed={seedOf(text)} color={t.pen} />
    </div>
  );
}

function Credit({ text, t }: { text: string; t: Tones }) {
  return (
    <div className="hm-credit" data-safe="true" data-fit-min={16} data-boxed={t.soft.startsWith('plain') ? undefined : 'true'}>
      <span className={`hm-hl hm-box--${t.soft}`}>
        {HOMEMADE.photo} {text}
      </span>
    </div>
  );
}

function objectPosition(photo: Photo): CSSProperties {
  return photo.focus ? { objectPosition: `${Math.round(photo.focus.x * 100)}% ${Math.round(photo.focus.y * 100)}%` } : {};
}

/** A photo sticker: rounded corners, a slight tilt, dropped on the fill. */
function Sticker({ photo, w, h, tilt }: { photo: Photo; w: number; h: number; tilt: number }) {
  return (
    <div className="hm-sticker" style={{ width: w, height: h, transform: `rotate(${tilt}deg)` }} data-sticker="true">
      <img src={photo.src} alt="" style={objectPosition(photo)} data-photo-kind={photo.kind} />
    </div>
  );
}

/** A logo as a cutout sticker with a white edge. */
function Cutout({ logo, size, tilt }: { logo: Photo; size: number; tilt: number }) {
  return (
    <div className="hm-cutout" style={{ width: size, height: size, transform: `rotate(${tilt}deg)` }} data-safe="true">
      <img src={logo.src} alt="" data-photo-kind="logo" />
    </div>
  );
}

/** Text struck through by hand with the pen tool. */
function Struck({ text, box, size, color, tilt = 0 }: { text: string; box: Box; size: number; color: string; tilt?: number }) {
  const w = Math.round(text.length * size * 0.56);
  const h = Math.round(size * 1.3);
  return (
    <div className="hm-line hm-struck" style={{ '--hm-size': `${size}px`, transform: `rotate(${tilt}deg)` } as CSSProperties} data-safe="true" data-boxed={box.startsWith('plain') ? undefined : 'true'}>
      <span className={`hm-hl hm-box--${box}`}>{text}</span>
      <svg className="hm-pen hm-strike" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" preserveAspectRatio="none">
        <path d={strikePath(w, h, seedOf(text))} stroke={color} />
      </svg>
    </div>
  );
}

/* ── Guess the Number ─────────────────────────────────────────────── */

function GtnIntro({ data, t }: { data: IntroData; t: Tones }) {
  if (!data.difficulty || !data.topic) throw new Error('Guess the Number intro needs a difficulty and a topic');
  return (
    <div className="hm-stack hm-stack--center">
      <Line box={t.plain} size={76} tilt={-4} align="left" shift={30}>
        {HOMEMADE.gtn.today}
      </Line>
      <Line box={t.emph} size={132} tilt={-2} maxH={380}>
        {HOMEMADE.gtn.title}
      </Line>
      <div className="hm-gap" />
      <Line box={t.plain} size={68} tilt={1.5}>
        {HOMEMADE.gtn.difficulty}: {data.difficulty[0]!.toUpperCase() + data.difficulty.slice(1)}{'\u00A0'}{HOMEMADE.gtn.spice[data.difficulty]}
      </Line>
      <Line box={t.plain} size={64} tilt={-1} maxH={280}>
        {HOMEMADE.gtn.topic}: {data.topic}
      </Line>
      <div className="hm-gap hm-gap--big" />
      <Cue text={HOMEMADE.gtn.play} t={t} />
    </div>
  );
}

function Question({ data, t }: { data: QuestionData; t: Tones }) {
  const family = data.photo ? data.family : 'type';
  if (family === 'photo') {
    return (
      <div className="hm-stack hm-stack--bottom">
        <Line box={t.emph} size={92} tilt={-2.5} maxH={250}>
          {HOMEMADE.gtn.kicker}
        </Line>
        <Line box={t.soft} size={52} tilt={0.5} maxH={200}>
          {data.question}
        </Line>
        <Cue text={HOMEMADE.gtn.cue} t={t} />
      </div>
    );
  }
  if (family === 'marquee') {
    return (
      <div className="hm-stack hm-stack--center">
        <Line box={t.emph} size={92} tilt={-2.5} maxH={250}>
          {HOMEMADE.gtn.kicker}
        </Line>
        <div className="hm-gap hm-gap--big" />
        <Sticker photo={data.photo!} w={740} h={470} tilt={3} />
        <div className="hm-gap" />
        <Line box={t.plain} size={54} tilt={-0.5} maxH={210}>
          {data.question}
        </Line>
        <Cue text={HOMEMADE.gtn.cue} t={t} />
      </div>
    );
  }
  return (
    <div className="hm-stack hm-stack--center">
      <Line box={t.plain} size={128} tilt={-3} maxH={480}>
        {HOMEMADE.gtn.kicker}
      </Line>
      <div className="hm-gap" />
      <Line box={t.emph} size={60} tilt={1.5} maxH={300}>
        {data.question}
      </Line>
      <div className="hm-gap" />
      <Cue text={HOMEMADE.gtn.cue} t={t} />
    </div>
  );
}

function Answer({ data, t, backdrop }: { data: AnswerData; t: Tones; backdrop: Backdrop }) {
  const family = data.photo ? data.family : 'type';
  const number = (
    <Line box={accentBox(backdrop)} size={family === 'type' ? 230 : family === 'marquee' ? 160 : 190} min={100} tilt={-3}>
      {data.number}{'\u00A0'}{HOMEMADE.gtn.wow}
    </Line>
  );
  const source = (
    <Line box={t.soft} size={30} tilt={0} align="center">
      {data.source.verb} {data.source.name}
    </Line>
  );
  return (
    <div className={`hm-stack ${family === 'photo' ? 'hm-stack--bottom' : 'hm-stack--center'}`}>
      <Line box={t.soft} size={family === 'marquee' ? 48 : 58} tilt={-2} align="left" shift={10}>
        {HOMEMADE.gtn.reveal}
      </Line>
      {number}
      {family === 'marquee' && (
        <>
          <div className="hm-gap" />
          <Sticker photo={data.photo!} w={620} h={340} tilt={-3} />
        </>
      )}
      <Line box={family === 'photo' ? t.emph : t.plain} size={52} tilt={1} maxH={140}>
        {data.label}
      </Line>
      <Line box={t.soft} size={42} tilt={0} maxH={120}>
        {data.meaning}
      </Line>
      <Line box={t.emph} size={56} tilt={2} shift={30}>
        {HOMEMADE.gtn.close}
      </Line>
      {source}
    </div>
  );
}

/* ── Free vs. Paid ────────────────────────────────────────────────── */

function FvpIntro({ t, backdrop }: { t: Tones; backdrop: Backdrop }) {
  return (
    <div className="hm-stack hm-stack--center">
      <Line box={freeBox(backdrop)} size={170} tilt={-4} align="left" shift={20}>
        {HOMEMADE.fvp.free}
      </Line>
      <Line box={t.plain} size={84} tilt={0}>
        {HOMEMADE.fvp.vs}
      </Line>
      <Line box={paidBox(backdrop)} size={170} tilt={3} align="right" shift={-20}>
        {HOMEMADE.fvp.paid}
      </Line>
      <div className="hm-gap" />
      <Line box={t.plain} size={52} tilt={0} maxH={340}>
        {FVP.intro.line}
      </Line>
      <div className="hm-gap" />
      <Cue text={HOMEMADE.fvp.introCue} t={t} />
    </div>
  );
}

function Paid({ data, t, backdrop }: { data: PaidData; t: Tones; backdrop: Backdrop }) {
  return (
    <div className="hm-stack hm-stack--center">
      {data.logo && <Cutout logo={data.logo} size={260} tilt={-7} />}
      <Line box={t.emph} size={80} tilt={-2} maxH={200}>
        {data.tool}
      </Line>
      <Line box={paidBox(backdrop)} size={112} min={72} tilt={2.5}>
        {data.price}/month{'\u00A0'}{HOMEMADE.fvp.ouch}
      </Line>
      <div className="hm-gap" />
      <Line box={t.plain} size={52} tilt={0} maxH={210}>
        {data.tease}
      </Line>
      <div className="hm-gap" />
      <Cue text={HOMEMADE.fvp.cue} t={t} />
    </div>
  );
}

function Free({ data, t, backdrop }: { data: FreeData; t: Tones; backdrop: Backdrop }) {
  return (
    <div className="hm-stack hm-stack--center">
      {data.logo && <Cutout logo={data.logo} size={230} tilt={6} />}
      <Line box={t.emph} size={90} tilt={-2} maxH={200}>
        {data.tool}
        {data.devTool ? ' (dev tool)' : ''}
      </Line>
      <div className="hm-row">
        <Line box={freeBox(backdrop)} size={112} min={72} tilt={-3}>
          {HOMEMADE.fvp.freeBadge}
        </Line>
        <Struck text={data.paidPrice} box={t.plain} size={54} color={t.pen} tilt={2} />
      </div>
      <Line box={t.plain} size={48} tilt={0} maxH={190}>
        {data.what}
      </Line>
      <Line box={t.plain} size={42} tilt={-1.5} align="left" shift={10}>
        {HOMEMADE.fvp.howTo}
      </Line>
      <Line box={t.emph} size={50} tilt={0.5}>
        {data.how}
      </Line>
      <Line box={t.plain} size={44} tilt={-0.5}>
        {data.platforms}
      </Line>
    </div>
  );
}
