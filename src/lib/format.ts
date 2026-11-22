import type { Segment } from './types';

function split(seconds: number): [number, number, number, number] {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  return [h, m, s, ms];
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function srtTime(seconds: number): string {
  const [h, m, s, ms] = split(seconds);
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, '0')}`;
}

export function vttTime(seconds: number): string {
  return srtTime(seconds).replace(',', '.');
}

/** Short display time: mm:ss, or h:mm:ss for long audio. */
export function clockTime(seconds: number): string {
  const [h, m, s] = split(seconds);
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

const clean = (t: string) => t.trim().replace(/\r?\n+/g, ' ');
const line = (s: Segment) => (s.speaker ? `${s.speaker}: ${clean(s.text)}` : clean(s.text)) + (s.alt ? `\n${clean(s.alt)}` : '');

/** The segments as they should read: translated text when chosen, else the original. */
export function view(segments: Segment[], translated: boolean): Segment[] {
  return translated ? segments.map((s) => ({ ...s, text: s.translation ?? s.text })) : segments;
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${line(s)}\n`)
    .join('\n');
}

export function toVtt(segments: Segment[]): string {
  const body = segments
    .map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${line(s)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function toTxt(segments: Segment[]): string {
  return segments.map(line).join('\n') + (segments.length ? '\n' : '');
}

export function toJson(segments: Segment[]): string {
  return JSON.stringify({ segments }, null, 2);
}

export type ExportFormat = 'srt' | 'vtt' | 'txt' | 'json';

export const EXPORTERS: Record<ExportFormat, { fn: (s: Segment[]) => string; mime: string }> = {
  srt: { fn: toSrt, mime: 'application/x-subrip' },
  vtt: { fn: toVtt, mime: 'text/vtt' },
  txt: { fn: toTxt, mime: 'text/plain' },
  json: { fn: toJson, mime: 'application/json' },
};
