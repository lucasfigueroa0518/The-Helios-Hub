'use client';

/**
 * Daylight: editorial white (the logged exception to the stage rule, AE-14, this series only). An
 * off-black Pragmatica headline whose last line is Helios orange; city slides set the top pick in a
 * hairline card with a tinted orange icon square, and end on a glowing orange CTA pill. No stage
 * ground: Premium recipes are used only inside dark islands (`.premium.ae-island`). The cover is the
 * shared cover on white (AE-22).
 */
import { Fit } from '../drafts/blocks';
import { AE_MIN, type AeCity, type AeCover, type AeCta, Cover, Eyebrow, EventIcon, EventText, Footer, Headline, Mentions, Orb, Swipe } from './shared';

/** The swipe tile is a Premium recipe; on white it sits in its own island. */
function DaylightSwipe() {
  return (
    <span className="premium ae-island">
      <Swipe />
    </span>
  );
}

export function DaylightCover({ s }: { s: AeCover }) {
  return <Cover s={s} />;
}

export function DaylightCity({ s }: { s: AeCity }) {
  return (
    <div className="ae-frame" data-look="daylight" data-role="city">
      <div className="ae-head ae-dl-head">
        <Headline as="h2" className="ae-city" min={AE_MIN.city} lit={s.city} />
      </div>
      <div className="ae-body">
        <div className="ae-dl-pick ae-pick">
          <EventIcon icon={s.pick.icon} className="ae-dl-icon" />
          <div className="ae-row-body">
            <EventText ev={s.pick} label={s.label} />
          </div>
        </div>
        <Mentions label={s.mentionsLabel} mentions={s.mentions} />
      </div>
      <div className="premium ae-island ae-dl-cta-wrap">
        <div className="hp-cta ae-cta ae-cta--halo">
          <Fit as="p" className="ae-cta-text" min={AE_MIN.more}>
            {s.more}
            <span className="ae-sep"> · </span>
            {s.cta}
          </Fit>
        </div>
      </div>
      <Footer left="Helios Group" right="heliosgroup.ai" />
      <DaylightSwipe />
    </div>
  );
}

export function DaylightCta({ s }: { s: AeCta }) {
  return (
    <div className="ae-frame" data-look="daylight" data-role="cta">
      <span className="premium ae-island ae-dl-orb-wrap">
        <Orb className="ae-dl-orb" />
      </span>
      <div className="ae-dl-final">
        <Eyebrow text={s.eyebrow} className="ae-eyebrow--center" />
        <Headline as="h1" className="ae-final" min={AE_MIN.hook} lead={s.lead} lit={s.lit} />
        <Fit as="p" className="ae-line" min={AE_MIN.line}>{s.line}</Fit>
        <Fit as="p" className="ae-site" min={AE_MIN.site}><span className="ae-clip">{s.site}</span></Fit>
        <div className="premium ae-island ae-dl-cta-wrap ae-dl-cta-wrap--final">
          <div className="hp-cta ae-cta ae-cta--halo">
            <Fit as="p" className="ae-cta-text" min={AE_MIN.cta}>{s.cta}</Fit>
          </div>
        </div>
      </div>
      <Footer left="Helios Group" right={s.handle} />
    </div>
  );
}
