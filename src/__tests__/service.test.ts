import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { JobService } from '../lib/service';
import { JobStore } from '../lib/store';
import { DAY_MS } from '../lib/retention';
import type { JobOptions, Outcome } from '../lib/pipeline';

const opts: JobOptions = { engine: 'local', apiKey: 'sk-secret', model: 'base', language: 'en', target: '', diarize: false, speakerCount: 'auto' };
const file = (n: string) => new File(['x'], n);
const wait = () => new Promise((r) => setTimeout(r, 80));

function make(o: { idb?: IDBFactory | undefined; clock?: { t: number }; runner?: (kind: string) => Outcome; keepAudio?: boolean } = {}) {
  const clock = o.clock ?? { t: Date.UTC(2026, 0, 1) };
  const idb = 'idb' in o ? o.idb : new IDBFactory();
  const ran: string[] = [];
  const svc = new JobService({
    store: new JobStore(idb as IDBFactory),
    now: () => clock.t,
    defaultRetention: () => ({ mode: 'days', days: 7 }),
    keepAudio: () => !!o.keepAudio,
    run: async (item) => {
      ran.push(item.name);
      return o.runner?.(item.input.kind) ?? { kind: 'process', segments: [{ start: 0, end: 1, text: item.name }], turns: null, ranOn: 'test', detectedLang: '' };
    },
  });
  return { svc, ran, clock, idb };
}

describe('JobService', () => {
  it('runs several files in submit order and saves each result with a 7 day expiry', async () => {
    const { svc, ran, clock } = make();
    svc.submit([file('a.wav'), file('b.wav'), file('c.wav')], opts);
    await wait();
    expect(ran).toEqual(['a.wav', 'b.wav', 'c.wav']);
    expect(svc.queue.items).toHaveLength(0); // saved results leave the live list
    expect(svc.stored.map((j) => j.name).sort()).toEqual(['a.wav', 'b.wav', 'c.wav']);
    expect(svc.stored[0].expiresAt).toBe(clock.t + 7 * DAY_MS);
  });

  it('results survive a reload (new service on the same database) and never contain the API key or audio', async () => {
    const a = make();
    a.svc.submit([file('a.wav')], opts);
    await wait();
    const b = make({ idb: a.idb });
    await b.svc.refresh();
    expect(b.svc.jobs).toHaveLength(1);
    expect(b.svc.jobs[0].segments[0].text).toBe('a.wav');
    expect(JSON.stringify(b.svc.jobs)).not.toContain('sk-secret');
    expect(b.svc.jobs[0].hasAudio).toBe(false);
    expect(await b.svc.audioFor(b.svc.jobs[0].id)).toBeUndefined();
  });

  it('keeps the audio only when the user opted in', async () => {
    const { svc } = make({ keepAudio: true });
    svc.submit([file('a.wav')], opts);
    await wait();
    expect(svc.stored[0].hasAudio).toBe(true);
    svc.files.clear(); // simulate a reload
    expect(await svc.audioFor(svc.stored[0].id)).toBeDefined();
  });

  it('sweeps expired results using the injected clock, and honours a per-item override', async () => {
    const { svc, clock } = make();
    svc.submit([file('a.wav'), file('b.wav')], opts);
    await wait();
    const [first, second] = [...svc.stored].sort((x, y) => x.name.localeCompare(y.name));
    await svc.setRetention(second.id, { mode: 'keep' });
    clock.t += 6 * DAY_MS;
    expect(await svc.sweep()).toEqual([]);
    clock.t += 2 * DAY_MS;
    expect(await svc.sweep()).toEqual([first.id]);
    expect(svc.stored.map((j) => j.name)).toEqual(['b.wav']);
  });

  it('delete after download removes the item after the grace period', async () => {
    const { svc, clock } = make();
    svc.submit([file('a.wav')], opts);
    await wait();
    const id = svc.stored[0].id;
    await svc.setRetention(id, { mode: 'afterDownload' });
    clock.t += 365 * DAY_MS;
    expect(await svc.sweep()).toEqual([]); // not downloaded yet
    await svc.markDownloaded(id);
    expect(await svc.sweep()).toEqual([]); // grace period
    clock.t += 16 * 60_000;
    expect(await svc.sweep()).toEqual([id]);
  });

  it('with reviewFirst, defers translation until the speakers are reviewed, then queues it', async () => {
    const turns = [{ start: 0, end: 1, embedding: Float32Array.from([1, 0]), speaker: 0 }];
    const { svc, ran } = make({
      runner: (k) => k === 'process'
        ? { kind: 'process', segments: [{ start: 0, end: 1, text: 'hi' }], turns, ranOn: 'test', detectedLang: 'en' }
        : { kind: 'translate', segments: [{ start: 0, end: 1, text: 'hi', translation: 'hola' }] },
    });
    svc.submit([file('a.wav')], { ...opts, diarize: true, target: 'es', reviewFirst: true });
    await wait();
    const job = svc.stored[0];
    expect(job.awaitingReview).toBe(true);
    expect(ran).toEqual(['a.wav']);
    await svc.finishReview(job.id, turns, { 0: 'Ada' });
    await wait();
    expect(ran).toEqual(['a.wav', 'a.wav']);
    const done = svc.stored[0];
    expect(done.awaitingReview).toBe(false);
    expect(done.translate).toBeNull();
    expect(done.segments[0].translation).toBe('hola');
    expect(done.names).toEqual({ 0: 'Ada' });
  });

  it('by default nothing is deferred: translation already happened, only the speaker review is left', async () => {
    const turns = [{ start: 0, end: 1, embedding: Float32Array.from([1, 0]), speaker: 0 }];
    const { svc, ran } = make({ runner: () => ({ kind: 'process', segments: [{ start: 0, end: 1, text: 'hi', translation: 'hola' }], turns, ranOn: 'test', detectedLang: 'en' }) });
    svc.submit([file('a.wav')], { ...opts, diarize: true, target: 'es' });
    await wait();
    expect(svc.stored[0].awaitingReview).toBe(true);
    expect(svc.stored[0].translate).toBeNull();
    await svc.finishReview(svc.stored[0].id, turns, { 0: 'Ada' });
    await wait();
    expect(ran).toEqual(['a.wav']); // no second (translate) task
    expect(svc.stored[0].segments[0].translation).toBe('hola');
  });

  it('a storage failure keeps the result in memory with a message instead of losing it', async () => {
    const { svc } = make({ idb: null as unknown as IDBFactory });
    svc.submit([file('a.wav')], opts);
    await wait();
    expect(svc.stored).toHaveLength(0);
    expect(svc.jobs).toHaveLength(1);
    expect(svc.isUnsaved(svc.jobs[0].id)).toBe(true);
    expect(svc.storageError).toMatch(/only until you close this tab/);
  });

  it('deleteAll empties the store and the queue', async () => {
    const { svc } = make();
    svc.submit([file('a.wav')], opts);
    await wait();
    await svc.deleteAll();
    expect(svc.jobs).toEqual([]);
    expect(svc.storageError).toBe('');
  });
});
