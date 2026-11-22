import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { JobStore, type StoredJob } from '../lib/store';
import { JobService } from '../lib/service';
import { toSrt, toTxt } from '../lib/format';
import {
  SCHEMA, UNKNOWN_LANG, activeVersion, addDiarization, addTranslation, deleteVersion, migrateJob, recluster, removeTranslation,
  renameVersion, render, setActive, updateActive,
} from '../lib/versions';
import { mergeSpeakers, speakerIds, type Turn } from '../lib/speakers';

const emb = (x: number, y: number) => Float32Array.from([x, y]);
// three voices: two close together (A, A'), one far (B)
const turns: Turn[] = [
  { start: 0, end: 1, embedding: emb(1, 0), speaker: 0 },
  { start: 1, end: 2, embedding: emb(0, 1), speaker: 1 },
  { start: 2, end: 3, embedding: emb(0.95, 0.31), speaker: 2 },
  { start: 3, end: 4, embedding: emb(-1, 0), speaker: 3 },
];
const base = (): StoredJob => ({
  id: 'a', name: 'a.wav', completedAt: 1, schema: SCHEMA, sourceLang: 'en', engine: 'local',
  segments: [0, 1, 2, 3].map((i) => ({ start: i, end: i + 1, text: `t${i}` })),
  translations: {}, diarizations: [], activeDiarization: null, awaitingReview: false, translate: null, ranOn: 'x',
  retention: { mode: 'keep' }, expiresAt: null, downloadedAt: null, hasAudio: false,
});

describe('translations', () => {
  it('adding a language keeps the original and every other language; re-adding replaces only that one', () => {
    let j = addTranslation(base(), 'es', ['e0', 'e1', 'e2', 'e3'], 5);
    j = addTranslation(j, 'fr', ['f0', 'f1', 'f2', 'f3'], 6);
    j = addTranslation(j, 'es', ['E0', 'E1', 'E2', 'E3'], 7);
    expect(Object.keys(j.translations).sort()).toEqual(['es', 'fr']);
    expect(j.translations.es.texts[0]).toBe('E0');
    expect(j.translations.fr.texts[0]).toBe('f0');
    expect(j.segments.map((s) => s.text)).toEqual(['t0', 't1', 't2', 't3']);
    expect(Object.keys(removeTranslation(j, 'fr').translations)).toEqual(['es']);
  });
});

describe('diarization versions', () => {
  it('recluster adds a version from the stored embeddings and leaves the others untouched', () => {
    let j = addDiarization(base(), turns, { 0: 'Ada' }, 1);
    const before = JSON.stringify(j.diarizations[0]);
    j = recluster(j, 2, 2)!;
    expect(j.diarizations).toHaveLength(2);
    expect(JSON.stringify(j.diarizations[0])).toBe(before);
    expect(speakerIds(activeVersion(j)!.turns)).toHaveLength(2);
    expect(j.activeDiarization).toBe('v2');
    j = recluster(j, 1, 3)!;
    expect(speakerIds(activeVersion(j)!.turns)).toEqual([0]);
    expect(recluster(base(), 2, 1)).toBeNull();
  });

  it('merge/split/rename edit only the active version', () => {
    let j = addDiarization(base(), turns, {}, 1);
    j = recluster(j, 3, 2)!;
    const v1 = JSON.stringify(j.diarizations[0]);
    j = updateActive(j, mergeSpeakers(activeVersion(j)!.turns, 1, 0), { 0: 'Bo' });
    expect(JSON.stringify(j.diarizations[0])).toBe(v1);
    expect(activeVersion(j)!.names).toEqual({ 0: 'Bo' });
    expect(speakerIds(activeVersion(j)!.turns).length).toBeLessThan(3);
  });

  it('switch, rename, delete; the last version is never deleted', () => {
    let j = recluster(addDiarization(base(), turns, {}, 1), 2, 2)!;
    j = setActive(j, 'v1');
    expect(j.activeDiarization).toBe('v1');
    expect(setActive(j, 'nope').activeDiarization).toBe('v1');
    j = renameVersion(j, 'v1', '  Interview  ');
    expect(j.diarizations[0].name).toBe('Interview');
    j = deleteVersion(j, 'v1');
    expect(j.diarizations.map((v) => v.id)).toEqual(['v2']);
    expect(j.activeDiarization).toBe('v2');
    expect(deleteVersion(j, 'v2').diarizations).toHaveLength(1);
  });
});

describe('render and exports', () => {
  it('picks language and diarization version independently; bilingual keeps both texts', () => {
    let j = addDiarization(base(), turns, { 0: 'Ada' }, 1);
    j = addTranslation(j, 'es', ['e0', 'e1', 'e2', 'e3'], 2);
    expect(render(j, { lang: null })[0]).toMatchObject({ text: 't0', speaker: 'Ada' });
    expect(render(j, { lang: 'es' })[0].text).toBe('e0');
    expect(render(j, { lang: 'es', version: null })[0].speaker).toBeUndefined();
    const both = render(j, { lang: 'es', bilingual: true });
    expect(toTxt(both).split('\n')[0]).toBe('Ada: t0');
    expect(toTxt(both).split('\n')[1]).toBe('e0');
    expect(toSrt(both)).toContain('Ada: t0\ne0');
    expect(j.segments[0]).toEqual({ start: 0, end: 1, text: 't0' }); // rendering never mutates storage
  });
});

