/**
 * MUS-V2 mix test: publish one finished reel as a trial reel at 2–3 song/SFX
 * mixes so Lucas can pick by ear. Every mix is a real, public trial reel on the
 * Helios account, so nothing is queued without --confirm.
 *
 *   npm run reels:mix-test -- --video <video_job_id> --mix 100:60 --mix 100:100
 *   npm run reels:mix-test -- --video <video_job_id> --mix 100:60 --mix 100:100 --confirm
 *
 * Each --mix is audio_volume:video_volume (song:SFX), 0–100. The worker
 * publishes the queued attempts.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const file of ['.env.local', 'scripts/gcp/worker.env']) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function args(): { video: string; mixes: Array<{ audioVolume: number; videoVolume: number }>; confirm: boolean } {
  const argv = process.argv.slice(2);
  const video = argv[argv.indexOf('--video') + 1];
  const mixes = argv
    .flatMap((arg, index) => (arg === '--mix' ? [argv[index + 1]] : []))
    .map((value) => {
      const [audio, video] = value.split(':').map(Number);
      if (![audio, video].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) throw new Error(`Bad mix "${value}"; use song:sfx, 0–100.`);
      return { audioVolume: audio, videoVolume: video };
    });
  if (!video || argv.indexOf('--video') < 0) throw new Error('--video <video_job_id> is required.');
  if (mixes.length === 0) throw new Error('At least one --mix is required.');
  return { video, mixes, confirm: argv.includes('--confirm') };
}

async function main(): Promise<void> {
  const { video, mixes, confirm } = args();
  if (!confirm) {
    console.log(`Would publish video ${video} as ${mixes.length} trial reel(s):`);
    for (const mix of mixes) console.log(`  song ${mix.audioVolume} / SFX ${mix.videoVolume}`);
    console.log('Nothing queued. Add --confirm to publish.');
    return;
  }
  const { closeDbPool } = await import('@/lib/db');
  const { queuePublish } = await import('@/lib/reels/music/publish');
  try {
    for (const mix of mixes) {
      console.log(JSON.stringify({ mix, ...(await queuePublish(video, 'mix_test', mix)) }));
    }
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
