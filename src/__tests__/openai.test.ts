import { describe, expect, it, vi } from 'vitest';
import { OpenAIEngine, MAX_DIRECT_BYTES } from '../lib/openai';
import { EngineError } from '../lib/types';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const FAKE = 'sk-test-fake-key';

describe('OpenAIEngine', () => {
  it('posts a small file directly with verbose_json + bearer key', async () => {
    const f = vi.fn().mockResolvedValue(ok({ segments: [{ start: 0, end: 1, text: ' hi ' }] }));
    const e = new OpenAIEngine({ apiKey: FAKE, fetchImpl: f, baseUrl: 'http://x/v1' });
    const out = await e.transcribe(new File(['abc'], 'a.mp3', { type: 'audio/mpeg' }), { language: 'fr' });
    expect(out).toEqual([{ start: 0, end: 1, text: 'hi' }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://x/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE}`);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('timestamp_granularities[]')).toBe('segment');
    expect(form.get('language')).toBe('fr');
    expect((form.get('file') as File).name).toBe('a.mp3');
  });

  it('omits language for auto', async () => {
    const f = vi.fn().mockResolvedValue(ok({ segments: [] }));
    await new OpenAIEngine({ apiKey: FAKE, fetchImpl: f }).transcribe(new Blob(['x']), { language: 'auto' });
    expect((f.mock.calls[0][1].body as FormData).has('language')).toBe(false);
  });

  it('falls back to plain text when no segments are returned', async () => {
    const f = vi.fn().mockResolvedValue(ok({ text: ' yo ', duration: 4 }));
    const out = await new OpenAIEngine({ apiKey: FAKE, fetchImpl: f }).transcribe(new Blob(['x']));
    expect(out).toEqual([{ start: 0, end: 4, text: 'yo' }]);
  });

  it('chunks big files and offsets timestamps', async () => {
    const f = vi.fn().mockImplementation(async () => ok({ segments: [{ start: 1, end: 2, text: 'a' }] }));
    const decode = vi.fn().mockResolvedValue(new Float32Array(16000 * 1300)); // 3 chunks of ≤600 s
    const big = new Blob([new Uint8Array(MAX_DIRECT_BYTES + 1)]);
    const prog = vi.fn();
    const out = await new OpenAIEngine({ apiKey: FAKE, fetchImpl: f, decode }).transcribe(big, { onProgress: prog });
    expect(f).toHaveBeenCalledTimes(3);
    expect(out.map((s) => s.start)).toEqual([1, 601, 1201]);
    expect(prog).toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [413, 'bad-request'],
    [500, 'bad-request'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'm' } }), { status }));
    await expect(new OpenAIEngine({ apiKey: FAKE, fetchImpl: f }).transcribe(new Blob(['x']))).rejects.toMatchObject({ kind });
  });

  it('reports opaque network/CORS failures as network errors', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(new OpenAIEngine({ apiKey: FAKE, fetchImpl: f }).transcribe(new Blob(['x']))).rejects.toMatchObject({ kind: 'network' });
  });

  it('requires a key and never sends anything without one', async () => {
    const f = vi.fn();
    await expect(new OpenAIEngine({ apiKey: '  ', fetchImpl: f }).transcribe(new Blob(['x']))).rejects.toBeInstanceOf(EngineError);
    expect(f).not.toHaveBeenCalled();
  });

  it('only ever contacts the configured base URL', async () => {
    const f = vi.fn().mockResolvedValue(ok({ segments: [] }));
    await new OpenAIEngine({ apiKey: FAKE, fetchImpl: f }).transcribe(new Blob(['x']));
    expect(f.mock.calls.every(([u]) => String(u).startsWith('https://api.openai.com/'))).toBe(true);
  });
});
