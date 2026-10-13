'use client';

import type { CSSProperties, ReactNode } from 'react';

import { BACKDROP_MAX_UPSCALE, BLEED_MAX_UPSCALE, SHARP_UPSCALE, SLIDE, coverScale, matteBox, panelTreatment, type Size } from '@/lib/social/render/framing';
import { DEFAULT_ICON, ICONS } from '@/lib/social/render/icons';
import type { SlideCopy, SpanRun } from '@/lib/social/render/types';

export type EyeStop = { id: string; label: string; x: number; y: number };
export type EyePath = EyeStop[];

export const MIN = { headline: 44, cover: 48, body: 28, number: 52, splitNumber: 40, note: 22, quote: 36, by: 18, landing: 52 } as const;

const FRAMES: Record<string, Size> = {
  'helios-cover__photo': { w: 1080, h: 780 },
  'helios-split__photo': { w: 888, h: 500 },
  'helios-quote__speaker': { w: 220, h: 220 },
  'helios-v2-cover__photo': { w: 1080, h: 780 },
  'helios-v2-split__photo': { w: 888, h: 500 },
  'helios-v2-quote__speaker': { w: 220, h: 220 },
};

export function SpanRunView({ run }: { run: SpanRun | undefined }) {
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

export function Fit({ as: Tag = 'div', className, min, children }: { as?: 'div' | 'h1' | 'h2' | 'p' | 'blockquote'; className: string; min: number; children: ReactNode }) {
  return (
    <Tag className={className} data-fit-min={min}>
      {children}
    </Tag>
  );
}

export function focusStyle(slide: SlideCopy): CSSProperties | undefined {
  const f = slide.photoFocus;
  if (!f) return undefined;
  const pos: CSSProperties = { objectPosition: `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%` };
  return f.windowW ? { ...pos, width: `${f.windowW}px`, flex: 'none', alignSelf: 'center' } : pos;
}

export const photoKindAttr = (slide: SlideCopy) => (slide.photoKind === 'subject' && slide.photoBleed ? 'person-bleed' : slide.photoKind ?? 'scene');

export function IconBackground({ slide, cover }: { slide: SlideCopy; cover?: boolean }) {
  const Icon = (ICONS[slide.icon ?? DEFAULT_ICON] ?? ICONS[DEFAULT_ICON]!).icon;
  const side = slide.iconSide === 'left' ? 'left' : 'right';
  return (
    <div className={`helios-icon-bg helios-icon-bg--${cover ? 'cover' : side}`} aria-hidden="true" data-icon={slide.icon ?? DEFAULT_ICON}>
      <div className="helios-icon-bg__glow" />
      <div className="helios-icon-bg__icon">
        <Icon width="100%" height="100%" strokeWidth={0.42} absoluteStrokeWidth={false} />
      </div>
    </div>
  );
}

export function RegionPhoto({ slide, className }: { slide: SlideCopy; className: string }) {
  if (slide.photoKind === 'logo') {
    return (
      <div className={`${className} helios-logo-region`} aria-hidden="true">
        <div className={`helios-logo-region__plate helios-logo-card__plate--${slide.logoPlate ?? 'light'}`}>
          <img className={`helios-photo helios-logo-card__logo${slide.logoWide ? ' helios-logo-region__logo--wide' : ''}`} src={slide.photoUrl} alt="" data-photo-kind="logo" />
        </div>
      </div>
    );
  }
  const frameKey = Object.keys(FRAMES).find((key) => className.split(/\s+/).includes(key));
  const frame = (frameKey && FRAMES[frameKey]) || FRAMES['helios-split__photo']!;
  const person = slide.photoKind === 'subject';
  const treatment = className.includes('helios-quote__speaker') || className.includes('helios-v2-quote__speaker')
    ? 'fill'
    : person
      ? (slide.photoSize && coverScale(slide.photoSize, frame) > BLEED_MAX_UPSCALE ? 'matte' : 'fill')
      : panelTreatment(slide.photoSize, frame);
  const box = treatment === 'matte' ? matteBox(slide.photoSize, frame) : null;
  const imgStyle: CSSProperties | undefined = box ? { width: `${box.w}px`, height: `${box.h}px`, objectFit: 'contain' } : focusStyle(slide);
  return (
    <div className={`helios-frame helios-frame--${treatment} ${className}`} data-frame={treatment}>
      <div className="helios-frame__blur" aria-hidden="true" style={{ backgroundImage: `url("${slide.photoUrl}")` }} />
      <img className="helios-photo helios-frame__img" src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={slide.photoKind ?? 'scene'} style={imgStyle} />
    </div>
  );
}

export function BleedPhoto({ slide, spread }: { slide: SlideCopy; spread?: 'left' | 'right' }) {
  const cls = spread ? `helios-bleed__photo helios-bleed__photo--spread-${spread}` : 'helios-bleed__photo';
  return <img className={`helios-photo ${cls}`} src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={photoKindAttr(slide)} style={spread ? undefined : focusStyle(slide)} />;
}

export function Backdrop({ slide }: { slide: SlideCopy }) {
  const soft = !!slide.photoSize && coverScale(slide.photoSize, SLIDE) > SHARP_UPSCALE && coverScale(slide.photoSize, SLIDE) <= BACKDROP_MAX_UPSCALE;
  return (
    <>
      <img className={`helios-photo helios-backdrop__img${soft ? ' helios-backdrop__img--soft' : ''}`} src={slide.photoUrl} alt="" aria-hidden="true" data-photo-kind={slide.photoKind ?? 'scene'} style={focusStyle(slide)} />
      <div className="helios-backdrop__shade" aria-hidden="true" />
    </>
  );
}

export function PhotoCredit({ credit }: { credit: string | undefined }) {
  if (!credit) return null;
  return <div className="helios-photo-credit">{credit}</div>;
}

export function LogoCard({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-logo-card" aria-hidden="true">
      <div className="helios-logo-card__wordmark">HELIOS</div>
      <div className={`helios-logo-card__plate helios-logo-card__plate--${slide.logoPlate ?? 'light'}`}>
        <img className={`helios-photo helios-logo-card__logo${slide.logoWide ? ' helios-logo-card__logo--wide' : ''}`} src={slide.photoUrl} alt="" data-photo-kind="logo" />
      </div>
    </div>
  );
}

export function coverModeOf(slide: SlideCopy): 'icon' | 'logo' | 'split' | 'bleed' {
  if (!slide.photoUrl) return 'icon';
  if (slide.photoKind === 'logo') return 'logo';
  if (slide.coverMode === 'split' || slide.coverMode === 'bleed') return slide.coverMode;
  if (slide.photoKind === 'subject' && !slide.photoBleed) return 'split';
  return 'bleed';
}
