import { describe, expect, it } from 'vitest';
import { clockTime, srtTime, toJson, toSrt, toTxt, toVtt, vttTime } from '../lib/format';

const segs = [
  { start: 0, end: 2.5, text: ' Hello world ' },
  { start: 3661.007, end: 3662, text: 'Line one\nline two' },
];

describe('formatters', () => {
  it('formats SRT timestamps with comma', () => {
    expect(srtTime(0)).toBe('00:00:00,000');
    expect(srtTime(3661.007)).toBe('01:01:01,007');
    expect(srtTime(-5)).toBe('00:00:00,000');
  });
  it('formats VTT timestamps with dot', () => {
    expect(vttTime(1.5)).toBe('00:00:01.500');
  });
  it('rounds milliseconds without overflowing to 1000', () => {
    expect(srtTime(1.9996)).toBe('00:00:02,000');
  });
  it('clockTime drops hours when zero', () => {
    expect(clockTime(75)).toBe('01:15');
    expect(clockTime(3725)).toBe('1:02:05');
  });
  it('toSrt numbers cues and trims/joins text', () => {
    expect(toSrt(segs)).toBe(
      '1\n00:00:00,000 --> 00:00:02,500\nHello world\n\n2\n01:01:01,007 --> 01:01:02,000\nLine one line two\n'
    );
  });
  it('toVtt has header', () => {
    expect(toVtt(segs).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello world')).toBe(true);
  });
  it('toTxt is one line per segment', () => {
    expect(toTxt(segs)).toBe('Hello world\nLine one line two\n');
    expect(toTxt([])).toBe('');
  });
  it('toJson round-trips', () => {
    expect(JSON.parse(toJson(segs)).segments).toEqual(segs);
  });
});
