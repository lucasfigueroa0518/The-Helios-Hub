'use client';

/**
 * The rank slide (AE-29), every look: no card, no label. The rank ("#2"), the organizer's poster
 * shown whole (never cropped: posters carry their own type), then the day and time, the title, the
 * host and the venue, each on its own line with room around it. Three layouts:
 *   poster   the poster at the top, the text under it, left aligned
 *   ambient  the poster centred on a blurred, dimmed copy of itself, the text centred under it
 *   type     no image: the rank and the event set large (also any layout whose event has no poster)
 * On the plain stage (Daylight: white), so the poster carries the colour. Behind it, the outlined rank
 * numerals (AE-33): by default each straddles a seam, so the swipe joins one slide to the next.
 */
import { Fit } from '../drafts/blocks';
import { AE_MIN, type AeRank, Swipe } from './shared';

export function Rank({ s }: { s: AeRank }) {
  const white = s.look === 'daylight';
  const ev = s.pick;
  const layout = ev.image ? s.layout : 'type';
  const treat = new Set(s.treat ?? []);
  const panorama = treat.has('panorama');
  const treatAttr = [...treat].sort().join(' ') || undefined;
  return (
    <div className={white ? 'ae-frame' : 'ae-frame premium'} data-look={s.look} data-role="rank" data-layout={layout} data-treat={treatAttr}>
      {layout === 'ambient' ? <img className="ae-rk-haze" src={ev.image} alt="" aria-hidden="true" /> : null}
      {treat.has('ghost') || panorama ? (
        <div className="ae-bleed" aria-hidden="true">
          {panorama ? <span className="ae-rk-wash" /> : null}
          <span className={panorama ? 'ae-rk-glow ae-rk-glow--seam-in' : 'ae-rk-glow'} />
          {panorama && s.next ? <span className="ae-rk-glow ae-rk-glow--seam-out" /> : null}
          <span className={panorama ? 'ae-rk-ghost ae-rk-ghost--seam-in' : 'ae-rk-ghost'}>{s.rank}</span>
          {panorama && s.next ? <span className="ae-rk-ghost ae-rk-ghost--seam-out">{s.next}</span> : null}
        </div>
      ) : null}
      <div className="ae-rk">
        <Fit as="p" className="ae-rk-rank" min={AE_MIN.city}>{`#${s.rank}`}</Fit>
        {layout !== 'type' ? (
          <div className="ae-rk-poster">
            <img className="ae-rk-pic" src={ev.image} alt="" />
          </div>
        ) : null}
        <div className="ae-rk-text">
          <Fit as="p" className="ae-rk-when" min={AE_MIN.when}>{ev.when}</Fit>
          <Fit as="p" className="ae-rk-title" min={AE_MIN.title}>
            <span className="ae-clip">{ev.title}</span>
          </Fit>
          {ev.host ? <Fit as="p" className="ae-rk-host" min={AE_MIN.meta}>{ev.host}</Fit> : null}
          {ev.place ? <Fit as="p" className="ae-rk-place" min={AE_MIN.meta}>{ev.place}</Fit> : null}
        </div>
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
