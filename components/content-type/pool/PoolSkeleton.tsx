import '@/components/content-type/pool/pool.css';

/** The pool screen while its page loads (DESIGN.md Pool screen, loading): the header line, three day columns and skeleton rows. No hooks, so a route's loading file can render it. */
export function PoolSkeleton() {
  return (
    <div className="pl" aria-hidden="true">
      <span className="pl-sk-line" style={{ width: 280, marginTop: 8 }} />
      <span className="pl-sk-line" style={{ width: 200, marginTop: 10, height: 8 }} />
      <div className="pl-days-head"><h2>Next three days</h2></div>
      <div className="pl-days">
        {[0, 1, 2].map((i) => (
          <div key={i} className="pl-daycol">
            <span className="pl-sk-line" style={{ width: '40%' }} />
            <span className="pl-sk-line" />
            <span className="pl-sk-line" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="pl-bar"><span className="pl-sk-line" style={{ width: 160, height: 28 }} /></div>
      <div className="pl-panel">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="pl-sk"><i /><i /><i /></div>)}
      </div>
    </div>
  );
}