describe('migration', () => {
  const old = {
    id: 'o', name: 'o.wav', completedAt: 10, awaitingReview: false, translate: null, ranOn: 'by OpenAI',
    segments: [{ start: 0, end: 1, text: 'hello', translation: 'hola' }, { start: 1, end: 2, text: 'bye', translation: 'adios' }],
    turns, names: { 0: 'Ada' },
    retention: { mode: 'days', days: 7 }, expiresAt: 99, downloadedAt: null, hasAudio: false,
  };
  it('old translation becomes one entry, old speaker state becomes version 1, the original is restored', () => {
    const j = migrateJob(old);
    expect(j.schema).toBe(SCHEMA);
    expect(j.segments).toEqual([{ start: 0, end: 1, text: 'hello' }, { start: 1, end: 2, text: 'bye' }]);
    expect(j.translations[UNKNOWN_LANG].texts).toEqual(['hola', 'adios']);
    expect(j.diarizations).toHaveLength(1);
    expect(j.diarizations[0]).toMatchObject({ id: 'v1', names: { 0: 'Ada' } });
    expect(j.activeDiarization).toBe('v1');
    expect(j.engine).toBe('openai');
    expect(j.expiresAt).toBe(99);
    expect('turns' in j).toBe(false);
    expect(migrateJob(j)).toBe(j); // idempotent
  });
  it('an old record with neither translation nor speakers gets empty maps', () => {
    const j = migrateJob({ ...old, segments: [{ start: 0, end: 1, text: 'x' }], turns: null, names: {} });
    expect(j.translations).toEqual({});
    expect(j.diarizations).toEqual([]);
    expect(j.activeDiarization).toBeNull();
  });
  it('the store migrates on read and rewrites old records on migrateAll, keeping them across a reload', async () => {
    const idb = new IDBFactory();
    // write an old-shape record directly
    const db = await new Promise<IDBDatabase>((res) => {
      const r = idb.open('vtt-transcribe', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('jobs', { keyPath: 'id' }); r.result.createObjectStore('audio'); };
      r.onsuccess = () => res(r.result);
    });
    await new Promise<void>((res) => { const t = db.transaction('jobs', 'readwrite'); t.objectStore('jobs').put(old); t.oncomplete = () => res(); });
    db.close();
    const s = new JobStore(idb);
    expect((await s.get('o'))!.translations[UNKNOWN_LANG]).toBeDefined();
    expect(await s.migrateAll()).toBe(1);
    expect(await new JobStore(idb).migrateAll()).toBe(0);
    const back = await new JobStore(idb).list();
    expect(back[0].schema).toBe(SCHEMA);
    expect(back[0].diarizations[0].turns).toHaveLength(4);
  });
});

describe('JobService version operations', () => {
  const make = () => {
    const idb = new IDBFactory();
    const svc = new JobService({
      store: new JobStore(idb), defaultRetention: () => ({ mode: 'keep' }), keepAudio: () => false,
      run: async (item) => item.input.kind === 'translate'
        ? { kind: 'translate', segments: item.input.segments.map((s) => ({ ...s, translation: `[${item.input.options.target}] ${s.text}` })) }
        : { kind: 'process', segments: [{ start: 0, end: 1, text: 'hi' }, { start: 1, end: 2, text: 'yo' }], turns: turns.slice(0, 2), ranOn: 'test', detectedLang: 'en' },
    });
    return svc;
  };
  const wait = () => new Promise((r) => setTimeout(r, 80));
  const opts = { engine: 'local', apiKey: '', model: 'base', language: 'en', target: '', diarize: true, speakerCount: 'auto' } as const;

  it('two languages, re-cluster, merge: everything stays available and survives a reload; retention is per result', async () => {
    const svc = make();
    svc.submit([new File(['x'], 'a.wav')], opts);
    await wait();
    const id = svc.stored[0].id;
    await svc.addLanguage(id, 'es', 'local', '');
    await wait();
    await svc.addLanguage(id, 'fr', 'local', '');
    await wait();
    await svc.recluster(id, 1);
    await svc.updateReview(id, svc.stored[0].diarizations[1].turns, { 0: 'Everyone' });
    const j = (await svc.getJob(id))!;
    expect(Object.keys(j.translations).sort()).toEqual(['es', 'fr']);
    expect(j.translations.es.texts).toEqual(['[es] hi', '[es] yo']);
    expect(j.diarizations).toHaveLength(2);
    expect(j.diarizations[0].names).toEqual({}); // v1 untouched by edits to v2
    expect(j.diarizations[1].names).toEqual({ 0: 'Everyone' });
    expect(j.segments.map((s) => s.text)).toEqual(['hi', 'yo']);
    // retention applies to the whole record: one expiry for every version
    await svc.setRetention(id, { mode: 'days', days: 1 });
    expect(Object.keys((await svc.getJob(id))!.translations)).toHaveLength(2);
    expect(svc.stored).toHaveLength(1);
  });
});
