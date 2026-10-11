/**
 * Overnight check: is the Social Hub ready to post, and did the night work?
 * Read only: it reads settings, runs, the schedule and the hub's own view of
 * each post. It writes nothing, calls no model and posts nothing.
 *
 *   npx tsx scripts/overnight_check.ts
 *
 * Run it the night before (are the switches right? is anything approved and
 * scheduled for tomorrow?) and at about 7:30 AM (did the 1/2/3/4 AM runs
 * work? what still needs an approval before the 8:30 AM windows?).
 * Each line starts with ✔ (fine), ⚠ (look at this) or ✖ (this will stop a post).
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const TYPES = ['reels', 'carousels', 'explainers', 'stories'] as const;
const LABEL: Record<(typeof TYPES)[number], string> = { reels: 'Text on Screen', carousels: 'Carousels', explainers: 'Explainers', stories: 'Stories' };
/** When each type's windows open (New York), from docs/social-overnight.md. */
const FIRST_WINDOW: Record<(typeof TYPES)[number], string> = { reels: '8:45 AM', carousels: '9:00 AM', explainers: '1:00 PM', stories: '8:30 AM' };

const ok = (s: string) => console.log(`  ✔ ${s}`);
const warn = (s: string) => console.log(`  ⚠ ${s}`);
const bad = (s: string) => console.log(`  ✖ ${s}`);
const ny = (d: Date | string | null) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '—');
const ago = (d: Date | string | null) => {
  if (!d) return 'never';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return mins < 90 ? `${mins} min ago` : mins < 36 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
};

