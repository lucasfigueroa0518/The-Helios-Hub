import '@/app/reels/reels.css';

/** Shell for a content-type page (Carousels, Stories, and the rest) while its queue loads. */
export function TypeHubLoading() {
  return (
    <div className="rh" role="status" aria-live="polite" aria-busy="true">
      <div className="rh__inner helios-loading">
        <span className="helios-skel helios-skel--title" />
        <span className="helios-skel helios-skel--line" />
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
