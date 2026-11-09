/**
 * The one-time identity check of the banked cutouts (MD-81). One vision call per person (Haiku 5.5,
 * cached instructions) compares each approved cutout in `explainers/real-case/bank/cutouts.json` with a
 * verified Wikidata/Commons portrait of them. Verdicts go to `explainers/reel-ai-drama/kit/bank-verdicts.json`;
 * the harvest then skips any cutout judged "different" (not the same person). Prints the estimate first;
 * calls the model only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_check_bank.ts          # estimate only
 *   npx tsx scripts/reel_ai_drama_check_bank.ts --yes    # run it
 *   npx tsx scripts/reel_ai_drama_check_bank.ts --yes --only=dario-amodei,sam-altman
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main(): Promise<void> {
  const { loadCutouts } = await import('@/lib/real-case/bank');
  const { BANK_CHECK_MODEL, estimateBankCheck, runBankCheck } = await import('@/lib/reel-ai-drama/harvest/bank-check');
  const { BANK_VERDICTS_FILE, loadBankVerdicts } = await import('@/lib/reel-ai-drama/harvest/bank-verdicts');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const cutouts = loadCutouts().filter((c) => c.approved && (!only?.length || only.includes(c.id)));
  console.log(
    `Estimate: ${cutouts.length} banked cutout(s) × 1 ${BANK_CHECK_MODEL} vision call (2 pictures each, no web search) ≈ $${estimateBankCheck(cutouts.length).toFixed(3)}. ` +
      `Verdicts go to ${BANK_VERDICTS_FILE}.`,
  );
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }
  const { anthropic } = await import('@/lib/anthropic');
  const { anthropicCreate } = await import('@/lib/reel-ai-drama/development/producer');
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { recordCost } = await import('@/lib/reel-ai-drama/cost');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const result = await runBankCheck(
    {
      create: anthropicCreate(anthropic, 'bank_identity_check'),
      http: fetch,
      record: ({ usd, totals }) => recordCost(db, { mode: 'development', vendor: 'anthropic', component: 'bank_identity_check', ...totals, usd }),
    },
    cutouts,
    loadBankVerdicts(),
  );
  for (const v of result.verdicts.verdicts.filter((x) => cutouts.some((c) => c.id === x.id))) console.log(`${v.verdict.padEnd(9)} ${v.name}: ${v.reason}`);
  for (const e of result.errors) console.log(`error     ${e}`);
  console.log(`Spent $${result.usd.toFixed(4)}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
