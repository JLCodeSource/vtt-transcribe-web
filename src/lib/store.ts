import type { Segment } from './types';
import type { SpeakerNames, Turn } from './speakers';
import type { Retention } from './retention';

/** A finished result, held in this browser's IndexedDB. Audio is NOT part of it (see putAudio). */
export interface StoredJob {
  id: string;
  name: string;
  completedAt: number;
  segments: Segment[];
  /** speaker turns (with voice embeddings) so speakers can be reviewed later; null when not diarized */
  turns: Turn[] | null;
  names: SpeakerNames;
  /** diarization finished but the human review has not been confirmed or skipped yet */
  awaitingReview: boolean;
  /** translation still to run once the speakers are confirmed */
  translate: { engine: 'openai' | 'local'; target: string; from: string } | null;
  ranOn: string;
  warning?: string;
  retention: Retention;
  expiresAt: number | null;
  downloadedAt: number | null;
  hasAudio: boolean;
}

export class StoreError extends Error {
  constructor(message: string, readonly kind: 'quota' | 'unavailable' | 'failed') {
    super(message);
    this.name = 'StoreError';
  }
}

const DB = 'vtt-transcribe';
const JOBS = 'jobs';
const AUDIO = 'audio';

function fail(e: unknown): StoreError {
  if (e instanceof StoreError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return new StoreError('This browser has no room left to save results. Delete old results or free some space.', 'quota');
  return new StoreError(`Could not use this browser's storage (${(e as Error)?.message ?? name ?? 'unknown error'}).`, 'failed');
}

export class JobStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new StoreError('Browser storage is not available here (private mode?). Results will only be kept until you close this tab.', 'unavailable'));
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = this.factory!.open(DB, 1);
      } catch (e) {
        return reject(fail(e));
      }
      req.onupgradeneeded = () => {
        req.result.createObjectStore(JOBS, { keyPath: 'id' });
        req.result.createObjectStore(AUDIO);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StoreError('Browser storage is not available here (private mode?). Results will only be kept until you close this tab.', 'unavailable'));
      req.onblocked = () => reject(new StoreError('Browser storage is blocked by another tab.', 'unavailable'));
    }).catch((e) => {
      this.db = null;
      throw e;
    });
    return this.db;
  }

  /** Run one transaction; resolves with the value `fn` produced once the transaction has committed. */
  private async tx<T>(stores: string[], write: boolean, fn: (s: IDBObjectStore[], out: (v: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(stores, write ? 'readwrite' : 'readonly');
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(fail(tx.error));
        tx.onabort = () => reject(fail(tx.error));
        fn(stores.map((s) => tx.objectStore(s)), (v) => (value = v));
      } catch (e) {
        reject(fail(e));
      }
    });
  }

  put(job: StoredJob): Promise<void> {
    return this.tx<void>([JOBS], true, ([s]) => void s.put(job));
  }
  get(id: string): Promise<StoredJob | undefined> {
    return this.tx<StoredJob | undefined>([JOBS], false, ([s], out) => {
      const r = s.get(id);
      r.onsuccess = () => out(r.result as StoredJob | undefined);
    });
  }
  /** newest first */
  async list(): Promise<StoredJob[]> {
    const all = await this.tx<StoredJob[]>([JOBS], false, ([s], out) => {
      const r = s.getAll();
      r.onsuccess = () => out(r.result as StoredJob[]);
    });
    return all.sort((a, b) => b.completedAt - a.completedAt);
  }
  remove(id: string): Promise<void> {
    return this.tx<void>([JOBS, AUDIO], true, ([j, a]) => {
      j.delete(id);
      a.delete(id);
    });
  }
  clear(): Promise<void> {
    return this.tx<void>([JOBS, AUDIO], true, ([j, a]) => {
      j.clear();
      a.clear();
    });
  }
  putAudio(id: string, blob: Blob): Promise<void> {
    return this.tx<void>([AUDIO], true, ([s]) => void s.put(blob, id));
  }
  getAudio(id: string): Promise<Blob | undefined> {
    return this.tx<Blob | undefined>([AUDIO], false, ([s], out) => {
      const r = s.get(id);
      r.onsuccess = () => out(r.result as Blob | undefined);
    });
  }
  removeAudio(id: string): Promise<void> {
    return this.tx<void>([AUDIO], true, ([s]) => void s.delete(id));
  }
}
