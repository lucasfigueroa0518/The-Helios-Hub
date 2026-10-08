'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { HeliosMenu } from '@/app/components/helios-menu';
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

const MODE_OPTIONS = [
  { value: 'development', label: 'Development' },
  { value: 'production', label: 'Production' },
];

type Draft = Record<SettingKey, string | boolean>;
type Confirm = 'auto_render' | 'production';

const CONFIRM: Record<Confirm, { title: string; body: string; accept: string }> = {
  auto_render: {
    title: 'Turn on auto-render?',
    body: 'Once the worker is running, it will generate ideas and render a reel every day without a click, and that spends money.',
    accept: 'Turn on',
  },
  production: {
    title: 'Switch to production?',
    body: 'The daily render and spend caps start applying.',
    accept: 'Switch',
  },
};

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
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);

  const baseline = useMemo(() => toDraft(saved), [saved]);
  const changed = FIELDS.filter((field) => draft[field.key] !== baseline[field.key]);

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(timer);
  }, [note]);

  function changes(): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const field of changed) next[field.key] = fromDraft(field, draft[field.key]);
    return next;
  }

  async function commit(next: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    try {
      const result = await requestJson<{ settings: ExplainersSettings }>('/api/explainers/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: next }),
      });
      setSaved(result.settings);
      setDraft(toDraft(result.settings));
      setNote('Saved.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function askSave() {
    const next = changes();
    if (Object.keys(next).length === 0) return;
    setPending(next);
    if (next.auto_render === true) {
      setConfirm('auto_render');
      return;
    }
    if (next.mode === 'production') {
      setConfirm('production');
      return;
    }
    void commit(next);
  }

  function acceptConfirm() {
    if (!pending || !confirm) return;
    if (confirm === 'auto_render' && pending.mode === 'production') {
      setConfirm('production');
      return;
    }
    const next = pending;
    setConfirm(null);
    setPending(null);
    void commit(next);
  }

  const dialog = confirm ? CONFIRM[confirm] : null;

  return (
    <>
      <form
        className="ex-settings"
        onSubmit={(event) => {
          event.preventDefault();
          askSave();
        }}
      >
        {FIELDS.map((field) => {
          const id = `ex-setting-${field.key}`;
          const value = draft[field.key];
          const set = (next: string | boolean) => setDraft((d) => ({ ...d, [field.key]: next }));
          return (
            <div className="rh-card" key={field.key}>
              <div className="rh-card__row">
                <div>
                  <h2 className="rh-card__title rh-card__title--flush">{field.label}</h2>
                  <p className="rh-muted">{field.help}</p>
                </div>
                {field.kind === 'bool' ? (
                  <label className="rh-switch">
                    <input
                      id={id}
                      type="checkbox"
                      checked={value === true}
                      aria-label={field.label}
                      onChange={(e) => set(e.target.checked)}
                    />
                    <span className="rh-switch__track" aria-hidden="true" />
                    {value === true ? 'On' : 'Off'}
                  </label>
                ) : field.kind === 'mode' ? (
                  <HeliosMenu value={String(value)} options={MODE_OPTIONS} onChange={set} />
                ) : (
                  <input
                    id={id}
                    className="helios-field-input"
                    type={field.kind === 'number' ? 'number' : 'text'}
                    step={field.kind === 'number' ? 'any' : undefined}
                    value={String(value)}
                    aria-label={field.label}
                    placeholder={field.kind === 'optional-text' ? 'not set' : undefined}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </div>
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
        </div>
      </form>

      {dialog && (
        <div className="rh-confirm" role="presentation" onClick={() => { setConfirm(null); setPending(null); }}>
          <div
            className="rh-confirm__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ex-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="ex-confirm-title">{dialog.title}</h2>
            <p>{dialog.body}</p>
            <div className="rh-confirm__actions">
              <button type="button" className="rh-btn" onClick={() => { setConfirm(null); setPending(null); }}>
                Cancel
              </button>
              <button type="button" className="rh-btn rh-btn--primary" onClick={acceptConfirm}>
                {dialog.accept}
              </button>
            </div>
          </div>
        </div>
      )}

      {note && (
        <p className="rh-toast" role="status">
          {note}
        </p>
      )}
    </>
  );
}
