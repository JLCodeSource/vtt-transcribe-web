import { EngineError, type Engine, type Segment, type TranscribeOptions } from './types';
import { chunkPcm, decodeToMono16k } from './audio';

export interface LocalModel {
  id: string;
  label: string;
  hfId: string;
  /** approximate download size for the quantised weights, shown to the user */
  size: string;
  /** larger weights are fetched when running on WebGPU */
  gpuSize: string;
  note: string;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'tiny',
    label: 'Tiny',
    hfId: 'onnx-community/whisper-tiny',
    size: '≈ 40 MB',
    gpuSize: '≈ 120 MB',
    note: 'Fastest, roughest. Fine for clear speech.',
  },
  {
    id: 'base',
    label: 'Base',
    hfId: 'onnx-community/whisper-base',
    size: '≈ 80 MB',
    gpuSize: '≈ 205 MB',
    note: 'Good balance for clear audio.',
  },
  {
    id: 'small',
    label: 'Small',
    hfId: 'onnx-community/whisper-small',
    size: '≈ 250 MB',
    gpuSize: '≈ 585 MB',
    note: 'Noticeably better, much slower.',
  },
];

/** Window fed to Whisper. Whisper itself sees 30 s at a time. */
export const WINDOW_SECONDS = 30;

type AsrOutput = { text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> };
export type AsrPipeline = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>) & {
  /** Whisper language ID: one decoder step over the first 30 s, argmax over the language tokens. */
  detectLanguage?: (audio30s: Float32Array) => Promise<string>;
  /** release the model's memory (WASM heap / GPU buffers) */
  dispose?: () => Promise<void> | void;
};

export interface PipelineRequest {
  hfId: string;
  device: 'webgpu' | 'wasm';
  onFile: (file: string, fraction: number | null) => void;
}
export type PipelineFactory = (req: PipelineRequest) => Promise<AsrPipeline>;

type GpuNav = { gpu?: { requestAdapter(): Promise<unknown> } };

/** navigator.gpu can exist while no adapter is available (e.g. headless/VMs), so probe it. */
export async function webGpuUsable(): Promise<boolean> {
  try {
    return !!(await (navigator as unknown as GpuNav).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/** Cheap synchronous hint for UI copy. */
export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as GpuNav).gpu;
}

/** Lazy-loads transformers.js (a separate chunk) only when the on-device engine is used. */
export const defaultFactory: PipelineFactory = async ({ hfId, device, onFile }) => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  // Serve ONNX Runtime wasm from this origin (public/ort), never from a CDN.
  env.backends.onnx.wasm!.wasmPaths = new URL('ort/', document.baseURI).href;
  const dtype =
    device === 'webgpu'
      ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
      : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  const asr = await pipeline('automatic-speech-recognition', hfId, {
    device,
    dtype: dtype as never,
    progress_callback: (e: { status: string; file?: string; progress?: number }) => {
      if (e.status === 'progress' && e.file) onFile(e.file, (e.progress ?? 0) / 100);
      else if (e.status === 'initiate' && e.file) onFile(e.file, 0);
    },
  });
  const pipe = asr as unknown as AsrPipeline & WhisperInternals;
  pipe.detectLanguage = (audio) => detectWhisperLanguage(pipe, audio);
  return pipe;
};

interface WhisperInternals {
  model: {
    generation_config: { decoder_start_token_id: number; lang_to_id?: Record<string, number> };
    (
      inputs: Record<string, unknown>,
    ): Promise<{ logits: { dims: number[]; data: ArrayLike<number>; getData?: () => Promise<ArrayLike<number>> } }>;
  };
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
}

/** Whisper language detection: transformers.js has none (it silently assumes English), so do it ourselves. */
async function detectWhisperLanguage(asr: WhisperInternals, audio: Float32Array): Promise<string> {
  const { Tensor } = await import('@huggingface/transformers');
  const cfg = asr.model.generation_config;
  if (!cfg.lang_to_id) return 'en'; // English-only model
  const { input_features } = await asr.processor(audio.subarray(0, 30 * 16000));
  const start = new Tensor('int64', BigInt64Array.from([BigInt(cfg.decoder_start_token_id)]), [1, 1]);
  const out = await asr.model({ input_features, decoder_input_ids: start });
  const logits = (await out.logits.getData?.()) ?? out.logits.data;
  let best = 'en';
  let bestScore = -Infinity;
  for (const [token, id] of Object.entries(cfg.lang_to_id)) {
    if (logits[id] > bestScore) {
      bestScore = logits[id];
      best = token.replace(/^<\||\|>$/g, '');
    }
  }
  return best;
}

export interface LocalOptions {
  model?: string; // LOCAL_MODELS id
  factory?: PipelineFactory;
  decode?: (b: Blob) => Promise<Float32Array>;
  /** force a device; default is WebGPU when available else WASM */
  device?: 'webgpu' | 'wasm';
}

