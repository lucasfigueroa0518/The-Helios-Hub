'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Story = {
  id: string; title: string; status: string; createdAt: string; group: 'post' | 'candidate';
  postRef: string | null; nyDate: string | null; origin: string | null; outlet: string | null;
  url: string | null; hasBrief: boolean; briefSource: string | null; thin: boolean;
  originalPhoto: { url: string; credit: string | null } | null;
  generated: number; generating: number;
};
type Run = {
  id: string; kind: string; postId: string | null; status: string; stage: string | null; costUsd: number;
  error: string | null; requestedAt: string; finishedAt: string | null; title: string | null;
  slate: number; graded: number;
};
type Meme = {
  id: string; templateId: string; templateName: string; inSlate: boolean; rank: number | null;
  situation: { id: string; name: string } | null; point: string; lines: Array<{ slot: string; says: string; why: string | null }>;
  judges: Record<string, number | string | null>; dropped: string | null; belowBar: string | null; hasImage: boolean;
  turnId: string | null; turnType: string | null;
  pick: { verdict: string; tags: string[]; note: string | null; rating: number | null } | null;
};
type Turn = { id: string; type: string; summary?: string; strength?: number; kept?: boolean; dropped?: string | null };
type RunDetail = Run & {
  slateId: string | null; pipeline: string;
  shape: { shape?: string; extraCall?: boolean; relation?: string; spread?: boolean; turns?: Turn[]; weakTurn?: boolean } | null;
  memes: Meme[]; detail: Record<string, unknown>;
};
type Preview = { postRef: string; coverIsMeme: boolean; slides: Array<{ kind: string; storyKey: string | null; title: string; image: { kind: string; url: string | null; credit: string | null } }>; mosaic: Array<{ url: string; credit: string | null }> };
type Bucket = { key: string; n: number; passed: number; picked: number; failed: Record<string, number>; rated: number; good: number; awesome: number; mean: number | null };
type Results = {
  totals: { memes: number; passed: number; picked: number; rated: number; good: number; awesome: number };
  byTemplate: Bucket[]; bySituation: Bucket[]; byKind: Bucket[]; byFail: Bucket[];
  byVersion: Bucket[]; byReason: Bucket[]; byTurnType: Bucket[];
};
type TagSet = Record<string, string>;

