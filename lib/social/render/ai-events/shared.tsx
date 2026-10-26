'use client';

/**
 * Pieces every AI Events look shares (plan M5). The cover is one layout for every look (AE-22: the
 * plain stage, or white for Daylight, with the hook, the calendar CTA, the week and the cities); the
 * city slide's top pick and honorable mentions (AE-24/25) are shared blocks each look frames its own
 * way. The Helios mark appears only on the closing slide (AE-26). Built from the design system's Premium recipes
 * (explainers/design/helios-design-system/premium.css: .hp-orb, .hp-eyebrow, .hp-headline, .hp-lit,
 * .hp-glass, .hp-tile, .hp-card, .hp-footer, .hp-cta); per-look layout and sizes live in
 * drafts/ai-events.css. Every text block is a <Fit> region (text-fit.ts), so copy that will not fit
 * at its minimum size fails the render instead of overflowing.
 */
import { Fragment, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Code, GraduationCap, Lock, Mic, Presentation, Ticket, Users, Utensils, type LucideIcon } from 'lucide-react';

import type { AeEventRow, AeIcon, AeMention, AeSlide } from '@/lib/social/render/types';

import { Fit } from '../drafts/blocks';

export type AeCover = Extract<AeSlide, { role: 'cover' }>;
export type AeCity = Extract<AeSlide, { role: 'city' }>;
export type AeCta = Extract<AeSlide, { role: 'cta' }>;
export type AeTease = Extract<AeSlide, { role: 'tease' }>;
export type AeRank = Extract<AeSlide, { role: 'rank' }>;

/** The whole Helios mark (DS iconography), the 5000px file; drawn only on the closing slide (AE-26). */
export const MARK_HD = '/social/helios-mark-hd.png';

/** Minimum font sizes (px) per text region; below these the render fails. */
export const AE_MIN = {
  eyebrow: 16,
  hook: 64,
  week: 18,
  mention: 22,
  hookOrb: 64,
  city: 60,
  sub: 24,
  when: 16,
  title: 28,
  meta: 20,
  more: 18,
  foot: 12,
  site: 40,
  line: 24,
  cta: 18,
  meta2: 18,
} as const;

export const AE_ICONS: Record<AeIcon, LucideIcon> = {
  calendar: CalendarDays,
  users: Users,
  mic: Mic,
  code: Code,
  presentation: Presentation,
  utensils: Utensils,
  ticket: Ticket,
  graduation: GraduationCap,
};

/** The whole mark inside a halo (`.hp-orb`). `data-protect="logo"`: nothing may be drawn over it (DS logo protection). */
export function Orb({ className }: { className: string }) {
  return (
    <span className={`hp-orb ae-orb ${className}`} data-protect="logo">
      <img src={MARK_HD} alt="Helios" />
    </span>
  );
}

export function Eyebrow({ text, className = '', bare = false }: { text: string; className?: string; bare?: boolean }) {
  return (
    <Fit as="p" className={`hp-eyebrow ae-eyebrow ${bare ? 'hp-eyebrow--bare ' : ''}${className}`} min={AE_MIN.eyebrow}>
      {text}
    </Fit>
  );
}

/**
 * Copy with any "→" drawn as the Lucide arrow (DS: no unicode glyphs as icons). The text itself stays
 * verbatim (a hook in the bank ends in "→"); only its drawing changes. The arrow is kept with the word
 * before it, so it never wraps onto a line of its own.
 */
export function withArrows(text: string): ReactNode {
  const parts = text.split(/\s*→/);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i === parts.length - 1) return part ? <Fragment key={i}>{part}</Fragment> : null;
    const cut = part.lastIndexOf(' ');
    return (
      <Fragment key={i}>
        {part.slice(0, cut + 1)}
        <span className="ae-nowrap">
          {part.slice(cut + 1)}
          <ArrowRight className="ae-arrow" strokeWidth={3} aria-label="→" />
        </span>
      </Fragment>
    );
  });
}

