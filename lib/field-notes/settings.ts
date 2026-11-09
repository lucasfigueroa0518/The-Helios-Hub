/**
 * field_notes.settings, read and checked (the ai_events.settings rules). SELECT only and no
 * network, so hub read code may use it. Writes live in lib/content-type/posting.ts.
 */
import { DEFAULT_FIELD_NOTES_RUN_CAP_USD, FIELD_NOTES_AUTO_DAYS } from './config';
import { FIELD_NOTES_DEFAULT_SETTINGS, type FieldNotesSettings } from './types';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query). */
export type FieldNotesQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type ParsedFieldNotesSettings = Omit<FieldNotesSettings, 'runCapUsd'> & {
  /** The run cap, or null when the stored value is not a positive number: a run then refuses to start. */
  runCapUsd: number | null;
  runCapRaw: unknown;
};

const D = FIELD_NOTES_DEFAULT_SETTINGS;

const num = (v: unknown): number | null => (typeof v === 'boolean' || v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseFieldNotesSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): ParsedFieldNotesSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const has = (key: string) => rows.some((r) => r.key === key);
  const rawCap = has('run_cap_usd') ? get('run_cap_usd') : DEFAULT_FIELD_NOTES_RUN_CAP_USD;
  const cap = num(rawCap);
  const int = (key: string, min: number, fallback: number) => {
    const n = num(get(key));
    return n !== null && Number.isInteger(n) && n >= min ? n : fallback;
  };
  const darken = num(get('darken_cap'));
  return {
    autoRun: get('auto_run') === true,
    publishingLive: get('publishing_live') === true,
    requireApproval: get('require_approval') !== false,
    runCapUsd: cap !== null && cap > 0 ? cap : null,
    runCapRaw: rawCap,
    photoRestPosts: int('photo_rest_posts', 0, D.photoRestPosts),
    maxPendingDrafts: int('max_pending_drafts', 0, D.maxPendingDrafts),
    tipExpiryDays: int('tip_expiry_days', 1, D.tipExpiryDays),
    darkenCap: darken !== null && darken > 0 && darken <= 1 ? darken : D.darkenCap,
  };
}

export async function readFieldNotesSettings(q: FieldNotesQuery): Promise<ParsedFieldNotesSettings> {
  const { rows } = await q(`SELECT key, value FROM field_notes.settings`);
  return parseFieldNotesSettings(rows as Array<{ key: string; value: unknown }>);
}

/**
 * Whether Field Notes makes a post on `nyDate`: on its auto days while auto_run is on. `anyDay`:
 * its own page's Generate makes one on any day, auto_run on or off.
 */
export function fieldNotesDueOn(s: Pick<FieldNotesSettings, 'autoRun'>, nyDate: string, anyDay = false): boolean {
  const weekday = new Date(`${nyDate}T12:00:00Z`).getUTCDay();
  return anyDay || (s.autoRun && FIELD_NOTES_AUTO_DAYS.includes(weekday));
}
