/** Dollar formats for the Cost page. Micros are integer micro-dollars. */

/** Whole dollars from $100 up, cents below. `scale` picks the format from another figure (a count-up keeps its final format). */
export function money(micros: number, scale = micros): string {
  const usd = micros / 1e6;
  return Math.abs(scale) >= 100e6 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`;
}

/** Budget-style figures: whole dollars from $10 up ("$61 of $100"), cents below. */
export function dollars(micros: number): string {
  const usd = micros / 1e6;
  return Math.abs(usd) >= 10 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`;
}

/** Cost per interaction: small numbers keep enough digits to compare. */
export function perUnit(micros: number | null): string {
  if (micros === null) return '—';
  const usd = micros / 1e6;
  return `$${usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/** "Oct 8" from a day key. */
export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
