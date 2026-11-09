import { NextResponse } from 'next/server';

import { FIELD_NOTES_DEFAULT_SETTINGS, type FieldNotesSettings } from '@/lib/field-notes/types';

/** The settings the panel shows and writes. runCapUsd and darkenCap are not set from the page. */
export type PanelSettings = Pick<FieldNotesSettings, 'autoRun' | 'publishingLive' | 'requireApproval' | 'photoRestPosts' | 'maxPendingDrafts' | 'tipExpiryDays'>;

export const NUMBER_LIMITS = {
  photoRestPosts: { min: 0, max: 50, label: 'Photo rest' },
  maxPendingDrafts: { min: 1, max: 10, label: 'Pending draft cap' },
  tipExpiryDays: { min: 1, max: 365, label: 'Tip expiry' },
} as const;

export type SettingsPatch = Partial<PanelSettings>;

export type SettingsEnv = {
  session: () => Promise<{ email: string } | null>;
  read: () => Promise<PanelSettings>;
  /**
   * The three switches, written through lib/content-type/posting.ts `writePosting('field_notes', ...)` the way
   * the other types do: generate = auto_run, live = publishing_live, autoPublish = !require_approval.
   */
  writeSwitches: (patch: { generate?: boolean; live?: boolean; autoPublish?: boolean }, email: string) => Promise<void>;
  /** An upsert into field_notes.settings for photo_rest_posts, max_pending_drafts or tip_expiry_days. */
  writeNumber: (key: 'photo_rest_posts' | 'max_pending_drafts' | 'tip_expiry_days', value: number) => Promise<void>;
};

const NUMBER_KEYS = { photoRestPosts: 'photo_rest_posts', maxPendingDrafts: 'max_pending_drafts', tipExpiryDays: 'tip_expiry_days' } as const;

/** A validated patch, or an error message. Unknown keys are refused so a typo never silently does nothing. */
export function parsePatch(body: unknown): SettingsPatch | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Expected a settings object.' };
  const out: SettingsPatch = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'autoRun' || k === 'publishingLive' || k === 'requireApproval') {
      if (typeof v !== 'boolean') return { error: `${k} must be on or off.` };
      out[k] = v;
    } else if (k in NUMBER_LIMITS) {
      const key = k as keyof typeof NUMBER_LIMITS;
      const { min, max, label } = NUMBER_LIMITS[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return { error: `${label} must be a whole number from ${min} to ${max}.` };
      out[key] = v;
    } else {
      return { error: `Unknown setting: ${k}.` };
    }
  }
  return Object.keys(out).length ? out : { error: 'Nothing to change.' };
}

/** Rows of field_notes.settings to the panel's values; a missing or malformed row reads as the shipped default. */
export function parsePanelSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): PanelSettings {
  const d = FIELD_NOTES_DEFAULT_SETTINGS;
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const bool = (key: string, fallback: boolean) => (typeof get(key) === 'boolean' ? (get(key) as boolean) : fallback);
  const int = (key: string, fallback: number, min: number) => {
    const n = Number(get(key));
    return get(key) != null && Number.isInteger(n) && n >= min ? n : fallback;
  };
  return {
    autoRun: bool('auto_run', d.autoRun),
    publishingLive: bool('publishing_live', d.publishingLive),
    requireApproval: bool('require_approval', d.requireApproval),
    photoRestPosts: int('photo_rest_posts', d.photoRestPosts, 0),
    maxPendingDrafts: int('max_pending_drafts', d.maxPendingDrafts, 1),
    tipExpiryDays: int('tip_expiry_days', d.tipExpiryDays, 1),
  };
}

export async function settingsGet(env: SettingsEnv): Promise<NextResponse> {
  if (!(await env.session())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await env.read());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function settingsPost(env: SettingsEnv, body: unknown): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const patch = parsePatch(body);
  if ('error' in patch) return NextResponse.json({ error: patch.error }, { status: 400 });
  try {
    const switches: { generate?: boolean; live?: boolean; autoPublish?: boolean } = {};
    if (patch.autoRun !== undefined) switches.generate = patch.autoRun;
    if (patch.publishingLive !== undefined) switches.live = patch.publishingLive;
    if (patch.requireApproval !== undefined) switches.autoPublish = !patch.requireApproval;
    if (Object.keys(switches).length) await env.writeSwitches(switches, session.email);
    for (const key of Object.keys(NUMBER_KEYS) as Array<keyof typeof NUMBER_KEYS>) {
      if (patch[key] !== undefined) await env.writeNumber(NUMBER_KEYS[key], patch[key]!);
    }
    return NextResponse.json(await env.read());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
