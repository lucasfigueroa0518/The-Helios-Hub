import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { localOnly } from '@/lib/social/render/local-store';
import type { ReviewStore, RevisionWork, TemplateReview } from '@/lib/social/render/drafts/reviews';

const FILE = path.join(process.cwd(), 'lib/social/render/drafts/reviews.json');

const WORKS: RevisionWork[] = ['idle', 'queued', 'working', 'ready', 'error'];

async function readStore(): Promise<ReviewStore> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as ReviewStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { reviews: {} };
    throw err;
  }
}

async function writeStore(store: ReviewStore): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export async function GET(): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  return NextResponse.json(await readStore(), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  const body = (await request.json()) as Partial<TemplateReview>;
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const store = await readStore();
  const prev = store.reviews[body.id];
  const now = new Date().toISOString();

  if (body.work && WORKS.includes(body.work)) {
    if (!prev) return NextResponse.json({ error: 'unknown review' }, { status: 404 });
    store.reviews[body.id] = {
      ...prev,
      work: body.work,
      step: typeof body.step === 'string' ? body.step : prev.step,
      generation: typeof body.generation === 'number' ? body.generation : prev.generation,
      updatedAt: now,
    };
    await writeStore(store);
    return NextResponse.json(store, { headers: { 'cache-control': 'no-store' } });
  }

  if (!body.choice) return NextResponse.json({ error: 'id and choice required' }, { status: 400 });
  if (body.choice !== 'old' && body.choice !== 'new' && body.choice !== 'revise') {
    return NextResponse.json({ error: 'choice must be old, new, or revise' }, { status: 400 });
  }

  const notes = typeof body.notes === 'string' ? body.notes : prev?.notes ?? '';
  store.reviews[body.id] = {
    id: body.id,
    choice: body.choice,
    notes,
    updatedAt: now,
    work: body.choice === 'revise' ? 'queued' : 'idle',
    step: body.choice === 'revise' ? 'Request received' : undefined,
    generation: prev?.generation ?? 0,
  };
  await writeStore(store);
  return NextResponse.json(store, { headers: { 'cache-control': 'no-store' } });
}
