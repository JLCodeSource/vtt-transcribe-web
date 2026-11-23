import type { Segment } from './types';
import { SCHEMA, migrateJob, type DiarizationVersion, type Translation } from './versions';
import type { Retention } from './retention';

/** A finished result, held in this browser's IndexedDB. Audio is NOT part of it (see putAudio). */
export interface StoredJob {
  id: string;
  name: string;
  completedAt: number;
  /** record shape version (see versions.ts); older records are migrated when read */
  schema: number;
  /** the ORIGINAL-language segments. Immutable: no translation or speaker is ever written into them. */
  segments: Segment[];
  /** language the audio is in ('' when unknown) */
  sourceLang: string;
  /** every translation kept, by language code */
  translations: Record<string, Translation>;
  /** every speaker-labelling kept; turns carry embeddings so re-clustering needs no model */
  diarizations: DiarizationVersion[];
  /** the version edits apply to and viewers show by default; null = show without speaker labels */
  activeDiarization: string | null;
  /** engine that produced it, used as the default for adding languages later */
  engine: 'openai' | 'local';
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
  constructor(
    message: string,
    readonly kind: 'quota' | 'unavailable' | 'failed',
  ) {
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
  if (name === 'QuotaExceededError')
    return new StoreError(
      'This browser has no room left to save results. Delete old results or free some space. If it keeps happening although the browser reports free space, clear the site data for this page (DevTools → Application → Storage) and check that no custom storage quota is being simulated.',
      'quota',
    );
  return new StoreError(
    `Could not use this browser's storage (${name ?? 'Error'}: ${(e as Error)?.message ?? 'unknown error'}).`,
    'failed',
  );
}

export class JobStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(
    private readonly factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(
        new StoreError(
          'Browser storage is not available here (private mode?). Results will only be kept until you close this tab.',
          'unavailable',
        ),
      );
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
      req.onerror = () =>
        reject(
          new StoreError(
            'Browser storage is not available here (private mode?). Results will only be kept until you close this tab.',
            'unavailable',
          ),
        );
      req.onblocked = () => reject(new StoreError('Browser storage is blocked by another tab.', 'unavailable'));
    }).catch((e) => {
      this.db = null;
      throw e;
    });
    return this.db;
  }

  /** Run one transaction; resolves with the value `fn` produced once the transaction has committed. */
  private async tx<T>(
    stores: string[],
    write: boolean,
    fn: (s: IDBObjectStore[], out: (v: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(stores, write ? 'readwrite' : 'readonly');
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(fail(tx.error));
        tx.onabort = () => reject(fail(tx.error));
        fn(
          stores.map((s) => tx.objectStore(s)),
          (v) => (value = v),
        );
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
      r.onsuccess = () => out(r.result ? migrateJob(r.result) : undefined);
    });
  }
  /** newest first */
  async list(): Promise<StoredJob[]> {
    const all = await this.tx<StoredJob[]>([JOBS], false, ([s], out) => {
      const r = s.getAll();
      r.onsuccess = () => out((r.result as unknown[]).map(migrateJob));
    });
    return all.sort((a, b) => b.completedAt - a.completedAt);
  }
  /** Rewrite any record still in an older shape to the current one, in place. Safe to run on every load. */
  async migrateAll(): Promise<number> {
    return this.tx<number>([JOBS], true, ([s], out) => {
      const r = s.getAll();
      r.onsuccess = () => {
        let n = 0;
        for (const raw of r.result as Array<{ schema?: number }>) {
          if (raw.schema === SCHEMA) continue;
          s.put(migrateJob(raw));
          n++;
        }
        out(n);
      };
    });
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
