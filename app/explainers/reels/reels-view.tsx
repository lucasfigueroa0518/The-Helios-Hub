'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Drawer, Section } from '@/app/reels/ui';
import { requestJson } from '@/lib/client-request';
import type { JobDetail, JobSummary } from '@/lib/explainers/overview';
import { FAILURE_TAGS, type FailureTag, type Verdict } from '@/lib/explainers/types';

const when = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const usd = (v: number) => `$${v.toFixed(2)}`;
const fileUrl = (artifactId: string) => `/api/explainers/artifacts/${artifactId}`;

function Costs({ job }: { job: JobSummary }) {
  if (job.cost_by_vendor.length === 0) return <span className="rh-muted">none</span>;
  return (
    <>
      {job.cost_by_vendor.map((cost) => (
        <div key={cost.vendor}>
          {cost.vendor} {usd(cost.usd)}
          {cost.unknown_count > 0 && (
            <span className="ex-unknown" title="The vendor returned no price for these calls">
              {' '}+ {cost.unknown_count} unknown
            </span>
          )}
        </div>
      ))}
    </>
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
        {message && <span className={`ex-note${message.bad ? ' ex-note--bad' : ''}`}>{message.text}</span>}
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

  // Poll while the render is still going.
  useEffect(() => {
    if (!detail || (detail.job.status !== 'running' && detail.job.status !== 'requested')) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [detail, load]);

  const artifact = (kind: string) => detail?.artifacts.filter((a) => a.kind === kind) ?? [];
  const latest = (kind: string) => artifact(kind).at(-1);
  const video = latest('video');
  const sheet = latest('contact_sheet');
  const captions = latest('captions');
  const transcript = latest('transcript_log');

  return (
    <Drawer label="Reel review" onClose={onClose} wide>
      {error && <p className="ex-note ex-note--bad">{error}</p>}
      {!detail && !error && <p className="rh-muted"><Loader2 size={14} className="rh-spin" /> Loading…</p>}
      {detail && (
        <div className="ex-drawer">
          <p className="rh__kicker">Explainer reel</p>
          <h2 className="ex-drawer__title">{detail.topic?.title ?? detail.job.topic_title}</h2>
          <p className="ex-scope">
            <span className={`ex-status ex-status--${detail.job.status}`}>{detail.job.status}</span>{' '}
            stage {detail.job.stage ?? '—'} · {usd(detail.job.spend_usd)} of {usd(detail.job.spend_cap_usd)} ·{' '}
            {when.format(new Date(detail.job.requested_at))}
          </p>
          {detail.job.error && <p className="ex-note ex-note--bad">{detail.job.error}</p>}

          <Section title="Outputs" open>
            {video ? (
              <div className="ex-player">
                <video src={fileUrl(video.id)} controls playsInline preload="metadata" />
              </div>
            ) : (
              <p className="rh-muted">No video yet.</p>
            )}
            {sheet && (
              <a href={fileUrl(sheet.id)} target="_blank" rel="noreferrer">
                <img className="ex-sheet" src={fileUrl(sheet.id)} alt="Contact sheet" />
              </a>
            )}
            <p className="ex-links">
              {captions && <a href={fileUrl(captions.id)} target="_blank" rel="noreferrer">Captions JSON</a>}
              {transcript && <a href={fileUrl(transcript.id)} target="_blank" rel="noreferrer">Agent transcript</a>}
            </p>
          </Section>

          <Section title="Review" open>
            <Review detail={detail} onSaved={() => { load(); onChanged(); }} />
          </Section>

          <Section title="Plan" count={detail.lint.length}>
            <h3 className="ex-sub">Lint violations</h3>
            {detail.lint.length === 0 ? (
              <p className="rh-muted">None.</p>
            ) : (
              <ul className="ex-lint">
                {detail.lint.map((v) => (
                  <li key={v.id} className={`ex-lint__item ex-lint__item--${v.severity}`}>
                    <strong>{v.rule}</strong>
                    {v.frame != null && <span> · frame {v.frame}</span>}
                    <span className="rh-muted"> · {v.source}</span>
                    <div>{v.detail}</div>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="ex-sub">Storyboard</h3>
            <Text value={latest('storyboard')?.content} />
            <h3 className="ex-sub">Script</h3>
            <Text value={latest('script')?.content} />
          </Section>

          <Section title="Inputs">
            <h3 className="ex-sub">Topic</h3>
            <p>{detail.topic?.title}</p>
            <p className="ex-scope">{detail.topic?.scope}</p>
            <h3 className="ex-sub">Source</h3>
            <Text value={latest('source')?.content ?? (detail.topic?.source_url ? `URL: ${detail.topic.source_url}` : null)} />
            <h3 className="ex-sub">BRIEF.md</h3>
            <Text value={latest('brief')?.content} />
          </Section>

          <Section title="Run">
            <p className="ex-scope">
              {detail.job.trigger} · {detail.job.mode} · orchestrator {detail.job.orchestrator_model} · frame workers{' '}
              {detail.job.frame_worker_model}
            </p>
            <div className="ex-table-wrap">
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Component</th>
                    <th className="ex-num">Tokens in / out</th>
                    <th className="ex-num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.costs.map((c, i) => (
                    <tr key={i}>
                      <td>{c.vendor}</td>
                      <td>{c.component}</td>
                      <td className="ex-num">{c.input_tokens.toLocaleString()} / {c.output_tokens.toLocaleString()}</td>
                      <td className="ex-num">{c.usd_known ? usd(c.usd) : <span className="ex-unknown">unknown</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="ex-sub">Lint report</h3>
            <Text value={artifact('lint_report').map((a) => a.content).join('\n\n')} />
            <h3 className="ex-sub">Audio meta</h3>
            <Text value={latest('audio_meta')?.content} />
          </Section>
        </div>
      )}
    </Drawer>
  );
}

export function ReelsView({ jobs }: { jobs: JobSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const live = jobs.some((j) => j.status === 'running' || j.status === 'requested');

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [live, router]);

  if (jobs.length === 0) return <p className="rh-empty">No renders yet. Click Generate on a pool topic.</p>;
  return (
    <>
      <div className="ex-table-wrap">
        <table className="ex-table ex-table--clickable">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Status</th>
              <th>Stage</th>
              <th className="ex-num">Spend / cap</th>
              <th>By vendor</th>
              <th className="ex-num">Lint</th>
              <th>Review</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} onClick={() => setOpen(job.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(job.id)}>
                <td>
                  <div className="ex-title">{job.topic_title}</div>
                  <div className="ex-scope">{job.trigger} · {job.mode} · {job.orchestrator_model}</div>
                  {job.error && <div className="ex-scope ex-note--bad">{job.error}</div>}
                </td>
                <td>
                  <span className={`ex-status ex-status--${job.status}`}>{job.status}</span>
                  {job.capped && <div className="ex-scope ex-note--bad">spend cap</div>}
                </td>
                <td>{job.stage ?? '—'}</td>
                <td className="ex-num">{usd(job.spend_usd)} / {usd(job.spend_cap_usd)}</td>
                <td><Costs job={job} /></td>
                <td className="ex-num">{job.lint_count}</td>
                <td>
                  {job.verdict ? (
                    <span className={`ex-status ex-status--${job.verdict}`}>{job.verdict}</span>
                  ) : (
                    <span className="rh-muted">not reviewed</span>
                  )}
                </td>
                <td>{when.format(new Date(job.requested_at))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ReelDrawer jobId={open} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
