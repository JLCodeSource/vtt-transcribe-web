import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const KEY = 'sk-test-fake-0000';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/** 6 s mono 16 kHz WAV: 0-3 s a 200 Hz tone ("voice A"), 3-6 s a 600 Hz tone ("voice B"). */
function twoVoiceWav(): Buffer {
  const rate = 16000;
  const n = rate * 6;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const f = i < rate * 3 ? 200 : 600;
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 12000), 44 + i * 2);
  }
  return b;
}

async function setup(page: Page) {
  const chat: string[] = [];
  await page.route('https://api.openai.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/chat/completions')) {
      chat.push(req.postData() ?? '');
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: (req.postData() ?? '').includes('French')
                  ? 'LINE_0: Bonjour à tous.\nLINE_1: Au revoir à tous.'
                  : 'LINE_0: Hola a todos.\nLINE_1: Adiós a todos.',
              },
            },
          ],
        }),
      });
    }
    await route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        segments: [
          { start: 0.2, end: 2.8, text: 'Hello everyone.' },
          { start: 3.2, end: 5.8, text: 'Goodbye everyone.' },
        ],
      }),
    });
  });
  // Stub speaker models: spans = the two tones; the "voice print" is high vs low zero-crossing rate.
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>).__VTT_DIARIZE_FACTORY__ = async () => ({
      speechSpans: async () => [
        { start: 0, end: 3, id: 1 },
        { start: 3, end: 6, id: 2 },
      ],
      embed: async (s: Float32Array) => {
        let z = 0;
        for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 !== s[i] < 0) z++;
        return (z / s.length) * 16000 > 800 ? Float32Array.from([0, 1]) : Float32Array.from([1, 0]);
      },
    });
  });
  await page.goto('/');
  await page.getByLabel(/Use OpenAI instead/).check();
  await page.getByLabel('Your OpenAI API key').fill(KEY);
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'call.wav', mimeType: 'audio/wav', buffer: twoVoiceWav() });
  return chat;
}

const txt = async (page: Page) => {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'TXT', exact: true }).click(),
  ]);
  return readFileSync((await dl.path())!, 'utf8');
};

test('translates into the chosen language and exports either version', async ({ page }) => {
  const chat = await setup(page);
  await page.getByLabel('Translate the transcript into').selectOption('es');
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await expect(page.getByText('Hola a todos.')).toBeVisible();
  expect(chat).toHaveLength(1);
  expect(chat[0]).toContain('Spanish');
  expect(chat[0]).toContain('LINE_1: Goodbye everyone.');
  expect(await txt(page)).toContain('Adiós a todos.');

  await page.getByLabel('Language', { exact: true }).selectOption('');
  await expect(page.getByText('Goodbye everyone.')).toBeVisible();
  expect(await txt(page)).toContain('Goodbye everyone.');
});

test('diarization: review, merge, split, rename, then speakers appear in transcript and exports', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Identify the speakers').check();
  await page.getByRole('button', { name: /Transcribe/ }).click();

  await expect(page.getByRole('heading', { name: 'Who is who?' })).toBeVisible();
  await expect(page.getByText('Found 2 speakers')).toBeVisible();

  // merge Speaker 2 into Speaker 1 -> one speaker
  await page.getByLabel('Merge Speaker 2 into').selectOption({ label: 'Speaker 1' });
  await page.locator('li[data-speaker="1"]').getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('Found 1 speaker')).toBeVisible();

  // split Speaker 1 -> two again
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByText('Found 2 speakers')).toBeVisible();

  await page.getByLabel('Name for Speaker 1').fill('Ada');
  await page.getByLabel('Name for Speaker 2').fill('Bob');
  await page.getByRole('button', { name: 'Looks good' }).click();

  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expect(page.getByText('Ada:')).toBeVisible();
  await expect(page.getByText('Bob:')).toBeVisible();
  const out = await txt(page);
  expect(out).toContain('Ada: Hello everyone.');
  expect(out).toContain('Bob: Goodbye everyone.');

  // names can be changed afterwards
  await page.getByRole('button', { name: 'Edit speakers' }).click();
  await page.getByLabel('Name for Speaker 2').fill('Robert');
  await page.getByRole('button', { name: 'Looks good' }).click();
  expect(await txt(page)).toContain('Robert: Goodbye everyone.');
});

test('diarization and translation together: by default everything runs first and the speakers are reviewed at the end', async ({
  page,
}) => {
  const chat = await setup(page);
  await page.getByLabel('Translate the transcript into').selectOption('es');
  await page.getByLabel('Identify the speakers').check();
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await expect(page.getByRole('button', { name: 'Looks good' })).toBeVisible();
  expect(chat).toHaveLength(1); // already translated by the time the human is asked about speakers
  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByRole('button', { name: 'SRT', exact: true })).toBeVisible();
  expect(chat).toHaveLength(1);
  expect(await txt(page)).toContain('Speaker 2: Adiós a todos.');
});

test('setting: review speakers before translating defers the translation until confirmed', async ({ page }) => {
  const chat = await setup(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Review the speakers before translating').check();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Translate the transcript into').selectOption('es');
  await page.getByLabel('Identify the speakers').check();
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await expect(page.getByRole('button', { name: 'Looks good' })).toBeVisible();
  expect(chat).toHaveLength(0); // nothing translated while the human is still reviewing speakers
  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByRole('button', { name: 'SRT', exact: true })).toBeVisible();
  expect(chat).toHaveLength(1);
  expect(await txt(page)).toContain('Speaker 2: Adiós a todos.');
});

