// Read-only: today's slots vs. the cards each view shows (plan Step 2). Not committed.
import { loadDataset } from '@/lib/social-hub/load';
import { quotaCandidates, DAY_TYPES } from '@/lib/social-hub/views/day-rank';
import { typeHubModel } from '@/lib/content-type/model';
import { capacityWindows, windowsOn, placedCount } from '@/lib/social-hub/views/plan';
import { nyDateOf } from '@/lib/social-hub/time';

async function main() {
const now = new Date(process.argv[2] ?? Date.now());
const d = await loadDataset();
const today = nyDateOf(now)!;
console.log('today', today, 'errors', d.errors.map((e) => e.vertical), 'slots for today?', Boolean(d.dayQuotas?.slots?.[today]));
for (const v of [...DAY_TYPES, 'ai_events' as const]) {
  const slots = windowsOn(v, today, [], d.dayQuotas?.slots ?? null);
  const held = placedCount(d.posts, v, today);
  const cap = capacityWindows(v, today, d.dayQuotas?.lfdDays ?? [], held, today, d.dayQuotas?.slots ?? null);
  const c = quotaCandidates(d, v, now);
  const m = typeHubModel(d, v, now);
  const todayDay = m.days.find((x) => x.date === today);
  console.log(`\n== ${v}: calendar slots ${slots.length} (${slots.map((w) => `${w.startMinute}${(w as any).feedMode ? '/' + (w as any).feedMode : ''}`).join(',')}), held ${held}, counted windows ${cap.length}, quota ${d.dayQuotas?.[v as keyof typeof d.dayQuotas] ?? '-'}`);
  console.log(`  main page cards: ${c.length}`);
  for (const x of c) console.log(`    ${x.locked ? 'BOOKED' : x.post ? 'made' : x.idea ? 'not made' : 'empty'} | ${x.post?.status ?? ''} ${x.post?.publishAt ?? ''} | ${(x.idea?.title ?? x.post?.title ?? '').slice(0, 60)} | slot_by=${(x.post as any)?.slotBy ?? ''}`);
  console.log(`  type page today: ${todayDay?.cards.length ?? 0} post cards + ${m.slots.filter((s) => !s.card && s.idea).length} open slots`);
  const todays = d.posts.filter((p) => p.vertical === v && p.nyDate === today);
  for (const p of todays) console.log(`    post ${p.id.slice(0, 8)} ${p.status} publishAt=${p.publishAt ?? ''} slotBy=${(p as any).slotBy ?? ''} ${(p.title ?? '').slice(0, 50)}`);
}
}
main().then(() => process.exit(0));
