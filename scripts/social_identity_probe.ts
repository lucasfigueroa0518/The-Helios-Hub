/**
 * Helios Social — LIVE identity-check probe: rerun the subject identity
 * check (Wikidata + Jev) on named subjects of a saved brief and print
 * Jev's raw scores. Report only; changes nothing. --jev-cap-usd required.
 *
 *   npx tsx scripts/social_identity_probe.ts --jev-cap-usd 0.001 <brief.json> "Name" "Name" …
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const at = process.argv.indexOf('--jev-cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const rest = process.argv.slice(2).filter((_, i, a) => a[i] !== '--jev-cap-usd' && a[i - 1] !== '--jev-cap-usd');
  const [briefFile, ...names] = rest;
  if (!Number.isFinite(cap) || cap <= 0 || !briefFile || names.length === 0) throw new Error('usage: --jev-cap-usd <amount> <brief.json> "Name" …');

  const { createJevAsk, createJevTally, capped, tallied } = await import('@/lib/social/jev/client');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { checkIdentity } = await import('@/lib/social/photos/identity');
  const { THRESHOLDS } = await import('@/lib/social/jev/questions/subject-identity.v1');

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, cap);
  const brief = validateBrief(JSON.parse(await fsp.readFile(briefFile, 'utf8')));
  const out = [];
  for (const name of names) {
    const subject = brief.subjects.find((s) => s.name === name) ?? { name, role: null };
    const r = await checkIdentity(subject, brief, { jev });
    out.push({ subject, result: r });
    console.log(`\n${name} — brief role: ${subject.role ?? '(none)'}`);
    console.log(`  result: ${r.ok ? `ok ${r.qid}` : `FAILED — ${r.reason}`}`);
    if (r.scores) {
      console.log(`  is_person: ${r.scores.person.toFixed(3)} (threshold ${THRESHOLDS.PERSON_MIN})`);
      for (const m of r.scores.matches) console.log(`  match ${m.p.toFixed(3)} (threshold ${THRESHOLDS.MATCH_MIN}) · ${m.id} "${m.label}" — ${m.description}`);
    }
  }
  const file = path.join(process.cwd(), 'runs', `identity-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(file, JSON.stringify(out, null, 2));
  console.log(`\nJev: ${tally.calls} calls, $${tally.costUsd.toFixed(5)}. Log: ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
