import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const KEY = 'sk-test-fake-0000';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const fx = (n: string) => join(process.cwd(), 'e2e/fixtures', n);

/** Mock OpenAI; records each upload (size + WAV header) and answers with one segment at 1-2 s. */
async function mock(page: Page) {
  const uploads: { size: number; filename: string; riff: boolean }[] = [];
  await page.route('https://api.openai.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const buf = req.postDataBuffer() ?? Buffer.alloc(0);
    uploads.push({
      size: buf.length,
      filename: /filename="([^"]+)"/.exec(buf.toString('latin1'))?.[1] ?? '',
      riff: buf.includes(Buffer.from('RIFF')) && buf.includes(Buffer.from('WAVE')),
    });
    await route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ segments: [{ start: 1, end: 2, text: `part ${uploads.length}` }] }),
    });
  });
  return uploads;
}

test('OpenAI chunking: a big file is decoded in the browser and sent as several WAV parts with offset timestamps', async ({ page, browserName }) => {
  const uploads = await mock(page);
  // Lower the limits so the 22 s mp3 takes the same path a 25+ MB file takes (3 chunks of 10 s).
  await page.addInitScript(() => {
    (globalThis as any).__VTT_OPENAI_LIMITS__ = { maxDirectBytes: 1000, chunkSeconds: 10 };
  });
  await page.goto('/');
  await page.getByLabel(/Use OpenAI instead/).check();
  await page.getByLabel('Your OpenAI API key').fill(KEY);
  await page.getByTestId('file-input').setInputFiles(fx('hello_conversation.mp3'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByText('part 3')).toBeVisible();

  expect(uploads).toHaveLength(3);
  expect(uploads.every((u) => u.filename.endsWith('.wav'))).toBe(true);
  // Playwright's WebKit does not expose binary multipart bodies, so inspect payload bytes elsewhere only.
  if (browserName !== 'webkit') {
    expect(uploads.every((u) => u.riff)).toBe(true);
  // 10 s of 16 kHz mono 16-bit = 320 KB (+ multipart overhead); last part is the ~2.3 s remainder
  expect(uploads[0].size).toBeGreaterThan(320000);
  expect(uploads[0].size).toBeLessThan(330000);
  expect(uploads[2].size).toBeLessThan(100000);
  }
  // Timestamps continue across chunks: 1, 11, 21 s
  await expect(page.locator('ol li time')).toHaveText(['00:01', '00:11', '00:21']);
});

// Chromium never decodes the video track, so H.264 video is fine as long as the AUDIO codec is available.
const videos = ['video-vp8-opus.webm', 'video-theora-vorbis.ogv', 'video-h264-mp3.mp4', 'video-vp9-opus.mp4', 'video-h264-aac.mp4'];
for (const name of videos) {
  test(`on-device engine decodes ${name} (video container, audio track)`, async ({ page, browserName }, info) => {
    // Phone/camera mp4 files carry AAC audio. Playwright's open-source Chromium has no AAC decoder
    // (branded Chrome does); Firefox and WebKit do and are tested instead.
    test.skip(name.includes('aac') && browserName === 'chromium' && info.project.name !== 'chrome', 'Playwright Chromium has no AAC decoder');
    // Stub the model: we only need to prove the container decodes to real audio samples.
    await page.addInitScript(() => {
      (globalThis as any).__VTT_PIPELINE_FACTORY__ = async () => async (samples: Float32Array) => ({
        text: 'x',
        chunks: [{ text: `samples=${samples.length}`, timestamp: [0, 1] }],
      });
    });
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fx(name));
    await page.getByRole('button', { name: 'Transcribe' }).click();
    // 6-22 s of audio at 16 kHz => 90k-360k samples in the first (<=30 s) window
    const first = await page.locator('ol li').first().innerText();
    expect(Number(/samples=(\d+)/.exec(first)?.[1])).toBeGreaterThan(90000);
  });
}
