/**
 * Smoke test for story-scoring@4 (2026-10-12): re-scores the stories a saved
 * daily run already scored (@3), under @4, and prints the two rankings side by
 * side. Also scores a few extra stories whose pages it fetches (free, no AI),
 * the classes of story Tommy wants at the top: a model launch, a chip, a
 * government arrangement.
 *
 *   npx tsx scripts/story_scoring_smoke.ts [--run <run id>] [--no-extra]
 *
 * Reads social.runs (SELECT only). Writes nothing and posts nothing. One Jev
 * call per story, about $0.0001 each, hard-capped at CAP_USD.
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const CAP_USD = 0.05;

type Extra = { label: string; headline: string; outlet: string; urls: string[]; standIn?: string };
/** Pages fetched for stories the saved run did not contain. Stand-ins are the closest real coverage found. */
const EXTRA: Extra[] = [
  {
    label: 'Haiku 5.5 launch',
    headline: 'Anthropic Launches Claude Haiku 5.5 at a Much Lower Price',
    outlet: 'trade press',
    urls: [
      'https://www.deccanchronicle.com/technology/anthropic-launches-third-claude-55-model-expanding-ai-lineup-before-planned-ipo-1994077',
      'https://pasqualepillitteri.it/en/news/21513/anthropic-launches-claude-haiku-5-5-pricing',
      'https://letsdatascience.com/news/anthropic-releases-claude-haiku-55-for-high-volume-tasks-1c6260b4',
      'https://trendingtopics.eu/claude-haiku-5-5-anthropic-price-cut',
      'https://forklog.com/en/?p=104941',
      'https://techstrong.ai/?p=71312',
      'https://letsdatascience.com/news/anthropic-releases-claude-haiku-55-with-lower-prices-and-eff-f698c663',
    ],
  },
  {
    label: 'Maia 300 chip',
    headline: 'Microsoft is ordering 300,000+ Maia 300 AI chips from TSMC as it races to reduce its dependence on Nvidia',
    outlet: 'The Next Web',
    urls: ['https://thenextweb.com/news/microsoft-maia-300-chip-tsmc-production-boost-nvidia'],
    standIn: 'the August chip-order story; the unveiling story itself was not found',
  },
  {
    label: 'UK safety-test access',
    headline: 'UK says it has pre-deployment access to nearly all frontier AI models for safety testing',
    outlet: 'trade press',
    urls: [
      'https://www.ctvnews.ca/sci-tech/article/britain-says-it-is-open-to-ai-regulation-if-voluntary-safeguards-fall-short/',
      'https://itpro.com/business/policy-and-legislation/reports-uk-could-consider-regulation-amidst-growing-rogue-ai-concerns',
      'https://techjacksolutions.com/ai-brief/uk-ai-regulation-signal-voluntary-safety-testing-2026/',
      'https://www.mlex.com/mlex/articles/2524257',
    ],
    standIn: 'the August UK testing-access story; the "given access" story itself was not found',
  },
];

const f = (x: number | undefined) => (x ?? 0).toFixed(2);

