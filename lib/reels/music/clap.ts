import { CLAP_MODEL, CLAP_SAMPLE_RATE } from '@/lib/reels/config';

/**
 * Hosted CLAP (D-177): a Hugging Face Inference Endpoint running the custom
 * handler in `hf/clap-endpoint/handler.py`. Two calls: embed audio, embed text.
 * Both return L2-normalized vectors in CLAP's shared space, so a dot product is
 * the cosine the tags and the shortlist are ranked by.
 *
 * The endpoint bills by the minute it is awake, not per call, so calls are
 * logged to the cost ledger at $0 and the endpoint's own invoice is the spend.
 */

export interface ClapClient {
  readonly model: string;
  /** 48 kHz mono float32 PCM. */
  embedAudio(pcm: Float32Array): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export class ClapNotConfiguredError extends Error {
  constructor() {
    super('CLAP is not configured: HF_TOKEN and HF_CLAP_ENDPOINT_URL must be set.');
  }
}

export function clapConfigured(): boolean {
  return Boolean(process.env.HF_TOKEN && process.env.HF_CLAP_ENDPOINT_URL);
}

/** A scaled-to-zero endpoint answers 503 while it wakes. */
const WAKE_ATTEMPTS = 20;
const WAKE_WAIT_MS = 15_000;

export function createLiveClapClient(fetchImpl: typeof fetch = fetch, wakeWaitMs = WAKE_WAIT_MS): ClapClient {
  const token = process.env.HF_TOKEN;
  const url = process.env.HF_CLAP_ENDPOINT_URL;
  if (!token || !url) throw new ClapNotConfiguredError();

  async function post<T>(inputs: Record<string, unknown>): Promise<T> {
    let last = '';
    for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(url!, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ inputs }),
      });
      if (response.ok) return (await response.json()) as T;
      last = `CLAP endpoint returned ${response.status}: ${(await response.text()).slice(0, 200)}`;
      if (response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, wakeWaitMs));
    }
    throw new Error(last);
  }

  return {
    model: CLAP_MODEL,
    async embedAudio(pcm) {
      const body = await post<{ audio_embedding?: number[] }>({
        audio_pcm_f32_b64: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64'),
        sample_rate: CLAP_SAMPLE_RATE,
      });
      if (!body.audio_embedding?.length) throw new Error('CLAP returned no audio embedding.');
      return body.audio_embedding;
    },
    async embedTexts(texts) {
      if (texts.length === 0) return [];
      const body = await post<{ text_embeddings?: number[][] }>({ texts });
      if (body.text_embeddings?.length !== texts.length) throw new Error('CLAP returned the wrong number of text embeddings.');
      return body.text_embeddings;
    },
  };
}
