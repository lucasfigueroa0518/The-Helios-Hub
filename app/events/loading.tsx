export default function EventsLoading() {
  return (
    <main className="app-shell networking-page">
      <section className="card" role="status" aria-live="polite" aria-busy="true">
        <div className="card__header">
          <span className="helios-skel helios-skel--title" />
        </div>
        <div className="card__body helios-loading">
          <div className="helios-loading__row">
            <span className="helios-skel helios-skel--tile" />
            <span className="helios-skel helios-skel--tile" />
            <span className="helios-skel helios-skel--tile" />
          </div>
          <span className="helios-skel helios-skel--block" />
          <span className="visually-hidden">Loading networking</span>
        </div>
      </section>
    </main>
  );
}
