'use client';

import { useCallback, useEffect, useState } from 'react';

import type { LabData, LabStory } from '@/lib/real-case/lab';

type Tab = 'pool' | 'searches' | 'renders' | 'dropped';

const SCORE_LABELS: Record<string, string> = {
  stakes: 'Stakes',
  turn: 'Turn',
  scene: 'Scene',
  reveal: 'Reveal',
  artifacts: 'Artifacts',
  players: 'Players',
  freshness: 'Freshness',
};
const ACTS: [keyof LabStory['story'], string][] = [
  ['cold_open', 'Cold open'],
  ['setup', 'Setup'],
  ['moment', 'The moment'],
  ['fallout', 'Fallout'],
  ['reveal', 'What actually happened'],
  ['since', 'Since then'],
  ['for_you', 'For you'],
];
const OUTCOME_LABEL: Record<string, string> = { found: 'Found', weak: 'None cleared the bar', none: 'No story', failed: 'Failed', running: 'Searching…' };

const usd = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

async function post(url: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: String((data as { error?: string }).error ?? `HTTP ${res.status}`) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function Check({ status }: { status: string }) {
  const tone = status === 'verified' ? 'ok' : status === 'unchecked' ? 'quiet' : 'bad';
  return <span className={`rc-chip ${tone}`}>{status}</span>;
}

function StoryCard({ story, onMake, busy }: { story: LabStory; onMake?: (s: LabStory) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rc-story">
      <button type="button" className="rc-story-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="rc-score">{story.score === null ? '—' : Math.round(story.score)}</span>
        <span className="rc-story-title">
          {story.title}
          <span className="rc-meta">
            {story.eventDate ?? 'undated'} · {story.term} · {story.polarity}
            {story.topic ? ` · near “${story.topic}”` : ''}
          </span>
        </span>
        <span className={`rc-chip ${story.status === 'rendered' ? 'ok' : story.status === 'promoted' ? 'live' : 'quiet'}`}>{story.status}</span>
      </button>
      {open && (
        <div className="rc-story-body">
          <p>{story.summary}</p>
          {story.scores && (
            <dl className="rc-scores">
              {Object.entries(story.scores).map(([k, v]) => (
                <div key={k}>
                  <dt>{SCORE_LABELS[k] ?? k}</dt>
                  <dd>{v.toFixed(2)}</dd>
                </div>
              ))}
            </dl>
          )}
          {story.rejectReason && <p className="rc-error">{story.rejectReason}</p>}
          {Array.isArray(story.story.cast) ? (
            <>
              <h4>Acts</h4>
              <ol className="rc-beats">
                {ACTS.map(([key, label]) => (
                  <li key={key}><b>{label}.</b> {String(story.story[key] ?? '')}</li>
                ))}
              </ol>
              <h4>Players</h4>
              <ul className="rc-beats">
                {story.story.cast.map((m, i) => {
                  const art = story.banked[i];
                  return (
                    <li key={i} className="rc-player">
                      {art ? <img className={`rc-thumb ${art.kind}`} src={`/api/real-case/bank/${art.kind}/${art.id}`} alt="" /> : <span className="rc-thumb none" aria-hidden="true" />}
                      <span><b>{m.name}</b> ({m.kind.replace(/_/g, ' ')}): {m.role}{art ? <span className="rc-meta"> · {art.kind} banked</span> : null}</span>
                    </li>
                  );
                })}
              </ul>
              <h4>Timeline</h4>
              <ul className="rc-beats">
                {story.story.timeline.map((t, i) => <li key={i}><b>{t.date}</b> {t.what} <span className="rc-fact-id">{t.claim_id}</span></li>)}
              </ul>
              {story.story.artifacts.length > 0 && (
                <>
                  <h4>Artifacts</h4>
                  <ul className="rc-artifacts">
                    {story.story.artifacts.map((a) => (
                      <li key={a.id}>
                        <span className="rc-meta">{a.kind} · {a.speaker} · {a.claim_id}</span>
                        <blockquote>{a.text}</blockquote>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="rc-note">A story from the first build (no acts).</p>
          )}
          <h4>Facts</h4>
          <ul className="rc-facts">
            {story.facts.map((f) => (
              <li key={f.id}>
                <span className="rc-fact-id">{f.id}{f.core ? '*' : ''}{f.act ? <span className="rc-meta">{f.act}</span> : null}</span>
                <span>
                  {f.text}{' '}
                  {f.source && (
                    <a href={f.source.url} target="_blank" rel="noreferrer noopener">
                      {f.source.publisher || 'source'}
                    </a>
                  )}
                  {f.detail && <span className="rc-meta"> {f.detail}</span>}
                </span>
                <Check status={f.check} />
              </li>
            ))}
          </ul>
          <p className="rc-note">* a core fact: the story is dropped if it fails its source check.</p>
          {onMake && story.status === 'pool' && (
            <div className="rc-actions">
              <button type="button" className="rc-primary" disabled={busy} onClick={() => onMake(story)}>
                Make reel
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function RealCaseLab() {
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pool');
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/real-case/lab', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as LabData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a render runs, refresh every 10s.
  const running = data?.jobs.some((j) => j.status === 'requested' || j.status === 'running') ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [running, load]);

  const find = async () => {
    if (!window.confirm(`Search recent AI news for stories?\n\nThis runs one live search: Sonnet with web search over the last ${data?.settings.news_window_days ?? 90} days, then the source check and Jev. Estimated $0.50–1.00.`)) return;
    setBusy('find');
    setNotice('Searching the news… this can take a few minutes.');
    const r = await post('/api/real-case/find', {});
    setBusy(null);
    if (!r.ok) setNotice(`Search failed: ${r.error}`);
    else {
      const result = r.data as { status: string; searches?: { outcome: string; evaluations: unknown[]; usd: number; error?: string }[]; usd?: number };
      const t = result.searches?.[0];
      setNotice(t ? `${OUTCOME_LABEL[t.outcome] ?? t.outcome}: ${t.evaluations.length} stories checked, ${usd(result.usd ?? 0)} spent.${t.error ? ` ${t.error}` : ''}` : `Search: ${result.status}.`);
    }
    await load();
  };

  const make = async (story: LabStory) => {
    if (!window.confirm(`Make a reel from “${story.title}”?\n\nThe worker renders it (npm run real-case:worker). A render costs about $6–8, capped at ${usd(data?.settings.per_reel_cap_usd ?? 8)}.`)) return;
    setBusy(story.id);
    const r = await post('/api/real-case/make', { storyId: story.id });
    setBusy(null);
    setNotice(r.ok ? `Queued “${story.title}”. Start the worker if it is not running.` : `Could not queue it: ${r.error}`);
    if (r.ok) setTab('renders');
    await load();
  };

  const toggleAuto = async () => {
    if (!data) return;
    const next = !data.settings.auto_scout;
    if (next && !window.confirm(`Turn on the nightly news search?\n\nEvery night at 2:30 AM New York, the worker runs ${data.settings.searches_per_night} news search${data.settings.searches_per_night === 1 ? '' : 'es'}, stopping at ${usd(data.settings.nightly_cap_usd)} of spend.`)) return;
    const r = await post('/api/real-case/settings', { key: 'auto_scout', value: next });
    if (!r.ok) setNotice(`Could not change it: ${r.error}`);
    await load();
  };

  return (
    <main className="rc">
      <header className="rc-head">
        <h1>AI News Explained lab</h1>
        <p className="rc-sub">Recent AI news stories, checked against their sources and scored by Jev. Local only; nothing publishes.</p>
        {data && (
          <div className="rc-bar">
            <span>Spent today: <b>{usd(data.spendTodayUsd)}</b></span>
            <span>Pool: <b>{data.pool.filter((s) => s.status === 'pool').length}</b> of {data.settings.pool_size}</span>
            <label className="rc-toggle">
              <input type="checkbox" checked={data.settings.auto_scout} onChange={() => void toggleAuto()} />
              Nightly search ({data.settings.searches_per_night}, {usd(data.settings.nightly_cap_usd)} cap)
            </label>
            <button type="button" className="rc-primary" disabled={busy !== null} onClick={() => void find()}>
              {busy === 'find' ? 'Searching…' : 'Find stories'}
            </button>
          </div>
        )}
      </header>
      {error && <p className="rc-error" role="alert">{error}</p>}
      {notice && <p className="rc-notice" role="status">{notice}</p>}

      <nav className="rc-tabs" aria-label="Lab sections">
        {(['pool', 'searches', 'renders', 'dropped'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-pressed={tab === t}>
            {t === 'pool' ? 'Story pool' : t === 'searches' ? 'Searches' : t === 'renders' ? 'Renders' : 'Dropped'}
          </button>
        ))}
      </nav>

      {!data && !error && <p className="rc-note">Loading…</p>}

      {data && tab === 'pool' && (
        <section className="rc-card">
          <h2>Story pool</h2>
          {data.pool.length === 0 ? (
            <p className="rc-note">No stories yet. Click Find stories to search the news.</p>
          ) : (
            <ul className="rc-list">{data.pool.map((s) => <StoryCard key={s.id} story={s} onMake={make} busy={busy !== null} />)}</ul>
          )}
        </section>
      )}

      {data && tab === 'searches' && (
        <section className="rc-card">
          <h2>Searches</h2>
          <ul className="rc-list">
            {data.scouts.map((s) => (
              <li key={s.id} className="rc-row">
                <span>
                  {s.topic_title}
                  <span className="rc-meta">{when(s.scouted_at)} · {s.stories_found} found{s.best_score !== null ? ` · best ${Math.round(s.best_score)}` : ''}</span>
                  {s.error && <span className="rc-meta rc-bad">{s.error}</span>}
                </span>
                <span className={`rc-chip ${s.outcome === 'found' ? 'ok' : s.outcome === 'failed' ? 'bad' : 'quiet'}`}>{OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
              </li>
            ))}
            {data.scouts.length === 0 && <li className="rc-note">Nothing searched yet.</li>}
          </ul>
        </section>
      )}

      {data && tab === 'renders' && (
        <section className="rc-card">
          <h2>Renders</h2>
          <p className="rc-note">Queued renders run in the Real Case worker: <code>npm run real-case:worker</code>.</p>
          <ul className="rc-list">
            {data.jobs.map((j) => (
              <li key={j.id} className="rc-job">
                <div className="rc-row">
                  <span>
                    {j.title}
                    <span className="rc-meta">{j.term} · {when(j.requestedAt)} · {usd(j.spendUsd)} of {usd(j.capUsd)}{j.stage ? ` · ${j.stage}` : ''}</span>
                  </span>
                  <span className={`rc-chip ${j.status === 'ok' ? 'ok' : j.status === 'failed' ? 'bad' : 'live'}`}>{j.status}</span>
                </div>
                {j.error && <p className="rc-error">{j.error}</p>}
                {j.flags.length > 0 && (
                  <ul className="rc-flags">
                    {j.flags.map((f, i) => <li key={i}><b>{f.kind.replace(/_/g, ' ')}:</b> {f.detail}</li>)}
                  </ul>
                )}
                {j.videoId && <video className="rc-video" src={`/api/real-case/artifacts/${j.videoId}`} controls preload="metadata" />}
              </li>
            ))}
            {data.jobs.length === 0 && <li className="rc-note">No renders yet.</li>}
          </ul>
        </section>
      )}

      {data && tab === 'dropped' && (
        <section className="rc-card">
          <h2>Dropped stories</h2>
          <p className="rc-note">Failed a source check, a gate or the bar, lost to a stronger telling of the same event, or aged out of the news window.</p>
          <ul className="rc-list">{data.others.map((s) => <StoryCard key={s.id} story={s} busy={busy !== null} />)}</ul>
          {data.others.length === 0 && <p className="rc-note">None.</p>}
        </section>
      )}
    </main>
  );
}
