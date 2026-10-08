/**
 * Local preview store (plan M6): render Posts as JSON files under
 * exports/social/generated/, read by the preview page through
 * /api/social/generated. No database, no Storage. Local only: on Vercel
 * the filesystem doesn't persist, so the routes refuse there.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Post } from './types';

export const GENERATED_DIR = path.join(process.cwd(), 'exports', 'social', 'generated');

const SLUG_RE = /^[a-z0-9-]+$/;

export function isSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'post';
}

export async function writeGeneratedPost(slug: string, post: Post, dir = GENERATED_DIR): Promise<string> {
  if (!isSlug(slug)) throw new Error(`bad slug: ${slug}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  await fs.writeFile(file, JSON.stringify(post, null, 2), 'utf8');
  return file;
}

export async function listGeneratedSlugs(dir = GENERATED_DIR): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter(isSlug).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Null when there's no such post. */
export async function readGeneratedPost(slug: string, dir = GENERATED_DIR): Promise<Post | null> {
  if (!isSlug(slug)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${slug}.json`), 'utf8')) as Post;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** The preview store is for local runs only. */
export const localOnly = () => !process.env.VERCEL;
