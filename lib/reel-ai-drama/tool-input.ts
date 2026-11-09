/**
 * Non-strict tool schemas (the large ones: fact sheet, script, revision, plan) let the model send a nested
 * object or array as a JSON string (a live run sent `verdict` as text). Parse such strings back, recursively,
 * before validation. A string that isn't JSON for an object or array is left as it is.
 */
export function coerceJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return coerceJsonStrings(JSON.parse(t));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(coerceJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceJsonStrings(v)]));
  }
  return value;
}
