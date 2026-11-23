import { JobQueue, type QueueItem, type Runner } from './queue';
import { SCHEMA } from './versions';
import { JobStore, StoreError, type StoredJob } from './store';
import { expiryFor, sweepExpired, type Retention } from './retention';
import type { Outcome, Task, JobOptions } from './pipeline';
import {
  addDiarization,
  addTranslation,
  deleteVersion,
  recluster,
  renameVersion,
  setActive,
  updateActive,
} from './versions';

export type LiveItem = QueueItem<Task, Outcome>;

export interface ServiceDeps {
  store: JobStore;
  run: Runner<Task, Outcome>;
  now?: () => number;
  defaultRetention: () => Retention;
  keepAudio: () => boolean;
  /** called after an item is done or failed and has been saved */
  onSettled?: (item: LiveItem) => void;
  newId?: () => string;
}

/** Ties the queue, the browser-local store and retention together. Plain TS so it can be unit-tested. */
export class JobService {
  readonly queue: JobQueue<Task, Outcome>;
  private readonly now: () => number;
  /** options (including the in-memory API key) for jobs submitted in this session */
  private readonly options = new Map<string, JobOptions>();
  /** the files of jobs submitted in this session, so speaker playback works without storing audio */
  readonly files = new Map<string, File>();
  /** newest-first copy of what is in the store; call refresh() to reload */
  stored: StoredJob[] = [];
  /** last storage problem to show to the user, if any */
  storageError = '';
  private listeners = new Set<() => void>();

