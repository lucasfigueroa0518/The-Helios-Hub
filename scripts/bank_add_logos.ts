/**
 * Add companies' logo variants to the photo bank (Tommy, 2026-10-12).
 *
 * A company's logo pool is its own logos and icon plus the logos of the
 * products Wikidata links to it (lib/social/photos/logo.ts fetchLogos). Every
 * finder run already records the ones it sees (the bank's `capture` switch);
 * this adds the whole pool for the companies you name, so covers can rotate
 * through them from the first night. Free Wikidata and Commons reads; no
 * model calls. The bank stores through its own policy (licence check, thumbnail
 * and master copies) and drains for up to two minutes.
 *
 *   npx tsx scripts/bank_add_logos.ts --dry-run            show what would be added
 *   npx tsx scripts/bank_add_logos.ts                      add the default companies
 *   npx tsx scripts/bank_add_logos.ts "Acme=Q123" "Other=Q456"   add these (name=Wikidata id)
 *
 * Safe to repeat: a photo already in the bank is not stored twice.
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

/** The companies the carousels cover most (Wikidata ids checked 2026-10-12). */
const DEFAULT_COMPANIES: Array<[string, string]> = [
  ['Anthropic', 'Q116758847'],
  ['OpenAI', 'Q21708200'],
  ['Google DeepMind', 'Q15733006'],
  ['Nvidia', 'Q182477'],
  ['Microsoft', 'Q2283'],
  ['Meta', 'Q380'],
  ['Amazon', 'Q3884'],
];

async function main() {
  const dry = process.argv.includes('--dry-run');
  const named = process.argv.slice(2).filter((a) => a.includes('='));
  const companies = named.length
    ? named.map((a): [string, string] => {
        const i = a.lastIndexOf('=');
        const qid = a.slice(i + 1).trim();
        if (!/^Q\d+$/.test(qid)) throw new Error(`"${a}": expected Name=Q123`);
        return [a.slice(0, i).trim(), qid];
      })
    : DEFAULT_COMPANIES;

  const { fetchLogos } = await import('@/lib/social/photos/logo');
  const items: Array<{ company: string; list: import('@/lib/social/photos/vetted').VettedPhoto[] }> = [];
  for (const [company, qid] of companies) {
    const { logos, reasons } = await fetchLogos(qid, company);
    console.log(`${company} (${qid}): ${logos.length} logo${logos.length === 1 ? '' : 's'}`);
    for (const l of logos) console.log(`  + ${l.file}  ${l.photo.width}×${l.photo.height}  ${l.photo.credit}`);
    for (const r of reasons) console.log(`  - ${r}`);
    items.push({
      company,
      list: logos.map((l) => ({
        slide: 1,
        request: { kind: 'logo' as const, query: company },
        outcome: 'verified' as const,
        candidate: { ...l.photo, lane: 'logo' as const, date: null, title: l.file, verified: true },
        tileTags: null,
        fit: null,
        vision: null,
      })),
    });
  }
  const total = items.reduce((n, i) => n + i.list.length, 0);
  console.log(`\n${total} logo${total === 1 ? '' : 's'} across ${items.length} companies.`);
  if (dry) {
    console.log('Dry run: nothing written.');
    return;
  }

  const { createSocialStore } = await import('@/lib/social/store');
  const { createPhotoBank } = await import('@/lib/media-library/bank');
  const store = await createSocialStore();
  if (!store.query) throw new Error('The photo bank needs the Postgres store (DATABASE_URL).');
  const bank = createPhotoBank({ query: store.query, log: (line) => console.log(`photo bank: ${line}`) });
  const day = new Date().toISOString().slice(0, 10);
  for (const { company, list } of items) {
    if (list.length) bank.offer({ runKind: 'backfill', runRef: `logo-variants-${day}-${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, subjects: [company], organizations: [company], items: list });
  }
  await bank.drain(120_000);
  console.log('Done.');
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
