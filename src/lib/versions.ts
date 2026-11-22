import type { Segment } from './types';
import { clusterEmbeddings, labelSegments, type SpeakerNames, type Turn } from './speakers';
import type { StoredJob } from './store';
import { languageName } from './languages';

/**
 * The "keep every version" model. A stored result holds the original segments (never edited), a map of
 * translations by language, and a list of diarization versions. Nothing here ever discards a rendering:
 * adding a language or re-clustering ADDS an entry; only an explicit delete removes one.
 */
export const SCHEMA = 2;
/** Key for a translation migrated from an old record that did not remember its language. */
export const UNKNOWN_LANG = 'und';

export interface Translation {
  lang: string;
  /** one string per original segment, same order */
  texts: string[];
  createdAt: number;
  engine?: 'openai' | 'local';
}

export interface DiarizationVersion {
  id: string;
  name: string;
  createdAt: number;
  /** turns carry their voice embeddings, so re-clustering to another speaker count needs no model run */
  turns: Turn[];
  names: SpeakerNames;
  origin: 'auto' | 'recluster' | 'migrated';
}

export const langLabel = (lang: string) => (lang === UNKNOWN_LANG ? 'Translation (language not recorded)' : languageName(lang));

const strip = ({ translation: _t, speaker: _s, ...rest }: Segment): Segment => rest;

/** Bring any stored record (current or older) to the current shape. Pure; never loses data. */
export function migrateJob(raw: unknown): StoredJob {
  const r = raw as Record<string, any>;
  if (r.schema === SCHEMA) return r as StoredJob;
  const old = (r.segments ?? []) as Segment[];
  const segments = old.map(strip);
  const translations: Record<string, Translation> = {};
  if (old.some((s) => s.translation != null)) {
    translations[UNKNOWN_LANG] = { lang: UNKNOWN_LANG, texts: old.map((s) => s.translation ?? s.text), createdAt: r.completedAt ?? 0 };
  }
  const diarizations: DiarizationVersion[] = [];
  if (r.turns) {
    diarizations.push({ id: 'v1', name: 'Speakers (version 1)', createdAt: r.completedAt ?? 0, turns: r.turns, names: r.names ?? {}, origin: 'migrated' });
  }
  const { turns: _t, names: _n, segments: _s, ...rest } = r;
  return {
    ...rest,
    schema: SCHEMA,
    segments,
    sourceLang: r.translate?.from ?? '',
    translations,
    diarizations,
    activeDiarization: diarizations[0]?.id ?? null,
    engine: r.engine ?? (typeof r.ranOn === 'string' && r.ranOn.includes('OpenAI') ? 'openai' : 'local'),
  } as StoredJob;
}

export const activeVersion = (j: StoredJob): DiarizationVersion | undefined =>
  j.diarizations.find((v) => v.id === j.activeDiarization);

const nextId = (j: StoredJob) => `v${Math.max(0, ...j.diarizations.map((v) => Number(v.id.slice(1)) || 0)) + 1}`;

/** Add (or, for a language already present, replace only that language) a translation. */
export function addTranslation(j: StoredJob, lang: string, texts: string[], now: number, engine?: 'openai' | 'local'): StoredJob {
  return { ...j, translations: { ...j.translations, [lang]: { lang, texts, createdAt: now, engine } } };
}

export function removeTranslation(j: StoredJob, lang: string): StoredJob {
  const { [lang]: _gone, ...rest } = j.translations;
  return { ...j, translations: rest };
}

/** Add a diarization version and make it the active one. */
export function addDiarization(j: StoredJob, turns: Turn[], names: SpeakerNames, now: number, name?: string, origin: DiarizationVersion['origin'] = 'auto'): StoredJob {
  const id = nextId(j);
  const v: DiarizationVersion = { id, name: name ?? `Speakers (version ${id.slice(1)})`, createdAt: now, turns, names, origin };
  return { ...j, diarizations: [...j.diarizations, v], activeDiarization: id };
}

/** Merge/split/rename edit the ACTIVE version only. With none active this does nothing. */
export function updateActive(j: StoredJob, turns: Turn[], names: SpeakerNames): StoredJob {
  return { ...j, diarizations: j.diarizations.map((v) => (v.id === j.activeDiarization ? { ...v, turns, names } : v)) };
}

export function setActive(j: StoredJob, id: string | null): StoredJob {
  return id === null || j.diarizations.some((v) => v.id === id) ? { ...j, activeDiarization: id } : j;
}

export function renameVersion(j: StoredJob, id: string, name: string): StoredJob {
  const n = name.trim();
  return n ? { ...j, diarizations: j.diarizations.map((v) => (v.id === id ? { ...v, name: n } : v)) } : j;
}

/** Delete a version. The last one is never deleted. */
export function deleteVersion(j: StoredJob, id: string): StoredJob {
  if (j.diarizations.length <= 1 || !j.diarizations.some((v) => v.id === id)) return j;
  const left = j.diarizations.filter((v) => v.id !== id);
  return { ...j, diarizations: left, activeDiarization: j.activeDiarization === id ? left[left.length - 1].id : j.activeDiarization };
}

/** New version from the active (else first) one, re-clustered to exactly `count` speakers. No model run. */
export function recluster(j: StoredJob, count: number, now: number): StoredJob | null {
  const base = activeVersion(j) ?? j.diarizations[0];
  if (!base || !base.turns.length) return null;
  const n = Math.max(1, Math.min(Math.floor(count), base.turns.length));
  const labels = clusterEmbeddings(base.turns.map((t) => t.embedding), { count: n });
  const turns = base.turns.map((t, i) => ({ ...t, speaker: labels[i] }));
  return addDiarization(j, turns, {}, now, `${n} ${n === 1 ? 'speaker' : 'speakers'} (re-clustered)`, 'recluster');
}

export interface RenderOptions {
  /** translation language, or null for the original */
  lang: string | null;
  /** diarization version id; undefined = the active one; null = no speaker labels */
  version?: string | null;
  /** keep the original text and add the translation as a second line (`alt`) */
  bilingual?: boolean;
}

/** Build what a viewer or an export shows. Read-only: computed from the stored parts, never stored itself. */
export function render(j: StoredJob, o: RenderOptions): Segment[] {
  const v = o.version === undefined ? activeVersion(j) : j.diarizations.find((x) => x.id === o.version);
  const base = v ? labelSegments(j.segments, v.turns, v.names) : j.segments;
  const tr = o.lang ? j.translations[o.lang] : undefined;
  if (!tr) return base;
  return base.map((s, i) => {
    const t = tr.texts[i] ?? s.text;
    return o.bilingual ? { ...s, alt: t } : { ...s, text: t };
  });
}
