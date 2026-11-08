'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * AI Drama Reels' rendering settings on the type page (GET / POST /api/reel-ai-drama/settings).
 * Only the keys the route calls editable are shown, minus the two the Posting panel above already
 * owns (Generate = `auto`, Posts per day = `posts_per_day`). One Save sends every changed key in one
 * batch; the route validates the lot (per key and across keys) and saves nothing on a 400, whose
 * `fields` errors show beside their inputs. An empty number field is an error here and is never sent as 0.
 */

type Value = boolean | number | string;
type SettingProblem = { key: string; stored: unknown; error: string };
type Loaded = { settings: Record<string, unknown>; editable: string[]; problems: SettingProblem[] };

/** Owned by PostingSettings (lib/content-type/posting.ts maps them through writeDramaPosting). */
const SHOWN_ABOVE: ReadonlySet<string> = new Set(['auto', 'posts_per_day']);

const label = (key: string) => {
  const words = key.replace(/_usd$/, ' (USD)').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** One line under each setting, as on the Explainers form. Model settings share one line. */
const HELP: Record<string, string> = {
  daily_render_cap: 'Most reels made in one day, clicks and the night together.',
  daily_spend_cap_usd: 'Most production spend in one day. A reel that would pass it is not started.',
  weekly_dev_cap_usd: 'Most a week of development sessions (new pitches) may spend.',
  cells_per_session: 'How many player-and-era cells one development session searches.',
  pitches_per_cell: 'Pitches the producer writes for each searched cell.',
  cell_due_days: 'Days before a searched cell is searched again.',
  visuals_check_cap_usd: 'Most one pitch’s visuals check may spend.',
  drama_bar: 'Lowest drama score a pitch needs to enter the pool (0–1).',
  material_bar: 'Lowest material score a pitch needs to enter the pool (0–1).',
  news_window_days: 'How recent a news peg must be to count as news.',
  fresh_days: 'News younger than this gets the freshness boost in the rank.',
  spread_days: 'Days before the same central player can lead another reel.',
  per_reel_cap_usd: 'Most one reel may spend. The job stops when it reaches it.',
  min_visuals: 'Fewest usable pictures a story needs before it is made.',
  reuse_days: 'Days before the same picture may appear in another reel.',
  target_seconds: 'The length the writer aims for.',
  max_seconds: 'The longest a reel may run.',
  hook_seconds: 'How fast the opening line must land.',
  rung_max_seconds: 'Longest one story beat may run.',
  voice_tempo: 'Voice speed multiplier.',
  words_per_minute_target: 'Speaking pace the script is written to.',
  silent_beat_max: 'Longest silence allowed between lines, in seconds.',
  solver_limit_usd: 'Most the problem solver may spend on one reel, inside the per-reel cap.',
};
const helpFor = (key: string) => HELP[key] ?? (key.endsWith('_model') ? 'Claude model id for this step.' : '');

/** A typed number from a text field: empty or not a number is an error, never 0. */
export function parseNumberField(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: false, error: 'Enter a number' };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Enter a number' };
}

async function readJson<T>(res: Response): Promise<T & { error?: string; fields?: Record<string, string> }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string; fields?: Record<string, string> };
}

export function ReelAiDramaSettingsForm() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reel-ai-drama/settings', { cache: 'no-store' });
      const json = await readJson<Loaded>(res);
      if (!res.ok) throw new Error(json.error ?? `Could not load AI Drama settings (${res.status}).`);
      setData({ settings: json.settings ?? {}, editable: json.editable ?? [], problems: json.problems ?? [] });
      setDraft({});
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const keys = useMemo(
    () => (data ? data.editable.filter((k) => !SHOWN_ABOVE.has(k) && ['boolean', 'number', 'string'].includes(typeof data.settings[k])) : []),
    [data],
  );

  if (loadError) return <p className="rh-empty" role="alert">{loadError}</p>;
  if (!data) return <p className="rh-muted">Loading…</p>;

  const shown = (key: string): string | boolean => {
    if (key in draft) return draft[key]!;
    const v = data.settings[key] as Value;
    return typeof v === 'boolean' ? v : String(v);
  };

  async function save() {
    if (!data) return;
    const values: Record<string, Value> = {};
    const errors: Record<string, string> = {};
    for (const [key, raw] of Object.entries(draft)) {
      const was = data.settings[key];
      if (typeof was === 'boolean') values[key] = raw === true;
      else if (typeof was === 'number') {
        const parsed = parseNumberField(String(raw));
        if (!parsed.ok) errors[key] = parsed.error;
        else values[key] = parsed.value;
      } else values[key] = String(raw);
    }
    setFields(errors);
    if (Object.keys(errors).length) { setNote('Fix the fields marked in red; nothing was saved.'); return; }
    if (!Object.keys(values).length) { setNote('Nothing changed.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/reel-ai-drama/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
      const json = await readJson<{ settings?: Record<string, unknown> }>(res);
      if (!res.ok) {
        setFields(json.fields ?? {});
        setNote(json.error ?? `Not saved (${res.status}).`);
        return;
      }
      setNote('Saved.');
      await load();
    } catch (e) {
      setNote(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rh-settings">
      {data.problems.length ? (
        <div role="alert">
          {data.problems.map((p) => (
            <p key={p.key} className="rh-run-status is-failed">{label(p.key)}: the stored value could not be used ({p.error}), so the default applies until it is saved again.</p>
          ))}
        </div>
      ) : null}
      {keys.map((key) => {
        const value = shown(key);
        const error = fields[key];
        const id = `rad-setting-${key}`;
        const isBool = typeof data.settings[key] === 'boolean';
        return (
          <div className="rh-card" key={key}>
            <div className="rh-card__row">
              <div>
                <h2 className="rh-card__title rh-card__title--flush">{label(key)}</h2>
                {helpFor(key) ? <p className="rh-muted">{helpFor(key)}</p> : null}
                {error ? <p className="rh-run-status is-failed" role="alert">{error}</p> : null}
              </div>
              {isBool ? (
                <label className="rh-switch">
                  <input id={id} type="checkbox" checked={value === true} aria-label={label(key)} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))} />
                  <span className="rh-switch__track" aria-hidden="true" />
                  {value === true ? 'On' : 'Off'}
                </label>
              ) : (
                <input
                  id={id}
                  className="helios-field-input"
                  inputMode={typeof data.settings[key] === 'number' ? 'decimal' : undefined}
                  value={String(value)}
                  aria-label={label(key)}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              )}
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {note ? <p className="rh-muted" role="status">{note}</p> : null}
    </div>
  );
}
