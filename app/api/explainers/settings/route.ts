import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import {
  isSettingKey,
  loadSettings,
  parseSetting,
  saveSetting,
  type SettingKey,
} from '@/lib/explainers/settings';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Settings Lucas may change from the page. voice_name and the brief version are fixed here. */
const EDITABLE = new Set<SettingKey>([
  'mode',
  'auto_render',
  'per_reel_cap_usd',
  'daily_render_cap',
  'daily_spend_cap_usd',
  'pool_size',
  'ideas_per_day',
  'dedupe_lookback_days',
  'voice_id',
  'orchestrator_model',
  'frame_worker_model',
  'idea_model',
  'music_enabled',
  'sfx_enabled',
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ settings: await loadSettings(await explainersDb()) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Body: `{ changes: { key: value, ... } }`. All values validate before any is saved. */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { changes?: Record<string, unknown> } | null;
  const changes = body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return NextResponse.json({ error: 'Expected { changes: { key: value } }' }, { status: 400 });
  }

  const entries = Object.entries(changes);
  for (const [key, value] of entries) {
    if (!isSettingKey(key) || !EDITABLE.has(key)) {
      return NextResponse.json({ error: `Setting ${key} cannot be changed here` }, { status: 400 });
    }
    try {
      parseSetting(key, value);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
  }

  try {
    const db = await explainersDb();
    await db.transaction(async (tx) => {
      for (const [key, value] of entries) await saveSetting(tx, key as SettingKey, value);
    });
    return NextResponse.json({ settings: await loadSettings(db) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
