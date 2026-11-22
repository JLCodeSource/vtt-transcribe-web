import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { JobStore, StoreError, type StoredJob } from '../lib/store';

const job = (id: string, at = 1): StoredJob => ({
  id, name: `${id}.wav`, completedAt: at,
  schema: 2, sourceLang: 'en', engine: 'local',
  segments: [{ start: 0, end: 1, text: 'hello' }],
  translations: { es: { lang: 'es', texts: ['hola'], createdAt: 1 } },
  diarizations: [{ id: 'v1', name: 'v1', createdAt: 1, origin: 'auto', names: { 0: 'Ada' }, turns: [{ start: 0, end: 1, embedding: Float32Array.from([0.6, 0.8]), speaker: 0 }] }],
  activeDiarization: 'v1', awaitingReview: false, translate: null, ranOn: 'on this device',
  retention: { mode: 'days', days: 7 }, expiresAt: 99, downloadedAt: null, hasAudio: false,
});

describe('JobStore (fake IndexedDB)', () => {
  it('round-trips a result, including typed-array embeddings, across a fresh store instance', async () => {
    const idb = new IDBFactory();
    await new JobStore(idb).put(job('a'));
    const back = await new JobStore(idb).get('a'); // a "reload": new instance, same database
    expect(back?.translations.es.texts).toEqual(['hola']);
    expect(back?.diarizations[0].names).toEqual({ 0: 'Ada' });
    expect(Array.from(back!.diarizations[0].turns[0].embedding)).toEqual([Float32Array.from([0.6, 0.8])[0], Float32Array.from([0.6, 0.8])[1]]);
  });

  it('lists newest first, removes one, clears all', async () => {
    const s = new JobStore(new IDBFactory());
    await s.put(job('old', 1));
    await s.put(job('new', 2));
    expect((await s.list()).map((j) => j.id)).toEqual(['new', 'old']);
    await s.remove('old');
    expect((await s.list()).map((j) => j.id)).toEqual(['new']);
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(await s.get('new')).toBeUndefined();
  });

  it('audio is separate, optional and removed with its job', async () => {
    const s = new JobStore(new IDBFactory());
    await s.put(job('a'));
    expect(await s.getAudio('a')).toBeUndefined();
    await s.putAudio('a', new Blob(['abc']));
    expect(await s.getAudio('a')).toBeDefined();
    await s.remove('a');
    expect(await s.getAudio('a')).toBeUndefined();
  });

  it('reports unavailable storage as a StoreError instead of throwing something obscure', async () => {
    const s = new JobStore(null as unknown as IDBFactory | undefined);
    await expect(s.put(job('a'))).rejects.toBeInstanceOf(StoreError);
    const q = new JobStore({ open: () => { throw Object.assign(new Error('x'), { name: 'SecurityError' }); } } as unknown as IDBFactory);
    await expect(q.list()).rejects.toMatchObject({ kind: 'failed' });
  });
});
