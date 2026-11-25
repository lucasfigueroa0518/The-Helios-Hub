/**
 * The per-type switch (PHASE3-CONTRACT.md "Switch + fallback"): `intake.settings` key `photo_finders` holds
 * `{ "<profile>": "shared" | "legacy" }`. Same pattern as readConsumerSettings (lib/intake/read.ts). A missing row,
 * a missing key, any other value, garbage JSON, a missing table or any read error reads as 'legacy'. Never throws.
 */
import { PHOTO_FINDERS_SETTINGS_KEY, PHOTO_PROFILE_IDS, type PhotoFinderMode, type PhotoFinderModes, type PhotoProfileId } from './types';

type SettingsQuery = { query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };

const allLegacy = (): PhotoFinderModes => Object.fromEntries(PHOTO_PROFILE_IDS.map((id) => [id, 'legacy'])) as PhotoFinderModes;

export async function readPhotoFinderModes(q: SettingsQuery): Promise<PhotoFinderModes> {
  const out = allLegacy();
  try {
    const { rows } = await q.query<{ value: unknown }>(`SELECT value FROM intake.settings WHERE key = $1`, [PHOTO_FINDERS_SETTINGS_KEY]);
    const raw = rows[0]?.value;
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const id of PHOTO_PROFILE_IDS) if ((value as Record<string, unknown>)[id] === 'shared') out[id] = 'shared';
    return out;
  } catch {
    return allLegacy();
  }
}

/** One type's mode; absent modes (or anything but 'shared') read as 'legacy'. */
export function photoFinderMode(modes: PhotoFinderModes | null | undefined, id: PhotoProfileId): PhotoFinderMode {
  return modes?.[id] === 'shared' ? 'shared' : 'legacy';
}
