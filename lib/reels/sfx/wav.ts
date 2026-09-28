/**
 * Minimal WAV reader. Pure, so the frame test can read the finished files
 * offline with no ffmpeg. Handles integer PCM (16, 24, 32 bit), 32-bit float,
 * and the extensible header those formats sometimes carry.
 */
export type Wav = {
  sampleRate: number;
  bitDepth: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
};

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export function readWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file.');
  }

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let data: { offset: number; length: number } | null = null;

  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitDepth = view.getUint16(body + 14, true);
      // Extensible headers carry the real format in the first two bytes of the subformat GUID.
      if (format === FORMAT_EXTENSIBLE && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, bytes.byteLength - body) };
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }

  if (!format || !channelCount || !sampleRate) throw new Error('WAV has no fmt chunk.');
  if (!data) throw new Error('WAV has no data chunk.');
  const isFloat = format === FORMAT_FLOAT;
  if (!(format === FORMAT_PCM && [16, 24, 32].includes(bitDepth)) && !(isFloat && bitDepth === 32)) {
    throw new Error(`Unsupported WAV format ${format} at ${bitDepth} bit.`);
  }

  const bytesPerSample = bitDepth / 8;
  const frameCount = Math.floor(data.length / (bytesPerSample * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const offset = data.offset + (frame * channelCount + channel) * bytesPerSample;
      channels[channel][frame] = readSample(view, offset, bitDepth, isFloat);
    }
  }
  return { sampleRate, bitDepth, channels };
}

function readSample(view: DataView, offset: number, bitDepth: number, isFloat: boolean): number {
  if (isFloat) return view.getFloat32(offset, true);
  if (bitDepth === 16) return view.getInt16(offset, true) / 32768;
  if (bitDepth === 32) return view.getInt32(offset, true) / 2147483648;
  const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
  return value / 8388608;
}

/** 16-bit PCM writer, used by tests to build fixtures and by later stages. */
export function writeWav16(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const dataLength = frameCount * channelCount * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(44 + (frame * channelCount + channel) * 2, Math.round(sample * 32767), true);
    }
  }
  return bytes;
}
