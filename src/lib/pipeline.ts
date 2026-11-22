import { OpenAIEngine } from './openai';
import { LocalEngine } from './local';
import { languageName } from './languages';
import { OpenAITranslator, LocalTranslator } from './translate';
import { Diarizer } from './diarize';
import { decodeToMono16k } from './audio';
import { EngineError, type Progress, type Segment } from './types';
import type { Turn } from './speakers';
import type { RunContext } from './queue';

export interface JobOptions {
  engine: 'openai' | 'local';
  /** held in memory only; never written to the stored result */
  apiKey: string;
  model: string;
  language: string;
  target: string;
  diarize: boolean;
  speakerCount: string;
}

export type Task =
  | { kind: 'process'; jobId: string; file: File; options: JobOptions }
  | { kind: 'translate'; jobId: string; segments: Segment[]; from: string; options: JobOptions };

export type Outcome =
  | { kind: 'process'; segments: Segment[]; turns: Turn[] | null; ranOn: string; detectedLang: string; warning?: string }
  | { kind: 'translate'; segments: Segment[] };

const diarizer = new Diarizer();
const aborted = (e: unknown) => e instanceof EngineError && e.kind === 'aborted';

export async function translateSegments(
  segs: Segment[], o: JobOptions, from: string, signal: AbortSignal, onProgress: (p: Progress) => void
): Promise<Segment[]> {
  const tr = o.engine === 'openai' ? new OpenAITranslator({ apiKey: o.apiKey }) : new LocalTranslator();
  const out = await tr.translate(segs, { from, to: o.target, signal, onProgress });
  return segs.map((s, i) => ({ ...s, translation: out[i] }));
}

/** The real work for one queue item. Order: transcribe -> diarize; translation waits for the speaker review. */
export async function runTask(task: Task, ctx: RunContext): Promise<Outcome> {
  const { signal, onProgress, setStep } = ctx;
  const o = task.options;
  if (task.kind === 'translate') {
    setStep('Translating');
    return { kind: 'translate', segments: await translateSegments(task.segments, o, task.from, signal, onProgress) };
  }
  setStep('Transcribing');
  const eng = o.engine === 'openai' ? new OpenAIEngine({ apiKey: o.apiKey }) : new LocalEngine({ model: o.model });
  const segments = await eng.transcribe(task.file, { language: o.language, signal, onProgress });
  const ranOn = eng instanceof LocalEngine
    ? (eng.device === 'webgpu' ? 'on this device, GPU (WebGPU)' : 'on this device, CPU (WebAssembly)') +
      (eng.detectedLanguage ? `; detected language: ${languageName(eng.detectedLanguage)}` : '')
    : 'by OpenAI';
  const detectedLang = eng instanceof LocalEngine ? (eng.detectedLanguage ?? '') : '';
  let turns: Turn[] | null = null;
  let warning: string | undefined;
  try {
    if (o.diarize && segments.length) {
      setStep('Identifying speakers');
      onProgress({ phase: 'decode', fraction: null, message: 'Preparing audio for speaker detection…' });
      const pcm = await decodeToMono16k(task.file);
      const t = await diarizer.run(pcm, { speakers: o.speakerCount === 'auto' ? undefined : Number(o.speakerCount), signal, onProgress });
      turns = t.length ? t : null;
    }
    // With speakers to review, translation is deferred until they are confirmed (see JobService.finishReview).
    if (!turns && o.target) {
      setStep('Translating');
      const from = o.language === 'auto' && detectedLang ? detectedLang : o.language;
      return { kind: 'process', segments: await translateSegments(segments, o, from, signal, onProgress), turns, ranOn, detectedLang };
    }
  } catch (e) {
    if (aborted(e) || signal.aborted) throw e;
    // keep what finished (e.g. the transcript when only speaker detection or translation failed)
    warning = e instanceof Error ? e.message : 'A later step failed.';
  }
  return { kind: 'process', segments, turns, ranOn, detectedLang, warning };
}
