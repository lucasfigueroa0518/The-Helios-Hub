'use client';

export default function HubError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sh-card sh-empty" role="alert">
      <strong>Something went wrong on this page</strong>
      <p className="sh-muted">{error.message || 'Unknown error'}</p>
      <button type="button" className="sh-btn" onClick={reset}>Try again</button>
    </div>
  );
}