  constructor(private readonly d: ServiceDeps) {
    this.now = d.now ?? Date.now;
    this.queue = new JobQueue(d.run, { now: this.now, onSettled: (i) => this.settled(i) });
    this.queue.subscribe(() => this.changed());
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const f of this.listeners) f();
  }

  /** Queue files, first in first out. Returns the live items. */
  submit(files: File[], options: JobOptions): LiveItem[] {
    return files.map((file) => {
      const jobId = this.d.newId?.() ?? crypto.randomUUID();
      this.options.set(jobId, options);
      this.files.set(jobId, file);
      return this.queue.add(file.name, { kind: 'process', jobId, file, options }, jobId);
    });
  }

  /** Upgrade records saved by older versions of the app to the current shape (once; cheap when none). */
  async migrate(): Promise<void> {
    try {
      await this.d.store.migrateAll();
    } catch (e) {
      this.storageError = (e as Error).message;
    }
  }

  async refresh(): Promise<void> {
    try {
      this.stored = await this.d.store.list();
    } catch (e) {
      if (!this.unsaved.size) this.storageError = (e as Error).message;
    }
    this.changed();
  }

  async sweep(): Promise<string[]> {
    const gone = await sweepExpired(this.d.store, this.now());
    if (gone.length) {
      for (const id of gone) this.files.delete(id);
      await this.refresh();
    }
    return gone;
  }

  /** Jobs the browser would not store (quota, private mode): kept in memory for this tab so nothing is lost. */
  private readonly unsaved = new Map<string, StoredJob>();
  /** what the Jobs view lists: the store plus anything that could not be stored */
  get jobs(): StoredJob[] {
    const ids = new Set(this.stored.map((j) => j.id));
    return [...Array.from(this.unsaved.values()).filter((j) => !ids.has(j.id)), ...this.stored].sort(
      (a, b) => b.completedAt - a.completedAt,
    );
  }
  isUnsaved(id: string): boolean {
    return this.unsaved.has(id);
  }

  async getJob(id: string): Promise<StoredJob | undefined> {
    const mem = this.unsaved.get(id);
    if (mem) return mem;
    try {
      return await this.d.store.get(id);
    } catch (e) {
      this.storageError = (e as Error).message;
      return undefined;
    }
  }
  private async save(job: StoredJob): Promise<boolean> {
    try {
      await this.d.store.put(job);
      this.unsaved.delete(job.id);
      return true;
    } catch (e) {
      this.storageError = `${(e as Error).message} This result is kept only until you close this tab: download it now.`;
      this.unsaved.set(job.id, job);
      return false;
    }
  }

  private async settled(item: LiveItem): Promise<void> {
    if (item.status === 'done' && item.result) {
      await this.persist(item);
      this.queue.remove(item.id);
      await this.refresh();
    }
    this.d.onSettled?.(item);
  }

  private async persist(item: LiveItem): Promise<void> {
    const r = item.result!;
    const t = item.input;
    if (r.kind === 'translate') {
      const job = await this.getJob(t.jobId);
      // ADD this language; the original segments and every other translation stay as they are
      if (job)
        await this.save({
          ...addTranslation(
            job,
            t.options.target,
            r.segments.map((s) => s.translation ?? s.text),
            this.now(),
            t.options.engine,
          ),
          translate: null,
        });
      return;
    }
    if (t.kind !== 'process') return;
    const now = this.now();
    const retention = this.d.defaultRetention();
    const o = t.options;
    const from = o.language === 'auto' && r.detectedLang ? r.detectedLang : o.language;
    const translated = r.segments.some((s) => s.translation != null) && !!o.target;
    let job: StoredJob = {
      id: t.jobId,
      name: item.name,
      completedAt: now,
      schema: SCHEMA,
      segments: r.segments.map(({ translation: _t, speaker: _s, ...s }) => s),
      sourceLang: from === 'auto' ? '' : from,
      translations: {},
      diarizations: [],
      activeDiarization: null,
      engine: o.engine,
      awaitingReview: !!r.turns,
      translate:
        r.turns && o.target && o.reviewFirst
          ? {
              engine: o.engine,
              target: o.target,
              from: o.language === 'auto' && r.detectedLang ? r.detectedLang : o.language,
            }
          : null,
      ranOn: r.ranOn,
      warning: r.warning,
      retention,
      expiresAt: expiryFor(retention, now),
      downloadedAt: null,
      hasAudio: false,
    };
    if (translated)
      job = addTranslation(
        job,
        o.target,
        r.segments.map((s) => s.translation ?? s.text),
        now,
        o.engine,
      );
    if (r.turns) job = addDiarization(job, r.turns, {}, now);
    if (!(await this.save(job))) return;
    if (this.d.keepAudio()) {
      try {
        await this.d.store.putAudio(job.id, t.file);
        await this.save({ ...job, hasAudio: true });
      } catch (e) {
        this.storageError = `Saved the transcript, but not the audio: ${(e as Error).message}`;
      }
    }
  }

  /** The speaker review was confirmed (turns+names, saved into the ACTIVE version) or skipped (turns null: no labels shown, versions kept). Queues the deferred translation, if any. */
  async finishReview(
    id: string,
    turns: StoredJob['diarizations'][number]['turns'] | null,
    names: StoredJob['diarizations'][number]['names'],
    fallbackKey = '',
  ): Promise<void> {
    const job = await this.getJob(id);
    if (!job) return;
    await this.save({ ...(turns ? updateActive(job, turns, names) : setActive(job, null)), awaitingReview: false });
    const pending = job.translate;
    if (pending) {
      const base = this.options.get(id);
      const options: JobOptions = base ?? {
        engine: pending.engine,
        apiKey: fallbackKey,
        model: 'base',
        language: pending.from,
        target: pending.target,
        diarize: false,
        speakerCount: 'auto',
      };
      // queued before the refresh so the UI never shows the untranslated transcript in between
      this.queue.add(
        job.name,
        { kind: 'translate', jobId: id, segments: job.segments, from: pending.from, options },
        `${id}:t`,
      );
    }
    await this.refresh();
  }

  /** Apply a pure edit to one stored result and save it. */
  async edit(id: string, fn: (j: StoredJob) => StoredJob | null): Promise<boolean> {
    const job = await this.getJob(id);
    const next = job && fn(job);
    if (next) await this.save(next);
    await this.refresh();
    return !!next;
  }

  /** Merge / split / rename in the review editor: edits the active version only. */
  updateReview(
    id: string,
    turns: StoredJob['diarizations'][number]['turns'],
    names: StoredJob['diarizations'][number]['names'],
  ): Promise<boolean> {
    return this.edit(id, (j) => updateActive(j, turns, names));
  }
  /** Re-cluster to N speakers from the stored embeddings (no model run); adds a version. */
  recluster(id: string, count: number): Promise<boolean> {
    return this.edit(id, (j) => recluster(j, count, this.now()));
  }
  setActiveVersion(id: string, version: string | null): Promise<boolean> {
    return this.edit(id, (j) => setActive(j, version));
  }
  renameVersion(id: string, version: string, name: string): Promise<boolean> {
    return this.edit(id, (j) => renameVersion(j, version, name));
  }
  deleteVersion(id: string, version: string): Promise<boolean> {
    return this.edit(id, (j) => deleteVersion(j, version));
  }

  /**
   * Add (or re-run) a translation of the ORIGINAL segments into `target`. Queued like any job; only that
   * language is added or replaced when it finishes.
   *
   * The source language is the one recorded for the result. When none is recorded (records saved by older
   * releases) the on-device translator cannot pick a model pair, so the caller must supply `source`; it is then
   * stored on the result once, so it is never asked again. Returns 'needs-source' (nothing queued) when it is
   * still needed, rather than guessing. OpenAI can translate without knowing the source.
   */
  async addLanguage(
    id: string,
    target: string,
    engine: 'openai' | 'local',
    apiKey: string,
    source = '',
  ): Promise<'queued' | 'needs-source' | 'missing'> {
    let job = await this.getJob(id);
    if (!job) return 'missing';
    if (source && source !== job.sourceLang) {
      job = { ...job, sourceLang: source };
      await this.save(job);
    }
    if (!job.sourceLang && engine === 'local') return 'needs-source';
    const from = job.sourceLang || 'auto';
    const options: JobOptions = {
      engine,
      apiKey,
      model: 'base',
      language: from,
      target,
      diarize: false,
      speakerCount: 'auto',
    };
    this.queue.add(
      job.name,
      { kind: 'translate', jobId: id, segments: job.segments, from, options },
      `${id}:t:${target}:${this.now()}`,
    );
    await this.refresh();
    return 'queued';
  }

  async setRetention(id: string, retention: Retention): Promise<void> {
    const job = await this.getJob(id);
    if (!job) return;
    await this.save({ ...job, retention, expiresAt: expiryFor(retention, this.now()) });
    await this.refresh();
  }

  async markDownloaded(id: string): Promise<void> {
    const job = await this.getJob(id);
    if (!job || job.downloadedAt) return;
    await this.save({ ...job, downloadedAt: this.now() });
    await this.refresh();
  }

  /** Audio for speaker playback: the file from this session if we still have it, else the stored copy (opt-in). */
  async audioFor(id: string): Promise<Blob | undefined> {
    const f = this.files.get(id);
    if (f) return f;
    try {
      return await this.d.store.getAudio(id);
    } catch {
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    this.unsaved.delete(id);
    try {
      await this.d.store.remove(id);
    } catch (e) {
      this.storageError = (e as Error).message;
    }
    this.files.delete(id);
    this.options.delete(id);
    await this.refresh();
  }

  /** Everything this app keeps in the browser's database; queue and memory too. */
  dismissStorageError(): void {
    this.storageError = '';
    this.changed();
  }

  async deleteAll(): Promise<void> {
    for (const i of this.queue.items) {
      this.queue.cancel(i.id);
      this.queue.remove(i.id);
    }
    await this.d.store.clear();
    this.files.clear();
    this.options.clear();
    this.unsaved.clear();
    this.stored = [];
    this.storageError = '';
    this.changed();
  }
}

export { StoreError };
