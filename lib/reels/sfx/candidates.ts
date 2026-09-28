import type { Hook } from '@/lib/reels/visual/hook';

/**
 * Stage 2 proposals (SFX-03): two source SFX per hook, with why each source's
 * character fits that hook's look. The agent chose these from the Stage 1
 * analysis and the file names. It has not heard them; Lucas picks by ear.
 */
export type SfxCandidate = { source: string; reason: string };

export const SFX_CANDIDATES: Record<Hook, [SfxCandidate, SfxCandidate]> = {
  glitch: [
    {
      source: 'Fast Distort Glitch.wav',
      reason: 'Dense digital distortion that stays loud for the whole window, like the torn, color-split picture on every flicker.',
    },
    {
      source: 'Double Glitch.wav',
      reason: 'Rapid short bursts that jump like the tear bands, which shift every few frames.',
    },
  ],
  color_bars: [
    {
      source: 'TV Noise.wav',
      reason: 'Flat dead-channel hiss with no gaps, the sound a set makes when the test bars come up.',
    },
    {
      source: 'Old TV Error.wav',
      reason: 'A steady broadcast-fault noise. Very quiet as recorded, so it takes the most gain of any source.',
    },
  ],
  invert: [
    {
      source: 'Whoosh Glitch.wav',
      reason: 'A swell with a glitch edge. The picture flipping to its negative reads as a reveal, and invert is also every fallback, so it should sit well under any story.',
    },
    {
      source: 'Crackle Glitch.wav',
      reason: 'One dense crackle burst, a sharp electrical flip. It is a little short, so it is slowed to about 0.8x (0.7x for tail).',
    },
  ],
  vhs: [
    {
      source: 'VHS Smooth Glitch.wav',
      reason: 'Tape warble for the tape look: the rolling tracking band and washed color.',
    },
    {
      source: 'TV Glitch.wav',
      reason: 'A soft analog glitch whose audible span (about 0.59s) nearly matches the hook window. Only tail needs a slight stretch.',
    },
  ],
  thermal: [
    {
      source: 'Pulse Glitch.wav',
      reason: 'A sustained electronic pulse, like a sensor sweeping the scene in heat vision.',
    },
    {
      source: 'Glitch Sci-Fi.wav',
      reason: 'A sustained sci-fi tone that suits the surveillance-camera palette.',
    },
  ],
  blue_screen: [
    {
      source: 'Glitch Bass.wav',
      reason: 'A hard bass hit, the system crashing. Needs stretching to reach the last flicker.',
    },
    {
      source: 'Deep End Glitch.wav',
      reason: 'One burst that decays, like a machine dropping out to the error screen.',
    },
  ],
};
