import { promises as fs } from 'node:fs';
import path from 'node:path';

import { dbQuery } from '@/lib/db';

/**
 * The photo manifest Haiku sees at compose time.
 *
 * Each entry is a real file that lives under `public/social/stock/` — Haiku
 * picks by `path` (the /-rooted URL that the renderer resolves against Next's
 * public directory). `subject` is a short human-readable caption of what the
 * image actually shows, so Haiku can pick the right metaphor.
 *
 * The cross-carousel uniqueness rule (see skill § Photo policy) is enforced
 * by removing any URL that appears in `helios_social.posts.post_json` on a
 * row whose `status` is not `draft`. Draft rows are fair game — a compose
 * retry within the same article may reuse the photos the first attempt tried.
 */

export type PhotoManifestEntry = {
  path: string; // e.g. '/social/stock/server-racks.jpg'
  filename: string; // e.g. 'server-racks.jpg'
  subject: string; // short caption of what the image shows
  hasFace: boolean; // if true, face-integrity rule applies
  license: string; // credit line format for on-slide attribution
};

/**
 * Human-authored catalog of what lives in `public/social/stock/`. Keep this
 * table in sync with the actual files on disk — a hydration script could
 * derive it, but the human-readable subject / face-flag / license fields
 * matter more than an automatic listing. Grow this list when you add a
 * photo to the library.
 */
const STOCK_CATALOG: PhotoManifestEntry[] = [
  {
    path: '/social/stock/mustafa-suleyman.jpg',
    filename: 'mustafa-suleyman.jpg',
    subject: 'Mustafa Suleyman (Microsoft AI CEO) — press portrait, upper body, bookstore background',
    hasFace: true,
    license: 'PHOTO · WIKIMEDIA COMMONS · CC BY-SA 4.0',
  },
  {
    path: '/social/stock/demis-hassabis.jpg',
    filename: 'demis-hassabis.jpg',
    subject: 'Demis Hassabis (Google DeepMind CEO, 2024 Nobel laureate) — press portrait, upper body',
    hasFace: true,
    license: 'PHOTO · WIKIMEDIA COMMONS · CC BY-SA 4.0',
  },
  {
    path: '/social/stock/server-racks.jpg',
    filename: 'server-racks.jpg',
    subject: 'Server racks in a near-black data center with glowing green LEDs and yellow cabling',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/circuit-macro.jpg',
    filename: 'circuit-macro.jpg',
    subject: 'Macro close-up of a dark circuit board with a central chip',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/earth-from-space.jpg',
    filename: 'earth-from-space.jpg',
    subject: 'Earth at night from the ISS, city lights visible across the surface',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/dell-keyboard.jpg',
    filename: 'dell-keyboard.jpg',
    subject: 'Two hands typing on a Dell laptop next to a MacBook (no faces visible)',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/dashboard.jpg',
    filename: 'dashboard.jpg',
    subject: 'Analytics dashboard with performance metrics and line charts on a screen',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/macbook-glow.jpg',
    filename: 'macbook-glow.jpg',
    subject: 'MacBook open at night, screen glowing in near-black surroundings',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/circuit-schematic.jpg',
    filename: 'circuit-schematic.jpg',
    subject: 'Glowing green circuit schematic on a dark surface — blueprint aesthetic',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/typewriter-ml.jpg',
    filename: 'typewriter-ml.jpg',
    subject: 'Vintage typewriter with a sheet of paper reading "MACHINE LEARNING"',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
  {
    path: '/social/stock/newspapers-stack.jpg',
    filename: 'newspapers-stack.jpg',
    subject: 'Close-up stack of folded newspapers with "WORLD BUSINESS" visible',
    hasFace: false,
    license: 'PHOTO · UNSPLASH',
  },
];

type PostRow = { post_json: unknown };

/**
 * Query every already-shipped Post (status other than `draft`) and extract
 * the set of `photoUrl` values that have appeared on-slide. Draft posts are
 * excluded so a compose retry can pull from the same pool as the failed
 * attempt — the used-photos rule protects the audience-facing feed, not the
 * internal drafts table.
 */
async function loadUsedPhotoUrls(): Promise<Set<string>> {
  const used = new Set<string>();
  const { rows } = await dbQuery<PostRow>(
    `SELECT post_json FROM helios_social.posts
      WHERE status IN ('approved','exported','published')
        AND post_json IS NOT NULL`,
  );
  for (const row of rows) {
    if (!row.post_json || typeof row.post_json !== 'object') continue;
    const post = row.post_json as { slides?: Array<{ photoUrl?: string }> };
    if (!Array.isArray(post.slides)) continue;
    for (const slide of post.slides) {
      if (typeof slide.photoUrl === 'string' && slide.photoUrl.length > 0) {
        used.add(slide.photoUrl);
      }
    }
  }
  return used;
}

export type PhotoManifest = {
  available: PhotoManifestEntry[];
  used: PhotoManifestEntry[];
};

/**
 * Build the compose-time photo manifest: everything in the stock catalog,
 * partitioned into "available for this post" vs. "already used elsewhere."
 * Haiku receives both lists so it can (a) pick from available and (b)
 * understand why the used ones are off-limits.
 */
export async function buildPhotoManifest(): Promise<PhotoManifest> {
  const usedUrls = await loadUsedPhotoUrls();
  const available: PhotoManifestEntry[] = [];
  const used: PhotoManifestEntry[] = [];
  for (const entry of STOCK_CATALOG) {
    if (usedUrls.has(entry.path)) {
      used.push(entry);
    } else {
      available.push(entry);
    }
  }
  return { available, used };
}

/**
 * Render the manifest into the text block Haiku sees in the user message.
 * Available photos come first with their filenames and subjects so Haiku
 * can pick by name; used photos come after with a short "off-limits"
 * marker so Haiku knows not to invent references to them.
 */
export function renderManifestForPrompt(manifest: PhotoManifest): string {
  const availableBlock = manifest.available
    .map((p) => `- ${p.path}\n    ${p.subject}${p.hasFace ? '\n    [HAS FACE — the entire face must render whole; do not crop, mask, or overlay]' : ''}\n    credit: ${p.license}`)
    .join('\n');
  const usedBlock = manifest.used.length === 0
    ? '(none — every stock photo is available for this post)'
    : manifest.used
        .map((p) => `- ${p.path} (already used in a published Helios Social post)`)
        .join('\n');
  return (
    `AVAILABLE PHOTOS — pick each slide's photoUrl from this list only:\n\n`
    + `${availableBlock}\n\n`
    + `OFF-LIMITS PHOTOS — do not reference these; they have already shipped:\n${usedBlock}\n`
  );
}

/**
 * Sanity check called by CI / tests: verify every catalog entry has a real
 * file on disk. Called from a script, not from compose (compose can't do
 * fs reads on Vercel serverless).
 */
export async function verifyStockCatalog(): Promise<{ missing: string[] }> {
  const root = process.cwd();
  const missing: string[] = [];
  for (const entry of STOCK_CATALOG) {
    const absolute = path.join(root, 'public', entry.path);
    try {
      await fs.access(absolute);
    } catch {
      missing.push(entry.path);
    }
  }
  return { missing };
}