export class LocalEngine implements Engine {
  private asr?: Promise<AsrPipeline>;
  private loadedKey = '';
  /** Which backend actually ran (for UI honesty). */
  device: 'webgpu' | 'wasm' = 'wasm';
  /** Language Whisper detected when the user chose "detect automatically" (undefined otherwise). */
  detectedLanguage?: string;

  constructor(private readonly cfg: LocalOptions = {}) {}

  async transcribe(audio: Blob, options: TranscribeOptions = {}): Promise<Segment[]> {
    const model = LOCAL_MODELS.find((m) => m.id === (this.cfg.model ?? 'base')) ?? LOCAL_MODELS[1];
    options.onProgress?.({ phase: 'decode', fraction: null, message: 'Decoding audio in your browser…' });
    const pcm = await (this.cfg.decode ?? decodeToMono16k)(audio);
    const asr = await this.load(model, options);

    let lang = options.language && options.language !== 'auto' ? options.language : undefined;
    this.detectedLanguage = undefined;
    if (!lang && asr.detectLanguage) {
      options.onProgress?.({ phase: 'transcribe', fraction: 0, message: 'Detecting the spoken language…' });
      try {
        lang = this.detectedLanguage = await asr.detectLanguage(pcm);
      } catch {
        lang = undefined; // fall back to Whisper's own default (English)
      }
    }

    const windows = chunkPcm(pcm, WINDOW_SECONDS);
    const out: Segment[] = [];
    for (let i = 0; i < windows.length; i++) {
      if (options.signal?.aborted) throw new EngineError('Cancelled.', 'aborted');
      options.onProgress?.({
        phase: 'transcribe',
        fraction: i / windows.length,
        message: `Transcribing ${i + 1} of ${windows.length}… (${this.device === 'webgpu' ? 'GPU' : 'CPU / WebAssembly'})`,
      });
      const res = await asr(windows[i].samples, {
        return_timestamps: true,
        task: 'transcribe',
        ...(lang ? { language: lang } : {}),
      });
      const r = Array.isArray(res) ? res[0] : res;
      const off = windows[i].offset;
      const chunkEnd = off + windows[i].samples.length / 16000;
      for (const c of r.chunks ?? []) {
        const text = c.text.trim();
        if (!text) continue;
        out.push({ start: off + c.timestamp[0], end: c.timestamp[1] == null ? chunkEnd : off + c.timestamp[1], text });
      }
      if (!r.chunks?.length && r.text.trim()) out.push({ start: off, end: chunkEnd, text: r.text.trim() });
    }
    options.onProgress?.({ phase: 'transcribe', fraction: 1, message: 'Done' });
    return out;
  }

  /** Free the model's memory. Long queues otherwise pile up one model per job until the WASM heap is exhausted. */
  async dispose(): Promise<void> {
    const asr = this.asr;
    this.asr = undefined;
    this.loadedKey = '';
    try {
      await (await asr)?.dispose?.();
    } catch {
      /* nothing useful to do if freeing fails */
    }
  }

  private async load(model: LocalModel, options: TranscribeOptions): Promise<AsrPipeline> {
    const device = this.cfg.device ?? ((await webGpuUsable()) ? 'webgpu' : 'wasm');
    const key = `${model.id}:${device}`;
    if (this.asr && this.loadedKey === key) return this.asr;
    this.device = device;
    this.loadedKey = key;
    const files = new Map<string, number>();
    const factory = this.cfg.factory ?? globalFactoryOverride() ?? defaultFactory;
    options.onProgress?.({
      phase: 'download',
      fraction: 0,
      message: `Loading ${model.label} model (${model.size}, cached after first use)…`,
    });
    this.asr = factory({
      hfId: model.hfId,
      device,
      onFile: (file, frac) => {
        if (frac != null) files.set(file, frac);
        const vals = [...files.values()];
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        options.onProgress?.({
          phase: 'download',
          fraction: avg,
          message: `Downloading model… ${avg == null ? '' : Math.round(avg * 100) + '%'}`,
        });
      },
    }).catch((e: unknown) => {
      this.asr = undefined;
      if (device === 'webgpu' && !this.cfg.device) {
        // WebGPU adapter present but unusable: fall back to WASM once.
        this.cfg.device = 'wasm';
        return this.load(model, options);
      }
      throw new EngineError(
        `Could not load the on-device model: ${e instanceof Error ? e.message : String(e)}`,
        'engine',
      );
    });
    return this.asr;
  }
}

/** Test seam: Playwright injects a stub pipeline here so e2e needs no model download. */
function globalFactoryOverride(): PipelineFactory | undefined {
  return (globalThis as { __VTT_PIPELINE_FACTORY__?: PipelineFactory }).__VTT_PIPELINE_FACTORY__;
}
