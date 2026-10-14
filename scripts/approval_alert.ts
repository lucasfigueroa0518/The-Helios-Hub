/**
 * The approval-deadline check (reliability plan #3): today's lineup waiting
 * on an approval, each with the time it must be approved by and what happens
 * if it isn't. The same count as the Today header in the hub. Read only: no
 * model calls, nothing posted or changed.
 *
 *   npx tsx scripts/approval_alert.ts
 *
 * Exit code 0 when nothing is waiting, 2 when something is. The hub shows
 * the same deadlines on the Today page (Tommy, 2026-10-14: in the hub only).
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

async function main(): Promise<number> {
  const { closeDbPool } = await import('@/lib/db');
  const { loadDataset } = await import('@/lib/social-hub/load');
  const { offerer } = await import('@/lib/social-hub/views/offer');
  const { approvalAlertLines } = await import('@/lib/social-hub/health/approvals');
  const { allQuotaCandidates } = await import('@/lib/social-hub/views/day-rank');
  const { VERTICALS } = await import('@/lib/social-hub/verticals');

  const now = new Date();
  const data = await loadDataset();
  const o = offerer(data, now);
  // Today's lineup only, the Today header's rule (components/social-hub/content/ContentScreen.tsx).
  const waiting = allQuotaCandidates(data, now).flatMap((c) => (c.post && o.offer(c.post).state.id === 'needs_you' ? [c.post] : []));
  const lines = approvalAlertLines(waiting, now, (v) => VERTICALS.find((x) => x.id === v)?.label ?? v);
  if (data.errors.length) lines.push(`(the hub could not read: ${data.errors.map((e: { vertical: string }) => e.vertical).join(', ')}, so this list may be short)`);
  console.log(lines.length ? lines.join('\n') : 'Nothing is waiting for approval.');
  await closeDbPool();
  return waiting.length ? 2 : 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
