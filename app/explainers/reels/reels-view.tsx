'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Loader2, Play } from 'lucide-react';

import { Drawer, ReelVideo, Section } from '@/app/reels/ui';
import { requestJson } from '@/lib/client-request';
import { reviewCaption } from '@/lib/explainers/caption-format';
import type { JobDetail, JobSummary } from '@/lib/explainers/overview';
import { FAILURE_TAGS, type FailureTag, type Verdict } from '@/lib/explainers/types';

const usd = (v: number) => `$${v.toFixed(2)}`;
const fileUrl = (artifactId: string) => `/api/explainers/artifacts/${artifactId}`;

function nyDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function todayInNewYork(): string {
  return nyDateKey(new Date().toISOString());
}

/** `nyDate` is a New York calendar date. Parsing it as UTC shifts the label back a day. */
function formatNyDate(nyDate: string, style: 'short' | 'long' = 'short'): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  if (!year || !month || !day) return nyDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: style === 'long' ? 'long' : undefined,
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function scoreLabel(value: number | null): string {
  const n = typeof value === 'number' ? value : Number(value);
  return value == null || !Number.isFinite(n) ? '—' : n.toFixed(1);
}

type DayGroup = { nyDate: string; jobs: JobSummary[] };

/** Oldest day first, so the strip reads left to right toward today. Jobs stay newest first. */
function groupByDay(jobs: JobSummary[]): DayGroup[] {
  const order: string[] = [];
  const byDay = new Map<string, JobSummary[]>();
  for (const job of jobs) {
    const nyDate = nyDateKey(job.requested_at);
    const list = byDay.get(nyDate);
    if (list) list.push(job);
    else {
      order.push(nyDate);
      byDay.set(nyDate, [job]);
    }
  }
  return order.reverse().map((nyDate) => ({ nyDate, jobs: byDay.get(nyDate) ?? [] }));
}

