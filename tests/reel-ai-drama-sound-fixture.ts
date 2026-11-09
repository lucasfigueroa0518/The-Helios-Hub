import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A tiny paced project for the sound tests (offline): three voiced frames of 3s and the close (11.5s),
 * word timing in assets/timing, audio_meta voices, and the repo's sfx library linked in (read-only).
 * Frame 2's words end at 5.0s and frame 3's begin at 6.2s: a pause for a silence.
 */
export const FRAMES = [
  { n: 1, id: '01-hotel', lines: 'L1', words: [['In', 0, 0.2], ['summer', 0.3, 0.7], ['a', 0.8, 0.9], ['dinner', 1.2, 1.6], ['began', 1.8, 2.4]] },
  { n: 2, id: '02-bomb', lines: 'L2', words: [['They', 0, 0.3], ['would', 0.4, 0.7], ['sue', 0.8, 1.2], ['each', 1.4, 1.7], ['other.', 1.8, 2.0]] },
  { n: 3, id: '03-turn', lines: 'L3', words: [['Then', 0.2, 0.5], ['it', 0.6, 0.7], ['flipped.', 0.8, 1.4]] },
] as const;

export function soundFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-sound-'));
  const sb = [
    '---', 'format: 1080x1920', 'music: none', '---', '',
    ...FRAMES.flatMap((f) => [
      `## Frame ${f.n} — F${f.n}`, '', '- duration: 3s', `- src: compositions/frames/${f.id}.html`, '- treatment: photo', `- lines: ${f.lines}`, '- music: hold',
      `- voiceover: "${f.words.map((w) => w[0]).join(' ')}"`, '',
    ]),
    '## Frame 4 — Close', '', '- duration: 2.5s', '- src: compositions/frames/04-close.html', '- treatment: close', '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), sb);
  fs.mkdirSync(path.join(root, 'assets', 'timing'), { recursive: true });
  const voices = FRAMES.map((f) => {
    const words = f.words.map(([text, start, end]) => ({ text, start, end }));
    fs.writeFileSync(path.join(root, 'assets', 'timing', `${f.id}.json`), JSON.stringify({ frame: f.n, id: f.id, words }));
    return { frame: f.n, path: `assets/voice/0${f.n}.wav`, duration_s: 2.6, words };
  });
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ bgm: { path: 'assets/bgm/track.mp3', volume: 0.16 }, voices, sfx: [] }));
  fs.symlinkSync(path.join(process.cwd(), 'explainers', 'design', 'sfx'), path.join(root, 'assets', 'sfx-library'));
  return root;
}
