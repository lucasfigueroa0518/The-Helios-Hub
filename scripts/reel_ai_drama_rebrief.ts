/**
 * MD-107: give pitches written before iteration 5 their prose `brief` (one Sonnet 5.5 call each, the producer
 * prompt as the cached system prefix, no web search). Prints the pitches it matched and the estimate; runs
 * only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_rebrief.ts <pitch-id-prefix>...          # estimate only
 *   npx tsx scripts/reel_ai_drama_rebrief.ts <pitch-id-prefix>... --yes    # write the briefs
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/** jsonb may come back as an object or (double-encoded) as a string. */
const parse = (v: unknown): unknown => {
  let x = v;
  while (typeof x === 'string') x = JSON.parse(x);
  return x;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const prefixes = args.filter((a) => !a.startsWith('--'));
  if (!prefixes.length || prefixes.some((p) => !/^[0-9a-f-]{4,36}$/i.test(p))) {
    throw new Error('Usage: npx tsx scripts/reel_ai_drama_rebrief.ts <pitch-id-prefix>... [--yes]  (prefixes of at least 4 hex characters)');
  }
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadPrompt } = await import('@/lib/reel-ai-drama/prompts');
  const { pitchBrief } = await import('@/lib/reel-ai-drama/types');
  const { estimateRebrief, REBRIEF_MODEL, rebriefPitch, saveBrief } = await import('@/lib/reel-ai-drama/development/rebrief');
  type Row = import('@/lib/reel-ai-drama/development/rebrief').RebriefRow;

  const db = await explainersDb();
  const rows: Row[] = [];
  for (const prefix of prefixes) {
    const { rows: hits } = await db.query<{ id: string; title: string; pitch: unknown }>(
      `SELECT id::text AS id, title, pitch FROM reel_ai_drama.pitches WHERE id::text LIKE $1 || '%' ORDER BY created_at`,
      [prefix.toLowerCase()],
    );
    if (hits.length !== 1) throw new Error(`prefix ${prefix} matches ${hits.length} pitches; give a longer prefix`);
    rows.push({ id: hits[0]!.id, title: hits[0]!.title, pitch: parse(hits[0]!.pitch) as Row['pitch'] });
  }

  const producerPrompt = loadPrompt('producer');
  console.log(`Estimate: ${rows.length} pitch(es) × 1 ${REBRIEF_MODEL} call (no web search) ≈ $${estimateRebrief(rows, producerPrompt.length).toFixed(4)} at most.`);
  for (const r of rows) console.log(`  ${r.id.slice(0, 8)}  ${r.title}${r.pitch.brief ? '  (has a brief: it will be replaced)' : ''}`);
  if (!yes) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { liveSend } = await import('@/lib/reel-ai-drama/writing/llm');
  const create = liveSend(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), { label: 'rebrief' });
  let total = 0;
  // One at a time: the first call writes the cached system prefix, the rest read it.
  for (const r of rows) {
    const { brief, usd } = await rebriefPitch({ create, db, producerPrompt }, r);
    await saveBrief(db, r, brief);
    total += usd;
    console.log(`\n${r.id.slice(0, 8)}  ${r.title}  ($${usd.toFixed(4)})\n  before: ${pitchBrief({ ...r.pitch, brief: '' }).slice(0, 160)}…\n  brief:  ${brief}`);
  }
  console.log(`\nDone: ${rows.length} brief(s), $${total.toFixed(4)}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
