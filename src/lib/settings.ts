const KEY = 'vtt.openaiKey';
const THEME = 'vtt.theme';

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The key is only ever persisted when the user explicitly opts in. */
export function loadSavedKey(): string {
  return ls()?.getItem(KEY) ?? '';
}
export function saveKey(key: string): void {
  ls()?.setItem(KEY, key);
}
export function forgetKey(): void {
  ls()?.removeItem(KEY);
}

export type Theme = 'light' | 'dark' | 'system';
export function loadTheme(): Theme {
  const t = ls()?.getItem(THEME);
  return t === 'light' || t === 'dark' ? t : 'system';
}
export function applyTheme(t: Theme): void {
  if (t === 'system') ls()?.removeItem(THEME); // the default is not a stored preference
  else ls()?.setItem(THEME, t);
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// --- local-only preferences (all stored in this browser, nothing leaves it) ---
import { DEFAULT_RETENTION, normaliseRetention, type Retention } from './retention';

const RETENTION = 'vtt.retention';
const KEEP_AUDIO = 'vtt.keepAudio';
const NOTIFY = 'vtt.notify';

export function loadDefaultRetention(): Retention {
  try {
    const raw = ls()?.getItem(RETENTION);
    return raw ? normaliseRetention(JSON.parse(raw)) : DEFAULT_RETENTION;
  } catch {
    return DEFAULT_RETENTION;
  }
}
export function saveDefaultRetention(r: Retention): void {
  ls()?.setItem(RETENTION, JSON.stringify(normaliseRetention(r)));
}
export const loadKeepAudio = (): boolean => ls()?.getItem(KEEP_AUDIO) === '1';
export const saveKeepAudio = (v: boolean): void => void ls()?.setItem(KEEP_AUDIO, v ? '1' : '0');
export const loadNotify = (): boolean => ls()?.getItem(NOTIFY) === '1';
export const saveNotify = (v: boolean): void => void ls()?.setItem(NOTIFY, v ? '1' : '0');

/** Remove every preference and the saved key (the "Delete all my data" button). */
export function clearLocalSettings(): void {
  const s = ls();
  if (!s) return;
  for (const k of Object.keys(s)) if (k.startsWith('vtt.')) s.removeItem(k);
}
