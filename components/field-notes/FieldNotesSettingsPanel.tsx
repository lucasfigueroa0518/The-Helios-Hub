'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { PanelSettings } from '@/app/api/field-notes/settings/handler';

/** One switch, the same markup as the other types' settings. */
function Switch({ checked, onChange, children, hint }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; hint: string }) {
  return (
    <div>
      <label className="rh-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="rh-switch__track" aria-hidden="true" />
        {children}
      </label>
      <p className="rh-settings__note">{hint}</p>
    </div>
  );
}

function Stepper({ label, value, min, max, unit, hint, onSave }: { label: string; value: number; min: number; max: number; unit: string; hint: string; onSave: (n: number) => void }) {
  return (
    <div>
      <div className="rh-quota">
        <span className="rh-quota__label">{label}</span>
        <button type="button" className="rh-btn rh-btn--xs" disabled={value <= min} onClick={() => onSave(value - 1)} aria-label={`One fewer ${unit}`}>−</button>
        <strong className="rh-quota__n">{value}</strong>
        <button type="button" className="rh-btn rh-btn--xs" disabled={value >= max} onClick={() => onSave(value + 1)} aria-label={`One more ${unit}`}>+</button>
      </div>
      <p className="rh-settings__note">{hint}</p>
    </div>
  );
}

/** Field Notes' settings, saved as you change them: auto-run, publishing live, require approval, photo rest, pending draft cap, tip expiry. */
export function FieldNotesSettingsPanel({ initial = null }: { initial?: PanelSettings | null }) {
  const [s, setS] = useState<PanelSettings | null>(initial);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch('/api/field-notes/settings', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as PanelSettings & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    setS(json);
  }, []);
  useEffect(() => {
    if (!initial) load().catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [initial, load]);
  async function save(patch: Partial<PanelSettings>) {
    try {
      const res = await fetch('/api/field-notes/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const json = (await res.json().catch(() => ({}))) as PanelSettings & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setS(json);
      setNote('Saved.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }
  if (!s) return <p className="rh-muted">{note ?? 'Loading…'}</p>;
  return (
    <div className="rh-settings">
      <Switch
        checked={s.autoRun}
        onChange={(on) => {
          if (on && !confirm('Make Field Notes posts on their own? Each run makes live Claude and Jev calls, up to the run cap.')) return;
          void save({ autoRun: on });
        }}
        hint={s.autoRun ? 'On: a run starts on its own schedule.' : 'Off: nothing is made until someone presses Generate.'}
      >
        Auto-run
      </Switch>
      <Switch
        checked={s.requireApproval}
        onChange={(on) => {
          if (!on && !confirm('Turn off approval? Field Notes posts would be scheduled and posted without waiting for you.')) return;
          void save({ requireApproval: on });
        }}
        hint={s.requireApproval ? 'On: a post goes out only once a person approves it.' : 'Off: posts are scheduled as soon as they are made.'}
      >
        Require approval
      </Switch>
      <Switch
        checked={s.publishingLive}
        onChange={(on) => {
          if (on && !confirm('Go live? Approved Field Notes posts are scheduled into their posting windows and posted to Instagram.')) return;
          void save({ publishingLive: on });
        }}
        hint={s.publishingLive ? 'On: approved posts are scheduled and posted.' : 'Off: nothing is scheduled or posted, even approved posts.'}
      >
        Publishing live
      </Switch>
      <Stepper label="Photo rest" value={s.photoRestPosts} min={0} max={50} unit="post of rest" hint="A photo sits out this many posts after it is used, then may come back." onSave={(n) => void save({ photoRestPosts: n })} />
      <Stepper label="Pending draft cap" value={s.maxPendingDrafts} min={1} max={10} unit="draft" hint="No new post is made while this many are waiting for review." onSave={(n) => void save({ maxPendingDrafts: n })} />
      <Stepper label="Tip expiry (days)" value={s.tipExpiryDays} min={1} max={365} unit="day" hint="A tip nobody used expires after this many days." onSave={(n) => void save({ tipExpiryDays: n })} />
      {note ? <p className="rh-muted" role="status">{note}</p> : null}
    </div>
  );
}
