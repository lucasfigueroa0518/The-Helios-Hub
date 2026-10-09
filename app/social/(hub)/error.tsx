'use client';

/** Something on this page threw: a plain sentence and a retry, with the raw reason tucked away. */
export default function HubError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sh-panel sh-empty" role="alert">
      <strong>This page hit a problem</strong>
      Try again; if it keeps happening, the rest of the hub still works.
      <button type="button" className="sh-btn" onClick={reset}>Try again</button>
      {error.message || error.digest ? (
        <details className="sh-more">
          <summary>Technical detail</summary>
          <p className="sh-subtle">{error.message}{error.digest ? ` (ref ${error.digest})` : ''}</p>
        </details>
      ) : null}
    </div>
  );
}
