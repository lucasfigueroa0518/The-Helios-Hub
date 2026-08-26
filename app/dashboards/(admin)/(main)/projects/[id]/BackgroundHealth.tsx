type Tone = 'ok' | 'wait' | 'error' | 'paused' | 'run';

const TONE: Record<Tone, { dot: string; wrap: string; label: string }> = {
  ok: { dot: 'bg-[#138510]', wrap: 'text-[#138510]', label: 'Healthy' },
  wait: { dot: 'bg-fg-muted', wrap: 'text-fg-3', label: 'Waiting' },
  error: { dot: 'bg-red-500', wrap: 'text-red-700', label: 'Needs attention' },
  paused: { dot: 'bg-amber-500', wrap: 'text-amber-700', label: 'Paused' },
  run: { dot: 'bg-[#138510]', wrap: 'text-[#138510]', label: 'Running' },
};

function StatusRow({
  title,
  tone,
  detail,
}: {
  title: string;
  tone: Tone;
  detail: string;
}) {
  const t = TONE[tone];
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg-1">{title}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{detail}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${t.wrap}`}>
          {tone === 'run' ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#138510] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#138510]" />
            </span>
          ) : (
            <span className={`h-2 w-2 rounded-full ${t.dot}`} />
          )}
          {t.label}
        </span>
      </div>
    </div>
  );
}

function formatUtc(date: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export default function BackgroundHealth({
  githubRepo,
  githubLastSyncAt,
  lastSyncError,
  cronEnabled,
  cronStatus,
  lastUpdateAt,
}: {
  githubRepo: string;
  githubLastSyncAt: Date | null;
  lastSyncError: string | null;
  cronEnabled: boolean;
  cronStatus: string;
  lastUpdateAt: Date | null;
}) {
  const running = cronStatus === 'RUNNING';

  let syncTone: Tone = 'wait';
  let syncDetail: string;
  if (!githubRepo) {
    syncTone = 'wait';
    syncDetail =
      'No GitHub repo linked. The daily cloud worker has nothing to sync until one is added.';
  } else if (lastSyncError) {
    syncTone = 'error';
    syncDetail = lastSyncError;
  } else if (running) {
    syncTone = 'run';
    syncDetail = 'The cloud worker is syncing this repo now.';
  } else if (githubLastSyncAt) {
    syncTone = 'ok';
    syncDetail = `Last synced ${formatUtc(githubLastSyncAt)}. Next daily pass after 09:00 UTC.`;
  } else {
    syncTone = 'wait';
    syncDetail =
      'Not synced yet. The cloud worker runs a daily pass after 09:00 UTC, and also picks up a new project shortly after it is created.';
  }

  let aiTone: Tone = 'wait';
  let aiDetail: string;
  if (!cronEnabled) {
    aiTone = 'paused';
    aiDetail = 'Automatic summaries are paused. The worker still syncs GitHub, but will not write a client-facing update.';
  } else if (running) {
    aiTone = 'run';
    aiDetail = 'The cloud worker is generating a client-facing summary now.';
  } else if (lastUpdateAt) {
    aiTone = 'ok';
    aiDetail = `Last summary ${formatUtc(lastUpdateAt)}. A new one is written when the daily pass finds fresh activity (at most every 47 hours).`;
  } else {
    aiTone = 'wait';
    aiDetail =
      'No summary yet. The first one appears after the worker finds GitHub activity for this project.';
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">
        GitHub sync and AI summaries run on the always-on cloud worker. They are not triggered from this page.
      </p>
      <StatusRow title="GitHub sync" tone={syncTone} detail={syncDetail} />
      <StatusRow title="AI context update" tone={aiTone} detail={aiDetail} />
    </div>
  );
}
