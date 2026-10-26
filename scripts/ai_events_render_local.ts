// scripts/ai_events_render_local.ts
/**
 * AI Events ranked city posts (AE-29), rendered to a local folder as JPEGs: every look, Miami and
 * Boston, from the sample fixtures (fixtures/social/ai-events-posts.ts). Nothing is uploaded,
 * booked or written; no database, no Jev, no Claude.
 *
 *   npx tsx scripts/ai_events_render_local.ts --out <dir>
 *   ... --looks spotlight,glass   only these looks       ... --copy min   the fewest slides the post allows
 *   ... --posters poster,ambient,type   real listings with their posters, one post per rank layout
 *   ... --treat ghost+glow,flyer        with --posters: one post per treatment set on the rank slides
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<number> {
  const out = arg('out');
  if (!out) {
    console.error('Pass --out <dir>.');
    return 1;
  }
  const { LOOKS, isLook } = await import('@/lib/ai-events/looks');
  const { buildAiEventsCityPost } = await import('@/lib/ai-events/post');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { storeSlideJpegs } = await import('@/lib/social/overnight/slides');
  const { sampleCityInput } = await import('@/fixtures/social/ai-events-posts');

  const looks = (arg('looks')?.split(',') ?? [...LOOKS]).filter(isLook);
  const copy = arg('copy') === 'min' ? 'min' : 'max';
  let problems = 0;
  const fitCheck = async (post: Parameters<typeof checkRenderFit>[0], opts: Parameters<typeof checkRenderFit>[1]) => {
    const res = await checkRenderFit(post, opts);
    const found = [...res.problems, ...res.violations.map((v) => `slide ${v.slide} bounds: ${v.element} "${v.text}"`)];
    problems += found.length;
    if (found.length) console.warn(`  ${found.length} fit problem(s):\n  - ${found.join('\n  - ')}`);
    return res;
  };
  const write = (dir: string) => async (objectPath: string, body: Buffer) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, path.basename(objectPath)), body);
  };

  const layouts = arg('posters')?.split(',') as Array<'poster' | 'ambient' | 'type'> | undefined;
  if (layouts) {
    const { posterCityInput } = await import('@/fixtures/social/ai-events-posts');
    type Treat = 'ghost' | 'panorama';
    const treats: Array<Treat[] | undefined> = arg('treat')?.split(',').map((t) => t.split('+') as Treat[]) ?? [undefined];
    for (const look of looks) {
      for (const layout of layouts) {
        for (const treat of treats) {
          for (const metro of ['miami', 'boston'] as const) {
            const name = [layout, ...(treat ?? []), look, metro].join('-');
            const dir = path.resolve(out, name);
            const post = buildAiEventsCityPost(posterCityInput(look, metro, layout, treat));
            await storeSlideJpegs(name, post, { fitCheck, upload: write(dir) });
            console.log(`${name} → ${dir}`);
          }
        }
      }
    }
    return problems ? 2 : 0;
  }

  for (const look of looks) {
    for (const metro of ['miami', 'boston'] as const) {
      const dir = path.resolve(out, `${look}-${metro}`);
      const post = buildAiEventsCityPost(sampleCityInput(look, metro, copy));
      await storeSlideJpegs(`${look}-${metro}`, post, { fitCheck, upload: write(dir) });
      console.log(`${look} ${metro}: ${post.slides.length} slides → ${dir}`);
    }
  }
  return problems ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
