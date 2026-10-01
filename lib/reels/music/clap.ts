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

/**
 * `laion/larger_clap_music_and_speech` uses a RoBERTa text tower whose
 * position table is 514. A longer caption comes back as a 400:
 * "expanded size of the tensor (N) must match the existing size (514)".
 * The handler truncates once the endpoint is updated. Until then the client
 * shortens the text and retries, because that 400 is what left reels with no song.
 */
export const CLAP_TEXT_POSITIONS = 514;

const OVERFLOW = /expanded size of the tensor \((\d+)\) must match the existing size \((\d+)\)/;
/** Same refusal, once the sequence is only a little over the position table. */
const POSITION_INDEX = /index out of range in self/i;

export function clapTextOverflow(message: string): { actual: number; limit: number } | null {
  const match = OVERFLOW.exec(message);
  if (match) {
    const actual = Number(match[1]);
    const limit = Number(match[2]);
    if (Number.isFinite(actual) && Number.isFinite(limit) && actual > limit) return { actual, limit };
  }
  // No token count in this form. actual 0 tells the shortener to take a larger slice off.
  if (POSITION_INDEX.test(message)) return { actual: 0, limit: CLAP_TEXT_POSITIONS };
  return null;
}

/** Keep the start of the text, which is the on-screen copy plus the opening of the caption. */
export function shortenForClap(text: string, actual: number, limit: number): string {
  if (text.length <= 1) return text;
  if (actual > 0 && actual <= limit) return text;
  // The head of a caption is denser than the average, so a tight ratio still overflows.
  const keep =
    actual > limit
      ? Math.max(1, Math.floor((text.length * Math.max(1, limit - 48)) / actual))
      : Math.max(1, Math.floor(text.length * 0.7));
  const next = text.slice(0, keep).trimEnd();
  return next.length < text.length ? next : text.slice(0, text.length - 1);
}

/** The overflow is the longest input. Leave the short tag sentences alone. */
export function shortenOverflowingTexts(texts: string[], actual: number, limit: number): string[] {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), 0);
  const floor = longest * 0.8;
  return texts.map((text) => (text.length >= floor ? shortenForClap(text, actual, limit) : text));
}

/** A scaled-to-zero endpoint answers 503 while it wakes. */
const WAKE_ATTEMPTS = 20;
const WAKE_WAIT_MS = 15_000;
const TEXT_OVERFLOW_RETRIES = 6;

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
      last = `CLAP endpoint returned ${response.status}: ${(await response.text()).slice(0, 500)}`;
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
      let pending = texts;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < TEXT_OVERFLOW_RETRIES; attempt += 1) {
        try {
          const body = await post<{ text_embeddings?: number[][] }>({ texts: pending });
          if (body.text_embeddings?.length !== texts.length) {
            throw new Error('CLAP returned the wrong number of text embeddings.');
          }
          return body.text_embeddings;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const overflow = clapTextOverflow(lastError.message);
          if (!overflow) throw lastError;
          const next = shortenOverflowingTexts(pending, overflow.actual, overflow.limit);
          if (next.every((text, index) => text === pending[index])) throw lastError;
          pending = next;
        }
      }
      throw lastError ?? new Error('CLAP text embedding failed.');
    },
  };
}
