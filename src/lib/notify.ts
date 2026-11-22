export const BASE_TITLE = 'VTT Transcribe';

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

/** Ask only when the user turns the option on. Resolves true if allowed. */
export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Show a notification only if the user opted in, it is allowed and the tab is in the background. */
export function notifyIfHidden(enabled: boolean, title: string, body: string): void {
  if (!enabled || !notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(title, { body });
  } catch {
    /* some mobile browsers only allow service-worker notifications */
  }
}

export function titleFor(running: { step: string; fraction: number | null } | null, waiting: number): string {
  if (!running) return BASE_TITLE;
  const pct = running.fraction == null ? '' : ` ${Math.round(running.fraction * 100)}%`;
  return `${running.step || 'Working'}${pct}${waiting ? ` (+${waiting} waiting)` : ''} · ${BASE_TITLE}`;
}