function chipClass(status: string): string {
  if (status === 'failed' || status === 'rejected') return 'rh-chip rh-chip--failed';
  if (status === 'ok' || status === 'approved') return 'rh-chip rh-chip--ready';
  return 'rh-chip';
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rh-btn rh-btn--quiet rh-btn--xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      <Copy size={12} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function Text({ value }: { value: string | null | undefined }) {
  if (!value) return <p className="rh-muted">None.</p>;
  return <pre className="ex-brief">{value}</pre>;
}

function Review({ detail, onSaved }: { detail: JobDetail; onSaved: () => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(detail.feedback?.verdict ?? null);
  const [tags, setTags] = useState<FailureTag[]>((detail.feedback?.tags as FailureTag[]) ?? []);
  const [note, setNote] = useState(detail.feedback?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const rendering = detail.job.status === 'requested' || detail.job.status === 'running';

  async function save() {
    if (!verdict) return;
    setBusy(true);
    setMessage(null);
    try {
      await requestJson(`/api/explainers/jobs/${detail.job.id}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verdict, tags, note }),
      });
      setMessage({ text: 'Review saved.' });
      onSaved();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setBusy(false);
    }
  }

  if (rendering) return <p className="rh-muted">Review opens when the render finishes.</p>;
  return (
    <div className="ex-review">
      <div className="ex-review__verdict" role="radiogroup" aria-label="Verdict">
        {(['approved', 'rejected'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={verdict === v}
            className={`rh-pill${verdict === v ? ' rh-pill--selected' : ''}`}
            onClick={() => setVerdict(v)}
          >
            {v === 'approved' ? 'Approve' : 'Reject'}
          </button>
        ))}
      </div>
      <div className="ex-review__tags" aria-label="Failure tags">
        {FAILURE_TAGS.map((tag) => {
          const on = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              className={`rh-pill${on ? ' rh-pill--selected' : ''}`}
              onClick={() => setTags((t) => (on ? t.filter((x) => x !== tag) : [...t, tag]))}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <textarea
        className="ex-textarea"
        rows={3}
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Review note"
      />
      <div className="ex-actions">
        <button type="button" className="rh-btn rh-btn--primary" disabled={!verdict || busy} onClick={() => void save()}>
          {busy && <Loader2 size={14} className="rh-spin" />}
          Save review
        </button>
        {message && <span className={message.bad ? 'rh-note rh-note--bad' : 'rh-muted'}>{message.text}</span>}
      </div>
    </div>
  );
}

function ReelDrawer({ jobId, onClose, onChanged }: { jobId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    requestJson<JobDetail>(`/api/explainers/jobs/${jobId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail || (detail.job.status !== 'running' && detail.job.status !== 'requested')) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [detail, load]);

  const artifact = (kind: string) => detail?.artifacts.filter((a) => a.kind === kind) ?? [];
  const latest = (kind: string) => artifact(kind).at(-1);
  const video = latest('video');
  const sheet = latest('contact_sheet');
  const post = latest('post_caption');
  const captions = latest('captions');
  const transcript = latest('transcript_log');
  const working = detail?.job.status === 'running' || detail?.job.status === 'requested';
  const title = detail?.topic?.title ?? detail?.job.topic_title;

  return (
    <Drawer label="Reel details" onClose={onClose}>
      {error && <p className="rh-note rh-note--bad">{error}</p>}
      {!detail && !error && (
        <p className="rh-muted">
          <Loader2 size={14} className="rh-spin" /> Loading…
        </p>
      )}
      {detail && (
        <div className="rh-detail ex-detail">
          <header className="rh-detail__head">
            <div className="rh-detail__score">
              <span>{scoreLabel(detail.topic?.weighted_score ?? null)}</span>
              <small>score</small>
            </div>
            <div className="rh-detail__labels">
              <span className="rh-detail__archetype">{title}</span>
              <span className="rh-detail__cat">
                {detail.job.stage ?? detail.job.status} · {usd(detail.job.spend_usd)} of {usd(detail.job.spend_cap_usd)} ·{' '}
                {formatTime(detail.job.requested_at)}
              </span>
              <span className="rh-reel__pills">
                <span className={chipClass(detail.job.status)}>{detail.job.status}</span>
                {detail.job.verdict && <span className={chipClass(detail.job.verdict)}>{detail.job.verdict}</span>}
                {detail.job.capped && <span className="rh-chip rh-chip--failed">Cap</span>}
              </span>
            </div>
          </header>

          {detail.job.error && (
            <p className="rh-note rh-note--bad">
              <AlertTriangle size={13} /> {detail.job.error}
            </p>
          )}

          <div className="rh-detail__media">
            {video ? (
              <ReelVideo src={fileUrl(video.id)} controls sound />
            ) : (
              <div className="rh-detail__blank">{working ? `${detail.job.stage ?? 'Starting'}…` : 'No video yet'}</div>
            )}
          </div>

          <Section title="Caption" open>
            {post?.content ? (
              <>
                <p className="rh-text">{reviewCaption(post.content)}</p>
                <CopyButton text={reviewCaption(post.content)} />
                <p className="rh-muted">The episode number is filled in when this posts, in the order explainers have gone out.</p>
              </>
            ) : (
              <p className="rh-muted">{working ? 'Written with the video.' : 'No caption yet.'}</p>
            )}
          </Section>

          <Review detail={detail} onSaved={() => { load(); onChanged(); }} />

          <div className="rh-detail__sections">
            {(sheet || captions || transcript) && (
              <Section title="Outputs" open={Boolean(sheet)}>
                {sheet && (
                  <a href={fileUrl(sheet.id)} target="_blank" rel="noreferrer">
                    <img className="ex-sheet" src={fileUrl(sheet.id)} alt="Contact sheet" />
                  </a>
                )}
                <p className="ex-links">
                  {captions && (
                    <a href={fileUrl(captions.id)} target="_blank" rel="noreferrer">
                      Captions JSON
                    </a>
                  )}
                  {transcript && (
                    <a href={fileUrl(transcript.id)} target="_blank" rel="noreferrer">
                      Agent transcript
                    </a>
                  )}
                </p>
              </Section>
            )}

            <Section title="Plan" count={detail.lint.length} open={detail.lint.some((v) => v.severity === 'error')}>
              {detail.lint.length === 0 ? (
                <p className="rh-muted">No lint violations.</p>
              ) : (
                <ul className="rh-notes">
                  {detail.lint.map((v) => (
                    <li key={v.id} className={`rh-note rh-note--${v.severity === 'error' ? 'bad' : 'warn'}`}>
                      <AlertTriangle size={13} />
                      <span>
                        <strong>{v.rule}</strong>
                        {v.frame != null && ` · frame ${v.frame}`}
                        <span className="rh-muted"> · {v.source}</span>
                        <div>{v.detail}</div>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="rh-card__sub">Storyboard</p>
              <Text value={latest('storyboard')?.content} />
              <p className="rh-card__sub">Script</p>
              <Text value={latest('script')?.content} />
            </Section>

            <Section title="Inputs">
              <p className="rh-text">{detail.topic?.title}</p>
              {detail.topic?.scope && <p className="rh-muted">{detail.topic.scope}</p>}
              <p className="rh-card__sub">Source</p>
              <Text value={latest('source')?.content ?? (detail.topic?.source_url ? `URL: ${detail.topic.source_url}` : null)} />
              <p className="rh-card__sub">BRIEF.md</p>
              <Text value={latest('brief')?.content} />
            </Section>

            <Section title="Run" open={Boolean(detail.job.error)}>
              <p className="rh-muted">
                {detail.job.trigger} · {detail.job.mode} · orchestrator {detail.job.orchestrator_model} · frame workers{' '}
                {detail.job.frame_worker_model}
              </p>
              {detail.costs.length === 0 ? (
                <p className="rh-muted">No spend recorded.</p>
              ) : (
                <dl className="rh-parts">
                  {detail.costs.map((c, i) => (
                    <div key={`${c.vendor}-${c.component}-${i}`}>
                      <dt>
                        {c.vendor} · {c.component}
                      </dt>
                      <dd>
                        {c.usd_known ? usd(c.usd) : 'unknown'}
                        <small className="rh-muted">
                          {' '}
                          {c.input_tokens.toLocaleString()} / {c.output_tokens.toLocaleString()}
                        </small>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {detail.job.cost_by_vendor.some((c) => c.unknown_count > 0) && (
                <p className="rh-muted">A vendor returned no price for some calls. Those amounts stay unknown.</p>
              )}
              <p className="rh-card__sub">Lint report</p>
              <Text value={artifact('lint_report').map((a) => a.content).filter(Boolean).join('\n\n') || null} />
              <p className="rh-card__sub">Audio meta</p>
              <Text value={latest('audio_meta')?.content} />
            </Section>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ReelCard({ job, onOpen }: { job: JobSummary; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const ready = job.status === 'ok' && Boolean(job.video_id);
  const working = job.status === 'running' || job.status === 'requested';
  const stopped = !ready && !working;

  return (
    <article className="rh-reel ex-reel">
      <div className="rh-reel__media" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {ready && job.video_id ? (
          <ReelVideo src={fileUrl(job.video_id)} playing={hover} />
        ) : null}
        <button type="button" className="rh-reel__hit" onClick={onOpen} aria-label={`Open ${job.topic_title}`}>
          {ready && !hover && (
            <span className="rh-reel__play" aria-hidden="true">
              <Play size={18} />
            </span>
          )}
        </button>
        {working && (
          <div className="rh-reel__state">
            <Loader2 size={20} className="rh-spin" />
            <span>{job.stage ?? 'Starting'}</span>
          </div>
        )}
        {stopped && (
          <div className="rh-reel__state">
            <span className="rh-reel__note">
              <AlertTriangle size={14} /> {job.status === 'failed' ? 'Generation stopped' : 'No video'}
            </span>
            {job.error && <span className="ex-reel__error">{job.error}</span>}
          </div>
        )}
      </div>
      <button type="button" className="rh-reel__meta" onClick={onOpen}>
        <span className="rh-reel__score">{scoreLabel(job.weighted_score)}</span>
        <span className="rh-reel__labels">
          <span>{job.topic_title}</span>
          <span className="rh-reel__cat">{usd(job.spend_usd)}</span>
        </span>
        <span className="rh-reel__pills">
          <span className={chipClass(job.status)}>{job.status}</span>
          {job.verdict && <span className={chipClass(job.verdict)}>{job.verdict}</span>}
          {job.capped && <span className="rh-chip rh-chip--failed">Cap</span>}
        </span>
      </button>
    </article>
  );
}

export function ReelsView({ jobs }: { jobs: JobSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const dayList = useRef<HTMLDivElement>(null);
  const days = useMemo(() => groupByDay(jobs), [jobs]);
  const today = todayInNewYork();
  const selected = days.find((day) => day.nyDate === dayKey) ?? days[days.length - 1] ?? null;
  const index = selected ? days.findIndex((day) => day.nyDate === selected.nyDate) : -1;
  const live = jobs.some((j) => j.status === 'running' || j.status === 'requested');

  useEffect(() => {
    const list = dayList.current;
    if (list) list.scrollLeft = list.scrollWidth;
  }, [days.length]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [live, router]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (jobs.length === 0 || !selected) {
    return <p className="rh-empty">No renders yet. Click Generate on a pool topic.</p>;
  }

  return (
    <>
      <nav className="rh-days" aria-label="Days">
        <button
          type="button"
          className="rh-days__step"
          onClick={() => setDayKey(days[index - 1]?.nyDate ?? selected.nyDate)}
          disabled={index <= 0}
          aria-label="Earlier day"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="rh-days__list" ref={dayList}>
          {days.map((day, i) => {
            const active = day.nyDate === selected.nyDate;
            const sub = day.nyDate === today ? 'Today' : i === days.length - 1 ? 'Latest' : `${day.jobs.length} reels`;
            return (
              <button
                key={day.nyDate}
                type="button"
                className={`rh-day${active ? ' is-active' : ''}`}
                aria-current={active ? 'date' : undefined}
                onClick={() => setDayKey(day.nyDate)}
              >
                <span className="rh-day__date">{formatNyDate(day.nyDate)}</span>
                <span className="rh-day__sub">{sub}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="rh-days__step"
          onClick={() => setDayKey(days[index + 1]?.nyDate ?? selected.nyDate)}
          disabled={index >= days.length - 1}
          aria-label="Later day"
        >
          <ChevronRight size={16} />
        </button>
      </nav>

      <section className="rh-day-head">
        <div>
          <h2>{formatNyDate(selected.nyDate, 'long')}</h2>
          <p>
            {selected.jobs.length} {selected.jobs.length === 1 ? 'reel' : 'reels'}
          </p>
        </div>
      </section>

      <div className="rh-top">
        {selected.jobs.map((job) => (
          <ReelCard key={job.id} job={job} onOpen={() => setOpen(job.id)} />
        ))}
      </div>

      {open && <ReelDrawer jobId={open} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
