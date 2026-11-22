import type { Progress } from './types';

export type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QueueItem<I, R> {
  id: string;
  name: string;
  input: I;
  status: ItemStatus;
  progress: Progress | null;
  /** coarse step name: "Transcribing", "Identifying speakers", … */
  step: string;
  error?: string;
  result?: R;
  addedAt: number;
}

export interface RunContext {
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
  setStep: (s: string) => void;
}
export type Runner<I, R> = (item: QueueItem<I, R>, ctx: RunContext) => Promise<R>;

/** Strictly first-in-first-out, one item at a time. Models are heavy in the browser, so nothing ever runs concurrently. */
export class JobQueue<I, R> {
  private list: QueueItem<I, R>[] = [];
  private current: { item: QueueItem<I, R>; abort: AbortController } | null = null;
  private subs = new Set<(items: QueueItem<I, R>[]) => void>();
  private seq = 0;

  constructor(
    private readonly runner: Runner<I, R>,
    private readonly opts: {
      now?: () => number;
      /** called after an item reaches done / failed (not cancelled). May be async; the next item waits for it. */
      onSettled?: (item: QueueItem<I, R>) => void | Promise<void>;
    } = {}
  ) {}

  get items(): QueueItem<I, R>[] {
    return this.list.map((i) => ({ ...i }));
  }
  subscribe(fn: (items: QueueItem<I, R>[]) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private emit() {
    const snap = this.items;
    for (const f of this.subs) f(snap);
  }
  /** 1-based place among waiting items; 0 if not waiting. */
  position(id: string): number {
    const q = this.list.filter((i) => i.status === 'queued');
    return q.findIndex((i) => i.id === id) + 1;
  }

  add(name: string, input: I, id = `q${++this.seq}`): QueueItem<I, R> {
    const item: QueueItem<I, R> = { id, name, input, status: 'queued', progress: null, step: '', addedAt: (this.opts.now ?? Date.now)() };
    this.list.push(item);
    this.emit();
    void this.pump();
    return { ...item };
  }

  cancel(id: string): void {
    const item = this.list.find((i) => i.id === id);
    if (!item) return;
    if (item.status === 'queued') {
      item.status = 'cancelled';
      this.emit();
    } else if (item.status === 'running') {
      this.current?.abort.abort();
    }
  }

  /** Put a failed or cancelled item back at the end of the line. */
  retry(id: string): void {
    const item = this.list.find((i) => i.id === id && (i.status === 'failed' || i.status === 'cancelled'));
    if (!item) return;
    this.list.splice(this.list.indexOf(item), 1);
    item.status = 'queued';
    item.error = undefined;
    item.progress = null;
    item.step = '';
    this.list.push(item);
    this.emit();
    void this.pump();
  }

  /** Drop a finished/failed/cancelled item from the list. */
  remove(id: string): void {
    const i = this.list.findIndex((x) => x.id === id && x.status !== 'queued' && x.status !== 'running');
    if (i >= 0) {
      this.list.splice(i, 1);
      this.emit();
    }
  }

  private pumping = false;
  private async pump(): Promise<void> {
    if (this.pumping) return; // the single worker loop: this is what guarantees no concurrency
    this.pumping = true;
    try {
      for (;;) {
        const item = this.list.find((i) => i.status === 'queued');
        if (!item) return;
        const abort = new AbortController();
        this.current = { item, abort };
        item.status = 'running';
        item.progress = { phase: 'decode', fraction: null, message: 'Starting…' };
        this.emit();
        try {
          item.result = await this.runner(item, {
            signal: abort.signal,
            onProgress: (p) => ((item.progress = p), this.emit()),
            setStep: (s) => ((item.step = s), this.emit()),
          });
          item.status = abort.signal.aborted ? 'cancelled' : 'done';
        } catch (e) {
          if (abort.signal.aborted || (e as { kind?: string })?.kind === 'aborted') item.status = 'cancelled';
          else {
            item.status = 'failed';
            item.error = e instanceof Error ? e.message : 'Something went wrong.';
          }
        }
        item.progress = null;
        this.current = null;
        this.emit();
        if (item.status === 'done' || item.status === 'failed') {
          try {
            await this.opts.onSettled?.({ ...item });
          } catch {
            /* a failing notifier/saver must not stop the queue */
          }
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
