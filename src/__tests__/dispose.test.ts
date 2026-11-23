import { describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../lib/local';
import { LocalTranslator } from '../lib/translate';
import { Diarizer } from '../lib/diarize';

describe('models are freed so long queues do not exhaust memory', () => {
  it('LocalEngine.dispose releases the pipeline and the next load builds a fresh one', async () => {
    const dispose = vi.fn();
    const factory = vi.fn(async () =>
      Object.assign(async () => ({ text: 'x', chunks: [{ text: 'x', timestamp: [0, 1] as [number, number] }] }), {
        dispose,
      }),
    );
    const e = new LocalEngine({ factory, decode: async () => new Float32Array(16000), device: 'wasm' });
    await e.transcribe(new Blob(['x']), { language: 'en' });
    await e.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await e.transcribe(new Blob(['x']), { language: 'en' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('LocalTranslator.dispose releases every pair model, even for a two-hop translation', async () => {
    const disposed: string[] = [];
    const t = new LocalTranslator(async ({ pair }) =>
      Object.assign(async (x: string[]) => x, { dispose: () => void disposed.push(pair) }),
    );
    await t.translate([{ start: 0, end: 1, text: 'hola' }], { from: 'es', to: 'fr' });
    await t.dispose();
    expect(disposed.sort()).toEqual(['en-fr', 'es-en']);
  });

  it('Diarizer.dispose releases the speaker models', async () => {
    const dispose = vi.fn();
    const d = new Diarizer(async () => ({
      speechSpans: async () => [{ start: 0, end: 3 }],
      embed: async () => Float32Array.from([1, 0]),
      dispose,
    }));
    await d.run(new Float32Array(16000 * 4), {});
    await d.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
