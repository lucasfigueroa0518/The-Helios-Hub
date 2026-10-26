'use client';

/**
 * Spotlight: a lit stage. City slides put the city under a beam (`.hp-beam`) and the top pick in a
 * glow card (`.hp-card`); the closing slide puts the whole mark in the beam's light. The cover is the
 * shared plain-stage cover (AE-22).
 */
import { Fit } from '../drafts/blocks';
import { AE_MIN, type AeCity, type AeCover, type AeCta, Cover, CtaPill, Eyebrow, EventText, Footer, Headline, Mentions, MoreCta, Orb, Swipe } from './shared';

export function SpotlightCover({ s }: { s: AeCover }) {
  return <Cover s={s} />;
}

export function SpotlightCity({ s }: { s: AeCity }) {
  return (
    <div className="ae-frame premium premium--spot" data-look="spotlight" data-role="city">
      <div className="hp-beam" aria-hidden="true" />
      <div className="ae-head ae-head--center">
        <Headline as="h2" className="ae-city" min={AE_MIN.city} lit={s.city} />
      </div>
      <div className="ae-body">
        <article className="hp-card ae-card ae-pick">
          <EventText ev={s.pick} label={s.label} />
        </article>
        <Mentions label={s.mentionsLabel} mentions={s.mentions} />
      </div>
      <MoreCta more={s.more} cta={s.cta} />
      <Footer left="Helios Group" right="heliosgroup.ai" />
      <Swipe />
    </div>
  );
}

export function SpotlightCta({ s }: { s: AeCta }) {
  return (
    <div className="ae-frame premium premium--spot" data-look="spotlight" data-role="cta">
      <div className="hp-beam" aria-hidden="true" />
      <Orb className="ae-sp-orb ae-sp-orb--cta" />
      <div className="ae-sp-copy ae-sp-copy--cta">
        <Eyebrow text={s.eyebrow} className="ae-eyebrow--center" bare />
        <Headline as="h1" className="ae-final" min={AE_MIN.hook} lead={s.lead} lit={s.lit} />
        <Fit as="p" className="ae-line" min={AE_MIN.line}>{s.line}</Fit>
        <Fit as="p" className="ae-site" min={AE_MIN.site}><span className="ae-clip">{s.site}</span></Fit>
        <CtaPill label={s.cta} halo />
      </div>
      <Footer left="Helios Group" right={s.handle} />
    </div>
  );
}
