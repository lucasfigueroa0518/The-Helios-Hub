/**
 * Bald-Eagle 2026-11-12: run the new readers against live data inside ONE read-only transaction (BEGIN READ ONLY …
 * ROLLBACK; never a session SET, CLAUDE.md). No model, search or Jev calls. Prints what tonight's code would see.
 *   npx tsx scripts/bald_eagle_live_readcheck.ts [YYYY-MM-DD]
 */
import './stories_env';
import { Client } from 'pg';
import { pendingHold } from '@/lib/photos/pending';
import { readUsedLedger, readPublishedLedger } from '@/lib/photos/used';
import { readWhatWeSaid } from '@/lib/stories/md-development';
import { outletCounts } from '@/lib/intake/outlets';
import { fillDates, leadDaysFor, LEAD_DAYS } from '@/lib/social-hub/lead';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';

async function main() {
  const now = new Date();
  const runDay = process.argv[2] ?? calendarDateKey(now, SOCIAL_TIMEZONE);
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  try {
    const q = { query: <T,>(text: string, params?: unknown[]) => c.query(text, params) as unknown as Promise<{ rows: T[] }> };
    const fq = (text: string, params?: unknown[]) => c.query(text, params);

    console.log(`Run day ${runDay}`);
    console.log('\n== Lead days and dates each night fills');
    for (const k of Object.keys(LEAD_DAYS)) {
      const [v, s] = k.split(':') as [never, never];
      const lead = leadDaysFor(v, s ?? null);
      console.log(`  ${k.padEnd(28)} lead ${lead}  fills ${fillDates(runDay, lead).join(', ')}`);
    }

    console.log('\n== Photo hold');
    const hold = await pendingHold(fq, now);
    const published = await readPublishedLedger(fq, now);
    const all = await readUsedLedger(fq, now);
    const byOwner = new Map<string, number>();
    for (const owners of hold.owners.values()) for (const o of owners) byOwner.set(o.vertical, (byOwner.get(o.vertical) ?? 0) + 1);
    console.log(`  held by waiting items: ${hold.urls.size} photo(s) ${JSON.stringify(Object.fromEntries(byOwner))}`);
    console.log(`  published last 20 days: ${published.urls.size}; combined ledger: ${all.urls.size}`);

    console.log('\n== Morning Download: what we said');
    const { rows: fresh } = await c.query<{ id: string; headline: string }>(
      `SELECT id::text AS id, headline FROM intake.stories WHERE merged_into IS NULL AND last_joined_at > now() - interval '24 hours' ORDER BY (SELECT count(*) FROM intake.items i WHERE i.story_id = intake.stories.id) DESC LIMIT 15`,
    ).catch(async (e) => {
      console.log(`  (fresh stories read failed: ${e.message})`);
      return { rows: [] as Array<{ id: string; headline: string }> };
    });
    const said = await readWhatWeSaid(q, now, runDay, { storyIds: fresh.map((r) => r.id) });
    console.log(`  rows: ${said.length}; with headline ${said.filter((s) => s.headline).length}; with story id ${said.filter((s) => s.storyId).length}`);
    for (const s of said.slice(0, 5)) console.log(`   - ${s.postedAt.toISOString().slice(0, 10)} ${s.headline?.slice(0, 70) ?? '(no headline: stays blocked)'}`);

    console.log('\n== Outlet signal on the freshest intake stories (last 24 h)');
    const counts = await outletCounts(q, new Map(fresh.map((r) => [r.id, [r.id]])), new Date(now.getTime() - 24 * 3600e3));
    for (const r of fresh.slice(0, 10)) {
      const sig = counts.get(r.id);
      console.log(`   ${String(sig ? JSON.stringify(sig).slice(0, 80) : '-').padEnd(82)} ${r.headline?.slice(0, 50)}`);
    }
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