/** A headline whose last line is lit (`.hp-lit`: solid orange with a glow, never gradient text). Pragmatica is clipped to its lines (`.ae-clip`). */
export function Headline({ as = 'h1', className, min, lead, lit }: { as?: 'h1' | 'h2'; className: string; min: number; lead?: string; lit: string }) {
  return (
    <Fit as={as} className={`hp-headline ae-headline ${className}`} min={min}>
      <span className="ae-clip">
        {lead ? <span className="ae-lead">{withArrows(lead)}</span> : null}
        <span className="hp-lit ae-lit">{withArrows(lit)}</span>
      </span>
    </Fit>
  );
}

/** Host and venue on one line up to this many characters (the narrowest list at the meta's size); longer, one line each. */
const META_INLINE_CHARS = 52;

/** The top pick's text (AE-24): the "TOP PICK" label, the day and time, the title, then "Hosted by … · Venue". */
export function EventText({ ev, label }: { ev: AeEventRow; label: string }) {
  const inline = !ev.host || !ev.place || ev.host.length + ev.place.length + 3 <= META_INLINE_CHARS;
  return (
    <>
      <Eyebrow text={label} className="ae-pick-label" bare />
      <Fit as="p" className="ae-when" min={AE_MIN.when}>{ev.when}</Fit>
      <Fit as="p" className="ae-title" min={AE_MIN.title}>
        <span className="ae-clip">{ev.title}</span>
      </Fit>
      {ev.host || ev.place ? (
        <Fit as="p" className={inline ? 'ae-meta' : 'ae-meta ae-meta--stack'} min={AE_MIN.meta}>
          {ev.host ? <span className="ae-host">{ev.host}</span> : null}
          {inline && ev.host && ev.place ? <span className="ae-sep"> · </span> : null}
          {ev.place ? <span className="ae-place">{ev.place}</span> : null}
        </Fit>
      ) : null}
    </>
  );
}

export function EventIcon({ icon, className }: { icon: AeIcon; className: string }) {
  const Icon = AE_ICONS[icon] ?? CalendarDays;
  return (
    <span className={className} aria-hidden="true">
      <Icon strokeWidth={2} />
    </span>
  );
}

/** The honorable mentions (AE-25): a ruled label, then one row each of the day and the title. */
export function Mentions({ label, mentions, className = '' }: { label: string; mentions: AeMention[]; className?: string }) {
  if (!mentions.length) return null;
  return (
    <div className={`ae-mentions ${className}`} data-count={mentions.length}>
      <Fit as="p" className="ae-mentions-label" min={AE_MIN.foot}>{label}</Fit>
      {mentions.map((m, i) => (
        <div key={i} className="ae-mention">
          <Fit as="p" className="ae-mention-day" min={AE_MIN.foot}>{m.day}</Fit>
          <Fit as="p" className="ae-mention-title" min={AE_MIN.mention}>{m.title}</Fit>
        </div>
      ))}
    </div>
  );
}

/** The city slide's CTA: "+5 more Boston events on our free calendar · Link in bio". */
export function MoreCta({ more, cta, className = '' }: { more: string; cta: string; className?: string }) {
  return (
    <div className={`ae-more ${className}`}>
      <span className="hp-tile hp-tile--sm ae-more-icon" aria-hidden="true">
        <CalendarDays strokeWidth={2} />
      </span>
      <Fit as="p" className="ae-more-text" min={AE_MIN.more}>
        {more}
        <span className="ae-sep"> · </span>
        <strong>{cta}</strong>
      </Fit>
    </div>
  );
}

/** The hairline footer (`.hp-footer`): a tracked label at each end. */
export function Footer({ left, right, className = '' }: { left: string; right: string; className?: string }) {
  return (
    <div className={`hp-footer ae-footer ${className}`}>
      <Fit as="p" className="ae-foot-l" min={AE_MIN.foot}>{left}</Fit>
      <Fit as="p" className="ae-foot-r" min={AE_MIN.foot}><strong>{right}</strong></Fit>
    </div>
  );
}

