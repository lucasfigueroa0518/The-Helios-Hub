'use client';

/**
 * The orb: title-slide energy (the DS Premium title slide, Rally Point p. 1). City slides are
 * left-aligned on hairlines: the city, then the top pick between rules. The closing slide is a massive
 * headline with the whole mark large on the right inside its clear space (never cropped, never off the
 * canvas, nothing over it) and a hairline meta row. The cover is the shared plain-stage cover (AE-22).
 */
import { Fit } from '../drafts/blocks';
import { AE_MIN, type AeCity, type AeCover, type AeCta, Cover, CtaPill, Eyebrow, EventText, Headline, Mentions, MoreCta, Orb, Swipe } from './shared';

function MetaCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`ae-ob-cell ${className}`}>
      <Fit as="p" className="ae-ob-label" min={AE_MIN.foot}>{label}</Fit>
      <Fit as="p" className="ae-ob-value" min={AE_MIN.meta2}>{value}</Fit>
    </div>
  );
}

export function OrbCover({ s }: { s: AeCover }) {
  return <Cover s={s} />;
}

export function OrbCity({ s }: { s: AeCity }) {
  return (
    <div className="ae-frame premium" data-look="orb" data-role="city">
      <div className="ae-head ae-ob-head">
        <Headline as="h2" className="ae-city" min={AE_MIN.city} lit={s.city} />
      </div>
      <div className="ae-body">
        <div className="ae-ob-pick ae-pick">
          <EventText ev={s.pick} label={s.label} />
        </div>
        <Mentions label={s.mentionsLabel} mentions={s.mentions} />
      </div>
      <MoreCta more={s.more} cta={s.cta} />
      <Swipe />
    </div>
  );
}

export function OrbCta({ s }: { s: AeCta }) {
  return (
    <div className="ae-frame premium" data-look="orb" data-role="cta">
      <div className="ae-ob-kicker">
        <Eyebrow text={s.eyebrow} />
        <Fit as="p" className="ae-ob-kicker-line" min={AE_MIN.line}>{s.line}</Fit>
      </div>
      <Orb className="ae-ob-orb" />
      <div className="ae-ob-copy ae-ob-copy--cta">
        <Headline as="h1" className="ae-ob-hook ae-final" min={AE_MIN.hookOrb} lead={s.lead} lit={s.lit} />
        <Fit as="p" className="ae-site" min={AE_MIN.site}><span className="ae-clip">{s.site}</span></Fit>
      </div>
      <div className="ae-ob-meta ae-ob-meta--cta">
        <MetaCell label="Instagram" value={s.handle} />
        <CtaPill label={s.cta} halo />
      </div>
    </div>
  );
}
