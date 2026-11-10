import { describe, expect, it, vi } from 'vitest';
import { LocalTranslator, OpenAITranslator, parseBatch } from '../lib/translate';
import { toSrt, toTxt, view } from '../lib/format';

const segs = [{ start: 0, end: 1, text: 'Hello' }, { start: 1, end: 2, text: 'Goodbye' }];

describe('parseBatch', () => {
  it('parses numbered lines and wrapped text', () => {
    const m = parseBatch('LINE_0: Hola\nLINE_1: Adiós\nmuy pronto\n');
    expect(m.get(0)).toBe('Hola');
    expect(m.get(1)).toBe('Adiós muy pronto');
  });
});

describe('OpenAITranslator', () => {
  const reply = (content: string, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
  it('translates and keeps order', async () => {
    const f = reply('LINE_0: Hola\nLINE_1: Adiós');
    const out = await new OpenAITranslator({ apiKey: 'k', fetchImpl: f }).translate(segs, { to: 'es' });
    expect(out).toEqual(['Hola', 'Adiós']);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toContain('Spanish');
  });
  it('falls back to the original line when the model drops one', async () => {
    const out = await new OpenAITranslator({ apiKey: 'k', fetchImpl: reply('LINE_0: Hola') }).translate(segs, { to: 'es' });
    expect(out).toEqual(['Hola', 'Goodbye']);
  });
  it('reports a bad key', async () => {
    await expect(new OpenAITranslator({ apiKey: 'k', fetchImpl: reply('', 401) }).translate(segs, { to: 'es' })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('LocalTranslator', () => {
  it('uses one hop with English and two hops otherwise', async () => {
    const pairs: string[] = [];
    const t = new LocalTranslator(async ({ pair }) => {
      pairs.push(pair);
      return async (xs) => xs.map((x) => `${pair}:${x}`);
    });
    expect(await t.translate(segs, { from: 'en', to: 'fr' })).toEqual(['en-fr:Hello', 'en-fr:Goodbye']);
    expect(await t.translate([segs[0]], { from: 'de', to: 'fr' })).toEqual(['en-fr:de-en:Hello']);
    expect(pairs).toEqual(['en-fr', 'de-en']);
  });
  it('explains a missing pair', async () => {
    const t = new LocalTranslator(async () => { throw new Error('404'); });
    await expect(t.translate(segs, { from: 'en', to: 'ja' })).rejects.toThrow(/OpenAI mode/);
  });
});

describe('exports with speakers and translation', () => {
  const s = [{ start: 0, end: 1, text: 'Hello', translation: 'Hola', speaker: 'Ada' }];
  it('prefixes the speaker and swaps in the translation', () => {
    expect(toTxt(view(s, true))).toBe('Ada: Hola\n');
    expect(toTxt(view(s, false))).toBe('Ada: Hello\n');
    expect(toSrt(view(s, true))).toContain('Ada: Hola');
  });
});
