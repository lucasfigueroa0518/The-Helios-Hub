/**
 * Run the S4 queue cutover once against the live database.
 *
 *   npx tsx scripts/smartlead/migrate-queue.ts
 *
 * Prints the report and stores it in org_settings.smartlead.cutover_report.
 * Safe to re-run.
 */
import { migrateQueueToHandoff } from '@/lib/smartlead/migrate-queue';

async function main() {
  const report = await migrateQueueToHandoff();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
