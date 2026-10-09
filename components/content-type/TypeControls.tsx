'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Plus, Settings } from 'lucide-react';

import { AddTopics } from '@/app/explainers/topics-view';
import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';
import { Drawer } from '@/app/reels/ui';

/**
 * The per-type generate buttons and settings panels on a content type's page.
 * Each posts to the type's own API; the click is the approval for any live
 * model or web spend, so each one says what it will cost first.
 */

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useLoaded<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => call<T>(path).then((d) => (setData(d), setError(null))).catch((e) => setError(msg(e))), [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

function Note({ text }: { text: string | null }) {
  return text ? <p className="rh-muted" role="status">{text}</p> : null;
}

// ── Carousels ───────────────────────────────────────────────────────────────

export function CarouselRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Run carousels now? A run makes live model and web calls, up to the run cap set in Settings (about $2 by default).')) return;
    setBusy(true);
    try {
      const out = await call<{ queued: boolean; note?: string }>('/api/carousels/run', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.queued ? 'Run queued. The social worker picks it up within a minute.' : (out.note ?? 'A run is already queued.'));
      router.refresh();
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Run now</button>
      <Note text={note} />
    </div>
  );
}

// ── Stories ─────────────────────────────────────────────────────────────────

const SERIES_LABEL: Record<string, string> = { morning_download: 'Morning Download', guess_the_number: 'Guess the Number', free_vs_paid: 'Free vs. Paid' };

export function StoriesGenerate() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function generate(series: string) {
    if (!confirm(`Generate ${SERIES_LABEL[series]}? This makes live model and web calls for that one set.`)) return;
    setBusy(series);
    try {
      await call('/api/stories/generate', { series });
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(`${SERIES_LABEL[series]}: requested. The worker picks it up within a minute.`);
      router.refresh();
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div>
      <div className="rh__head-actions">
        {Object.entries(SERIES_LABEL).map(([id, label]) => (
          <button key={id} type="button" className="rh-btn" disabled={busy !== null} onClick={() => generate(id)}>Generate {label}</button>
        ))}
      </div>
      <Note text={note} />
    </div>
  );
}

// ── Header: the Live switch, shared by every type ───────────────────────────

/** Live: while on, the type schedules and posts on its own. Turning it on asks first. */
export function LiveToggle({ type, initial }: { type: 'carousels' | 'stories' | 'explainers'; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function set(value: boolean) {
    try {
      const out = await call<{ live: boolean }>('/api/content-type/posting', { type, live: value });
      setOn(out.live);
      setNote(out.live ? 'Live is on.' : 'Live is off. Posts already on the clock still go out.');
      router.refresh();
    } catch (e) {
      setNote(msg(e));
    }
  }
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);
  return (
    <>
      <button type="button" className={`rh-live${on ? ' is-on' : ''}`} aria-pressed={on} title="When Live is on, this type's content is scheduled into its posting windows and posted to Instagram." onClick={() => (on ? void set(false) : setAsking(true))}>
        <span className="rh-live__lamp" aria-hidden="true" />
        Live
      </button>
      {asking ? (
        <div className="rh-confirm" role="presentation" onClick={() => setAsking(false)}>
          <div className="rh-confirm__card" role="dialog" aria-modal="true" aria-labelledby="rh-live-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="rh-live-title">Go live?</h2>
            <p>Content is scheduled into its posting windows and posted to Instagram. Anything that needs your approval still waits for it.</p>
            <div className="rh-confirm__actions">
              <button type="button" className="rh-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="rh-btn rh-btn--primary" onClick={() => { setAsking(false); void set(true); }}>Go live</button>
            </div>
          </div>
        </div>
      ) : null}
      {note ? <p className="rh-toast" role="status">{note}</p> : null}
    </>
  );
}

// ── Explainers: generate from a bench idea ──────────────────────────────────

export function ExplainerGenerate({ ideaId, title }: { ideaId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const topicId = ideaId.replace(/^explainers:topic:/, '');
  async function generate() {
    if (!confirm(`Render "${title}"? This makes live model, voice and video calls for this one reel.`)) return;
    setBusy(true);
    try {
      await call(`/api/explainers/topics/${topicId}/generate`, {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote('Render queued.');
      router.refresh();
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="rh-btn rh-btn--primary rh-btn--xs" disabled={busy} onClick={generate}>Generate</button>
      {note ? <span className="rh-muted"> {note}</span> : null}
    </>
  );
}

// ── Header buttons that open a drawer ───────────────────────────────────────

/** Settings: the type's switches and caps, in a drawer so the page itself stays the Text on Screen format. */
export function SettingsButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="rh-btn" onClick={() => setOpen(true)}>
        <Settings size={15} /> Settings
      </button>
      {open ? <Drawer label="Settings" wide onClose={() => setOpen(false)}>{children}</Drawer> : null}
    </>
  );
}

/** Explainers: add a topic or paste a list; each is written up and scored (a live model call) when added. */
export function AddTopicsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="rh-btn rh-btn--primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add topics
      </button>
      {open ? (
        <Drawer label="Add a topic" onClose={() => setOpen(false)}>
          <AddTopics onDone={(text) => { setOpen(false); setNote(text); router.refresh(); }} />
        </Drawer>
      ) : null}
      {note ? <p className="rh-toast" role="status">{note}</p> : null}
    </>
  );
}

