/** The hub's data didn't arrive: say so plainly, keep the raw reason one click away for whoever debugs it. */
export function LoadError({ message }: { message: string }) {
  return (
    <div className="sh-panel sh-empty" role="alert">
      <strong>The hub’s data didn’t load</strong>
      Reload in a moment. If it keeps happening, the database may be unreachable.
      {message ? (
        <details className="sh-more">
          <summary>Technical detail</summary>
          <p className="sh-subtle">{message}</p>
        </details>
      ) : null}
    </div>
  );
}