/** Blind grading hides which pipeline made a slate, Jev's scores and its ranking (UPGRADE_PLAN U0). */
const BLIND_KEY = 'memes-lab-blind';
function readBlind(): boolean {
  try {
    return window.localStorage.getItem(BLIND_KEY) === '1';
  } catch {
    return false;
  }
}
function writeBlind(on: boolean) {
  try {
    window.localStorage.setItem(BLIND_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked: the toggle still works for this visit */
  }
}

/** A fixed shuffle (by id), so blind mode does not show the slate in Jev's rank order. */
function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function parseWhen(iso: string): Date | null {
  if (!iso) return null;
  const t = iso.trim().replace(' ', 'T').replace(/([+-]\d{2})(?::?(\d{2}))?$/, (_, hh: string, mm?: string) => `${hh}:${mm ?? '00'}`);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
const when = (iso: string) => {
  const d = parseWhen(iso);
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
};
const gradeLabel = (r: { slate: number; graded: number; status: string }) => {
  if (r.slate <= 0) return r.status === 'ok' ? 'No slate' : null;
  if (r.graded >= r.slate) return 'Graded';
  if (r.graded === 0) return 'Not graded';
  return `${r.graded}/${r.slate} graded`;
};
const genLabel = (s: { generated: number; generating: number }) => {
  if (s.generating > 0 && s.generated === 0) return 'Generating…';
  if (s.generated === 1) return 'Generated';
  if (s.generated > 1) return `Generated ×${s.generated}`;
  return null;
};
const usd = (n: number) => `$${n.toFixed(3)}`;
const pct = (v: number | string | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}` : '–');

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

type Tab = 'stories' | 'preview' | 'results';
type Gen = 'single' | 'spread' | 'landscape';

export function MemeLab({ reasonTags, workedTags, capUsd, briefCapUsd = 0.5 }: { reasonTags: TagSet; workedTags: TagSet; capUsd: number; briefCapUsd?: number }) {
  const [page, setPage] = useState<Tab>('stories');
  const [blind, setBlind] = useState(false);
  useEffect(() => setBlind(readBlind()), []);
  const [gen, setGen] = useState<Gen>('single');
  const [stories, setStories] = useState<Story[] | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStories = useCallback(async () => {
    try {
      setStories(await api<Story[]>('/api/memes/stories'));
      setStoryError(null);
    } catch (e) {
      setStoryError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api<Run[]>('/api/memes/runs'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadStories();
    void loadRuns();
  }, [loadStories, loadRuns]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api<RunDetail>(`/api/memes/runs/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (openRun) void loadDetail(openRun);
  }, [openRun, loadDetail]);

  const live = detail && (detail.status === 'requested' || detail.status === 'running');
  useEffect(() => {
    if (!live || !openRun) return;
    const t = setInterval(() => {
      void loadDetail(openRun);
      void loadRuns();
      void loadStories();
    }, 2500);
    return () => clearInterval(t);
  }, [live, openRun, loadDetail, loadRuns]);

  const posts = useMemo(() => [...new Set((stories ?? []).filter((s) => s.postRef).map((s) => s.postRef!))], [stories]);
  const [postRef, setPostRef] = useState<string | null>(null);
  useEffect(() => {
    if (!postRef && posts[0]) setPostRef(posts[0]);
  }, [posts, postRef]);

  useEffect(() => {
    if (page !== 'preview' || !postRef) return;
    api<Preview>(`/api/memes/preview?postRef=${encodeURIComponent(postRef)}`).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [page, postRef, detail]);

  useEffect(() => {
    if (page !== 'results') return;
    api<Results>('/api/memes/results').then(setResults).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [page, runs]);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function briefs(mode: 'from-body' | 'reporter') {
    setBusy(true);
    setError(null);
    try {
      const ids = mode === 'reporter' ? selected.slice(0, 1) : selected;
      const out = await api<{ jobs: Array<{ id: string; ok: boolean; error?: string }> }>('/api/memes/briefs', { method: 'POST', body: JSON.stringify({ storyIds: ids, mode }) });
      const failed = out.jobs.filter((j) => !j.ok);
      if (failed.length) setError(failed.map((j) => j.error ?? j.id).join(' · '));
      await loadStories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { requestId } = await api<{ requestId: string }>('/api/memes/generate', { method: 'POST', body: JSON.stringify({ kind: gen, storyIds: selected }) });
      setOpenRun(requestId);
      await loadRuns();
      await loadStories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = gen === 'single' ? selected.length >= 1 : selected.length >= 2;
  const chosen = stories?.filter((s) => selected.includes(s.id)) ?? [];
  const needBriefs = chosen.filter((s) => !s.hasBrief);
  const thin = chosen.filter((s) => s.thin && !s.hasBrief);

  return (
    <main className="ml">
      <header className="ml-head">
        <div>
          <h1>Meme lab</h1>
          <p className="ml-sub">
            Last Few Days test bed. Nothing publishes. Generate is capped at {usd(capUsd)}; briefs in parallel at {usd(briefCapUsd)}.
          </p>
        </div>
        <label className="ml-blind">
          <input
            type="checkbox"
            checked={blind}
            onChange={(e) => {
              setBlind(e.target.checked);
              writeBlind(e.target.checked);
            }}
          />
          Blind grading
        </label>
      </header>

      {error && <p className="ml-error" role="alert">{error}</p>}

      <div className="ml-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={page === 'stories'} className={page === 'stories' ? 'on' : ''} onClick={() => setPage('stories')}>Stories</button>
        <button type="button" role="tab" aria-selected={page === 'preview'} className={page === 'preview' ? 'on' : ''} onClick={() => setPage('preview')}>Post preview</button>
        <button type="button" role="tab" aria-selected={page === 'results'} className={page === 'results' ? 'on' : ''} onClick={() => setPage('results')}>Results</button>
      </div>

      {page === 'stories' && (
        <section className="ml-card">
          <div className="ml-tabs" role="tablist" aria-label="Generate mode">
            <button type="button" role="tab" aria-selected={gen === 'single'} className={gen === 'single' ? 'on' : ''} onClick={() => setGen('single')}>One story</button>
            <button type="button" role="tab" aria-selected={gen === 'spread'} className={gen === 'spread' ? 'on' : ''} onClick={() => setGen('spread')}>Spread (whole set)</button>
            <button type="button" role="tab" aria-selected={gen === 'landscape'} className={gen === 'landscape' ? 'on' : ''} onClick={() => setGen('landscape')}>Landscape</button>
          </div>
          {gen === 'single' && <p className="ml-note">Pick one or more stories. Generate queues a separate meme for each.</p>}
          {gen === 'landscape' && <p className="ml-note">Pick two or more stories. Generate makes one meme about how those stories stack up.</p>}
          {gen === 'spread' && <p className="ml-note">Pick the whole Last Few Days set. A spread has to cover every selected story; a strong one can be the cover.</p>}
          <StoryPicker stories={stories} error={storyError} selected={selected} onToggle={toggle} />
          <div className="ml-actions">
            {needBriefs.length > 0 && (
              <button type="button" disabled={busy} onClick={() => briefs('from-body')}>
                {busy ? 'Briefing…' : `Generate briefs (${needBriefs.length})`}
              </button>
            )}
            {thin.length === 1 && (
              <button type="button" disabled={busy} onClick={() => briefs('reporter')}>Full Reporter (thin body)</button>
            )}
            <button type="button" className="ml-primary" disabled={busy || !canGenerate} onClick={generate}>
              {busy ? 'Queuing…' : gen === 'single' && selected.length > 1 ? `Generate (${selected.length})` : 'Generate'}
            </button>
          </div>
        </section>
      )}

      {page === 'preview' && (
        <PreviewPanel posts={posts} postRef={postRef} onPost={setPostRef} preview={preview} stories={stories ?? []} />
      )}

      {page === 'results' && <ResultsPanel results={results} />}

      {page === 'stories' && (
        <div className="ml-grid">
          <section className="ml-card ml-runs">
            <h2>Runs</h2>
            {!runs.length && <p className="ml-note">No runs yet.</p>}
            <ul>
              {runs.map((r) => {
                const grade = gradeLabel(r);
                return (
                <li key={r.id}>
                  <button type="button" className={`ml-run ${openRun === r.id ? 'on' : ''}`} onClick={() => setOpenRun(r.id)}>
                    <span className={`ml-dot ${r.status}`} aria-hidden />
                    <span className="ml-run-title">{r.title ?? (r.kind === 'spread' ? 'Spread' : r.kind === 'landscape' ? 'Landscape' : 'Story')}</span>
                    {grade && (
                      <span className={`ml-run-grade${r.slate > 0 && r.graded >= r.slate ? ' done' : r.graded === 0 ? ' none' : ''}`}>
                        {grade}
                      </span>
                    )}
                    <span className="ml-run-meta">{r.status === 'running' ? r.stage ?? 'running' : r.status} · {usd(r.costUsd)} · {when(r.requestedAt)}</span>
                  </button>
                </li>
                );
              })}
            </ul>
          </section>
          <section className="ml-card ml-detail">
            {!detail ? <p className="ml-note">Generate, or open a run.</p> : (
              <RunView
                run={detail}
                blind={blind}
                reasonTags={reasonTags}
                workedTags={workedTags}
                postRef={postRef ?? chosen.find((s) => s.postRef)?.postRef ?? null}
                stories={chosen}
                onChanged={() => {
                  if (openRun) void loadDetail(openRun);
                  void loadRuns();
                }}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function StoryPicker({ stories, error, selected, onToggle }: { stories: Story[] | null; error: string | null; selected: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (stories ?? []).filter((s) => s.title.toLowerCase().includes(q.toLowerCase())), [stories, q]);
  const posts = shown.filter((s) => s.group === 'post');
  const candidates = shown.filter((s) => s.group === 'candidate');
  if (error) return <p className="ml-error">Couldn&apos;t load Last Few Days stories: {error}</p>;
  if (!stories) return <p className="ml-note">Loading Last Few Days stories…</p>;
  if (!stories.length) return <p className="ml-note">No Last Few Days posts or candidates yet. Candidates appear from reels and carousel shortlists in the current window.</p>;
  return (
    <div className="ml-picker">
      <input className="ml-search" placeholder="Filter stories" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter stories" />
      {!!posts.length && <p className="ml-note">Finished Last Few Days posts</p>}
      <StoryList items={posts} selected={selected} onToggle={onToggle} />
      {!!candidates.length && <p className="ml-note">Candidates (need a brief before Generate)</p>}
      <StoryList items={candidates} selected={selected} onToggle={onToggle} />
    </div>
  );
}

function StoryList({ items, selected, onToggle }: { items: Story[]; selected: string[]; onToggle: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul>
      {items.map((s) => {
        const gen = genLabel(s);
        return (
        <li key={s.id}>
          <label className={selected.includes(s.id) ? 'on' : ''}>
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => onToggle(s.id)} />
            <span className="ml-story-title">{s.title}</span>
            {gen && (
              <span className={`ml-story-gen${s.generated > 0 ? ' done' : ' live'}`}>{gen}</span>
            )}
            <span className="ml-story-meta">
              {s.group === 'post' ? `post ${s.nyDate ?? ''}` : s.origin ?? 'candidate'}
              {s.hasBrief ? ' · brief ready' : s.thin ? ' · thin body' : ' · no brief'}
              {s.outlet ? ` · ${s.outlet}` : ''}
            </span>
          </label>
        </li>
        );
      })}
    </ul>
  );
}

function PreviewPanel({ posts, postRef, onPost, preview, stories }: { posts: string[]; postRef: string | null; onPost: (id: string) => void; preview: Preview | null; stories: Story[] }) {
  if (!posts.length) return <section className="ml-card"><p className="ml-note">No finished Last Few Days post to preview yet. Attach memes after a post exists, or generate against candidates first.</p></section>;
  return (
    <section className="ml-card">
      <h2>Last Few Days preview</h2>
      <p className="ml-note">Cover uses original story photos unless a spread meme is the cover. Story slides show a picked meme when attached.</p>
      <div className="ml-tabs" role="tablist" aria-label="Last Few Days post">
        {posts.map((id) => (
          <button type="button" key={id} className={postRef === id ? 'on' : ''} onClick={() => onPost(id)}>
            {stories.find((s) => s.postRef === id)?.nyDate ?? id.slice(0, 8)}
          </button>
        ))}
      </div>
      {!preview ? <p className="ml-note">Loading preview…</p> : (
        <div className="ml-preview">
          {preview.slides.map((s, i) => (
            <article key={`${s.kind}-${s.storyKey ?? i}`} className={`ml-preview-slide ml-preview-${s.kind}`}>
              <p className="ml-story-meta">{s.kind}</p>
              <strong>{s.title}</strong>
              {s.kind === 'cover' && !preview.coverIsMeme && preview.mosaic.length > 0 && (
                <div className="ml-mosaic">
                  {preview.mosaic.map((p) => <img key={p.url} src={p.url} alt="" />)}
                </div>
              )}
              {s.image.kind === 'meme' && s.image.url && <img src={s.image.url} alt={s.title} />}
              {s.kind === 'story' && s.image.kind === 'photo' && s.image.url && <img src={s.image.url} alt="" />}
              {s.kind === 'follow' && <p className="ml-note">Follow Helios</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultsPanel({ results }: { results: Results | null }) {
  if (!results) return <section className="ml-card"><p className="ml-note">Loading results…</p></section>;
  if (!results.totals.memes) return <section className="ml-card"><p className="ml-note">No lab memes yet. Generate and pick; this board fills from those runs only.</p></section>;
  const t = results.totals;
  return (
    <section className="ml-card">
      <h2>Results</h2>
      <p className="ml-note">
        {t.memes} memes · {t.passed} passed judges · {t.rated} rated · {t.good} good ({t.rated ? Math.round((t.good / t.rated) * 100) : 0}%) · {t.awesome} awesome
      </p>
      <BucketTable title="By pipeline" rows={results.byVersion} />
      {results.byTurnType.length > 0 && <BucketTable title="By turn type" rows={results.byTurnType} />}
      {results.byReason.length > 0 && <BucketTable title="By reason chip" rows={results.byReason} />}
      <BucketTable title="By template" rows={results.byTemplate} />
      <BucketTable title="By situation" rows={results.bySituation} />
      <BucketTable title="By kind" rows={results.byKind} />
      <BucketTable title="Failed bar" rows={results.byFail} />
    </section>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <div className="ml-results">
      <h2>{title}</h2>
      <table>
        <thead><tr><th>Key</th><th>N</th><th>Passed</th><th>Rated</th><th>Good</th><th>Awesome</th><th>Mean</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td>{r.n}</td>
              <td>{r.passed}</td>
              <td>{r.rated}</td>
              <td>{r.rated ? `${r.good} (${Math.round((r.good / r.rated) * 100)}%)` : '–'}</td>
              <td>{r.rated ? r.awesome : '–'}</td>
              <td>{r.mean != null ? r.mean.toFixed(2) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunView({ run, blind, reasonTags, workedTags, postRef, stories, onChanged }: { run: RunDetail; blind: boolean; reasonTags: TagSet; workedTags: TagSet; postRef: string | null; stories: Story[]; onChanged: () => void }) {
  const inSlate = run.memes.filter((m) => m.inSlate);
  const slate = blind ? [...inSlate].sort((a, b) => hashOf(a.id) - hashOf(b.id)) : inSlate;
  const turns = run.shape?.turns ?? [];
  const others = run.memes.filter((m) => !m.inSlate);
  return (
    <div>
      <h2>{run.title ?? 'Run'}</h2>
      <p className="ml-run-line">
        <span className={`ml-dot ${run.status}`} aria-hidden /> {run.status === 'running' ? `Running: ${run.stage ?? '…'}` : run.status} · {usd(run.costUsd)}
        {run.finishedAt ? ` · finished ${when(run.finishedAt)}` : ''}
        {!blind && <span className="ml-version"> · pipeline {run.pipeline}</span>}
      </p>
      {run.error && <p className="ml-error">{run.error}</p>}
      {run.shape?.shape && <p className="ml-shape"><strong>Shape:</strong> {run.shape.shape}</p>}
      {!blind && turns.length > 0 && (
        <div className="ml-shape">
          <strong>Turns{run.shape?.weakTurn ? ' (weak: no strong turn found)' : ''}:</strong>
          <ul className="ml-turns">
            {turns.map((t) => (
              <li key={t.id} className={t.kept ? 'kept' : ''}>
                <em>{t.id} · {t.type}</em> {t.summary}{t.dropped ? <span className="ml-why"> · dropped: {t.dropped}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.shape?.relation && <p className="ml-note"><strong>Stack-up:</strong> {String(run.shape.relation).replace('_', ' ')}</p>}
      {run.shape?.spread && <p className="ml-note">Spread: must cover every selected Last Few Days story.</p>}
      {run.shape?.extraCall && <p className="ml-note">Fewer than two drafts cleared the judges, so the writer was asked once for more.</p>}
      <div className="ml-slate">
        {slate.map((m) => (
          <MemeCard key={m.id} meme={m} blind={blind} reasonTags={reasonTags} workedTags={workedTags} postRef={postRef} stories={stories} kind={run.kind} onChanged={onChanged} />
        ))}
      </div>
      {!blind && !!others.length && (
        <details className="ml-dropped">
          <summary>{others.length} candidate{others.length === 1 ? '' : 's'} not in the slate</summary>
          <ul>
            {others.map((m) => (
              <li key={m.id}>
                <strong>{m.templateName}</strong>: {m.dropped ?? 'ranked below the slate'}
                <div className="ml-lines">{m.lines.map((l) => <div key={l.slot}><em>{l.slot}</em> {l.says}{l.why ? <span className="ml-why"> · why: {l.why}</span> : null}</div>)}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const RATINGS = [
  { n: 1 as const, label: 'Horrible', hint: 'Something was clearly wrong. Would not post.' },
  { n: 2 as const, label: 'No', hint: 'Not a good meme. Would not post.' },
  { n: 3 as const, label: 'Yes', hint: 'A good meme. Would post.' },
  { n: 4 as const, label: 'Awesome', hint: 'Love it. Would post and be proud of it.' },
];

export function ReviewSlider({ value, disabled, onChange }: { value: 1 | 2 | 3 | 4 | null; disabled?: boolean; onChange: (n: 1 | 2 | 3 | 4) => void }) {
  const chosen = RATINGS.find((r) => r.n === value) ?? null;
  return (
    <div className={`ml-rate${value != null ? ` rated-${value}` : ''}`}>
      <div className="ml-rate-track" role="radiogroup" aria-label="Review">
        <span className="ml-rate-line" aria-hidden />
        {RATINGS.map((r) => (
          <button
            key={r.n}
            type="button"
            role="radio"
            aria-checked={value === r.n}
            aria-label={`${r.n}, ${r.label}. ${r.hint}`}
            className={value === r.n ? 'on' : ''}
            disabled={disabled}
            onClick={() => onChange(r.n)}
          >
            <span className="ml-rate-dot" aria-hidden />
            <span className="ml-rate-n">{r.n}</span>
          </button>
        ))}
      </div>
      <p className="ml-rate-hint">{chosen ? chosen.hint : 'Plot a rating. No default.'}</p>
    </div>
  );
}

function MemeCard({ meme, blind, postRef, stories, kind, onChanged }: { meme: Meme; blind: boolean; reasonTags: TagSet; workedTags: TagSet; postRef: string | null; stories: Story[]; kind: string; onChanged: () => void }) {
  const savedNote = meme.pick?.note ?? '';
  const [note, setNote] = useState(savedNote);
  // Keep the box in step with what was saved (a reload, or another card's save refreshing the run).
  useEffect(() => setNote(savedNote), [savedNote]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slide, setSlide] = useState(stories[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  const rating = meme.pick?.rating === 1 || meme.pick?.rating === 2 || meme.pick?.rating === 3 || meme.pick?.rating === 4 ? meme.pick.rating : null;

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setErr(null);
    try {
      await api('/api/memes/picks', { method: 'POST', body: JSON.stringify({ memeId: meme.id, ...body }) });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function place(role: 'cover' | 'slide') {
    if (!postRef) {
      setErr('Open a Last Few Days post in Preview first, or pick stories from a finished post.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api('/api/memes/attach', { method: 'POST', body: JSON.stringify({ postRef, memeId: meme.id, role, storyKey: role === 'slide' ? slide || stories[0]?.id : null }) });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const picked = rating != null ? rating >= 3 : meme.pick?.verdict === 'picked';
  const rejected = rating != null ? rating <= 2 : meme.pick?.verdict === 'rejected';
  return (
    <article className={`ml-meme ${picked ? 'picked' : ''} ${rejected ? 'rejected' : ''}`}>
      <div className="ml-meme-img">{meme.hasImage ? <img src={`/api/memes/image/${meme.id}`} alt={`${meme.templateName} meme`} /> : <div className="ml-noimg">No image</div>}</div>
      <div className="ml-meme-body">
        <ReviewSlider value={rating} disabled={saving} onChange={(n) => save({ rating: n })} />
        {rating != null && (
          <div className="ml-note-row">
            <textarea
              className="ml-note-in"
              aria-label={rating >= 3 ? 'What worked' : 'What went wrong'}
              placeholder={rating >= 3 ? 'What worked? (optional)' : 'What went wrong? (optional)'}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== savedNote && save({ rating, note })}
            />
            {note !== savedNote && <button type="button" disabled={saving} onClick={() => save({ rating, note })}>Save feedback</button>}
          </div>
        )}
        {err && <p className="ml-error">{err}</p>}
        <button type="button" className="ml-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Show more'}
        </button>
        {open && (
          <div className="ml-more-body">
            <div className="ml-meme-top">
              {!blind && <span className="ml-rank">#{meme.rank}</span>} <strong>{meme.templateName}</strong>
              {meme.turnType && <span className="ml-sit">{meme.turnId} · {meme.turnType}</span>}
              {meme.situation && <span className="ml-sit">{meme.situation.id} {meme.situation.name}</span>}
            </div>
            {!blind && meme.belowBar && <p className="ml-below">Shown below a bar so there are two to look at: {meme.belowBar.replace(/^judges: /, '')}</p>}
            <p className="ml-point">{meme.point}</p>
            {!blind && (
              <dl className="ml-scores">
                {['score', 'turn_visible', 'legible', 'format_true', 'punch_last', 'accurate', 'funny', 'relevant', 'clear', 'fit']
                  .filter((k) => typeof meme.judges[k] === 'number')
                  .map((k) => <div key={k}><dt>{k.replace('_', ' ')}</dt><dd>{pct(meme.judges[k])}</dd></div>)}
              </dl>
            )}
            {postRef && (
              <div className="ml-place">
                {kind === 'spread' && <button type="button" disabled={saving} onClick={() => place('cover')}>Use as cover</button>}
                {kind !== 'spread' && stories.length > 0 && (
                  <>
                    <div className="ml-tabs" role="tablist" aria-label="Story slide">
                      {stories.map((s) => (
                        <button type="button" key={s.id} className={slide === s.id ? 'on' : ''} onClick={() => setSlide(s.id)}>{s.title.slice(0, 28)}</button>
                      ))}
                    </div>
                    <button type="button" disabled={saving} onClick={() => place('slide')}>Use on this slide</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
