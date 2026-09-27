/**
 * True peak by 4x oversampling (the ITU-R BS.1770 approach): a windowed-sinc
 * interpolator fills three points between every pair of samples, and the
 * largest absolute value of the original and interpolated points wins. It
 * catches the inter-sample overs that a sample-peak meter misses.
 */
const OVERSAMPLE = 4;
const HALF_TAPS = 16;

function sinc(x: number): number {
  if (x === 0) return 1;
  const a = Math.PI * x;
  return Math.sin(a) / a;
}

/** One kernel per fractional phase, Hann-windowed. */
const KERNELS: Float64Array[] = Array.from({ length: OVERSAMPLE - 1 }, (_, index) => {
  const phase = (index + 1) / OVERSAMPLE;
  const kernel = new Float64Array(HALF_TAPS * 2);
  for (let k = 0; k < kernel.length; k += 1) {
    const offset = k - HALF_TAPS + 1 - phase;
    const window = 0.5 + 0.5 * Math.cos((Math.PI * offset) / HALF_TAPS);
    kernel[k] = sinc(offset) * window;
  }
  return kernel;
});

export function truePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      peak = Math.max(peak, Math.abs(channel[i]));
      for (const kernel of KERNELS) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k += 1) {
          const at = i + k - HALF_TAPS + 1;
          if (at >= 0 && at < channel.length) sum += channel[at] * kernel[k];
        }
        peak = Math.max(peak, Math.abs(sum));
      }
    }
  }
  return peak;
}
