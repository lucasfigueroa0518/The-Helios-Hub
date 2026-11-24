'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { GenerateOutcome } from '@/lib/content-type/queue-client';
import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';
import { STORY_TYPE_LABEL, type StoryVertical } from '@/lib/social-hub/story-types';
import { refreshHubPage } from '@/lib/content-type/refresh-client';

/**
 * The per-type generate buttons on a content type's page. Each posts to the
 * type's own API; the click is the approval for any live model or web spend,
 * so each one says what it will cost first. Settings are not here: they live
 * in the pool's Settings tab (components/content-type/pool/SettingsTab.tsx,
 * settings standard D8, D9), which replaced the gear-button drawer and the
 * header Live switch.
 */

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Note({ text }: { text: string | null }) {
  return text ? <p className="rh-muted" role="status">{text}</p> : null;
}

// ── Carousels ───────────────────────────────────────────────────────────────

export function CarouselRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Run carousels now? It makes the top story in today’s queue, with live model and web calls, up to this type’s run cap (about $2 by default).')) return;
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
    if (!confirm('Make Last Few Days now? It picks 5–6 stories, writes and fact-checks them and finds photos, with live model and web calls, up to this type’s run cap ($1 by default). The post waits for your approval.')) return;
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
    if (!confirm('Generate this week’s AI Events post? It ranks the coming week’s events in Miami, Boston, NYC and SF with live Jev calls (about $0.02; capped by this type’s run cap, $0.50 by default) and renders the carousel. No Claude calls. The post waits for your approval.')) return;
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

// ── Stories-format types (Morning Download, AI Trivia, Real or AI?) ─────────

/** Generate: one set of this page's own Stories-format type (SS-26); the click is the approval for that set's live calls. */
export function StoriesGenerate({ type = 'stories' }: { type?: StoryVertical }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const label = STORY_TYPE_LABEL[type];
  async function generate() {
    if (!confirm(`Generate ${label}? This makes live model and web calls for that one set.`)) return;
    setBusy(true);
    try {
      await call('/api/stories/generate', { vertical: type });
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(`${label}: requested. The worker picks it up within a minute.`);
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={generate}>Generate</button>
      <Note text={note} />
    </div>
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

// ── Field Notes: make one tip ───────────────────────────────────────────────

/**
 * Make it on one Field Notes tip (POST /api/field-notes/tips/:id/make): queues one run that puts this tip first, for
 * the social worker to claim. The click approves that run's capped spend (field_notes.settings run_cap_usd). A refusal
 * (archived, used, a run already queued, the cap not set) comes back as a 409 with its note.
 */
export async function fieldNotesMake(ideaId: string): Promise<GenerateOutcome> {
  const tipId = ideaId.replace(/^field_notes:tip:/, '');
  try {
    const res = await fetch(`/api/field-notes/tips/${encodeURIComponent(tipId)}/make`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
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

/**
 * Develop: one development session (new pitches for the pool), queued for the drama worker; nothing runs in the
 * request. The confirm names the nightly development cap from the drama settings.
 */
export function DramaDevelopButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    try {
      const { settings } = await call<{ settings: { nightly_dev_cap_usd?: number } }>('/api/reel-ai-drama/settings');
      const cap = typeof settings?.nightly_dev_cap_usd === 'number' ? usd(settings.nightly_dev_cap_usd) : 'the nightly development cap';
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
