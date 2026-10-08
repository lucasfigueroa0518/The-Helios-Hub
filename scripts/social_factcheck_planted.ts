/**
 * Helios Social — LIVE Fact-checker planted-error test (Tommy's OK, cap
 * required). Takes the final NYC post, plants one error per always-flag
 * type plus two harmless style edits, runs the Claude Fact-checker once,
 * and writes what it flagged and what code applied.
 *
 *   npx tsx scripts/social_factcheck_planted.ts --cap-usd 0.10
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

type Plant = { id: string; kind: string; slide: number | null; field: 'headline' | 'body'; from: string; to: string; shouldFlag: boolean };

export const PLANTS: Plant[] = [
  { id: 'E1', kind: 'type 1: hedge made certain', slide: 8, field: 'body',
    from: 'The Council is weighing a ban on selling or deploying AI in the five boroughs without outside-expert vetting, and a kill switch requirement, a human override that can shut down the system. Proposals only, not enacted.',
    to: 'The Council has passed a ban on selling or deploying AI in the five boroughs without outside-expert vetting, and a kill switch requirement, a human override that can shut down the system.', shouldFlag: true },
  { id: 'E2', kind: 'type 2: wrong number', slide: 5, field: 'body', from: 'all 51 Council members', to: 'all 41 Council members', shouldFlag: true },
  { id: 'E3', kind: 'type 3: quote altered', slide: 6, field: 'body', from: "called the industry's approach extremely reckless", to: 'called the industry\'s approach "criminally reckless"', shouldFlag: true },
  { id: 'E4', kind: 'type 4: cause/effect not claimed', slide: 5, field: 'body', from: 'approach, after President Trump signed', to: 'approach, because President Trump signed', shouldFlag: true },
  { id: 'E5', kind: 'type 5: invented detail', slide: 4, field: 'body', from: 'Google: Alice Friend.', to: 'Google: Alice Friend, who testified by video link from London.', shouldFlag: true },
  { id: 'S1', kind: 'style: punchier true headline', slide: 2, field: 'headline', from: "Musk's SpaceXAI did not show up", to: 'SpaceXAI was a no-show', shouldFlag: false },
  { id: 'S2', kind: 'style: different-but-true wording', slide: 7, field: 'body',
    from: 'Asked by Menin how to balance frontier model development against the race with China, former Google DeepMind researcher Alex Turner warned about misaligned AI, whose goals diverge from human intentions.',
    to: 'Menin asked how to balance frontier model development against the race with China. Former Google DeepMind researcher Alex Turner answered with a warning about misaligned AI, whose goals diverge from human intentions.', shouldFlag: false },
];

async function main() {
  const at = process.argv.indexOf('--cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--cap-usd is required');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { runFactCheck } = await import('@/lib/social/factcheck/factcheck');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');

  const run = JSON.parse(await fsp.readFile('runs/edit-check-2026-10-05T19-04-11-577Z/nyc.json', 'utf8'));
  const brief = validateBrief(JSON.parse(await fsp.readFile(run.brief, 'utf8')));
  const planted = structuredClone(run.attempts[0].check.outcome.draft);
  for (const p of PLANTS) {
    const s = planted.slides[p.slide! - 2];
    const line = p.field === 'headline' ? s.headline : s.body;
    if (!line.text.includes(p.from)) throw new Error(`${p.id}: "${p.from}" not found on slide ${p.slide}`);
    line.text = line.text.replace(p.from, p.to);
  }

  const live = liveMessagesCreate(new Anthropic());
  let spent = 0;
  const create: typeof live = async (params) => {
    if (spent + 0.05 > cap) throw new Error(`cap: $${spent.toFixed(4)} spent`);
    const res = await live(params);
    spent += Number(priceAnthropicMessages([res as any], { modelId: (params as any).model }).costUsd);
    return res;
  };
  const r = await runFactCheck(brief, { submission: planted, filled: fillDraft(planted, brief) }, { create });
  const dir = path.join(process.cwd(), 'runs', `factcheck-planted-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'result.json'), JSON.stringify({ plants: PLANTS, planted, result: r, spentUsd: spent }, null, 2));
  console.log(JSON.stringify({ dir: path.relative(process.cwd(), dir), spentUsd: Number(spent.toFixed(4)), ok: r.ok, retries: r.retries, retryErrors: r.retryErrors }, null, 2));
}
if (process.argv[1]?.endsWith('social_factcheck_planted.ts')) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
}
