import type { Source } from '../types';

/**
 * Frames from official videos (research 04 §3 I): yt-dlp and ffmpeg, only when both are on PATH
 * (live.ts decides). Frames are not trusted: a TV channel logo counts as a watermark (MD-16), so every
 * frame goes through the look.
 */
export const MAX_FRAMES = 8;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const videoSource: Source = async (want, run) => {
  if (!want.url) return [];
  if (!run.deps.videoFrames) {
    const note = 'video frames: skipped (yt-dlp or ffmpeg not on PATH)';
    if (!run.notes.includes(note)) run.notes.push(note);
    return [];
  }
  const got = await run.deps.videoFrames(want.url, { outDir: run.tmpDir, max: MAX_FRAMES });
  return got.frames.map((f) => ({
    source: 'video' as const,
    want: want.id,
    kind: 'video_frame' as const,
    url: null,
    localFile: f.file,
    source_page: want.url ?? null,
    credit: `${got.channel || 'YouTube'} (video frame at ${clock(f.at)})`,
    license: null,
    caption: got.title,
    people: [],
    qids: [],
    place: null,
    date_taken: got.date,
    date_basis: got.date ? ('event' as const) : ('unknown' as const),
    character_image: false,
    made: false,
    trusted: false,
    flags: [],
  }));
};
