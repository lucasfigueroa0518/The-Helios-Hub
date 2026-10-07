'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { requestJson } from '@/lib/client-request';
import type { ExplainersSettings, SettingKey } from '@/lib/explainers/settings';

type Field = {
  key: SettingKey;
  label: string;
  help: string;
  kind: 'bool' | 'number' | 'text' | 'optional-text' | 'mode';
};

const FIELDS: Field[] = [
  { key: 'mode', label: 'Mode', help: 'Production applies the daily caps (E-17).', kind: 'mode' },
  { key: 'auto_render', label: 'Auto-render', help: 'On runs the daily idea cycle and renders the top topic (A-5, A-7).', kind: 'bool' },
  { key: 'per_reel_cap_usd', label: 'Per-reel cap (USD)', help: 'Kills a render past this spend. Always on.', kind: 'number' },
  { key: 'daily_render_cap', label: 'Daily render cap', help: 'Production only.', kind: 'number' },
  { key: 'daily_spend_cap_usd', label: 'Daily spend cap (USD)', help: 'Production only. Renders plus the idea run (A-4).', kind: 'number' },
  { key: 'pool_size', label: 'Pool size', help: 'Candidates kept after each idea run (E-16).', kind: 'number' },
  { key: 'ideas_per_day', label: 'Ideas per day', help: 'Generated in one call (E-16).', kind: 'number' },
  { key: 'dedupe_lookback_days', label: 'Duplicate lookback (days)', help: 'Rendered topics checked for repeats (A-2).', kind: 'number' },
  { key: 'voice_id', label: 'HeyGen voice ID', help: 'Voice "Lucas Figueroa" (E-19). Fill after the lookup.', kind: 'optional-text' },
  { key: 'orchestrator_model', label: 'Orchestrator model', help: 'E-18.', kind: 'text' },
  { key: 'frame_worker_model', label: 'Frame worker model', help: 'E-18.', kind: 'text' },
  { key: 'idea_model', label: 'Idea generator model', help: 'E-16.', kind: 'text' },
  { key: 'music_enabled', label: 'Background music', help: 'E-20.', kind: 'bool' },
  { key: 'sfx_enabled', label: 'Sound effects', help: 'E-20.', kind: 'bool' },
];

type Draft = Record<SettingKey, string | boolean>;

function toDraft(settings: ExplainersSettings): Draft {
  const draft = {} as Draft;
  for (const field of FIELDS) {
    const value = settings[field.key];
    draft[field.key] = typeof value === 'boolean' ? value : value == null ? '' : String(value);
  }
  return draft;
}

function fromDraft(field: Field, value: string | boolean): unknown {
  if (field.kind === 'bool') return value;
  if (field.kind === 'number') return value === '' ? NaN : Number(value);
  if (field.kind === 'optional-text') return String(value).trim() === '' ? null : String(value).trim();
  return String(value).trim();
}

export function SettingsForm({ initial }: { initial: ExplainersSettings }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  const baseline = useMemo(() => toDraft(saved), [saved]);
  const changed = FIELDS.filter((field) => draft[field.key] !== baseline[field.key]);

  async function save() {
    const changes: Record<string, unknown> = {};
    for (const field of changed) changes[field.key] = fromDraft(field, draft[field.key]);

    if (changes.auto_render === true && !window.confirm(
      'Turn on auto-render? Once the worker is running, it will generate ideas and render a reel every day without a click, and that spends money.',
    )) return;
    if (changes.mode === 'production' && !window.confirm(
      'Switch to production? The daily render and spend caps start applying.',
    )) return;

    setBusy(true);
    setNote(null);
    try {
      const result = await requestJson<{ settings: ExplainersSettings }>('/api/explainers/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      setSaved(result.settings);
      setDraft(toDraft(result.settings));
      setNote({ text: 'Saved.' });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ex-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {FIELDS.map((field) => {
        const id = `ex-setting-${field.key}`;
        const value = draft[field.key];
        const set = (next: string | boolean) => setDraft((d) => ({ ...d, [field.key]: next }));
        return (
          <div className="ex-field" key={field.key}>
            <label htmlFor={id}>
              {field.label}
              <small>{field.help}</small>
            </label>
            {field.kind === 'bool' ? (
              <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />
            ) : field.kind === 'mode' ? (
              <select id={id} className="ex-input" value={String(value)} onChange={(e) => set(e.target.value)}>
                <option value="development">development</option>
                <option value="production">production</option>
              </select>
            ) : (
              <input
                id={id}
                className="ex-input"
                type={field.kind === 'number' ? 'number' : 'text'}
                step={field.kind === 'number' ? 'any' : undefined}
                value={String(value)}
                placeholder={field.kind === 'optional-text' ? 'not set' : undefined}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </div>
        );
      })}
      <div className="ex-actions">
        <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || changed.length === 0}>
          {busy && <Loader2 size={14} className="rh-spin" />}
          Save{changed.length > 0 ? ` (${changed.length})` : ''}
        </button>
        {changed.length > 0 && !busy && (
          <button type="button" className="rh-btn rh-btn--quiet" onClick={() => setDraft(baseline)}>
            Discard
          </button>
        )}
        {note && <span className={`ex-note${note.bad ? ' ex-note--bad' : ''}`}>{note.text}</span>}
      </div>
    </form>
  );
}