async function main() {
  const runArg = process.argv.indexOf('--run');
  const runId = runArg >= 0 ? process.argv[runArg + 1] : undefined;
  const withExtra = !process.argv.includes('--no-extra');

  const { dbQuery, closeDbPool } = await import('@/lib/db');
  const { createJevAsk, createJevTally, capped, tallied } = await import('@/lib/social/jev/client');
  const Scoring4 = await import('@/lib/social/jev/questions/story-scoring.v4');
  const { judge } = await import('@/lib/social/ingest/select/score');
  const { mapPool } = await import('@/lib/async-pool');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  type StoryGroup = import('@/lib/social/ingest/select/types').StoryGroup;

  const r = await dbQuery(
    runId
      ? `SELECT started_at, record->'selection' AS sel FROM social.runs WHERE id = $1`
      : `SELECT started_at, record->'selection' AS sel FROM social.runs WHERE kind = 'daily' AND jsonb_typeof(record->'selection'->'scored') = 'array' ORDER BY started_at DESC LIMIT 1`,
    runId ? [runId] : [],
  );
  if (!r.rows[0]) throw new Error('no saved run found');
  const saved: Array<Record<string, any>> = r.rows[0].sel.scored;
  console.log(`Saved run ${new Date(r.rows[0].started_at).toISOString()}: ${saved.length} stories scored under @3.`);

  const { contentFarmReason } = await import('@/lib/social/ingest/select/code-filters');
  const { outletKey } = await import('@/lib/social/ingest/select/outlets');
  const farmDropped: string[] = [];
  const isFarm = (m: { title: string; outlet: string; url: string }) => contentFarmReason({ headline: m.title, source: m.outlet, sourceUrl: m.url }) !== null;
  const asGroup = (g: Record<string, any>): StoryGroup | null => {
    // The content-farm filter removes farm articles before grouping; a story keeps its other members.
    const members = (g.members as Array<{ title: string; outlet: string; url: string }>).filter((m) => !isFarm(m));
    for (const m of (g.members as Array<{ title: string; outlet: string; url: string }>).filter(isFarm)) farmDropped.push(`${m.outlet}: ${m.title.slice(0, 60)}`);
    if (members.length === 0) return null;
    const outlets = [...new Map(members.map((m) => [outletKey(m.outlet), m.outlet])).values()];
    return {
      ...(g as StoryGroup),
      members: members as StoryGroup['members'],
      outlets,
      outletCount: outlets.length,
      publishedAt: new Date(g.publishedAt),
      representative: { ...g.representative, publishedAt: new Date(g.representative.publishedAt) },
    };
  };
  type Row = { key: string; label: string; headline: string; group: StoryGroup; v3?: { rank: number; score: number; status: string }; standIn?: string };
  const rows: Row[] = [];
  const v3Ranked = saved.filter((g) => g.status === 'qualified').sort((a, b) => b.probSum - a.probSum);
  let farmOnly = 0;
  for (const g of saved) {
    const rank = v3Ranked.findIndex((x) => x.id === g.id) + 1;
    const group = asGroup(g);
    if (!group) { farmOnly++; continue; }
    rows.push({ key: g.id, label: '', headline: group.representative.headline, group, v3: { rank, score: g.probSum, status: g.status } });
  }
  console.log(`Content-farm filter: ${farmDropped.length} articles removed (${farmOnly} stories had nothing else and are dropped):`);
  for (const d of farmDropped) console.log(`  - ${d}`);

  if (withExtra) {
    for (const e0 of EXTRA) {
      let e = e0;
      let text: string | null = null;
      let used = '';
      for (const u of e.urls) {
        const t = await fetchBodyLive(u).catch(() => null);
        if (t && t.length >= 1500) { text = t; used = u; break; }
      }
      if (!text) {
        console.log(`  extra "${e.label}": none of ${e.urls.length} pages readable; left out.`);
        continue;
      }
      e = { ...e, urls: [used] };
      const article = { headline: e.headline, sourceUrl: e.urls[0], body: text, publishedAt: new Date(), outlet: e.outlet } as unknown as StoryGroup['representative'];
      const group = {
        id: e.urls[0], members: [{ url: e.urls[0], outlet: e.outlet, title: e.headline, publishedAt: new Date(), feedSlug: 'smoke' }],
        outlets: [e.outlet], outletCount: 1, publishedAt: new Date(), representative: article, articles: [article], body: text, read: [], tried: [],
      } as StoryGroup;
      rows.push({ key: e.urls[0], label: e.label, headline: e.headline, group, standIn: e.standIn });
      console.log(`  extra "${e.label}": ${text.length} chars read from ${e.urls[0].slice(8, 40)}${e.standIn ? ` (stand-in: ${e.standIn})` : ''}`);
    }
  }

  const questions = Scoring4.buildQuestions([]);
  const estimate = rows.filter(() => true).reduce((s, x) => s + Math.ceil(JSON.stringify({ state: Scoring4.buildState(x.group, []), questions }).length / 4), 0);
  const estUsd = (estimate * 0.042) / 1_000_000;
  console.log(`\n${rows.length} Jev calls, ~${estimate.toLocaleString()} input tokens, estimated $${estUsd.toFixed(4)} (cap $${CAP_USD.toFixed(2)}).`);
  if (estUsd > CAP_USD) throw new Error('estimate is over the cap; stopping before any call');

  const { createHash } = await import('node:crypto');
  const { promises: fsp } = await import('node:fs');
  const cacheFile = path.join(process.env.SMOKE_CACHE_DIR ?? process.cwd(), '.smoke-cache-' + createHash('sha1').update(JSON.stringify(questions)).digest('hex').slice(0, 10) + '.json');
  const cache: Record<string, Record<string, number>> = await fsp.readFile(cacheFile, 'utf8').then((x) => JSON.parse(x)).catch(() => ({}));
  const tally = createJevTally();
  const jev = tallied(capped(createJevAsk(), tally, CAP_USD), tally);
  const scored = await mapPool(rows, 8, async (row) => {
    const ckey = `${row.key}|${row.group.outletCount}`;
    let answers = cache[ckey];
    if (!answers) {
      const res = await jev({ state: Scoring4.buildState(row.group, []), questions }, { version: Scoring4.VERSION, subjectId: row.key });
      answers = {};
      for (const [id, a] of Object.entries(res.answers)) answers[id] = a.noul ?? 0;
      cache[ckey] = answers;
    }
    const g = Scoring4.gate(answers);
    // The cutoff under test (default 0.45); gate() itself still holds 0.60 until one is chosen.
    const cut = Number(process.env.SMOKE_COMMENTARY ?? 0.45);
    const lateCommentary = g.status === 'qualified' && (answers.commentary ?? 0) >= cut;
    const status = lateCommentary ? 'not-qualified' : g.status;
    const reason = lateCommentary ? 'required: commentary' : g.reason ?? '';
    return { row, answers, status, reason, score: Scoring4.engagementScore(answers, row.group.outletCount) };
  });
  void judge;
  await fsp.writeFile(cacheFile, JSON.stringify(cache));

  const ranked = scored.filter((s) => s.status === 'qualified').sort((a, b) => b.score - a.score);
  console.log(`\nspent: ${tally.calls} calls, $${tally.costUsd.toFixed(4)}\n`);
  console.log(`@4 TOP 15 (${ranked.length} qualified of ${scored.length})`);
  console.log('rank  @4    @3 rank/score   axes (field industry policy | must common | src)   headline');
  for (const [i, s] of ranked.slice(0, 15).entries()) {
    const a = s.answers;
    const was = s.row.v3 ? `${s.row.v3.rank ? '#' + s.row.v3.rank : s.row.v3.status} ${f(s.row.v3.score)}` : 'new';
    console.log(`${String(i + 1).padStart(3)}   ${f(s.score)}  ${was.padEnd(14)}  ${f(a.field_shift)} ${f(a.industry_power)} ${f(a.national_policy)} | ${f(a.must_know)} ${f(a.common_person)} | ${f(a.sourcing)}   ${s.row.label ? `[${s.row.label}] ` : ''}${s.row.headline.slice(0, 78)}`);
  }

  console.log('\nWHERE THE EXTRA STORIES LANDED');
  for (const s of scored.filter((x) => x.row.label)) {
    const rank = ranked.findIndex((x) => x.row.key === s.row.key) + 1;
    console.log(`  ${s.row.label}: ${s.status}${s.reason ? ` (${s.reason})` : ''}, ${rank ? `rank ${rank} of ${ranked.length}` : 'not ranked'}, ${f(s.score)}${s.row.standIn ? `  [stand-in: ${s.row.standIn}]` : ''}`);
  }

  console.log('\nTHE @3 TOP 8, AND WHERE @4 PUT THEM');
  for (const g of v3Ranked.slice(0, 8)) {
    const s = scored.find((x) => x.row.key === g.id)!;
    const rank = ranked.findIndex((x) => x.row.key === g.id) + 1;
    console.log(`  @3 #${v3Ranked.indexOf(g) + 1} ${f(g.probSum)} -> @4 ${s.status === 'qualified' ? `#${rank} ${f(s.score)}` : `${s.status} (${s.reason})`}   ${g.representative.headline.slice(0, 70)}`);
  }

  const gate = scored.filter((s) => s.row.v3?.status === 'qualified' && s.status !== 'qualified');
  console.log(`\nQUALIFIED UNDER @3, NOT UNDER @4: ${gate.length}`);
  for (const s of gate.slice(0, 12)) console.log(`  ${s.status} (${s.reason})  news_event ${f(s.answers.news_event)}  ${s.row.headline.slice(0, 80)}`);
  console.log('\nTHE GATE ON THE STORIES WE KNOW (event = something happened; comm = commentary, rejected at 0.60)');
  const probe = /murder tip|Britain to strengthen|math model|Claude Next|Bill Gates to OpenAI|NDTV Exclusive|AI Regulation Must Balance|ChatGPT for Teens|Midterm|Dot Vs|Silicon Valley is falling|South Korea Job|Claude found 29,000|Anthropic just took steps|EU Tech Chief|China rolls out|Amazon is reportedly|Google Unveils Gemini|Critical Infrastructure|Anthropic Says Claude Bypassed/i;
  for (const s of scored.filter((x) => probe.test(x.row.headline) || x.row.label).sort((a, b) => b.answers.commentary - a.answers.commentary)) console.log(`  event ${f(s.answers.news_event)}  comm ${f(s.answers.commentary)}  ${s.status === 'qualified' ? 'in ' : 'OUT'}  ${s.row.headline.slice(0, 80)}`);
  // Do must_know and common_person measure the same thing? (qualified stories only; n is small)
  const corr = (xs: number[], ys: number[]) => {
    const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
    const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)); const sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
    return xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / (sx * sy);
  };
  const col = (id: string) => ranked.map((x) => x.answers[id] ?? 0);
  console.log(`\nCORRELATION AMONG ${ranked.length} QUALIFIED STORIES (+1 = always together, 0 = unrelated)`);
  console.log(`  must_know ~ common_person ${corr(col('must_know'), col('common_person')).toFixed(2)}`);
  console.log('  common_person on the stories we know: ' + scored.filter((x) => /Haiku|Decart|Maia|China rolls|EU Tech Chief|Britain to strengthen|UK says|murder tip|Gemini Agent|South Korea Job|math model|Annualized/i.test(x.row.headline) || x.row.label).map((x) => `${x.row.headline.slice(0, 22)} ${f(x.answers.common_person)}`).join(' | '));

  // Where would a lower commentary cutoff land? (stories that pass every other gate, by commentary score)
  const Th = { ...Scoring4.THRESHOLDS, COMMENTARY_MIN: 0.45 };
  const others = scored.filter((x) => x.answers.ai_main_subject >= Th.REQUIRED_MIN && x.answers.substance >= Th.REQUIRED_MIN && x.answers.news_event >= Th.EVENT_MIN);
  console.log('\nCOMMENTARY CUTOFF: stories that pass every other gate, by commentary score (the line is drawn at the cutoff)');
  for (const x of others.sort((a, b) => b.answers.commentary - a.answers.commentary).filter((x) => x.answers.commentary >= 0.3)) console.log(`  ${f(x.answers.commentary)}  ${x.answers.commentary >= 0.6 ? 'OUT at 0.60' : x.answers.commentary >= 0.5 ? 'out at 0.50' : x.answers.commentary >= 0.45 ? 'out at 0.45' : 'in at all three'}  ${x.row.headline.slice(0, 80)}`);
  console.log('\nGATED OUT BY @4 BUT STRONG ON SIGNIFICANCE (would-be score, if the gate had passed)');
  const gatedOut = scored.filter((x) => x.status === 'not-qualified' && x.answers.ai_main_subject >= 0.6 && x.answers.substance >= 0.6).sort((a, b) => b.score - a.score);
  for (const s of gatedOut.slice(0, 10)) console.log(`  would-be ${f(s.score)}  event ${f(s.answers.news_event)} comm ${f(s.answers.commentary)}  ${s.row.v3 ? '@3 ' + (s.row.v3.rank ? '#' + s.row.v3.rank : s.row.v3.status) : 'new'}  ${s.row.headline.slice(0, 85)}`);
  await closeDbPool();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
