import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const KEY = 'sk-test-fake-0000';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/** 6 s mono 16 kHz WAV: 0-3 s a 200 Hz tone ("voice A"), 3-6 s a 600 Hz tone ("voice B"). */
function twoVoiceWav(): Buffer {
  const rate = 16000;
  const n = rate * 6;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
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
        status: 200, headers: CORS, contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: 'LINE_0: Hola a todos.\nLINE_1: Adiós a todos.' } }] }),
      });
    }
    await route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ segments: [{ start: 0.2, end: 2.8, text: 'Hello everyone.' }, { start: 3.2, end: 5.8, text: 'Goodbye everyone.' }] }),
    });
  });
  // Stub speaker models: spans = the two tones; the "voice print" is high vs low zero-crossing rate.
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>).__VTT_DIARIZE_FACTORY__ = async () => ({
      speechSpans: async () => [{ start: 0, end: 3, id: 1 }, { start: 3, end: 6, id: 2 }],
      embed: async (s: Float32Array) => {
        let z = 0;
        for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 !== s[i] < 0) z++;
        return (z / s.length) * 16000 > 800 ? Float32Array.from([0, 1]) : Float32Array.from([1, 0]);
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Your OpenAI API key').fill(KEY);
  await page.getByTestId('file-input').setInputFiles({ name: 'call.wav', mimeType: 'audio/wav', buffer: twoVoiceWav() });
  return chat;
}

const txt = async (page: Page) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'TXT', exact: true }).click()]);
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

  await page.getByLabel('Show / export the translation').uncheck();
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

test('diarization and translation together: speakers first, translation only after review', async ({ page }) => {
  const chat = await setup(page);
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