// ── Settings: generate, auto-publish and the daily quota, the same on every type ──

type Posting = {
  type: 'reels' | 'carousels' | 'explainers' | 'stories';
  live: boolean;
  generate: boolean | null;
  autoPublish: boolean;
  perDay: number | null;
  maxPerDay: number | null;
  series: Array<{ id: string; label: string; enabled: boolean; generate: boolean; days: number[] }> | null;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NOUN: Record<Posting['type'], string> = { reels: 'reels', carousels: 'carousels', explainers: 'explainers', stories: 'story sets' };

function Switch({ checked, onChange, children, hint }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="rh-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="rh-switch__track" aria-hidden="true" />
        {children}
      </label>
      {hint ? <p className="rh-settings__note">{hint}</p> : null}
    </div>
  );
}

/**
 * How this type makes and posts. Generate makes content every morning to fill
 * the day's quota. Auto-publish decides what happens next: off, a post goes
 * out only when a person approves it; on, it is scheduled and posted without
 * waiting. Live (the header button) is the master switch for all posting.
 */
export function PostingSettings({ type }: { type: Posting['type'] }) {
  const { data, error, reload } = useLoaded<Posting>(`/api/content-type/posting?type=${type}`);
  const [note, setNote] = useState<string | null>(null);
  async function save(patch: Record<string, unknown>) {
    try {
      await call('/api/content-type/posting', { type, ...patch });
      setNote('Saved.');
      await reload();
    } catch (e) {
      setNote(msg(e));
    }
  }
  if (error) return <p className="rh-empty">{error}</p>;
  if (!data) return <p className="rh-muted">Loading…</p>;
  const noun = NOUN[type];
  return (
    <div className="rh-settings">
      {!data.live ? (
        <p className="rh-settings__note"><strong>Live is off</strong>, so nothing is scheduled or posted yet, even approved {noun}. Turn Live on in the header when you are ready.</p>
      ) : null}
      {data.generate !== null ? (
        <Switch
          checked={data.generate}
          onChange={(on) => {
            if (on && !confirm(`Make ${noun} every morning? Each run makes live model and web calls.`)) return;
            void save({ generate: on });
          }}
          hint={`Makes ${noun} every morning to fill the day's quota.`}
        >
          Generate every morning
        </Switch>
      ) : null}
      <Switch
        checked={data.autoPublish}
        onChange={(on) => {
          if (on && !confirm(`Turn on auto-publish? ${noun[0]!.toUpperCase()}${noun.slice(1)} will be scheduled and posted without waiting for your approval.`)) return;
          void save({ autoPublish: on });
        }}
        hint={data.autoPublish ? `On: ${noun} are scheduled and posted as soon as they are made.` : `Off: ${noun} are made but only go out once you approve them.`}
      >
        Auto-publish
      </Switch>
      {data.perDay !== null && data.maxPerDay !== null ? (
        <div>
          <div className="rh-quota">
            <span className="rh-quota__label">Posts per day</span>
            <button type="button" className="rh-btn rh-btn--xs" disabled={data.perDay <= (type === 'explainers' ? 1 : 0)} onClick={() => void save({ perDay: data.perDay! - 1 })} aria-label="One fewer a day">−</button>
            <strong className="rh-quota__n">{data.perDay}</strong>
            <button type="button" className="rh-btn rh-btn--xs" disabled={data.perDay >= data.maxPerDay} onClick={() => void save({ perDay: data.perDay! + 1 })} aria-label="One more a day">+</button>
          </div>
          <p className="rh-settings__note">How many {noun} are made, scheduled and posted each day. Up to {data.maxPerDay}: one per posting window.</p>
        </div>
      ) : null}
      {data.series ? (
        <>
          <p className="rh-settings__note">Each series has its own days of the week. A set is made for each series on its days.</p>
          {data.series.map((s) => (
            <div key={s.id} className="rh-series">
              <strong>{s.label}</strong>
              <div className="rh-series__days" role="group" aria-label={`${s.label} days`}>
                {DAY_NAMES.map((name, d) => {
                  const on = s.days.includes(d);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`rh-btn rh-btn--xs${on ? ' rh-btn--primary' : ''}`}
                      aria-pressed={on}
                      onClick={() => {
                        const days = on ? s.days.filter((x) => x !== d) : [...s.days, d];
                        if (days.length === 0) { setNote('Pick at least one day.'); return; }
                        void save({ series: { id: s.id, days } });
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              <Switch checked={s.enabled} onChange={(on) => void save({ series: { id: s.id, enabled: on } })}>Enabled</Switch>
              <Switch
                checked={s.generate}
                onChange={(on) => {
                  if (on && !confirm(`Make ${s.label} automatically on its days? Each build makes live model and web calls.`)) return;
                  void save({ series: { id: s.id, generate: on } });
                }}
              >
                Generate on its days
              </Switch>
            </div>
          ))}
        </>
      ) : null}
      <Note text={note} />
    </div>
  );
}
