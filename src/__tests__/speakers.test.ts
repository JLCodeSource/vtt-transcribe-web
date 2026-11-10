import { describe, expect, it } from 'vitest';
import {
  clusterEmbeddings, labelSegments, mergeSpeakers, normalise, speakerAt, speakerIds, splitSpeaker, type Turn,
} from '../lib/speakers';
import { mergeSpans } from '../lib/diarize';

const v = (...x: number[]) => normalise(Float32Array.from(x));
const turn = (start: number, end: number, speaker: number, e: Float32Array): Turn => ({ start, end, speaker, embedding: e });

describe('clustering', () => {
  const A = [v(1, 0.05), v(1, -0.05), v(0.98, 0)];
  const B = [v(0.05, 1), v(-0.05, 1)];
  it('separates two voices by threshold', () => {
    expect(clusterEmbeddings([A[0], B[0], A[1], B[1], A[2]])).toEqual([0, 1, 0, 1, 0]);
  });
  it('honours a requested count', () => {
    expect(new Set(clusterEmbeddings([...A, ...B], { count: 1 })).size).toBe(1);
    expect(clusterEmbeddings([...A, ...B], { count: 2 })).toEqual([0, 0, 0, 1, 1]);
  });
  it('handles empty input', () => expect(clusterEmbeddings([])).toEqual([]));
});

describe('merge / split', () => {
  const turns = [turn(0, 2, 0, v(1, 0.05)), turn(2, 4, 1, v(0, 1)), turn(4, 6, 2, v(1, -0.05)), turn(6, 8, 0, v(1, 0))];
  it('merges one speaker into another', () => {
    const m = mergeSpeakers(turns, 2, 0);
    expect(speakerIds(m)).toEqual([0, 1]);
  });
  it('splits a speaker whose turns are two voices', () => {
    const mixed = [turn(0, 2, 0, v(1, 0)), turn(2, 4, 0, v(0, 1)), turn(4, 6, 0, v(1, 0.02)), turn(6, 8, 0, v(0.02, 1))];
    const r = splitSpeaker(mixed, 0)!;
    expect(r.newId).toBe(1);
    expect(r.turns.map((t) => t.speaker)).toEqual([0, 1, 0, 1]);
  });
  it('refuses to split a single turn', () => expect(splitSpeaker([turns[0]], 0)).toBeNull());
});

describe('assigning speakers to transcript segments', () => {
  const turns = [turn(0, 5, 0, v(1, 0)), turn(5, 10, 1, v(0, 1))];
  it('picks the speaker with most overlap', () => {
    expect(speakerAt(turns, 4, 9)).toBe(1);
    expect(speakerAt(turns, 0, 3)).toBe(0);
  });
  it('falls back to the nearest turn', () => expect(speakerAt(turns, 12, 13)).toBe(1));
  it('labels with names, defaulting to Speaker N', () => {
    const out = labelSegments([{ start: 0, end: 3, text: 'hi' }, { start: 6, end: 9, text: 'yo' }], turns, { 1: ' Ada ' });
    expect(out.map((s) => s.speaker)).toEqual(['Speaker 1', 'Ada']);
  });
});

describe('mergeSpans', () => {
  it('joins near spans only', () => {
    expect(mergeSpans([{ start: 0, end: 1 }, { start: 1.2, end: 2 }, { start: 5, end: 6 }])).toEqual([
      { start: 0, end: 2 }, { start: 5, end: 6 },
    ]);
  });
  it('never joins different local speakers', () => {
    expect(mergeSpans([{ start: 0, end: 3, id: 1 }, { start: 3, end: 6, id: 2 }])).toHaveLength(2);
  });
});
