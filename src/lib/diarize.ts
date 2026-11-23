import { EngineError, type Progress } from './types';
import { chunkPcm } from './audio';
import { clusterEmbeddings, normalise, type Turn } from './speakers';

/** pyannote-segmentation-3.0 (ONNX, ~6 MB) finds who-speaks-when; WavLM x-vector (~95 MB) says who. */
export const SEGMENTATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
export const EMBEDDING_MODEL = 'Xenova/wavlm-base-plus-sv';
export const DIARIZE_DOWNLOAD = '≈ 100 MB, cached after first use';

/** Audio is segmented in windows of this length. */
const WINDOW_SECONDS = 30;
const MIN_TURN_SECONDS = 0.6;
const MAX_EMBED_SECONDS = 12;
const SAMPLE_RATE = 16000;
/** Cosine-distance stop point for automatic speaker counting. */
export const DEFAULT_THRESHOLD = 0.2;

export interface RawSpan {
  start: number;
  end: number;
  /** local speaker class within the window; spans are only joined when this matches */
  id?: number;
}

/** The two model calls, behind an interface so tests can stub them. */
export interface DiarizeModels {
  /** Speech spans (seconds, relative to the window) found in this audio. */
  speechSpans(samples: Float32Array): Promise<RawSpan[]>;
  /** Voice embedding for this audio. */
  embed(samples: Float32Array): Promise<Float32Array>;
  /** release the models' memory */
  dispose?(): Promise<void> | void;
}

export interface ModelRequest {
  onFile: (file: string, fraction: number | null) => void;
}
export type ModelsFactory = (req: ModelRequest) => Promise<DiarizeModels>;

export const defaultModelsFactory: ModelsFactory = async ({ onFile }) => {
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  tf.env.backends.onnx.wasm!.wasmPaths = new URL('ort/', document.baseURI).href;
  const progress_callback = (e: { status: string; file?: string; progress?: number }) => {
    if (e.status === 'progress' && e.file) onFile(e.file, (e.progress ?? 0) / 100);
    else if (e.status === 'initiate' && e.file) onFile(e.file, 0);
  };
  const [segProc, segModel, embProc, embModel] = await Promise.all([
    tf.AutoProcessor.from_pretrained(SEGMENTATION_MODEL, { progress_callback }),
    tf.AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, { dtype: 'q8', progress_callback }),
    tf.AutoProcessor.from_pretrained(EMBEDDING_MODEL, { progress_callback }),
    tf.AutoModel.from_pretrained(EMBEDDING_MODEL, { dtype: 'q8', progress_callback } as never),
  ]);
  return {
    async speechSpans(samples) {
      const inputs = await segProc(samples);
      const { logits } = await segModel(inputs);
      const res = (
        segProc as unknown as {
          post_process_speaker_diarization(
            l: unknown,
            n: number,
          ): Array<Array<{ id: number; start: number; end: number }>>;
        }
      ).post_process_speaker_diarization(logits, samples.length);
      // class 0 is silence; 1-3 single speakers; 4-6 overlaps. Everything but 0 is speech.
      return res[0].filter((s) => s.id !== 0).map((s) => ({ start: s.start, end: s.end, id: s.id }));
    },
    async embed(samples) {
      const inputs = await embProc(samples);
      const { embeddings } = await embModel(inputs);
      return Float32Array.from(embeddings.data as ArrayLike<number>);
    },
    async dispose() {
      await Promise.all([segModel, embModel].map((m) => (m as unknown as { dispose(): Promise<void> }).dispose()));
    },
  };
};

export interface DiarizeOptions {
  /** If known, cluster to exactly this many speakers. Otherwise count is detected. */
  speakers?: number;
  threshold?: number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

/** Join same-class spans of one window that are within `gap` seconds into single stretches. */
export function mergeSpans(spans: RawSpan[], gap = 0.3): RawSpan[] {
  const out: RawSpan[] = [];
  for (const s of spans.slice().sort((a, b) => a.start - b.start)) {
    const last = [...out].reverse().find((o) => o.id === s.id);
    if (last && s.start - last.end <= gap) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export class Diarizer {
  private models?: Promise<DiarizeModels>;
  constructor(private readonly factory?: ModelsFactory) {}

  async run(pcm: Float32Array, options: DiarizeOptions = {}): Promise<Turn[]> {
    const { onProgress, signal } = options;
    const models = await this.load(onProgress);

    // 1. who-speaks-when, window by window
    const spans: RawSpan[] = [];
    const windows = chunkPcm(pcm, WINDOW_SECONDS);
    for (let i = 0; i < windows.length; i++) {
      if (signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      onProgress?.({
        phase: 'transcribe',
        fraction: (i / windows.length) * 0.5,
        message: `Finding speech ${i + 1} of ${windows.length}…`,
      });
      for (const s of mergeSpans(await models.speechSpans(windows[i].samples))) {
        spans.push({ start: s.start + windows[i].offset, end: s.end + windows[i].offset });
      }
    }
    const stretches = spans.sort((a, b) => a.start - b.start).filter((s) => s.end - s.start >= MIN_TURN_SECONDS);
    if (!stretches.length) return [];

    // 2. a voice fingerprint per stretch
    const embs: Float32Array[] = [];
    for (let i = 0; i < stretches.length; i++) {
      if (signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      onProgress?.({
        phase: 'transcribe',
        fraction: 0.5 + (i / stretches.length) * 0.45,
        message: `Identifying voices ${i + 1} of ${stretches.length}…`,
      });
      const a = Math.floor(stretches[i].start * SAMPLE_RATE);
      const b = Math.min(
        pcm.length,
        Math.floor(Math.min(stretches[i].end, stretches[i].start + MAX_EMBED_SECONDS) * SAMPLE_RATE),
      );
      embs.push(normalise(await models.embed(pcm.subarray(a, b))));
    }

    // 3. group voices into speakers
    onProgress?.({ phase: 'transcribe', fraction: 0.97, message: 'Grouping speakers…' });
    const labels = clusterEmbeddings(embs, {
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      count: options.speakers,
    });
    const turns: Turn[] = stretches.map((s, i) => ({
      start: s.start,
      end: s.end,
      embedding: embs[i],
      speaker: labels[i],
    }));
    onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
    return turns;
  }

  /** Free the speaker models' memory. */
  async dispose(): Promise<void> {
    const m = this.models;
    this.models = undefined;
    try {
      await (await m)?.dispose?.();
    } catch {
      /* ignore */
    }
  }

  private load(onProgress?: (p: Progress) => void): Promise<DiarizeModels> {
    if (this.models) return this.models;
    const files = new Map<string, number>();
    const factory = this.factory ?? globalFactoryOverride() ?? defaultModelsFactory;
    onProgress?.({ phase: 'download', fraction: 0, message: `Loading speaker models (${DIARIZE_DOWNLOAD})…` });
    this.models = factory({
      onFile: (file, frac) => {
        if (frac != null) files.set(file, frac);
        const v = [...files.values()];
        const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        onProgress?.({
          phase: 'download',
          fraction: avg,
          message: `Downloading speaker models… ${avg == null ? '' : Math.round(avg * 100) + '%'}`,
        });
      },
    }).catch((e: unknown) => {
      this.models = undefined;
      throw new EngineError(
        `Could not load the speaker models: ${e instanceof Error ? e.message : String(e)}`,
        'engine',
      );
    });
    return this.models;
  }
}

/** Test seam, like the Whisper one. */
function globalFactoryOverride(): ModelsFactory | undefined {
  return (globalThis as { __VTT_DIARIZE_FACTORY__?: ModelsFactory }).__VTT_DIARIZE_FACTORY__;
}
