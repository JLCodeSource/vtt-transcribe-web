export interface Segment {
  /** seconds from start of the audio */
  start: number;
  end: number;
  text: string;
}

export type ProgressPhase = 'decode' | 'download' | 'load' | 'transcribe';

export interface Progress {
  phase: ProgressPhase;
  /** 0..1, or null when unknown */
  fraction: number | null;
  message: string;
}

export interface TranscribeOptions {
  /** ISO-639-1 code, or undefined/'auto' to detect */
  language?: string;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

/** Every engine exposes this one function. */
export interface Engine {
  transcribe(audio: Blob, options?: TranscribeOptions): Promise<Segment[]>;
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'network' | 'bad-request' | 'decode' | 'aborted' | 'engine' = 'engine'
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