test('skipping speaker labels keeps the plain transcript', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Identify the speakers').check();
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await page.getByRole('button', { name: 'Skip speaker labels' }).click();
  expect(await txt(page)).toBe('Hello everyone.\nGoodbye everyone.\n');
  await expect(page.getByRole('button', { name: 'Edit speakers' })).toHaveCount(0);
});

test('keeps every version: two languages, switch, re-cluster, merge on one version, bilingual export', async ({
  page,
}) => {
  const chat = await setup(page);
  await page.getByLabel('Translate the transcript into').selectOption('es');
  await page.getByLabel('Identify the speakers').check();
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByText('Hola a todos.')).toBeVisible();

  // add a second language: Spanish stays available
  const lang = page.getByLabel('Language', { exact: true });
  await lang.selectOption('__add');
  await page.getByLabel('Translate into').selectOption('fr');
  await page.getByLabel('Translation engine').selectOption('openai');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();
  expect(chat).toHaveLength(2);
  await lang.selectOption('es');
  await expect(page.getByText('Hola a todos.')).toBeVisible();
  await lang.selectOption('');
  await expect(page.getByText('Hello everyone.')).toBeVisible();

  // re-translating an existing language asks first
  await lang.selectOption('__add');
  await page.getByLabel('Translate into').selectOption('es');
  await page.getByLabel('Translation engine').selectOption('openai');
  await page.getByRole('button', { name: 'Re-translate' }).click();
  await expect(page.getByText(/Replace the existing Spanish translation/)).toBeVisible();
  expect(chat).toHaveLength(2);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // re-run with 1 speaker adds a version; version 1 is still there
  await page.getByLabel('Number of speakers').fill('1');
  await page.getByRole('button', { name: 'Re-run with 1 speaker', exact: true }).click();
  const ver = page.getByLabel('Speaker version', { exact: true });
  await expect(ver.locator('option')).toHaveCount(3); // none, version 1 (2 speakers), version 2 (1 speaker)
  expect(await txt(page)).toContain('Speaker 1: Goodbye everyone.');
  await ver.selectOption({ label: 'Speakers (version 1)' });
  expect(await txt(page)).toContain('Speaker 2: Goodbye everyone.');

  // merge on version 1 only
  await page.getByRole('button', { name: 'Edit speakers' }).click();
  await page.getByLabel('Merge Speaker 2 into').selectOption({ label: 'Speaker 1' });
  await page.locator('li[data-speaker="1"]').getByRole('button', { name: 'Merge', exact: true }).click();
  await page.getByRole('button', { name: 'Looks good' }).click();
  expect(await txt(page)).toContain('Speaker 1: Goodbye everyone.');

  // export chooses language + version, and can be bilingual
  await page.getByText('Export options').click();
  await page.getByLabel('Export language').selectOption('fr');
  await page.getByLabel('Export speaker version').selectOption({ label: 'No speaker labels' });
  await page.getByLabel(/Bilingual/).check();
  const out = await txt(page);
  expect(out).toContain('Hello everyone.\nBonjour à tous.');
  expect(out).not.toContain('Speaker');
});

test('a result saved by an older release: on-device "Add language" asks for the source language once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>).__VTT_TRANSLATE_FACTORY__ =
      async ({ pair }: { pair: string }) =>
      (texts: string[]) =>
        texts.map((t) => `[${pair}] ${t}`);
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Jobs' })).toBeVisible();
  // write an old-shape record (translation baked into the segments, no source language) straight into IndexedDB
  await page.evaluate(
    () =>
      new Promise<void>((res, rej) => {
        const r = indexedDB.open('vtt-transcribe', 1);
        r.onerror = () => rej(r.error);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('jobs', { keyPath: 'id' });
          r.result.createObjectStore('audio');
        };
        r.onsuccess = () => {
          const t = r.result.transaction('jobs', 'readwrite');
          t.objectStore('jobs').put({
            id: 'old1',
            name: 'legacy.wav',
            completedAt: Date.now(),
            awaitingReview: false,
            translate: null,
            ranOn: 'on this device',
            segments: [{ start: 0, end: 2, text: 'Hello everyone.', translation: 'Hola a todos.' }],
            turns: null,
            names: {},
            retention: { mode: 'keep' },
            expiresAt: null,
            downloadedAt: null,
            hasAudio: false,
          });
          t.oncomplete = () => res();
        };
      }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await page.getByRole('button', { name: 'Open' }).click();
  // the old translation is kept, labelled honestly
  await expect(page.getByText('Hola a todos.')).toBeVisible();
  const lang = page.getByLabel('Language', { exact: true });
  await lang.selectOption('__add');
  await page.getByLabel('Translate into').selectOption('fr');
  await page.getByLabel('Translation engine').selectOption('local');
  // on-device needs the source: it cannot be left blank and is not guessed
  await expect(page.getByText(/saved before the language was recorded/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();
  await page.getByLabel('Audio language').selectOption('en');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('[en-fr] Hello everyone.')).toBeVisible();
  // it was stored: the next language does not ask again
  await lang.selectOption('__add');
  await page.getByLabel('Translate into').selectOption('de');
  await page.getByLabel('Translation engine').selectOption('local');
  await expect(page.getByText(/saved before the language was recorded/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('[en-de] Hello everyone.')).toBeVisible();
  // and the original translation is still available
  await lang.selectOption({ label: 'Translation (language not recorded)' });
  await expect(page.getByText('Hola a todos.')).toBeVisible();
});
