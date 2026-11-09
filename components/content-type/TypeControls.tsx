'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';

import { GenerateConfirm } from '@/components/content-type/GenerateConfirm';
import type { GenerateOutcome } from '@/lib/content-type/queue-client';
import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';
import { Drawer } from '@/app/reels/ui';
import { SERIES_LABEL } from '@/lib/content-type/story-series';
import { refreshHubPage } from '@/lib/content-type/refresh-client';
import { ScheduleStrip } from '@/components/content-type/ScheduleStrip';
import type { ScheduleDay } from '@/lib/content-type/posting';
import { maxCapFor } from '@/lib/content-type/caps';
import { TYPE_CONFIG, generateCopy, type ContentTypeId, type PageVertical } from '@/lib/content-type/config';
import { formatUsd } from '@/lib/social-hub/cost';

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
    if (!confirm('Run carousels now? It makes the top story in today’s queue, with live model and web calls, up to the run cap set in Settings (about $2 by default).')) return;
    setBusy(true);
    try {
      const out = await call<{ queued: boolean; note?: string }>('/api/carousels/run', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.queued ? `${out.note ?? 'Run queued.'} The social worker picks it up within a minute.` : (out.note ?? 'A run is already queued.'));
      void refreshHubPage(router);
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

// ── Last Few Days ───────────────────────────────────────────────────────────

export function LfdRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Make Last Few Days now? It picks 5–6 stories, writes and fact-checks them and finds photos, with live model and web calls, up to the run cap in Settings ($1 by default). The post waits for your approval.')) return;
    setBusy(true);
    try {
      const out = await call<{ queued: boolean; note?: string }>('/api/last-few-days/run', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.queued ? (out.note ?? 'Run queued.') : (out.note ?? 'A run is already queued.'));
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Make Last Few Days now</button>
      <Note text={note} />
    </div>
  );
}

// ── AI Events This Week ─────────────────────────────────────────────────────

/** Generate: rank the coming week's events (Jev, about $0.02) and render the carousel; the post waits for approval. */
export function AiEventsRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Generate this week’s AI Events post? It ranks the coming week’s events in Miami, Boston, NYC and SF with live Jev calls (about $0.02; capped by the run cap in Settings, $0.50 by default) and renders the carousel. No Claude calls. The post waits for your approval.')) return;
    setBusy(true);
    try {
      const out = await call<{ queued: boolean; note?: string }>('/api/ai-events/run', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.queued ? (out.note ?? 'Run queued.') : (out.note ?? 'A run is already queued.'));
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Generate</button>
      <Note text={note} />
    </div>
  );
}

