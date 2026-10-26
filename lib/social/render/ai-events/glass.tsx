'use client';

/**
 * Obsidian glass: frosted panes (`.hp-glass`) under warm light. City slides set the top pick in one
 * large glass panel with a glossy Lucide icon tile; the closing slide puts the whole mark large and low
 * in a strong halo, with clear space of at least its "H" on every side (DS logo protection). The cover
 * is the shared plain-stage cover (AE-22).
 */
import { Fit } from '../drafts/blocks';
import { AE_MIN, type AeCity, type AeCover, type AeCta, Cover, CtaPill, Eyebrow, EventIcon, EventText, Footer, Headline, Mentions, MoreCta, Orb, Swipe } from './shared';

export function GlassCover({ s }: { s: AeCover }) {
  return <Cover s={s} />;
}

export function GlassCity({ s }: { s: AeCity }) {
  return (
    <div className="ae-frame premium" data-look="glass" data-role="city">
      <div className="ae-gl-light ae-gl-light--panel" aria-hidden="true" />
      <div className="ae-head">
        <Headline as="h2" className="ae-city" min={AE_MIN.city} lit={s.city} />
      </div>
      <div className="ae-body">
        <div className="hp-glass ae-panel ae-pick">
          <EventIcon icon={s.pick.icon} className="hp-tile ae-row-icon" />
          <div className="ae-row-body">
            <EventText ev={s.pick} label={s.label} />
          </div>
        </div>
        <Mentions label={s.mentionsLabel} mentions={s.mentions} />
      </div>
      <MoreCta more={s.more} cta={s.cta} />
      <Footer left="Helios Group" right="heliosgroup.ai" />
      <Swipe />
    </div>
  );
}

export function GlassCta({ s }: { s: AeCta }) {
  return (
    <div className="ae-frame premium" data-look="glass" data-role="cta">
      <div className="ae-gl-light" aria-hidden="true" />
      <div className="ae-gl-copy ae-gl-copy--cta">
        <Eyebrow text={s.eyebrow} />
        <Headline as="h1" className="ae-final" min={AE_MIN.hook} lead={s.lead} lit={s.lit} />
        <Fit as="p" className="ae-line" min={AE_MIN.line}>{s.line}</Fit>
      </div>
      <Orb className="ae-gl-orb" />
      <div className="hp-glass ae-gl-card">
        <Fit as="p" className="ae-site" min={AE_MIN.site}><span className="ae-clip">{s.site}</span></Fit>
        <CtaPill label={s.cta} halo />
      </div>
      <Footer left="Helios Group" right={s.handle} />
    </div>
  );
}
