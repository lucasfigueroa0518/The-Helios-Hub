import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clapTextOverflow,
  createLiveClapClient,
  shortenForClap,
  shortenOverflowingTexts,
} from '@/lib/reels/music/clap';

const TODAY =
  'CLAP endpoint returned 400: {"error":"The expanded size of the tensor (560) must match the existing size (514) at non-singleton dimension 1.  Target sizes: [1, 560].  Tensor sizes: [1, 514]"}';

describe('CLAP text overflow', () => {
  it('reads the position-table overflow that left a reel with no song', () => {
    assert.deepEqual(clapTextOverflow(TODAY), { actual: 560, limit: 514 });
    assert.equal(clapTextOverflow('CLAP endpoint returned 503: loading'), null);
    assert.equal(clapTextOverflow('CLAP returned no audio embedding.'), null);
  });

  it('keeps the start of a long caption and leaves short tag lines alone', () => {
    const caption = 'Nvidia owes him a billion. '.repeat(80);
    const shortened = shortenForClap(caption, 560, 514);
    assert.ok(shortened.length < caption.length);
    assert.ok(shortened.startsWith('Nvidia owes him a billion.'));
    assert.equal(shortenForClap('short', 100, 514), 'short');

    const next = shortenOverflowingTexts(['lo-fi piano', caption, 'warm'], 560, 514);
    assert.equal(next[0], 'lo-fi piano');
    assert.equal(next[2], 'warm');
    assert.ok(next[1].length < caption.length);
  });

  it('cuts again when the endpoint still rejects the shorter caption', () => {
    const once = shortenForClap('x'.repeat(2284), 560, 514);
    const twice = shortenForClap(once, 0, 514);
    assert.ok(twice.length < once.length);
    assert.ok(twice.length < 1700);
  });

  it('retries a 400 by sending a shorter caption', async () => {
    const saved = { token: process.env.HF_TOKEN, url: process.env.HF_CLAP_ENDPOINT_URL };
    process.env.HF_TOKEN = 'hf-test';
    process.env.HF_CLAP_ENDPOINT_URL = 'https://clap.example.com';
    const sent: string[] = [];
    const caption = 'x'.repeat(2000);
    let calls = 0;
    const impl = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { inputs: { texts: string[] } };
      sent.push(body.inputs.texts[0]);
      if (calls === 1) return new Response(JSON.stringify({ error: TODAY }), { status: 400 });
      if (calls === 2) return new Response(JSON.stringify({ error: 'index out of range in self' }), { status: 400 });
      return new Response(JSON.stringify({ text_embeddings: [[1, 0]] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      assert.deepEqual(await createLiveClapClient(impl, 0).embedTexts([caption]), [[1, 0]]);
      assert.equal(calls, 3);
      assert.equal(sent[0], caption);
      assert.ok(sent[1].length < caption.length);
      assert.ok(sent[2].length < sent[1].length);
    } finally {
      if (saved.token === undefined) delete process.env.HF_TOKEN;
      else process.env.HF_TOKEN = saved.token;
      if (saved.url === undefined) delete process.env.HF_CLAP_ENDPOINT_URL;
      else process.env.HF_CLAP_ENDPOINT_URL = saved.url;
    }
  });
});
