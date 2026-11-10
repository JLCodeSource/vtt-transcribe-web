import { expect, test, type Page } from '@playwright/test';

const FAKE_KEY = 'sk-test-fake-0000';

/** 1 s of 16 kHz silence as a WAV file. */
function tinyWav(): Buffer {
  const n = 16000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const upload = (page: Page) =>
  page.getByTestId('file-input').setInputFiles({ name: 'talk.wav', mimeType: 'audio/wav', buffer: tinyWav() });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

async function mockOpenAI(page: Page, status = 200) {
  const seen: { auth?: string; model?: string; body?: string }[] = [];
  await page.route('https://api.openai.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postData() ?? '';
    seen.push({ auth: req.headers()['authorization'], model: /name="model"\r\n\r\n([^\r]+)/.exec(body)?.[1], body });
    if (status !== 200)
      return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { message: 'nope' } }) });
    await route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ segments: [{ start: 0, end: 1.5, text: ' Hello there.' }, { start: 1.5, end: 3, text: 'General Kenobi.' }] }),
    });
  });
  return seen;
}

test('BYOK: sends audio straight to OpenAI with the key, shows transcript, exports', async ({ page }) => {
  const seen = await mockOpenAI(page);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  page.on('dialog', () => { throw new Error('unexpected alert/confirm dialog'); });

  await page.goto('/');
  await page.getByLabel('Your OpenAI API key').fill(FAKE_KEY);
  await upload(page);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  await expect(page.getByText('General Kenobi.')).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0].auth).toBe(`Bearer ${FAKE_KEY}`);
  expect(seen[0].model).toBe('whisper-1');
  expect([...hosts].filter((h) => !['localhost', '127.0.0.1'].includes(h))).toEqual(['api.openai.com']);

  // Key is not persisted unless the user opts in.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(FAKE_KEY);

  for (const [fmt, needle] of [['SRT', '00:00:01,500 --> 00:00:03,000'], ['VTT', 'WEBVTT'], ['TXT', 'Hello there.'], ['JSON', '"segments"']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: fmt, exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe(`talk.${fmt.toLowerCase()}`);
    const text = (await import('node:fs')).readFileSync((await dl.path())!, 'utf8');
    expect(text).toContain(needle);
  }

  await page.getByPlaceholder('Search transcript…').fill('kenobi');
  await expect(page.getByText('1 of 2 segments')).toBeVisible();
});

test('BYOK: key is remembered only when the user opts in', async ({ page }) => {
  await mockOpenAI(page);
  await page.goto('/');
  await page.getByLabel('Your OpenAI API key').fill(FAKE_KEY);
  await page.getByLabel(/Remember the key/).check();
  await upload(page);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByText('Hello there.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your OpenAI API key')).toHaveValue(FAKE_KEY);
});

test('invalid key shows an inline error, not an alert popup', async ({ page }) => {
  await mockOpenAI(page, 401);
  page.on('dialog', () => { throw new Error('unexpected dialog'); });
  await page.goto('/');
  await page.getByLabel('Your OpenAI API key').fill(FAKE_KEY);
  await upload(page);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the API key');
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
});

test('Transcribe is disabled until a key and file are provided', async ({ page }) => {
  await page.goto('/');
  const go = page.getByRole('button', { name: 'Transcribe' });
  await expect(go).toBeDisabled();
  await upload(page);
  await expect(go).toBeDisabled();
  await expect(page.getByText('Enter your API key to continue.')).toBeVisible();
  await page.getByLabel('Your OpenAI API key').fill(FAKE_KEY);
  await expect(go).toBeEnabled();
});

test('on-device engine (stubbed model) needs no key and makes no network calls', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).__VTT_PIPELINE_FACTORY__ = async ({ onFile }: any) => {
      onFile('model.onnx', 0.5);
      return async () => ({ text: 'stub', chunks: [{ text: ' stubbed words', timestamp: [0, 1] }] });
    };
  });
  const external: string[] = [];
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (!['localhost', '127.0.0.1'].includes(h) && r.url().startsWith('http')) external.push(r.url()); });

  await page.goto('/');
  await page.getByRole('radio', { name: /On this device/ }).check();
  await expect(page.getByLabel('Your OpenAI API key')).toHaveCount(0);
  await upload(page);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByText('stubbed words')).toBeVisible();
  expect(external).toEqual([]);
});

test('layout: no horizontal scroll, theme toggle works', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