async function main() {
  const { dbQuery, closeDbPool } = await import('@/lib/db');
  const { readPosting } = await import('@/lib/content-type/posting');
  const { loadDataset } = await import('@/lib/social-hub/load');
  const { offerer } = await import('@/lib/social-hub/views/offer');
  const rows = async (sql: string) => {
    try {
      return (await dbQuery(sql)).rows as Array<Record<string, any>>;
    } catch (e) {
      bad(`read failed: ${(e as Error).message.slice(0, 100)}`);
      return [];
    }
  };

  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(now.getTime() + 86_400_000));
  console.log(`\nOvernight check · ${ny(now)} New York · today ${today}\n`);

  // ── Workers ────────────────────────────────────────────────────────────────
  console.log('Workers');
  const settings = await rows(`SELECT key, value FROM social_hub.settings`);
  const beat = settings.find((s) => s.key === 'publisher_heartbeat')?.value as { at?: string; verticals?: string[] } | undefined;
  const mode = settings.find((s) => s.key === 'publisher_mode')?.value;
  if (!beat?.at) bad('no publisher heartbeat: the worker VM may be down');
  else if (Date.now() - Date.parse(beat.at) > 5 * 60_000) bad(`publisher heartbeat is ${ago(beat.at)}: the worker VM looks stopped`);
  else ok(`publisher alive (heartbeat ${ago(beat.at)}; covers ${(beat.verticals ?? []).join(', ')})`);
  ok(`publisher_mode is "${mode}" (each type's own worker posts while it is not "live")`);

  // ── Switches ───────────────────────────────────────────────────────────────
  console.log('\nSwitches (what a person can change in each page\'s Settings)');
  for (const t of TYPES) {
    const p = await readPosting(t);
    const parts = `Live ${p.live ? 'on' : 'OFF'} · Generate ${p.generate === null ? 'per series' : p.generate ? 'on' : 'OFF'} · Auto-publish ${p.autoPublish ? 'ON' : 'off (needs your approval)'}${p.perDay != null ? ` · ${p.perDay}/day` : ''}`;
    console.log(`  ${LABEL[t]}: ${parts}`);
    if (!p.live) bad(`${LABEL[t]}: Live is off, so nothing is scheduled or posted automatically`);
    if (p.generate === false) warn(`${LABEL[t]}: Generate every morning is off, so no overnight run will make content`);
    if (t === 'stories' && p.series) for (const s of p.series) if (!s.generate) warn(`Stories: ${s.label} will not be made automatically`);
    if (p.autoPublish) warn(`${LABEL[t]}: Auto-publish is ON: what is made posts without review`);
  }

  // ── Last runs ──────────────────────────────────────────────────────────────
  console.log('\nLast runs (did the night work?)');
  const reelsRun = (await rows(`SELECT status, trigger, requested_at, finished_at FROM reels.runs ORDER BY requested_at DESC LIMIT 1`))[0];
  const carRun = (await rows(`SELECT status, trigger, requested_at, finished_at, total_usd, coalesce(stop_reason, left(coalesce(error,''),80)) AS note FROM social.runs WHERE kind = 'daily' ORDER BY requested_at DESC LIMIT 1`))[0];
  const exJob = (await rows(`SELECT status, trigger, requested_at, finished_at, stage FROM explainers.jobs ORDER BY requested_at DESC LIMIT 1`))[0];
  const stSet = (await rows(`SELECT series, status, trigger, created_at, left(coalesce(error,''),80) AS error FROM stories.sets WHERE trigger = 'auto' ORDER BY created_at DESC LIMIT 1`))[0];
  const line = (label: string, r: Record<string, any> | undefined, when: string, detail: string) => {
    if (!r) return warn(`${label}: no runs recorded`);
    const failing = ['failed'].includes(String(r.status));
    (failing ? bad : ok)(`${label}: ${r.status} (${r.trigger}) ${ago(r[when])}${detail}`);
  };
  line('Text on Screen night run', reelsRun, 'requested_at', '');
  line('Carousel run', carRun, 'requested_at', carRun ? ` · $${Number(carRun.total_usd ?? 0).toFixed(2)}${carRun.note ? ` · ${carRun.note}` : ''}` : '');
  line('Latest explainer render', exJob, 'requested_at', exJob?.stage ? ` · ${exJob.stage}` : '');
  line('Latest auto Story set', stSet, 'created_at', stSet ? ` · ${stSet.series}${stSet.error ? ` · ${stSet.error}` : ''}` : '');

  // ── What is waiting, what is scheduled ─────────────────────────────────────
  console.log('\nWhat is made and what will go out');
  const data = await loadDataset();
  if (data.errors.length) bad(`the hub could not read: ${data.errors.map((e: { vertical: string; message: string }) => `${e.vertical} (${e.message.slice(0, 60)})`).join('; ')}`);
  const o = offerer(data, now);
  for (const t of TYPES) {
    const mine = data.posts.filter((p) => p.vertical === t);
    const waiting = mine.filter((p) => (p.status === 'ready' || (p.status === 'scheduled' && !p.approval.approvedAt)) && o.offer(p).state.tone === 'needs');
    const goingOut = mine.filter((p) => p.status === 'scheduled' && (p.nyDate === today || p.nyDate === tomorrow));
    const approvedOut = goingOut.filter((p) => p.approval.approvedAt || !p.approval.required);
    console.log(`  ${LABEL[t]}: ${approvedOut.length} approved and scheduled · ${waiting.length} waiting on you · first window ${FIRST_WINDOW[t]}`);
    for (const p of approvedOut) ok(`${ny(p.publishAt)}  ${p.name.slice(0, 70)}`);
    for (const p of goingOut.filter((x) => !approvedOut.includes(x))) bad(`${ny(p.publishAt)}  NOT approved, will be cancelled at its slot: ${p.name.slice(0, 55)}`);
    for (const p of waiting.slice(0, 3)) warn(`needs approval: ${p.name.slice(0, 70)}`);
    if (waiting.length > 3) warn(`…and ${waiting.length - 3} more waiting`);
    if (approvedOut.length === 0 && waiting.length === 0) warn(`${LABEL[t]}: nothing made or scheduled for ${today === tomorrow ? 'today' : 'today or tomorrow'}`);
  }

  console.log('\nRead the ✖ lines first: each one is something that will stop a post. Approve what is waiting on each type page (Approve, then Schedule… if it needs a window), or press Publish now.\n');
  await closeDbPool();
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
