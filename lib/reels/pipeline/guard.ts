/**
 * One bad item must not fail the night. Callers keep going and record the
 * message. A PDF, a null byte, or any other single-item throw stays on that item.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function noteItemFailure(label: string, error: unknown): string {
  const message = errorText(error);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'reels-item',
      message: 'item_failed',
      label,
      error: message,
    }),
  );
  return `${label}: ${message}`;
}

/** Runs one item. Returns the failure line, or null when the item finished. */
export async function guardItem(label: string, work: () => Promise<void>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    return noteItemFailure(label, error);
  }
}
