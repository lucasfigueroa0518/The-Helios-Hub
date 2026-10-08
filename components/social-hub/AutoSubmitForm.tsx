'use client';

import type { ReactNode } from 'react';

/**
 * A plain GET form that submits when a select changes, so every view state
 * lives in the URL. Works without JavaScript through its Apply button.
 */
export function AutoSubmitForm({ action, hidden, children, label }: { action: string; hidden: Record<string, string | undefined>; children: ReactNode; label: string }) {
  return (
    <form
      method="get"
      action={action}
      className="sh-form"
      aria-label={label}
      onChange={(event) => (event.currentTarget as HTMLFormElement).requestSubmit()}
    >
      {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      {children}
      <noscript><button type="submit" className="sh-btn">Apply</button></noscript>
    </form>
  );
}
