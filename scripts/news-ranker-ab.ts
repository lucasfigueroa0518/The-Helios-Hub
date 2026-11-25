/** Lab: compares reranker runs against the Opus baseline (posted set, top 10). Free. */
import fs from 'node:fs';

type Row = { id: string; headline: string; posted: boolean };
const B = '.memes-local/news-ranker-lab/tourney/build-b/';
const load = (f: string) => JSON.parse(fs.readFileSync(B + f, 'utf8')) as { costUsd: number; days: Record<string, Row[]> };
const base = load(process.argv[2] ?? 'rerank-opus-post.json');
for (const f of process.argv.slice(3)) {
  const x = load(f);
  let shared = 0, opusPosted = 0, modelPosted = 0, top10 = 0, n = 0;
  const notes: string[] = [];
  for (const d of Object.keys(base.days)) {
    const o = base.days[d]!, m = x.days[d] ?? [];
    const po = o.filter((s) => s.posted).map((s) => s.id), pm = m.filter((s) => s.posted).map((s) => s.id);
    opusPosted += po.length; modelPosted += pm.length; shared += pm.filter((id) => po.includes(id)).length;
    const t = new Set(o.slice(0, 10).map((s) => s.id));
    top10 += m.slice(0, 10).filter((s) => t.has(s.id)).length; n += 10;
    const extra = m.filter((s) => s.posted && !po.includes(s.id)).map((s) => s.headline.slice(0, 60));
    const lost = o.filter((s) => s.posted && !pm.includes(s.id)).map((s) => s.headline.slice(0, 60));
    notes.push(`${d}: opus ${po.length}, model ${pm.length}, shared ${pm.filter((id) => po.includes(id)).length}${lost.length ? `\n    lost: ${lost.join(' | ')}` : ''}${extra.length ? `\n    added: ${extra.join(' | ')}` : ''}`);
  }
  console.log(`${f}: $${x.costUsd.toFixed(3)} vs $${base.costUsd.toFixed(3)} | posted ${modelPosted} (opus ${opusPosted}), shared ${shared} | top-10 overlap ${top10}/${n}`);
  console.log('  ' + notes.join('\n  '));
}
