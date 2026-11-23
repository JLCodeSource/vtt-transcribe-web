import { describe, expect, it, vi } from 'vitest';
import { LocalEngine, type PipelineFactory } from '../lib/local';

const pcm = () => Promise.resolve(new Float32Array(16000 * 65)); // 3 windows

function stub() {
  const asr = vi
    .fn()
    .mockResolvedValueOnce({ text: 'a', chunks: [{ text: ' one ', timestamp: [0, 2] }] })
    .mockResolvedValueOnce({ text: 'b', chunks: [{ text: 'two', timestamp: [1, null] }] })
    .mockResolvedValueOnce({ text: ' tail ' });
  const factory: PipelineFactory = vi.fn(async ({ onFile }) => {
    onFile('encoder.onnx', 0.5);
    onFile('decoder.onnx', 1);
    return asr;
  });
  return { asr, factory };
}

describe('LocalEngine', () => {
  it('transcribes windows, offsets timestamps, reports progress and lazy-loads once', async () => {
    const { asr, factory } = stub();
    const e = new LocalEngine({ factory, decode: pcm, device: 'wasm', model: 'tiny' });
    const prog = vi.fn();
    const out = await e.transcribe(new Blob(['x']), { onProgress: prog, language: 'de' });
    expect(out).toEqual([
      { start: 0, end: 2, text: 'one' },
      { start: 31, end: 60, text: 'two' }, // null end → window end
      { start: 60, end: 65, text: 'tail' }, // no chunks → window text
    ]);
    expect(asr.mock.calls[0][1]).toMatchObject({ return_timestamps: true, language: 'de' });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ hfId: 'onnx-community/whisper-tiny', device: 'wasm' }),
    );
    const phases = prog.mock.calls.map((c) => c[0].phase);
    expect(phases).toContain('download');
    expect(phases).toContain('transcribe');
    expect(prog.mock.calls.at(-1)![0].fraction).toBe(1);
    asr.mockResolvedValue({ text: '', chunks: [] });
    await e.transcribe(new Blob(['x']));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('omits language when auto', async () => {
    const { asr, factory } = stub();
    await new LocalEngine({ factory, decode: pcm, device: 'wasm' }).transcribe(new Blob(['x']), { language: 'auto' });
    expect(asr.mock.calls[0][1]).not.toHaveProperty('language');
  });

  it('falls back from WebGPU to WASM when the GPU model fails to load', async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('no adapter'))
      .mockResolvedValueOnce(vi.fn().mockResolvedValue({ text: 'ok' }));
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
    const e = new LocalEngine({ factory, decode: () => Promise.resolve(new Float32Array(100)) });
    const out = await e.transcribe(new Blob(['x']));
    expect(out[0].text).toBe('ok');
    expect(factory.mock.calls.map((c) => c[0].device)).toEqual(['webgpu', 'wasm']);
    expect(e.device).toBe('wasm');
    vi.unstubAllGlobals();
  });

  it('skips WebGPU when no adapter is available', async () => {
    const factory = vi.fn().mockResolvedValue(vi.fn().mockResolvedValue({ text: 'ok' }));
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
    const e = new LocalEngine({ factory, decode: () => Promise.resolve(new Float32Array(100)) });
    await e.transcribe(new Blob(['x']));
    expect(factory.mock.calls.map((c) => c[0].device)).toEqual(['wasm']);
    vi.unstubAllGlobals();
  });

  it('surfaces load failure as EngineError', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(new LocalEngine({ factory, decode: pcm, device: 'wasm' }).transcribe(new Blob(['x']))).rejects.toThrow(
      /boom/,
    );
  });

  it('stops when aborted', async () => {
    const { factory } = stub();
    const ac = new AbortController();
    ac.abort();
    await expect(
      new LocalEngine({ factory, decode: pcm, device: 'wasm' }).transcribe(new Blob(['x']), { signal: ac.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  describe('language detection', () => {
    const mk = (detect: (a: Float32Array) => Promise<string>) => {
      const asr = Object.assign(
        vi.fn().mockResolvedValue({ text: 'x', chunks: [{ text: 'bonjour', timestamp: [0, 1] }] }),
        {
          detectLanguage: vi.fn(detect),
        },
      );
      return { asr, factory: vi.fn().mockResolvedValue(asr) as unknown as PipelineFactory };
    };

    it('detects the language when set to auto and uses it for every window', async () => {
      const { asr, factory } = mk(async () => 'fr');
      const e = new LocalEngine({ factory, decode: pcm, device: 'wasm' });
      await e.transcribe(new Blob(['x']), { language: 'auto' });
      expect(asr.detectLanguage).toHaveBeenCalledTimes(1);
      expect(e.detectedLanguage).toBe('fr');
      expect(asr.mock.calls.every((c) => c[1].language === 'fr')).toBe(true);
    });

    it('does not detect when the user picked a language', async () => {
      const { asr, factory } = mk(async () => 'fr');
      const e = new LocalEngine({ factory, decode: pcm, device: 'wasm' });
      await e.transcribe(new Blob(['x']), { language: 'de' });
      expect(asr.detectLanguage).not.toHaveBeenCalled();
      expect(e.detectedLanguage).toBeUndefined();
      expect(asr.mock.calls[0][1].language).toBe('de');
    });

    it('falls back to the model default if detection throws', async () => {
      const { asr, factory } = mk(async () => {
        throw new Error('boom');
      });
      const e = new LocalEngine({ factory, decode: pcm, device: 'wasm' });
      await e.transcribe(new Blob(['x']));
      expect(e.detectedLanguage).toBeUndefined();
      expect(asr.mock.calls[0][1]).not.toHaveProperty('language');
    });
  });
});
