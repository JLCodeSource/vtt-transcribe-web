import { EngineError } from './types';

export const TARGET_RATE = 16000;

/**
 * Decode any browser-playable audio/video file to mono Float32 PCM at 16 kHz.
 * Uses the Web Audio API (no ffmpeg): works for mp3/wav/ogg/m4a/webm/mp4 where the
 * browser can decode the audio track. Whole file is decoded in memory.
 */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const Ctx: typeof AudioContext | undefined =
    globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') {
    throw new EngineError('This browser cannot decode audio (Web Audio API missing).', 'decode');
  }
  let decoded: AudioBuffer;
  const ctx = new Ctx();
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new EngineError(
      'This browser could not decode that file. Try mp3, wav, m4a, ogg or webm/mp4 with an audio track.',
      'decode'
    );
  } finally {
    void ctx.close();
  }
  // Resample + downmix in one pass using an OfflineAudioContext at the target rate.
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Split PCM into consecutive windows of at most `seconds`. Returns [offsetSeconds, samples]. */
export function chunkPcm(
  pcm: Float32Array,
  seconds: number,
  rate = TARGET_RATE
): Array<{ offset: number; samples: Float32Array }> {
  const size = Math.max(1, Math.floor(seconds * rate));
  const out: Array<{ offset: number; samples: Float32Array }> = [];
  for (let i = 0; i < pcm.length; i += size) {
    out.push({ offset: i / rate, samples: pcm.subarray(i, Math.min(i + size, pcm.length)) });
  }
  return out;
}

/** 16-bit PCM mono WAV (32 KB per second at 16 kHz: 10 min ≈ 19 MB, under OpenAI's 25 MB cap). */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
