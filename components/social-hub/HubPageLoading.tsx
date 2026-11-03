/**
 * The shell for a Social Hub place, shown while its data renders. Uses the hub's shimmer.
 *
 * It renders inside the hub's `.sh__inner` (max-width, centred, 32px gutters, 24px gap), so it is a fragment: its
 * pieces are direct children of that column, spaced and aligned like the real screen's. Header, section heads, the
 * today strip and the pool grid reuse the real classes' boxes, so nothing moves when the page arrives.
 */
type Kind = 'content' | 'calendar' | 'analytics' | 'health' | 'post';

const LABEL: Record<Kind, string> = {
  content: 'Loading today’s content',
  calendar: 'Loading the calendar',
  analytics: 'Loading analytics',
  health: 'Loading health',
  post: 'Loading the post',
};

function Head({ meta, actions, aside }: { meta?: boolean; actions?: number; /** The title carries a day label beside it (Today). */ aside?: boolean }) {
  return (
    <header className="sh-head" aria-hidden="true">
      <div className="sh-head__text">
        <span className={`sh-skel sh-skel--head-title${aside ? ' sh-skel--head-aside' : ''}`} />
        {meta ? <span className="sh-skel sh-skel--head-meta" /> : null}
      </div>
      {actions ? (
        <div className="sh-head__actions">
          {Array.from({ length: actions }, (_, i) => <span key={i} className="sh-skel sh-skel--btn" />)}
        </div>
      ) : null}
    </header>
  );
}

function SectionHead({ width = 150 }: { width?: number }) {
  return (
    <div className="sh-section__head">
      <span className="sh-skel sh-skel--sec-title" style={{ width }} />
    </div>
  );
}

export function HubPageLoading({ kind }: { kind: Kind }) {
  return (
    <>
      {kind === 'content' ? (
        <>
          <Head meta aside actions={2} />
          <section className="sh-section" aria-hidden="true">
            <SectionHead width={160} />
            <div className="sh-strip sh-gallery">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="sh-panel sh-strip__card sh-gallery__card sh-skel-card">
                  <span className="sh-skel sh-strip__art sh-gallery__art is-tall" />
                  <span className="sh-skel sh-skel--card-line" />
                  <span className="sh-skel sh-skel--card-line sh-skel--short" />
                  <span className="sh-skel sh-skel--card-pill" />
                  <span className="sh-skel sh-skel--card-btn" />
                  <span className="sh-skel sh-skel--card-btn" />
                </div>
              ))}
            </div>
          </section>
          <section className="sh-section" aria-hidden="true">
            <SectionHead width={110} />
            <div className="sh-pools">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="sh-panel sh-pool sh-pool--skel">
                  <span className="sh-skel sh-skel--card-line" />
                  <span className="sh-skel sh-skel--card-line sh-skel--short" />
                  <span className="sh-skel sh-skel--card-line" />
                </div>
              ))}
            </div>
          </section>
          <section className="sh-section" aria-hidden="true">
            <SectionHead width={90} />
            <div className="sh-panel">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="sh-skel-lib">
                  <span className="sh-skel sh-skel--lib-icon" />
                  <span className="sh-skel sh-skel--card-line" />
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {kind === 'calendar' ? (
        <>
          <Head actions={3} />
          <span className="sh-skel sh-skel--calendar" aria-hidden="true" />
        </>
      ) : null}
      {kind === 'analytics' ? (
        <>
          <Head meta />
          <div className="sh-page-loading__stats" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <span key={i} className="sh-skel sh-skel--stat" />)}
          </div>
          <div className="sh-page-loading__list" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <span key={i} className="sh-skel sh-skel--row" />)}
          </div>
        </>
      ) : null}
      {kind === 'health' ? (
        <>
          <Head meta />
          <div className="sh-page-loading__list" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => <span key={i} className="sh-skel sh-skel--stat" />)}
          </div>
        </>
      ) : null}
      {kind === 'post' ? (
        <div className="sh-page-loading__list" aria-hidden="true">
          <span className="sh-skel sh-skel--block" />
          <span className="sh-skel sh-skel--row" />
          <span className="sh-skel sh-skel--row" />
        </div>
      ) : null}
      <span className="sh-sr" role="status" aria-live="polite" aria-busy="true">{LABEL[kind]}</span>
    </>
  );
}
