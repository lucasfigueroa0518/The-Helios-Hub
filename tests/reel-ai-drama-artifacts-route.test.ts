import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { dramaArtifactResponse } from '@/lib/reel-ai-drama/artifacts-route';

import { dramaHubDb, finishedJob } from './reel-ai-drama-hub-fixture';

const session = async () => ({ email: 't@x' });
const get = (headers: Record<string, string> = {}) => new Request('http://x/api/reel-ai-drama/artifacts/id', { headers });

test('artifacts: text served directly; a bucket copy off this disk redirects to a signed URL; a local file streams with ranges', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  const art = async (kind: string) => (await db.query<{ id: string; storage_path: string }>(`SELECT id, storage_path FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = $2`, [jobId, kind])).rows[0];
  const noDisk = { localPath: () => null };

  const text = await dramaArtifactResponse(get(), (await art('post_text')).id, { session, db: async () => db, store: noDisk });
  assert.equal(text.status, 200);
  assert.match(text.headers.get('content-type') ?? '', /json/);

  const video = await art('video');
  const signed: string[] = [];
  const redirect = await dramaArtifactResponse(get(), video.id, { session, db: async () => db, store: noDisk, sign: async (k) => (signed.push(k), 'https://signed.example/v.mp4') });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://signed.example/v.mp4');
  assert.deepEqual(signed, [video.storage_path]);

  const broken = await dramaArtifactResponse(get(), video.id, { session, db: async () => db, store: noDisk, sign: async () => { throw new Error('no key'); } });
  assert.equal(broken.status, 502);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-art-'));
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, Buffer.from('0123456789'));
  const onDisk = { localPath: () => file };
  const ranged = await dramaArtifactResponse(get({ range: 'bytes=2-5' }), video.id, { session, db: async () => db, store: onDisk });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '2345');
  assert.equal((await dramaArtifactResponse(get(), video.id, { session, db: async () => db, store: onDisk })).status, 200);
  fs.rmSync(dir, { recursive: true, force: true });

  // Only on another machine's disk: not found here.
  await db.query(`UPDATE reel_ai_drama.artifacts SET storage_location = 'local' WHERE id = $1`, [video.id]);
  assert.equal((await dramaArtifactResponse(get(), video.id, { session, db: async () => db, store: noDisk })).status, 404);
});

test('artifacts: 401 without a session, 404 for a bad or unknown id', async () => {
  const db = await dramaHubDb();
  assert.equal((await dramaArtifactResponse(get(), '00000000-0000-4000-8000-000000000000', { session: async () => null, db: async () => db })).status, 401);
  assert.equal((await dramaArtifactResponse(get(), 'not-an-id', { session, db: async () => db })).status, 404);
  assert.equal((await dramaArtifactResponse(get(), '00000000-0000-4000-8000-000000000000', { session, db: async () => db })).status, 404);
});