/** The cover's CTA line (AE-22): "Free AI Events Calendar · Link in bio", with "Link in bio" lit. */
export function CoverCta({ cta }: { cta: string }) {
  const cut = cta.lastIndexOf(' · ');
  const lead = cut > 0 ? cta.slice(0, cut) : '';
  const action = cut > 0 ? cta.slice(cut + 3) : cta;
  return (
    <Fit as="p" className="ae-cv-cta" min={AE_MIN.cta}>
      {lead ? <span className="ae-cv-cta-lead">{lead}</span> : null}
      {lead ? <span className="ae-sep"> · </span> : null}
      <strong>{action}</strong>
    </Fit>
  );
}

/**
 * The tease (AE-29), every look: on the cover's plain stage (Daylight: white), "Want to see the full
 * list? →" over a locked card for the week's #1. The card's lines are placeholders blurred out, so the
 * #1 is only on the site; the lock and the CTA say where.
 */
export function Tease({ s }: { s: AeTease }) {
  const white = s.look === 'daylight';
  return (
    <div className={white ? 'ae-frame' : 'ae-frame premium'} data-look={s.look} data-role="tease">
      <div className="ae-tz">
        <Headline as="h1" className="ae-tz-hook" min={AE_MIN.city} lead={s.lead} lit={s.lit} />
        <div className="ae-tz-card-wrap">
          <div className={white ? 'ae-dl-pick ae-tz-card' : 'hp-card ae-tz-card'}>
            <div className="ae-tz-blur" aria-hidden="true">
              <span className="ae-tz-bar ae-tz-bar--sm" />
              <span className="ae-tz-bar ae-tz-bar--lg" />
              <span className="ae-tz-bar ae-tz-bar--md" />
            </div>
            <div className="ae-tz-lock">
              <span className="hp-tile ae-tz-lock-icon" aria-hidden="true">
                <Lock strokeWidth={2} />
              </span>
              <Fit as="p" className="ae-tz-rank" min={AE_MIN.city}>{s.rank}</Fit>
              <Eyebrow text={s.label} className="ae-eyebrow--center" bare />
            </div>
          </div>
        </div>
        <CoverCta cta={s.cta} />
      </div>
      {white ? (
        <span className="premium ae-island">
          <Swipe />
        </span>
      ) : (
        <Swipe />
      )}
    </div>
  );
}

/** The glossy swipe tile (`.hp-tile`), bottom right on every slide but the last. */
export function Swipe() {
  return (
    <span className="hp-tile ae-swipe" aria-hidden="true">
      <ArrowRight strokeWidth={2.25} />
    </span>
  );
}

/** The orange CTA pill with its glow (`.hp-cta`); `halo` adds the two halo rings (the final slide's dominant CTA). */
export function CtaPill({ label, className = '', halo = false }: { label: string; className?: string; halo?: boolean }) {
  return (
    <div className={`hp-cta ae-cta ${halo ? 'ae-cta--halo ' : ''}${className}`}>
      <Fit as="p" className="ae-cta-text" min={AE_MIN.cta}>{label}</Fit>
      <ArrowUpRight strokeWidth={2.25} aria-hidden="true" />
    </div>
  );
}

/**
 * The cover, every look (AE-22): the plain stage (Daylight: white), the hook centred and large, the
 * calendar CTA under it, the week above and the cities below, quiet, and the swipe tile. No mark, no
 * light, no pills: the hook and the CTA are what the eye lands on.
 */
export function Cover({ s }: { s: AeCover }) {
  const white = s.look === 'daylight';
  return (
    <div className={white ? 'ae-frame' : 'ae-frame premium'} data-look={s.look} data-role="cover">
      <div className="ae-cv">
        <Fit as="p" className="ae-cv-week" min={AE_MIN.week}>{s.week}</Fit>
        <Headline as="h1" className="ae-cv-hook" min={AE_MIN.hook} lead={s.lead} lit={s.lit} />
        <CoverCta cta={s.cta} />
      </div>
      <Fit as="p" className="ae-cv-cities" min={AE_MIN.foot}>{s.cities.map((c) => c.short).join('  ·  ')}</Fit>
      {white ? (
        <span className="premium ae-island">
          <Swipe />
        </span>
      ) : (
        <Swipe />
      )}
    </div>
  );
}