// ── Stories ─────────────────────────────────────────────────────────────────


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
      void refreshHubPage(router);
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
export function LiveToggle({ type, initial }: { type: PageVertical; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function set(value: boolean) {
    try {
      const out = await call<{ live: boolean }>('/api/content-type/posting', { type, live: value });
      setOn(out.live);
      setNote(out.live ? 'Live is on.' : 'Live is off. Posts already on the clock still go out.');
      void refreshHubPage(router);
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

/** Generate one explainer topic. The cap question comes back as `ask: 'over_cap'`; the progress strip is told a render was queued. */
export async function explainerGenerate(ideaId: string, overrideCaps: boolean): Promise<GenerateOutcome> {
  const topicId = ideaId.replace(/^explainers:topic:/, '');
  const res = await fetch(`/api/explainers/topics/${topicId}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overrideCaps }) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; ask?: string; costUsd?: number };
  if (res.ok) {
    window.dispatchEvent(new Event(PROGRESS_EVENT));
    return { ok: true };
  }
  if (json.ask === 'over_cap') return { ok: false, ask: 'over_cap', message: json.error ?? 'A daily cap is used up.', costUsd: json.costUsd ?? 0 };
  return { ok: false, message: json.error ?? `Request failed (${res.status})` };
}

export function ExplainerGenerate({ ideaId, title }: { ideaId: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className="rh-btn rh-btn--primary rh-btn--xs" onClick={() => setAsking(true)}>Generate</button>
      {asking ? <GenerateConfirm generate={explainerGenerate} ideaId={ideaId} title={title} reason="click" onDone={() => { setAsking(false); void refreshHubPage(router); }} /> : null}
    </>
  );
}

// ── Carousels: seed a story ─────────────────────────────────────────────────

// ── Stories: seed an idea ───────────────────────────────────────────────────

// ── Header buttons that open a drawer ───────────────────────────────────────

/** Settings: the type's switches and caps, in a drawer so the page itself stays the Text on Screen format. */
export function SettingsButton({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button type="button" className="rh-btn" onClick={() => setOpen(true)}>
        <Settings size={15} /> Settings
      </button>
      {open ? <Drawer label="Settings" wide onClose={() => setOpen(false)}>{children}</Drawer> : null}
    </>
  );
}

// ── Settings: generate, auto-publish and the daily quota, the same on every type ──

type Posting = {
  type: ContentTypeId;
  live: boolean;
  generate: boolean | null;
  autoPublish: boolean;
  perDay: number | null;
  maxPerDay: number | null;
  series: Array<{ id: string; label: string; enabled: boolean; generate: boolean; days: number[] }> | null;
  /** The calendar's week for this type (template mode); null while each type sets its own cadence. */
  schedule: ScheduleDay[] | null;
  /** The daily limit (template mode; Stories: per series); null while legacy. */
  cap: number | null;
  /** About what one more post a night costs; null when unknown. */
  costPerPostMicros: number | null;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
 * The daily limit (week board spec §Safety cap): the most the overnight run
 * makes a day, whatever the calendar holds. A person's decision; each step
 * saves at once.
 */
function DailyLimit({ type, cap, costMicros, onSave }: { type: Posting['type']; cap: number; costMicros: number | null; onSave: (cap: number) => void }) {
  const noun = TYPE_CONFIG[type].postsNoun;
  return (
    <div>
      <div className="rh-quota">
        <span className="rh-quota__label">Daily limit</span>
        <button type="button" className="rh-btn rh-btn--xs" disabled={cap <= 0} onClick={() => onSave(cap - 1)} aria-label="One fewer a night">−</button>
        <strong className="rh-quota__n">{cap}</strong>
        <button type="button" className="rh-btn rh-btn--xs" disabled={cap >= maxCapFor(type)} onClick={() => onSave(cap + 1)} aria-label="One more a night">+</button>
      </div>
      <p className="rh-settings__note">The most {noun} the overnight run makes a day{TYPE_CONFIG[type].capPerSeries ? ', per series' : ''}, however many slots the calendar has.</p>
      {costMicros != null ? <p className="rh-settings__note">One more a night costs about {formatUsd(costMicros)}.</p> : null}
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
  const noun = TYPE_CONFIG[type].postsNoun;
  // With the calendar, when a type posts is set there: the quota and series days give way to its week, read only.
  const calendar = data.schedule ?? null;
  return (
    <div className="rh-settings">
      {!data.live ? (
        <p className="rh-settings__note"><strong>Live is off</strong>, so nothing is scheduled or posted yet, even approved {noun}. Turn Live on in the header when you are ready.</p>
      ) : null}
      {type === 'reel_ai_drama' ? (
        <p className="rh-settings__note">Only the shared publisher posts {noun}, and only while its mode is <strong>live</strong>; until then nothing is posted, even with Live on here.</p>
      ) : null}
      {data.generate !== null ? (
        <Switch
          checked={data.generate}
          onChange={(on) => {
            const ask = generateCopy(type).confirm;
            if (on && !confirm(ask)) return;
            void save({ generate: on });
          }}
          hint={generateCopy(type).hint}
        >
          {generateCopy(type).label}
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
      {calendar ? <ScheduleStrip type={type} days={calendar} /> : null}
      {calendar && data.cap !== null ? <DailyLimit type={type} cap={data.cap} costMicros={data.costPerPostMicros} onSave={(cap) => void save({ cap })} /> : null}
      {!calendar && data.perDay !== null && data.maxPerDay !== null ? (
        <div>
          <div className="rh-quota">
            <span className="rh-quota__label">Posts per day</span>
            <button type="button" className="rh-btn rh-btn--xs" disabled={data.perDay <= TYPE_CONFIG[type].perDayMin} onClick={() => void save({ perDay: data.perDay! - 1 })} aria-label="One fewer a day">−</button>
            <strong className="rh-quota__n">{data.perDay}</strong>
            <button type="button" className="rh-btn rh-btn--xs" disabled={data.perDay >= data.maxPerDay} onClick={() => void save({ perDay: data.perDay! + 1 })} aria-label="One more a day">+</button>
          </div>
          <p className="rh-settings__note">How many {noun} are made, scheduled and posted each day. Up to {data.maxPerDay}: one per posting window.</p>
        </div>
      ) : null}
      {data.series ? (
        <>
          {calendar ? null : <p className="rh-settings__note">Each series has its own days of the week. A set is made for each series on its days.</p>}
          {data.series.map((s) => (
            <div key={s.id} className="rh-series">
              <strong>{s.label}</strong>
              {calendar ? null : <div className="rh-series__days" role="group" aria-label={`${s.label} days`}>
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
              </div>}
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

// ── Explainers: run today's idea cycle now (C serves POST /api/explainers/idea-cycle) ──

type IdeaCycleInfo = { estimateUsd: number; maxRenders: number; ranToday: boolean; requested: boolean };

/**
 * "Run the idea cycle now": asks the explainers worker for today's cycle (it still keeps one cycle a day and the spend
 * caps). The confirm states the route's own estimate; the note that comes back is shown as it is.
 */
export function IdeaCycleButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    try {
      const info = await call<IdeaCycleInfo>('/api/explainers/idea-cycle');
      if (info.ranToday) { setNote('Today’s idea cycle already ran.'); return; }
      if (info.requested) { setNote('An idea cycle is already requested. The worker picks it up within a minute.'); return; }
      if (!confirm(`Run today’s idea cycle now? It refills the topic pool and renders up to ${info.maxRenders} reel${info.maxRenders === 1 ? '' : 's'}, with live model, voice and video calls, about ${usd(info.estimateUsd)}. The daily spend caps still apply.`)) return;
      const out = await call<{ queued?: boolean; note?: string }>('/api/explainers/idea-cycle', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.note ?? (out.queued ? 'Idea cycle requested.' : 'Not requested.'));
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn" disabled={busy} onClick={run}>Run the idea cycle now</button>
      <Note text={note} />
    </div>
  );
}

// ── AI Drama Reels ──────────────────────────────────────────────────────────

/** Make one pitch into a reel (POST /api/reel-ai-drama/make). The daily render and spend caps answer with a plain note. */
export async function dramaGenerate(ideaId: string): Promise<GenerateOutcome> {
  const pitchId = ideaId.replace(/^reel_ai_drama:pitch:/, '');
  try {
    const res = await fetch('/api/reel-ai-drama/make', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pitchId }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      return { ok: true };
    }
    return { ok: false, message: json.error ?? `Request failed (${res.status})` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export function DramaMakeIt({ ideaId, title }: { ideaId: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className="rh-btn rh-btn--primary rh-btn--xs" onClick={() => setAsking(true)}>Make it</button>
      {asking ? <GenerateConfirm generate={dramaGenerate} ideaId={ideaId} title={title} reason="click" onDone={() => { setAsking(false); void refreshHubPage(router); }} /> : null}
    </>
  );
}

/**
 * Develop: one development session (new pitches for the pool), queued for the drama worker; nothing runs in the
 * request. The confirm names the weekly development cap from the drama settings.
 */
export function DramaDevelopButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    try {
      const { settings } = await call<{ settings: { weekly_dev_cap_usd?: number } }>('/api/reel-ai-drama/settings');
      const cap = typeof settings?.weekly_dev_cap_usd === 'number' ? usd(settings.weekly_dev_cap_usd) : 'the weekly development cap';
      if (!confirm(`Develop new AI Drama pitches now? This queues one development session, up to ${cap}, with live model and web calls. The drama worker runs it; nothing runs in this page.`)) return;
      await call<{ requestId: string; status: string }>('/api/reel-ai-drama/develop', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote('Development session queued. The drama worker picks it up; new pitches land in the pool when it finishes.');
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Develop</button>
      <Note text={note} />
    </div>
  );
}
