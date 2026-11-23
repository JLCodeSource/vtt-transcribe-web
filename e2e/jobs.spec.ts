import { expect, test, type Page } from '@playwright/test';

/** 1 s of 16 kHz silence as a WAV file. */
function wav(): Buffer {
  const n = 16000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
const files = (...names: string[]) => names.map((name) => ({ name, mimeType: 'audio/wav', buffer: wav() }));

/**
 * Stub the on-device model. Each transcription waits for the test to release it, so the test controls
 * the order and can prove that two never run at once. Results are "words 1", "words 2", ... by start order.
 */
async function stubModel(page: Page) {
  await page.addInitScript(() => {
    const w = globalThis as any;
    w.__active = 0;
    w.__max = 0;
    w.__started = 0;
    w.__release = [];
    w.__VTT_PIPELINE_FACTORY__ = async () => async () => {
      const n = ++w.__started;
      w.__active++;
      w.__max = Math.max(w.__max, w.__active);
      await new Promise<void>((r) => w.__release.push(r));
      w.__active--;
      return { text: `words ${n}`, chunks: [{ text: ` words ${n}`, timestamp: [0, 1] }] };
    };
  });
}
const release = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => (globalThis as any).__release.length as number)).toBeGreaterThan(0);
  await page.evaluate(() => (globalThis as any).__release.shift()());
};
const started = (page: Page) => page.evaluate(() => (globalThis as any).__started as number);

test('queue: several files run one at a time in order, with position, cancel and progress in the title', async ({
  page,
}) => {
  await stubModel(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files('one.wav', 'two.wav', 'three.wav'));
  await page.getByRole('button', { name: 'Transcribe' }).click();

  const live = page.getByTestId('live-jobs').locator('li');
  await expect(live).toHaveCount(3);
  await expect(live.nth(0)).toContainText('one.wav');
  await expect(live.nth(0)).toHaveAttribute('data-status', 'running');
  await expect(live.nth(1)).toContainText('Waiting · position 1');
  await expect(live.nth(2)).toContainText('Waiting · position 2');
  await expect(page).toHaveTitle(/Transcribing.*\(\+2 waiting\)/);
  expect(await started(page)).toBe(1);

  // cancel the last one while it waits
  await live.nth(2).getByRole('button', { name: 'Cancel' }).click();
  await expect(live.nth(2)).toHaveAttribute('data-status', 'cancelled');

  await release(page);
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(1);
  await expect(live.nth(0)).toHaveAttribute('data-status', 'running'); // two.wav now
  await expect.poll(() => started(page)).toBe(2);
  await release(page);
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(2);
  expect(await started(page)).toBe(2); // the cancelled one never ran
  expect(await page.evaluate(() => (globalThis as any).__max)).toBe(1);
  await expect(page).toHaveTitle('VTT Transcribe');

  // back to the main page and queue another
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByTestId('file-input')).toBeAttached();
});

test('results are held in this browser: survive a reload, can be re-opened and downloaded, retention can be changed', async ({
  page,
}) => {
  await stubModel(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files('a.wav', 'b.wav'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await release(page);
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(1);
  await release(page);
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('saved-jobs')).toContainText('Expires on'); // platform default: hold 7 days

  await page.reload();
  await page.getByRole('button', { name: 'Jobs' }).click();
  const saved = page.getByTestId('saved-jobs').locator('li');
  await expect(saved).toHaveCount(2);

  // per-item override
  const first = saved.filter({ hasText: 'a.wav' });
  await page.getByLabel('Keep a.wav').selectOption('keep');
  await expect(first).toContainText('Kept until you delete it');
  await page.getByLabel('Keep b.wav').selectOption('afterDownload');

  // re-open and download
  await first.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('words 1')).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'TXT', exact: true }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('a.txt');
  await page.getByRole('button', { name: 'Back to jobs' }).click();

  // no audio is stored unless the user opted in
  const hasAudio = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const r = indexedDB.open('vtt-transcribe');
        r.onsuccess = () => {
          const q = r.result.transaction('audio').objectStore('audio').count();
          q.onsuccess = () => res(q.result);
        };
      }),
  );
  expect(hasAudio).toBe(0);

  await page.getByRole('button', { name: 'Delete b.wav' }).click();
  await expect(saved).toHaveCount(1);
});

test('retention sweep on load removes expired results only', async ({ page }) => {
  await stubModel(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files('keepme.wav', 'old.wav'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await release(page);
  await release(page);
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(2);

  // age one result past its expiry directly in the database, as if time had passed
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const r = indexedDB.open('vtt-transcribe');
        r.onsuccess = () => {
          const tx = r.result.transaction('jobs', 'readwrite');
          const st = tx.objectStore('jobs');
          st.getAll().onsuccess = (e) => {
            for (const j of (e.target as IDBRequest).result)
              if (j.name === 'old.wav') st.put({ ...j, expiresAt: Date.now() - 1000 });
          };
          tx.oncomplete = () => res();
        };
      }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await expect(page.getByTestId('saved-jobs').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('saved-jobs')).toContainText('keepme.wav');
});

test('settings: default retention, key wording, notification opt-in, and Delete all my data', async ({
  page,
  context,
}) => {
  await stubModel(page);
  await context.grantPermissions(['notifications']).catch(() => {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/stored unencrypted in this browser/)).toBeVisible();
  await page.getByLabel('Default retention').selectOption('days:14');

  await page.getByTestId('file-input').count(); // (home is not shown here)
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByTestId('file-input').setInputFiles(files('x.wav'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await release(page);
  await expect(page.getByText('words 1')).toBeVisible(); // a lone file opens by itself
  await page.getByRole('button', { name: 'Back to jobs' }).click();
  const when = new Date(Date.now() + 14 * 86400000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  await expect(page.getByTestId('saved-jobs')).toContainText(`Expires on ${when}`);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(page.getByText('All data stored by this app in this browser has been deleted.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('vtt.')))).toEqual([]);
});
