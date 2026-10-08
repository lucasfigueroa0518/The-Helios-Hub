export function LoadError({ message }: { message: string }) {
  return (
    <div className="sh-card sh-empty" role="alert">
      <strong>The hub could not load</strong>
      {message}
    </div>
  );
}
