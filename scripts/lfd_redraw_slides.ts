/**
 * Redraws a Last Few Days post's slide JPEGs from its saved render (local Chromium, no AI, no spend). For posts whose
 * meme slides shipped broken: the saved render keeps memes as `storage:<object>`, which a render can't load, so each
 * one is read back from the bucket first. storeSlideJpegs refuses to store a slide whose image fails to load.
 *
 *   npx tsx scripts/lfd_redraw_slides.ts <post id>          # dry: writes the JPEGs to ./tmp/lfd-redraw/<slug>/
 *   npx tsx scripts/lfd_redraw_slides.ts <post id> --go     # uploads over the post's own slide objects
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

type Slide = { photoUrl?: string; lfdCover?: { meme?: { url: string }; photos?: Array<{ url: string }> } };

async function main() {
  const postId = process.argv[2];
  const go = process.argv.includes('--go');
  if (!postId || postId.startsWith('--')) throw new Error('usage: lfd_redraw_slides.ts <post id> [--go]');
  const { liveHubQuery } = await import('@/lib/social-hub/db');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { storeSlideJpegs } = await import('@/lib/social/overnight/slides');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { closeDbPool } = await import('@/lib/db');
  const bucket = mediaBucket(SLIDE_BUCKET);
  try {
    const { rows } = await liveHubQuery<{ slug: string; render: { slides: Slide[] }; slide_objects: string[] }>(
      `SELECT slug, render, slide_objects FROM lfd.posts WHERE id = $1`,
      [postId],
    );
    const post = rows[0];
    if (!post) throw new Error(`no LFD post ${postId}`);
    const draw = JSON.parse(JSON.stringify(post.render)) as typeof post.render;
    const loaded = new Map<string, string>();
    const resolve = async (url: string) => {
      if (!url.startsWith('storage:')) return url;
      if (!loaded.has(url)) {
        const body = await bucket.download(url.slice('storage:'.length));
        loaded.set(url, `data:image/png;base64,${body.toString('base64')}`);
      }
      return loaded.get(url)!;
    };
    for (const sl of draw.slides) {
      if (sl.photoUrl) sl.photoUrl = await resolve(sl.photoUrl);
      if (sl.lfdCover?.meme) sl.lfdCover.meme.url = await resolve(sl.lfdCover.meme.url);
      for (const t of sl.lfdCover?.photos ?? []) t.url = await resolve(t.url);
    }
    const outDir = path.join(process.cwd(), 'tmp', 'lfd-redraw', post.slug);
    if (!go) fs.mkdirSync(outDir, { recursive: true });
    const objects = await storeSlideJpegs(post.slug, draw as never, {
      prefix: 'lfd',
      fitCheck: checkRenderFit,
      upload: async (p, b) => {
        if (!go) return fs.writeFileSync(path.join(outDir, path.basename(p)), b);
        if (!post.slide_objects.includes(p)) throw new Error(`${p} is not one of the post's slide objects`);
        await bucket.upload(p, b, 'image/jpeg');
      },
    });
    console.log(JSON.stringify({ postId, slug: post.slug, storageImagesLoaded: loaded.size, slides: objects.length, uploaded: go, ...(go ? {} : { outDir }) }));
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
