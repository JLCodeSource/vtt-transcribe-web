import { EngineError, type Progress, type Segment } from './types';
import { languageName } from './languages';

export interface TranslateOptions {
  /** language the audio was spoken in (ISO-639-1), when known */
  from?: string;
  to: string;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

/** Returns one translated string per input segment, same order. */
export interface Translator {
  translate(segments: Segment[], options: TranslateOptions): Promise<string[]>;
}

export const BATCH_SIZE = 40;

/** Parse `LINE_3: text` replies into an index → text map. Tolerates blank lines and wrapped text. */
export function parseBatch(reply: string): Map<number, string> {
  const out = new Map<number, string>();
  let cur = -1;
  for (const raw of reply.split(/\r?\n/)) {
    const m = raw.match(/^\s*LINE_(\d+):\s*(.*)$/);
    if (m) {
      cur = Number(m[1]);
      out.set(cur, m[2].trim());
    } else if (cur >= 0 && raw.trim()) {
      out.set(cur, `${out.get(cur)} ${raw.trim()}`.trim());
    }
  }
  return out;
}

export interface OpenAITranslatorOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/** Translates with an OpenAI chat model, in numbered batches (same approach as the Python CLI). */
export class OpenAITranslator implements Translator {
  constructor(private readonly cfg: OpenAITranslatorOptions) {}

  async translate(segments: Segment[], o: TranslateOptions): Promise<string[]> {
    if (!this.cfg.apiKey.trim()) throw new EngineError('Enter your OpenAI API key first.', 'auth');
    const out: string[] = new Array(segments.length).fill('');
    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      if (o.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      o.onProgress?.({
        phase: 'transcribe',
        fraction: i / segments.length,
        message: `Translating to ${languageName(o.to)}… ${i} of ${segments.length}`,
      });
      const batch = segments.slice(i, i + BATCH_SIZE);
      const reply = await this.chat(batch, o);
      const parsed = parseBatch(reply);
      batch.forEach((s, k) => {
        // fall back to the original line rather than lose it
        out[i + k] = parsed.get(k) || s.text;
      });
    }
    o.onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
    return out;
  }

  private async chat(batch: Segment[], o: TranslateOptions): Promise<string> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.cfg.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey.trim()}`, 'Content-Type': 'application/json' },
        signal: o.signal,
        body: JSON.stringify({
          model: this.cfg.model ?? 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                `You are a translator. Translate each line to ${languageName(o.to)}. ` +
                'Keep each line separate and preserve the LINE_N: prefix for each line. ' +
                'Return only the translations with their LINE_N: prefixes, no explanations.',
            },
            { role: 'user', content: batch.map((s, k) => `LINE_${k}: ${s.text.replace(/\s*\n\s*/g, ' ')}`).join('\n') },
          ],
        }),
      });
    } catch {
      if (o.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      throw new EngineError('Could not reach OpenAI. Check your connection and that the API key is valid.', 'network');
    }
    if (res.status === 401) throw new EngineError('OpenAI rejected the API key (401).', 'auth');
    if (res.status === 429) throw new EngineError('OpenAI rate limit or quota reached (429).', 'rate-limit');
    if (!res.ok) throw new EngineError(`OpenAI error ${res.status} while translating.`, 'bad-request');
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? '';
  }
}

// ---- on-device ---------------------------------------------------------------------------

/** Translate an array of strings with one Opus-MT pair model (e.g. 'en-fr'). */
export type PairTranslate = ((texts: string[]) => Promise<string[]>) & { dispose?: () => Promise<void> | void };
export interface PairRequest {
  pair: string; // 'en-fr'
  onFile: (file: string, fraction: number | null) => void;
}
export type PairFactory = (req: PairRequest) => Promise<PairTranslate>;

export const defaultPairFactory: PairFactory = async ({ pair, onFile }) => {
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  tf.env.backends.onnx.wasm!.wasmPaths = new URL('ort/', document.baseURI).href;
  const t = await tf.pipeline('translation', `Xenova/opus-mt-${pair}`, {
    dtype: 'q8',
    progress_callback: (e: { status: string; file?: string; progress?: number }) => {
      if (e.status === 'progress' && e.file) onFile(e.file, (e.progress ?? 0) / 100);
    },
  } as never);
  const run: PairTranslate = async (texts) => {
    const res = (await (t as unknown as (x: string[], o: object) => Promise<Array<{ translation_text: string }>>)(texts, {
      max_new_tokens: 256,
    })) as Array<{ translation_text: string }>;
    return res.map((r) => r.translation_text);
  };
  run.dispose = () => (t as unknown as { dispose(): Promise<void> }).dispose();
  return run;
};

/**
 * Translates on this device with small Opus-MT models (~75 MB per direction). Pairs that do not
 * involve English are routed through English (two hops).
 */
export class LocalTranslator implements Translator {
  private readonly cache = new Map<string, Promise<PairTranslate>>();
  constructor(private readonly factory: PairFactory = globalFactory() ?? defaultPairFactory) {}

  async translate(segments: Segment[], o: TranslateOptions): Promise<string[]> {
    const from = !o.from || o.from === 'auto' ? 'en' : o.from;
    if (from === o.to) return segments.map((s) => s.text);
    const hops: string[] = from === 'en' || o.to === 'en' ? [`${from}-${o.to}`] : [`${from}-en`, `en-${o.to}`];
    let texts = segments.map((s) => s.text);
    for (let h = 0; h < hops.length; h++) {
      const run = await this.pair(hops[h], o);
      const out: string[] = [];
      for (let i = 0; i < texts.length; i += 8) {
        if (o.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
        o.onProgress?.({
          phase: 'transcribe',
          fraction: (h + i / texts.length) / hops.length,
          message: `Translating to ${languageName(o.to)}… ${i} of ${texts.length}`,
        });
        out.push(...(await run(texts.slice(i, i + 8))));
      }
      texts = out;
    }
    o.onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
    return texts;
  }

  /** Free the translation models' memory. */
  async dispose(): Promise<void> {
    const all = [...this.cache.values()];
    this.cache.clear();
    for (const p of all) {
      try {
        await (await p)?.dispose?.();
      } catch {
        /* ignore */
      }
    }
  }

  private pair(pair: string, o: TranslateOptions): Promise<PairTranslate> {
    let p = this.cache.get(pair);
    if (!p) {
      const files = new Map<string, number>();
      o.onProgress?.({ phase: 'download', fraction: 0, message: `Loading translation model ${pair} (≈ 75 MB, cached after first use)…` });
      p = this.factory({
        pair,
        onFile: (f, frac) => {
          if (frac != null) files.set(f, frac);
          const v = [...files.values()];
          const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
          o.onProgress?.({ phase: 'download', fraction: avg, message: `Downloading translation model… ${avg == null ? '' : Math.round(avg * 100) + '%'}` });
        },
      }).catch((e: unknown) => {
        this.cache.delete(pair);
        throw new EngineError(
          `No on-device translation model for ${pair.replace('-', ' → ')} could be loaded (${e instanceof Error ? e.message : String(e)}). Try OpenAI mode, which supports every language.`,
          'engine'
        );
      });
      this.cache.set(pair, p);
    }
    return p;
  }
}

function globalFactory(): PairFactory | undefined {
  return (globalThis as { __VTT_TRANSLATE_FACTORY__?: PairFactory }).__VTT_TRANSLATE_FACTORY__;
}
