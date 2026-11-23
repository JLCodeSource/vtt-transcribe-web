import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DEFAULT_RETENTION,
  DOWNLOAD_GRACE_MS,
  describeRetention,
  expiryFor,
  isExpired,
  normaliseRetention,
  sweepExpired,
  type Retained,
} from '../lib/retention';

const T0 = Date.UTC(2026, 0, 1);
const job = (id: string, o: Partial<Retained> = {}): Retained => ({
  id,
  retention: { mode: 'days', days: 7 },
  expiresAt: T0 + 7 * DAY_MS,
  downloadedAt: null,
  ...o,
});

describe('retention', () => {
  it('platform default is a 7 day hold', () => {
    expect(DEFAULT_RETENTION).toEqual({ mode: 'days', days: 7 });
    expect(expiryFor(DEFAULT_RETENTION, T0)).toBe(T0 + 7 * DAY_MS);
    expect(expiryFor({ mode: 'keep' }, T0)).toBeNull();
  });

  it('days holds expire exactly at the deadline, never early', () => {
    const j = job('a');
    expect(isExpired(j, T0 + 7 * DAY_MS - 1)).toBe(false);
    expect(isExpired(j, T0 + 7 * DAY_MS)).toBe(true);
  });

  it('keep never expires; delete-after-download waits for a download plus a grace period', () => {
    expect(isExpired(job('k', { retention: { mode: 'keep' }, expiresAt: null }), T0 + 9999 * DAY_MS)).toBe(false);
    const d = job('d', { retention: { mode: 'afterDownload' }, expiresAt: null });
    expect(isExpired(d, T0 + 365 * DAY_MS)).toBe(false);
    d.downloadedAt = T0;
    expect(isExpired(d, T0 + DOWNLOAD_GRACE_MS - 1)).toBe(false);
    expect(isExpired(d, T0 + DOWNLOAD_GRACE_MS)).toBe(true);
  });

  it('sweep deletes only expired items, using the injected clock', async () => {
    const items = [
      job('old', { expiresAt: T0 + DAY_MS }),
      job('fresh', { expiresAt: T0 + 5 * DAY_MS }),
      job('kept', { retention: { mode: 'keep' }, expiresAt: null }),
      job('dl', { retention: { mode: 'afterDownload' }, expiresAt: null, downloadedAt: T0 }),
    ];
    const store = {
      list: async () => [...items],
      remove: async (id: string) =>
        void items.splice(
          items.findIndex((i) => i.id === id),
          1,
        ),
    };
    expect(await sweepExpired(store, T0)).toEqual([]);
    expect(await sweepExpired(store, T0 + 2 * DAY_MS)).toEqual(['old', 'dl']);
    expect(items.map((i) => i.id)).toEqual(['fresh', 'kept']);
    expect(await sweepExpired(store, T0 + 6 * DAY_MS)).toEqual(['fresh']);
  });

  it('a failing delete or list does not throw', async () => {
    expect(
      await sweepExpired(
        {
          list: async () => {
            throw new Error('x');
          },
          remove: async () => {},
        },
        T0,
      ),
    ).toEqual([]);
    expect(
      await sweepExpired(
        {
          list: async () => [job('a', { expiresAt: 0 })],
          remove: async () => {
            throw new Error('x');
          },
        },
        T0,
      ),
    ).toEqual([]);
  });

  it('normalises stored values and describes them', () => {
    expect(normaliseRetention({ mode: 'days', days: 0 })).toEqual({ mode: 'days', days: 7 });
    expect(normaliseRetention({ mode: 'days', days: 3.9 })).toEqual({ mode: 'days', days: 3 });
    expect(normaliseRetention('junk')).toEqual(DEFAULT_RETENTION);
    expect(describeRetention(job('a'))).toMatch(/^Expires on /);
    expect(describeRetention(job('k', { retention: { mode: 'keep' }, expiresAt: null }))).toMatch(/Kept/);
  });
});
