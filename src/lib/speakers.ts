import type { Segment } from './types';

/** One stretch of a single person speaking, with its voice embedding. */
export interface Turn {
  start: number;
  end: number;
  /** L2-normalised voice embedding */
  embedding: Float32Array;
  /** cluster id (0-based, stable once assigned) */
  speaker: number;
}

export function normalise(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine distance for already-normalised vectors. */
export function cosDist(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return 1 - d;
}

export interface ClusterOptions {
  /** stop merging when the closest pair is farther apart than this (cosine distance) */
  threshold?: number;
  /** if set, merge until exactly this many clusters remain (overrides threshold) */
  count?: number;
}

/**
 * Average-linkage agglomerative clustering. Returns a label per input, numbered by first appearance.
 * O(n^3) worst case, fine for the few hundred turns in a typical recording.
 */
export function clusterEmbeddings(embs: Float32Array[], opts: ClusterOptions = {}): number[] {
  const n = embs.length;
  if (n === 0) return [];
  const threshold = opts.threshold ?? 0.4;
  let clusters: number[][] = embs.map((_, i) => [i]);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += cosDist(embs[i], embs[j]);
    return s / (a.length * b.length);
  };
  const target = opts.count != null ? Math.max(1, opts.count) : 1;
  while (clusters.length > target) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i], clusters[j]);
        if (d < best) [best, bi, bj] = [d, i, j];
      }
    if (opts.count == null && best > threshold) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }
  const labels = new Array<number>(n).fill(0);
  clusters = clusters.sort((a, b) => Math.min(...a) - Math.min(...b));
  clusters.forEach((c, id) => c.forEach((i) => (labels[i] = id)));
  return labels;
}

/** Sorted distinct speaker ids present in the turns. */
export function speakerIds(turns: Turn[]): number[] {
  return [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);
}

/** Merge speaker `from` into `into`. */
export function mergeSpeakers(turns: Turn[], from: number, into: number): Turn[] {
  if (from === into) return turns;
  return turns.map((t) => (t.speaker === from ? { ...t, speaker: into } : t));
}

/**
 * Split one speaker in two by re-clustering just their turns. The part least similar to the
 * original centroid gets a fresh id. Returns the new turns and the new id, or null if the
 * speaker has fewer than two turns to separate.
 */
export function splitSpeaker(turns: Turn[], id: number): { turns: Turn[]; newId: number } | null {
  const idx = turns.map((t, i) => (t.speaker === id ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const labels = clusterEmbeddings(
    idx.map((i) => turns[i].embedding),
    { count: 2 }
  );
  const newId = Math.max(-1, ...turns.map((t) => t.speaker)) + 1;
  const out = turns.slice();
  // the cluster containing the first turn keeps the old id
  idx.forEach((ti, k) => {
    if (labels[k] === 1) out[ti] = { ...turns[ti], speaker: newId };
  });
  return { turns: out, newId };
}

/** Speaker with the greatest time overlap with [start,end]; the nearest turn if none overlap. */
export function speakerAt(turns: Turn[], start: number, end: number): number | undefined {
  if (!turns.length) return undefined;
  const score = new Map<number, number>();
  for (const t of turns) {
    const o = Math.min(end, t.end) - Math.max(start, t.start);
    if (o > 0) score.set(t.speaker, (score.get(t.speaker) ?? 0) + o);
  }
  if (score.size) return [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mid = (start + end) / 2;
  return turns.reduce((best, t) => {
    const d = Math.min(Math.abs(t.start - mid), Math.abs(t.end - mid));
    return d < best.d ? { d, s: t.speaker } : best;
  }, { d: Infinity, s: turns[0].speaker }).s;
}

export type SpeakerNames = Record<number, string>;

export const defaultName = (id: number) => `Speaker ${id + 1}`;

/** Attach a speaker name to every segment. */
export function labelSegments(segments: Segment[], turns: Turn[], names: SpeakerNames = {}): Segment[] {
  return segments.map((s) => {
    const id = speakerAt(turns, s.start, s.end);
    return id == null ? s : { ...s, speaker: names[id]?.trim() || defaultName(id) };
  });
}

/** Seconds spoken per speaker, and the longest turns for audio previews. */
export function speakerSummary(turns: Turn[], id: number): { seconds: number; samples: Array<{ start: number; end: number }> } {
  const mine = turns.filter((t) => t.speaker === id);
  const seconds = mine.reduce((a, t) => a + (t.end - t.start), 0);
  const samples = mine
    .slice()
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 3)
    .map((t) => ({ start: t.start, end: Math.min(t.end, t.start + 8) }));
  return { seconds, samples };
}
