export default function DashboardsLoading() {
  return (
    <div className="helios-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="helios-skel helios-skel--title" />
      <span className="helios-skel helios-skel--line" />
      <span className="helios-skel helios-skel--block" />
      <span className="visually-hidden">Loading projects</span>
    </div>
  );
}
