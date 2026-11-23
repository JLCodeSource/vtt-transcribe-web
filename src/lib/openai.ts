import { EngineError, type Engine, type Segment, type TranscribeOptions } from './types';
import { chunkPcm, decodeToMono16k, encodeWav } from './audio';

/** OpenAI's hard upload limit is 25 MB; stay under it. */
export const MAX_DIRECT_BYTES = 24 * 1024 * 1024;
/** 10 min of 16 kHz mono WAV ≈ 19 MB. */
export const CHUNK_SECONDS = 600;

export interface OpenAIOptions {
  apiKey: string;
  /** Override for tests / proxies. Defaults to https://api.openai.com/v1 */
  baseUrl?: string;
  /** `whisper-1` is the OpenAI model that supports verbose_json segment timestamps. */
  model?: string;
  fetchImpl?: typeof fetch;
  decode?: (b: Blob) => Promise<Float32Array>;
  /** Files above this are chunked. Defaults to MAX_DIRECT_BYTES. */
  maxDirectBytes?: number;
  chunkSeconds?: number;
}

/** Test seam: e2e lowers the limits so a tiny file exercises the real decode/chunk path. */
function limitsOverride(): { maxDirectBytes?: number; chunkSeconds?: number } {
  return (
    (globalThis as { __VTT_OPENAI_LIMITS__?: { maxDirectBytes?: number; chunkSeconds?: number } })
      .__VTT_OPENAI_LIMITS__ ?? {}
  );
}

interface VerboseJson {
  segments?: Array<{ start: number; end: number; text: string }>;
  text?: string;
  duration?: number;
}

export class OpenAIEngine implements Engine {
  constructor(private readonly cfg: OpenAIOptions) {}

  async transcribe(audio: Blob, options: TranscribeOptions = {}): Promise<Segment[]> {
    if (!this.cfg.apiKey.trim()) throw new EngineError('Enter your OpenAI API key first.', 'auth');
    const decode = this.cfg.decode ?? decodeToMono16k;

    // Small files go up untouched (best quality, no decoding). Big ones are decoded and chunked.
    const lim = limitsOverride();
    const maxDirect = this.cfg.maxDirectBytes ?? lim.maxDirectBytes ?? MAX_DIRECT_BYTES;
    const chunkSeconds = this.cfg.chunkSeconds ?? lim.chunkSeconds ?? CHUNK_SECONDS;
    if (audio.size <= maxDirect) {
      options.onProgress?.({ phase: 'transcribe', fraction: 0, message: 'Uploading to OpenAI…' });
      const segs = await this.request(audio, 'audio', options);
      options.onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
      return segs;
    }

    options.onProgress?.({ phase: 'decode', fraction: null, message: 'Preparing audio in your browser…' });
    const chunks = chunkPcm(await decode(audio), chunkSeconds);
    const out: Segment[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (options.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      options.onProgress?.({
        phase: 'transcribe',
        fraction: i / chunks.length,
        message: `Transcribing part ${i + 1} of ${chunks.length}…`,
      });
      const segs = await this.request(encodeWav(chunks[i].samples), `part${i}.wav`, options);
      for (const s of segs) out.push({ ...s, start: s.start + chunks[i].offset, end: s.end + chunks[i].offset });
    }
    options.onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
    return out;
  }

  private async request(file: Blob, name: string, options: TranscribeOptions): Promise<Segment[]> {
    const form = new FormData();
    const filename = file instanceof File ? file.name : name.includes('.') ? name : `${name}.${extFor(file.type)}`;
    form.append('file', file, filename);
    form.append('model', this.cfg.model ?? 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (options.language && options.language !== 'auto') form.append('language', options.language);

    const doFetch = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.cfg.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey.trim()}` },
        body: form,
        signal: options.signal,
      });
    } catch (e) {
      if (options.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      // OpenAI omits CORS headers on some error responses (e.g. 401), which browsers report as
      // an opaque network failure. A wrong/expired key is the most common cause.
      throw new EngineError('Could not reach OpenAI. Check your connection and that the API key is valid.', 'network');
    }
    if (!res.ok) throw await toError(res);
    const body = (await res.json()) as VerboseJson;
    if (body.segments?.length) {
      return body.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
    }
    // Silent/very short audio can return text without segments.
    return body.text?.trim() ? [{ start: 0, end: body.duration ?? 0, text: body.text.trim() }] : [];
  }
}

function extFor(mime: string): string {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  return 'mp3';
}

async function toError(res: Response): Promise<EngineError> {
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401) return new EngineError('OpenAI rejected the API key (401). Check it and try again.', 'auth');
  if (res.status === 429)
    return new EngineError(`OpenAI rate limit or quota reached (429). ${detail}`.trim(), 'rate-limit');
  if (res.status === 413) return new EngineError('OpenAI says the file is too large (413).', 'bad-request');
  return new EngineError(`OpenAI error ${res.status}. ${detail}`.trim(), 'bad-request');
}
