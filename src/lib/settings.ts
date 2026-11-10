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
  ls()?.setItem(THEME, t);
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
