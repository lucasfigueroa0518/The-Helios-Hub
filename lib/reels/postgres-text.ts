/**
 * Postgres text and jsonb both reject U+0000, and jsonb also rejects an
 * unpaired surrogate. Untrusted pages contain both. Strip them before a write
 * so one bad string cannot abort the night.
 */
export function postgresText(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[index] + value[index + 1];
        index += 1;
        continue;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[index];
  }
  return out;
}

/** JSON text Postgres can store. Strings are cleaned; every other value is left alone. */
export function postgresJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'string' ? postgresText(item) : item));
}
