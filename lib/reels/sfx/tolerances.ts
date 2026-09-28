import type { FrameTolerances } from '@/lib/reels/sfx/frame-test';

/**
 * SFX-V4 frame-test tolerances, approved by Lucas 2026-09-27 (D-134) from
 * the evidence below.
 *
 * WAV (the 18 files in the repo): off-frames are digital silence, so the
 * strictest threshold holds. Every miss at 2 ms and 5 ms onset was a first
 * flicker arriving 3–8 ms late, on the source's own soft attack at the chosen
 * trim; 10 ms passes all 18.
 *
 * MP4 (the render check): AAC smears each gate edge by a few ms (up to
 * -26.7 dBFS right at the edge), so 5 ms at each gap edge is skipped. Past
 * that, codec noise remains. On the Mac (ffmpeg 7) it reaches -52 dBFS; on the
 * production worker (ffmpeg 4.4) it reaches -46.9 dBFS on glitch-strobe, still
 * about 39 dB under its flickers. -45 passes all 18 on the worker; -50 passes 17.
 */
export const SFX_WAV_TOLERANCES: FrameTolerances = { silenceDb: -120, onsetMs: 10, edgeGuardMs: 0 };
export const SFX_MP4_TOLERANCES: FrameTolerances = { silenceDb: -45, onsetMs: 10, edgeGuardMs: 5 };
