/** Opening a post: the drawer frame shows at once while its numbers load. */
export default function DrawerLoading() {
  return (
    <div className="sh-drawer-loading" role="status" aria-live="polite">
      <div className="sh-drawer-loading__panel">
        <span className="sh-skel sh-skel--line" />
        <span className="sh-skel sh-skel--title" />
        <span className="sh-skel sh-skel--block" />
        <span className="sh-sr">Loading the post…</span>
      </div>
    </div>
  );
}
