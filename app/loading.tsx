export default function HomeLoading() {
  return (
    <div className="hub-home" role="status" aria-live="polite" aria-busy="true">
      <div className="hub-home__inner helios-loading">
        <span className="helios-skel helios-skel--line" />
        <span className="helios-skel helios-skel--title" />
        <div className="helios-loading__row">
          <span className="helios-skel helios-skel--tile" />
          <span className="helios-skel helios-skel--tile" />
          <span className="helios-skel helios-skel--tile" />
        </div>
        <span className="visually-hidden">Loading</span>
      </div>
    </div>
  );
}
