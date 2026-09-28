import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { recordCost } from '@/lib/reels/repository';
import { decodePcm, measureBpm, type BpmReading } from '@/lib/reels/music/audio';
import type { ClapClient } from '@/lib/reels/music/clap';
import { cosine } from '@/lib/reels/music/pool';
import { saveTags, untaggedSongs } from '@/lib/reels/music/store';
import {
  GENRES,
  INSTRUMENTS,
  labelSentence,
  songTagText,
  SONG_VOCAB_VERSION,
  tagsFromScores,
  VIBES,
  type LabelScores,
} from '@/lib/reels/music/vocab';

/**
 * Stage 3 (D-165, D-180 to D-183). Tag every untagged song in the pool: CLAP
 * scores the audio against each approved label sentence, the relative rule
 * picks the tags, librosa measures BPM, and the tag text is embedded for the
 * narrowing. The audio embedding is kept as gate 2 evidence (D-169).
 */

export type TagDeps = {
  clap: ClapClient;
  downloadPreview: (storagePath: string) => Promise<Buffer>;
  decode?: (filePath: string) => Promise<Float32Array>;
  bpm?: (filePath: string) => Promise<BpmReading>;
};

export type TagOutcome = { tagged: string[]; failed: Array<{ audioId: string; error: string }> };

export type LabelEmbeddings = Record<'genre' | 'instrument' | 'vibe', Array<{ label: string; vector: number[] }>>;

async function embedLabels(clap: ClapClient): Promise<LabelEmbeddings> {
  const kinds = [
    ['genre', GENRES],
    ['instrument', INSTRUMENTS],
    ['vibe', VIBES],
  ] as const;
  const sentences = kinds.flatMap(([kind, labels]) => labels.map((label) => labelSentence(kind, label)));
  const vectors = await clap.embedTexts(sentences);
  const out: LabelEmbeddings = { genre: [], instrument: [], vibe: [] };
  let index = 0;
  for (const [kind, labels] of kinds) {
    for (const label of labels) out[kind].push({ label, vector: vectors[index++] });
  }
  return out;
}

function score(audio: number[], labels: Array<{ label: string; vector: number[] }>): LabelScores {
  return Object.fromEntries(labels.map(({ label, vector }) => [label, cosine(audio, vector)]));
}

/**
 * A checkpoint that collapses every input to one vector would tag every song
 * the same (seen with laion/larger_clap_music on 2026-09-28). Two unrelated
 * label sentences must embed apart before anything is stored.
 */
export const CLAP_COLLAPSE_BAR = 0.98;

export function assertClapDiscriminates(labels: LabelEmbeddings): void {
  const a = labels.genre.find((item) => item.label === 'sound effects')?.vector ?? labels.genre[0].vector;
  const b = labels.instrument.find((item) => item.label === 'piano')?.vector ?? labels.instrument[0].vector;
  const similarity = cosine(a, b);
  if (similarity > CLAP_COLLAPSE_BAR) {
    throw new Error(
      `CLAP returned near-identical embeddings for unrelated labels (cosine ${similarity.toFixed(3)}). Songs stay untagged until the endpoint's checkpoint is fixed.`,
    );
  }
}

export async function tagUntagged(deps: TagDeps): Promise<TagOutcome> {
  const songs = await untaggedSongs();
  const outcome: TagOutcome = { tagged: [], failed: [] };
  if (songs.length === 0) return outcome;

  const labels = await embedLabels(deps.clap);
  assertClapDiscriminates(labels);
  const decode = deps.decode ?? decodePcm;
  const bpmOf = deps.bpm ?? measureBpm;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-songs-'));
  try {
    for (const song of songs) {
      try {
        const file = path.join(dir, `${song.audioId}${path.extname(song.previewStoragePath)}`);
        await writeFile(file, await deps.downloadPreview(song.previewStoragePath));
        const audio = await deps.clap.embedAudio(await decode(file));
        let reading: BpmReading | null = null;
        let bpmError: string | null = null;
        try {
          reading = await bpmOf(file);
        } catch (error) {
          bpmError = error instanceof Error ? error.message : String(error);
        }
        const scores = {
          genre: score(audio, labels.genre),
          instrument: score(audio, labels.instrument),
          vibe: score(audio, labels.vibe),
        };
        const tags = tagsFromScores({ ...scores, bpm: reading?.bpm ?? null });
        const tagText = songTagText(tags);
        const [tagTextEmbedding] = await deps.clap.embedTexts([tagText]);
        await saveTags({
          audioId: song.audioId,
          tags,
          tagScores: { ...scores, bpm: reading ?? { error: bpmError } },
          tagVersion: SONG_VOCAB_VERSION,
          clapModel: deps.clap.model,
          tagText,
          tagTextEmbedding,
          audioEmbedding: audio,
        });
        // The endpoint bills by the minute awake, so the ledger counts calls at $0.
        await recordCost({ runId: null, vendor: 'huggingface', component: 'song-tag', inputTokens: 0, usd: 0 });
        outcome.tagged.push(song.audioId);
      } catch (error) {
        outcome.failed.push({ audioId: song.audioId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return outcome;
}
