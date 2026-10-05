/**
 * Smartlead account ids are Postgres bigints. node-pg returns those as strings,
 * and a `typeof === 'number'` filter drops every one of them.
 */
export function smartleadAccountId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function smartleadAccountIds(values: readonly unknown[]): number[] {
  const ids: number[] = [];
  for (const value of values) {
    const id = smartleadAccountId(value);
    if (id !== null) ids.push(id);
  }
  return ids;
}
