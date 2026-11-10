import { describe, expect, it } from 'vitest';
import { chunkPcm, encodeWav } from '../lib/audio';

describe('chunkPcm', () => {
  it('splits into windows with offsets', () => {
    const pcm = new Float32Array(16000 * 25);
    const c = chunkPcm(pcm, 10);
    expect(c.map((x) => x.offset)).toEqual([0, 10, 20]);
    expect(c.map((x) => x.samples.length)).toEqual([160000, 160000, 80000]);
  });
  it('empty input yields no chunks', () => {
    expect(chunkPcm(new Float32Array(0), 10)).toEqual([]);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit header and clamps samples', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 8);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767); // clamped
  });
});
