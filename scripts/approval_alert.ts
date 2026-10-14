/**
 * The 8 AM approval-deadline alert (reliability plan #3): everything made but
 * not approved, each with the time it must be approved by and what happens
 * if it isn't. Read only: no model calls, nothing posted or changed.
 *
 *   npx tsx scripts/approval_alert.ts
 *
 * Exit code 0 when nothing is waiting, 2 when something is, so a timer or
 * cron can decide whether to send it. Delivery (email, Slack, push) is not
 * wired yet: it prints the alert.
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
  const { approvalAlertLines, approvalsDue, waitingForApproval } = await import('@/lib/social-hub/health/approvals');
  const { nyDateOf } = await import('@/lib/social-hub/time');
  const { VERTICALS } = await import('@/lib/social-hub/verticals');

  const now = new Date();
  const today = nyDateOf(now)!;
  const data = await loadDataset();
  const o = offerer(data, now);
  const waiting = waitingForApproval(data.posts, (p) => o.offer(p).state.tone === 'needs', today);
  const lines = approvalAlertLines(approvalsDue(waiting, today, now), (v) => VERTICALS.find((x) => x.id === v)?.label ?? v);
  if (data.errors.length) lines.push(`(the hub could not read: ${data.errors.map((e: { vertical: string }) => e.vertical).join(', ')}, so this list may be short)`);
  console.log(lines.length ? lines.join('\n') : 'Nothing is waiting for approval.');
  await closeDbPool();
  return waiting.length ? 2 : 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
