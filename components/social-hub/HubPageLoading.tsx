/** The shell for a Social Hub place, shown while its data renders. Uses the hub's shimmer. */
export function HubPageLoading({ kind }: { kind: 'content' | 'calendar' | 'analytics' | 'health' | 'post' }) {
  const label = kind === 'content' ? 'Loading today’s content' : kind === 'calendar' ? 'Loading the calendar' : kind === 'analytics' ? 'Loading analytics' : kind === 'health' ? 'Loading health' : 'Loading the post';
  return (
    <div className="sh-page-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="sh-page-loading__head">
        <span className="sh-skel sh-skel--title" />
        <span className="sh-skel sh-skel--line" />
      </div>
      {kind === 'content' ? (
        <div className="sh-page-loading__row">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="sh-page-loading__card">
              <span className="sh-skel sh-skel--card" />
              <span className="sh-skel sh-skel--line" />
            </span>
          ))}
        </div>
      ) : null}
      {kind === 'calendar' ? <span className="sh-skel sh-skel--calendar" /> : null}
      {kind === 'analytics' ? (
        <>
          <div className="sh-page-loading__stats">
            {Array.from({ length: 4 }, (_, i) => <span key={i} className="sh-skel sh-skel--stat" />)}
          </div>
          <div className="sh-page-loading__list">
            {Array.from({ length: 6 }, (_, i) => <span key={i} className="sh-skel sh-skel--row" />)}
          </div>
        </>
      ) : null}
      {kind === 'health' ? (
        <div className="sh-page-loading__list">
          {Array.from({ length: 8 }, (_, i) => <span key={i} className="sh-skel sh-skel--stat" />)}
        </div>
      ) : null}
      {kind === 'post' ? (
        <>
          <span className="sh-skel sh-skel--block" />
          <span className="sh-skel sh-skel--row" />
          <span className="sh-skel sh-skel--row" />
        </>
      ) : null}
      <span className="sh-sr">{label}</span>
    </div>
  );
}
