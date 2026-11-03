import '@/app/reels/reels.css';
import './type-hub.css';
import './type-hub-loading.css';

/** Card shape per content type: Text on Screen, Explainers and Stories are tall (9:16); carousel-style posts are 4:5. */
const RATIO = { tall: '9 / 16', feed: '4 / 5' } as const;

/**
 * Shell for a content-type page (Carousels, Stories, and the rest) while its queue loads. Same container, header,
 * day strip, card row and bench as TypeHub, so the page does not shift when it arrives.
 */
export function TypeHubLoading({ shape = 'feed' }: { shape?: keyof typeof RATIO }) {
  return (
    <div className="rh" role="status" aria-live="polite" aria-busy="true">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <div className="rh-skel-back"><span className="rh-skel" /></div>
            <span className="rh-skel rh-skel-title" />
          </div>
          <div className="rh__head-actions">
            <span className="rh-skel rh-skel-btn" />
            <span className="rh-skel rh-skel-btn" />
            <span className="rh-skel rh-skel-btn" />
          </div>
        </header>

        <div className="rh-days">
          <span className="rh-skel rh-skel-step" />
          <div className="rh-days__list">
            {Array.from({ length: 7 }, (_, i) => <span key={i} className="rh-skel rh-skel-day" />)}
          </div>
          <span className="rh-skel rh-skel-step" />
        </div>

        <section className="rh-day-head">
          <div className="rh-skel-dayhead">
            <span className="rh-skel" />
            <span className="rh-skel" />
          </div>
        </section>

        <div className="rh-top">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rh-reel">
              <span className="rh-skel rh-skel-media" style={{ aspectRatio: RATIO[shape] }} />
              <span className="rh-skel rh-skel-cap" />
              <span className="rh-skel rh-skel-cap" />
            </div>
          ))}
        </div>

        <section className="rh-rest">
          <span className="rh-skel rh-skel-bench-title" />
          <span className="rh-skel rh-skel-bench-note" />
          <div className="rh-skel-list">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="rh-skel-row"><span className="rh-skel" /></div>)}
          </div>
        </section>
        <span className="visually-hidden">Loading</span>
      </div>
    </div>
  );
}
