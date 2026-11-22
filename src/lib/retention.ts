/** Browser-local retention rules. Pure functions: the clock is always passed in so tests can control it. */
export type Retention =
  | { mode: 'keep' }
  | { mode: 'afterDownload' }
  | { mode: 'days'; days: number };

export const DAY_MS = 86_400_000;
/** Platform default, same as the server product: hold a result for 7 days. */
export const DEFAULT_RETENTION: Retention = { mode: 'days', days: 7 };
/** After a download, "delete after download" items are removed once this much time has passed (so the open page doesn't vanish). */
export const DOWNLOAD_GRACE_MS = 15 * 60_000;

export interface Retained {
  id: string;
  retention: Retention;
  /** epoch ms when a 'days' hold ends; null for the other modes */
  expiresAt: number | null;
  downloadedAt: number | null;
}

export function normaliseRetention(r: unknown): Retention {
  const o = r as { mode?: string; days?: unknown } | null;
  if (o?.mode === 'keep') return { mode: 'keep' };
  if (o?.mode === 'afterDownload') return { mode: 'afterDownload' };
  if (o?.mode === 'days') {
    const d = Math.floor(Number(o.days));
    return { mode: 'days', days: Number.isFinite(d) && d >= 1 ? Math.min(d, 3650) : DEFAULT_RETENTION.mode === 'days' ? DEFAULT_RETENTION.days : 7 };
  }
  return DEFAULT_RETENTION;
}

/** When a hold that starts at `from` ends (null if it does not end on a date). */
export function expiryFor(r: Retention, from: number): number | null {
  return r.mode === 'days' ? from + r.days * DAY_MS : null;
}

export function isExpired(j: Retained, now: number): boolean {
  if (j.retention.mode === 'days') return j.expiresAt != null && j.expiresAt <= now;
  if (j.retention.mode === 'afterDownload') return j.downloadedAt != null && now - j.downloadedAt >= DOWNLOAD_GRACE_MS;
  return false;
}

export function describeRetention(j: Retained): string {
  if (j.retention.mode === 'keep') return 'Kept until you delete it';
  if (j.retention.mode === 'afterDownload') return j.downloadedAt ? 'Deleted shortly after your download' : 'Deleted after you download it';
  return j.expiresAt != null ? `Expires on ${new Date(j.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : 'Expiry unknown';
}

export interface Sweepable {
  list(): Promise<Retained[]>;
  remove(id: string): Promise<void>;
}

/** Delete everything that has expired. Returns the ids removed. Never throws: a failing item is skipped. */
export async function sweepExpired(store: Sweepable, now: number): Promise<string[]> {
  const removed: string[] = [];
  let items: Retained[];
  try {
    items = await store.list();
  } catch {
    return removed;
  }
  for (const j of items) {
    if (!isExpired(j, now)) continue;
    try {
      await store.remove(j.id);
      removed.push(j.id);
    } catch {
      /* try again on the next sweep */
    }
  }
  return removed;
}
